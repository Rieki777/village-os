/**
 * What closing this village means, written.
 *
 *   PUT /api/admin/exit-policy/closing   { policyId, statement, adopt }
 *        -> { success, named, closing }
 *
 * The closing section of the exit policy (Rye, 2026-09-25). Its rules are in
 * server/lib/closingPolicy.ts and shared/closingPolicies.ts; this file is the
 * door and nothing else.
 *
 * READING IT NEEDS NO ROUTE OF ITS OWN. The section lives inside the
 * `exit-policy` document, so `GET /api/exit-policy` already serves it to every
 * reader, signed in or not, the way the dials ruling asks, and
 * `GET /api/admin/exits` already hands it to the editor. Both read through
 * `withPolicyDefaults`, which serves the section without the account that
 * adopted it.
 *
 * IN ITS OWN MODULE because server/index.ts has no route registration to
 * spare, and because the exits routes in that file are being moved to a
 * module of their own by another lane: this door is the one piece of the exit
 * policy that never had to live there.
 *
 * GATED AS THE EXIT POLICY IS: `isAdmin`, the gate its own PUT calls, which
 * also marks the request for the /api/admin default-deny. No transferable
 * power covers the exit policy, so this section has the same writers the rest
 * of the document has, and a change to either is the same kind of act.
 *
 * WRITES THROUGH THE CACHED HANDLE. The exit policy is a `dbDocument` loaded
 * at boot, and a write that went round it would leave the public page serving
 * the old words until the next restart.
 *
 * EVERY WRITE LEAVES A RECORD, AND AN ADOPTION IS TOLD TO THE VILLAGE (Wave 2
 * audit, 2026-09-28). One admin can replace where the treasury and assets go
 * on closing, and the only trace was a changed "Adopted on" date. Each save
 * now writes an admin audit row naming the policy before and after, and each
 * NEW adoption writes a line on the village pulse, which members read. Both go
 * through `recordEvent`, the one door into `health_events`, and are awaited so
 * the answer is sent after the record exists (`recordEvent` never throws).
 * Re-adopting the same words keeps the old stamp in `closingWrite` and is not
 * news. The consequence pen's second half, a ballot once the Game has started
 * (plan section 3), is Wave 3 work and is not built here.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { closingWrite } from "../lib/closingPolicy";
import { recordEvent } from "../lib/events";
import { closingForReaders, closingNamed, closingPolicyDef } from "../../shared/closingPolicies";

/** The exit policy's own document handle, `exitPolicyRepo` in server/index.ts. */
export interface ExitPolicyHandle {
  get(): any;
  put(doc: any): Promise<unknown>;
}

type Deps = Pick<AppDeps, "isAdmin" | "adminActor" | "getPool"> & { exitPolicy: ExitPolicyHandle };

export function register(app: Express, deps: Deps): void {
  app.put("/api/admin/exit-policy/closing", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const stored = deps.exitPolicy.get() ?? {};
    const actor = deps.adminActor(req);
    const answer = closingWrite(req.body, stored.closing, actor?.id ?? null, new Date());
    if (!answer.ok) return res.status(answer.status).json({ error: answer.error, message: answer.message });
    // Every other key of the document exactly as stored: this door owns one
    // section and must not rewrite the terms beside it.
    await deps.exitPolicy.put({ ...stored, closing: answer.section });
    const section = answer.section;
    const before = String(stored.closing?.policyId ?? "") || "none";
    const adoptedNow = !!section.adoptedAt && section.adoptedAt !== (stored.closing?.adoptedAt ?? null);
    await recordEvent(deps.getPool(), {
      kind: "audit",
      text: `closing-policy:${section.adoptedAt ? "adopted" : "draft"}:${before}->${section.policyId}`,
      actorUserId: actor?.id ?? null,
      entityType: "exit_policy", entityRef: "closing", audience: "admin",
    });
    if (adoptedNow) {
      await recordEvent(deps.getPool(), {
        kind: "governance",
        text: `${actor?.name || "An admin"} adopted what closing this village means: ${closingPolicyDef(section.policyId)?.name ?? section.policyId}. The words are on the exit policy page.`,
        actorUserId: actor?.id ?? null,
        entityType: "exit_policy", entityRef: "closing", audience: "public",
      });
    }
    res.json({ success: true, named: closingNamed(section), closing: closingForReaders(section) });
  });
}
