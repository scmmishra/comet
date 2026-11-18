//! A terminal in the view pane: its rows on Rune's grid of cells, the cursor, keys, the input method,
//! scrolling, selecting text to copy, and the mouse for programs that track it. The screen comes from
//! `terminal.rs`, and the shell runs in the core.

use crate::protocol::ClientMessage;
use crate::shell::Comet;
use crate::terminal::{FOREGROUND, Mouse, Row, Screen, Size, Spot, key_bytes, mouse_bytes, paste_bytes};
use alacritty_terminal::term::TermMode;
use alacritty_terminal::vte::ansi::Rgb;
use rune::{Color, Drag, El, GridRow, Ime, Key, KeyEvent, Mods, Phase, Span, TextStyle, Tx, el, text};
use rune_kit::Kit;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

/// Comet's terminal font size.
const FONT_SIZE: f32 = 12.0;
/// The room around the grid, Comet's `px-3 pb-3`.
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
    /// Each terminal's rows as last given to the grid, by id. The view reads `&Comet`, so it keeps them
    /// behind a `RefCell`.
    built: RefCell<HashMap<String, Vec<BuiltRow>>>,
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

impl Comet {
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
                    tx.read_clipboard(move |s: &mut Comet, content, _| {
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

/// A cell's text colour: the theme's foreground draws in Comet's own ink.
fn fg_color(fg: Rgb, ink: Color) -> Color {
    if fg == FOREGROUND { ink } else { rgb(fg) }
}

/// A terminal's screen, filling the pane, sized to whole cells.
pub fn terminal(s: &Comet, id: &str, k: &Kit) -> El {
    let Some(screen) = s.terminals.screens.get(id) else { return el().grow(1.0) };
    let f = font();
    let (cw, ch) = s.terminals.cell.unwrap_or((7.2, f.line_height));
    let ink = k.c.text_base;
    let look = Look { ink, tint: crate::theme::accent_soft(k.dark) };
    let rows = s.terminals.grid_rows(id, screen, look);
    let mut grid = rune::grid(screen.size.cols as u16, cw, ch, rows).absolute(PAD, 0.0).size(screen.size.cols as f32 * cw, screen.size.rows as f32 * ch);
    if let Some((x, y)) = screen.cursor {
        grid = grid.grid_caret(x as u16, y as u16);
    }
    let cursor = screen.cursor.map(|(x, y)| el().absolute(PAD + x as f32 * cw, y as f32 * ch).size(1.5, ch).fill(ink));
    // While the terminal has the keyboard, the input method works at the caret, and what it composes
    // shows there, underlined, until it is typed. On macOS the caret also makes Option the Alt key, so
    // Option+B reaches `key_bytes` as Alt+B (Esc b). Otherwise the input method composes it into "∫" and
    // commits that, with no key for `terminal_key`.
    let has_keyboard = s.terminals.focused.as_deref() == Some(id);
    let (cx, cy) = screen.caret;
    let caret = has_keyboard.then(|| {
        let at = el().key("caret").absolute(PAD + cx as f32 * cw, cy as f32 * ch).h(ch).ime_cursor().ime_option_as_alt(true);
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
        .on_layout(move |s: &mut Comet, r| s.resize_terminal(&resize_id, r[2], r[3]))
        .on_key(move |s: &mut Comet, event: &KeyEvent, tx| s.terminal_key(&key_id, event, tx))
        .on_drag(move |s: &mut Comet, d: &mut Drag, tx| s.terminal_drag(&drag_id, d.phase, d.x, d.y, d.clicks, tx.mods()))
        .on_pointer_move_local(move |s: &mut Comet, p, tx| {
            s.terminal_hover(&hover_id, p.x, p.y);
            // A move only reaches the program. Nothing on screen changes, so the view is not built again.
            tx.live_only();
        })
        .on_wheel(move |s: &mut Comet, e, _| {
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
        .children(cursor)
        .children(caret)
}

/// Notes which terminal has the keyboard, from `shell::poll`. True when that changed.
pub fn poll(s: &mut Comet, tx: &Tx) -> bool {
    s.follow_focus(tx.focused())
}

/// The theme colours a row draws in.
#[derive(Clone, Copy, PartialEq)]
struct Look {
    ink: Color,
    /// The selection, over the cells' own backgrounds, faint enough to read the text through.
    tint: Color,
}

/// A row as last given to the grid, with what it was built from. The grid shapes a row again only when
/// it gets a new `GridRow`, so an unchanged row hands back the same one.
struct BuiltRow {
    version: u64,
    selected: Option<(usize, usize)>,
    look: Look,
    row: Rc<GridRow>,
}

impl Terminals {
    /// Terminal `id`'s rows for the grid, built again only where a row, its selection or the theme changed.
    fn grid_rows(&self, id: &str, screen: &Screen, look: Look) -> Vec<Rc<GridRow>> {
        let mut built = self.built.borrow_mut();
        let built = built.entry(id.to_owned()).or_default();
        built.truncate(screen.rows.len());
        let f = font();
        screen
            .rows
            .iter()
            .enumerate()
            .map(|(y, row)| {
                let (version, selected) = (screen.versions[y], screen.selection.iter().find(|s| s.0 == y).map(|&(_, from, to)| (from, to)));
                match built.get(y) {
                    Some(b) if (b.version, b.selected, b.look) == (version, selected, look) => b.row.clone(),
                    _ => {
                        let fresh = BuiltRow { version, selected, look, row: Rc::new(grid_row(row, selected, f, look)) };
                        let out = fresh.row.clone();
                        if y < built.len() { built[y] = fresh } else { built.push(fresh) }
                        out
                    }
                }
            })
            .collect()
    }
}

/// One row for the grid: its text coloured by its runs, wide characters in their cells, and its
/// background runs with the selection over them.
fn grid_row(row: &Row, selected: Option<(usize, usize)>, font: TextStyle, look: Look) -> GridRow {
    let mut g = GridRow::new(row.text.clone(), spans(row, look.ink), font).wraps(row.wraps);
    for (start, end, color) in fills(row, selected, look.tint) {
        g = g.fill(start, end, color);
    }
    for (col, glyph, fg) in &row.wide {
        g = g.cell(*col as u16, 2, glyph.clone(), font, fg_color(*fg, look.ink));
    }
    g
}

/// A span per run, so every cell takes its run's colour, weight, slant and underline.
fn spans(row: &Row, ink: Color) -> Vec<Span> {
    row.runs
        .iter()
        .map(|r| {
            let c = fg_color(r.fg, ink);
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
        .collect()
}

/// The columns to fill under the text: each run's background, then the selection over them.
fn fills(row: &Row, selected: Option<(usize, usize)>, tint: Color) -> Vec<(u16, u16, Color)> {
    let backgrounds = row.runs.iter().filter_map(|r| r.bg.map(|bg| (r.col as u16, (r.col + r.cols) as u16, rgb(bg))));
    backgrounds.chain(selected.map(|(from, to)| (from as u16, to as u16 + 1, tint))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::palette;

    /// A Comet with one 20×5 terminal, "t", on 10×20 cells.
    fn comet(output: &[u8]) -> Comet {
        let mut s = Comet::default();
        s.terminals.cell = Some((10.0, 20.0));
        let mut screen = Screen::new(Size { cols: 20, rows: 5 });
        screen.feed(output);
        s.terminals.screens.insert("t".into(), screen);
        s
    }

    fn sent(s: &Comet) -> Vec<String> {
        s.core.sent().into_iter().filter(|m| m["type"] == "terminal.input").map(|m| m["data"].as_str().unwrap().to_owned()).collect()
    }

    /// The middle of a cell, in the terminal's own points.
    fn at(col: usize, row: usize) -> (f32, f32) {
        (PAD + col as f32 * 10.0 + 2.0, row as f32 * 20.0 + 10.0)
    }

    const LOOK: Look = Look { ink: Color::WHITE, tint: Color { r: 0.0, g: 0.0, b: 1.0, a: 0.1 } };

    #[test]
    fn each_run_colours_its_cells_and_the_foreground_draws_in_ink() {
        let s = comet(b"hi \x1b[1;4;31mred\x1b[0m \x1b[42m ok \x1b[0m");
        let row = &s.terminals.screens["t"].rows[0];
        let spans = spans(row, LOOK.ink);
        assert_eq!(spans.first().and_then(|sp| sp.color), Some(LOOK.ink), "plain text draws in Comet's ink");
        let red = spans.iter().find(|sp| &row.text[sp.start as usize..sp.end as usize] == "red").expect("a span for the red word");
        assert_eq!((red.color, red.weight, red.underline), (Some(rgb(palette(1))), Some(700.0), Some(rgb(palette(1)))));
        assert_eq!(spans.last().map(|sp| sp.end as usize), Some(row.text.len()), "the spans cover the whole row");
        assert_eq!(fills(row, Some((0, 1)), LOOK.tint), [(7, 11, rgb(palette(2))), (0, 2, LOOK.tint)], "backgrounds first, the selection over them");
    }

    #[test]
    fn a_row_is_built_again_only_when_it_its_selection_or_the_theme_changes() {
        let mut s = comet(b"one\r\ntwo");
        let rows = |s: &Comet, look| s.terminals.grid_rows("t", &s.terminals.screens["t"], look);
        let first = rows(&s, LOOK);
        assert!(first.iter().zip(rows(&s, LOOK)).all(|(a, b)| Rc::ptr_eq(a, &b)), "an unchanged screen hands back the same rows");
        s.terminals.screens.get_mut("t").unwrap().feed(b"!");
        let typed = rows(&s, LOOK);
        assert!(Rc::ptr_eq(&first[0], &typed[0]) && !Rc::ptr_eq(&first[1], &typed[1]), "only the row typed into is new");
        s.terminals.screens.get_mut("t").unwrap().select_from(Spot { col: 0, row: 0, right: false }, 2);
        let selected = rows(&s, LOOK);
        assert!(!Rc::ptr_eq(&typed[0], &selected[0]) && Rc::ptr_eq(&typed[1], &selected[1]), "only the selected row is new");
        let light = rows(&s, Look { ink: Color::BLACK, ..LOOK });
        assert!(!Rc::ptr_eq(&selected[1], &light[1]), "a theme change builds every row again");
    }

    #[test]
    fn the_grid_reads_each_row_and_puts_the_caret_on_the_cursor() {
        fn view(s: &Comet, _: &mut rune::Cx<Comet>) -> El {
            terminal(s, "t", crate::theme::kit(true))
        }
        let mut rt = rune::Runtime::new(comet(b"$ ls\r\n\xe6\x97\xa5x"), view, (400.0, 200.0), rune::Env { system_dark: true, scale: 2.0 });
        rt.frame(0.0);
        let tree = rt.accessibility_tree();
        let lines: Vec<&str> = tree.nodes.iter().filter_map(|(_, n)| (format!("{:?}", n.role()) == "TextRun").then(|| n.value()).flatten()).collect();
        assert_eq!(lines[..2], ["$ ls\n", "\u{65e5}x\n"], "a line per row, the wide character once");
        let caret = tree.nodes.iter().find_map(|(_, n)| n.text_selection()).expect("the cursor is the caret");
        assert_eq!(caret.focus.character_index, 2, "after the wide character and the x");
    }

    #[test]
    fn a_program_that_tracks_the_mouse_hears_the_press_and_shift_still_selects() {
        let mut s = comet(b"one two\x1b[?1000h\x1b[?1006h");
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
        let mut s = comet(b"\x1b[?1002h\x1b[?1006h");
        let points = [at(1, 0), at(1, 0), at(2, 0)];
        s.terminal_drag("t", Phase::Down, points[0].0, points[0].1, 1, Mods::default());
        for (x, y) in &points[1..] {
            s.terminal_drag("t", Phase::Move, *x, *y, 1, Mods::default());
        }
        assert_eq!(sent(&s), ["\x1b[<0;2;1M", "\x1b[<32;3;1M"]);
    }

    #[test]
    fn the_input_method_types_into_the_terminal_with_the_keyboard() {
        let mut s = comet(b"");
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
        let mut s = comet(b"");
        let (x, y) = at(0, 0);
        s.terminal_wheel("t", 2, x, y, Mods::default());
        assert!(sent(&s).is_empty(), "the shell's own screen scrolls back");
        s.terminals.screens.get_mut("t").unwrap().feed(b"\x1b[?1049h");
        s.terminal_wheel("t", 2, x, y, Mods::default());
        s.terminal_wheel("t", -1, x, y, Mods::default());
        assert_eq!(sent(&s), ["\x1b[A\x1b[A", "\x1b[B"]);
    }
}
