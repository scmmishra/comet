export function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`
}

/** A token count in short: 820, 32k, 1.2M. */
export function formatTokens(tokens: number) {
  if (tokens < 1000) return String(tokens)
  if (tokens < 999_500) return `${Math.round(tokens / 1000)}k`
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
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

export const DAY_MS = 24 * 60 * 60 * 1000

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

/** A project's name: its folder's last part. */
export function projectName(project: string) {
  return project.split("/").filter(Boolean).pop() ?? project
}

/** How long a copy button says it copied. */
export const COPIED_MS = 1500

/** A path with the home folder written as ~. Desk runs on macOS, where homes live in /Users. */
export const shortPath = (path: string) => path.replace(/^\/Users\/[^/]+/, "~")

/** "1 file", "3 files". */
export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** A thread's branch, when it differs from the branch the project is on now. */
export const otherBranch = (thread: { readonly branch?: string }, current: string | undefined) => (thread.branch && thread.branch !== current ? thread.branch : undefined)
