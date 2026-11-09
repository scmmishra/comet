import { Marked } from "marked"

const COPIED_MS = 1200

// Raw HTML in a reply shows as text. Model output is untrusted, and the renderer can reach the core.
const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    code: ({ text, lang }) =>
      `<div class="desk-code"><div class="desk-code-header"><span>${escapeHtml(lang || "text")}</span>` +
      `<button class="desk-code-copy" data-copy>Copy</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`,
  },
})

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!)
}

/** Copy buttons are plain HTML from the Markdown, so one handler on the block serves all of them. */
function copyCode(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]")
  const code = button?.closest(".desk-code")?.querySelector("code")
  if (!button || !code) return
  void navigator.clipboard.writeText(code.textContent ?? "")
  button.textContent = "Copied"
  setTimeout(() => (button.textContent = "Copy"), COPIED_MS)
}

export function Markdown(props: { text: string }) {
  return <div class="desk-prose" onClick={copyCode} innerHTML={marked.parse(props.text, { async: false })} />
}
