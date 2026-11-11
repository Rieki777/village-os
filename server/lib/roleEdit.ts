/**
 * EDITING A ROLE ON ITS CARD (role journey, PR-B "Edit this role").
 *
 * One editor holds every word of a role card, its listing details, the order
 * of its interviewers and the pay group of the terms on offer. A SAVE is one
 * human-sourced org draft with one `update_seat` change, previewed by the same
 * preview every draft meets, and published at once by the editor's own power
 * (a live holder of `org.decide`, or an admin before launch: the two doors
 * `publishDoorFor` names). It is recorded where every structure change is, in
 * the role's draft history, with who, when and what, and the newest one can be
 * put back in one click (`revertEdit`).
 *
 * ── NOTHING HERE PUBLISHES BY ITSELF ───────────────────────────────────────
 *
 * `saveRoleEdit` runs only when a person pressed save. Sera's range and Sera's
 * words are SUGGESTIONS the editor puts in the form (`suggestionFor`); they
 * reach the role only inside that person's save, and the sync never writes the
 * terms on offer (`carriesTerms` keeps a machine's draft out of them).
 *
 * ── WHAT A SAVE WRITES ─────────────────────────────────────────────────────
 *
 * Only what changed: a field equal to the role as it stands is dropped before
 * the draft is made, so the history lists real changes and a save that changes
 * nothing is refused in words. Words go through the proposal parser
 * (`parseRoleWords`) so a card that reads clean saves clean; the parameters go
 * through `readParameter`; the pay group is merged into the terms on offer and
 * read by the terms' own parser. A role is listed only once its card passes the
 * gate (`listingProblems`).
 */
import { PAID_TRACKS, type Track } from "../../shared/roleTracks";
import type { Pool } from "mysql2/promise";
import { addChange, createDraft, getDraft, revertDraft, withdrawDraft } from "./orgDrafts";
import { draftReadiness, publishOrgDraft, type PublishDeps } from "./orgDraftDecide";
import { listOrgRoles, updateOrgRole, type OrgRole } from "./orgChart";
import { ROLE_WORD_FIELDS } from "./roleProposals";
import { liveParameterKeys, PARAMETERS_NOT_HERE } from "./roleParameterColumns";
import { canonicalJson } from "../../shared/canonicalJson";
import { normalWord, parseRoleWords, type RoleWords, type WordValue } from "../../shared/roleProposals";
import { ROLE_CARD_FIELDS } from "../../shared/roleCardText";
import { ROLE_CCOS_COLUMNS } from "../../shared/roleCcos";
import { ROLE_HANDOVER_COLUMNS } from "../../shared/roleHandover";
import { readTermsOffer } from "../../shared/seatTermsOffer";
import type { PaySettings, SeatSettings } from "../../shared/seatSettings";
import {
  PARAMETER_CARD_FIELDS,
  PARAMETER_COLUMNS,
  PARAMETER_KEYS,
  readPayGroup,
  readParameter,
  suggestPayGroup,
  type ParameterKey,
  type ParameterValues,
  type SourcePayLike,
} from "../../shared/roleParameters";
import { newestPublishedDraftFor, draftTouchedRole, firstNames, roleDraftRows } from "../repos/roleEditHistory";
import { readDifferences } from "./seraDifferencesRead";
import { latestRolePay } from "./saberraRolePay";
import { recentSnapshots } from "../repos/saberraSnapshots";
import type { Difference } from "../../shared/seraDifferences";
import { recordEvent } from "./events";
import { listArchetypeRows } from "../repos/archetypes";
import { characterTagsFrom } from "./orgChart";
import { villageId } from "./economy";
import { readHeldBy } from "../../shared/agentHolders";
import { readSections, SECTION_WORDS, type RoleCardSections } from "../../shared/roleCardSections";
import { saveSections, sectionsFor } from "./roleCardSections";

