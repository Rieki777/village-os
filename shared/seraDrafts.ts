/**
 * "ASK SERA FOR A FIRST DRAFT" on a proposal (joining lane PR 5, 10 Nov 2026).
 *
 * A candidate who is signed in may press a button and ask the guide they chose
 * (Sera, or the village's own) for a first draft of three things:
 *
 *   aim     their aim for the season
 *   goals   three goals for their first moon, each with a "done when" and the
 *           role goal it moves, picked only from the role's own goals
 *   story   the "my story with us" line, from their own words only
 *
 * THE RULES THIS FILE HOLDS
 *
 *   - It is an explicit press, never automatic.
 *   - What goes out is `draftBody`: the roles asked for (and the candidate's
 *     note on each), "Why you" and the aim, and nothing else. The server
 *     passes even that through `forAssistants` (shared/proposalAbout.ts), the
 *     one allow-list of proposal fields a model may be handed. References,
 *     consent, links, files, name and email are not named there, so cannot go.
 *   - Every draft is marked "Draft from Sera" until the candidate edits it or
 *     presses "Keep this". A proposal is not sent while one is unconfirmed.
 *   - Nothing records which parts were drafted once they are kept: a goal's
 *     `seraDraft` flag and a text's marker live in the page only, and the
 *     intake reads neither. The deciders cannot tell, so nothing is judged by it.
 *   - The model never selects, ranks, scores or summarises a candidate. It
 *     writes for the candidate, in their voice, from their words.
 *
 * Pure: no clock, no pool, no browser.
 */
import type { ProposalGoal } from "./proposalGoals";

export type DraftKind = "aim" | "goals" | "story";
export const DRAFT_KINDS: readonly DraftKind[] = ["aim", "goals", "story"];

/** How many goals one draft offers. */
export const DRAFT_GOALS = 3;

/** One role the candidate asked for, with their own note on it. */
export interface DraftRoleIn {
  roleId: string;
  note?: string;
}

/** What the page sends, whole. The server reads these keys and no others. */
export interface DraftRequest {
  kind: DraftKind;
  roles: DraftRoleIn[];
  why: string;
  aim: string;
}

/** The request body for a press: the candidate's own words about the work, and the roles. Nothing else is ever added. */
export function draftBody(kind: DraftKind, input: { roles: readonly DraftRoleIn[]; why: string; aim: string }): DraftRequest {
  return {
    kind,
    roles: input.roles.slice(0, 5).map((r) => ({ roleId: r.roleId, ...(r.note?.trim() ? { note: r.note.trim().slice(0, 600) } : {}) })),
    why: input.why.trim().slice(0, 1200),
    aim: input.aim.trim().slice(0, 300),
  };
}

/** One goal as the guide drafts it. `moves` is one of the role's own goals, or empty. */
export interface DraftedGoal {
  title: string;
  doneWhen: string;
  moves: string;
  roleId: string;
}

/** What the door answers. Only the part that was asked for is filled. */
export interface DraftReply {
  guide: { id: string; name: string };
  note: string | null;
  kind: DraftKind;
  aim?: string;
  goals?: DraftedGoal[];
  story?: string;
}

/** The marks on the text drafts: the words Sera wrote. A draft is on show while the field still holds exactly them. */
export interface DraftMarks {
  aim?: string;
  story?: string;
}

/** A goal as the list holds it while it is a draft. The flag is never sent and never stored. */
export type DraftableGoal = ProposalGoal & { seraDraft?: boolean };

/** Whether a field still holds exactly the words Sera drafted. Editing them, even by one letter, ends the draft. */
export function isTextDraft(value: string, marked: string | undefined): boolean {
  return !!marked && value.trim() === marked.trim();
}

/**
 * The marks that still mean something. A mark whose field has been edited is dropped, and with no marks left the
 * object is gone, so a proposal being written keeps no sign that Sera drafted anything once it is edited or kept.
 */
export function settleMarks(marks: DraftMarks | undefined, now: { aim: string; story: string }): DraftMarks | undefined {
  const kept: DraftMarks = {
    ...(isTextDraft(now.aim, marks?.aim) ? { aim: marks!.aim } : {}),
    ...(isTextDraft(now.story, marks?.story) ? { story: marks!.story } : {}),
  };
  return kept.aim || kept.story ? kept : undefined;
}

/** Which parts are still unconfirmed Sera drafts. Empty means the proposal may be sent. */
export function unconfirmedDrafts(input: { aim: string; story: string; marks: DraftMarks; goals: readonly DraftableGoal[] }): DraftKind[] {
  const out: DraftKind[] = [];
  if (isTextDraft(input.aim, input.marks.aim)) out.push("aim");
  if (input.goals.some((g) => g.seraDraft === true)) out.push("goals");
  if (isTextDraft(input.story, input.marks.story)) out.push("story");
  return out;
}

/** Drafted goals placed in the list: wholly blank rows make room, the person's own goals stay, and the list never passes the cap. */
export function placeDraftGoals(existing: readonly DraftableGoal[], drafted: readonly DraftableGoal[], cap: number): DraftableGoal[] {
  const own = existing.filter((g) => g.title.trim() || g.doneWhen.trim() || g.moves || g.serves || g.date);
  return [...own, ...drafted].slice(0, cap);
}

/** Goals as they are sent: the draft flag is left behind, so nothing says where a goal began. */
export function withoutDraftFlag<T extends DraftableGoal>(goals: readonly T[]): Omit<T, "seraDraft">[] {
  return goals.map(({ seraDraft: _flag, ...rest }) => rest);
}

/** Drafted goals as list rows, each flagged a draft. */
export function goalsFromDraft(drafted: readonly DraftedGoal[]): DraftableGoal[] {
  return drafted.map((g) => ({ title: g.title, doneWhen: g.doneWhen, moves: g.moves, serves: "", date: "", roleId: g.roleId, seraDraft: true }));
}

export const DRAFT_WORDS = {
  button: "Get help drafting from Sera, our regeneratively trained digital assistant",
  buttonFor: (name: string) => `Get help drafting from ${name}, our regeneratively trained digital assistant`,
  kinds: { aim: "a draft of your aim", goals: "three draft goals for your first moon", story: "a draft of your story line" } as Record<DraftKind, string>,
  sends: (name: string) =>
    `Pressing the button sends ${name} the roles you picked, your "Why you" and your aim. Nothing else goes: not your references, links, files, name or email. Nothing is sent until you press it.`,
  working: (name: string) => `${name} is writing a first draft. You can keep going while you wait.`,
  mark: "Draft from Sera",
  markNamed: (name: string) => `Draft from ${name}`,
  keep: "Keep this",
  markHint: "Edit it or keep it. We cannot send your proposal until you have done one or the other.",
  unavailable: "Sera cannot answer right now. Your form works without it, and you can write this part yourself.",
  slow: "That is taking longer than it should. Your form works without it, and you can write this part yourself.",
  nothingToDraft: "There is not enough of your own writing to draft from yet. Add a few lines to \"Why you\" and try again.",
  signedOut: "Sign in to ask Sera for a first draft.",
  /** The sentence that stops a send. */
  blocked: (what: DraftKind[]) => {
    const names = what.map((k) => ({ aim: "your aim", goals: "your goals", story: "your story line" })[k]);
    const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${names.length === 1 ? "is" : "are"} still a draft from Sera. Edit ${names.length === 1 ? "it" : "them"} or press "Keep this", then send.`;
  },
} as const;
