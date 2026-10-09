/**
 * Where a thing lives on the Living Map, and WHO SAID SO.
 *
 * The second half is the point. A circle, a seat, a quest or a thread can be
 * addressed to a painted structure by a person who knows, or by a resolver
 * making a reasonable guess. Those are not the same claim, and a system that
 * stores only the address will eventually let a guess quietly overwrite
 * somebody's decision. So the provenance rides beside the address, and the
 * rule below is enforced in code rather than remembered.
 *
 * ── THE VOCABULARY ───────────────────────────────────────────────────────
 *  creator        a person placed it here deliberately
 *  creator-board  a person said deliberately that it lives at the Board,
 *                 with no structure of its own
 *  resolver-guess something inferred it, and may be replaced by a better guess
 *
 * NULL is none of these. It means nobody has said anything yet, which is
 * different from `creator-board`: one is silence, the other is a decision.
 * That distinction is the whole reason `creator-board` exists as a value.
 *
 * ── WIRE VOCABULARY vs STORED VOCABULARY ─────────────────────────────────
 * The scene may carry FOUR values; we store THREE. `pool` is the exporter's
 * derived default for "no structure was set", so it is silence and becomes
 * NULL here. The artifact states this itself now, in
 * `map_scene.address_source_vocabulary`, which carries both the value list and
 * the creator-wins law in the payload so an importer never has to infer the
 * contract from a sample. `WIRE_ADDRESS_SOURCES` below is our copy of that
 * list, and the importer cross-checks the two on every run: a scene that
 * carries a value neither side knows is reported loudly instead of being
 * quietly dropped to NULL.
 */

/** What we STORE. `pool` is deliberately absent: it is silence, not a value. */
export const ADDRESS_SOURCES = ["creator", "resolver-guess", "creator-board"] as const;
export type AddressSource = (typeof ADDRESS_SOURCES)[number];

/**
 * What a scene may CARRY, mirroring `map_scene.address_source_vocabulary`.
 *
 * Kept as our own copy on purpose. Trusting the scene's list blindly would let
 * a future export teach this importer a value it has no handling for; holding
 * a copy means the two can be COMPARED, and a divergence becomes a printed
 * warning instead of a silent NULL.
 */
export const WIRE_ADDRESS_SOURCES = ["creator", "resolver-guess", "creator-board", "pool"] as const;

/**
 * Values older exports used before the map normalised them at its boundary.
 *
 * The artifact now rewrites `lexicon guess` to `resolver-guess` on the way
 * out, so fresh scenes never carry it. Scene files exported before that fix
 * still do, and dropping one to NULL would throw away a real guess and let the
 * next resolver overwrite something it should merely have refined.
 */
const LEGACY_ALIASES: Record<string, AddressSource> = {
  "lexicon guess": "resolver-guess",
};

/** Column width in the migration; kept here so the two cannot drift. */
export const ADDRESS_SOURCE_MAX = 24;

export function isAddressSource(v: unknown): v is AddressSource {
  return typeof v === "string" && (ADDRESS_SOURCES as readonly string[]).includes(v);
}

/**
 * A human said this, so nothing automated may overwrite it.
 *
 * Both creator spellings count. `creator-board` is a person choosing NOT to
 * put something on a building, and a resolver that "helpfully" addressed it
 * anyway would be overriding exactly the decision the value records.
 */
export function isCreatorAuthored(source: unknown): boolean {
  return source === "creator" || source === "creator-board";
}

/**
 * Translate whatever the scene carries into what we store.
 *
 * Unknown values become null rather than being stored raw: a value nobody
 * recognises would sit in the column looking authoritative and satisfy none of
 * the checks that read it.
 */
export function normaliseAddressSource(raw: unknown): AddressSource | null {
  if (isAddressSource(raw)) return raw;
  // The artifact's derived "nothing was set". Silence, not a decision, and
  // the scene's own stated law says importers map it to NULL.
  if (raw === "pool") return null;
  if (typeof raw === "string" && LEGACY_ALIASES[raw]) return LEGACY_ALIASES[raw];
  return null;
}

/**
 * Compare the scene's declared vocabulary against the one we implement.
 *
 * Returns the values the scene claims that this importer has no handling for.
 * An empty array means the two agree. A scene with no declared vocabulary
 * (anything exported before the contract was published) returns empty too:
 * absence is not disagreement, and the importer falls back to the mapping it
 * already has.
 */
export function unknownWireSources(declared: unknown): string[] {
  const values = (declared as any)?.values;
  if (!Array.isArray(values)) return [];
  const known = new Set<string>([
    ...(WIRE_ADDRESS_SOURCES as readonly string[]),
    ...Object.keys(LEGACY_ALIASES),
  ]);
  return values.filter((v: unknown): v is string => typeof v === "string" && !known.has(v));
}

