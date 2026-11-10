/**
 * SUGGEST-TO-EDIT, THE LIFECYCLE (ROLE_POWERS_DESIGN.md §4.5; GO 2026-11-06).
 *
 * The routing rule is shared/suggestions.ts and the store is
 * server/repos/adminSuggestions.ts. This file holds what a suggestion does:
 *
 *   - the CONTROL REGISTRY: each admin control a suggestion may name registers
 *     how to read its current value and version, how to check a payload, and
 *     how to APPLY one. The apply is the very function the control's direct
 *     route calls, so an Accept goes through the same guards and the same
 *     version check as a direct edit. server/routes/villagePaths.ts registers
 *     the first one.
 *   - ACCEPT, as the reviewer: refused when the target moved since the
 *     suggestion was made (the difference comes back), claimed before it is
 *     applied so two reviewers cannot both win, and put back when the apply
 *     refuses.
 *   - THE BALLOT: one subject, `admin_edit` (shared/ballotSubjects.ts), opened
 *     when the route says "ballot", when a holder sends a suggestion to a
 *     vote, or when the suggester raises one. Its closer applies the edit
 *     when the vote carries, through the same apply.
 *
 * The person-level gate (who is asking, do they hold the power, is it their
 * own suggestion) is the route's: server/routes/adminSuggestions.ts.
 */
import type { Pool } from "mysql2/promise";
import { ADMIN_EDIT, dialsForSubject, thresholdSettingsFrom, thresholdsForSubject } from "../../shared/ballotSubjects";
import { ADMIN_EDIT_CONTROLS, suggestionDiff, type AdminEditControlId, type DiffLine } from "../../shared/suggestions";
import type { CloseRouting, SubjectCloser } from "./applyDue";
import { decisionLink } from "./ballotNotices";
import { openBallot, type BallotRow } from "./ballots";
import type { BallotSetup } from "./ballotSetup";
import { numberVar, stringVar } from "./variables";
import type { SuggestionRow, SuggestionStore } from "../repos/adminSuggestions";

export { ADMIN_EDIT };

export type Refusal = { ok: false; status: number; body: Record<string, unknown> };

/** One admin control a suggestion may name, as its own route module registers it. */
export interface AdminEditControl {
  /**
   * The value in force now, and its version (the one the direct route's
   * `x-content-was` names). A control whose value lives in the database reads
   * it there, so this may answer a promise; every caller awaits it.
   */
  read(): { value: unknown; version: string } | Promise<{ value: unknown; version: string }>;
  /** What is wrong with a payload, in words, or null. The direct route's own check. */
  problem(payload: unknown): string | null;
  /**
   * Apply it: the direct route's own write, given the version it was made on.
   * The route asks the gate before calling this; a carried vote is the
   * village's decision and calls it directly. `by.decidedBy` is the holder who
   * accepted it, or `village:<ballot id>` for a carried vote, for a control
   * whose own door asks who is writing (the cash budget's payee conflict).
   */
  apply(payload: unknown, was: string, by?: { decidedBy: string }): Promise<{ ok: true } | Refusal>;
  /**
   * What the change does, one line each, for the ballot's WHAT CHANGES. A
   * control whose payload is a list of rows rather than the document itself
   * says it in words; without this the ballot shows the leaf difference.
   */
  describe?(payload: unknown): string[] | Promise<string[]>;
  /**
   * At creation, before anything is stored: the control checks the payload
   * the way its own door would (a dry run), refuses one that would not apply,
   * returns it cleaned (fields a suggestion may not carry taken off, and a
   * payee conflict flagged), and may name the version it binds to.
   */
  prepare?(payload: unknown, suggestedBy: string): Promise<{ problem: string | null; payload: unknown; version?: string }>;
  /**
   * The version THIS payload binds to now, when it is narrower than `read()`'s
   * (the rows it touches, never the whole document). Stale is judged on it.
   */
  versionFor?(payload: unknown): Promise<string>;
  /**
   * Of the live holders, the ones who may decide this suggestion: for the cash
   * budget, those who hold no role the change pays (a payee conflict, V10).
   * When holders exist and none may decide it, it goes to a village vote.
   */
  deciders?(payload: unknown, holders: readonly string[]): Promise<string[]>;
}

