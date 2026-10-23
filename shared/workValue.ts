/**
 * WHAT A PIECE OF WORK IS WORTH, AND WHAT IT PAYS (0265).
 *
 * Rye, 2026-10-21: every quest carries a value from the moment it is created,
 * and quest and role cards show every token assigned to them, or "inquire for
 * payment details" when no value has been set. The value is held in the
 * village's own currency and the token amounts sit beside it. Gratitude is
 * never one of them: its only job is sharing out the cycle pool.
 *
 * This file is the shape both ends agree on, and the one reader of the stored
 * columns. The server decides what a list actually pays, under the village's
 * mint rule ceilings (server/lib/economy.ts `quoteWorkPay`); the client only
 * renders what the server sent.
 *
 * ABSENT AND ZERO ARE DIFFERENT FACTS, three times over:
 *
 *   value null       nobody has set a value, so the card says to inquire
 *   value 0          somebody decided this work carries no money value
 *   tokens null      the work has no list of its own; the village's standard
 *                    mint rules pay it, as they did before 0265
 *   tokens []        the work pays no tokens
 *
 * A token with no price is shown as its amount and nothing else. A card never
 * converts a token into money, because a token only has a price when the
 * exchange posts one, and "no price set" is not "worth nothing".
 */

/** The value of a piece of work, in minor units of a currency. */
export interface WorkValue {
  minor: number;
  currency: string;
}

/** One token amount a piece of work names, in human units. */
export interface TokenAmount {
  token: string;
  amount: number;
}

/** One line the platform will actually pay, ready to render. */
export interface PayLine {
  token: string;
  /** The token's live display name, so a rename reaches every card. */
  name: string;
  /** Human units, after the village's ceiling. */
  amount: number;
  /** True when the village's mint rule ceiling lowered the amount the work names. */
  capped: boolean;
}

/**
 * Where the lines came from.
 *
 *   own        the work's own list
 *   standard   the village's standard mint rules, because the work has no list
 */
export type PaySource = "own" | "standard";

/** Cash a role's agreement records. Stated on the card, never paid by the platform. */
export interface StatedCash {
  kind: string;
  currency: string | null;
  minor: number | null;
  minMinor: number | null;
  maxMinor: number | null;
  per: "month" | "moon" | null;
}

/** Everything a card needs to say what a piece of work pays. */
export interface WorkPay {
  value: WorkValue | null;
  lines: PayLine[];
  source: PaySource;
  /** A quest pays once, at consent. A role pays each seat every cycle. */
  cadence: "once" | "cycle";
  /** Roles only, and only for a reader allowed to read the role's terms. */
  cash?: StatedCash | null;
}

/** The most token lines one piece of work may name. */
export const VALUE_TOKENS_MAX = 8;

/** The largest value one piece of work may carry, in minor units. */
export const VALUE_MINOR_MAX = 1_000_000_000_000;

/** The largest single token amount one piece of work may name. */
export const TOKEN_AMOUNT_MAX = 1_000_000_000;

/** The one token that never pays for work. */
// The refusal states the rule and never what the token does (Rye, 2026-10-22).
export const GRATITUDE_NEVER_PAYS = "Quests and roles are not paid in Gratitude.";

/**
 * The stored list, read tolerantly. NULL stays NULL (no list of its own); junk
 * reads as an empty list, which pays nothing, rather than as a list nobody wrote.
 */
export function readValueTokens(raw: unknown): TokenAmount[] | null {
  if (raw === null || raw === undefined) return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: TokenAmount[] = [];
  for (const item of parsed) {
    const token = String((item as any)?.token ?? "").trim();
    const amount = Number((item as any)?.amount);
    if (!token || !Number.isFinite(amount) || amount <= 0) continue;
    if (out.some((t) => t.token === token)) continue;
    out.push({ token, amount });
  }
  return out;
}

