//! The Bun core: starting it, reading its messages and stopping it. The core serves every project,
//! as it does for the Electron app (`app/src/main/core-process.ts` and `app/src/renderer/core.ts`).

use crate::ids;
use crate::protocol::{ClientMessage, CoreMessage, CoreReady};
use std::io::{BufRead, BufReader, ErrorKind, Read};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tungstenite::{Message, WebSocket};

const START_TIMEOUT: Duration = Duration::from_secs(10);
const STOP_GRACE: Duration = Duration::from_secs(1);
/// How long the socket thread waits for a core message before it sends what the app queued. A
/// message the app sends waits at most this long.
const SEND_WAIT: Duration = Duration::from_millis(4);
/// The core keeps the native app's window and plugin builds in `~/.desk/native`, apart from the
/// Electron Desk's, while both exist.
pub const INSTANCE: &str = "native";

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
    /// Desk's folder for the core, in place of `~/.desk`, so a test never touches the user's.
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
        // Only tests change the command, to point the core at their own Desk folder.
        #[cfg_attr(not(test), expect(unused_mut))]
        let mut command = Command::new(std::env::var("DESK_BUN").unwrap_or_else(|_| "bun".into()));
        #[cfg(test)]
        if let Some(home) = &self.home {
            command.env("DESK_HOME", home);
        }
        std::thread::Builder::new()
            .name("desk-core".into())
            .spawn(move || {
                if let Err(reason) = run(command, &process, &queued, &on_event) {
                    on_event(Event::Failed(reason));
                }
            })
            .expect("the core thread starts");
    }

    /// Closing stdin tells the core to exit. The kill is a fallback for a core that hangs.
    pub fn stop(&self) {
        let Some((mut child, stdin)) = self.process.lock().unwrap().take() else { return };
        drop(stdin);
        let deadline = Instant::now() + STOP_GRACE;
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// The repo the core runs from. A packaged Desk will carry the core in its bundle instead.
fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn run(mut command: Command, process: &Mutex<Option<(Child, ChildStdin)>>, queued: &Receiver<String>, on_event: &dyn Fn(Event)) -> Result<(), String> {
    let token = ids::hex::<24>();
    let bun = command.get_program().to_string_lossy().into_owned();
    let mut child = command
        .arg("core/src/main.ts")
        .current_dir(repo())
        .env("DESK_TOKEN", &token)
        .env("DESK_INSTANCE", INSTANCE)
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
                Err(e) => eprintln!("desk: a core message did not decode: {e}"),
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

    /// A Desk folder of the test's own, with a saved window of two tabs in the native instance.
    fn seeded_home(test: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("desk-native-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let project = home.join("project");
        std::fs::create_dir_all(home.join(INSTANCE)).unwrap();
        std::fs::create_dir_all(&project).unwrap();
        let tab = |id: &str, title: &str| serde_json::json!({ "id": id, "title": title, "project": project, "terminals": [], "model": "default", "permissionMode": "auto" });
        let window = serde_json::json!({ "tabs": [tab("a", "First"), tab("b", "Second")], "active": "b", "threads": {}, "recent": [], "keyed": {}, "layouts": {}, "closed": [] });
        std::fs::write(home.join(INSTANCE).join("window.json"), window.to_string()).unwrap();
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
        let tab: crate::protocol::TabInfo = serde_json::from_value(serde_json::json!({ "id": "a", "title": "First", "project": project, "terminals": [{ "id": "term", "title": "Terminal" }], "model": "default", "permissionMode": "auto" })).unwrap();
        core.send(&ClientMessage::TabsSave { tabs: vec![tab], active: Some("a".into()) });
        core.send(&ClientMessage::TerminalOpen { id: "term".into(), cols: 60, rows: 10 });
        core.send(&ClientMessage::TerminalInput { id: "term".into(), data: "echo desk-$((40+2))\r".into() });
        let mut screen = crate::terminal::Screen::new(crate::terminal::Size { cols: 60, rows: 10 });
        let deadline = Instant::now() + Duration::from_secs(20);
        let shown = loop {
            let shown = screen.rows.iter().any(|r| r.text.contains("desk-42"));
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
        let file = home.join(INSTANCE).join("window.json");
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
