/**
 * Live Sessions: the advice process. The store is server/repos/sessionAdvice.ts;
 * the doors are server/routes/sessionAdvice.ts; the shapes, rules and words are
 * shared/sessionAdvice.ts.
 *
 *   adviceFor       the requests a member made and the ones they were asked about
 *   askAdvice       ask a circle for advice on what you mean to decide
 *   giveAdvice      give your advice on a request you were asked about, or change it
 *   decideAdvice    the asker records what they decided
 *   withdrawAdvice  the asker withdraws the request
 *
 * ── WHO ──────────────────────────────────────────────────────────────────
 *
 * Any member may ask any live circle; everybody with standing in it is asked,
 * the asker aside (server/lib/sessionRhythm.ts `circleMemberUserIds`, the
 * audience a circle's meeting reminder reaches). A request is read by whoever
 * asked and the people asked, and by nobody else: to anybody else it does not
 * exist, and every refusal says so in the same words.
 *
 * The bells go after the write commits, from the doors: the people asked hear
 * they were asked, the asker hears each new piece of advice, and the people
 * asked hear what was decided.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import * as store from "../repos/sessionAdvice";
import * as room from "../repos/liveSessions";
import { ensureMemberNo, memberNo, namesFor, type MemberLookup, type Named, type Outcome, type Refusal } from "./liveSessions";
import { circleMemberUserIds } from "./sessionRhythm";
import { villageTimezone } from "./villageReaders";
import type { LapseContext } from "./orgChart";
import { villageKey } from "../../shared/sessionRhythm";
import { SESSION_SOMEONE } from "../../shared/sessions";
import {
  ADVICE_LIMITS,
  ADVICE_REFUSALS,
  cleanAdvice,
  cleanAdviceAsk,
  cleanDecision,
  isAdviceStatus,
  type AdvicePayload,
  type AdviceRequestCard,
} from "../../shared/sessionAdvice";

const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const toIso = (v: unknown): string => asDate(v).toISOString();

export interface AdviceDeps {
  circles: () => { id: string; name: string }[];
  lapseContext?: () => LapseContext;
  lookup: MemberLookup;
}

export interface AdviceAsker {
  userId: string;
  admin: boolean;
}

/** One request as one viewer reads it. */
function asCard(
  r: Record<string, unknown>,
  asks: readonly Record<string, unknown>[],
  viewerNo: number | null,
  names: ReadonlyMap<number, Named>,
  circleName: (id: string) => string,
  zone: string,
): AdviceRequestCard {
  const id = Number(r.id);
  const askerNo = Number(r.asker_no);
  const status = isAdviceStatus(r.status) ? r.status : "open";
  const open = status === "open";
  const mine = viewerNo != null && askerNo === viewerNo;
  const own = asks.filter((a) => Number(a.request_id) === id);
  const myAsk = viewerNo != null ? own.find((a) => Number(a.member_no) === viewerNo) : undefined;
  return {
    id,
    circleId: String(r.circle_id),
    circleName: circleName(String(r.circle_id)),
    askerName: names.get(askerNo)?.name ?? SESSION_SOMEONE,
    mine,
    intent: String(r.intent ?? ""),
    context: r.context == null ? null : String(r.context),
    decideBy: String(r.decide_by),
    status,
    decision: r.decision == null ? null : String(r.decision),
    settledOn: r.settled_at == null ? null : villageKey(asDate(r.settled_at), zone),
    askedCount: own.length,
    advice: own
      .filter((a) => a.advice != null)
      .map((a) => ({
        by: names.get(Number(a.member_no))?.name ?? SESSION_SOMEONE,
        words: String(a.advice),
        at: toIso(a.advised_at),
        mine: viewerNo != null && Number(a.member_no) === viewerNo,
      })),
    canAdvise: open && !!myAsk,
    myAdvice: myAsk?.advice == null ? null : String(myAsk.advice),
    canDecide: open && mine,
  };
}

/** Cards for some request rows, read for one viewer. */
async function cardsFor(q: Pool | PoolConnection, rows: readonly Record<string, unknown>[], viewerNo: number | null, deps: AdviceDeps): Promise<AdviceRequestCard[]> {
  if (!rows.length) return [];
  const asks = await store.askRows(q, rows.map((r) => Number(r.id)));
  const names = await namesFor(q, [...rows.map((r) => Number(r.asker_no)), ...asks.map((a) => Number(a.member_no))], deps.lookup);
  const circles = new Map(deps.circles().map((c) => [c.id, c.name]));
  const zone = villageTimezone();
  return rows.map((r) => asCard(r, asks, viewerNo, names, (id) => circles.get(id) ?? id, zone));
}

