import { SERVER_NAME } from "../../tools/mcp"
import { acpToolReader, stringField, type ToolReader } from "../acp/tools"
import type { ToolCall } from "../acp/protocol"

/** Where Antigravity's tools put the command they run, by the names T3 Code found, in the order it reads them. */
const COMMAND_INPUTS = ["CommandLine", "command_line", "commandLine", "command"]
/** Where a finished command repeats it. */
const COMMAND_OUTPUTS = ["commandLine", "command_line"]
/** Where a finished command keeps what it printed. */
const OUTPUT_FIELDS = ["combinedOutput", "combined_output"]
/**
 * The title of a call of one of Comet's tools, such as `Run mcp_comet_delegate`. Antigravity names an MCP
 * tool `mcp_<server>_<tool>`, and its call's input holds only the tool's arguments.
 */
const COMET_TOOL_TITLE = new RegExp(`^Run mcp_${SERVER_NAME}_\\w+\\??$`)
/** The title of the call that updates Antigravity's plan, a checklist of steps, as T3 Code found it. */
const UPDATE_STEPS_TITLE = "Run update_steps"

const firstField = (raw: unknown, keys: readonly string[]) => keys.map((key) => stringField(raw, key)).find((value) => value !== undefined)

/**
 * How Antigravity reports a tool call: its own field names in `rawInput` and `rawOutput`, else ACP's. Its
 * plan updates come as `update_steps` calls, of no kind or of kind `other`, since agy sends no ACP plan.
 */
export const antigravityTools: ToolReader = {
  command: (call: ToolCall) => firstField(call.rawInput, COMMAND_INPUTS) ?? firstField(call.rawOutput, COMMAND_OUTPUTS),
  output: (call: ToolCall) => firstField(call.rawOutput, OUTPUT_FIELDS) ?? acpToolReader.output(call),
  updatesPlan: (call: ToolCall) => (!call.kind || call.kind === "other") && call.title?.trim() === UPDATE_STEPS_TITLE,
}

/** Whether a call runs one of Comet's tools. A command whose title looks like one is not. */
export const isCometTool = (call: ToolCall) => call.kind !== "execute" && antigravityTools.command(call) === undefined && COMET_TOOL_TITLE.test(call.title?.trim() ?? "")
