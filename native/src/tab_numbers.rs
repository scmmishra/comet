//! Tab numbers, after OpenCode: while ⌘ is held alone, each tab's mark shows the number of the ⌘
//! shortcut that selects it. A quick shortcut, such as ⌘T, shows none.

use rune::Mods;

/// How long ⌘ is held alone before the numbers show, in seconds.
pub const DELAY: f64 = 0.4;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum TabNumbers {
    #[default]
    Hidden,
    /// ⌘ went down alone. The numbers show at `due`, on the window's clock.
    Waiting { due: f64 },
    Shown,
}

impl TabNumbers {
    /// Hears the modifiers change at `now`. Rune reports none held once the window loses focus,
    /// so that hides the numbers too.
    pub fn modifiers(&mut self, mods: Mods, now: f64) {
        if !cmd_alone(mods) {
            *self = TabNumbers::Hidden;
        } else if *self == TabNumbers::Hidden {
            *self = TabNumbers::Waiting { due: now + DELAY };
        }
    }

    /// Shows the numbers once they are due. Returns whether they began to show.
    pub fn tick(&mut self, now: f64) -> bool {
        match *self {
            TabNumbers::Waiting { due } if now >= due => {
                *self = TabNumbers::Shown;
                true
            }
            _ => false,
        }
    }

    /// When the numbers are due, while ⌘ waits.
    pub fn due(self) -> Option<f64> {
        match self {
            TabNumbers::Waiting { due } => Some(due),
            _ => None,
        }
    }

    pub fn shown(self) -> bool {
        self == TabNumbers::Shown
    }
}

/// Whether ⌘ is held with no other modifier. On macOS ⌘ also sets `logo`, so only Shift, Option
/// and Control count as others.
fn cmd_alone(mods: Mods) -> bool {
    mods.cmd && !mods.shift && !mods.alt && !mods.ctrl
}

#[cfg(test)]
mod tests {
    use super::*;

    const CMD: Mods = Mods { cmd: true, logo: true, shift: false, alt: false, ctrl: false };
    const NONE: Mods = Mods { cmd: false, logo: false, shift: false, alt: false, ctrl: false };

    #[test]
    fn the_numbers_show_once_cmd_is_held_alone_for_the_delay() {
        let mut numbers = TabNumbers::default();
        numbers.modifiers(CMD, 1.0);
        assert!(!numbers.tick(1.0 + DELAY - 0.01));
        assert!(!numbers.shown());
        assert!(numbers.tick(1.0 + DELAY));
        assert!(numbers.shown());
        numbers.modifiers(NONE, 2.0);
        assert!(!numbers.shown());
    }

    #[test]
    fn another_modifier_cancels_them_while_they_wait_and_once_they_show() {
        let shift = Mods { shift: true, ..CMD };
        let mut numbers = TabNumbers::default();
        numbers.modifiers(CMD, 0.0);
        numbers.modifiers(shift, 0.1);
        assert!(!numbers.tick(1.0));
        numbers.modifiers(CMD, 2.0);
        numbers.tick(3.0);
        numbers.modifiers(Mods { alt: true, ..CMD }, 3.1);
        assert!(!numbers.shown());
    }

    #[test]
    fn a_second_hold_waits_its_own_delay() {
        let mut numbers = TabNumbers::default();
        numbers.modifiers(CMD, 0.0);
        numbers.modifiers(NONE, 0.2);
        numbers.modifiers(CMD, 0.3);
        // The first hold's wake comes, but the second hold is not due yet.
        assert!(!numbers.tick(DELAY));
        assert!(numbers.tick(0.3 + DELAY));
    }

    #[test]
    fn a_repeated_report_keeps_the_first_delay() {
        let mut numbers = TabNumbers::default();
        numbers.modifiers(CMD, 0.0);
        numbers.modifiers(CMD, 0.3);
        assert!(numbers.tick(DELAY));
    }
}
