/**
 * The Journal's outbox: every save lands on this device first.
 *
 * A member writes on a phone, often on a bad link, sometimes on none. So a
 * save never goes straight to the server. It is written here, under a
 * `clientId` generated on the device, and only then sent; a send that
 * succeeds removes it, and one that fails leaves it here to try again on the
 * next page load, the next `online` event, or a tap on "Sync now". The server
 * treats a POST with a `clientId` it already holds as a no-op
 * (shared/journal.ts), so sending the same item twice is safe, which is what
 * makes "try again" a safe default.
 *
 * WHOSE ITEM IT IS. Each item carries the id of the member who wrote it, and
 * a flush sends only the signed-in member's own. Without that, a shared
 * device would post one person's offline entry into whoever signed in next.
 *
 * WHICH SESSION SENDS IT. Filtering by owner is not enough on its own: the
 * token rides on every request, and the token in storage can change under a
 * running flush (a sign-out and a sign-in on a slow link) or already belong
 * to somebody else (a second tab signed in as another member while this one
 * still shows the first). So a flush reads the token ONCE, proves it is the
 * owner's, sends every item with that token explicitly, and stops the moment
 * the stored token is no longer the one it started with, or the server says
 * 401. Whatever it did not send stays here for the owner's next session.
 *
 * A SEND THAT HANGS ENDS. Every request has a time limit, and running out of
 * it counts as no connection. One stalled POST used to hold the per-member
 * flush for minutes, and every Save and "Sync now" queued behind it.
 *
 * A REFUSAL IS NOT A RETRY. A 4xx the server will give again (a 400 for a
 * date a day ahead, say) marks the item refused, with the server's sentence.
 * A flush leaves a refused item alone; the member tries it again after
 * fixing what the sentence names, or removes it from the device.
 *
 * All storage goes through safeStorage. A browser that refuses storage cannot
 * hold the outbox, and `saveEntry` then sends directly and says so.
 */
import type { JournalEntryInput } from "@shared/journal";
import { isJournalDepth, isJournalPractice } from "@shared/journal";
import { authToken, gameFetch } from "./gameApi";
import { refusalOf } from "./journalApi";
import { readStoredJson, writeStoredJson } from "./safeStorage";

export const OUTBOX_KEY = "village.journal.outbox";
/** Fired on window whenever the outbox changes, so a list can re-read it. */
export const OUTBOX_EVENT = "journal-outbox-changed";

/** How long one request may hang before it counts as no connection. */
export const SEND_TIMEOUT_MS = 20_000;
/**
 * How long a Save holds its button. Past this the entry is safe on the
 * device, the page says so, and the send carries on behind it.
 */
export const SAVE_WAIT_MS = 10_000;

export interface OutboxItem {
  /** The member who wrote it. Only their session ever sends it. */
  owner: string;
  entry: JournalEntryInput;
  queuedAt: string;
  attempts: number;
  /** The last refusal, in words, or null when it has not been tried. */
  lastError: string | null;
  /**
   * True when the server refused it for a reason sending again cannot
   * change. A flush skips it until the member tries it again.
   */
  refused?: boolean;
}

export interface FlushResult {
  /** clientIds the server accepted, now gone from the outbox. */
  sent: string[];
  /** clientIds still waiting. */
  kept: string[];
  /** clientIds the server refused outright, kept on the device and marked. */
  refused: string[];
  /** True when the network itself failed, so the rest were not tried. */
  offline: boolean;
  /** True when the run stopped because its session ended or changed hands. */
  sessionEnded: boolean;
}

/** How a single save ended, for the sentence the page shows. */
export type SaveOutcome = "synced" | "on-device" | "signed-out" | "refused" | "failed";

export interface SaveResult {
  outcome: SaveOutcome;
  /** The server's own sentence, for a refusal. */
  why: string | null;
}

/** A fresh id for one sitting. Random enough that two devices never collide. */
export function newClientId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `j-${Date.now().toString(36)}-${rand()}${rand()}`;
}

