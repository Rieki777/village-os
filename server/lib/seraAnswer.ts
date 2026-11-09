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
 * ours on the first answer about it (R1); an undo unties a link its answer made.
 *
 * ── COMPARE AND SET (R14), AND THE LOCKS ─────────────────────────────────
 *
 * Every item carries the difference's key and both hashes as the person saw
 * them. Inside one transaction, in this order (server/repos/seraSettled.ts
 * says why): the newest stored read, exclusively; every open draft the answers
 * may write to; our roles and circles the items are about; the answers. The
 * draft comes before our rows because `publishDraft` takes it first too, so a
 * take never lands in a draft that is being published, and the two never wait
 * on each other in a circle. Only then is the list read again and every item
 * checked against it: a hash that moved refuses with "Sera changed this since
 * you opened it" and the new difference. The draft, its changes and the
 * answers are written on that same connection, so they commit together.
 *
 * ── IN A DRAFT IS A STATE (R13) ──────────────────────────────────────────
 *
 * An answer names its draft, and the draft's status is the state: a take in an
 * open draft cannot be taken again (409), a published one is settled, and a
 * withdrawn or reverted one is open again. A take whose difference has gone or
 * moved since is "changed": it may be undone or taken again, and its draft
 * takes no new answers until it is. A draft under a village vote takes none.
 *
 * ── WHOSE WORDS (R9, review 11) ──────────────────────────────────────────
 *
 * An edit's words are a person's, so they are name-checked here, inside the
 * transaction, and words that name a member are refused. A draft that holds an
 * edit is a person's draft: its title and rationale say some of it was written
 * here.
 *
 * ── WHO ──────────────────────────────────────────────────────────────────
 *
 * The route lets in the review queue's key (`intake.moderate`), because an
 * answer writes a draft and never the chart: anyone's act makes a draft, and
 * the publish door is the holder test (R17). The door the person came through
 * is recorded with the answer, and an undo records the undoer's own door.
 *
 * The event each answer writes is fixed text, names nobody and carries no
 * values (R26). An unexpected failure is answered with a fixed sentence and
 * logged by its code: no exception text leaves the server.
 */
import type { Pool } from "mysql2/promise";
import type { Difference } from "../../shared/seraDifferences";
import {
  answerRefusalWords,
  answerState,
  bulkLeftOut,
  changesFor,
  draftHasChanged,
  nestedIn,
  withAnswers,
  type Answer,
  type AnswerDoor,
  type AnswerRefusal,
  type SettledRow,
} from "../../shared/seraSettle";
import { pageKey } from "../../shared/seraWaiting";
import { ORG_DRAFT } from "../../shared/ballotSubjects";
import { openBallotFor } from "./ballots";
import { recordEvent } from "./events";
import { addChange, createDraft } from "./orgDrafts";
import type { DifferencesRead } from "./seraDifferencesRead";
import {
  changesOfDrafts,
  chartNames,
  lapseAnswers,
  draftIdsForKeys,
  lockAnswers,
  lockAnswersInDraft,
  lockChartRows,
  lockDrafts,
  lockNewestRead,
  markDraftWritten,
  markUndone,
  removeDraftChanges,
  removeLink,
  withdrawEmptyDraft,
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
  /** Whether words name a member here, by the wide match the snapshot flags with (R9). */
  namesAMember: () => Promise<(text: string) => boolean>;
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

/** The open drafts the answers point at: every one an answer or an undo may write to. */
function openAnswerDrafts(answers: ReadonlyMap<string, SettledRow>): string[] {
  const ids = new Set<string>();
  for (const r of Array.from(answers.values())) if (r.draftId && r.draftStatus === "open" && (r.answer === "taken" || r.answer === "edited")) ids.add(r.draftId);
  return Array.from(ids).sort();
}

/** A key's subject kind and page key: `role:<page key>:<slot>`. */
function keyParts(key: string): { kind: string; pk: string } {
  const [kind = "", pk = ""] = key.split(":");
  return { kind, pk };
}

const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** Log an unexpected failure by its code only, and answer a fixed sentence (review 19). */
function failed(where: string, e: unknown, agent: string): Outcome {
  const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code: string }).code) : e instanceof Error ? e.name : "unknown";
  console.warn(`[saberra] ${where} stopped (${code}); nothing was written`);
  return { status: 409, body: { error: answerRefusalWords("failed", agent), why: "failed" } };
}