/** The requests a member made and the ones they were asked about, open first. */
export async function adviceFor(pool: Pool, who: AdviceAsker, deps: AdviceDeps, now = new Date()): Promise<AdvicePayload> {
  const today = villageKey(now, villageTimezone());
  const circles = deps.circles();
  const no = await memberNo(pool, who.userId);
  if (no == null) return { askedOfMe: [], mine: [], circles, today };
  return {
    askedOfMe: await cardsFor(pool, await store.requestsAskedOf(pool, no, ADVICE_LIMITS.settledShown), no, deps),
    mine: await cardsFor(pool, await store.requestsByAsker(pool, no, ADVICE_LIMITS.settledShown), no, deps),
    circles,
    today,
  };
}

/** One request read back for its viewer. */
async function cardOf(q: Pool | PoolConnection, id: number, viewerNo: number, deps: AdviceDeps): Promise<AdviceRequestCard> {
  const [row] = await store.requestRow(q, id);
  if (!row) throw new Error("live sessions: a request for advice just written could not be read back");
  return (await cardsFor(q, [row], viewerNo, deps))[0];
}

/**
 * Ask a circle for advice. Refused in this order: a body that does not read
 * (400), an asker with too many requests open (409), and a circle with nobody
 * else in it to ask (409). Hands back the request and who to tell.
 */
export async function askAdvice(
  pool: Pool,
  who: AdviceAsker,
  raw: unknown,
  deps: AdviceDeps,
  now = new Date(),
): Promise<Outcome<{ request: AdviceRequestCard; askedUserIds: string[] }>> {
  const today = villageKey(now, villageTimezone());
  const input = cleanAdviceAsk(raw, new Set(deps.circles().map((c) => c.id)), today);
  if (!input.ok) return refuse(400, input.error);
  const askerNo = await ensureMemberNo(pool, who.userId, now);
  if ((await store.openCount(pool, askerNo)) >= ADVICE_LIMITS.openPerAsker) return refuse(409, ADVICE_REFUSALS.tooManyOpen);
  const userIds = (await circleMemberUserIds(pool, input.value.circleId, deps.lapseContext)).filter((u) => u !== who.userId).slice(0, ADVICE_LIMITS.askedMax);
  if (!userIds.length) return refuse(409, ADVICE_REFUSALS.nobodyToAsk);
  const nos: number[] = [];
  for (const userId of userIds) nos.push(await ensureMemberNo(pool, userId, now));
  const id = await room.inTransaction(pool, async (conn) => {
    const requestId = await store.insertRequest(conn, { ...input.value, askerNo, now });
    await store.insertAsks(conn, requestId, nos, now);
    return requestId;
  });
  return done({ request: await cardOf(pool, id, askerNo, deps), askedUserIds: userIds });
}

/** A request this viewer may read, or the one refusal anybody else gets. */
async function visible(q: Pool | PoolConnection, id: number, no: number | null, lock = false): Promise<Outcome<{ row: Record<string, unknown>; asked: boolean; asker: boolean }>> {
  const [row] = Number.isInteger(id) && id > 0 && no != null ? await store.requestRow(q, id, lock) : [];
  if (!row || no == null) return refuse(404, ADVICE_REFUSALS.notFound);
  const asker = Number(row.asker_no) === no;
  const asked = (await store.askRows(q, [id])).some((a) => Number(a.member_no) === no);
  if (!asker && !asked) return refuse(404, ADVICE_REFUSALS.notFound);
  return done({ row, asked, asker });
}

/**
 * Give advice on a request you were asked about, or change it. Refused in
 * this order: a request the viewer may not read (404), a viewer who was not
 * asked (403), a request settled already (409), and words that do not read
 * (400). Hands back the request, and whoever asked to tell.
 */
