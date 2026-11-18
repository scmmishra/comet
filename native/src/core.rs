//! The Bun core: starting it, reading its messages and stopping it. The core serves every project,
//! for every tab of the window.

use crate::ids;
use crate::protocol::{ClientMessage, CoreMessage, CoreReady};
use std::io::{BufRead, BufReader, ErrorKind, Read};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tungstenite::{Message, WebSocket};

const START_TIMEOUT: Duration = Duration::from_secs(10);
const STOP_GRACE: Duration = Duration::from_secs(1);
/// How long the socket thread waits for a core message before it sends what the app queued. A
/// message the app sends waits at most this long.
const SEND_WAIT: Duration = Duration::from_millis(4);
/// A Comet run from the repo keeps its window and plugin builds in `~/.comet/native`, apart from the
/// installed Comet's `~/.comet`.
const DEV_INSTANCE: &str = "native";

/// Where the core runs from, and which Comet it serves.
#[derive(Debug, PartialEq)]
pub struct Setup {
    pub bun: PathBuf,
    /// The folder holding `core/src/main.ts`.
    pub dir: PathBuf,
    /// The instance's folder name under `~/.comet`. None is the installed Comet, which keeps `~/.comet` itself.
    pub instance: Option<&'static str>,
}

/// This Comet's setup: the core in its bundle when it runs as `Comet.app`, else in the repo it was built from.
pub fn setup() -> Setup {
    let exe = std::env::current_exe().unwrap_or_default();
    setup_for(&exe, std::env::var_os("COMET_BUN"))
}

/// A bundled Comet carries the core's source, its packages and Bun in `Contents/Resources`, as
/// `scripts/package.sh` lays them out. Run from the repo, Comet takes `bun` from PATH, or `COMET_BUN`.
fn setup_for(exe: &Path, bun: Option<std::ffi::OsString>) -> Setup {
    let contents = exe.parent().filter(|dir| dir.ends_with("Contents/MacOS")).and_then(Path::parent);
    match contents {
        Some(contents) => {
            let resources = contents.join("Resources");
            Setup { bun: resources.join("bun"), dir: resources.join("core"), instance: None }
        }
        None => Setup { bun: bun.map_or_else(|| "bun".into(), PathBuf::from), dir: repo(), instance: Some(DEV_INSTANCE) },
    }
}

/// What the core tells the app, in order: one `Ready` or `Failed`, then messages until it stops.
/// Each event moves once, from the socket thread to the app, so its size costs nothing worth boxing.
#[expect(clippy::large_enum_variant)]
#[derive(Debug)]
pub enum Event {
    Ready,
    Message(CoreMessage),
    Failed(String),
}

/// The app's one link to the core. Messages sent before the socket opens wait, as in `core.ts`.
/// Dropping it leaves the process running, so call `stop`.
#[derive(Clone)]
pub struct Core {
    process: Arc<Mutex<Option<(Child, ChildStdin)>>>,
    outgoing: Sender<String>,
    /// The other end of `outgoing`, until the socket thread takes it.
    queued: Arc<Mutex<Option<Receiver<String>>>>,
    /// Comet's folder for the core, in place of `~/.comet`, so a test never touches the user's.
    #[cfg(test)]
    home: Option<PathBuf>,
}

impl Default for Core {
    fn default() -> Self {
        let (outgoing, queued) = mpsc::channel();
        Core {
            process: Arc::default(),
            outgoing,
            queued: Arc::new(Mutex::new(Some(queued))),
            #[cfg(test)]
            home: None,
        }
    }
}

impl Core {
    pub fn send(&self, message: &ClientMessage) {
        let data = serde_json::to_string(message).expect("a client message encodes");
        // The socket thread is gone only once the core stopped, and then nothing can be sent.
        let _ = self.outgoing.send(data);
    }

    /// What the app sent and the core has not taken, as JSON. Only for a core that never started.
    #[cfg(test)]
    pub fn sent(&self) -> Vec<serde_json::Value> {
        let queued = self.queued.lock().unwrap();
        queued.as_ref().expect("the core never started").try_iter().map(|data| serde_json::from_str(&data).unwrap()).collect()
    }

