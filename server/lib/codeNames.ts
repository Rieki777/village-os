/**
 * Code-names: how a member is named to the organisational memory service
 * without the service ever learning who they are.
 *
 * ── THE RULING AND THE PROMISE ───────────────────────────────────────────
 *
 * The founder ruled (2026-10-02) that the information bridge to Saberra is
 * full transparency, and that every member gets a code-name so feedback can
 * still be personal without exposing PII. What was then promised to the
 * vendor (2026-10-13), and what this file keeps:
 *
 *   - Each member gets a STABLE code-name, minted at RANDOM, carrying nothing
 *     about them. Stable, so the service can give one person feedback over
 *     time. Random, so nothing about the person can be read out of it.
 *   - The map from code-name to person STAYS INSIDE THE VILLAGE. `resolve`
 *     below is for the village's own use, and no route returns it.
 *   - On erasure the village scrubs its own records first, asks the service
 *     to delete, and DROPS THE MAP ENTRY ONCE THEY CONFIRM. Until then the
 *     entry stays, marked pending. The service has no delete endpoint yet, so
 *     today every erased member's entry stays pending, and the admin panel
 *     says so.
 *   - Journal code-names are KEPT APART from any future seat-holder
 *     code-names: every entry carries a `purpose`, and the code-name itself is
 *     unique across all of them.
 *
 * ── WHY NOT THE OPAQUE SUBJECT REFERENCE ─────────────────────────────────
 *
 * `server/lib/subjectRefs.ts` is the pattern this follows (stored, random,
 * dropped last on erasure) and it is not reused, for two reasons. A subject
 * reference is 128 bits of hex, which nobody can read in a sentence, and a
 * code-name is written INTO the member's prose by the name swap, where it has
 * to read as a name. And a subject reference is one per member for every
 * vendor, where these are kept apart by purpose on purpose.
 *
 * ── WHY STORED AND NOT DERIVED ───────────────────────────────────────────
 *
 * The same two reasons subjectRefs.ts gives: a derived name cannot be retired
 * for one member, and rotating its secret would rename everybody at once.
 */
import { randomInt } from "node:crypto";
import type { Pool } from "mysql2/promise";
import {
  codeNameForUser,
  codeNamesForUsers,
  dropPendingCodeName,
  insertCodeNameIfAbsent,
  liveCodeNamesOfUser,
  markPendingVendorDelete,
  pendingVendorDeleteCount,
  userIdForCodeName,
} from "../repos/codeNames";

/** The maps this table holds. A purpose added later is a word added here. */
export const CODE_NAME_PURPOSES = ["journal"] as const;
export type CodeNamePurpose = (typeof CODE_NAME_PURPOSES)[number];

/*
 * THE WORD LISTS. Fixed, so a code-name is always two plain words and two
 * digits. Chosen to read well in a sentence and to avoid common first names
 * and surnames: a code-name like "rose-..." written into prose would look
 * like a member named Rose to whoever reads it.
 */
const FIRST_WORDS = [
  "alpine", "breezy", "brisk", "calm", "cloudy", "coastal", "cobalt", "cosy",
  "dappled", "dusky", "eager", "early", "faint", "fleet", "fond", "frosty",
  "glad", "grassy", "hardy", "hidden", "humble", "kindly", "leafy", "lively",
  "lucky", "lunar", "mild", "mossy", "nimble", "northern", "ochre", "patient",
  "plain", "polar", "quiet", "rapid", "rare", "ready", "russet", "rustic",
  "shady", "shy", "silent", "sleek", "slow", "smooth", "snowy", "soft",
  "solar", "speckled", "spry", "starry", "steady", "sunlit", "tawny", "tidy",
  "tiny", "upland", "vast", "warm", "wild", "windy", "woolly", "zesty",
] as const;

const SECOND_WORDS = [
  "alpaca", "avocet", "badger", "beaver", "bison", "bittern", "caribou", "chough",
  "curlew", "dipper", "dunlin", "egret", "eider", "fulmar", "gannet", "gecko",
  "godwit", "goshawk", "grouse", "hare", "heron", "ibex", "ibis", "jackdaw",
  "kestrel", "kudu", "lapwing", "lemur", "linnet", "lynx", "magpie", "mallard",
  "manatee", "marmot", "marten", "meerkat", "moorhen", "moose", "narwhal", "newt",
  "nuthatch", "ocelot", "okapi", "oriole", "osprey", "otter", "pika", "pipit",
  "plover", "ptarmigan", "puffin", "quail", "quokka", "shrike", "skylark", "sparrow",
  "stonechat", "stork", "tapir", "tern", "thrush", "vole", "wagtail", "walrus",
] as const;

