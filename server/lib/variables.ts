/**
 * Runtime accessor for the variables registry.
 *
 * S12: overrides live in the game_variables TABLE and are cached in memory —
 * loaded at boot, written through on change. Only values a founder has
 * actually CHANGED are stored, so upgrading the platform picks up new
 * defaults instead of freezing whatever was seeded on launch day. That is the
 * opposite of regen-civics, which seeds every row via migration and therefore
 * needs a migration to change a default.
 *
 * Readers stay SYNCHRONOUS (the cache is the read path): variables sit on hot
 * paths — budget math, cycle close, consent caps — and they change through
 * exactly one admin endpoint, which is where the single async write lives.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  VARIABLES,
  VARIABLES_BY_KEY,
  parseVariable,
  validateVariable,
  type VariableDef,
} from "../../shared/gameVariables";

type Overrides = Record<string, string>;

let overrides: Overrides = {};

/** Boot-time load. Fail-loud: a server that cannot read its rules must not guess them. */
export async function loadVariables(pool: Pool): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT config_key, value FROM game_variables");
  const next: Overrides = {};
  for (const r of rows) next[String(r.config_key)] = String(r.value);
  overrides = next;
}

/** One variable, typed. Unknown keys throw, because a typo must not read as 0. */
export function variable(key: string): number | boolean | string {
  const def = VARIABLES_BY_KEY[key];
  if (!def) throw new Error(`Unknown game variable: ${key}`);
  return parseVariable(def, overrides[key]);
}

export function numberVar(key: string): number {
  const v = variable(key);
  return typeof v === "number" ? v : Number(v) || 0;
}

export function boolVar(key: string): boolean {
  const v = variable(key);
  return typeof v === "boolean" ? v : v === "true";
}

export function stringVar(key: string): string {
  return String(variable(key));
}

/**
 * The RAW effective value (override ?? default), as stored. This is the
 * string a mechanics proposal captures as its baseline and compares its
 * target against — same representation the write path validates, so a
 * proposal can never be a no-op that only looks like a change (or vice
 * versa) through a parse/format asymmetry. Unknown keys throw, as always.
 */
export function rawValue(key: string): string {
  const def = VARIABLES_BY_KEY[key];
  if (!def) throw new Error(`Unknown game variable: ${key}`);
  return overrides[key] ?? def.default;
}

/**
 * Every variable with its definition and current value, grouped for Admin.
 * `isDefault` lets the UI show what has been customised at a glance.
 */
export function allVariables(): Array<
  VariableDef & { value: string; parsed: number | boolean | string; isDefault: boolean }
> {
  return VARIABLES.map((def) => {
    const raw = overrides[def.key];
    return {
      ...def,
      value: raw ?? def.default,
      parsed: parseVariable(def, raw),
      isDefault: raw === undefined || raw === def.default,
    };
  });
}

// ── The write guard, and why it lives on THIS side of the door ──────────────

/**
 * A refusal about one proposed write, or null when the write is coherent.
 *
 * The registry answers "is this a legal value" all by itself (`validateVariable`
 * reads the def's own type and bounds). This answers the other question, the
 * one no single def can hold: whether this value COMBINED with the values the
 * village already holds describes something the engine can actually do. The
 * exit levers are the first family that needs it, and the guard has to see the
 * whole reading to judge one dial.
 */
export type VariableWriteGuard = (
  key: string,
  value: string,
  /**
   * The other dials a CHANGE SET writes beside this one, at their final
   * values. A guard reads these instead of what stands today, so a write inside
   * a set is judged against the state the set produces and never against a
   * half-written one. Absent for a single admin write, which has no set.
   */
  alongside?: Readonly<Record<string, string>>,
) => string | null;

let writeGuard: VariableWriteGuard | null = null;

/**
 * Wired ONCE at boot, beside `wireModuleAuth`, with everything the guard needs
 * to reach the published policy and the token registry. It arrives as a
 * closure so this file keeps its one import and never reaches for a repo of
 * its own: a variables cache that imported the exit policy document would
 * import the ledger and the exchange behind it, and `server/lib/economy.ts`
 * imports this file, so the cycle would run through the hottest read path
 * there is.
 *
 * A build that never wires it refuses nothing, which is the honest shape for
 * an injected seam and the one thing to know about this one. The wiring is
 * proven where it matters instead of being assumed: `exitLevers.routes.e2e.test.ts`
 * drives both doors against the BUILT server.
 */
export function wireVariableGuard(guard: VariableWriteGuard | null): void {
  writeGuard = guard;
}

/**
 * THE PREDICATE. Ask before writing, or ask INSTEAD of writing.
 *
 * `setVariable` calls this on every write, so the admin route, the governance
 * apply loop and any future writer are all judged by one function. It is also
 * exported on its own because a two-phase executor has to be able to refuse a
 * whole change set BEFORE it makes any irreversible write, and that validate
 * phase must reach the same sentence the write path would produce. One figure,
 * several callers, no second implementation to drift.
 *
 * It writes nothing, opens no transaction and needs no pool or connection:
 * everything it reads is already in memory (this file's override cache, the
 * token registry, and the exit policy document the wiring closes over).
 */
export function variableWriteRefusal(
  key: string,
  raw: string,
  alongside?: Readonly<Record<string, string>>,
): string | null {
  return writeGuard ? writeGuard(key, String(raw).trim(), alongside) : null;
}

/**
 * THE SET PREDICATE: the first refusal a whole change set's FINAL dial values
 * carry, or null. Every key is judged with every other key of the set at its
 * final value, so a set turning Voice conversion on and setting its rate and
 * share in the same breath is judged as the coherent whole it is, in whatever
 * order its elements were written. Writes nothing.
 */
export function variableSetRefusal(
  values: Readonly<Record<string, string>>,
): { key: string; sentence: string } | null {
  if (!writeGuard) return null;
  for (const [key, raw] of Object.entries(values)) {
    const sentence = writeGuard(key, String(raw).trim(), values);
    if (sentence) return { key, sentence };
  }
  return null;
}

export interface SetResult {
  ok: boolean;
  error?: string;
  key: string;
  value?: string;
  previous?: string;
}

/** Write one override after validating it. Returns the previous value for audit. */
export async function setVariable(
  pool: Pool,
  key: string,
  raw: string,
  opts: { alongside?: Readonly<Record<string, string>> } = {},
): Promise<SetResult> {
  const def = VARIABLES_BY_KEY[key];
  if (!def) return { ok: false, key, error: `Unknown variable: ${key}` };

  const value = String(raw).trim();
  const error = validateVariable(def, value);
  if (error) return { ok: false, key, error };

  // EVERY writer passes here, which is the whole point of the move. The
  // guard used to sit in the admin variables route, and the governance apply
  // loop writes through this function directly, so a passed proposal could
  // land a combination the product refuses to let an admin type.
  const refusal = variableWriteRefusal(key, value, opts.alongside);
  if (refusal) return { ok: false, key, error: refusal };

  const previous = overrides[key] ?? def.default;

  // Setting a variable back to its default REMOVES the override, so the village
  // keeps inheriting future platform defaults for anything it has not opinionated.
  if (value === def.default) {
    await pool.query("DELETE FROM game_variables WHERE config_key = ?", [key]);
    delete overrides[key];
  } else {
    await pool.query(
      "INSERT INTO game_variables (config_key, value, value_type) VALUES (?,?,?) " +
        "ON DUPLICATE KEY UPDATE value = VALUES(value), value_type = VALUES(value_type)",
      [key, value, "text"],
    );
    overrides[key] = value;
  }
  return { ok: true, key, value, previous };
}
