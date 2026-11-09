/**
 * WORK-EARNED VOICE: HOW MUCH OF EACH MEMBER'S VOICE CAME FROM WORK.
 *
 * Rye, 2026-11-08, relayed by the master coordinator: a vote may count only
 * work-earned Voice, and Funding rounds keeps Voice from money paid in and
 * from backing out of pot ballots. This is the one read both use.
 *
 * THE COUNT. A member's balance times their work share: Voice minted to them
 * from work sources over all Voice minted to them, each source net of its own
 * reversals (`workShare` in shared/voiceFromMoney.ts says why a share of the
 * balance is the right count). Which sources are work is an allow-list there.
 *
 * WHAT IT READS. Only the ledger, which is the record (server/repos/voiceLedger.ts):
 *   - mints: postings from the Voice faucet to the member, grouped by source;
 *   - un-mints: clawback mirrors from the member back to the faucet, each
 *     netted against the source of the posting its key names
 *     (`reversal:<village>:<original key>`, `originalKeyOf` in ledger.ts).
 * Decay, claims and exit sweeps take from the balance as a whole and are not
 * read: they move every source's share alike.
 *
 * WHAT IT REPORTS. Any mint source it does not classify, so a ballot or a pot
 * can say a count is understated. Such a source counts in the whole and never
 * in the work, which fails closed. A mirror whose original cannot be found
 * comes off the work as well as the whole, which also only lowers the count.
 *
 * Figures are in Voice's MINOR units, floored, the same units `weightsFor`
 * reads off `token_balances`, so a ballot can weigh with either.
 */
import type { Pool } from "mysql2/promise";
import { memberAccount, originalKeyOf } from "./ledger";
import { VILLAGE_VOICE, VOICE_MINT } from "./economy";
import { balancesOf, clawbacksToFaucet, mintedBySource, sourcesOfKeys } from "../repos/voiceLedger";
import { voiceSourceKind, workShare } from "../../shared/voiceFromMoney";

export interface WorkEarnedVoiceRead {
  /** Each asked member's work-earned Voice, in minor units. A member holding nothing reads 0. */
  byUser: Map<string, number>;
  /** Mint sources met that are neither work nor money, sorted. */
  unclassified: string[];
}

export async function workEarnedVoice(pool: Pool, userIds: readonly string[]): Promise<WorkEarnedVoiceRead> {
  const byUser = new Map<string, number>();
  const ids = Array.from(new Set(userIds.map(String)));
  if (ids.length === 0) return { byUser, unclassified: [] };

  const accounts = ids.map((id) => memberAccount(id));
  const balanceOf = await balancesOf(pool, VILLAGE_VOICE, accounts);

  const net = new Map<string, Record<string, number>>();
  const unclassified = new Set<string>();
  for (const m of await mintedBySource(pool, VILLAGE_VOICE, VOICE_MINT, accounts)) {
    const row = net.get(m.account) ?? {};
    row[m.source] = (row[m.source] ?? 0) + m.total;
    net.set(m.account, row);
    if (voiceSourceKind(m.source) === "unclassified") unclassified.add(m.source);
  }

  const mirrors = await clawbacksToFaucet(pool, VILLAGE_VOICE, VOICE_MINT, accounts);
  const originals = Array.from(new Set(mirrors.map((r) => originalKeyOf(r.key)).filter((k): k is string => k !== null)));
  const sourceOfKey = await sourcesOfKeys(pool, VILLAGE_VOICE, originals);
  const unattributed = new Map<string, number>();
  for (const r of mirrors) {
    const original = originalKeyOf(r.key);
    const source = original === null ? undefined : sourceOfKey.get(original);
    if (source === undefined) {
      unattributed.set(r.account, (unattributed.get(r.account) ?? 0) + r.amount);
      continue;
    }
    const row = net.get(r.account) ?? {};
    row[source] = (row[source] ?? 0) - r.amount;
    net.set(r.account, row);
  }

  ids.forEach((id, i) => {
    const account = accounts[i];
    const balance = Math.max(0, balanceOf.get(account) ?? 0);
    const share = workShare(net.get(account) ?? {}, unattributed.get(account) ?? 0);
    byUser.set(id, Math.floor(balance * share + 1e-9));
  });
  return { byUser, unclassified: Array.from(unclassified).sort() };
}
