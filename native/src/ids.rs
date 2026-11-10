//! Random ids, from the system's random source.

use std::io::Read;

fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).expect("the system's random source reads");
    bytes
}

/// `N` random bytes as hex, such as the token only the app and its core know.
pub fn hex<const N: usize>() -> String {
    random::<N>().iter().map(|b| format!("{b:02x}")).collect()
}

/// A version 4 UUID, as `crypto.randomUUID()` makes them.
pub fn uuid() -> String {
    let mut b = random::<16>();
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: Vec<String> = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", h[0..4].concat(), h[4..6].concat(), h[6..8].concat(), h[8..10].concat(), h[10..16].concat())
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_uuid_is_version_4() {
        let id = super::uuid();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
        assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
        assert_ne!(id, super::uuid());
    }
}
