/**
 * The email guild's bee: one route that proves this village can send.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * A Resend key being SET has never meant email works. Resend answers 200 for
 * a key whose sender domain was never verified and then delivers nothing, so
 * the launch row that reads "Key set from the admin panel" was green over a
 * village that could not send a single welcome. The setup game's rule
 * (2026-10-13) is that presence alone is never healthy: a plant is green only
 * after a live check passes. This is that check for email.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────
 * One real send, from the village's own sender, to Resend's test recipient,
 * which accepts it and reaches nobody (`probeResendSend`,
 * `server/lib/email.ts`). The outcome lands in `integration_health` under
 * `email`, which the Resend card on Admin, Integrations reads back. So the
 * card shows what the last check FOUND, never what somebody typed.
 *
 * ── THE GATE ─────────────────────────────────────────────────────────────
 * Admin only, and audit-logged. The key never leaves the server: the route
 * reads it from the store and hands it to the transport, and the answer
 * carries a sentence and the health reading, never the key or its last four.
 *
 * A send counts against the village's Resend quota, so one check a minute is
 * enough for a person pressing a button and is the most this answers.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { verifyEmailTransport } from "../lib/email";
import { recordEvent } from "../lib/events";
import { secretValue } from "../lib/secrets";

type Deps = Pick<AppDeps, "isAdmin" | "adminActor" | "getPool"> & {
  /** The sender every real send uses: Admin email config, then EMAIL_FROM. */
  sender(): string;
};

export const EMAIL_PROBE_PATH = "/api/admin/integrations/resend/probe";
export const EMAIL_PROBE_COOLDOWN_MS = 60_000;

export function register(app: Express, deps: Deps): void {
  let lastRunAt = 0;

  app.post(EMAIL_PROBE_PATH, async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const key = secretValue("resend_api_key");
    if (!key) {
      return res.status(409).json({ error: "no_key", message: "No Resend key is set, so there is nothing to check yet." });
    }
    const now = Date.now();
    if (now - lastRunAt < EMAIL_PROBE_COOLDOWN_MS) {
      return res.status(429).json({ error: "too_soon", message: "A check ran in the last minute. Try again shortly." });
    }
    lastRunAt = now;
    const result = await verifyEmailTransport({ resendApiKey: key }, deps.sender());
    void recordEvent(deps.getPool(), {
      kind: "audit",
      text: `integrations:resend_api_key:probe:${result.ok ? "alive" : "failed"}`,
      actorUserId: deps.adminActor(req)?.id ?? null,
      entityType: "integration",
      entityRef: "resend_api_key",
      audience: "admin",
    });
    res.json({ ok: result.ok, detail: result.detail });
  });
}
