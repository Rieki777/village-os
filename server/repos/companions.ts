/**
 * THE COMPANION TABLES' ONE ENUMERABLE HOME (0295).
 *
 * Every statement against `companions`, `companion_items` and
 * `companion_messages` is here, so the erasure sweep and anybody asking "who
 * reads this table" has one file to read. The policy (the cap, the evidence
 * rule, which door a yes opens) is server/lib/companions.ts, and nothing here
 * decides who may see what.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type {
  CompanionProvider,
  CompanionScope,
  CompanionStatus,
  DraftKind,
  ItemOrigin,
  ItemStatus,
  ItemType,
} from "../../shared/companionItems";

type Q = Pool | PoolConnection;

export interface CompanionRow {
  id: string;
  ownerUserId: string;
  scope: CompanionScope;
  scopeId: string;
  provider: CompanionProvider;
  name: string;
  look: string | null;
  dailyQuestionCap: number;
  status: CompanionStatus;
  sortOrder: number;
}

export interface ItemRow {
  id: string;
  companionId: string;
  ownerUserId: string;
  type: ItemType;
  draftKind: DraftKind | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  quote: string | null;
  sourceRef: string | null;
  sourceOccurredAt: string | null;
  origin: ItemOrigin;
  externalRef: string | null;
  dedupeKey: string;
  blocking: boolean;
  dueOn: string | null;
  dayKey: string;
  status: ItemStatus;
  answer: string | null;
  editedFields: string[] | null;
  outcomeRef: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface MessageRow {
  id: number;
  companionId: string;
  speaker: "member" | "companion";
  engine: string;
  body: string;
  createdAt: string;
}

const COMPANION_COLS =
  "id, owner_user_id, scope, scope_id, provider, name, look, daily_question_cap, status, sort_order";
const ITEM_COLS =
  "id, companion_id, owner_user_id, type, draft_kind, title, body, payload, quote, source_ref, source_occurred_at, origin, " +
  "external_ref, dedupe_key, blocking, DATE_FORMAT(due_on, '%Y-%m-%d') AS due_on, DATE_FORMAT(day_key, '%Y-%m-%d') AS day_key, " +
  "status, answer, edited_fields, outcome_ref, decided_at, created_at";

function json<T>(v: unknown): T | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return null;
  }
}

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function toCompanion(r: RowDataPacket): CompanionRow {
  return {
    id: String(r.id),
    ownerUserId: String(r.owner_user_id),
    scope: r.scope,
    scopeId: String(r.scope_id ?? ""),
    provider: r.provider,
    name: String(r.name),
    look: r.look == null ? null : String(r.look),
    dailyQuestionCap: Number(r.daily_question_cap),
    status: r.status,
    sortOrder: Number(r.sort_order),
  };
}

function toItem(r: RowDataPacket): ItemRow {
  return {
    id: String(r.id),
    companionId: String(r.companion_id),
    ownerUserId: String(r.owner_user_id),
    type: r.type,
    draftKind: r.draft_kind ?? null,
    title: String(r.title),
    body: r.body ?? null,
    payload: json<Record<string, unknown>>(r.payload),
    quote: r.quote ?? null,
    sourceRef: r.source_ref ?? null,
    sourceOccurredAt: iso(r.source_occurred_at),
    origin: r.origin,
    externalRef: r.external_ref ?? null,
    dedupeKey: String(r.dedupe_key),
    blocking: Number(r.blocking) === 1,
    dueOn: r.due_on ?? null,
    dayKey: String(r.day_key),
    status: r.status,
    answer: r.answer ?? null,
    editedFields: json<string[]>(r.edited_fields),
    outcomeRef: r.outcome_ref ?? null,
    decidedAt: iso(r.decided_at),
    createdAt: iso(r.created_at) ?? "",
  };
}

// ── companions ───────────────────────────────────────────────────────────

export async function companionsOf(pool: Q, ownerUserId: string): Promise<CompanionRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COMPANION_COLS} FROM companions WHERE owner_user_id = ? ORDER BY sort_order, created_at, id`,
    [ownerUserId],
  );
  return rows.map(toCompanion);
}

export async function companionById(pool: Q, id: string): Promise<CompanionRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${COMPANION_COLS} FROM companions WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? toCompanion(rows[0]) : null;
}

/** Insert a companion, or leave the one already there for this (owner, scope, scope id). */
export async function insertCompanionIfAbsent(
  pool: Q,
  c: Omit<CompanionRow, "status"> & { status?: CompanionStatus },
): Promise<void> {
  await pool.query(
    "INSERT IGNORE INTO companions (id, owner_user_id, scope, scope_id, provider, name, look, daily_question_cap, status, sort_order) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)",
    [c.id, c.ownerUserId, c.scope, c.scopeId, c.provider, c.name, c.look, c.dailyQuestionCap, c.status ?? "active", c.sortOrder],
  );
}

