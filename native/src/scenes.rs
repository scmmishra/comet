//! Sample states for Rune's headless tooling, such as `cargo run -- --snap thread.png --scene thread`.
//! They draw the app without a core, so its look can be checked without a window.

use crate::core::Event;
use crate::protocol::CoreMessage;
use crate::shell::{CoreState, Desk};

/// A scene: its name, and what it sets in a fresh window.
type Scene = (&'static str, fn(&mut Desk));

pub const SCENES: &[Scene] = &[("thread", thread), ("models", models), ("start", start), ("review", review), ("terminal", terminal), ("palette", palette), ("plugin", plugin)];

/// A tab laid out by a plugin's setup: a sidebar listing made-up conversations, and a card.
fn plugin(s: &mut Desk) {
    start(s);
    let item = |id: u64, title: &str, subtitle: &str, badge: Option<(&str, &str)>, selected: bool| {
        let mut ops = vec![
            serde_json::json!({ "op": "create", "id": id, "type": "item" }),
            serde_json::json!({ "op": "set", "id": id, "key": "title", "value": title }),
            serde_json::json!({ "op": "set", "id": id, "key": "subtitle", "value": subtitle }),
            serde_json::json!({ "op": "set", "id": id, "key": "selected", "value": selected }),
            serde_json::json!({ "op": "set", "id": id, "key": "onSelect", "value": { "handler": id } }),
            serde_json::json!({ "op": "insert", "parent": 2, "id": id }),
        ];
        if let Some((text, tint)) = badge {
            ops.push(serde_json::json!({ "op": "set", "id": id, "key": "badge", "value": { "text": text, "tint": tint } }));
        }
        ops
    };
    let mut ops = vec![
        serde_json::json!({ "op": "create", "id": 1, "type": "root" }),
        serde_json::json!({ "op": "create", "id": 2, "type": "list" }),
        serde_json::json!({ "op": "insert", "parent": 1, "id": 2 }),
        serde_json::json!({ "op": "create", "id": 20, "type": "root" }),
        serde_json::json!({ "op": "create", "id": 21, "type": "text" }),
        serde_json::json!({ "op": "set", "id": 21, "key": "tone", "value": "muted" }),
        serde_json::json!({ "op": "text", "id": 22, "text": "3 open, 1 urgent" }),
        serde_json::json!({ "op": "insert", "parent": 21, "id": 22 }),
        serde_json::json!({ "op": "insert", "parent": 20, "id": 21 }),
    ];
    ops.extend(item(10, "Priya Raman", "Refund for a double charge", Some(("Urgent", "red")), true));
    ops.extend(item(11, "Tom Becker", "Can't reset my password", Some(("2", "blue")), false));
    ops.extend(item(12, "Ana Souza", "Export to CSV is empty", None, false));
    let messages = serde_json::json!([
        { "type": "plugin.ops", "plugin": "support", "reset": true, "ops": ops },
        { "type": "layout", "tabId": "tab", "layout": { "sidebar": { "id": "support.inbox", "title": "Inbox", "plugin": "support", "root": 1 }, "panels": [], "cards": [{ "id": "support.summary", "title": "Inbox", "plugin": "support", "root": 20 }] } }
    ]);
    for message in serde_json::from_value::<Vec<CoreMessage>>(messages).expect("the scene's messages decode") {
        s.receive(Event::Message(message)).expect("plugin messages need no folder");
    }
}

/// A new tab with the command palette open.
fn palette(s: &mut Desk) {
    start(s);
    s.show_palette(Vec::new());
}

/// The thread with a terminal open in the pane, showing coloured output.
fn terminal(s: &mut Desk) {
    thread(s);
    s.new_terminal();
    let id = s.workspace.active_tab().and_then(|t| t.terminals.first()).map(|t| t.id.clone()).expect("a terminal");
    let output = "\x1b[1;32m➜\x1b[0m  \x1b[36mweb\x1b[0m \x1b[34mgit:(\x1b[31mmain\x1b[34m)\x1b[0m npm test\r\n\r\n \x1b[42;30m PASS \x1b[0m src/login.test.ts\r\n \x1b[41;37m FAIL \x1b[0m src/retry.test.ts\r\n   \x1b[31m● retry keeps the error\x1b[0m\r\n\r\nTests: \x1b[31m1 failed\x1b[0m, \x1b[32m1 passed\x1b[0m, 2 total\r\n\x1b[1;32m➜\x1b[0m  \x1b[36mweb\x1b[0m ";
    s.terminal_output(&id, output);
}

/// The thread with the view pane open on Review.
fn review(s: &mut Desk) {
    thread(s);
    s.receive(Event::Message(serde_json::from_value(serde_json::json!({ "type": "review", "tabId": "tab", "scope": "thread", "files": [
        { "path": "src/login.ts", "status": "modified", "additions": 2, "deletions": 1,
          "patch": "--- a/src/login.ts\n+++ b/src/login.ts\n@@ -1,4 +1,5 @@\n export function retry() {\n-  setError(null)\n   send()\n+  setError(null)\n+  return true\n }\n" }
    ] })).expect("the review decodes"))).expect("a review needs no folder");
    s.toggle_panel();
}

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
        { "type": "session.event", "tabId": "tab", "event": { "kind": "context", "reading": { "percent": 38.0, "tokens": 76_000.0, "maxTokens": 200_000.0 } } },
        { "type": "usage", "usage": { "windows": [{ "id": "five_hour", "label": "Five hours", "percent": 42.0 }, { "id": "seven_day", "label": "Week", "percent": 12.0 }] } },
        { "type": "session.event", "tabId": "tab", "event": { "kind": "item", "item": { "type": "question", "id": "q1", "requestId": "rq", "questions": [
            { "header": "Tests", "question": "Which kind of test should I add?", "options": [{ "label": "Unit test", "description": "Fast, mocks the network" }, { "label": "End-to-end test" }], "multiSelect": false }
        ] } } },
        { "type": "queue", "tabId": "tab", "messages": [{ "id": "m1", "text": "Then update the changelog" }], "held": false },
        { "type": "project", "project": "/Users/me/code/web", "part": "space", "value": { "name": "web", "root": "/Users/me/code/web", "branch": "fix-login", "upstream": { "ahead": 2, "behind": 0 },
            "changes": { "files": 1, "additions": 3, "deletions": 1 },
            "pr": { "number": 42, "title": "Keep the login error after a retry", "url": "https://example.com/pr/42", "state": "OPEN", "draft": false, "checks": { "passed": 3, "failed": 1, "pending": 0 } } } },
        { "type": "project", "project": "/Users/me/code/web", "part": "commands", "value": [
            { "id": "c1", "name": "web", "command": "bun run dev", "group": "Dev", "run": { "state": "running" } },
            { "id": "c2", "name": "worker", "command": "bun run worker", "group": "Dev", "run": { "state": "idle" } },
            { "id": "c3", "name": "Tests", "command": "bun test", "run": { "state": "failed", "code": 1 } }
        ] },
        { "type": "session.event", "tabId": "tab", "event": { "kind": "subagent", "subagent": { "id": "a1", "description": "Find the login tests", "type": "Explore", "status": "running", "background": false, "startedAt": at(12.0), "toolUses": 3, "items": [] } } },
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
