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
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`
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

const DAY_MS = 24 * 60 * 60 * 1000

/** A message's time, as T3 Code shows it: "15:54" today, "yesterday at 15:54", then a date. */
export function formatMessageTime(at: number, now = Date.now()) {
  const date = new Date(at)
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / DAY_MS)
  if (days <= 0) return time
  if (days === 1) return `yesterday at ${time}`
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })} ${time}`
}