export async function updateCompanion(
  pool: Q,
  id: string,
  patch: Partial<Pick<CompanionRow, "name" | "look" | "dailyQuestionCap" | "status" | "sortOrder" | "provider">>,
): Promise<void> {
  const cols: string[] = [];
  const args: unknown[] = [];
  const map: Record<string, string> = {
    name: "name",
    look: "look",
    dailyQuestionCap: "daily_question_cap",
    status: "status",
    sortOrder: "sort_order",
    provider: "provider",
  };
  for (const [k, col] of Object.entries(map)) {
    if ((patch as Record<string, unknown>)[k] === undefined) continue;
    cols.push(`${col} = ?`);
    args.push((patch as Record<string, unknown>)[k]);
  }
  if (cols.length === 0) return;
  await pool.query(`UPDATE companions SET ${cols.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...args, id]);
}

/** Active companions on one role or quest owned by anybody outside `keep`. */
export async function activeScopeCompanionsOutside(pool: Q, scope: CompanionScope, scopeId: string, keep: readonly string[]): Promise<CompanionRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COMPANION_COLS} FROM companions WHERE scope = ? AND scope_id = ? AND status <> 'retired'`,
    [scope, scopeId],
  );
  return rows.map(toCompanion).filter((c) => !keep.includes(c.ownerUserId));
}

/**
 * A role passed on: undecided items of the retired companions on that role
 * move to the new holder's companion. A decided item keeps its decision where
 * it was made.
 */
export async function adoptScopeItems(pool: Q, scope: CompanionScope, scopeId: string, to: CompanionRow): Promise<number> {
  const [r]: any = await pool.query(
    "UPDATE companion_items SET companion_id = ?, owner_user_id = ? WHERE status IN ('open','held') AND companion_id IN " +
      "(SELECT id FROM (SELECT id FROM companions WHERE scope = ? AND scope_id = ? AND status = 'retired' AND id <> ?) AS gone)",
    [to.id, to.ownerUserId, scope, scopeId, to.id],
  );
  return Number(r?.affectedRows ?? 0);
}

// ── items ────────────────────────────────────────────────────────────────

export interface NewItem {
  id: string;
  companionId: string;
  ownerUserId: string;
  type: ItemType;
  draftKind: DraftKind | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  quote: string | null;
  sourceRef: string | null;
  sourceOccurredAt: Date | null;
  origin: ItemOrigin;
  externalRef: string | null;
  dedupeKey: string;
  blocking: boolean;
  dueOn: string | null;
  dayKey: string;
  status: ItemStatus;
}

/** Insert an item. False when its dedupe key is already stored (the same item, landing twice). */
export async function insertItem(pool: Q, it: NewItem): Promise<boolean> {
  const [r]: any = await pool.query(
    "INSERT IGNORE INTO companion_items (id, companion_id, owner_user_id, type, draft_kind, title, body, payload, quote, source_ref, " +
      "source_occurred_at, origin, external_ref, dedupe_key, blocking, due_on, day_key, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      it.id, it.companionId, it.ownerUserId, it.type, it.draftKind, it.title, it.body,
      it.payload ? JSON.stringify(it.payload) : null, it.quote, it.sourceRef, it.sourceOccurredAt, it.origin,
      it.externalRef, it.dedupeKey, it.blocking ? 1 : 0, it.dueOn, it.dayKey, it.status,
    ],
  );
  return Number(r?.affectedRows ?? 0) === 1;
}

export async function itemById(pool: Q, id: string): Promise<ItemRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${ITEM_COLS} FROM companion_items WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? toItem(rows[0]) : null;
}

export async function itemByDedupeKey(pool: Q, key: string): Promise<ItemRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${ITEM_COLS} FROM companion_items WHERE dedupe_key = ? LIMIT 1`, [key]);
  return rows[0] ? toItem(rows[0]) : null;
}

/** Every item of these companions a member still reads: undecided, and anything decided this week. */
export async function itemsForCompanions(pool: Q, companionIds: readonly string[], since: string): Promise<ItemRow[]> {
  if (companionIds.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ITEM_COLS} FROM companion_items WHERE companion_id IN (${companionIds.map(() => "?").join(",")}) ` +
      "AND (status IN ('open','held') OR decided_at >= ?) ORDER BY blocking DESC, created_at, id",
    [...companionIds, since],
  );
  return rows.map(toItem);
}

