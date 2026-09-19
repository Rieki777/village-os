/**
 * WHICH CHARACTER SUITS WHICH POWER.
 *
 * A member picks a character, and the village entrusts powers. This map joins
 * the two: each power the village hands out by appointment names the classes
 * it suits, so a member who has reached Contributor and plays one of those
 * classes is told the power suits them. It recommends and it never permits.
 * The gate in shared/capabilities.ts does not read this file, and nothing here
 * may ever be read by it.
 *
 * ── THE RULINGS, AS GIVEN (Rye, 2026-09-09) ────────────────────────────────
 *
 *   18:25Z  Moderating the forum, publishing the map and posting announcements
 *           go to "The Space Holder", "The Architect" and "The Story Teller",
 *           recommended "to those who reach contributor level and have the
 *           appropriate Player archetype/ character(s) they've chosen", and
 *           "this same thing for any other powers".
 *   18:48Z  Curating photos and telling the village's story publicly:
 *           storytelling. Keeping the library, logging the land and drafting
 *           the map in build mode: architecting. Managing events: space
 *           holding.
 *   19:02Z  "The catalyst taking the welcome aboard work is great", and "Leave
 *           the map edit to the architect". The Builder has no power yet, by
 *           the same ruling: "we just don't seem to have a lot of powers for
 *           builders or catalysts for some reason, but maybe we will as we go
 *           forward."
 *
 * `intake.moderate` for the Catalyst is the queue half of the welcome-aboard
 * work, as it was proposed and approved. The board itself does not exist yet,
 * and when it does its power belongs on this list beside it.
 *
 * ── KEYED BY IDENTIFIER, ON BOTH SIDES ─────────────────────────────────────
 *
 * Powers by capability key and classes by `ArchetypeSeed.key`, never by a
 * name. A village renaming The Architect keeps every line of this map. A key
 * that stops matching drops out at resolve time with no error, which is why
 * `powerAffinity.test.ts` pins every key here against `ARCHETYPE_KEYS` and
 * `ALL_CAPABILITIES`.
 *
 * ── A VILLAGE'S OWN MAP ────────────────────────────────────────────────────
 *
 * A village stores only the powers it decided about, in the `power-affinity`
 * document, the way the variables registry stores only changed values. A power
 * absent from that document follows the default below, so a suggestion the
 * platform adds later reaches every village that has not decided otherwise.
 * An empty list is a decision too: this power suits no class here.
 *
 * PURE, no state and no I/O, so the admin editor checks an edit with the same
 * function the server refuses it with.
 */
import { ALL_CAPABILITIES, type Capability } from "./capabilities";

/** Which classes each power suits, by class key. */
export type PowerAffinity = Partial<Record<Capability, readonly string[]>>;

/** What a village has decided, as stored: only the powers it changed. */
export type PowerAffinityOverrides = Partial<Record<Capability, string[]>>;

/** The platform's suggestion. See the rulings in the header. */
export const DEFAULT_POWER_AFFINITY: PowerAffinity = {
  "forum.moderate": ["facilitating"],
  "event.manage": ["facilitating"],
  "map.edit": ["researching"],
  "map.publish": ["researching"],
  "library.keep": ["researching"],
  "health.record": ["researching"],
  "map.curatePhotos": ["storytelling"],
  "feed.announce": ["storytelling"],
  "story.tell": ["storytelling"],
  "intake.moderate": ["catalyzing"],
};

/**
 * The rung a recommendation starts at, from the ruling's own words: "those who
 * reach contributor level". Below it a member still reads which class a power
 * suits. Only from here is the power put to them as one that suits THEM.
 */
export const RECOMMENDS_FROM = "contributor";

/** The `app_config` key a village's own decisions live under. */
export const POWER_AFFINITY_DOCUMENT = "power-affinity";

const isCapability = (key: string): key is Capability =>
  (ALL_CAPABILITIES as readonly string[]).indexOf(key) >= 0;

const owns = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** Trimmed, blank-free and each key once, in the order given. */
function distinct(keys: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const s = typeof k === "string" ? k.trim() : "";
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

/**
 * A stored document, read defensively.
 *
 * A key naming no capability is dropped, and a value that is not a list is
 * read as no decision, so that power follows the platform. A hand-edited row
 * degrades to the default instead of throwing on a member's profile.
 */
export function storedOverrides(doc: unknown): PowerAffinityOverrides {
  const out: PowerAffinityOverrides = {};
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return out;
  for (const cap of ALL_CAPABILITIES) {
    if (!owns(doc, cap)) continue;
    const value = (doc as Record<string, unknown>)[cap];
    if (Array.isArray(value)) out[cap] = distinct(value);
  }
  return out;
}

/**
 * The map a village plays by: its own decision for a power where it made one,
 * the platform's where it did not, and only classes the village actually has.
 *
 * `classKeys` is the village's cast as stored, so a sixth class a village
 * added resolves and a class key nobody has any more does not.
 */
export function resolvePowerAffinity(doc: unknown, classKeys: readonly string[]): PowerAffinity {
  const overrides = storedOverrides(doc);
  const out: PowerAffinityOverrides = {};
  for (const cap of ALL_CAPABILITIES) {
    const source = owns(overrides, cap) ? overrides[cap] ?? [] : DEFAULT_POWER_AFFINITY[cap] ?? [];
    const kept = distinct(source).filter((k) => classKeys.indexOf(k) >= 0);
    if (kept.length) out[cap] = kept;
  }
  return out;
}

/** The powers one class suits, in the platform's own capability order. */
export function powersSuitedTo(classKey: string, map: PowerAffinity): Capability[] {
  return ALL_CAPABILITIES.filter((cap) => (map[cap] ?? []).indexOf(classKey) >= 0);
}

/**
 * What is wrong with an edit, in words, or null when it can be saved.
 *
 * `classes` is a list of class keys, which may be empty, or null to follow the
 * platform's suggestion again.
 */
export function affinityEditProblem(capability: unknown, classes: unknown, classKeys: readonly string[]): string | null {
  const cap = typeof capability === "string" ? capability.trim() : "";
  if (!isCapability(cap)) return `"${cap}" is not a power this platform has.`;
  if (classes === null) return null;
  if (!Array.isArray(classes)) {
    return "Send the classes as a list, or send null to follow the platform's suggestion again.";
  }
  for (const k of classes) {
    const key = typeof k === "string" ? k.trim() : "";
    if (classKeys.indexOf(key) < 0) return `"${String(k)}" is not a class this village has.`;
  }
  return null;
}

/**
 * The document after one edit. Null removes the village's decision, so the
 * power follows the platform again. A list, empty or not, is kept exactly as
 * decided, even when it matches today's default: a village that chose these
 * classes chose them, and a later change to the suggestion must not move them.
 */
export function withAffinityEdit(
  doc: unknown,
  capability: Capability,
  classes: readonly string[] | null,
): PowerAffinityOverrides {
  const next = storedOverrides(doc);
  if (classes === null) delete next[capability];
  else next[capability] = distinct(classes);
  return next;
}

/**
 * Whether a power is put to this member as one that suits them.
 *
 * All four, and each for a reason a member would recognise: they have reached
 * the rung the ruling names, they do not already hold it, climbing does not
 * open it anyway, and they play a class it suits.
 */
export function isRecommended(
  row: { held: boolean; opens: { via: string } },
  suits: readonly string[],
  party: readonly string[],
  reachedRung: boolean,
): boolean {
  return reachedRung && !row.held && row.opens.via === "appointment" && suits.some((k) => party.indexOf(k) >= 0);
}
