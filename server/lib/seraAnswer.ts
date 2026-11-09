/**
 * ANSWERING THE DIFFERENCES WITH THE OUTSIDE SERVICE: take, keep, edit and
 * undo, for `POST /api/saberra/differences/answer` and `/undo`
 * (server/routes/saberra.ts). The rules are pure, in shared/seraSettle.ts.
 *
 * ── WHAT AN ANSWER WRITES ────────────────────────────────────────────────
 *
 * Nothing on the chart. A take or an edit adds changes to ONE open org draft
 * that collects the list's answers, built by the structure review's own
 * builders, one field per difference (R12). That draft is reviewed and
 * published through the three doors every draft uses (an `org.decide` holder,
 * the admin panel before launch, or a village vote), and withdrawn through the
 * review queue's own withdraw. A keep writes only its answer. Both write a row
 * in `saberra_settled`, hashes and never words (R6), and tie the page id to
 * ours on the first answer about it (R1).
 *
 * ── COMPARE AND SET (R14) ────────────────────────────────────────────────
 *
 * Every item carries the difference's key and both hashes as the person saw
 * them. Inside one transaction the newest stored read is locked for shared
 * use (so the sync's next read waits to be kept), our roles and circles the
 * items are about are locked, and the answers already given are locked with
 * their drafts (so a publish of that draft waits). Only then is the list read
 * again and every item checked against it: a hash that moved refuses with
 * "Sera changed this since you opened it" and the new difference. The draft,
 * its changes and the answers are written on that same connection, so they
 * commit together or not at all.
 *
 * ── IN A DRAFT IS A STATE (R13) ──────────────────────────────────────────
 *
 * An answer names its draft, and the draft's status is the state: a take in
 * an open draft cannot be taken again (409), a published one is settled, and
 * a withdrawn or reverted one is open again. So nothing has to be written when
 * the draft moves, and the two can never disagree.
 *
 * ── WHO ──────────────────────────────────────────────────────────────────
 *
 * The route lets in the review queue's key (`intake.moderate`), because an
 * answer writes a draft and never the chart: anyone's act makes a draft, and
 * the publish door is the holder test (R17). The door the person came through
 * is recorded with the answer: `power` for a live `org.decide` holder, `admin`
 * for the admin panel before launch, `moderator` otherwise, and a moderator's
 * keep of a decision only sets it aside for the people who decide (R16).
 *
 * The event each answer writes is fixed text, names nobody and carries no
 * values (R26).
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import type { Difference } from "../../shared/seraDifferences";
import {
  answerRefusalWords,
  answerState,
  changesFor,
  nestedIn,
  type Answer,
  type AnswerDoor,
  type AnswerRefusal,
  type SettledRow,
} from "../../shared/seraSettle";
import { pageKey, waitingKind } from "../../shared/seraWaiting";
import { ORG_DRAFT } from "../../shared/ballotSubjects";
import { openBallotFor } from "./ballots";
import { recordEvent } from "./events";
import { addChange, createDraft, withdrawDraft } from "./orgDrafts";
import type { DifferencesRead } from "./seraDifferencesRead";
import {
  draftChangeCount,
  draftCirclesOf,
  lockAnswers,
  lockChartRows,
  lockNewestRead,
  markUndone,
  removeDraftChanges,
  writeAnswer,
  writeLink,
  type AnswerRow,
} from "../repos/seraSettled";

export type AnswerAct = "take" | "keep" | "edit";
const ACTS: readonly AnswerAct[] = ["take", "keep", "edit"];

export interface AnswerItem {
  key: string;
  seraHash: string;
  oursHash: string;
  /** An edit's own words. */
  value?: string;
}

export interface AnswerActor {
  userId: string;
  door: AnswerDoor;
  /** The role whose power they acted through, or null. */
  byRoleId: string | null;
}

export interface Refused {
  key: string;
  why: AnswerRefusal;
  words: string;
  /** The difference as it stands now, for a hash that moved: the page shows it in place of the one it had. */
  difference: unknown;
}

/** The most items one answer carries: a page of differences, never the whole table. */
export const ANSWER_MAX_ITEMS = 200;
const KEY_MAX = 191;
const VALUE_MAX = 20_000;

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v !== "" && v.length <= max ? v : null);

