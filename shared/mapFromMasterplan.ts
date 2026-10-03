/**
 * A village's map, from nothing and from its masterplan.
 *
 * Three things a village needs before it has a map of its own, in one place
 * because they are one pathway (docs/MAP_FROM_A_MASTERPLAN.md is the method):
 *
 *   1. THE BLANK SLATE. A village that has published nothing used to be shown
 *      the artifact's own seed: another village's buildings, roads, water and
 *      ground, drawn at the fidelity of the real thing. `blankScene()` is what
 *      the map is handed in its place, so the board a founder draws on, and
 *      the land under a draft they are reviewing, carry nothing that is not
 *      theirs.
 *
 *   2. THE MASTERPLAN. The document a village's land is drawn from. One per
 *      village, kept in the uploads volume, named by an `app_config` record.
 *
 *   3. THE DRAFT A FOUNDER'S AGENT SENDS. `draftSceneProblems` is the gate a
 *      generated scene passes before it is saved as that founder's draft. It
 *      checks what `sceneProblem` checks (the envelope) and then what the map
 *      needs to draw it and what a generator must never do. Nothing here
 *      publishes: the founder reviews the draft on the map and presses
 *      Publish there, through the same route as every other publish.
 *
 * Shared, because the server enforces these rules and the agent's brief
 * describes them from the same constants, so the two cannot drift.
 */
import { SCENE_BLOCKS, isSupportedSceneVersion, sceneEnvelopeProblem, sceneProblem } from "./mapScene";

/**
 * The world the map draws in, in its own units: the artifact's `W` and `H`.
 * Every anchor, polygon and path in a scene is in these units, and the
 * village's frame (centre and width in metres) is laid over them.
 */
export const SCENE_WORLD = { w: 2400, h: 1600 } as const;

/**
 * The version a drafted scene carries. A member of a family this deployment
 * stores (`isSupportedSceneVersion`), and the test holds it there, so the day
 * the families move this has to move with them.
 */
export const DRAFT_SCENE_VERSION = "v0.8-masterplan";

/**
 * The building kinds the map knows how to draw, by id.
 *
 * A COPY of the keys of `REG` in docs/prototypes/grounds-v0.html, which is the
 * source. `shared/mapFromMasterplan.test.ts` reads the artifact and fails if
 * the two disagree, the same way `SEED_GEOREF` is held to `GEOREF`. An
 * archetype outside this list draws as a blank point on the map, which is why
 * a draft may only use these.
 */
export const MAP_ARCHETYPES: readonly string[] = [
  "gate", "welcome", "trailhead", "bridge", "tower", "parking",
  "bighall", "council", "amphi", "school", "library", "archive", "embassy", "cowork",
  "hamlet", "coliving", "dome", "treehouse", "earthship", "yurts", "guest", "retreat", "hermitage",
  "foodforest", "garden", "greenhouse", "nursery", "orchard", "crops", "mushroom", "apiary", "coop",
  "barn", "paddock", "aquaponics", "seedbank",
  "spring", "well", "tank", "pond", "swale", "raincatch", "wetland", "bathhouse",
  "solar", "hydro", "biogas", "workshop", "makerspace", "sawmill", "kiln", "depot", "compost", "upcycle",
  "health", "apothecary", "sauna", "temple", "meditation", "shala", "healingarts",
  "kitchen", "dining", "cafe", "stagearts", "artstudio", "playground", "sports", "fire",
  "market", "farmstand", "store", "guild", "treasury", "media", "innovation", "research",
  "reserve", "corridor", "grove", "creek", "swimhole", "campground", "waterfall",
];

/** What a drawn feature may be, and the shape each kind is drawn as. */
export const FEATURE_KINDS: readonly string[] = ["road", "water", "zone", "structure-area"];
export const FEATURE_GEOMS: readonly string[] = ["line", "area"];

/**
 * The blocks that hold the VILLAGE'S OWN RECORDS: its quests, its seats, its
 * threads, its journeys, its gatherings, its measurements, and what its
 * members have promised. A masterplan carries none of these, so a drafted
 * scene leaves every one empty. The village fills them through its own
 * pages, where each one has a person's name on it.
 */
export const RECORD_BLOCKS: readonly string[] = [
  "org_roles",
  "quests",
  "journeys",
  "forum_threads",
  "events",
  "my_rsvps",
  "my_claims",
  "concierge_queries",
  "map_structure_facts",
];

