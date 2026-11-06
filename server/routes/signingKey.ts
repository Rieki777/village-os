/**
 * THE VILLAGE SIGNING KEY, FROM ADMIN (readiness R069).
 *
 * The key signs what peers pin this village by: /.well-known/village.json,
 * /api/public/org.json and /api/platform/module-usage. Two ways leave a village
 * needing a new one. The private half leaked, or a restore under a different
 * VILLAGE_SECRETS_KEY stranded it, sealed under a key nobody holds, and the
 * signed documents then answer 503 on every boot. FORK_RUNBOOK's incident list
 * said this "needs a database write, not an admin screen". This is the screen.
 *
 * Rotating is deliberate and loud. It takes a typed confirmation, because
 * every peer that follows this village pauses on the new key and has to accept
 * it by hand (server/lib/network.ts: a rotation and an impostor look the same
 * from outside). It is recorded with both key ids, and the admins and the
 * stewards are told the same hour, the way a database export is.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { canSign, rotateSigningKey, signingKey, signingKeyAtRest } from "../lib/villageExport";
import { exportWitnesses } from "./villageExport";

type Deps = Pick<AppDeps, "isAdmin" | "authedUser" | "adminActor" | "getPool" | "notify" | "members">;

export const SIGNING_KEY_NOTICE_TYPE = "signing_key_rotated";
/** What an admin types to confirm. Plain words, so nobody confirms by reflex. */
export const ROTATE_CONFIRM = "make a new key";

export function register(app: Express, deps: Deps): void {
  app.get("/api/admin/identity/signing-key", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const k = signingKey();
    res.json({ kid: k.kid, createdAt: k.createdAt, atRest: signingKeyAtRest(), canSign: canSign(), confirmWith: ROTATE_CONFIRM });
  });

  app.post("/api/admin/identity/signing-key/rotate", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const actor = (await deps.authedUser(req))?.id ?? deps.adminActor(req)?.id ?? null;
    if (!actor) return res.status(401).json({ error: "auth_required", message: "Replacing the signing key needs a named admin" });
    if (String(req.body?.confirm ?? "").trim().toLowerCase() !== ROTATE_CONFIRM) {
      return res.status(400).json({
        error: `Type "${ROTATE_CONFIRM}" to confirm. Every village that follows this one will pause on the new key and has to accept it by hand.`,
      });
    }
    const pool = deps.getPool();
    const out = await rotateSigningKey(pool);
    if (!out.ok) return res.status(503).json({ error: out.error });

    void recordEvent(pool, {
      kind: "audit",
      text: `identity:signing-key:rotated from ${out.previousKid ?? "none"} to ${out.kid}`,
      actorUserId: actor, entityType: "identity", entityRef: "village-signing-key", audience: "admin",
    });
    const title = "The village's signing key was replaced.";
    const body =
      `The new key is ${out.kid}${out.previousKid ? `, in place of ${out.previousKid}` : ""}. Every village that follows this one ` +
      "will pause on the change until somebody there accepts the new key. If nobody running this village did this, " +
      "an admin account is in the wrong hands: change ADMIN_PASSWORD and the admins' passwords now. The audit log names who did it.";
    for (const userId of await exportWitnesses(deps)) {
      try {
        await deps.notify({ userId, type: SIGNING_KEY_NOTICE_TYPE, title, body, link: "/admin?tab=integrations", dedupeKey: `signing-key-rotated:${out.kid}:${userId}` });
      } catch (e) {
        console.error("[identity] could not tell a witness the signing key was replaced", e);
      }
    }
    res.json({ ok: true, kid: out.kid, previousKid: out.previousKid });
  });
}
