/**
 * Quest claims: the consent queue, the holder's own confidence flag, the
 * stewards' attention list, and the one human gate that releases value.
 *
 * Four routes, lifted out of server/index.ts unchanged:
 *
 *   GET  /api/admin/quest-claims                the queue, a look and nothing more
 *   PUT  /api/game/quest-claims/:id/confidence  how it is going, said by the holder
 *   GET  /api/admin/quest-claims/attention      open claims somebody has flagged
 *   POST /api/admin/quest-claims/:id/consent    the witness, and the release
 *
 * ORDER INSIDE THIS FILE IS LOAD-BEARING. `/api/admin/quest-claims/attention`
 * is registered BEFORE `/api/admin/quest-claims/:id/consent`, because Express
 * matches in registration order and the parameter route would otherwise read
 * "attention" as a claim id and answer 404 on a page that exists. Sorting this
 * file would break it silently. `register()` is likewise called at exactly the
 * point the run occupied in server/index.ts: after the quest routes, before
 * `GET /api/game/me`.
 *
 * `consentActor` STAYED IN server/index.ts AND ARRIVES AS A DEPENDENCY. It is
 * the gate for the two routes that RELEASE something, and only one of those is
 * here; the other, the event check-in that witnesses somebody was there, has
 * not moved. A copy of the gate in this file would be a second gate on one
 * power, which is exactly the drift that left `quest.consent` granted to
 * stewards and enforced by nothing. `consentQueueViewer` came with the queue
 * instead, because that route is its only caller and reading a queue is a
 * different question from acting on it. The account of why those are two
 * helpers and not one is on `consentActor`, in server/index.ts.
 *
 * THE TWO RAW QUERIES DID NOT TRAVEL WITH THE ROUTES. The confidence write and
 * the attention read were `getPool().query(...)` inside the handlers; they are
 * now `claimsRepo.setConfidence` and `claimsRepo.needingAttention` in
 * server/repos/quests.ts, identical in SQL and in the shape they hand back.
 * `scripts/sql-burndown.mjs` is the reason it could not simply come along: a
 * query in a route module is a new unregistered violation of the rule that
 * queries live in a repo, and the repo is where these two belonged anyway.
 */
import type express from "express";
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { markAdminGate } from "../lib/adminGate";
import { mintForConfirmedClaim } from "../lib/economy";
import { recordEvent } from "../lib/events";
import { EXAMPLE_REFUSAL_BODY, isExampleRow } from "../lib/examples";
import { issuanceRefusal } from "../lib/gameStart";
import { memberAccount, postTransferOn, RECOGNITION_FAUCET } from "../lib/ledger";
import { effectiveLifecycle } from "../lib/modules";
import { rewardMultiplierFor } from "../lib/seasonPatterns";
import { mintStayCredits } from "../lib/stays";
import { boolVar, numberVar, stringVar } from "../lib/variables";
import type { ClaimRecord } from "../repos/quests";
import { describeRange, parseRewardRange } from "../../shared/questRewards";

/**
 * What the consent gate answers.
 *
 * Declared here and imported back by server/index.ts, which still owns the
 * function itself. The type travels with the route that reads every branch of
 * it; the gate stays where its other caller can still reach it.
 */
export type ConsentActor =
  | { ok: true; userId: string | null; isAdminActor: boolean }
  | { ok: false; status: number; body: Record<string, unknown> };

type Deps = Pick<
  AppDeps,
  | "isAdmin"
  | "authedUser"
  | "mayStillSee"
  | "getPool"
  | "members"
  | "claimsRepo"
  | "questsRepo"
  | "firstName"
  | "notify"
  | "notifyAdmins"
  | "stageOf"
  | "recordStageEvent"
> & {
  /**
   * THE consent gate. Passed rather than imported: server/index.ts holds it,
   * and the event check-in still asks it there. See the file header.
   */
  consentActor(req: express.Request): Promise<ConsentActor>;
  /** One line on the Village Pulse, through the event spine. Never throws. */
  addActivity(
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ): Promise<void>;
  /**
   * The seasonal badges whose season is not running, cached for a few seconds
   * in server/index.ts. The reward multiplier below asks it so a badge that is
   * asleep does not multiply anybody's consent.
   */
  dormantBadgeIds(): Promise<string[]>;
};

