import { definePlugin, Item, List, Messages, Stack, Text, type MessageData } from "@desk/plugin"
import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"

/**
 * A support inbox, as a Desk plugin, on made-up conversations. It calls no service. The inbox sidebar
 * lists open conversations. Picking one opens it as a panel in the view pane and opens the Claude
 * thread kept for it. Turn it on for a project in `~/.desk/plugins.json`.
 */

interface Conversation {
  readonly id: number
  readonly customer: string
  readonly status: "open"
  unread: number
  readonly priority?: "high" | "urgent"
  readonly messages: MessageData[]
}

const HOUR_MS = 60 * 60 * 1000
const ago = (hours: number) => Date.now() - hours * HOUR_MS

/** Sample conversations. None of them is real. */
const SAMPLE: Conversation[] = [
  {
    id: 1001,
    customer: "Priya Raman",
    status: "open",
    unread: 2,
    priority: "urgent",
    messages: [
      { id: "1", author: "Priya Raman", text: "None of our appointment reminders have gone out since Friday.", at: ago(3), incoming: true },
      { id: "2", author: "Priya Raman", text: "We have 200 appointments tomorrow morning. Please help.", at: ago(2.9), incoming: true },
      { id: "3", text: "Assigned to you", at: ago(2.8), kind: "activity" },
    ],
  },
  {
    id: 1002,
    customer: "Jonas Weber",
    status: "open",
    unread: 1,
    priority: "high",
    messages: [
      { id: "1", author: "Jonas Weber", text: "Since this morning our team can't log in with SSO. It sends us back to the sign-in page.", at: ago(5), incoming: true },
      { id: "2", author: "Sam", text: "Thanks Jonas, we're looking into it now.", at: ago(4.5) },
      { id: "3", author: "Sam", text: "Their signing certificate may have expired.", at: ago(4.4), kind: "note" },
      { id: "4", author: "Jonas Weber", text: "Any update? Half the team is locked out.", at: ago(1), incoming: true },
    ],
  },
  {
    id: 1003,
    customer: "Ana Souza",
    status: "open",
    unread: 0,
    messages: [{ id: "1", author: "Ana Souza", text: "When I export contacts to CSV, the custom attribute columns are empty.", at: ago(26), incoming: true }],
  },
  {
    id: 1004,
    customer: "Marco Bianchi",
    status: "open",
    unread: 0,
    messages: [{ id: "1", author: "Marco Bianchi", text: "Can we change the name of the bot that answers on Instagram?", at: ago(48), incoming: true }],
  },
]

export default definePlugin((desk) => {
  const [conversations, setConversations] = createStore<Conversation[]>(structuredClone(SAMPLE))
  const find = (id: unknown) => conversations.find((conversation) => conversation.id === id)

  desk.sidebar("inbox", {
    title: "Inbox",
    view: (ctx) => (
      <Show when={conversations.length > 0} fallback={<Text tone="muted">No open conversations.</Text>}>
        <List>
          <For each={conversations}>
            {(conversation) => (
              <Item
                title={conversation.customer}
                subtitle={conversation.messages.at(-1)?.text}
                badge={conversation.unread ? { text: String(conversation.unread), tint: "blue" } : conversation.priority ? { text: conversation.priority, tint: "orange" } : undefined}
                selected={ctx.isOpen("support.conversation", { id: conversation.id })}
                onSelect={() => {
                  setConversations((found) => found.id === conversation.id, "unread", 0)
                  ctx.open("support.conversation", { id: conversation.id })
                  const transcript = conversation.messages.map((message) => `${message.author ?? "Activity"}: ${message.text}`).join("\n")
                  ctx.openThread({
                    key: `sample-support-${conversation.id}`,
                    title: `#${conversation.id} ${conversation.customer}`,
                    prompt: `This is a made-up support conversation for a demo. Draft a reply to it. Do not run any commands.\n\n${transcript}`,
                  })
                }}
              />
            )}
          </For>
        </List>
      </Show>
    ),
  })

  desk.panel<{ id: number }>("conversation", {
    title: (params) => `#${params.id} ${find(params.id)?.customer ?? ""}`,
    params: ["id"],
    single: true,
    view: (ctx) => (
      <Show when={find(ctx.params.id)} fallback={<Text tone="muted">This conversation is gone.</Text>}>
        {(conversation) => (
          <Stack grow>
            <Stack direction="row">
              <Text tone="strong">{conversation().customer}</Text>
              <Text tone="muted">
                #{conversation().id} · {conversation().status} · sample data
              </Text>
            </Stack>
            <Messages items={conversation().messages} />
          </Stack>
        )}
      </Show>
    ),
  })

  desk.setup("support", { title: "Support", sidebar: "support.inbox" })
})
