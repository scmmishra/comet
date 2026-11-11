/** What an action the user stopped fails with. The registry knows it by its signal, so the user never reads it. */
const CANCELLED = "Cancelled."

/** A promise that fails once `signal` aborts, to race against work the user may stop. It never settles otherwise. */
export function whenAborted(signal: AbortSignal): Promise<never> {
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) return reject(new Error(CANCELLED))
    signal.addEventListener("abort", () => reject(new Error(CANCELLED)), { once: true })
  })
  // A race that ends first leaves this one unawaited, and its rejection must not surface on its own.
  aborted.catch(() => undefined)
  return aborted
}
