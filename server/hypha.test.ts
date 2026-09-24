/**
 * The Hypha Bridge module, DRIVEN: a real JSON-RPC node, real viem, real ABI
 * encoding, the real SSRF guard, and the real store.
 *
 * There is no Base mainnet key in this environment, so the chain here is a
 * fixture node on 127.0.0.1 answering `eth_call` with properly encoded ERC-20
 * responses. What that does and does not prove is worth being exact about,
 * because a fabricated "verified on Base" is worse than an honest gap:
 *
 *   PROVEN AGAINST A REAL NODE. The viem client is built the way the platform
 *   builds it, the SSRF guard's loopback exemption is exercised (the same
 *   exemption anyone running a local anvil relies on), the selectors and the
 *   ABI decoding are viem's own, decimals() is read per contract, an 18-decimal
 *   uint256 survives as a full-precision string, and the store round-trips it.
 *
 *   NOT PROVEN. That Base mainnet answers these calls the same way. That
 *   Alchemy's Token API or Etherscan V2 return the shapes discovery parses;
 *   those two are exercised only through their pure helpers, and their network
 *   paths are UNDRIVEN here.
 *
 * The last case takes the node away mid-suite, which is the only way to reach
 * the branch that matters most: a failed read must return the last true figure
 * marked stale, and never a zero.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import mysql from "mysql2/promise";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import {
  FRESH_WINDOW_MS,
  formatUnits,
  readInstant,
  readOnchainBalance,
  readTokenIdentity,
  readVillageMetric,
  withinFreshWindow,
} from "./lib/base-reads";
import { villageFigure } from "./lib/hypha/village";
import { switchoverPreflight } from "./lib/hypha/switchover";
import { loadVariables, setVariable } from "./lib/variables";
import * as repo from "./repos/hypha";

const configured = testDbConfigured();

// Two contracts, so the per-contract decimals() read is a real distinction and
// not one value serving both. The addresses are arbitrary and checksummed by
// viem on the way in.
const EQUITY = "0x1111111111111111111111111111111111111111";
const VOICE = "0x2222222222222222222222222222222222222222";
const TREASURY_ADDR = "0x3333333333333333333333333333333333333333";
const FOUNDER = "0x4444444444444444444444444444444444444444";

/*
 * Fixture slugs, deliberately not this deployment's token names. The store
 * takes any slug, the module derives the real ones from the token registry
 * (governance === "hypha"), and a village's own names have no business in
 * platform code or in a platform test.
 */
const EQUITY_SLUG = "fixture-equity";
const VOICE_SLUG = "fixture-voice";

/** ERC-20 selectors, as they appear on the wire. */
const SELECTOR = {
  name: "06fdde03",
  symbol: "95d89b41",
  decimals: "313ce567",
  totalSupply: "18160ddd",
  balanceOf: "70a08231",
};

interface FixtureToken {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  balances: Record<string, bigint>;
}

const encodeString = (s: string) => encodeAbiParameters(parseAbiParameters("string"), [s]);
const encodeUint = (n: bigint) => encodeAbiParameters(parseAbiParameters("uint256"), [n]);
const encodeUint8 = (n: number) => encodeAbiParameters(parseAbiParameters("uint8"), [n]);

/**
 * A JSON-RPC node that answers the five ERC-20 reads this module makes.
 *
 * Deliberately a real HTTP server rather than a viem transport stub. The point
 * of driving it is that everything between `readTokenIdentity` and the socket
 * is the shipped code: the guard, the pinned dial, the transport, the encoder.
 * A transport stub would test the last three lines of each function and call it
 * a chain read.
 */
