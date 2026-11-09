/** "claude-opus-5-5" → "Opus 5.5". Unknown ids pass through unchanged. */
export function modelLabel(id: string | undefined) {
  if (!id) return "Claude"
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d))?/.exec(id)
  if (!match) return id
  const [, family, major, minor] = match
  return `${family!.charAt(0).toUpperCase()}${family!.slice(1)} ${major}${minor ? `.${minor}` : ""}`
}

export function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

/** How long ago a time was, in the largest whole unit: "now", "5m", "3h", "2d", then a date. */
export function formatAgo(time: number, now = Date.now()) {
  const minutes = Math.floor((now - time) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
