/**
 * Which character suits which power, as a village plays it.
 *
 * The rules are in shared/powerAffinity.ts and are not restated here. This
 * module reads the village's decisions, resolves them against the cast the
 * village actually has, and hangs the answer on the three places a member or a
 * founder meets it:
 *
 *   - the capability catalogue on `/api/game/progression`, where each power
 *     the village entrusts says which classes it suits and whether it is put
 *     to THIS member (`withPowerAffinity`);
 *   - a class's open paths on `/api/archetypes/:key/paths`, where the powers
 *     it suits sit beside the seats tagged for it (`powersForClass`);
 *   - the admin editor (`affinityForAdmin`, `saveAffinityEdit`).
 *
 * ── A HINT MUST NOT TAKE THE PROFILE DOWN WITH IT ──────────────────────────
 *
 * The catalogue is a member's whole map of what they can do. If the village's
 * decisions cannot be read, the rows go out with no suggestion on them and the
 * failure is logged, because a missing hint is a smaller wrong than a profile
 * that does not load. Nothing is guessed in its place: an unread map suggests
 * nothing, and it never falls back to the platform's suggestion as though the
 * village had made it.
 *
 * ── ONE WRITER AT A TIME ───────────────────────────────────────────────────
 *
 * An edit reads the document, changes one power and writes the whole document
 * back. Two founders saving two different powers at the same moment would each
 * write a document missing the other's line. Edits are chained per pool, so the
 * second one reads what the first one wrote.
 */
import type { Pool } from "mysql2/promise";
import { ALL_CAPABILITIES, capabilityLabel, STAGE_UNLOCKS, type Capability } from "../../shared/capabilities";
import { stageIndex } from "../../shared/gameConfig";
import {
  DEFAULT_POWER_AFFINITY,
  isRecommended,
  POWER_AFFINITY_DOCUMENT,
  powersSuitedTo,
  RECOMMENDS_FROM,
  resolvePowerAffinity,
  storedOverrides,
  withAffinityEdit,
  type PowerAffinity,
  type PowerAffinityOverrides,
} from "../../shared/powerAffinity";
import { charactersForMember } from "../repos/playerCharacters";
import { dbDocument, type DbDocument } from "../repos/store-db";
import { listArchetypes } from "./characters";
import { visibleCapabilities, type CapabilityCatalogueRow } from "./progressionPayload";
import { stringVar } from "./variables";

interface Held {
  doc: DbDocument;
  loading: Promise<void> | null;
  writes: Promise<unknown>;
}

const perPool = new WeakMap<Pool, Held>();

function heldFor(pool: Pool): Held {
  const existing = perPool.get(pool);
  if (existing) return existing;
  const held: Held = { doc: dbDocument(pool, POWER_AFFINITY_DOCUMENT, {}), loading: null, writes: Promise.resolve() };
  perPool.set(pool, held);
  return held;
}

/**
 * The document, read once per process and kept.
 *
 * This module is the only writer of the key, and its writes go through the
 * same cache, so the cached copy cannot fall behind the table. A failed first
 * read is forgotten, so the next request tries again instead of failing for
 * the life of the process.
 */
async function loaded(pool: Pool): Promise<DbDocument> {
  const held = heldFor(pool);
  if (!held.loading) {
    held.loading = held.doc.load().catch((err) => {
      held.loading = null;
      throw err;
    });
  }
  await held.loading;
  return held.doc;
}

