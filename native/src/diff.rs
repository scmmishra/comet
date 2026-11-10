//! A line diff of a tool's edit, as `app/src/renderer/diff.ts` makes it.

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LineKind {
    Same,
    Add,
    Del,
}

/// Edits larger than this many lines on either side show as removed-then-added, without matching.
const MAX_MATCHED_LINES: usize = 400;

/// A line diff of two strings, by longest common subsequence. Tool edits are small, so this stays cheap.
pub fn line_diff<'a>(before: &'a str, after: &'a str) -> Vec<(LineKind, &'a str)> {
    let split = |s: &'a str| if s.is_empty() { Vec::new() } else { s.split('\n').collect::<Vec<_>>() };
    let (a, b) = (split(before), split(after));
    if a.len() > MAX_MATCHED_LINES || b.len() > MAX_MATCHED_LINES {
        return a.iter().map(|t| (LineKind::Del, *t)).chain(b.iter().map(|t| (LineKind::Add, *t))).collect();
    }
    let mut table = vec![vec![0u32; b.len() + 1]; a.len() + 1];
    for i in (0..a.len()).rev() {
        for j in (0..b.len()).rev() {
            table[i][j] = if a[i] == b[j] { table[i + 1][j + 1] + 1 } else { table[i + 1][j].max(table[i][j + 1]) };
        }
    }
    let (mut lines, mut i, mut j) = (Vec::new(), 0, 0);
    while i < a.len() && j < b.len() {
        if a[i] == b[j] {
            lines.push((LineKind::Same, a[i]));
            (i, j) = (i + 1, j + 1);
        } else if table[i + 1][j] >= table[i][j + 1] {
            lines.push((LineKind::Del, a[i]));
            i += 1;
        } else {
            lines.push((LineKind::Add, b[j]));
            j += 1;
        }
    }
    lines.extend(a[i..].iter().map(|t| (LineKind::Del, *t)));
    lines.extend(b[j..].iter().map(|t| (LineKind::Add, *t)));
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_shared_lines_and_marks_the_rest() {
        assert_eq!(line_diff("a\nb\nc", "a\nx\nc"), [(LineKind::Same, "a"), (LineKind::Del, "b"), (LineKind::Add, "x"), (LineKind::Same, "c")]);
        assert_eq!(line_diff("", "new"), [(LineKind::Add, "new")]);
    }
}
