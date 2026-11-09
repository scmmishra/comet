import type { Component } from "solid-js"
import type { IconName } from "../icons"
import { AppearancePage } from "./appearance"
import { McpsPage } from "./mcps"
import { ProjectsPage } from "./projects"
import { ProvidersPage } from "./providers"
import { SkillsPage } from "./skills"

/** The settings screen's pages, in the order its sidebar and the command palette list them. */
export const SETTINGS_PAGES: readonly { readonly id: string; readonly title: string; readonly icon: IconName; readonly view: Component }[] = [
  { id: "providers", title: "Providers", icon: "providers", view: ProvidersPage },
  { id: "appearance", title: "Appearance", icon: "appearance", view: AppearancePage },
  { id: "projects", title: "Projects", icon: "folder", view: ProjectsPage },
  { id: "mcps", title: "MCP servers", icon: "mcp", view: McpsPage },
  { id: "skills", title: "Skills", icon: "post-skill", view: SkillsPage },
]
