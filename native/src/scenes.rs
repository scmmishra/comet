//! Sample states for Rune's headless tooling, such as `cargo run -- --snap thread.png --scene thread`.
//! They draw the app without a core, so its look can be checked without a window.

use crate::core::Event;
use crate::protocol::CoreMessage;
use crate::shell::{CoreState, Desk};

/// A scene: its name, and what it sets in a fresh window.
type Scene = (&'static str, fn(&mut Desk));

pub const SCENES: &[Scene] = &[("thread", thread), ("models", models), ("start", start)];

/// A new tab in a project with past threads.
fn start(s: &mut Desk) {
    s.status = CoreState::Ready;
    let now = crate::format::now_ms();
    let messages = serde_json::json!([
        { "type": "recent", "projects": ["/Users/me/code/web", "/Users/me/code/api"] },
        { "type": "tabs", "active": "tab", "tabs": [{ "id": "tab", "title": "New session", "project": "/Users/me/code/web", "terminals": [], "model": "default", "permissionMode": "auto" }] },
        { "type": "project", "project": "/Users/me/code/web", "part": "space", "value": { "name": "web", "root": "/Users/me/code/web", "branch": "main", "changes": {} } },
        { "type": "project", "project": "/Users/me/code/web", "part": "threads", "value": [
            { "id": "s1", "title": "Fix the login form", "updatedAt": now - 5.0 * 60_000.0 },
            { "id": "s2", "title": "Add a dark theme to the settings page", "branch": "theme", "updatedAt": now - 3.0 * 3_600_000.0 },
            { "id": "s3", "title": "Speed up the build", "updatedAt": now - 2.0 * 86_400_000.0 }
        ] }
    ]);
    for message in serde_json::from_value::<Vec<CoreMessage>>(messages).expect("the scene's messages decode") {
        s.receive(Event::Message(message)).expect("the scene has a tab");
    }
}

/// The thread with the model picker open.
fn models(s: &mut Desk) {
    thread(s);
    let models = serde_json::json!({ "type": "models", "models": [
        { "value": "default", "label": "Default", "description": "The recommended model", "resolvedModel": "claude-opus-5-5", "efforts": ["low", "medium", "high", "xhigh", "max"], "defaultEffort": "high", "fast": true, "autoMode": true },
        { "value": "sonnet", "label": "Sonnet", "description": "Fast and capable for everyday tasks", "resolvedModel": "claude-sonnet-5-5", "efforts": ["low", "medium", "high"], "fast": false, "autoMode": true },
        { "value": "haiku", "label": "Haiku", "description": "Fastest for quick answers", "efforts": [], "fast": false, "autoMode": false },
        { "value": "claude-opus-4-8", "label": "Opus 4.8", "description": "Older model", "efforts": ["high"], "fast": false, "autoMode": true }
    ] });
    s.receive(Event::Message(serde_json::from_value(models).expect("the models decode"))).expect("models need no folder");
    s.toggle_picker();
}

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
            { "type": "user", "id": "u2", "text": "Now add a test for it. Yes, in phases. The Electron app stays the shipped Desk until the last phase. Each phase should end with something that runs, so we can stop between them.", "at": at(25.0), "steered": true },
            { "type": "tool", "id": "t4", "name": "Bash", "summary": "npm test -- login", "kind": "command", "label": "Running npm" },
            { "type": "permission", "id": "p1", "requestId": "r1", "tool": "Bash", "kind": "command", "detail": "rm -rf dist && npm run build", "reason": "It deletes the build folder", "allowSession": true }
        ] },
        { "type": "session.event", "tabId": "tab", "event": { "kind": "status", "busy": true } },
        { "type": "session.event", "tabId": "tab", "event": { "kind": "item", "item": { "type": "question", "id": "q1", "requestId": "rq", "questions": [
            { "header": "Tests", "question": "Which kind of test should I add?", "options": [{ "label": "Unit test", "description": "Fast, mocks the network" }, { "label": "End-to-end test" }], "multiSelect": false }
        ] } } },
        { "type": "queue", "tabId": "tab", "messages": [{ "id": "m1", "text": "Then update the changelog" }], "held": false },
        { "type": "session.rows", "tabId": "tab", "rows": [
            { "type": "item", "id": "u1" },
            { "type": "fold", "id": "fold:u1", "rows": [{ "type": "group", "id": "group:th1", "steps": ["th1", "t1", "t2", "t3"], "live": false, "summary": "Read a file, ran a command, and changed a file" }], "durationMs": 63_000.0, "stopped": false },
            { "type": "item", "id": "x1" },
            { "type": "item", "id": "ch1" },
            { "type": "item", "id": "c1" },
            { "type": "item", "id": "u2" },
            { "type": "working", "id": "working:u2", "since": at(25.0) },
            { "type": "group", "id": "group:t4", "steps": ["t4"], "live": true, "summary": "Ran a command" },
            { "type": "item", "id": "p1" }
        ] }
    ]);
    for message in serde_json::from_value::<Vec<CoreMessage>>(messages).expect("the scene's messages decode") {
        s.receive(Event::Message(message)).expect("the scene has a tab");
    }
    s.threads.toggle("tab", "fold:u1");
    s.threads.toggle("tab", "group:th1");
    s.threads.toggle("tab", "t3");
}