/** The stored value, read tolerantly. Either half missing means no value. */
export function readWorkValue(minor: unknown, currency: unknown): WorkValue | null {
  if (minor === null || minor === undefined || minor === "") return null;
  const n = Number(minor);
  const code = String(currency ?? "").trim().toUpperCase();
  if (!Number.isFinite(n) || n < 0 || !/^[A-Z]{3}$/.test(code)) return null;
  return { minor: Math.trunc(n), currency: code };
}

/**
 * A checked edit. A field that is `undefined` was not in the body and is left
 * alone; `null` clears it on purpose.
 */
export type WorkValueInput =
  | { ok: true; valueMinor: number | null | undefined; tokens: TokenAmount[] | null | undefined }
  | { ok: false; error: string };

/**
 * What a steward typed, checked before anything is stored.
 *
 * `valueMinor` and `valueTokens` are read only when the body carries them, so
 * a save that edits a quest's title leaves its value alone. `valueMinor: null`
 * clears the value on purpose. The currency is never read from the body: the
 * server stamps the village's own currency at the moment of the save.
 *
 * `isPayable` is the server's question about a slug (a platform token the
 * engine can issue). Gratitude is refused by name before it is asked.
 */
export function readWorkValueInput(
  body: Record<string, unknown> | null | undefined,
  isPayable: (slug: string) => string | null,
): WorkValueInput {
  const bag = body ?? {};
  // A key holding `undefined` is a key JSON would never have carried, so it is absent.
  const hasValue = bag.valueMinor !== undefined;
  const hasTokens = bag.valueTokens !== undefined;
  if (!hasValue && !hasTokens) return { ok: true, valueMinor: undefined, tokens: undefined };

  let valueMinor: number | null = null;
  if (hasValue && bag.valueMinor !== null && bag.valueMinor !== "") {
    const n = Number(bag.valueMinor);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: "A value is a whole number of the currency's smallest unit." };
    if (n < 0) return { ok: false, error: "A value is zero or more." };
    if (n > VALUE_MINOR_MAX) return { ok: false, error: "That value is larger than this platform records." };
    valueMinor = n;
  }

  let tokens: TokenAmount[] | null = null;
  if (hasTokens && bag.valueTokens !== null) {
    if (!Array.isArray(bag.valueTokens)) return { ok: false, error: "The token amounts are a list." };
    if (bag.valueTokens.length > VALUE_TOKENS_MAX) {
      return { ok: false, error: `A piece of work names at most ${VALUE_TOKENS_MAX} tokens.` };
    }
    tokens = [];
    for (const item of bag.valueTokens) {
      const token = String((item as any)?.token ?? "").trim();
      if (!token) return { ok: false, error: "Each token amount names its token." };
      if (token === "gratitude") return { ok: false, error: GRATITUDE_NEVER_PAYS };
      const amount = Number((item as any)?.amount);
      if (!Number.isFinite(amount)) return { ok: false, error: `The amount for ${token} is not a number.` };
      if (amount < 0) return { ok: false, error: `The amount for ${token} is zero or more.` };
      if (amount > TOKEN_AMOUNT_MAX) return { ok: false, error: `The amount for ${token} is larger than this platform records.` };
      if (tokens.some((t) => t.token === token)) return { ok: false, error: `${token} is named twice.` };
      // Zero is a decision to pay none of this token, so it is dropped rather than stored as a line.
      if (amount === 0) continue;
      const problem = isPayable(token);
      if (problem) return { ok: false, error: problem };
      tokens.push({ token, amount });
    }
  }
  return {
    ok: true,
    valueMinor: hasValue ? valueMinor : undefined,
    tokens: hasTokens ? tokens : undefined,
  };
}

/** The list as it is stored: JSON, or NULL for no list of its own. */
export function valueTokensToStore(tokens: TokenAmount[] | null | undefined): string | null {
  if (tokens === null || tokens === undefined) return null;
  return JSON.stringify(tokens.map((t) => ({ token: t.token, amount: t.amount })));
}
