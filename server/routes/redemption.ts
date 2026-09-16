/**
 * Redemption over HTTP: asking to turn tokens into something real, and saying
 * that it happened.
 *
 * Six routes, all of them new:
 *
 *   GET  /api/redemptions              what I have open, what I may redeem, what is held
 *   POST /api/redemptions              ask
 *   POST /api/redemptions/:id/withdraw take it back, my own act
 *   GET  /api/admin/redemptions        the queue, for whoever holds the key
 *   POST /api/redemptions/:id/confirm  the member was paid; destroy the tokens
 *   POST /api/redemptions/:id/refuse   no; give them back
 *
 * IN THEIR OWN MODULE AND NOT IN server/index.ts, and this is mechanical rather
 * than tidy: that file is under a ratchet that turns one way, in LINES and in
 * route registrations, and it is currently at its route baseline exactly. Six
 * registrations there would be six over. The shape is server/routes/faqs.ts's,
 * which server/lib/appDeps.ts describes: `register(app, deps)` is the only
 * export that touches Express, and `deps` is a `Pick<AppDeps, ...>` so the
 * module's own signature says what it can reach.
 *
 * ── A MODULE THAT SHIPS OFF (ruling 22, 2026-09-15) ───────────────────────
 *
 * Both prefixes mount behind `requireModule("redemption")`, and the gate lines
 * live HERE rather than in server/index.ts for the ratchet reason above, the
 * shape server/routes/stays.ts already has. Off is a 404 for every door but one.
 *
 * WITHDRAW IS REGISTERED ABOVE THE GATE, DELIBERATELY. It is the member's own
 * refund door, and stays' settlement webhook is the precedent: value that is
 * already held has to be able to come home even when the module is served off.
 * `openStateCheck` refuses to switch the module off while anything is open, so
 * this matters only when a module is served off with rows open anyway, by a
 * quarantine or a hand-edited settings row, and then it is the one way a member
 * gets their tokens back before expiry, or at all if the village set expiry to
 * never. It reveals nothing about the lifecycle: an outsider gets the same 401
 * or "no such redemption" whether the module is on or off. Expiry itself runs
 * lifecycle-blind for the same reason (`expireRedemptions`).
 *
 * `openStateCheck` is attached in `register` below, which runs once at boot.
 * It needs the pool, so the shared registry stays import-clean for the client.
 *
 * ── WHO CONFIRMS, AND WHY IT IS A CAPABILITY ──────────────────────────────
 *
 * The founder's words are "confirmed by a steward or a vote (if no stewards are
 * in a role)". Neither half can be executed literally. There is no
 * `isSteward()` in this codebase: in the mint co-sign flow, which is the one
 * place the product already says "steward" to a founder, the word is prose for
 * `user.role === 'admin' || 'founder'`. And there is no vacancy predicate: the
 * question "is this role empty" is computed inline in three places and spelled
 * differently in each, with a fourth spelling in the natural-language readers.
 *
 * `redemption.confirm` asks neither question. A village that wants its Steward
 * Circle to confirm grants the key to that role; a village that has granted it
 * to nobody falls through the one gate to admin, which is the behaviour the
 * default describes. There is no vacancy to detect, only a key nobody was
 * given, and the fall-through is already written and already tested.
 *
 * ── WHY THESE ARE NOT GOVERNANCE PROPOSALS ────────────────────────────────
 *
 * A redemption is a financial request about one person. `GET /api/game/mechanics/proposals`
 * takes `_req` and performs no auth check at all, by design and with a stated
 * reason, so routing redemptions through it would publish what every member
 * asked for and what they asked for it in return, to anyone with the link,
 * permanently, including after a refusal. And every mechanics proposal spends
 * one of that member's five `governance.proposals_per_member_per_cycle` rule
 * changes for the moon, which inverts what that cap is for.
 *
 * So a redemption is its own row, visible to the member and to whoever may
 * confirm it. It keeps the founder's word "proposal" in what the member reads,
 * because that is the right word for what they are doing, without taking the
 * machinery that word points at.
 */
