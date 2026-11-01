/**
 * A REWARD MOMENT EACH TIME SOMETHING LANDS (0294).
 *
 * Rye, 2026-10-30, earnings idea 1. When a member next opens the app after
 * tokens, Voice or a cash payment arrived for them, they are shown one short
 * celebration naming what came in and what it was for: "40 Amora tokens and
 * 5 Voice for Seed bank shelves", "Your cash for Rebuild the water tank was
 * paid".
 *
 * WHAT COUNTS AS AN ARRIVAL. Two things, both only read:
 *
 *   a work credit   a ledger row INTO the member's account whose source is
 *                   pay for work (`REWARD_SOURCES`: a quest consented, a role
 *                   cycle settled, a proposal accepted). Every token that
 *                   payment carried lands on one line.
 *   a cash payment  a `cash_owed` row the village marked paid.
 *
 * GRATITUDE IS NOT EARNINGS. It moves only by a member's send (Rye,
 * 2026-10-23), so a row in the recognition token is left out even when its
 * source is work: an old consent from before 2026-10-21 credited Gratitude,
 * and that is not what this moment is for.
 *
 * ONCE, ON EVERY DEVICE. What a member has been shown is a row per arrival
 * in `reward_moment_seen`, so a phone and a laptop agree. The first time a
 * member is asked about, a baseline row is written instead and nothing is
 * returned: history is not news.
 *
 * ONE MOMENT, NEVER A QUEUE. Everything unseen comes back together, grouped
 * by the work behind it, and is acknowledged together.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { memberAccount, PLATFORM_TOKEN, tokenDef } from "./ledger";
import {
  cashPaidRowsSince,
  hasBaselineRow,
  insertBaselineRow,
  insertSeenRows,
  proposalDataRows,
  questConsentRefsSince,
  questTitleRows,
  roleNameRows,
  seenKeyRows,
  workCreditRowsSince,
} from "../repos/rewardMoment";
import {
  REWARD_MAX_ARRIVALS,
  REWARD_SOURCES,
  type RewardLine,
  type RewardMomentView,
  type RewardSource,
  type RewardToken,
} from "../../shared/rewardMoment";

export const rewardKeys = {
  ledger: (id: unknown) => `ledger:${String(id)}`,
  cash: (id: unknown) => `cash:${String(id)}`,
};

const EMPTY: RewardMomentView = { keys: [], lines: [] };

/** Gratitude never counts as earnings, whatever row carried it. */
export function isEarningsToken(slug: string): boolean {
  if (slug === PLATFORM_TOKEN) return false;
  return tokenDef(slug)?.kind !== "recognition";
}

const byId = (rows: RowDataPacket[], col: string) => new Map(rows.map((r) => [String(r.id), r[col] == null ? "" : String(r[col]).trim()]));

function proposalWork(raw: unknown): string {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    return String((data as any)?.work ?? "").trim();
  } catch {
    return "";
  }
}

/** Every title the credits name, read in one query per kind of work. */
async function workTitles(pool: Pool, credits: RowDataPacket[]): Promise<(source: string, ref: string) => string> {
  const refs = (source: RewardSource) => Array.from(new Set(credits.filter((r) => r.source === source && r.source_ref).map((r) => String(r.source_ref))));
  const [quests, roles, proposals] = await Promise.all([
    questTitleRows(pool, refs("quest_consent")),
    roleNameRows(pool, refs("role_cycle")),
    proposalDataRows(pool, refs("proposal_accepted")),
  ]);
  const questTitle = byId(quests, "title");
  const roleName = byId(roles, "name");
  const proposalTitle = new Map(proposals.map((r) => [String(r.id), proposalWork(r.data)]));
  return (source, ref) => {
    if (source === "quest_consent") return questTitle.get(ref) || "a quest";
    if (source === "role_cycle") {
      const name = roleName.get(ref);
      return name ? `holding ${name}` : "holding your role";
    }
    return proposalTitle.get(ref) || "your proposal";
  };
}

/**
 * What landed for a member that they have not been shown, grouped by the
 * work behind it. Writes only the baseline, and only on the first call.
 */
