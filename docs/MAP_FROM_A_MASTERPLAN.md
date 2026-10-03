# Making a village's map from its masterplan

<!-- describes: shared/mapFromMasterplan.ts shared/mapScene.ts server/routes/agentMap.ts server/routes/mapMasterplan.ts client/src/components/map/MapSlate.tsx docs/prototypes/grounds-v0.html -->

This is the method a village's first map is made by, and the brief its founder's own agent reads
before it drafts one. The agent receives this file whole from `GET /api/agent/v1/map`, beside the
masterplan, the village's land record and the scene schema, so it is written to be followed.

**Code:** `shared/mapFromMasterplan.ts` (the blank scene, the masterplan record, the draft rules),
`server/routes/mapMasterplan.ts` (the upload), `server/routes/agentMap.ts` (the agent's two routes),
`client/src/components/map/MapSlate.tsx` (what a village with no map shows),
`docs/prototypes/grounds-v0.html` (the map itself), `docs/skills/village-map/SKILL.md` (the agent skill).

---

## 1. The pathway, in one paragraph

A village that has published no map shows visitors an honest empty state and shows the people who may
draft the land (`map.edit`) a **Make your map** page. There they upload the masterplan. A founder then
gives their own agent a token carrying the `map.draft` scope. The agent reads the masterplan and this
method, draws the land as a scene, and sends it as a **draft**: checked against the rules in section 6,
echoed back, and kept only after the founder says yes. The draft sits in the founder's own draft row,
the same row build mode saves into. The founder opens the map, the map offers the draft, they look at
it, change what is wrong in build mode, and press Publish. **Nothing is published by anyone but a
person with `map.publish`. The platform makes no model call and holds no model key for this: the
founder's agent does the generation, on the founder's account with its provider.**

Drawing the land by hand is the same pathway without step two: Make your map opens the map on a blank
land, and build mode does the rest.

## 2. How the first village's version 1.0 was made

The first map (August 2026, `docs/prototypes/`, history from `a3915f4`) was drawn from one sheet: the
village's master plan, version 7, a PDF carrying LiDAR contours, creeks and springs, forest cover,
protection zones and every building footprint coloured by type. What was done, in order, and what each
step taught:

1. **Read the plan, by hand.** A build session read the sheet and wrote the land as a literal: the
   `const SCENE` near the top of `grounds-v0.html`. Twenty-two buildings with a name, a kind
   (`archetype`), a district, a position, a phase and a funding level; six districts; seven clearings;
   three creeks; two ponds; eight internal roads and two public ones; and the property line as nineteen
   points. **Positions were in the plan's own pixel space.** That is the right first move: copy what the
   plan shows where it shows it, and convert later in one place.
2. **One affine into the world.** `TP(x, y) = (x * 0.58 + 800, y * 0.72 + 110)` (`AF` in the artifact)
   carried every plan pixel into world units, and `migrate()` applied it to every array once. Its inverse
   (`IAF`) is still written into every export as `map_scene.georef.masterplan_affine`, so any point on
   the published map can be traced back to the sheet.
3. **One pin on the Earth.** `fetch_sat.py` stitched Esri World Imagery tiles around one point
   (9.2320128 N, 83.8343203 W) at zoom 17 into a 2400 by 1600 world covering 2592 by 1728 metres, and
   put that point at world (1520, 800). `GEOREF` in the artifact carries the same constants, and
   `worldToLatLon` turns any world point into WGS84 by them. **The pin is not the centre**: the frame's
   centre is world (1200, 800), about 345 metres west of the pin. Anything that centres a picture on "the
   village's coordinates" lands that far off unless it uses the frame centre.
4. **A painted plate, and why it was retired.** `gen_plate.py` sent the masterplan to an image model
   and asked for a painterly world map "keeping the actual geography faithful". It was measured against
   the satellite (Fix 16 in the original build session's prompt, which is kept in the maintainers'
   private operations repository): ocean coverage 7 percent against 20, a shoreline displaced a mean of
   252 world units, edge agreement 0.069, and buildings painted where the scene had none. **An image
   model asked to keep geography faithful invents geography.** The painted plate became a deterministic
   filter over the real satellite, and the generated picture survives only as six palette numbers.
5. **Sprites per kind of building, never per village.** `gen_sprites.py` made one transparent sprite per
   icon family (great hall, greenhouse, spring, and so on, thirty in all) from a fixed style preamble,
   and `gen_wip_sprites.py` made each one's half-built twin from the finished sprite. Natural features
   drew as architecture until they got their own preamble (Fix 14). These are platform art: every
   village's greenhouse uses the same greenhouse. A village map never needs new sprites.
6. **The geometry layer.** Roads, water, clearings and footprints moved from seven hard-coded arrays into
   one primitive (`FEATURE_GEOMETRY_LAYER.md`): a feature with an `id`, a `kind`, a `geom` (line or
   area), its points, a `subtype`, a `phase` and an owner. That is the shape a scene carries today.
7. **The export became the contract.** `buildExportJSON()` writes the scene a publish stores, and
   `restoreScene()` reads it back. `shared/mapScene.ts` stores it byte for byte and checks only the
   envelope, because every bug in round D was a value losing the parts the far side had no slot for.
8. **Records were matched, never created.** `scripts/import-map-scene.ts` connected the scene's seats,
   quests and threads to the village's real rows by name, and reported every one it could not match
   instead of creating it.

What the first version got wrong, and what this pathway does instead:

| Then | Now |
|---|---|
| The plan of the first plan (`LIVING_MAP_PLAN.md` 5.3) pulled the coast, public roads and "generic" neighbouring roofs from open map data, and auto-published the result | Nothing past the plan is drawn by a generator, and nothing is published by anything but a person (Rye's standing ruling: the map may not invent geography) |
| A model painted the ground from the plan | The ground is a photograph the village owns or open satellite data (`docs/VILLAGE_LAND.md`), and the map draws an honest flat field until it has one |
| Funding levels, events, origin stories, sample quests and seats were written into the seed scene | A drafted scene leaves every record empty; the village's own pages fill them |
| Every new village inherited the first village's land as its own | A village with nothing published starts blank (section 7) |

## 3. The scene

A scene is one JSON object. The map writes it (`buildExportJSON`), the server stores it verbatim
(`map_scene_drafts`, `map_scene_revisions`), and the map reads it (`restoreScene`). Size ceiling: 3 MB.
A scene is geometry and words: no imagery travels in one.

**The version.** `map_scene.version` must be a version this deployment stores. A drafted scene writes
`v0.8-masterplan` (`DRAFT_SCENE_VERSION`). The brief's `schema.version` is the value to use.

**What the map reads** (each block it is not handed keeps whatever was on screen, which is why a draft
names every block, empty or not):

| Block | Rows | The fields the map reads |
|---|---|---|
| `map_scene` | one object | `version`; `vocabulary` (the village's words for road, water and zone kinds); `vision_bound` (optional) |
| `map_structures` | one per building or point feature | `key` (short id, unique), `name`, `archetype` (one of the brief's `schema.archetypes`), `anchor: {x, y}`, `phase` (1 built, 2 building next, 3 the long vision), `circle_id` (null), `blurb`, `origin_story` (empty), `state_inputs: {fund: null, activity: "steady", event: null}`, `bindings.doors` (`[{label, route}]`, routes on this site), `scale` (1) |
| `map_zones` | one per drawn feature | `id` (unique, never reused), `kind` (`road`, `water`, `zone`, `structure-area`), `geom` (`line` with a `path`, or `area` with a `polygon`), points as `[x, y]`, `subtype` (`track`, `improved`, `paved`, `creek`, `pond`, `meadow`, `forest`, `orchard`...), `phase`, `owner_structure_key` (a footprint's building, else null), `name`, `public` (true for a public road the land fronts) |
| `map_flows` | one per declared flow | `from_key` (a building, or null for off the land), `to_key` (a building), `medium` (`water`, `food-raw`, `food-prepared`, `compost`, `materials-raw`, `materials-finished`, `energy`, `care`), `note`, `phase`, `via_feature` (a road or water line's `id`, optional) |
| `boundary` | one object | `scene_units`: the property line, three or more `[x, y]` points |
| `map_edits` | one per change | `{seq, actor, action, target, diff, at}`, `seq` from 1 and unique, `at` an ISO time. The publish card lists these lines, so a draft writes one per thing placed: `action: "place"` with `target: "structure:<name>"`, and `action: "feature-edit"` with `target: "feature:<name>"` |
| `org_roles`, `quests`, `journeys`, `forum_threads`, `events`, `my_rsvps`, `my_claims`, `concierge_queries`, `map_structure_facts` | none | The village's own records. A draft sends each one as `[]` |
| `vital_overrides` | none | `{}` |

**Optional and kept verbatim:** `map_scene.georef` (write your `masterplan_affine` here, as version 1.0
did, so the plan can be traced from the map), `map_scene.name`, `map_scene.note`.

The brief carries a small example in `schema.example`. Copy its shape; every name and position in a real
draft comes from the plan.

## 4. Georeferencing

**World units.** The map draws in a world 2400 units across and 1600 down (`SCENE_WORLD`), x to the east,
y to the south, north up. Every anchor, path, polygon and boundary point is in these units.

**The frame is the village's land record.** A founder sets a centre and a width in metres
(`docs/VILLAGE_LAND.md`); the map lays the world over that rectangle with the centre at world (1200, 800)
and `spanM / 2400` metres per unit. The brief's `ground` block carries `spanM`, `metresPerUnit` and the
centre when the founder's visibility setting lets it be known (it is null at "hidden"), and
`seedFrame`, which says whether the village stands on the first village's own rectangle.

**From the plan to the world.** Find, on the plan:

1. its scale (a scale bar or a stated ratio): metres per plan pixel, `m`;
2. north (a north arrow): the angle `θ` the plan is turned from north-up;
3. one point you can place in the frame: if the plan is georeferenced, any labelled coordinate; if the
   founder placed the land record on the plan's centre, the plan's centre at world (1200, 800).

Then every plan pixel `(px, py)` relative to that anchor point `(ax, ay)` goes to the world as

```
k  = m / metresPerUnit                    world units per plan pixel
dx = (px - ax) * cos θ - (py - ay) * sin θ
dy = (px - ax) * sin θ + (py - ay) * cos θ
world = (anchorWorldX + k * dx, anchorWorldY + k * dy)
```

which, with no rotation, is version 1.0's own affine: `sx = sy = k`, `dx = anchorWorldX - k * ax`,
`dy = anchorWorldY - k * ay`. A coordinate in degrees goes to the world through the inverse of
`worldToLatLon` about the frame's centre. Keep every point inside the world, keep every building inside
the property line, and write the numbers you used into `map_scene.georef.masterplan_affine`.

**When the frame is unknown** (`ground.configured` false, or no `spanM`): say so to the founder and draw
the plan scaled to fit inside the world, centred, with its own scale bar as the measure. The map shows
coordinates only where it knows them, so nothing false is printed; ask the founder to place the village
before publishing.

## 5. Sprites, plates and the ground

- **Sprites** belong to the platform. A building's look comes from its `archetype`. A generator picks the
  nearest archetype from the list and makes no images.
- **The ground** is a photograph: the village's own aerial picture, or open satellite data the licence
  lets the village keep (`docs/VILLAGE_LAND.md`, section 4). It is never generated. Under a village that
  does not stand on the first village's rectangle, the first village's satellite, coast, place names and
  district names are taken down and the map draws a flat field, which is honest about having no picture.
- **The painted look** is a filter over whatever ground there is. It needs nothing from a generator.

## 6. What a generator must do, and must never do

Every line here is enforced by `draftSceneProblems` (`shared/mapFromMasterplan.ts`) when the draft is
sent, except the ones only a reader of the plan can check, which are on the generator's honour and the
founder's review.

**Must:**

- Draw only what the masterplan shows: its buildings, roads, water, zones and property line.
- Take names from the plan's labels. Name an unlabelled thing plainly ("Building 4", "North track").
- Use an archetype from the list for every building, the nearest one when none is exact.
- Give every building an anchor in world units inside the property line, a phase the plan supports (1, 2
  or 3), and a unique short key.
- Give every feature a unique id, a kind, a geometry and points in world units.
- Write one `map_edits` line per thing placed, numbered from 1, so the founder's publish card lists it.
- Send the property line. If the plan shows none, send the frame's four corners and tell the founder.
- Tell the founder what you could not read, and what you guessed.

**Must never** (Rye's standing ruling: the map may not invent geography, and nothing sample is shown at
the fidelity of the real thing):

- Never draw what the plan does not show: no coast, river, road, landmark or neighbouring building from
  general knowledge, from another map, or because a village of this kind usually has one.
- Never write a village record: quests, seats, threads, journeys, gatherings, measurements and promises
  stay empty. They belong to the people who keep them.
- Never write an origin story, a funding level or a gathering onto a building. They are things that
  happened to a place, and nothing has happened yet.
- Never send imagery inside a scene, and never generate a picture of the land.
- Never publish. The founder publishes, on the map, after looking.

## 7. The blank slate

Until a village publishes, `GET /api/map/draft` answers `liveVersion: 0`. The shell then shows:

- a **visitor**: "*Village* has not drawn its map yet", the org view, and the way out. The four-megabyte
  map is never downloaded for them.
- **someone who may draft the land**: Make your map, with the masterplan upload, the agent step, and the
  draft waiting for review.

When the map is opened from there, the shell hands it `blankScene()` in place of the seed: every block
empty and the property line on the frame's edge, so build mode can place buildings. The seed's ground
comes down unless the village stands on the seed's own rectangle (`seedGround` in the config push). The
first village has a published map and none of this applies to it.

A read that fails decides nothing: the shell then behaves exactly as it did before.

## 8. The agent's side, call by call

The skill is `docs/skills/village-map/SKILL.md`, served at `/api/agent/v1/skills/village-map/SKILL.md`.

1. **The founder** uploads the masterplan (Make your map, or `POST /api/map/masterplan` with a `file`),
   then mints a token in their profile under Your agent with the `map.draft` scope.
2. **The agent** reads `GET /api/agent/v1/map`: this method, the rules, the masterplan link, the
   `ground`, the `schema` (version, world, archetypes, feature kinds, the blocks that stay empty, an
   example), the live version, any draft already waiting, and where to send the draft.
3. **The agent** fetches the masterplan from its link, with no Authorization header (the token is
   refused outside `/api/agent/v1/`), and reads it. A PDF is the agent's to render.
4. **The agent** sends `POST /api/agent/v1/map/draft {scene}`. A draft that breaks a rule comes back
   `400 draft_refused` with every problem listed; nothing is written. A sound one comes back `202` with
   an `echo` (counts, a hash of the exact scene, the live version, and `replaces` when the founder already
   has unpublished work that this would replace) and a `confirmToken`.
5. **The agent** shows the founder the echo and gets a yes, then sends the same scene with
   `confirm: true`, the `confirmToken` and the `echo`, inside ten minutes. `200` means it is kept as the
   founder's draft. `409` means something moved (the scene, or the founder's own draft) and nothing was
   written.
6. **The founder** opens the map. It offers "You have an unpublished draft of the map", they open it,
   fix what is wrong in build mode, and publish through the publish card, which lists the agent's lines.

## 9. Not built yet

- **District names in the scene.** The map draws district names from the seed and nowhere else, so a
  drafted scene cannot name its own districts yet; it names its zones instead. Reading
  `map_scene.districts` in `restoreScene` and writing it in `buildExportJSON` closes this.
- **The land screen.** `PUT /api/admin/land` and the imagery fetch exist without an admin screen
  (`docs/VILLAGE_LAND.md`, section 6), so a founder places the village through the API today.
- **The first village's words in the map itself.** Maia's welcome and the vitals bar name the first
  village, and the export carries the artifact's sample gatherings and measurements labelled as samples.
  These are the artifact's, and a drafted scene does not carry them.
- **Several parcels.** One scene is one parcel's frame. A village with land in two places drafts one
  scene per parcel, and the map draws one at a time.
