import type { McpServer } from "@desk/protocol"
import { Button } from "@opencode/ui/button"
import { Collapsible } from "@opencode/ui/collapsible"
import { Switch } from "@opencode/ui/switch"
import { Tooltip } from "@opencode/ui/tooltip"
import { createSignal, For, Show } from "solid-js"
import { plural } from "../format"
import { Chevron } from "../icons"
import { projectLabel, reloadProject, toggleMcpServer } from "../projects"
import { SettingsHeader, SettingsList, SettingsRow, SettingsSection } from "./layout"
import { GLOBAL, ScopePills, useScope } from "./scope-pills"

/** What each status reads as, in its dot's label and the row's line. */
const STATUS_LABEL: Record<McpServer["status"], string> = {
  connected: "Connected",
  failed: "Failed",
  "needs-auth": "Needs sign-in",
  pending: "Connecting",
  disabled: "Off",
}

/**
 * Claude Code's MCP servers, after OpenCode's extensions pages. Global lists the servers available to
 * all projects, with their status. A project's pill lists its own servers, then the shared ones folded
 * below them, and each switch acts in that project, as Claude Code keeps a server's on or off per project.
 */
export function McpsPage() {
  const { scope, setScope, project, value: all } = useScope("mcp")
  const own = () => all()?.filter((server) => server.ownProject) ?? []
  const shared = () => all()?.filter((server) => !server.ownProject) ?? []
  return (
    <>
      <SettingsHeader
        title="MCP servers"
        description="The servers Claude Code loads. Global ones load in every project. A project's switches act in that project only."
        actions={
          <Button variant="ghost" onClick={() => reloadProject(project(), "mcp")} disabled={all() === undefined}>
            Refresh
          </Button>
        }
      />
      <div class="settings-tab-body">
        <ScopePills value={scope()} onChange={setScope} />
        <Show when={scope() === GLOBAL}>
          <p class="text-fg-3">From your user settings, claude.ai and plugins. To turn one off, open a project's pill.</p>
        </Show>
        <Show when={all() !== undefined} fallback={<p class="text-fg-3">Starting the servers to read them…</p>}>
          <Show when={all() !== null} fallback={<p class="text-fg-3">Desk could not ask Claude Code for its MCP servers.</p>}>
            <Show
              when={scope() !== GLOBAL}
              fallback={
                <Show when={shared().length > 0} fallback={<p class="text-fg-3">No MCP servers are available to all projects.</p>}>
                  <SettingsList>
                    <For each={shared()}>{(server) => <McpRow project={project()} server={server} toggles={false} />}</For>
                  </SettingsList>
                </Show>
              }
            >
              <SettingsSection title={`Installed in ${projectLabel(project())}`}>
                <Show when={own().length > 0} fallback={<p class="text-fg-3">No MCP servers are installed in this project. Add one to its .mcp.json, or with claude mcp add.</p>}>
                  <SettingsList>
                    <For each={own()}>{(server) => <McpRow project={project()} server={server} toggles />}</For>
                  </SettingsList>
                </Show>
              </SettingsSection>
              <Show when={shared().length > 0}>
                <SharedServers project={project()} servers={shared()} />
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </>
  )
}

/** The servers available to all projects, folded under a project's own, as OpenCode's Shared section. Their switches act in this project. */
function SharedServers(props: { project: string; servers: readonly McpServer[] }) {
  const [open, setOpen] = createSignal(false)
  return (
    <Collapsible variant="ghost" open={open()} onOpenChange={setOpen} class="gap-3">
      <Collapsible.Trigger class="flex h-auto w-fit items-center gap-1.5 text-[13px] font-medium text-fg">
        <Chevron open={open()} class="size-[13px] text-fg-3" />
        Shared
        <span class="font-normal text-fg-3">{props.servers.length}</span>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <SettingsList>
          <For each={props.servers}>{(server) => <McpRow project={props.project} server={server} toggles />}</For>
        </SettingsList>
      </Collapsible.Content>
    </Collapsible>
  )
}

/** A server's row. `toggles` adds its switch, for a project: Claude Code turns a server off per project, never everywhere. */
function McpRow(props: { project: string; server: McpServer; toggles: boolean }) {
  const detail = () => {
    const { status, tools, error, scope } = props.server
    const state = status === "connected" ? plural(tools, "tool") : status === "failed" && error ? error : status === "needs-auth" ? "Sign in with /mcp in Claude Code" : STATUS_LABEL[status]
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
      <Show when={props.toggles}>
        <Switch
          checked={props.server.status !== "disabled"}
          disabled={props.server.status === "pending"}
          onChange={(enabled) => toggleMcpServer(props.project, props.server.name, enabled)}
          hideLabel
        >
          {props.server.name}
        </Switch>
      </Show>
    </SettingsRow>
  )
}

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
