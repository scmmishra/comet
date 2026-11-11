//! A terminal's screen, kept by `alacritty_terminal` until Rune has a terminal of its own. The shell runs
//! in the core, as for the Electron app: its output arrives here, and keys go back as `terminal.input`.

use alacritty_terminal::event::{Event as TermEvent, EventListener};
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Point, Side};
use alacritty_terminal::selection::{Selection, SelectionType};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::{Config, Term, TermMode, viewport_to_point};
use alacritty_terminal::vte::ansi::{Color, NamedColor, Processor, Rgb};
use rune::Key;
use std::sync::{Arc, Mutex};

/// Lines kept above the screen.
const SCROLLBACK: usize = 10_000;

/// The size of the screen, in cells.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Size {
    pub cols: usize,
    pub rows: usize,
}

impl Dimensions for Size {
    fn total_lines(&self) -> usize {
        self.rows
    }
    fn screen_lines(&self) -> usize {
        self.rows
    }
    fn columns(&self) -> usize {
        self.cols
    }
}

/// Replies the terminal owes the program, such as to a request for the cursor's place.
#[derive(Clone, Default)]
struct Replies(Arc<Mutex<String>>);

impl EventListener for Replies {
    fn send_event(&self, event: TermEvent) {
        if let TermEvent::PtyWrite(text) = event {
            self.0.lock().unwrap().push_str(&text);
        }
    }
}

/// A run of cells with one look, by byte range of the row's text and by column.
#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    pub start: usize,
    pub end: usize,
    pub col: usize,
    pub cols: usize,
    pub fg: Rgb,
    pub bg: Option<Rgb>,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
}

/// One row as the view draws it: its text, and the runs that colour it. Wide characters draw on their
/// own, in their cells, so a fallback font's widths cannot push the row off the grid.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Row {
    pub text: String,
    pub runs: Vec<Run>,
    pub wide: Vec<(usize, String, Rgb)>,
}

pub struct Screen {
    term: Term<Replies>,
    parser: Processor,
    replies: Replies,
    pub rows: Vec<Row>,
    /// Bumps when a row changes, by row, so the view redraws only those.
    pub versions: Vec<u64>,
    /// The cursor's cell, when it shows on screen.
    pub cursor: Option<(usize, usize)>,
    /// The selected cells on screen, by row: the row, then its first and last selected column.
    pub selection: Vec<(usize, usize, usize)>,
    pub size: Size,
}

/// A point on the screen: its cell, and which half of the cell it is in, which decides whether a
/// selection takes that cell.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spot {
    pub col: usize,
    pub row: usize,
    pub right: bool,
}

impl Screen {
    pub fn new(size: Size) -> Screen {
        let replies = Replies::default();
        let config = Config { scrolling_history: SCROLLBACK, ..Config::default() };
        let mut screen = Screen { term: Term::new(config, &size, replies.clone()), parser: Processor::new(), replies, rows: Vec::new(), versions: Vec::new(), cursor: None, selection: Vec::new(), size };
        screen.refresh();
        screen
    }

    /// Takes output from the shell. Returns the replies the program asked for, to send back as input.
    pub fn feed(&mut self, bytes: &[u8]) -> String {
        self.parser.advance(&mut self.term, bytes);
        self.refresh();
        std::mem::take(&mut *self.replies.0.lock().unwrap())
    }

    pub fn resize(&mut self, size: Size) {
        if size != self.size {
            self.size = size;
            self.term.resize(size);
            self.refresh();
        }
    }

    /// Scrolls the view by `lines`, up when positive.
    pub fn scroll(&mut self, lines: i32) {
        self.term.scroll_display(Scroll::Delta(lines));
        self.refresh();
    }

    pub fn mode(&self) -> TermMode {
        *self.term.mode()
    }

    /// Starts a selection at `spot`: by characters, or by words on a double click and lines on a triple.
    pub fn select_from(&mut self, spot: Spot, clicks: u32) {
        let kind = match clicks {
            2 => SelectionType::Semantic,
            3.. => SelectionType::Lines,
            _ => SelectionType::Simple,
        };
        let (point, side) = self.point(spot);
        self.term.selection = Some(Selection::new(kind, point, side));
        self.read_selection();
    }

