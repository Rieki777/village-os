/**
 * A MEMBER'S SEASON, READ BACK FROM WHAT THE VILLAGE ALREADY RECORDED (idea 4).
 *
 * In server/repos because every query here is raw SQL, and the burn-down
 * register keeps a table's readers enumerable there.
 *
 * Read only. Every figure comes from a table some other part of the platform
 * writes, inside the season's window [first day, turn day) in the village's
 * own zone:
 *
 *   tokens, Voice   token_ledger rows paying this member for work: a quest
 *                   consent, a role's cycle, an accepted proposal, a cycle
 *                   pool share, a Voice claim. A posting a reversal undid is
 *                   left out, and recognition never counts as earnings.
 *   cash            cash_owed (0285), owed in the season, and how much of
 *                   that has been paid. The platform never moves the money.
 *   gratitude       gratitude_log, sent and received, examples left out.
 *   quests          quest_claims consented in the season.
 *   roles           org_role_assignments held for any part of the season,
 *                   with their term.
 *   proposals       ballots this member opened that passed and did not fall
 *                   to a veto, plus Work With Us proposals accepted.
 *   badges          badge_awards made in the season. A warning is no
 *                   celebration and a self-declared skill was nobody's award,
 *                   so neither shows.
 *
 * Nothing here compares one member with another, and nothing here writes.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { civilDateInstant } from "../../shared/seatTerms";
import {
  pickSummarySeason,
  seasonWindows,
  topContributions,
  type SeasonSummary,
  type SummaryContribution,
  type SummarySeasonInput,
  type SummaryTokenLine,
} from "../../shared/seasonSummary";

/** Ledger sources that pay a member for work. Anything else (a swap, a purchase, a gift) is not earnings. */
export const EARNING_SOURCES = ["quest_consent", "role_cycle", "proposal_accepted", "gratitude_pool", "voice_claim"] as const;

export interface SummaryCalendar {
  seasons: readonly SummarySeasonInput[];
  timezone: string;
  /** The village's civil date today, `YYYY-MM-DD`. */
  today: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));
const human = (units: unknown, decimals: unknown): number => Number(units) / 10 ** Number(decimals ?? 0);

