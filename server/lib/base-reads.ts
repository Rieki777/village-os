/**
 * Base chain reads (S47): the economics section's ONLY chain surface.
 *
 * The platform READS Amora/Voice balances to display them — it never mints,
 * moves, or prices what Hypha governs (Gate B; economy invariant 2.1 #6).
 * Three rules, all load-bearing:
 *
 *   1. decimals() is READ from each contract, never assumed 18, and stored
 *      beside every cached balance. Raw uint256 stays raw (DECIMAL(65,0));
 *      formatting is string math at the edge. BigInt-dividing 0.5 tokens of
 *      equity into an INT that displays as 0 is a misstatement about
 *      ownership, and this file is where that can never happen.
 *   2. NULL ON RPC FAILURE, NEVER ZERO. A failed read returns the last
 *      known value marked stale (with when it was true), or null if nothing
 *      was ever read. Nothing is written on failure — a zero in the cache
 *      means the CHAIN said zero.
 *   3. Balances render only against wallet_verified_at bindings (the
 *      signed-message challenge in index.ts). An address string someone
 *      merely typed proves nothing; equity beside a name must.
 */
import crypto from "crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { stringVar } from "./variables";
import { guardOutboundUrl } from "./toolcheck";

/**
 * viem IS LOADED ON DEMAND, NEVER AT MODULE LOAD, and that is a boot-time
 * decision rather than a style one.
 *
 * `server/index.ts` imports this file for four route handlers, so a top-level
 * `import ... from "viem"` made every boot resolve viem's package whether or
 * not any chain read ever happened. It is 10,134 files and 26.7 MB on disk,
 * 1,417 of them chain definitions that `viem/chains` re-exports as one barrel,
 * against 135 files for mysql2 and 10 for express. Node's ESM resolver opens
 * every one of them, and on a first-touch tree (a fresh worktree, a fresh
 * container, an anti-malware scanner that has not seen the files before) that
 * walk is tens of seconds during which the process emits NOTHING. Measured on
 * this machine, 2026-09-23: first boot after `pnpm install` took 51.7 s to its
 * first byte of output and 69.5 s to "Server listening", against 3.2 s and
 * 19.8 s once the tree was warm.
 *
 * That cost every Railway boot, and it made the 56 e2e suites that spawn
 * `dist/index.js` race a 120 s deadline they could lose under load, with an
 * EMPTY server log as the symptom, which reads like a boot the change under
 * test broke.
 *
 * Both modules are memoised, so the first chain read pays the load once and
 * every read after it pays nothing. Nothing else about the surface moves: the
 * three rules in the header above still hold, and `null` still means the chain
 * did not answer.
 */
let viemModule: Promise<typeof import("viem")> | null = null;
function loadViem(): Promise<typeof import("viem")> {
  if (!viemModule) viemModule = import("viem");
  return viemModule;
}

let baseChainDef: Promise<(typeof import("viem/chains"))["base"]> | null = null;
function loadBaseChain(): Promise<(typeof import("viem/chains"))["base"]> {
  if (!baseChainDef) baseChainDef = import("viem/chains").then((m) => m.base);
  return baseChainDef;
}

export interface OnchainBalance {
  /** Raw uint256 as a decimal string — full fixed-point, never truncated. */
  raw: string;
  decimals: number;
  /** Human string with full precision, e.g. "0.5" — string math, no floats. */
  formatted: string;
  fetchedAt: string;
  /** True when this is a LAST-KNOWN value (the fresh read failed). */
  stale: boolean;
}

