// @vitest-environment jsdom
/**
 * The journal's outbox: a save lands on the device first, and only a server
 * that said yes takes it off again.
 *
 * Every assertion reads BOTH sides: the requests that went out (through the
 * real gameFetch, so the Authorization header is the real one) and what is
 * left in storage afterwards. A flush that removed items without sending
 * them, or sent them and kept them, would pass a one-sided check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalEntryInput } from "@shared/journal";
import { TOKEN_KEY } from "./gameApi";
import { OUTBOX_KEY, enqueue, flushOutbox, pendingFor, saveEntry } from "./journalOutbox";

const ME = "usr-wren";
const SOMEONE_ELSE = "usr-fen";

function entry(clientId: string, text = "Slept well."): JournalEntryInput {
  return {
    clientId,
    practice: "morning",
    depth: "light",
    answers: [{ questionKey: "arrival", prompt: "How did you sleep?", text }],
    writtenAt: "2026-10-02T07:30:00.000Z",
    localHour: 7,
  };
}

const ok = () => new Response(JSON.stringify({ id: "e1" }), { status: 201, headers: { "Content-Type": "application/json" } });
/** The journal routes' refusal shape: `{ error: <a sentence> }` (server/routes/journal.ts). */
const refused = (status: number, sentence: string) =>
  new Response(JSON.stringify({ error: sentence }), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * A working store of our own. Node 25 puts a runtime `localStorage` on the
 * global that is not jsdom's and has no `clear`, so the suite installs one it
 * controls, the way storageResilience.test.tsx does.
 */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}
let store: ReturnType<typeof memoryStorage>;

/** The clientIds the server was sent, in order. */
const posted = () =>
  fetchMock.mock.calls.map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as JournalEntryInput).clientId);

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal("localStorage", store);
  store.setItem(TOKEN_KEY, "tok-wren");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("enqueue", () => {
  it("keeps the entry on the device under its owner", () => {
    expect(enqueue(ME, entry("c1"))).toEqual({ stored: true });
    const waiting = pendingFor(ME);
    expect(waiting.map((i) => i.entry.clientId)).toEqual(["c1"]);
    expect(waiting[0]!.attempts).toBe(0);
    expect(pendingFor(SOMEONE_ELSE)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replaces an entry with the same clientId, so one sitting is never queued twice", () => {
    enqueue(ME, entry("c1", "first words"));
    enqueue(ME, entry("c1", "second words"));
    const waiting = pendingFor(ME);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.entry.answers[0]!.text).toBe("second words");
  });
});

describe("flushOutbox", () => {
  it("sends with the member's token and removes what the server accepted", async () => {
    enqueue(ME, entry("c1"));
    enqueue(ME, entry("c2"));
    fetchMock.mockImplementation(async () => ok());

    const result = await flushOutbox(ME);

    expect(result).toEqual({ sent: ["c1", "c2"], kept: [], offline: false });
    expect(posted()).toEqual(["c1", "c2"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/journal/entries");
    expect((init as RequestInit).method).toBe("POST");
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe("Bearer tok-wren");
    expect(pendingFor(ME)).toEqual([]);
  });

  it("keeps a refused entry and records why", async () => {
    enqueue(ME, entry("c1"));
    fetchMock.mockImplementation(async () => refused(500, "The journal is having a moment."));

    const result = await flushOutbox(ME);

    expect(result).toEqual({ sent: [], kept: ["c1"], offline: false });
    const waiting = pendingFor(ME);
    expect(waiting.map((i) => i.entry.clientId)).toEqual(["c1"]);
    expect(waiting[0]!.attempts).toBe(1);
    expect(waiting[0]!.lastError).toBe("The journal is having a moment.");
  });

  it("stops at a dead network and keeps everything after it untried", async () => {
    enqueue(ME, entry("c1"));
    enqueue(ME, entry("c2"));
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

    const result = await flushOutbox(ME);

    expect(result.offline).toBe(true);
    expect(result.kept).toEqual(["c1", "c2"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pendingFor(ME).map((i) => i.entry.clientId)).toEqual(["c1", "c2"]);
  });

  it("is safe to run again: a second flush after success sends nothing", async () => {
    enqueue(ME, entry("c1"));
    fetchMock.mockImplementation(async () => ok());

    await flushOutbox(ME);
    const again = await flushOutbox(ME);

    expect(again).toEqual({ sent: [], kept: [], offline: false });
    expect(posted()).toEqual(["c1"]);
  });

  it("shares one run between two callers, so nothing is posted twice at once", async () => {
    enqueue(ME, entry("c1"));
    let release!: () => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(ok());
        }),
    );

    const a = flushOutbox(ME);
    const b = flushOutbox(ME);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra).toBe(rb);
    expect(posted()).toEqual(["c1"]);
    expect(pendingFor(ME)).toEqual([]);
  });

  it("retries a refused entry on the next flush and clears it once accepted", async () => {
    enqueue(ME, entry("c1"));
    fetchMock.mockImplementationOnce(async () => refused(503, "Busy.")).mockImplementation(async () => ok());

    await flushOutbox(ME);
    expect(pendingFor(ME)).toHaveLength(1);
    const second = await flushOutbox(ME);

    expect(second.sent).toEqual(["c1"]);
    // The same clientId both times: the server's idempotence is what makes this safe.
    expect(posted()).toEqual(["c1", "c1"]);
    expect(pendingFor(ME)).toEqual([]);
  });

  it("never sends another member's waiting entry", async () => {
    enqueue(SOMEONE_ELSE, entry("theirs"));
    enqueue(ME, entry("mine"));
    fetchMock.mockImplementation(async () => ok());

    await flushOutbox(ME);

    expect(posted()).toEqual(["mine"]);
    expect(pendingFor(SOMEONE_ELSE).map((i) => i.entry.clientId)).toEqual(["theirs"]);
  });
});

describe("saveEntry", () => {
  it("reports synced when the server takes it", async () => {
    fetchMock.mockImplementation(async () => ok());
    expect(await saveEntry(ME, entry("c1"))).toBe("synced");
    expect(pendingFor(ME)).toEqual([]);
  });

  it("reports on-device when offline, and the entry is still there", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await saveEntry(ME, entry("c1"))).toBe("on-device");
    expect(pendingFor(ME).map((i) => i.entry.clientId)).toEqual(["c1"]);
    expect(JSON.parse(store.getItem(OUTBOX_KEY) ?? "[]")).toHaveLength(1);
  });
});