/** One member's summary, or null when the season is not one they can open. */
export async function seasonSummaryFor(
  pool: Pool,
  member: { id: string; name: string; handle: string | null },
  calendar: SummaryCalendar,
  askedSeasonId: string | null,
  now: Date = new Date(),
): Promise<SeasonSummary | null> {
  const windows = seasonWindows(calendar.seasons, calendar.today);
  const season = pickSummarySeason(windows, askedSeasonId);
  if (!season) return null;
  const from = civilDateInstant(season.startsOn, calendar.timezone);
  if (!from) return null;
  const turned = season.endedOn ? civilDateInstant(season.endedOn, calendar.timezone) : null;
  const to = turned && turned < now ? turned : now;

  const account = `mem:${member.id}`;
  const sources = EARNING_SOURCES as readonly string[];
  const marks = sources.map(() => "?").join(",");

  // Every paying posting in the window, with what it was for. A posting a
  // reversal undid never counts: the mirror's source_ref is the original key.
  const [paidRows] = await pool.query<RowDataPacket[]>(
    "SELECT l.token_type, l.source, l.source_ref, l.amount, t.name, t.kind, t.decimals " +
      "FROM token_ledger l JOIN tokens t ON t.slug = l.token_type " +
      "LEFT JOIN token_ledger r ON r.source = 'reversal' AND r.from_account = l.to_account AND r.source_ref = LEFT(l.idempotency_key, 120) " +
      `WHERE l.to_account = ? AND l.source IN (${marks}) AND l.at >= ? AND l.at < ? AND r.id IS NULL AND t.kind <> 'recognition'`,
    [account, ...sources, from, to],
  );

  const totals = new Map<string, SummaryTokenLine>();
  const paidFor = new Map<string, Array<{ token: string; name: string; amount: number }>>();
  for (const r of paidRows) {
    const amount = human(r.amount, r.decimals);
    const slug = String(r.token_type);
    const line = totals.get(slug) ?? { token: slug, name: String(r.name), kind: String(r.kind), amount: 0 };
    line.amount += amount;
    totals.set(slug, line);
    const key = `${r.source}:${r.source_ref ?? ""}`;
    const list = paidFor.get(key) ?? [];
    const same = list.find((p) => p.token === slug);
    if (same) same.amount += amount;
    else list.push({ token: slug, name: String(r.name), amount });
    paidFor.set(key, list);
  }
  const lines = Array.from(totals.values()).filter((l) => l.amount > 0).sort((a, b) => a.name.localeCompare(b.name));

  const [cashRows] = await pool.query<RowDataPacket[]>(
    "SELECT currency, SUM(amount_minor) AS earned, SUM(CASE WHEN state = 'paid' THEN amount_minor ELSE 0 END) AS paid " +
      "FROM cash_owed WHERE user_id = ? AND owed_at >= ? AND owed_at < ? GROUP BY currency ORDER BY currency",
    [member.id, from, to],
  );

  const [[sent]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS notes, COALESCE(SUM(amount),0) AS amount, COUNT(DISTINCT to_id) AS people FROM gratitude_log " +
      "WHERE from_id = ? AND kind = 'gratitude' AND is_example = 0 AND at >= ? AND at < ?",
    [member.id, from, to],
  );
  const [[received]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS notes, COALESCE(SUM(amount),0) AS amount FROM gratitude_log " +
      "WHERE to_id = ? AND kind = 'gratitude' AND is_example = 0 AND at >= ? AND at < ?",
    [member.id, from, to],
  );

  const contributions: SummaryContribution[] = [];

  const [quests] = await pool.query<RowDataPacket[]>(
    "SELECT c.id, COALESCE(q.title, c.quest_title) AS title, c.consented_at FROM quest_claims c " +
      "LEFT JOIN quests q ON q.id = c.quest_id " +
      "WHERE c.user_id = ? AND c.status = 'consented' AND c.consented_at >= ? AND c.consented_at < ? AND COALESCE(q.is_example, 0) = 0",
    [member.id, from, to],
  );
  for (const q of quests) {
    contributions.push({
      kind: "quest", id: String(q.id), title: String(q.title ?? "A quest"), at: iso(q.consented_at),
      paid: paidFor.get(`quest_consent:${q.id}`) ?? [],
    });
  }

  const [roles] = await pool.query<RowDataPacket[]>(
    "SELECT a.id, r.name, a.started_at, COALESCE(a.ended_at, a.term_ends_at) AS ends_at FROM org_role_assignments a " +
      "JOIN org_roles r ON r.id = a.org_role_id " +
      "WHERE a.user_id = ? AND a.holder_kind = 'member' AND a.started_at < ? AND (a.ended_at IS NULL OR a.ended_at > ?)",
    [member.id, to, from],
  );
  for (const r of roles) {
    contributions.push({
      kind: "role", id: String(r.id), title: String(r.name), at: iso(r.started_at),
      term: { from: iso(r.started_at), to: isoOrNull(r.ends_at) },
      paid: paidFor.get(`role_cycle:${r.id}`) ?? [],
    });
  }

  // Adopted: passed, and not a vote that a veto or the clock stopped landing.
  const [ballots] = await pool.query<RowDataPacket[]>(
    "SELECT id, title, closed_at FROM ballots WHERE opened_by = ? AND status = 'passed' " +
      "AND COALESCE(landing_status, 'applied') NOT IN ('vetoed', 'expired', 'not_applicable') AND closed_at >= ? AND closed_at < ?",
    [member.id, from, to],
  );
  for (const b of ballots) {
    contributions.push({ kind: "proposal", id: String(b.id), title: String(b.title), at: iso(b.closed_at), paid: [] });
  }
  // A Work With Us proposal leaves its title on the cash record when it pays
  // cash, and otherwise only its ledger rows.
  const [offers] = await pool.query<RowDataPacket[]>(
    "SELECT l.source_ref, MIN(l.at) AS at, MAX(c.work_title) AS title FROM token_ledger l " +
      "LEFT JOIN cash_owed c ON c.work_kind = 'proposal' AND c.work_ref = l.source_ref AND c.user_id = ? " +
      "WHERE l.to_account = ? AND l.source = 'proposal_accepted' AND l.at >= ? AND l.at < ? GROUP BY l.source_ref",
    [member.id, account, from, to],
  );
  for (const o of offers) {
    const paid = paidFor.get(`proposal_accepted:${o.source_ref}`);
    if (!paid) continue; // reversed
    contributions.push({
      kind: "proposal", id: String(o.source_ref), title: String(o.title ?? "Work With Us proposal"), at: iso(o.at), paid,
    });
  }

  const [badges] = await pool.query<RowDataPacket[]>(
    "SELECT b.id, b.name, b.icon, b.kind, a.count FROM badge_awards a JOIN badges b ON b.id = a.badge_id " +
      "WHERE a.user_id = ? AND a.created_at >= ? AND a.created_at < ? AND b.kind NOT IN ('warning', 'self') " +
      "AND COALESCE(a.is_example, 0) = 0 ORDER BY a.created_at, b.name",
    [member.id, from, to],
  );

  return {
    season,
    member: { name: member.name, handle: member.handle },
    tokens: lines.filter((l) => l.kind !== "voice"),
    voice: lines.filter((l) => l.kind === "voice"),
    cash: cashRows.map((c) => ({ currency: String(c.currency), earnedMinor: Number(c.earned), paidMinor: Number(c.paid) })),
    gratitude: {
      sent: Number(sent.amount), sentNotes: Number(sent.notes), people: Number(sent.people),
      received: Number(received.amount), receivedNotes: Number(received.notes),
    },
    counts: {
      quests: quests.length,
      roles: roles.length,
      proposals: contributions.filter((c) => c.kind === "proposal").length,
    },
    top: topContributions(contributions),
    badges: badges.map((b) => ({ id: String(b.id), name: String(b.name), icon: b.icon ? String(b.icon) : null, kind: String(b.kind), count: Number(b.count ?? 1) })),
    seasons: windows.slice().reverse().map((w) => ({ id: w.id, name: w.name, closed: w.closed })),
  };
}
