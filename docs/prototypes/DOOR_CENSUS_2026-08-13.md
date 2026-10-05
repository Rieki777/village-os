# Door census, 2026-08-13

Rye clicked a door labelled Gratitude and got "this door is bound, but its room isn't on the map yet",
on a card whose only button said "Back to the land". This is the full list, one row per door, with
where each one now sends someone. Tick the rows you agree with and correct the ones you do not.

## What was measured, before and after

`docs/prototypes/qa/_probe_doors.js` drives every door on the real page and reads the card. It runs
against the pre-round-g artifact as well as this one, and against a scene a village had already
published as well as the seed scene, so all four numbers below can be re-taken with the shipped tool:

| | before | after |
|---|---|---|
| per-building doors | 32 | 32 |
| bound to a room on the map | 0 | 19 |
| dead ends, no way onward | **32** | **0** |
| routes the site does not serve | **16** | **0** |

The same four numbers on a scene that was published **before** this round and then restored, which is
the case that matters for any village already running:

| | before | after |
|---|---|---|
| per-building doors | 32 | 32 |
| bound to a room on the map | 0 | 19 |
| dead ends, no way onward | **16** | **0** |
| routes the site does not serve | **16** | **0** |

The 16 broken routes were `/health` x8, `/products` x4, `/stays` x3, `/exchange` x1. They were
harmless only because the card had no link. `/health` is the worst of them: the server serves it as
the ops probe, so those eight would have shown a visitor raw JSON rather than a 404.

The route list is derived from `client/src/App.tsx` by `scripts/qa/routes.mjs`, which finds 54
concrete routes. **`qa/verify_door_routes.js` was never written** (see the correction at the foot
of this file). `scripts/check-map-routes.mjs` re-derives the list on every CI run and goes red if
the map's copy drifts, in either direction.

### Re-taking every number

```
cd docs/prototypes && source qa/env.sh
node qa/_probe_doors.js                                        # the seed scene
LEGACY_DOORS=qa/legacy_doors_pre_g.json node qa/_probe_doors.js # a village that already published
GROUNDS_FILE="file:///…/head-artifact.html" node qa/_probe_doors.js   # either one, pre-round-g
node ../../scripts/check-map-routes.mjs                        # the route half, and it is in CI
```

`qa/legacy_doors_pre_g.json` is the 32 doors exactly as the map shipped them before this round,
captured by driving the old artifact rather than typed by hand.

## The census

**Route today** is what the door carried before this round. **Where I send them** is what shipped.
A "room" is a module on this map, which opens a card here *and* links to the site page. A "page" is
a site page with no room on the map yet, which now opens with a working link instead of a dead end.

