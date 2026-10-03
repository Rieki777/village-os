/**
 * THE DELIVERY-REPORT WEBHOOK, `POST /api/comms/webhooks/resend`
 * (the comms build spec 5.3 and 8.1).
 *
 * The provider tells the village what became of each email it accepted:
 * delivered, bounced, complained, failed. This route proves a report came
 * from the provider, stores it ONCE, and answers 200. Applying it to the
 * message it is about, and writing the suppressions a bounce or a complaint
 * calls for, is the post office lane's (B1), from the stored row.
 *
 * ── WHERE THIS IS REGISTERED, AND WHY IT MUST STAY THERE ───────────────────
 *
 * BEFORE `express.json()`, beside the Stripe webhook, for the reason Stripe's
 * is there: the signature is over the bytes the provider sent, and a body
 * parsed and re-serialised is not those bytes. Key order, escapes and number
 * formatting survive a round trip looking identical and hashing differently.
 * Registered after the JSON parser, `req.body` arrives parsed, the raw parser
 * below steps aside because the body was already read, and every report is
 * refused. server/comms.foundation.e2e.test.ts sends a correctly signed
 * report and expects it stored, so a moved registration turns it red.
 *
 * NEVER BEHIND A MODULE GATE. A delivery report is plumbing: an address that
 * bounced must be known whether or not the automations are on.
 *
 * ── WHAT IT ANSWERS ────────────────────────────────────────────────────────
 *
 *   429  the in-memory per-IP ceiling, ahead of everything, which costs no
 *        database write to refuse (the Stripe route's reasoning).
 *   503  this village has not connected delivery reports. The provider
 *        retries, which is what a report sent before the secret was saved
 *        should get.
 *   401  the signature does not prove the provider sent it. One answer for
 *        every way that fails, so a forger learns nothing from it.
 *   400  a signed body that is not a delivery report.
 *   200  stored, or already stored under the same delivery id. A redelivery
 *        is a success: the provider is retrying because it did not hear us.
 *   500  the store failed, so the provider retries.
 */
import express, { type Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { readDeliveryReport, verifySvix } from "../lib/comms/webhook";
import { secretValue } from "../lib/secrets";
import { storeProviderEvent } from "../repos/commsMessages";

type Deps = Pick<AppDeps, "getPool" | "clientIp">;

/**
 * Far above real traffic from one provider address, and a 429 is retried
 * like any other non-2xx, so a genuine burst (a letter reporting back on two
 * thousand addresses) is delayed and never lost.
 */
const REPORTS_PER_MINUTE = 1200;

export function register(app: Express, deps: Deps): void {
  const { getPool, clientIp } = deps;
  const hits = new Map<string, { n: number; resetAt: number }>();

  app.post(
    "/api/comms/webhooks/resend",
    express.raw({ type: () => true, limit: "256kb" }),
    async (req, res) => {
      const now = Date.now();
      const who = clientIp(req);
      const slot = hits.get(who);
      if (!slot || slot.resetAt < now) {
        if (hits.size > 5000) hits.clear(); // bounded, never a leak
        hits.set(who, { n: 1, resetAt: now + 60_000 });
      } else if (++slot.n > REPORTS_PER_MINUTE) {
        return res.status(429).json({ error: "Too many delivery reports at once. Retry shortly." });
      }

      const secret = secretValue("resend_webhook_secret");
      if (!secret) {
        return res.status(503).json({ error: "This village has not connected delivery reports yet." });
      }
      const body = Buffer.isBuffer(req.body) ? req.body : null;
      if (!body) return res.status(401).json({ error: "bad signature" });
      const verdict = verifySvix({
        secret,
        id: req.header("svix-id"),
        timestamp: req.header("svix-timestamp"),
        signature: req.header("svix-signature"),
        body,
      });
      if (!verdict.ok) {
        // Reported to the log only: these arrive from anybody with the address,
        // and the per-IP ceiling above is their answer.
        console.warn(`[comms] a delivery report was refused (${verdict.reason})`);
        return res.status(401).json({ error: "bad signature" });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "That report is not JSON." });
      }
      const report = readDeliveryReport(payload);
      if (!report) return res.status(400).json({ error: "That is not a delivery report." });

      try {
        const { stored } = await storeProviderEvent(getPool(), {
          id: verdict.id,
          type: report.type,
          providerMessageId: report.providerMessageId,
          messageId: report.messageId,
          payload,
        });
        res.json({ ok: true, stored });
      } catch (err) {
        console.error("[comms] a delivery report could not be stored, so the provider will retry it", err);
        res.status(500).json({ error: "The report could not be stored. Retry it." });
      }
    },
  );
}
