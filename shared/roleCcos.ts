/**
 * A ROLE'S CCOS WORDS: the sections of the CCOS Role Card Template that a
 * role card carries in plain words (Rye, 2026-10-22).
 *
 *   existsWhile       "This role exists while ..."      CCOS Purpose, its condition
 *   authorities       "What I can decide on my own"     CCOS Authorities
 *   responsibilities  "What I do regularly"             CCOS Responsibilities / Actions
 *   signsStretched    "Signs I'm stretched"             CCOS ARC Awareness
 *   flowsBack         "What flows back"                 CCOS ARC Reciprocity
 *   stepBack          "How I can step back"             CCOS ARC Choice
 *   timeCommitment    the time chip                     CCOS Time Commitment
 *
 * They live on the ROLE (`org_roles`, migration 0274) and change only by
 * consent, through an org-chart draft (`update_seat` or `create_seat`), the
 * same way aim, domain and the handover words of 0268 do. The domain stays
 * what it was: the card labels it "What I look after", and the authorities
 * are a separate list.
 *
 * The CCOS limits live here too, so every door reads one number:
 *   - a role answers for 3 to 6 things (its accountabilities);
 *   - at most 8 authorities and 8 responsibilities;
 *   - "How we'll know it's working" names 2 to 4 measures. Those live in the
 *     role's terms (`scoreboard.measures`), so `shared/seatSettings.ts`
 *     applies that one where it parses them.
 * A limit binds a NEW WRITE only. A role written before these limits keeps
 * loading exactly as it is, and an empty list is "not written yet", never
 * refused: the minimum applies once a list is written, the rule the circle
 * charter keeps (shared/circleCharter.ts `CHARTER_LIST_LIMITS`).
 *
 * The parser lives in `shared/roleCcosParse.ts`, apart from this file, for
 * the reason `shared/roleHandover.ts` gives: it reads the payment-detail rule
 * from the terms model, and `server/lib/orgChart.ts` reads the stored columns
 * through this file, which modules that move value import.
 *
 * Pure: no pool, no clock, no Node builtins, no imports.
 */

/** The draft payload keys, in the order the card reads them. */
export const ROLE_CCOS_FIELDS = [
  "existsWhile",
  "authorities",
  "responsibilities",
  "signsStretched",
  "flowsBack",
  "stepBack",
  "timeCommitment",
] as const;
export type RoleCcosField = (typeof ROLE_CCOS_FIELDS)[number];

/** The two list fields. The rest are one piece of text each. */
export const ROLE_CCOS_LIST_FIELDS = ["authorities", "responsibilities"] as const;
export type RoleCcosListField = (typeof ROLE_CCOS_LIST_FIELDS)[number];
export type RoleCcosTextField = Exclude<RoleCcosField, RoleCcosListField>;

export const isRoleCcosListField = (f: RoleCcosField): f is RoleCcosListField =>
  (ROLE_CCOS_LIST_FIELDS as readonly string[]).includes(f);

/** The `org_roles` column each draft payload key writes. */
export const ROLE_CCOS_COLUMNS: Record<RoleCcosField, string> = {
  existsWhile: "exists_while",
  authorities: "authorities",
  responsibilities: "responsibilities",
  signsStretched: "signs_stretched",
  flowsBack: "flows_back",
  stepBack: "step_back",
  timeCommitment: "time_commitment",
};

/** The vendor spellings a proposal may use, the column names. */
export const ROLE_CCOS_ALIASES: Readonly<Record<string, readonly string[]>> = {
  existsWhile: ["exists_while"],
  signsStretched: ["signs_stretched"],
  flowsBack: ["flows_back"],
  stepBack: ["step_back"],
  timeCommitment: ["time_commitment"],
};

/** The most items "What I can decide on my own" or "What I do regularly" may hold. */
export const CCOS_LIST_MAX_ITEMS = 8;
/** The most characters one item may hold. */
export const CCOS_LIST_ITEM_MAX = 200;

/** The most characters each text field may hold. */
export const ROLE_CCOS_TEXT_MAX: Record<RoleCcosTextField, number> = {
  existsWhile: 300,
  signsStretched: 300,
  flowsBack: 300,
  stepBack: 300,
  timeCommitment: 80,
};

/** CCOS: a role answers for 3 to 6 things, once any is written. */
export const ACCOUNTABILITIES_MIN = 3;
export const ACCOUNTABILITIES_MAX = 6;

