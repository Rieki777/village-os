/**
 * THE SERA DRAFT (spec section 7, "The Sera draft"; Rye, 3 November: "we have
 * a super transparent organisation", so the in-app draft is ON and check 46
 * is retired).
 *
 *   1. The member's Sera person comes from `sera_person_links`. None linked:
 *      the state says so, and the member adds items by hand.
 *   2. `ask_sera`'s input schema is read live (`listTools`), and it is called
 *      ONCE with a fixed question naming the member and the moon's dates.
 *   3. Each bullet or paragraph of the answer becomes one SUGGESTED item, its
 *      first link as evidence, no guessed role, Approvers only, private to the
 *      member until they keep it. One whose link matches a gathered item is
 *      dropped. At most 40. Emails and phone numbers are stripped.
 *   4. The whole draft stops at 90 seconds: an AbortSignal wrapped into the
 *      fetch the client uses, and the client's own `timeoutMs` now applied.
 *
 * NOTHING FROM THE MEMBER'S OWN LIST, JOURNAL OR RECAP IS SENT. The question
 * carries the member's name, their Sera person id and two dates, nothing else.
 *
 * Progress lives in `moon_recaps.sera_state`, read by polling `GET /api/me/moon`.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import {
  LIMITS, SERA_TIMEOUT_MS, SERA_WORDS, dayWords, evidenceUrlProblem, recapEditable, seraExternalId,
  type AskSeraResponse, type RecapItem, type SeraState,
} from "../../shared/moonRecap";
import { stripContact } from "../../shared/memberTaskFeedback";
import { looksLikePaymentDetails } from "../../shared/seatSettings";
import * as store from "../repos/moonRecaps";
import { libraryOwnerOf } from "../repos/memberTaskFeedback";
import { callToolJson, listTools, openSession, type ClientOptions, type ToolInfo } from "./saberraClient";
import type { Frame, Moon, Outcome } from "./moonRecap";

const newId = (prefix: string): string => `${prefix}-${crypto.randomBytes(8).toString("hex")}`;

/** The tool the draft asks. */
export const ASK_TOOL = "ask_sera";

export interface SeraDeps {
  /** The connection to the library, or null when the village has none (`preflight`, server/lib/saberraSync.ts). */
  client(): ClientOptions | null;
  nameOf(userId: string): Promise<string>;
  /** Overridable for the tests; the spec's 90 seconds otherwise. */
  timeoutMs?: number;
}

/** The fixed question: the member's name and the moon's dates, and what to bring back. */
export function seraQuestion(name: string, firstDay: string, lastDay: string): string {
  return `List the decisions, meetings, documents and tasks that ${name} took part in between ${dayWords(firstDay)} and ${dayWords(lastDay)}. ` +
    "Give one per line, each with its source link.";
}

/** The argument the question travels under, read from the tool's own schema. */
export function questionArgs(tool: ToolInfo | undefined, question: string, ownerId: string): Record<string, unknown> {
  const schema = (tool?.inputSchema ?? {}) as { properties?: Record<string, { type?: string }>; required?: string[] };
  const props = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const names = Object.keys(props);
  const q = ["question", "query", "prompt", "q", "message"].find((n) => names.includes(n))
    ?? (schema.required ?? []).find((n) => props[n]?.type === "string")
    ?? names.find((n) => props[n]?.type === "string")
    ?? "question";
  const args: Record<string, unknown> = { [q]: question };
  const owner = names.find((n) => /owner|person/i.test(n) && n !== q);
  if (owner) args[owner] = ownerId;
  return args;
}

const LINK = /https?:\/\/[^\s<>()"']+/i;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** The words of an answer, whatever shape it came back in. */
export function answerText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    for (const k of ["answer", "text", "result", "content"]) if (typeof v[k] === "string") return v[k] as string;
  }
  return "";
}

/**
 * THE ANSWER AS SUGGESTIONS: each bullet, or each paragraph that is not a
 * bullet list, is one item. Headings (a line ending in a colon, or one
 * starting with #) are not items. The first link is the evidence; the words
 * lose every email and phone number. One whose link a gathered item already
 * holds is dropped, and so is one naming a Sera task the recap already has.
 */
export function seraDraftItems(answer: string, existing: readonly Pick<RecapItem, "evidenceUrl" | "dedupeKey">[]): Array<{ text: string; link: string | null }> {
  const lines = answer.replace(/\r/g, "").split("\n");
  const chunks: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) chunks.push(para.join(" "));
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^#/.test(line) || (/:\s*$/.test(line) && !LINK.test(line))) {
      flush();
      continue;
    }
    if (BULLET.test(line)) {
      flush();
      chunks.push(line.replace(BULLET, ""));
    } else {
      para.push(line);
    }
  }
  flush();
  const urls = new Set(existing.map((i) => i.evidenceUrl).filter((u): u is string => !!u));
  const seraIds = existing.map((i) => seraExternalId(i)).filter((x): x is string => !!x && x.length >= 4);
  const out: Array<{ text: string; link: string | null }> = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    const found = LINK.exec(c)?.[0]?.replace(/[.,;:)\]]+$/, "") ?? null;
    const link = found && found.length <= LIMITS.evidenceUrl && evidenceUrlProblem(found) === null ? found : null;
    const words = stripContact(c.replace(LINK, " ").replace(/\[\s*\]|\(\s*\)/g, " ")).replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:-]+$/g, "").trim().slice(0, LIMITS.itemText);
    if (!words || looksLikePaymentDetails(words)) continue;
    if (link && (urls.has(link) || seraIds.some((id) => link.includes(id)))) continue;
    const key = (link ?? words).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: words, link });
    if (out.length >= LIMITS.seraItems) break;
  }
  return out;
}

