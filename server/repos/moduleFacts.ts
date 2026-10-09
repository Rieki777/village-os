/**
 * `module_entity_facts`: what a module knows about a seat or a circle that this
 * village's own chart does not model.
 *
 * ── WHAT IT HOLDS AND WHAT IT REFUSES TO INTERPRET ───────────────────────
 *
 * `fields` is a JSON object under the VENDOR'S OWN key names, and nothing in
 * this file reads a value. That is the structural form of a promise made
 * elsewhere: an enumeration nobody has sent us cannot be acted on if no code
 * can name it. What may be in there at all is decided one layer up by the
 * allow list in `server/lib/saberraRecords.ts`, and no field that names a
 * person is in that list.
 *
 * ── THE REVOCATION GRAIN ─────────────────────────────────────────────────
 *
 * `module_id` is a plain string and not a foreign key, exactly as in
 * `external_proposals`. Migration 0140 states the rule and this table obeys it:
 * turning a module off is the lever a village has, so every row that module
 * produced has to be findable by that id alone. `forgetModuleFacts` is that
 * lever and it is the reason this file exists rather than a few columns on
 * `org_roles`.
 *
 * ── WHY A RECORD CAN ARRIVE BEFORE ITS SEAT ──────────────────────────────
 *
 * `entity_id` is nullable and `attaches_to` carries the NAME the vendor used.
 * A circle the service holds and this village has not created yet still has
 * detail worth keeping, and a proposal is reviewed before any seat exists to
 * point at. Nullable is the honest state; resolving it later is a join by name
 * that a steward can correct.
 *
 * ── STRICT MYSQL ─────────────────────────────────────────────────────────
 *
 * Every string a vendor sends is CLIPPED to its column width here rather than
 * at the call site. A value one character over its column is not a truncation
 * warning on this server, it is a refused INSERT, and the caller is a sync that
 * would then land nothing and say nothing.
 */
import { createHash } from "crypto";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/** Column widths, so a clip here is the same number the schema enforces. */
const WIDTH = {
  moduleId: 64,
  villageId: 64,
  entityKind: 24,
  entityId: 96,
  vendorKind: 40,
  vendorRecordId: 200,
  attachesTo: 200,
  sourceUrl: 400,
} as const;

function clip(v: string | null | undefined, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length <= max ? s : s.slice(0, max);
}

export interface FactInput {
  entityKind: string;
  entityId?: string | null;
  vendorKind: string;
  vendorRecordId: string;
  attachesTo?: string | null;
  fields: Record<string, unknown>;
  sourceUrl?: string | null;
  observedAt?: string | null;
}

export interface FactRow {
  moduleId: string;
  entityKind: string;
  entityId: string | null;
  vendorKind: string;
  vendorRecordId: string;
  attachesTo: string | null;
  fields: Record<string, unknown>;
  sourceUrl: string | null;
  /** Seconds since the epoch, read as a number so a host offset cannot shift it. */
  updatedAt: number;
}

/**
 * A stable id from the three columns the unique key covers.
 *
 * Deterministic so a re-sync of the same record reuses its row rather than
 * racing the unique index and losing the insert to a duplicate-key error that
 * the caller would have to distinguish from a real failure.
 */
function factId(moduleId: string, vendorKind: string, vendorRecordId: string): string {
  return createHash("sha256").update(`${moduleId}\u0000${vendorKind}\u0000${vendorRecordId}`).digest("hex").slice(0, 32);
}

/**
 * Write what a module knows, replacing what it knew before about the same
 * records and leaving everything else alone.
 *
 * Returns how many rows were written, so a sync can say what it did rather
 * than report success and leave a steward guessing.
 */