function isItem(v: unknown): v is OutboxItem {
  if (!v || typeof v !== "object") return false;
  const it = v as Partial<OutboxItem>;
  const e = it.entry as Partial<JournalEntryInput> | undefined;
  return (
    typeof it.owner === "string" &&
    !!e &&
    typeof e.clientId === "string" &&
    isJournalPractice(e.practice) &&
    isJournalDepth(e.depth) &&
    Array.isArray(e.answers)
  );
}

function readAll(): OutboxItem[] {
  const read = readStoredJson("local", OUTBOX_KEY);
  if (read.status !== "value" || !Array.isArray(read.value)) return [];
  return read.value.filter(isItem);
}

function writeAll(items: OutboxItem[]): boolean {
  const ok = writeStoredJson("local", OUTBOX_KEY, items).status === "saved";
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(OUTBOX_EVENT));
  }
  return ok;
}

/** Change the stored items that match, and write only when one did. */
function update(match: (i: OutboxItem) => boolean, change: (i: OutboxItem) => OutboxItem): void {
  const all = readAll();
  let touched = false;
  const next = all.map((i) => {
    if (!match(i)) return i;
    touched = true;
    return change(i);
  });
  if (touched) writeAll(next);
}

/** This member's items on the device, oldest first, refused ones included. */
export function pendingFor(owner: string): OutboxItem[] {
  return readAll().filter((i) => i.owner === owner);
}

/** This member's items a flush would send: everything not refused. */
function waitingFor(owner: string): OutboxItem[] {
  return pendingFor(owner).filter((i) => !i.refused);
}

/**
 * Put an entry in the outbox. An entry with a clientId already waiting
 * replaces it, so saving the same sitting twice never queues it twice.
 * Returns whether the device actually kept it.
 */
export function enqueue(owner: string, entry: JournalEntryInput): { stored: boolean } {
  const rest = readAll().filter((i) => i.entry.clientId !== entry.clientId);
  const item: OutboxItem = { owner, entry, queuedAt: new Date().toISOString(), attempts: 0, lastError: null };
  return { stored: writeAll([...rest, item]) };
}

/** Forget one waiting item by its clientId. */
export function removeFromOutbox(clientId: string): void {
  const all = readAll();
  const rest = all.filter((i) => i.entry.clientId !== clientId);
  if (rest.length !== all.length) writeAll(rest);
}

function noteFailure(clientId: string, why: string, refused: boolean): void {
  update(
    (i) => i.entry.clientId === clientId,
    (i) => ({ ...i, attempts: i.attempts + 1, lastError: why, refused }),
  );
}

/**
 * clientIds the server accepted while this page was open. A draft carrying
 * one of these must not be saved under it again: the server would answer
 * with the first save and keep none of the new words.
 */
const sentHere = new Set<string>();

export function sentFromThisPage(clientId: string): boolean {
  return sentHere.has(clientId);
}

/**
 * The entry as it should travel. An entry cannot have been written in this
 * device's own future, so a `writtenAt` ahead of the clock now was stamped by
 * a clock that has since been put right, and it is stamped again from the
 * corrected one. While the clock is still wrong nothing changes, and the
 * server keeps saying why it refuses.
 */
function restamped(item: OutboxItem): JournalEntryInput {
  const at = Date.parse(item.entry.writtenAt);
  const now = new Date();
  if (!Number.isFinite(at) || at <= now.getTime()) return item.entry;
  const entry: JournalEntryInput = { ...item.entry, writtenAt: now.toISOString(), localHour: now.getHours() };
  update(
    (i) => i.entry.clientId === entry.clientId,
    (i) => ({ ...i, entry }),
  );
  return entry;
}