    /// Moves the selection's end to `spot`.
    pub fn select_to(&mut self, spot: Spot) {
        let (point, side) = self.point(spot);
        if let Some(selection) = &mut self.term.selection {
            selection.update(point, side);
        }
        self.read_selection();
    }

    /// Drops a selection that holds no text, as a click without a drag leaves.
    pub fn drop_empty_selection(&mut self) {
        if self.term.selection.as_ref().is_some_and(Selection::is_empty) {
            self.term.selection = None;
            self.read_selection();
        }
    }

    pub fn selected_text(&self) -> Option<String> {
        self.term.selection_to_string().filter(|t| !t.is_empty())
    }

    /// The grid point under a spot on screen, counting the lines scrolled back.
    fn point(&self, spot: Spot) -> (Point, Side) {
        let at = Point::new(spot.row.min(self.size.rows - 1), Column(spot.col.min(self.size.cols - 1)));
        (viewport_to_point(self.term.grid().display_offset(), at), if spot.right { Side::Right } else { Side::Left })
    }

    /// Reads which cells on screen are selected. Output and resizes move or drop the selection in the terminal.
    fn read_selection(&mut self) {
        self.selection.clear();
        let Some(range) = self.term.selection.as_ref().and_then(|s| s.to_range(&self.term)) else { return };
        let offset = self.term.grid().display_offset() as i32;
        let last = self.size.cols - 1;
        for row in 0..self.size.rows {
            let line = row as i32 - offset;
            if line < range.start.line.0 || line > range.end.line.0 {
                continue;
            }
            let (from, to) = if range.is_block {
                (range.start.column.0, range.end.column.0)
            } else {
                (if line == range.start.line.0 { range.start.column.0 } else { 0 }, if line == range.end.line.0 { range.end.column.0 } else { last })
            };
            self.selection.push((row, from.min(last), to.min(last)));
        }
    }

    /// Reads the screen into rows, and bumps the version of each row that changed.
    fn refresh(&mut self) {
        let content = self.term.renderable_content();
        let offset = content.display_offset as i32;
        let colors = content.colors;
        let mut rows = vec![Row::default(); self.size.rows];
        let mut last: Vec<Option<(Rgb, Option<Rgb>, Flags)>> = vec![None; self.size.rows];
        for cell in content.display_iter {
            let y = cell.point.line.0 + offset;
            if y < 0 || y as usize >= rows.len() || cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                continue;
            }
            let (row, last) = (&mut rows[y as usize], &mut last[y as usize]);
            let inverse = cell.flags.contains(Flags::INVERSE);
            let (mut fg, mut bg) = (resolve(colors, cell.fg, true), resolve(colors, cell.bg, false));
            if inverse {
                std::mem::swap(&mut fg, &mut bg);
            }
            let fg = fg.unwrap_or(FOREGROUND);
            let col = cell.point.column.0;
            if cell.flags.contains(Flags::WIDE_CHAR) {
                row.wide.push((col, cell.c.to_string(), fg));
                row.text.push_str("  ");
            } else {
                row.text.push(if cell.c == '\0' { ' ' } else { cell.c });
            }
            let end = row.text.len();
            let look = (fg, bg, cell.flags & (Flags::BOLD | Flags::ITALIC | Flags::UNDERLINE));
            let width = if cell.flags.contains(Flags::WIDE_CHAR) { 2 } else { 1 };
            match row.runs.last_mut() {
                Some(run) if *last == Some(look) => {
                    run.end = end;
                    run.cols += width;
                }
                _ => row.runs.push(Run {
                    start: end - if width == 2 { 2 } else { cell.c.len_utf8().max(1) },
                    end,
                    col,
                    cols: width,
                    fg,
                    bg,
                    bold: look.2.contains(Flags::BOLD),
                    italic: look.2.contains(Flags::ITALIC),
                    underline: look.2.contains(Flags::UNDERLINE),
                }),
            }
            *last = Some(look);
        }
        let cursor = content.cursor.point;
        let y = cursor.line.0 + offset;
        self.cursor = (self.term.mode().contains(TermMode::SHOW_CURSOR) && y >= 0 && (y as usize) < self.size.rows).then_some((cursor.column.0, y as usize));
        self.versions.resize(rows.len(), 0);
        for (y, row) in rows.iter().enumerate() {
            if self.rows.get(y) != Some(row) {
                self.versions[y] += 1;
            }
        }
        self.rows = rows;
        self.read_selection();
    }
}