/** Fixed-point → human string. Pure string math; exported for tests. */
export function formatUnits(raw: string, decimals: number): string {
  const neg = raw.startsWith("-");
  let digits = (neg ? raw.slice(1) : raw).replace(/^0+(?=\d)/, "");
  if (decimals <= 0) return (neg ? "-" : "") + digits;
  digits = digits.padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const frac = digits.slice(-decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + whole + (frac ? `.${frac}` : "");
}

/** decimals() per contract, cached per process. Refreshed only on success. */
const decimalsCache = new Map<string, number>();

/**
 * The read-through window every cached chain figure is served under. One
 * constant, because `readOnchainBalance` (per member) and `villageFigure` (per
 * village) answer the same question about the same paid endpoint, and two
 * numbers claiming to be the same number drift.
 */
export const FRESH_WINDOW_MS = 60_000;

/**
 * Is a cached figure still inside its window? PURE, and it takes BOTH instants
 * so the comparison can be exercised without a clock or a database.
 *
 * This exists because the comparison it replaces was wrong in a way nothing
 * about the code looked wrong. `fetched_at` was written by `NOW()` and read
 * back against `Date.now()`, which compares the DATABASE server's clock with
 * this process's. `fetched_at` is a MySQL `timestamp`, so the server converts
 * it out of UTC into the SESSION zone on the way out and mysql2 (`timezone:
 * "Z"`) then reads those digits as UTC: the value comes back shifted by
 * whatever the session's offset is. Measured on this machine's MariaDB, whose
 * session zone is America/New_York, the two clocks were 711 ms apart and this
 * subtraction reported 14,400,711 ms.
 *
 * Both directions are silent and both are bad, which is why the window is now
 * CLOSED AT BOTH ENDS rather than only at the top:
 *
 *   - a BEHIND-UTC session inflates the age, the window never engages, and
 *     every profile load dials an endpoint somebody pays per call for.
 *   - an AHEAD-UTC session makes the age NEGATIVE, and a bare `age < window`
 *     reads that as fresh for as long as the offset lasts. A member is shown
 *     a balance that stopped being true hours ago and is told nothing.
 *
 * A row dated in the future is therefore not fresh. Under the fix it cannot
 * normally happen — the writer stores its own `Date`, truncated to the second
 * the column holds, so the stored instant is never after the writing process's
 * now. It can still arrive from a second app instance whose clock runs ahead,
 * and the honest answer there is to spend a call rather than to show a figure
 * this process cannot date. The safe failure is the expensive one.
 */
export function withinFreshWindow(fetchedAtIso: string, nowMs: number, windowMs: number): boolean {
  const at = Date.parse(fetchedAtIso);
  if (!Number.isFinite(at)) return false;
  const age = nowMs - at;
  return age >= 0 && age < windowMs;
}

/**
 * The instant a read happened, as this process saw it, truncated to the second
 * the `timestamp` column holds.
 *
 * Truncating HERE and storing this exact value is what lets the same figure be
 * returned and written without the first read of a balance reporting a
 * different moment from every read after it. It also keeps the stored instant
 * at or before the caller's `Date.now()`, which is the invariant
 * `withinFreshWindow` leans on when it refuses a future date.
 */
export function readInstant(nowMs: number = Date.now()): Date {
  return new Date(Math.floor(nowMs / 1000) * 1000);
}

/**
 * The RPC URL is an admin-typed game variable, and its validation rule
 * accepts any https URL with no range check at all — so without this guard
 * an admin (or anyone who reached that route) could point the village's
 * server at `https://10.0.0.5/…` and read whatever answers, which is exactly
 * the SSRF the pinned dialer exists to close.
 *
 * NOT routed through guardedFetchJson: that helper is https-only, and the
 * loopback exemption is load-bearing — the acceptance test points the
 * platform at http://127.0.0.1, as does anyone running a local anvil node.
 * `redirect: "error"` stops viem hopping off the vetted host afterwards.
 */
async function rpcClient() {
  const url = stringVar("tokens.base_rpc_url").trim();
  if (!url) return null;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const isLoopback = host === "127.0.0.1" || host === "localhost";
  if (!isLoopback) {
    const guard = await guardOutboundUrl(url);
    if (!guard.ok) {
      console.error(`[base-reads] refusing RPC url: ${guard.refused ?? "refused"}`);
      return null;
    }
  }
  const [{ createPublicClient, http }, chain] = await Promise.all([loadViem(), loadBaseChain()]);
  return createPublicClient({
    chain,
    transport: http(url, { retryCount: 1, timeout: 8_000, fetchOptions: { redirect: "error" } }),
  });
}

/**
 * THE SEAM (R58d). The guarded client, exposed.
 *
 * Everything above this line is general: an SSRF-checked dialer, a decimals()
 * cache, string-math formatting and the null-never-zero rule. None of it knows
 * what Hypha is. The founder's ruling on other DAO stacks was "make the module
 * open, each one will be its own module anyway", so a second stack writes a
 * sibling module and builds on THESE functions rather than editing the Hypha
 * one or growing a second, unguarded dialer of its own.
 *
 * Deliberately not an adapter interface with one implementation. There is no
 * second stack yet, and a speculative abstraction shaped around a single case
 * is a worse starting point for the second case than the plain functions are.
 * What this does guarantee is that the second module never has to reach for
 * `createPublicClient` itself, which is the part that would actually go wrong.
 *
 * Returns null when no RPC is configured or the configured one is refused, and
 * every caller treats that as "the chain did not answer".
 */
export async function baseChainClient(): Promise<Awaited<ReturnType<typeof rpcClient>>> {
  return rpcClient();
}

/** What a contract calls itself, plus the decimals every figure is scaled by. */
export interface TokenIdentity {
  name: string;
  symbol: string;
  decimals: number;
  /** Base mainnet, carried so a testnet binding can never pass as a mainnet fact. */
  chainId: number;
  readAt: string;
}

/**
 * name(), symbol() and decimals() READ FROM THE CHAIN.
 *
 * Base is already declared the source of truth for a village's token names and
 * `tokenNameClash` enforces that rule, and until this function existed nothing
 * in the platform had ever asked a contract what it was called. The names on
 * screen came from a founder typing them into a variable, so the guard defended
 * a claim it could not check.
 *
 * All three in ONE multicall-free sequence with no cache: a binding happens once
 * and correctness matters more there than a round trip does. The decimals cache
 * above is for the hot balance path, and reusing it here would let a stale entry
 * decide what a NEW binding is scaled by.
 *
 * Returns null on any failure, including an implausible decimals(). A contract
 * that will not say what it is is a contract nobody should bind.
 */
export async function readTokenIdentity(contractAddress: string): Promise<TokenIdentity | null> {
  try {
    const client = await rpcClient();
    if (!client) return null;
    const { getAddress, erc20Abi } = await loadViem();
    const address = getAddress(contractAddress);
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ]);
    const d = Number(decimals);
    if (!Number.isInteger(d) || d < 0 || d > 77) throw new Error(`implausible decimals() = ${d}`);
    const chainName = String(name ?? "").trim();
    const chainSymbol = String(symbol ?? "").trim();
    if (!chainName || !chainSymbol) throw new Error("contract answered with a blank name or symbol");
    return {
      name: chainName.slice(0, 190),
      symbol: chainSymbol.slice(0, 64),
      decimals: d,
      chainId: (await loadBaseChain()).id,
      readAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error(`[base-reads] identity read failed for ${contractAddress}: ${(e as any)?.message ?? e}`);
    return null;
  }
}

