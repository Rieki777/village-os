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
 * All storage goes through safeStorage. A browser that refuses storage cannot
 * hold the outbox, and `saveEntry` then sends directly and says so.
 */
import type { JournalEntryInput } from "@shared/journal";
import { isJournalDepth, isJournalPractice } from "@shared/journal";
import { gameFetch } from "./gameApi";
import { refusalOf } from "./journalApi";
import { readStoredJson, writeStoredJson } from "./safeStorage";

export const OUTBOX_KEY = "village.journal.outbox";
/** Fired on window whenever the outbox changes, so a list can re-read it. */
export const OUTBOX_EVENT = "journal-outbox-changed";

export interface OutboxItem {
  /** The member who wrote it. Only their session ever sends it. */
  owner: string;
  entry: JournalEntryInput;
  queuedAt: string;
  attempts: number;
  /** The last refusal, in words, or null when it has not been tried. */
  lastError: string | null;
}

export interface FlushResult {
  /** clientIds the server accepted, now gone from the outbox. */
  sent: string[];
  /** clientIds still waiting. */
  kept: string[];
  /** True when the network itself failed, so the rest were not tried. */
  offline: boolean;
}

/** How a single save ended, for the sentence the page shows. */
export type SaveOutcome = "synced" | "on-device" | "failed";

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

/** This member's waiting items, oldest first. */
export function pendingFor(owner: string): OutboxItem[] {
  return readAll().filter((i) => i.owner === owner);
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

function noteFailure(clientId: string, why: string): void {
  const all = readAll();
  let touched = false;
  const next = all.map((i) => {
    if (i.entry.clientId !== clientId) return i;
    touched = true;
    return { ...i, attempts: i.attempts + 1, lastError: why };
  });
  if (touched) writeAll(next);
}

async function post(entry: JournalEntryInput): Promise<{ ok: true } | { ok: false; why: string; network: boolean }> {
  try {
    const res = await gameFetch("/api/journal/entries", { method: "POST", body: JSON.stringify(entry) });
    if (res.ok) return { ok: true };
    let why = res.status === 401 ? "Sign in again to send it." : `The journal answered ${res.status}.`;
    try {
      const { sentence } = refusalOf(await res.json());
      if (sentence) why = sentence;
    } catch {
      /* the status line is the whole answer */
    }
    return { ok: false, why, network: false };
  } catch {
    return { ok: false, why: "No connection.", network: true };
  }
}

/** One flush per member at a time; a second caller shares the first one's run. */
const inflight = new Map<string, Promise<FlushResult>>();

/**
 * Send every waiting item that belongs to `owner`, oldest first. A success
 * removes the item; a refusal keeps it and records why; a dead network stops
 * the run, since every later item would fail the same way.
 */
export function flushOutbox(owner: string): Promise<FlushResult> {
  const running = inflight.get(owner);
  if (running) return running;
  const run = (async (): Promise<FlushResult> => {
    const result: FlushResult = { sent: [], kept: [], offline: false };
    const items = pendingFor(owner);
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const answer = await post(item.entry);
      if (answer.ok) {
        removeFromOutbox(item.entry.clientId);
        result.sent.push(item.entry.clientId);
        continue;
      }
      noteFailure(item.entry.clientId, answer.why);
      result.kept.push(item.entry.clientId);
      if (answer.network) {
        result.offline = true;
        for (const later of items.slice(i + 1)) result.kept.push(later.entry.clientId);
        break;
      }
    }
    return result;
  })();
  inflight.set(owner, run);
  const clear = () => {
    if (inflight.get(owner) === run) inflight.delete(owner);
  };
  run.then(clear, clear);
  return run;
}

/**
 * Save one entry the outbox way: keep it on the device, then try to send it.
 *
 *   synced     the server has it, and the device copy is gone
 *   on-device  the device holds it and will send it later
 *   failed     the device could not hold it AND the send failed
 */
export async function saveEntry(owner: string, entry: JournalEntryInput): Promise<SaveOutcome> {
  const { stored } = enqueue(owner, entry);
  if (!stored) {
    const answer = await post(entry);
    return answer.ok ? "synced" : "failed";
  }
  const result = await flushOutbox(owner);
  if (result.sent.includes(entry.clientId)) return "synced";
  // A flush already running when this save landed may have started before
  // the item existed; ask once more so a fresh save is not left waiting.
  if (!result.kept.includes(entry.clientId) && pendingFor(owner).some((i) => i.entry.clientId === entry.clientId)) {
    const again = await flushOutbox(owner);
    if (again.sent.includes(entry.clientId)) return "synced";
  }
  return pendingFor(owner).some((i) => i.entry.clientId === entry.clientId) ? "on-device" : "synced";
}
