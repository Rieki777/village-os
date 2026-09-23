import { describe, expect, it } from "vitest";
import { MODULE_CATALOG, MODULE_GROUPS, BUILD_A_MODULE_URL, BUILDER_GUIDE_URL } from "./moduleCatalog";
import { MODULES, MODULES_BY_ID, modulesOwning } from "./modules";
import { VARIABLES } from "./gameVariables";

/**
 * The registry and the catalog move together, and this file is what makes
 * that a build fact instead of a habit. Everything iterates over MODULES
 * itself, never over a copied list of ids, so a later lane that adds a module
 * to BOTH `MODULES` and `MODULE_CATALOG` passes untouched, and one that adds
 * to only one of the two fails with the module named.
 */
describe("moduleCatalog", () => {
  const groupIds = new Set(MODULE_GROUPS.map((g) => g.id));

  it("every registry entry has a catalog entry, a group and a setup", () => {
    for (const m of MODULES) {
      expect(MODULE_CATALOG[m.id], `module "${m.id}" has no MODULE_CATALOG entry`).toBeTruthy();
      expect(m.group, `module "${m.id}" declares no group`).toBeTruthy();
      expect(groupIds.has(m.group!), `module "${m.id}" group "${m.group}" is not a shelf`).toBe(true);
      expect(m.setup, `module "${m.id}" declares no setup`).toBeTruthy();
      expect(["none", "optional", "required"]).toContain(m.setup);
    }
  });

  it("no catalog entry points at a module that does not exist", () => {
    const known = new Set(MODULES.map((m) => m.id));
    for (const id of Object.keys(MODULE_CATALOG)) {
      expect(known.has(id), `MODULE_CATALOG["${id}"] names no registry module`).toBe(true);
    }
  });

  it("every entry carries the full card: promise, 3..5 benefits, forWhom, summaries, hue, emblem", () => {
    for (const m of MODULES) {
      const e = MODULE_CATALOG[m.id];
      expect(e.promise.trim().length, `"${m.id}" promise is empty`).toBeGreaterThan(0);
      expect(e.benefits.length, `"${m.id}" needs 3 to 5 benefits`).toBeGreaterThanOrEqual(3);
      expect(e.benefits.length, `"${m.id}" needs 3 to 5 benefits`).toBeLessThanOrEqual(5);
      for (const b of e.benefits) expect(b.trim().length).toBeGreaterThan(0);
      expect(e.forWhom.trim().length, `"${m.id}" forWhom is empty`).toBeGreaterThan(0);
      expect(e.setupSummary.trim().length, `"${m.id}" setupSummary is empty`).toBeGreaterThan(0);
      expect(e.dataSummary.trim().length, `"${m.id}" dataSummary is empty`).toBeGreaterThan(0);
      expect(Number.isInteger(e.hue) && e.hue >= 0 && e.hue < 360, `"${m.id}" hue must be 0..359`).toBe(true);
      expect(e.emblem.trim().length, `"${m.id}" emblem is empty`).toBeGreaterThan(0);
    }
  });

  it("the shelves are exactly five, ordered, unique, and none stands empty", () => {
    expect(MODULE_GROUPS.length).toBe(5);
    expect(new Set(MODULE_GROUPS.map((g) => g.id)).size).toBe(5);
    for (const g of MODULE_GROUPS) {
      expect(g.label.trim().length).toBeGreaterThan(0);
      expect(g.gloss.trim().length).toBeGreaterThan(0);
      const members = MODULES.filter((m) => m.group === g.id);
      expect(members.length, `shelf "${g.id}" holds no modules`).toBeGreaterThan(0);
    }
  });

  it("the two renamed cards read as ruled: How Power Is Held, Village Calendar", () => {
    expect(MODULES_BY_ID.map.name).toBe("How Power Is Held");
    expect(MODULE_CATALOG.map.promise).toContain("Living Map of the land");
    expect(MODULES_BY_ID.events.name).toBe("Village Calendar");
  });

  it("the calendar knobs ride the events module's variable list", () => {
    for (const key of ["calendar.year_anchor", "calendar.hemisphere", "calendar.cross_quarters"]) {
      expect(MODULES_BY_ID.events.variableKeys).toContain(key);
    }
  });

  /**
   * WHAT "NOTHING TO SET UP" COSTS WHEN IT GOES STALE.
   *
   * `setup: "none"` is a promise to a founder that the module works the
   * moment it is on, and `setupSummary` is that promise in words on the
   * catalog card. Both are written once, when a module lands with no
   * settings, and neither is recomputed when a later ruling gives it dials.
   *
   * Redemption is why these three exist. It shipped with no settings of its
   * own in #285, said "Nothing to set up to switch it on", and then took
   * fourteen dials under ruling 23 while both sentences stayed. One of those
   * dials, `redemption.process_text`, is the village's own instructions for
   * how a member actually gets paid, and it ships empty: a village that read
   * the card and switched redemption on handed every member who asked to cash
   * out nothing at all. That sentence was live on production when this was
   * written.
   *
   * These assertions are enumerations on purpose. The other modules in that
   * state may well be right, and that judgement is not a test's to make; what
   * a test can do is make the set VISIBLE, so a module that joins it has to be
   * looked at by a person instead of arriving silently.
   */
  const ownedDials = (id: string) => VARIABLES.filter((v) => modulesOwning(v.key).includes(id));

  it("a module that carries a legal card never claims there is nothing to set up", () => {
    // The funds-bearing four. Money reaches a member through settings a
    // village has to decide, so "nothing to set up" cannot be true of one of
    // them, whatever its dials happen to be called this month.
    const funded = MODULES.filter((m) => m.legalReview).map((m) => m.id);
    expect(funded.sort()).toEqual(["commerce", "exchange", "redemption", "stays"]);
    for (const m of MODULES) {
      if (!m.legalReview) continue;
      expect(
        m.setup,
        `"${m.id}" ships a legal card and still says setup "none"`,
      ).not.toBe("none");
    }
  });

  it("pins every module that says `setup: none` while owning dials", () => {
    const claiming = MODULES.filter((m) => m.setup === "none" && ownedDials(m.id).length > 0)
      .map((m) => m.id)
      .sort();
    /*
     * Measured on main 2f91c93, redemption included, and re-measured on
     * 2026-09-23 when EVENTS came off it. Every one of these owns dials whose
     * defaults are a working village: the module does what its card says on
     * the day it is switched on, and the dials are there for a village that
     * wants something other than the default.
     *
     * Events was on this list under a claim that turned out to be false of it.
     * `calendar.hemisphere` defaults to "north", which is not a working
     * village south of the equator, it is an upside-down one, and no default
     * can be right for both. That is a place-dependent default rather than a
     * tuning knob, so events is `required` now and the test below is what
     * stops another one arriving silently.
     *
     * Ownership is `modulesOwning`, never `variableKeys`: progression lists no
     * keys and owns twenty-six by namespace, so the shorter question would
     * have missed it.
     */
    expect(claiming).toEqual([
      "feed", "forum", "governance", "gratitude",
      "introductions", "messaging", "progression", "quests",
    ]);
  });

  /**
   * THE PAIRING RULE, from Rye's ruling of 2026-09-21: a module owning a
   * default that depends on WHERE the village is may not tell a fork there is
   * nothing to set up. The flag is declared on the dial
   * (`placeDependent`, shared/gameVariables.ts) and this is where it binds to
   * the module that owns it, in both directions, so neither half can move
   * alone.
   */
  it("no module owning a place-dependent dial says `setup: none`", () => {
    const placeDials = VARIABLES.filter((v) => v.placeDependent);
    // A known positive, so an empty list can never pass this test by accident:
    // the day somebody drops the flag, this line fails before the loop does.
    expect(placeDials.map((v) => v.key)).toContain("calendar.hemisphere");
    for (const v of placeDials) {
      const owners = modulesOwning(v.key);
      expect(owners.length, `"${v.key}" depends on place and no module owns it`).toBeGreaterThan(0);
      for (const id of owners) {
        expect(
          MODULES_BY_ID[id].setup,
          `"${id}" owns "${v.key}", whose default depends on where the village is, and still says setup "none"`,
        ).not.toBe("none");
      }
    }
  });

  /**
   * THE SCREEN THAT FINDS THE NEXT ONE.
   *
   * The rule above only works on dials somebody remembered to flag. This is
   * the enumeration that makes an unflagged candidate visible: every dial
   * whose key, words or default smell of a place or a clock, pinned as a list.
   * A new one joins the list and a person has to look at it and decide, which
   * is the whole point; the judgement is not a test's to make.
   *
   * The pattern deliberately does not use `\b` around its words. `\b` treats
   * an underscore as a word character, so `\busd\b` cannot match
   * `payments.purchase_limit_per_order_usd` — measured while surveying the
   * registry for this ruling, and it is how a currency dial hid from an
   * earlier sweep of exactly this kind.
   */
  it("pins every dial that reads as place-dependent, flagged or judged", () => {
    const SCREEN =
      /hemispher|solstice|equinox|timezone|time zone|utc|locale|currency|usd|crc|country|latitud|longitud|coordinat|calendar|hectare|acre|celsius|fahrenheit/i;
    const hits = VARIABLES.filter(
      (v) => SCREEN.test(`${v.key} ${v.label} ${v.description} ${v.default}`) && !v.placeDependent,
    ).map((v) => v.key).sort();
    /*
     * Judged on 2026-09-23, every one of them, and not one is a default that
     * depends on where the village is:
     *
     *   calendar.year_anchor    a convention, not a fact. December is a real
     *                           choice in the south, and the dial's own words
     *                           say southern villages often pick June.
     *   calendar.cross_quarters off, and off is right everywhere.
     *   cycle.mode              a moon or a calendar month: the same two
     *                           answers under either sky.
     *   economy.claims_week_starts the solstices and equinoxes, which fall on
     *                           the same four dates in both hemispheres.
     *   events.*                window lengths, in days.
     *   payments.*_usd          the payment spine charges in `usd`
     *                           (server/lib/payments.ts), one platform choice
     *                           rather than a local one.
     *   redemption.*            counted in "the redemption's own currency",
     *                           which the village answers once, elsewhere.
     *   stay.autopay_post_hour  labelled UTC and read as UTC, so it is the
     *                           same instant everywhere. Its LOCAL hour moves
     *                           with longitude, which argues for reading it in
     *                           village time rather than for asking a founder.
     *   map.concierge_enabled   matched on "coordination".
     *   governance.hub_url, governance.quorum_pct,
     *   library.dispute_deadline_days, governance.window_role_seat
     *                           matched on letters inside other words:
     *                           "outcome", "computed", "the calendar allows
     *                           it". The screen looks for substrings on
     *                           purpose, because a word boundary is what hid
     *                           the currency dials from an earlier sweep, and
     *                           the price of that is noise a person reads
     *                           once.
     */
    expect(hits).toEqual([
      "calendar.cross_quarters",
      "calendar.year_anchor",
      "cycle.mode",
      "economy.claims_week_starts",
      "events.past_visible_days",
      "events.rsvp_enabled",
      "events.upcoming_days",
      "governance.hub_url",
      "governance.quorum_pct",
      "governance.window_role_seat",
      "library.dispute_deadline_days",
      "map.concierge_enabled",
      "payments.donation_max_usd",
      "payments.purchase_limit_30d_usd",
      "payments.purchase_limit_annual_usd",
      "payments.purchase_limit_per_order_usd",
      "redemption.currencies",
      "redemption.fee_fixed",
      "redemption.max_per_member_per_cycle",
      "redemption.max_per_request",
      "redemption.min_amount",
      "stay.autopay_post_hour",
    ]);
  });

  it("pins the modules that say `setup: none` while shipping a dial with no value", () => {
    const blank = MODULES.filter(
      (m) => m.setup === "none" && ownedDials(m.id).some((v) => v.default.trim() === ""),
    ).map((m) => m.id);
    /*
     * The narrower question, and the one redemption failed hardest: a dial
     * that ships empty is a decision nobody has made yet.
     *
     * `governance.hub_url` is the one honest case. Empty there MEANS no hub,
     * every reader treats it as off, and the default is blank precisely so a
     * fork does not inherit somebody else's relay. Redemption's three were not
     * that: `process_text` empty shows a member no card at all.
     */
    expect(blank).toEqual(["governance"]);
  });

  it("the builder links point into the upstream repository's module docs", () => {
    expect(BUILD_A_MODULE_URL.startsWith("https://")).toBe(true);
    expect(BUILD_A_MODULE_URL.endsWith("/BUILDING_A_MODULE.md")).toBe(true);
    // Same repository, same directory: only the final file name differs.
    expect(BUILD_A_MODULE_URL.replace(/[^/]+$/, "")).toBe(BUILDER_GUIDE_URL.replace(/[^/]+$/, ""));
  });
});
