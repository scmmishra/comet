import { Marked } from "marked"

// Raw HTML in a reply shows as text. Model output is untrusted, and the renderer can reach the core.
const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html: ({ text }) => escapeHtml(text),
  },
})

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!)
}

export function Markdown(props: { text: string }) {
  return <div class="desk-prose" innerHTML={marked.parse(props.text, { async: false })} />
}
