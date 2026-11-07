/**
 * CHANGING SERA'S INBOX TAKES A SECOND SIGNER (invoice rails, C7).
 *
 * Rye, 2026-11-06, relayed by the master coordinator: changing the inbox
 * "needs a second cash.pay or steward holder whenever 2+ exist, with every
 * member notified of the new address before their next send. It redirects
 * every member's invoices, so the higher bar is right even with legal names
 * removed."
 *
 *   - A NEW ADDRESS WAITS while two or more people can sign. The settings
 *     keep the old one; the new one sits in its own document until a second
 *     signer, never the proposer, confirms it. Any signer may cancel it.
 *   - CLEARING APPLIES AT ONCE. An empty inbox only stops mail, which is the
 *     safe direction, and it drops any change still waiting.
 *   - WITH ONE SIGNER OR NONE the change applies at once, as before.
 *   - EVERY MEMBER IS TOLD the moment a new address applies, and My moon names
 *     the address beside the send button, so nobody sends to one they have
 *     not been shown.
 *   - Every step writes an audit line.
 *
 * Signers are the live holders of `cash.pay` and of `steward.veto`, read
 * through the one capability gate's holder lookup by the caller.
 */
import type { Pool } from "mysql2/promise";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { SETTINGS_DOC_KEY } from "../../shared/moonRecap";

export const PENDING_INBOX_DOC_KEY = "sera-inbox-pending";

export interface PendingInbox {
  address: string;
  proposedBy: string;
  proposedAt: string;
}

export interface InboxDeps {
  getPool(): Pool;
  /** Everyone who may sign: live holders of cash.pay and steward.veto. */
  signers(): Promise<string[]>;
  /** Tell every member the new address. Answers how many were told. */
  notifyAll(address: string, actorUserId: string): Promise<number>;
  audit(text: string, actorUserId: string): Promise<void>;
  now(): Date;
}

export type InboxOutcome = { ok: true; address: string | null; notified: number } | { ok: false; status: number; error: string };

export async function pendingInbox(pool: Pool): Promise<PendingInbox | null> {
  const raw = await readConfigDocument<Partial<PendingInbox>>(pool, PENDING_INBOX_DOC_KEY);
  return raw && typeof raw.address === "string" && raw.address && typeof raw.proposedBy === "string"
    ? { address: raw.address, proposedBy: raw.proposedBy, proposedAt: String(raw.proposedAt ?? "") }
    : null;
}

const clearPending = (pool: Pool) => writeConfigDocument(pool, PENDING_INBOX_DOC_KEY, {});

/**
 * A settings save that names an inbox: what the settings should hold now,
 * and the change left waiting, if any.
 */
export async function decideInbox(deps: InboxDeps, before: string | null, wanted: string | null, actorUserId: string): Promise<{ apply: string | null; pending: PendingInbox | null }> {
  const pool = deps.getPool();
  if (wanted === before) return { apply: before, pending: await pendingInbox(pool) };
  if (wanted === null) {
    await clearPending(pool);
    await deps.audit("sera-inbox:cleared", actorUserId);
    return { apply: null, pending: null };
  }
  const signers = new Set(await deps.signers());
  if (signers.size >= 2) {
    const pending: PendingInbox = { address: wanted, proposedBy: actorUserId, proposedAt: deps.now().toISOString() };
    await writeConfigDocument(pool, PENDING_INBOX_DOC_KEY, { ...pending });
    await deps.audit("sera-inbox:proposed", actorUserId);
    return { apply: before, pending };
  }
  await clearPending(pool);
  await deps.notifyAll(wanted, actorUserId);
  await deps.audit("sera-inbox:changed", actorUserId);
  return { apply: wanted, pending: null };
}

/** The second signer applies the waiting address to the settings as they are now. */
export async function confirmInboxChange(deps: InboxDeps, actorUserId: string): Promise<InboxOutcome> {
  const pool = deps.getPool();
  const pending = await pendingInbox(pool);
  if (!pending) return { ok: false, status: 409, error: "No change to Sera's inbox is waiting." };
  if (!(await deps.signers()).includes(actorUserId)) return { ok: false, status: 403, error: "Only a holder of cash.pay or of the steward veto can confirm this." };
  if (pending.proposedBy === actorUserId) return { ok: false, status: 409, error: "A second holder confirms the change. It cannot be the person who proposed it." };
  const settings = (await readConfigDocument<Record<string, unknown>>(pool, SETTINGS_DOC_KEY)) ?? {};
  await writeConfigDocument(pool, SETTINGS_DOC_KEY, { ...settings, seraInbox: pending.address });
  await clearPending(pool);
  const notified = await deps.notifyAll(pending.address, actorUserId);
  await deps.audit("sera-inbox:confirmed", actorUserId);
  return { ok: true, address: pending.address, notified };
}

export async function cancelInboxChange(deps: InboxDeps, actorUserId: string): Promise<InboxOutcome> {
  const pool = deps.getPool();
  if (!(await deps.signers()).includes(actorUserId)) return { ok: false, status: 403, error: "Only a holder of cash.pay or of the steward veto can cancel this." };
  if (!(await pendingInbox(pool))) return { ok: false, status: 409, error: "No change to Sera's inbox is waiting." };
  await clearPending(pool);
  await deps.audit("sera-inbox:cancelled", actorUserId);
  return { ok: true, address: null, notified: 0 };
}
