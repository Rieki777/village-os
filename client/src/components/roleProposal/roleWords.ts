/**
 * A role's words on the proposal steps (role proposals PR C): which fields the
 * words step offers, in the card's order and with the card's own headings;
 * what the member has typed against what is posted; and which fields go in a
 * save. Pure, so the gold a field draws and the save the page sends come from
 * one function each.
 *
 * THE FIELDS ARE THE CARD'S. Every role word the player card shows, in its
 * order (client/src/components/playerCard/RoleInFull.tsx): purpose, this role
 * exists while, what I look after, what I can decide on my own, what you can
 * count on me for, what I do regularly, bring me, not mine to hold, holding
 * this role well (three lines) and time. The headings are `CARD_WORDS`, and
 * each carries its CCOS term (`ROLE_CCOS_TERMS`) on hover or tap where the
 * village shows the terms.
 *
 * GOLD IS AGAINST THE POSTED ROLE. A field is changed when what the member
 * has written, read the way the server reads it (`normalWord`), differs from
 * the role as posted. A new role has nothing posted, so every field it writes
 * is new.
 *
 * ONE JUDGE. A field is checked with `parseRoleWords`, the function the PUT
 * runs, so the line under a field is the sentence the server would answer:
 * the handover and CCOS parsers, and 3 to 6 things a role answers for.
 */
import { CARD_WORDS as W } from "@shared/playerCard";
import type { RoleTermKey } from "@shared/playerCardWords";
import { ROLE_WORD_FIELD, type RoleEditKey } from "@shared/playerCardEdit";
import { ROLE_CCOS_WORDS } from "@shared/roleCcos";
import { ROLE_HANDOVER_WORDS } from "@shared/roleHandover";
import { normalWord, parseRoleWords, PROPOSAL_WORDS, type WordFieldsContext, type WordValue } from "@shared/roleProposals";
import { RP_WORDS } from "./proposalWords";

export interface EditField {
  /** The `update_seat` field name the server keys the diff by. */
  field: string;
  /** The card's section for this field, for the gold in the preview. */
  key: RoleEditKey;
  label: string;
  /** The CCOS term key, or null for a heading the card shows without one. */
  term: RoleTermKey | null;
  list: boolean;
  multiline: boolean;
  hint?: string;
  /** Drawn under one heading with the others in its group. */
  group?: "holding";
}

export const EDIT_FIELDS: readonly EditField[] = [
  { field: "aim", key: "purpose", label: W.purpose, term: "purpose", list: false, multiline: true },
  { field: "existsWhile", key: "existsWhile", label: W.existsWhile, term: "existsWhile", list: false, multiline: false, hint: ROLE_CCOS_WORDS.existsWhileHint },
  { field: "domain", key: "decide", label: W.decide, term: "decide", list: false, multiline: true },
  { field: "authorities", key: "authorities", label: W.authorities, term: "authorities", list: true, multiline: true, hint: ROLE_CCOS_WORDS.authoritiesHint },
  { field: "accountabilities", key: "countOnMe", label: W.countOnMe, term: "countOnMe", list: true, multiline: true, hint: RP_WORDS.countOnMeHint },
  { field: "responsibilities", key: "responsibilities", label: W.responsibilities, term: "responsibilities", list: true, multiline: true, hint: ROLE_CCOS_WORDS.responsibilitiesHint },
  { field: "bringMe", key: "bringMe", label: W.bringMe, term: null, list: true, multiline: true, hint: ROLE_HANDOVER_WORDS.bringMeHint },
  { field: "notMine", key: "notMine", label: W.notMine, term: "notMine", list: true, multiline: true, hint: ROLE_HANDOVER_WORDS.notMineHint },
  { field: "signsStretched", key: "signsStretched", label: W.signsStretched, term: "signsStretched", list: false, multiline: true, hint: ROLE_CCOS_WORDS.signsStretchedHint, group: "holding" },
  { field: "flowsBack", key: "flowsBack", label: W.flowsBack, term: "flowsBack", list: false, multiline: true, hint: ROLE_CCOS_WORDS.flowsBackHint, group: "holding" },
  { field: "stepBack", key: "stepBack", label: W.stepBack, term: "stepBack", list: false, multiline: true, hint: ROLE_CCOS_WORDS.stepBackHint, group: "holding" },
  { field: "timeCommitment", key: "timeCommitment", label: W.timeCommitment, term: "timeCommitment", list: false, multiline: false, hint: ROLE_CCOS_WORDS.timeCommitmentHint },
];

/** The new role's name: a field of its words, and the only one a new role must have. */
export const NAME_FIELD = "name";

const LISTS = new Set(EDIT_FIELDS.filter((f) => f.list).map((f) => f.field));

