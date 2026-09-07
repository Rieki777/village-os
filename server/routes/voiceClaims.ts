/**
 * Voice claim routes (extracted from server/index.ts).
 *
 * Three routes:
 *
 *   POST /api/me/voice-claim           ask to carry accrued voice to Hypha
 *   POST /api/me/voice-claim/:id/cancel take the voice back (owner only)
 *   GET  /api/me/voice-claims          every claim you have made (yours only)
 *
 * The engine decides everything; these routes only carry the answer. The
 * refusal sentence is returned rather than a code, because the sentence is
 * the one the chip already shows and two sources for the same message drift.
 */
import type { Express, Request } from "express";
import type { Pool } from "mysql2/promise";
import {
  claimHistory,
  requestVoiceClaim,
  settleVoiceClaim,
} from "../lib/voiceClaim";
import type { EventInput } from "../lib/events";

export interface VoiceClaimDeps {
  authedUser: (req: Request) => Promise<any | null>;
  getPool: () => Pool;
  villageId: () => string;
  recordEvent: (pool: Pool, event: EventInput) => Promise<void>;
}

export function register(app: Express, deps: VoiceClaimDeps): void {
  const { authedUser, getPool, villageId, recordEvent } = deps;

  app.post("/api/me/voice-claim", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const out = await requestVoiceClaim(getPool(), user.id);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    void recordEvent(getPool(), {
      kind: "audit",
      text: `voice:claim-requested:${out.claimId}:${out.amount}`,
      actorUserId: user.id,
      entityType: "voice_claim",
      entityRef: out.claimId,
      audience: "admin",
    });
    res.json({ success: true, claimId: out.claimId, amount: out.amount });
  });

  app.post("/api/me/voice-claim/:id/cancel", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const [own] = await getPool().query<any[]>(
      "SELECT `id` FROM `voice_claims` WHERE `id` = ? AND `village_id` = ? AND `user_id` = ? LIMIT 1",
      [req.params.id, villageId(), user.id],
    );
    if (!own.length) return res.status(404).json({ error: "Not found" });
    const out = await settleVoiceClaim(getPool(), req.params.id, "canceled", "The member withdrew it");
    if (!out.ok) return res.status(409).json({ error: out.error });
    res.json({ success: true, refunded: out.refunded });
  });

  app.get("/api/me/voice-claims", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    res.json({ claims: await claimHistory(getPool(), user.id) });
  });
}