/**
 * A raw uint256 read, village-scale: total supply, or what one address holds.
 *
 * Separate from `readOnchainBalance` because that function is a per-MEMBER
 * read-through cache keyed on a user id and gated on a verified wallet binding,
 * and neither of those applies to a fact about the village. This one takes an
 * address and returns a number or nothing; the caching and the null-never-zero
 * fallback live one layer up, where the store is.
 *
 * `null` means the chain did not answer. It never means zero.
 */
export async function readVillageMetric(
  input: { contractAddress: string; metric: "totalSupply" | "balanceOf"; holderAddress?: string },
): Promise<{ raw: string; decimals: number } | null> {
  try {
    const client = await rpcClient();
    if (!client) return null;
    const { getAddress, erc20Abi } = await loadViem();
    const address = getAddress(input.contractAddress);
    let decimals = decimalsCache.get(address.toLowerCase());
    if (decimals === undefined) {
      decimals = Number(await client.readContract({ address, abi: erc20Abi, functionName: "decimals" }));
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) throw new Error(`implausible decimals() = ${decimals}`);
      decimalsCache.set(address.toLowerCase(), decimals);
    }
    let raw: bigint;
    if (input.metric === "totalSupply") {
      raw = (await client.readContract({ address, abi: erc20Abi, functionName: "totalSupply" })) as bigint;
    } else {
      if (!input.holderAddress) throw new Error("balanceOf needs an address to read");
      raw = (await client.readContract({
        address, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(input.holderAddress)],
      })) as bigint;
    }
    return { raw: raw.toString(), decimals };
  } catch (e) {
    console.error(`[base-reads] ${input.metric} read failed for ${input.contractAddress}: ${(e as any)?.message ?? e}`);
    return null;
  }
}

async function readCache(pool: Pool, userId: string, tokenSlug: string): Promise<{ raw: string; decimals: number; fetchedAt: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT raw_balance, decimals, fetched_at FROM onchain_balances WHERE user_id = ? AND token_slug = ?",
    [userId, tokenSlug],
  );
  const r = rows[0];
  if (!r) return null;
  return { raw: String(r.raw_balance), decimals: Number(r.decimals), fetchedAt: new Date(r.fetched_at).toISOString() };
}

/**
 * One read-through cached balance. On success the cache row is upserted; on
 * ANY failure nothing is written and the caller gets last-known-with-
 * staleness or null. This function never throws.
 */
