/**
 * The wizard's shared validators, each answering with a sentence or null.
 *
 * Moved out of wizardConfig.ts, unchanged, when that file reached the monolith
 * ratchet's 1000-line threshold (scripts/check-file-lines.mjs). A proposal type
 * that lives in its own file (roleSeatType.ts) speaks with the same sentences
 * as every type in the config, and neither file imports the other at runtime.
 */

export const required = (what: string) => (v: unknown) =>
  String(v ?? "").trim() ? null : `${what} is the part only you can write. It cannot be blank`;

export const atLeast = (n: number, what: string) => (v: unknown) =>
  String(v ?? "").trim().length >= n ? null : `${what} needs at least ${n} characters so the village can weigh it`;

export const pct = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "That needs to be a number between 0 and 100";
  if (n < 0 || n > 100) return "A percentage runs from 0 to 100";
  return null;
};

export const positive = (what: string) => (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return `${what} has to be more than zero`;
  return null;
};

export const changesPresent = (v: unknown) =>
  Array.isArray(v) && v.length > 0 ? null : "Pick at least one dial to change, and say what it becomes";