/**
 * THE DOCTRINE, in one function.
 *
 * May an incoming address replace what is stored? Only when the stored value
 * is silence or a guess. A `creator` or `creator-board` row is immovable by
 * anything automated; a human changes it through the surface that owns it.
 *
 * Deliberately takes only the SOURCES. Callers were getting this wrong by
 * reasoning about whether the key differed, which is the wrong question: an
 * identical key from a guess still must not downgrade a creator's provenance.
 */
export function mayOverwriteAddress(
  storedSource: unknown,
  incomingSource: unknown,
): boolean {
  // A creator's word stands, whatever is arriving.
  if (isCreatorAuthored(storedSource)) return false;
  // Silence or a stale guess yields, but only to something we recognise.
  return incomingSource === null || isAddressSource(incomingSource);
}

/**
 * The map's own name for a row, as it travels and as it is stored.
 *
 * A scene event arrives as `e1`; a scene quest arrives as the key the map
 * derived from its title once and then kept. Both go into `map_key` exactly as
 * sent (migration 0062). NOTHING HERE DERIVES A KEY. Two implementations of
 * the same slug rule must agree forever, and the first title edit on either
 * side breaks them apart, which is precisely the failure `map_key` exists to
 * end.
 *
 * 190 is the column width and the utf8mb4 ceiling for an indexed varchar. The
 * pattern is deliberately WIDER than the vocabulary-media rule
 * (`/^[a-z0-9_-]{1,32}$/`): that one bounds a small fixed table of flow types,
 * and borrowing it for a join key cut two of twenty seed quests at exactly 32
 * characters, where truncation silently collides.
 */
export const MAP_KEY_MAX = 190;
const MAP_KEY = /^[a-z0-9_-]+$/i;

/** The key as given, or null when it is unusable. Never repaired, never cut. */
export function sanitiseMapKey(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const key = input.trim();
  if (!key || key.length > MAP_KEY_MAX || !MAP_KEY.test(key)) return null;
  return key;
}

/** The `app_config` document key the map's founder-named words live under. */
export const MAP_VOCABULARY_DOC = "map_vocabulary";

/** The `app_config` document key the Welcome Walk lives under. */
export const MAP_WALK_DOC = "map_walk";

/** Gestures a walk step can gate on. Mirrors the artifact's WGATE keys. */
export const WALK_GESTURES = ["pan", "tap", "pinch", "toggle", "none", "choice"] as const;
export type WalkGesture = (typeof WALK_GESTURES)[number];

export interface WalkStep {
  id: string;
  structure_key: string;
  title: string;
  body: string;
  gesture: WalkGesture;
  gate_hint?: string;
}

/**
 * The walk, per language.
 *
 * Stored as `{ [lang]: WalkStep[] }` with `en` the default, so a village that
 * hosts in two languages does not have to choose which newcomers get a guided
 * arrival.
 *
 * AN EMPTY WALK MEANS NO WALK. It used to mean "run the artifact's own seed",
 * and the seed was another village's monologue. Rye, 2026-10-02: "Onboarding
 * is something that founders should do and really personalize and put their
 * spirit into it." So the map offers a walk only once the village has written
 * one, and the seed's example walk is offered to nobody.
 */
export const DEFAULT_WALK_LANG = "en";
export type MapWalk = Record<string, WalkStep[]>;

/** A walk language: two letters, and an optional region or script. */
const WALK_LANG = /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/;

/**
 * Coerce stored or submitted walk data into steps the artifact can run.
 *
 * Order is positional, so the array order IS the walk order and no sort key
 * has to be kept in sync. Ids are stable per step so analytics in `walk.log`
 * can be joined back to the step a newcomer stopped on.
 */
export function sanitiseWalk(input: unknown): MapWalk {
  const byLang = (input ?? {}) as Record<string, unknown>;
  const out: MapWalk = {};
  for (const [lang, steps] of Object.entries(byLang)) {
    if (!WALK_LANG.test(lang) || !Array.isArray(steps)) continue;
    const clean: WalkStep[] = [];
    for (const raw of steps.slice(0, 40)) {
      const s = (raw ?? {}) as Record<string, unknown>;
      const title = typeof s.title === "string" ? s.title.trim().slice(0, 120) : "";
      if (!title) continue;
      clean.push({
        id: typeof s.id === "string" && s.id ? s.id.slice(0, 64) : `step-${clean.length + 1}`,
        structure_key: typeof s.structure_key === "string" ? s.structure_key.slice(0, 64) : "",
        title,
        body: typeof s.body === "string" ? s.body.slice(0, 600) : "",
        gesture: (WALK_GESTURES as readonly string[]).includes(String(s.gesture))
          ? (s.gesture as WalkGesture)
          : "none",
        ...(typeof s.gate_hint === "string" && s.gate_hint.trim()
          ? { gate_hint: s.gate_hint.trim().slice(0, 160) }
          : {}),
      });
    }
    if (clean.length) out[lang] = clean;
  }
  return out;
}

