/**
 * The membrane: who is vouched into membership, and by whom.
 *
 *   POST /api/members/:id/vouch        say you know this person
 *   POST /api/members/:id/super-vouch  a steward admits them outright
 *   GET  /api/members/:id/vouches      who has vouched for them
 *   GET  /api/me/vouches               your own standing at the membrane
 *
 * ── A NEW MODULE, NOT LINES IN server/index.ts ──────────────────────────────
 *
 * That file is ratcheted on lines and on route registrations and both only
 * ever fall, so a route module is the cheap direction by construction. Nothing
 * here raises a baseline.
 *
 * ── WHAT THE THIRD VOUCH DOES ───────────────────────────────────────────────
 *
 * It grants membership, here, in the same request. That is the one thing this
 * file does that is more than bookkeeping, and it is why the write and the
 * count live together: a village where the third vouch landed and the rung did
 * not move would leave somebody looking at "3 of 3" and still locked out, with
 * nobody able to say which of the two was wrong.
 *
 * ── AND WHY GRANTING IS NOT THE SAME AS COMPUTING ───────────────────────────
 *
 * Every other position on this ladder is derived at read time from live rows,
 * so it falls when the facts move. Membership is written, because a vouch
 * cannot be withdrawn (Rye, 2026-09-08) and so the fact can never move. The
 * flag and the rows agree forever, and `membershipGranted` keeps meaning
 * exactly what it meant before: somebody decided this person is in.
 */
import type { Express } from "express";

import type { AppDeps } from "../lib/appDeps";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { numberVar } from "../lib/variables";
import { DEFAULT_VOUCHES_FOR_MEMBERSHIP, refuseVouch, vouchSentence, vouchState } from "../lib/vouches";
import { recordVouch, vouchesBy, vouchesFor } from "../repos/vouches";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "members" | "guardCapability" | "stageOf" | "recordStageEvent">;

/** The bar this village sets, floored at one by `vouchState`. */
const neededHere = (): number => {
  const n = numberVar("membership.vouches_required");
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_VOUCHES_FOR_MEMBERSHIP;
};

/** Where the rung this route names sits, resolved once. */
const CONTRIBUTOR_INDEX = GAME_CONFIG.stages.findIndex((s) => s.id === "contributor");

