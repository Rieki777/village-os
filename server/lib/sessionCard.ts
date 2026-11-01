/**
 * PULL A CARD: the rules between the routes and the tables (drizzle/0296).
 *
 * Anyone joined to an open live session may pull a card, as many times as
 * they like within the limits in `CARD_LIMITS` (Rye, 2026-10-30: "ANYONE can
 * pull a card and we can do it multiple times"). A pull reads:
 *
 *   - the sky of the day, sent by the puller's browser and checked here
 *     (`parseSky`), since the server may not hold the ephemeris;
 *   - the people present in the room right now, by the room's own presence
 *     window, and their names as the room shows them;
 *   - the charts of the present people who said yes to all three: lines shown,
 *     Maia allowed, not left out of cards (server/lib/geneKeys.ts
 *     `cardChartsFor`). Everyone else present is welcomed by name.
 *
 * Then the plain reading is built from those facts (shared/sessionCard.ts).
 * When an assistant key is set, Maia weaves the same facts into warmer words;
 * a weaving that is cut off, unreadable, too long, names nobody it should, or
 * trips the house voice check is thrown away and the plain card is served.
 *
 * WHAT EACH VIEWER RECEIVES. The collective reading, the suggestions and who
 * was welcomed go to everyone in the room. A person's own line goes only to
 * them, until they share it; then everyone in the room sees it (Rye chose
 * private by default, each free to share).
 *
 * A CARD LASTS AS LONG AS ITS SESSION, AND AS LONG AS EVERYONE IT READ STILL
 * SAYS YES. A job clears every closed or discarded session's cards each hour
 * (`clearClosedCards`), the way the arrival round's words are erased at close;
 * reading a closed session's cards answers none and writes nothing. Every
 * read re-asks the people a card read: when one has since hidden their lines,
 * stopped Maia, said no to cards or deleted their lines, the card is taken
 * back for everyone and deleted.
 *
 * MAIA NEVER SEES A NAME. A display name is member-written text, so the facts
 * she is handed call each person read `p1`, `p2` and so on, and give only a
 * count of the people welcomed. Her reply must use every key and no other; the
 * names go back in here, on the server.
 *
 * The session tables are read through their own repository and never written.
 */
import type { Pool } from "mysql2/promise";
import * as rooms from "../repos/liveSessions";
import * as cards from "../repos/sessionCards";
import { cardChartsFor, cardStandingOf } from "./geneKeys";
import { cardReadableGeneKeys } from "../repos/geneKeys";
import { assistantKeyOwner, callAssistant, DEFAULT_ASSISTANT_MODEL, parseJsonReply, type AssistantRequest, type AssistantResult } from "./assistant";
import { recordAssistantUsage } from "./assistantUsage";
import { instanceIdentity } from "./identity";
import { voiceLint } from "../../shared/comms/voiceLint";
import { PRESENT_WINDOW_MS } from "../../shared/sessions";
import {
  CARD_LIMITS, callNames, parseSky, plainReading, readRoom, skyLines,
  type CardLine, type CardPerson, type CardReading, type CardSky, type CardSuggestion, type CardSystem, type CardView, type CardsAnswer, type RoomFacts,
} from "../../shared/sessionCard";

export type CardRefusal = { ok: false; status: number; error: string };
export type CardOutcome<T> = { ok: true; value: T } | CardRefusal;

const refuse = (status: number, error: string): CardRefusal => ({ ok: false, status, error });

export const CARD_REFUSALS = {
  notFound: "That session is not here.",
  closed: "This session has closed. Cards live only while it is open.",
  joinFirst: "Join the session to pull a card.",
  badSky: "The sky could not be read on this device. Try again.",
  tooSoon: "A card was just pulled. Read that one first.",
  full: "This session has pulled all the cards it can hold.",
  noCard: "That card is not in this session.",
  noLine: "This card has no line of yours to share.",
} as const;

/** Somebody's name for the card, by member id: the room's own lookup. */
export type NameOf = (userId: string) => Promise<string | null>;