import type { Express } from "express";
import { MODULES_BY_ID } from "../../shared/modules";
import type { AppDeps } from "../lib/appDeps";
import { requireModule } from "../lib/modules";
import { recordEvent } from "../lib/events";
import { allTokens, tokenDef } from "../lib/ledger";
import { cycleWindow, decimalsFor, finerThanScale, fromLedgerUnits, toLedgerUnits } from "../lib/economy";
import { isListedForTrade } from "../lib/exchange";
import { openExitFor } from "../lib/exit";
import {
  canSettleRedemption,
  confirmRefusal,
  redeemableTokens,
  redemptionWarnings,
  VOTE_PATH_BUILT,
  type ConfirmAsk,
  type RedemptionState,
} from "../lib/redemption";
import {
  heldForRedemption,
  holdsOnPropose,
  openRedemptionsFor,
  redemptionById,
  redemptionHistory,
  redemptionOpenState,
  redemptionQueue,
  redemptionsOpenedSince,
  requestRedemption,
  settleRedemption,
} from "../lib/redemptionStore";
import { balanceOf, memberAccount } from "../lib/ledger";
import { numberVar, stringVar } from "../lib/variables";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "guardCapability" | "members" | "notify" | "overLimit">;

/** What one redemption looks like to a person, with every amount human. */
function forReading(row: {
  id: string;
  userId: string;
  tokenSlug: string;
  amountUnits: number;
  askedFor: string;
  state: RedemptionState;
  confirmedByMode: string;
  decisionNote: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}) {
  const def = tokenDef(row.tokenSlug);
  return {
    id: row.id,
    userId: row.userId,
    token: row.tokenSlug,
    tokenName: def?.name ?? row.tokenSlug,
    // HUMAN, and this is the ONE conversion out. `redemptions`.`amount` is
    // minor units everywhere below the route, and every sentence a person reads
    // is built from this field.
    amount: fromLedgerUnits(row.tokenSlug, row.amountUnits),
    askedFor: row.askedFor,
    state: row.state,
    confirmedByMode: row.confirmedByMode,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    openedAt: row.createdAt,
  };
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, guardCapability, members, notify, overLimit } = deps;

  MODULES_BY_ID["redemption"].openStateCheck = () => redemptionOpenState(getPool());

  /**
   * Take it back. The member's own act, and the only ending they can reach.
   *
   * It carries no reason, deliberately: a confirmation and a refusal are
   * decisions ABOUT somebody and owe them a stated reason, and changing your
   * own mind owes nobody one.
   *
   * ABOVE THE GATE, on purpose: see the header. Express answers in
   * registration order, so this handler replies before the `app.use` below is
   * ever consulted for this path.
   */
  app.post("/api/redemptions/:id/withdraw", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const row = await redemptionById(pool, String(req.params.id));
    if (!row || row.userId !== user.id) return res.status(404).json({ error: "no such redemption" });
    const out = await settleRedemption(pool, {
      id: row.id,
      to: "withdrawn",
      actorUserId: user.id,
      note: "Withdrawn by the member who asked",
    });
    if (!out.ok) {
      return res.status(out.reason === "raced" || out.reason === "terminal" ? 409 : 500).json({ error: out.error });
    }
    res.json({ redemption: forReading(out.row), released: out.released });
  });

  app.use("/api/redemptions", requireModule("redemption"));
  app.use("/api/admin/redemptions", requireModule("redemption"));

  /**
   * What this member has open, what they may ask for, and what is held.
   *
   * The held figure is here and not only in the wallet because a member whose
   * balance reads short has one question, and every surface that shows the
   * balance has to be able to answer it.
   */
  app.get("/api/redemptions", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const open = await openRedemptionsFor(pool, user.id);
    const heldUnits = await heldForRedemption(pool, user.id);
    const held: Record<string, number> = {};
    for (const [slug, units] of Object.entries(heldUnits)) held[slug] = fromLedgerUnits(slug, units);
    const perCycle = numberVar("redemption.per_member_per_cycle");
    const openedThisCycle = await redemptionsOpenedSince(pool, user.id, cycleWindow().startsAt);
    res.json({
      open: open.map(forReading),
      history: (await redemptionHistory(pool, user.id)).map(forReading),
      held,
      holds: holdsOnPropose(),
      confirmedBy: String(stringVar("redemption.confirmed_by") ?? "steward"),
      votePathBuilt: VOTE_PATH_BUILT,
      perCycle,
      openedThisCycle,
      tokens: redeemableTokens(allTokens()).map((t) => ({
        slug: t.slug,
        name: t.name,
        decimals: t.decimals,
      })),
    });
  });

  /**
   * Ask.
   *
   * The amount arrives HUMAN from a person typing into a field, and is
   * converted once, here, with `toLedgerUnits`. Everything below this line is
   * minor units. That single conversion is the whole units rule for this
   * domain, and it is written down because `voice_claims` stores human and pays
   * for it with two "do not convert again" comments on opposite sides of one
   * module.
   */
  app.post("/api/redemptions", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    // Bounded like the wallet send, per member per day. Every ask opens a
    // SERIALIZABLE transaction holding the member's row, so pressing it in a
    // loop is cost the village cannot refuse even when every ask is refused.
    if (await overLimit(`redemption-open:${user.id}`, 30, 24 * 60 * 60 * 1000)) {
      return res.status(429).json({ error: "You have asked to redeem many times today. Try again tomorrow." });
    }
    const body = req.body ?? {};
    const slug = String(body.token ?? body.tokenSlug ?? "").trim().toLowerCase();
    const asked = Number(body.amount);
    if (!slug) return res.status(400).json({ error: "Name the token you would like to redeem." });
    if (!Number.isFinite(asked)) return res.status(400).json({ error: "Say how much." });
    /*
     * A FINER NUMBER THAN THE TOKEN CARRIES IS REFUSED, NOT ROUNDED.
     * `toLedgerUnits` rounds, deliberately and for a good reason (0.1 * 1000 is
     * not 100 in binary), so at 0 decimals a member asking for 1.5 credits
     * would silently redeem 2 and be told nothing. Converting and converting
     * back is the cheap exact test, and it costs the member one sentence
     * instead of half a token. `finerThanScale` is that test, shared with the
     * hand-mint route so the two doors agree on what "too fine" means.
     */
    const units = toLedgerUnits(slug, asked);
    if (tokenDef(slug) && finerThanScale(asked, decimalsFor(slug))) {
      // Worded from the token's own scale: "whole" is wrong on a token that
      // carries two decimal places, and it was the only sentence a member got.
      const places = decimalsFor(slug);
      return res.status(400).json({
        error: places > 0
          ? `Ask for ${tokenDef(slug)?.name ?? slug} in positive amounts with at most ${places} decimal places.`
          : `Ask for ${tokenDef(slug)?.name ?? slug} in whole positive amounts.`,
      });
    }
    const pool = getPool();
    const exit = await openExitFor(pool, user.id);
    const out = await requestRedemption(pool, {
      userId: user.id,
      tokenSlug: slug,
      amountUnits: units,
      askedFor: String(body.askedFor ?? ""),
      exitOpen: !!exit,
      cycleStart: cycleWindow().startsAt,
    });
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    void recordEvent(pool, {
      kind: "audit",
      text: `redemption:opened:${out.row.amountUnits}:${slug}`,
      actorUserId: user.id,
      entityType: "redemption",
      entityRef: out.row.id,
      audience: "admin",
    });
    res.status(201).json({ redemption: forReading(out.row), holds: !!out.row.heldAccount });
  });

  /**
   * The queue, for whoever holds the key.
   *
   * EVERY WARNING RIDES ON THE ROW AND NONE OF THEM BLOCKS. That is
   * `exitLeverFindings`' shape and `exitLeverProblem`'s rule: a warning belongs
   * to the person looking, never to the save. The first of them is the same
   * finding the exit levers already carry about a withdrawal window, met on a
   * different door, and it is worded so a reader recognises the pair.
   */
  app.get("/api/admin/redemptions", async (req, res) => {
    if (!(await guardCapability(req, res, "redemption.confirm"))) return;
    const pool = getPool();
    const queue = await redemptionQueue(pool);
    const rows = [];
    for (const row of queue) {
      const person = await members.byId(row.userId).catch(() => null);
      const totalHeldUnits =
        (await balanceOf(pool, memberAccount(row.userId), row.tokenSlug)) + row.amountUnits;
      rows.push({
        ...forReading(row),
        memberName: person?.name ?? row.userId,
        warnings: redemptionWarnings({
          tokenName: tokenDef(row.tokenSlug)?.name ?? row.tokenSlug,
          listedForTrade: isListedForTrade(row.tokenSlug),
          amountUnits: row.amountUnits,
          totalHeldUnits,
          redemptionsThisMoon: await redemptionsOpenedSince(pool, row.userId, cycleWindow().startsAt),
        }),
      });
    }
    res.json({ redemptions: rows, holds: holdsOnPropose() });
  });

  /**
   * Decide. One handler for both endings, because the two differ in one word
   * and every guard around them is identical.
   *
   * EVERY GUARD FROM THE ASK IS RE-RUN, which is 0106's rule and its stated
   * reason: a token can be retired and a member can leave between somebody
   * asking and somebody agreeing.
   */
  const decide = (to: RedemptionState) => async (req: any, res: any) => {
    if (!(await guardCapability(req, res, "redemption.confirm"))) return;
    const actor = await authedUser(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const row = await redemptionById(pool, String(req.params.id));
    if (!row) return res.status(404).json({ error: "no such redemption" });
    // THE ROW'S OWN QUESTION FIRST. Whether this redemption may move at all is
    // the state machine's answer, and asking it before the person's question
    // means somebody pressing on a decision that has already been made is told
    // that, instead of being asked for a reason nobody needs.
    const movable = canSettleRedemption(row.state, to);
    if (!movable.ok) return res.status(409).json({ error: movable.error });
    const def = tokenDef(row.tokenSlug);
    const person = await members.byId(row.userId).catch(() => null);
    const ask: ConfirmAsk = {
      memberUserId: row.userId,
      actorUserId: actor.id,
      tokenStillReal: !!def && def.active,
      memberStillHere: !!person,
      tokenName: def?.name ?? row.tokenSlug,
      note: String(req.body?.note ?? ""),
    };
    const refusal = confirmRefusal(ask);
    if (refusal) return res.status(409).json({ error: refusal });

    const out = await settleRedemption(pool, {
      id: row.id,
      to,
      actorUserId: actor.id,
      note: ask.note,
    });
    if (!out.ok) {
      return res.status(out.reason === "raced" || out.reason === "terminal" ? 409 : 500).json({ error: out.error });
    }
    const human = fromLedgerUnits(row.tokenSlug, row.amountUnits);
    void recordEvent(pool, {
      kind: "audit",
      text: `redemption:${to}:${row.amountUnits}:${row.tokenSlug}`,
      actorUserId: actor.id,
      entityType: "redemption",
      entityRef: row.id,
      audience: "admin",
    });
    /*
     * WHAT THE MEMBER IS TOLD, and the second sentence is the load-bearing one.
     * A confirmation is a steward's statement that the off-platform half
     * happened. The platform is the witness and never the guarantor, so the
     * copy says what was agreed and never that the payment arrived.
     */
    void notify({
      userId: row.userId,
      type: to === "confirmed" ? "redemption_confirmed" : "redemption_refused",
      title:
        to === "confirmed"
          ? `Your redemption is confirmed and the ${human} ${ask.tokenName} are gone`
          : `Your redemption was not confirmed, and your ${human} ${ask.tokenName} are back in your wallet`,
      body:
        to === "confirmed"
          ? "This says a steward agreed you were paid. It does not say the payment arrived. If it has not, tell a steward: the record of what was agreed is still here."
          : ask.note,
      dedupeKey: `redemption:${row.id}:${to}`,
      link: "/wallet",
    });
    res.json({ redemption: forReading(out.row), released: out.released });
  };

  app.post("/api/redemptions/:id/confirm", decide("confirmed"));
  app.post("/api/redemptions/:id/refuse", decide("refused"));
}
