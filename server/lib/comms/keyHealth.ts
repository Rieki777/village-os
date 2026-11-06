/**
 * IS THE RESEND KEY ALIVE: the post office's own test send, read back.
 *
 * Rye, 2026-10-13: a plant is green only once a live check has passed, and the
 * Resend key's check reuses what comms already has. "Send me a test" in Comms
 * Settings (server/routes/commsSettings.ts) posts a `comms.test` email to the
 * signed-in admin's own address through the post office, onto the ledger,
 * and item 13 of the comms setup checklist reads the latest such row reaching
 * `delivered` (`testEmailDelivered`, ./setup.ts). That is a real send from the
 * village's own sender, reported delivered by the provider, which proves the
 * key, its permission, the domain and the sender in one go. This file asks the
 * same question for the launch journey's `resend-key` row and the setup game's
 * seed, so neither keeps a second opinion about it.
 *
 * Nothing here sends. It reads.
 */
import type { Pool } from "mysql2/promise";
import { latestTestEmail, type TestEmailRow } from "../../repos/commsOverview";
import { testEmailDelivered, testProvesKey } from "./setup";

export type KeyHealth = { state: "ok" | "missing" | "partial"; detail: string };

/** The answer, from the key's presence and the latest `comms.test` row. Pure. */
export function resendKeyHealth(key: { configured: boolean; source?: string; setAt?: string | null }, test: TestEmailRow | null): KeyHealth {
  if (!key.configured) return { state: "missing", detail: "No Resend key, no email leaves this deployment" };
  // A test sent before this key was saved proved the key before it (testProvesKey, ./setup.ts).
  if (test && !testProvesKey(test, key)) {
    return { state: "partial", detail: "A new key was saved after the last test email. Send yourself a test from Comms Settings to prove this one" };
  }
  if (testEmailDelivered(test)) return { state: "ok", detail: "The last test email was reported delivered" };
  if (!test) {
    return { state: "partial", detail: "A key is set and no test email has shown it works yet. Send yourself a test from Comms Settings" };
  }
  if (test.status === "sent") return { state: "partial", detail: "The last test email was sent and is waiting for its delivery report" };
  if (test.status === "queued" || test.status === "sending") return { state: "partial", detail: "The last test email is still on its way" };
  return { state: "missing", detail: `The last test email did not arrive: ${test.lastError ?? test.skipReason ?? test.status}` };
}

/** The `resend-key` launch row. */
export async function resendKeyLaunchCheck(pool: Pool, key: { configured: boolean; source?: string; setAt?: string | null }): Promise<KeyHealth> {
  return resendKeyHealth(key, key.configured ? await latestTestEmail(pool) : null);
}