export async function readOnchainBalance(
  pool: Pool,
  input: { userId: string; walletAddress: string; tokenSlug: string; contractAddress: string },
): Promise<OnchainBalance | null> {
  const cached = await readCache(pool, input.userId, input.tokenSlug).catch(() => null);
  // Read-through TTL: a value under a minute old is served as fresh without
  // touching the RPC — profile loads must not hammer a public endpoint.
  // Both instants come from THIS process (see `withinFreshWindow`): the stored
  // one was written by the branch below out of `readInstant()`, never by NOW().
  if (cached && withinFreshWindow(cached.fetchedAt, Date.now(), FRESH_WINDOW_MS)) {
    return { raw: cached.raw, decimals: cached.decimals, formatted: formatUnits(cached.raw, cached.decimals), fetchedAt: cached.fetchedAt, stale: false };
  }
  try {
    const client = await rpcClient();
    if (!client) throw new Error("no RPC configured");
    const { getAddress, erc20Abi } = await loadViem();
    const contract = getAddress(input.contractAddress);
    const holder = getAddress(input.walletAddress);
    let decimals = decimalsCache.get(contract.toLowerCase());
    if (decimals === undefined) {
      decimals = Number(await client.readContract({ address: contract, abi: erc20Abi, functionName: "decimals" }));
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) throw new Error(`implausible decimals() = ${decimals}`);
      decimalsCache.set(contract.toLowerCase(), decimals);
    }
    const raw = (await client.readContract({
      address: contract, abi: erc20Abi, functionName: "balanceOf", args: [holder],
    })) as bigint;
    const rawStr = raw.toString();
    /*
     * ONE instant, from THIS process, stored and returned. Never `NOW()`.
     *
     * `NOW()` is the database server's wall clock in the database session's
     * zone, and every freshness check downstream subtracts it from
     * `Date.now()`. A bound `Date` renders and parses through mysql2 under one
     * `timezone` setting in both directions, so it reads back as the same
     * instant whatever the session is set to. `readInstant` truncates to the
     * second the `timestamp` column holds, so the value returned to the caller
     * is the value the next read will find.
     */
    const at = readInstant();
    await pool.query(
      "INSERT INTO onchain_balances (id, user_id, token_slug, raw_balance, decimals, fetched_at) VALUES (?,?,?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE raw_balance = VALUES(raw_balance), decimals = VALUES(decimals), fetched_at = VALUES(fetched_at)",
      [`${input.userId}:${input.tokenSlug}`.slice(0, 120), input.userId, input.tokenSlug, rawStr, decimals, at],
    );
    return { raw: rawStr, decimals, formatted: formatUnits(rawStr, decimals), fetchedAt: at.toISOString(), stale: false };
  } catch (e) {
    // The rule, verbatim: null on RPC failure, NEVER zero. Last-known wins
    // when it exists, marked with when it was actually true.
    console.error(`[base-reads] ${input.tokenSlug} read failed for ${input.userId}: ${(e as any)?.message ?? e}`);
    if (cached) {
      return { raw: cached.raw, decimals: cached.decimals, formatted: formatUnits(cached.raw, cached.decimals), fetchedAt: cached.fetchedAt, stale: true };
    }
    return null;
  }
}

// ── The signed-message challenge ─────────────────────────────────────────────

export function challengeMessage(input: { nonce: string; userId: string; host: string }): string {
  // Human-readable on purpose: wallets show this text to the person signing.
  // The HOST names the village — no deployment's brand is welded in here.
  return (
    `Wallet verification for ${input.host}\n\n` +
    `This signature proves you control this wallet. It authorizes nothing ` +
    `and costs nothing.\n\nMember: ${input.userId}\nSite: ${input.host}\nNonce: ${input.nonce}`
  );
}

export async function createWalletChallenge(pool: Pool, userId: string, host: string): Promise<{ message: string; expiresAt: string }> {
  const nonce = crypto.randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + 10 * 60 * 1000);
  await pool.query(
    "INSERT INTO wallet_challenges (user_id, nonce, expires_at) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE nonce = VALUES(nonce), expires_at = VALUES(expires_at)",
    [userId, nonce, expires],
  );
  return { message: challengeMessage({ nonce, userId, host }), expiresAt: expires.toISOString() };
}

/**
 * Verify the signature against the OUTSTANDING challenge. Consumes the nonce
 * on success (one signature, one binding); an expired or missing challenge
 * refuses. EIP-191 recovery via viem — "nobody else claimed the string" was
 * regen-civics' bug; the signature is the point.
 */
export async function verifyWalletSignature(
  pool: Pool,
  input: { userId: string; address: string; signature: string; host: string },
): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT nonce, expires_at FROM wallet_challenges WHERE user_id = ?",
    [input.userId],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "No challenge outstanding. Request one first" };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "The challenge expired. Request a fresh one" };
  }
  // Loaded here, past the two early returns above, so a caller with no
  // outstanding challenge is refused without paying for viem at all. The
  // `getAddress` call stays inside its own try: a load failure must not be
  // reported to the member as an invalid address.
  const { getAddress, verifyMessage } = await loadViem();
  let address: string;
  try {
    address = getAddress(String(input.address));
  } catch {
    return { ok: false, error: "That is not a valid address" };
  }
  const message = challengeMessage({ nonce: String(row.nonce), userId: input.userId, host: input.host });
  let valid = false;
  try {
    valid = await verifyMessage({ address: address as `0x${string}`, message, signature: input.signature as `0x${string}` });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "The signature does not match this address and challenge" };
  await pool.query("DELETE FROM wallet_challenges WHERE user_id = ?", [input.userId]);
  return { ok: true, address };
}
