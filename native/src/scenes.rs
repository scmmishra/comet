//! Sample states for Rune's headless tooling, such as `cargo run -- --snap thread.png --scene thread`.
//! They draw the app without a core, so its look can be checked without a window.

use crate::core::Event;
use crate::protocol::CoreMessage;
use crate::shell::{CoreState, Desk};

/// A scene: its name, and what it sets in a fresh window.
type Scene = (&'static str, fn(&mut Desk));

pub const SCENES: &[Scene] = &[("thread", thread)];

/// A tab with a finished turn, a steered message, and a running turn with a live group.
fn thread(s: &mut Desk) {
    s.status = CoreState::Ready;
    // Times count back from now, as the working head reads the clock.
    let now = crate::format::now_ms();
    let at = |ago_s: f64| now - ago_s * 1000.0;
    s.now_ms = now;
    let messages = serde_json::json!([
        { "type": "tabs", "active": "tab", "tabs": [{ "id": "tab", "title": "Fix the login form", "project": "/Users/me/code/web", "terminals": [], "model": "default", "permissionMode": "auto" }] },
        { "type": "session.history", "tabId": "tab", "items": [
            { "type": "user", "id": "u1", "text": "The login form loses its error message after a retry. Can you fix it?", "at": at(125.0) },
            { "type": "thinking", "id": "th1", "text": "**Reading the form**", "kind": "thought", "label": "Reading the form" },
            { "type": "tool", "id": "t1", "name": "Read", "summary": "src/login.ts", "result": { "output": "…", "isError": false }, "kind": "read", "label": "Read src/login.ts" },
            { "type": "tool", "id": "t2", "name": "Bash", "summary": "npm test", "result": { "output": "1 failed", "isError": true }, "kind": "command", "label": "Failed npm" },
            { "type": "tool", "id": "t3", "name": "Edit", "summary": "src/login.ts", "file": "src/login.ts", "edits": [{ "before": "setError(null)\nretry()", "after": "retry()" }], "kind": "edit", "label": "Edited src/login.ts" },
            { "type": "text", "id": "x1", "text": "The retry cleared the error before it ran. I moved the reset **after** the retry, so a failed retry keeps its message.\n\n```ts\nretry()\n```", "done": true, "at": at(65.0) },
            { "type": "result", "id": "r1", "durationMs": 63_000.0, "isError": false },
            { "type": "changes", "id": "ch1", "files": [{ "path": "src/login.ts", "status": "modified", "additions": 3, "deletions": 1 }] },
            { "type": "compaction", "id": "c1", "status": "done", "preTokens": 180_000.0, "postTokens": 32_000.0 },
            { "type": "user", "id": "u2", "text": "Now add a test for it", "at": at(25.0), "steered": true },
            { "type": "tool", "id": "t4", "name": "Bash", "summary": "npm test -- login", "kind": "command", "label": "Running npm" }
        ] },
        { "type": "session.rows", "tabId": "tab", "rows": [
            { "type": "item", "id": "u1" },
            { "type": "fold", "id": "fold:u1", "rows": [{ "type": "group", "id": "group:th1", "steps": ["th1", "t1", "t2", "t3"], "live": false, "summary": "Read a file, ran a command, and changed a file" }], "durationMs": 63_000.0, "stopped": false },
            { "type": "item", "id": "x1" },
            { "type": "item", "id": "ch1" },
            { "type": "item", "id": "c1" },
            { "type": "item", "id": "u2" },
            { "type": "working", "id": "working:u2", "since": at(25.0) },
            { "type": "group", "id": "group:t4", "steps": ["t4"], "live": true, "summary": "Ran a command" }
        ] }
    ]);
    for message in serde_json::from_value::<Vec<CoreMessage>>(messages).expect("the scene's messages decode") {
        s.receive(Event::Message(message)).expect("the scene has a tab");
    }
    s.threads.toggle("tab", "fold:u1");
    s.threads.toggle("tab", "group:th1");
    s.threads.toggle("tab", "t3");
}
