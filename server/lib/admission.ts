/**
 * NOBODY STANDS ABOVE A DOOR THEY WERE NEVER LET THROUGH.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 *
 * `computeStage` awards the highest rung whose rule is met, and it read each
 * rung's rule on its own. Member's rule is being admitted. Contributor's is
 * having been paid by the village and Quest Seeker's is a count of consented
 * quests, and neither of those asked whether the person had been admitted.
 * So a guest the village paid once stood at Contributor. That is above Member,
 * where `ballot.vote` opens, so they were on every roll built afterwards, and
 * it is exactly where `member.vouch` opens. Three such guests could vouch a
 * fourth person in, and not one of the four had ever been let in.
 * `POST /api/members/:id/contributor` cut the same door a second way, by
 * naming somebody a contributor without asking whether they were a member.
 *
 * ── THE RULE NOW ────────────────────────────────────────────────────────────
 *
 * A rung above Member is reached only by somebody the village admitted. Every
 * rung below it reads exactly as it did, and so does every stage grant.
 *
 * ADMITTED is one of two records, and each is an act somebody performed on the
 * village's behalf:
 *   - `membershipGranted`: the vouches were met, a steward vouched them in, a
 *     signed Love Letter was accepted, or the 0058 freeze wrote it;
 *   - a stage grant at Member or above: an admin placed them there by hand.
 *
 * ── AND THE DEPLOY THAT ADDS THE DOOR DEMOTES NOBODY ────────────────────────
 *
 * On the ladder this replaced, Contributor was one consented quest, and a guest
 * may claim a quest. So there are people standing above Member with no
 * admission on record, holding a vote the village's consent to their work gave
 * them. Taking it back on the morning the door deploys would be a worse harm
 * than the hole, which is what `freezeEmailMatchedMemberships` said about the
 * last one, so `freezeStandingAboveTheDoor` writes that standing down as an
 * admission, once, before the rule applies.
 *
 * It keeps only the standing that ladder really gave. Pay became a rung on
 * Rye's ruling of 2026-09-08, in the same release as the door, so a guest who
 * was paid and never had a quest consented stood below Member on the old
 * ladder. Admitting them here would be the hole, written down as a decision.
 */
import type { GameStage } from "../../shared/gameConfig";

/** The rung whose rule is being admitted. Every rung above it is behind the door. */
export const ADMISSION_RUNG = "member";

/** One rung, as far as this file reads it. */
export type LadderStage = Pick<GameStage, "id" | "rule">;

/** The two fields that record an admission, as the member record carries them. */
export interface AdmissionRecord {
  membershipGranted?: unknown;
  stageGranted?: unknown;
}

/** Where a stage id sits on this ladder, or -1 for no id and for one it does not contain. */
function rungOf(stages: readonly LadderStage[], id: unknown): number {
  const key = String(id ?? "");
  return key ? stages.findIndex((s) => s.id === key) : -1;
}

/**
 * Whether the village has let this person in.
 *
 * A ladder with no admission rung has no door, so nobody is kept out by one.
 * The platform ladder always has it. A fork that removes it keeps a ladder
 * people can climb, instead of one that quietly stops at the bottom.
 */
export function isAdmitted(user: AdmissionRecord, stages: readonly LadderStage[]): boolean {
  if (user.membershipGranted) return true;
  const door = rungOf(stages, ADMISSION_RUNG);
  return door < 0 || rungOf(stages, user.stageGranted) >= door;
}

/**
 * The highest rung this person stands on.
 *
 * `ruleMet` answers each rung's OWN rule, from whatever counts the host holds.
 * Everything that is not a rung's own rule is answered here, once, so no second
 * caller can re-derive it slightly differently: a granted rung, the door, and
 * the grant as a floor. `ruleMet` is never asked about a granted rung.
 */
