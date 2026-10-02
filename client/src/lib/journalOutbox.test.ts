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
import {
  OUTBOX_KEY,
  SAVE_WAIT_MS,
  SEND_TIMEOUT_MS,
  enqueue,
  flushOutbox,
  pendingFor,
  removeFromOutbox,
  retryEntry,
  saveEntry,
} from "./journalOutbox";

const ME = "usr-wren";
const SOMEONE_ELSE = "usr-fen";

/** A session token shaped like the server's: base64url claims, a dot, a signature. */
function tokenFor(userId: string): string {
  const claims = JSON.stringify({ userId, email: `${userId}@example.test`, timestamp: 1, v: 0 });
  return `${btoa(claims).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.sig`;
}
const MY_TOKEN = tokenFor(ME);

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

/** Every entry POST, in order. */
const entryPosts = () =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/journal/entries").map(([, init]) => init as RequestInit);

/** The clientIds the server was sent, in order. */
const posted = () => entryPosts().map((init) => (JSON.parse(String(init.body)) as JournalEntryInput).clientId);

/** The bearer each entry POST carried, in order. */
const bearers = () => entryPosts().map((init) => (init.headers as Record<string, string>).Authorization);

const nothing = { sent: [], kept: [], refused: [], offline: false, sessionEnded: false };

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal("localStorage", store);
  store.setItem(TOKEN_KEY, MY_TOKEN);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
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

    expect(result).toEqual({ ...nothing, sent: ["c1", "c2"] });
    expect(posted()).toEqual(["c1", "c2"]);
    // The session is read from the token itself: nothing was asked first.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/journal/entries");
    expect((init as RequestInit).method).toBe("POST");
    expect(bearers()).toEqual([`Bearer ${MY_TOKEN}`, `Bearer ${MY_TOKEN}`]);
    expect(pendingFor(ME)).toEqual([]);
  });

  it("keeps an entry the server failed on, records why, and tries it again later", async () => {
    enqueue(ME, entry("c1"));
    fetchMock.mockImplementation(async () => refused(500, "The journal is having a moment."));

    const result = await flushOutbox(ME);

    expect(result).toEqual({ ...nothing, kept: ["c1"] });
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

    expect(again).toEqual(nothing);
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

describe("one session per flush", () => {
  it("stops when the stored session changes mid-run, and keeps the rest for their owner", async () => {
    enqueue(ME, entry("c1"));
    enqueue(ME, entry("c2"));
    // The first POST hangs on a slow link; meanwhile I sign out and somebody
    // else signs in on the same device.
    fetchMock.mockImplementation(async () => {
      store.setItem(TOKEN_KEY, tokenFor(SOMEONE_ELSE));
      return ok();
    });

    const result = await flushOutbox(ME);

    expect(posted()).toEqual(["c1"]);
    expect(bearers()).toEqual([`Bearer ${MY_TOKEN}`]);
    expect(result).toEqual({ ...nothing, sent: ["c1"], kept: ["c2"], sessionEnded: true });
    expect(pendingFor(ME).map((i) => i.entry.clientId)).toEqual(["c2"]);
  });

  it("sends nothing when the stored session is somebody else's (a tab left open on me)", async () => {
    enqueue(ME, entry("c1"));
    enqueue(ME, entry("c2"));
    store.setItem(TOKEN_KEY, tokenFor(SOMEONE_ELSE));
    fetchMock.mockImplementation(async () => ok());

    const result = await flushOutbox(ME);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ...nothing, kept: ["c1", "c2"], sessionEnded: true });
    expect(pendingFor(ME).map((i) => i.entry.clientId)).toEqual(["c1", "c2"]);
  });

  it("sends nothing with no session at all", async () => {
    enqueue(ME, entry("c1"));
    store.removeItem(TOKEN_KEY);
    const result = await flushOutbox(ME);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.sessionEnded).toBe(true);
    expect(pendingFor(ME)).toHaveLength(1);
  });

  it("stops at a 401 and leaves every later entry untried", async () => {
    enqueue(ME, entry("c1"));
    enqueue(ME, entry("c2"));
    fetchMock.mockImplementation(async () => refused(401, "auth_required"));

    const result = await flushOutbox(ME);

    expect(posted()).toEqual(["c1"]);
    expect(result).toEqual({ ...nothing, kept: ["c1", "c2"], sessionEnded: true });
    expect(pendingFor(ME)[0]!.lastError).toBe("Sign in again to send it.");
  });

  it("asks the profile, once, whose a token is when the token does not say", async () => {
    store.setItem(TOKEN_KEY, "tok-opaque");
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/profile" ? new Response(JSON.stringify({ id: ME }), { status: 200 }) : ok(),
    );
    enqueue(ME, entry("c1"));
    await flushOutbox(ME);
    enqueue(ME, entry("c2"));
    await flushOutbox(ME);

    expect(posted()).toEqual(["c1", "c2"]);
    expect(bearers()).toEqual(["Bearer tok-opaque", "Bearer tok-opaque"]);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/profile")).toHaveLength(1);
  });

  it("sends nothing when the profile says the token is somebody else's", async () => {
    store.setItem(TOKEN_KEY, "tok-theirs");
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/profile" ? new Response(JSON.stringify({ id: SOMEONE_ELSE }), { status: 200 }) : ok(),
    );
    enqueue(ME, entry("c1"));
    const result = await flushOutbox(ME);
    expect(posted()).toEqual([]);
    expect(result.sessionEnded).toBe(true);
  });
});

