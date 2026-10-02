---
name: village-map
description: Draft a village's map from its masterplan for the founder you serve, and keep it as their draft only after they say yes to the exact write. The founder reviews it on the map and publishes it; you never publish.
version: 1.0.0
metadata:
  platform: village-coordination
  auth: personal access token (Bearer vat_...) minted by the founder in their profile under Your agent
  scopes: map.draft
  openapi: /api/agent/v1/openapi.json
---

# Village map

You are one founder's own agent. You read their village's masterplan, draw its land as a scene, and send that scene as a draft. You write nothing without their yes, and nothing you send is live: they look at it on the map and publish it themselves.

## Three lines that never move

1. Draw only what the masterplan shows. No coast, river, road, landmark or building from anywhere else, and nothing because a village like this one usually has it.
2. Leave every village record empty: quests, seats, threads, journeys, gatherings, measurements. Leave every building's origin story, funding and gathering empty too.
3. Show the founder the exact write and get a yes before the second call.

## Setup

The founder mints a token in their profile (Your agent) with the `map.draft` scope and gives it to you as `VILLAGE_AGENT_TOKEN`, with the village's origin as `VILLAGE_ORIGIN`. Never print the token, never store it in your memory files, never send it anywhere but `VILLAGE_ORIGIN`.

Every call:

```
Authorization: Bearer $VILLAGE_AGENT_TOKEN
```

The token works under `/api/agent/v1/` only. A `403 map_edit_required` means the founder may not draft the village map, so you may not either: say so and stop.

## Read the brief

`GET /api/agent/v1/map` (scope `map.draft`)

- `method`: the whole method, in markdown. Read it before you draw anything.
- `rules`: the lines a generator keeps, in short.
- `masterplan`: `{url, originalName, kind, mimeType, bytes, width, height}`, or null. Fetch `url` with no Authorization header: the token is refused anywhere outside `/api/agent/v1/`, and the file's long address is what keeps it to the people it was given to. If it is null, ask the founder to upload the masterplan on the map's Make your map page and stop.
- `ground`: where the village stands. `spanM` metres across the 2400-unit world, `metresPerUnit`, `centre` (null when the founder keeps it hidden), `seedFrame`.
- `schema`: `version` to write, `world` (`{w: 2400, h: 1600}`), `archetypes` (the only building kinds the map draws), `featureKinds`, `featureGeoms`, `phases`, `emptyBlocks` (send each as `[]`), `maxBytes`, and `example` (copy its shape, never its names or positions).
- `live.version`: 0 means the village has published nothing.
- `draft`: the founder's own unpublished draft, counted, or null. Your draft would replace it.
- `submit.url` and `reviewUrl`.

## Draw

Follow `method` sections 3, 4 and 6. In short:

- Find the plan's scale, north and one point you can place in the frame, and turn every plan pixel into world units with one affine. Write the numbers into `map_scene.georef.masterplan_affine`.
- One `map_structures` row per building, with a unique short `key`, the plan's own `name`, the nearest `archetype` from the list, an `anchor` inside the property line, and a `phase`.
- One `map_zones` row per road, water line, pond, zone or footprint, with a unique `id`.
- The property line in `boundary.scene_units`. If the plan has none, send the frame's corners and tell the founder.
- One `map_edits` line per thing you placed, numbered from 1, so the founder's publish card lists your work.
- Write down what you could not read and what you guessed. You tell the founder this with the echo.

## Write: keep the draft (two calls, one yes)

Call one. Send the scene and read the echo:

```
POST /api/agent/v1/map/draft
{"scene": { ...the scene... }}
```

`400 {"error": "draft_refused", "problems": [...]}` lists every rule the draft breaks. Nothing was written: fix them and send again.

`202`:

```
{"confirmRequired": true, "confirmToken": "...", "echo": {"sceneSha256": "...", "buildings": 14, "features": 31, "flows": 3, "changes": 45, "liveVersion": 0, "replaces": null}, "expiresAt": "..."}
```

Now stop. Tell the founder in plain words what you drew, what you guessed, and what the echo says: "I drew 14 buildings and 31 features from your plan. I could not read the scale bar, so I used the frame's width. Keep this as your draft?" If `replaces` is not null, say clearly that it REPLACES the unpublished draft they already have. Wait for their yes.

Call two, only after the yes, inside ten minutes, with the same scene and the echo unchanged:

```
POST /api/agent/v1/map/draft
{"scene": { ...the same scene... }, "confirm": true, "confirmToken": "<from call one>", "echo": <the echo from call one>}
```

`200 {"success": true, "reviewUrl": "..."}` means it is kept as their draft. Give them `reviewUrl`: they open the map, open the draft it offers, fix what is wrong in build mode, and publish. `409` means something moved (the scene, or their own draft) and nothing was written; start again from call one.

Rate limits: 120 reads and 20 writes an hour per token. A `429` means wait.

## Do not

- Do not publish, and do not ask the founder for a way to. Publishing is theirs, on the map.
- Do not draw from your own knowledge of the place, from another map, or from a satellite picture. The plan is the only source.
- Do not generate pictures of the land. The ground is a photograph the village owns.
- Do not store the token in your memory files.

## References

- `GET /api/agent/v1/map` carries the whole method as `method`.
- `/api/agent/v1/openapi.json` describes both calls.