/** The control's value now, with the version this suggestion's payload binds to. */
export async function currentFor(control: AdminEditControl, s: Pick<SuggestionRow, "edit">): Promise<{ value: unknown; version: string }> {
  const now = await control.read();
  return control.versionFor ? { value: now.value, version: await control.versionFor(s.edit.payload) } : now;
}

const CONTROLS = new Map<AdminEditControlId, AdminEditControl>();

/** Called once by the control's route module, at registration. */
export function registerAdminEditControl(id: AdminEditControlId, control: AdminEditControl): void {
  CONTROLS.set(id, control);
}

/** The registered control, or null when its route module never registered it. */
export function adminEditControl(id: AdminEditControlId): AdminEditControl | null {
  return CONTROLS.get(id) ?? null;
}

/** The difference a stale suggestion shows: what moved under it, and what it would change now. */
export interface StaleDifference {
  movedSinceSuggested: DiffLine[];
  suggestedChange: DiffLine[];
  versionThen: string;
  versionNow: string;
}

export function staleDifference(s: SuggestionRow, now: { value: unknown; version: string }): StaleDifference | null {
  if (s.edit.version === now.version) return null;
  return {
    movedSinceSuggested: suggestionDiff(s.edit.base, now.value),
    suggestedChange: suggestionDiff(now.value, s.edit.payload),
    versionThen: s.edit.version,
    versionNow: now.version,
  };
}

const STALE_WORDS =
  "What this suggestion changes has moved since it was made. Read the difference, then suggest it again on the words as they are now.";

/**
 * Accept a suggestion and apply it. The caller has already decided this
 * person may (a live holder, through the gate, never their own).
 *
 * Order: refuse stale, claim, apply, and put the claim back if the apply
 * refused, so a refusal leaves the suggestion where it was.
 */
export async function acceptSuggestion(
  store: SuggestionStore,
  s: SuggestionRow,
  input: { decidedBy: string; note: string },
): Promise<{ ok: true } | Refusal> {
  const control = adminEditControl(s.edit.control);
  if (!control) return { ok: false, status: 409, body: { error: "This control cannot take suggestions yet.", code: "control_not_wired" } };
  const stale = staleDifference(s, await currentFor(control, s));
  if (stale) return { ok: false, status: 409, body: { error: STALE_WORDS, code: "stale", difference: stale } };
  const problem = control.problem(s.edit.payload);
  if (problem) return { ok: false, status: 400, body: { error: problem, code: "payload_refused" } };
  if (!(await store.move(s.id, s.status, "accepted", { decidedBy: input.decidedBy, note: input.note, ballotId: s.ballotId }))) {
    return { ok: false, status: 409, body: { error: "This suggestion has just been decided by somebody else.", code: "already_decided" } };
  }
  let applied: { ok: true } | Refusal;
  try {
    applied = await control.apply(s.edit.payload, s.edit.version, { decidedBy: input.decidedBy });
  } catch (e) {
    await store.move(s.id, "accepted", s.status, { ballotId: s.ballotId });
    throw e;
  }
  if (!applied.ok) {
    await store.move(s.id, "accepted", s.status, { ballotId: s.ballotId });
    return applied;
  }
  return { ok: true };
}

// ── The ballot ──────────────────────────────────────────────────────────────

export interface SuggestionBallotDeps {
  pool: Pool;
  store: SuggestionStore;
  /** "Maya", or "a member". */
  nameOf(userId: string): Promise<string>;
  notify(input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; actorUserId?: string | null; dedupeKey: string }): Promise<unknown>;
}

/** Who a vote decided by, in the 64 characters `decided_by` holds. */
export const villageDecider = (ballotId: string): string => `village:${ballotId}`.slice(0, 64);

