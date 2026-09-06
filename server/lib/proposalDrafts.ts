/**
 * Proposal drafts: the wizard's unfinished work, held by the server.
 *
 * The Hypha harvest (section 1) flagged one upgrade over the wizard it was
 * otherwise copying wholesale: their drafts live in the browser's
 * localStorage, keyed by title and timestamp, and a member who writes half a
 * role application on a phone loses it to a cleared cache. A draft is work.
 * Work belongs on the server.
 *
 * The rules this file holds:
 *
 *  - A DRAFT IS NOT A PROPOSAL. It has no supports, no ballot, no standing
 *    and no reader but its author. Nothing here writes to any governance
 *    table; publishing is a separate act through the subject's own route,
 *    which is what keeps "I was typing" and "the village is deciding" from
 *    ever being the same row.
 *  - PRIVATE TO THE AUTHOR. Every read and every write is scoped by user_id
 *    in the SQL itself, never by a check the caller could forget. A draft
 *    fetched by the wrong member is not a 403 with a body; it is a miss.
 *  - CAPPED. Drafts cost nothing to make and a wizard that autosaves is a
 *    machine for making them, so a member holds at most DRAFT_CAP. The cap
 *    refuses the NEW draft and says which ones to finish or discard; it never
 *    silently evicts the oldest, because the oldest is the one somebody has
 *    been meaning to come back to.
 *  - THE STEP TRAVELS WITH IT. `step_index` is what makes Continue land where
 *    the author stopped instead of at the type cards, and it is stored rather
 *    than derived because the wizard's skip-walk means "how far they got" is
 *    not a function of which fields are filled.
 *
 * The pure half (`draftProblem`, `WIZARD_TYPES`) is exported for the client's
 * config-drift test: the wizard's type list and this validator's type list are
 * the same list in two files, and a test proves they stay that way.
 */
import { randomUUID } from "crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * The proposal types a wizard draft may belong to (GOV_DESIGN section 4).
 *
 * This is the SERVER's copy. The client's declarative wizard config
 * (client/src/components/governance/wizardConfig.ts) holds the same ids with
 * their steps, fields and copy, and `wizardConfig.test.ts` fails if the two
 * lists ever drift. Two files rather than one because the config carries React
 * components and this module must not import any.
 */
export const WIZARD_TYPES = [
  "role_application",
  "mechanics",
  "agreement",
  "badge_grant",
  "quest_payout",
  "power_transfer",
  "power_grant",
  "power_return",
] as const;
export type WizardType = (typeof WIZARD_TYPES)[number];

/**
 * The types this deployment can actually take to a vote today.
 *
 * A wizard that walks a member through five steps and then discovers there is
 * nowhere to publish is worse than one that says so on the first screen, so
 * the type step reads this list and the review step refuses what is not in it.
 * The executors land lane by lane (GOV_DESIGN section 8): agreements with G3,
 * role applications and quest payouts with G4, badge grants with G5. Each lane
 * adds its own id here in the same commit that mounts its route, and nothing
 * else in the wizard changes.
 */
export const CONDUCTABLE_TYPES: readonly WizardType[] = [
  "mechanics",
  "power_transfer",
  "power_grant",
  "power_return",
];

/**
 * WHICH CAPABILITY KEYS A PROPOSAL TYPE MAY NOT NAME, AND WHY.
 *
 * The badge review asked that `badge_grant` refuse `ballot.vote` and
 * `member.vouch`. Its stated reason was that "an electorate that can vote to
 * hand ballot.vote to chosen people is an electorate that can vote to enlarge
 * itself, one ballot at a time." R54 makes that reason wrong while leaving
 * the conclusion right, so the reason is restated here rather than inherited:
 *
 *   ENLARGEMENT IS THE DESTINATION. "These villages are meant to be taken
 *   over by the electorate to run the game and put the admins out of a full
 *   time job." A village voting to widen its own roll is the thing this
 *   platform is for, and a refusal built to prevent it would be the
 *   scaffolding defending itself.
 *
 *   CAPTURE IS THE RISK, and it is a different shape. A badge grant names
 *   PEOPLE. Three named individuals handed the vote by one ballot is a small
 *   group choosing who else gets a say, which is capture wearing the
 *   village's clothes. A power transfer names a POWER, and the whole
 *   electorate votes on where it lives.
 *
 * So the refusal sits on the type that names people, and the type that names
 * a power carries no capability refusal at all. That distinction is the whole
 * design: it answers the review's real safety concern and leaves R54's
 * destination reachable.
 *
 * A type absent from this map refuses nothing, which is today's behaviour for
 * every type that names no capability at all.
 *
 * WHAT THIS DOES NOT DO, said here rather than discovered later:
 * `POST /api/governance/badge-grants` has not been built (the wizard type is
 * advisory-only until it is, because `CONDUCTABLE_TYPES` does not name it).
 * This map is what that route reads on the day it lands, and the transfer
 * route reads it today. It is a contract with one live reader, not two.
 */