export async function pendingRewardMoment(pool: Pool, userId: string): Promise<RewardMomentView> {
  if (!(await hasBaselineRow(pool, userId))) {
    await insertBaselineRow(pool, userId);
    return EMPTY;
  }

  const [creditRows, cashRows] = await Promise.all([
    workCreditRowsSince(pool, memberAccount(userId), userId, REWARD_SOURCES, REWARD_MAX_ARRIVALS),
    cashPaidRowsSince(pool, userId, REWARD_MAX_ARRIVALS),
  ]);
  const credits = creditRows.filter((r) => isEarningsToken(String(r.token_type)) && Number(r.amount) > 0);
  const candidates = [...credits.map((r) => rewardKeys.ledger(r.id)), ...cashRows.map((r) => rewardKeys.cash(r.id))];
  const seen = new Set((await seenKeyRows(pool, userId, candidates)).map((r) => String(r.arrival_key)));

  const fresh = credits.filter((r) => !seen.has(rewardKeys.ledger(r.id)));
  const paid = cashRows.filter((r) => !seen.has(rewardKeys.cash(r.id)));
  if (!fresh.length && !paid.length) return EMPTY;

  const titleOf = await workTitles(pool, fresh);
  const lines: RewardLine[] = [];
  const earned = new Map<string, { work: string; tokens: Map<string, RewardToken> }>();
  for (const r of fresh) {
    const source = String(r.source);
    const ref = String(r.source_ref ?? r.id);
    const group = `${source}:${ref}`;
    let line = earned.get(group);
    if (!line) {
      line = { work: titleOf(source, ref), tokens: new Map() };
      earned.set(group, line);
    }
    const slug = String(r.token_type);
    const def = tokenDef(slug);
    const prior = line.tokens.get(slug);
    line.tokens.set(slug, {
      token: slug,
      name: def?.name ?? slug,
      units: (prior?.units ?? 0) + Number(r.amount),
      decimals: def?.decimals ?? 0,
    });
  }
  for (const { work, tokens } of Array.from(earned.values())) lines.push({ kind: "earned", work, tokens: Array.from(tokens.values()) });
  for (const r of paid) {
    lines.push({
      kind: "cash_paid",
      work: String(r.work_title ?? "").trim() || "your work",
      amountMinor: Number(r.amount_minor),
      currency: String(r.currency),
    });
  }

  return {
    keys: [...fresh.map((r) => rewardKeys.ledger(r.id)), ...paid.map((r) => rewardKeys.cash(r.id))],
    lines,
  };
}

/**
 * THE QUESTS WHOSE PAY THIS MOMENT ANNOUNCES, so the quest page does not
 * announce it a second time.
 *
 * A consent used to be celebrated on the quest page alone (QuestActions'
 * seeds moment, once per browser). Since 0294 the same pay is also named here,
 * on whatever page the member opens next, so a consented quest was announced
 * twice. This moment wins wherever it applies: it names what actually landed,
 * by token, it is remembered on the server so a phone and a laptop agree, and
 * it reaches the member without their going back to the quest.
 *
 * It applies to a claim whose consent credited an earnings token at or after
 * the member's baseline: exactly the rows `pendingRewardMoment` reads. A
 * consent from before the baseline, one that paid only Gratitude, or one that
 * paid no tokens at all (nothing set, or cash only) is never announced here,
 * so the quest page keeps its moment for those and nothing goes uncelebrated.
 * Before a member's first look there is no baseline and the answer is empty.
 */
export async function claimsAnnouncedHere(pool: Pool, userId: string): Promise<Set<string>> {
  if (!(await hasBaselineRow(pool, userId))) return new Set();
  const rows = await questConsentRefsSince(pool, memberAccount(userId), userId);
  return new Set(rows.filter((r) => r.source_ref && isEarningsToken(String(r.token_type))).map((r) => String(r.source_ref)));
}

/**
 * Record a moment as shown. Only keys that are this member's own unseen
 * arrivals are written, so a client cannot fill the table with whatever it
 * likes or mark somebody else's payment seen. Returns how many were recorded.
 */
export async function markRewardMomentSeen(pool: Pool, userId: string, keys: unknown): Promise<number> {
  if (!Array.isArray(keys) || !keys.length) return 0;
  const asked = new Set(keys.filter((k): k is string => typeof k === "string"));
  const pending = await pendingRewardMoment(pool, userId);
  const mine = pending.keys.filter((k) => asked.has(k));
  await insertSeenRows(pool, userId, mine);
  return mine.length;
}