/** One member's undecided drafts of one kind. */
export async function openDraftsOfKind(pool: Q, ownerUserId: string, kind: DraftKind): Promise<ItemRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${ITEM_COLS} FROM companion_items WHERE owner_user_id = ? AND type = 'draft' AND draft_kind = ? AND status = 'open'`,
    [ownerUserId, kind],
  );
  return rows.map(toItem);
}

/** Questions this companion has shown on one day, held ones left out. The cap counts this. */
export async function questionsShownOn(pool: Q, companionId: string, dayKey: string): Promise<number> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM companion_items WHERE companion_id = ? AND type = 'question' AND day_key = ? AND status <> 'held'",
    [companionId, dayKey],
  );
  return Number(row?.n ?? 0);
}

/**
 * Who speaks for the circle a budget belongs to: the live member holders of
 * its active seats flagged `represents_circle` (the third door of
 * `mayDeclare`, server/lib/orgChart.ts). Null for a budget that does not
 * exist or is an example.
 */
export async function circleSpeakersForBudget(pool: Q, budgetId: string): Promise<{ circleId: string; holders: string[] } | null> {
  const [budgets] = await pool.query<RowDataPacket[]>("SELECT circle_id FROM circle_budgets WHERE id = ? AND is_example = 0", [budgetId]);
  if (!budgets[0]) return null;
  const circleId = String(budgets[0].circle_id);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT a.user_id FROM org_role_assignments a JOIN org_roles r ON r.id = a.org_role_id " +
      "WHERE r.circle_id = ? AND r.active = 1 AND r.is_example = 0 AND r.represents_circle = 1 " +
      "AND a.ended_at IS NULL AND a.holder_kind = 'member' AND a.is_example = 0 AND a.user_id IS NOT NULL ORDER BY a.user_id",
    [circleId],
  );
  return { circleId, holders: rows.map((r) => String(r.user_id)) };
}

/**
 * Held questions that carry their evidence, oldest first. A question held for
 * want of a source never opens, so it is never listed here.
 */
export async function releasableHeld(pool: Q, companionId: string, limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM companion_items WHERE companion_id = ? AND type = 'question' AND status = 'held' " +
      "AND quote IS NOT NULL AND quote <> '' AND source_ref IS NOT NULL AND source_ref <> '' ORDER BY created_at, id LIMIT ?",
    [companionId, limit],
  );
  return rows.map((r) => String(r.id));
}

export async function openHeld(pool: Q, ids: readonly string[], dayKey: string): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(
    `UPDATE companion_items SET status = 'open', day_key = ? WHERE status = 'held' AND id IN (${ids.map(() => "?").join(",")})`,
    [dayKey, ...ids],
  );
}

/** Open questions shown on or before `lastShownDay` expire. Returns how many. */
export async function expireQuestions(pool: Q, lastShownDay: string, ownerUserId?: string): Promise<number> {
  const [r]: any = await pool.query(
    "UPDATE companion_items SET status = 'expired', decided_at = CURRENT_TIMESTAMP WHERE type = 'question' AND status = 'open' AND day_key <= ?" +
      (ownerUserId ? " AND owner_user_id = ?" : ""),
    ownerUserId ? [lastShownDay, ownerUserId] : [lastShownDay],
  );
  return Number(r?.affectedRows ?? 0);
}

/**
 * Move an undecided item to a decided status, once. False when it was already
 * decided, which is how two yeses on one draft open its door once: the second
 * finds nothing to claim.
 */
export async function decideItem(
  pool: Q,
  id: string,
  from: readonly ItemStatus[],
  to: ItemStatus,
  fields: { answer?: string | null; editedFields?: string[] | null; outcomeRef?: string | null; payload?: Record<string, unknown> | null } = {},
): Promise<boolean> {
  const sets = ["status = ?", "decided_at = CURRENT_TIMESTAMP"];
  const args: unknown[] = [to];
  if (fields.answer !== undefined) { sets.push("answer = ?"); args.push(fields.answer); }
  if (fields.editedFields !== undefined) { sets.push("edited_fields = ?"); args.push(fields.editedFields ? JSON.stringify(fields.editedFields) : null); }
  if (fields.outcomeRef !== undefined) { sets.push("outcome_ref = ?"); args.push(fields.outcomeRef); }
  if (fields.payload !== undefined) { sets.push("payload = ?"); args.push(fields.payload ? JSON.stringify(fields.payload) : null); }
  const [r]: any = await pool.query(
    `UPDATE companion_items SET ${sets.join(", ")} WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`,
    [...args, id, ...from],
  );
  return Number(r?.affectedRows ?? 0) === 1;
}

/** A claimed yes whose door refused goes back to open, with nothing recorded. */
export async function reopenItem(pool: Q, id: string, from: ItemStatus): Promise<void> {
  await pool.query(
    "UPDATE companion_items SET status = 'open', decided_at = NULL, edited_fields = NULL, outcome_ref = NULL WHERE id = ? AND status = ?",
    [id, from],
  );
}

export async function setItemPayload(pool: Q, id: string, payload: Record<string, unknown>): Promise<void> {
  await pool.query("UPDATE companion_items SET payload = ? WHERE id = ?", [JSON.stringify(payload), id]);
}

// ── chat ─────────────────────────────────────────────────────────────────

export async function addMessage(pool: Q, m: { companionId: string; ownerUserId: string; speaker: "member" | "companion"; engine: string; body: string }): Promise<number> {
  const [r]: any = await pool.query(
    "INSERT INTO companion_messages (companion_id, owner_user_id, speaker, engine, body) VALUES (?,?,?,?,?)",
    [m.companionId, m.ownerUserId, m.speaker, m.engine, m.body],
  );
  return Number(r?.insertId ?? 0);
}

/** The most recent `limit` messages of one companion's chat, oldest first. */
export async function recentMessages(pool: Q, companionId: string, ownerUserId: string, limit: number): Promise<MessageRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, companion_id, speaker, engine, body, created_at FROM companion_messages WHERE companion_id = ? AND owner_user_id = ? " +
      "ORDER BY id DESC LIMIT ?",
    [companionId, ownerUserId, limit],
  );
  return rows
    .map((r) => ({ id: Number(r.id), companionId: String(r.companion_id), speaker: r.speaker, engine: String(r.engine), body: String(r.body), createdAt: iso(r.created_at) ?? "" }))
    .reverse();
}

// ── erasure ──────────────────────────────────────────────────────────────

/**
 * Everything of one member's companions: the chats, the items and the
 * companions themselves. Chat first, then items, then the companions, so a
 * sweep that dies part way leaves nothing pointing at a companion that is
 * gone. Idempotent: a second run deletes nothing.
 */
export async function forgetCompanionsForMember(pool: Q, userId: string): Promise<void> {
  await pool.query("DELETE FROM companion_messages WHERE owner_user_id = ?", [userId]);
  await pool.query("DELETE FROM companion_items WHERE owner_user_id = ?", [userId]);
  await pool.query("DELETE FROM companions WHERE owner_user_id = ?", [userId]);
}

// ── the live roster, as companions read it ───────────────────────────────

export interface HeldRole {
  roleId: string;
  name: string;
}

/** The live roles a member holds as a member, examples left out. */
export async function rolesHeldBy(pool: Q, userId: string): Promise<HeldRole[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT r.id, r.name FROM org_role_assignments a JOIN org_roles r ON r.id = a.org_role_id " +
      "WHERE a.ended_at IS NULL AND a.holder_kind = 'member' AND a.is_example = 0 AND a.user_id = ? ORDER BY r.name",
    [userId],
  );
  return rows.map((r) => ({ roleId: String(r.id), name: String(r.name) }));
}

/** Each role's name and its live holders (id and display name), for "Role (FirstName)". */
export async function rosterFor(pool: Q, roleIds: readonly string[]): Promise<Map<string, { name: string; holders: { id: string; name: string }[] }>> {
  const out = new Map<string, { name: string; holders: { id: string; name: string }[] }>();
  if (roleIds.length === 0) return out;
  const marks = roleIds.map(() => "?").join(",");
  const [roles] = await pool.query<RowDataPacket[]>(`SELECT id, name FROM org_roles WHERE id IN (${marks})`, [...roleIds]);
  for (const r of roles) out.set(String(r.id), { name: String(r.name), holders: [] });
  const [held] = await pool.query<RowDataPacket[]>(
    "SELECT a.org_role_id, u.id, u.name FROM org_role_assignments a JOIN users u ON u.id = a.user_id " +
      `WHERE a.ended_at IS NULL AND a.holder_kind = 'member' AND a.is_example = 0 AND a.org_role_id IN (${marks}) ORDER BY a.started_at, a.id`,
    [...roleIds],
  );
  for (const h of held) out.get(String(h.org_role_id))?.holders.push({ id: String(h.id), name: String(h.name ?? "") });
  return out;
}

/** Display names and handles of members, for a draft that names a member. */
export async function membersByIds(pool: Q, ids: readonly string[]): Promise<Map<string, { name: string; handle: string | null }>> {
  const out = new Map<string, { name: string; handle: string | null }>();
  if (ids.length === 0) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, handle FROM users WHERE id IN (${ids.map(() => "?").join(",")})`,
    [...ids],
  );
  for (const r of rows) out.set(String(r.id), { name: String(r.name ?? ""), handle: r.handle ?? null });
  return out;
}