export interface CardDeps {
  getPool(): Pool;
  nameOf: NameOf;
  /** The call path. Absent: `callAssistant`. Tests pass their own. */
  call?(req: AssistantRequest): Promise<AssistantResult>;
  /** Whether any assistant key is set. Absent: `assistantKeyOwner`. */
  ready?(): boolean;
  /** Whose key Maia would spend. Absent: `assistantKeyOwner`. */
  keyOwner?(): "own" | "platform" | "none";
  /** The village's limiter (`AppDeps.overLimit`). Absent: no card cap of its own. */
  overLimit?(key: string, max: number, windowMs: number): Promise<boolean>;
  now?(): number;
}

/**
 * Woven cards on the BORROWED platform key, per day. That key's day cap is
 * shared by every mode in the village (`assistant-platform-day`, 100 by
 * default), and a room pulling card after card could spend it for everyone.
 * Past either number the plain card is served. The village's own key does not
 * meet these: its own mode budget (`card`, 120 a day) still does.
 */
export const PLATFORM_WOVEN = { perMemberDay: 5, perVillageDay: 20 } as const;

// ── The room, read ──────────────────────────────────────────────────────────

interface Room {
  open: boolean;
  /** The viewer's place in the room: joined or not. */
  joined: boolean;
  /** Everyone present now, as member ids, in the order they joined. */
  present: string[];
}

/** The session as a card sees it, or null when there is no such session. */
async function roomFor(pool: Pool, sessionId: number, userId: string, now: number): Promise<Room | null> {
  const rows = await rooms.sessionRow(pool, sessionId);
  if (!rows.length) return null;
  const open = String(rows[0].status) === "open";
  const people = await rooms.peopleRows(pool, sessionId);
  const nos = people.map((p) => Number(p.member_no));
  const ids = new Map((await rooms.memberUserIdRows(pool, nos)).map((r) => [Number(r.no), String(r.user_id)]));
  const joined = people.some((p) => ids.get(Number(p.member_no)) === userId);
  const present = people
    // The room's own presence window (server/lib/liveSessions.ts `isPresentAt`).
    .filter((p) => p.last_seen_at != null && now - new Date(p.last_seen_at).getTime() <= PRESENT_WINDOW_MS)
    .map((p) => ids.get(Number(p.member_no)))
    .filter((id): id is string => !!id);
  // The puller is in the room by pulling, even between two presence beats.
  return { open, joined, present: joined && !present.includes(userId) ? [...present, userId] : present };
}

// ── Maia's weaving ──────────────────────────────────────────────────────────

const SYSTEMS: readonly CardSystem[] = ["human-design", "western", "both"];

const SYSTEM_PROMPT = [
  "You are Maia, the village guide, writing the card a live session pulls at its start.",
  "You are given the facts of the day's sky and of the people present, and a plain draft built from them.",
  "Weave the draft into a short collective reading the whole room reads together, and a few sentences for each person read.",
  "Each person read is called by a key, p1, p2 and so on. Write each person's key where their name goes, exactly as given, and name each key in the collective reading once. Use no other key and no name.",
  "Keep every fact as given: gate, line, channel and centre numbers and names, signs, phases, types and authorities. Add no fact, number, prediction or promise.",
  "It is a lens for being present: invite, never predict, never tell anyone what will happen, never steer anyone away from work or from each other.",
  "Label each collective paragraph with the system its facts come from: human-design, western, or both.",
  "Plain warm words, no headings, no lists, no emoji, no dashes between clauses. Each paragraph under 90 words, each person's line under 60.",
  'Reply with JSON only: {"collective":[{"system":"human-design","text":"..."}],"lines":{"p1":"..."}}, with one key in lines per person read, using their key.',
].join(" ");

const undash = (s: string): string => s.replace(/\s*[–—]\s*/g, ", ").trim();

