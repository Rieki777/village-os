/**
 * The season retrospective (Phase 3): the gap between what a pattern SAID the
 * village needed and what it actually used.
 *
 * This is the part of the season system worth building carefully, because it
 * is the only part that makes a pattern better than the day somebody wrote
 * it. A pattern that has run three times should be truer than any first
 * draft, and the only way that happens is if the close of each season hands
 * back evidence rather than a feeling.
 *
 * Same instinct as the concierge's unmatched-query log, which is reused here:
 * the system notices where reality and the written structure disagree, and
 * turns that into one action.
 *
 * Every read below answers a question a village would otherwise argue about,
 * and every one carries the ACTION it implies. A retrospective that only
 * describes is a report; one that offers the edit is a tool.
 *
 * Two rules this module holds to:
 *
 *  - Nothing here writes. It reads and proposes; a human accepts.
 *  - No composite score. Villages optimise whatever number is displayed, and
 *    a single "season health" figure would go green while the founder held
 *    everything. Each read stands on its own with its own honest null.
 */
import type { Pool } from "mysql2/promise";
import { listMembers, type PatternKind } from "./seasonPatterns";

export type ActionKind =
  | "drop_from_pattern"
  | "recruit"
  | "grow_into_circle"
  | "add_seat"
  | "chase_settlement"
  | "lower_threshold"
  | "mark_dormant"
  | "support_holder";

export interface Observation {
  /** Stable key so the UI can offer the same action twice without guessing. */
  id: string;
  kind: PatternKind | "gap";
  entityId: string | null;
  name: string;
  /** What was observed, in plain language. */
  reading: string;
  /** Why it matters, so a village can disagree with the inference. */
  meaning: string;
  action: ActionKind;
  /** Supporting numbers, never rolled into a score. */
  evidence: Record<string, number | string>;
}

export interface Retrospective {
  patternId: string | null;
  seasonId: string | null;
  /** Honest nulls: a season with almost no activity says so. */
  tooQuietToRead: boolean;
  observations: Observation[];
  totals: Record<string, number>;
}

function obs(o: Observation): Observation {
  return o;
}

/**
 * Read a season that has run.
 *
 * `since` bounds the window. A season with no start date reads everything,
 * which is right for a founding season that has been running since the
 * beginning.
 */
