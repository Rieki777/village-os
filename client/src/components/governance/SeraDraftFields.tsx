/**
 * "Ask Sera for a first draft" on the member door's fields: the aim, the goals
 * and the story line. Each is the shared button (proposalDrafts/AskSera.tsx)
 * with the member door's answers behind it; the wizard keeps the marks
 * (seraDraftAnswers.ts).
 */
import { AskSera, DraftMark } from "@/components/proposalDrafts/AskSera";
import { GOAL_LIMITS } from "@shared/proposalGoals";
import { goalsFromDraft, isTextDraft, placeDraftGoals, type DraftReply, type DraftableGoal } from "@shared/seraDrafts";
import type { GoalRole } from "./GoalsList";
import { draftRolesOf, marksOf } from "./seraDraftAnswers";

/** Under the aim field. Offered while the field is empty or still holds the draft, so a draft never replaces the member's own words. */
export function AimAssist({
  value,
  answers,
  onChange,
  setAnswer,
}: {
  value: string;
  answers: Record<string, unknown>;
  onChange: (next: string) => void;
  setAnswer?: (key: string, value: unknown) => void;
}) {
  const roles = draftRolesOf(answers);
  if (!setAnswer || roles.length === 0) return null;
  const marks = marksOf(answers);
  const draft = isTextDraft(value, marks.aim);
  const take = (r: DraftReply) => {
    if (!r.aim) return;
    onChange(r.aim);
    setAnswer("seraDrafts", { ...marks, aim: r.aim });
  };
  return (
    <div className="mt-2 grid gap-2">
      {(!value.trim() || draft) && <AskSera kind="aim" roles={roles} why={String(answers.fitStatement ?? "")} aim={value} onDraft={take} />}
      {draft && <DraftMark onKeep={() => setAnswer("seraDrafts", { ...marks, aim: undefined })} />}
    </div>
  );
}

/** Under the story line. Same rule as the aim. */
export function StoryAssist({
  story,
  answers,
  onStory,
  setAnswer,
}: {
  story: string;
  answers: Record<string, unknown>;
  onStory: (next: string) => void;
  setAnswer?: (key: string, value: unknown) => void;
}) {
  const roles = draftRolesOf(answers);
  if (!setAnswer || roles.length === 0) return null;
  const marks = marksOf(answers);
  const draft = isTextDraft(story, marks.story);
  const take = (r: DraftReply) => {
    if (!r.story) return;
    onStory(r.story);
    setAnswer("seraDrafts", { ...marks, story: r.story });
  };
  return (
    <>
      {(!story.trim() || draft) && <AskSera kind="story" roles={roles} why={String(answers.fitStatement ?? "")} aim={String(answers.aim ?? "")} onDraft={take} />}
      {draft && <DraftMark onKeep={() => setAnswer("seraDrafts", { ...marks, story: undefined })} />}
    </>
  );
}

/** Above the goals list. Drafted goals are added to the list; the member's own goals stay. */
export function GoalsAssist({
  goals,
  answers,
  roles,
  onChange,
}: {
  goals: DraftableGoal[];
  answers: Record<string, unknown>;
  roles: readonly GoalRole[];
  onChange: (next: DraftableGoal[]) => void;
}) {
  const asked = draftRolesOf(answers);
  if (asked.length === 0) return null;
  const first = asked[0]!.roleId;
  return (
    <AskSera
      kind="goals"
      roles={asked}
      why={String(answers.fitStatement ?? "")}
      aim={String(answers.aim ?? "")}
      onDraft={(r) => onChange(placeDraftGoals(goals, goalsFromDraft((r.goals ?? []).map((g) => ({ ...g, roleId: g.roleId || first }))), GOAL_LIMITS.max * Math.max(1, roles.length)))}
    />
  );
}
