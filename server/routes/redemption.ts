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
  confirmModeFor,
  confirmRefusal,
  redeemableTokens,
  redemptionCurrencies,
  redemptionQuote,
  redemptionRateSource,
  redemptionWarnings,
  resolveRedemptionRate,
  setRateAboveExchange,
  VOTE_PATH_BUILT,
  type ConfirmAsk,
  type RedemptionQuote,
  type RedemptionState,
} from "../lib/redemption";
import { latestPrice } from "../lib/exchange";
import { latestRates } from "../lib/fxRates";
import { convertMinor, crossRate, exponentOf, formatMoney } from "../../shared/money";
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

type Deps = Pick<
  AppDeps,
  "authedUser" | "getPool" | "guardCapability" | "members" | "notify" | "overLimit" | "projectCurrency"
> & {
  /**
   * Put a redemption to the village, when nobody holds the key.
   *
   * Handed in for the same reason the holder count is: opening a ballot needs
   * the electorate, the weight snapshot and the threshold dials, and those are
   * gathered once in server/index.ts (`roleBallotSetup`). Null while this build
   * cannot carry a redemption to a vote.
   */
  openRedemptionBallot?: (redemptionId: string) => Promise<{ ok: boolean; error?: string }>;

  /**
   * Who can actually confirm a redemption in this village right now.
   *
   * Handed in rather than computed here, because counting holders needs the
   * roles cache and the role_holders cache, both of which live in
   * server/index.ts, plus one read of the badge rows. `liveHoldersOfCapability`
   * does the counting; this is only the wire.
   */
  redemptionKeyHolders: () => Promise<string[]>;
};

/**
 * WHAT THE EXCHANGE'S POSTED PRICE IS DENOMINATED IN, measured rather than
 * assumed. `currency_prices` carries `price_minor` and no currency column, and
 * `/api/exchange/buy` hands `createCheckout` no currency, so Stripe is charged
 * in the `"usd"` default in server/lib/payments.ts. Following the exchange
 * therefore means following a USD price, converted through the daily table.
 *
 * A village with the exchange module OFF may still have a posted price sitting
 * in that table from before. That is the honest answer to "what does this
 * village sell it for": the last price it posted. A village that means to stop
 * offering that number clears the price or sets its own rate.
 */
