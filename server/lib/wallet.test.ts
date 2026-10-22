/**
 * What the wallet decides to say, driven with plain inputs and no database.
 *
 * `assembleWallet` is where every sentence and every number on the member's
 * wallet is chosen, so the rules the founder's brief names are pinned here
 * one at a time:
 *
 *   - an unpriced token says "No price set" and never carries a money figure;
 *   - recognition is never priced, never claimed, and shows giving left;
 *   - a claimable token says exactly why it cannot be claimed and when that
 *     changes, and never names a Claims Week date while the bridge is unbuilt;
 *   - the Hypha mirror is the far side of its claimable row, never a row of
 *     its own, and an unread mirror is words, never a zero;
 *   - names are whatever the registry rows say on this request.
 */
import { describe, expect, it } from "vitest";
import type { ClaimReadiness } from "./voiceClaim";
import type { TokenHolding } from "./holdings";
import type { TokenDef } from "./ledger";
import { assembleWallet, claimOpensSentence, type WalletInputs, type WalletRow } from "./wallet";

const def = (slug: string, name: string, kind: string, extra: Partial<TokenDef> = {}): TokenDef => ({
  slug,
  name,
  kind,
  governance: "platform",
  transferable: false,
  decimals: 0,
  active: true,
  ...extra,
});

const TOKENS: TokenDef[] = [
  def("gratitude", "Gratitude", "recognition"),
  def("credits", "Village Credits", "credit", { decimals: 2, transferable: true }),
  def("village-voice", "Village Voice", "voice", { decimals: 2 }),
  def("earned-equity", "Earned Equity", "equity"),
  def("equity", "Village Equity", "equity", { governance: "hypha" }),
  def("voice", "Voice", "voice", { governance: "hypha" }),
];

const holding = (slug: string, totalUnits: number, decimals = 0, lockedUnits = 0): TokenHolding => ({
  tokenSlug: slug,
  tokenName: slug,
  decimals,
  spendableUnits: totalUnits - lockedUnits,
  lockedUnits,
  totalUnits,
  spendable: 0,
  locked: 0,
  total: 0,
  locks: lockedUnits ? [{ source: "library-loan", ref: "l1", tokenSlug: slug, heldUnits: lockedUnits, held: 0, itemName: "Camera", sentence: "locked up with the Camera, return the Camera to unlock these tokens" }] : [],
});

const ready = (token: string, over: Partial<ClaimReadiness> = {}): ClaimReadiness => ({
  token,
  balance: 0,
  threshold: 1,
  claimable: false,
  windowOpen: true,
  nextOpens: null,
  spaceConfigured: true,
  bridgeReady: false,
  openClaim: null,
  says: "0 gathered. Claims open at 1.",
  ...over,
});

const inputs = (over: Partial<WalletInputs> = {}): WalletInputs => ({
  tokens: TOKENS,
  holdings: {},
  readiness: { "earned-equity": ready("earned-equity"), "village-voice": ready("village-voice", { threshold: 100 }) },
  claimedTotals: {},
  chain: [],
  prices: {},
  priceable: ["credits"],
  exchangeOn: false,
  allowance: { total: 100, spent: 30, remaining: 70, cycleKey: "lunar-000330" },
  economicsSection: false,
  walletVerified: false,
  contracts: { equity: "", voice: "" },
  bridgeReady: false,
  ...over,
});

const row = (rows: WalletRow[], slug: string): WalletRow => {
  const r = rows.find((x) => x.token === slug);
  if (!r) throw new Error(`no wallet row for ${slug}`);
  return r;
};

