/**
 * THE ALIGNMENT STORE'S SUBJECTS, AND THE `seat_terms` ADAPTER (seat settings PR5).
 *
 * A subject is something a member can align with. Today there is one,
 * `seat_terms`: the terms an application to hold seats sets
 * (server/routes/seatApplications.ts). This file turns one into a TEXT and its
 * PARTIES, records each party's act of aligning, derives whether the text is in
 * force, and, once every required party has aligned, SEALS it and tells the
 * parties. It writes through server/repos/alignments.ts, which only inserts.
 *
 * ── THE TEXT ───────────────────────────────────────────────────────────────
 *
 * The words come from `renderSeatTermsText` (shared/alignments.ts), over the
 * seat names and the application's stored settings. They are what the wizard's
 * Review step showed and what the application page shows. The hash is salted:
 *
 *   content_hash = sha256(canonicalJson({salt, subjectType, subjectRef,
 *                         version, title, body, settings, parties}))
 *
 * The salt is 32 random bytes, so nobody can walk a list of plausible
 * stipends to find the one a hash came from. It is served to the parties and
 * to members reading the page, never to anybody else.
 *
 * ── PARTIES ────────────────────────────────────────────────────────────────
 *
 * Seat terms bind two: `user:<candidate>` ("individually") and `village`
 * ("for the village"). The candidate aligns when they propose, in the same
 * transaction that writes the application, so they never click twice. The
 * village aligns when it adopts: the holder's adopt click (`holder`) or the
 * landed ballot (`ballot`), which first checks the text's hash is the one the
 * application recorded.
 *
 * ── SEALING ────────────────────────────────────────────────────────────────
 *
 * With every required party aligned, the receipt is `signDocument` over
 * {textId, version, contentHash, parties, alignments}: the hash and the party
 * list, never the words, so an erasure that scrubs a name from the words never
 * breaks a seal. When this village cannot sign (`canSign()` false: the key is
 * sealed and its secret is missing), the terms still come into force,
 * "unsealed", and the hourly sweep seals them once the key is back.
 *
 * ── TELLING THE PARTIES ────────────────────────────────────────────────────
 *
 * Each party hears ONCE that the terms are in force, keyed
 * `alignment:<textId>:<partyKey>:in-force`, with the seat names and a link
 * only. No `recordEvent` and no `addActivity`: both reach the village's public
 * record, and the alignment row is the record.
 */
import crypto from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import { canonicalJson } from "../../shared/canonicalJson";
import {
  CAPACITY,
  carriesMoney,
  deriveAlignmentState,
  intentSentence,
  renderSeatTermsText,
  SEAT_TERMS,
  userParty,
  VILLAGE_PARTY,
  type AlignMethod,
  type DerivedState,
} from "../../shared/alignments";
import { applicationHref, seatList, STATUS_WORDS } from "../../shared/seatApplications";
import type { SeatSettings } from "../../shared/seatSettings";
import { civilDateKey } from "../../shared/lunar";
import {
  alignmentsOf,
  insertAlignment,
  insertParty,
  insertSeal,
  insertText,
  partiesOf,
  readText,
  sealsOf,
  seatingFacts,
  textsToSettle,
  type StoredAlignment,
  type StoredParty,
  type StoredText,
} from "../repos/alignments";
import { readApplications, seatsForUpdate, setApplicationText, type StoredApplication } from "../repos/seatApplications";
import { canSign, signDocument, signingKey } from "./villageExport";

type Db = Pool | PoolConnection;

export { SEAT_TERMS };

const newId = (prefix: string) => `${prefix}-${crypto.randomBytes(8).toString("hex")}`;