| place | label shown | route today | exists? | where I would send them | why |
|---|---|---|---|---|---|
| The Gate | Welcome & Stays | `/stays` | no | **room** Stays · `/stay` | The site page is singular. The Gate is where an arrival lands and Stays is the booking room. |
| The Gate | Profiles | `/profile` | yes | **page** `/profile` | No room here answers to profiles. The page already worked. |
| Welcome Lodge | Stays | `/stays` | no | **room** Stays · `/stay` | Same room as the Gate's door. |
| Welcome Lodge | Welcome Aboard quests | `/quests` | yes | **room** Quests · `/quests` | The Quests room exists and scopes itself to the place you came through. |
| Market Pavilion | Exchange | `/exchange` | no | **room** The Exchange · `/wallet` | The module is named The Exchange. `/exchange` was never a page. |
| Market Pavilion | Payments & Donations | `/products` | no | **page** `/contribute` | No products page and no products room. Donations are what `/contribute` is. **Judgement call.** |
| Pond Hamlet | Member profiles | `/team` | yes | **page** `/team` | Already correct. It stopped being a dead end without a data change. |
| The Ponds | Village Health | `/health` | no | **room** Village Health · `/village-health` | `/health` is the server's ops probe and would have leaked JSON. |
| Greenhouse & Gardens | Harvest log | `/health` | no | **room** Village Health · `/village-health` | No harvest-log page exists. The vitals are where the numbers live. **Label changes to "Village Health".** |
| Community Center | Forum & Decisions | `/forum` | yes | **room** Forum · `/forum` | The room scopes threads to this building. |
| Community Center | Village Feed | `/feed` | yes | **page** `/feed` | Already correct. |
| Community Center | Tools Hub | `/tools` | yes | **page** `/tools` | Already correct. |
| Kitchen & Hearth | Gratitude | `/gratitude` | yes | **page** `/gratitude` | **The door you clicked.** The page existed the whole time. The card simply never offered it. |
| Kitchen & Hearth | Events | `/feed` | yes, wrong room | **room** Events · `/events` | There is an Events module and an `/events` page. The feed was the wrong destination. **Judgement call.** |
| Library & Workshop | Material Library | `/library` | yes | **room** Material Library · `/library` | The room carries the borrow quote and the wear estimate. |
| Library & Workshop | Badges & Skills | `/badges` | yes | **page** `/badges` | Already correct. |
| Council Fire | Stages & Roles | `/roles` | yes | **page** `/roles` | Already correct. |
| Council Fire | Governance | `/tools` | yes, wrong page | **page** `/governance` | A `/governance` page exists. `/tools` is the tools hub, which is the door beside it. **Judgement call.** |
| Food Forest | Quests here | `/quests` | yes | **room** Quests · `/quests` | The room lists the quests already addressed here. |
| Water Tank | Village Health | `/health` | no | **room** Village Health · `/village-health` | Same fix as the Ponds. |
| Spring Three | Water stewardship | `/health` | no | **room** Village Health · `/village-health` | **Label changes to "Village Health".** |
| Spring Two | Water stewardship | `/health` | no | **room** Village Health · `/village-health` | **Label changes to "Village Health".** |
| Spring Four | Water stewardship | `/health` | no | **room** Village Health · `/village-health` | **Label changes to "Village Health".** |
| A Possible Spring | Water stewardship | `/health` | no | **room** Village Health · `/village-health` | **Label changes to "Village Health".** |
| Ridge Hamlet North | Crowdpool | `/products` | no | **page** `/contribute` | Pooled money toward a build is what `/contribute` collects. **Judgement call.** |
| Ridge Hamlet North | Build quests | `/quests` | yes | **room** Quests · `/quests` | The room already scopes to the hamlet. |
| Ridge Hamlet South | Crowdpool | `/products` | no | **page** `/contribute` | **Judgement call.** |
| The Sanctuary | Design circle | `/forum` | yes | **room** Forum · `/forum` | The design conversation is a thread pinned to this place. |
| The Sanctuary | Crowdpool | `/products` | no | **page** `/contribute` | **Judgement call.** |
| Guest Lodge | Stays | `/stays` | no | **room** Stays · `/stay` | Same room as the Gate and the Welcome Lodge. |
| Healing Garden | Village Health | `/health` | no | **room** Village Health · `/village-health` | Same fix as the Ponds. |
| Pacific Trailhead | Village Network | `/network` | yes | **page** `/network` | Already correct. |

19 doors reach a room on the map, 13 reach a page on the site. Every one of the 32 opens something.

## The six rows to tick or correct

Everything above is measurable except these. Each is a taste call I made so that three lanes had one
answer to build against, and each is one line to flip.

1. **Crowdpool goes to `/contribute`** (Ridge North, Ridge South, Sanctuary, three doors). The other
   candidates were `/prosperity`, `/investor` and `/tokens`. If a crowdpool is closer to an
   investment than to a donation, `/investor` is the flip.
2. **Payments & Donations goes to `/contribute`** as well, so the Market has one money door pointing
   at the room (The Exchange) and one at the page.
3. **Governance moves off `/tools` to `/governance`.** The Council Fire had two doors and both went
   to the tools hub.
4. **Events moves off `/feed` to the Events room.** The Kitchen's feast is an event with an RSVP, and
   the Events module holds those.
5. **"Water stewardship" becomes "Village Health" on all four springs**, and "Harvest log" becomes
   "Village Health" at the Greenhouse. A door has two slots, a room and a route, with no third slot
   for a nickname, and a third slot would be dropped on the first publish by the whitelist in
   `restoreScene`. Getting those five names back means either a water module and a harvest module of
   their own, or accepting the room's name. Five of 32 labels changed; the other 27 read exactly as
   before.