/** Thrown from inside the transaction to end it with a named refusal. */
class Refusal extends Error {
  constructor(readonly why: AnswerRefusal, readonly words: string) {
    super(why);
  }
}

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

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // 1. The newest read, exclusively: answers queue behind each other, and the service's side stands still.
    await lockNewestRead(conn);
    // A first look, to learn which drafts and rows to lock.
    const first = await deps.read();
    const firstByKey = new Map(first.list.map((d) => [d.key, d]));
    const about = items.map((i) => firstByKey.get(i.key)).filter((d): d is Difference => !!d);
    const lockKeys = new Set(items.map((i) => i.key));
    for (const d of about) if (d.kind === "circleAdd" && d.subject.pageId) for (const r of nestedIn(first.list, pageKey(d.subject.pageId))) lockKeys.add(r.key);
    // 2. Every open draft an answer may write to, before our rows: the order publishDraft takes them in.
    const drafts = await lockDrafts(conn, openAnswerDrafts(first.answers ?? new Map()));
    // 3. Our roles and circles. 4. The answers.
    const { roles, circles } = subjectsOf(about);
    await lockChartRows(conn, roles, circles);
    const locked = await lockAnswers(conn, Array.from(lockKeys));
    // The look that counts: nothing it reads can move before the commit.
    const read = await deps.read();
    const byKey = new Map(read.list.map((d) => [d.key, d]));
    const answers = new Map<string, SettledRow>(read.answers ?? []);
    for (const [k, r] of Array.from(locked.entries())) answers.set(k, r);
    const groups = withAnswers(read.list, answers).inDraft;
    const underVote = new Set<string>();
    for (const id of Array.from(drafts.keys())) if (await openBallotFor(conn, ORG_DRAFT, id)) underVote.add(id);

    const refused: Refused[] = [];
    const pass: Array<{ item: AnswerItem; d: Difference; retake: AnswerRow | null }> = [];
    for (const item of items) {
      const d = byKey.get(item.key);
      if (!d) {
        refused.push(refuse(item.key, "gone"));
        continue;
      }
      const row = locked.get(d.key);
      const state = answerState(d, answers.get(d.key));
      if (state === "inDraft") refused.push(refuse(d.key, "inDraft"));
      else if (state === "changed" && act === "keep") refused.push(refuse(d.key, "inDraft"));
      else if (state === "changed" && row?.draftId && underVote.has(row.draftId)) refused.push(refuse(d.key, "underVote"));
      else if (state === "settled") refused.push(refuse(d.key, "answered"));
      else if (d.seraHash !== item.seraHash) refused.push(refuse(d.key, "seraChanged", d));
      else if (d.oursHash !== item.oursHash) refused.push(refuse(d.key, "oursChanged", d));
      else {
        // R2: what carries a reason to check first, and pay and ours ahead, are never taken with others; each says which.
        const why = bulk && act === "take" ? bulkLeftOut(d) : null;
        if (why) refused.push(refuse(d.key, why));
        else pass.push({ item, d, retake: state === "changed" && row ? row : null });
      }
    }

    const done: Array<{ key: string; answer: Answer; draftId: string | null; with: string[]; setAside?: boolean }> = [];
    let sharedDraft: string | null = null;
    if (pass.length > 0 && (act === "take" || act === "edit")) {
      const names = act === "edit" ? await deps.namesAMember() : null;
      // The draft new answers collect in: open, not under a vote, and holding nothing that changed since it was taken.
      const reusable = groups.find((g) => drafts.get(g.draftId)?.status === "open" && !underVote.has(g.draftId) && !draftHasChanged(g));
      sharedDraft = reusable?.draftId ?? null;
      const madeCircles = new Map<string, Map<string, string>>();
      const circlesIn = async (draftId: string): Promise<Map<string, string>> => {
        const known = madeCircles.get(draftId);
        if (known) return known;
        const out = new Map<string, string>();
        const changes = await changesOfDrafts(conn, [draftId]);
        for (const r of Array.from(answers.values())) {
          if (r.draftId !== draftId || !r.key.startsWith("circle:") || (r.answer !== "taken" && r.answer !== "edited")) continue;
          const c = changes.find((x) => x.id === (r as AnswerRow).draftChangeId);
          if (c?.op === "create_circle") out.set(keyParts(r.key).pk, c.orgRoleId.slice("circle:".length));
        }
        madeCircles.set(draftId, out);
        return out;
      };
      for (const { item, d, retake } of pass) {
        // R9: a person's words are checked for a member's name before they go anywhere.
        if (act === "edit" && names && names(String(item.value ?? ""))) {
          refused.push(refuse(d.key, "editNamesAMember"));
          continue;
        }
        let draftId = retake?.draftId ?? sharedDraft;
        const take = changesFor({
          d, list: read.list, actor: actor.userId, draftCircles: draftId ? await circlesIn(draftId) : new Map(), answers,
          ...(act === "edit" ? { value: item.value } : {}),
        });
        if (!take.ok) {
          refused.push(refuse(d.key, take.why));
          continue;
        }
        if (retake?.draftId) {
          // Taken again: what it put in the draft before comes out, with the new roles that came with it.
          const came = Array.from(locked.values()).filter((r) => r.cameWith === d.key && r.draftId === retake.draftId);
          await removeDraftChanges(conn, retake.draftId, [retake.draftChangeId, ...came.map((r) => r.draftChangeId)].filter((x): x is string => !!x));
          await markUndone(conn, came.map((r) => r.key), { actorUserId: actor.userId, door: actor.door, byRoleId: actor.byRoleId });
        }
        if (!draftId) {
          const made = await createDraft(conn, {
            title: act === "edit" ? `Changes from ${possessive(deps.agent)} list, some in words written here` : `${possessive(deps.agent)} suggestions, taken from the review list`,
            rationale:
              act === "edit"
                ? `Some changes here were taken from the list of ways ${deps.agent} and this village's chart differ, and some were written here.`
                : `Each change here was taken from the list of ways ${deps.agent} and this village's chart differ, one field at a time.`,
            createdBy: actor.userId,
            // A draft that holds a person's words is a person's draft (review 11).
            sourceKind: act === "edit" ? "human" : "agent",
            sourceModuleId: "saberra",
            // A person's act, one draft at a time, reused until it is published or withdrawn.
            openCap: null,
          });
          if (!made.ok) throw new Refusal("failed", answerRefusalWords("failed", deps.agent));
          draftId = made.id;
          sharedDraft = sharedDraft ?? made.id;
        } else if (act === "edit") {
          await markDraftWritten(
            conn,
            draftId,
            `Changes from ${possessive(deps.agent)} list, some in words written here`,
            `Some changes here were taken from the list of ways ${deps.agent} and this village's chart differ, and some were written here.`,
          );
        }
        const ids: string[] = [];
        for (const change of take.changes) {
          const added = await addChange(conn, draftId, change);
          if (!added.ok) throw new Refusal("failed", answerRefusalWords("failed", deps.agent));
          ids.push(added.id);
          if (change.op === "create_circle" && d.subject.pageId) (await circlesIn(draftId)).set(pageKey(d.subject.pageId), change.orgRoleId.slice("circle:".length));
        }
        const answer: Answer = act === "edit" ? "edited" : "taken";
        const linkMade =
          d.subject.ourId && d.subject.pageId
            ? await writeLink(conn, { kind: d.subject.kind, pageKey: pageKey(d.subject.pageId), ourId: d.subject.ourId, setBy: "take", actorUserId: actor.userId })
            : false;
        const base = { answer, door: actor.door, byRoleId: actor.byRoleId, actorUserId: actor.userId, draftId };
        await writeAnswer(conn, { key: d.key, seraHash: d.seraHash, oursHash: d.oursHash, draftChangeId: ids[0] ?? null, cameWith: null, linkMade, ...base });
        for (let i = 0; i < take.with.length; i += 1) {
          const r = byKey.get(take.with[i]);
          if (!r) continue;
          await writeAnswer(conn, { key: r.key, seraHash: r.seraHash, oursHash: r.oursHash, draftChangeId: ids[i + 1] ?? null, cameWith: d.key, linkMade: false, ...base });
        }
        for (const l of take.leftOut) refused.push(refuse(l.key, l.why));
        done.push({ key: d.key, answer, draftId, with: take.with });
      }
    } else if (act === "keep") {
      for (const { d } of pass) {
        const linkMade =
          d.subject.ourId && d.subject.pageId
            ? await writeLink(conn, { kind: d.subject.kind, pageKey: pageKey(d.subject.pageId), ourId: d.subject.ourId, setBy: "keep", actorUserId: actor.userId })
            : false;
        await writeAnswer(conn, {
          key: d.key, seraHash: d.seraHash, oursHash: d.oursHash, answer: "kept", door: actor.door, byRoleId: actor.byRoleId,
          actorUserId: actor.userId, draftId: null, draftChangeId: null, cameWith: null, linkMade,
        });
        // A moderator's keep only sets it aside (R16, and R29 while automatic apply is off), and the page says so.
        done.push({ key: d.key, answer: "kept", draftId: null, with: [], setAside: actor.door === "moderator" });
      }
    }

    if (!bulk && done.length === 0 && refused.length > 0) {
      await conn.rollback();
      const r = refused[0];
      const status = r.why === "blank" || r.why === "tooLong" || r.why === "notEditable" || r.why === "editNamesAMember" ? 400 : 409;
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
        ...(sharedDraft ? { entityType: "draft", entityRef: sharedDraft } : {}),
        audience: "admin",
      });
    }
    return { status: 200, body: { done, refused, draftId: done.find((x) => x.draftId)?.draftId ?? null } };
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    if (e instanceof Refusal) return { status: 409, body: { error: e.words, why: e.why } };
    return failed("an answer", e, deps.agent);
  } finally {
    conn.release();
  }
}

