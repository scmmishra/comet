import type { McpServer } from "@desk/protocol"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { Tooltip } from "@opencode/ui/tooltip"
import { For, onMount, Show } from "solid-js"
import { projectLabel } from "../project-mark"
import { activeProject, readMcpServers, state, toggleMcpServer } from "../store"
import { SettingsHeader, SettingsList, SettingsRow } from "./layout"

/** What each status reads as, in its dot's label and the row's line. */
const STATUS_LABEL: Record<McpServer["status"], string> = {
  connected: "Connected",
  failed: "Failed",
  "needs-auth": "Needs sign-in",
  pending: "Connecting",
  disabled: "Off",
}

/** Claude Code's MCP servers in the active tab's project, after OpenCode's MCP list: a status dot, the name and a switch. */
export function McpsPage() {
  // The page reads the project it opened on, so switching tabs underneath it does not swap the list.
  const project = activeProject()
  const servers = () => state.projects[project]?.mcp
  onMount(() => readMcpServers(project))
  return (
    <>
      <SettingsHeader
        title="MCP servers"
        description={`The servers Claude Code loads in ${projectLabel(project)}. Turning one off keeps it off in this project.`}
        actions={
          <Button variant="ghost" onClick={() => readMcpServers(project)} disabled={servers() === undefined}>
            Refresh
          </Button>
        }
      />
      <div class="settings-tab-body">
        <Show when={servers() !== undefined} fallback={<p class="text-fg-3">Starting the servers to read them…</p>}>
          <Show when={servers()} fallback={<p class="text-fg-3">Desk could not ask Claude Code for its MCP servers.</p>}>
            {(list) => (
              <Show when={list().length > 0} fallback={<p class="text-fg-3">Claude Code loads no MCP servers in this project.</p>}>
                <SettingsList>
                  <For each={list()}>{(server) => <McpRow project={project} server={server} />}</For>
                </SettingsList>
              </Show>
            )}
          </Show>
        </Show>
      </div>
    </>
  )
}

function McpRow(props: { project: string; server: McpServer }) {
  const detail = () => {
    const { status, tools, error, scope } = props.server
    const state = status === "connected" ? `${tools} ${tools === 1 ? "tool" : "tools"}` : status === "failed" && error ? error : status === "needs-auth" ? "Sign in with /mcp in Claude Code" : STATUS_LABEL[status]
    return scope ? `${scope} · ${state}` : state
  }
  return (
    <SettingsRow
      title={
        <span class="flex min-w-0 items-center gap-2.5" classList={{ "text-fg-2": props.server.status === "disabled" }}>
          <StatusDot status={props.server.status} />
          <span class="truncate">{props.server.name}</span>
        </span>
      }
      description={
        <Tooltip value={<span class="font-mono">{props.server.target}</span>} inactive={!props.server.target} placement="bottom">
          <span class="line-clamp-2 break-all">{detail()}</span>
        </Tooltip>
      }
    >
      <Switch
        checked={props.server.status !== "disabled"}
        disabled={props.server.status === "pending"}
        onChange={(enabled) => toggleMcpServer(props.project, props.server.name, enabled)}
        hideLabel
      >
        {props.server.name}
      </Switch>
    </SettingsRow>
  )
}

/** Green when connected, red when failed, amber when it needs sign-in, hollow when off. */
function StatusDot(props: { status: McpServer["status"] }) {
  return (
    <span class="grid size-4 shrink-0 place-items-center" role="img" aria-label={STATUS_LABEL[props.status]}>
      <span
        class="size-[7px] rounded-full"
        classList={{
          "bg-add": props.status === "connected",
          "bg-del": props.status === "failed",
          "bg-fast": props.status === "needs-auth",
          "bg-fg-3 animate-pulse": props.status === "pending",
          "border border-fg-3": props.status === "disabled",
        }}
      />
    </span>
  )
}