export async function buildRetrospective(
  pool: Pool,
  opts: { patternId: string | null; seasonId: string | null; since: Date | null },
): Promise<Retrospective> {
  const observations: Observation[] = [];
  const since = opts.since;
  const sinceClause = since ? " AND at >= ?" : "";
  const sinceArgs = since ? [since] : [];

  const members = await listMembers(pool, opts.patternId ?? undefined);
  const inPattern = (kind: PatternKind) =>
    new Set(members.filter((m) => m.kind === kind).map((m) => m.entityId));

  // How much happened at all. A season nobody used cannot be read for
  // anything except that nobody used it, and saying so beats inventing
  // signal from four events.
  const [evRows]: any = await pool.query(
    `SELECT COUNT(*) n, COUNT(DISTINCT actor_user_id) actors FROM health_events
      WHERE is_example = 0${sinceClause}`,
    sinceArgs,
  );
  const eventCount = Number(evRows[0]?.n ?? 0);
  const actorCount = Number(evRows[0]?.actors ?? 0);
  const tooQuietToRead = eventCount < 20;

  // ── Seats ────────────────────────────────────────────────────────────────
  const [seats]: any = await pool.query(
    `SELECT r.id, r.name, r.seats, r.accountabilities, r.criticality,
            -- AGENTS DO NOT COUNT IN EITHER OF THESE (0142). Every other
            -- site in this audit merely reads wrong; this one does visible
            -- harm. A held seat with no events against its
            -- holder produces the observation "Held all season, with nothing
            -- recorded against whoever held it", whose stated meaning is that
            -- the holder may have needed support nobody offered. Events carry
            -- an actor user id and an agent has none, so an agent seat would
            -- trip that branch EVERY season and hand the village a suggestion
            -- to go and support a piece of software.
            --
            -- everHeld gets the same filter for the same reason one branch up:
            -- "Declared for this season and never held by anyone" is a true
            -- and useful thing to say about a seat an agent is sitting in, and
            -- counting the agent would have suppressed it.
            (SELECT COUNT(*) FROM org_role_assignments a
              WHERE a.org_role_id = r.id AND a.ended_at IS NULL AND a.is_agent = 0) AS held,
            (SELECT COUNT(*) FROM org_role_assignments a2
              WHERE a2.org_role_id = r.id AND a2.is_agent = 0) AS everHeld
       FROM org_roles r
      WHERE r.active = 1 AND r.is_example = 0`,
  );
  const seatIds = inPattern("org_role");

  // Events attributed to each seat's holders, which is the closest honest
  // proxy for "did this seat do anything".
  const [byActor]: any = await pool.query(
    `SELECT actor_user_id AS uid, COUNT(*) n FROM health_events
      WHERE is_example = 0 AND actor_user_id IS NOT NULL${sinceClause}
      GROUP BY actor_user_id`,
    sinceArgs,
  );
  const eventsByUser = new Map<string, number>((byActor as any[]).map((r) => [r.uid, Number(r.n)]));

  const [holders]: any = await pool.query(
    "SELECT org_role_id, user_id FROM org_role_assignments WHERE ended_at IS NULL AND user_id IS NOT NULL",
  );
  const usersBySeat = new Map<string, string[]>();
  for (const h of holders as any[]) {
    usersBySeat.set(h.org_role_id, [...(usersBySeat.get(h.org_role_id) ?? []), h.user_id]);
  }

  for (const s of seats as any[]) {
    const held = Number(s.held);
    const declared = seatIds.has(s.id);
    const seatEvents = (usersBySeat.get(s.id) ?? []).reduce((n, u) => n + (eventsByUser.get(u) ?? 0), 0);
    const accountabilities = Array.isArray(s.accountabilities)
      ? s.accountabilities.length
      : (() => { try { return JSON.parse(s.accountabilities || "[]").length; } catch { return 0; } })();

    if (declared && held === 0 && Number(s.everHeld) === 0) {
      observations.push(obs({
        id: `seat-never-filled:${s.id}`,
        kind: "org_role", entityId: s.id, name: s.name,
        reading: "Declared for this season and never held by anyone.",
        meaning: "Either the village does not need this role, or nobody was ever asked. Both are worth deciding on purpose.",
        action: "drop_from_pattern",
        evidence: { seats: Number(s.seats), everHeld: 0 },
      }));
    } else if (held > 0 && seatEvents === 0 && !tooQuietToRead) {
      observations.push(obs({
        id: `seat-silent:${s.id}`,
        kind: "org_role", entityId: s.id, name: s.name,
        reading: "Held all season, with nothing recorded against whoever held it.",
        meaning: "The role may be ceremonial, or the holder may have needed support nobody offered. It is not evidence of laziness.",
        action: "support_holder",
        evidence: { holders: held, events: 0 },
      }));
    }

    // The fractal signal, from the one thing that IS a property of the seat.
    //
    // There is deliberately no per-seat share of activity here. Events carry
    // an actor and not a SEAT, so a person holding three seats would make all
    // three look equally overloaded, and the number would be an artefact of
    // how many seats they hold rather than a fact about any of them. Person
    // concentration is read once, below, where it is honest. Attributing
    // events to seats needs events tagged with the seat they were done under,
    // which is a real change and not a calculation.
    if (accountabilities >= 6) {
      observations.push(obs({
        id: `seat-broad:${s.id}`,
        kind: "org_role", entityId: s.id, name: s.name,
        reading: `Carries ${accountabilities} accountabilities.`,
        meaning: "A role answerable for this many separate things cannot be held well by one person, and cannot be handed over cleanly either.",
        action: "grow_into_circle",
        evidence: { accountabilities },
      }));
    }

    // The bus factor, on the seats the village itself marked critical.
    //
    // This is invisible to every other read here. A seat with one holder who
    // was active all season passes the silent check, passes the never-filled
    // check, and passes the vacancy read on the map, because on paper it is
    // simply working. What it has is no second holder, and the season it
    // stops working is the season that person is ill.
    //
    // Only critical seats, deliberately. In a small village nearly every seat
    // has one holder, and firing on all of them would produce a wall of
    // observations that says "you are small" and buries the one that matters.
    if (held === 1 && s.criticality === "high") {
      observations.push(obs({
        id: `seat-sole-critical:${s.id}`,
        kind: "org_role", entityId: s.id, name: s.name,
        reading: "Marked critical, and one person is the only holder.",
        meaning: "Nothing is wrong with the role or the holder. It has no second pair of hands, so it stops when they do, and a second holder is cheaper to find now than in the week it stops.",
        action: "recruit",
        evidence: { holders: 1, criticality: "high" },
      }));
    }
  }

  // ── Who carried the season ───────────────────────────────────────────────
  //
  // Read once, per PERSON, because that is the level the data supports and
  // the level the risk lives at. A village where one person produced most of
  // what happened is one illness away from stopping, and the seats they hold
  // are the ones to grow into circles first.
  //
  // Named without judgement on purpose: carrying the village is not a fault,
  // it is a load, and the action is to spread it rather than to correct them.
  if (!tooQuietToRead) {
    const seatsByUser = new Map<string, string[]>();
    for (const [seatId, users] of Array.from(usersBySeat.entries())) {
      for (const u of users) seatsByUser.set(u, [...(seatsByUser.get(u) ?? []), seatId]);
    }
    const seatName = new Map((seats as any[]).map((s) => [s.id, s.name as string]));
    for (const [uid, n] of Array.from(eventsByUser.entries())) {
      const share = eventCount > 0 ? n / eventCount : 0;
      if (share < 0.4) continue;
      const held = seatsByUser.get(uid) ?? [];
      const [who]: any = await pool.query("SELECT name FROM users WHERE id = ?", [uid]);
      observations.push(obs({
        id: `person-carrying:${uid}`,
        kind: "gap", entityId: uid, name: who[0]?.name ?? "A member",
        reading: `Produced ${Math.round(share * 100)}% of everything recorded this season, across ${held.length} role(s).`,
        meaning: "One person carrying most of the village is the failure that ends projects, and the roles they hold are the ones to grow into circles first.",
        action: "grow_into_circle",
        evidence: {
          share: Math.round(share * 100),
          events: n,
          seats: held.map((s) => seatName.get(s) ?? s).join(", "),
        },
      }));
    }
  }

  // ── Quests ───────────────────────────────────────────────────────────────
  const questIds = inPattern("quest");
  if (questIds.size) {
    const [quests]: any = await pool.query(
      `SELECT q.id, q.title,
              (SELECT COUNT(*) FROM quest_claims c WHERE c.quest_id = q.id) AS claims,
              (SELECT COUNT(*) FROM quest_claims c2 WHERE c2.quest_id = q.id AND c2.status = 'consented') AS consented,
              (SELECT COUNT(*) FROM quest_claims c3 WHERE c3.quest_id = q.id AND c3.status IN ('claimed','submitted')) AS inFlight,
              (SELECT COUNT(*) FROM quest_claims c4 WHERE c4.quest_id = q.id AND c4.confidence IN ('at_risk','stuck')) AS flagged
         FROM quests q WHERE q.is_example = 0`,
    );
    for (const q of quests as any[]) {
      if (!questIds.has(q.id)) continue;
      if (Number(q.claims) === 0 && !tooQuietToRead) {
        observations.push(obs({
          id: `quest-unclaimed:${q.id}`,
          kind: "quest", entityId: q.id, name: q.title,
          reading: "On the board all season and never claimed.",
          meaning: "Nobody wanted it, or nobody could see themselves doing it. A board of unclaimed quests teaches members the board is decoration.",
          action: "drop_from_pattern",
          evidence: { claims: 0 },
        }));
      } else if (Number(q.inFlight) > 0) {
        // 0053: somebody SAID it was going badly, which is a different
        // reading from a claim that merely sat there. Reported first, because
        // an asked-for hand is the one thing here that was never a guess.
        const flagged = Number(q.flagged);
        observations.push(obs({
          id: `quest-unsettled:${q.id}`,
          kind: "quest", entityId: q.id, name: q.title,
          reading: flagged > 0
            ? `${q.inFlight} claim(s) still waiting, and ${flagged} of them were flagged as at risk or stuck.`
            : `${q.inFlight} claim(s) still waiting on a decision.`,
          meaning: flagged > 0
            ? "Somebody said out loud that this was going badly and the season ended anyway. Whatever else changes, that signal reached nobody in time."
            : "Somebody did the work and is waiting. This is a settlement problem, and dropping the quest would strand them.",
          action: flagged > 0 ? "support_holder" : "chase_settlement",
          evidence: { inFlight: Number(q.inFlight), consented: Number(q.consented), flagged },
        }));
      }
    }
  }

  // ── Badges ───────────────────────────────────────────────────────────────
  const badgeIds = inPattern("badge");
  if (badgeIds.size) {
    const [badges]: any = await pool.query(
      `SELECT b.id, b.name, b.kind,
              (SELECT COUNT(*) FROM badge_awards a WHERE a.badge_id = b.id AND a.is_example = 0) AS awards
         FROM badges b WHERE b.is_example = 0 AND b.active = 1`,
    );
    for (const b of badges as any[]) {
      if (!badgeIds.has(b.id)) continue;
      if (Number(b.awards) === 0 && !tooQuietToRead) {
        observations.push(obs({
          id: `badge-unearned:${b.id}`,
          kind: "badge", entityId: b.id, name: b.name,
          reading: "Awardable all season and nobody got it.",
          meaning: b.kind === "earned"
            ? "Either the threshold is out of reach or the metric does not measure what the village thought."
            : "Nobody thought to give it. A standing nobody confers is not a standing.",
          action: "lower_threshold",
          evidence: { awards: 0 },
        }));
      }
    }
  }

  // ── Circles ──────────────────────────────────────────────────────────────
  const circleIds = inPattern("circle");
  if (circleIds.size) {
    const [circles]: any = await pool.query(
      `SELECT c.id, c.name, c.status,
              (SELECT COUNT(*) FROM org_roles r WHERE r.circle_id = c.id AND r.active = 1) AS seats
         FROM circles c WHERE c.is_example = 0`,
    );
    for (const c of circles as any[]) {
      if (!circleIds.has(c.id) || c.status !== "active") continue;
      if (Number(c.seats) === 0) {
        observations.push(obs({
          id: `circle-empty:${c.id}`,
          kind: "circle", entityId: c.id, name: c.name,
          reading: "Ran all season with no roles in it.",
          meaning: "A circle with nobody accountable for anything is a heading. Members read it as structure that exists, which makes the whole chart harder to trust.",
          action: "mark_dormant",
          evidence: { seats: 0 },
        }));
      }
    }
  }

  // ── The missing seat ─────────────────────────────────────────────────────
  //
  // The most valuable read here, and the only one that finds something the
  // village never wrote down. Questions the concierge could not answer are
  // work somebody wanted done that no seat covers.
  const [unmatched]: any = await pool.query(
    `SELECT query, COUNT(*) n FROM concierge_queries
      WHERE matched_kind = 'none'${since ? " AND created_at >= ?" : ""}
      GROUP BY query ORDER BY n DESC, query LIMIT 10`,
    since ? [since] : [],
  );
  for (const u of unmatched as any[]) {
    observations.push(obs({
      id: `gap:${String(u.query).slice(0, 40)}`,
      kind: "gap", entityId: null, name: String(u.query),
      reading: `Asked ${u.n} time(s) this season, and nothing on the map answered it.`,
      meaning: "This is work somebody wanted to do and could not find a way into. It is the clearest evidence a village ever gets that a role is missing.",
      action: "add_seat",
      evidence: { asked: Number(u.n) },
    }));
  }

  return {
    patternId: opts.patternId,
    seasonId: opts.seasonId,
    tooQuietToRead,
    observations,
    totals: {
      events: eventCount,
      actors: actorCount,
      seatsRead: (seats as any[]).length,
      observations: observations.length,
    },
  };
}

/**
 * The pattern the retrospective suggests for next time: this season's
 * membership minus what nobody used, plus nothing.
 *
 * Deliberately only ever REMOVES. Adding a seat for a gap is a decision about
 * what the village will take on, which is not a thing a report should make on
 * anyone's behalf; those arrive as actions a human accepts one at a time.
 */
export function proposeNextPattern(
  retro: Retrospective,
  current: Array<{ kind: PatternKind; entityId: string }>,
): { keep: Array<{ kind: PatternKind; entityId: string }>; drop: Array<{ kind: PatternKind; entityId: string; why: string }> } {
  if (retro.tooQuietToRead) return { keep: current, drop: [] };
  const dropIds = new Map<string, string>();
  for (const o of retro.observations) {
    if (o.action === "drop_from_pattern" && o.entityId) {
      dropIds.set(`${o.kind}:${o.entityId}`, o.reading);
    }
  }
  const keep: Array<{ kind: PatternKind; entityId: string }> = [];
  const drop: Array<{ kind: PatternKind; entityId: string; why: string }> = [];
  for (const m of current) {
    const why = dropIds.get(`${m.kind}:${m.entityId}`);
    if (why) drop.push({ ...m, why });
    else keep.push(m);
  }
  return { keep, drop };
}