/// The theme's foreground, which plain text takes. The view draws it in Desk's own colour.
pub const FOREGROUND: Rgb = Rgb { r: 0xe3, g: 0xe4, b: 0xe8 };

/// A cell's colour: the program's own, else the 256-colour palette. None is the default, which the
/// theme draws: the panel for backgrounds, `FOREGROUND` for text.
fn resolve(colors: &alacritty_terminal::term::color::Colors, color: Color, foreground: bool) -> Option<Rgb> {
    match color {
        Color::Spec(rgb) => Some(rgb),
        Color::Indexed(i) => Some(colors[i as usize].unwrap_or_else(|| palette(i))),
        Color::Named(NamedColor::Foreground | NamedColor::BrightForeground) if foreground => None,
        Color::Named(NamedColor::Background) => None,
        Color::Named(named) if (named as usize) < 16 => Some(colors[named as usize].unwrap_or_else(|| palette(named as u8))),
        Color::Named(_) => None,
    }
}

/// xterm's 256 colours: the 16 named, a 6×6×6 cube, then 24 greys.
pub fn palette(i: u8) -> Rgb {
    const NAMED: [(u8, u8, u8); 16] = [
        (0x1d, 0x1f, 0x21), (0xe8, 0x77, 0x7e), (0x62, 0xc2, 0x8a), (0xf5, 0xc5, 0x42), (0x6e, 0xa8, 0xfe), (0xc6, 0x8a, 0xf0), (0x5f, 0xc8, 0xd8), (0xc5, 0xc8, 0xc6),
        (0x62, 0x66, 0x6d), (0xff, 0x8f, 0x96), (0x7e, 0xdc, 0xa4), (0xff, 0xd8, 0x6b), (0x8c, 0xbe, 0xff), (0xd8, 0xa4, 0xff), (0x7c, 0xdc, 0xea), (0xff, 0xff, 0xff),
    ];
    let rgb = |(r, g, b)| Rgb { r, g, b };
    match i {
        0..16 => rgb(NAMED[i as usize]),
        16..232 => {
            let n = i - 16;
            let level = |v: u8| if v == 0 { 0 } else { 55 + v * 40 };
            rgb((level(n / 36), level(n / 6 % 6), level(n % 6)))
        }
        _ => {
            let v = 8 + (i - 232) * 10;
            rgb((v, v, v))
        }
    }
}

/// The bytes a key sends to the shell, as xterm sends them. Ctrl and Alt follow the usual rules, and the
/// arrows follow the program's cursor mode. None for a key the terminal leaves alone.
pub fn key_bytes(key: &Key, ctrl: bool, alt: bool, app_cursor: bool) -> Option<String> {
    let arrow = |c: char| Some(if app_cursor { format!("\x1bO{c}") } else { format!("\x1b[{c}") });
    let bytes = match key {
        Key::Text(t) if ctrl => {
            let c = t.chars().next()?.to_ascii_lowercase();
            match c {
                'a'..='z' => ((c as u8 - b'a' + 1) as char).to_string(),
                ' ' | '@' => "\0".into(),
                '[' => "\x1b".into(),
                '\\' => "\x1c".into(),
                ']' => "\x1d".into(),
                _ => t.clone(),
            }
        }
        Key::Text(t) => t.clone(),
        Key::Enter => "\r".into(),
        Key::Backspace => "\x7f".into(),
        Key::Tab => "\t".into(),
        Key::Escape => "\x1b".into(),
        Key::Up => return arrow('A').map(|s| alt_prefix(s, alt)),
        Key::Down => return arrow('B').map(|s| alt_prefix(s, alt)),
        Key::Right => return arrow('C').map(|s| alt_prefix(s, alt)),
        Key::Left => return arrow('D').map(|s| alt_prefix(s, alt)),
        Key::Home => "\x1b[H".into(),
        Key::End => "\x1b[F".into(),
        Key::PageUp => "\x1b[5~".into(),
        Key::PageDown => "\x1b[6~".into(),
        Key::Delete => "\x1b[3~".into(),
        Key::Insert => "\x1b[2~".into(),
        Key::Function(n) => match n {
            1 => "\x1bOP".into(),
            2 => "\x1bOQ".into(),
            3 => "\x1bOR".into(),
            4 => "\x1bOS".into(),
            5 => "\x1b[15~".into(),
            6..=10 => format!("\x1b[{}~", n + 11),
            11 | 12 => format!("\x1b[{}~", n + 12),
            _ => return None,
        },
        _ => return None,
    };
    Some(alt_prefix(bytes, alt))
}