const decidedIn = (overrides: PowerAffinityOverrides, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(overrides, key);

/**
 * Whether THIS village hands a power out by appointment, read the way
 * `capabilityCatalogue` reads it: the village's own rung for a key the ladder
 * can open (`progression.unlock.<key>`), where "none" means nobody climbs to
 * it, and no rung at all for every other key. Reading the platform's unlock
 * table instead would hide a power a village took off its ladder from the
 * editor, while the catalogue already showed it as entrusted.
 */
function entrustedHere(key: Capability): boolean {
  if (!STAGE_UNLOCKS[key]) return true;
  const rung = stringVar(`progression.unlock.${key}`);
  return !rung || rung === "none";
}

/** The powers this village has decided about itself. */
export async function villageOverrides(pool: Pool): Promise<PowerAffinityOverrides> {
  return storedOverrides((await loaded(pool)).get());
}

/** A class as a member reads it: its key, and the name this village gives it today. */
export interface ClassName {
  key: string;
  name: string;
  /** Set on a recommended power's classes: this is a class the member plays. */
  yours?: boolean;
}

/** The map a village plays by, beside the names its classes carry now. */
export async function villageAffinity(
  pool: Pool,
  villageId: string,
): Promise<{ map: PowerAffinity; classes: ClassName[] }> {
  const [overrides, cast] = await Promise.all([villageOverrides(pool), listArchetypes(pool, villageId)]);
  const classes = cast.map((a) => ({ key: a.key, name: a.name }));
  return { map: resolvePowerAffinity(overrides, classes.map((c) => c.key)), classes };
}

/** A catalogue row, with what the map says about it. */
export type AffinityCatalogueRow = CapabilityCatalogueRow & {
  /** The classes this power suits, named the way this village names them. Empty unless the village entrusts it. */
  suits: ClassName[];
  /** True when the power is put to this member as one that suits them. */
  recommended: boolean;
};

/**
 * The catalogue, with each entrusted power naming the classes it suits.
 *
 * `suits` is set only on rows the village entrusts, because a power the
 * ladder opens needs nobody to suggest it. A member's party is read for THIS
 * village only: a character chosen in another village on the same deployment
 * says nothing about who they are here.
 */
export async function withPowerAffinity(
  rows: CapabilityCatalogueRow[],
  who: { pool: Pool; villageId: string; userId: string; stageId: string },
): Promise<AffinityCatalogueRow[]> {
  try {
    const [{ map, classes }, characters] = await Promise.all([
      villageAffinity(who.pool, who.villageId),
      charactersForMember(who.pool, who.userId),
    ]);
    const party = characters.filter((c) => c.villageId === who.villageId).map((c) => c.archetypeKey);
    const from = stageIndex(RECOMMENDS_FROM);
    const reached = from >= 0 && stageIndex(who.stageId) >= from;
    return rows.map((row) => {
      const keys = row.opens.via === "appointment" ? (map[row.key] ?? []).slice() : [];
      const recommended = isRecommended(row, keys, party, reached);
      return {
        ...row,
        // `yours` only on a recommended power. Below the rung, the class a
        // member plays is named like any other, because marking it theirs there
        // would be the recommendation the ruling holds back until Contributor.
        suits: keys.map((key) => {
          const name = classes.find((c) => c.key === key)?.name ?? key;
          return recommended && party.indexOf(key) >= 0 ? { key, name, yours: true } : { key, name };
        }),
        recommended,
      };
    });
  } catch (err) {
    console.warn(`[powerAffinity] the catalogue went out with no suggestions: ${(err as Error)?.message ?? String(err)}`);
    return rows.map((row) => ({ ...row, suits: [], recommended: false }));
  }
}

/**
 * The powers one class suits, for its card on the character select.
 *
 * A power whose module is off here is left out, for the reason the catalogue
 * leaves it out: its routes stop mounting, so suggesting it names a door with
 * nothing behind it. So is a power this village's ladder opens, which the
 * catalogue never marks as suiting anybody. An unread map lists nothing, and
 * the seats and quests on the same card still arrive.
 */
export async function powersForClass(
  pool: Pool,
  villageId: string,
  classKey: string,
): Promise<Array<{ key: Capability; label: string }>> {
  try {
    const { map } = await villageAffinity(pool, villageId);
    const live = visibleCapabilities();
    return powersSuitedTo(classKey, map)
      .filter((key) => live.indexOf(key) >= 0 && entrustedHere(key))
      .map((key) => ({ key, label: capabilityLabel(key) }));
  } catch (err) {
    console.warn(`[powerAffinity] a class card went out with no powers: ${(err as Error)?.message ?? String(err)}`);
    return [];
  }
}

/** One power as the editor shows it. */
export interface AffinityEditorRow {
  key: Capability;
  label: string;
  /** The classes it suits in this village now. */
  classes: string[];
  /** What the platform suggests, so the editor can offer to go back to it. */
  suggested: string[];
  /** True when this village decided the power itself. */
  decided: boolean;
  /** False when its module is off here, so the suggestion reaches nobody yet. */
  live: boolean;
  /**
   * False when this village's own ladder opens the power. A decision stays on
   * the screen that made it, and this is what lets that screen say its ticks
   * currently reach no member, because the catalogue suggests only what the
   * village entrusts.
   */
  entrusted: boolean;
}

/**
 * Every power a village entrusts, with its classes, for the admin editor.
 *
 * "Entrusts" is read off this village's own rungs (`entrustedHere`), plus any
 * power the village has already decided about, so a decision never
 * disappears from the screen that made it.
 */
export async function affinityForAdmin(
  pool: Pool,
  villageId: string,
): Promise<{ classes: ClassName[]; powers: AffinityEditorRow[] }> {
  const [overrides, { map, classes }] = await Promise.all([villageOverrides(pool), villageAffinity(pool, villageId)]);
  const live = visibleCapabilities();
  const powers = ALL_CAPABILITIES.filter((key) => entrustedHere(key) || decidedIn(overrides, key)).map((key) => ({
    key,
    label: capabilityLabel(key),
    classes: (map[key] ?? []).slice(),
    suggested: (DEFAULT_POWER_AFFINITY[key] ?? []).slice(),
    decided: decidedIn(overrides, key),
    live: live.indexOf(key) >= 0,
    entrusted: entrustedHere(key),
  }));
  return { classes, powers };
}

/**
 * Save one power's classes. The caller has already checked the edit with
 * `affinityEditProblem`; this only writes it, one write at a time.
 */
export async function saveAffinityEdit(
  pool: Pool,
  capability: Capability,
  classes: readonly string[] | null,
): Promise<void> {
  const held = heldFor(pool);
  const run = held.writes.then(async () => {
    const doc = await loaded(pool);
    await doc.put(withAffinityEdit(doc.get(), capability, classes));
  });
  held.writes = run.catch(() => undefined);
  await run;
}
