/**
 * THE GOVERNANCE ROWS ON THE LAUNCH CHECKLIST (2026-09-27): three questions a
 * village answers before it is asked to start its Game, all blocking by
 * Rye's ruling (Option B of the canvas plan's Decision 1).
 *
 *   canvas:on-record          every one of the twelve governance canvas blocks
 *                             carries at least one reading. "Not decided yet,
 *                             because..." counts: Absent, and its sentence.
 *   governance:conflict-door  a member with a conflict has somebody to bring it
 *                             to (a live holder of the exit policy's intake
 *                             role, or a named contact outside the village) and
 *                             a promised reply time in hours. Below three
 *                             members who are not founders, only the outside
 *                             contact will do.
 *   governance:on-for-members the governance module is open to members, since
 *                             the launch is a vote and members answer votes
 *                             there. This is the refusal the propose route
 *                             used to give with no row saying so.
 *
 * ── WHY THIS FILE, AND NOT server/index.ts ─────────────────────────────────
 *
 * Every check wired through `LaunchDeps.checks` closes over a boot cache in
 * server/index.ts, and that file is on a ratchet that only turns down. None of
 * these three needs a cache: the canvas and the exit policy are read fresh
 * through their repos, the holders and the member count likewise, and the
 * module lifecycle arrives through `LaunchDeps.moduleLifecycle`, which the
 * launch resolver already carries. So server/lib/launch.ts hands the three
 * keys here, the way it hands `village:` keys to `villageFactFor`.
 *
 * ── PURE CHECKS, ONE IMPURE ADAPTER ────────────────────────────────────────
 *
 * `canvasOnRecordCheck`, `conflictDoorCheck` and `governanceOnCheck` take
 * facts and return a state and one sentence. They are what the unit tests
 * drive through every state. `governanceRowFor` is the only function here
 * that reads the world, and it only gathers the facts.
 *
 * ── NO NUMBER ACROSS BLOCKS (R55) ──────────────────────────────────────────
 *
 * The canvas row names the blocks still without a reading. It never says how
 * many of twelve are read, never averages a level, and never asks for a level
 * above one. The radar on the Canvas view is the one place levels are drawn.
 */
import type { Pool } from "mysql2/promise";
import { CANVAS_BLOCK_IDS, CANVAS_BLOCKS } from "../../shared/governanceCanvas";
import { LIFECYCLE_RANK, type ModuleLifecycle } from "../../shared/modules";
import { allCanvasReadings } from "../repos/canvasReadings";
import { readConfigDocument } from "../repos/appConfigDocs";
import { holdingsForRoles } from "../repos/permissionHoldings";
import { roleCapabilityRow } from "../repos/stewardRoles";
import { admittedNonFounderCount } from "../repos/users";
import { outsideContactNamed, outsideContactOf, replyHoursOf, withPolicyDefaults } from "./exitPolicy";
import { holdingHasLapsed } from "./stewardship";

/** The check keys shared/launchRequirements.ts names, spelled once so the two cannot drift. */
export const CANVAS_ON_RECORD_KEY = "canvas:on-record";
export const CONFLICT_DOOR_KEY = "governance:conflict-door";
export const GOVERNANCE_ON_KEY = "governance:on-for-members";
export const GOVERNANCE_ROW_KEYS = [CANVAS_ON_RECORD_KEY, CONFLICT_DOOR_KEY, GOVERNANCE_ON_KEY] as const;

/**
 * Below this many admitted members who are not founders, a conflict's door
 * must be a named contact OUTSIDE the village. Three, because the routing rule
 * (docs/COORDINATION_SUBSTRATE.md) sends a tension outside when fewer than
 * three candidates remain once the people it is about are excluded.
 */
export const OUTSIDE_CONTACT_BELOW = 3;

/** One row's answer, the shape `LaunchCheckResult` in ./launch takes. */
export interface GovernanceCheck {
  state: "ok" | "missing";
  detail: string;
}

/** "A", "A and B", "A, B and C". */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const ABSENT_COUNTS = "A reading of Absent, with one sentence saying why, counts";

/**
 * Is every canvas block on record?
 *
 * `blocksRead` is the block id of every reading the village holds, in any
 * order and with repeats. A reading at level 1 is a reading like any other.
 */
export function canvasOnRecordCheck(blocksRead: Iterable<string>): GovernanceCheck {
  const read = new Set(blocksRead);
  const unread = CANVAS_BLOCK_IDS.filter((id) => !read.has(id)).map((id) => CANVAS_BLOCKS[id].name);
  if (unread.length === 0) {
    return { state: "ok", detail: "Every block has a reading on record" };
  }
  if (unread.length === CANVAS_BLOCK_IDS.length) {
    return { state: "missing", detail: `No block has a reading yet. ${ABSENT_COUNTS}` };
  }
  return { state: "missing", detail: `Still without a reading: ${nameList(unread)}. ${ABSENT_COUNTS}` };
}

/** Everything the conflict-door row is judged on, with nothing read from the world. */
export interface ConflictDoorFacts {
  /** Whole hours, or null when nobody has promised a reply. */
  replyHours: number | null;
  outsideContact: { name: string; organisation: string; howToReach: string };
  /** The exit policy's intake role id, or "" when none is chosen. */
  intakeRoleId: string;
  /** That role's name, or null when the id no longer names a role. */
  intakeRoleName: string | null;
  /** Holders of the intake role whose term has not run out. */
  liveIntakeHolders: number;
  /** Holders of the intake role whose term has run out. */
  lapsedIntakeHolders: number;
  /** Admitted members who are not founders. */
  nonFounderMembers: number;
}

