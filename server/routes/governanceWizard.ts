/**
 * What a member may do in governance, and the drafts they leave behind.
 *
 * Five routes, lifted out of server/index.ts unchanged:
 *
 *   GET    /api/governance/standing     may I vote, what do I weigh, and why
 *   GET    /api/governance/wizard       what the wizard may offer today
 *   GET    /api/governance/drafts       my unfinished proposals
 *   POST   /api/governance/drafts       save and leave, and every autosave
 *   DELETE /api/governance/drafts/:id   discard one
 *
 * Five reads and writes about the member asking, which is what separates
 * this file from server/routes/governanceWeights.ts next door: those routes
 * allocate weight, these only report it.
 *
 * ALL FIVE MOUNT BEHIND requireModule("governance"), installed on the
 * /api/governance prefix in server/index.ts before this register() runs. The
 * module ships OFF, and while it is off every path here is a 404.
 *
 * `capabilityCtx` RATHER THAN A GATE, on purpose, and this is one of the few
 * places where that is the right call. Every route here asks a member ABOUT
 * themselves and refuses nobody on a capability, so there is no act to carry
 * a break-glass for. /standing's own comment says it at length: an admin
 * reading their own standing on a village-held key is told `false`, which is
 * the honest answer about who facilitates.
 *
 * REGISTERED WHERE IT WAS, because Express matches in registration order.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { capabilityDecision, hasCapability } from "../../shared/capabilities";
import { weightCapLine, weightHistory, weightsFor } from "../lib/governanceWeights";
import { tokenDef } from "../lib/ledger";
import {
  ADVISORY_TYPES,
  CONDUCTABLE_TYPES,
  DRAFT_CAP,
  deleteDraft as deleteProposalDraft,
  draftsOf as proposalDraftsOf,
  saveDraft as saveProposalDraft,
} from "../lib/proposalDrafts";
import { numberVar } from "../lib/variables";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "capabilityCtx" | "weightModeNow">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, capabilityCtx, weightModeNow } = deps;

  // ── The wizard's surfaces (round 5, lane G2) ──────────────────────────────
  //
  // Two reads and two writes, all inside requireModule("governance") with the
  // rest of the engine: a member's own standing before they vote, and the
  // server-side drafts that let a half-written proposal survive the browser
  // that typed it.

  /**
   * MY standing, in my own words: whether I may vote, how much I weigh, and
   * WHY I weigh that. Custom-mode weight is allocated power, so this answer
   * carries the member's own slice of the append-only trail rather than
   * leaving them to find their first name in the village-wide list.
   */
  app.get("/api/governance/standing", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const snapshot = weightModeNow();
    const ctx = await capabilityCtx(user);
    /*
     * WHY, AND NOT ONLY WHETHER. This read the yes-or-no face of the gate and
     * served a bare `eligible: false`, so the card underneath had to name
     * BOTH of the two things that could be refusing a member and let them
     * guess which was theirs. A member a warning badge is holding back is
     * entitled to know that is the reason.
     *
     * ONE named fact rather than the source string. `CapabilitySource` is the
     * gate's internal vocabulary, and shipping it would invite a client map
     * from every one of its seven values to a sentence, which is the
     * hand-kept-mirror class exactly. One boolean answers the one question a
     * member is owed an answer to.
     */
    const voteGate = capabilityDecision("ballot.vote", ctx);
    const eligible = voteGate.allowed;
    const weights = await weightsFor(getPool(), [String(user.id)], snapshot);
    const weight = weights.get(String(user.id)) ?? 0;
    const tokenName = snapshot.token ? tokenDef(snapshot.token)?.name ?? snapshot.token : null;
    const why =
      snapshot.mode === "equal"
        ? "Every member who may vote weighs the same here. One person, one vote."
        : snapshot.mode === "token"
          ? [
              `Your weight is your balance of ${tokenName ?? "the village's chosen token"} at the moment a ballot opens, and it freezes there for that vote.`,
              // Said only while the cap is on, because only then is it true.
              weightCapLine(snapshot),
            ].filter(Boolean).join(" ")
          : "The stewards allocate weight one member at a time, and every change carries a reason. Yours is below.";
    res.json({
      mode: snapshot.mode,
      token: snapshot.token,
      tokenName,
      eligible,
      /**
       * Always false since 0109: a warning badge can no longer take a voice
       * away, so this key never reaches the deny step. Served rather than
       * dropped so the client contract holds while the surfaces that read it
       * catch up.
       */
      deniedByWarning: voteGate.source === "denied by warning badge",
      weight,
      why,
      // Whether this member facilitates: rules objections, closes early. The
      // page hides those controls on this rather than offering a button the
      // route will refuse, which is the difference between a surface that
      // teaches a member their standing and one that lets them find out by
      // being told no.
      //
      // 0103: a LOOK, and the PURE gate. `mayAct` would read the break-glass
      // off a request that is only asking a member about themselves, and an
      // admin checking their own standing would have written "acted on a
      // power this village holds" to the public pulse. On a village-held key
      // an admin is told `false` here, which is the honest answer about who
      // facilitates; the 409 on the close route is where they are told how to
      // reach past it.
      mayDecide: hasCapability("proposal.decide", ctx),
      // The member's own history, never the village's: the village-wide trail
      // already has its own route, and this one answers "why me".
      history: snapshot.mode === "custom" ? await weightHistory(getPool(), String(user.id), 50) : [],
    });
  });

  /**
   * What the wizard may offer. The type step reads this rather than assuming,
   * so a member never walks five steps toward a publish route that this
   * deployment has not mounted yet.
   */
  app.get("/api/governance/wizard", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const ctx = await capabilityCtx(user);
    res.json({
      conductable: CONDUCTABLE_TYPES,
      // The kinds this village can put to a NON-BINDING vote today: every
      // type the executors have not reached yet. A type step reading both
      // lists can offer a practice vote where it used to offer a locked card,
      // which turns four dead ends into four ways to find out what the
      // village already agrees about.
      advisory: ADVISORY_TYPES,
      mayOpenAdvisory: hasCapability("proposal.open", ctx),
      draftCap: DRAFT_CAP,
      supportThreshold: Math.max(0, numberVar("governance.proposal_support_threshold")),
      // What happens after publish, so the review step can say it plainly
      // instead of the wizard implying the vote starts on the button.
      mayOpenBallot: hasCapability("proposal.open", ctx),
    });
  });

  /** My unfinished proposals, most recently touched first. */
  app.get("/api/governance/drafts", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    res.json({ cap: DRAFT_CAP, drafts: await proposalDraftsOf(getPool(), String(user.id)) });
  });

  /**
   * Save-and-leave, and every autosave before it. A body with an `id` updates
   * that draft when the caller owns it; without one it creates, up to the cap.
   */
  app.post("/api/governance/drafts", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const result = await saveProposalDraft(getPool(), {
      id: req.body?.id ? String(req.body.id) : null,
      userId: String(user.id),
      wizardType: String(req.body?.wizardType ?? ""),
      payload: req.body?.payload,
      stepIndex: Number(req.body?.stepIndex ?? 0),
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ success: true, draft: result.draft, created: result.created });
  });

  /** Discard a draft, or clear it once its proposal exists. */
  app.delete("/api/governance/drafts/:id", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const gone = await deleteProposalDraft(getPool(), req.params.id, String(user.id));
    if (!gone) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });
}
