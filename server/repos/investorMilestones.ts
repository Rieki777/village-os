/**
 * The investor path's own tables (drizzle/0349): invitations, raised hands,
 * homes handed over and parcels sold. SQL only; the rules that decide whether
 * a write may happen live in shared/investorPath.ts and the order of a write
 * in server/lib/investorMilestones.ts.
 *
 * NO AMOUNT IS READ OR WRITTEN HERE. The ledger is the only thing that says how
 * much (server/lib/ledger.ts, decision 5 as amended 2026-11-09).
 */
import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Single-village build, matching server/repos/investorPath.ts. */
const VILLAGE = "local";

const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 12)}`;
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

// ── Invitations ─────────────────────────────────────────────────────────────

export interface InvitationRow {
  id: string;
  way: string;
  title: string;
  body: string | null;
  placeRef: string | null;
  status: "open" | "closed";
  closedReason: string | null;
  createdAt: string;
}

const toInvitation = (r: RowDataPacket): InvitationRow => ({
  id: String(r.id),
  way: String(r.way),
  title: String(r.title),
  body: r.body == null ? null : String(r.body),
  placeRef: r.place_ref == null ? null : String(r.place_ref),
  status: r.status === "closed" ? "closed" : "open",
  closedReason: r.closed_reason == null ? null : String(r.closed_reason),
  createdAt: iso(r.created_at),
});

export async function insertInvitation(
  pool: Pool,
  input: { way: string; title: string; body?: string | null; placeRef?: string | null; createdBy: string | null },
): Promise<string> {
  const id = newId("inv");
  await pool.query(
    "INSERT INTO investor_invitations (id, village_id, way, title, body, place_ref, created_by) VALUES (?,?,?,?,?,?,?)",
    [id, VILLAGE, input.way, input.title, input.body ?? null, input.placeRef ?? null, input.createdBy],
  );
  await insertInvitationHistory(pool, id, "opened", null, input.createdBy);
  return id;
}

export async function insertInvitationHistory(
  pool: Pool,
  invitationId: string,
  change: string,
  detail: string | null,
  changedBy: string | null,
): Promise<void> {
  await pool.query(
    "INSERT INTO investor_invitation_history (id, invitation_id, `change`, detail, changed_by) VALUES (?,?,?,?,?)",
    [newId("invh"), invitationId, change, detail, changedBy],
  );
}

/** Close an OPEN invitation. False when it was already closed or does not exist. */
export async function closeInvitationRow(pool: Pool, id: string, reason: string): Promise<boolean> {
  const [r]: any = await pool.query(
    "UPDATE investor_invitations SET status = 'closed', closed_reason = ? WHERE village_id = ? AND id = ? AND status = 'open'",
    [reason, VILLAGE, id],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

export async function invitationById(pool: Pool, id: string): Promise<InvitationRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM investor_invitations WHERE village_id = ? AND id = ? LIMIT 1",
    [VILLAGE, id],
  );
  return rows[0] ? toInvitation(rows[0]) : null;
}

export async function listInvitations(pool: Pool, opts: { way?: string } = {}): Promise<InvitationRow[]> {
  const where = ["village_id = ?"];
  const args: unknown[] = [VILLAGE];
  if (opts.way) {
    where.push("way = ?");
    args.push(opts.way);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM investor_invitations WHERE ${where.join(" AND ")} ORDER BY created_at, id LIMIT 500`,
    args,
  );
  return rows.map(toInvitation);
}

export async function invitationHistory(
  pool: Pool,
  invitationId: string,
): Promise<Array<{ change: string; detail: string | null; changedBy: string | null; at: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `change`, detail, changed_by, at FROM investor_invitation_history WHERE invitation_id = ? ORDER BY at, id",
    [invitationId],
  );
  return rows.map((r) => ({
    change: String(r.change),
    detail: r.detail == null ? null : String(r.detail),
    changedBy: r.changed_by == null ? null : String(r.changed_by),
    at: iso(r.at),
  }));
}

// ── Raised hands ────────────────────────────────────────────────────────────