/** sha256 over the canonical bytes, lowercase hex. */
export function contentHashOf(input: {
  salt: string;
  subjectType: string;
  subjectRef: string;
  version: number;
  title: string;
  body: string;
  settings: SeatSettings | null;
  parties: ReadonlyArray<Pick<StoredParty, "partyKey" | "capacity" | "required">>;
}): string {
  const parties = [...input.parties]
    .map((p) => ({ partyKey: p.partyKey, capacity: p.capacity, required: p.required }))
    .sort((a, b) => (a.partyKey < b.partyKey ? -1 : a.partyKey > b.partyKey ? 1 : 0));
  // Named fields only: a stored row or a downloaded copy carries more, and none of it is hashed.
  const bytes = canonicalJson({
    salt: input.salt,
    subjectType: input.subjectType,
    subjectRef: input.subjectRef,
    version: input.version,
    title: input.title,
    body: input.body,
    settings: input.settings ?? null,
    parties,
  });
  return crypto.createHash("sha256").update(bytes, "utf8").digest("hex");
}

// ── The seat_terms adapter ───────────────────────────────────────────────────

export interface PreparedText {
  text: Omit<StoredText, "createdAt" | "redactedAt">;
  parties: StoredParty[];
  seatNames: string[];
}

/** The seats' names, in the order the application lists them. */
export async function seatNamesFor(db: Db, seatIds: readonly string[]): Promise<string[]> {
  const seats = await seatsForUpdate(db, seatIds);
  return seatIds.map((id) => seats.find((s) => s.id === id)?.name ?? id);
}

/**
 * The words for an application, rendered from its seats and terms. Exported
 * so the Review step's preview and the stored text are one rendering.
 */
export function seatTermsWords(seatNames: readonly string[], settings: SeatSettings) {
  return renderSeatTermsText(seatNames, settings);
}

/** The text's window: from the first day it names, to the last day of its term, in the village's calendar. */
function windowOf(app: Pick<StoredApplication, "startsAt" | "termEndsAt">, timezone: string): { from: string | null; to: string | null } {
  const tz = timezone || "UTC";
  return {
    from: app.startsAt ? civilDateKey(app.startsAt, tz) : null,
    // The term ends AT this instant, so its last whole day is the one before.
    to: app.termEndsAt ? civilDateKey(new Date(app.termEndsAt.getTime() - 1), tz) : null,
  };
}

/** Version 1 of an application's text, ready to insert. Pure apart from the salt. */
export function prepareSeatTermsText(
  app: Pick<StoredApplication, "id" | "candidateUserId" | "settings" | "startsAt" | "termEndsAt">,
  seatNames: readonly string[],
  createdBy: string,
  timezone: string,
): PreparedText {
  const { title, body } = renderSeatTermsText(seatNames, app.settings);
  const id = newId("at");
  const parties: StoredParty[] = [
    { textId: id, partyKey: userParty(app.candidateUserId), userId: app.candidateUserId, capacity: CAPACITY.individually, required: true },
    { textId: id, partyKey: VILLAGE_PARTY, userId: null, capacity: CAPACITY.forTheVillage, required: true },
  ];
  const salt = crypto.randomBytes(32).toString("hex");
  const w = windowOf(app, timezone);
  const contentHash = contentHashOf({
    salt,
    subjectType: SEAT_TERMS,
    subjectRef: app.id,
    version: 1,
    title,
    body,
    settings: app.settings,
    parties,
  });
  return {
    text: {
      id,
      subjectType: SEAT_TERMS,
      subjectRef: app.id,
      version: 1,
      title,
      body,
      settings: app.settings,
      salt,
      contentHash,
      supersedesId: null,
      effectiveFrom: w.from,
      effectiveTo: w.to,
      createdBy,
    },
    parties,
    seatNames: [...seatNames],
  };
}

/** Write a prepared text and its parties, inside the caller's transaction. */
export async function writePreparedText(conn: Db, p: PreparedText): Promise<void> {
  await insertText(conn, p.text);
  for (const party of p.parties) await insertParty(conn, party);
}

/** Record one party's act of aligning. True when it landed, false when they already had. */
export async function recordAlignment(
  conn: Db,
  input: { textId: string; partyKey: string; userId: string | null; contentHash: string; intent: string; method: AlignMethod; authorityRef: string | null },
): Promise<boolean> {
  return insertAlignment(conn, {
    id: newId("al"),
    textId: input.textId,
    partyKey: input.partyKey,
    userId: input.userId,
    contentHash: input.contentHash,
    intentText: input.intent.slice(0, 300),
    method: input.method,
    authorityRef: input.authorityRef ? input.authorityRef.slice(0, 64) : null,
  });
}