describe("the member wallet's decisions", () => {
  it("lists every token once, the mirrors folded into the rows that claim toward them", () => {
    const { rows } = assembleWallet(inputs());
    expect(rows.map((r) => r.token)).toEqual(["earned-equity", "village-voice", "credits", "gratitude"]);
    expect(rows.find((r) => r.token === "equity")).toBeUndefined();
    expect(rows.find((r) => r.token === "voice")).toBeUndefined();
    expect(row(rows, "earned-equity").onBase?.mirror).toBe("equity");
    expect(row(rows, "village-voice").onBase?.mirror).toBe("voice");
  });

  it("never prints a money figure for a token nobody priced", () => {
    const { rows } = assembleWallet(inputs({ holdings: { credits: holding("credits", 1250, 2) } }));
    expect(row(rows, "credits").price).toEqual({ state: "unset", says: "No price set" });
    // The exchange being on is not a price either.
    const on = assembleWallet(inputs({ exchangeOn: true, holdings: { credits: holding("credits", 1250, 2) } }));
    expect(row(on.rows, "credits").price).toEqual({ state: "unset", says: "No price set" });
    // Nor is a price row for a token the exchange can never price.
    const odd = assembleWallet(
      inputs({
        exchangeOn: true,
        prices: { "earned-equity": { id: "p", tokenSlug: "earned-equity", priceMinor: 500, note: "n", setBy: null, effectiveAt: "2026-10-01T00:00:00.000Z" } },
      }),
    );
    expect(row(odd.rows, "earned-equity").price.state).toBe("unset");
  });

  it("prices a credit only when the exchange posted one, at the token's own scale", () => {
    const price = { id: "p", tokenSlug: "credits", priceMinor: 40, note: "first price", setBy: "adm", effectiveAt: "2026-10-01T00:00:00.000Z" };
    const { rows } = assembleWallet(inputs({ exchangeOn: true, prices: { credits: price }, holdings: { credits: holding("credits", 1250, 2) } }));
    // 12.50 credits at 40 cents each is 500 cents.
    expect(row(rows, "credits").price).toEqual({
      state: "priced",
      currency: "USD",
      perTokenMinor: 40,
      heldValueMinor: 500,
      since: "2026-10-01T00:00:00.000Z",
    });
    // Off, the same price row says nothing about money.
    const off = assembleWallet(inputs({ exchangeOn: false, prices: { credits: price }, holdings: { credits: holding("credits", 1250, 2) } }));
    expect(row(off.rows, "credits").price.state).toBe("unset");
  });

  it("shows recognition as giving left and thanks received, never as a price or a claim", () => {
    const { rows } = assembleWallet(inputs({ holdings: { gratitude: holding("gratitude", 45) } }));
    const g = row(rows, "gratitude");
    expect(g.role).toBe("gratitude");
    expect(g.heldUnits).toBe(45);
    expect(g.claim).toBeNull();
    expect(g.onBase).toBeNull();
    expect(g.price).toEqual({ state: "never", says: "Gratitude is never priced. What you receive decides your share of the cycle pool." });
    expect(g.gratitude).toEqual({
      givingLeft: 70,
      givingTotal: 100,
      cycleKey: "lunar-000330",
      says: "70 of 100 left to give this cycle. What you do not give expires when the cycle closes.",
    });
    expect(g.staysHere).toBe("Gratitude is given and received here, and never claimed or sent to Base.");
  });

  it("says why a claim cannot be made, and gives no date while the bridge is unbuilt", () => {
    const r = ready("earned-equity", { balance: 4, says: "4 gathered, and ready. The connection to Hypha is still being finished.", nextOpens: "2026-12-21T06:00:00.000Z", windowOpen: false });
    const { rows } = assembleWallet(inputs({ readiness: { "earned-equity": r, "village-voice": ready("village-voice") } }));
    const eq = row(rows, "earned-equity");
    expect(eq.claim).toMatchObject({
      claimable: false,
      says: "4 gathered, and ready. The connection to Hypha is still being finished.",
      opens: "Claims open once the connection to Hypha is finished. No date is set yet.",
    });
    expect(eq.claim?.opens).not.toContain("2026-12-21");
  });

  it("names the next Claims Week once nothing but the calendar is in the way", () => {
    expect(claimOpensSentence(ready("x", { bridgeReady: true, windowOpen: false, nextOpens: "2027-03-21T06:00:00.000Z" }))).toBe(
      "Claims Week next opens on 2027-03-21.",
    );
    expect(claimOpensSentence(ready("x", { bridgeReady: true, windowOpen: true }))).toBe("Claims Week is open now.");
    expect(claimOpensSentence(ready("x", { bridgeReady: true, spaceConfigured: false }))).toBe(
      "Claims open once the village names its Hypha space.",
    );
    expect(claimOpensSentence(ready("x", { bridgeReady: true, windowOpen: false, nextOpens: null }))).toBe(
      "Claims are closed, and no Claims Week date is set.",
    );
  });

  it("reads the mirror off the cache only when the village shows it and the wallet is proven", () => {
    const cache = [{ tokenSlug: "equity", raw: "1500000000000000000", decimals: 18, fetchedAt: "2026-10-20T09:00:00.000Z" }];
    const hidden = assembleWallet(inputs({ chain: cache }));
    expect(row(hidden.rows, "earned-equity").onBase).toEqual({
      state: "hidden",
      mirror: "equity",
      mirrorName: "Village Equity",
      says: "This village does not show on-chain holdings yet.",
    });
    const unproven = assembleWallet(inputs({ chain: cache, economicsSection: true }));
    expect(row(unproven.rows, "earned-equity").onBase?.says).toBe("Verify your wallet below to see what you hold on Base.");
    const noContract = assembleWallet(inputs({ chain: cache, economicsSection: true, walletVerified: true }));
    expect(row(noContract.rows, "earned-equity").onBase).toMatchObject({ state: "unread" });
    const live = assembleWallet(
      inputs({ chain: cache, economicsSection: true, walletVerified: true, contracts: { equity: "0xabc", voice: "0xdef" } }),
    );
    expect(row(live.rows, "earned-equity").onBase).toEqual({
      state: "read",
      mirror: "equity",
      mirrorName: "Village Equity",
      formatted: "1.5",
      fetchedAt: "2026-10-20T09:00:00.000Z",
      says: "As Base last said, on 2026-10-20.",
    });
    // Voice has a contract and no cached read: words, never a zero.
    expect(row(live.rows, "village-voice").onBase).toEqual({
      state: "unread",
      mirror: "voice",
      mirrorName: "Voice",
      says: "Not read from Base yet. Nothing is shown in place of a number.",
    });
  });

  it("follows a rename on the same request, the mirror's included", () => {
    const renamed = TOKENS.map((t) =>
      t.slug === "earned-equity" ? { ...t, name: "Amora Earned" } : t.slug === "equity" ? { ...t, name: "Amora" } : t,
    );
    const { rows } = assembleWallet(inputs({ tokens: renamed }));
    expect(row(rows, "earned-equity").name).toBe("Amora Earned");
    expect(row(rows, "earned-equity").onBase?.mirrorName).toBe("Amora");
  });

  it("keeps a balance in sight even when its token left the registry or retired", () => {
    const retired = TOKENS.map((t) => (t.slug === "credits" ? { ...t, active: false } : t));
    const { rows } = assembleWallet(
      inputs({ tokens: retired, holdings: { credits: holding("credits", 300, 2), "old-seeds": holding("old-seeds", 7) } }),
    );
    expect(row(rows, "credits").heldUnits).toBe(300);
    expect(row(rows, "old-seeds")).toMatchObject({ name: "old-seeds", heldUnits: 7, price: { state: "unset" } });
    // A retired token nobody holds drops away.
    const empty = assembleWallet(inputs({ tokens: retired }));
    expect(empty.rows.find((r) => r.token === "credits")).toBeUndefined();
  });

  it("names what is locked, and counts it as the member's", () => {
    const { rows } = assembleWallet(inputs({ holdings: { credits: holding("credits", 7000, 2, 5000) } }));
    expect(row(rows, "credits").heldUnits).toBe(7000);
    expect(row(rows, "credits").lockedUnits).toBe(5000);
    expect(row(rows, "credits").locks).toEqual(["locked up with the Camera, return the Camera to unlock these tokens"]);
  });

  it("carries what has already been claimed across, by confirmed claim", () => {
    const { rows } = assembleWallet(inputs({ claimedTotals: { "earned-equity": 12 } }));
    expect(row(rows, "earned-equity").claim?.claimedToHypha).toBe(12);
    expect(row(rows, "village-voice").claim?.claimedToHypha).toBe(0);
  });
});
