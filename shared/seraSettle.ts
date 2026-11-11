/**
 * ANSWERING A DIFFERENCE FROM THE OUTSIDE SERVICE: the pure rules (spec R12,
 * R13, R16, R30, R31).
 *
 * The list of differences (shared/seraDifferences.ts) says how the service's
 * chart and ours differ now. A person answers each one: takes the service's
 * value into an org draft, keeps ours, or writes their own. The server writes
 * the answer (server/lib/seraAnswer.ts, table `saberra_settled`); these are the
 * rules it and the page share.
 *
 * - R12. One difference writes one field. `changesFor` builds a take through
 *   the structure review's own builders (shared/structurePlan.ts), one field
 *   each: `seatField` for a name, a role's words or its circle, and never the
 *   whole-record update an accepted structure makes. A take writes the
 *   service's words AS STORED, line breaks and all; only the comparison uses
 *   the normalised form.
 * - R13. "In a draft" is a state. A take names its draft, and the draft's own
 *   status says the rest: open is in a draft, published is settled, withdrawn
 *   or reverted is open again. A take in an open draft whose difference has
 *   gone, or whose service value or ours has moved since, is "changed since
 *   you took it": the draft card says so and the draft is not published or
 *   added to until it is undone or taken again. The draft card is built from
 *   the stored answers, so a take never hides when its difference goes.
 * - R16. A keep holds until the service's value changes, and an undo opens it
 *   again. A keep by somebody without the power to decide only sets the
 *   difference aside: it stays in the list for the people who decide. While
 *   automatic apply is off (C3) that holds for a small change and a fact too,
 *   because they wait for the same people (R29). An answer whose difference
 *   left the list after a later read has lapsed, and answers nothing.
 * - R30, R2. Bulk takes only what may be taken together. A row marked Check
 *   first (an unknown base among them) and pay are left out, and named.
 * - R31. A new circle carries the new roles the service puts in it, and
 *   leaving the circle out leaves them out. A new role already answered, or
 *   carrying a reason to check first of its own, stays out and is named.
 *
 * Pure: no pool, no clock. The words are in plain English and take the
 * agent's name from config (R34).
 */
import type { Difference } from "./seraDifferences";
import { pageKey } from "./seraWaiting";
import { circleCreate, circleIdFor, circleRest, seatCreate, seatField, seatIdFor, seatRest, type DecidedChange } from "./structurePlan";

// ── An answer, as the table keeps it ────────────────────────────────────────

/** How a difference was answered. `applied` and `first` are written by later slices (the automatic lane, a seeded base). */
export type Answer = "taken" | "kept" | "edited" | "applied" | "undone" | "first";
export const ANSWERS: readonly Answer[] = ["taken", "kept", "edited", "applied", "undone", "first"];

/** The door it came through: a holder's power, the admin panel before launch, a moderator, a vote, or the sync. */
export type AnswerDoor = "power" | "admin" | "moderator" | "ballot" | "sync";
export const ANSWER_DOORS: readonly AnswerDoor[] = ["power", "admin", "moderator", "ballot", "sync"];

/** One answer, with its draft's status read beside it. Hashes only, never the words (R6). */
export interface SettledRow {
  key: string;
  seraHash: string;
  oursHash: string;
  answer: Answer;
  door: AnswerDoor;
  draftId: string | null;
  /** The draft's own status, or null when it has none or the draft is gone. */
  draftStatus: string | null;
  draftTitle: string | null;
  /** The new circle this new role was taken with, by its difference key. */
  cameWith: string | null;
  /** Its difference left the list after it was answered, so it answers nothing now. */
  lapsed?: boolean;
  actorUserId?: string | null;
  /** The role whose power the person acted through, by id. */
  byRoleId?: string | null;
}

export type AnswerState = "open" | "inDraft" | "changed" | "settled" | "setAside";

const takenOrEdited = (row: Pick<SettledRow, "answer">) => row.answer === "taken" || row.answer === "edited";

