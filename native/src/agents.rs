//! How each agent Comet runs looks and reads: its mark, its colour, and the words for where it stands.

use crate::icons;
use crate::protocol::{AgentAccount, AgentInfo, AgentState, ClientMessage};
use crate::shell::Comet;
use crate::theme;
use rune::{Color, El, Icon, icon};
use rune_kit::{ButtonVariant, Kit};
use rune_theme_opencode::{icons as ic, provider_icons};

impl Comet {
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

/// An agent's mark from the OpenCode catalog, or Comet's own where the catalog has none.
fn glyph(agent: &str) -> &'static Icon {
    match agent {
        "claude" => &icons::CLAUDE,
        "codex" => provider_icons::named("openai").unwrap_or(&ic::PROVIDERS),
        "antigravity" => &icons::ANTIGRAVITY,
        _ => &ic::PROVIDERS,
    }
}

/// The colour an agent's mark draws in. Codex's mark is black or white, as OpenAI draws it. Antigravity's
/// mark carries its own colours, so this one does not reach it.
fn tint(agent: &str, k: &Kit) -> Color {
    match agent {
        "claude" => theme::claude(),
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
        AgentState::Ready | AgentState::Updating => agent.account.as_ref().map_or_else(|| "Ready".to_owned(), account_line),
        AgentState::Installing | AgentState::SigningIn | AgentState::Missing | AgentState::SignedOut => state_sentence(agent),
    }
}

/// What to do about an agent that is not ready, or what Comet is doing to get it ready, in a sentence.
pub fn setup_hint(agent: &AgentInfo) -> Option<String> {
    match agent.state {
        AgentState::Installing => Some("Downloading and installing. This takes a minute or two.".to_owned()),
        AgentState::SigningIn if agent.sign_in_link.is_some() => Some("Finish signing in in your browser. If you closed the page, open it again.".to_owned()),
        AgentState::SigningIn => Some("Opening the sign-in page in your browser…".to_owned()),
        _ => agent.problem.clone(),
    }
}

/// The buttons that get an agent ready: its install or its sign-in, and a way to stop either while it
/// runs. Empty when Comet can do nothing, or nothing is needed. `install` names the install button.
pub fn setup_actions(agent: &AgentInfo, install: String, k: &Kit) -> Vec<El> {
    let can = |feature: &str| agent.features.iter().any(|f| f == feature);
    let send = |message: fn(String) -> ClientMessage| {
        let id = agent.id.clone();
        move |s: &mut Comet| s.core.send(&message(id.clone()))
    };
    let button = |words: String| theme::small_button(words);
    match agent.state {
        AgentState::Missing if can("install") => vec![button(install).variant(ButtonVariant::Contrast).on_press(send(|agent| ClientMessage::AgentInstall { agent })).build(k)],
        AgentState::SignedOut if can("sign-in") => vec![button("Sign in".into()).variant(ButtonVariant::Contrast).on_press(send(|agent| ClientMessage::AgentSignIn { agent })).build(k)],
        AgentState::Installing => vec![button("Cancel".into()).variant(ButtonVariant::Outline).on_press(send(|agent| ClientMessage::AgentCancel { agent })).build(k)],
        AgentState::SigningIn => {
            let reopen = agent.sign_in_link.clone().map(|link| {
                button("Open the page".into())
                    .variant(ButtonVariant::Contrast)
                    .on_press_tx(move |s: &mut Comet, tx| {
                        if let Err(error) = tx.open_url(&link) {
                            s.toasts.error("Comet could not open the sign-in page".into(), Some(error.to_string()));
                        }
                    })
                    .build(k)
            });
            reopen.into_iter().chain([button("Cancel".into()).variant(ButtonVariant::Outline).on_press(send(|agent| ClientMessage::AgentCancel { agent })).build(k)]).collect()
        }
        _ => Vec::new(),
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
        let mut agent = AgentInfo { id: "codex".into(), name: "Codex".into(), state: AgentState::SignedOut, problem: Some("Run `codex login` in a terminal to sign in.".into()), version: None, account: None, models: vec![], features: vec![], usage: None, sign_in_link: None };
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