export function register(app: Express, deps: Deps): void {
  const {
    isAdmin,
    authedUser,
    mayStillSee,
    getPool,
    members,
    claimsRepo,
    questsRepo,
    firstName,
    notify,
    notifyAdmins,
    stageOf,
    recordStageEvent,
    consentActor,
    addActivity,
    dormantBadgeIds,
  } = deps;

  /**
   * WHO MAY READ THE QUEUE. A look, and it writes nothing.
   *
   * The queue and the consent button sit on the same panel, so it would have
   * been one line shorter to keep one helper for both. That is the RSVP
   * defect: a curator opening a list is not an act, and an admin whose
   * request happened to carry an override would have been recorded reaching
   * past a power for having opened a page.
   *
   * The operator keeps the read on a village-held key (`adminSees`). A
   * village taking on consent takes the button, and there is no break-glass
   * on a GET to hand an operator their eyes back.
   */
  async function consentQueueViewer(
    req: express.Request,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    markAdminGate(req);
    if (!(await authedUser(req))) return { ok: false, status: 401, error: "Unauthorized" };
    if (!(await mayStillSee(req, "quest.consent"))) {
      return { ok: false, status: 403, error: "Consenting to finished work is for stewards" };
    }
    return { ok: true };
  }

  app.get("/api/admin/quest-claims", async (req, res) => {
    const viewer = await consentQueueViewer(req);
    if (!viewer.ok) return res.status(viewer.status).json({ error: viewer.error });
    const claims = await claimsRepo.all();
    claims.sort((a, b) => new Date(b.claimedAt ?? 0).getTime() - new Date(a.claimedAt ?? 0).getTime());
    res.json(claims);
  });

  /**
   * How it is going, said by the person doing it (0055).
   *
   * The failure this catches: a claim sits in `claimed` for six weeks and
   * looks identical whether somebody is halfway through or quietly stuck. The
   * season retrospective can already see "claimed, never consented", but only
   * once the season has ENDED, which is exactly too late to help.
   *
   * Only the holder may set it, and only while the claim is still open. A
   * steward setting it would make it a judgement of somebody's work instead of
   * a signal from them, and the whole value is that asking for help costs
   * nothing here.
   */
  app.put("/api/game/quest-claims/:id/confidence", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const value = String(req.body?.confidence ?? "");
    // Clearing it is allowed: somebody who flagged a wobble and then sorted it
    // out should not have to leave the flag up.
    const allowed = ["on_track", "at_risk", "stuck", ""];
    if (!allowed.includes(value)) {
      return res.status(400).json({ error: "confidence must be on_track, at_risk, stuck, or empty" });
    }
    const note = String(req.body?.note ?? "").slice(0, 280) || null;
    // The same UPDATE, now in server/repos/quests.ts. The ownership test and
    // the open-status test still ride in its WHERE, so "no rows matched" is
    // still the only thing that produces the 404 below.
    const wrote = await claimsRepo.setConfidence(req.params.id, user.id, value, note);
    if (!wrote) {
      return res.status(404).json({ error: "No open claim of yours with that id" });
    }
    /*
     * SWEEP (the incomplete loop). This handler's own comment says the point
     * of collecting the signal is that a steward SEES it, and the only place
     * it landed was a queue somebody had to think to open. A member typing
     * "stuck" is asking for help, and asking for help must not cost a week.
     *
     * Only the two flags that mean trouble ring. Clearing the flag, and
     * saying "on track", are the member reassuring the village and need no
     * summons. The key carries the claim AND the value, so re-saying the same
     * thing with a longer note rings once, and going from at_risk to stuck is
     * its own word.
     *
     * WHAT IT CARRIES: the quest and the flag, never the note. The note is
     * how somebody describes being stuck, which is the most private sentence
     * on the whole screen, and the queue behind the gate holds it.
     */
    if (value === "at_risk" || value === "stuck") {
      const claim: any = (await claimsRepo.forUser(user.id)).find((c) => c.id === req.params.id);
      const questTitle = String(claim?.questTitle ?? "a quest");
      await notifyAdmins(
        "quest_help",
        value === "stuck"
          ? `${firstName(user.name)} is stuck on ${questTitle}`
          : `${firstName(user.name)} flagged a wobble on ${questTitle}`,
        `quest-confidence:${req.params.id}:${value}`,
        "/admin?tab=quest-claims",
      );
    }
    res.json({ success: true });
  });

  /**
   * Open claims that somebody has flagged, worst first.
   *
   * The point of collecting the signal is that a steward SEES it, and a signal
   * nobody reads is a form nobody fills in.
   */
  app.get("/api/admin/quest-claims/attention", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    // The query, the ordering and every field of the shape moved together into
    // server/repos/quests.ts. Only `holder` is decided here, because how much
    // of somebody's name a surface shows is the surface's call and not the
    // table's: first names only, the rule every public-facing list follows.
    const rows = await claimsRepo.needingAttention();
    res.json(rows.map((c) => ({
      id: c.id,
      questTitle: c.questTitle,
      holder: firstName(c.userName),
      status: c.status,
      confidence: c.confidence,
      note: c.note,
      saidAt: c.saidAt,
      claimedAt: c.claimedAt,
    })));
  });

  app.post("/api/admin/quest-claims/:id/consent", async (req, res) => {
    const actor = await consentActor(req);
    if (!actor.ok) return res.status(actor.status).json(actor.body);
    const { approve, amount } = req.body ?? {};
    const claim = await claimsRepo.byId(req.params.id);
    if (!claim) return res.status(404).json({ error: "Not found" });
    // The last door on the example-quest chain. Claim and submit both refuse
    // an example, so a claim can only reach here if it predates those guards
    // — and this is the step that actually mints, so it refuses too. The
    // DECLINE branch stays open on purpose: a stranded claim has to be
    // clearable, and declining creates nothing.
    if (approve !== false && (await isExampleRow(getPool(), "quests", claim.questId))) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    // NO SELF-CONSENT — load-bearing, not decorative. Consent mints
    // recognition from the faucet, grants stay credits and advances stages;
    // without this guard, widening the gate to role-holders would let a
    // steward claim a quest, submit it and pay themselves.
    //
    // ONE exception, deliberately narrow (Rye, 2026-07-31): a founder
    // building alone has nobody to witness anything, so while the village
    // has FEWER than quest.self_consent_until_members members, an ADMIN may
    // consent to their own claims. The moment the village reaches that size
    // the witness rule applies to everyone, admins included. Stewards never
    // get the exception — role authority is not founder authority — and
    // tombstoned members do not count toward the size.
    if (claim.userId === actor.userId) {
      const soloWindow = Math.max(0, numberVar("quest.self_consent_until_members"));
      // Neither tombstones nor standing examples are people, and three
      // phantom identities would shrink the solo-founder window from six real
      // members to three.
      const livingMembers = (await members.all()).filter(
        (u: any) => !u.isExample && u.email && !String(u.email).endsWith("@anonymized.invalid"),
      ).length;
      const soloFounder = actor.isAdminActor && livingMembers < soloWindow;
      if (!soloFounder) {
        return res.status(403).json({
          error: "You cannot consent to your own claim. Someone else has to witness the work.",
        });
      }
      void recordEvent(getPool(), {
        kind: "audit",
        text: `quest:self-consent:solo-founder:${claim.id}`,
        actorUserId: actor.userId,
        entityType: "quest_claim",
        entityRef: claim.id,
        audience: "admin",
      });
    }
    if (approve === false) {
      const declined = await claimsRepo.update(claim.id, (c) => {
        c.status = "declined";
        c.resolvedAt = new Date().toISOString();
      });
      if (declined) {
        await notify({
          userId: declined.userId,
          type: "quest_declined",
          title: `Your claim on "${declined.questTitle}" was released`,
          body: "The claim was declined or cleared. The quest is open again.",
          // The quest itself, not the board it sits on. A member reading this
          // wants to see the thing they were working on.
          link: `/quests/${declined.questId}`,
          // The real actor, admin or steward: adminActor() only populates for
          // password/admin callers, so a steward's decision was anonymous.
          actorUserId: actor.userId,
          dedupeKey: `quest:${declined.id}:declined`,
        });
        // The /api/admin audit middleware attributes isAdmin actors only, so
        // a steward's decision would otherwise leave no trail at all.
        if (!actor.isAdminActor) {
          void recordEvent(getPool(), {
            kind: "audit", text: `quest:declined:${declined.id}`,
            actorUserId: actor.userId, entityType: "quest_claim", entityRef: declined.id, audience: "admin",
          });
        }
      }
      return res.json(declined);
    }
    // Consent releases value, so it may only follow an actual submission.
    // Without this an admin could credit a quest that was claimed and never
    // done, which quietly breaks the one promise the recognition economy makes:
    // that credit lands after the work was shown and consented to. Declining
    // stays legal from any state, since a stale claim needs clearing. The test
    // itself moved DOWN into `consentOnce`, under the claim's row lock: read
    // here it was a plain SELECT several awaits from the write it guarded, and
    // two stewards consenting at once both passed it.
    const consentableFrom: ClaimRecord["status"][] =
      boolVar("quest.require_submission_before_consent") ? ["submitted"] : ["claimed", "submitted"];
    // Item 7: the award was unbounded and never compared to the posted amount,
    // so the quest board was not a contract. The ceiling is a village choice.
    const requested = Math.max(0, Number(amount) || 0);
    // Quests advertise a RANGE ("50-100"), not a number: the same work done
    // thoroughly is worth more than done adequately, and the consenting admin
    // decides where in the range it landed. parseRewardRange is the one place
    // that knows the format.
    const consentedQuest = await questsRepo.byId(claim.questId);
    const range = parseRewardRange(consentedQuest?.gratitude);
    const capMode = stringVar("quest.consent_cap_mode");
    const granted = requested;
    // Consent at 0 used to "succeed" while the failed ledger post zeroed the
    // member's CACHED balance — the worst of both worlds. Now it is refused
    // unless the village has explicitly opted into "acknowledged, no
    // recognition" (quest.allow_zero_consent), in which case the claim
    // completes with no ledger movement and the balance is left alone.
    if (granted <= 0 && !boolVar("quest.allow_zero_consent")) {
      return res.status(400).json({
        error:
          "Consent releases value: the amount must be at least 1. To allow consenting at zero (acknowledged, no recognition), enable 'Allow consenting at zero' in Admin → Variables → Quests.",
      });
    }
    // A cap needs a number to cap, so BOTH capping modes have to refuse a label naming none. This used to sit inside the posted branch, which left "capped" to compute a multiple of the 0 an unreadable label parses to and answer with a ceiling-shaped error for a label-shaped problem. Only "unlimited" is exempt, because that village asked for no ceiling at all.
    if (capMode !== "unlimited" && !range.valid) {
      return res.status(409).json({ error: "This quest does not advertise a readable amount, so it cannot be consented while a cap is set. Give the quest a number on the board first." });
    }
    if (capMode === "posted") {
      if (requested < range.min || requested > range.max) {
        return res.status(409).json({
          error: `${requested} is outside what this quest advertises (${describeRange(range)}). The board is the contract.`,
          min: range.min,
          max: range.max,
        });
      }
    } else if (capMode === "capped") {
      const ceiling = Math.round(range.max * numberVar("quest.consent_cap_multiplier"));
      if (requested > ceiling) {
        return res.status(409).json({
          error: `${requested} is above the ceiling for this quest. It advertises ${describeRange(range)} and the bonus ceiling is ${ceiling}.`,
          max: range.max,
          ceiling,
        });
      }
    }
    /*
     * ISSUANCE WAITS FOR THE VILLAGE (R67), ASKED BEFORE ANY WORK IS DONE.
     *
     * The ledger refuses a faucet posting until the launch vote carries, and
     * `postTransferOn` asks the same question inside the transaction below,
     * where a refusal now rolls the flip back with it. So this is no longer
     * the thing standing between a member and a lost consent; it is a cheap
     * first ask that hands back the ledger's own sentence verbatim, before a
     * multiplier lookup and a transaction are spent finding out.
     *
     * `granted > 0` because a village that has opted into consenting at zero
     * posts nothing at all, and refusing that would be withholding an
     * acknowledgement that costs no tokens.
     */
    if (granted > 0) {
      const notStarted = await issuanceRefusal(getPool());
      if (notStarted) return res.status(409).json({ error: notStarted });
    }

    // Stage depends on consented-quest count, so the snapshot must be taken
    // BEFORE the claim flips to consented; taking it after would always compare
    // equal and the advancement event would never fire.
    const claimant = await members.byId(claim.userId);
    const stageBefore = claimant ? await stageOf(claimant) : null;

    // Applied AFTER the consent cap, on purpose; why, and why multiplied
    // rather than added, is in `rewardMultiplierFor` (server/lib/seasonPatterns.ts).
    const multiplier =
      effectiveLifecycle("badges") === "off"
        ? 1
        : await rewardMultiplierFor(getPool(), claim.userId, await dormantBadgeIds());
    const payout = multiplier === 1 ? granted : Math.floor(granted * multiplier);
    // The recomputed balance, set by the post below and read after it commits.
    // At payout 0 (allow_zero_consent) nothing posts and this stays null, so
    // the cache write is skipped: the old code wrote the failed post's 0.
    let credited: number | null = null;
    // One commit: the status check, the flip and the credit, or none of them.
    // The account of why is on `consentOnce` in server/repos/quests.ts.
    const outcome = await claimsRepo.consentOnce(
      claim.id,
      consentableFrom,
      (c) => {
        c.status = "consented";
        c.amount = granted;
        c.resolvedAt = new Date().toISOString();
        // WHO witnessed it (0070). The guard above already refuses self-consent
        // in the moment; recording the witness is what lets the audit see a
        // reciprocal pair afterwards, and what makes the rule checkable at all
        // once the request is over.
        c.consentedBy = actor.userId ?? null;
      },
      // No member row means no account to credit, which is what the old
      // `if (claimant && consented)` said. Same for a payout of zero.
      !claimant || payout <= 0 ? null : async (conn) => {
        // Through the ledger, not `+=`. The idempotency key is the claim, so a
        // retried or double-clicked consent credits exactly once, and the balance
        // column is RECOMPUTED from the ledger rather than incremented. S7:
        // recognition issues from the faucet account, so issuance is visible.
        const credit = await postTransferOn(conn, {
          from: RECOGNITION_FAUCET,
          to: memberAccount(claim.userId),
          amount: payout,
          source: "quest_consent",
          sourceRef: claim.id,
          description:
            multiplier === 1
              ? `Quest consented: ${claim.questTitle}`
              : `Quest consented: ${claim.questTitle} (${granted} x${multiplier} for a standing badge)`,
          idempotencyKey: `quest_consent:${claim.id}`,
        });
        if (!credit.ok) return { ok: false as const, error: credit.error ?? "the ledger refused the credit" };
        credited = credit.toBalance;
        return { ok: true as const };
      },
    );
    if (!outcome.ok) {
      if (outcome.reason === "missing") return res.status(404).json({ error: "Not found" });
      if (outcome.reason === "status") {
        return res.status(409).json({
          error: outcome.status === "claimed"
            ? `Cannot consent a claim with status "claimed". The member has to submit their work first.`
            : `Cannot consent a claim with status "${outcome.status}". It has already been resolved, so there is nothing left to witness.`,
          status: outcome.status,
        });
      }
      // Nothing was written, so this is a refusal and not a 500: the claim is
      // untouched, the member is still owed, and consenting again is the retry.
      console.error(`[quests] consent credit refused for claim ${claim.id}: ${outcome.error}`);
      return res.status(409).json({
        error: `The credit could not be posted, so nothing was recorded and the claim is untouched: ${outcome.error}`,
      });
    }
    const consented = outcome.claim;
    // Credit the player's balance
    if (claimant) {
      let after: any = claimant;
      if (credited !== null) {
        after = await members.update(claimant.id, (u: any) => { u.recognitionBalance = credited; });
      }
      // Whatever else the village's rules say a confirmed contribution mints,
      // which today is its voice token. Hearts are NOT re-minted here: the
      // block above has posted them since S7 with the range, the cap and the
      // standing multiplier, and a rule minting them again would pay twice for
      // one piece of work.
      //
      // Deliberately not awaited into the response contract and never allowed
      // to throw: a quest that was witnessed and credited must not fail because
      // a secondary mint had a bad afternoon. The occurrence key makes a later
      // repair-post safe.
      try {
        const extra = await mintForConfirmedClaim(getPool(), {
          id: consented.id,
          questId: consented.questId,
          userId: consented.userId,
          confirmedAt: consented.resolvedAt,
        });
        if (extra.skipped) {
          console.log(`[economy] claim ${consented.id}: no rule mint (${extra.skipped})`);
        }
      } catch (err) {
        console.error(`[economy] rule mint failed for claim ${consented.id}:`, err);
      }
      // S31 work-exchange (F2 firewall): a quest may ALSO carry stay credits,
      // released by the same human consent — a separate column, a separate
      // token, the same claim-keyed idempotency. Never blended with recognition.
      const stayReward = Math.max(0, Math.floor(Number(consentedQuest?.stayCreditReward ?? 0)));
      if (stayReward > 0) {
        const stayCredit = await mintStayCredits(getPool(), {
          userId: consented.userId,
          amount: stayReward,
          source: "quest_stay_reward",
          sourceRef: consented.id,
          description: `Work exchange: ${consented.questTitle}`,
          idempotencyKey: `queststay:${consented.id}`,
        });
        if (stayCredit.ok) {
          await notify({
            userId: consented.userId,
            type: "stays",
            title: `+${stayReward} stay credit(s) for "${consented.questTitle}"`,
            link: "/stay",
            dedupeKey: `queststay:${consented.id}:notify`,
          });
        } else {
          console.error(`[stays] work-exchange release failed for claim ${consented.id}: ${stayCredit.error}`);
        }
      }
      await addActivity("quest", `${firstName(consented.userName)} completed the quest "${consented.questTitle}"`, { actorUserId: consented.userId, entityType: "quest", entityRef: consented.questId });
      await notify({
        userId: consented.userId,
        type: "quest_consented",
        // What was actually CREDITED, not what was consented. A standing
        // badge can multiply the two apart, and telling a member a number
        // their balance does not match is the fastest way to lose their
        // trust in the ledger.
        title: multiplier === 1
          ? `Your quest was consented: ${consented.questTitle} (+${payout})`
          : `Your quest was consented: ${consented.questTitle} (+${payout}, including your badge bonus)`,
        link: `/quests/${consented.questId}`,
        // The real actor, admin or steward (see the declines branch above).
        actorUserId: actor.userId,
        dedupeKey: `quest:${consented.id}:consented`,
      });
      // Releasing value must always be attributable. The /api/admin audit
      // middleware only stamps isAdmin actors, so a steward's consent — the
      // whole point of widening this gate — needs its own row.
      if (!actor.isAdminActor) {
        void recordEvent(getPool(), {
          // Both figures: what the steward decided, and what the ledger
          // moved. An audit row carrying only the first would misstate the
          // release it exists to attribute.
          kind: "audit",
          text: multiplier === 1
            ? `quest:consented:${consented.id}:${payout}`
            : `quest:consented:${consented.id}:granted=${granted}:paid=${payout}:x${multiplier}`,
          actorUserId: actor.userId, entityType: "quest_claim", entityRef: consented.id, audience: "admin",
        });
      }
      if (after) {
        const stageAfter = await stageOf(after);
        if (stageBefore) await recordStageEvent(after, stageBefore, stageAfter, `quest consented: ${consented.questTitle}`);
      }
    }
    res.json(consented);
  });
}
