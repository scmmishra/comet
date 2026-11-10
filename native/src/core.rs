//! The Bun core: starting it, reading its messages and stopping it. The core serves every project,
//! as it does for the Electron app (`app/src/main/core-process.ts` and `app/src/renderer/core.ts`).

use crate::protocol::{CoreMessage, CoreReady};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tungstenite::Message;

const START_TIMEOUT: Duration = Duration::from_secs(10);
const STOP_GRACE: Duration = Duration::from_secs(1);
/// The core keeps the native app's window and plugin builds in `~/.desk/native`, apart from the
/// Electron Desk's, while both exist.
pub const INSTANCE: &str = "native";

/// What the core tells the app, in order: one `Ready` or `Failed`, then messages until it stops.
#[derive(Debug)]
pub enum Event {
    Ready,
    Message(CoreMessage),
    Failed(String),
}

/// The core process, once started. Dropping it leaves the process running, so call `stop`.
#[derive(Clone, Default)]
pub struct Core {
    process: Arc<Mutex<Option<(Child, ChildStdin)>>>,
    /// Desk's folder for the core, in place of `~/.desk`, so a test never touches the user's.
    #[cfg(test)]
    home: Option<PathBuf>,
}

impl Core {
    /// Starts the core on a thread and reports each event through `on_event`, from that thread.
    pub fn start(&self, on_event: impl Fn(Event) + Send + 'static) {
        let process = self.process.clone();
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
                if let Err(reason) = run(command, &process, &on_event) {
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

fn run(mut command: Command, process: &Mutex<Option<(Child, ChildStdin)>>, on_event: &dyn Fn(Event)) -> Result<(), String> {
    let token = token()?;
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
    let (mut socket, _) = tungstenite::connect(format!("ws://127.0.0.1:{port}/?token={token}")).map_err(|e| format!("Could not connect to the core: {e}"))?;
    on_event(Event::Ready);
    loop {
        match socket.read() {
            Ok(Message::Text(text)) => match serde_json::from_str(&text) {
                Ok(message) => on_event(Event::Message(message)),
                Err(e) => eprintln!("desk: a core message did not decode: {e}"),
            },
            Ok(Message::Close(_)) | Err(_) => return Err("The core stopped.".into()),
            Ok(_) => {}
        }
    }
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

/// A secret only this app and its core know, as 48 hex characters.
fn token() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).map_err(|e| format!("Could not make a token: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::CoreMessage;

    /// A Desk folder of its own, with a saved window of two tabs in the native instance.
    fn seeded_home() -> PathBuf {
        let home = std::env::temp_dir().join(format!("desk-native-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let project = home.join("project");
        std::fs::create_dir_all(home.join(INSTANCE)).unwrap();
        std::fs::create_dir_all(&project).unwrap();
        let tab = |id: &str, title: &str| serde_json::json!({ "id": id, "title": title, "project": project, "terminals": [], "model": "default", "permissionMode": "auto" });
        let window = serde_json::json!({ "tabs": [tab("a", "First"), tab("b", "Second")], "active": "b", "threads": {}, "recent": [], "keyed": {}, "layouts": {}, "closed": [] });
        std::fs::write(home.join(INSTANCE).join("window.json"), window.to_string()).unwrap();
        home
    }

    #[test]
    fn a_real_core_sends_the_saved_tabs() {
        let home = seeded_home();
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
        core.stop();
        let _ = std::fs::remove_dir_all(&home);
        assert!(ready, "Ready comes before any message");
        assert_eq!(tabs.0.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["First", "Second"]);
        assert_eq!(tabs.1.as_deref(), Some("b"));
    }
}
