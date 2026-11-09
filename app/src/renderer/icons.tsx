import type { JSX } from "solid-js"

/** Small line icons, 16px on a 16-unit grid. Only the ones Desk uses. */
const PATHS = {
  branch: "M5 3.5v9M5 3.5a1.5 1.5 0 1 0 0 .01M5 12.5a1.5 1.5 0 1 0 0 .01M11 5a1.5 1.5 0 1 0 0 .01M11 6.5c0 2.5-3 2.5-6 4.5",
  folder: "M2 4.5C2 3.7 2.7 3 3.5 3h3L8 4.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9C2.7 13 2 12.3 2 11.5z",
  pr: "M4 5.1v5.8M4 3.5a1.5 1.5 0 1 0 0 .01M4 12.5a1.5 1.5 0 1 0 0 .01M12 12.5a1.5 1.5 0 1 0 0 .01M12 10.9V6.5a2 2 0 0 0-2-2H7.5M9 3 7.5 4.5 9 6",
  diff: "M9.5 2h-5C3.7 2 3 2.7 3 3.5v9c0 .8.7 1.5 1.5 1.5h7c.8 0 1.5-.7 1.5-1.5v-7zM8 5.5v4M6 7.5h4M6 11.5h4",
  check: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11M5.5 8.2l1.7 1.7 3.3-3.6",
  up: "M8 13V3M4 7l4-4 4 4",
  stop: "M5 5h6v6H5z",
} as const

export type IconName = keyof typeof PATHS

export function Icon(props: { name: IconName; class?: string } & JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`size-4 shrink-0 ${props.class ?? ""}`}
      aria-hidden="true"
    >
      <path d={PATHS[props.name]} />
    </svg>
  )
}
