import { Marked } from "marked"
import { createEffect, on } from "solid-js"
import { fileIconId, fileIconName, requestFileIcon } from "./file-icons"
import { fileLabel, fileReference, type FileReference } from "./file-links"
import { highlight } from "./highlight"
import { openFile } from "./store"

const COPIED_MS = 1200
// Raw HTML in a reply shows as text. Model output is untrusted, and the renderer can reach the core.
const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    code: ({ text, lang }) => {
      const language = (lang ?? "").split(/\s/)[0] || "text"
      return (
        `<div class="desk-code"><div class="desk-code-header"><span>${escapeHtml(language)}</span>` +
        `<button class="desk-code-copy" data-copy>Copy</button></div>` +
        `<pre><code data-lang="${escapeHtml(language)}">${escapeHtml(text)}</code></pre></div>`
      )
    },
    codespan: ({ text }) => {
      // Escape whatever marked hands over, so inline code can never become markup.
      const source = unescapeHtml(text)
      const reference = fileReference(source)
      return reference ? fileChip(reference) : `<code>${escapeHtml(source)}</code>`
    },
    link(token) {
      const reference = fileReference(token.href)
      if (reference) return fileChip(reference)
      return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noreferrer">${this.parser.parseInline(token.tokens)}</a>`
    },
  },
})

function fileChip(reference: FileReference) {
  const icon = fileIconName(reference.path)
  const title = escapeHtml(reference.line ? `${reference.path}:${reference.line}` : reference.path)
  return (
    `<a class="desk-file" href="#" title="${title}" data-path="${escapeHtml(reference.path)}" data-line="${reference.line ?? ""}">` +
    `<svg aria-hidden="true" data-icon="${icon}"><use href="#${fileIconId(icon)}"/></svg>` +
    `<span>${escapeHtml(fileLabel(reference))}</span></a>`
  )
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!)
}

/** marked hands inline code over already escaped. */
function unescapeHtml(text: string) {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]!)
}

/** Copy buttons and file chips are plain HTML from the Markdown, so one handler serves all of them. */
function handleClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const file = target.closest<HTMLElement>(".desk-file")
  if (file) {
    event.preventDefault()
    openFile(file.dataset.path!, Number(file.dataset.line) || undefined)
    return
  }
  const button = target.closest<HTMLButtonElement>("[data-copy]")
  const code = button?.closest(".desk-code")?.querySelector("code")
  if (!button || !code) return
  void navigator.clipboard.writeText(code.textContent ?? "")
  button.textContent = "Copied"
  setTimeout(() => (button.textContent = "Copy"), COPIED_MS)
}

/**
 * Renders a reply. Code is highlighted once the text is final: while it streams, each change
 * replaces the HTML, so highlighting then would only flicker.
 */
export function Markdown(props: { text: string; done?: boolean }) {
  let root!: HTMLDivElement
  createEffect(
    on(
      () => [props.text, props.done] as const,
      ([, done]) => {
        for (const icon of root.querySelectorAll<SVGElement>(".desk-file svg[data-icon]")) requestFileIcon(icon.dataset.icon!)
        if (done === false) return
        for (const code of root.querySelectorAll<HTMLElement>("code[data-lang]:not([data-highlighted])")) {
          code.dataset.highlighted = ""
          const source = code.textContent ?? ""
          void highlight(source, code.dataset.lang!).then((html) => {
            if (code.isConnected && code.textContent === source) code.innerHTML = html
          })
        }
      },
    ),
  )
  return <div ref={root} class="desk-prose" onClick={handleClick} innerHTML={marked.parse(props.text, { async: false })} />
}
