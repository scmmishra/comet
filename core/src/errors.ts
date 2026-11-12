/** What went wrong, in the words of whatever was thrown. */
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
