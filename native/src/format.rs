//! Words for numbers and times, as `app/src/renderer/format.ts` writes them.

/// "45 s", "2 min", "2 min 5 s".
pub fn duration(ms: f64) -> String {
    let seconds = (ms / 1000.0).round().max(0.0) as u64;
    if seconds < 60 {
        return format!("{seconds} s");
    }
    let (minutes, rest) = (seconds / 60, seconds % 60);
    if rest == 0 { format!("{minutes} min") } else { format!("{minutes} min {rest} s") }
}

/// A token count in short: 820, 32k, 1.2M.
pub fn tokens(count: f64) -> String {
    if count < 1000.0 {
        return format!("{}", count.round());
    }
    if count < 999_500.0 {
        return format!("{}k", (count / 1000.0).round());
    }
    let millions = format!("{:.1}", count / 1_000_000.0);
    format!("{}M", millions.trim_end_matches(".0"))
}

/// "1 file", "3 files".
pub fn plural(count: usize, one: &str) -> String {
    if count == 1 { format!("1 {one}") } else { format!("{count} {one}s") }
}

/// A project's name: its folder's last part.
pub fn project_name(project: &str) -> &str {
    project.trim_end_matches('/').rsplit('/').next().filter(|s| !s.is_empty()).unwrap_or(project)
}

/// Now, in milliseconds since the epoch, as the core times messages.
pub fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_as_the_app_writes_them() {
        assert_eq!(duration(44_600.0), "45 s");
        assert_eq!(duration(120_000.0), "2 min");
        assert_eq!(duration(125_000.0), "2 min 5 s");
        assert_eq!(tokens(820.0), "820");
        assert_eq!(tokens(32_400.0), "32k");
        assert_eq!(tokens(1_000_000.0), "1M");
        assert_eq!(tokens(1_230_000.0), "1.2M");
        assert_eq!(plural(1, "changed file"), "1 changed file");
        assert_eq!(plural(3, "changed file"), "3 changed files");
        assert_eq!(project_name("/Users/me/code/web/"), "web");
    }
}
