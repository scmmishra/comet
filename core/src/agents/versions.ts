/** Whether `latest` is a later version than `installed`, comparing each number in turn. */
export function isNewer(latest: string, installed: string) {
  const [a, b] = [latest, installed].map((version) => version.split(".").map(Number))
  for (let index = 0; index < 3; index++) if (a![index] !== b![index]) return a![index]! > b![index]!
  return false
}