    /// Starts the core on a thread and reports each event through `on_event`, from that thread.
    pub fn start(&self, on_event: impl Fn(Event) + Send + 'static) {
        let process = self.process.clone();
        let Some(queued) = self.queued.lock().unwrap().take() else { return };
        let setup = setup();
        let mut command = Command::new(&setup.bun);
        command.arg("core/src/main.ts").current_dir(&setup.dir);
        if let Some(instance) = setup.instance {
            command.env("COMET_INSTANCE", instance);
        }
        // Only tests point the core at a Comet folder of their own.
        #[cfg(test)]
        if let Some(home) = &self.home {
            command.env("COMET_HOME", home);
        }
        std::thread::Builder::new()
            .name("comet-core".into())
            .spawn(move || {
                if let Err(reason) = run(command, &process, &queued, &on_event) {
                    on_event(Event::Failed(reason));
                }
            })
            .expect("the core thread starts");
    }

    /// Closing stdin tells the core to exit. The kill is a fallback for a core that hangs.
    pub fn stop(&self) {
        let Some((child, stdin)) = self.process.lock().unwrap().take() else { return };
        end(child, stdin, STOP_GRACE);
    }

    /// Stops this core when the app quits. Rune ends the process fast at a quit, so nothing after
    /// `App::run` runs. Its `fast_exit` hook runs once, after the window has hidden and every quit
    /// hook has run, which suits a stop that may wait up to `STOP_GRACE`. The hook is a plain `fn`,
    /// so it finds the core in `QUITTING`.
    pub fn stop_at_quit(&self) {
        if QUITTING.set(self.clone()).is_ok() {
            rune::fast_exit(stop_quitting);
        }
    }
}

/// The core `stop_at_quit` registered, for Rune's `fast_exit` hook.
static QUITTING: std::sync::OnceLock<Core> = std::sync::OnceLock::new();

fn stop_quitting() {
    if let Some(core) = QUITTING.get() {
        core.stop();
    }
}

/// Closes a process's stdin and waits until it exits, for at most `grace`, then kills it. A thread waits
/// on the process, so this returns the moment it exits rather than at the next check of a timer.
fn end(mut child: Child, stdin: ChildStdin, grace: Duration) {
    drop(stdin);
    let pid = child.id() as libc::pid_t;
    let (exited, exit) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = exited.send(());
    });
    if exit.recv_timeout(grace).is_ok() {
        return;
    }
    // SAFETY: kill takes no pointers. The waiting thread has not reaped the process, so its pid is still its own.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    let _ = exit.recv();
}

/// The repo this Comet was built from, which a Comet run from the repo starts the core in.
fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn run(mut command: Command, process: &Mutex<Option<(Child, ChildStdin)>>, queued: &Receiver<String>, on_event: &dyn Fn(Event)) -> Result<(), String> {
    let token = ids::hex::<24>();
    let bun = command.get_program().to_string_lossy().into_owned();
    let mut child = command
        .env("COMET_TOKEN", &token)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Could not start the core with {bun}: {e}"))?;
    let stdin = child.stdin.take().expect("stdin is piped");
    let stdout = child.stdout.take().expect("stdout is piped");
    *process.lock().unwrap() = Some((child, stdin));

    let port = ready_port(stdout)?;
    let mut socket = connect(port, &token).map_err(|e| format!("Could not connect to the core: {e}"))?;
    on_event(Event::Ready);
    loop {
        match socket.read() {
            Ok(Message::Text(text)) => match serde_json::from_str(&text) {
                Ok(message) => on_event(Event::Message(message)),
                Err(e) => eprintln!("comet: a core message did not decode: {e}"),
            },
            Ok(_) => {}
            // No message came in time, so send what the app queued.
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                for data in queued.try_iter() {
                    socket.send(Message::text(data)).map_err(|_| "The core stopped.".to_string())?;
                }
            }
            Err(_) => return Err("The core stopped.".into()),
        }
    }
}