/** An answer's body, read without trusting it: an act and its items, or null when it is not one. */
export function readAnswerBody(body: unknown): { act: AnswerAct; items: AnswerItem[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const act = ACTS.find((a) => a === b.act);
  if (!act || !Array.isArray(b.items) || b.items.length === 0 || b.items.length > ANSWER_MAX_ITEMS) return null;
  const items: AnswerItem[] = [];
  for (const raw of b.items) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const key = str(r.key, KEY_MAX);
    const seraHash = str(r.seraHash, 32);
    const oursHash = str(r.oursHash, 32);
    if (!key || !seraHash || !oursHash) return null;
    const item: AnswerItem = { key, seraHash, oursHash };
    if (act === "edit") {
      if (typeof r.value !== "string" || r.value.length > VALUE_MAX) return null;
      item.value = r.value;
    }
    items.push(item);
  }
  // An edit is one person's words for one field.
  if (act === "edit" && items.length !== 1) return null;
  if (new Set(items.map((i) => i.key)).size !== items.length) return null;
  return { act, items };
}

/** A keys list, read the same way. */
export function readUndoBody(body: unknown): string[] | null {
  const keys = body && typeof body === "object" ? (body as Record<string, unknown>).keys : null;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > ANSWER_MAX_ITEMS) return null;
  const out = keys.map((k) => str(k, KEY_MAX));
  return out.every((k): k is string => k !== null) ? Array.from(new Set(out)) : null;
}

export interface AnswerDeps {
  /** The list as the routes read it, through the same cache. */
  read: () => Promise<DifferencesRead>;
  /** One difference as the list sends it, words included, for a refusal that carries the new one. */
  describe: (d: Difference) => unknown;
  agent: string;
}

type Outcome = { status: number; body: Record<string, unknown> };

/** The roles and circles a set of differences is about: what is locked before the check. */
function subjectsOf(list: readonly Difference[]): { roles: string[]; circles: string[] } {
  const roles = new Set<string>();
  const circles = new Set<string>();
  for (const d of list) {
    if (!d.subject.ourId) continue;
    (d.subject.kind === "role" ? roles : circles).add(d.subject.ourId);
  }
  return { roles: Array.from(roles).sort(), circles: Array.from(circles).sort() };
}

/** The open draft the list's answers collect in, when one stands and no vote is running on it. */
async function openAnswerDraft(conn: PoolConnection, rows: ReadonlyMap<string, AnswerRow>, everyAnswer: ReadonlyMap<string, SettledRow>): Promise<string | null> {
  const ids = new Set<string>();
  for (const m of [rows, everyAnswer]) for (const r of Array.from(m.values())) if (r.draftId && r.draftStatus === "open" && (r.answer === "taken" || r.answer === "edited")) ids.add(r.draftId);
  for (const id of Array.from(ids).sort()) {
    if (await openBallotFor(conn, ORG_DRAFT, id)) continue;
    // Locked with this answer, so a publish of it waits until the changes below are in (R13).
    const [locked] = await conn.query<any[]>("SELECT id FROM org_drafts WHERE id = ? AND status = 'open' FOR UPDATE", [id]); // module-review-ok: a step inside this answer's own transaction on its connection, as server/repos/orgDrafts.ts explains for the publish
    if (locked.length) return id;
  }
  return null;
}

const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/**
 * Take, keep or edit. Answers 200 with what was done and what was refused (a
 * bulk answer goes ahead with the items that pass and names the rest), or 409
 * when a single item is refused, with its words and the difference as it
 * stands now.
 */
