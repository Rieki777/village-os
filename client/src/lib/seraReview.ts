/**
 * The outside service's differences on /review, as the page reads them: which
 * wait for a person, how they group by circle, what the headline says, and the
 * merged diff a conflict shows. Pure, so every rule here is a test in
 * seraReview.test.ts and none of it needs a DOM.
 *
 * The sentences for each difference are NOT here. The server builds them with
 * shared/seraDifferenceWords.ts and sends them as `words`, so the page never
 * holds a second copy of that table. What lives here is the page's own copy:
 * the headline, the counts and the state lines of the approved boards (spec
 * section 8.6, R29 to R39).
 *
 * WHITE LABEL (R34). The agent's name is always handed in, from the list's own
 * `agent` or the guide read, and this village is "here" and "ours".
 */
import type { Difference, DifferenceCount, SnapshotRead } from "@shared/seraDifferences";
import { pageKey, waitingKind } from "@shared/seraWaiting";
import { readDoor, type Door } from "@shared/seraDecides";

/** One difference with its words, as `GET /api/saberra/differences` sends it. */
export interface ListedDifference extends Difference {
  /** The waiting arrival that holds it, for the structure review link (review C7), or null when none does. */
  batchId?: string | null;
  /** Kept by somebody without the power to decide it, so it still waits for those who have it (R16). */
  setAside?: boolean;
  /** When somebody here last rewrote what this conflict is about, where published history says so. */
  changedHereAt?: string | null;
  words: { sentence: string; flags: string[]; source: string; open: string | null; openWords: string };
}

/** `GET /api/saberra/differences/count`, for any signed-in member. Totals only. */
export interface CountAnswer extends DifferenceCount {
  lastReadAt: string | null;
  lastReadWhole: boolean;
  /** Who decides what waits, by the holder test (review S2). Null when the server could not say. */
  decides: Door | null;
  /** Who sets pay, the same way. */
  paySetBy: Door | null;
  /** About this reader: may they read the list (null when the server could not say), and do they decide. */
  reader?: { mayRead: boolean | null; decides: boolean };
  /** The drafts the list's answers opened, by id and size only (R38's door to a vote). */
  drafts?: Array<{ id: string; changes: number }>;
}

/** One draft the list's answers opened, as the list sends it (R13). */
export interface InDraftGroup {
  draftId: string;
  title: string | null;
  items: Array<{ key: string; sentence: string }>;
  /** The new roles that came with a new circle in it. */
  with: number;
}