/**
 * The scene a village with nothing published is drawn from.
 *
 * Empty in every block the map reads, so restoring it takes the seed's
 * buildings, features, flows, seats, quests, threads and journeys off the
 * land. `restoreScene` keeps whatever a block it is handed does NOT mention,
 * which is why every block is named here even when it is empty.
 *
 * THE BOUNDARY IS THE FRAME'S OWN EDGE. The map refuses to place a building
 * outside the property line, so an empty line would make the board impossible
 * to build on. The edge of the picture is the one line that is true before a
 * founder has drawn theirs, and it is the first thing build mode lets them
 * move.
 */
export function blankScene(): Record<string, unknown> {
  const { w, h } = SCENE_WORLD;
  return {
    map_scene: {
      key: "village-grounds",
      name: "",
      status: "draft",
      version: DRAFT_SCENE_VERSION,
      bounds: { w, h, units: "scene" },
    },
    map_zones: [],
    map_structures: [],
    map_flows: [],
    map_structure_facts: [],
    map_edits: [],
    boundary: { scene_units: [[0, 0], [w, 0], [w, h], [0, h]] },
    org_roles: [],
    quests: [],
    journeys: [],
    forum_threads: [],
    events: [],
    vital_overrides: {},
  };
}

// ─── The masterplan record ─────────────────────────────────────────────────

/** The `app_config` key the village's masterplan record lives under. */
export const MASTERPLAN_DOC = "map-masterplan";

/** 25 MB, the cap every other document door into the volume carries. */
export const MASTERPLAN_MAX_BYTES = 25 * 1024 * 1024;

/** Said in the refusal and in the picker's `accept`, so the two agree. */
export const MASTERPLAN_TYPES = "PDF, JPG, PNG or WebP";
export const MASTERPLAN_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

export interface MasterplanRecord {
  /** Where the file is served from: `/api/uploads/<stamped name>`. */
  url: string;
  filename: string;
  /** The founder's own name for the file, cleaned, for telling plans apart. */
  originalName: string;
  kind: "pdf" | "image";
  mimeType: string;
  bytes: number;
  /** Pixel size, for a picture. Null for a PDF. */
  width: number | null;
  height: number | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

/**
 * A stored record, read defensively: a document written by an older build,
 * or by hand, degrades to "no masterplan" instead of handing a reader a URL
 * that points somewhere it should not.
 */
export function readMasterplan(raw: unknown): MasterplanRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === "string" ? r.url : "";
  if (!/^\/api\/uploads\/[A-Za-z0-9._-]+$/.test(url)) return null;
  const kind = r.kind === "pdf" || r.kind === "image" ? r.kind : null;
  if (!kind) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    url,
    filename: typeof r.filename === "string" ? r.filename : url.slice("/api/uploads/".length),
    originalName: typeof r.originalName === "string" ? r.originalName : "",
    kind,
    mimeType: typeof r.mimeType === "string" ? r.mimeType : kind === "pdf" ? "application/pdf" : "image/webp",
    bytes: num(r.bytes) ?? 0,
    width: num(r.width),
    height: num(r.height),
    uploadedBy: typeof r.uploadedBy === "string" ? r.uploadedBy : null,
    uploadedAt: typeof r.uploadedAt === "string" ? r.uploadedAt : "",
  };
}

// ─── The drafted scene ─────────────────────────────────────────────────────

/** How many problems one refusal lists. Past this, the first ones are enough to act on. */
const MAX_PROBLEMS = 20;

type Pt = [number, number];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPt = (v: unknown): v is Pt => Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1]);
const inWorld = (x: number, y: number) => x >= 0 && x <= SCENE_WORLD.w && y >= 0 && y <= SCENE_WORLD.h;
/**
 * Roads and water may run past the frame (a public road the land fronts on),
 * so a feature point is held to one frame's width beyond each edge: generous
 * for a real road, and still a refusal for a coordinate in metres or degrees
 * sent where world units belong.
 */
const nearWorld = (x: number, y: number) =>
  x >= -SCENE_WORLD.w && x <= 2 * SCENE_WORLD.w && y >= -SCENE_WORLD.h && y <= 2 * SCENE_WORLD.h;

