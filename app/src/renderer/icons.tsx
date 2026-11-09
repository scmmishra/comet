import type { JSX } from "solid-js"

/** Line icons on a 16-unit grid, drawn the same way as the approved mock. Only the ones Desk uses. */
const PATHS = {
  branch: "M4 5.1v5.8M12 6.6c0 3-4 2.6-7.2 4.6M5.6 3.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0M5.6 12.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0M13.6 5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0",
  pr: "M4 5.1v5.8M12 10.9V6.5a2 2 0 0 0-2-2H7.5M9 3 7.5 4.5 9 6M5.6 3.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0M5.6 12.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0M13.6 12.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0",
  folder: "M2 4.5C2 3.7 2.7 3 3.5 3h3L8 4.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9C2.7 13 2 12.3 2 11.5z",
  diff: "M9.5 2h-5C3.7 2 3 2.7 3 3.5v9c0 .8.7 1.5 1.5 1.5h7c.8 0 1.5-.7 1.5-1.5v-7zM8 5.5v4M6 7.5h4M6 11.5h4",
  check: "M3.5 8.5l3 3 6-7",
  chevron: "M6 4l4 4-4 4",
  down: "M4 6l4 4 4-4",
  up: "M8 13V3M4 7l4-4 4 4",
  stop: "M5 5h6v6H5z",
  plus: "M8 3v10M3 8h10",
  x: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  edit: "M10.5 3 13 5.5 6 12.5H3.5V10z",
  bot: "M4.5 5h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2M8 2.5V5M6 9h.01M10 9h.01",
  panel: "M4 2.5h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2M10 2.5v11",
  terminal: "M3.5 3h9a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3M5 6.5l2 1.5-2 1.5M8.5 10h2.5",
  gauge: "M2.5 11a5.5 5.5 0 1 1 11 0M8 11l2.5-3",
  lock: "M4.5 7.5h7a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2",
} as const

export type IconName = keyof typeof PATHS

export function Icon(props: { name: IconName; class?: string } & JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`size-[15px] shrink-0 ${props.class ?? ""}`}
      aria-hidden="true"
    >
      <path d={PATHS[props.name]} />
    </svg>
  )
}
