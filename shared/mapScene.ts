/**
 * The Living Map's scene, as something the village owns (0063).
 *
 * Until now the land's shape lived in exactly two places, and neither of them
 * was the village: a `const SCENE` baked into `grounds-v0.html`, and whatever
 * one founder's browser had in `localStorage`. Build mode could rearrange the
 * whole map and the only way to the live site was an exported file, a person
 * with database access, and `scripts/import-map-scene.ts` — which imports the
 * blocks that HAVE a home and skips `structures`, `zones` and `flows` because
 * "the scene's geometry has no home yet". This file is that home.
 *
 * ── STORED VERBATIM, VALIDATED AT THE ENVELOPE ───────────────────────────
 * The single most important decision here, and it is a decision made by
 * scar tissue. Round D ended with four bugs that were one bug: a value
 * crossed a boundary and lost the parts the far side had no slot for, and
 * none of them raised. `sanitiseMapSkin` dropped `flow_style` and
 * `label_style` by rebuilding its output field by field. The same rebuild
 * dropped `vocabulary.media` and `vocabulary.phases`.
 *
 * A scene has twenty top-level blocks and hundreds of nested fields, and it
 * is the MAP's document: the map writes it with `buildExportJSON()` and the
 * map reads it back with `restoreScene()`. A field-by-field sanitiser here
 * would be that same bug with twenty times the surface, and it would fire
 * every single time the map lane adds a field. So this module validates the
 * ENVELOPE (is it JSON, is it a scene, is its version one we know, is it a
 * sane size) and stores the body byte for byte. The map is the only thing
 * that interprets a scene, which is what makes verbatim storage safe.
 *
 * The version gate is what makes it safe over TIME. A scene from a build
 * this deployment has never seen is refused loudly instead of being written
 * as plausible rows from fields that have moved.
 */

/**
 * Scene versions this deployment can store and serve.
 *
 * THE CANONICAL LIST. `scripts/import-map-scene.ts` imports from here rather
 * than keeping its own copy: two lists of the same versions that must agree
 * forever is precisely what produced the vocabulary bug (three of five keys
 * absorbed, looking from outside exactly like it worked). The file importer
 * and the publish route are two doors into one absorber, so they read one
 * list.
 *
 * A family is added by EXPORTING from that build and diffing the blocks that
 * are read, never by trusting a changelog.
 */
export const SUPPORTED_SCENE_VERSIONS: readonly string[] = ["v0.6-buildmode"];
export const SUPPORTED_SCENE_FAMILIES: readonly string[] = ["v0.7", "v0.8"];

export function isSupportedSceneVersion(v: unknown): boolean {
  if (typeof v !== "string" || !v) return false;
  if (SUPPORTED_SCENE_VERSIONS.includes(v)) return true;
  // "v0.7-roundC1" -> family "v0.7". Anything with no dash is its own family.
  const family = v.split("-")[0];
  return SUPPORTED_SCENE_FAMILIES.includes(family);
}

/**
 * Everything the map may ask the village to do with a scene.
 *
 * THE LIST, and the shell routes on it rather than on a hand-written `if`
 * chain that has to be remembered twice. `qa/verify_publish.js` asserts the
 * artifact posts nothing that is not here, so a verb added on one side and
 * not the other fails a gate instead of being silently ignored by a listener
 * that looks, from the outside, exactly like it is working.
 *
 * That failure has already happened once in this bridge: `media` and `phases`
 * joined the vocabulary, only the file door grew, and the live push absorbed
 * three of five keys for a whole release with nothing raising anywhere.
 */
export const SCENE_VERBS: readonly string[] = [
  "draft-save",
  "draft-discard",
  "publish",
  "restore",
];

export function isSceneVerb(t: unknown): boolean {
  return typeof t === "string" && SCENE_VERBS.includes(t);
}

