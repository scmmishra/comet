//! How each agent Desk runs looks and reads: its mark, its colour, and the words for where it stands.

use crate::icons;
use crate::protocol::{AgentAccount, AgentInfo, AgentState};
use crate::shell::Desk;
use crate::theme;
use rune::{Color, El, Icon, icon};
use rune_kit::Kit;
use rune_theme_opencode::{icons as ic, provider_icons};

impl Desk {
    /// An agent's name, such as "Claude Code".
    pub fn agent_name<'a>(&'a self, agent: &'a str) -> &'a str {
        self.account.agent(agent).map_or_else(|| fallback_name(agent), |a| a.name.as_str())
    }

    /// The agent a tab runs, by the tab's id.
    pub fn tab_agent(&self, tab: &str) -> &str {
        self.workspace.tabs.iter().find(|t| t.id == tab).map_or(crate::account::DEFAULT_AGENT, |t| t.agent.as_str())
    }

    /// Whether the agent a tab runs can do something beyond a conversation, such as "rewind".
    pub fn tab_can(&self, tab: &str, feature: &str) -> bool {
        self.account.can(self.tab_agent(tab), feature)
    }
}

/// An agent's mark from the OpenCode catalog, or Desk's own where the catalog has none.
fn glyph(agent: &str) -> &'static Icon {
    match agent {
        "claude" => &icons::CLAUDE,
        "codex" => provider_icons::named("openai").unwrap_or(&ic::PROVIDERS),
        "antigravity" => &icons::ANTIGRAVITY,
        _ => &ic::PROVIDERS,
    }
}

/// The colour an agent's mark draws in. Codex's mark is black or white, as OpenAI draws it.
fn tint(agent: &str, k: &Kit) -> Color {
    match agent {
        "claude" => theme::claude(),
        "antigravity" => theme::antigravity(),
        _ => k.c.text_base,
    }
}

/// An agent's mark at `size`, in its colour.
pub fn mark(agent: &str, size: f32, k: &Kit) -> El {
    icon(glyph(agent), size).color(tint(agent, k))
}

/// An agent's name before the core has sent it.
pub fn fallback_name(agent: &str) -> &str {
    match agent {
        "claude" => "Claude Code",
        "codex" => "Codex",
        "antigravity" => "Antigravity",
        other => other,
    }
}

/// Where an agent stands, in a word or two, for its badge.
pub fn state_label(state: AgentState) -> &'static str {
    match state {
        AgentState::Checking => "Checking…",
        AgentState::Ready => "Connected",
        AgentState::Missing => "Not installed",
        AgentState::SignedOut => "Not signed in",
        AgentState::Installing => "Installing…",
        AgentState::SigningIn => "Signing in…",
        AgentState::Updating => "Updating…",
    }
}

/// Where an agent stands, as a sentence that names it, for the picker's empty state.
pub fn state_sentence(agent: &AgentInfo) -> String {
    let name = &agent.name;
    match agent.state {
        AgentState::Checking => format!("Checking {name}…"),
        AgentState::Ready => format!("{name} is ready"),
        AgentState::Missing => format!("{name} is not installed"),
        AgentState::SignedOut => format!("{name} is not signed in"),
        AgentState::Installing => format!("Installing {name}…"),
        AgentState::SigningIn => format!("Signing in to {name}…"),
        AgentState::Updating => format!("Updating {name}…"),
    }
}

/// Who an agent is signed in as, in one line: the account, its organization and its plan.
pub fn account_line(account: &AgentAccount) -> String {
    let who = match (&account.email, &account.method) {
        (Some(email), _) => format!("Signed in as {email}"),
        (None, Some(method)) => format!("Signed in with {method}"),
        (None, None) => "Signed in".to_owned(),
    };
    let plan = account.plan.as_deref().map(|p| format!("{} plan", capitalized(p)));
    [Some(who), account.organization.clone(), plan].into_iter().flatten().collect::<Vec<_>>().join(" · ")
}

/// What to say under an agent's name: who is signed in, else what stands in the way.
pub fn status_line(agent: &AgentInfo) -> String {
    match agent.state {
        AgentState::Checking => "Checking the install and the account…".to_owned(),
        AgentState::Installing => "Downloading and installing. This takes a minute or two.".to_owned(),
        AgentState::SigningIn => "Finish signing in in your browser.".to_owned(),
        AgentState::Ready | AgentState::Updating => agent.account.as_ref().map_or_else(|| "Ready".to_owned(), account_line),
        AgentState::Missing | AgentState::SignedOut => state_sentence(agent),
    }
}

/// A plan's name as a word: "max" reads "Max".
pub fn capitalized(word: &str) -> String {
    let mut letters = word.chars();
    letters.next().map_or_else(String::new, |first| first.to_uppercase().chain(letters).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(email: Option<&str>, organization: Option<&str>, plan: Option<&str>, method: Option<&str>) -> AgentAccount {
        AgentAccount { email: email.map(Into::into), organization: organization.map(Into::into), plan: plan.map(Into::into), method: method.map(Into::into) }
    }

    #[test]
    fn says_who_is_signed_in_with_the_plan_or_the_method() {
        assert_eq!(account_line(&account(Some("me@example.com"), Some("Example"), Some("max"), None)), "Signed in as me@example.com · Example · Max plan");
        assert_eq!(account_line(&account(None, None, None, Some("an API key"))), "Signed in with an API key");
    }

    #[test]
    fn an_agent_that_is_not_ready_says_what_to_do() {
        let mut agent = AgentInfo { id: "codex".into(), name: "Codex".into(), state: AgentState::SignedOut, problem: Some("Sign in to use your ChatGPT plan.".into()), version: None, account: None, models: vec![], features: vec![], usage: None };
        assert_eq!(status_line(&agent), "Codex is not signed in");
        assert_eq!(state_sentence(&agent), "Codex is not signed in");
        agent.state = AgentState::Ready;
        assert_eq!(status_line(&agent), "Ready");
    }

    #[test]
    fn every_agent_has_a_mark_and_a_name() {
        for agent in ["claude", "codex", "antigravity"] {
            assert_ne!(glyph(agent).name, ic::PROVIDERS.name, "{agent} has its own mark");
            assert_ne!(fallback_name(agent), agent);
        }
    }
}
