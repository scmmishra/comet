//! What the core reads about each project, as `app/src/renderer/projects.ts` keeps it.

use crate::protocol::{Skill, Space, ThreadSummary};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Default)]
pub struct Project {
    /// The project's recent threads, open in a tab or not. None until read.
    pub threads: Option<Vec<ThreadSummary>>,
    /// None until read or outside a Git repo.
    pub space: Option<Space>,
    /// Claude Code's commands in the project. None until read.
    pub skills: Option<Vec<Skill>>,
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
            _ => {}
        }
    }
}

/// The parts the start screen shows.
pub const START_PARTS: [&str; 2] = ["threads", "space"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_threads_and_space_and_a_folder_outside_git() {
        let mut projects = Projects::default();
        projects.read("/a".into(), "threads", serde_json::json!([{ "id": "s", "title": "T", "updatedAt": 5.0 }]));
        projects.read("/a".into(), "space", serde_json::json!({ "name": "a", "root": "/a", "branch": "main", "changes": {} }));
        projects.read("/b".into(), "space", Value::Null);
        assert_eq!(projects.get("/a").unwrap().threads.as_ref().unwrap()[0].title, "T");
        assert_eq!(projects.get("/a").unwrap().space.as_ref().unwrap().branch, "main");
        assert!(projects.get("/b").unwrap().space.is_none());
    }
}
