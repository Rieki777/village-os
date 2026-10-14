/**
 * THE KEY'S LIVE CHECK: one ledgered send to Resend's test address, through
 * the post office like every other email (Rye, 2026-10-13, on the setup game's
 * Resend seed: a plant is green only once a live check has passed).
 *
 * ── WHY A SEND, AND WHY THIS ADDRESS ──────────────────────────────────────
 *
 * A key being set has never meant email works. Resend accepts a key whose
 * sender domain was never verified and then delivers nothing, and the key a
 * village should hold (`sending_access`, restricted to its own domain) can do
 * nothing BUT send, so no read can prove it. A send can. Resend's test address
 * `delivered@resend.dev` accepts the email, records it as delivered and
 * reaches no person (resend.com/docs, "Send test emails").
 *
 * ── WHY IT CANNOT MAIL ANYBODY ELSE ───────────────────────────────────────
 *
 * The recipient is this file's constant and nothing else. `probeEmail` takes
 * no address, the route takes no body it reads, and the test proves both. So
 * the button that runs this can never be turned into a way to write to a
 * person.
 *
 * ── WHY IT IS ESSENTIAL MAIL ──────────────────────────────────────────────
 *
 * The same reason as "Send me a test" (server/routes/commsSettings.ts): the
 * check has to answer at every lifecycle, Pause all included, because a
 * village checks its sending before it turns anything on. Essential mail is
 * sent inside the request, its row records the provider's answer and its words
 * are never kept.
 *
 * ── WHAT IS RECORDED ──────────────────────────────────────────────────────
 *
 * The ledger row is the record: its status, when it was written and sent, and
 * the provider's words when it refused (`last_error`). `latestTestEmail` reads
 * it back by origin, and `probeReading` turns it into what a plant's health
 * and the launch row show.
 */
import type { Pool } from "mysql2/promise";
import type { OutgoingEmail } from "../../../shared/comms/contracts";
import { PROBE_EMAIL_ORIGIN, latestTestEmail, type TestEmailRow } from "../../repos/commsOverview";
import { escapeHtml } from "./mailer";

/** Resend's own test recipient. The ONLY address the probe ever writes to. */
export const RESEND_PROBE_RECIPIENT = "delivered@resend.dev";

/** One probe a minute for the whole village: each one spends a send from the village's quota. */
export const PROBE_COOLDOWN_MS = 60_000;

/** The probe email. No recipient parameter, on purpose. */
export function probeEmail(villageName: string, nonce: string): OutgoingEmail {
  const text =
    `This message checks that ${villageName} can send email. ` +
    "It goes to Resend's test address and reaches nobody.";
  return {
    idempotencyKey: `${PROBE_EMAIL_ORIGIN}:${nonce}`,
    kind: "essential",
    origin: PROBE_EMAIL_ORIGIN,
    to: { email: RESEND_PROBE_RECIPIENT, name: null, userId: null },
    subject: `An email check from ${villageName}`,
    html: `<!doctype html><html><body><p>${escapeHtml(text)}</p></body></html>`,
    text,
    urgent: true,
  };
}

/**
 * What the last probe found.
 *
 *   alive    Resend accepted it (or reported it delivered).
 *   failed   the provider refused it, or it could not be sent; `reason` says why.
 *   pending  written and not yet answered.
 *   none     no probe has run.
 */
export interface ProbeReading {
  state: "alive" | "failed" | "pending" | "none";
  /** Epoch seconds of the attempt, or null. */
  at: number | null;
  /** The provider's words, or the skip reason, when it did not go. */
  reason: string | null;
}

export function probeReading(row: TestEmailRow | null): ProbeReading {
  if (!row) return { state: "none", at: null, reason: null };
  const at = row.sentAt ?? row.createdAt;
  if (row.status === "sent" || row.status === "delivered" || row.deliveredReport) return { state: "alive", at, reason: null };
  if (row.status === "queued" || row.status === "sending") return { state: "pending", at, reason: null };
  return { state: "failed", at, reason: row.lastError ?? row.skipReason ?? row.status };
}

export async function latestProbe(pool: Pool): Promise<ProbeReading> {
  return probeReading(await latestTestEmail(pool, PROBE_EMAIL_ORIGIN));
}

/**
 * The `resend-key` row on the launch journey, read from the last probe and
 * never from the key's presence alone. A key with no probe behind it is
 * `partial`: set, and not yet shown to work.
 */
export async function resendKeyLaunchCheck(
  pool: Pool,
  key: { configured: boolean },
): Promise<{ state: "ok" | "missing" | "partial"; detail: string }> {
  if (!key.configured) return { state: "missing", detail: "No Resend key, no email leaves this deployment" };
  const p = await latestProbe(pool);
  if (p.state === "alive") return { state: "ok", detail: "Resend accepted the last test send to its test address" };
  if (p.state === "failed") return { state: "missing", detail: `The last test send did not go: ${p.reason}` };
  return { state: "partial", detail: "A key is set and no test send has shown it works yet. Run the key check in Comms Settings" };
}