/** How the list reads one difference once its answer is read. */
export function answerState(d: Pick<Difference, "seraHash" | "oursHash">, row: SettledRow | undefined): AnswerState {
  if (!row || row.lapsed) return "open";
  if (takenOrEdited(row)) {
    if (row.draftStatus === "open") return row.seraHash !== d.seraHash || row.oursHash !== d.oursHash ? "changed" : "inDraft";
    // Live: what the service said then is answered, so it returns only once the service changes it again.
    if (row.draftStatus === "published") return row.seraHash === d.seraHash ? "settled" : "open";
    return "open";
  }
  if (row.answer === "kept" || row.answer === "applied") {
    if (row.seraHash !== d.seraHash) return "open";
    // R16, and R29 while automatic apply is off: a moderator's keep sets it aside for the holders, whatever its lane.
    if (row.answer === "kept" && row.door === "moderator") return "setAside";
    return "settled";
  }
  return "open";
}

/** One answer in an open draft, with its difference when the list still has it. */
export interface DraftItem<D> {
  key: string;
  row: SettledRow;
  /** The difference as it stands now, or null when the list no longer has it. */
  d: D | null;
  /** Its difference has gone, or its service value or ours has moved, since it was taken. */
  changed: boolean;
}

export interface InDraft<D> {
  draftId: string;
  title: string | null;
  /** What the draft holds, one per answer a person gave. */
  items: DraftItem<D>[];
  /** The new roles that came with a new circle in `items`. */
  with: DraftItem<D>[];
}

/**
 * The list as a reader sees it once every answer is read. The drafts are
 * built from the stored answers, never from the list, so a take whose
 * difference has gone still shows, marked changed.
 */