/// Alt sends Escape before the key, as with Option as Meta.
fn alt_prefix(bytes: String, alt: bool) -> String {
    if alt { format!("\x1b{bytes}") } else { bytes }
}

/// Pasted text, bracketed when the program asks for it, so a shell does not run it line by line.
pub fn paste_bytes(text: &str, bracketed: bool) -> String {
    let text = text.replace("\r\n", "\r").replace('\n', "\r");
    if bracketed { format!("\x1b[200~{}\x1b[201~", text.replace("\x1b[201~", "")) } else { text }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours_and_text_fill_rows_and_replies_go_back() {
        let mut screen = Screen::new(Size { cols: 20, rows: 3 });
        let reply = screen.feed(b"hi \x1b[31mred\x1b[0m\r\nnext\x1b[6n");
        assert_eq!(screen.rows[0].text.trim_end(), "hi red");
        let red = screen.rows[0].runs.iter().find(|r| &screen.rows[0].text[r.start..r.end] == "red").expect("a run for the red word");
        assert_eq!(red.fg, palette(1));
        assert_eq!(screen.rows[1].text.trim_end(), "next");
        assert_eq!(reply, "\x1b[2;5R", "the cursor report answers the program");
        assert_eq!(screen.cursor, Some((4, 1)));
    }

    #[test]
    fn only_changed_rows_move_their_version() {
        let mut screen = Screen::new(Size { cols: 10, rows: 3 });
        screen.feed(b"a\r\nb");
        let before = screen.versions.clone();
        screen.feed(b"c");
        assert_eq!(screen.versions[0], before[0]);
        assert!(screen.versions[1] > before[1]);
    }

    #[test]
    fn a_drag_selects_text_and_a_double_click_a_word() {
        let mut screen = Screen::new(Size { cols: 20, rows: 3 });
        screen.feed(b"one two\r\nthree four");
        let at = |col, row| Spot { col, row, right: false };
        screen.select_from(at(4, 0), 1);
        screen.select_to(at(5, 1));
        assert_eq!(screen.selected_text().as_deref(), Some("two\nthree"));
        assert_eq!(screen.selection, [(0, 4, 19), (1, 0, 4)]);
        screen.select_from(at(7, 1), 2);
        assert_eq!(screen.selected_text().as_deref(), Some("four"));
    }

    #[test]
    fn a_click_without_a_drag_leaves_no_selection() {
        let mut screen = Screen::new(Size { cols: 10, rows: 2 });
        screen.feed(b"hello");
        screen.select_from(Spot { col: 2, row: 0, right: false }, 1);
        screen.drop_empty_selection();
        assert_eq!(screen.selected_text(), None);
        assert!(screen.selection.is_empty());
    }

    #[test]
    fn keys_encode_as_xterm_sends_them() {
        assert_eq!(key_bytes(&Key::Text("c".into()), true, false, false).as_deref(), Some("\x03"));
        assert_eq!(key_bytes(&Key::Up, false, false, false).as_deref(), Some("\x1b[A"));
        assert_eq!(key_bytes(&Key::Up, false, false, true).as_deref(), Some("\x1bOA"));
        assert_eq!(key_bytes(&Key::Text("b".into()), false, true, false).as_deref(), Some("\x1bb"));
        assert_eq!(key_bytes(&Key::Function(5), false, false, false).as_deref(), Some("\x1b[15~"));
        assert_eq!(paste_bytes("a\nb", true), "\x1b[200~a\rb\x1b[201~");
    }
}