/** The key one draft suggestion carries: never `sera:`, which names a library task the outbox may close. */
export function seraDraftKey(s: { text: string; link: string | null }): string {
  return `seradraft:${crypto.createHash("sha256").update(s.link ?? s.text.toLowerCase()).digest("hex").slice(0, 32)}`;
}

const state = (s: SeraState["state"], added: number, startedAt: string | null, line: string | null): SeraState => ({
  state: s, added, startedAt, finishedAt: s === "running" ? null : new Date().toISOString(), line,
});

/**
 * THE DRAFT ITSELF. Answers the final state; writes it, and every item, as it
 * goes. The route starts this without waiting and the member polls.
 */
export async function runSeraDraft(pool: Pool, recapId: string, userId: string, ownerId: string, moon: Moon, client: ClientOptions, deps: SeraDeps): Promise<SeraState> {
  const startedAt = new Date().toISOString();
  const ms = deps.timeoutMs ?? SERA_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(ms);
  // The deadline rides into every fetch the client makes, and the client's own per-call timeout is set too.
  const c: ClientOptions = { ...client, timeoutMs: ms, signal: deadline, fetchImpl: (url, init) => client.fetchImpl(url, { ...init, signal: init.signal ?? deadline }) };
  const fail = async (): Promise<SeraState> => {
    const s = state("failed", 0, startedAt, SERA_WORDS.failed);
    await store.setSeraState(pool, recapId, JSON.stringify(s));
    return s;
  };
  const session = await openSession(c);
  if (!session) return fail();
  const tools = await listTools(c, session);
  if (!tools.ok) return fail();
  const ask = tools.tools.find((t) => t.name === ASK_TOOL);
  if (!ask) return fail();
  const answer = await callToolJson(c, session, ASK_TOOL, questionArgs(ask, seraQuestion(await deps.nameOf(userId), moon.days.firstDay, moon.days.lastDay), ownerId));
  if (!answer.ok) return fail();

  const existing = await store.itemsOf(pool, recapId);
  let position = existing.length;
  let added = 0;
  for (const s of seraDraftItems(answerText(answer.value), existing)) {
    if (position >= LIMITS.items) break;
    const wrote = await store.insertItem(pool, {
      id: newId("mi"), recapId, origin: "sera", dedupeKey: seraDraftKey(s), text: s.text, originNote: null, doneOn: null, evidenceUrl: s.link,
      roleId: null, seasonGoalId: null, state: "suggested", visibility: "approvers", position, evidenceKind: s.link ? "sera" : null,
    });
    if (wrote) {
      added += 1;
      position += 1;
    }
  }
  const done = state("done", added, startedAt, SERA_WORDS.done);
  await store.setSeraState(pool, recapId, JSON.stringify(done));
  return done;
}

/**
 * `POST /api/me/moon/:cycle/ask-sera`. Answers at once with the state; the
 * draft runs in-process and writes its progress for the member to poll.
 * `wait` is for the tests, which read the final state directly.
 */
export async function askSera(pool: Pool, userId: string, moon: Moon, frame: Frame, deps: SeraDeps, wait = false): Promise<Outcome<AskSeraResponse>> {
  const recap = await store.ensureRecap(pool, { id: newId("mr"), userId, cycleId: moon.bounds.id, seasonId: frame.seasonId });
  if (!recapEditable(recap.status)) return { ok: false, status: 409, error: "not_editable" };
  const prior = recap.seraState ? (JSON.parse(recap.seraState) as SeraState) : null;
  if (prior?.state === "running" && prior.startedAt && Date.now() - Date.parse(prior.startedAt) < (deps.timeoutMs ?? SERA_TIMEOUT_MS) + 5000) {
    return { ok: true, value: { sera: prior } };
  }
  const ownerId = await libraryOwnerOf(pool, userId);
  if (!ownerId) {
    const s = state("not_linked", 0, null, SERA_WORDS.notLinked);
    await store.setSeraState(pool, recap.id, JSON.stringify(s));
    return { ok: true, value: { sera: s } };
  }
  const client = deps.client();
  if (!client) {
    const s = state("failed", 0, null, SERA_WORDS.failed);
    await store.setSeraState(pool, recap.id, JSON.stringify(s));
    return { ok: true, value: { sera: s } };
  }
  const running = state("running", 0, new Date().toISOString(), SERA_WORDS.running);
  await store.setSeraState(pool, recap.id, JSON.stringify(running));
  const job = runSeraDraft(pool, recap.id, userId, ownerId, moon, client, deps).catch(async () => {
    const s = state("failed", 0, running.startedAt, SERA_WORDS.failed);
    await store.setSeraState(pool, recap.id, JSON.stringify(s)).catch(() => undefined);
    return s;
  });
  if (wait) return { ok: true, value: { sera: await job } };
  return { ok: true, value: { sera: running } };
}