export const EDIT_WORDS = {
  noRole: "There is no role by that id.",
  example: "That is a standing example role, so it cannot be edited.",
  nothing: "Nothing changed, so there is nothing to save.",
  notHere: PARAMETERS_NOT_HERE,
  revertOnlyNewest: "A newer change has been made to this role since, so this one cannot be put back by itself. Put back the newer change first.",
  revertNotOurs: "That change did not touch this role.",
  revertNotLive: "Only a change that is live can be put back.",
} as const;

/** The words a role card carries, by the field name a draft takes. */
const WORD_KEYS: readonly string[] = ROLE_WORD_FIELDS.fields;

/** What the editor opens with: the role as it stands. */
export interface EditorState {
  id: string;
  name: string;
  circleId: string | null;
  isExample: boolean;
  words: Record<string, WordValue>;
  /** The listing details the database has columns for. A key missing here is not editable yet. */
  parameters: ParameterValues;
  /** Which parameter keys this database can hold; the rest are shown as "not yet". */
  parameterKeys: ParameterKey[];
  pay: PaySettings | null;
  archetypes: string[];
  /** The founding sections (shared/roleCardSections.ts): who we hope for, AI support, the pay's shape. */
  sections: RoleCardSections;
}

const asList = (v: unknown): unknown[] => {
  let x = v;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return [];
    }
  }
  return Array.isArray(x) ? x : [];
};

