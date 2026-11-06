/**
 * The member's own wallet, and the one door to claim from it.
 *
 * A route module, so `server/index.ts` pays only the import and the register
 * call, both of which its size ratchet exempts. `register(app, deps)` is the
 * only export that touches Express, and the dependency slice below is the
 * complete list of what these routes can reach.
 *
 * ── YOURS ONLY ──────────────────────────────────────────────────────────────
 *
 * Neither route takes an id or a handle. The member is whoever `authedUser`
 * says sent the request, so there is no shape of request that reads or claims
 * against somebody else's wallet.
 *
 * ── THE CLAIM DOOR IS SHUT IN THIS BUILD, AND SAYS SO ───────────────────────
 *
 * `POST /api/me/wallet/claim` calls `requestClaim` WITHOUT a bridge argument,
 * so the shipped `BRIDGE_DISPATCH_BUILT = false` answers every request with a
 * 503 before anything is debited. That is the whole point of the constant: a
 * claim that took a member's balance with nothing able to raise the proposal
 * would strand it. The route exists so the day the dispatch ships, the wallet's
 * button has somewhere to go, and passing `true` here would be turning claims
 * on by hand, which a grep for `requestClaim(` finds.
 *
 * Cancelling stays on `POST /api/me/voice-claim/:id/cancel`, which settles a
 * claim in ANY lane: `settleVoiceClaim` reads the token off the stored row.
 */
import type { Express } from "express";

import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { laneForToken, requestClaim } from "../lib/voiceClaim";
import { walletFor, type WalletDeps } from "../lib/wallet";

/**
 * The allowance arrives as a FUNCTION, because the member's stage multiplier
 * lives in the host and R73 says there is one allowance. A second resolver
 * here would be a second answer to the same question.
 */
type Deps = Pick<AppDeps, "authedUser" | "getPool"> & { gratitudeAllowance: WalletDeps["allowanceFor"] };

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, gratitudeAllowance } = deps;

  app.get("/api/me/wallet", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    res.json(await walletFor(getPool(), user, { allowanceFor: gratitudeAllowance }));
  });

  /**
   * Ask to carry one token across to Hypha. The engine decides everything and
   * this route only carries the answer, including the refusal SENTENCE, which
   * is the one the wallet row already shows.
   */
  app.post("/api/me/wallet/claim", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const lane = laneForToken(String(req.body?.token ?? ""));
    if (!lane) return res.status(400).json({ error: "That token stays in the village. There is nothing to claim on Hypha." });
    const out = await requestClaim(getPool(), user.id, lane);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    void recordEvent(getPool(), {
      kind: "audit",
      text: `${lane.id}:claim-requested:${out.claimId}:${out.amount}`,
      actorUserId: user.id,
      entityType: "voice_claim",
      entityRef: out.claimId,
      audience: "admin",
    });
    res.json({ success: true, claimId: out.claimId, amount: out.amount });
  });
}
