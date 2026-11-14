//! A terminal in the view pane: its rows on a fixed grid of cells, the cursor, keys, the input method,
//! scrolling, selecting text to copy, and the mouse for programs that track it. The screen comes from
//! `terminal.rs`, and the shell runs in the core.

use crate::protocol::ClientMessage;
use crate::shell::Desk;
use crate::terminal::{FOREGROUND, Mouse, Row, Screen, Size, Spot, key_bytes, mouse_bytes, paste_bytes};
use alacritty_terminal::term::TermMode;
use alacritty_terminal::vte::ansi::Rgb;
use rune::{Color, Drag, El, Ime, Key, KeyEvent, Mods, Phase, Span, TextStyle, Tx, col, el, memo, text};
use rune_kit::Kit;
use std::collections::{HashMap, HashSet};

/// Desk's terminal font size.
const FONT_SIZE: f32 = 12.0;
/// The room around the grid, Desk's `px-3 pb-3`.
const PAD: f32 = 12.0;
/// What a shell shows when it ends.
const EXITED: &[u8] = b"\r\n\x1b[2m[Process exited]\x1b[0m\r\n";
const START: Size = Size { cols: 80, rows: 24 };
/// The prefix of a terminal's element key, which tells it apart when it has focus.
const KEY_PREFIX: &str = "terminal-";

/// Every terminal's screen, by id, and the cell size the font gives.
#[derive(Default)]
pub struct Terminals {
    screens: HashMap<String, Screen>,
    /// Terminals the core was asked to open, so each opens once.
    opened: HashSet<String>,
    /// Wheel travel not yet a whole line.
    wheel: f32,
    cell: Option<(f32, f32)>,
    /// The cell last reported to a program that tracks the mouse, so a move reports only a new cell.
    reported: Option<(usize, usize)>,
    /// A press went to the program rather than starting a selection.
    pressed: bool,
    /// The terminal with the keyboard, which the input method types into.
    focused: Option<String>,
    /// What the input method has composed and not yet typed, drawn at the caret.
    preedit: String,
}

fn font() -> TextStyle {
    TextStyle { size: FONT_SIZE, line_height: (FONT_SIZE * 1.25).ceil(), ..crate::theme::mono(12.0) }
}

impl Terminals {
    /// One cell's width and height. A long run gives the true advance, since one glyph rounds to whole points.
    fn cell(&mut self) -> (f32, f32) {
        *self.cell.get_or_insert_with(|| {
            let f = font();
            let (w, _) = rune::text::measure(&"M".repeat(1000), &[], f, None);
            (w / 1000.0, f.line_height)
        })
    }