/**
 * The text an application's words live in, writing version 1 first when the
 * application came before PR5 (the retrofit). The words render from the
 * stored, never-updated `settings_json`, so they are the terms the village was
 * asked about. Inside the caller's transaction.
 */
export async function ensureApplicationText(
  conn: Db,
  app: StoredApplication,
  createdBy: string,
  timezone: string,
): Promise<StoredText> {
  if (app.textId) {
    const t = await readText(conn, app.textId);
    if (t) return t;
  }
  const prepared = prepareSeatTermsText(app, await seatNamesFor(conn, app.seatIds), createdBy, timezone);
  await writePreparedText(conn, prepared);
  const claimed = await setApplicationText(conn, app.id, prepared.text.id, prepared.text.contentHash);
  if (!claimed) {
    // Another door wrote the text a moment ago; ours never commits.
    throw Object.assign(new Error("the application gained a text while this one was written"), { code: "AT_RACED" });
  }
  return (await readText(conn, prepared.text.id)) as StoredText;
}

/**
 * The village aligns, by a holder's adopt click or a landed ballot. Inside the
 * adoption's transaction. Refuses when the text's hash is not the one the
 * application recorded: the village adopts the words it was asked about, or
 * nothing.
 */
export async function recordVillageAlignment(
  conn: Db,
  app: StoredApplication,
  how: { method: "holder" | "ballot"; authorityRef: string; actorId: string },
  timezone: string,
): Promise<{ ok: true; textId: string } | { ok: false; why: string }> {
  const text = await ensureApplicationText(conn, app, how.actorId, timezone);
  const recorded = app.textHash ?? text.contentHash;
  if (text.contentHash !== recorded) {
    return { ok: false, why: "The words this adoption would align with are not the words the application recorded, so nothing was changed." };
  }
  const names = await seatNamesFor(conn, app.seatIds);
  await recordAlignment(conn, {
    textId: text.id,
    partyKey: VILLAGE_PARTY,
    userId: how.method === "holder" ? how.actorId : null,
    contentHash: text.contentHash,
    intent: intentSentence(names, true),
    method: how.method,
    authorityRef: how.authorityRef,
  });
  return { ok: true, textId: text.id };
}

// ── In force, derived ────────────────────────────────────────────────────────

export interface TextView {
  text: StoredText;
  parties: StoredParty[];
  alignments: StoredAlignment[];
  sealed: boolean;
  receipt: Record<string, any> | null;
  application: StoredApplication | null;
  seatNames: string[];
  derived: DerivedState;
}

/** Statuses that close an application before its terms could hold. */
const CLOSED: Partial<Record<string, string>> = {
  withdrawn: `${STATUS_WORDS.withdrawn}.`,
  "not-adopted": `${STATUS_WORDS["not-adopted"]}.`,
};

/**
 * Everything about some texts, with their state derived now. A fixed number
 * of reads whatever the number of texts (red team D8): the applications, their
 * seatings and their seats' names are each read once for the whole list.
 *
 * A TERM THAT FOLLOWS THE SEASON MOVES WITH IT (red team G7). The text's
 * stored window end is the term as it stood when the application was written;
 * when the admin moves the season's end, the seating's term moves, so for such
 * an application the window ends with the open seating's term instead.
 */
