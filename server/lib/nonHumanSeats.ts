/**
 * VOICE FOR OTHER BEINGS, AND WHAT IT DOES TO A QUORUM (19G).
 *
 * ── THE RULING ─────────────────────────────────────────────────────────────
 *
 * 2026-09-03: "yes voice for other beings at day 1", and the earlier sentence
 * it answers: a village is invited to name non-human governance roles, "other
 * beings who live on the land", a mountain, a river, the trees and the fauna
 * and flora that share that piece of earth.
 *
 * A non-human seat is a VOTING seat. Somebody holds it, a member or a bot
 * carrying that being's point of view, and that holder casts its vote.
 *
 * ── THE PROBLEM THIS MODULE EXISTS FOR ─────────────────────────────────────
 *
 * 19F made quorum pure token weight. Put the two rulings together with no
 * third rule and a river holding a share of the Voice sits in every quorum
 * denominator whether or not anybody ever speaks for it. Twenty-five percent
 * of the Voice across four such seats, three of them quiet, puts every
 * constitutional decision and the veto override that rides on the highest set
 * tier permanently out of reach, and none of the warnings fire, because no
 * tier rounds to the whole roll and nobody has left the village.
 *
 * So the village says which way it reads it, through
 * `governance.nonhuman_in_quorum`, and this module answers the two questions
 * the arithmetic in `shared/governanceEngine.ts` needs about each seat: is
 * this seat speaking for a being, and can its weight actually answer.
 *
 * ── WHAT THE FLAG IS, AND WHAT IT READS ────────────────────────────────────
 *
 * The flag is `roles.represents_being`, a column on the permission-group
 * plane, and it is set by the founding step that invites a village to name its
 * beings (the birthing lane owns writing it). A member holding a role with
 * that flag holds a non-human seat: the role IS the being, the holder is its
 * representative, and the representative's seat on the roll is the being's
 * voice.
 *
 * `roles` is the right plane and `org_roles` is not, for the reason
 * `stewardship.ts` gives about the same two planes: `roles` carries holders
 * who are members with capabilities, and a vote needs a member. The
 * `steward.veto` seat is read the same way, off the same table.
 *
 * ── WHY THE COLUMN IS PROBED AND NEVER ASSUMED ─────────────────────────────
 *
 * This lane writes no migration, so the column arrives with the lane that owns
 * the founding step, and this code has to be correct on both sides of that
 * landing. It asks the schema once per call and answers `known: false` when
 * the column is absent, which every caller renders as "the Game cannot tell"
 * and never as "no seat speaks for a being". Those are different facts, and a
 * quorum that treated the second as the first would quietly count weight the
 * village had voted out of its own arithmetic.
 *
 * ── WHERE THE STATEMENTS LIVE ──────────────────────────────────────────────
 *
 * Two tables answer the two questions above, and each has its own module:
 * `server/repos/beingRoles.ts` (the `represents_being` flag, and the schema
 * probe that guards reading it) and `server/repos/beingRepresentatives.ts`
 * (who holds those roles). What stays in this file is the arithmetic and the
 * rulings behind it: that silence is measured in cycles of the active clock
 * and never in ballots, that ONLY non-human seats carry a silence, and that a
 * being nobody holds puts nothing on the roll. None of those is a query, and
 * all of them are what a reviewer has to read together.
 *
 * The one read still spelled out below is `ballot_votes`, and its waiver on
 * the line says why: the ballot plane's statements are gathered in
 * `server/lib/ballots.ts` and moving one of them from here would scatter that
 * plane rather than gather it.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { QuorumPolicy, WeighedSeat } from "../../shared/governanceEngine";
import type { CycleClock } from "../../shared/cycleClock";
import { beingRoleIds, type BeingRoles } from "../repos/beingRoles";
import { holdersOfRoles } from "../repos/beingRepresentatives";

/*
 * Re-exported, not redefined. The column name and the shape of the answer are
 * facts about the statement that reads them, so they live beside it; importers
 * of this file (and its own test) keep the names they already had, and there is
 * no second copy of the string to drift from the WHERE clause.
 */
export { REPRESENTS_BEING_COLUMN } from "../repos/beingRoles";
export type { BeingRoles };

/** How many cycles of silence strand a seat's weight, when nothing is set. */
export const ABSENT_CYCLES_DEFAULT = 3;

/**
 * What the roles plane says about beings right now.
 *
 * `known` false means the flag is not on this database yet. It is the "could
 * not tell" answer and it is deliberately different from an empty `roleIds`,
 * which is "this village has named no beings".
 */