/// Opens the WebSocket. Reads time out after the handshake, so one thread both reads and sends.
fn connect(port: u16, token: &str) -> Result<WebSocket<TcpStream>, String> {
    let stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    let (socket, _) = tungstenite::client(format!("ws://127.0.0.1:{port}/?token={token}"), stream).map_err(|e| e.to_string())?;
    socket.get_ref().set_read_timeout(Some(SEND_WAIT)).map_err(|e| e.to_string())?;
    Ok(socket)
}

/// Waits for the line the core prints once it listens. Nothing else may print before it.
fn ready_port(stdout: impl Read + Send + 'static) -> Result<u16, String> {
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let read = BufReader::new(stdout).read_line(&mut line);
        let _ = send.send(read.map(|_| line));
    });
    let line = match receive.recv_timeout(START_TIMEOUT) {
        Ok(Ok(line)) if !line.is_empty() => line,
        Ok(_) => return Err("The core exited before it started.".into()),
        Err(_) => return Err("The core did not start in time.".into()),
    };
    let ready: CoreReady = serde_json::from_str(&line).map_err(|e| format!("The core's first line is not where it listens: {e}"))?;
    Ok(ready.port)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ClientMessage, CoreMessage};
    use std::time::Instant;

    /// A process to end, with its stdin piped.
    fn spawn_piped(program: &str, args: &[&str]) -> (Child, ChildStdin) {
        let mut child = Command::new(program).args(args).stdin(Stdio::piped()).stdout(Stdio::null()).spawn().unwrap();
        let stdin = child.stdin.take().unwrap();
        (child, stdin)
    }

    #[test]
    fn ending_a_process_returns_once_it_exits_and_kills_one_that_outlasts_its_grace() {
        let (child, stdin) = spawn_piped("cat", &[]);
        let started = Instant::now();
        end(child, stdin, Duration::from_secs(5));
        assert!(started.elapsed() < Duration::from_millis(500), "cat exits when its stdin closes: {:?}", started.elapsed());

        let (child, stdin) = spawn_piped("sleep", &["30"]);
        let pid = child.id() as libc::pid_t;
        let started = Instant::now();
        end(child, stdin, Duration::from_millis(100));
        let took = started.elapsed();
        assert!(took >= Duration::from_millis(100) && took < Duration::from_secs(5), "sleep ignores its stdin, so it is killed: {took:?}");
        // SAFETY: kill takes no pointers. Signal 0 only asks whether the pid is in use.
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "the killed process is gone");
    }

    #[test]
    fn a_bundled_comet_runs_the_core_in_its_resources_and_one_from_the_repo_runs_its_own() {
        let bundled = setup_for(Path::new("/Applications/Comet.app/Contents/MacOS/Comet"), Some("/opt/bun".into()));
        let resources = Path::new("/Applications/Comet.app/Contents/Resources");
        assert_eq!(bundled, Setup { bun: resources.join("bun"), dir: resources.join("core"), instance: None }, "a bundle ignores COMET_BUN and serves ~/.comet");
        let dev = setup_for(Path::new("/code/comet/native/target/debug/comet"), None);
        assert_eq!(dev, Setup { bun: "bun".into(), dir: repo(), instance: Some(DEV_INSTANCE) });
        assert_eq!(setup_for(Path::new("/code/comet/native/target/debug/comet"), Some("/opt/bun".into())).bun, Path::new("/opt/bun"));
    }

    /// A Comet folder of the test's own, with a saved window of two tabs in the native instance.
    fn seeded_home(test: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("comet-native-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let project = home.join("project");
        std::fs::create_dir_all(home.join(DEV_INSTANCE)).unwrap();
        std::fs::create_dir_all(&project).unwrap();
        let tab = |id: &str, title: &str| serde_json::json!({ "id": id, "title": title, "project": project, "terminals": [], "agent": "claude", "model": "default", "permissionMode": "auto" });
        let window = serde_json::json!({ "tabs": [tab("a", "First"), tab("b", "Second")], "active": "b", "threads": {}, "recent": [], "keyed": {}, "layouts": {}, "closed": [] });
        std::fs::write(home.join(DEV_INSTANCE).join("window.json"), window.to_string()).unwrap();
        home
    }

    /// Runs one short turn with the Claude Code on this Mac, on the user's account. Run it by hand:
    /// `cargo test real_turn -- --ignored`.
    #[test]
    #[ignore]
    fn a_real_turn_streams_its_answer_and_ends() {
        let home = seeded_home("real-turn");
        let core = Core { home: Some(home.clone()), ..Core::default() };
        let (send, receive) = mpsc::channel();
        core.start(move |event| {
            let _ = send.send(event);
        });
        core.send(&ClientMessage::SessionSend { tab_id: "a".into(), text: "Reply with the single word: pong".into(), images: vec![], follow_up: None });
        let deadline = Instant::now() + Duration::from_secs(120);
        let (mut busy_seen, mut text, mut rows) = (false, String::new(), 0);
        loop {
            match receive.recv_timeout(deadline.saturating_duration_since(Instant::now())).expect("the turn ends in time") {
                Event::Failed(reason) => panic!("{reason}"),
                Event::Message(CoreMessage::SessionRows { tab_id, .. }) if tab_id == "a" => rows += 1,
                Event::Message(CoreMessage::SessionEvent { tab_id, event }) if tab_id == "a" => match event {
                    crate::protocol::ThreadEvent::Status { busy: true } => busy_seen = true,
                    crate::protocol::ThreadEvent::Status { busy: false } if busy_seen => break,
                    crate::protocol::ThreadEvent::Item { item: crate::protocol::ThreadItem::Text { text: t, .. } } => text = t,
                    crate::protocol::ThreadEvent::TextDelta { delta, .. } => text.push_str(&delta),
                    _ => {}
                },
                _ => {}
            }
        }
        core.stop();
        let _ = std::fs::remove_dir_all(&home);
        assert!(text.to_lowercase().contains("pong"), "the answer: {text:?}");
        assert!(rows > 0, "rows follow the turn");
    }

    #[test]
    fn a_terminal_runs_a_shell_in_the_core_and_its_output_fills_the_screen() {
        let home = seeded_home("terminal");
        let core = Core { home: Some(home.clone()), ..Core::default() };
        let (send, receive) = mpsc::channel();
        core.start(move |event| {
            let _ = send.send(event);
        });
        // The core opens only a terminal a saved tab lists, as the app saves a new terminal before opening it.
        let project = home.join("project").to_string_lossy().into_owned();
        let tab: crate::protocol::TabInfo = serde_json::from_value(serde_json::json!({ "id": "a", "title": "First", "project": project, "terminals": [{ "id": "term", "title": "Terminal" }], "agent": "claude", "model": "default", "permissionMode": "auto" })).unwrap();
        core.send(&ClientMessage::TabsSave { tabs: vec![tab], active: Some("a".into()) });
        core.send(&ClientMessage::TerminalOpen { id: "term".into(), cols: 60, rows: 10 });
        core.send(&ClientMessage::TerminalInput { id: "term".into(), data: "echo comet-$((40+2))\r".into() });
        let mut screen = crate::terminal::Screen::new(crate::terminal::Size { cols: 60, rows: 10 });
        let deadline = Instant::now() + Duration::from_secs(20);
        let shown = loop {
            let shown = screen.rows.iter().any(|r| r.text.contains("comet-42"));
            if shown || Instant::now() > deadline {
                break shown;
            }
            if let Ok(Event::Message(CoreMessage::TerminalOutput { id, data })) = receive.recv_timeout(Duration::from_millis(200))
                && id == "term"
            {
                screen.feed(data.as_bytes());
            }
        };
        core.stop();
        let _ = std::fs::remove_dir_all(&home);
        assert!(shown, "the shell's answer shows: {:?}", screen.rows.iter().map(|r| r.text.trim_end()).collect::<Vec<_>>());
    }

    /// Runs the example support plugin, which shows made-up conversations and calls no service.
    #[test]
    fn a_plugin_s_setup_lays_out_its_sidebar_and_sends_its_nodes() {
        let home = seeded_home("plugin");
        let plugins = home.join("plugins").join("support");
        std::fs::create_dir_all(&plugins).unwrap();
        std::fs::copy(repo().join("examples/plugins/support/index.tsx"), plugins.join("index.tsx")).unwrap();
        std::fs::write(home.join("plugins.json"), r#"{ "everywhere": ["support"] }"#).unwrap();
        let core = Core { home: Some(home.clone()), ..Core::default() };
        let (send, receive) = mpsc::channel();
        core.start(move |event| {
            let _ = send.send(event);
        });
        core.send(&ClientMessage::SetupOpen { tab_id: "a".into(), setup: "support.support".into() });
        let deadline = Instant::now() + Duration::from_secs(30);
        let (mut sidebar, mut nodes) = (None, 0);
        while (sidebar.is_none() || nodes == 0) && Instant::now() < deadline {
            match receive.recv_timeout(Duration::from_millis(200)) {
                Ok(Event::Message(CoreMessage::Layout { tab_id, layout })) if tab_id == "a" => sidebar = layout.sidebar,
                Ok(Event::Message(CoreMessage::PluginOps { plugin, ops, .. })) if plugin == "support" => nodes += ops.len(),
                Ok(Event::Failed(reason)) => panic!("{reason}"),
                _ => {}
            }
        }
        core.stop();
        let _ = std::fs::remove_dir_all(&home);
        assert_eq!(sidebar.map(|s| s.id).as_deref(), Some("support.inbox"));
        assert!(nodes > 0, "the sidebar's nodes arrive");
    }

    #[test]
    fn a_settings_change_comes_back_from_the_core_as_settings() {
        let home = seeded_home("settings-update");
        let core = Core { home: Some(home.clone()), ..Core::default() };
        let (send, receive) = mpsc::channel();
        core.start(move |event| {
            let _ = send.send(event);
        });
        let project = home.join("project").to_string_lossy().into_owned();
        core.send(&ClientMessage::SettingsUpdate { change: serde_json::json!({ "project": { "dir": project, "settings": { "name": "Web", "color": "blue" } }, "appearance": { "uiFont": "Inter" } }) });
        let deadline = Instant::now() + START_TIMEOUT;
        let settings = loop {
            match receive.recv_timeout(deadline.saturating_duration_since(Instant::now())).expect("the core sends the new settings in time") {
                Event::Failed(reason) => panic!("{reason}"),
                Event::Message(CoreMessage::Settings { settings }) if settings.projects.contains_key(&project) => break settings,
                Event::Message(CoreMessage::Error { message, detail }) => panic!("{message}: {detail:?}"),
                _ => {}
            }
        };
        core.stop();
        let _ = std::fs::remove_dir_all(&home);
        assert_eq!(settings.projects[&project].name.as_deref(), Some("Web"));
        assert_eq!(settings.projects[&project].color.as_deref(), Some("blue"));
        assert_eq!(settings.appearance.ui_font, "Inter");
    }

    #[test]
    fn a_real_core_sends_the_saved_tabs() {
        let home = seeded_home("saved-tabs");
        let core = Core { home: Some(home.clone()), ..Core::default() };
        let (send, receive) = mpsc::channel();
        core.start(move |event| {
            let _ = send.send(event);
        });
        let deadline = Instant::now() + START_TIMEOUT;
        let mut ready = false;
        let tabs = loop {
            match receive.recv_timeout(deadline.saturating_duration_since(Instant::now())).expect("the core sends its tabs in time") {
                Event::Ready => ready = true,
                Event::Failed(reason) => panic!("{reason}"),
                Event::Message(CoreMessage::Tabs { tabs, active }) => break (tabs, active),
                Event::Message(_) => {}
            }
        };
        assert!(ready, "Ready comes before any message");
        assert_eq!(tabs.0.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["First", "Second"]);
        assert_eq!(tabs.1.as_deref(), Some("b"));

        // The app's saved order reaches the core's file.
        let mut reversed = tabs.0;
        reversed.reverse();
        core.send(&ClientMessage::TabsSave { tabs: reversed, active: Some("a".into()) });
        let file = home.join(DEV_INSTANCE).join("window.json");
        let saved = |deadline: Instant| loop {
            let window: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
            if window["active"] == "a" || Instant::now() > deadline {
                break window;
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        let window = saved(Instant::now() + Duration::from_secs(2));
        core.stop();
        let _ = std::fs::remove_dir_all(&home);
        assert_eq!(window["active"], "a");
        assert_eq!(window["tabs"][0]["id"], "b");
    }
}