export async function upsertFacts(
  pool: Pool,
  villageId: string,
  moduleId: string,
  facts: readonly FactInput[],
): Promise<number> {
  if (facts.length === 0) return 0;
  const mid = clip(moduleId, WIDTH.moduleId) ?? "";
  let written = 0;
  for (const f of facts) {
    const vendorKind = clip(f.vendorKind, WIDTH.vendorKind) ?? "";
    const vendorRecordId = clip(f.vendorRecordId, WIDTH.vendorRecordId) ?? "";
    if (mid === "" || vendorKind === "" || vendorRecordId === "") continue;
    const [res] = await pool.query<ResultSetHeader>(
      "INSERT INTO module_entity_facts " +
        "(id, village_id, module_id, entity_kind, entity_id, vendor_kind, vendor_record_id, attaches_to, fields, source_url, observed_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE entity_kind = VALUES(entity_kind), entity_id = VALUES(entity_id), " +
        "attaches_to = VALUES(attaches_to), fields = VALUES(fields), source_url = VALUES(source_url), " +
        "observed_at = VALUES(observed_at)",
      [
        factId(mid, vendorKind, vendorRecordId),
        clip(villageId, WIDTH.villageId) ?? "",
        mid,
        clip(f.entityKind, WIDTH.entityKind) ?? "",
        clip(f.entityId ?? null, WIDTH.entityId),
        vendorKind,
        vendorRecordId,
        clip(f.attachesTo ?? null, WIDTH.attachesTo),
        JSON.stringify(f.fields ?? {}),
        clip(f.sourceUrl ?? null, WIDTH.sourceUrl),
        f.observedAt ?? null,
      ],
    );
    if (res.affectedRows > 0) written += 1;
  }
  return written;
}

function toRow(r: RowDataPacket): FactRow {
  let fields: Record<string, unknown> = {};
  const raw = r.fields;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) fields = raw as Record<string, unknown>;
  else if (typeof raw === "string") {
    // mysql2 parses a JSON column for us on most drivers and hands back a
    // string on some. A vendor's own text is not trusted to parse, so a bad
    // value answers an empty object and never throws into a page render.
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fields = parsed as Record<string, unknown>;
    } catch {
      fields = {};
    }
  }
  return {
    moduleId: String(r.module_id),
    entityKind: String(r.entity_kind),
    entityId: r.entity_id === null ? null : String(r.entity_id),
    vendorKind: String(r.vendor_kind),
    vendorRecordId: String(r.vendor_record_id),
    attachesTo: r.attaches_to === null ? null : String(r.attaches_to),
    fields,
    sourceUrl: r.source_url === null ? null : String(r.source_url),
    updatedAt: Number(r.updated_at_unix ?? 0),
  };
}

const SELECT =
  "SELECT module_id, entity_kind, entity_id, vendor_kind, vendor_record_id, attaches_to, fields, source_url, " +
  "UNIX_TIMESTAMP(updated_at) AS updated_at_unix FROM module_entity_facts ";

/** Everything any module knows about one seat or circle, newest first. */
export async function factsForEntity(pool: Pool, entityKind: string, entityId: string): Promise<FactRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${SELECT}WHERE entity_kind = ? AND entity_id = ? ORDER BY updated_at DESC, vendor_record_id ASC`,
    [entityKind, entityId],
  );
  return rows.map(toRow);
}

/**
 * Facts a module has not been able to attach to a row here yet, looked up by
 * the NAME the vendor used. This is how a panel finds detail for a circle that
 * exists in both places under the same name and has never been linked.
 */
export async function factsByName(pool: Pool, moduleId: string, entityKind: string): Promise<Map<string, FactRow>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${SELECT}WHERE module_id = ? AND entity_kind = ? AND attaches_to IS NOT NULL ORDER BY updated_at ASC`,
    [moduleId, entityKind],
  );
  const out = new Map<string, FactRow>();
  // Ascending order with a plain set means the NEWEST wins on a duplicate name.
  for (const r of rows) {
    const row = toRow(r);
    if (row.attachesTo) out.set(row.attachesTo, row);
  }
  return out;
}

/**
 * THE REVOCATION LEVER. Everything one module ever wrote, gone.
 *
 * This is the function that earns the table its shape. It is why `module_id` is
 * a plain string, and it is what "turning a module off takes its rows with it"
 * has to mean to be true rather than said.
 */
export async function forgetModuleFacts(pool: Pool, moduleId: string): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>("DELETE FROM module_entity_facts WHERE module_id = ?", [moduleId]);
  return res.affectedRows;
}

/** How many rows a module holds, for an admin card that should say a number. */
export async function moduleFactCount(pool: Pool, moduleId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM module_entity_facts WHERE module_id = ?",
    [moduleId],
  );
  return Number(rows[0]?.n ?? 0);
}