/** The stored listing details of one role, by key. Only keys with a live column are read. */
async function storedParameters(pool: Pool, roleId: string, live: readonly ParameterKey[]): Promise<ParameterValues> {
  if (!live.length) return {};
  const cols = live.map((k) => PARAMETER_COLUMNS[k]);
  const [rows]: any = await pool.query(`SELECT ${cols.map((c) => `\`${c}\``).join(", ")} FROM org_roles WHERE id = ?`, [roleId]); // module-review-ok: the editor's one read of the listing columns this database has; the set of columns is asked of information_schema first (roleParameterColumns.ts)
  const row = rows[0];
  if (!row) return {};
  const out: Record<string, unknown> = {};
  for (const k of live) {
    const v = row[PARAMETER_COLUMNS[k]];
    if (k === "alwaysChecked") out[k] = Number(v) === 1;
    else if (k === "heldBy") out[k] = readHeldBy(v);
    else if (k === "listed") out[k] = v === null || v === undefined ? true : Number(v) === 1;
    else if (k === "languages" || k === "villageGoals" || k === "selectionCriteria" || k === "accessBundle") out[k] = asList(v).map(String);
    else if (k === "conversations") out[k] = asList(v);
    else if (k === "fundedFrom") out[k] = v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null;
    else out[k] = v ?? null;
  }
  return out as ParameterValues;
}

function payOf(role: OrgRole): PaySettings | null {
  const r = readTermsOffer(role.termsOffer, {});
  return r.ok && r.settings?.pay ? r.settings.pay : null;
}

export async function editorState(pool: Pool, role: OrgRole): Promise<EditorState> {
  const live = await liveParameterKeys(pool);
  const words: Record<string, WordValue> = {};
  const posted = role as unknown as Record<string, unknown>;
  for (const f of WORD_KEYS) words[f] = normalWord(posted[f], ROLE_WORD_FIELDS.lists.has(f));
  const parameters = await storedParameters(pool, role.id, live);
  parameters.recruiting = role.recruiting;
  return {
    id: role.id,
    name: role.name,
    circleId: role.circleId,
    isExample: role.isExample,
    words,
    parameters,
    parameterKeys: ["recruiting", ...live],
    pay: payOf(role),
    archetypes: role.archetypes,
    sections: (await sectionsFor(pool, role.id)).sections,
  };
}

// ── The listing gate ────────────────────────────────────────────────────────

/**
 * WHAT A CARD STILL LACKS BEFORE IT MAY BE LISTED (brief 5.3, rule 9: a role
 * is listed only once its card passes the gate). The words are the card's
 * own headings. A role already listed is not re-judged by this: it is asked
 * only when a save turns `listed` on.
 */
export function listingProblems(state: Pick<EditorState, "words" | "parameters" | "pay">): string[] {
  const w = state.words;
  const p = state.parameters;
  const missing: string[] = [];
  const has = (v: WordValue | undefined) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "");
  if (!has(w.aim)) missing.push("Purpose");
  if (!has(w.domain)) missing.push("What it looks after");
  if (!has(w.accountabilities)) missing.push("What you can count on me for");
  if (!has(w.timeCommitment)) missing.push("Time commitment");
  if (!p.track) missing.push("Track");
  if (!(p.villageGoals && p.villageGoals.length)) missing.push("Village goals this role serves");
  if (!(p.selectionCriteria && p.selectionCriteria.length >= 3)) missing.push("Selection criteria");
  if (!(p.conversations && p.conversations.length)) missing.push("Interviewers");
  // Every paid track asks for pay on offer, as the card's gate does (shared/roleTracks.ts, guide v2).
  if (p.track && PAID_TRACKS.includes(p.track as Track) && !(state.pay && (state.pay.kind === "fixed" || state.pay.kind === "range"))) missing.push("Pay on offer");
  return missing;
}

// ── Save ────────────────────────────────────────────────────────────────────

export interface EditRequest {
  words?: unknown;
  parameters?: unknown;
  /** The pay group on offer; `null` takes the pay off the terms; absent leaves the terms alone. */
  pay?: unknown;
  archetypes?: unknown;
  /** The founding sections, whole; absent leaves them alone. Saved beside the draft, never into it. */
  sections?: unknown;
}

export type EditOutcome =
  | { ok: true; draftId: string | null; changed: string[] }
  | { ok: false; status: number; error: string; fields?: string[] };

const bad = (error: string, status = 400, fields?: string[]): EditOutcome => ({ ok: false, status, error, ...(fields ? { fields } : {}) });

/** A key's heading in the card's own words. */
export function labelOf(key: string): string {
  if (key === "whyItMatters") return "Why it matters";
  if (key === "termsOffer") return "Pay on offer";
  if (key === "recruiting") return "Door";
  if (key === "accountabilities") return "What you can count on me for";
  const word = ROLE_CARD_FIELDS.find((f) => f.key === key);
  if (word) return word.heading;
  const param = PARAMETER_CARD_FIELDS.find((f) => f.key === key);
  return param ? param.heading : key;
}

const sameJson = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

export interface SaveDeps {
  pool: Pool;
  publish: PublishDeps;
  /** The roles of this village, for the interviewers' ids. */
  roles?: readonly OrgRole[];
}

/**
 * SAVE THE EDITOR: build the draft, read it, publish it. A refused draft is
 * withdrawn so nothing is left open for somebody else to find. `userId` is the
 * person who pressed save and is recorded as the draft's maker and publisher.
 */
export async function saveRoleEdit(deps: SaveDeps, roleId: string, userId: string, body: EditRequest): Promise<EditOutcome> {
  const { pool } = deps;
  const roles = deps.roles ?? (await listOrgRoles(pool));
  const role = roles.find((r) => r.id === roleId);
  if (!role) return bad(EDIT_WORDS.noRole, 404);
  if (role.isExample) return bad(EDIT_WORDS.example, 409);
  const roleIds = new Set(roles.filter((r) => !r.isExample).map((r) => r.id));
  const payload: Record<string, unknown> = {};

  // The words: the proposal parser judges them, and only a change is kept.
  if (body.words !== undefined && body.words !== null) {
    if (typeof body.words !== "object" || Array.isArray(body.words)) return bad("A role's words arrive as a set of fields.");
    const read = parseRoleWords(body.words, "words", ROLE_WORD_FIELDS, role as unknown as Record<string, unknown>);
    if (!read.ok) return bad(read.error, 400, [read.field]);
    for (const [k, v] of Object.entries(read.value as RoleWords)) payload[k] = v === null && ROLE_WORD_FIELDS.lists.has(k) ? [] : v;
  }

  // The parameters.
  const live = await liveParameterKeys(pool);
  const stored = await storedParameters(pool, roleId, live);
  stored.recruiting = role.recruiting;
  const asked: Record<string, unknown> = body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters) ? (body.parameters as Record<string, unknown>) : {};
  for (const key of Object.keys(asked)) {
    if (!(PARAMETER_KEYS as readonly string[]).includes(key)) return bad("That is not a detail a role card holds.", 400, [`parameters.${key}`]);
    const k = key as ParameterKey;
    const r = readParameter(k, asked[k], (id) => roleIds.has(id));
    if (!r.ok) return bad(r.problem, 400, [`parameters.${k}`]);
    if (k !== "recruiting" && !live.includes(k)) {
      // Said in words, and only when it would change something: sending a value the role already holds asks for nothing.
      if (r.value !== undefined && r.value !== null && !(Array.isArray(r.value) && r.value.length === 0)) return bad(EDIT_WORDS.notHere, 409, [`parameters.${k}`]);
      continue;
    }
    if (sameJson(r.value, (stored as Record<string, unknown>)[k])) continue;
    payload[k] = r.value;
  }

  // The pay group, merged into the terms on offer. The terms' other groups are left as they are.
  let nextPay: PaySettings | null = payOf(role);
  if (body.pay !== undefined) {
    const read = readPayGroup(body.pay);
    if (!read.ok) return bad(read.problem, 400, ["pay"]);
    nextPay = read.value;
    if (!sameJson(nextPay, payOf(role))) {
      const held = readTermsOffer(role.termsOffer, {});
      const base: SeatSettings = held.ok && held.settings ? { ...held.settings } : { v: 1 };
      if (nextPay) base.pay = nextPay;
      else delete base.pay;
      // Terms with nothing left in them are no terms on offer.
      const empty = Object.keys(base).every((k) => k === "v");
      payload.termsOffer = empty ? null : base;
    }
  }

  // The characters the role suits are not a draft field: they are the role's tags, saved beside the draft.
  let tags: string[] | null = null;
  if (body.archetypes !== undefined) {
    const cast = (await listArchetypeRows(pool, villageId())).map((a) => a.key);
    const t = characterTagsFrom(body.archetypes, cast);
    if (!t.ok) return bad(t.error, 400, ["archetypes"]);
    if (!sameJson([...t.tags].sort(), [...role.archetypes].sort())) tags = t.tags;
  }

  // The founding sections are not a draft field either: they are the village's card data, saved beside the draft.
  let sections: RoleCardSections | null = null;
  if (body.sections !== undefined) {
    const read = readSections(body.sections);
    if (!read.ok) return bad(read.problem, 400, [read.field]);
    const held = (await sectionsFor(pool, roleId)).sections;
    if (JSON.stringify(held) !== JSON.stringify(read.value)) sections = read.value;
  }

  if (!Object.keys(payload).length && tags === null && sections === null) return bad(EDIT_WORDS.nothing);

  // A role is listed only once its card passes the gate.
  if (payload.listed === true) {
    const state = await editorState(pool, role);
    const merged: EditorState = {
      ...state,
      words: { ...state.words, ...Object.fromEntries(Object.entries(payload).filter(([k]) => WORD_KEYS.includes(k)).map(([k, v]) => [k, normalWord(v, ROLE_WORD_FIELDS.lists.has(k))])) },
      parameters: { ...state.parameters, ...Object.fromEntries(Object.entries(payload).filter(([k]) => (PARAMETER_KEYS as readonly string[]).includes(k))) } as ParameterValues,
      pay: nextPay,
    };
    const lacking = listingProblems(merged);
    if (lacking.length) return bad(`This card is not ready to list yet. Still to write: ${lacking.join(", ")}.`, 409, lacking);
  }

  let draftId: string | null = null;
  if (Object.keys(payload).length) {
    const made = await createDraft(pool, {
      title: `Edit role: ${role.name}`.slice(0, 200),
      rationale: "Edited on the role card by a holder of the power to decide the structure.",
      createdBy: userId,
      sourceKind: "human",
      openCap: null,
    });
    if (!made.ok) return bad(made.error, 409);
    draftId = made.id;
    const added = await addChange(pool, made.id, { op: "update_seat", orgRoleId: roleId, payload });
    if (!added.ok) {
      await withdrawDraft(pool, made.id);
      return bad(added.error, 409);
    }
    const draft = await getDraft(pool, made.id);
    const ready = draft ? await draftReadiness(pool, draft) : { blocked: 1, blockedLines: [], changes: 0 };
    if (ready.blocked > 0) {
      await withdrawDraft(pool, made.id);
      const first = ready.blockedLines[0];
      return bad(first ? `${first.blocked}. Nothing was saved.` : "This does not fit the village as it stands. Nothing was saved.", 409);
    }
    const published = await publishOrgDraft(deps.publish, made.id, userId, userId);
    if (!published.ok) {
      await withdrawDraft(pool, made.id);
      return bad(`${published.error}. Nothing was saved.`, 409);
    }
  }
  if (tags !== null) await updateOrgRole(pool, roleId, { archetypes: tags });
  if (sections !== null) await saveSections(pool, roleId, sections, userId);
  const changed = [...Object.keys(payload).map(labelOf), ...(tags !== null ? ["Characters it suits"] : []), ...(sections !== null ? [SECTION_WORDS.editorHeading] : [])];
  return { ok: true, draftId, changed: Array.from(new Set(changed)) };
}

// ── History and revert ──────────────────────────────────────────────────────

const BEFORE_COLUMN: Record<string, string> = {
  name: "name",
  aim: "aim",
  domain: "domain",
  accountabilities: "accountabilities",
  whyItMatters: "why_it_matters",
  termsOffer: "terms_offer",
  ...ROLE_CCOS_COLUMNS,
  ...ROLE_HANDOVER_COLUMNS,
  ...PARAMETER_COLUMNS,
};

export interface HistoryChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
}

export interface HistoryEntry {
  draftId: string;
  title: string;
  at: string | null;
  /** First name of the person who published it, or null for a machine or an unknown. */
  by: string | null;
  fromEditor: boolean;
  status: "published" | "reverted";
  revertedAt: string | null;
  created: boolean;
  changes: HistoryChange[];
  /** True only for the newest live change to the role. */
  canRevert: boolean;
}

const CLIP = 240;
function shown(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let x = v;
  if (typeof x === "string" && /^[[{]/.test(x.trim())) {
    try {
      x = JSON.parse(x);
    } catch {
      /* shown as written */
    }
  }
  const text = Array.isArray(x) ? x.map((i) => (typeof i === "object" ? JSON.stringify(i) : String(i))).join("; ") : typeof x === "object" ? JSON.stringify(x) : String(x);
  return text.length > CLIP ? `${text.slice(0, CLIP)}...` : text || null;
}

export async function roleHistory(pool: Pool, roleId: string): Promise<HistoryEntry[]> {
  const [rows, newest] = await Promise.all([roleDraftRows(pool, roleId), newestPublishedDraftFor(pool, roleId)]);
  const names = await firstNames(pool, rows.map((r) => r.publishedBy ?? ""));
  return rows.map((r) => {
    const changes: HistoryChange[] = [];
    if (r.op === "update_seat") {
      for (const [key, after] of Object.entries(r.payload)) {
        const col = BEFORE_COLUMN[key];
        if (!col && key !== "accountabilities") continue;
        changes.push({ field: key, label: labelOf(key), before: r.before && col ? shown(r.before[col]) : null, after: shown(after) });
      }
    }
    return {
      draftId: r.draftId,
      title: r.title,
      at: r.publishedAt ? new Date(r.publishedAt).toISOString() : null,
      by: r.publishedBy ? names.get(r.publishedBy) ?? null : null,
      fromEditor: r.sourceKind === "human" && /^Edit role:/.test(r.title),
      status: r.status,
      revertedAt: r.revertedAt ? new Date(r.revertedAt).toISOString() : null,
      created: r.op === "create_seat",
      changes,
      canRevert: r.status === "published" && r.draftId === newest && r.op === "update_seat",
    };
  });
}

export type RevertOutcome = { ok: true } | { ok: false; status: number; error: string };

/** Put back the newest live change to a role. An older one waits for the newer to be put back first. */
export async function revertEdit(deps: SaveDeps, roleId: string, draftId: string, userId: string): Promise<RevertOutcome> {
  const { pool } = deps;
  if (!(await draftTouchedRole(pool, draftId, roleId))) return { ok: false, status: 404, error: EDIT_WORDS.revertNotOurs };
  const newest = await newestPublishedDraftFor(pool, roleId);
  if (newest !== draftId) {
    const rows = await roleDraftRows(pool, roleId);
    const mine = rows.find((r) => r.draftId === draftId);
    return mine && mine.status === "reverted" ? { ok: false, status: 409, error: EDIT_WORDS.revertNotLive } : { ok: false, status: 409, error: EDIT_WORDS.revertOnlyNewest };
  }
  const r = await revertDraft(pool, draftId);
  if (!r.ok) return { ok: false, status: 409, error: r.error };
  void recordEvent(pool, { kind: "org", text: "an edit to this role was put back", actorUserId: userId, entityType: "org_role", entityRef: roleId, audience: "admin" });
  return { ok: true };
}

// ── Sera's version and Sera's range ─────────────────────────────────────────

export interface SeraSuggestion {
  /** The differences between Sera's latest read and this role, each a word the editor may take into its form. */
  differences: Array<{ key: string; kind: string; field: string | null; sera: string | null; ours: string | null; takeable: boolean }>;
  /** The pay group Sera's figures suggest, for the person to read and save. Null when Sera sent nothing to go on. */
  pay: PaySettings | null;
  /** What Sera said about pay, in her own terms, so the person can see what the suggestion came from. */
  payFrom: SourcePayLike | null;
  /** The newest read, when it was taken. */
  readAt: string | null;
}

/** The fields a difference may fill in the editor's form: the role's own words. */
const TAKEABLE_FIELDS: ReadonlySet<string> = new Set(["name", "aim", "domain"]);

/** READ ONLY. Sera's latest read of this role against the role here. Writes nothing, anywhere. */
export async function suggestionFor(pool: Pool, roleId: string): Promise<SeraSuggestion> {
  const read = await readDifferences(pool);
  const mine = read.list.filter((d: Difference) => d.subject.kind === "role" && d.subject.ourId === roleId);
  // The latest range the service holds for this role (role journey L10, GET /api/saberra/role-pay reads the same).
  // Information beside the role, never a term: the person's save is what puts a group on offer.
  const reading = latestRolePay(await recentSnapshots(pool, 5));
  const held = reading?.byRole[roleId] ?? null;
  const payFrom: SourcePayLike | null = held ? { model: held.model, standing: held.standing, statusLabel: held.statusLabel, terms: held.terms, monthlyUsd: held.monthlyUsd, range: held.range ?? null } : null;
  return {
    differences: mine
      .filter((d) => d.kind !== "pay")
      .map((d) => ({
        key: d.key,
        kind: d.kind,
        field: d.field,
        sera: d.sera,
        ours: d.oursAsStored ?? d.ours,
        takeable: d.takeable && d.field !== null && TAKEABLE_FIELDS.has(d.field),
      })),
    pay: suggestPayGroup(payFrom),
    payFrom,
    readAt: reading?.readAt ?? read.latest?.takenAt ?? null,
  };
}