/**
 * THE VILLAGE'S OWN WELCOME: the first thing the guide says on the map.
 *
 * It was a platform sentence that told every visitor "Everything you see
 * traces to something true", over a map whose seed is sample data. The guide
 * now opens with a plain greeting that promises nothing, and a village that
 * has written a welcome is greeted in its own words.
 *
 * Kept in the walk's document under this key, per language like the walk,
 * because a founder writes the two in one panel and saves them with one press.
 * The key is not a language code, so `sanitiseWalk` passes over it.
 */
export const WALK_WELCOME_KEY = "welcome";
/** The welcome's length cap, the same as a walk step's body. */
export const WALK_WELCOME_MAX = 600;
export type WalkWelcome = Record<string, string>;

/** Trimmed and capped per language. A blank welcome is no welcome, so it is dropped. */
export function sanitiseWalkWelcome(input: unknown): WalkWelcome {
  const out: WalkWelcome = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [lang, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!WALK_LANG.test(lang) || typeof raw !== "string") continue;
    const words = raw.trim().slice(0, WALK_WELCOME_MAX).trim();
    if (words) out[lang] = words;
  }
  return out;
}

/** The welcome stored beside a walk, read off the stored document. */
export function storedWalkWelcome(doc: unknown): WalkWelcome {
  const d = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  return sanitiseWalkWelcome(d[WALK_WELCOME_KEY]);
}

/**
 * WHAT A SAVE STORES: the walk the founder sent, and the welcome beside it.
 *
 * A body with no `welcome` key keeps the welcome already stored, so a client
 * that only knows about the walk cannot wipe a welcome it never showed. A
 * body that carries one, even an empty one, is the founder's answer.
 */
export function walkDocumentFrom(
  stored: unknown,
  body: unknown,
): { walk: MapWalk; welcome: WalkWelcome; doc: Record<string, unknown> } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const walk = sanitiseWalk(b.walk ?? b);
  const welcome = WALK_WELCOME_KEY in b ? sanitiseWalkWelcome(b[WALK_WELCOME_KEY]) : storedWalkWelcome(stored);
  const doc: Record<string, unknown> = { ...walk };
  if (Object.keys(welcome).length) doc[WALK_WELCOME_KEY] = welcome;
  return { walk, welcome, doc };
}

/**
 * WHAT THE MAP IS SERVED for one language: the steps and the welcome, each
 * falling back to the default language and each null when the village wrote
 * none. Null means "no walk" and "the plain welcome". It never means the seed.
 */
export function servedWalk(stored: unknown, lang: string): { walk: WalkStep[] | null; welcome: string | null } {
  const walk = sanitiseWalk(stored);
  const welcome = storedWalkWelcome(stored);
  const steps = walk[lang] ?? walk[DEFAULT_WALK_LANG] ?? null;
  return {
    walk: steps && steps.length ? steps : null,
    welcome: welcome[lang] ?? welcome[DEFAULT_WALK_LANG] ?? null,
  };
}

/**
 * THE WALK'S HALF OF THE MAP'S `{type:'config'}` PUSH, from an answer shaped
 * like /api/map/config's (or the editor's draft, shaped the same).
 *
 * Both keys are ALWAYS present, null included, because null is the village's
 * answer: it has written no walk, or no welcome, so the map offers no walk and
 * greets plainly. The map treats an ABSENT key as "keep what you have", which
 * is what the shell's bare push after a failed fetch relies on, so a caller
 * that has no answer sends neither key and never calls this.
 */
export function walkPush(body: unknown): { walk: WalkStep[] | null; welcome: string | null } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    walk: Array.isArray(b.walk) && b.walk.length ? (b.walk as WalkStep[]) : null,
    welcome: typeof b.welcome === "string" && b.welcome.trim() ? b.welcome.trim() : null,
  };
}

/**
 * HAS THIS VILLAGE WRITTEN ITS OWN WALK? The Journey to Launch asks it, as a
 * recommendation, because a village launches fine without one and the map
 * simply offers no walk.
 *
 * It reads the walk the map is SERVED, which is the default language's: the
 * shell asks for the map's config with no language, so a walk written only in
 * Spanish reaches nobody yet, and counting it would say the map offers a walk
 * it does not. And a stop needs a place, because the walk goes from place to
 * place: a walk where no stop names one has nowhere to take anybody.
 */
