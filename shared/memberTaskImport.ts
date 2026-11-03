/**
 * Bringing one member's tasks in from the knowledge library ("Your list", PR 3).
 *
 * The input is what the library's `list_voice_tasks` tool answers, filtered to
 * one owner, pasted or read from a file by a steward. Nothing here calls the
 * library. The plan is a PURE function of those items and of what the
 * member's list already holds, so the dry run and the real run decide the same
 * way and a second run changes nothing the first one did.
 *
 *   High, Medium, Low          -> high, priority, not_yet (tierFromLibrary)
 *   anything else              -> priority, flagged for the steward
 *   status Done or Cancelled   -> skipped
 *   status Needs Owner         -> the steward queue, never the member's list
 *   already held, untouched    -> title, tier and due date refreshed
 *   already held and edited    -> left alone: the member's edits win
 *   removed or done by them    -> left alone: a tombstone never comes back
 */
import { TITLE_MAX, isDayKey, tierFromLibrary, type TaskStatus, type Tier } from "./memberTasks";

export interface LibraryTask {
  externalId: string;
  title: string;
  tier: Tier;
  flagged: boolean;
  dueOn: string | null;
  ownerId: string | null;
  status: string;
  /** 0 to 1 when the library sends one. */
  confidence: number | null;
}

export interface HeldTask {
  id: string;
  externalId: string;
  title: string;
  tier: Tier;
  dueOn: string | null;
  status: TaskStatus;
  memberEdited: boolean;
}

export interface ImportPlan {
  create: LibraryTask[];
  update: { id: string; next: LibraryTask }[];
  unchanged: LibraryTask[];
  keptEdits: LibraryTask[];
  tombstoned: LibraryTask[];
  skipped: { item: LibraryTask | null; why: "done" | "cancelled" | "other_owner" | "no_id" | "no_title" | "duplicate" }[];
  needsOwner: LibraryTask[];
  flagged: LibraryTask[];
}

const str = (v: unknown): string => (v == null ? "" : String(v)).trim();
const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  return undefined;
};

/** One library item to our shape, reading the field names the tool is known to use. */
export function readLibraryTask(raw: unknown): LibraryTask | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const externalId = str(pick(o, ["id", "task_id", "taskId", "external_id"]));
  const title = str(pick(o, ["title", "name", "task", "summary"])).replace(/\s+/g, " ").slice(0, TITLE_MAX);
  const { tier, flagged } = tierFromLibrary(pick(o, ["priority", "Priority"]));
  const dueRaw = str(pick(o, ["due_date", "dueDate", "due_on", "due"])).slice(0, 10);
  const ownerRaw = pick(o, ["owner_id", "ownerId", "owner"]);
  const owner = ownerRaw && typeof ownerRaw === "object" ? str((ownerRaw as Record<string, unknown>).id) : str(ownerRaw);
  return {
    externalId,
    title,
    tier,
    flagged,
    dueOn: isDayKey(dueRaw) ? dueRaw : null,
    ownerId: owner || null,
    status: str(pick(o, ["status", "Status", "state"])).toLowerCase(),
    confidence: (() => { const c = Number(pick(o, ["confidence"])); return Number.isFinite(c) && c >= 0 && c <= 1 ? c : null; })(),
  };
}

/** The items array from whatever the tool's answer looks like: an array, or `{ tasks | items | results | data }`. */
export function itemsOf(answer: unknown): unknown[] {
  // Several pages pasted together (the tool pages with a cursor): an array of answers.
  const pageOf = (p: unknown) => !!p && typeof p === "object" && !Array.isArray(p) && ["tasks", "items", "results", "data", "records", "result"].some((k) => k in (p as object));
  if (Array.isArray(answer) && answer.length > 0 && answer.every(pageOf)) return answer.flatMap((p) => itemsOf(p));
  if (Array.isArray(answer)) return answer;
  if (answer && typeof answer === "object") {
    const o = answer as Record<string, unknown>;
    for (const k of ["tasks", "items", "results", "data", "records"]) if (Array.isArray(o[k])) return o[k] as unknown[];
    if (o.result) return itemsOf(o.result);
  }
  return [];
}

export function planImport(rawItems: readonly unknown[], ownerId: string, held: readonly HeldTask[]): ImportPlan {
  const plan: ImportPlan = { create: [], update: [], unchanged: [], keptEdits: [], tombstoned: [], skipped: [], needsOwner: [], flagged: [] };
  const byExt = new Map(held.map((h) => [h.externalId, h]));
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = readLibraryTask(raw);
    if (!item || !item.externalId) { plan.skipped.push({ item, why: "no_id" }); continue; }
    if (!item.title) { plan.skipped.push({ item, why: "no_title" }); continue; }
    if (seen.has(item.externalId)) { plan.skipped.push({ item, why: "duplicate" }); continue; }
    seen.add(item.externalId);
    const s = item.status.replace(/[\s_-]+/g, " ");
    if (s === "done" || s === "completed" || s === "complete") { plan.skipped.push({ item, why: "done" }); continue; }
    if (s === "cancelled" || s === "canceled") { plan.skipped.push({ item, why: "cancelled" }); continue; }
    if (s === "needs owner") { plan.needsOwner.push(item); continue; }
    if (item.ownerId && item.ownerId !== ownerId) { plan.skipped.push({ item, why: "other_owner" }); continue; }
    if (item.flagged) plan.flagged.push(item);
    const h = byExt.get(item.externalId);
    if (!h) { plan.create.push(item); continue; }
    if (h.status !== "open") { plan.tombstoned.push(item); continue; }
    if (h.memberEdited) { plan.keptEdits.push(item); continue; }
    if (h.title === item.title && h.tier === item.tier && h.dueOn === item.dueOn) plan.unchanged.push(item);
    else plan.update.push({ id: h.id, next: item });
  }
  return plan;
}

/** What a steward reads before saying yes: counts, the first ten titles, and the items to look at. */
export function planSummary(plan: ImportPlan) {
  return {
    counts: {
      create: plan.create.length,
      update: plan.update.length,
      unchanged: plan.unchanged.length,
      keptEdits: plan.keptEdits.length,
      tombstoned: plan.tombstoned.length,
      skipped: plan.skipped.length,
      needsOwner: plan.needsOwner.length,
      flagged: plan.flagged.length,
    },
    firstTitles: plan.create.slice(0, 10).map((t) => t.title),
    flagged: plan.flagged.map((t) => ({ externalId: t.externalId, title: t.title })),
    needsOwner: plan.needsOwner.map((t) => ({ externalId: t.externalId, title: t.title })),
    skipped: plan.skipped.map((s) => ({ externalId: s.item?.externalId ?? null, title: s.item?.title ?? null, why: s.why })),
  };
}