/**
 * The facts as Maia is handed them: each person read by a key, never by a
 * name or a member id, and the people welcomed only as a count. The draft is
 * rebuilt from the keyed facts, so it holds no name either.
 */
function factsForMaia(f: RoomFacts): { data: unknown; keyOf: Map<string, string> } {
  const keyOf = new Map(f.people.map((p, i) => [p.userId, `p${i + 1}`]));
  const keyed: RoomFacts = {
    ...f,
    people: f.people.map((p) => ({
      ...p,
      name: keyOf.get(p.userId)!,
      together: p.together.map((t) => ({ ...t, withName: keyOf.get(t.withUserId) ?? "another" })),
    })),
    welcomed: [],
  };
  const draft = plainReading(keyed);
  return {
    keyOf,
    data: {
      sky: f.sky,
      skyInWords: skyLines(f),
      mood: f.mood,
      openCenters: f.openCenters,
      types: f.types,
      people: keyed.people.map((p) => ({
        key: p.name,
        type: p.type,
        authority: p.authority,
        profile: p.profile,
        todaysSunInTheirGate: p.sunInTheirGate,
        channelsTheSkyCompletes: p.lit,
        channelsMadeWithAnother: p.together.map((t) => ({ channel: t.channel, with: t.withName })),
      })),
      welcomedNotReadCount: f.welcomed.length,
      draft: { collective: draft.collective, lines: Object.fromEntries(keyed.people.map((p) => [p.name, draft.lines[p.userId]])) },
    },
  };
}

const KEY = /\b[pP](\d+)\b/g;

/** Every key in `text` swapped for its name, or null when a key names nobody read. */
function unkey(text: string, names: readonly string[]): string | null {
  let bad = false;
  const out = text.replace(KEY, (_m, n: string) => {
    const name = names[Number(n) - 1];
    if (!name) bad = true;
    return name ?? "";
  });
  return bad ? null : out;
}

/** Whether a woven card may be asked for at all on this key, today. */
async function mayWeave(deps: CardDeps, pulledBy: string): Promise<boolean> {
  if ((deps.keyOwner ?? assistantKeyOwner)() !== "platform" || !deps.overLimit) return true;
  const day = 24 * 60 * 60 * 1000;
  if (await deps.overLimit(`session-card-woven:${pulledBy}`, PLATFORM_WOVEN.perMemberDay, day)) return false;
  return !(await deps.overLimit("session-card-woven:village", PLATFORM_WOVEN.perVillageDay, day));
}

/** Maia's reading, or null for "serve the plain one". Never an error the room sees. */
export async function weaveReading(deps: CardDeps, f: RoomFacts, draft: CardReading, pulledBy: string): Promise<CardReading | null> {
  if (!f.people.length) return null;
  if (!(deps.ready ?? (() => assistantKeyOwner() !== "none"))()) return null;
  if (!(await mayWeave(deps, pulledBy))) return null;
  const { data, keyOf } = factsForMaia(f);
  // Key n is people[n - 1]: the names that go back in, here and nowhere else.
  const names = f.people.map((p) => p.name);
  const call = await (deps.call ?? callAssistant)({
    mode: "card",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: "Pull our card." }],
    model: DEFAULT_ASSISTANT_MODEL,
    clientIp: "session-card",
    burstKey: `assist-card:${pulledBy}`,
    userId: pulledBy,
    prefetch: [{ key: "card.facts", data }],
  });
  await noteUsage(deps.getPool(), call, pulledBy);
  if (!call.ok || call.stopReason === "max_tokens" || call.stopReason === "length") return null;
  const got = parseJsonReply<{ collective?: unknown; lines?: unknown }>(call.text, {});
  if (!Array.isArray(got.collective) || !got.lines || typeof got.lines !== "object") return null;
  const collective: CardLine[] = [];
  const keysSeen = new Set<string>();
  for (const c of got.collective.slice(0, 6)) {
    const system = (c as { system?: unknown })?.system;
    const raw = undash(String((c as { text?: unknown })?.text ?? ""));
    for (const m of Array.from(raw.matchAll(KEY))) keysSeen.add(`p${m[1]}`);
    const text = unkey(raw, names);
    if (!SYSTEMS.includes(system as CardSystem) || !text || text.length > CARD_LIMITS.paragraph) return null;
    collective.push({ system: system as CardSystem, text });
  }
  if (!collective.length) return null;
  // Everyone read is named in the collective reading, by their key, as the card promises.
  if (f.people.some((p) => !keysSeen.has(keyOf.get(p.userId)!))) return null;
  const lines: Record<string, string> = {};
  for (const p of f.people) {
    const line = unkey(undash(String((got.lines as Record<string, unknown>)[keyOf.get(p.userId)!] ?? "")), names);
    if (!line || line.length > CARD_LIMITS.line) return null;
    lines[p.userId] = line;
  }
  // Words that still trip the house voice check are served plain instead.
  if ([...collective.map((c) => c.text), ...Object.values(lines)].some((t) => voiceLint(t, "body").length > 0)) return null;
  return { ...draft, collective, lines, source: "maia" };
}

