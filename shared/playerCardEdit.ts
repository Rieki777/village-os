/**
 * WHO OWNS EACH WORD ON THE PLAYER CARD, and so where an edit goes.
 *
 * The owner's "Edit my card" mode puts an edit control beside every text block
 * on their own card. What happens on save depends on who the words belong to
 * (Rye, 2026-10-22):
 *
 *   PERSONAL  the person's own words. They save straight to the person's own
 *             record. Today only the season aim and the village goal it serves
 *             have a home (`season_plans.aim` and `serves_goal`, written
 *             through the existing `PUT /api/season-plans/mine`). The rest
 *             have their edit control and this contract, and their storage
 *             arrives with the season plan migration (PR 6).
 *   ROLE      the role's words. They change by consent, so an edit opens a
 *             proposed change to the role: a one-change org draft
 *             (`update_seat`), decided the way every org draft is. The card
 *             says "Proposed, waiting for consent" until it is adopted. Only
 *             the fields `org_roles` stores can be proposed today; "Bring me"
 *             and "Not mine to hold" have no column yet.
 *   TERMS     agreements are never edited on the card. They change through a
 *             new role application.
 *
 * Pure. The client reads this table and decides nothing else about owners.
 */

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

export const ROLE_EDIT_KEYS = ["purpose", "decide", "countOnMe", "bringMe", "notMine"] as const;
export type RoleEditKey = (typeof ROLE_EDIT_KEYS)[number];

/** Personal words with a home today. Everything else waits for PR 6's storage. */
export const PERSONAL_STORED_NOW: readonly PersonalEditKey[] = ["aim", "servesGoal"];

/** The `org_roles` field each role word is proposed into, or null where no column exists yet. */
export const ROLE_WORD_FIELD: Record<RoleEditKey, "aim" | "domain" | "accountabilities" | null> = {
  purpose: "aim",
  decide: "domain",
  countOnMe: "accountabilities",
  bringMe: null,
  notMine: null,
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
  notStoredYet: "This part of the card can't be saved yet. It is stored from the next season plan update.",
  noColumnYet: "This part of a role can't be proposed yet. The role card gains it in a later update.",
  failed: "That did not save. Try again.",
  onePerLine: "One per line",
  seeProposal: "See it in review",
} as const;

/** One proposed edit to a role's words, as the card's route accepts it. */
export interface RoleWordProposal {
  key: RoleEditKey;
  /** Text for purpose and decide; one item per line for countOnMe. */
  text: string;
}

/** The longest text the card accepts for a role word, matching the org draft path's own room. */
export const ROLE_WORD_MAX = 1000;

/** A proposal's update_seat payload, or the reason it cannot be one. Pure. */
export function roleWordPayload(p: unknown): { ok: true; payload: Record<string, unknown>; key: RoleEditKey } | { ok: false; error: string } {
  const b = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  if (!isRoleEditKey(b.key)) return { ok: false, error: "Pick one of the role's words to change." };
  const field = ROLE_WORD_FIELD[b.key];
  if (!field) return { ok: false, error: EDIT_WORDS.noColumnYet };
  if (typeof b.text !== "string") return { ok: false, error: "The change needs to be words." };
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
  return ROLE_EDIT_KEYS.filter((k) => {
    const field = ROLE_WORD_FIELD[k];
    return field !== null && p[field] !== undefined;
  });
}
