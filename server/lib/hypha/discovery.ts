/**
 * Token discovery on Base: what the founder's account HOLDS, as a proposal.
 *
 * DISCOVERY PROPOSES, THE FOUNDER CONFIRMS, and that separation is the whole
 * reason this file exists apart from the route that used to hold it. The
 * shipped lookup asked for a token's exact on-chain name, matched on it, and
 * returned the one contract that matched. Two things make that the wrong shape:
 *
 *   - A founder's wallet also holds airdropped junk. Somebody who has ever
 *     touched a Base address has tokens in it they did not ask for.
 *   - Scam tokens deliberately mimic real names. An exact-name match is exactly
 *     the check an impersonating contract is built to pass, and a name match is
 *     the only evidence the old path had.
 *
 * So this returns EVERY candidate with its name, symbol and address, marks the
 * ones whose name matches a hint, and picks nothing. The confirm step reads
 * name() and symbol() off the contract itself before anything is stored, which
 * is the check a name match cannot do for itself.
 *
 * WHAT IT CANNOT SEE, said out loud because it changes what a founder does
 * first: discovery only sees tokens the founder's account holds a balance of,
 * or has moved. Creating a token on Hypha does not by itself put a balance
 * anywhere. Issue yourself any amount on Hypha first, and the contract appears.
 *
 * Two sources, tried in order, both through the PINNED dialer. Neither is
 * authoritative and both are used only to propose an address a human then
 * confirms against the chain.
 */
import { guardedFetchJson } from "../toolcheck";
import { secretConfigured, secretValue } from "../secrets";

export interface TokenCandidate {
  contractAddress: string;
  /** As the source reported it. The chain is asked again at confirm time. */
  tokenName: string;
  tokenSymbol: string;
  /** True when this candidate's reported name matches the founder's hint. */
  nameMatches: boolean;
}

export interface DiscoveryResult {
  /** Every candidate seen, name-matches first. Never a single auto-picked one. */
  candidates: TokenCandidate[];
  source: "alchemy" | "basescan";
  /** How many of them matched the hint, when a hint was given. */
  matchCount: number;
}

export class DiscoveryUnavailable extends Error {}

/** Alchemy's Token API rides the SAME key as the RPC url, so there is no second signup. */
export function alchemyEndpoint(baseRpcUrl: string): string | null {
  const url = baseRpcUrl.trim();
  return /g\.alchemy\.com\/v2\//.test(url) ? url : null;
}

/**
 * Is there any way to look at all. Returns the refusal sentence, or null when a
 * lookup can run.
 *
 * A sentence, because the answer a founder needs is which of three doors to walk
 * through and every caller would otherwise write its own version of that
 * paragraph.
 *
 * `basescanConfigured` is an ARGUMENT and not a `secretConfigured` call inside,
 * for the same reason `listenerPosture` takes one: the secrets cache throws
 * until boot has loaded it, so reading it in here would make a pure question
 * about configuration depend on process lifecycle. The unit test found that by
 * asking the question before any boot, which is exactly when a fork's tooling
 * would ask it.
 */
export function discoverySourceProblem(baseRpcUrl: string, basescanConfigured: boolean): string | null {
  if (alchemyEndpoint(baseRpcUrl)) return null;
  if (basescanConfigured) return null;
  return (
    "No lookup source is configured. Either set an Alchemy endpoint as the Base RPC URL " +
    "(Tokens, Base RPC URL: its Token API does the lookup and needs no extra key), or save a free " +
    "etherscan.io API key under Admin, Integrations as the Basescan key. You can also paste the " +
    "contract address by hand from basescan.org."
  );
}