export async function viewTexts(db: Db, texts: readonly StoredText[], today: string, timezone = "UTC"): Promise<TextView[]> {
  const ids = texts.map((t) => t.id);
  const appIds = Array.from(new Set(texts.filter((t) => t.subjectType === SEAT_TERMS).map((t) => t.subjectRef)));
  const [parties, alignments, seals, apps, facts] = await Promise.all([
    partiesOf(db, ids),
    alignmentsOf(db, ids),
    sealsOf(db, ids),
    readApplications(db, appIds),
    seatingFacts(db, appIds),
  ]);
  const seatIds = Array.from(new Set(apps.flatMap((a) => a.seatIds)));
  const seats = await seatsForUpdate(db, seatIds);
  const nameOfSeat = (id: string) => seats.find((s) => s.id === id)?.name ?? id;
  const out: TextView[] = [];
  for (const text of texts) {
    const app = text.subjectType === SEAT_TERMS ? (apps.find((a) => a.id === text.subjectRef) ?? null) : null;
    const fact = app ? facts.get(app.id) : undefined;
    const seatings = app ? { open: fact?.open ?? 0, total: fact?.total ?? 0 } : null;
    const effectiveTo =
      app?.termFollowsSeason && fact?.openEndsAt ? civilDateKey(new Date(fact.openEndsAt.getTime() - 1), timezone || "UTC") : text.effectiveTo;
    const mine = parties.filter((p) => p.textId === text.id);
    const aligned = alignments.filter((a) => a.textId === text.id);
    const seal = seals.find((s) => s.textId === text.id) ?? null;
    out.push({
      text,
      parties: mine,
      alignments: aligned,
      sealed: !!seal,
      receipt: seal?.receipt ?? null,
      application: app,
      seatNames: app ? app.seatIds.map(nameOfSeat) : [],
      derived: deriveAlignmentState({
        contentHash: text.contentHash,
        parties: mine,
        alignments: aligned,
        effectiveFrom: text.effectiveFrom,
        effectiveTo,
        today,
        seatings: text.subjectType === SEAT_TERMS ? (seatings ?? { open: 0, total: 0 }) : null,
        closed: app ? (CLOSED[app.status] ?? null) : null,
      }),
    });
  }
  return out;
}

export async function viewText(db: Db, textId: string, today: string, timezone = "UTC"): Promise<TextView | null> {
  const t = await readText(db, textId);
  return t ? ((await viewTexts(db, [t], today, timezone))[0] ?? null) : null;
}

// ── Seal and tell ────────────────────────────────────────────────────────────

export interface SettleDeps {
  getPool: () => Pool;
  notify: (input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; actorUserId?: string | null; dedupeKey: string }) => Promise<unknown>;
  notifyAdmins: (type: string, title: string, dedupeKey: string, link?: string) => Promise<unknown>;
  /** Today in the village's calendar, YYYY-MM-DD. */
  today: () => string;
}

/** The receipt's document: the hash and who aligned, never the words. */
export function receiptDocument(v: Pick<TextView, "text" | "parties" | "alignments">) {
  return {
    kind: "alignment-receipt",
    textId: v.text.id,
    subjectType: v.text.subjectType,
    version: v.text.version,
    contentHash: v.text.contentHash,
    parties: [...v.parties]
      .sort((a, b) => (a.partyKey < b.partyKey ? -1 : 1))
      .map((p) => ({ partyKey: p.partyKey, capacity: p.capacity, required: p.required })),
    alignments: v.alignments.map((a) => ({
      partyKey: a.partyKey,
      contentHash: a.contentHash,
      method: a.method,
      authorityRef: a.authorityRef,
      at: a.at.toISOString(),
    })),
  };
}

/**
 * Seal a text whose required parties have all aligned, when this village can
 * sign. False when it cannot yet, or it was already sealed.
 */
export async function sealIfReady(db: Db, v: TextView): Promise<boolean> {
  if (v.sealed || !v.derived.allAligned || !canSign()) return false;
  const signed = signDocument(receiptDocument(v), signingKey(), new Date().toISOString());
  return insertSeal(db, v.text.id, signed);
}

/**
 * After anything that may have completed a text: seal it if it can be sealed,
 * and tell each party once if it is now in force.
 */