const hours = (n: number): string => (n === 1 ? "1 hour" : `${n} hours`);

/**
 * Does a conflict have somewhere to go, and a promised reply?
 *
 * The door is a live holder of the intake role OR a named outside contact,
 * and below `OUTSIDE_CONTACT_BELOW` members who are not founders, only the
 * outside contact. The cover role is not counted here, on purpose: the intake
 * reaches the intake role's live holders and nobody else today, so a live
 * cover holder is not yet a person a request would reach.
 *
 * Every missing piece is named in one detail, because a founder fixing one
 * and finding the next only after saving has been told half of it.
 */
export function conflictDoorCheck(f: ConflictDoorFacts): GovernanceCheck {
  const outsideNamed = outsideContactNamed(f.outsideContact);
  const needOutside = f.nonFounderMembers < OUTSIDE_CONTACT_BELOW;
  const roleLabel = f.intakeRoleName ? `the ${f.intakeRoleName} role` : "the intake role";
  const insideDoor = !!f.intakeRoleId && f.intakeRoleName !== null && f.liveIntakeHolders > 0;
  const door = outsideNamed || (!needOutside && insideDoor);

  const problems: string[] = [];
  if (!door) {
    if (needOutside) {
      problems.push(
        "Fewer than three members here are not founders, so a conflict needs a named contact outside the village. Give their name and how to reach them",
      );
    } else if (!f.intakeRoleId) {
      problems.push("No intake role is chosen and no outside contact is named");
    } else if (f.intakeRoleName === null) {
      problems.push("The intake role on the exit policy no longer exists, and no outside contact is named");
    } else {
      problems.push(
        `Nobody holds ${roleLabel} today${f.lapsedIntakeHolders > 0 ? ", because every term in it has run out" : ""}, and no outside contact is named`,
      );
    }
  }
  if (f.replyHours === null) {
    problems.push("No reply time is promised yet. Say within how many hours a member hears back");
  }
  if (problems.length) return { state: "missing", detail: problems.join(". ") };

  const c = outsideContactOf(f.outsideContact);
  const outside = `${c.name}${c.organisation ? ` (${c.organisation})` : ""} is the outside contact`;
  const inside = `T${roleLabel.slice(1)} is held today`;
  const who = outsideNamed && insideDoor ? `${inside}, ${outside}` : outsideNamed ? outside : inside;
  return { state: "ok", detail: `${who}, and a member hears back within ${hours(f.replyHours as number)}` };
}

/** Is the governance module open to members? `lifecycle` is its EFFECTIVE lifecycle. */
export function governanceOnCheck(lifecycle: string): GovernanceCheck {
  const rank = LIFECYCLE_RANK[lifecycle as ModuleLifecycle] ?? 0;
  if (rank >= LIFECYCLE_RANK.members) {
    return {
      state: "ok",
      detail: lifecycle === "public" ? "Governance is open to everyone, members included" : "Governance is open to members",
    };
  }
  return {
    state: "missing",
    detail:
      lifecycle === "preview"
        ? "Governance is open to admins only, so a member sent to the vote would find nothing there"
        : "Governance is off, so there is no vote a member could answer",
  };
}

/**
 * The conflict-door facts, read fresh.
 *
 * The exit policy is read from its stored document through
 * `withPolicyDefaults`, the same reader every route uses, so a policy saved
 * before the three conflict-door fields existed reads with them blank.
 */
export async function conflictDoorFacts(pool: Pool, now: Date = new Date()): Promise<ConflictDoorFacts> {
  const stored = await readConfigDocument(pool, "exit-policy");
  const policy = withPolicyDefaults(stored ?? undefined);
  const r: any = policy.restorative ?? {};
  const intakeRoleId = String(r.intakeContactRole ?? "").trim();
  let intakeRoleName: string | null = null;
  let live = 0;
  let lapsed = 0;
  if (intakeRoleId) {
    const role = await roleCapabilityRow(pool, intakeRoleId);
    intakeRoleName = role ? role.name ?? role.id : null;
    for (const h of await holdingsForRoles(pool, [intakeRoleId])) {
      if (holdingHasLapsed(h, now)) lapsed += 1;
      else live += 1;
    }
  }
  return {
    replyHours: replyHoursOf(r.replyHours),
    outsideContact: outsideContactOf(r.outsideContact),
    intakeRoleId,
    intakeRoleName,
    liveIntakeHolders: live,
    lapsedIntakeHolders: lapsed,
    nonFounderMembers: await admittedNonFounderCount(pool),
  };
}

/**
 * One governance row, by its check key. The launch resolver's `canvas:` and
 * `governance:` branch calls this and nothing else.
 *
 * A key nothing here resolves reads missing, in the same words an unwired
 * check does, so a checklist can never read shorter than the truth.
 */
export async function governanceRowFor(
  pool: Pool,
  deps: { moduleLifecycle: (id: string) => string; now?: () => Date },
  checkKey: string,
): Promise<GovernanceCheck> {
  if (checkKey === CANVAS_ON_RECORD_KEY) {
    return canvasOnRecordCheck((await allCanvasReadings(pool)).map((row) => row.blockId));
  }
  if (checkKey === CONFLICT_DOOR_KEY) {
    return conflictDoorCheck(await conflictDoorFacts(pool, deps.now?.() ?? new Date()));
  }
  if (checkKey === GOVERNANCE_ON_KEY) {
    return governanceOnCheck(deps.moduleLifecycle("governance"));
  }
  return { state: "missing", detail: `No governance resolver for "${checkKey}". This is a platform bug, report it` };
}
