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