/** Run one request with a time limit. Running out rejects, like a dropped connection. */
async function timed(send: (signal: AbortSignal) => Promise<Response>, ms = SEND_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timed out"));
    }, ms);
  });
  try {
    // Raced as well as aborted, so a fetch that ignores its signal still ends.
    return await Promise.race([send(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

const OFFLINE = Symbol("offline");

/**
 * Whose session a token is. The token's own payload names its member (the
 * server checks the signature; this only has to tell two members apart).
 * A token that does not read that way is asked about once, by its profile.
 */
export function claimedUserId(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  try {
    const b64 = token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { userId?: unknown };
    const id = claims?.userId;
    return typeof id === "string" || typeof id === "number" ? String(id) : null;
  } catch {
    return null;
  }
}

const profileOwner = new Map<string, string>();

async function sessionOwner(token: string): Promise<string | null | typeof OFFLINE> {
  const claimed = claimedUserId(token);
  if (claimed) return claimed;
  const known = profileOwner.get(token);
  if (known) return known;
  try {
    const res = await timed((signal) =>
      gameFetch("/api/profile", { headers: { Authorization: `Bearer ${token}` }, signal }),
    );
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return OFFLINE;
    const body = (await res.json()) as { id?: unknown } | null;
    const id = body?.id;
    if (typeof id !== "string" && typeof id !== "number") return null;
    profileOwner.set(token, String(id));
    return String(id);
  } catch {
    return OFFLINE;
  }
}

/**
 * What one POST came to.
 *
 *   network   no answer at all, or none in time: stop, keep the rest
 *   session   401, or 409 for an entry that is not this session's: stop, keep the rest
 *   stop      the journal is not taking entries just now (403, 404, 408, 429): stop, keep the rest
 *   retry     the server failed (5xx): keep this one, carry on with the next
 *   refused   any other 4xx: the same answer would come again, so mark it refused
 */
type PostAnswer = { ok: true } | { ok: false; why: string; kind: "network" | "session" | "stop" | "retry" | "refused" };

function kindOf(status: number): Exclude<PostAnswer, { ok: true }>["kind"] {
  if (status === 401 || status === 409) return "session";
  if (status === 403 || status === 404 || status === 408 || status === 429) return "stop";
  if (status >= 500) return "retry";
  return "refused";
}

async function post(entry: JournalEntryInput, token: string): Promise<PostAnswer> {
  let res: Response;
  try {
    res = await timed((signal) =>
      gameFetch("/api/journal/entries", {
        method: "POST",
        body: JSON.stringify(entry),
        // The session this run proved is the owner's, never whatever storage
        // holds by the time this item's turn comes.
        headers: { Authorization: `Bearer ${token}` },
        signal,
      }),
    );
  } catch {
    return { ok: false, why: "No connection.", kind: "network" };
  }
  if (res.ok) return { ok: true };
  let why = res.status === 401 ? "Sign in again to send it." : `The journal answered ${res.status}.`;
  try {
    const { sentence } = refusalOf(await res.json());
    if (sentence) why = sentence;
  } catch {
    /* the status line is the whole answer */
  }
  return { ok: false, why, kind: kindOf(res.status) };
}

/** One flush per member at a time; a second caller shares the first one's run. */
const inflight = new Map<string, Promise<FlushResult>>();

async function runFlush(owner: string): Promise<FlushResult> {
  const result: FlushResult = { sent: [], kept: [], refused: [], offline: false, sessionEnded: false };
  const items = waitingFor(owner);
  if (items.length === 0) return result;
  const keepFrom = (i: number) => {
    for (const later of items.slice(i)) result.kept.push(later.entry.clientId);
  };

  // One session for the whole run, read once and proven to be the owner's.
  const token = authToken();
  const who = token ? await sessionOwner(token) : null;
  if (who === OFFLINE) {
    result.offline = true;
    keepFrom(0);
    return result;
  }
  if (!token || who !== owner) {
    result.sessionEnded = true;
    keepFrom(0);
    return result;
  }

  for (let i = 0; i < items.length; i++) {
    if (authToken() !== token) {
      result.sessionEnded = true;
      keepFrom(i);
      break;
    }
    // Read again: the member may have removed it, or saved over it, since the run began.
    const id = items[i]!.entry.clientId;
    const item = waitingFor(owner).find((it) => it.entry.clientId === id);
    if (!item) continue;
    const answer = await post(restamped(item), token);
    if (answer.ok) {
      removeFromOutbox(id);
      sentHere.add(id);
      result.sent.push(id);
      continue;
    }
    noteFailure(id, answer.why, answer.kind === "refused");
    if (answer.kind === "refused") {
      result.refused.push(id);
      continue;
    }
    result.kept.push(id);
    if (answer.kind === "retry") continue;
    if (answer.kind === "network") result.offline = true;
    if (answer.kind === "session") result.sessionEnded = true;
    keepFrom(i + 1);
    break;
  }
  return result;
}

/**
 * Send every waiting item that belongs to `owner`, oldest first. A success
 * removes the item; a server failure keeps it and records why; a refusal
 * marks it refused; a dead network or an ended session stops the run, since
 * every later item would fail the same way.
 */
export function flushOutbox(owner: string): Promise<FlushResult> {
  const running = inflight.get(owner);
  if (running) return running;
  const run = runFlush(owner);
  inflight.set(owner, run);
  const clear = () => {
    if (inflight.get(owner) === run) inflight.delete(owner);
  };
  run.then(clear, clear);
  return run;
}

/**
 * A flush that is sure to have looked at `clientId`. A run already going
 * when the item landed read the outbox before it existed, so it is asked
 * once more.
 */
async function flushIncluding(owner: string, clientId: string): Promise<FlushResult> {
  const first = await flushOutbox(owner);
  const seen = (r: FlushResult) => r.sent.includes(clientId) || r.kept.includes(clientId) || r.refused.includes(clientId);
  if (seen(first) || !waitingFor(owner).some((i) => i.entry.clientId === clientId)) return first;
  return flushOutbox(owner);
}

/** Send a refused item again, once the member has put right what the server said. */
export function retryEntry(owner: string, clientId: string): Promise<FlushResult> {
  update(
    (i) => i.owner === owner && i.entry.clientId === clientId,
    (i) => ({ ...i, refused: false }),
  );
  return flushIncluding(owner, clientId);
}

/** The direct send, for a browser that would not keep the entry. Same session rule. */
async function sendDirect(owner: string, entry: JournalEntryInput): Promise<SaveResult> {
  const token = authToken();
  const who = token ? await sessionOwner(token) : null;
  if (!token || who !== owner) return { outcome: "failed", why: null };
  const answer = await post(entry, token);
  if (answer.ok) {
    sentHere.add(entry.clientId);
    return { outcome: "synced", why: null };
  }
  return answer.kind === "refused" ? { outcome: "refused", why: answer.why } : { outcome: "failed", why: null };
}

/**
 * Save one entry the outbox way: keep it on the device, then try to send it.
 * `onStored` runs the moment the device holds it, before any waiting, so the
 * page can let go of its draft: from then on the outbox owns the words.
 *
 *   synced      the server has it, and the device copy is gone
 *   on-device   the device holds it and will send it later
 *   signed-out  the device holds it for this member's next session
 *   refused     the server said no, in `why`; the device keeps it, marked
 *   failed      the device could not hold it AND the send failed
 */
export async function saveEntry(
  owner: string,
  entry: JournalEntryInput,
  opts: { onStored?: () => void; waitMs?: number } = {},
): Promise<SaveResult> {
  const { stored } = enqueue(owner, entry);
  if (!stored) return sendDirect(owner, entry);
  opts.onStored?.();
  const id = entry.clientId;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), opts.waitMs ?? SAVE_WAIT_MS);
  });
  const result = await Promise.race([flushIncluding(owner, id), waited]);
  clearTimeout(timer);
  if (result?.sent.includes(id)) return { outcome: "synced", why: null };
  const item = pendingFor(owner).find((i) => i.entry.clientId === id);
  if (!item) return { outcome: "synced", why: null };
  if (item.refused) return { outcome: "refused", why: item.lastError };
  if (result?.sessionEnded) return { outcome: "signed-out", why: null };
  return { outcome: "on-device", why: null };
}