const newId = (): string => `vch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, members, guardCapability, stageOf, recordStageEvent } = deps;

  /**
   * Give one, and it may be the one that admits them.
   *
   * `member.vouch` opens at the Contributor rung, so a voucher has finished a
   * quest for this village before speaking for somebody else. The gate is the
   * ONE gate and it answers the request itself when the answer is no.
   */
  app.post("/api/members/:id/vouch", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    /*
     * A WRITTEN SENTENCE, not a bare 401. `guardCapability` falls back to
     * `auth_required` when a route supplies nothing, and its own header names
     * that as the loss to avoid: the gate would be right and every person who
     * met it would be told less than before. Somebody refused here is signed
     * in and simply has not reached the rung, so the refusal says which rung
     * and what reaches it.
     */
    if (
      !(await guardCapability(req, res, "member.vouch", {
        status: 403,
        body: {
          error:
            "Vouching for somebody opens at Contributor. Finish a quest for the village, and you can speak for the next person who arrives.",
        },
      }))
    ) {
      return;
    }
    return void (await give(req, res, user, "member"));
  });

  /**
   * A steward admits somebody outright.
   *
   * For the village that has lost one of its three before a fourth reached
   * Contributor and cannot otherwise admit anybody at all.
   *
   * ITS OWN KEY, and the first version of this used `steward.veto` instead.
   * The governance engine ruled against that and was right: `roleGrants.ts`
   * says the steward seat "is filled and emptied by the `role_seat` and
   * `role_unseat` ballots and by nothing else", so the veto MOVES between
   * roles by vote. A conflated key means a village voting "the Elders hold
   * the veto" has also voted "the Elders may admit members outright", without
   * ever being asked that question.
   *
   * The guard that made me reach for a shortcut is the thing that makes a
   * separate key safe: `member.superVouch` joins the same refusal lists that
   * already protect `member.vouch` and `ballot.vote`, so it cannot be seated
   * by an admin route or voted onto a role. It is a list to join, not a wall
   * to route around.
   */
  app.post("/api/members/:id/super-vouch", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (
      !(await guardCapability(req, res, "member.superVouch", {
        status: 403,
        body: {
          error:
            "A super vouch is a steward's, and it exists for a village that has lost one of its three and cannot otherwise admit anybody.",
        },
      }))
    ) {
      return;
    }
    return void (await give(req, res, user, "super"));
  });

  /**
   * The person this is about, by id OR by handle.
   *
   * The public profile at /profile/:handle is where a member meets somebody
   * they might vouch for, and that payload carries no id, deliberately: a
   * handle is already public and an id is not, so the page should not have to
   * learn one to press a button. Id first, because that is what a notification
   * link or an admin screen holds.
   */
  async function findMember(key: string): Promise<any | null> {
    const trimmed = String(key ?? "").trim();
    if (!trimmed) return null;
    const byId = await members.byId(trimmed);
    if (byId) return byId;
    const wanted = trimmed.toLowerCase();
    return (await members.all()).find((m: any) => String(m.handle ?? "").toLowerCase() === wanted) ?? null;
  }

  async function give(req: any, res: any, user: any, kind: "member" | "super") {
    const pool = getPool();
    const target = await findMember(String(req.params.id ?? ""));
    if (!target) return res.status(404).json({ error: "There is nobody here by that name." });
    const targetId = String(target.id);

    const existing = await vouchesFor(pool, targetId);
    const refusal = refuseVouch({
      voucherUserId: String(user.id),
      vouchedUserId: targetId,
      existing,
      vouchedIsMember: !!target.membershipGranted,
    });
    if (refusal) return res.status(409).json(refusal);

    const note = String(req.body?.note ?? "").trim().slice(0, 280) || null;
    await recordVouch(pool, {
      id: newId(),
      voucherUserId: String(user.id),
      vouchedUserId: targetId,
      kind,
      note,
    });

    // Re-read rather than appending to the list above: another voucher may
    // have landed between the two, and the count that decides membership must
    // be the database's answer and never this handler's arithmetic.
    const state = vouchState(await vouchesFor(pool, targetId), neededHere());
    if (state.met && !target.membershipGranted) {
      await members.update(targetId, (m: any) => {
        m.membershipGranted = true;
      });
    }
    res.json({ vouches: state, admitted: state.met, sentence: vouchSentence(state) });
  }

  /**
   * NAME SOMEBODY A CONTRIBUTOR, when the village has no tokens to pay them in.
   *
   * Rye's ruling, 2026-09-08: Contributor is the rung the village pays you
   * onto, and a village that runs no token economy would therefore never have
   * one. Since Contributor is what opens `member.vouch`, such a village could
   * never assemble the three vouchers its next member needs. This is the door
   * out of that.
   *
   * ── WHY THIS KEY GATES IT ───────────────────────────────────────────────
   *
   * `member.superVouch`, which the steward circle holds. A steward can already
   * admit a member OUTRIGHT, so naming somebody a contributor is strictly the
   * smaller act, and gating the smaller act on a key that carries the larger
   * one keeps the membrane's whole authority in a single place. It also means
   * a village that moves the override to another role moves this with it,
   * which is the correct coupling: both answer "who keeps the door working".
   *
   * ── AND WHY IT NAMES ONE RUNG RATHER THAN TAKING A STAGE ID ─────────────
   *
   * `PUT /api/admin/players/:id/stage` already sets any rung and is admin-only,
   * and it should stay that way. Handing a steward a general stage setter to
   * solve a specific problem is how a narrow power becomes a wide one. This
   * says contributor, in the route, and cannot say anything else.
   */
  app.post("/api/members/:id/contributor", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (
      !(await guardCapability(req, res, "member.superVouch", {
        status: 403,
        body: {
          error:
            "Naming somebody a contributor is a steward's, and it exists for a village with no tokens to pay anybody in.",
        },
      }))
    ) {
      return;
    }
    const target = await findMember(String(req.params.id ?? ""));
    if (!target) return res.status(404).json({ error: "There is nobody here by that name." });

    /*
     * ONLY EVER RAISES. `stageGranted` holds one rung, so writing "contributor"
     * over a higher grant would quietly demote somebody a village had already
     * placed above it. A member who is already at or past this rung is told
     * nothing changed, which is true.
     */
    const before = await stageOf(target);
    const held = String(target.stageGranted ?? "");
    if (held && GAME_CONFIG.stages.findIndex((s) => s.id === held) >= CONTRIBUTOR_INDEX) {
      return res.json({ changed: false, stage: before, note: "They are already granted this rung or one above it." });
    }
    const updated = await members.update(target.id, (u: any) => {
      u.stageGranted = "contributor";
    });
    if (!updated) return res.status(404).json({ error: "There is nobody here by that name." });
    const after = await stageOf(updated);
    await recordStageEvent(updated, before, after, "named a contributor by a steward");
    res.json({ changed: true, stage: after });
  });

  /**
   * Who has vouched for this person.
   *
   * Member-scoped rather than public: the membrane is the village's business
   * and not a stranger's. It returns ids and the words somebody wrote, never
   * an email or anything else off the member record.
   */
  app.get("/api/members/:id/vouches", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const target = await findMember(String(req.params.id ?? ""));
    if (!target) return res.status(404).json({ error: "There is nobody here by that name." });
    const rows = await vouchesFor(getPool(), String(target.id));
    const state = vouchState(rows, neededHere());
    res.json({
      vouches: rows.map((v) => ({ voucherUserId: v.voucherUserId, kind: v.kind, note: v.note })),
      state,
      /*
       * Whether they are IN, which is not the same question as whether the
       * count is met. A member admitted by an admin grant, or by the 0058
       * freeze that predates all of this, holds membership with no vouches at
       * all: reading `met` alone would offer a stranger a button to admit
       * somebody who has been here two years, and the write would refuse it.
       */
      isMember: !!target.membershipGranted,
      sentence: vouchSentence(state),
    });
  });

  /** Your own standing at the membrane, and what you have said about others. */
  app.get("/api/me/vouches", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const received = await vouchesFor(pool, String(user.id));
    const state = vouchState(received, neededHere());
    const given = await vouchesBy(pool, String(user.id));
    res.json({
      state,
      sentence: vouchSentence(state),
      receivedFrom: received.map((v) => ({ voucherUserId: v.voucherUserId, kind: v.kind, note: v.note })),
      // What somebody has said about others, which a reputation mechanic will
      // later read and which a member is owed sight of now.
      givenTo: given.map((v) => ({ vouchedUserId: v.vouchedUserId, kind: v.kind })),
    });
  });
}
