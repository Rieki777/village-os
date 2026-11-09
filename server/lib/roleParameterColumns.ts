/**
 * WHICH ROLE PARAMETER COLUMNS THIS DATABASE HAS (role journey, PR-B).
 *
 * The parameters of a role card (listed, track, where it is worked, the
 * interviewers and the rest, shared/roleParameters.ts) live in columns the
 * listing PR adds. This branch adds no migration, so a draft may write one only
 * when the column is there, and says so in words when it is not. The question is
 * asked of the database itself, once per use, so a deploy that brings the
 * columns turns the editor's parameters on with no change here.
 *
 * `recruiting` is the door and has always been a column: it is not asked.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { JSON_PARAMETERS, PARAMETER_COLUMNS, PARAMETER_KEYS, readParameter, type ParameterKey } from "../../shared/roleParameters";

/** The parameter keys whose column exists in `org_roles` now, `recruiting` aside. */
export async function liveParameterKeys(db: Pool | PoolConnection): Promise<ParameterKey[]> {
  const keys = PARAMETER_KEYS.filter((k) => k !== "recruiting");
  const [rows]: any = await db.query(
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_roles' AND COLUMN_NAME IN (?)", // module-review-ok: asks the database which columns exist, not a table's rows
    [keys.map((k) => PARAMETER_COLUMNS[k])],
  );
  const have = new Set((rows as any[]).map((r) => String(r.c)));
  return keys.filter((k) => have.has(PARAMETER_COLUMNS[k]));
}

/** A payload's parameter keys (`recruiting` aside), in registry order. */
export function parameterKeysIn(p: Record<string, unknown> | null | undefined): ParameterKey[] {
  return PARAMETER_KEYS.filter((k) => k !== "recruiting" && p?.[k] !== undefined);
}

export const PARAMETERS_NOT_HERE = "This village's roles do not carry the listing details yet, so they cannot be changed.";

/** Why a change's parameters cannot be written, or null. Shape only: the interviewers' roles are the route's to check. */
export function parameterProblem(p: Record<string, unknown> | null | undefined): string | null {
  for (const k of parameterKeysIn(p)) {
    const r = readParameter(k, p![k]);
    if (!r.ok) return r.problem;
  }
  return null;
}

/** The column value a parameter is stored as: JSON text for a list, the value itself otherwise. */
export function parameterStored(key: ParameterKey, raw: unknown): unknown {
  const r = readParameter(key, raw);
  if (!r.ok) throw new Error(`This change cannot be published. ${r.problem}`);
  const v = r.value;
  if (JSON_PARAMETERS.has(key)) return v === null || v === undefined ? null : JSON.stringify(v);
  return v === undefined ? null : v;
}

/** The parameter columns' stored values for one role, by column name, for `before_json`. */
export async function parametersBefore(conn: PoolConnection, orgRoleId: string): Promise<Record<string, unknown>> {
  const live = await liveParameterKeys(conn);
  if (!live.length) return {};
  const cols = live.map((k) => PARAMETER_COLUMNS[k]);
  const [[row]]: any = await conn.query(`SELECT ${cols.map((c) => `\`${c}\``).join(", ")} FROM org_roles WHERE id = ?`, [orgRoleId]); // module-review-ok: a step inside the publish transaction on its own connection; server/repos/orgDrafts.ts explains why a transaction step cannot move to a repo
  return row ?? {};
}

/** Put the captured parameter columns back. Only the columns `before_json` holds are touched. */
export async function putParametersBack(conn: PoolConnection, orgRoleId: string, before: Record<string, unknown>): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const k of PARAMETER_KEYS) {
    if (k === "recruiting") continue;
    const col = PARAMETER_COLUMNS[k];
    if (!(col in before)) continue;
    const v = before[col];
    sets.push(`\`${col}\` = ?`);
    // A DATE read back from `before_json` is an ISO string; the column wants the day.
    const stored = k === "fundedFrom" && v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : v;
    args.push(stored === undefined || stored === null ? null : typeof stored === "object" && !(stored instanceof Date) ? JSON.stringify(stored) : stored);
  }
  if (!sets.length) return;
  args.push(orgRoleId);
  await conn.query(`UPDATE org_roles SET ${sets.join(", ")} WHERE id = ?`, args); // module-review-ok: a step inside the revert transaction on its own connection; server/repos/orgDrafts.ts explains why a transaction step cannot move to a repo
}