export async function giveAdvice(
  pool: Pool,
  who: AdviceAsker,
  id: number,
  raw: unknown,
  deps: AdviceDeps,
  now = new Date(),
): Promise<Outcome<{ request: AdviceRequestCard; askerUserId: string | null; advisorName: string; first: boolean }>> {
  const no = await memberNo(pool, who.userId);
  const found = await visible(pool, id, no);
  if (!found.ok) return found;
  if (!found.value.asked) return refuse(403, ADVICE_REFUSALS.notAsked);
  if (found.value.row.status !== "open") return refuse(409, ADVICE_REFUSALS.settled);
  const words = cleanAdvice(raw);
  if (!words.ok) return refuse(400, words.error);
  const before = (await store.askRows(pool, [id])).find((a) => Number(a.member_no) === no);
  await store.putAdvice(pool, id, no!, words.value, now);
  const names = await namesFor(pool, [Number(found.value.row.asker_no), no!], deps.lookup);
  return done({
    request: await cardOf(pool, id, no!, deps),
    askerUserId: names.get(Number(found.value.row.asker_no))?.userId ?? null,
    advisorName: names.get(no!)?.name ?? SESSION_SOMEONE,
    first: before?.advice == null,
  });
}

/** The asker settles their own request, inside a transaction that holds its row. */
async function settle(
  pool: Pool,
  who: AdviceAsker,
  id: number,
  status: "decided" | "withdrawn",
  decision: string | null,
  deps: AdviceDeps,
  now: Date,
): Promise<Outcome<{ request: AdviceRequestCard; askedUserIds: string[]; askerName: string }>> {
  const no = await memberNo(pool, who.userId);
  const out = await room.inTransaction(pool, async (conn): Promise<Outcome<null>> => {
    const found = await visible(conn, id, no, true);
    if (!found.ok) return found;
    if (!found.value.asker) return refuse(403, ADVICE_REFUSALS.notYours);
    if (!(await store.settleRequest(conn, id, status, decision, now))) return refuse(409, ADVICE_REFUSALS.settled);
    return done(null);
  });
  if (!out.ok) return out;
  const asks = await store.askRows(pool, [id]);
  const names = await namesFor(pool, [no!, ...asks.map((a) => Number(a.member_no))], deps.lookup);
  return done({
    request: await cardOf(pool, id, no!, deps),
    askedUserIds: asks.map((a) => names.get(Number(a.member_no))?.userId).filter((u): u is string => !!u),
    askerName: names.get(no!)?.name ?? SESSION_SOMEONE,
  });
}

/**
 * The asker records what they decided. Refused in this order: words that do
 * not read (400), a request the viewer may not read (404), a viewer who did
 * not ask (403), and a request settled already (409).
 */
export async function decideAdvice(pool: Pool, who: AdviceAsker, id: number, raw: unknown, deps: AdviceDeps, now = new Date()) {
  const decision = cleanDecision(raw);
  if (!decision.ok) return refuse(400, decision.error);
  return settle(pool, who, id, "decided", decision.value, deps, now);
}

/** The asker withdraws the request. Refused like a decision, words aside. */
export async function withdrawAdvice(pool: Pool, who: AdviceAsker, id: number, deps: AdviceDeps, now = new Date()) {
  return settle(pool, who, id, "withdrawn", null, deps, now);
}

// ── The member's own ────────────────────────────────────────────────────────

/** What the advice process holds about a member, for the export: the requests they made, and the advice they gave. */
export async function exportAdviceFor(pool: Pool, no: number): Promise<{ adviceAsked: Record<string, unknown>[]; adviceGiven: Record<string, unknown>[] }> {
  const adviceAsked = (await store.memberRequests(pool, no)).map((r) => ({
    id: Number(r.id),
    circleId: String(r.circle_id),
    intent: String(r.intent ?? ""),
    context: r.context == null ? null : String(r.context),
    decideBy: String(r.decide_by),
    status: String(r.status),
    decision: r.decision == null ? null : String(r.decision),
    askedAt: toIso(r.created_at),
  }));
  const adviceGiven = (await store.memberAdvice(pool, no)).map((r) => ({ requestId: Number(r.request_id), advice: String(r.advice), at: toIso(r.advised_at) }));
  return { adviceAsked, adviceGiven };
}

/** The member leaves, inside the erasure's transaction. */
export async function forgetAdviceFor(conn: PoolConnection, no: number): Promise<void> {
  await store.forgetMember(conn, no);
}