export function withAnswers<D extends Difference>(
  list: readonly D[],
  rows: ReadonlyMap<string, SettledRow>,
): { open: D[]; setAside: Set<string>; inDraft: InDraft<D>[]; settled: number } {
  const open: D[] = [];
  const setAside = new Set<string>();
  let settled = 0;
  const byKey = new Map(list.map((d) => [d.key, d]));
  for (const d of list) {
    const state = answerState(d, rows.get(d.key));
    if (state === "settled") settled += 1;
    else if (state === "open" || state === "setAside") {
      if (state === "setAside") setAside.add(d.key);
      open.push(d);
    }
  }
  const drafts = new Map<string, InDraft<D>>();
  // The list's order first, then the answers whose difference has gone, in the order they were read.
  const order = (r: SettledRow) => {
    const i = list.findIndex((d) => d.key === r.key);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const inOpenDrafts = Array.from(rows.values())
    .filter((r) => takenOrEdited(r) && !r.lapsed && r.draftStatus === "open" && r.draftId)
    .sort((a, b) => order(a) - order(b));
  for (const row of inOpenDrafts) {
    const d = byKey.get(row.key) ?? null;
    const item: DraftItem<D> = { key: row.key, row, d, changed: d === null || row.seraHash !== d.seraHash || row.oursHash !== d.oursHash };
    const g = drafts.get(row.draftId!) ?? { draftId: row.draftId!, title: row.draftTitle, items: [], with: [] };
    (row.cameWith ? g.with : g.items).push(item);
    drafts.set(row.draftId!, g);
  }
  return { open, setAside, inDraft: Array.from(drafts.values()), settled };
}

/** A draft holding a take that changed since it was taken: never published from the card, never added to (R13). */
export const draftHasChanged = (g: InDraft<unknown>): boolean => [...g.items, ...g.with].some((i) => i.changed);

// ── What a take writes (R12, R31) ───────────────────────────────────────────

export type TakeRefusal =
  | "notTakeable"
  | "namesAMember"
  | "editNamesAMember"
  | "pay"
  | "heldHere"
  | "severalCircles"
  | "circleFirst"
  | "circleNotHere"
  | "circleRename"
  | "bringBack"
  | "blank"
  | "tooLong"
  | "notEditable"
  | "answered"
  | "checkFirst";

export interface TakeInput {
  d: Difference;
  /** The whole list, so a new circle finds the new roles that sit in it. */
  list: readonly Difference[];
  /** Who is taking it: stamped on a retirement as the person's own choice. */
  actor: string;
  /** Circles the open draft already makes, by the service's page key, so a new role can go in one. */
  draftCircles: ReadonlyMap<string, string>;
  /** An edit: the person's own words for the field, in place of the service's. */
  value?: string;
  /** Every stored answer, so a new circle leaves out a new role already answered (R31). */
  answers?: ReadonlyMap<string, SettledRow>;
}

export type Take =
  | { ok: true; changes: DecidedChange[]; with: string[]; leftOut: Array<{ key: string; why: TakeRefusal }> }
  | { ok: false; why: TakeRefusal };

/** The longest name and words an edit may write. A name keeps the structure review's own bound. */
const NAME_MAX = 120;
const WORDS_MAX = 4000;
/** A retirement taken from the list says so, the way the structure review's says "old-chart". */
const RETIRING = "sera";
/** The reasons a new role in a new circle carries by being there: taking the circle answers them. */
const CARRIED_BY_THE_CIRCLE = new Set(["baseUnknown", "firstSight", "circleNotHere"]);

const no = (why: TakeRefusal): Take => ({ ok: false, why });
const asStored = (stored: unknown, normalised: string | null | undefined): string => (typeof stored === "string" && stored.trim() !== "" ? stored.trim() : (normalised ?? "").trim());

/** Where a new role goes: a circle here, or a new one the draft already makes. */
function placeRole(circleId: string | null, draftCircles: ReadonlyMap<string, string>): { ok: true; circleId: string | null } | { ok: false; why: TakeRefusal } {
  if (circleId === null) return { ok: true, circleId: null };
  if (circleId.startsWith("sera:")) {
    const made = draftCircles.get(pageKey(circleId.slice("sera:".length)));
    return made ? { ok: true, circleId: made } : { ok: false, why: "circleFirst" };
  }
  if (circleId.startsWith("name:")) return { ok: false, why: "circleNotHere" };
  return { ok: true, circleId };
}

/** A new role's create, from its difference: its id from the page id, its words as the service stored them, its circle. */
function roleCreate(d: Difference, circleId: string | null): DecidedChange {
  const pk = pageKey(d.subject.pageId ?? d.key);
  const aim = asStored(d.params?.aimAsStored, typeof d.params?.aim === "string" ? d.params.aim : null);
  return seatCreate(seatIdFor(d.subject.pageId, `sera-role-${pk.slice(0, 40)}`), {
    name: asStored(d.seraAsStored, d.sera ?? d.subject.name),
    ...(aim !== "" ? { aim } : {}),
    ...(circleId !== null ? { circleId } : {}),
  });
}

/** The new roles the service puts in a new circle, by that circle's page key. */
export function nestedIn<D extends Difference>(list: readonly D[], circlePageKey: string): D[] {
  return list.filter((x) => x.kind === "roleAdd" && x.subject.ourId === null && x.subject.circleId === `sera:${circlePageKey}`);
}

/** Why a new role stays out of its new circle's take, or null when it goes in with it (R2, R31). */
function nestedLeftOut(r: Difference, answers: ReadonlyMap<string, SettledRow> | undefined): TakeRefusal | null {
  if (!r.takeable) return r.namesAMember ? "namesAMember" : "notTakeable";
  if (answers && answerState(r, answers.get(r.key)) !== "open") return "answered";
  if (r.flags.some((f) => !CARRIED_BY_THE_CIRCLE.has(f.key))) return "checkFirst";
  return null;
}

/**
 * The changes one difference makes: the service's value as stored, or the
 * person's own words for an edit, one field and nothing else (R12). A new
 * circle brings its new roles (R31); a new role whose circle is not here waits
 * for that circle.
 */
export function changesFor(input: TakeInput): Take {
  const { d, list, actor, draftCircles } = input;
  const ourId = d.subject.ourId;
  const editing = input.value !== undefined;
  if (d.kind === "pay") return no("pay");
  if (editing && !(d.kind === "textField" && d.field === "aim") && !(d.kind === "rename" && d.subject.kind === "role")) return no("notEditable");
  if (!editing && !d.takeable) return no(d.namesAMember ? "namesAMember" : "notTakeable");
  const words = (max: number): { ok: true; v: string } | { ok: false; why: TakeRefusal } => {
    const v = editing ? String(input.value).trim() : asStored(d.seraAsStored, d.sera);
    if (v === "") return { ok: false, why: "blank" };
    if (v.length > max) return { ok: false, why: "tooLong" };
    return { ok: true, v };
  };
  const one = (change: DecidedChange): Take => ({ ok: true, changes: [change], with: [], leftOut: [] });
  const held = d.flags.some((f) => f.key === "heldHere");

  switch (d.kind) {
    case "circleAdd": {
      if (ourId !== null) return no("bringBack");
      const name = asStored(d.seraAsStored, d.sera ?? d.subject.name);
      const pk = pageKey(d.subject.pageId ?? d.key);
      const id = circleIdFor(name, `sera-${pk.slice(0, 40)}`);
      const changes = [circleCreate(id, name)];
      const withKeys: string[] = [];
      const leftOut: Array<{ key: string; why: TakeRefusal }> = [];
      for (const r of nestedIn(list, pk)) {
        const why = nestedLeftOut(r, input.answers);
        if (why) {
          leftOut.push({ key: r.key, why });
          continue;
        }
        changes.push(roleCreate(r, id));
        withKeys.push(r.key);
      }
      return { ok: true, changes, with: withKeys, leftOut };
    }
    case "circleRest":
      if (ourId === null) return no("notTakeable");
      return held ? no("heldHere") : one(circleRest(ourId, actor, RETIRING));
    case "roleAdd": {
      if (ourId !== null) return no("bringBack");
      const place = placeRole(d.subject.circleId, draftCircles);
      return place.ok ? one(roleCreate(d, place.circleId)) : no(place.why);
    }
    case "roleRest":
      if (ourId === null) return no("notTakeable");
      return held ? no("heldHere") : one(seatRest(ourId, actor, RETIRING));
    case "roleMove": {
      if (ourId === null || !d.sera) return no("notTakeable");
      const to = d.sera.split("|").filter(Boolean);
      if (to.length !== 1) return no("severalCircles");
      const place = placeRole(to[0], draftCircles);
      if (!place.ok) return no(place.why);
      return place.circleId === null ? no("notTakeable") : one(seatField(ourId, "circleId", place.circleId));
    }
    case "rename": {
      if (d.subject.kind === "circle") return no("circleRename");
      if (ourId === null) return no("notTakeable");
      const w = words(NAME_MAX);
      return w.ok ? one(seatField(ourId, "name", w.v)) : no(w.why);
    }
    case "textField": {
      if (d.field !== "aim" || d.subject.kind !== "role" || ourId === null) return no("notTakeable");
      const w = words(WORDS_MAX);
      return w.ok ? one(seatField(ourId, "aim", w.v)) : no(w.why);
    }
    default:
      return no("notTakeable");
  }
}

// ── Bulk with exceptions (R2, R30, R31) ─────────────────────────────────────

export type LeftOutWhy = "checkFirst" | "pay" | "notTakeable" | "withCircle" | "oursAhead";

export interface BulkPlan<D> {
  /** What a bulk take takes. */
  take: D[];
  /** What was ticked and is left out, and why, in the order ticked. */
  leftOut: Array<{ d: D; why: LeftOutWhy }>;
  /** Each new circle left out, with every new role that leaves with it. */
  cascades: Array<{ circle: D; roles: D[] }>;
}

/** Why a row is not taken in bulk, in the order the reasons are checked; null when it may be. */
export function bulkLeftOut(d: Pick<Difference, "kind" | "state" | "bulkEligible" | "takeable">): Exclude<LeftOutWhy, "withCircle"> | null {
  if (d.kind === "pay") return "pay";
  if (d.state === "oursAhead") return "oursAhead";
  if (!d.bulkEligible) return "checkFirst";
  if (!d.takeable) return "notTakeable";
  return null;
}

/**
 * What a bulk take of the ticked rows takes. Never a row that carries a
 * reason to check first, an unknown base among them (R2), never pay, and
 * never a new role apart from its new circle (R31).
 */
export function bulkPlan<D extends Difference>(ticked: readonly D[], list: readonly D[]): BulkPlan<D> {
  const take: D[] = [];
  const leftOut: Array<{ d: D; why: LeftOutWhy }> = [];
  const circles = new Map<string, D>();
  for (const d of list) if (d.kind === "circleAdd" && d.subject.ourId === null && d.subject.pageId) circles.set(pageKey(d.subject.pageId), d);
  const touched = new Set<string>();
  for (const d of ticked) {
    const under = d.kind === "roleAdd" && d.subject.ourId === null && d.subject.circleId?.startsWith("sera:") ? pageKey(d.subject.circleId.slice(5)) : null;
    if (under !== null && circles.has(under)) {
      touched.add(under);
      leftOut.push({ d, why: "withCircle" });
      continue;
    }
    const why = bulkLeftOut(d);
    if (why) leftOut.push({ d, why });
    else take.push(d);
    if (d.kind === "circleAdd" && d.subject.pageId && !take.includes(d)) touched.add(pageKey(d.subject.pageId));
  }
  const cascades = Array.from(touched)
    .map((pk) => ({ circle: circles.get(pk)!, roles: nestedIn(list, pk) }))
    .filter((c) => c.circle && c.roles.length > 0);
  return { take, leftOut, cascades };
}

// ── A change in a draft, described without its difference ───────────────────

/**
 * What one draft change does, in words, for a take whose difference the list
 * no longer has: names from the chart here and the change itself, never from
 * the service and never a person.
 */
export function changeLine(c: { op: string; orgRoleId: string; payload: Record<string, unknown> }, names: ReadonlyMap<string, string>): string {
  const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const role = names.get(c.orgRoleId) ?? text(c.payload.name) ?? "a role";
  const circle = names.get(c.orgRoleId) ?? text(c.payload.name) ?? "a circle";
  switch (c.op) {
    case "create_circle":
      return `A new circle, ${circle}`;
    case "create_seat":
      return `A new role, ${text(c.payload.name) ?? role}`;
    case "rest_seat":
      return `Retiring ${role}`;
    case "rest_circle":
      return `Retiring the circle ${circle}`;
    case "set_circle_standing":
      return `A change to the standing of the circle ${circle}`;
    case "update_seat":
      if (c.payload.name !== undefined) return `A new name for ${role}`;
      if (c.payload.aim !== undefined) return `New words for ${role}'s purpose`;
      if (c.payload.circleId !== undefined) return `Moving ${role}`;
      return `A change to ${role}`;
    default:
      return "A change to the structure";
  }
}

// ── The words ───────────────────────────────────────────────────────────────

/** Why a take was refused, in a sentence. */
export function takeRefusalWords(why: TakeRefusal, agent: string): string {
  switch (why) {
    case "namesAMember":
      return "Its words name a member here, so they cannot be taken as they are. Edit them instead.";
    case "editNamesAMember":
      return "These words name a member here. Write them without the name.";
    case "pay":
      return "Pay is set by a person in the role's terms. Ask whoever sets pay.";
    case "heldHere":
      return "Somebody holds this here, so it cannot be retired from this list.";
    case "severalCircles":
      return `${agent} puts this role in more than one circle, so there is no one circle to move it to.`;
    case "circleFirst":
      return "This role sits in a new circle. Add the circle, and its roles come with it.";
    case "circleNotHere":
      return `${agent} puts it in a circle this village doesn't have.`;
    case "circleRename":
      return "Rename the circle on the circles page.";
    case "bringBack":
      return "Bring it back from the page it was retired on.";
    case "blank":
      return "Write the words first.";
    case "tooLong":
      return "That is longer than this field can hold.";
    case "notEditable":
      return "Only a role's name and its words can be edited here.";
    case "answered":
      return "It is already answered, so it stays as it is.";
    case "checkFirst":
      return "It is marked Check first, so take it on its own.";
    default:
      return "This one cannot be taken from this list.";
  }
}

/** Why an answer was refused before anything was written: the list moved under it, or it is already answered (R13, R14). */
export type AnswerRefusal =
  | "seraChanged"
  | "oursChanged"
  | "gone"
  | "inDraft"
  | "answered"
  | "underVote"
  | "live"
  | "nothing"
  | "oursAhead"
  | "draftHasChanged"
  | "circleHasRoles"
  | "failed"
  | TakeRefusal;

export function answerRefusalWords(why: AnswerRefusal, agent: string): string {
  switch (why) {
    case "seraChanged":
      return `${agent} changed this since you opened it.`;
    case "oursChanged":
      return "This changed here since you opened it.";
    case "gone":
      return "This no longer differs, so there is nothing to answer.";
    case "inDraft":
      return "This is already in a draft.";
    case "answered":
      return "This was already answered.";
    case "underVote":
      return "The village is voting on the draft this is in, so it cannot change until the vote closes.";
    case "live":
      return "This is live now with its draft, so it is not undone from this list.";
    case "nothing":
      return "There is nothing to undo here.";
    case "oursAhead":
      return `This was changed here and ${agent} still has the old way, so there is nothing to take.`;
    case "draftHasChanged":
      return "Something in this draft changed since it was taken. Undo it or take it again first.";
    case "circleHasRoles":
      return "Roles are placed in this new circle. Undo them first.";
    case "failed":
      return "The answer could not be written. Nothing changed.";
    default:
      return takeRefusalWords(why, agent);
  }
}