async function noteUsage(pool: Pool, call: AssistantResult, userId: string): Promise<void> {
  const paid = call.ok ? { keySource: call.keySource, usage: call.usage, iterations: call.iterations, stopReason: call.stopReason } : call.spent;
  if (!paid) return;
  try {
    await recordAssistantUsage(pool, {
      villageId: instanceIdentity().instanceId,
      mode: "card",
      model: DEFAULT_ASSISTANT_MODEL,
      keySource: paid.keySource,
      userId,
      usage: paid.usage,
      iterations: paid.iterations,
      stopReason: paid.stopReason,
      path: "prefetch",
    });
  } catch (e) {
    console.error("[session-card] the card's assistant usage was not recorded", e);
  }
}

// ── What a viewer receives ──────────────────────────────────────────────────

interface StoredReading {
  collective: CardLine[];
  suggestions: CardSuggestion[];
  welcomed: string[];
  source: "plain" | "maia";
}

function readStored(raw: unknown): StoredReading {
  const r = (raw ?? {}) as Partial<StoredReading>;
  return {
    collective: Array.isArray(r.collective) ? r.collective.filter((c) => c && typeof c.text === "string" && SYSTEMS.includes(c.system)) : [],
    suggestions: Array.isArray(r.suggestions) ? r.suggestions.filter((s) => s && typeof s.words === "string") : [],
    welcomed: Array.isArray(r.welcomed) ? r.welcomed.filter((w): w is string => typeof w === "string") : [],
    source: r.source === "maia" ? "maia" : "plain",
  };
}

const someone = (n: string | null): string => (n && n.trim() ? n.trim() : "Someone");
const firstOf = (n: string): string => n.split(/\s+/)[0] || n;

async function cardsAnswer(deps: CardDeps, pool: Pool, sessionId: number, userId: string, room: Room): Promise<CardsAnswer> {
  let rows = await cards.cardsOf(pool, sessionId);
  let lines = await cards.linesOf(pool, rows.map((r) => r.id));
  // Everyone a card READ must still say yes to being read, today, by the same
  // rule a pull uses. A card that read somebody who has since withdrawn is
  // taken back for everyone, and deleted.
  const read = Array.from(new Set(lines.filter((l) => l.line != null).map((l) => l.userId)));
  const still = new Set((await cardReadableGeneKeys(pool, read)).map((r) => r.userId));
  const withdrawn = read.filter((id) => !still.has(id));
  if (withdrawn.length) {
    await cards.forgetCardsReading(pool, withdrawn);
    const gone = new Set(lines.filter((l) => l.line != null && withdrawn.includes(l.userId)).map((l) => l.cardId));
    rows = rows.filter((r) => !gone.has(r.id));
    lines = lines.filter((l) => !gone.has(l.cardId));
  }
  const names = new Map<string, string>();
  const nameOf = async (id: string) => {
    if (!names.has(id)) names.set(id, firstOf(someone(await deps.nameOf(id).catch(() => null))));
    return names.get(id)!;
  };
  const out: CardView[] = [];
  for (const r of rows) {
    const sky = parseSky(r.sky, Date.parse(r.createdAt));
    if (!sky) continue;
    const stored = readStored(r.reading);
    const mine = lines.find((l) => l.cardId === r.id && l.userId === userId);
    const shared = [];
    for (const l of lines) if (l.cardId === r.id && l.shared && l.line && l.userId !== userId) shared.push({ name: await nameOf(l.userId), line: l.line });
    out.push({
      id: r.id,
      n: r.n,
      pulledByName: await nameOf(r.pulledBy),
      pulledAt: r.createdAt,
      sky,
      ...stored,
      mine: mine?.line ?? null,
      mineShared: !!mine?.shared,
      shared,
    });
  }
  return {
    cards: out.reverse(),
    mayPull: room.open && room.joined,
    notRead: await cardStandingOf(pool, userId),
  };
}

