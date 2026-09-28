/**
 * Member exit (S52, F12): the published policy, and a departure's four steps.
 *
 *   GET  /api/exit-policy                        the published policy, for everyone
 *   PUT  /api/admin/exit-policy                  an admin writes the terms
 *   GET  /api/admin/players/:id/exit-state       one member's open state, on the admin's desk
 *   GET  /api/admin/exits                        every exit, with the policy and its defaults
 *   POST /api/profile/request-exit               a member opens their own departure
 *   POST /api/admin/exits                        an admin opens one (on behalf, or involuntary)
 *   POST /api/admin/exits/:id/settle-balances    the one settlement move exit owns
 *   POST /api/admin/exits/:id/resolve            the tombstone, once nothing blocks
 *   POST /api/admin/exits/:id/cancel             a person who stays
 *
 * Not a module: leaving is core identity, like joining. The policy is
 * PUBLISHED; the process refuses to tombstone anyone who still owes or is
 * owed through a blocking domain; the restorative flow's content reaches
 * only its recipients, never a table.
 *
 * ── WHY IT LEFT server/index.ts ─────────────────────────────────────────────
 *
 * Lifted out on 2026-09-27 as a pure move (plan section 9: the exits block
 * out of the monolith), so the handlers below are the ones that ran there,
 * with the free variables they closed over now named in `ExitDeps`. The
 * three status writes moved with them into `server/repos/exits.ts`, statement
 * for statement. The domain logic was already out: enumeration, opening and
 * the sweep in `server/lib/exit.ts`, the policy's defaults and the checks
 * that keep its acknowledgement honest in `server/lib/exitPolicy.ts`.
 *
 * ── REGISTERED WHERE IT WAS ─────────────────────────────────────────────────
 *
 * `register()` is called from startServer at exactly the point these routes
 * used to occupy, immediately before the restorative intake
 * (`server/routes/restorativeIntake.ts`), because Express matches in
 * registration order. None of these paths sits under a module mount: exit is
 * core, so no `requireModule` stands in front of any of them.
 *
 * ── THE RESTORATIVE BLOCK CAN BELONG TO THE CONFLICT AGREEMENT ─────────────
 *
 * Once a village saves a conflict agreement (server/lib/conflictAgreement.ts),
 * `readExitPolicy()` answers the restorative block from it. Two things here
 * follow (2026-09-28):
 *
 *   1. The public read serves that block to anybody who is not a member with
 *      the agreement's public rule: a step naming a member is withheld, and
 *      the outside contact is its organisation, with no name and no way to
 *      reach them. Members read it whole.
 *   2. The policy's own save leaves the block alone while the agreement holds
 *      it, and refuses a body that tries to change it, naming where it lives.
 *      Storing it would be a change no reader ever sees.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { anonymizeMember, type ErasureDeps } from "../lib/erasure";
import { recordEvent } from "../lib/events";
import { EXAMPLE_REFUSAL_BODY, isExampleUser } from "../lib/examples";
import {
  allExits,
  blockingStates,
  createExit,
  exitById,
  exitOpenState,
  openExitFor,
  sweepBalances,
} from "../lib/exit";
import {
  DEFAULT_EXIT_POLICY,
  EXIT_POLICY_TERMS,
  blankTerms,
  normalizeExitPolicy,
  platformDefaultTermKeys,
  platformDefaultTerms,
  restorativeDoorProblem,
} from "../lib/exitPolicy";
import type { makeIdentityGate } from "../lib/identityConfirm";
import { intakeRoleForReaders, type IntakeHolding } from "../lib/restorativeIntake";
import { RESTORATIVE_IN_AGREEMENT, memberNameMatcher, restorativeForPublic, sameRestorative } from "../lib/conflictAgreement";
import type { DbDocument } from "../repos/store-db";
import { cancelOpenExit, markExitResolved, markExitSettling } from "../repos/exits";

export type ExitDeps = Pick<
  AppDeps,
  | "isAdmin"
  | "authedUser"
  | "adminActor"
  | "getPool"
  | "members"
  | "circlesRepo"
  | "loadRoles"
  | "roleIdsFor"
  | "notify"
  | "notifyAdmins"
  | "hasMembership"
> & {
  /** Whether the village has saved a conflict agreement, which then answers the restorative block. */
  agreementStored(): boolean;
  /**
   * The policy with the platform defaults read through: the copy every READER
   * is served, so every response here builds on it and never on
   * `exitPolicyRepo.get()`. See its note in server/index.ts for the field that
   * proved why.
   */
  readExitPolicy(): any;
  /**
   * The stored document itself, for what the reader's copy cannot answer:
   * whether a row exists, the write, and `get` for a save that must carry a
   * stored section it does not itself write. That save reads the RAW document,
   * never `readExitPolicy()`: the reader's copy adds defaults and may leave
   * fields out, and storing it back would freeze the one and erase the other.
   */
  exitPolicyRepo: Pick<DbDocument<any>, "exists" | "get" | "put">;
  /** Every role_holders row, for whether the intake role is held today (`intakeRoleForReaders`). */
  roleHolders(): ReadonlyArray<IntakeHolding>;
  /** A password, or a fresh Google sign-in for a member with none (server/lib/identityConfirm.ts). */
  confirmIdentity: ReturnType<typeof makeIdentityGate>;
  /** The refusal that stops a departure leaving the village with nobody who can administer it, or null. */
  departureStrandingRefusal(target: any, self: boolean): Promise<string | null>;
  /** What the tombstone needs that it cannot import (server/lib/erasure.ts). */
  erasureDeps: ErasureDeps;
};