export async function beingRoles(pool: Pool): Promise<BeingRoles> {
  return beingRoleIds(pool);
}

/** One seat on a roll, with everything the quorum arithmetic asks of it. */
export interface SeatFacts extends WeighedSeat {
  userId: string;
  /** Why this seat's weight cannot answer, when it cannot. */
  silence: "no_representative" | "silent" | null;
}

export interface SeatFactsInput {
  /** The roll, already weighed by the caller. */
  roll: readonly { userId: string; weight: number }[];
  /** `governance.absent_cycles`. */
  absentCycles?: number;
  /** The active clock, for turning cycles of silence into an instant. */
  clock: CycleClock;
  /** The instant to read silence against. */
  at?: Date;
}

/**
 * The roll, with each seat told apart.
 *
 * SILENCE IS MEASURED IN CYCLES OF THE ACTIVE CLOCK, never in ballots. A
 * village that opened one ballot in six moons has not made anybody silent, and
 * counting ballots would say it had.
 *
 * A seat that has never voted at all reads as silent once the window has
 * passed, which is the honest reading: the question is whether this weight
 * answers, and weight that has never answered does not.
 *
 * ONLY NON-HUMAN SEATS CARRY A SILENCE. A member who stops playing is the case
 * the founder answered himself, with the above-97 warning and the stalemate
 * re-run, and dropping a quiet member's weight out of the quorum would be this
 * platform deciding who counts. A seat for a being is different because
 * nobody's own voice is being taken: the seat exists so a river can be heard,
 * and a river nobody speaks for is not heard whatever the arithmetic says.
 */
export async function seatFacts(pool: Pool, input: SeatFactsInput): Promise<{ known: boolean; seats: SeatFacts[] }> {
  const roll = input.roll.filter((s) => String(s.userId ?? "").trim() !== "");
  const beings = await beingRoles(pool);
  const plain = (): { known: boolean; seats: SeatFacts[] } => ({
    known: beings.known,
    seats: roll.map((s) => ({ userId: s.userId, weight: s.weight, silence: null })),
  });
  if (!beings.known || beings.roleIds.length === 0 || roll.length === 0) return plain();

  const representatives = new Set(await holdersOfRoles(pool, beings.roleIds));
  if (representatives.size === 0) return plain();

  const cycles = Math.max(1, Math.trunc(Number(input.absentCycles) || ABSENT_CYCLES_DEFAULT));
  const at = input.at ?? new Date();
  const since = input.clock.startOf(input.clock.cycleNumberAt(at) - (cycles - 1));
  const onTheRoll = roll.filter((s) => representatives.has(String(s.userId))).map((s) => String(s.userId));
  const spoken = new Set<string>();
  if (onTheRoll.length > 0) {
    const [voted] = await pool.query<RowDataPacket[]>( // module-review-ok: the ballot tables' one enumerable home, the pattern ballots.ts already holds
      `SELECT DISTINCT user_id FROM ballot_votes WHERE cast_at >= ? AND user_id IN (${onTheRoll.map(() => "?").join(",")})`,
      [since, ...onTheRoll],
    );
    for (const r of voted) spoken.add(String(r.user_id));
  }
  return {
    known: true,
    seats: roll.map((s) => {
      const isBeing = representatives.has(String(s.userId));
      if (!isBeing) return { userId: s.userId, weight: s.weight, silence: null };
      const silent = !spoken.has(String(s.userId));
      return {
        userId: s.userId,
        weight: s.weight,
        nonHuman: true,
        canVote: !silent,
        silence: silent ? "silent" : null,
      };
    }),
  };
}

/*
 * A BEING NOBODY HOLDS PUTS NOTHING ON THE ROLL. 19G's "a representative seat
 * vacant" case needs no code of its own here: the roll is built from members,
 * and a flagged role with no holder contributes no member and therefore no
 * weight. The denominator is already right. What such a village should see is
 * the invitation left unanswered, and that belongs on the seat surfaces rather
 * than inside the quorum arithmetic.
 */

/** Read the village's setting into the shape the arithmetic takes. */
export function quorumPolicyFrom(read: (key: string) => unknown): QuorumPolicy {
  const raw = String(read("governance.nonhuman_in_quorum") ?? "").trim().toLowerCase();
  return { nonHumanInQuorum: raw === "true" || raw === "1" || raw === "yes" };
}