/**
 * The ceiling on a stored scene.
 *
 * A real Amora export is a few hundred kilobytes: geometry, words and ids,
 * no imagery (the satellite plate and the sprites live in the artifact and
 * are never in the scene). Three megabytes is far above any honest scene and
 * far below anything that would trouble a `json` column, so it is a guard
 * against a runaway client, never a limit a founder can reach by building.
 */
export const MAX_SCENE_BYTES = 3 * 1024 * 1024;

/**
 * The body limit for the scene routes specifically.
 *
 * `express.json({ limit: "1mb" })` is mounted globally, and a scene is
 * legitimately bigger than that. Without a wider limit ON THESE ROUTES, a
 * publish would fail with Express's own 413 and a stack trace instead of
 * this module's sentence. Deliberately above MAX_SCENE_BYTES so the size
 * message a founder reads is the one written here.
 */
/*
 * WHY 8 AND NOT 4. The scene travels as a JSON string INSIDE a JSON body, so
 * it is escaped on the way out: every quote in a scene full of keys and names
 * becomes two characters. A 3 MB scene is comfortably over 4 MB on the wire,
 * which would put a LEGAL scene over the limit and hand the person Express's
 * own 413 on the exact path this constant exists to keep readable. Generous
 * headroom, so the ceiling that ever speaks is MAX_SCENE_BYTES.
 */
export const SCENE_BODY_LIMIT = "8mb";

/**
 * Top-level blocks a scene is known to carry.
 *
 * Not a filter. Nothing is dropped for being absent from this list, because
 * dropping is the bug. It exists so `sceneProblem` can recognise a scene at
 * all, and so a test can notice when the map lane adds a block and this
 * comment goes stale.
 */
export const SCENE_BLOCKS: readonly string[] = [
  "map_scene",
  "map_zones",
  "map_structures",
  "map_flows",
  "map_structure_facts",
  "map_edits",
  "boundary",
  "circles",
  "org_roles",
  "quests",
  "journeys",
  "forum_threads",
  "events",
  "my_rsvps",
  "my_claims",
  "stays_occupancy",
  "concierge_queries",
  "vital_overrides",
];

/**
 * Is this a scene this deployment will store? Returns the reason it is not,
 * in words a founder can act on, or null when it is fine.
 *
 * Order matters: the cheapest and most likely failure first, so a founder who
 * pasted the wrong file is told that and not told about a version.
 */
export function sceneProblem(scene: unknown): string | null {
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
    return "That is not a scene: expected a JSON object.";
  }
  const s = scene as Record<string, unknown>;
  const meta = s.map_scene as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return "This does not look like a map scene: no `map_scene` block.";
  }
  if (!Array.isArray(s.map_structures)) {
    return "This scene has no `map_structures`, so it carries no land to draw.";
  }
  if (!isSupportedSceneVersion(meta.version)) {
    return (
      `Scene version "${String(meta.version ?? "")}" is not one this village knows ` +
      `(it knows ${SUPPORTED_SCENE_VERSIONS.join(", ")} and the ` +
      `${SUPPORTED_SCENE_FAMILIES.join(", ")} families). ` +
      "Publishing an unknown version would draw the land from fields that have moved."
    );
  }
  return null;
}

/**
 * The size check, separate from `sceneProblem` because the caller has the
 * serialised form and should not pay to build it twice.
 */
export function sceneSizeProblem(bytes: number): string | null {
  if (bytes > MAX_SCENE_BYTES) {
    return `That scene is ${Math.round(bytes / 1024)} KB, over the ${Math.round(
      MAX_SCENE_BYTES / 1024,
    )} KB ceiling. Something is wrong with it: a real scene is a fraction of this.`;
  }
  return null;
}

export interface SceneSummary {
  version: string;
  buildings: number;
  features: number;
  flows: number;
  quests: number;
  seats: number;
  edits: number;
}

/**
 * What a scene contains, for a member deciding whether to publish it. Every
 * count is defensive: a block may be absent in an older scene, and a summary
 * is not worth throwing over.
 */
