import { Icon as OpenCodeIcon } from "@opencode/ui/icon"
import type { IconName as OpenCodeIconName } from "@opencode/ui/icons/catalog"
import { Show, splitProps, type JSX } from "solid-js"

const BOLT = "M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z"

/**
 * Glyphs @opencode/ui has no icon for, drawn on a 16-unit grid. Everything else comes from its
 * catalog, so names follow OpenCode's.
 */
const OWN = {
  "pull-request": "M4 5.1v5.8M12 10.9V6.5a2 2 0 0 0-2-2H7.5M9 3 7.5 4.5 9 6M5.6 3.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0M5.6 12.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0M13.6 12.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0",
  bolt: BOLT,
  play: "M5 3.5v9l7.5-4.5z",
  sparkle: "M8 2.5l1.4 4.1 4.1 1.4-4.1 1.4L8 13.5l-1.4-4.1L2.5 8l4.1-1.4z",
  "shield-off": "M8 1.5l5 2v4c0 3-2.2 5.3-5 6-2.8-.7-5-3-5-6v-4zM2.5 2.5l11 11",
  gauge: "M2.5 11a5.5 5.5 0 1 1 11 0M8 11l2.5-3",
} as const

export type IconName = OpenCodeIconName | keyof typeof OWN

const isOwn = (name: IconName): name is keyof typeof OWN => Object.hasOwn(OWN, name)

/** One icon by name, 15px unless a class sizes it. */
export function Icon(props: { name: IconName; class?: string } & Omit<JSX.SvgSVGAttributes<SVGSVGElement>, "name">) {
  const [local, rest] = splitProps(props, ["name", "class"])
  const size = () => `size-[15px] shrink-0 ${local.class ?? ""}`
  return (
    <Show when={isOwn(local.name) && local.name} fallback={<OpenCodeIcon {...rest} name={local.name} class={size()} />}>
      {(own) => (
        <svg
          {...rest}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
          stroke-linejoin="round"
          class={size()}
          aria-hidden="true"
        >
          <path d={OWN[own() as keyof typeof OWN]} />
        </svg>
      )}
    </Show>
  )
}

/**
 * Claude's starburst mark: eight lines through the centre make sixteen rays. In fast mode a solid
 * bolt sits on its bottom-right corner.
 */
export function ClaudeMark(props: { fast?: boolean }) {
  return (
    <span class="relative shrink-0">
      <svg viewBox="0 0 16 16" class="size-4 text-claude" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" aria-hidden="true">
        <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2M5.3 1.9l5.4 12.2M10.7 1.9 5.3 14.1M1.9 5.3l12.2 5.4M14.1 5.3 1.9 10.7" />
      </svg>
      <Show when={props.fast}>
        {/* The card colour outlines the bolt, so it reads on top of the rays. */}
        <svg viewBox="0 0 16 16" class="absolute -bottom-px -right-1.5 size-[13px] text-fast" aria-label="Fast">
          <path d={BOLT} fill="currentColor" stroke="var(--color-card)" stroke-width="2" stroke-linejoin="round" paint-order="stroke" />
        </svg>
      </Show>
    </span>
  )
}

/** A disclosure chevron, pointing down while open. */
export function Chevron(props: { open: boolean; class?: string }) {
  return <Icon name="chevron-right" class={`transition-transform duration-150 ${props.open ? "rotate-90" : ""} ${props.class ?? ""}`} />
}