/** The session's cards for this viewer, newest first. A closed session answers none; the hourly job deletes them. */
export async function readCards(deps: CardDeps, sessionId: number, userId: string, admin: boolean): Promise<CardOutcome<CardsAnswer>> {
  const pool = deps.getPool();
  const now = (deps.now ?? Date.now)();
  const room = await roomFor(pool, sessionId, userId, now);
  if (!room) return refuse(404, CARD_REFUSALS.notFound);
  if (!room.open) return { ok: true, value: { cards: [], mayPull: false, notRead: null } };
  if (!room.joined && !admin) return refuse(403, CARD_REFUSALS.joinFirst);
  return { ok: true, value: await cardsAnswer(deps, pool, sessionId, userId, room) };
}

/**
 * The line rows a card is written with: one for EVERY person present, their
 * own line when they were read and an empty row when they were welcomed.
 *
 * This is what erasure stands on. `forgetCardsNaming` finds a card by a line
 * row (or by who pulled it), and a card's words may name anybody present, so a
 * person the reading names with no row of their own would outlive their
 * erasure on the room's card. So the rule is checked here, before anything is
 * written: every line the reading holds belongs to somebody present, and every
 * name it welcomes is somebody present. A card that breaks it is not written.
 */
export function cardLinesFor(persons: readonly { userId: string; name: string }[], reading: Pick<CardReading, "lines" | "welcomed">): { userId: string; line: string | null }[] {
  const ids = new Set(persons.map((p) => p.userId));
  for (const id of Object.keys(reading.lines)) {
    if (!ids.has(id)) throw new Error(`[session-card] the reading holds a line for ${id}, who has no row on the card`);
  }
  const called = new Set(callNames(persons).values());
  for (const name of reading.welcomed) {
    if (!called.has(name)) throw new Error(`[session-card] the reading welcomes ${name}, who has no row on the card`);
  }
  return persons.map((p) => ({ userId: p.userId, line: reading.lines[p.userId] ?? null }));
}