    /// The spot on screen under a point of the terminal's own layout.
    fn spot(&mut self, x: f32, y: f32) -> Spot {
        let (cw, ch) = self.cell();
        let across = ((x - PAD) / cw).max(0.0);
        Spot { col: across as usize, row: (y / ch).max(0.0) as usize, right: across.fract() >= 0.5 }
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

    fn resize_terminal(&mut self, id: &str, width: f32, height: f32) {
        let (cw, ch) = self.terminals.cell();
        let size = Size { cols: (((width - 2.0 * PAD) / cw).floor() as usize).max(2), rows: (((height - PAD) / ch).floor() as usize).max(1) };
        let Some(screen) = self.terminals.screens.get_mut(id) else { return };
        if screen.size != size {
            screen.resize(size);
            self.core.send(&ClientMessage::TerminalResize { id: id.to_owned(), cols: size.cols, rows: size.rows });
        }
    }

    /// A press and drag selects text: by characters, or by words and lines after a double or triple click.
    /// A program that tracks the mouse hears the press instead, unless Shift is held, as in xterm.
    fn terminal_drag(&mut self, id: &str, phase: Phase, x: f32, y: f32, clicks: u32, mods: Mods) {
        let spot = self.terminals.spot(x, y);
        let Some(screen) = self.terminals.screens.get_mut(id) else { return };
        let tracking = screen.mode().intersects(TermMode::MOUSE_MODE) && !mods.shift;
        let event = match phase {
            Phase::Down if tracking => Mouse::Press,
            Phase::Move | Phase::Up if self.terminals.pressed => if phase == Phase::Up { Mouse::Release } else { Mouse::Drag },
            Phase::Down => return screen.select_from(spot, clicks),
            Phase::Move => return screen.select_to(spot),
            Phase::Up => return screen.drop_empty_selection(),
        };
        self.terminals.pressed = event != Mouse::Release;
        self.report_mouse(id, event, spot, mods);
    }

    /// The pointer over the terminal, for a program that tracks every move.
    fn terminal_hover(&mut self, id: &str, x: f32, y: f32) {
        let spot = self.terminals.spot(x, y);
        if !self.terminals.pressed {
            self.report_mouse(id, Mouse::Move, spot, Mods::default());
        }
    }

    /// The wheel scrolls back through the output. A program that tracks the mouse hears it instead, and a
    /// full-screen program such as `less` gets arrow keys, as xterm's alternate scroll sends.
    fn terminal_wheel(&mut self, id: &str, lines: i32, x: f32, y: f32, mods: Mods) {
        let spot = self.terminals.spot(x, y);
        let Some(screen) = self.terminals.screens.get_mut(id) else { return };
        let mode = screen.mode();
        if mode.intersects(TermMode::MOUSE_MODE) {
            let event = if lines > 0 { Mouse::WheelUp } else { Mouse::WheelDown };
            for _ in 0..lines.unsigned_abs() {
                self.terminals.reported = None;
                self.report_mouse(id, event, spot, mods);
            }
        } else if mode.contains(TermMode::ALT_SCREEN | TermMode::ALTERNATE_SCROLL) {
            let key = if lines > 0 { Key::Up } else { Key::Down };
            let bytes = key_bytes(&key, false, false, mode.contains(TermMode::APP_CURSOR)).unwrap_or_default().repeat(lines.unsigned_abs() as usize);
            self.core.send(&ClientMessage::TerminalInput { id: id.to_owned(), data: bytes });
        } else {
            screen.scroll(lines);
        }
    }

    /// Sends a pointer event to the program, when it tracks that kind. A move reports only a new cell.
    fn report_mouse(&mut self, id: &str, event: Mouse, spot: Spot, mods: Mods) {
        let Some(screen) = self.terminals.screens.get(id) else { return };
        let cell = (spot.col.min(screen.size.cols - 1), spot.row.min(screen.size.rows - 1));
        if matches!(event, Mouse::Drag | Mouse::Move) && self.terminals.reported == Some(cell) {
            return;
        }
        if let Some(data) = mouse_bytes(screen.mode(), event, cell.0, cell.1, mods) {
            self.terminals.reported = Some(cell);
            self.core.send(&ClientMessage::TerminalInput { id: id.to_owned(), data });
        }
    }

    /// Notes which terminal has the keyboard. A composition ends when the terminal loses it.
    /// Returns true when that changed.
    fn follow_focus(&mut self, focused: Option<&str>) -> bool {
        let id = focused.and_then(|key| key.strip_prefix(KEY_PREFIX)).filter(|id| self.terminals.screens.contains_key(*id));
        if self.terminals.focused.as_deref() == id {
            return false;
        }
        self.terminals.focused = id.map(str::to_owned);
        self.terminals.preedit.clear();
        true
    }

    /// The input method's text for the focused terminal: a composition to show at the caret, then the
    /// text it settles on, typed into the shell. Plain keys arrive through `terminal_key` instead.
    pub fn terminal_ime(&mut self, event: &Ime) -> bool {
        let Some(id) = self.terminals.focused.clone() else { return false };
        match event {
            // The clauses go unused: the terminal underlines the whole composition as one.
            Ime::Preedit(text, ..) => self.terminals.preedit = text.clone(),
            Ime::Commit(text) => {
                self.terminals.preedit.clear();
                self.type_into(&id, text.clone());
            }
            // Text typed into the shell is gone from the terminal's hands, so there is nothing to
            // convert again. The terminal publishes no text, and ignores a reconversion.
            Ime::Select(_) | Ime::Enabled => {}
            Ime::Disabled => self.terminals.preedit.clear(),
        }
        true
    }

    fn terminal_key(&mut self, id: &str, event: &KeyEvent, tx: &mut Tx) -> bool {
        let mods = event.mods;
        if mods.cmd && !mods.ctrl {
            return match &event.key {
                // ⌘C copies the selection. Without one, the key goes on, as in Terminal.app.
                Key::Command('c') => match self.terminals.screens.get(id).and_then(Screen::selected_text) {
                    Some(text) => {
                        tx.copy(text);
                        true
                    }
                    None => false,
                },
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
    let f = font();
    let (cw, ch) = s.terminals.cell.unwrap_or((7.2, f.line_height));
    let ink = k.c.text_base;
    let tint = crate::theme::accent_soft(k.dark);
    let selection = screen.selection.iter().map(|&(row, from, to)| el().absolute(PAD + from as f32 * cw, row as f32 * ch).size((to + 1 - from) as f32 * cw, ch).fill(tint));
    let rows = screen.rows.iter().enumerate().map(|(y, row)| {
        let version = (screen.versions[y], k.dark);
        memo(format!("term-{id}-{y}"), version, || row_view(row, f, (cw, ch), ink))
    });
    let grid = col().absolute(PAD, 0.0).w(screen.size.cols as f32 * cw).children(rows);
    let cursor = screen.cursor.map(|(x, y)| el().absolute(PAD + x as f32 * cw, y as f32 * ch).size(1.5, ch).fill(ink));
    // While the terminal has the keyboard, the input method works at the caret, and what it composes
    // shows there, underlined, until it is typed.
    let has_keyboard = s.terminals.focused.as_deref() == Some(id);
    let (cx, cy) = screen.caret;
    let caret = has_keyboard.then(|| {
        let at = el().key("caret").absolute(PAD + cx as f32 * cw, cy as f32 * ch).h(ch).ime_cursor();
        let preedit = &s.terminals.preedit;
        if preedit.is_empty() {
            return at.w(1.0);
        }
        at.fill(k.c.bg_base).child(text(preedit.clone()).font(f).color(ink).spans(vec![Span::new(0, preedit.len()).underline(ink)]))
    });
    let (resize_id, key_id, wheel_id, drag_id, hover_id) = (id.to_owned(), id.to_owned(), id.to_owned(), id.to_owned(), id.to_owned());
    el()
        .key(format!("{KEY_PREFIX}{id}"))
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .clip_rounded(0.0)
        .focusable(true)
        .role("textbox")
        .label("Terminal")
        .on_layout(move |s: &mut Desk, r| s.resize_terminal(&resize_id, r[2], r[3]))
        .on_key(move |s: &mut Desk, event: &KeyEvent, tx| s.terminal_key(&key_id, event, tx))
        .on_drag(move |s: &mut Desk, d: &mut Drag, tx| s.terminal_drag(&drag_id, d.phase, d.x, d.y, d.clicks, tx.mods()))
        .on_pointer_move_local(move |s: &mut Desk, p, tx| {
            s.terminal_hover(&hover_id, p.x, p.y);
            // A move only reaches the program. Nothing on screen changes, so the view is not built again.
            tx.live_only();
        })
        .on_wheel(move |s: &mut Desk, e, _| {
            let (_, ch) = s.terminals.cell.unwrap_or((7.2, 15.0));
            s.terminals.wheel += e.dy;
            let lines = (s.terminals.wheel / ch).trunc();
            if lines != 0.0 {
                s.terminals.wheel -= lines * ch;
                s.terminal_wheel(&wheel_id, lines as i32, e.x, e.y, e.mods);
            }
            true
        })
        .child(grid)
        // Over the cells' own backgrounds, faint enough to read the text through.
        .children(selection)
        .children(cursor)
        .children(caret)
}

/// Notes which terminal has the keyboard, from `shell::poll`. True when that changed.
pub fn poll(s: &mut Desk, tx: &Tx) -> bool {
    s.follow_focus(tx.focused())
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A Desk with one 20×5 terminal, "t", on 10×20 cells.
    fn desk(output: &[u8]) -> Desk {
        let mut s = Desk::default();
        s.terminals.cell = Some((10.0, 20.0));
        let mut screen = Screen::new(Size { cols: 20, rows: 5 });
        screen.feed(output);
        s.terminals.screens.insert("t".into(), screen);
        s
    }

    fn sent(s: &Desk) -> Vec<String> {
        s.core.sent().into_iter().filter(|m| m["type"] == "terminal.input").map(|m| m["data"].as_str().unwrap().to_owned()).collect()
    }

    /// The middle of a cell, in the terminal's own points.
    fn at(col: usize, row: usize) -> (f32, f32) {
        (PAD + col as f32 * 10.0 + 2.0, row as f32 * 20.0 + 10.0)
    }

    #[test]
    fn a_program_that_tracks_the_mouse_hears_the_press_and_shift_still_selects() {
        let mut s = desk(b"one two\x1b[?1000h\x1b[?1006h");
        let (x, y) = at(2, 1);
        s.terminal_drag("t", Phase::Down, x, y, 1, Mods::default());
        s.terminal_drag("t", Phase::Up, x, y, 1, Mods::default());
        assert_eq!(sent(&s), ["\x1b[<0;3;2M", "\x1b[<0;3;2m"]);
        let shift = Mods { shift: true, ..Mods::default() };
        let (x0, y0) = at(0, 0);
        let (x1, y1) = at(3, 0);
        s.terminal_drag("t", Phase::Down, x0, y0, 1, shift);
        s.terminal_drag("t", Phase::Move, x1, y1, 1, shift);
        s.terminal_drag("t", Phase::Up, x1, y1, 1, shift);
        assert!(sent(&s).is_empty(), "Shift selects instead of reporting");
        assert_eq!(s.terminals.screens["t"].selected_text().as_deref(), Some("one"));
    }

    #[test]
    fn a_drag_reports_each_new_cell_once() {
        let mut s = desk(b"\x1b[?1002h\x1b[?1006h");
        let points = [at(1, 0), at(1, 0), at(2, 0)];
        s.terminal_drag("t", Phase::Down, points[0].0, points[0].1, 1, Mods::default());
        for (x, y) in &points[1..] {
            s.terminal_drag("t", Phase::Move, *x, *y, 1, Mods::default());
        }
        assert_eq!(sent(&s), ["\x1b[<0;2;1M", "\x1b[<32;3;1M"]);
    }

    #[test]
    fn the_input_method_types_into_the_terminal_with_the_keyboard() {
        let mut s = desk(b"");
        assert!(!s.terminal_ime(&Ime::Commit("é".into())), "with no terminal focused, the input method goes elsewhere");
        assert!(s.follow_focus(Some("terminal-t")));
        assert!(!s.follow_focus(Some("terminal-t")), "the same focus is no change");
        assert!(s.terminal_ime(&Ime::Preedit("ni".into(), None, vec![rune::Clause::new(0..2).target()])));
        assert_eq!(s.terminals.preedit, "ni");
        assert!(s.terminal_ime(&Ime::Select(0..2)), "a reconversion is the terminal's, and changes nothing");
        assert_eq!(s.terminals.preedit, "ni");
        s.terminal_ime(&Ime::Commit("你".into()));
        assert_eq!(s.terminals.preedit, "");
        assert_eq!(sent(&s), ["你"]);
        s.terminal_ime(&Ime::Preedit("ha".into(), None, Vec::new()));
        assert!(s.follow_focus(Some("composer-input")));
        assert_eq!((s.terminals.focused.as_deref(), s.terminals.preedit.as_str()), (None, ""), "leaving the terminal ends the composition");
    }

    #[test]
    fn the_wheel_scrolls_back_or_sends_arrows_to_a_full_screen_program() {
        let mut s = desk(b"");
        let (x, y) = at(0, 0);
        s.terminal_wheel("t", 2, x, y, Mods::default());
        assert!(sent(&s).is_empty(), "the shell's own screen scrolls back");
        s.terminals.screens.get_mut("t").unwrap().feed(b"\x1b[?1049h");
        s.terminal_wheel("t", 2, x, y, Mods::default());
        s.terminal_wheel("t", -1, x, y, Mods::default());
        assert_eq!(sent(&s), ["\x1b[A\x1b[A", "\x1b[B"]);
    }
}
