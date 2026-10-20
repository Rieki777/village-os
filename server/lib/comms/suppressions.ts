/**
 * THE SUPPRESSION LIST: addresses that receive essential mail and nothing else
 * (the comms build spec 5.3).
 *
 * WHO WRITES HERE:
 *
 *   - the delivery reports (server/lib/comms/webhook.ts): a permanent bounce,
 *     a bounce of unknown type, a complaint, and the provider's own
 *     suppression of an address;
 *   - the people lane: "stop everything" (`unsubscribed_all`), a manual
 *     suppress from the People screen, and erasure;
 *   - and nothing else.
 *
 * WHO READS IT: the post office, at insert time and again at send time,
 * before it asks about permission. Essential mail ignores it, because the
 * person just asked for that email.
 *
 * Each function takes a pool, or anything carrying `getPool()` (the post
 * office's deps, the journey deps), and an address or the key of one: an
 * address is folded to its key here, the one way it is folded everywhere
 * (`emailKeyOf`).
 */
import type { Pool } from "mysql2/promise";
import { emailKeyOf } from "../../../shared/comms/address";
import { SUPPRESSION_REASONS, type SuppressionReason } from "../../../shared/comms/kinds";
import {
  deleteSuppression,
  suppressionByKey,
  suppressionRows,
  upsertSuppression,
  type SuppressionRow,
} from "../../repos/commsSuppressions";

export type { SuppressionRow };

/** A pool, or the deps object most comms code already carries. */
export type PoolSource = Pool | { getPool(): Pool };

const poolOf = (src: PoolSource): Pool =>
  typeof (src as { getPool?: unknown }).getPool === "function" ? (src as { getPool(): Pool }).getPool() : (src as Pool);

/** The key an address or a key is filed under. A caller's empty address is a bug, said in words. */
function keyOf(emailOrKey: string): string {
  const key = emailKeyOf(emailOrKey);
  if (!key) throw new RangeError("suppressions: an address is required");
  return key;
}

const isReason = (v: unknown): v is SuppressionReason => (SUPPRESSION_REASONS as readonly string[]).includes(String(v));

/** True when this address receives nothing but essential mail. */
export async function isSuppressed(src: PoolSource, emailOrKey: string): Promise<boolean> {
  const key = emailKeyOf(emailOrKey);
  if (!key) return false;
  return (await suppressionByKey(poolOf(src), key)) !== null;
}

/** The suppression on one address, with its reason, or null. */
export async function suppressionOf(src: PoolSource, emailOrKey: string): Promise<SuppressionRow | null> {
  const key = emailKeyOf(emailOrKey);
  return key ? suppressionByKey(poolOf(src), key) : null;
}

export interface AddSuppressionInput {
  /** The address, or its key. One of the two. */
  email?: string;
  emailKey?: string;
  reason: SuppressionReason;
  /** Why, in words a person will read on the People screen. */
  detail?: string | null;
  /** A user id, or `provider` for a delivery report. */
  createdBy?: string | null;
}

/**
 * Suppress an address. A second suppression of the same address keeps the
 * stronger of the two reasons (server/repos/commsSuppressions.ts), so this is
 * safe to call from a report that arrives twice.
 *
 * Answers the reason the address is now held for, and whether this call is
 * what put it on the list.
 */
export async function addSuppression(src: PoolSource, input: AddSuppressionInput): Promise<{ added: boolean; reason: string }>;
export async function addSuppression(
  src: PoolSource,
  emailOrKey: string,
  reason: SuppressionReason,
  detail?: string | null,
  createdBy?: string | null,
): Promise<{ added: boolean; reason: string }>;
export async function addSuppression(
  src: PoolSource,
  first: string | AddSuppressionInput,
  reason?: SuppressionReason,
  detail?: string | null,
  createdBy?: string | null,
): Promise<{ added: boolean; reason: string }> {
  const input: AddSuppressionInput =
    typeof first === "string" ? { email: first, reason: reason as SuppressionReason, detail, createdBy } : first;
  if (!isReason(input.reason)) throw new RangeError(`suppressions: "${String(input.reason)}" is not a reason`);
  const key = keyOf(String(input.emailKey ?? input.email ?? ""));
  const pool = poolOf(src);
  const before = await suppressionByKey(pool, key);
  await upsertSuppression(pool, {
    emailKey: key,
    reason: input.reason,
    detail: input.detail ?? null,
    createdBy: input.createdBy ?? null,
  });
  const after = await suppressionByKey(pool, key);
  return { added: before === null, reason: after?.reason ?? input.reason };
}

/**
 * Lift the suppression on one address, and answer what it was.
 *
 * A COMPLAINT IS LIFTED ONLY WITH A REASON (5.3): somebody marked our email as
 * spam, and writing to them again is a decision a person makes on the record.
 * Without one this refuses and lifts nothing. The row is gone once lifted, so
 * the reason and `previous` are handed back for the caller's audit line.
 */
export async function removeSuppression(
  src: PoolSource,
  emailOrKey: string,
  opts: { reason?: string | null; by?: string | null } = {},
): Promise<{ removed: boolean; previous: SuppressionRow | null; refused?: string }> {
  const key = keyOf(emailOrKey);
  const pool = poolOf(src);
  const previous = await suppressionByKey(pool, key);
  if (!previous) return { removed: false, previous: null };
  if (previous.reason === "complained" && !String(opts.reason ?? "").trim()) {
    return {
      removed: false,
      previous,
      refused: "This address marked one of the village's emails as spam. Say why it is right to write to it again before lifting that.",
    };
  }
  return { removed: await deleteSuppression(pool, key), previous };
}

/** A page of the list, newest first, for the People screen. */
export async function listSuppressions(
  src: PoolSource,
  opts: { reason?: SuppressionReason | null; search?: string | null; limit?: number; offset?: number } = {},
): Promise<{ rows: SuppressionRow[]; total: number }> {
  if (opts.reason != null && !isReason(opts.reason)) throw new RangeError(`suppressions: "${String(opts.reason)}" is not a reason`);
  return suppressionRows(poolOf(src), {
    reason: opts.reason ?? null,
    search: opts.search ?? null,
    limit: opts.limit ?? 100,
    offset: opts.offset ?? 0,
  });
}