/** The decision page shows this text as written, so plain lines only (no Markdown marks). */
function ballotText(s: SuggestionRow, suggester: string, current: { value: unknown }, at: Date, described: string[] | null = null): { title: string; doc: string } {
  const label = ADMIN_EDIT_CONTROLS[s.edit.control].label;
  const title = `A suggested change to ${label}: the village decides`;
  const lines = described
    ? described.map((l) => `  ${l}`)
    : suggestionDiff(current.value, s.edit.payload).map((d) => `  ${d.path}: ${JSON.stringify(d.from)} becomes ${JSON.stringify(d.to)}`);
  const doc = [
    title,
    "",
    "WHAT WAS SUGGESTED",
    "",
    `${suggester} suggested a change to ${label}.`,
    ...(s.why.trim() ? ["", "In their words:", "", s.why.trim()] : []),
    "",
    "WHAT CHANGES",
    "",
    ...(lines.length ? lines : ["  Nothing differs from the words in force today."]),
    "",
    "IF THIS CARRIES",
    "",
    "The change is applied exactly as written, the way the admin panel would apply it. If the words have changed again by the time the vote lands, nothing is applied and the suggestion waits to be made again.",
    "",
    "IF IT DOES NOT CARRY",
    "",
    "Nothing changes. If too few vote, the suggestion goes back to waiting.",
    "",
    `Put to the village on ${at.toISOString().slice(0, 10)}.`,
    "",
  ].join("\n");
  return { title, doc };
}

/**
 * Open the vote on a suggestion. The caller has already decided this person
 * may. The suggestion is claimed first (proposed to superseded), so it leaves
 * the holders' queue the moment the vote is opened and two openers cannot
 * both win; a refused open puts it back.
 */
export async function putSuggestionToVillage(
  deps: SuggestionBallotDeps,
  input: { suggestion: SuggestionRow; openedBy: string; setup: BallotSetup; at?: Date },
): Promise<{ ok: true; ballot: BallotRow; electorate: string[] } | Refusal> {
  const s = input.suggestion;
  if (s.status !== "proposed") return { ok: false, status: 409, body: { error: `This suggestion is already ${s.status}.`, code: "not_waiting" } };
  const control = adminEditControl(s.edit.control);
  if (!control) return { ok: false, status: 409, body: { error: "This control cannot take suggestions yet.", code: "control_not_wired" } };
  const now = await currentFor(control, s);
  const stale = staleDifference(s, now);
  if (stale) return { ok: false, status: 409, body: { error: STALE_WORDS, code: "stale", difference: stale } };
  // The checks it passed when it was made are run again before the village is asked: a name added to the roster since, say.
  if (control.prepare) {
    const again = await control.prepare(s.edit.payload, s.suggestedBy);
    if (again.problem) return { ok: false, status: 400, body: { error: again.problem, code: "payload_refused" } };
  }
  const { setup } = input;
  if (setup.tokenProblem) return { ok: false, status: 409, body: { error: setup.tokenProblem } };
  if (!(await deps.store.move(s.id, "proposed", "superseded", {}))) {
    return { ok: false, status: 409, body: { error: "This suggestion has just been decided by somebody else.", code: "already_decided" } };
  }
  const method = thresholdsForSubject(ADMIN_EDIT)?.method ?? setup.method;
  const dials = dialsForSubject(ADMIN_EDIT, method, setup.dials, thresholdSettingsFrom((key) => Number(numberVar(key)), (key) => stringVar(key)));
  const described = control.describe ? await control.describe(s.edit.payload) : null;
  const { title, doc } = ballotText(s, await deps.nameOf(s.suggestedBy), now, input.at ?? new Date(), described);
  let opened: Awaited<ReturnType<typeof openBallot>>;
  try {
    opened = await openBallot(deps.pool, {
      subjectType: ADMIN_EDIT,
      subjectRef: s.id,
      title,
      docMarkdown: doc,
      method,
      weightMode: setup.snapshot.mode,
      weightToken: setup.snapshot.token,
      unityPct: dials.unityPct,
      quorumPct: dials.quorumPct,
      durationDays: setup.durationDays,
      openedBy: input.openedBy,
      electorate: setup.electorate,
    });
  } catch (e) {
    await deps.store.move(s.id, "superseded", "proposed", {});
    throw e;
  }
  if (!opened.ok) {
    await deps.store.move(s.id, "superseded", "proposed", {});
    return { ok: false, status: 409, body: { error: opened.error, ballotId: opened.alreadyOpen?.id ?? null } };
  }
  await deps.store.move(s.id, "superseded", "superseded", { ballotId: opened.ballot.id });
  return { ok: true, ballot: opened.ballot, electorate: setup.electorate.map((e) => e.userId) };
}