/** How many hands this person has open on this way, and how many they raised this moon (withdrawn ones count). */
export async function handCounts(pool: Pool, userId: string, way: string, moon: string): Promise<{ openOnWay: number; raisedThisMoon: number }> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    "SELECT " +
      "(SELECT COUNT(*) FROM investor_intents WHERE village_id = ? AND user_id = ? AND way = ? AND status = 'open') AS open_on_way, " +
      "(SELECT COUNT(*) FROM investor_intents WHERE village_id = ? AND user_id = ? AND moon = ?) AS this_moon",
    [VILLAGE, userId, way, VILLAGE, userId, moon],
  );
  return { openOnWay: Number(row?.open_on_way ?? 0), raisedThisMoon: Number(row?.this_moon ?? 0) };
}

/**
 * Insert an open hand. `null` when the person already holds an open hand on
 * this way: the unique key on `open_key` decides it, so two requests arriving
 * together cannot both open one.
 */
export async function insertIntent(
  pool: Pool,
  input: { userId: string; way: string; invitationId: string | null; moon: string; routedKind: string; routedRef: string | null },
): Promise<string | null> {
  const id = newId("int");
  try {
    await pool.query(
      "INSERT INTO investor_intents (id, village_id, user_id, way, invitation_id, moon, routed_kind, routed_ref, open_key) " +
        "VALUES (?,?,?,?,?,?,?,?,?)",
      [id, VILLAGE, input.userId, input.way, input.invitationId, input.moon, input.routedKind, input.routedRef, `${input.userId}:${input.way}`],
    );
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") return null;
    throw e;
  }
  return id;
}

/** Withdraw one of this person's open hands. The row stays, and still counts toward the moon. */
export async function withdrawIntentRow(pool: Pool, userId: string, intentId: string): Promise<boolean> {
  const [r]: any = await pool.query(
    "UPDATE investor_intents SET status = 'withdrawn', open_key = NULL, ended_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND id = ? AND user_id = ? AND status = 'open'",
    [VILLAGE, intentId, userId],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

// ── Homes handed over and parcels sold ──────────────────────────────────────

/** Record a handover. `null` when that home was already handed over (one per home, the unique key decides). */
export async function insertHomeHandover(
  pool: Pool,
  input: { homeRef: string; reservationId: string | null; userId: string; recordedBy: string },
): Promise<string | null> {
  const id = newId("ihh");
  try {
    await pool.query(
      "INSERT INTO investor_home_handovers (id, village_id, home_ref, reservation_id, user_id, recorded_by) VALUES (?,?,?,?,?,?)",
      [id, VILLAGE, input.homeRef, input.reservationId, input.userId, input.recordedBy],
    );
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") return null;
    throw e;
  }
  return id;
}

/** Record a parcel sale. `null` when the parcel was already sold. */
export async function insertParcelSale(
  pool: Pool,
  input: { invitationId: string; userId: string | null; recordedBy: string },
): Promise<string | null> {
  const id = newId("ips");
  try {
    await pool.query(
      "INSERT INTO investor_parcel_sales (id, village_id, invitation_id, user_id, recorded_by) VALUES (?,?,?,?,?)",
      [id, VILLAGE, input.invitationId, input.userId, input.recordedBy],
    );
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") return null;
    throw e;
  }
  return id;
}

/** The badge metric `homes_handed_over`: homes per member. */
export async function homesHandedOverByMember(pool: Pool): Promise<Map<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT user_id, COUNT(*) AS v FROM investor_home_handovers WHERE village_id = ? GROUP BY user_id",
    [VILLAGE],
  );
  return new Map(rows.map((r) => [String(r.user_id), Number(r.v)]));
}

/** The badge metric `parcels_bought`: parcels per member. A sale with no known buyer counts for nobody. */
export async function parcelsBoughtByMember(pool: Pool): Promise<Map<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT user_id, COUNT(*) AS v FROM investor_parcel_sales WHERE village_id = ? AND user_id IS NOT NULL GROUP BY user_id",
    [VILLAGE],
  );
  return new Map(rows.map((r) => [String(r.user_id), Number(r.v)]));
}