export async function answerDifferences(
  pool: Pool,
  deps: AnswerDeps,
  input: { act: AnswerAct; items: readonly AnswerItem[]; actor: AnswerActor },
): Promise<Outcome> {
  const { act, items, actor } = input;
  const bulk = items.length > 1;
  const refuse = (key: string, why: AnswerRefusal, d: Difference | null = null): Refused => ({
    key,
    why,
    words: answerRefusalWords(why, deps.agent),
    difference: d ? deps.describe(d) : null,
  });

  // A first look, unlocked, only to learn which rows to lock.
  const first = await deps.read();
  const firstByKey = new Map(first.list.map((d) => [d.key, d]));
  const about = items.map((i) => firstByKey.get(i.key)).filter((d): d is Difference => !!d);
  const lockKeys = new Set(items.map((i) => i.key));
  for (const d of about) if (d.kind === "circleAdd" && d.subject.pageId) for (const r of nestedIn(first.list, pageKey(d.subject.pageId))) lockKeys.add(r.key);
  const { roles, circles } = subjectsOf(about);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await lockNewestRead(conn);
    await lockChartRows(conn, roles, circles);
    const locked = await lockAnswers(conn, Array.from(lockKeys));
    // The look that counts: after the locks, so neither side moves before the commit.
    const read = await deps.read();
    const byKey = new Map(read.list.map((d) => [d.key, d]));
    const answers = new Map(read.answers ?? []);
    for (const [k, r] of Array.from(locked.entries())) answers.set(k, r);

    const refused: Refused[] = [];
    const pass: Array<{ item: AnswerItem; d: Difference }> = [];
    for (const item of items) {
      const d = byKey.get(item.key);
      if (!d) {
        refused.push(refuse(item.key, "gone"));
        continue;
      }
      const state = answerState(d, answers.get(d.key));
      if (state === "inDraft") refused.push(refuse(d.key, "inDraft"));
      else if (state === "settled") refused.push(refuse(d.key, "answered"));
      else if (d.seraHash !== item.seraHash) refused.push(refuse(d.key, "seraChanged", d));
      else if (d.oursHash !== item.oursHash) refused.push(refuse(d.key, "oursChanged", d));
      // R2: what carries a reason to check first is taken on its own, never with others.
      else if (bulk && act === "take" && !d.bulkEligible) refused.push(refuse(d.key, "checkFirst"));
      else pass.push({ item, d });
    }

    const done: Array<{ key: string; answer: Answer; draftId: string | null; with: string[]; setAside?: boolean }> = [];
    let draftId: string | null = null;
    if (pass.length > 0 && (act === "take" || act === "edit")) {
      draftId = await openAnswerDraft(conn, locked, read.answers ?? new Map());
      const circlesMade = draftId ? await draftCirclesOf(conn, draftId) : new Map<string, string>();
      for (const { item, d } of pass) {
        const take = changesFor({ d, list: read.list, actor: actor.userId, draftCircles: circlesMade, ...(act === "edit" ? { value: item.value } : {}) });
        if (!take.ok) {
          refused.push(refuse(d.key, take.why));
          continue;
        }
        if (!draftId) {
          const made = await createDraft(conn, {
            title: `${possessive(deps.agent)} suggestions, taken from the review list`,
            rationale: `Each change here was taken from the list of ways ${deps.agent} and this village's chart differ, one field at a time.`,
            createdBy: actor.userId,
            sourceKind: "agent",
            sourceModuleId: "saberra",
            // A person's act, one draft at a time, reused until it is published or withdrawn.
            openCap: null,
          });
          if (!made.ok) throw new Error(made.error);
          draftId = made.id;
        }
        const ids: string[] = [];
        for (const change of take.changes) {
          const added = await addChange(conn, draftId, change);
          if (!added.ok) throw new Error(added.error);
          ids.push(added.id);
          if (change.op === "create_circle" && d.subject.pageId) circlesMade.set(pageKey(d.subject.pageId), change.orgRoleId.slice("circle:".length));
        }
        const answer: Answer = act === "edit" ? "edited" : "taken";
        const base = { answer, door: actor.door, byRoleId: actor.byRoleId, actorUserId: actor.userId, draftId };
        await writeAnswer(conn, { key: d.key, seraHash: d.seraHash, oursHash: d.oursHash, draftChangeId: ids[0] ?? null, cameWith: null, ...base });
        for (let i = 0; i < take.with.length; i += 1) {
          const r = byKey.get(take.with[i]);
          if (!r) continue;
          await writeAnswer(conn, { key: r.key, seraHash: r.seraHash, oursHash: r.oursHash, draftChangeId: ids[i + 1] ?? null, cameWith: d.key, ...base });
        }
        for (const l of take.leftOut) refused.push(refuse(l.key, l.why));
        if (d.subject.ourId && d.subject.pageId) {
          await writeLink(conn, { kind: d.subject.kind, pageKey: pageKey(d.subject.pageId), ourId: d.subject.ourId, setBy: "take", actorUserId: actor.userId });
        }
        done.push({ key: d.key, answer, draftId, with: take.with });
      }
    } else if (act === "keep") {
      for (const { d } of pass) {
        await writeAnswer(conn, {
          key: d.key, seraHash: d.seraHash, oursHash: d.oursHash, answer: "kept", door: actor.door, byRoleId: actor.byRoleId,
          actorUserId: actor.userId, draftId: null, draftChangeId: null, cameWith: null,
        });
        if (d.subject.ourId && d.subject.pageId) {
          await writeLink(conn, { kind: d.subject.kind, pageKey: pageKey(d.subject.pageId), ourId: d.subject.ourId, setBy: "keep", actorUserId: actor.userId });
        }
        // A moderator's keep of a decision only sets it aside (R16), and the page says so.
        done.push({ key: d.key, answer: "kept", draftId: null, with: [], setAside: actor.door === "moderator" && waitingKind(d) === "toDecide" });
      }
    }

    if (!bulk && done.length === 0 && refused.length > 0) {
      await conn.rollback();
      const r = refused[0];
      const status = r.why === "blank" || r.why === "tooLong" || r.why === "notEditable" ? 400 : 409;
      return { status, body: { error: r.words, why: r.why, key: r.key, difference: r.difference } };
    }
    await conn.commit();
    if (done.length > 0) {
      void recordEvent(pool, {
        kind: "org",
        text: `sera differences answered: ${done.length} ${act === "keep" ? "kept" : act === "edit" ? "edited" : "taken"}`,
        actorUserId: actor.userId,
        actorKind: "human",
        originModuleId: "saberra",
        ...(draftId ? { entityType: "draft", entityRef: draftId } : {}),
        audience: "admin",
      });
    }
    return { status: 200, body: { done, refused, draftId } };
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    const message = e instanceof Error ? e.message.slice(0, 300) : "The answer could not be written.";
    return { status: 409, body: { error: message, why: "refused" } };
  } finally {
    conn.release();
  }
}

