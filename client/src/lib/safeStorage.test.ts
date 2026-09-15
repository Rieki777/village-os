/**
 * The storage helper's contract, and the distinction the whole thing exists
 * for: "the browser refused" is not "nothing was stored".
 *
 * No jsdom here. The helper resolves its store through `window` on every
 * call, so a plain object standing in for a window is a complete browser for
 * these purposes, and it lets a test hand back a store that throws in each of
 * the three ways a real browser throws. That is the point: the defect was
 * never reproducible by emptying the store, only by making it refuse.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readStored,
  readStoredJson,
  removeStored,
  storageAvailable,
  storedText,
  writeStored,
  writeStoredJson,
} from "./safeStorage";

type Host = { window?: unknown };
const host = globalThis as Host;
let savedWindow: unknown;

/** A store that works. */
function workingStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

/** Chrome with site data turned off: the property access itself throws. */
function accessThrows() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "localStorage" || prop === "sessionStorage") {
          throw new Error("Access to storage is not allowed from this context");
        }
        return undefined;
      },
    },
  );
}

/** Safari private browsing: the store is there and every call throws. */
function callsThrow() {
  const boom = () => {
    throw new Error("QuotaExceededError");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

/** A store present but refusing writes only, which is the quota-zero case. */
function writesThrow() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

beforeEach(() => {
  savedWindow = host.window;
});
afterEach(() => {
  host.window = savedWindow;
});

describe("the three-way read", () => {
  it("tells a stored empty string apart from nothing stored", () => {
    const store = workingStore();
    host.window = { localStorage: store };
    store.setItem("empty", "");
    expect(readStored("local", "empty")).toEqual({ status: "value", value: "" });
    expect(readStored("local", "never-set")).toEqual({ status: "absent" });
  });

  it("tells a refusal apart from nothing stored", () => {
    host.window = { localStorage: callsThrow() };
    expect(readStored("local", "never-set")).toEqual({ status: "unavailable", reason: "blocked" });
    host.window = { localStorage: workingStore() };
    expect(readStored("local", "never-set")).toEqual({ status: "absent" });
  });

  it("survives a browser that throws on the property access itself", () => {
    host.window = accessThrows();
    expect(readStored("local", "k")).toEqual({ status: "unavailable", reason: "blocked" });
    expect(writeStored("local", "k", "v")).toEqual({ status: "unavailable", reason: "blocked" });
    expect(removeStored("local", "k")).toEqual({ status: "unavailable", reason: "blocked" });
  });

  it("reports no store at all as its own reason", () => {
    host.window = {};
    expect(readStored("local", "k")).toEqual({ status: "unavailable", reason: "no-storage" });
    expect(writeStored("local", "k", "v")).toEqual({ status: "unavailable", reason: "no-storage" });
  });

  it("collapses both no-value cases only where the caller asked for that", () => {
    host.window = { localStorage: callsThrow() };
    expect(storedText("local", "k")).toBeNull();
    host.window = { localStorage: workingStore() };
    expect(storedText("local", "k")).toBeNull();
    // The collapsing read loses the difference on purpose. The explicit one
    // keeps it, and that is the whole reason both exist.
    expect(readStored("local", "k").status).toBe("absent");
  });
});

describe("writing and forgetting", () => {
  it("saves, reads back, and removes", () => {
    const store = workingStore();
    host.window = { localStorage: store };
    expect(writeStored("local", "k", "v")).toEqual({ status: "saved" });
    expect(readStored("local", "k")).toEqual({ status: "value", value: "v" });
    expect(removeStored("local", "k")).toEqual({ status: "saved" });
    expect(readStored("local", "k")).toEqual({ status: "absent" });
  });

  it("reports a refused write without throwing", () => {
    host.window = { localStorage: writesThrow() };
    expect(() => writeStored("local", "k", "v")).not.toThrow();
    expect(writeStored("local", "k", "v")).toEqual({ status: "unavailable", reason: "blocked" });
  });

  it("reaches sessionStorage by the same door", () => {
    const local = workingStore();
    const session = workingStore();
    host.window = { localStorage: local, sessionStorage: session };
    expect(writeStored("session", "k", "v")).toEqual({ status: "saved" });
    expect(readStored("session", "k")).toEqual({ status: "value", value: "v" });
    // The two areas stay separate, which is what a per-tab dismissal needs.
    expect(readStored("local", "k")).toEqual({ status: "absent" });
  });

  it("keeps sessionStorage working when localStorage is the blocked one", () => {
    host.window = { localStorage: callsThrow(), sessionStorage: workingStore() };
    expect(writeStored("session", "k", "v")).toEqual({ status: "saved" });
    expect(readStored("local", "k")).toEqual({ status: "unavailable", reason: "blocked" });
  });
});

describe("the JSON read", () => {
  it("hands back the parsed value", () => {
    host.window = { localStorage: workingStore() };
    writeStoredJson("local", "k", ["a", "b"]);
    expect(readStoredJson("local", "k")).toEqual({ status: "value", value: ["a", "b"] });
  });

  it("calls a corrupted value unreadable, which is not the same as unavailable", () => {
    const store = workingStore();
    host.window = { localStorage: store };
    store.setItem("k", "{ not json");
    const read = readStoredJson("local", "k");
    expect(read.status).toBe("unreadable");
    host.window = { localStorage: callsThrow() };
    expect(readStoredJson("local", "k").status).toBe("unavailable");
  });

  it("does not throw on a value that cannot be serialised", () => {
    host.window = { localStorage: workingStore() };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => writeStoredJson("local", "k", cycle)).not.toThrow();
    expect(writeStoredJson("local", "k", cycle).status).toBe("unavailable");
  });

  it("reports an absent key as absent, never as unreadable", () => {
    host.window = { localStorage: workingStore() };
    expect(readStoredJson("local", "never-set")).toEqual({ status: "absent" });
  });
});

describe("the availability probe", () => {
  it("is true only when a value can be written and taken away again", () => {
    host.window = { localStorage: workingStore() };
    expect(storageAvailable("local")).toBe(true);
  });

  it("is false on a store that reads fine and refuses every write", () => {
    // This is the case a `typeof window.localStorage` check gets wrong, and
    // it is the one Safari's private mode actually presents.
    host.window = { localStorage: writesThrow() };
    expect(storageAvailable("local")).toBe(false);
  });

  it("is false where the store is missing or throws", () => {
    host.window = {};
    expect(storageAvailable("local")).toBe(false);
    host.window = { localStorage: callsThrow() };
    expect(storageAvailable("local")).toBe(false);
  });

  it("leaves nothing of its own behind", () => {
    const store = workingStore();
    host.window = { localStorage: store };
    expect(storageAvailable("local")).toBe(true);
    expect([...store._map.keys()]).toEqual([]);
  });
});
