/**
 * Stays: accommodation bought with the village's own stay credits.
 *
 * Twenty routes, lifted out of server/index.ts unchanged:
 *
 *   GET    /api/stays                         what is available, and mine
 *   POST   /api/stays/request                 ask for a stay
 *   POST   /api/stays/checkout                buy credits for one
 *   GET    /api/admin/stays                   the whole book
 *   POST   /api/admin/stays/accommodations    define a room
 *   PUT    /api/admin/stays/accommodations/:id        change one
 *   PUT    /api/admin/stays/accommodations/:id/prices set its two rates
 *   POST   /api/admin/stays/:id/activate      let a guest in
 *   POST   /api/admin/stays/:id/end           check them out
 *   PUT    /api/admin/stays/:id               correct a stay
 *   POST   /api/admin/stays/post-nights       run the nightly posting now
 *   POST   /api/admin/stays/comp              a comped stay
 *   POST   /api/admin/stays/adjust            grant or burn credits by hand
 *   POST   /api/admin/stays/purchases/manual  record a payment taken offline
 *   POST   /api/admin/stays/purchases/:id/refund      undo one
 *   GET    /api/admin/payments                the payments desk
 *   POST   /api/admin/payments/suspensions/:id/lift   reinstate a member
 *
 * WHY THIS IS ONE MODULE. `stayAudienceFor` is the one rule that decides
 * whether a viewer books at the guest rate or the member rate, and five of
 * these routes call it: the read, the request, the checkout, the activation
 * and the manual purchase. Pricing and snapshots agreeing on one answer is
 * the whole point of it, so it moved with them rather than being reimplemented
 * on either side of a file boundary.
 *
 * THE SETTLEMENT WEBHOOK IS NOT HERE, DELIBERATELY. It stays registered in
 * server/index.ts through `registerPaymentHandlers` and is NOT behind
 * `requireModule("stays")`, because an order already in flight has to settle
 * even when the module was disabled a minute ago. Both `app.use` lines below
 * gate only the surfaces a person opens.
 *
 * THE PAYMENTS DESK IS PLATFORM, NOT STAYS. `/api/admin/payments` and the
 * suspension lift sit at the end of this file because that is where they sat
 * in server/index.ts, and they are ungated for the same reason: a village
 * that switched stays off still has to be able to see what was charged and
 * lift a hold on a member who is locked out of paying.
 *
 * REGISTERED WHERE IT WAS, because Express matches in registration order:
 * after the calendar's admin routes, before /api/examples.
 */
import type { Express } from "express";
import { hasCapability } from "../../shared/capabilities";
import type { AppDeps } from "../lib/appDeps";
import { EXAMPLE_REFUSAL_BODY, isExampleRow, onRealItemPublished } from "../lib/examples";
import {
  MINT_FAUCET,
  allTokens,
  balanceOf,
  balancesFor,
  memberAccount,
  postTransfer,
  tokenDef,
} from "../lib/ledger";
import {
  assertCanPurchase,
  ceilMinor,
  createCheckout,
  floorTokens,
  recordFiatCharge,
  stripeConfigured,
} from "../lib/payments";
import { priceRefusal } from "../lib/spending";
import { requireModule } from "../lib/modules";
import {
  STAY_CREDIT,
  allStays,
  listAccommodations,
  mintStayCredits,
  nightsRemaining,
  priceFor,
  runNightlyPosting,
  stayById,
  staysForUser,
} from "../lib/stays";
import { boolVar, numberVar, stringVar } from "../lib/variables";

type Deps = Pick<
  AppDeps,
  | "adminActor"
  | "authedUser"
  | "capabilityCtx"
  | "isAdmin"
  | "members"
  | "notify"
  | "notifyAdmins"
  | "notifyDeps"
  | "overLimit"
  | "questsRepo"
  | "stayPostingHooks"
  | "getPool"
>;

