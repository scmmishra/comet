import { homedir } from "node:os"
import { join } from "node:path"

/** Claude Code's own folder: CLAUDE_CONFIG_DIR when the user set it, else ~/.claude. */
export const configDir = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")