export async function settleText(deps: SettleDeps, textId: string): Promise<TextView | null> {
  const pool = deps.getPool();
  const v = await viewText(pool, textId, deps.today());
  if (!v) return null;
  if (v.derived.state === "in-force") {
    const seats = seatList(v.seatNames);
    const title = `Aligned and in force: the terms for ${seats}`;
    const link = v.application ? applicationHref(v.application.id) : null;
    for (const p of v.parties) {
      const key = `alignment:${v.text.id}:${p.partyKey}:in-force`.slice(0, 191);
      if (p.userId) {
        await deps.notify({ userId: p.userId, type: "governance", title, body: null, link, actorUserId: null, dedupeKey: key });
      } else if (p.partyKey === VILLAGE_PARTY) {
        // The village is told through the holder who aligned for it, or, for a vote, its admins.
        const holder = v.alignments.find((a) => a.partyKey === VILLAGE_PARTY && a.method === "holder" && a.userId)?.userId ?? null;
        if (holder) await deps.notify({ userId: holder, type: "governance", title, body: null, link, actorUserId: null, dedupeKey: key });
        else await deps.notifyAdmins("governance", title, key, link ?? undefined);
      }
    }
  }
  if (await sealIfReady(pool, v)) return viewText(pool, textId, deps.today());
  return v;
}

/** The hourly sweep: seal what can now be sealed, and tell parties of terms that came into force by any door. */
export async function settleAll(deps: SettleDeps): Promise<string> {
  const ids = await textsToSettle(deps.getPool());
  let sealed = 0;
  for (const id of ids) {
    const before = await viewText(deps.getPool(), id, deps.today());
    const after = await settleText(deps, id);
    if (before && !before.sealed && after?.sealed) sealed += 1;
  }
  return `${ids.length} text(s) read, ${sealed} sealed`;
}

// ── What a reader is served ──────────────────────────────────────────────────

export interface PartyChip {
  partyKey: string;
  /** A display name, "The village", or "A former member". Never an id. */
  label: string;
  capacity: string;
  required: boolean;
  aligned: boolean;
  /** When they aligned, ISO. */
  at: string | null;
  method: AlignMethod | null;
}

export interface ServedAlignment {
  textId: string | null;
  title: string;
  body: string;
  version: number;
  seatNames: string[];
  href: string | null;
  state: DerivedState["state"];
  why: string | null;
  sealed: boolean;
  /** True when the terms record money, so aligning may ask the re-confirm. */
  money: boolean;
  parties: PartyChip[];
  /** The reader's own place, when they are a party. */
  you: { partyKey: string; aligned: boolean; alignedAt: string | null; mayAlign: boolean } | null;
  /** On member pages and receipts only. Never on a public surface. */
  contentHash: string | null;
  createdAt: string | null;
}

type NameOf = (userId: string) => Promise<string | null>;

/** A view as a member reads it. `withHash` for a party or a member page; never for anything public. */
export async function presentView(v: TextView, viewerId: string | null, nameOf: NameOf, withHash: boolean): Promise<ServedAlignment> {
  const parties: PartyChip[] = [];
  for (const p of v.parties) {
    const a = v.alignments.find((x) => x.partyKey === p.partyKey && x.contentHash === v.text.contentHash) ?? null;
    parties.push({
      partyKey: p.partyKey,
      label: p.partyKey === VILLAGE_PARTY ? "The village" : ((p.userId ? await nameOf(p.userId) : null) ?? "A former member"),
      capacity: p.capacity,
      required: p.required,
      aligned: !!a,
      at: a ? a.at.toISOString() : null,
      method: a?.method ?? null,
    });
  }
  const mine = viewerId ? parties.find((p) => p.partyKey === userParty(viewerId)) ?? null : null;
  return {
    textId: v.text.id,
    title: v.text.title,
    body: v.text.body,
    version: v.text.version,
    seatNames: v.seatNames,
    href: v.application ? applicationHref(v.application.id) : null,
    state: v.derived.state,
    why: v.derived.why,
    sealed: v.sealed,
    money: carriesMoney(v.text.settings),
    parties,
    you: mine ? { partyKey: mine.partyKey, aligned: mine.aligned, alignedAt: mine.at, mayAlign: !mine.aligned && v.derived.state !== "ended" } : null,
    contentHash: withHash ? v.text.contentHash : null,
    createdAt: v.text.createdAt ? v.text.createdAt.toISOString() : null,
  };
}