export function register(app: Express, deps: ExitDeps): void {
  /**
   * The published policy — F12's "publish the exit policy on the site".
   *
   * `involuntary.decidingDomainId` and `appealDomainId` are stored ids. They
   * are resolved to circle NAMES here because a published page naming a slug
   * publishes nothing: who decides an involuntary exit and who hears an appeal
   * are the two facts a member most needs from this page.
   */
  app.get("/api/exit-policy", async (req, res) => {
    const policy: any = deps.readExitPolicy();
    // Signed in or not, both are fine here; only a member reads the block whole.
    const viewer = await deps.authedUser(req);
    const member = !!viewer && (deps.hasMembership(viewer) || (await deps.isAdmin(req)));
    const restorative = member
      ? policy?.restorative ?? {}
      : restorativeForPublic(policy?.restorative ?? {}, memberNameMatcher((await deps.members.all()).map((m: any) => m?.name)));
    const namedCircle = (id: unknown) => {
      const wanted = String(id ?? "");
      if (!wanted) return null;
      const c: any = deps.circlesRepo.all().find((x: any) => x.id === wanted);
      return c ? { id: c.id, name: c.name } : null;
    };
    res.json({
      policy: {
        ...policy,
        involuntary: {
          ...(policy?.involuntary ?? {}),
          decidingCircle: namedCircle(policy?.involuntary?.decidingDomainId),
          appealCircle: namedCircle(policy?.involuntary?.appealDomainId),
        },
        // Named for the same reason: a member sees who an intake reaches before
        // sending it. `heldToday` says whether anybody would: the page promises a
        // reply and offers the form only then (server/lib/restorativeIntake.ts).
        restorative: {
          ...restorative,
          intakeRole: intakeRoleForReaders(policy?.restorative?.intakeContactRole, deps.loadRoles(), deps.roleHolders()),
        },
      },
      configured: deps.exitPolicyRepo.exists(), platformWording: platformDefaultTermKeys(policy),
    });
  });

  /**
   * THE ACKNOWLEDGEMENT IS A CLAIM, SO THE SERVER CHECKS IT.
   *
   * `placeholder: false` clears the caution card on /exit-policy and turns the
   * page into the village's settled exit terms. The editor used to offer that
   * checkbox while offering no field for three of the five terms the page
   * prints, so a village could publish the platform's boilerplate under its own
   * name and never know. The fields now exist above; this refuses to clear the
   * flag while any rendered term is still word-for-word the platform's, and
   * names every one of them. Same shape as the `stay.credit_expiry_days`
   * refusal: a write the platform cannot honour is declined with the reason,
   * never accepted into a void.
   */
  app.put("/api/admin/exit-policy", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const body = req.body ?? {};
    if (typeof body !== "object" || !body.voluntary || !body.involuntary || !body.restorative) {
      return res.status(400).json({
        error: "incomplete_policy",
        message: "The policy needs voluntary, involuntary and restorative sections",
      });
    }
    // While the conflict agreement holds the restorative block, this save
    // carries the stored block forward and refuses a body that changes it.
    let body2 = body;
    if (deps.agreementStored()) {
      if (!sameRestorative(body.restorative, deps.readExitPolicy()?.restorative)) {
        return res.status(409).json({ error: "restorative_in_agreement", message: RESTORATIVE_IN_AGREEMENT });
      }
      body2 = { ...body, restorative: deps.exitPolicyRepo.get()?.restorative ?? {} };
    } else {
      // The intake and cover roles, the reply time and the outside contact: server/lib/exitPolicy.ts.
      const door = restorativeDoorProblem(body.restorative, deps.loadRoles().map((r: any) => String(r.id)));
      if (door) return res.status(400).json(door);
    }
    for (const [field, label] of [["decidingDomainId", "deciding circle"], ["appealDomainId", "appeal circle"]] as const) {
      const id = String(body.involuntary?.[field] ?? "");
      if (id && !deps.circlesRepo.all().some((c: any) => c.id === id)) {
        return res.status(400).json({ error: "unknown_circle", message: `Unknown ${label} "${id}"` });
      }
    }
    // The RAW stored document, never readExitPolicy(): the closing section is
    // carried as stored, adoptedBy included (server/lib/exitPolicy.ts).
    const next = normalizeExitPolicy(body2, deps.exitPolicyRepo.get());
    const blank = blankTerms(next);
    if (blank.length) {
      return res.status(400).json({
        error: "blank_terms",
        message: `A published policy cannot leave a term empty. Still blank: ${blank.join(", ")}.`,
      });
    }
    if (!next.placeholder) {
      const stale = platformDefaultTerms(next);
      if (stale.length) {
        return res.status(409).json({
          error: "terms_still_platform_default",
          fields: stale,
          message:
            `These terms are still word for word the platform's: ${stale.join(", ")}. ` +
            "Recording that the community decided them would publish the platform's boilerplate under the village's name. " +
            "Write each one in the community's own words, then clear the draft banner.",
        });
      }
    }
    await deps.exitPolicyRepo.put(next);
    res.json({ success: true, policy: deps.readExitPolicy() });
  });

  /** The per-member open-state enumeration, on the admin's desk. */
  app.get("/api/admin/players/:id/exit-state", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const target = await deps.members.byId(req.params.id);
    if (!target) return res.status(404).json({ error: "Not found" });
    const states = await exitOpenState(deps.getPool(), target.id, deps.roleIdsFor(target.id));
    res.json({
      states,
      blocking: blockingStates(states),
      exit: await openExitFor(deps.getPool(), target.id),
    });
  });

  app.get("/api/admin/exits", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const exits = await allExits(deps.getPool());
    const withNames = [];
    for (const e of exits) {
      withNames.push({ ...e, userName: (await deps.members.byId(e.userId))?.name ?? "(anonymized)" });
    }
    // `defaults` and `terms` travel with the policy so the editor can mark each
    // term that is still the platform's without keeping a second copy of the
    // platform's words in the bundle. One source of truth, checked in one place.
    res.json({
      exits: withNames,
      policy: deps.readExitPolicy(),
      defaults: DEFAULT_EXIT_POLICY,
      terms: EXIT_POLICY_TERMS,
      circles: deps.circlesRepo.all().map((c: any) => ({ id: c.id, name: c.name })),
      conflictAgreementStored: deps.agreementStored(),
    });
  });

  /** A member opens their own departure. Identity-confirmed (a password, or Google for a member with none), stranding-guarded. */
  app.post("/api/profile/request-exit", async (req, res) => {
    const user = await deps.authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const { note } = req.body ?? {};
    const confirmed = await deps.confirmIdentity(req, res, user, "request-exit");
    if (!confirmed.ok) return res.status(403).json(confirmed.body);
    const stranding = await deps.departureStrandingRefusal(user, true);
    if (stranding) return res.status(409).json({ error: stranding });
    const policy: any = deps.readExitPolicy();
    const r = await createExit(deps.getPool(), {
      userId: user.id,
      kind: "voluntary",
      openedBy: user.id,
      noticeDays: Number(policy?.voluntary?.noticePeriodDays) || 0,
      note: note ? String(note) : null,
    });
    if (!r.ok) return res.status(409).json({ error: r.error });
    await deps.notifyAdmins("exit_opened", `${user.name ?? "A member"} has begun a departure`, `exit:${r.exit.id}:opened`);
    void recordEvent(deps.getPool(), {
      kind: "audit", text: "exit:opened:voluntary", actorUserId: user.id,
      entityType: "user", entityRef: user.id, audience: "admin",
    });
    res.json({ success: true, exit: r.exit });
  });

  /** An admin opens one (on behalf, or involuntary per the published process). */
  app.post("/api/admin/exits", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const { userId, kind, note } = req.body ?? {};
    const target = await deps.members.byId(String(userId ?? ""));
    if (!target) return res.status(404).json({ error: "No such member" });
    // An example identity is content, not a person who can leave. The exits
    // row would outlive the identities (retirement deletes users, not exits)
    // and the notify below is addressed to an account nobody can sign in to.
    if (isExampleUser(target)) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    const stranding = await deps.departureStrandingRefusal(target, false);
    if (stranding) return res.status(409).json({ error: stranding });
    const policy: any = deps.readExitPolicy();
    const r = await createExit(deps.getPool(), {
      userId: target.id,
      kind: kind === "involuntary" ? "involuntary" : "voluntary",
      openedBy: deps.adminActor(req)?.id ?? "admin",
      noticeDays: Number(policy?.voluntary?.noticePeriodDays) || 0,
      note: note ? String(note) : null,
    });
    if (!r.ok) return res.status(409).json({ error: r.error });
    await deps.notify({
      userId: target.id, type: "exit_opened",
      title: kind === "involuntary" ? "A departure process has been opened with you" : "Your departure process has been opened",
      body: "The published exit policy describes each step. The stewards will walk it with you.",
      link: "/exit-policy", dedupeKey: `exit:${r.exit.id}:member`,
    });
    res.json({ success: true, exit: r.exit });
  });

  /**
   * The ONE settlement move exit owns: sweep positive balances, idempotent
   * per token. Everything else settles through its own domain's terminals.
   */
  app.post("/api/admin/exits/:id/settle-balances", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const exit = await exitById(deps.getPool(), req.params.id);
    if (!exit) return res.status(404).json({ error: "No such exit" });
    if (exit.status === "resolved" || exit.status === "cancelled") {
      return res.status(409).json({ error: `This exit is ${exit.status}` });
    }
    const result = await sweepBalances(deps.getPool(), { exitId: exit.id, userId: exit.userId });
    if (result.refusal) return res.status(409).json({ error: result.refusal });
    await markExitSettling(deps.getPool(), exit.id, result.note);
    res.json({ success: true, ...result });
  });

  /**
   * The terminal act: refuses with the NAMED blocking domains until the
   * member's open state is clean, then runs the existing tombstone. Exit
   * never invents a settle path — 2.2 #8 stands.
   */
  app.post("/api/admin/exits/:id/resolve", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const exit = await exitById(deps.getPool(), req.params.id);
    if (!exit) return res.status(404).json({ error: "No such exit" });
    if (exit.status === "resolved" || exit.status === "cancelled") {
      return res.status(409).json({ error: `This exit is already ${exit.status}` });
    }
    const target = await deps.members.byId(exit.userId);
    if (!target) return res.status(404).json({ error: "Member not found" });
    const roleIds = deps.roleIdsFor(target.id);
    const blocking = blockingStates(await exitOpenState(deps.getPool(), target.id, roleIds));
    if (blocking.length) {
      return res.status(409).json({
        error: "Open state must settle through its own domain first",
        blocking,
      });
    }
    const { agreementRef } = req.body ?? {};
    await anonymizeMember(deps.getPool(), target, deps.adminActor(req)?.id ?? null, deps.erasureDeps);
    await markExitResolved(deps.getPool(), exit.id, agreementRef ? String(agreementRef).slice(0, 255) : null);
    // Seats vacate at the tombstone; the stewards hear which ones.
    for (const roleId of roleIds) {
      await deps.notifyAdmins("exit_opened", `A seat opened: ${roleId} (departure resolved)`, `exit:${exit.id}:vacancy:${roleId}`);
    }
    res.json({ success: true, vacatedRoles: roleIds });
  });

  /** A person who stays: the exit closes without a tombstone. */
  app.post("/api/admin/exits/:id/cancel", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    if (!(await cancelOpenExit(deps.getPool(), req.params.id))) return res.status(404).json({ error: "No open exit with that id" });
    res.json({ success: true });
  });
}