6. **The site has a `/housing` room that no building door uses.** The three hamlets reach it through
   the separate "Reserve a home" action door instead. Worth a look when the housing numbers become
   real, because that is the door a visitor will press.

## What a founder can do now

A door added in build mode used to push free text into the scene with `/forum` as a silent default,
so every founder-added door was born unbound and the census would have re-rotted the first time you
used it. Adding a door now resolves what you type:

- a room's key (`forum`, `stay`, `health`, `library`, `quests`, `events`, `wallet`, `housing`,
  `journeys`, `admin`) binds to that room
- a room's name ("Material Library") binds to that room
- a room's route (`/village-health`) binds to that room
- any other route has to be a page the site actually serves, and it opens as a page door
- anything else is refused with a message naming what would work, rather than being accepted and
  quietly pointed at the forum

Editing a door that already exists goes through the same resolver. The label box shows the room's
name and the route box shows the room's real route, so neither box ever shows an internal key. An
edit that resolves to nothing is put back as it was, with a message. An edit that resolves to a room
keeps the room's name, because slot 0 of a bound door **is** the key and a nickname has nowhere to
live; the card says so rather than letting the box quietly snap back.

## Three things the first version of this got wrong

Worth carrying, because each one passed the gate that existed at the time.

1. **The new card was an attribute sink.** The card interpolates the route into an `href` and into an
   `onclick`, and `realRoute` stripped `?` and `#` before its membership test. So `/gratitude`
   followed by a fragment passed validation while the raw string, fragment and all, still reached both
   attributes. Measured: `onclick="return siteNav(event,'/gratitude#');alert(1);//')"`, which closes
   the JS string and runs. This is a stored shape rather than self-XSS, because `restoreScene` reads
   the route straight out of `bindings.doors[].route` on every scene push from the shell. Fixed by
   having `realRoute` hand back the **canonical** path, which is one of the 54 literals in the file,
   having `bindDoor` store that, and escaping at both attribute sites.
2. **The data half was artifact-only.** `restoreScene` replaces `SCENE.structures` wholesale, so the
   17 data edits reached the seed literal and nothing else. A village that had already published got
   all 16 broken routes back, eight of them at `/health`. A round trip that exports the already-fixed
   scene cannot see this. Fixed by resolving every door read through `bindDoor` at draw time, which
   heals an old scene without writing to it and without a line in `restoreScene`.
3. **Module keys showed up in the founder's label box.** Slot 0 carries the key on the 19 bound
   doors, so 19 of 32 boxes read `stay`, `quests`, `health`. The obvious move from there, typing a
   friendlier word, unbound the door. Fixed above. **The bound-count floor of 19 was never actually
   held by anything**, since the gate named here was never written; `scripts/check-map-routes.mjs`
   covers the route list only.

## Four more the second review found, in the fix itself

The three above were found before the doors patch shipped. These four were found by reviewing that
patch afterwards, and every one of them was opened or widened by it. None of them changes where a
door sends anybody, so the census table above still stands as written; they are here because the
pattern is the point. `qa/_probe_doorproto.js` measures all four on the real page.

1. **A door could take the whole building down.** `MODULES` and the new `LEGACY_ROUTES` are plain
   object literals, so every name on `Object.prototype` answered a lookup in them. A door whose route
   read `constructor` made `LEGACY_ROUTES['constructor']` hand back the Object **function**, and the
   next line called `.split` on it: `TypeError: r.split is not a function`. `renderTab` calls that
   once per door, so one door with that route threw the entire structure panel away, tab 0 and tab 3
   both, and left the door broken. Reachable without the founder's keyboard, because `restoreScene`
   rebuilds the structures from the published payload with their door pairs intact. Fixed with one
   own-property accessor, `ownAt`, and the three door tables reading through it.
2. **The structure key went into an onclick, twice, unescaped.** The two panel lines the doors patch
   rewrote wrote `onclick="openDoorAt('${s.key}',${mi})"`. Measured, a key of `x');window.__pwn=1;//`
   produced `onclick="openDoorAt('x');window.__pwn=1;//',0)"` and the smuggled statement **ran on the
   first click**. This is the same sink class that patch had just fixed for the route, one field over.
   Escaping is not the fix: the HTML parser turns `&#39;` back into an apostrophe before the handler
   is compiled. The key stops travelling through the attribute instead, and the button now carries a
   loop index and nothing else.