const SHAPE = /^[a-z]+-[a-z]+-[1-9][0-9]$/;

/** How many fresh code-names one member is tried with before the mint gives up. */
const MINT_ATTEMPTS = 8;

/**
 * A fresh code-name: two words and two digits, chosen with the platform's
 * cryptographic randomness. About four hundred thousand possibilities, so a
 * village meets a collision rarely, and the mint below survives one anyway.
 * `pick(n)` answers an integer in [0, n); a test hands in its own.
 */
export function mintCodeName(pick: (n: number) => number = (n) => randomInt(n)): string {
  const first = FIRST_WORDS[pick(FIRST_WORDS.length)];
  const second = SECOND_WORDS[pick(SECOND_WORDS.length)];
  const digits = 10 + pick(90);
  return `${first}-${second}-${digits}`;
}

/** Shape only. Whether a code-name names anybody is `resolveCodeName`'s question. */
export function looksLikeCodeName(v: unknown): v is string {
  return typeof v === "string" && v.length <= 64 && SHAPE.test(v);
}

/** The word lists' sizes, for a test that wants the space it draws from. */
export const CODE_NAME_SPACE = { first: FIRST_WORDS.length, second: SECOND_WORDS.length, digits: 90 };

/**
 * This member's code-name for one purpose, minting one the first time.
 *
 * INSERT IGNORE then re-read, as `subjectRefFor` does, so two concurrent
 * callers converge on one code-name. The re-read is also how a COLLISION is
 * seen: a minted code-name somebody else already holds is ignored by the
 * primary key, the re-read finds nothing for this member, and a new one is
 * tried. Eight misses in a row means the word lists are exhausted, which is a
 * fault worth a loud error.
 */
export async function codeNameFor(
  pool: Pool,
  userId: string,
  purpose: CodeNamePurpose,
  draw: () => string = mintCodeName,
): Promise<string> {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("a code-name needs a member");
  const existing = await codeNameForUser(pool, uid, purpose);
  if (existing) return existing;
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    await insertCodeNameIfAbsent(pool, draw(), uid, purpose);
    const issued = await codeNameForUser(pool, uid, purpose);
    if (issued) return issued;
  }
  throw new Error("could not mint a code-name: every attempt collided");
}

/** Code-names for several members, minting for any who have none yet. */
export async function codeNamesFor(
  pool: Pool,
  userIds: readonly string[],
  purpose: CodeNamePurpose,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = Array.from(new Set(userIds.filter((id) => typeof id === "string" && id.trim() !== "")));
  if (wanted.length === 0) return out;
  for (const r of await codeNamesForUsers(pool, wanted, purpose)) out.set(r.userId, r.codeName);
  for (const id of wanted) {
    if (!out.has(id)) out.set(id, await codeNameFor(pool, id, purpose));
  }
  return out;
}

/**
 * Who a code-name names. FOR THE VILLAGE'S OWN USE ONLY: no route answers
 * this, and nothing the service sends can ask it. A malformed code-name and
 * one that names nobody both answer null, and a caller must not say which.
 */
export async function resolveCodeName(pool: Pool, codeName: string): Promise<string | null> {
  if (!looksLikeCodeName(codeName)) return null;
  return userIdForCodeName(pool, codeName);
}

/**
 * The erasure's half: mark every live code-name this member holds as waiting
 * on a vendor delete, and answer which ones, so the outbox can scrub the rows
 * filed under them. The entries stay and keep resolving, because the village
 * has to be able to name the person when the vendor answers.
 */
export async function markCodeNamesPendingVendorDelete(pool: Pool, userId: string): Promise<string[]> {
  const held = await liveCodeNamesOfUser(pool, userId);
  if (held.length > 0) await markPendingVendorDelete(pool, userId);
  return held;
}

/**
 * Drop a map entry once the vendor confirms it deleted what it held under
 * that code-name. Refuses (answers false) for an entry no erasure marked,
 * because a drop before the erasure scrubbed the village's own records would
 * be the wrong order. NOTHING CALLS THIS YET: the service has no delete
 * endpoint, so there is no confirm to act on.
 */
export async function dropCodeNameOnVendorConfirm(pool: Pool, codeName: string): Promise<boolean> {
  if (!looksLikeCodeName(codeName)) return false;
  return (await dropPendingCodeName(pool, codeName)) > 0;
}

/** How many erased members' code-names are kept, waiting on a vendor's confirm. */
export async function codeNamesPendingVendorDelete(pool: Pool): Promise<number> {
  return pendingVendorDeleteCount(pool);
}