/** What the client knows of the role reader's word fields: the ones it offers, and the name. */
export const CLIENT_WORDS: WordFieldsContext = { fields: [NAME_FIELD, ...EDIT_FIELDS.map((f) => f.field)], lists: LISTS };

/** A value as a text box holds it: a list one item per line. */
export function textOf(v: WordValue | undefined): string {
  if (v === null || v === undefined) return "";
  return Array.isArray(v) ? v.join("\n") : v;
}

const same = (a: WordValue, b: WordValue) => JSON.stringify(a) === JSON.stringify(b);

/** True when what is typed differs from the posted words, read as the server reads both. */
export function differs(field: string, text: string, posted: WordValue | undefined): boolean {
  const list = LISTS.has(field);
  return !same(normalWord(text, list), normalWord(posted ?? null, list));
}

/** One role as the words step holds it: the posted words, and what the member has typed over them. */
export interface RoleWordsState {
  posted: Record<string, WordValue>;
  /** The proposed words the server holds now, as text, before any typing. */
  proposed: Record<string, string>;
  /** What the member has typed since, by field. */
  typed: Record<string, string>;
}

/** The text a field shows now. */
export const shownText = (s: RoleWordsState, field: string): string => s.typed[field] ?? s.proposed[field] ?? "";

/** A role's state from the payload's word fields. */
export function stateFrom(fields: ReadonlyArray<{ field: string; posted: WordValue; proposed: WordValue }>, typed: Record<string, string> = {}): RoleWordsState {
  const posted: Record<string, WordValue> = {};
  const proposed: Record<string, string> = {};
  for (const f of fields) {
    posted[f.field] = f.posted;
    proposed[f.field] = textOf(f.proposed);
  }
  return { posted, proposed, typed };
}

/**
 * The words a save sends for an existing role: every offered field whose text
 * differs from the posted role. The server keeps only those, and a group sent
 * replaces the stored one, so a field typed back to its posted words is a
 * change undone.
 */
export function wordsToSave(s: RoleWordsState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of EDIT_FIELDS) {
    const text = shownText(s, f.field);
    if (differs(f.field, text, s.posted[f.field])) out[f.field] = text;
  }
  return out;
}

/** The words a save sends for a new role: its name and every field written. */
export function newWordsToSave(s: RoleWordsState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of [NAME_FIELD, ...EDIT_FIELDS.map((f) => f.field)]) {
    const text = shownText(s, field);
    if (text.trim()) out[field] = text;
  }
  return out;
}

/** The sentence the server would refuse this field with, or null. */
export function fieldProblem(field: string, text: string, posted: WordValue | undefined, isNew: boolean): string | null {
  if (!isNew && !differs(field, text, posted)) return null;
  const r = parseRoleWords({ [field]: text }, "w", CLIENT_WORDS, isNew ? null : { [field]: posted ?? null });
  return r.ok ? null : r.error;
}

/** Every field's problem for one role, by field. Empty when the role's words can be saved. */
export function roleProblems(s: RoleWordsState, isNew: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const fields = isNew ? [NAME_FIELD, ...EDIT_FIELDS.map((f) => f.field)] : EDIT_FIELDS.map((f) => f.field);
  for (const field of fields) {
    const problem = fieldProblem(field, shownText(s, field), s.posted[field], isNew);
    if (problem) out[field] = problem;
  }
  if (isNew && !shownText(s, NAME_FIELD).trim()) out[NAME_FIELD] = PROPOSAL_WORDS.newRoleName;
  return out;
}

/** The card section a field draws in. */
const KEY_OF: Record<string, RoleEditKey> = Object.fromEntries(
  (Object.entries(ROLE_WORD_FIELD) as Array<[RoleEditKey, string]>).map(([key, field]) => [field, key]),
);

export interface ChangedRole {
  keys: RoleEditKey[];
  isNew: boolean;
}

/**
 * The card sections to draw in gold, by role id: for an existing role the
 * fields the payload says changed, for a new role every field it writes.
 */
export function changedSections(p: {
  roles: ReadonlyArray<{ roleId: string; fields: ReadonlyArray<{ field: string; changed: boolean }> }>;
  newRoles: ReadonlyArray<{ id: string; fields: ReadonlyArray<{ field: string; changed: boolean }> }>;
}): Record<string, ChangedRole> {
  const keysOf = (fields: ReadonlyArray<{ field: string; changed: boolean }>) =>
    fields.filter((f) => f.changed && KEY_OF[f.field]).map((f) => KEY_OF[f.field]);
  const out: Record<string, ChangedRole> = {};
  for (const r of p.roles) {
    const keys = keysOf(r.fields);
    if (keys.length) out[r.roleId] = { keys, isNew: false };
  }
  for (const r of p.newRoles) out[r.id] = { keys: keysOf(r.fields), isNew: true };
  return out;
}