3. **A payload label executed in the panel.** `bindDoor` blesses any label whenever the **route** is
   real, which is true of all 13 page doors, and the panel printed the label straight into
   `innerHTML`. The old gate's "a payload is refused" assertion typed into a door bound to a **room**,
   where the route resolves the pair and the label is discarded, so it was true of that one row and of
   no other. Both cases are asserted now, and the label is escaped at the sink rather than refused at
   the door, because a founder is allowed to call a page door whatever they like.
4. **Prototype names passed the "is a room on this map" test.** `MODULES['constructor']` was truthy,
   so `doorLabel` reported the room's name as `Object`, `openDoor` drew `undefined Objectundefined`,
   and `#/module/__proto__` typed into the address bar reached the same branch.

And one that was **not** from this round, found while fixing the second: the action door on the same
panel, the `Book a room` / `Reserve a home here` button, interpolated the same structure key into the
same single-quoted `onclick`. It is on `main`, it predates all of this, and it is closed the same way.

**None of this was ever held by a gate.** `qa/verify_door_routes.js` does not exist and never did,
on any ref. The route half is now held by `scripts/check-map-routes.mjs`, which runs in CI; the
other checks described above are unwatched.

## Correction, 2026-08-22

Every reference above to `qa/verify_door_routes.js` was wrong. `git ls-files` and
`git log --all --diff-filter=A` return nothing for it on any ref, proven against `verify_doors.js`
as a known-present control in the same command. **Three documents cited it as a working gate, so a
reader was told the line was held when it was not** - and the map's route list duly drifted four
routes behind the router (`/campaigns`, `/decisions`, `/places`, `/propose`) with three shipped dead
doors as a result. `scripts/check-map-routes.mjs` now holds the route half in CI and has been
watched going red on that exact drift and on a rename, then green after re-derivation.

## Housing example numbers, the same round

Separate from the doors and measured by `qa/_probe_housing.js`: four player-facing surfaces render
the sample housing counts, across three hamlets, and one of the twelve said so.

| | before | after |
|---|---|---|
| surfaces labelled as an example, no hamlet set | **0 of 12** | **12 of 12** |
| surfaces labelled once a founder sets ridgeA | 0 of 12 | 8 of 12 |

The before number is 0 of 12 rather than 1 of 12 because the one label that did exist was the Housing
module's footer, which sat outside the per-hamlet row the probe reads. The predicate is single
sourced: a hamlet is an example until its structure key appears in `housing.entries` on
`/api/map/config`, per `HOUSING_AVAILABILITY_CONTRACT.md` section F. All twelve labels go quiet on
their own the moment that block arrives, with no further patch.

## Correction, 2026-10-01: two rows the published scene never took

A QA sweep opened every door on the live map, as a visitor, and two of them landed on the wrong page.

- **Row 3, Governance.** The seed has carried `/governance` since this census, but the scene the
  village published (version 6) still carries `["Governance","/tools"]`. `/tools` is a page the site
  serves, so the read-time alias table, which only heals routes the site does NOT serve, left it
  alone. The Council Fire's Governance door opened "Village Tools".
- **Item 1, Crowdpool.** The judgement call above sent Crowdpool to `/contribute` before the map's
  route list knew `/campaigns` existed (the 2026-08-22 correction records that drift). `/campaigns`
  is the Crowdpool page ("Our raisings"). The three Crowdpool doors are published as `/products`,
  which the site does not serve, so they fell through to `/contribute`.

Both are now healed at read time by `DOOR_PAIR_FIX` in the artifact, which matches the exact pair a
scene carries (label folded, route as stored): `Governance|/tools` goes to `/governance`, and
`Crowdpool|/products` goes to `/campaigns`. It is a pair and nothing looser, so the Market's
Payments & Donations, which shares `/products`, still lands on `/contribute`, and a founder who binds
either label to any other route keeps it. The seed's three Crowdpool doors now say `/campaigns`.

Two things this does not do. The published scene itself still holds the old pairs, because a
republish writes the raw door slots back; fixing the data means editing the door in build mode and
publishing. And `/campaigns` reads "No raisings yet" today, while the Ridge Hamlet North overview
still shows a pool at 72% from the published scene.