/**
 * Take answers back: a keep waits again, and a take still in an open draft
 * comes out of the draft, with the new roles a new circle brought (R15, R16).
 * Never a take that is live: that is undone from the draft's own history. A
 * draft left with nothing in it is withdrawn.
 */
export async function undoAnswers(pool: Pool, deps: Pick<AnswerDeps, "agent">, input: { keys: readonly string[]; actorUserId: string }): Promise<Outcome> {
  const conn = await pool.getConnection();
  const touched = new Set<string>();
  try {
    await conn.beginTransaction();
    const rows = await lockAnswers(conn, input.keys);
    const undone: string[] = [];
    const refused: Array<{ key: string; why: AnswerRefusal; words: string }> = [];
    const no = (key: string, why: AnswerRefusal) => refused.push({ key, why, words: answerRefusalWords(why, deps.agent) });
    for (const key of input.keys) {
      const row = rows.get(key);
      if (!row || row.answer === "undone" || row.answer === "first") {
        no(key, "nothing");
        continue;
      }
      if (row.answer === "kept") {
        undone.push(key);
        continue;
      }
      if (row.answer !== "taken" && row.answer !== "edited") {
        no(key, "nothing");
        continue;
      }
      if (row.draftStatus === "published") {
        no(key, "live");
        continue;
      }
      if (row.draftStatus !== "open" || !row.draftId) {
        no(key, "nothing");
        continue;
      }
      if (await openBallotFor(conn, ORG_DRAFT, row.draftId)) {
        no(key, "underVote");
        continue;
      }
      const came = Array.from(rows.values()).filter((r) => r.cameWith === key && r.draftId === row.draftId && (r.answer === "taken" || r.answer === "edited"));
      const ids = [row.draftChangeId, ...came.map((r) => r.draftChangeId)].filter((x): x is string => !!x);
      await removeDraftChanges(conn, row.draftId, ids);
      touched.add(row.draftId);
      undone.push(key, ...came.map((r) => r.key));
    }
    await markUndone(conn, undone, input.actorUserId);
    await conn.commit();
    for (const id of Array.from(touched)) {
      if ((await draftChangeCount(pool, id)) === 0) await withdrawDraft(pool, id);
    }
    if (undone.length > 0) {
      void recordEvent(pool, {
        kind: "org",
        text: `sera differences answered: ${undone.length} undone`,
        actorUserId: input.actorUserId,
        actorKind: "human",
        originModuleId: "saberra",
        audience: "admin",
      });
    }
    if (undone.length === 0 && refused.length > 0) return { status: 409, body: { error: refused[0].words, why: refused[0].why, undone, refused } };
    return { status: 200, body: { undone, refused } };
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    return { status: 409, body: { error: e instanceof Error ? e.message.slice(0, 300) : "The undo could not be written.", why: "refused" } };
  } finally {
    conn.release();
  }
}