export function register(app: Express, deps: Deps): void {
  const {
    adminActor,
    authedUser,
    capabilityCtx,
    isAdmin,
    members,
    notify,
    notifyAdmins,
    notifyDeps,
    overLimit,
    questsRepo,
    stayPostingHooks,
    getPool,
  } = deps;

  // â”€â”€ S30-S31: Stays — accommodation on stay credits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€─
  // Every route mounts behind requireModule('stays'); the settlement webhook
  // deliberately does NOT (in-flight orders settle even if the module was
  // just disabled). The suspension/limits surfaces are PLATFORM routes below.

  app.use("/api/stays", requireModule("stays"));
  app.use("/api/admin/stays", requireModule("stays"));

  /** The audience a viewer books at. One rule, used by pricing AND snapshots. */
  async function stayAudienceFor(user: any | null): Promise<"guest" | "member"> {
    if (!user) return "guest";
    const ctx = await capabilityCtx(user);
    return hasCapability("stay.member_rate", ctx) ? "member" : "guest";
  }

  /** Catalog + the viewer's own stay state, one call. */
  app.get("/api/stays", async (req, res) => {
    const viewer = await authedUser(req);
    const audience = await stayAudienceFor(viewer);
    const accommodations = await listAccommodations(getPool());
    let mine: any = null;
    if (viewer) {
      const balance = await balanceOf(getPool(), memberAccount(viewer.id), STAY_CREDIT);
      // 0092: a room can post its nightly price in the village's own credits as
      // well as in stay credits, so "nights remaining" has to be read against
      // the token the stay was ACTIVATED in. Reading it against stay credits
      // for every stay is how a guest paying credits would have been told they
      // had zero nights left while their balance sat untouched.
      const held = await balancesFor(getPool(), memberAccount(viewer.id));
      const stays = await staysForUser(getPool(), viewer.id);
      mine = {
        balance,
        // MINOR units plus the scale that turns them into the number a member
        // reads. Ported from the decimals fix, which was written against this
        // code while it still lived in server/index.ts.
        balanceDecimals: tokenDef(STAY_CREDIT)?.decimals ?? 0,
        balances: Object.fromEntries(
          Object.entries(held)
            .filter(([slug]) => tokenDef(slug)?.active !== false)
            .map(([slug, n]) => [slug, { name: tokenDef(slug)?.name ?? slug, balance: n, decimals: tokenDef(slug)?.decimals ?? 0 }]),
        ),
        stays: stays.map((s) => ({
          ...s,
          nightsRemaining:
            s.status === "active"
              ? nightsRemaining(held[s.rateSnapshotToken] ?? 0, s.rateSnapshotCredits)
              : null,
        })),
      };
    }
    // Work-exchange: quests that pay stay credits at consent, surfaced here so
    // "earn your nights" is a visible path, not folklore.
    const tag = stringVar("stay.work_exchange_tag");
    // status compares lowercased: the board has both "open" (seed) and "Open"
    // (admin-created) in the wild, and the earn path must see them all.
    const earnQuests = (await questsRepo.all()).filter(
      // Example quests are never offered as a way to earn: this list is
      // shown to a guest running low on stay credits as real, claimable work.
      (q) => !q.isExample && String(q.status).toLowerCase() === "open" && ((q.stayCreditReward ?? 0) > 0 || (tag && q.tags.includes(tag))),
    ).map((q) => ({ id: q.id, title: q.title, stayCreditReward: q.stayCreditReward ?? 0, gratitude: q.gratitude }));
    /*
     * THE NAME AND THE SCALE OF EVERY TOKEN ANY ROOM POSTS A RATE IN.
     *
     * `accommodation_prices.amount_minor` is the ledger's MINOR units, so a
     * room at three Village Credits stores 300 once credits is at its ruled
     * two decimals (docs/ECONOMICS.md section 11). The page
     * printed that raw fifty-eight lines under a balance line that divides,
     * which is one page answering the same question two ways.
     *
     * Derived from the ROOMS' own price keys rather than from `mine.balances`,
     * which is where the token's name used to come from and could never have
     * carried the rest: `mine` is null for a signed-out visitor and holds only
     * tokens the member ALREADY has, so the person most likely to be reading a
     * nightly rate is exactly the one it is silent about. `stay-credit` is in
     * here too, because the credit rate, both tier lines and the work-exchange
     * rewards are the same question again.
     */
    const pricedSlugs = [STAY_CREDIT, ...accommodations.flatMap((a) => Object.keys(a.prices ?? {}))]
      .filter((slug, i, all) => slug !== "usd" && all.indexOf(slug) === i);
    const priceTokens = Object.fromEntries(
      pricedSlugs.map((slug) => [slug, { name: tokenDef(slug)?.name ?? slug, decimals: tokenDef(slug)?.decimals ?? 0 }]),
    );
    res.json({
      accommodations,
      audience,
      priceTokens,
      mine,
      earnQuests,
      guestBookingEnabled: boolVar("stay.guest_booking_enabled"),
      stripeConfigured: stripeConfigured(),
      maxPurchaseNights: numberVar("stay.max_purchase_nights"),
    });
  });

  /** Request a stay. Requested, never active: activation is a human act. */
  app.post("/api/stays/request", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to request a stay" });
    const audience = await stayAudienceFor(user);
    if (audience === "guest" && !boolVar("stay.guest_booking_enabled")) {
      return res.status(403).json({ error: "Stay requests are open to members right now. Write to the village instead" });
    }
    if (await overLimit(`stay-request:${user.id}`, Math.max(1, numberVar("stay.request_daily_cap")), 24 * 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Five stay requests in a day is plenty. The stewards will reply" });
    }
    const { accommodationId, arriveOn, notes } = req.body ?? {};
    const acc = (await listAccommodations(getPool())).find((a) => a.id === String(accommodationId ?? ""));
    if (!acc) return res.status(400).json({ error: "Pick an accommodation" });
    // A requested stay is open state: it would block disabling the module, for
    // a room nobody can actually sleep in.
    if (await isExampleRow(getPool(), "accommodations", acc.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    const id = `stay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const arrive = arriveOn && /^\d{4}-\d{2}-\d{2}$/.test(String(arriveOn)) ? String(arriveOn) : null;
    await getPool().query(
      "INSERT INTO stays (id, user_id, accommodation_id, status, arrive_on, autopay, notes) VALUES (?,?,?,?,?,?,?)",
      [id, user.id, acc.id, "requested", arrive, boolVar("stay.autopay_default") ? 1 : 0, String(notes ?? "").slice(0, 2000) || null],
    );
    await notifyAdmins("stays", `${user.name ?? "A member"} requested a stay in ${acc.name}`, `stay:${id}:requested`);
    res.json({ id, status: "requested" });
  });

  /**
   * Buy stay credits for a room: Stripe Checkout. The server derives BOTH
   * numbers from posted prices — USD ceil'd, credits floor'd (rounding favors
   * the treasury; the property test holds the line).
   */
  app.post("/api/stays/checkout", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to buy stay credits" });
    const { accommodationId, nights } = req.body ?? {};
    const n = Math.floor(Number(nights) || 0);
    if (n < 1) return res.status(400).json({ error: "How many nights?" });
    if (n > numberVar("stay.max_purchase_nights")) {
      return res.status(400).json({ error: `At most ${numberVar("stay.max_purchase_nights")} nights per purchase (stay.max_purchase_nights)` });
    }
    const audience = await stayAudienceFor(user);
    const creditRate = await priceFor(getPool(), String(accommodationId ?? ""), STAY_CREDIT, audience);
    const usdRate = await priceFor(getPool(), String(accommodationId ?? ""), "usd", audience);
    if (!creditRate || creditRate <= 0) return res.status(409).json({ error: "That room has no posted credit rate yet" });
    if (!usdRate || usdRate <= 0) return res.status(409).json({ error: "That room has no posted USD price. Use the manual payment path" });
    const amountMinor = ceilMinor(n * usdRate);
    const creditsGranted = floorTokens(n * creditRate);
    // Limits and suspensions rule BEFORE the provider question: "you are over
    // your 30-day limit" is the truthful refusal even where Stripe isn't set up.
    const check = await assertCanPurchase(getPool(), user.id, amountMinor);
    if (!check.ok) return res.status(403).json({ error: check.error });
    // The example rooms post real credit AND usd prices, so this route would
    // happily open a Stripe session and leave a pending stay_purchases row —
    // which is both a Stripe object and open state blocking module-off.
    if (await isExampleRow(getPool(), "accommodations", String(accommodationId ?? ""))) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    if (!stripeConfigured()) return res.status(503).json({ error: "Card payments are not set up yet. Ask about the manual payment path" });
    const id = `sp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await getPool().query(
      "INSERT INTO stay_purchases (id, user_id, accommodation_id, nights, amount_minor, credits_granted, provider, status) VALUES (?,?,?,?,?,?, 'stripe','pending')",
      [id, user.id, String(accommodationId), n, amountMinor, creditsGranted],
    );
    const origin = notifyDeps.origin();
    const session = await createCheckout({
      module: "stays",
      orderId: id,
      name: `Stay credits: ${n} night(s)`,
      amountMinor,
      successUrl: `${origin}/stay?purchase=success`,
      cancelUrl: `${origin}/stay?purchase=cancelled`,
      customerEmail: user.email ?? undefined,
    });
    await getPool().query("UPDATE stay_purchases SET provider_ref = ? WHERE id = ?", [session.sessionId, id]);
    res.json({ url: session.url });
  });

  /** Admin overview: rooms (incl. inactive), stays with live balances, purchases. */
  app.get("/api/admin/stays", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const accommodations = await listAccommodations(getPool(), { includeInactive: true });
    const stays = await allStays(getPool());
    const withNames = [];
    for (const s of stays) {
      const u = await members.byId(s.userId);
      // 0092: read the balance of the token THIS stay pays in. The desk's
      // "nights left" column is what a steward acts on, so it has to be about
      // the money the guest is actually spending.
      const balance = await balanceOf(getPool(), memberAccount(s.userId), s.rateSnapshotToken || STAY_CREDIT);
      withNames.push({
        ...s,
        userName: u?.name ?? "(anonymized)",
        balance,
        rateTokenName: tokenDef(s.rateSnapshotToken)?.name ?? s.rateSnapshotToken,
        nightsRemaining: s.status === "active" ? nightsRemaining(balance, s.rateSnapshotCredits) : null,
      });
    }
    const [purchases] = await getPool().query<any[]>(
      "SELECT * FROM stay_purchases ORDER BY created_at DESC LIMIT 200",
    );
    // `capacity` was written, editable and read into the row type — and then
    // used for no decision and no display anywhere in the codebase. A flag,
    // not a block: refusing a booking contradicts the module's design (stays
    // are activated by a human, who is the one who knows whether the room
    // really is full). Additive fields only, so no client is broken by them.
    const activeByAcc = new Map<string, number>();
    for (const s of stays) {
      if (s.status === "ended" || s.status === "cancelled") continue;
      activeByAcc.set(s.accommodationId, (activeByAcc.get(s.accommodationId) ?? 0) + 1);
    }
    const accommodationsWithLoad = accommodations.map((a) => {
      const activeStays = activeByAcc.get(a.id) ?? 0;
      return { ...a, activeStays, overCapacity: activeStays > a.capacity };
    });
    /*
     * 0092: the tokens a room may post a nightly rate in, from the same
     * firewall the prices route enforces. The desk needs the village's own
     * word for each one, because a select showing raw slugs is how a steward
     * prices a room in something they cannot name.
     */
    res.json({
      accommodations: accommodationsWithLoad,
      stays: withNames,
      purchases,
      payableTokens: allTokens()
        .filter((t) => t.slug !== STAY_CREDIT && priceRefusal(t.slug) === null)
        .map((t) => ({ slug: t.slug, name: t.name })),
    });
  });

  app.post("/api/admin/stays/accommodations", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const { name, description, capacity, photoUrl } = req.body ?? {};
    if (!String(name ?? "").trim()) return res.status(400).json({ error: "A name is required" });
    const id = `acc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await getPool().query(
      "INSERT INTO accommodations (id, name, description, capacity, photo_url, sort_order) VALUES (?,?,?,?,?,?)",
      [id, String(name).trim().slice(0, 120), description ?? null, Math.max(1, Number(capacity) || 1), photoUrl ?? null, 0],
    );
    onRealItemPublished(getPool(), "stays", adminActor(req)?.id ?? null);
    res.json({ id });
  });

  app.put("/api/admin/stays/accommodations/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    // Renaming or deactivating an example room launders it into village
    // content that retirement can still delete. Every sibling admin edit route
    // refuses examples; stays was the one that did not.
    if (await isExampleRow(getPool(), "accommodations", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    const { name, description, capacity, photoUrl, active, sortOrder } = req.body ?? {};
    const [r] = await getPool().query<any>(
      "UPDATE accommodations SET name = COALESCE(?, name), description = COALESCE(?, description), " +
        "capacity = COALESCE(?, capacity), photo_url = COALESCE(?, photo_url), active = COALESCE(?, active), " +
        "sort_order = COALESCE(?, sort_order) WHERE id = ?",
      [name ?? null, description ?? null, capacity ?? null, photoUrl ?? null,
        active == null ? null : active ? 1 : 0, sortOrder ?? null, req.params.id],
    );
    if (!(r as any).affectedRows) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  /** Replace a room's posted prices. Two numbers per audience, never an FX rate. */
  app.put("/api/admin/stays/accommodations/:id/prices", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    // Worse than the edit route: this deactivates every posted price for the
    // room and re-inserts over the unique (accommodation_id, token_type,
    // audience) key, so it rewrites the seeded example rates in place and
    // leaves any combo the admin left blank switched off for good.
    if (await isExampleRow(getPool(), "accommodations", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    const prices: any[] = Array.isArray(req.body?.prices) ? req.body.prices : [];
    for (const p of prices) {
      // 0092: usd, stay credits, or any credit token this village issues. The
      // last of those is what gives the cycle pool's token somewhere to go.
      // `priceRefusal` is the same firewall the seat fee uses, so recognition
      // can never become a nightly rate by either door.
      const slug = String(p?.tokenType ?? "");
      if (slug !== "usd") {
        const refusal = priceRefusal(slug);
        if (refusal) return res.status(400).json({ error: refusal });
      }
      if (!["guest", "member"].includes(String(p?.audience))) return res.status(400).json({ error: "Audience is guest or member" });
      if (!(Number(p?.amountMinor) > 0)) return res.status(400).json({ error: "Amounts must be positive" });
    }
    await getPool().query("UPDATE accommodation_prices SET active = 0 WHERE accommodation_id = ?", [req.params.id]);
    for (const p of prices) {
      await getPool().query(
        "INSERT INTO accommodation_prices (id, accommodation_id, token_type, audience, amount_minor, active) VALUES (?,?,?,?,?,1) " +
          "ON DUPLICATE KEY UPDATE amount_minor = VALUES(amount_minor), active = 1",
        [`ap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, req.params.id, String(p.tokenType), String(p.audience), Math.floor(Number(p.amountMinor))],
      );
    }
    res.json({ success: true });
  });

  /**
   * Activate: THE snapshot moment. Rate and audience freeze here; later price
   * edits touch this stay only through an explicit re-rate (which is just
   * activate again, deliberately).
   */
  app.post("/api/admin/stays/:id/activate", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const stay = await stayById(getPool(), req.params.id);
    if (!stay) return res.status(404).json({ error: "Not found" });
    if (stay.status === "ended" || stay.status === "cancelled") {
      return res.status(409).json({ error: `This stay is ${stay.status}` });
    }
    const guest = await members.byId(stay.userId);
    const audience = ["guest", "member"].includes(req.body?.audience)
      ? (req.body.audience as "guest" | "member")
      : await stayAudienceFor(guest);
    /*
     * 0092: WHICH TOKEN, decided here, snapshot here, for the same reason the
     * rate is. Either accepted, never a rate between them: the room posts a
     * price per token and the stay is activated in exactly one of them.
     *
     * Defaults to stay credits when the caller says nothing, so every existing
     * caller and every existing test activates exactly what it activated
     * before. A token the room posts no price for is refused by name, because
     * "no rate" and "wrong token" are different mistakes and an admin can only
     * fix the one they are told about.
     */
    const wantedToken = String(req.body?.tokenType ?? "").trim() || STAY_CREDIT;
    if (wantedToken !== STAY_CREDIT) {
      const refusal = priceRefusal(wantedToken);
      if (refusal) return res.status(400).json({ error: refusal });
    }
    const rate = await priceFor(getPool(), stay.accommodationId, wantedToken, audience);
    if (!rate || rate <= 0) {
      const name = tokenDef(wantedToken)?.name ?? wantedToken;
      return res.status(409).json({ error: `Post a ${name} rate for this room before activating` });
    }
    await getPool().query(
      "UPDATE stays SET status = 'active', rate_snapshot_credits = ?, rate_snapshot_token = ?, audience_snapshot = ?, " +
        "arrive_on = COALESCE(arrive_on, CURRENT_DATE) WHERE id = ?",
      [rate, wantedToken, audience, stay.id],
    );
    await notify({
      userId: stay.userId,
      type: "stays",
      title: `Your stay is active, ${rate} ${tokenDef(wantedToken)?.name ?? wantedToken} per night`,
      link: "/stay",
      dedupeKey: `stay:${stay.id}:activated`,
    });
    res.json({ success: true, rateSnapshotCredits: rate, rateSnapshotToken: wantedToken, audienceSnapshot: audience });
  });

  /** End or cancel. NEVER automatic — ending a stay is a human act. */
  app.post("/api/admin/stays/:id/end", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const stay = await stayById(getPool(), req.params.id);
    if (!stay) return res.status(404).json({ error: "Not found" });
    const to = req.body?.cancel ? "cancelled" : "ended";
    await getPool().query("UPDATE stays SET status = ? WHERE id = ?", [to, stay.id]);
    /*
     * SWEEP (the incomplete loop). `/activate` twenty lines up tells the guest
     * their stay is on. This end of the same pair told them nothing, so a stay
     * could be cancelled under somebody who is packing for it.
     *
     * Keyed on the stay AND the landing status, the same grammar `/activate`
     * uses, so a re-ended stay rings once and an end after a cancel is its
     * own word.
     */
    await notify({
      userId: stay.userId,
      type: "stays",
      title: to === "cancelled" ? "Your stay has been cancelled" : "Your stay has been closed out",
      body: to === "cancelled"
        ? "Nothing further will be charged against it. Talk to the village if this is wrong."
        : "Nights stop posting now. Anything still owed is settled with the village.",
      link: "/stay",
      dedupeKey: `stay:${stay.id}:${to}`,
    });
    res.json({ success: true, status: to });
  });

  app.put("/api/admin/stays/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const { autopay, notes, arriveOn } = req.body ?? {};
    const arrive = arriveOn && /^\d{4}-\d{2}-\d{2}$/.test(String(arriveOn)) ? String(arriveOn) : null;
    const [r] = await getPool().query<any>(
      "UPDATE stays SET autopay = COALESCE(?, autopay), notes = COALESCE(?, notes), arrive_on = COALESCE(?, arrive_on) WHERE id = ?",
      [autopay == null ? null : autopay ? 1 : 0, notes ?? null, arrive, req.params.id],
    );
    if (!(r as any).affectedRows) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  /** The catch-up button: same code path as the scheduler, hour check skipped. */
  app.post("/api/admin/stays/post-nights", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const result = await runNightlyPosting(getPool(), { forced: true, ...stayPostingHooks() });
    res.json(result);
  });

  /** Comp nights: a gift, on the ledger, keyed. */
  app.post("/api/admin/stays/comp", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const { userId, credits, note } = req.body ?? {};
    const amount = Math.floor(Number(credits) || 0);
    if (amount < 1) return res.status(400).json({ error: "How many credits?" });
    if (!(await members.byId(String(userId ?? "")))) return res.status(404).json({ error: "No such member" });
    const id = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const r = await mintStayCredits(getPool(), {
      userId: String(userId), amount, source: "stay_comp", sourceRef: id,
      description: String(note ?? "Comped stay credits").slice(0, 255), idempotencyKey: id,
    });
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ success: true, balance: r.toBalance });
  });

  /** Manual override: either direction, admin-audited, refuses overdraft. */
  app.post("/api/admin/stays/adjust", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const { userId, credits, note } = req.body ?? {};
    const amount = Math.floor(Number(credits) || 0);
    if (!amount) return res.status(400).json({ error: "Credits must be a non-zero integer (negative removes)" });
    if (!(await members.byId(String(userId ?? "")))) return res.status(404).json({ error: "No such member" });
    const id = `adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const r = await postTransfer(getPool(), {
      from: amount > 0 ? MINT_FAUCET : memberAccount(String(userId)),
      to: amount > 0 ? memberAccount(String(userId)) : MINT_FAUCET,
      tokenType: STAY_CREDIT,
      amount: Math.abs(amount),
      source: "stay_manual_override",
      sourceRef: id,
      description: String(note ?? "Manual adjustment").slice(0, 255),
      idempotencyKey: id,
    });
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ success: true });
  });

  /**
   * Manual payment (cash, Zeffy, bank transfer): the server derives the
   * credits from nights × posted rate — the admin records money received,
   * never types a credit amount (that's what adjust is for, audited apart).
   */
  app.post("/api/admin/stays/purchases/manual", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const { userId, accommodationId, nights, amountMinor } = req.body ?? {};
    const guest = await members.byId(String(userId ?? ""));
    if (!guest) return res.status(404).json({ error: "No such member" });
    const n = Math.floor(Number(nights) || 0);
    if (n < 1) return res.status(400).json({ error: "How many nights?" });
    const audience = await stayAudienceFor(guest);
    // The admin room picker lists example rooms beside real ones, so recording
    // a walk-in payment against a demo room is one dropdown slip away — and it
    // mints real stay credits and records a real fiat charge.
    if (await isExampleRow(getPool(), "accommodations", String(accommodationId ?? ""))) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    const creditRate = await priceFor(getPool(), String(accommodationId ?? ""), STAY_CREDIT, audience);
    if (!creditRate || creditRate <= 0) return res.status(409).json({ error: "That room has no posted credit rate yet" });
    const creditsGranted = floorTokens(n * creditRate);
    const paid = Math.max(0, Math.floor(Number(amountMinor) || 0));
    const id = `sp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await getPool().query(
      "INSERT INTO stay_purchases (id, user_id, accommodation_id, nights, amount_minor, credits_granted, provider, status, recorded_by, paid_at) " +
        "VALUES (?,?,?,?,?,?, 'manual','paid', ?, NOW())",
      [id, guest.id, String(accommodationId), n, paid, creditsGranted, adminActor(req)?.id ?? null],
    );
    if (paid > 0) {
      await recordFiatCharge(getPool(), { userId: guest.id, module: "stays", orderId: id, amountMinor: paid });
    }
    const r = await mintStayCredits(getPool(), {
      userId: guest.id, amount: creditsGranted, source: "stay_purchase", sourceRef: id,
      description: `Manual purchase: ${n} night(s)`, idempotencyKey: `ord:${id}:leg1`,
    });
    if (!r.ok) return res.status(500).json({ error: r.error });
    await notify({
      userId: guest.id, type: "stays", title: `${creditsGranted} stay credit(s) added to your balance`,
      link: "/stay", dedupeKey: `ord:${id}:notify`,
    });
    res.json({ success: true, id, creditsGranted, balance: r.toBalance });
  });

  /**
   * Refund, simplified (S32 refund-hold): debit the credits FIRST — if the
   * guest already slept on them there is nothing to refund — then the admin
   * refunds the money in the Stripe dashboard, then this purchase is done.
   */
  app.post("/api/admin/stays/purchases/:id/refund", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const [rows] = await getPool().query<any[]>("SELECT * FROM stay_purchases WHERE id = ?", [req.params.id]);
    const p = rows[0];
    if (!p) return res.status(404).json({ error: "Not found" });
    if (p.status !== "paid") return res.status(409).json({ error: `Only paid purchases refund (this one is ${p.status})` });
    const debit = await postTransfer(getPool(), {
      from: memberAccount(String(p.user_id)),
      to: MINT_FAUCET,
      tokenType: STAY_CREDIT,
      amount: Number(p.credits_granted),
      source: "payment_reversal",
      sourceRef: String(p.id),
      description: "Refund: credits returned",
      // THE SAME KEY the webhook's reversal handler uses. The admin holds
      // the credits here, then refunds in Stripe; Stripe then sends
      // charge.refunded, whose handler would otherwise claw the SAME
      // credits back a second time under a different key and leave the
      // member negative and auto-suspended for the village's own refund.
      // NO allowNegative here on purpose: a village-initiated refund still
      // refuses when the guest already spent the credits (settle that
      // difference with a human). A CHARGEBACK is different — the bank
      // already took the money — so the webhook leg keeps allowNegative and,
      // if this path refused, posts under this same key and prevails.
      idempotencyKey: `ord:${p.id}:reversal-leg1`,
    });
    if (!debit.ok) {
      return res.status(409).json({ error: `The guest no longer holds these credits (${debit.error}). Settle the difference manually first` });
    }
    await getPool().query("UPDATE stay_purchases SET status = 'refunded' WHERE id = ?", [p.id]);
    await getPool().query("UPDATE fiat_charges SET status = 'reversed' WHERE module = 'stays' AND order_id = ?", [p.id]);
    res.json({
      success: true,
      nextStep: p.provider === "stripe" ? "Credits are held. Now refund the charge in the Stripe dashboard." : "Credits are held. Return the money however it arrived.",
    });
  });

  // â”€â”€ S32 platform payment surfaces (NOT module-gated: the trio owns them) â”€â”€

  /** Suspensions + recent payment activity, across all fiat modules. */
  app.get("/api/admin/payments", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const [suspensions] = await getPool().query<any[]>(
      "SELECT s.*, u.name AS user_name FROM payment_suspensions s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 100",
    );
    const [log] = await getPool().query<any[]>("SELECT * FROM payments_log ORDER BY at DESC LIMIT 100");
    const [charges] = await getPool().query<any[]>(
      "SELECT c.*, u.name AS user_name FROM fiat_charges c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.paid_at DESC LIMIT 100",
    );
    res.json({ suspensions, log, charges, stripeConfigured: stripeConfigured() });
  });

  app.post("/api/admin/payments/suspensions/:id/lift", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const [[suspension]] = await getPool().query<any[]>(
      "SELECT id, user_id FROM payment_suspensions WHERE id = ? AND lifted_at IS NULL LIMIT 1",
      [req.params.id],
    );
    const [r] = await getPool().query<any>(
      "UPDATE payment_suspensions SET lifted_at = NOW(), lifted_by = ? WHERE id = ? AND lifted_at IS NULL",
      [adminActor(req)?.id ?? null, req.params.id],
    );
    if (!(r as any).affectedRows) return res.status(404).json({ error: "No open suspension with that id" });
    /*
     * SWEEP (the incomplete loop). A suspension locks a member out of paying
     * and booking. Lifting it gave them everything back and told them nothing,
     * so the only way to discover you were reinstated was to try the thing
     * that had been refusing you.
     *
     * `payments_alert` on the member's side of the same event class the ops
     * alerts use: immediate, because somebody who has been locked out should
     * not learn tomorrow. The WHERE clause only matches an OPEN suspension,
     * and the key carries the row, so a second press rings nothing.
     */
    if (suspension?.user_id) {
      await notify({
        userId: String(suspension.user_id),
        type: "payments_alert",
        title: "Your payments are open again",
        body: "The hold on your account has been lifted. Booking and paying work as before.",
        link: "/wallet",
        dedupeKey: `suspension:${String(suspension.id)}:lifted`,
      });
    }
    res.json({ success: true });
  });
}
