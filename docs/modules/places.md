# Module design: places

Provenance: platform

> Registry id `places`, named "Living places". The rules are `shared/places.ts`; the reads and the import are
> `server/lib/places.ts`; every statement is in `server/repos/places.ts`; the routes are
> `server/routes/placeRegistry.ts`; the schema is `drizzle/0354_every_place_is_a_living_invitation.sql`.

**Every place on the land as a living invitation: what it is, the stage it has reached from idea to built,
which permits it waits on, the roles that care for it, and how to step forward as its steward.**

## Status

Ships OFF, like every non-core module. An admin, or a holder of `module.switch`, turns it on.

Built so far:
- **S1:** the rules (`shared/places.ts`): keys, the nine stages, the building gate, permits and what they wait
  on, the preserve answers, who may adopt a stage change, the steward position's state, the claim's five
  answers, and the problems a village's seed can have.
- **S2, this release:** the tables, the module, the powers `place.tend` and `place.permit`, the seed import, the
  index in two tiers, the card, the orphan report, and `getPlaceStewardship` for the build days lane.

Not built yet:
- S3: stage proposals, the moon-review queue and adoption.
- S4: permit and preserve writes.
- S5: stewardship claims.
- S6: shared systems' vital signs and the moon-review panel.

Until S3, nothing changes a place's stage once it is imported.

## The key

A place's key is the living map's own `structure_key`, byte for byte. Keys already on a map keep their spelling,
mixed case included. New keys are lowercase slugs of at most 64 characters. The database compares keys without
case, so two keys that differ only by case are one key, and a seed carrying both is refused. A place can carry
aliases, the other keys it has been called. A lookup resolves them, and a row is never re-keyed.

## No geography is stored

The registry holds no coordinates. A place's anchor is read from the published scene's `map_structures`. A place
the scene does not draw has `anchor: null`: it is listed and never drawn. A place that is not confirmed, or has
an open dispute about whether it exists or what it matches, reads `confirmed: false`, and the map draws it dashed,
"to confirm", at every stage.

## Reads

| Door | Who | What |
|---|---|---|
| `GET /api/place-registry` | a visitor, while `map.public_structure` is on; any member | the index |
| `GET /api/place-registry/:key` | members | one place's card; an alias resolves |
| `GET /api/place-registry/orphans` | `place.tend` | what names a place the registry does not hold, and the reverse |
| `POST /api/place-registry/import` | `place.tend` | write the village's place seed |

**The public tier is structure only:**
- key, name, zone, kind and stage;
- whether the place is confirmed, and how ready it is;
- whether it is temporary, with its successor, or set aside, with the reason;
- whether it is a home;
- its anchor, and how many open quests sit there.

It carries no roles, claims, steward state or events, so no time a place is busy is ever public. It also carries
no flag saying where children may be.

**The members' tier adds:**
- whether the place is child-safe, and whether it is a showcase;
- the steward position's state, and whether the invitation is open;
- the open roles at the place, with title, state, how many it takes and how many hold it;
- open claims and queued stage changes;
- events in the next 14 days, as a count and the next start time;
- the number of photos.

**The card adds:**
- the place's words and aliases;
- its open disputes and its preserve and riparian answers;
- its stewardship (role titles only);
- its quests and events;
- its permit checklist, and whether it is complete;
- the places it serves or is part of.

Holder first names come only on the map's `viewPeople` tier: an admin, or a holder of `map.viewPeople`.

Roles, their states and holders come from `projectMapOrg`, the projection the map draws. The registry never copies
the org chart, so a place cannot disagree with it about a role.

Every answer is `private, no-cache` and varies by `Authorization`. The index carries a version: a hash over its
body and the day. Its ETag answers a matching `If-None-Match` with a bodyless 304. Amora's 66 places are about
30 KB raw on the members' tier and about 2 KB compressed.

## The seed import

A village's places start as a seed file beside its other records. Amora's is `server/seeds/amora/places-seed.json`.
Nothing loads it at boot or in a migration: a `place.tend` holder imports it, posting `{ seed }`.

- The import is refused whole, naming every problem, when `seedProblems` finds any. Among them:
  - a key on the published map missing from the seed;
  - two keys that differ only by case;
  - a place in doubt marked confirmed;
  - a standing stage on an unconfirmed place;
  - a permit that waits on itself.
- With no published map, the seed's own `onMap` keys are taken as it states them, and the answer says
  `checkedAgainstMap: false`.
- A steward role is linked by its exact title. A title that matches no live role leaves the place a virtual
  invitation, and the answer lists it under `unlinkedStewardTitles`.
- Rows that exist are kept. A second import adds what is new and undoes no edit.
- The homes target (`homesTarget`) is kept in the `place-registry` app_config document, once.

## Powers

| Power | Holds | Transferable |
|---|---|---|
| `place.tend` | import the seed and read the orphan report; from S3, confirm a match, set readiness, adopt a stage change | not yet (Rye's word, spec C8) |
| `place.permit` | from S4, the permit checklist and the preserve and riparian answers | not yet (Rye's word, spec C8) |

Both are asked through the one gate with `guardCapability`. With no live holder, the village decides by its vote
path (Article 0.3).

## Setup

Seat someone in a role carrying `place.tend`, then import the village's seed.

## Privacy and erasure

A place is village content. Its rows name only the member who imported or changed them (`created_by`,
`changed_by`), as every village-content table does. No child's location is ever stored: `child_safe` is a fact
about a place. Holder names are read from the org chart at request time, and only on the `viewPeople` tier.

## Turning it off

Off deletes nothing. Places, zones, permits and links stay, and return when it is on.