/** The words every door says, so the editor's red line and the server's refusal are one sentence. */
export const ROLE_CCOS_WORDS = {
  // What a steward or the owner edits, in the role's own voice.
  existsWhile: "This role exists while",
  authorities: "What I can decide on my own",
  responsibilities: "What I do regularly",
  signsStretched: "Signs I'm stretched",
  flowsBack: "What flows back",
  stepBack: "How I can step back",
  timeCommitment: "Time",
  existsWhileHint: "Finish the sentence: the condition this role serves, and when it should change or fold.",
  authoritiesHint: "Decisions the role makes without asking anyone. One per line.",
  responsibilitiesHint: "What the role does each week or each moon. One per line.",
  signsStretchedHint: "Early signs the work has grown too much for whoever holds it.",
  flowsBackHint: "The support and feedback that come back to whoever holds it.",
  stepBackHint: "How whoever holds it can slow down or hand work on.",
  timeCommitmentHint: "A few words, like Part of a full-time season.",
  // Refusals.
  notWords: "This needs to be words.",
  tooMany: `Up to ${CCOS_LIST_MAX_ITEMS} lines.`,
  itemTooLong: `Keep each line to ${CCOS_LIST_ITEM_MAX} characters.`,
  textTooLong: (n: number) => `Keep it to ${n} characters.`,
  oneLine: "Keep it to one line.",
  accountabilities: `A role answers for ${ACCOUNTABILITIES_MIN} to ${ACCOUNTABILITIES_MAX} things. Write each one on its own line.`,
} as const;

/** A stored text column read back: trimmed text, or `null`. */
export function readStoredRoleText(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * A stored list column read back: the JSON text or the parsed value MySQL
 * hands over. Anything that is not a list of strings reads as `null`, so a
 * malformed row draws nothing and never a broken card. The same reading
 * `readStoredRoleList` gives the handover lists (shared/roleHandover.ts),
 * spelled here so this file imports nothing.
 */
export function readStoredCcosList(v: unknown): string[] | null {
  let x = v;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(x)) return null;
  const items = x.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim());
  return items.length ? items : null;
}

/** A role's CCOS words as `/api/org` names them. Every field optional: absent reads as nothing written. */
export interface RoleCcosWords {
  existsWhile?: string | null;
  authorities?: string[] | null;
  responsibilities?: string[] | null;
  signsStretched?: string | null;
  flowsBack?: string | null;
  stepBack?: string | null;
  timeCommitment?: string | null;
}

/** An `org_roles` row's seven columns read back, each through its reader. */
export function ccosWordsFromRow(r: Record<string, unknown>): Required<RoleCcosWords> {
  return {
    existsWhile: readStoredRoleText(r.exists_while),
    authorities: readStoredCcosList(r.authorities),
    responsibilities: readStoredCcosList(r.responsibilities),
    signsStretched: readStoredRoleText(r.signs_stretched),
    flowsBack: readStoredRoleText(r.flows_back),
    stepBack: readStoredRoleText(r.step_back),
    timeCommitment: readStoredRoleText(r.time_commitment),
  };
}

/**
 * How many accountabilities a list holds once blanks are dropped, or null
 * when the value is not a list. Lists only: a draft carries accountabilities
 * as a list, and anything else writes the empty list.
 */
export function accountabilityCount(v: unknown): number | null {
  if (!Array.isArray(v)) return null;
  return v.filter((s) => typeof s === "string" && s.trim() !== "").length;
}

/**
 * The CCOS limit on what a role answers for, on a NEW write: 3 to 6 once any
 * is written. An empty list is "not written yet" and passes. A role already
 * stored with fewer is never re-judged by a read.
 */
export function accountabilitiesProblem(v: unknown): string | null {
  const n = accountabilityCount(v);
  if (n === null || n === 0) return null;
  return n < ACCOUNTABILITIES_MIN || n > ACCOUNTABILITIES_MAX ? ROLE_CCOS_WORDS.accountabilities : null;
}

/**
 * A `create_seat` line that carries in a role which already exists somewhere
 * else names where it came from under this key. Today one door sets it: the
 * ReGen Civics load, `draftChangesFor` in shared/regenImport.ts, whose roles
 * are the village's own, already written on its card. Such a role arrives with
 * the lines it has, as a role stored before the limit keeps loading with its
 * own: the 3 to 6 count binds roles written here. Every other check, and every
 * other field's parser, still runs. Nothing writes the key to a column.
 */
export const CARRIED_FROM_KEY = "carriedFrom";

/** The accountability count's refusal for a draft payload, or null; a carried-in role keeps its own count. */
export function payloadAccountabilitiesProblem(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;
  const from = payload[CARRIED_FROM_KEY];
  if (typeof from === "string" && from.trim() !== "") return null;
  return accountabilitiesProblem(payload.accountabilities);
}
