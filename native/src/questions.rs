//! Answering the agent's questions, after T3 Code. The questions
//! come one at a time. Picking an option of a single-choice question answers it, and the composer's
//! text, when there is any, answers it instead.

use crate::protocol::Question;
use std::collections::{BTreeMap, HashMap};

/// What the user has given so far, by question text.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct QuestionDraft {
    pub index: usize,
    pub selected: HashMap<String, Vec<String>>,
    pub custom: HashMap<String, String>,
}

/// A question's answer: the user's own text, else the picked options joined, else none yet.
pub fn answer_of(question: &Question, draft: &QuestionDraft) -> Option<String> {
    let custom = draft.custom.get(&question.question).map(|t| t.trim()).unwrap_or("");
    if !custom.is_empty() {
        return Some(custom.to_owned());
    }
    let selected = draft.selected.get(&question.question).filter(|s| !s.is_empty())?;
    Some(selected.join(", "))
}

/// Picks an option. A single-choice question keeps only it, and a multiple-choice one toggles it.
/// A picked option answers the question, so text typed for it gives way.
pub fn pick(question: &Question, draft: &mut QuestionDraft, label: &str) {
    let current = draft.selected.entry(question.question.clone()).or_default();
    if !question.multi_select {
        *current = vec![label.to_owned()];
    } else if let Some(at) = current.iter().position(|l| l == label) {
        current.remove(at);
    } else {
        current.push(label.to_owned());
    }
    draft.custom.insert(question.question.clone(), String::new());
}

pub fn is_picked(question: &Question, draft: &QuestionDraft, label: &str) -> bool {
    let typed = draft.custom.get(&question.question).is_some_and(|t| !t.trim().is_empty());
    !typed && draft.selected.get(&question.question).is_some_and(|s| s.iter().any(|l| l == label))
}

pub enum Advance {
    /// The next question shows.
    Next,
    /// Every question has its answer, by question text, which is how AskUserQuestion takes them.
    Answers(BTreeMap<String, String>),
}

/// Moves past the current question once it has an answer. After the last one it gives every answer.
pub fn advance(questions: &[Question], draft: &mut QuestionDraft) -> Option<Advance> {
    let question = questions.get(draft.index)?;
    answer_of(question, draft)?;
    if draft.index + 1 < questions.len() {
        draft.index += 1;
        return Some(Advance::Next);
    }
    questions.iter().map(|q| answer_of(q, draft).map(|a| (q.question.clone(), a))).collect::<Option<_>>().map(Advance::Answers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::QuestionOption;

    fn question(text: &str, multi_select: bool) -> Question {
        let option = |label: &str| QuestionOption { label: label.into(), description: None };
        Question { header: "H".into(), question: text.into(), options: vec![option("A"), option("B")], multi_select }
    }

    #[test]
    fn typed_text_answers_in_place_of_picks_and_a_pick_clears_it() {
        let q = question("Which?", false);
        let mut draft = QuestionDraft::default();
        pick(&q, &mut draft, "A");
        assert_eq!(answer_of(&q, &draft).as_deref(), Some("A"));
        draft.custom.insert("Which?".into(), "  my own  ".into());
        assert_eq!(answer_of(&q, &draft).as_deref(), Some("my own"));
        assert!(!is_picked(&q, &draft, "A"));
        pick(&q, &mut draft, "B");
        assert_eq!(answer_of(&q, &draft).as_deref(), Some("B"));
    }

    #[test]
    fn multiple_choice_toggles_and_joins() {
        let q = question("Which?", true);
        let mut draft = QuestionDraft::default();
        pick(&q, &mut draft, "A");
        pick(&q, &mut draft, "B");
        pick(&q, &mut draft, "A");
        pick(&q, &mut draft, "A");
        assert_eq!(answer_of(&q, &draft).as_deref(), Some("B, A"));
    }

    #[test]
    fn advances_one_question_at_a_time_then_gives_every_answer() {
        let questions = [question("One?", false), question("Two?", false)];
        let mut draft = QuestionDraft::default();
        assert!(advance(&questions, &mut draft).is_none(), "an unanswered question holds");
        pick(&questions[0], &mut draft, "A");
        assert!(matches!(advance(&questions, &mut draft), Some(Advance::Next)));
        pick(&questions[1], &mut draft, "B");
        let Some(Advance::Answers(answers)) = advance(&questions, &mut draft) else { panic!("answers") };
        assert_eq!(answers, [("One?".to_owned(), "A".to_owned()), ("Two?".to_owned(), "B".to_owned())].into());
    }
}