/** Pull a card: read the room and the sky, write the reading, answer with every card. */
export async function pullCard(deps: CardDeps, sessionId: number, userId: string, body: unknown): Promise<CardOutcome<CardsAnswer>> {
  const pool = deps.getPool();
  const now = (deps.now ?? Date.now)();
  const sky: CardSky | null = parseSky((body as { sky?: unknown } | null)?.sky, now);
  if (!sky) return refuse(400, CARD_REFUSALS.badSky);
  const room = await roomFor(pool, sessionId, userId, now);
  if (!room) return refuse(404, CARD_REFUSALS.notFound);
  if (!room.open) return refuse(409, CARD_REFUSALS.closed);
  if (!room.joined) return refuse(403, CARD_REFUSALS.joinFirst);

  // The cheap refusals first, so a double tap never pays for a weaving.
  const before = await cards.cardCount(pool, sessionId);
  if (before.count >= CARD_LIMITS.perSession) return refuse(409, CARD_REFUSALS.full);
  if (before.lastAt != null && now - before.lastAt < CARD_LIMITS.gapSeconds * 1000) return refuse(429, CARD_REFUSALS.tooSoon);

  const charts = await cardChartsFor(pool, room.present);
  const persons: CardPerson[] = [];
  for (const id of room.present) persons.push({ userId: id, name: someone(await deps.nameOf(id).catch(() => null)), chart: charts.get(id) ?? null });
  const facts = readRoom(persons, sky);
  const plain = plainReading(facts);
  const reading = (await weaveReading(deps, facts, plain, userId)) ?? plain;

  const written = await rooms.inTransaction(pool, async (conn) => {
    // The session row's lock orders two pulls in one room, so each gets its own number.
    const s = await rooms.sessionRow(conn, sessionId, true);
    if (!s.length || String(s[0].status) !== "open") return refuse(409, CARD_REFUSALS.closed);
    const held = await cards.cardCount(conn, sessionId);
    if (held.count >= CARD_LIMITS.perSession) return refuse(409, CARD_REFUSALS.full);
    if (held.lastAt != null && now - held.lastAt < CARD_LIMITS.gapSeconds * 1000) return refuse(429, CARD_REFUSALS.tooSoon);
    const stored: StoredReading = { collective: reading.collective, suggestions: reading.suggestions, welcomed: reading.welcomed, source: reading.source };
    await cards.insertCard(conn, {
      sessionId,
      n: held.maxN + 1,
      pulledBy: userId,
      sky,
      reading: stored,
      lines: cardLinesFor(persons, reading),
    });
    return { ok: true as const, value: null };
  });
  if (!written.ok) return written;
  return { ok: true, value: await cardsAnswer(deps, pool, sessionId, userId, room) };
}

/** Share or unshare the viewer's own line on one card of this session. */
export async function shareLine(deps: CardDeps, sessionId: number, cardId: number, userId: string, body: unknown): Promise<CardOutcome<CardsAnswer>> {
  const shared = (body as { shared?: unknown } | null)?.shared;
  if (typeof shared !== "boolean") return refuse(400, "Sharing is a yes or a no.");
  const pool = deps.getPool();
  const room = await roomFor(pool, sessionId, userId, (deps.now ?? Date.now)());
  if (!room) return refuse(404, CARD_REFUSALS.notFound);
  if (!room.open) return refuse(409, CARD_REFUSALS.closed);
  if (!room.joined) return refuse(403, CARD_REFUSALS.joinFirst);
  const card = await cards.cardById(pool, cardId);
  if (!card || card.sessionId !== sessionId) return refuse(404, CARD_REFUSALS.noCard);
  if (!(await cards.setLineShared(pool, cardId, userId, shared))) return refuse(404, CARD_REFUSALS.noLine);
  return { ok: true, value: await cardsAnswer(deps, pool, sessionId, userId, room) };
}

// ── The hourly clear, erasure, and what the labels say ──────────────────────

/** Every closed session's cards, deleted. The route registers it as an hourly job. */
export async function clearClosedCards(pool: Pool): Promise<number> {
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const n = await cards.clearClosedCards(pool);
    total += n;
    if (n === 0) break;
  }
  return total;
}

/**
 * The `session-cards-after-tombstone` step of the erasure sweep
 * (server/lib/erasure.ts). It deletes every card that names the member, then
 * READS BACK: a card still naming them afterwards throws, so the sweep records
 * the step as not done and tries again, instead of trusting a count.
 */
export async function forgetMemberCards(pool: Pool, userId: string): Promise<number> {
  const uid = String(userId ?? "").trim();
  if (!uid) return 0;
  const gone = await cards.forgetCardsNaming(pool, uid);
  const left = await cards.cardsNamingCount(pool, uid);
  if (left > 0) throw new Error(`[session-card] erasure still names this member on ${left} card(s); the sweep will try again`);
  return gone;
}
