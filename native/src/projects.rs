//! What the core reads about each project.

use crate::protocol::{CommandInfo, CommandSource, McpServer, PluginContributions, Skill, Space, ThreadSummary};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Default)]
pub struct Project {
    /// The project's recent threads, open in a tab or not. None until read.
    pub threads: Option<Vec<ThreadSummary>>,
    /// None until read or outside a Git repo.
    pub space: Option<Space>,
    /// Each agent's slash commands in the project, by agent. None until read, and None for an agent that could not be asked.
    pub skills: Option<HashMap<String, Option<Vec<Skill>>>>,
    /// The project's own commands, which the Commands card runs. None until read.
    pub commands: Option<Vec<CommandInfo>>,
    /// Commands the project's files define, for the command editor's import menu. None until read.
    pub command_sources: Option<Vec<CommandSource>>,
    /// What the project's plugins offer in the palette.
    pub plugins: Option<PluginContributions>,
    /// Images in the project that look like its logo, for the icon picker, as paths inside it. None until read.
    pub icons: Option<Vec<String>>,
    /// The MCP servers Claude Code loads in the project. Some(None) when it could not be asked.
    pub mcp: Option<Option<Vec<McpServer>>>,
}

impl Project {
    /// An agent's slash commands in the project. None until read, and when the agent could not be asked.
    pub fn skills_of(&self, agent: &str) -> Option<&[Skill]> {
        self.skills.as_ref()?.get(agent)?.as_deref()
    }
}

#[derive(Default)]
pub struct Projects {
    by_dir: HashMap<String, Project>,
}

impl Projects {
    pub fn get(&self, dir: &str) -> Option<&Project> {
        self.by_dir.get(dir)
    }

    /// Takes one part the core read. Parts the app does not show yet are left out.
    pub fn read(&mut self, dir: String, part: &str, value: Value) {
        let project = self.by_dir.entry(dir).or_default();
        match part {
            "threads" => project.threads = serde_json::from_value(value).ok(),
            "space" => project.space = serde_json::from_value(value).ok(),
            "skills" => project.skills = serde_json::from_value(value).ok(),
            "icons" => project.icons = serde_json::from_value(value).ok(),
            "commands" => project.commands = serde_json::from_value(value).ok(),
            "commandSources" => project.command_sources = serde_json::from_value(value).ok(),
            "plugins" => project.plugins = serde_json::from_value(value).ok(),
            "mcp" => project.mcp = Some(serde_json::from_value(value).ok()),
            _ => {}
        }
    }
}

/// The parts a tab shows about its project: the start screen's threads, and the cards' Space and commands.
pub const START_PARTS: [&str; 3] = ["threads", "space", "commands"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_threads_and_space_and_a_folder_outside_git() {
        let mut projects = Projects::default();
        projects.read("/a".into(), "threads", serde_json::json!([{ "id": "s", "agent": "claude", "title": "T", "updatedAt": 5.0 }]));
        projects.read("/a".into(), "space", serde_json::json!({ "name": "a", "root": "/a", "branch": "main", "changes": {} }));
        projects.read("/b".into(), "space", Value::Null);
        assert_eq!(projects.get("/a").unwrap().threads.as_ref().unwrap()[0].title, "T");
        assert_eq!(projects.get("/a").unwrap().space.as_ref().unwrap().branch, "main");
        assert!(projects.get("/b").unwrap().space.is_none());
    }

    #[test]
    fn keeps_each_agents_commands_apart_and_none_for_an_agent_that_could_not_be_asked() {
        let mut projects = Projects::default();
        assert!(Project::default().skills_of("claude").is_none());
        projects.read("/a".into(), "skills", serde_json::json!({ "claude": [{ "name": "pdf", "description": "Reads PDFs", "ownProject": false, "group": "User" }], "codex": [], "antigravity": null }));
        let project = projects.get("/a").unwrap();
        assert_eq!(project.skills_of("claude").unwrap().iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["pdf"]);
        assert!(project.skills_of("codex").unwrap().is_empty());
        assert!(project.skills_of("antigravity").is_none());
    }
}