const EXCHANGE_PRICE_CURRENCY = "USD";

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
  currency?: string | null;
  rateMinor?: number | null;
  rateSource?: string | null;
  feePct?: number | null;
  grossMinor?: number | null;
  feeMinor?: number | null;
  netMinor?: number | null;
  processText?: string | null;
}) {
  const def = tokenDef(row.tokenSlug);
  const money = row.currency && row.grossMinor !== null && row.grossMinor !== undefined
    ? {
        currency: row.currency,
        grossMinor: row.grossMinor,
        feeMinor: row.feeMinor ?? 0,
        netMinor: row.netMinor ?? 0,
        rateMinor: row.rateMinor ?? 0,
        rateSource: row.rateSource ?? null,
        feePct: row.feePct ?? 0,
        // FORMATTED ON THE SERVER, once. Every surface that prints these has to
        // agree, and `shared/money.ts` is the one place money becomes words.
        grossText: formatMoney(row.grossMinor, row.currency),
        feeText: formatMoney(row.feeMinor ?? 0, row.currency),
        netText: formatMoney(row.netMinor ?? 0, row.currency),
      }
    : null;
  return {
    money,
    processText: row.processText ?? null,
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
  const { authedUser, getPool, guardCapability, members, notify, openRedemptionBallot, overLimit, projectCurrency, redemptionKeyHolders } = deps;

  /**
   * WHO DECIDES, derived at the moment of asking (Rye, 2026-09-15).
   *
   * "A steward confirms but if there isn't a steward the village can vote on
   * these things." So this counts the people who hold `redemption.confirm`
   * through the village's own powers, and `confirmModeFor` turns that number
   * into the mode. A failed count answers STEWARD, deliberately: the vote path
   * is the wider consequence (a public ballot, permanently), and a database
   * hiccup must never be what routes somebody's private request into public.
   */
  const confirmMode = async (): Promise<"steward" | "vote"> => {
    try {
      return confirmModeFor((await redemptionKeyHolders()).length);
    } catch (e) {
      console.error("[redemption] could not count who holds the redemption key; treating it as a steward's", e);
      return "steward";
    }
  };

  MODULES_BY_ID["redemption"].openStateCheck = () => redemptionOpenState(getPool());

  /**
   * WHAT THIS VILLAGE HAS DECIDED ABOUT MONEY, resolved for one token and one
   * currency (ruling 23).
   *
   * Every figure a member or a steward reads comes from here, and so does the
   * snapshot written onto the row, so the number on the screen and the number
   * in the record are the same number by construction.
   *
   * THE CAPS ARE CONVERTED ONCE, HERE. A cap is typed in whole money and stored
   * that way; everything below the route boundary is minor units, the same rule
   * the token amounts already follow.
   */
  async function moneyContext(slug: string, wanted?: unknown) {
    const pool = getPool();
    // THE MERGED CURRENCY, never the stored brand document's. That document
    // holds only what a founder typed in Make This Yours, so a village that
    // never typed one read blank here and was quoted a private fallback while
    // every price on the site was in the platform default.
    const currencies = redemptionCurrencies(projectCurrency());
    const asked = String(wanted ?? "").trim().toUpperCase();
    const currency = currencies.includes(asked) ? asked : currencies[0];
    const source = redemptionRateSource();
    // Both reads are outside the ask's transaction on purpose: they are another
    // module's table and a cache of a daily feed, and neither is a figure this
    // request may hold a lock over.
    const posted = await latestPrice(pool, slug).catch(() => null);
    const table = await latestRates(pool).catch(() => ({ base: "EUR", asOf: null, rates: {} as Record<string, number> }));
    const convert = (amountMinor: number, from: string, to: string) => {
      const r = crossRate(table.rates, from, to);
      return r === null ? null : convertMinor(amountMinor, from, to, r);
    };
    const common = {
      currency,
      postedPriceMinor: posted?.priceMinor ?? null,
      postedCurrency: EXCHANGE_PRICE_CURRENCY,
      setRatePerToken: numberVar("redemption.rate_per_token"),
      setRateCurrency: currencies[0],
      convert,
    };
    const rate = resolveRedemptionRate({ ...common, source });
    // What the village SELLS it for, whatever it pays to redeem. Read for the
    // warning alone, and it costs no extra query.
    const exchangeRate = resolveRedemptionRate({ ...common, source: "exchange" });
    const minorOf = (human: number) => Math.round(Math.max(0, human) * Math.pow(10, exponentOf(currency)));
    return {
      currencies,
      currency,
      rate,
      exchangeRate,
      source,
      feePct: numberVar("redemption.fee_pct"),
      feeFixed: numberVar("redemption.fee_fixed"),
      minMinor: minorOf(numberVar("redemption.min_amount")),
      maxPerRequestMinor: minorOf(numberVar("redemption.max_per_request")),
      memberCapMinor: minorOf(numberVar("redemption.max_per_member_per_cycle")),
      villageCapMinor: minorOf(numberVar("redemption.max_village_per_cycle")),
      processText: String(stringVar("redemption.process_text") ?? ""),
    };
  }

  /** The money half of a payload, as every surface prints it. */
  const moneyPayload = (ctx: Awaited<ReturnType<typeof moneyContext>>) => ({
    currencies: ctx.currencies,
    currency: ctx.currency,
    rateSource: ctx.source,
    rateMinor: ctx.rate?.minorPerToken ?? null,
    feePct: ctx.feePct,
    feeFixedMinor: Math.round(Math.max(0, ctx.feeFixed) * Math.pow(10, exponentOf(ctx.currency))),
    minMinor: ctx.minMinor,
    maxPerRequestMinor: ctx.maxPerRequestMinor,
    memberCapMinor: ctx.memberCapMinor,
    villageCapMinor: ctx.villageCapMinor,
    processText: ctx.processText,
  });

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
      confirmedBy: await confirmMode(),
      votePathBuilt: VOTE_PATH_BUILT,
      /*
       * WHETHER TO ASK, and never whether they may act.
       *
       * The steward queue used to find out by requesting the admin route and
       * reading the refusal, so every ordinary member's wallet fired
       * `GET /api/admin/redemptions` and took a 401 on every load. The screen
       * was right and the wire was not: ruling 28 (2026-09-21) is that a
       * permanent 401 on an ordinary page is noise nobody wants, and a member
       * who simply does not hold a key has not failed to authenticate.
       *
       * This is a HINT for the client's next request, not a permission. The
       * gate is still `guardCapability` on the admin route, so a hint that is
       * wrong in the permissive direction costs one refused request and grants
       * nothing. Wrong in the RESTRICTIVE direction is the expensive one, and
       * it is why the admin short-circuit is added back here: the holder list
       * deliberately leaves admins out (see redemptionKeyHolders), and a
       * founder who stopped seeing the queue would be a real loss.
       */
      mayConfirm: user.role === "admin" || user.role === "founder"
        || (await redemptionKeyHolders().catch(() => [] as string[])).includes(String(user.id)),
      perCycle,
      openedThisCycle,
      // ONE RESOLUTION PER TOKEN, so the form can show what each is worth
      // before a member picks one. `moneyContext` reads the posted price for
      // that token and the one daily rate table.
      tokens: await Promise.all(
        redeemableTokens(allTokens()).map(async (t) => {
          const ctx = await moneyContext(t.slug, req.query.currency);
          return {
            slug: t.slug,
            name: t.name,
            decimals: t.decimals,
            rateMinor: ctx.rate?.minorPerToken ?? null,
            rateSource: ctx.rate?.source ?? null,
            currency: ctx.currency,
          };
        }),
      ),
      money: moneyPayload(await moneyContext(redeemableTokens(allTokens())[0]?.slug ?? "", req.query.currency)),
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
    // Ruling 23: what this comes to, resolved once here and snapshotted onto
    // the row inside the transaction, so a dial moved later never changes it.
    const ctx = await moneyContext(slug, body.currency);
    const quote = redemptionQuote({
      amountUnits: units,
      decimals: decimalsFor(slug),
      rate: ctx.rate,
      feePct: ctx.feePct,
      feeFixed: ctx.feeFixed,
    });
    const out = await requestRedemption(pool, {
      userId: user.id,
      tokenSlug: slug,
      amountUnits: units,
      askedFor: String(body.askedFor ?? ""),
      exitOpen: !!exit,
      cycleStart: cycleWindow().startsAt,
      confirmedBy: await confirmMode(),
      money: {
        currency: ctx.currency,
        quote,
        processText: ctx.processText,
        minMinor: ctx.minMinor,
        maxPerRequestMinor: ctx.maxPerRequestMinor,
        memberCapMinor: ctx.memberCapMinor,
        villageCapMinor: ctx.villageCapMinor,
        feePct: ctx.feePct,
        feeFixed: ctx.feeFixed,
      },
    });
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    /*
     * A VOTE-MODE REQUEST MUST NOT EXIST WITHOUT ITS BALLOT.
     *
     * The hold is already posted by here, so if the ballot cannot be opened the
     * request has tokens held and nothing that will ever decide it. The reaper
     * would free them eventually, and "eventually" is wrong when the village
     * can simply be told now: the request is closed, the tokens go back, and
     * the member reads why.
     *
     * Dead while `VOTE_PATH_BUILT` is false, because the refusal above turns a
     * vote-mode ask away before anything is held.
     */
    if (out.row.confirmedByMode === "vote" && VOTE_PATH_BUILT && openRedemptionBallot) {
      const opened = await openRedemptionBallot(out.row.id).catch((e) => ({
        ok: false,
        error: String(e?.message ?? e),
      }));
      if (!opened.ok) {
        await settleRedemption(pool, {
          id: out.row.id,
          to: "refused",
          actorUserId: null,
          note: "The village could not open a vote on this, so the tokens came back",
        });
        return res.status(503).json({
          error: `This one goes to a village vote and the vote could not be opened: ${opened.error ?? "unknown"}. Your tokens are back in your wallet.`,
        });
      }
    }

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
    /*
     * ONE RESOLUTION PER TOKEN IN THE QUEUE, not one per row. A hundred waiting
     * requests would otherwise read the posted price and the daily table a
     * hundred times over to answer one question about the village's dials.
     */
    const rateWarnings = new Map<string, string | null>();
    const warningFor = async (slug: string, tokenName: string): Promise<string | null> => {
      if (!rateWarnings.has(slug)) {
        const ctx = await moneyContext(slug);
        rateWarnings.set(
          slug,
          setRateAboveExchange({
            setMinorPerToken: ctx.source === "set" ? ctx.rate?.minorPerToken ?? null : null,
            exchangeMinorPerToken: ctx.exchangeRate?.minorPerToken ?? null,
            tokenName,
          }),
        );
      }
      return rateWarnings.get(slug) ?? null;
    };
    for (const row of queue) {
      const person = await members.byId(row.userId).catch(() => null);
      const totalHeldUnits =
        (await balanceOf(pool, memberAccount(row.userId), row.tokenSlug)) + row.amountUnits;
      const tokenName = tokenDef(row.tokenSlug)?.name ?? row.tokenSlug;
      const warnings = redemptionWarnings({
        tokenName,
        listedForTrade: isListedForTrade(row.tokenSlug),
        amountUnits: row.amountUnits,
        totalHeldUnits,
        redemptionsThisMoon: await redemptionsOpenedSince(pool, row.userId, cycleWindow().startsAt),
      });
      // Ruling 23's warning rides the same list and blocks nothing, like every
      // other one here. It is about the DIAL as it stands now, not about this
      // row, so it reads the same on every row of a queue.
      const rateWarning = await warningFor(row.tokenSlug, tokenName);
      if (rateWarning) warnings.push({ key: "rate-above-exchange", message: rateWarning });
      rows.push({
        ...forReading(row),
        memberName: person?.name ?? row.userId,
        warnings,
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
