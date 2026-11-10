//! A terminal in the view pane: its rows on a fixed grid of cells, the cursor, keys and scrolling. The
//! screen comes from `terminal.rs`, and the shell runs in the core.

use crate::protocol::ClientMessage;
use crate::shell::Desk;
use crate::terminal::{FOREGROUND, Row, Screen, Size, key_bytes, paste_bytes};
use alacritty_terminal::term::TermMode;
use alacritty_terminal::vte::ansi::Rgb;
use rune::{Color, El, Key, KeyEvent, Span, TextStyle, Tx, col, el, memo, text};
use rune_kit::Kit;
use std::collections::{HashMap, HashSet};

/// Desk's terminal font size, as the Electron app sets it.
const FONT_SIZE: f32 = 12.0;
/// The room around the grid, Desk's `px-3 pb-3`.
const PAD: f32 = 12.0;
/// What a shell shows when it ends.
const EXITED: &[u8] = b"\r\n\x1b[2m[Process exited]\x1b[0m\r\n";
const START: Size = Size { cols: 80, rows: 24 };

/// Every terminal's screen, by id, and the cell size the font gives.
#[derive(Default)]
pub struct Terminals {
    screens: HashMap<String, Screen>,
    /// Terminals the core was asked to open, so each opens once.
    opened: HashSet<String>,
    /// Wheel travel not yet a whole line.
    wheel: f32,
    cell: Option<(f32, f32)>,
}

fn font(k: &Kit) -> TextStyle {
    TextStyle { size: FONT_SIZE, line_height: (FONT_SIZE * 1.25).ceil(), ..k.ty.mono }
}

impl Terminals {
    /// One cell's width and height. A long run gives the true advance, since one glyph rounds to whole points.
    fn cell(&mut self, k: &Kit) -> (f32, f32) {
        *self.cell.get_or_insert_with(|| {
            let f = font(k);
            let (w, _) = rune::text::measure(&"M".repeat(1000), &[], f, None);
            (w / 1000.0, f.line_height)
        })
    }
}

impl Desk {
    /// Opens the active tab's terminals in the core, once each. The core replays what a running one showed.
    pub fn open_terminals(&mut self) {
        let Some(tab) = self.workspace.active_tab() else { return };
        for terminal in &tab.terminals {
            if self.terminals.opened.insert(terminal.id.clone()) {
                self.terminals.screens.entry(terminal.id.clone()).or_insert_with(|| Screen::new(START));
                self.core.send(&ClientMessage::TerminalOpen { id: terminal.id.clone(), cols: START.cols, rows: START.rows });
            }
        }
    }

    pub fn terminal_output(&mut self, id: &str, data: &str) {
        let Some(screen) = self.terminals.screens.get_mut(id) else { return };
        let reply = screen.feed(data.as_bytes());
        if !reply.is_empty() {
            self.core.send(&ClientMessage::TerminalInput { id: id.to_owned(), data: reply });
        }
    }

    pub fn terminal_exit(&mut self, id: &str) {
        if let Some(screen) = self.terminals.screens.get_mut(id) {
            screen.feed(EXITED);
        }
    }

    pub fn new_terminal(&mut self) {
        let Some(tab) = self.workspace.active.clone() else { return };
        self.workspace.new_terminal(&tab, &self.core);
        self.open_terminals();
    }

    fn type_into(&mut self, id: &str, data: String) {
        if let Some(screen) = self.terminals.screens.get_mut(id) {
            // Typing shows the bottom of the screen again.
            screen.scroll(i32::MIN / 2);
        }
        self.core.send(&ClientMessage::TerminalInput { id: id.to_owned(), data });
    }

    fn resize_terminal(&mut self, id: &str, width: f32, height: f32, k: &Kit) {
        let (cw, ch) = self.terminals.cell(k);
        let size = Size { cols: (((width - 2.0 * PAD) / cw).floor() as usize).max(2), rows: (((height - PAD) / ch).floor() as usize).max(1) };
        let Some(screen) = self.terminals.screens.get_mut(id) else { return };
        if screen.size != size {
            screen.resize(size);
            self.core.send(&ClientMessage::TerminalResize { id: id.to_owned(), cols: size.cols, rows: size.rows });
        }
    }