/** Tokens the founder's account holds a balance of, with their metadata. */
async function alchemyCandidates(rpcUrl: string, founderAddress: string): Promise<TokenCandidate[]> {
  const rpc = (method: string, params: unknown[]) =>
    guardedFetchJson(rpcUrl, 10_000, {
      method: "POST",
      body: { jsonrpc: "2.0", id: 1, method, params },
    }).then((d: any) => {
      if (d?.error) throw new Error(String(d.error.message ?? "RPC error"));
      return d?.result;
    });

  const balances: any = await rpc("alchemy_getTokenBalances", [founderAddress]);
  const held: string[] = (balances?.tokenBalances ?? [])
    .filter((b: any) => b?.tokenBalance && !/^0x0*$/.test(String(b.tokenBalance)))
    .map((b: any) => String(b.contractAddress).toLowerCase())
    // Capped for the same reason the shipped version capped it: a wallet with
    // four hundred airdrops would otherwise make four hundred metadata calls.
    .slice(0, 60);

  const metas = await Promise.all(
    held.map(async (addr): Promise<TokenCandidate | null> => {
      try {
        const m: any = await rpc("alchemy_getTokenMetadata", [addr]);
        return {
          contractAddress: addr,
          tokenName: String(m?.name ?? ""),
          tokenSymbol: String(m?.symbol ?? ""),
          nameMatches: false,
        };
      } catch {
        return null;
      }
    }),
  );
  return metas.filter((m): m is TokenCandidate => m !== null && m.tokenName !== "");
}

/** Etherscan V2 on Base (chainid 8453): distinct tokens in the transfer history. */
async function basescanCandidates(founderAddress: string): Promise<TokenCandidate[]> {
  const api = new URL("https://api.etherscan.io/v2/api");
  api.searchParams.set("chainid", "8453");
  api.searchParams.set("module", "account");
  api.searchParams.set("action", "tokentx");
  api.searchParams.set("address", founderAddress);
  api.searchParams.set("page", "1");
  api.searchParams.set("offset", "500");
  api.searchParams.set("sort", "desc");
  api.searchParams.set("apikey", secretValue("basescan_api_key"));
  const data: any = await guardedFetchJson(api.toString(), 10_000);
  const txs: any[] = Array.isArray(data?.result) ? data.result : [];
  const distinct = new Map<string, TokenCandidate>();
  for (const t of txs) {
    const addr = String(t.contractAddress ?? "").toLowerCase();
    if (addr && !distinct.has(addr)) {
      distinct.set(addr, {
        contractAddress: addr,
        tokenName: String(t.tokenName ?? ""),
        tokenSymbol: String(t.tokenSymbol ?? ""),
        nameMatches: false,
      });
    }
  }
  return Array.from(distinct.values());
}

/**
 * Every candidate the configured source can see, ordered with name-matches
 * first. `nameHint` is optional on purpose: a founder who does not remember
 * what they called the token can still read the list.
 *
 * Throws `DiscoveryUnavailable` when no source is configured, so a caller can
 * separate "nothing to look with" from "looked and found nothing", which are
 * different sentences to a founder.
 */
export async function discoverCandidates(input: {
  baseRpcUrl: string;
  founderAddress: string;
  nameHint?: string;
}): Promise<DiscoveryResult> {
  const problem = discoverySourceProblem(input.baseRpcUrl, secretConfigured("basescan_api_key"));
  if (problem) throw new DiscoveryUnavailable(problem);

  const alchemy = alchemyEndpoint(input.baseRpcUrl);
  const source = alchemy ? "alchemy" : "basescan";
  const all = alchemy
    ? await alchemyCandidates(alchemy, input.founderAddress)
    : await basescanCandidates(input.founderAddress);

  const hint = String(input.nameHint ?? "").trim().toLowerCase();
  for (const c of all) {
    c.nameMatches = hint !== "" && c.tokenName.trim().toLowerCase() === hint;
  }
  const matchCount = all.filter((c) => c.nameMatches).length;
  // Name matches first, then alphabetically, so the list a founder reads is
  // stable between two calls. An unstable order is how somebody confirms the
  // wrong row on the second look.
  all.sort((a, b) =>
    a.nameMatches === b.nameMatches
      ? a.tokenName.localeCompare(b.tokenName)
      : a.nameMatches
        ? -1
        : 1,
  );
  return { candidates: all, source, matchCount };
}

/**
 * What a founder does in Hypha before discovery can see anything.
 *
 * Kept here beside the lookup rather than in a component, because the reason
 * these steps exist is a property of how discovery works and the two drift
 * apart the moment they live in different files.
 */
/**
 * Re-exported so every existing server import keeps working. The list itself
 * moved to shared/hypha.ts because the admin panel needs it too, and it could
 * not reach a server module. One list, two readers.
 */
export { HYPHA_FIRST_STEPS } from "../../../shared/hypha";