function startFixtureChain(tokens: Record<string, FixtureToken>) {
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let payload: any = {};
      try { payload = JSON.parse(body); } catch { /* answered below as an error */ }
      const respond = (result: unknown) =>
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ jsonrpc: "2.0", id: payload?.id ?? 1, result }),
        );
      if (payload?.method === "eth_chainId") return respond("0x2105"); // 8453
      if (payload?.method === "eth_blockNumber") return respond("0x1");
      if (payload?.method !== "eth_call") {
        return res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ jsonrpc: "2.0", id: payload?.id ?? 1, error: { message: `no fixture for ${payload?.method}` } }),
        );
      }
      const to = String(payload.params?.[0]?.to ?? "").toLowerCase();
      const data = String(payload.params?.[0]?.data ?? "").replace(/^0x/, "");
      const selector = data.slice(0, 8);
      const token = tokens[to];
      calls.push(`${to}:${selector}`);
      if (!token) {
        return res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { message: "execution reverted" } }),
        );
      }
      if (selector === SELECTOR.name) return respond(encodeString(token.name));
      if (selector === SELECTOR.symbol) return respond(encodeString(token.symbol));
      if (selector === SELECTOR.decimals) return respond(encodeUint8(token.decimals));
      if (selector === SELECTOR.totalSupply) return respond(encodeUint(token.totalSupply));
      if (selector === SELECTOR.balanceOf) {
        // The address argument is the last 40 hex characters of the one word.
        const holder = `0x${data.slice(8).slice(24)}`.toLowerCase();
        return respond(encodeUint(token.balances[holder] ?? BigInt(0)));
      }
      return res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { message: `no fixture for selector ${selector}` } }),
      );
    });
  });
  return new Promise<{ url: string; calls: string[]; stop: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls,
        stop: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

describe.skipIf(!configured)("the Hypha Bridge, driven against a chain", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let chain: Awaited<ReturnType<typeof startFixtureChain>>;

  const tokens: Record<string, FixtureToken> = {
    [EQUITY.toLowerCase()]: {
      name: "Village Equity",
      symbol: "VEQ",
      decimals: 18,
      // 1,000,000.5 tokens. The half is the point: this is exactly the figure
      // that becomes 1000000 if anybody divides it into an integer.
      totalSupply: BigInt("1000000500000000000000000"),
      balances: { [TREASURY_ADDR.toLowerCase()]: BigInt("250000000000000000000000") },
    },
    [VOICE.toLowerCase()]: {
      // Six decimals, so a shared cache or an assumed 18 shows up as a wrong
      // number instead of as a passing test.
      name: "Village Voice",
      symbol: "VVO",
      decimals: 6,
      totalSupply: BigInt("4200000000"),
      balances: { [TREASURY_ADDR.toLowerCase()]: BigInt("1500000") },
    },
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    chain = await startFixtureChain(tokens);
    await pool.query("DELETE FROM game_variables"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await loadVariables(pool);
    // The loopback exemption in base-reads.ts is deliberate and documented, and
    // this is the case it exists for: a local node, http, no public DNS.
    await setVariable(pool, "tokens.base_rpc_url", chain.url);
    await setVariable(pool, "hypha.treasury_address", TREASURY_ADDR);
    await setVariable(pool, "hypha.founder_base_address", FOUNDER);
    await loadVariables(pool);
  });

  afterAll(async () => {
    await chain?.stop().catch(() => {});
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM hypha_token_bindings"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM hypha_village_reads"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("DELETE FROM hypha_outcomes"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  // ── Upgrade 5: the name comes from the chain ───────────────────────────────

  it("reads name(), symbol() and decimals() OFF THE CONTRACT, per contract", async () => {
    const equity = await readTokenIdentity(EQUITY);
    expect(equity).toBeTruthy();
    expect(equity!.name).toBe("Village Equity");
    expect(equity!.symbol).toBe("VEQ");
    expect(equity!.decimals).toBe(18);
    expect(equity!.chainId).toBe(8453);
    expect(Date.parse(equity!.readAt)).toBeGreaterThan(0);

    // The second contract's decimals must be ITS OWN. An assumed 18, or a cache
    // shared across contracts, both show up right here.
    const voice = await readTokenIdentity(VOICE);
    expect(voice!.name).toBe("Village Voice");
    expect(voice!.decimals).toBe(6);
  });

  it("refuses a contract that will not answer, and stores nothing", async () => {
    const nothing = await readTokenIdentity("0x9999999999999999999999999999999999999999");
    expect(nothing).toBeNull();
    expect(await repo.allBindings(pool)).toEqual([]);
  });

  it("a confirmed binding keeps the chain's own name, its provenance and who said yes", async () => {
    const identity = (await readTokenIdentity(EQUITY))!;
    await repo.saveBinding(pool, {
      tokenSlug: EQUITY_SLUG,
      contractAddress: EQUITY,
      chainId: identity.chainId,
      chainName: identity.name,
      chainSymbol: identity.symbol,
      decimals: identity.decimals,
      readAt: identity.readAt,
      confirmedByUserId: "u-founder",
    });
    const back = await repo.bindingFor(pool, EQUITY_SLUG);
    expect(back!.chainName).toBe("Village Equity");
    expect(back!.chainSymbol).toBe("VEQ");
    expect(back!.decimals).toBe(18);
    expect(back!.confirmedByUserId).toBe("u-founder");
    // Stored lowercase, so a rebinding of the checksummed spelling is the same
    // contract and not a second one.
    expect(back!.contractAddress).toBe(EQUITY.toLowerCase());

    await repo.saveBinding(pool, {
      tokenSlug: EQUITY_SLUG,
      contractAddress: VOICE,
      chainId: 8453,
      chainName: "Village Voice",
      chainSymbol: "VVO",
      decimals: 6,
      readAt: new Date().toISOString(),
      confirmedByUserId: "u-founder",
    });
    expect((await repo.allBindings(pool)).length).toBe(1);
    expect((await repo.bindingFor(pool, EQUITY_SLUG))!.chainSymbol).toBe("VVO");
  });

  // ── Upgrade 7: the village, not only the member ────────────────────────────

  it("reads TOTAL SUPPLY and the TREASURY balance as facts about the village", async () => {
    const supply = await villageFigure(pool, {
      tokenSlug: EQUITY_SLUG, metric: "totalSupply", contractAddress: EQUITY,
    });
    expect(supply!.stale).toBe(false);
    expect(supply!.raw).toBe("1000000500000000000000000");
    // The half token survives. An integer division here would print 1000000.
    expect(supply!.formatted).toBe("1000000.5");

    const held = await villageFigure(pool, {
      tokenSlug: EQUITY_SLUG, metric: "treasuryBalance", contractAddress: EQUITY, holderAddress: TREASURY_ADDR,
    });
    expect(held!.formatted).toBe("250000");

    // Six decimals scales by its own contract's answer.
    const voiceSupply = await villageFigure(pool, {
      tokenSlug: VOICE_SLUG, metric: "totalSupply", contractAddress: VOICE,
    });
    expect(voiceSupply!.formatted).toBe("4200");
  });

  it("a treasury balance with no treasury address configured reads as nothing, never as zero", async () => {
    const held = await villageFigure(pool, {
      tokenSlug: EQUITY_SLUG, metric: "treasuryBalance", contractAddress: EQUITY, holderAddress: "",
    });
    expect(held).toBeNull();
  });

  it("serves a figure under a minute old without asking the chain again", async () => {
    await villageFigure(pool, { tokenSlug: EQUITY_SLUG, metric: "totalSupply", contractAddress: EQUITY });
    const before = chain.calls.length;
    const again = await villageFigure(pool, { tokenSlug: EQUITY_SLUG, metric: "totalSupply", contractAddress: EQUITY });
    expect(again!.stale).toBe(false);
    expect(chain.calls.length).toBe(before);

    // `force` is what the admin refresh button passes, and it does reach out.
    await villageFigure(pool, { tokenSlug: EQUITY_SLUG, metric: "totalSupply", contractAddress: EQUITY, force: true });
    expect(chain.calls.length).toBeGreaterThan(before);
  });

  it("formats every scale by string math, with no float anywhere near it", () => {
    expect(formatUnits("1000000500000000000000000", 18)).toBe("1000000.5");
    expect(formatUnits("1", 18)).toBe("0.000000000000000001");
    expect(formatUnits("0", 18)).toBe("0");
    expect(formatUnits("4200000000", 6)).toBe("4200");
  });

  // ── Upgrades 3 and the orphans ─────────────────────────────────────────────

  it("records every delivery once, and a retry of one repairs instead of duplicating", async () => {
    const first = await repo.recordOutcome(pool, {
      agreementId: "991", marker: "p-1", verdict: "confirmed",
      matchedBy: "agreement", matchedProposalId: "p-1", deliveryKey: "d-1",
    });
    expect(first.duplicate).toBe(false);
    const retry = await repo.recordOutcome(pool, {
      agreementId: "991", marker: "p-1", verdict: "confirmed",
      matchedBy: "agreement", matchedProposalId: "p-1", deliveryKey: "d-1",
    });
    expect(retry.duplicate).toBe(true);
    expect((await repo.recentOutcomes(pool)).length).toBe(1);
  });

  it("an unmatched delivery is an ORPHAN a steward can see and answer", async () => {
    await repo.recordOutcome(pool, {
      agreementId: "404", verdict: "rejected", matchedBy: "none", deliveryKey: "d-orphan",
    });
    const orphans = await repo.orphanOutcomes(pool);
    expect(orphans.length).toBe(1);
    expect(orphans[0].matchedProposalId).toBeNull();

    expect(await repo.resolveOutcome(pool, orphans[0].id, "u-steward", "It belonged to the other village")).toBe(true);
    // Answered once. A second answer finds nothing to answer.
    expect(await repo.resolveOutcome(pool, orphans[0].id, "u-steward", "again")).toBe(false);
    expect(await repo.orphanOutcomes(pool)).toEqual([]);
    // And it stays on the record with the note beside it.
    const all = await repo.recentOutcomes(pool);
    expect(all[0].note).toBe("It belonged to the other village");
    expect(all[0].resolvedByUserId).toBe("u-steward");
  });

  it("a matched delivery never shows up in the orphan list", async () => {
    await repo.recordOutcome(pool, {
      agreementId: "991", verdict: "confirmed", matchedBy: "agreement",
      matchedProposalId: "p-1", deliveryKey: "d-matched",
    });
    expect(await repo.orphanOutcomes(pool)).toEqual([]);
  });

  // ── Upgrade 4: the switchover strands nothing ──────────────────────────────

  it("the switchover preflight counts what is really in flight, from the proposals table", async () => {
    const mk = (id: string, status: string) =>
      pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO mechanics_proposals (id, title, rationale, change_set, proposer_user_id, status) VALUES (?,?,?,?,?,?)",
        [id, `t ${id}`, "why", "[]", "u-1", status],
      );
    await pool.query("DELETE FROM mechanics_proposals"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await mk("p-open", "open");
    await mk("p-hypha", "to_hypha");
    await mk("p-vote", "onsite_vote");
    await mk("p-done", "applied");

    const counts = await repo.inFlightDecisionCounts(pool);
    expect(counts.open).toBe(1);
    expect(counts.to_hypha).toBe(1);
    expect(counts.onsite_vote).toBe(1);
    expect(counts.applied).toBeUndefined();

    const p = switchoverPreflight({ currentMethod: "custom", targetMethod: "hypha", byStatus: counts });
    expect(p.inFlight).toBe(3);
    expect(p.strands).toBe(false);
    expect(p.effect).toContain("None of them is stranded");

    await pool.query("DELETE FROM mechanics_proposals"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  it("the agreement id finds its proposal, which is what makes it the strong key", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mechanics_proposals (id, title, rationale, change_set, proposer_user_id, status, hypha_proposal_id) VALUES (?,?,?,?,?,?,?)",
      ["p-linked", "t", "why", "[]", "u-1", "to_hypha", "991"],
    );
    expect(await repo.proposalByAgreementId(pool, "991")).toBe("p-linked");
    expect(await repo.proposalByAgreementId(pool, "992")).toBeNull();
    expect(await repo.proposalByAgreementId(pool, "")).toBeNull();
    expect(await repo.proposalExists(pool, "p-linked")).toBe(true);
    expect(await repo.proposalExists(pool, "p-missing")).toBe(false);
    await pool.query("DELETE FROM mechanics_proposals"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  // ── The read-through window, against a database in another zone ────────────

  /**
   * The window has to hold on a database whose session zone is not UTC, and
   * NOTHING about the code showed that it did not.
   *
   * `fetched_at` is a MySQL `timestamp`. The server converts one out of UTC
   * into the SESSION zone on its way out, and mysql2 (`timezone: "Z"`) reads
   * those digits back as UTC, so a row WRITTEN by `NOW()` returns shifted by
   * the session's offset while a row written from a bound `Date` round-trips
   * unchanged. The old code wrote `NOW()` and compared against `Date.now()`.
   *
   * These pools are the real mechanism and not a simulation of it: a second
   * and third connection onto the SAME scratch schema, pinned four hours
   * behind UTC and two hours ahead, in the production `on("connection")`
   * shape. On a UTC runner they are the only thing that can reach the defect,
   * which matters because CI's MySQL is UTC and this machine's MariaDB is
   * America/New_York — a guard that leaned on the local clock would be green
   * in exactly the place it needed to be red.
   */
  function zonedPool(url: string, offset: string): mysql.Pool {
    const p = mysql.createPool({ uri: url, timezone: "Z", connectionLimit: 2 }); // module-review-ok: the S5 scratch-schema harness pool, the shape this file already uses. test-pool-ok: this pool is pinned to a deliberate non-UTC offset below, which is what the file measures
    p.on("connection", (c) => {
      c.query(`SET time_zone = '${offset}'`); // module-review-ok: the session pin is the thing under test, on the S5 scratch schema
    });
    return p;
  }

  const HOLDER = TREASURY_ADDR; // the fixture address the equity token actually credits
  const MEMBER = "u-window";

  it.each([
    ["four hours BEHIND UTC", "-04:00"],
    ["two hours AHEAD of UTC", "+02:00"],
    ["UTC itself", "+00:00"],
  ])("the member-balance window engages on a database %s", async (_label, offset) => {
    const zoned = zonedPool(db.url, offset);
    try {
      await zoned.query("DELETE FROM onchain_balances"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      const args = {
        userId: MEMBER,
        walletAddress: HOLDER,
        tokenSlug: EQUITY_SLUG,
        contractAddress: EQUITY,
      };

      // A cold read reaches the chain and returns the real figure.
      const before = chain.calls.length;
      const cold = await readOnchainBalance(zoned, args);
      expect(cold).toBeTruthy();
      expect(cold!.formatted).toBe("250000");
      expect(cold!.stale).toBe(false);
      expect(chain.calls.length).toBeGreaterThan(before);

      /*
       * THE ASSERTION THE DEFECT FAILED. A second read inside the window must
       * spend NOTHING. On a behind-UTC session the old code saw an age of four
       * hours here and dialled the paid endpoint on every single page load.
       */
      const afterCold = chain.calls.length;
      const warm = await readOnchainBalance(zoned, args);
      expect(warm!.raw).toBe(cold!.raw);
      expect(warm!.stale).toBe(false);
      expect(warm!.fetchedAt).toBe(cold!.fetchedAt);
      expect(chain.calls.length).toBe(afterCold);

      /*
       * THE OTHER DIRECTION, and the one that costs a member instead of the
       * village. Age the row past the window by writing what the writer would
       * have written a hundred seconds ago. On an ahead-UTC session the old
       * code read this as a NEGATIVE age, which is less than sixty seconds, so
       * a balance two hours out of date was served with `stale: false` and
       * nobody was told. The window must engage and refetch.
       */
      const aged = readInstant(Date.now() - FRESH_WINDOW_MS - 40_000);
      await zoned.query("UPDATE onchain_balances SET fetched_at = ? WHERE user_id = ?", [aged, MEMBER]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      const stale = await readOnchainBalance(zoned, args);
      expect(chain.calls.length).toBeGreaterThan(afterCold);
      expect(stale!.stale).toBe(false); // refetched, so it is fresh again
      expect(Date.parse(stale!.fetchedAt)).toBeGreaterThan(aged.getTime());
    } finally {
      await zoned.end();
    }
  });

  /**
   * The mechanism itself, isolated, with the old write beside the new one.
   *
   * A `timestamp` is stored as a UTC epoch and converted BOTH ways against the
   * session zone, so the property that holds is a round trip within one
   * session and never agreement across sessions. That distinction is the whole
   * bug: a bound `Date` is shifted on the way in and shifted back on the way
   * out, so it survives; `NOW()` is generated by the server already in session
   * wall time, is stored correctly, and is then shifted once on the way out
   * with nothing to cancel it.
   *
   * The `NOW()` half is a live control. It fails on any engine this run is on,
   * which is what stops the other half passing by comparing nothing.
   */
  it.each([
    ["a session BEHIND UTC dates a NOW() row in the past", "-04:00", -1],
    ["a session AHEAD of UTC dates a NOW() row in the future", "+02:00", 1],
  ])("%s while a bound Date round-trips", async (_label, offset, sign) => {
    const p = zonedPool(db.url, offset);
    try {
      await p.query("DELETE FROM onchain_balances"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      await p.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO onchain_balances (id, user_id, token_slug, raw_balance, decimals, fetched_at) VALUES (?,?,?,?,?,?)",
        ["row", MEMBER, EQUITY_SLUG, "1", 18, readInstant()],
      );
      const readBack = async () => {
        const [rows] = await p.query<any[]>("SELECT fetched_at FROM onchain_balances WHERE user_id = ?", [MEMBER]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        return new Date(rows[0].fetched_at).getTime();
      };

      // THE FIX'S WRITE. Out and back through a shifted session, unchanged.
      const at = readInstant();
      await p.query("UPDATE onchain_balances SET fetched_at = ? WHERE user_id = ?", [at, MEMBER]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      expect(await readBack()).toBe(at.getTime());

      // THE OLD WRITE. Off by the session's whole offset, in the direction the
      // session leans, and by hours against a window of sixty seconds.
      await p.query("UPDATE onchain_balances SET fetched_at = NOW() WHERE user_id = ?", [MEMBER]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      const viaNow = await readBack();
      const drift = viaNow - Date.now();
      expect(Math.abs(drift)).toBeGreaterThan(FRESH_WINDOW_MS);
      expect(Math.sign(drift)).toBe(sign);
      // And the pair of readings this file's fix is about: what the old
      // comparison would have concluded, spelled out.
      expect(withinFreshWindow(new Date(viaNow).toISOString(), Date.now(), FRESH_WINDOW_MS)).toBe(false);
    } finally {
      await p.end();
    }
  });

  // ── The rule the whole surface stands on. Last, because it kills the node. ──

  it("NULL ON RPC FAILURE, NEVER ZERO: a dead chain returns the last true figure, dated", async () => {
    const fresh = await villageFigure(pool, {
      tokenSlug: EQUITY_SLUG, metric: "totalSupply", contractAddress: EQUITY, force: true,
    });
    expect(fresh!.formatted).toBe("1000000.5");
    expect(fresh!.stale).toBe(false);

    // The chain goes away. Nothing else changes.
    await chain.stop();

    const afterOutage = await villageFigure(pool, {
      tokenSlug: EQUITY_SLUG, metric: "totalSupply", contractAddress: EQUITY, force: true,
    });
    expect(afterOutage).toBeTruthy();
    expect(afterOutage!.stale).toBe(true);
    expect(afterOutage!.formatted).toBe("1000000.5");
    expect(afterOutage!.fetchedAt).toBe(fresh!.fetchedAt);

    // A figure this village has NEVER read is nothing at all. This is the
    // assertion the rule exists for: a zero total supply would be a statement
    // that the DAO issued nothing.
    const neverRead = await villageFigure(pool, {
      tokenSlug: VOICE_SLUG, metric: "totalSupply", contractAddress: VOICE, force: true,
    });
    expect(neverRead).toBeNull();

    // And the identity read refuses too, so no binding can be made off a
    // chain that is not answering.
    expect(await readTokenIdentity(VOICE)).toBeNull();
    expect(await readVillageMetric({ contractAddress: VOICE, metric: "totalSupply" })).toBeNull();

    // Nothing was written on the way through any of that.
    const [rows] = await pool.query<any[]>("SELECT token_slug FROM hypha_village_reads"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows.map((r: any) => r.token_slug)).toEqual([EQUITY_SLUG]);
  });
});
