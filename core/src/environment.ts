import type { SpawnOptions, Subprocess } from "bun"

// Bun copies the environment once, when the process starts. Bun.spawn without `env`, and Bun.which without
// `PATH`, read that copy and miss what `takeLoginEnvironment` set, so the core runs and finds programs only
// through the two functions below. node:child_process, Bun.$ and Workers read process.env when called.

/** Bun.spawn with the core's current environment, plus `options.env`. */
export function spawn<const In extends SpawnOptions.Writable = "ignore", const Out extends SpawnOptions.Readable = "pipe", const Err extends SpawnOptions.Readable = "inherit">(
  command: string[],
  options: SpawnOptions.SpawnOptions<In, Out, Err> = {},
): Subprocess<In, Out, Err> {
  return Bun.spawn(command, { ...options, env: { ...process.env, ...options.env } })
}

/** The path of `command` on the core's current PATH, or null. */
export function which(command: string): string | null {
  return Bun.which(command, { PATH: process.env.PATH ?? "" })
}