/** Ray casting, the same test the map's own `inBound` makes. */
function pointInPolygon(poly: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const KEY = /^[a-z0-9][a-z0-9_-]{0,47}$/i;

/**
 * Everything wrong with a drafted scene, in words its author can act on, or
 * an empty list when it may be saved as a draft.
 *
 * WHAT IT HOLDS A DRAFT TO, in order:
 *
 *   - THE ENVELOPE, through `sceneEnvelopeProblem`, the shape every publish
 *     checks first. A draft this fails could never be published anyway, and
 *     nothing past it can be read, so it is the whole answer. The publish
 *     check's other rule, one place per key (N28), is listed with the rows
 *     below in its own words, beside every other fault, and `sceneProblem`
 *     is asked once more at the end so no draft saved here could be refused
 *     at publish.
 *   - WHAT THE MAP NEEDS TO DRAW IT. The map restores a scene inside one
 *     try/catch, so one building with no anchor takes the whole land down
 *     with it. Each row is checked for the fields the restore reads.
 *   - THE JOURNAL. The publish card lists `map_edits` as the changes, and a
 *     draft with no lines in it reads as "nothing to publish". One line per
 *     building and feature placed is what lets the founder review it.
 *   - WHAT A GENERATOR MUST NEVER DO. A masterplan carries the land and no
 *     village records, so the record blocks stay empty. Funding, gatherings
 *     and origin stories are things that happened to a place, so they stay
 *     empty too. No imagery rides in a scene.
 *
 * Total over every row, capped at twenty lines, so an author who got one
 * thing wrong everywhere is told so once with enough examples to see it.
 */
export function draftSceneProblems(scene: unknown, text?: string): string[] {
  const envelope = sceneEnvelopeProblem(scene);
  if (envelope) return [envelope];
  const s = scene as Record<string, any>;
  const out: string[] = [];
  const say = (line: string) => {
    if (out.length < MAX_PROBLEMS) out.push(line);
  };

  if (!isSupportedSceneVersion(s.map_scene?.version)) {
    say(`map_scene.version must be "${DRAFT_SCENE_VERSION}".`);
  }

  const raw = typeof text === "string" ? text : JSON.stringify(scene);
  if (/data:(image|application)\//i.test(raw)) {
    say("The scene carries an embedded file. A scene is geometry and words: the masterplan and any picture stay in the uploads volume.");
  }

  // The property line, which every building has to stand inside.
  const bound: Pt[] = Array.isArray(s.boundary?.scene_units) ? s.boundary.scene_units : [];
  if (!Array.isArray(s.boundary?.scene_units) || bound.length < 3 || !bound.every(isPt)) {
    say("boundary.scene_units must be the property line as three or more [x, y] points. If the masterplan shows no line, send the frame's four corners.");
  } else if (!bound.every(([x, y]) => nearWorld(x, y))) {
    say("boundary.scene_units has points far outside the world. Points are world units (0 to 2400 across, 0 to 1600 down).");
  }
  const lineOk = bound.length >= 3 && bound.every(isPt);

  // Buildings.
  const rows: any[] = s.map_structures;
  const keys = new Set<string>();
  rows.forEach((r, i) => {
    const at = `map_structures[${i}]`;
    if (!r || typeof r !== "object") return say(`${at} is not an object.`);
    const key = typeof r.key === "string" ? r.key : "";
    if (!KEY.test(key)) say(`${at}.key must be a short id of letters, digits, - or _ (got ${JSON.stringify(r.key ?? null)}).`);
    else if (keys.has(key)) say(`${at}.key "${key}" is used twice. Each building needs its own key.`);
    keys.add(key);
    if (typeof r.name !== "string" || !r.name.trim() || r.name.length > 80) {
      say(`${at}.name must be the building's name as the masterplan labels it, 1 to 80 characters.`);
    }
    if (!MAP_ARCHETYPES.includes(String(r.archetype))) {
      say(`${at}.archetype "${String(r.archetype ?? "")}" is not a kind the map draws. Pick the nearest from the brief's archetype list.`);
    }
    const x = r.anchor?.x;
    const y = r.anchor?.y;
    if (!isNum(x) || !isNum(y)) say(`${at}.anchor must be {x, y} in world units.`);
    else if (!inWorld(x, y)) say(`${at}.anchor (${x}, ${y}) is outside the world (0 to 2400 across, 0 to 1600 down).`);
    else if (lineOk && !pointInPolygon(bound, x, y)) say(`${at} "${key}" stands outside the property line.`);
    if (![1, 2, 3].includes(r.phase)) say(`${at}.phase must be 1, 2 or 3: built, building next, or the long vision.`);
    if (typeof r.origin_story === "string" && r.origin_story.trim()) {
      say(`${at}.origin_story must be empty. An origin story is a memory the village writes once a place has one.`);
    }
    if (r.state_inputs?.fund != null) say(`${at}.state_inputs.fund must be null. Funding is a fact the village's own pool records.`);
    if (r.state_inputs?.event) say(`${at}.state_inputs.event must be null. A gathering is a record the calendar keeps.`);
    const doors = r.bindings?.doors;
    if (doors !== undefined && (!Array.isArray(doors) || !doors.every((d: any) => d && typeof d.route === "string" && /^\/(?!\/)/.test(d.route)))) {
      say(`${at}.bindings.doors must be a list of {label, route} with routes on this site, each starting with a single /.`);
    }
  });

  // Drawn features: roads, water, zones, building footprints.
  const zones: any[] = Array.isArray(s.map_zones) ? s.map_zones : [];
  if (s.map_zones !== undefined && !Array.isArray(s.map_zones)) say("map_zones must be a list.");
  const ids = new Set<string>();
  zones.forEach((z, i) => {
    const at = `map_zones[${i}]`;
    if (!z || typeof z !== "object") return say(`${at} is not an object.`);
    if (z.id == null) return; // the map's own default-ground row carries no id and is never drawn from
    const id = String(z.id);
    if (ids.has(id)) say(`${at}.id "${id}" is used twice.`);
    ids.add(id);
    if (!FEATURE_KINDS.includes(z.kind)) say(`${at}.kind must be one of ${FEATURE_KINDS.join(", ")}.`);
    if (!FEATURE_GEOMS.includes(z.geom)) say(`${at}.geom must be "line" or "area".`);
    const pts = z.geom === "area" ? z.polygon : z.path;
    const need = z.geom === "area" ? 3 : 2;
    if (!Array.isArray(pts) || pts.length < need || !pts.every(isPt)) {
      say(`${at} needs ${z.geom === "area" ? "a polygon of three" : "a path of two"} or more [x, y] points.`);
    } else if (!pts.every(([x, y]: Pt) => nearWorld(x, y))) {
      say(`${at} has points far outside the world. Points are world units.`);
    }
    if (![1, 2, 3].includes(z.phase)) say(`${at}.phase must be 1, 2 or 3.`);
    if (z.owner_structure_key != null && !keys.has(String(z.owner_structure_key))) {
      say(`${at}.owner_structure_key "${String(z.owner_structure_key)}" names no building in this scene.`);
    }
  });

  if (!rows.length && !ids.size) say("The scene draws nothing: no buildings and no features.");

  // Flows between buildings, as the masterplan declares them.
  const flows: any[] = Array.isArray(s.map_flows) ? s.map_flows : [];
  if (s.map_flows !== undefined && !Array.isArray(s.map_flows)) say("map_flows must be a list.");
  flows.forEach((f, i) => {
    const at = `map_flows[${i}]`;
    if (!f || typeof f !== "object") return say(`${at} is not an object.`);
    if (f.from_key != null && !keys.has(String(f.from_key))) say(`${at}.from_key "${String(f.from_key)}" names no building in this scene.`);
    if (!keys.has(String(f.to_key ?? ""))) say(`${at}.to_key must name a building in this scene.`);
    if (typeof f.medium !== "string" || !f.medium.trim()) say(`${at}.medium must say what flows (water, food-raw, energy...).`);
  });

  // The journal the publish card reads.
  const edits: any[] = Array.isArray(s.map_edits) ? s.map_edits : [];
  if (!edits.length) {
    say("map_edits is empty. Write one line per building and feature you placed ({seq, actor, action: \"place\", target, at}), so the founder's publish card can list them.");
  }
  const seqs = new Set<number>();
  edits.forEach((e, i) => {
    const at = `map_edits[${i}]`;
    if (!e || typeof e !== "object") return say(`${at} is not an object.`);
    if (!Number.isInteger(e.seq) || e.seq < 1) say(`${at}.seq must be a whole number from 1.`);
    else if (seqs.has(e.seq)) say(`${at}.seq ${e.seq} is used twice. Number the lines 1, 2, 3 and on.`);
    seqs.add(e.seq);
    if (typeof e.action !== "string" || !e.action) say(`${at}.action must name what was done (place, draw...).`);
    if (typeof e.target !== "string") say(`${at}.target must name what it was done to ("structure:<key>").`);
    if (typeof e.at !== "string" || Number.isNaN(Date.parse(e.at))) say(`${at}.at must be an ISO date and time.`);
  });

  // The village's own records stay the village's.
  for (const block of RECORD_BLOCKS) {
    const v = s[block];
    if (v !== undefined && (!Array.isArray(v) || v.length > 0)) {
      say(`${block} must be empty. A masterplan carries the land; ${block.replace(/_/g, " ")} are the village's own records.`);
    }
  }
  const vo = s.vital_overrides;
  if (vo !== undefined && (typeof vo !== "object" || vo === null || Array.isArray(vo) || Object.keys(vo).length)) {
    say("vital_overrides must be empty. The village's vitals are counted, never drafted.");
  }
  if (Array.isArray(s.housing?.rows) && s.housing.rows.length) {
    say("housing.rows must be empty. How many homes are open is the village's own count.");
  }

  // The publish check whole, so a draft that passes here is one a publish takes.
  if (!out.length) {
    const publishable = sceneProblem(scene);
    if (publishable) say(publishable);
  }
  return out;
}

/** The blocks a scene is recognised by, re-exported for the brief. */
export { SCENE_BLOCKS };