export function climbLadder(
  stages: readonly LadderStage[],
  user: AdmissionRecord,
  ruleMet: (stage: LadderStage) => boolean,
): string {
  if (stages.length === 0) return "";
  const door = rungOf(stages, ADMISSION_RUNG);
  const admitted = isAdmitted(user, stages);
  const granted = rungOf(stages, user.stageGranted);
  let earned = 0;
  stages.forEach((stage, idx) => {
    // The door. `isAdmitted` is true on a ladder without one, so this never
    // holds anybody back there.
    if (!admitted && idx > door) return;
    const ok = stage.rule.type === "granted" ? granted >= idx : ruleMet(stage);
    if (ok && idx > earned) earned = idx;
  });
  // A grant is a floor: it raises the answer and never lowers it. A grant at
  // Member or above is itself an admission, so it is never behind the door.
  return stages[Math.max(earned, granted)].id;
}

/**
 * How many consented quests carried somebody past Member on the ladder the door
 * replaced: Contributor's bar, or Quest Seeker's where a village set that lower.
 *
 * Contributor's bar is read from what the village STORED, because its variable
 * left the registry when the rung stopped counting quests, and `numberVar`
 * refuses a key the registry does not know. A village that never tuned it ran
 * the platform's one, and a stored value that does not read as a whole number
 * of at least one is treated the same way.
 */
export function questsThatCarriedPastTheDoor(storedContributorBar: string | undefined, questSeekerBar: number): number {
  const stored = Math.trunc(Number(storedContributorBar ?? ""));
  const contributor = stored >= 1 ? stored : 1;
  const seeker = Math.trunc(questSeekerBar);
  return seeker >= 1 ? Math.min(contributor, seeker) : contributor;
}

/** What the freeze reads about one person. */
export interface StandingOnRecord extends AdmissionRecord {
  id?: unknown;
  email?: unknown;
  isExample?: unknown;
}

/**
 * Whether the old ladder put this person above Member with no admission on
 * record, so the door would take standing they hold today.
 *
 * An example identity is content and not a person, and a tombstone is somebody
 * who left. A migration admits neither.
 */
export function stoodAboveTheDoor(
  person: StandingOnRecord,
  stages: readonly LadderStage[],
  consentedQuests: number,
  questBar: number,
): boolean {
  if (person.isExample) return false;
  // The address `server/lib/erasure.ts` writes onto a tombstone, and the one
  // the 0058 freeze skipped on too.
  if (String(person.email ?? "").toLowerCase().endsWith("@anonymized.invalid")) return false;
  if (isAdmitted(person, stages)) return false;
  return consentedQuests >= Math.max(1, questBar);
}

/** What the freeze needs from the host, so this file opens no connections. */
export interface FreezeHost {
  stages: readonly LadderStage[];
  everyone: () => Promise<readonly StandingOnRecord[]>;
  /** Consented claims per member id, in one grouped read. */
  consentedCounts: () => Promise<ReadonlyMap<string, number>>;
  /** From `questsThatCarriedPastTheDoor`. */
  questBar: number;
  admit: (userId: string) => Promise<unknown>;
  log: (line: string) => void;
}

/**
 * Write down, as an admission, the standing the door would otherwise take.
 *
 * The host runs this through `runOnce` before the first request is served. A
 * run that fails part way is not recorded and runs again at the next boot, and
 * that is safe: everybody it already admitted reads as admitted and is skipped.
 */
export async function freezeStandingAboveTheDoor(host: FreezeHost): Promise<void> {
  const [people, consented] = await Promise.all([host.everyone(), host.consentedCounts()]);
  let admitted = 0;
  for (const person of people) {
    const id = String(person.id ?? "");
    if (!id || !stoodAboveTheDoor(person, host.stages, consented.get(id) ?? 0, host.questBar)) continue;
    await host.admit(id);
    admitted += 1;
  }
  host.log(`[MIGRATION] standing above Member kept as an admission for ${admitted} member(s)`);
}
