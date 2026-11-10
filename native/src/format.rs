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

/// How long ago a time was, in the largest whole unit: "now", "5m", "3h", "2d", then a date.
pub fn ago(time_ms: f64, now_ms: f64) -> String {
    let minutes = ((now_ms - time_ms) / 60_000.0).floor() as i64;
    if minutes < 1 {
        return "now".into();
    }
    if minutes < 60 {
        return format!("{minutes}m");
    }
    let hours = minutes / 60;
    if hours < 24 {
        return format!("{hours}h");
    }
    let days = hours / 24;
    if days < 7 {
        return format!("{days}d");
    }
    month_day(time_ms)
}

/// "Nov 3", in the system's time zone.
fn month_day(time_ms: f64) -> String {
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let (_, month, day) = civil_date((time_ms / 1000.0) as i64 + local_offset_s());
    format!("{} {day}", MONTHS[(month - 1) as usize])
}

/// The system's offset from UTC, in seconds.
fn local_offset_s() -> i64 {
    // SAFETY: localtime_r writes into the struct it is given, and reads the time it is given.
    unsafe {
        let now = libc::time(std::ptr::null_mut());
        let mut tm: libc::tm = std::mem::zeroed();
        libc::localtime_r(&now, &mut tm);
        tm.tm_gmtoff
    }
}

/// Year, month and day of a count of seconds since the epoch, by Howard Hinnant's civil-from-days.
fn civil_date(seconds: i64) -> (i64, i64, i64) {
    let z = seconds.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
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
        assert_eq!(ago(0.0, 30_000.0), "now");
        assert_eq!(ago(0.0, 5.0 * 60_000.0), "5m");
        assert_eq!(ago(0.0, 3.0 * 3_600_000.0), "3h");
        assert_eq!(ago(0.0, 2.0 * 86_400_000.0), "2d");
        assert_eq!(civil_date(1_700_000_000), (2023, 11, 14));
    }
}
