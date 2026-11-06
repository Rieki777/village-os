/**
 * GET /api/governance/voice-spread: how Voice is spread across the people who
 * vote, and how the village's votes have gone this season (Rye, 2026-10-31).
 *
 * Mounted under /api/governance, so it answers 404 while the governance module
 * is off. Every figure is a group's: the spread comes from `voiceSpread`
 * (shared/voiceSpread.ts), which withholds any group of fewer than three and
 * names nobody, and the ballot counts carry no title, subject or voter.
 *
 * WHO MAY READ IT. A member, always. A signed-out visitor only while the
 * village shows its people to strangers (`org.public_people`, the R097 lock
 * every people surface reads through `peopleTier`): the spread is a fact about
 * the members, so a village that keeps its people to itself keeps this too.
 *
 * THE ROLL IS THE BALLOT'S ROLL. `electorate` is the server's own
 * `buildElectorate`: present members who may vote, former members gone. So the
 * spread is measured over exactly the people a Voice-weighted vote would ask.
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import { outcomeStatusOf } from "../lib/ballots";
import type { WeightModeSnapshot } from "../lib/governanceWeights";
import { memberAccount } from "../lib/ledger";
import { VILLAGE_VOICE } from "../lib/economy";
import { peopleTier } from "../lib/peopleLock";
import { balancesOf, villageBallotsSince, type BallotCountRow } from "../repos/governanceStats";
import { voiceSpread, type VoiceSpreadView } from "@shared/voiceSpread";

export interface VoiceSpreadDeps {
  authedUser(req: any): Promise<{ id: string } | null | undefined>;
  getPool(): Pool;
  /** The user ids a village-wide ballot opened now would ask. */
  electorate(): Promise<string[]>;
  weightModeNow(): WeightModeSnapshot;
  /** The current season's first day (YYYY-MM-DD), or null with no season running. */
  seasonStartsOn(): string | null;
  /** `governance.quorum_pct`. */
  quorumPct(): number;
  /** `org.public_people`. */
  peopleArePublic(): boolean;
}

/** Counts over village ballots, in the shape the page reads. */
export function ballotCounts(rows: readonly BallotCountRow[], since: string | null): VoiceSpreadView["ballots"] {
  let closed = 0;
  let passed = 0;
  let turnoutSum = 0;
  let turnoutN = 0;
  for (const r of rows) {
    const status = outcomeStatusOf(r);
    if (status === "open") continue;
    closed += 1;
    if (status === "passed") passed += 1;
    const roll = Number(r.electorate_count);
    if (roll > 0) {
      turnoutSum += Math.min(1, Number(r.voters) / roll);
      turnoutN += 1;
    }
  }
  return { since, run: rows.length, closed, passed, turnoutPct: turnoutN ? Math.round((turnoutSum / turnoutN) * 100) : null };
}

export function register(app: Express, deps: VoiceSpreadDeps): void {
  app.get("/api/governance/voice-spread", async (req, res) => {
    const viewer = await deps.authedUser(req);
    if (peopleTier(!!viewer, deps.peopleArePublic()) === "none") {
      return res.status(401).json({ error: "auth_required" });
    }
    const pool = deps.getPool();
    const ids = await deps.electorate();
    const voice = await balancesOf(pool, VILLAGE_VOICE, ids.map(memberAccount));
    const mode = deps.weightModeNow();
    const startsOn = deps.seasonStartsOn();
    // A season's first day is a civil date; its midnight in UTC is close enough for a count.
    const since = startsOn && /^\d{4}-\d{2}-\d{2}$/.test(startsOn) ? startsOn : null;
    const rows = await villageBallotsSince(pool, since ? `${since} 00:00:00` : null);
    const quorum = Number(deps.quorumPct());
    const view: VoiceSpreadView = {
      spread: voiceSpread(ids.map((id) => voice.get(memberAccount(id)) ?? 0)),
      weightedByVoice: mode.mode === "token" && mode.token === VILLAGE_VOICE,
      quorumPct: Number.isFinite(quorum) ? Math.round(quorum) : 0,
      ballots: ballotCounts(rows, since),
    };
    res.json(view);
  });
}