/**
 * Take answers back: a keep waits again, and a take still in an open draft
 * comes out of the draft, with the new roles a new circle brought and every
 * role placed in that circle since (R15, R16, review 4). Never a take that is
 * live, never one in a draft under a vote. A draft left with nothing in it is
 * withdrawn in the same transaction. A link the answer made is untied.
 */
export async function undoAnswers(pool: Pool, deps: Pick<AnswerDeps, "agent">, input: { keys: readonly string[]; actor: AnswerActor }): Promise<Outcome> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await lockNewestRead(conn);
    // The drafts first, in the order every answer and every publish takes them.
    await lockDrafts(conn, await draftIdsForKeys(conn, input.keys));
    const rows = await lockAnswers(conn, input.keys);
    const undone: string[] = [];
    const unlink: AnswerRow[] = [];
    const touched = new Set<string>();
    const refused: Array<{ key: string; why: AnswerRefusal; words: string }> = [];
    const no = (key: string, why: AnswerRefusal, words = answerRefusalWords(why, deps.agent)) => refused.push({ key, why, words });
    for (const key of input.keys) {
      const row = rows.get(key);
      if (!row || row.lapsed || row.answer === "undone" || row.answer === "first" || row.answer === "applied") {
        no(key, "nothing");
        continue;
      }
      if (row.answer === "kept") {
        undone.push(key);
        unlink.push(row);
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
      const inDraft = await lockAnswersInDraft(conn, row.draftId);
      const out = [row, ...Array.from(inDraft.values()).filter((r) => r.cameWith === key && (r.answer === "taken" || r.answer === "edited"))];
      // A new circle: every role the draft places in it goes too, or the undo is refused and names them (review 4).
      if (key.startsWith("circle:") && row.draftChangeId) {
        const changes = await changesOfDrafts(conn, [row.draftId]);
        const circle = changes.find((c) => c.id === row.draftChangeId && c.op === "create_circle");
        if (circle) {
          const circleId = circle.orgRoleId.slice("circle:".length);
          const placing = changes.filter((c) => (c.op === "create_seat" || c.op === "update_seat") && c.payload.circleId === circleId);
          const byChange = new Map(Array.from(inDraft.values()).filter((r) => r.answer === "taken" || r.answer === "edited").map((r) => [r.draftChangeId, r]));
          const loose = placing.filter((c) => !byChange.has(c.id));
          if (loose.length > 0) {
            const names = await chartNames(conn, loose.map((c) => c.orgRoleId), []);
            const named = loose.map((c) => (typeof c.payload.name === "string" ? c.payload.name : names.get(c.orgRoleId) ?? c.orgRoleId));
            no(key, "circleHasRoles", `${answerRefusalWords("circleHasRoles", deps.agent)} ${named.join(", ")}.`);
            continue;
          }
          for (const c of placing) {
            const r = byChange.get(c.id);
            if (r && !out.includes(r)) out.push(r);
          }
        }
      }
      await removeDraftChanges(conn, row.draftId, out.map((r) => r.draftChangeId).filter((x): x is string => !!x));
      touched.add(row.draftId);
      for (const r of out) {
        if (!undone.includes(r.key)) undone.push(r.key);
        unlink.push(r);
      }
    }
    for (const r of unlink) if (r.linkMade) await removeLink(conn, keyParts(r.key));
    await markUndone(conn, undone, { actorUserId: input.actor.userId, door: input.actor.door, byRoleId: input.actor.byRoleId });
    for (const id of Array.from(touched)) await withdrawEmptyDraft(conn, id);
    await conn.commit();
    if (undone.length > 0) {
      void recordEvent(pool, {
        kind: "org",
        text: `sera differences answered: ${undone.length} undone`,
        actorUserId: input.actor.userId,
        actorKind: "human",
        originModuleId: "saberra",
        audience: "admin",
      });
    }
    if (undone.length === 0 && refused.length > 0) return { status: 409, body: { error: refused[0].words, why: refused[0].why, undone, refused } };
    return { status: 200, body: { undone, refused } };
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    return failed("an undo", e, deps.agent);
  } finally {
    conn.release();
  }
}

/**
 * AN ANSWER LAPSES WHEN ITS DIFFERENCE LEAVES THE LIST (review 7). Run after
 * every read the sync keeps, under its lock. A keep, an apply, or a take that
 * went live answered one value of the service's; once a later read no longer
 * differs on that key (both sides agree, or the record is gone), or differs
 * only as ours ahead, that answer is spent. So the service sending the same
 * value again later is a new suggestion, never hidden by an old keep. Answers
 * in an open draft are the draft card's (R13) and are left alone. Says how
 * many lapsed.
 */
export async function lapseLeftAnswers(pool: Pool, read: () => Promise<DifferencesRead>): Promise<number> {
  const r = await read();
  const now = new Map(r.list.map((d) => [d.key, d]));
  const keys: string[] = [];
  for (const row of Array.from((r.answers ?? new Map<string, SettledRow>()).values())) {
    if (row.lapsed) continue;
    const spent = row.answer === "kept" || row.answer === "applied" || ((row.answer === "taken" || row.answer === "edited") && row.draftStatus === "published");
    if (!spent) continue;
    const d = now.get(row.key);
    if (!d || d.state === "oursAhead") keys.push(row.key);
  }
  return lapseAnswers(pool, keys);
}