export function welcomeWalkCheck(stored: unknown): { state: "ok" | "missing"; detail: string } {
  const walk = sanitiseWalk(stored);
  const steps = walk[DEFAULT_WALK_LANG] ?? [];
  const stops = (n: number) => `${n} stop${n === 1 ? "" : "s"}`;
  if (!steps.length) {
    const others = Object.keys(walk);
    return {
      state: "missing",
      detail: others.length
        ? `Written in ${others.join(", ")} only. The map offers the ${DEFAULT_WALK_LANG} walk, so nobody is offered one yet`
        : "Nothing is written yet, so the map offers no walk",
    };
  }
  const placed = steps.filter((s) => s.structure_key.trim()).length;
  if (!placed) {
    return {
      state: "missing",
      detail: `${stops(steps.length)} written, and none names a place on the map, so the walk has nowhere to go`,
    };
  }
  const unplaced = steps.length - placed;
  const welcome = !!storedWalkWelcome(stored)[DEFAULT_WALK_LANG];
  return {
    state: "ok",
    detail:
      `Written, ${stops(steps.length)}${welcome ? " and your own welcome" : ""}` +
      (unplaced ? `. ${unplaced} name${unplaced === 1 ? "s" : ""} no place, so the walk passes ${unplaced === 1 ? "it" : "them"} by` : "") +
      (welcome ? "" : ". The guide greets people plainly until you write a welcome"),
  };
}

/**
 * The founder's own words for the things they draw. The map renames every
 * drawn feature from these, so they are village data and not platform copy.
 */
export interface MapVocabulary {
  road: string[];
  water: string[];
  zone: string[];
  /**
   * What flows along the lines. Not a word list: each medium carries the
   * colour and glyph the map draws it with, so a village that renames "water"
   * to "acequia" keeps the blue droplet with it. Artifact v0.8.
   */
  media: MapMedium[];
  /**
   * What a build phase is called, keyed by the phase NUMBER the scene stores
   * (`{"1":"Built","2":"Building","3":"Planned"}`). Keys stay strings because
   * that is what JSON gives back and what the artifact reads.
   */
  phases: Record<string, string>;
}

export interface MapMedium {
  key: string;
  name: string;
  color: string;
  glyph: string;
}

export const DEFAULT_MAP_VOCABULARY: MapVocabulary = {
  road: [], water: [], zone: [], media: [], phases: {},
};

/** Six hex digits or nothing: a medium's colour becomes a CSS value. */
const MEDIUM_HEX = /^#[0-9a-f]{6}$/i;

/** Keys and glyph names index into the map's own tables, so hold them plain. */
const PLAIN_KEY = /^[a-z0-9_-]{1,32}$/i;

/**
 * Trim, drop blanks, dedupe, cap.
 *
 * The three word lists are exactly that. `media` and `phases` are structured
 * and get structured treatment: a medium keeps its colour only if the colour
 * is a literal hex (it reaches CSS), and both its key and glyph must be plain
 * identifiers, because they index into the artifact's own tables rather than
 * being displayed. Anything malformed is dropped rather than repaired, since
 * a half-built medium would draw a flow in a colour nobody chose.
 */
export function sanitiseMapVocabulary(input: unknown): MapVocabulary {
  const v = (input ?? {}) as Record<string, unknown>;
  const list = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const word = item.trim().slice(0, 48);
      if (word) seen.add(word);
    }
    // Array.from, not a spread: the build target is below ES2015 iteration,
    // so spreading a Set is the same class of break as a BigInt literal.
    return Array.from(seen).slice(0, 60);
  };

  const media: MapMedium[] = [];
  const mediaSeen = new Set<string>();
  if (Array.isArray(v.media)) {
    for (const raw of v.media) {
      const m = (raw ?? {}) as Record<string, unknown>;
      const key = String(m.key ?? "").trim();
      const glyph = String(m.glyph ?? "").trim();
      const color = String(m.color ?? "").trim();
      if (!PLAIN_KEY.test(key) || mediaSeen.has(key)) continue;
      if (!PLAIN_KEY.test(glyph) || !MEDIUM_HEX.test(color)) continue;
      const name = String(m.name ?? "").trim().slice(0, 48);
      if (!name) continue;
      mediaSeen.add(key);
      media.push({ key, name, color, glyph });
      if (media.length >= 24) break;
    }
  }

  const phases: Record<string, string> = {};
  const phaseSrc = v.phases;
  if (phaseSrc && typeof phaseSrc === "object" && !Array.isArray(phaseSrc)) {
    for (const [k, raw] of Object.entries(phaseSrc as Record<string, unknown>)) {
      // The scene keys phases by number. A key that is not one names nothing
      // the map can draw, so it is dropped instead of stored as decoration.
      if (!/^\d{1,2}$/.test(k) || Object.keys(phases).length >= 12) continue;
      const name = typeof raw === "string" ? raw.trim().slice(0, 48) : "";
      if (name) phases[k] = name;
    }
  }

  return { road: list(v.road), water: list(v.water), zone: list(v.zone), media, phases };
}