export function sceneSummary(scene: unknown): SceneSummary {
  const s = (scene ?? {}) as Record<string, any>;
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    version: String(s.map_scene?.version ?? "unknown"),
    buildings: len(s.map_structures),
    features: len(s.map_zones),
    flows: len(s.map_flows),
    quests: len(s.quests),
    seats: len(s.org_roles),
    edits: len(s.map_edits),
  };
}

/**
 * The map's own edit journal, turned into lines a person reads before they
 * publish.
 *
 * The artifact already keeps this: every `logEdit(action, target, diff)` call
 * appends `{seq, actor, action, target, diff, at}`. Publishing it alongside
 * the scene means the confirm dialog and the revision history both describe
 * the change in the founder's own terms, for free, instead of a diff of JSON
 * nobody reads.
 *
 * An unmapped action falls back to its own key rather than being hidden. A
 * changelog that silently omits the one change you were unsure about is worse
 * than a changelog with an ugly word in it.
 */
const EDIT_VERBS: Record<string, string> = {
  place: "placed",
  move: "moved",
  remove: "removed",
  rename: "renamed",
  duplicate: "duplicated",
  scale: "resized",
  archetype: "changed the kind of",
  phase: "changed the phase of",
  circle: "changed the circle of",
  blurb: "rewrote the description of",
  origin: "rewrote the origin story of",
  activity: "changed the activity of",
  fund: "changed the funding of",
  badges: "changed the marks on",
  door: "changed a door on",
  "door-add": "opened a door on",
  "door-remove": "closed a door on",
  doors: "changed the doors on",
  "feature-edit": "redrew",
  "flow-add": "drew a flow",
  "flow-remove": "removed a flow",
  "flow-endpoint": "rerouted a flow",
  "flow-medium": "changed what flows through",
  "flow-via": "rerouted a flow",
  "flow-style": "changed the flow styling",
  "label-style": "changed the label styling",
  "quest-add": "created a quest",
  "quest-address": "moved a quest to",
  "quest-weight": "changed the weight of a quest",
  "seat-add": "created a seat",
  "seat-address": "moved a seat to",
  "address-override": "set the place of",
  "public-unlock": "opened to the public",
  "vision-boundary-seed": "drew the vision boundary",
  "vital-override": "set a village vital",
  "sprite-approve": "approved artwork for",
  "sprite-reroll": "asked for new artwork for",
  skin: "restyled the map",
  vocab: "renamed the village's words",
  undo: "undid a change to",
  "housing-total": "set the homes at",
  "housing-taken": "set the homes taken at",
  "housing-label": "named the hamlet at",
};

export interface SceneChange {
  seq: number;
  action: string;
  target: string;
  /** The whole line, ready to render. */
  text: string;
  at: string;
}

/**
 * The most recent changes first, capped. `limit` bounds what a confirm dialog
 * renders; the full journal always travels inside the scene itself, so
 * nothing is lost by showing ten.
 */
export function changeSummary(scene: unknown, limit = 20): SceneChange[] {
  const s = (scene ?? {}) as Record<string, any>;
  const edits = Array.isArray(s.map_edits) ? s.map_edits : [];
  return edits
    .slice()
    .sort((a: any, b: any) => (Number(b?.seq) || 0) - (Number(a?.seq) || 0))
    .slice(0, Math.max(0, limit))
    .map((e: any) => {
      const action = String(e?.action ?? "changed");
      const rawTarget = String(e?.target ?? "");
      // Targets arrive namespaced ("quest:Plant the beds"); the reader wants
      // the name, and the namespace is already carried by the verb.
      const target = rawTarget.includes(":")
        ? rawTarget.slice(rawTarget.indexOf(":") + 1)
        : rawTarget;
      const verb = EDIT_VERBS[action] ?? action;
      return {
        seq: Number(e?.seq) || 0,
        action,
        target,
        text: target ? `${verb} ${target}` : verb,
        at: String(e?.at ?? ""),
      };
    });
}
