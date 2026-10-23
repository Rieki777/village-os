/**
 * WHO OWNS EACH WORD ON THE PLAYER CARD, and so where an edit goes.
 *
 * The owner's "Edit my card" mode puts an edit control beside every text block
 * on their own card. What happens on save depends on who the words belong to
 * (Rye, 2026-10-22):
 *
 *   PERSONAL  the person's own words. They save straight to the person's own
 *             record: the season aim through `PUT /api/season-plans/mine`; the
 *             goals served with how each helps, the seasonal goals and the
 *             card words through `PUT /api/season-plans/mine/card`; and this
 *             moon's load through `PUT /api/season-plans/mine/load` (#530).
 *   ROLE      the role's words. They change by consent, so an edit opens a
 *             proposed change to the role: a one-change org draft
 *             (`update_seat`), decided the way every org draft is. The card
 *             says "Proposed, waiting for consent" until it is adopted.
 *             "Bring me", "Not mine to hold" and the runbook live on the role
 *             since #534 and pass the one parser (shared/roleHandoverParse.ts)
 *             before they are proposed.
 *   TERMS     agreements are never edited on the card. They change through a
 *             new role application.
 *
 * Pure. The client reads this table and decides nothing else about owners.
 */
import { parseRoleWordList, parseRunbook } from "./roleHandoverParse";

export const PERSONAL_EDIT_KEYS = [
  "aim",
  "servesGoal",
  "seasonalGoals",
  "howItHelps",
  "howIHold",
  "growingEdge",
  "whoCouldHoldNext",
  "loadRead",
] as const;
export type PersonalEditKey = (typeof PERSONAL_EDIT_KEYS)[number];

export const ROLE_EDIT_KEYS = ["purpose", "decide", "countOnMe", "bringMe", "notMine", "runbook"] as const;
export type RoleEditKey = (typeof ROLE_EDIT_KEYS)[number];

/** The `update_seat` payload key each role word is proposed into. */
export const ROLE_WORD_FIELD: Record<RoleEditKey, "aim" | "domain" | "accountabilities" | "bringMe" | "notMine" | "runbook"> = {
  purpose: "aim",
  decide: "domain",
  countOnMe: "accountabilities",
  bringMe: "bringMe",
  notMine: "notMine",
  runbook: "runbook",
};

export function isRoleEditKey(v: unknown): v is RoleEditKey {
  return typeof v === "string" && (ROLE_EDIT_KEYS as readonly string[]).includes(v);
}

export const EDIT_WORDS = {
  editMyCard: "Edit my card",
  doneEditing: "Done editing",
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
  saved: "Saved",
  proposeChange: "Propose this change",
  proposed: "Proposed, waiting for consent",
  roleWordsNote: "These words belong to the role, so a change goes to the circle for consent.",
  termsNote: "Terms change through a new role application.",
  newApplication: "Start a new application",
  noSeason: "There is no season to plan yet, so this part of the card cannot be saved. Planning opens one moon before the next season starts.",
  failed: "That did not save. Try again.",
  onePerLine: "One per line",
  sent: "Sent as a proposal for consent.",
  seasonalGoalsHint: "One goal per line. Add when it is done after a colon.",
  servesGoalsHint: "One of this season's goals per line, as the village wrote it.",
  loadSaved: "Saved for this moon",
} as const;

/** One proposed edit to a role's words, as the card's route accepts it. */
export interface RoleWordProposal {
  key: RoleEditKey;
  /** Text for purpose, decide and the runbook; one item per line for countOnMe, bringMe and notMine. */
  text: string;
}

/** The longest text the card accepts for a role word, matching the org draft path's own room. */
export const ROLE_WORD_MAX = 1000;

/** A proposal's update_seat payload, or the reason it cannot be one. Pure. */
export function roleWordPayload(p: unknown): { ok: true; payload: Record<string, unknown>; key: RoleEditKey } | { ok: false; error: string } {
  const b = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  if (!isRoleEditKey(b.key)) return { ok: false, error: "Pick one of the role's words to change." };
  const field = ROLE_WORD_FIELD[b.key];
  if (typeof b.text !== "string") return { ok: false, error: "The change needs to be words." };
  // The handover words pass the one parser, so the card refuses with the same
  // sentence the draft preview and the publish would. Blank clears them.
  if (field === "bringMe" || field === "notMine") {
    const r = parseRoleWordList(b.text, field);
    if (!r.ok) return { ok: false, error: r.problem };
    return { ok: true, payload: { [field]: r.value }, key: b.key };
  }
  if (field === "runbook") {
    const r = parseRunbook(b.text);
    if (!r.ok) return { ok: false, error: r.problem };
    return { ok: true, payload: { runbook: r.value }, key: b.key };
  }
  const text = b.text.trim();
  if (text.length > ROLE_WORD_MAX) return { ok: false, error: `Keep it to ${ROLE_WORD_MAX} characters.` };
  if (field === "accountabilities") {
    const items = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) return { ok: false, error: "Write at least one thing people can count on the role for." };
    if (items.length > 20) return { ok: false, error: "Up to 20 lines." };
    return { ok: true, payload: { accountabilities: items }, key: b.key };
  }
  if (!text) return { ok: false, error: "Write the words first." };
  return { ok: true, payload: { [field]: text }, key: b.key };
}

/** Which role words an open draft's update_seat payload would change. Pure. */
export function roleWordsIn(payload: unknown): RoleEditKey[] {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  return ROLE_EDIT_KEYS.filter((k) => p[ROLE_WORD_FIELD[k]] !== undefined);
}