/**
 * WHAT CLOSING A VOTE ON A SUGGESTION DOES. Written into `SUBJECT_CLOSERS` by
 * server/routes/adminSuggestions.ts.
 *
 *   carried        `execute` applies the edit through the control's own apply,
 *                  recorded as decided by the village. Stale by then: held,
 *                  with the reason, and nothing written.
 *   not carried    `settle` marks it declined: "The village voted no."
 *   too few voted  `settle` puts it back to waiting, so it is never stuck.
 *
 * IDEMPOTENT. A second `execute` finds it accepted by THIS ballot and reports
 * it landed without writing again.
 */
export function adminEditCloser(deps: SuggestionBallotDeps): SubjectCloser {
  const told = async (b: BallotRow, userId: string, title: string, body: string, key: string, actorId: string) => {
    try {
      await deps.notify({ userId, type: "governance", title, body, link: decisionLink(b), actorUserId: actorId, dedupeKey: `bal:${b.id}:${key}` });
    } catch (e) {
      console.error("[suggestions] could not tell the suggester how the vote ended:", b.id, e);
    }
  };
  return {
    settle: async (b, outcome, outcomeNote, actorId) => {
      const out: CloseRouting = { applied: [], held: null, proposerTold: null };
      if (outcome === "passed") return out;
      const s = await deps.store.byId(b.subjectRef);
      if (!s || s.status !== "superseded") return out;
      out.proposerTold = s.suggestedBy;
      if (outcome === "no_quorum") {
        await deps.store.move(s.id, "superseded", "proposed", {});
        await told(b, s.suggestedBy, `Too few of the village voted: ${b.title}`, "Nothing changed, and your suggestion is waiting again.", "admin-edit-quiet", actorId);
        return out;
      }
      await deps.store.move(s.id, "superseded", "rejected", { decidedBy: villageDecider(b.id), note: `The village voted no. ${outcomeNote}`.trim(), ballotId: b.id });
      await told(b, s.suggestedBy, `The village did not carry this one: ${b.title}`, "Nothing changed.", "admin-edit-declined", actorId);
      return out;
    },
    execute: async (b, actorId) => {
      const out: CloseRouting = { applied: [], held: null, proposerTold: null };
      const s = await deps.store.byId(b.subjectRef);
      if (!s) return out;
      if (s.status === "accepted" && s.decidedBy === villageDecider(b.id)) {
        out.applied = [`admin_edit:${s.id}`];
        return out;
      }
      out.proposerTold = s.suggestedBy;
      const r = await acceptSuggestion(deps.store, s, {
        decidedBy: villageDecider(b.id),
        note: `Suggested by ${await deps.nameOf(s.suggestedBy)}, carried by a village vote.`,
      });
      if (!r.ok) {
        out.held = `The village carried this and it could not be applied: ${String(r.body.error)}`;
        // Closed with the reason, so it never sits under a vote that ended.
        await deps.store.move(s.id, "superseded", "rejected", { decidedBy: villageDecider(b.id), note: out.held.slice(0, 1000), ballotId: b.id });
        await told(b, s.suggestedBy, `A carried suggestion could not be applied: ${b.title}`, out.held, "admin-edit-held", actorId);
        return out;
      }
      out.applied = [`admin_edit:${s.id}`];
      await told(b, s.suggestedBy, `The village carried this: ${b.title}`, "Your suggestion is applied.", "admin-edit-applied", actorId);
      return out;
    },
  };
}
