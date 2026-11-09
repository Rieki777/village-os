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
 *
 * AFTER LAUNCH IT TAKES TWO PEOPLE whenever two can sign (the coordinator,
 * 2026-11-08, on Rye's two-signature rule; server/lib/signingKeyCosign.ts).
 * The first press asks, the other signers are told, and a different admin's
 * press with the same confirmation replaces the key. With nobody else able to
 * sign, the one admin replaces it at once and the record says they were alone.
 *
 *   GET  /api/admin/identity/signing-key                 the key, and any request waiting
 *   POST /api/admin/identity/signing-key/rotate          replace, ask, or co-sign
 *   POST /api/admin/identity/signing-key/rotate/decline  a signer declines; the asker withdraws
 */
import type { Express, Request } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { TOKEN_PREFIX } from "../lib/agentTokens";
import { cosignPhase } from "../lib/plantingRequests";
import {
  askForRotation,
  clearPendingRotation,
  decideRotation,
  readPendingRotation,
  rotationNeedsCosign,
  type PendingRotation,
} from "../lib/signingKeyCosign";
import { canSign, rotateSigningKey, signingKey, signingKeyAtRest } from "../lib/villageExport";
import { claimRotationCosign, releaseRotationCosign } from "../repos/signingKeyRow";
import { exportWitnesses } from "./villageExport";

type Deps = Pick<AppDeps, "isAdmin" | "authedUser" | "adminActor" | "getPool" | "notify" | "members" | "isPresent">;

export const SIGNING_KEY_NOTICE_TYPE = "signing_key_rotated";
/** What an admin types to confirm. Plain words, so nobody confirms by reflex. */
export const ROTATE_CONFIRM = "make a new key";

interface Signer {
  id: string;
  name: string;
}

/** Who can sign: every admin or founder with their own login, the keystone co-sign's rule. */
async function keySigners(deps: Deps): Promise<Signer[]> {
  return (await deps.members.all())
    .filter((u: any) => (u.role === "admin" || u.role === "founder") && deps.isPresent(u))
    .map((u: any) => ({ id: String(u.id), name: String(u.name ?? u.handle ?? "An admin") }));
}

/** An agent token never signs: a co-sign is a second person. */
const byAgent = (req: Request): boolean => String(req.headers.authorization ?? "").startsWith(`Bearer ${TOKEN_PREFIX}`);

async function actorOf(req: Request, deps: Deps): Promise<string | null> {
  return (await deps.authedUser(req))?.id ?? deps.adminActor(req)?.id ?? null;
}

const nameOf = (signers: readonly Signer[], id: string): string => signers.find((s) => s.id === id)?.name ?? "An admin";

function pendingView(p: PendingRotation | null, signers: readonly Signer[], me: string | null) {
  if (!p) return null;
  return { id: p.id, requestedBy: p.requestedBy, requestedByName: nameOf(signers, p.requestedBy), requestedAt: p.requestedAt, expiresAt: p.expiresAt, mine: p.requestedBy === me };
}

export function register(app: Express, deps: Deps): void {
  app.get("/api/admin/identity/signing-key", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const pool = deps.getPool();
    const me = await actorOf(req, deps);
    const signers = await keySigners(deps);
    const k = signingKey();
    const pending = await readPendingRotation(pool);
    res.json({
      kid: k.kid,
      createdAt: k.createdAt,
      atRest: signingKeyAtRest(),
      canSign: canSign(),
      confirmWith: ROTATE_CONFIRM,
      twoSign: rotationNeedsCosign(await cosignPhase(pool), [...signers.map((s) => s.id), ...(me ? [me] : [])]),
      pending: pending && pending.fromKid === k.kid ? pendingView(pending, signers, me) : null,
    });
  });

  app.post("/api/admin/identity/signing-key/rotate", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const actor = await actorOf(req, deps);
    if (!actor) return res.status(401).json({ error: "auth_required", message: "Replacing the signing key needs a named admin" });
    if (String(req.body?.confirm ?? "").trim().toLowerCase() !== ROTATE_CONFIRM) {
      return res.status(400).json({
        error: `Type "${ROTATE_CONFIRM}" to confirm. Every village that follows this one will pause on the new key and has to accept it by hand.`,
      });
    }
    const pool = deps.getPool();
    const signers = await keySigners(deps);
    const decision = decideRotation({
      phase: await cosignPhase(pool),
      signers: signers.map((s) => s.id),
      actor,
      actorIsPerson: !byAgent(req),
      pending: await readPendingRotation(pool),
      currentKid: signingKey().kid,
    });

    if (decision.kind === "refuse") return res.status(decision.status).json({ error: decision.error });

    if (decision.kind === "ask") {
      const pending = decision.existing ?? (await askForRotation(pool, actor, signingKey().kid));
      if (!decision.existing) {
        void recordEvent(pool, {
          kind: "audit",
          text: `identity:signing-key:rotation-asked to replace ${pending.fromKid}, waiting for a second admin`,
          actorUserId: actor, entityType: "identity", entityRef: "village-signing-key", audience: "admin",
        });
        const asker = nameOf(signers, actor);
        for (const s of signers) {
          if (s.id === actor) continue;
          try {
            await deps.notify({
              userId: s.id,
              type: "governance",
              title: `${asker} asked you to co-sign a new village signing key`,
              body:
                "The village has launched, so replacing the key other villages know this one by needs a second admin. " +
                "Open Admin, Integrations to co-sign or decline it. If you did not expect this, decline it: an admin account may be in the wrong hands.",
              link: "/admin?tab=integrations",
              actorUserId: actor,
              dedupeKey: `signing-key-cosign:${pending.id}:${s.id}`,
            });
          } catch (e) {
            console.error("[identity] could not ask a signer to co-sign the signing key", e);
          }
        }
      }
      return res.status(202).json({
        asked: true,
        pending: pendingView(pending, signers, actor),
        message: "Asked for a co-sign. Another admin replaces the key from Admin, Integrations, with the same confirmation.",
      });
    }

    const pending = decision.kind === "cosign" ? decision.pending : null;
    if (pending && !(await claimRotationCosign(pool, pending.id, actor))) {
      return res.status(409).json({ error: "Somebody else has just co-signed this. Reload to see the new key." });
    }
    const out = await rotateSigningKey(pool);
    if (!out.ok) {
      if (pending) await releaseRotationCosign(pool, pending.id);
      return res.status(503).json({ error: out.error });
    }
    await clearPendingRotation(pool);

    const how = pending
      ? `, asked by ${pending.requestedBy} and co-signed by ${actor}`
      : decision.kind === "rotate" && decision.alone
        ? ", alone: nobody else could sign"
        : "";
    void recordEvent(pool, {
      kind: "audit",
      text: `identity:signing-key:rotated from ${out.previousKid ?? "none"} to ${out.kid}${how}`,
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
    res.json({ ok: true, kid: out.kid, previousKid: out.previousKid, cosignedBy: pending ? actor : null });
  });

  app.post("/api/admin/identity/signing-key/rotate/decline", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const actor = await actorOf(req, deps);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    const pool = deps.getPool();
    const pending = await readPendingRotation(pool);
    if (!pending || pending.fromKid !== signingKey().kid) return res.status(404).json({ error: "No new key is waiting for a co-sign." });
    const signers = await keySigners(deps);
    const withdrawn = pending.requestedBy === actor;
    if (!withdrawn && !signers.some((s) => s.id === actor)) {
      return res.status(403).json({ error: "Declining a new signing key is for an admin with their own login." });
    }
    await clearPendingRotation(pool);
    void recordEvent(pool, {
      kind: "audit",
      text: `identity:signing-key:rotation-${withdrawn ? "withdrawn" : "declined"} (request ${pending.id}); ${pending.fromKid} stays`,
      actorUserId: actor, entityType: "identity", entityRef: "village-signing-key", audience: "admin",
    });
    if (!withdrawn) {
      try {
        await deps.notify({
          userId: pending.requestedBy,
          type: "governance",
          title: `${nameOf(signers, actor)} declined the new village signing key`,
          body: "The village keeps its current key. Ask again from Admin, Integrations if it still needs replacing.",
          link: "/admin?tab=integrations",
          actorUserId: actor,
          dedupeKey: `signing-key-cosign-declined:${pending.id}`,
        });
      } catch (e) {
        console.error("[identity] could not tell the asker the new signing key was declined", e);
      }
    }
    res.json({ ok: true, withdrawn });
  });
}
