/**
 * The one place in the client that talks to Web Storage.
 *
 * WHY THIS EXISTS. A browser with site data blocked does not hand back an
 * empty store. `window.localStorage` throws on the property access itself in
 * Chrome and Edge when third-party or all cookies are blocked, and Safari's
 * private mode has thrown on `setItem` for years. A member in that state used
 * to take a white screen on any page that remembered a filter, a currency or
 * a collapsed panel, because the call sat bare in a render path. Forty-six
 * such calls were counted in `client/src` under a line-local guard test, and
 * twenty-four of them were genuinely bare.
 *
 * WHY ONE HELPER AND NOT ONE TRY BLOCK PER SITE. Forty-six catch blocks put
 * the same reasoning in forty-six places and guarantee that the forty-seventh
 * site forgets. This module holds the reasoning once.
 *
 * THE READING IS THREE-WAY ON PURPOSE. "The browser refused" and "nothing was
 * stored" are different facts, and a caller guarding on falsiness cannot tell
 * them apart. `client/src/lib/celebrated.ts` is the case that proves the
 * point: a moment with no stored history is news and should be celebrated,
 * while a moment whose history cannot be read must stay silent, because
 * otherwise a member in private browsing replays the same celebration on
 * every navigation. Both of those look like `null` to a two-way accessor.
 *
 * WHERE CARRYING ON QUIETLY IS THE WRONG ANSWER. Signing in. A member who
 * cannot store a session cannot stay signed in, so a site that ignored the
 * status here would show a sign-in that looked like it worked and did not.
 * Those sites use the same three-way reading and REFUSE on `unavailable`,
 * with a sentence a member can act on. `client/src/lib/signInStorage.ts`
 * holds that decision and the words; nothing else in the client should
 * decide it again.
 */

/** Which of the two Web Storage areas. Neither survives a cleared browser. */
export type StorageArea = "local" | "session";

/**
 * The result of a read. Three outcomes, never two:
 *  - `value`       something was stored, and here it is. An empty string is a
 *                  stored value and reports as one.
 *  - `absent`      the store works and holds nothing under this key.
 *  - `unavailable` the browser refused. Nothing is known about the key.
 */
export type StorageRead =
  | { status: "value"; value: string }
  | { status: "absent" }
  | { status: "unavailable"; reason: StorageBlockReason };

/** The result of a write or a remove. */
export type StorageWrite =
  | { status: "saved" }
  | { status: "unavailable"; reason: StorageBlockReason };

/**
 * The result of a read that also parses JSON. `unreadable` is its own outcome
 * because a corrupted value is a fact about the key, and `unavailable` is a
 * fact about the browser. Collapsing them loses the difference that decides
 * whether re-writing the key is worth attempting.
 */
export type StorageJsonRead =
  | { status: "value"; value: unknown }
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | { status: "unavailable"; reason: StorageBlockReason };

/**
 * Why the store could not be used.
 *  - `no-storage` there is no storage object at all: server rendering, a
 *                 test running under the node environment, an old engine.
 *  - `blocked`    the object exists and threw. Site data is turned off, the
 *                 quota is full, or the page is in a partitioned frame.
 */
export type StorageBlockReason = "no-storage" | "blocked";

/**
 * Resolve the store on every call, never once at module load.
 *
 * Two reasons, and both have bitten this codebase. A module-level capture
 * runs before a test can stub the global, and `client/src/lib/sound.test.ts`
 * installs a whole fake `window` after import. And the property access is
 * itself the throwing step in Chrome, so it belongs inside the try.
 *
 * `window` is preferred over `globalThis` for the same test: it fakes a
 * `window` object on a node global, where `globalThis.localStorage` is either
 * absent or, on Node 25, the runtime's own store, which is not the one the
 * test set up.
 */
function areaOf(area: StorageArea): Storage | null {
  const host: unknown = typeof window !== "undefined" && window ? window : globalThis;
  if (!host || typeof host !== "object") return null;
  const store = (host as Record<string, unknown>)[
    area === "local" ? "localStorage" : "sessionStorage"
  ];
  if (!store || typeof store !== "object") return null;
  return store as Storage;
}

/** Read one key. See `StorageRead` for why the answer has three shapes. */
export function readStored(area: StorageArea, key: string): StorageRead {
  try {
    const store = areaOf(area);
    if (!store) return { status: "unavailable", reason: "no-storage" };
    const raw = store.getItem(key);
    return raw === null || raw === undefined ? { status: "absent" } : { status: "value", value: raw };
  } catch {
    return { status: "unavailable", reason: "blocked" };
  }
}

/** Store one key. The caller decides whether a refusal is worth reporting. */
export function writeStored(area: StorageArea, key: string, value: string): StorageWrite {
  try {
    const store = areaOf(area);
    if (!store) return { status: "unavailable", reason: "no-storage" };
    store.setItem(key, value);
    return { status: "saved" };
  } catch {
    return { status: "unavailable", reason: "blocked" };
  }
}

/** Forget one key. A key that was never there reports `saved`, as the DOM does. */
export function removeStored(area: StorageArea, key: string): StorageWrite {
  try {
    const store = areaOf(area);
    if (!store) return { status: "unavailable", reason: "no-storage" };
    store.removeItem(key);
    return { status: "saved" };
  } catch {
    return { status: "unavailable", reason: "blocked" };
  }
}

/**
 * Read a key that holds JSON.
 *
 * The parse is inside the helper because it is the second way one of these
 * reads takes a page down, and every site that hand-rolled a guard had to
 * remember both. The value comes back as `unknown`: narrow it at the call
 * site, where the expected shape is known.
 */
export function readStoredJson(area: StorageArea, key: string): StorageJsonRead {
  const raw = readStored(area, key);
  if (raw.status !== "value") return raw;
  try {
    return { status: "value", value: JSON.parse(raw.value) as unknown };
  } catch {
    return { status: "unreadable", reason: "not JSON" };
  }
}

/**
 * Store a key as JSON. A value that cannot be serialised (a cycle, a BigInt)
 * reports `unavailable` with `blocked`, because from the caller's side the
 * outcome is the same: the preference did not stick and the page carries on.
 */
export function writeStoredJson(area: StorageArea, key: string, value: unknown): StorageWrite {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return { status: "unavailable", reason: "blocked" };
  }
  return writeStored(area, key, encoded);
}

/**
 * The collapsing read, for a caller that genuinely does not care why there is
 * no value. Named so the collapse is visible at the call site. Reach for
 * `readStored` wherever "the browser refused" would change what the code does.
 */
export function storedText(area: StorageArea, key: string): string | null {
  const read = readStored(area, key);
  return read.status === "value" ? read.value : null;
}

/** The key the probe below writes and removes. Nothing else ever reads it. */
const PROBE_KEY = "village.storageProbe";

/**
 * Can this browser store anything at all?
 *
 * A round trip, never a `typeof` check, because the failure this asks about
 * has three shapes and only one of them is a missing object. Safari's private
 * mode hands back a store whose quota is zero, so `setItem` throws while the
 * object is present and `getItem` works. Chrome with site data turned off
 * throws on the property access. A blocked partitioned frame throws on the
 * call. Writing a value and taking it away again is the only question that
 * covers all three.
 *
 * The sign-in path is the caller this exists for: it asks BEFORE it sends
 * anybody's password, so a member is refused with a sentence they can act on
 * instead of being handed a session the browser will drop.
 */
export function storageAvailable(area: StorageArea): boolean {
  if (writeStored(area, PROBE_KEY, "1").status !== "saved") return false;
  removeStored(area, PROBE_KEY);
  return true;
}
