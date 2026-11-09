/** A project's first letter, as tabs, the session header and the project switcher show it. Tabs use the small size. */
export function ProjectAvatar(props: { name: string | undefined; small?: boolean }) {
  return (
    <span
      class="grid shrink-0 place-items-center bg-[#3a3a40] font-semibold leading-none text-fg"
      classList={{ "size-[18px] rounded-[5px] text-[11px]": !props.small, "size-[16px] rounded-[4px] text-[10px]": props.small }}
    >
      {(props.name ?? "?").charAt(0).toUpperCase()}
    </span>
  )
}