export const TYPE_CAPABILITY_REFUSALS: Partial<
  Record<WizardType, { readonly keys: readonly string[]; readonly why: string }>
> = {
  badge_grant: {
    /*
     * `steward.veto` joined the two electorate keys on 2026-09-03, for the
     * reason this map already gives. A badge names PEOPLE, and the seat that
     * can stop a decision the village carried is seated by the village at a
     * `role_seat` ballot and taken back at a `role_unseat` one. Handing it to
     * three named individuals through a badge would put the seat outside the
     * only two doors that are supposed to move it, which is the same hole the
     * admin routes were closed against in `server/lib/roleGrants.ts`.
     */
    keys: ["ballot.vote", "member.vouch", "steward.veto"],
    why:
      "A badge names people, so handing this one to named individuals would be a few members " +
      "choosing who else gets a say. The village can still take this power on: that is a power " +
      "transfer, where the power is named and the whole electorate votes on where it lives. " +
      "The steward's seat moves only at a seating vote, which is the same rule from the other side.",
  },
  power_transfer: {
    keys: [],
    why: "",
  },
  /*
   * THE RUNWAY REFUSES THE TWO KEYS THAT MAKE AN ELECTORATE.
   *
   * `power_grant` is the village voting to give a role a power it does not
   * carry yet. It sits one step before `power_transfer` on purpose, and that
   * position is exactly why it needs a refusal the transfer does not.
   *
   * A transfer names a POWER and moves it to a role that already carries it,
   * so the electorate that votes is the electorate that lives with it. A
   * grant WRITES a role's capability list, and a role is a set of PEOPLE
   * through its seats. Granting `ballot.vote` to a role and then seating
   * three people in it is the badge-grant capture path with one extra step:
   * a small group choosing who else gets a say.
   *
   * R54 IS NOT BEING FENCED OFF HERE, and the difference matters. A village
   * widening its own roll is the destination, and the way there is the roll's
   * own dials: `progression.unlock.ballot.vote` is a mechanic, so a
   * `mechanics` ballot moves the rung that decides who votes, and the whole
   * electorate decides it in one act about a rule. What is refused is the
   * other route to the same place, the one that goes through naming a
   * container of people.
   *
   * TRANSFERABLE already excludes both of these keys today, so this map
   * currently refuses what nothing could reach. It is written anyway, and
   * that is the whole point of it: the day a lane converts the vote route to
   * `mayAct` and flips `ballot.vote` to transferable, the runway would widen
   * to include it silently, in a commit about something else. This is the
   * line that does not move when that one does.
   */
  power_grant: {
    keys: ["ballot.vote", "member.vouch"],
    why:
      "A role is a set of people, so voting this one onto a role and then seating people in it " +
      "would be a few members choosing who else gets a say. Who votes here is a rule of the game, " +
      "and the village changes it the way it changes any rule: open a rule change on the rung that " +
      "decides who is on the roll, and the whole roll decides it.",
  },
  /*
   * Giving a power back refuses nothing, and there is nothing to refuse: the
   * only capability a return ballot can name is one this village is already
   * holding, and every one of those passed `TRANSFERABLE` on the way in.
   */
  power_return: {
    keys: [],
    why: "",
  },
};

/**
 * A sentence saying why this type may not name this capability, or null.
 *
 * The sentence comes out of the map beside the keys, so a type added to the
 * map tomorrow cannot inherit an argument written about badges.
 */
export function typeRefusesCapability(type: string, capability: string): string | null {
  const entry = TYPE_CAPABILITY_REFUSALS[type as WizardType];
  if (!entry || !entry.keys.includes(capability)) return null;
  return entry.why;
}

/**
 * The types a village can put to a NON-BINDING vote today.
 *
 * Every type outside `CONDUCTABLE_TYPES` is here, and that is the whole list:
 * the ones the executors have not reached yet. A village that cannot yet MAKE
 * a role appointment by ballot can still ask its members what they would
 * decide about one, hold the vote on the real engine with the real frozen
 * electorate and the real weights, and read the real answer. The decision
 * closes, records its outcome, tells the roll, and does nothing else, because
 * a subject type with no executor executes nothing (the close route's subject
 * table is the one home for that fact).
 *
 * It is a ladder and never a scorecard. A village holding one binding power is
 * a village at the beginning of something, and the practice vote is how it
 * finds out what it already agrees about before it takes the next one.
 */
export const ADVISORY_TYPES: readonly WizardType[] = WIZARD_TYPES.filter(
  (t) => !CONDUCTABLE_TYPES.includes(t),
);

/**
 * How many unfinished proposals one member may hold.
 *
 * Five is the number of proposal types: a member may have one of each in
 * flight and still be doing something reasonable. A sixth is a wizard that
 * autosaved a stray click, and the cap is where that shows up.
 */
export const DRAFT_CAP = 5;

/** A payload bigger than this is not a draft, it is a document. */
const MAX_PAYLOAD_BYTES = 64_000;