describe("a send that hangs", () => {
  it("ends at the time limit as no connection, and lets the next flush start", async () => {
    vi.useFakeTimers();
    enqueue(ME, entry("c1"));
    enqueue(ME, entry("c2"));
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    const first = flushOutbox(ME);
    let ended = false;
    void first.then(() => (ended = true));
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(ended).toBe(true);
    const result = await first;

    expect(result).toEqual({ ...nothing, kept: ["c1", "c2"], offline: true });
    expect(pendingFor(ME).map((i) => i.entry.clientId)).toEqual(["c1", "c2"]);
    // The aborted request was told to stop.
    expect((entryPosts()[0]!.signal as AbortSignal).aborted).toBe(true);

    // The lock is free: a new flush sends again instead of joining the dead one.
    const second = flushOutbox(ME);
    await vi.waitFor(() => expect(posted()).toEqual(["c1", "c1"]));
    // Let it run out too, so no run outlives this test.
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect((await second).offline).toBe(true);
  });

  it("does not hold a Save past its wait: the entry is safe on the device and the page says so", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    const saving = saveEntry(ME, entry("c1"));
    let answered = false;
    void saving.then(() => (answered = true));
    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS);

    expect(answered).toBe(true);
    expect(await saving).toEqual({ outcome: "on-device", why: null });
    expect(pendingFor(ME).map((i) => i.entry.clientId)).toEqual(["c1"]);
    // The send behind it still ends at its own limit, and the entry stays.
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(pendingFor(ME)[0]!.lastError).toBe("No connection.");
  });
});

describe("a refusal", () => {
  const AHEAD = "That entry is dated more than a day ahead. Check this device's clock.";

  it("marks the entry refused with the server's sentence, and later flushes leave it alone", async () => {
    enqueue(ME, entry("c1"));
    enqueue(ME, entry("c2"));
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) =>
      JSON.parse(String(init.body)).clientId === "c1" ? refused(400, AHEAD) : ok(),
    );

    const result = await flushOutbox(ME);

    // A refusal is about that entry alone, so the next one still goes.
    expect(result).toEqual({ ...nothing, sent: ["c2"], refused: ["c1"] });
    const [left] = pendingFor(ME);
    expect(left!.entry.clientId).toBe("c1");
    expect(left!.refused).toBe(true);
    expect(left!.lastError).toBe(AHEAD);

    fetchMock.mockClear();
    expect(await flushOutbox(ME)).toEqual(nothing);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is reported by saveEntry as refused, with the sentence, never as on its way", async () => {
    fetchMock.mockImplementation(async () => refused(400, AHEAD));
    expect(await saveEntry(ME, entry("c1"))).toEqual({ outcome: "refused", why: AHEAD });
    expect(pendingFor(ME)[0]!.refused).toBe(true);
  });

  it("goes through on Try again once the clock is put right, stamped from the corrected clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const right = new Date("2026-10-02T08:00:00.000Z");
    const fast = new Date(right.getTime() + 3 * 24 * 60 * 60 * 1000);
    // The phone's clock runs three days fast when the page is written.
    vi.setSystemTime(fast);
    fetchMock.mockImplementation(async () => refused(400, AHEAD));
    expect((await saveEntry(ME, { ...entry("c1"), writtenAt: fast.toISOString() })).outcome).toBe("refused");

    // While the clock is still wrong, trying again changes nothing.
    await retryEntry(ME, "c1");
    expect(JSON.parse(String(entryPosts()[1]!.body)).writtenAt).toBe(fast.toISOString());
    expect(pendingFor(ME)[0]!.refused).toBe(true);

    // The member fixes the clock and taps Try again.
    vi.setSystemTime(right);
    fetchMock.mockImplementation(async () => ok());
    const result = await retryEntry(ME, "c1");

    expect(result.sent).toEqual(["c1"]);
    expect(JSON.parse(String(entryPosts()[2]!.body)).writtenAt).toBe(right.toISOString());
    expect(pendingFor(ME)).toEqual([]);
  });

  it("can be removed from the device, and only that one goes", async () => {
    enqueue(ME, entry("c1"));
    enqueue(SOMEONE_ELSE, entry("theirs"));
    fetchMock.mockImplementation(async () => refused(400, AHEAD));
    await flushOutbox(ME);

    removeFromOutbox("c1");

    expect(pendingFor(ME)).toEqual([]);
    expect(pendingFor(SOMEONE_ELSE).map((i) => i.entry.clientId)).toEqual(["theirs"]);
  });
});

describe("saveEntry", () => {
  it("reports synced when the server takes it", async () => {
    fetchMock.mockImplementation(async () => ok());
    expect(await saveEntry(ME, entry("c1"))).toEqual({ outcome: "synced", why: null });
    expect(pendingFor(ME)).toEqual([]);
  });

  it("reports on-device when offline, and the entry is still there", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await saveEntry(ME, entry("c1"))).toEqual({ outcome: "on-device", why: null });
    expect(pendingFor(ME).map((i) => i.entry.clientId)).toEqual(["c1"]);
    expect(JSON.parse(store.getItem(OUTBOX_KEY) ?? "[]")).toHaveLength(1);
  });

  it("says the entry waits for the next sign-in when the session has gone", async () => {
    store.removeItem(TOKEN_KEY);
    expect(await saveEntry(ME, entry("c1"))).toEqual({ outcome: "signed-out", why: null });
    expect(pendingFor(ME)).toHaveLength(1);
  });

  it("tells the page the moment the device holds the entry, before any waiting", async () => {
    let release!: () => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = () => resolve(ok()))));
    const stored = vi.fn(() => expect(pendingFor(ME)).toHaveLength(1));

    const saving = saveEntry(ME, entry("c1"), { onStored: stored });
    expect(stored).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release();
    expect((await saving).outcome).toBe("synced");
  });
});