/** `GET /api/saberra/differences`, behind the review queue's key. */
export interface ListAnswer {
  agent: string;
  lastReadAt: string | null;
  lastReadWhole: boolean;
  reads: { circles: SnapshotRead; roles: SnapshotRead } | null;
  count: DifferenceCount;
  differences: ListedDifference[];
  /** When each kind was last read whole. Absent from a server that does not send it. */
  lastWholeAt?: { circles: string | null; roles: string | null } | null;
  /** The circles here in chart order, by id. Absent from a server that does not send it. */
  circleOrder?: string[];
  /** The waiting arrivals the newest read holds whole: only these may fold away (review S1). */
  heldBatches?: string[];
  /** What a person took, by draft: not live yet (R13). */
  inDraft?: InDraftGroup[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function countOf(v: unknown): DifferenceCount | null {
  if (!isObj(v) || typeof v.total !== "number" || !isObj(v.lanes)) return null;
  const lanes = v.lanes;
  return {
    total: num(v.total),
    // An older server sends no toDecide; its decisions are the nearest it said.
    toDecide: typeof v.toDecide === "number" ? num(v.toDecide) : num(lanes.decision),
    small: typeof v.small === "number" ? num(v.small) : num(lanes.lowRisk),
    facts: typeof v.facts === "number" ? num(v.facts) : num(lanes.facts),
    lanes: { facts: num(lanes.facts), lowRisk: num(lanes.lowRisk), decision: num(lanes.decision) },
    conflicts: num(v.conflicts),
    checkFirst: num(v.checkFirst),
    oursAhead: num(v.oursAhead),
  };
}

/** The count, or null when the answer is not one (an older server, or a body meant for another read). */
export function readCount(v: unknown): CountAnswer | null {
  const c = countOf(v);
  if (!c || !isObj(v)) return null;
  return {
    ...c,
    lastReadAt: typeof v.lastReadAt === "string" ? v.lastReadAt : null,
    lastReadWhole: v.lastReadWhole === true,
    decides: readDoor(v.decides),
    paySetBy: readDoor(v.paySetBy),
    reader: isObj(v.reader)
      ? { mayRead: typeof v.reader.mayRead === "boolean" ? v.reader.mayRead : null, decides: v.reader.decides === true }
      : undefined,
    drafts: Array.isArray(v.drafts)
      ? v.drafts.filter((d): d is { id: string; changes: number } => isObj(d) && typeof d.id === "string" && typeof d.changes === "number")
      : [],
  };
}

const READS: readonly SnapshotRead[] = ["whole", "not-asked", "failed", "cut-short", "empty"];
const readOf = (v: unknown): SnapshotRead => (READS.includes(v as SnapshotRead) ? (v as SnapshotRead) : "failed");

function listedOf(v: unknown): ListedDifference | null {
  if (!isObj(v) || typeof v.key !== "string" || !isObj(v.subject) || !isObj(v.words)) return null;
  if (typeof v.words.sentence !== "string" || v.words.sentence === "") return null;
  const w = v.words;
  return {
    ...(v as unknown as Difference),
    flags: Array.isArray(v.flags) ? (v.flags as Difference["flags"]) : [],
    batchId: typeof v.batchId === "string" && v.batchId !== "" ? v.batchId : null,
    setAside: v.setAside === true,
    changedHereAt: typeof v.changedHereAt === "string" ? v.changedHereAt : null,
    words: {
      sentence: w.sentence as string,
      flags: Array.isArray(w.flags) ? w.flags.filter((f): f is string => typeof f === "string") : [],
      source: typeof w.source === "string" ? w.source : "",
      open: typeof w.open === "string" && w.open.startsWith("https://") ? w.open : null,
      openWords: typeof w.openWords === "string" ? w.openWords : "",
    },
  };
}

/** The list, or null when the answer is not one. A row the page cannot say in words is left out. */
export function readList(v: unknown): ListAnswer | null {
  if (!isObj(v) || typeof v.agent !== "string" || !Array.isArray(v.differences)) return null;
  const count = countOf(v.count);
  if (!count) return null;
  const reads = isObj(v.reads) ? { circles: readOf(v.reads.circles), roles: readOf(v.reads.roles) } : null;
  const whole = isObj(v.lastWholeAt) ? v.lastWholeAt : null;
  return {
    agent: v.agent.trim() || "The outside service",
    lastReadAt: typeof v.lastReadAt === "string" ? v.lastReadAt : null,
    lastReadWhole: v.lastReadWhole === true,
    reads,
    count,
    differences: v.differences.map(listedOf).filter((d): d is ListedDifference => d !== null),
    lastWholeAt: whole
      ? { circles: typeof whole.circles === "string" ? whole.circles : null, roles: typeof whole.roles === "string" ? whole.roles : null }
      : null,
    circleOrder: Array.isArray(v.circleOrder) ? v.circleOrder.filter((c): c is string => typeof c === "string") : [],
    heldBatches: Array.isArray(v.heldBatches) ? v.heldBatches.filter((c): c is string => typeof c === "string") : [],
    inDraft: Array.isArray(v.inDraft) ? v.inDraft.map(inDraftOf).filter((g): g is InDraftGroup => g !== null) : [],
  };
}

function inDraftOf(v: unknown): InDraftGroup | null {
  if (!isObj(v) || typeof v.draftId !== "string" || !Array.isArray(v.items)) return null;
  const items = v.items.filter((i): i is { key: string; sentence: string } => isObj(i) && typeof i.key === "string" && typeof i.sentence === "string");
  return { draftId: v.draftId, title: typeof v.title === "string" ? v.title : null, items, with: num(v.with) };
}

// ── What waits ──────────────────────────────────────────────────────────────

export interface Waiting {
  /** Decisions, and every conflict whatever its lane: a person settles each one. */
  toDecide: ListedDifference[];
  /** Low-risk changes that wait only because automatic apply is off. */
  small: ListedDifference[];
  /** The service's facts that changed since yesterday. They wait for nobody. */
  facts: ListedDifference[];
  /** Changed here, still the old way there. Never a difference to act on. */
  oursAhead: ListedDifference[];
}

/** R29: the headline counts only what waits for a person, by the rule the count uses (shared/seraWaiting.ts). */
export function splitWaiting(list: readonly ListedDifference[]): Waiting {
  const out: Waiting = { toDecide: [], small: [], facts: [], oursAhead: [] };
  for (const d of list) out[waitingKind(d)].push(d);
  return out;
}

/** "Sera's", "Agents'": the same rule the sentences use. */
export const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** The module whose differences these are, and whose old batches fold away once they are listed. */
export const SERA_MODULE = "saberra";

/** "1 change", "5 changes". */
export const changes = (n: number): string => `${n} ${n === 1 ? "change" : "changes"}`;

// ── Groups by circle (R37, R31) ─────────────────────────────────────────────

/** Groups longer than this start collapsed (R37). */
export const GROUP_OPEN_MAX = 8;

export interface Row {
  d: ListedDifference;
  /** Roles the service adds inside a circle it adds, nested under that circle (R31). */
  nested: ListedDifference[];
}

export interface CircleGroup {
  key: string;
  /** The circle's name, or null for roles in no circle. */
  name: string | null;
  rows: Row[];
  /** Every difference in the group, nested ones included. */
  size: number;
}

/** The circle a difference concerns: the circle itself, or the one a role sits in (US2.3). */
export function circleKeyOf(d: Difference): string {
  // One key for a page id on both sides (shared pageKey), so a new circle and its roles meet (review C4).
  if (d.subject.kind === "circle") return d.subject.ourId ?? `sera:${pageKey(d.subject.pageId ?? d.key)}`;
  const id = d.subject.circleId;
  return id === null ? "none" : id.startsWith("sera:") ? `sera:${pageKey(id.slice(5))}` : id;
}

/** A row shows Check first when the server sent it a flag to show; a flag left off the screen lifts nothing (R39). */
export const checkFirst = (d: ListedDifference): boolean => d.words.flags.length > 0;
/** Check first rows to the top, everything else in the order the server sent (R37). */
const flaggedFirst = <T>(items: T[], of: (t: T) => ListedDifference): T[] =>
  items.map((t, i) => ({ t, i })).sort((a, b) => Number(checkFirst(of(b.t))) - Number(checkFirst(of(a.t))) || a.i - b.i).map((x) => x.t);
const fold = (s: string) => s.normalize("NFKD").toLowerCase();

/**
 * The groups in chart order (US2.3): the circles here as the chart orders
 * them, then circles that are not here yet by name, then roles in no circle.
 */
export function groupByCircle(list: readonly ListedDifference[], chartOrder: readonly string[] = []): CircleGroup[] {
  const groups = new Map<string, { name: string | null; items: ListedDifference[] }>();
  for (const d of list) {
    const key = circleKeyOf(d);
    const g = groups.get(key) ?? { name: null, items: [] };
    // The circle's own name wins over the name a role carries for it.
    if (d.subject.kind === "circle") g.name = d.subject.name;
    else if (g.name === null && key !== "none") g.name = d.subject.circleName;
    g.items.push(d);
    groups.set(key, g);
  }
  // A group nothing names is "Not in a circle": one such group, never two.
  for (const [key, g] of Array.from(groups.entries())) {
    if (key === "none" || g.name !== null) continue;
    const none = groups.get("none") ?? { name: null, items: [] };
    none.items.push(...g.items);
    groups.set("none", none);
    groups.delete(key);
  }
  const out: CircleGroup[] = [];
  for (const [key, g] of Array.from(groups.entries())) {
    const adds = g.items.find((d) => d.kind === "circleAdd" && d.subject.ourId === null);
    const nests = (d: ListedDifference) => !!adds && d.kind === "roleAdd" && d.subject.ourId === null;
    const nested = flaggedFirst(g.items.filter(nests), (d) => d);
    const top = g.items.filter((d) => !nests(d)).map((d): Row => ({ d, nested: d === adds ? nested : [] }));
    // A new circle leads its group, so its roles read beneath it.
    const ordered = flaggedFirst(top, (r) => r.d).sort((a, b) => Number(b.d === adds) - Number(a.d === adds));
    out.push({ key, name: g.name, rows: ordered, size: g.items.length });
  }
  const rank = (g: CircleGroup) => {
    const i = chartOrder.indexOf(g.key);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return out.sort(
    (a, b) =>
      Number(a.key === "none") - Number(b.key === "none") ||
      rank(a) - rank(b) ||
      fold(a.name ?? "").localeCompare(fold(b.name ?? "")),
  );
}

/** The group's heading, its count in the text (R37). */
export const groupHeading = (g: CircleGroup): string => `${g.name ?? "Not in a circle"}: ${changes(g.size)}`;

// ── The page's own words (R29, R36, R38) ────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayMonth = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d);

/** "14:05" today, "14:05 on 5 Nov" any other day, in the reader's own zone. */
export function clockWords(iso: string | null, now: Date = new Date()): string | null {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return null;
  const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  return sameDay(t, now) ? hm : `${hm} on ${dayMonth(t)}`;
}

/** "Last checked 14:05 today.", "Last checked 14:05 yesterday.", "Last checked 14:05 on 3 Nov." */
export function lastCheckedWords(iso: string | null, now: Date = new Date()): string | null {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return null;
  const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(t, now)) return `Last checked ${hm} today.`;
  if (sameDay(t, yesterday)) return `Last checked ${hm} yesterday.`;
  return `Last checked ${hm} on ${dayMonth(t)}.`;
}

/** In step: the last read was whole, nothing waits, and no draft is open (R29). */
export function inStep(list: Pick<ListAnswer, "lastReadAt" | "lastReadWhole">, w: Waiting, draftOpen: boolean): boolean {
  return list.lastReadAt !== null && list.lastReadWhole && w.toDecide.length === 0 && w.small.length === 0 && !draftOpen;
}

/** The headline: only what waits for a person (R29). */
export function headlineWords(agent: string, w: Waiting, step: boolean): string {
  if (w.toDecide.length > 0) return `${agent} suggests ${changes(w.toDecide.length)} for you to decide`;
  if (w.small.length > 0) return `${agent} suggests ${w.small.length} small ${w.small.length === 1 ? "change" : "changes"}`;
  if (step) return `The chart and ${agent} are in step`;
  return `Nothing from ${agent} waits for you`;
}

/** R29: the small changes that wait because automatic apply is off. Null when there are none. */
export function smallWords(w: Waiting): string | null {
  const n = w.small.length;
  if (n === 0) return null;
  if (w.toDecide.length === 0) return `${n === 1 ? "It waits" : "They wait"} for you, because automatic apply is off.`;
  return `${n} small ${n === 1 ? "change also waits" : "changes also wait"} for you, because automatic apply is off.`;
}

/** R29: the facts that updated by themselves, on their own line. Null when there are none. */
export function factsWords(w: Waiting): string | null {
  const n = w.facts.length;
  if (n === 0) return null;
  return n === 1 ? "1 fact updated by itself since yesterday." : `${n} facts updated by themselves since yesterday.`;
}

/** R36: our changes the service has not caught up with. Null when there are none. */
export function aheadWords(agent: string, n: number): string | null {
  if (n === 0) return null;
  const lead = n === 1 ? "1 thing you changed here is still the old way" : `${n} things you changed here are still the old way`;
  return `${lead} in ${agent}. ${agent} doesn't hear about changes made here, so update ${n === 1 ? "it" : "them"} in ${agent} if you want both to match.`;
}

/** How a kind came out of the last read, in words. Keyed by the union, so a new read word is a build error here. */
const READ_WORDS: Record<SnapshotRead, string> = {
  whole: "came through",
  "not-asked": "weren't asked for",
  failed: "didn't come through",
  "cut-short": "came through cut short",
  empty: "came back empty",
};

const KIND_WORDS = { circles: ["Circles", "circles"], roles: ["Roles", "roles"] } as const;

export interface ReadTrouble {
  /** Both kinds failed: the service did not answer. */
  noAnswer: boolean;
  /** One sentence per kind that did not read whole, then which kind is current. */
  lines: string[];
}

/**
 * R36: what the last read could not bring. Null when it read whole, or when
 * nothing was ever read. A failed kind keeps the read before it (R5), so the
 * list is never emptied by it.
 */
export function readTrouble(list: Pick<ListAnswer, "lastReadAt" | "reads" | "lastWholeAt">, now: Date = new Date()): ReadTrouble | null {
  if (!list.reads || list.lastReadAt === null) return null;
  const at = clockWords(list.lastReadAt, now) ?? "the last check";
  const bad = (["circles", "roles"] as const).filter((k) => list.reads![k] !== "whole");
  if (bad.length === 0) return null;
  const since = (k: "circles" | "roles") => {
    const t = clockWords(list.lastWholeAt?.[k] ?? null, now);
    return t ? `the ${t} check` : "the last full check";
  };
  if (bad.length === 2 && list.reads.circles === "failed" && list.reads.roles === "failed") {
    const times = [list.lastWholeAt?.circles ?? null, list.lastWholeAt?.roles ?? null];
    const one = times[0] !== null && times[0] === times[1] ? clockWords(times[0], now) : null;
    return { noAnswer: true, lines: [`This list is from the last full check${one ? `, at ${one}` : ""}. Nothing changed on the chart.`] };
  }
  const lines = bad.map((k) => `${KIND_WORDS[k][0]} ${READ_WORDS[list.reads![k]]} at ${at}, so ${KIND_WORDS[k][1]} show ${since(k)}.`);
  if (bad.length === 1) lines.push(`${KIND_WORDS[bad[0] === "roles" ? "circles" : "roles"][0]} are current.`);
  return { noAnswer: false, lines };
}

// ── The merged diff (R33) ───────────────────────────────────────────────────

export type DiffPart = { text: string; side: "both" | "here" | "sera" };

/** Beyond this many word pairs the middle is shown as replaced whole, never computed. */
const DIFF_CELLS_MAX = 250_000;

/**
 * One merged diff, word by word: "here" is only in our words, "sera" only in
 * the service's. Within each change, ours comes first, so it reads as struck
 * then underlined (R33). The words are kept as they were typed.
 */
export function mergedDiff(here: string, sera: string): DiffPart[] {
  const a = here.split(/\s+/).filter(Boolean);
  const b = sera.split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops: DiffPart[] = a.slice(0, start).map((text) => ({ text, side: "both" as const }));
  if (midA.length * midB.length > DIFF_CELLS_MAX) {
    ops.push(...midA.map((text) => ({ text, side: "here" as const })), ...midB.map((text) => ({ text, side: "sera" as const })));
  } else {
    const n = midA.length;
    const m = midB.length;
    const lcs = new Uint32Array((n + 1) * (m + 1));
    const at = (i: number, j: number) => i * (m + 1) + j;
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lcs[at(i, j)] = midA[i] === midB[j] ? lcs[at(i + 1, j + 1)] + 1 : Math.max(lcs[at(i + 1, j)], lcs[at(i, j + 1)]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        ops.push({ text: midA[i], side: "both" });
        i += 1;
        j += 1;
      } else if (j >= m || (i < n && lcs[at(i + 1, j)] >= lcs[at(i, j + 1)])) {
        ops.push({ text: midA[i], side: "here" });
        i += 1;
      } else {
        ops.push({ text: midB[j], side: "sera" });
        j += 1;
      }
    }
  }
  ops.push(...a.slice(endA).map((text) => ({ text, side: "both" as const })));
  // Join runs, and put each change's struck words before its underlined ones.
  const out: DiffPart[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].side === "both") {
      const run: string[] = [];
      while (k < ops.length && ops[k].side === "both") run.push(ops[k++].text);
      out.push({ text: run.join(" "), side: "both" });
      continue;
    }
    const gone: string[] = [];
    const came: string[] = [];
    while (k < ops.length && ops[k].side !== "both") (ops[k].side === "here" ? gone : came).push(ops[k++].text);
    if (gone.length) out.push({ text: gone.join(" "), side: "here" });
    if (came.length) out.push({ text: came.join(" "), side: "sera" });
  }
  return out;
}

/** A difference whose two values are words a person can compare: a name or a text field. */
export const comparable = (d: Difference): boolean => (d.kind === "rename" || d.kind === "textField") && typeof d.sera === "string";