export interface ProposalDraftRow {
  id: string;
  userId: string;
  wizardType: WizardType;
  payload: Record<string, unknown>;
  stepIndex: number;
  createdAt: string;
  updatedAt: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

/**
 * MySQL's json column comes back parsed on some driver versions and as a
 * string on others. Both are handled, and a payload that will not parse
 * becomes an empty object rather than throwing: a corrupt draft should cost
 * the member their typing, never their access to the drafts card.
 */
function parsePayload(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function toDraft(r: RowDataPacket): ProposalDraftRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    wizardType: String(r.wizard_type) as WizardType,
    payload: parsePayload(r.payload),
    stepIndex: Number(r.step_index),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface DraftInput {
  wizardType: unknown;
  payload: unknown;
  stepIndex: unknown;
}

/**
 * Every check a draft passes before it is stored, as a sentence or null.
 *
 * Pure on purpose: the wizard runs the same function before it asks the
 * server, so a member sees the refusal in the step they are standing in
 * rather than after a round trip.
 */
export function draftProblem(input: DraftInput): string | null {
  if (!(WIZARD_TYPES as readonly string[]).includes(String(input.wizardType))) {
    return "That is not a proposal type this village knows";
  }
  const payload = input.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "A draft carries what you have written so far, as a set of fields";
  }
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
    return "This draft has outgrown the wizard. Trim it, or publish what you have and edit from there";
  }
  const step = Number(input.stepIndex);
  if (!Number.isInteger(step) || step < 0 || step > 50) {
    return "A draft remembers which step you left off at, and that one is out of range";
  }
  return null;
}

export async function draftsOf(pool: Pool, userId: string): Promise<ProposalDraftRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM proposal_drafts WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 50",
    [userId],
  );
  return rows.map(toDraft);
}

/**
 * One draft, scoped to its author in the query. A member asking for someone
 * else's draft id gets null, which the route answers as a 404: the existence
 * of another member's unfinished thought is not information.
 */
export async function draftFor(pool: Pool, id: string, userId: string): Promise<ProposalDraftRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM proposal_drafts WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return rows[0] ? toDraft(rows[0]) : null;
}

export interface SaveDraftInput {
  /** Absent creates; present updates that draft if the author owns it. */
  id?: string | null;
  userId: string;
  wizardType: string;
  payload: Record<string, unknown>;
  stepIndex: number;
}

export type SaveDraftResult =
  | { ok: true; draft: ProposalDraftRow; created: boolean }
  | { ok: false; error: string };

/**
 * Save-and-leave, and every autosave in between.
 *
 * An update is scoped by `(id, user_id)` in the UPDATE itself, so a save
 * against a draft the caller does not own affects zero rows and reads as a
 * miss rather than as a write to somebody else's work. The cap is checked
 * only when a NEW draft would be created, because refusing to save an
 * existing draft would throw away the very typing this table exists to keep.
 */
export async function saveDraft(pool: Pool, input: SaveDraftInput): Promise<SaveDraftResult> {
  const problem = draftProblem(input);
  if (problem) return { ok: false, error: problem };

  if (input.id) {
    const [result] = await pool.query<any>(
      "UPDATE proposal_drafts SET wizard_type = ?, payload = ?, step_index = ? WHERE id = ? AND user_id = ?",
      [input.wizardType, JSON.stringify(input.payload), input.stepIndex, input.id, input.userId],
    );
    if (Number(result.affectedRows) > 0) {
      const draft = await draftFor(pool, input.id, input.userId);
      if (draft) return { ok: true, draft, created: false };
    }
    // The draft is gone (published, or discarded on another device). Falling
    // through to a fresh row is right: the member is still typing, and losing
    // the tab's work to a race elsewhere is the failure this table prevents.
  }

  const mine = await draftsOf(pool, input.userId);
  if (mine.length >= DRAFT_CAP) {
    return {
      ok: false,
      error: `You are holding ${mine.length} unfinished proposals, which is the limit. Publish one or discard one to start another`,
    };
  }
  const id = `pdr-${randomUUID().slice(0, 12)}`;
  await pool.query(
    "INSERT INTO proposal_drafts (id, user_id, wizard_type, payload, step_index) VALUES (?,?,?,?,?)",
    [id, input.userId, input.wizardType, JSON.stringify(input.payload), input.stepIndex],
  );
  const draft = await draftFor(pool, id, input.userId);
  if (!draft) return { ok: false, error: "The draft did not save" };
  return { ok: true, draft, created: true };
}

/**
 * Discard a draft, or clear it once its proposal exists. Returns whether a row
 * went, so the route can answer 404 for a draft that was never the caller's
 * instead of pretending to have deleted it.
 */
export async function deleteDraft(pool: Pool, id: string, userId: string): Promise<boolean> {
  const [result] = await pool.query<any>(
    "DELETE FROM proposal_drafts WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return Number(result.affectedRows) > 0;
}