    fn terminal_key(&mut self, id: &str, event: &KeyEvent, tx: &mut Tx) -> bool {
        let mods = event.mods;
        if mods.cmd && !mods.ctrl {
            return match &event.key {
                // ⌘V pastes, bracketed when the program asks for it.
                Key::Command('v') => {
                    let id = id.to_owned();
                    tx.read_clipboard(move |s: &mut Desk, content, _| {
                        let bracketed = s.terminals.screens.get(&id).is_some_and(|t| t.mode().contains(TermMode::BRACKETED_PASTE));
                        s.type_into(&id, paste_bytes(content.text(), bracketed));
                    });
                    true
                }
                // ⌘⌫ deletes the line, as in Terminal.app: Ctrl+U to the shell.
                Key::Backspace => {
                    self.type_into(id, "\x15".into());
                    true
                }
                _ => false,
            };
        }
        let app_cursor = self.terminals.screens.get(id).is_some_and(|t| t.mode().contains(TermMode::APP_CURSOR));
        match key_bytes(&event.key, mods.ctrl, mods.alt, app_cursor) {
            Some(bytes) => {
                self.type_into(id, bytes);
                true
            }
            None => false,
        }
    }
}

fn rgb(c: Rgb) -> Color {
    rune::color::hex(&format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b)).unwrap_or(Color::WHITE)
}

/// A terminal's screen, filling the pane, sized to whole cells.
pub fn terminal(s: &Desk, id: &str, k: &Kit) -> El {
    let Some(screen) = s.terminals.screens.get(id) else { return el().grow(1.0) };
    let f = font(k);
    let (cw, ch) = s.terminals.cell.unwrap_or((7.2, f.line_height));
    let ink = k.c.text_base;
    let rows = screen.rows.iter().enumerate().map(|(y, row)| {
        let version = (screen.versions[y], k.dark);
        memo(format!("term-{id}-{y}"), version, || row_view(row, f, (cw, ch), ink))
    });
    let grid = col().absolute(PAD, 0.0).w(screen.size.cols as f32 * cw).children(rows);
    let cursor = screen.cursor.map(|(x, y)| el().absolute(PAD + x as f32 * cw, y as f32 * ch).size(1.5, ch).fill(ink));
    let (resize_id, key_id, wheel_id) = (id.to_owned(), id.to_owned(), id.to_owned());
    let dark = k.dark;
    el()
        .key(format!("terminal-{id}"))
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .clip_rounded(0.0)
        .focusable(true)
        .role("textbox")
        .label("Terminal")
        .on_layout(move |s: &mut Desk, r| s.resize_terminal(&resize_id, r[2], r[3], crate::theme::kit(dark)))
        .on_key(move |s: &mut Desk, event: &KeyEvent, tx| s.terminal_key(&key_id, event, tx))
        .on_wheel(move |s: &mut Desk, e, _| {
            let (_, ch) = s.terminals.cell.unwrap_or((7.2, 15.0));
            s.terminals.wheel += e.dy;
            let lines = (s.terminals.wheel / ch).trunc();
            if lines != 0.0 {
                s.terminals.wheel -= lines * ch;
                if let Some(screen) = s.terminals.screens.get_mut(&wheel_id) {
                    screen.scroll(lines as i32);
                }
            }
            true
        })
        .child(grid)
        .children(cursor)
}

/// One row: background runs under the text, the text with its colours, and wide characters in their cells.
fn row_view(row: &Row, font: TextStyle, (cw, ch): (f32, f32), ink: Color) -> El {
    let mut e = el().h(ch).w_full();
    for run in &row.runs {
        if let Some(bg) = run.bg {
            e = e.child(el().absolute(run.col as f32 * cw, 0.0).size(run.cols as f32 * cw, ch).fill(rgb(bg)));
        }
    }
    let spans: Vec<Span> = row
        .runs
        .iter()
        .filter(|r| r.fg != FOREGROUND || r.bold || r.italic || r.underline)
        .map(|r| {
            let c = rgb(r.fg);
            let mut span = Span::new(r.start, r.end).color(c);
            if r.bold {
                span = span.weight(700.0);
            }
            if r.italic {
                span = span.italic();
            }
            if r.underline {
                span = span.underline(c);
            }
            span
        })
        .collect();
    if !row.text.trim_end().is_empty() {
        let mut t = text(row.text.clone()).font(font).color(ink).absolute(0.0, 0.0);
        if !spans.is_empty() {
            t = t.spans(spans);
        }
        e = e.child(t);
    }
    for (col, glyph, fg) in &row.wide {
        e = e.child(el().absolute(*col as f32 * cw, 0.0).size(2.0 * cw, ch).center().child(text(glyph.clone()).font(font).color(rgb(*fg))));
    }
    e
}
