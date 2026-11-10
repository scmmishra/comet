import { FOLLOW_UPS, type Effort, type ModelOption } from "@desk/protocol"
import { Badge } from "@opencode/ui/badge"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { For, Show } from "solid-js"
import { account, updateSettings } from "../account"
import { ClaudeMark } from "../icons"
import { UsageRow } from "../meters"
import { EFFORT_LABEL, effortFor, PERMISSION, permissionFor, permissionModes } from "../models"
import { SettingsHeader, SettingsList, SettingsRow, SettingsSection } from "./layout"

/** Agents Desk will run next. They show so the page says what is coming, and do nothing yet. */
const COMING_SOON = ["Codex", "Antigravity"]

/** An effort choice, or the model's own default. */
type EffortChoice = { readonly value?: Effort; readonly label: string }

/** The agents Desk runs, and what a new tab starts Claude with. */
export function ProvidersPage() {
  const claude = () => account.settings.claude
  const model = () => account.models.find((option) => option.value === claude().model)
  const efforts = (): EffortChoice[] => [
    { label: model()?.defaultEffort ? `Default (${EFFORT_LABEL[model()!.defaultEffort!]})` : "Default" },
    ...(model()?.efforts ?? []).map((value) => ({ value, label: EFFORT_LABEL[value] })),
  ]
  const pickModel = (option: ModelOption) => updateSettings({ claude: { model: option.value, effort: effortFor(option, claude().effort) ?? null } })

  return (
    <>
      <SettingsHeader title="Providers" description="The coding agents Desk runs, and what a new tab starts with." />
      <div class="settings-tab-body">
        <SettingsSection title="Claude Code">
          <SettingsList>
            <SettingsRow title={<span class="flex items-center gap-2"><ClaudeMark />Claude Code</span>} description={<AccountLine />}>
              <Show when={account.userRead}>
                <Badge variant={account.user ? "accent" : "neutral"}>{account.user ? "Connected" : "Not signed in"}</Badge>
              </Show>
            </SettingsRow>
            <SettingsRow title="Default model" description="The model a new tab starts on. A tab can change it in the model picker.">
              <Select
                options={[...account.models]}
                current={model()}
                value={(option) => option.value}
                label={(option) => option.label}
                placeholder="Loading models…"
                placement="bottom-end"
                gutter={6}
                onSelect={(option) => option && pickModel(option)}
              />
            </SettingsRow>
            <Show when={model()?.efforts.length}>
              <SettingsRow title="Default effort" description="How long Claude thinks before it answers, on the default model.">
                <Select
                  options={efforts()}
                  current={efforts().find((choice) => choice.value === claude().effort)}
                  value={(choice) => choice.value ?? "default"}
                  label={(choice) => choice.label}
                  placement="bottom-end"
                  gutter={6}
                  onSelect={(choice) => choice && updateSettings({ claude: { effort: choice.value ?? null } })}
                />
              </SettingsRow>
            </Show>
            <SettingsRow title="Default permissions" description="How a new tab's Claude handles tool calls. A tab can change it in the model picker. Auto needs a model that supports it.">
              <Select
                options={[...permissionModes(model())]}
                current={permissionFor(model(), claude().permissionMode)}
                value={(mode) => mode}
                label={(mode) => PERMISSION[mode].label}
                placement="bottom-end"
                gutter={6}
                onSelect={(permissionMode) => permissionMode && updateSettings({ claude: { permissionMode } })}
              />
            </SettingsRow>
            <SettingsRow title="Follow-ups" description="What Enter does while Claude works: steer the running turn, or queue the message for when it ends. ⌘Enter does the other, for one message.">
              <Select
                options={[...FOLLOW_UPS]}
                current={claude().followUp}
                value={(followUp) => followUp}
                label={(followUp) => (followUp === "steer" ? "Steer" : "Queue")}
                placement="bottom-end"
                gutter={6}
                onSelect={(followUp) => followUp && updateSettings({ claude: { followUp } })}
              />
            </SettingsRow>
            <SettingsRow title="Compact idle threads" description="When you return to a large thread that sat idle, Claude Code compacts it first, so its next reply reads a summary, not the whole history.">
              <Switch checked={claude().compactIdle} onChange={(compactIdle) => updateSettings({ claude: { compactIdle } })} hideLabel>
                Compact idle threads
              </Switch>
            </SettingsRow>
          </SettingsList>
        </SettingsSection>
        <Show when={account.usage}>
          {(usage) => (
            <SettingsSection title="Subscription">
              <SettingsList>
                <SettingsRow title={planName(account.user?.plan)} description="Your plan's usage limits, as Claude Code reports them.">
                  <div class="grid w-[260px] gap-3">
                    <For each={usage().windows}>{(window) => <UsageRow window={window} />}</For>
                  </div>
                </SettingsRow>
              </SettingsList>
            </SettingsSection>
          )}
        </Show>
        <SettingsSection title="Coming soon">
          <SettingsList>
            <For each={COMING_SOON}>
              {(name) => (
                <SettingsRow title={name} description={`Desk will run ${name} beside Claude Code.`}>
                  <Badge variant="subtle">Coming soon</Badge>
                </SettingsRow>
              )}
            </For>
          </SettingsList>
        </SettingsSection>
      </div>
    </>
  )
}

/** Who Claude Code is signed in as, or how to sign in. */
function AccountLine() {
  return (
    <Show when={account.userRead} fallback="Checking the account…">
      <Show when={account.user} fallback={<>Not signed in. Run <code class="font-mono">claude</code> in a terminal to sign in.</>}>
        {(account) => (
          <Show when={account().email} fallback={account().apiKeySource ? `Signed in with an API key from ${account().apiKeySource}.` : `Signed in through ${account().apiProvider}.`}>
            {(email) => `Signed in as ${email()}${account().organization ? ` · ${account().organization}` : ""}`}
          </Show>
        )}
      </Show>
    </Show>
  )
}

/** "max" reads as "Max plan". Without a plan, the account pays per use. */
function planName(plan: string | undefined) {
  return plan ? `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan` : "Plan"
}
