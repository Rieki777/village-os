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
 * What a village STORED under a key, whether or not the registry still knows
 * the key. For a migration reading a dial whose variable has since left the
 * registry, and for nothing else: every rule reads through `variable`, which
 * refuses an unknown key so that a typo can never read as 0.
 */
export function storedOverride(key: string): string | undefined {
  return overrides[key];
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

export interface SetResult {
  ok: boolean;
  error?: string;
  key: string;
  value?: string;
  previous?: string;
}

/** Write one override after validating it. Returns the previous value for audit. */
export async function setVariable(pool: Pool, key: string, raw: string): Promise<SetResult> {
  const def = VARIABLES_BY_KEY[key];
  if (!def) return { ok: false, key, error: `Unknown variable: ${key}` };

  const value = String(raw).trim();
  const error = validateVariable(def, value);
  if (error) return { ok: false, key, error };

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
