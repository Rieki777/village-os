# Module design: Stages & Roles — module id `progression`

Provenance: platform

<!-- describes: shared/modules.ts shared/capabilities.ts shared/gameConfig.ts shared/gameVariables.ts server/lib/progressionPayload.ts server/lib/erasure.ts server/lib/villageReaders.ts server/repos/store-db.ts server/routes/players.ts server/index.ts client/src/components/profile/PowersMap.tsx client/src/components/profile/MaturityLadder.tsx client/src/components/ProfileJourney.tsx -->

> Progression is the permission spine. It owns the twelve-rung stage ladder in `GAME_CONFIG.stages`, the
> `roles` and `role_holders` tables that carry appointments, and the `stage_events` record of the crossings
> two of its paths record. It does not own the gate: `capabilityDecision` in `shared/capabilities.ts` is the one
> gate, and every module's permission answer comes through it. What this module owns is the two inputs
> that gate reads about a person, the ladder and the appointments, and the payload shaping in
> `server/lib/progressionPayload.ts` that makes those legible on a profile.

## What this module is, and why it is core

`core: true` in `shared/modules.ts`. `effectiveLifecycle` returns `"public"` for any core module before it
consults quarantine, demotion or the stored setting, so there is no request, no admin control and no
invariant failure that can switch this off. The lifecycle route refuses to move it.

That is not a preference. Every other module's capabilities are gated by a ladder this module computes and
an appointment table this module keeps. Switching it off would leave the gate with a stage index of nothing
and a role list of nothing, which is not "progression is off", it is "nobody in the village can do anything
except an administrator". The four core modules are the substrate for that reason.

The name in the registry is "Stages & Roles" and the id is `progression`. Both appear in payloads: the id
keys the module settings and the examples seed, the name is what `docs/MODULES.md` and the admin shelf
print.

## Data model

Five tables and one column, none of them new, all of them additive to what came before.

| Table | Migration | What it holds |
| --- | --- | --- |
| `roles` | `drizzle/0002_roles_and_cycles.sql` | The permission groups: `id`, `name`, `description`, `capabilities` (JSON array of capability keys), `min_stage`, `sort_order`. `circle_id` and `seats` arrived with `drizzle/0018_village_map.sql`; `is_example` with `drizzle/0046_standing_examples.sql`. |
| `role_holders` | `drizzle/0002_roles_and_cycles.sql` | One row per appointment: `role_id`, `user_id`, `granted_by`, `granted_at`. `UNIQUE (role_id, user_id)`. |
| `role_declarations` | `drizzle/0120_a_village_declares_a_role.sql` | What a role a village is voting on would be called: `ballot_id` (PK), `role_id`, `name`, `purpose`. One row per declaration ballot. A role created by vote lives here until the ballot closes, and in `roles` afterwards. |
| `stage_events` | `drizzle/0003_variables_and_stage_events.sql` | Forward crossings recorded by the two paths that call `recordStageEvent`: `from_stage`, `to_stage`, `unlocked` (JSON array of capability keys), `reason`, `at`. Two rungs are crossed without one, see Mechanics. |
| `game_variables` | `drizzle/0003_variables_and_stage_events.sql` | Where a village's tuned rungs and multipliers live. Only CHANGED values are stored; an absent row means the platform default. |
| `users.stage_granted` | `drizzle/0001_init.sql` | The one column on the member row this module writes. Nullable. |

**The row type is narrower than the table, and the compiler will not say so.** `RoleDef` in
`server/index.ts` declares `id`, `name`, `description`, `capabilities`, `minStage` and `order`. It does not
declare `seats`, `circleId` or `isExample`, while the repo spec names every column on every INSERT, so an
omitted field lands as an explicit NULL and `seats` is NOT NULL. A new creator that leaves them out
typechecks and then fails at runtime. Both existing creators carry a comment saying so, because a live
accept is what found it. Pass `seats: 1`, `circleId`, `isExample` and `order` explicitly.

**`role_holders.granted_by` holds three different kinds of value.** A real user id, from the admin and
decider path. The literal string `"admin"`, when that path had no named actor. And a BALLOT id, from the
`role_seat` executor, because the village seated them and naming the closer would say somebody appointed
what a vote decided. Ballot ids and user ids are prefixed, so they can be told apart; the executor's own
comment says a reader that cannot tell them apart must say it cannot rather than guess. The first person to
render "appointed by X" meets all three.

**Neither writer of `role_holders` ever reaches the unique key.** `POST /api/admin/roles/:id/holders` and
the `role_seat` executor both check membership in the snapshot before they push, so a repeat appointment
through the API answers 200 with the existing holder count and changes nothing. The unique key is the
backstop that would catch a fork's own writer, never a refusal a caller sees.

**Four permanent starter roles arrive at first boot.** `ensureDataFiles()` seeds
`server/seeds/roles-seed.json` into an empty `roles` table: Founders Circle, Steward Circle, Treasury and
Trained Practitioners. These are NOT examples. Founders Circle ships carrying `proposal.open`,
`proposal.decide`, `quest.consent`, `forum.moderate`, `forum.post` and `org.declare`, which makes it the
strongest permission group in a fresh village. They carry no `is_example` flag, so the retirement sweep
never removes them, and no route deletes a role. A fork that does not want them edits the seed BEFORE first
boot. Separately, this module's EXAMPLE roles and org seats seed in `seedExamplesAtBoot()` rather than off a
lifecycle change, because a core module cannot hang off one.

There is no "current stage" column anywhere. A member's stage is computed on every read by `computeStage`
in `server/index.ts` from three live facts: their training journey, their membership grant, and a `COUNT`
of consented quest claims. `stage_granted` is a FLOOR laid over that computation, never a stored answer.
The consequence a fork operator needs: **a stage can go down, silently, with no row written anywhere.**
See Sharp edges.

`roles` and `role_holders` are `dbCollection` tables. They load fully into memory at boot and are read
synchronously from that cache on every gate question. **The lock covers only one of them.**
`withRoleHolderLock` says in its own docblock that it serializes the `role_holders`
snapshot-mutate-`replaceAll` cycle, and all four of its call sites write `role_holders` alone. Every
`rolesRepo.replaceAll` and `rolesRepo.insert` runs UNLOCKED and relies on the collection's own
`collection_versions` rebase for concurrency. A fork adding a `roles` writer will otherwise assume a lock it
does not have.

A raw `UPDATE` or `DELETE` against either table leaves the running server serving the old permissions until
something calls `load()` or the process restarts. `stage_events` is a `dbCollection` too, appended with
`insert`, and its load carries no `LIMIT`: the whole history of every member sits in the server's heap, and
`/api/game/progression` filters that entire array per request.

### Two different things called "roles"

`roles` (this module, 0002) is a list of PERMISSION groups. `org_roles` and `org_role_assignments`
(`drizzle/0049_org_roles.sql`) are the sociocratic org chart: seats with an aim, a domain and
accountabilities. They share a word and nothing else. `/api/roles` serves the first, `/api/org` serves the
second, and the client page at `client/src/pages/Roles.tsx` draws the SECOND one. A reader looking for the
UI of `/api/roles` will not find it there.

## Endpoints

The registry declares two prefixes, `/api/game/progression` and `/api/roles`. Those are the two
member-facing reads. Everything else that moves this module's data sits outside them.

**Member reads.**

- `GET /api/game/progression` (`server/index.ts`). Requires a bearer token; 401 `auth_required` otherwise.
  Serves `stage` (as played, not as configured), `stageIndex`, `consentedQuests`, `capabilities` (held),
  `capabilityCatalogue` (all of them, with the rung that opens each), `roles` (id and name), `history` (this
  member's stage events, newest first) and `firsts`.
- `GET /api/roles` (`server/index.ts`). No auth required, no module gate. Serves the village's SHAPE to
  anyone: role id, name, description, `capabilities`, `minStage`, `circleId`, `seats`, `holderCount`,
  `isExample`. It answers with a **bare array**, not an object; reading `.roles` off it yields `undefined`,
  which `client/src/pages/Admin.tsx` carries a comment about because it happened. The `holders` array is
  empty unless the caller is an admin or holds `map.viewPeople`, so structure is public and people are not.

**Reads that carry this module's data under another prefix.** `GET /api/game/config` serves the ladder
through `servedLadder` to anonymous callers. `GET /api/game/me` serves `stage`, `stages`,
`consentedQuests`, `roles`, `capabilities` and `lastAdvance`. Neither is under a declared progression
prefix.

**Writes and admin reads, all admin or capability gated.**

- `GET /api/admin/players` and `PUT /api/admin/players/:id/stage` (`server/routes/players.ts`). The roster,
  and the only ROUTE that writes `stage_granted`. Admin only. Refuses an unknown stage id with 400 and a
  standing example identity with 409. Calls `recordStageEvent` on the way out. Two other writers of the
  column exist and neither is a route: `anonymizeMember` (`server/lib/erasure.ts`) nulls it when a member
  departs, and the examples seed writes it for the standing-example identities.
- `POST /api/admin/roles/:id/holders` (`server/index.ts`). Appointment and removal. This is **not** admin
  only: it runs through `mayAct(req, "proposal.decide")`, so a role or a badge can grant it. Three guards
  apply to a non-admin decider: no self-appointment, no removals, and no appointing into a role carrying a
  capability the appointer does not hold themselves.
- `PUT /api/admin/roles/:id` (`server/index.ts`). Admin only, and it accepts `{ circleId, seats }` and
  NOTHING else: name, description, capabilities and `min_stage` are not editable here. It calls
  `onRealItemPublished(getPool(), "progression", ...)`, so touching a role's seat count is what deletes this
  module's example roles and the org chart's example seats.
- `PUT /api/admin/roles/:id/capabilities` (`server/index.ts`). Admin only, the runway that adds a power to
  an existing role, through `rolesRepo.replaceAll`. Two properties are load-bearing and an agent refactoring
  this route must not drop either. Unknown keys are refused 400 against `ALL_CAPABILITIES`. And
  `applyEscalationChoices` lists any capability this role would be the FIRST in the village to carry, grants
  it only if the request ticks it, and treats silence as refusal, with the first unanswered call returning
  409 and changing nothing.
- `POST /api/admin/drafts/:id/accept` (`server/index.ts`). Admin only. When `draft.kind === "role"` it
  CREATES a `roles` row, with the capabilities and the `min_stage` an AI assistant proposed, through
  `rolesRepo.insert`. It runs the same `applyEscalationChoices` confirmation as the route above. It does not
  call `onRealItemPublished`, so a real role created this way leaves the example roles standing.
- `GET /api/admin/members/:id/capabilities` (`server/index.ts`). A read, under an admin prefix. The
  explainer: every capability key with the step that decided it, read out of `capabilityDecision` rather
  than re-implemented.

**Writes by vote.** A whole second plane creates roles, seats members into them and takes seats back by a
vote of the village. None of these is gated on admin: all three routes ask `refuseUnlessMemberMayOpen`,
which is `proposal.open`.

- `POST /api/governance/role-declarations` (`server/index.ts`) opens the ballot and writes the
  `role_declarations` row. Its `role_declare` executor inserts a `roles` row with `capabilities: []`, the
  empty array being the load-bearing value, and calls `onRealItemPublished(getPool(), "progression", ...)`,
  which retires this module's examples.
- `POST /api/governance/role-seats` (`server/index.ts`) opens a seating ballot. Its `role_seat` executor
  writes the `role_holders` row under `withRoleHolderLock` and re-checks `min_stage` at close. The route
  refuses a role carrying `ballot.vote` or `member.vouch`, because seating into one of those would be a few
  members choosing who else gets a say.
- `POST /api/governance/role-unseats` (`server/index.ts`) opens the ballot to take a seat back. Its
  `role_unseat` executor filters the holder row out, again under the lock.

The vote takes effect the instant the row lands. `roleCapabilitiesFor` reads the holder rows and the role's
capability list on every request and there is no cache between that and the gate, which is the property R90
names.

One more executor writes a role's capability list. `power_grant` adds a capability to a role through
`rolesRepo.replaceAll`, the same writer the admin route uses, which makes a carried ballot the third writer
of `roles.capabilities` after the two admin routes. It does NOT run the escalation confirmation, on purpose:
the whole frozen roll was notified when the ballot opened, the document named the consequence in the words
`CAPABILITY_CONSEQUENCE` uses, and the roll voted. The confirmation is the vote. Its counterpart
`power_return` is NOT a fourth writer of this table: returning a power deletes the village's
`capability_holding` row through `returnCapabilityToScaffolding` and leaves the role's list untouched.

## Surfaces

- `client/src/components/profile/MaturityLadder.tsx`. The twelve rungs, with the sentence saying how each
  is earned. Its rules arrive already overlaid with this village's numbers; nothing in it reads
  `GAME_CONFIG`.
- `client/src/components/profile/PowersMap.tsx`. The capability catalogue as a map rather than an
  inventory: open, opens at the next rung, opens further along, appointment only, and closed-at-or-below
  your own rung. Its groups are derived from `held` and `opens`, never from a hand-kept table.
- `client/src/components/ProfileJourney.tsx`. Held-capability chips, the three `firsts`, and the stage
  history with what each crossing unlocked. It runs raw capability keys through `capabilityLabel` before
  printing them.
- `client/src/components/GameDashboard.tsx`. Reads `lastAdvance` off `/api/game/me` and celebrates a
  crossing once, keyed on `stage:<toStage>:<at>`.
- `client/src/pages/Admin.tsx`. The Players roster with the per-member "Grant" select, and `GameRolesTab`
  for appointments.
- `client/src/components/admin/HandoverTab.tsx`. Not this module's route, but it edits `roles` rows: moving
  a capability to the village writes the key onto a role's `capabilities` list first.
- `client/src/pages/QuestDetail.tsx` and `client/src/components/governance/pickSources.ts` both read
  `/api/roles` for names, the second filtering `isExample` out.
- Not a client component: `server/lib/villageReaders.ts` declares a reader keyed `roles.all`, module
  `progression`, audience `member`, which selects `id, name, description, min_stage` from `roles` where
  `is_example = 0` and hands it to the assistant inside `fenceForPrompt`. Structure only. Holder names are
  deliberately absent, because `map.viewPeople` gates those; the sibling `seats.vacant` reader joins
  `role_holders` for counts alone.

## Mechanics

**The ladder is an ordered array, and the order is the authority.** `stageIndex` is
`GAME_CONFIG.stages.findIndex`. Every comparison in the product, the gate's rung check, a role's
`minStage`, the "did this member advance" test, resolves through it. Reordering that array reorders the
permission model. An id the array does not contain returns `-1`, and every caller treats `-1` as "no such
rung" rather than "rung zero", which is what keeps an unknown value from reading as the bottom of the
ladder.

**Six rule types, one of which is countable.** `default` and `account` are always true for anyone with a
user record. `training-complete` reads `trainingRepo.all()` and requires EVERY training module row to be in
`user.journeys.training`, returning false when the village has no modules at all. There is no draft state:
`training_modules` carries `id`, `title`, `description`, `type`, `url` and `sort_order` and nothing else, so
a POST to `/api/admin/training-modules` is live the moment it lands. `membership`
reads `membershipGranted`. `quests` compares the consented-claim count against
`progression.quests_for.<id>`. `granted` compares against `stage_granted`. `MaturityLadder` prints a
distance only for the `quests` rung, because that is the only one with a countable distance, and inventing
"60% of the way to Member" for a rung that turns on a signature is the fabrication the path progress bars
were deleted for.

**`stage_granted` is a floor, never a value.** `computeStage` runs the whole ladder first, then raises the
answer to the grant if the grant is higher. A grant BELOW the earned stage does nothing. A grant naming a
stage id the ladder does not contain resolves to `-1` and is silently ignored, with no error and no
warning.

**Appointment beats the ladder, and `minStage` is checked at appointment time only.**
`roleCapabilitiesFor` unions the `capabilities` arrays of every role the member holds, and hands that list
to the gate as `roleCapabilities`. The gate consults it at step 4, above badges and above the ladder. A
role's `minStage` is enforced at three appointment-time sites and nowhere at gate time:
`POST /api/admin/roles/:id/holders`, `POST /api/governance/role-seats` when a seating ballot opens, and the
`role_seat` ballot-outcome handler when it closes. The third exists because the second is not enough: a
member can slip below the floor while the vote runs, and the executor's own comment says so. A fork changing
the ladder's relationship to appointments has to touch all three. What no site does is re-check after
seating: see Sharp edges.

**The `training-complete` rung is a client-declared fact.** Nothing in this module writes
`user.journeys.training`. `POST /api/game/journey/sync` takes `{ journeyId, steps }` from the member's own
body and writes `u.journeys[journeyId] = steps.map(String)`, with no check that the ids name real modules,
that anything was read, or that the member ever opened one. `GET /api/training-modules` publishes every
module id unauthenticated, and `trainingComplete` asks only whether each one appears in that array. So the
Participant rung is asserted by one POST. **No capability may ever be hung on `participant` by moving a
`progression.unlock.*` dial.** Today it costs nothing, because `participant` carries multiplier 1 and opens
no key; the warning is for the fork that moves a rung.

**Two rungs are crossed with no record at all.** `recordStageEvent` has exactly two callers: the admin
grant in `server/routes/players.ts`, and quest consent in `server/index.ts`. The `membership` rung is
crossed by `PUT /api/admin/submissions/:id/status` when an accepted Love Letter sets `membershipGranted`,
which is gated on `intake.moderate` and is the only writer of that flag; the `training-complete` rung is
crossed by `POST /api/game/journey/sync`. Neither calls `recordStageEvent`. So the crossing into `member`,
which opens nine of the thirteen stage unlocks, writes no `stage_events` row, no pulse line and no
notification. The member is never told, and their profile history skips the rung entirely.

**A crossing is recorded, a fall is not.** `recordStageEvent` returns immediately when
`stageIndex(to) <= stageIndex(from)`. Forward only. It computes an unlock diff by running the gate twice,
once at the old index and once at the new, appends a `stage_events` row, writes a pulse line, and sends one
notification deduped on `stage:<userId>:<toStage>`, so a re-computation can never re-celebrate.

**Served numbers are the played numbers.** `servedRule`, `servedMultiplier`, `servedStage` and
`servedLadder` in `server/lib/progressionPayload.ts` exist because two of the ladder's numbers and the
whole unlock table became tunable. A payload built from `shared/gameConfig.ts` alone would hand a member a
figure styled exactly like the gate's while the gate compared against a different one. Each function
resolves the registry through the same expression the deciding code uses.

**An off module's capability is not a held power.** `visibleCapabilities` filters `ALL_CAPABILITIES` by
`effectiveLifecycle` of the module that declares each key, and both `heldCapabilities` and
`capabilityCatalogue` are projections of that one filter. So `capabilities` on either payload is exactly
the catalogue rows whose `held` is true, by construction rather than by agreement, and the e2e suite pins
it. The reason is a route contract: a module's API prefixes stop mounting the moment it goes off, so
advertising its key would name a door with nothing behind it.

## Game variables

**This module declares `variableKeys: []`, and that is accurate rather than an oversight.** The registry
field lists keys a module OWNS. Progression owns none, and yet 27 dials drive its behaviour, because those
27 are not written as literals anywhere. They are BUILT AT MODULE LOAD in `shared/gameVariables.ts` from
two tables this module reads:

- `GAME_CONFIG.stages` (12 entries) generates 12 `progression.multiplier.<stageId>` defs, each defaulting
  to that stage's `gratitudeMultiplier`.
- The two stages whose rule type is `quests` generate 2 `progression.quests_for.<stageId>` defs, each
  defaulting to that rule's `min`.
- `STAGE_UNLOCKS` in `shared/capabilities.ts` (13 entries) generates 13 `progression.unlock.<capability>`
  defs, each defaulting to the platform rung, plus the extra choice `"none"` meaning never by stage.

Defaults are the values that were previously hardcoded, so registering them changed nothing until a village
edits one. `docs/VARIABLES.md` is generated from the registry and carries all of them with their real
descriptions; read it there rather than here, and note its own warning that a reader of the array literal
alone would print a document missing a fifth of the registry.

The **28th** row `docs/VARIABLES.md` files under the Progression category is `org.reassignment_cadence`, a
hand-written def that belongs to the org chart's seat machinery and is read by `lapseContext`, not by
anything in this module. Category is a display grouping, not ownership.

**Who may turn them, and this is the sharpest single fact about the module.** Every progression dial sits in
the OPEN ring. `ringOf` returns `"open"` for all of them, because Progression is not one of the four
`FOUNDER_CATEGORIES` and none of these keys is in `FOUNDER_KEYS`, which is why `docs/VARIABLES.md` prints
"the whole village" on all 28 rows. The write door is `PUT /api/admin/variables/:key`, gated on `dial.set`
through `mayAct`, and `dial.set` is TRANSFERABLE. So a village that takes `dial.set` can re-cut the
permission ladder for everybody, all thirteen `progression.unlock.*` keys included, with no admin in the
chain. The member-facing route to the same values is `POST /api/game/mechanics/proposals` plus either
`POST /api/admin/mechanics/proposals/:id/apply` or `POST /api/governance/mechanics/:id/open-ballot`.

**When a change lands.** The twelve `progression.multiplier.*` defs carry `applyTiming: "cycle-close"`, and
`changeSetWaitsForCycleClose` holds any proposal set touching one of them until the boundary, where
`POST /api/admin/cycles/close` applies it while `governance.auto_apply_enabled` is on. A set holding one
cycle-timed dial waits as a whole, because atomicity beats promptness. `quests_for` and `unlock` carry no
such timing and land immediately. And an ADMIN edit through `PUT /api/admin/variables/:key` is always
immediate regardless of the def's timing: it calls `setVariable` directly and defers nothing. So the same
dial applies at once through the admin door and at the next moon through the vote door.

Two consequences of generation a fork operator will meet:

1. **Editing the ladder changes the key set.** Rename a stage id and its `progression.multiplier.*` and
   `progression.quests_for.*` keys vanish and new ones appear with platform defaults. Any stored
   `game_variables` row under the old key becomes an orphan: `loadVariables` reads it into the override
   map, nothing ever asks for it, `allVariables()` iterates the defs and never shows it, and no sweep
   deletes it. It is invisible rather than harmful. The same rename silently voids every `stage_granted`
   row holding the old id.
2. **`variable()` throws on an unknown key.** A typo reads as an exception, not as zero. Every progression
   read is safe today because each one interpolates an id that came out of `GAME_CONFIG.stages` in the same
   process, but a fork that starts interpolating a stage id from a database row is one bad row away from a
   500.

## Capabilities

The module declares `proposal.open` and `proposal.decide`. Both are consumed almost entirely by the forum
and governance routes: opening a decision thread, taking a proposal to the vote, ruling an objection,
closing a ballot, and appointing a role holder. Declaring them here rather than under `governance` is what
keeps them visible when the governance module is off, since the module-to-capability map filters by the
DECLARING module's lifecycle and this one is core.

`proposal.open` unlocks at the `co-creator` rung. `proposal.decide` has no rung at all: it is an
appointment, granted by a role, a badge or an admin, and it is marked transferable so a village can take
it.

**Do not read the gate's order from this document.** `docs/CAPABILITIES.md` is generated from
`capabilityDecision` by `scripts/generate-capabilities-doc.mjs` and checked against it by
`scripts/check-capabilities-doc.mjs`. It is the authority on all 31 keys and all 7 steps. Two things are
worth knowing before you open it, because they are the ones people guess wrong:

- **An administrator is not automatically top of the order.** Step 1 is `isAdmin && !villageHolds`. On a
  key the village has taken over through `capability_holding`, that step does not fire, and the same admin
  is judged on the later steps like anybody else. A warning badge's deny therefore beats an administrator
  on a village-held key. The account tier itself is a fourth input to the gate, beside the ladder, the
  appointments and the badges, and it is written by a route this module does not own:
  `PUT /api/admin/users/:id/role` sets `users.role` to member, admin or founder. It refuses a non-founder
  while `founderPowerStands`, refuses making anybody a founder after launch, refuses an example identity
  409, and carries a last-admin guard counting `accountsWithAdminReach()`.
- **The break-glass is the way through.** An admin who means it sends `override: true` in the body or
  `x-capability-override: true` as a header. `mayAct` then writes the admin trail entry immediately, and
  seals a public event plus a notification to the holder when the response goes out.

A refusal has three shapes. `401 { error: "auth_required" }` for no session. Whatever sentence the route
already wrote, at its own status, for an ordinary refusal, because replacing eleven written refusals with a
bare 401 would have left every person who met one told less than before. And `409` carrying
`{ error, capability, villageHolds: true, requiresOverride: true, holder, title, consequence }` for the one
case that had no sentence at all: an admin, on a village-held key, who did not break the glass.

Restating the order in prose is exactly what went stale for two weeks in `CLAUDE.md`. It is stale right now
in the docblock at the top of `PowersMap.tsx`, which describes a five-step gate and predates the two
village-held steps.

## Dependencies

Progression `requires: []` and `recommends: []`, and it genuinely needs no other module to be on. It does
read a good deal it does not own:

- **Quest claims.** `claimsRepo.consentedCount` is the input to the one countable rung. The quests module
  is core, so the count is always answerable.
- **Training modules.** `trainingRepo.all()` decides the `training-complete` rung.
- **Badges.** `capabilityCtx` calls `badgeGrantsFor` only while the badges module is on; off means zero
  queries and a gate byte-identical to its pre-badges self. Seasonally dormant badges are cached for 10
  seconds, and a failure reading them falls back to "nothing is asleep" so it can neither widen nor narrow
  anybody's permissions.
- **Capability holdings.** `villageHeldCapabilities` is read live, never cached, every time a capability
  context is built, because a permission a hand-written `UPDATE` can desync between processes is not a
  permission. That is not every authenticated request: `capabilityCtx` is built only by the routes that ask
  a capability question, and plenty of authenticated routes never call it.
- **Three tables it does not own, in the `firsts` query.** `ballot_votes`, `ballot_objections` and
  `org_role_assignments`. Migrations always run, so these answer even when governance and the org chart are
  off; a member with no history gets three nulls and a page that renders nothing, never three zeroes.
- **The examples seed.** `server/lib/examples.ts` lists `roles`, `org_roles` and `org_role_assignments` as
  progression's example tables, so this module's retirement sweep deletes the org chart's demonstration
  seats as well as its own demonstration roles.

Consumers pointing the other way are wider than the module's own surfaces, and wider than any list will
stay. **Any surface comparing a stage id resolves through `stageIndex`, so grep is the authority.** The ones
a fork operator meets by surprise: the library compares `item.minStage` when somebody borrows, the token
exchange compares `minStageToBuy` when somebody buys, quests compare `quest.minStage`, and
`buildElectorate` asks the gate for `ballot.vote` on every candidate at every ballot open. Beyond stage
comparisons, the gratitude allowance reads `progression.multiplier.<stage>` through `stageMultiplierFor`
and `server/lib/dryRun.ts` reads the same key for its projection, quest gates read `requiresRole` against
`roles`, `server/lib/villageReaders.ts` reads the `roles` table into an assistant prompt, and the departure
path reads `roleIdsFor` before it will let anybody leave.

## Sharp edges

**A stage can fall, and nothing records it.** Every rung except `granted` is recomputed from live facts on
every read, and `recordStageEvent` returns early on a backward move. Three ordinary admin acts therefore
demote members with no event, no notification and no trace:

- Raising `progression.quests_for.contributor` from 1 to 5 drops every member sitting at 1 to 4 consented
  quests back below Contributor. They lose `member.vouch`, which is the only key that unlocks at that rung.
  **The dial's own description says the opposite**: "Raising it never demotes anyone retroactively on its
  own: stages are recomputed from live counts." The clause after the colon is the mechanism that causes the
  demotion. Treat the behaviour as authoritative and the sentence as wrong.
- Adding one training module drops everyone who had completed the previous set back below Participant,
  because `trainingComplete` requires every row the table holds. There is no draft state to stage work in:
  a POST is live immediately.
- Un-consenting a quest claim moves the count down the same way.

None of these is a data loss and all three reverse the moment the input reverses. What they are is a
permission change nobody is told about, on a product whose whole design is that permission changes are
visible.

**And the consequential rung is not `contributor`.** Nine of the thirteen `STAGE_UNLOCKS` sit at `member`:
`forum.post`, `map.contact`, `stay.member_rate`, `message.send`, `exchange.buy`, `exchange.swap`,
`mechanics.propose`, `ballot.vote` and `map.photograph`. A fall below that rung takes all nine at once. It
also changes who votes, because `buildElectorate` rebuilds the roll from the gate at every ballot open and
asks it for `ballot.vote` per candidate. So adding one training module silently changes the electorate, and
therefore what quorum is measured against on the next ballot anybody opens, with no event anywhere.

**`minStage` is an appointment-time check only.** The gate hands `roleCapabilities` to `capabilityDecision`
with no stage comparison of any kind, and `roleCapabilitiesFor` never looks at `min_stage`. So a member
seated into a role that asks for Member, who later falls below Member by any of the three routes above,
keeps every capability that role carries indefinitely. If your fork treats `min_stage` as a standing
requirement rather than a hiring bar, you have to enforce it yourself.

**`min_stage`, a role's name and its description are write-once, and no route deletes a role.** The field
is set at creation and never afterwards: `POST /api/admin/drafts/:id/accept` takes it from the payload,
`role_declare` hardcodes it null, and the boot seed supplies the rest. `PUT /api/admin/roles/:id` takes
`{ circleId, seats }` only, and `PUT /api/admin/roles/:id/capabilities` takes capabilities only, so there is
no admin act that raises or lowers a floor. A fork that changes one by hand gets no re-validation of the
people already seated, in either direction. The six writers of `roles` are the boot seed, the two admin
PUTs, draft accept, `power_grant` and `role_declare`, and the only DELETE against the table is the examples
sweep. Getting a role's name or its floor wrong is fixed with a migration, or by editing the seed before
first boot.

**The unlock diff is computed against a narrower gate than the one that answers.** `recordStageEvent`
builds its two contexts from `stageIndex` and `roleCapabilities` alone. It passes no `badgeCapabilities`,
no `badgeDenies`, no `villageHeld` and no `isAdmin`, and it iterates `ALL_CAPABILITIES` rather than
`visibleCapabilities()`. Two visible results. A member carrying a warning badge that denies `message.send`
is told the crossing unlocked it while the gate still refuses. And a village with the messaging module off
gets `message.send` named in the `unlocked` array and in the notification body, which is precisely the
defect the module-lifecycle filter was written to end on the two payloads, still live on the third writer.
The stored row keeps whatever it was told, so the profile history repeats it forever.

**That notification prints raw keys.** `recordStageEvent` builds its body by joining the `unlocked` array
directly, so a member's bell and mail read "Newly unlocked: forum.post, message.send". `capabilityLabel`
exists and `ProfileJourney.tsx` uses it on the same array a few pixels away.

**The declared API prefixes gate nothing today.** The vendor-lapse loop in `server/index.ts` mounts
`requireModule` and `requireVendor` over `def.apiPrefixes`, but it iterates `vendorModules()` and nothing
in the registry sits above `included`, so the loop is a no-op. It would skip progression regardless, since
core modules are always public. This matters if you promote a listing: the prefixes as declared cover the
two member reads and miss `/api/game/me`, `/api/game/config`, `/api/admin/players/*`, `/api/admin/roles/*`
and `/api/admin/members/:id/capabilities`, every one of which carries or moves this module's data. The
gratitude entry carries the same warning in a comment.

**Raw SQL against `roles` or `role_holders` does not take effect.** Both are cached in memory and read
synchronously by the gate. Deleting a role row by hand leaves the API serving that role, and leaves its
capabilities being granted, until something calls `load()` or the process restarts.

What two ordinary writers do to each other is not that. `replaceAll` opens a transaction, reads the version
`FOR UPDATE`, and when the payload's stamped snapshot differs from the database version it three-way
REBASES the write onto the rows that exist now rather than erasing them. It logs a `[store]` warning naming
any field both writers changed, and the later writer wins that field. When the baseline has aged out of the
in-memory history it throws `StaleSnapshotError`, which surfaces as a 500 on an appointment rather than as a
refusal anybody can read.

**Raw SQL is the case the rebase cannot see.** A hand-written row is erased by the next `replaceAll` and
nothing detects it, because raw SQL never moves `collection_versions`. Only a `load()` that happens to run
notices: it compares row sets, and only then bumps the counter so outstanding snapshots rebase. A raw writer
that does not call `load()` itself is invisible to the cache AND to the counter.

**This module assumes ONE server process.** `all()` returns the in-process cache stamped with the
in-process version and never consults `collection_versions` on a read. `role_holders` is reloaded at boot
and nowhere else; `roles` is reloaded at boot and by the examples reloader. `withRoleHolderLock` states the
assumption in its own header: a promise chain suffices because this process is the only writer. Scale to two
replicas and an appointment made on instance A is not honoured by instance B until B restarts, and B's next
`replaceAll` rebases A's rows in. That is the kind of thing a fork operator discovers the day they add a
replica.

**`stage_events` never shrinks.** No retention sweep, no `LIMIT` on load, no pagination on the payload.
Growth is bounded in practice at one row per member per forward crossing, which is small, but the whole
table is resident in the server's heap and is filtered linearly per profile request. A fork running tens of
thousands of members should measure this before assuming it.

**Example rows are real rows on a public read.** `/api/roles` answers anonymously and includes seeded
demonstration roles, flagged `isExample`. Nothing downstream can tell them from the village's own without
that flag, which is why the governance picker filters on it. `POST /api/admin/roles/:id/holders` refuses
409 on an example role and on an example identity, because seating somebody into an example role announces
it on the pulse and notifies them, and then retirement deletes the role and orphans the seat.

**A holder row naming a role that no longer exists renders as the id.** `namedRoles` falls back to the id
rather than to blank, the same posture `capabilityLabel` takes with a key it cannot resolve: an
unresolvable value prints itself and says so out loud.

**When a member leaves, all three inputs to the ladder are reset.** This is a `member-pii` module, so a
fork operator answering a data request needs the whole shape. Departure is refused while the member's roles
hold open state: `exitOpenState(getPool(), user.id, roleIdsFor(user.id))` runs first. Then
`anonymizeMember` in `server/lib/erasure.ts` deletes every `role_holders` row for that member under
`withRoleHolderLock`, and clears `stageGranted`, `membershipGranted`, `journeys` and `paths` on the member
row. What SURVIVES is `stage_events`: the sweep does not touch that table, so the crossings stay, keyed on a
user id that is now a tombstone. And the data-rights export carries `stage` and `stageEvents` and carries no
role holdings at all.

## Tests

No gate checks this document against the code. `server/moduleDocProvenance.test.ts` enforces the
`Provenance:` marker and nothing else, so a route added without a doc edit is invisible. These are the
suites that pin the module's behaviour, and the ones that should go red when the gate or the appointment
paths change:

- `server/handover.routes.e2e.test.ts`. A power moves onto a role and its holder acts with a member token
  and no admin in the request; an admin reaching past a village-held power leaves a PUBLIC record.
- `server/powerTransfer.routes.e2e.test.ts`. A power crosses to the village by a vote of the whole
  electorate, with a date, an author, an outcome sentence and a permanent row.
- `server/powerRunway.routes.e2e.test.ts`. The runway and the way back with no admin in the chain: a power
  goes from carried by nobody, to held by the village, and back.
- `server/powerEight.routes.e2e.test.ts`. The seven keys converted to `mayAct`/`guardCapability`, driven one
  at a time, plus the argument for why `ballot.vote` stayed non-transferable.
- `server/glassHandle.routes.e2e.test.ts`. The break-glass 409 carries what a browser needs, and the public
  record waits for the act instead of preceding it.
- `server/steward.routes.e2e.test.ts`. R90 end to end: a village declares a role, votes it a power, votes
  somebody into it, watches them act, and takes the seat back, with no admin anywhere.
- `server/seatRecord.routes.e2e.test.ts`. Seat terms, the seat's history behind `map.viewPeople`, and the
  electorate drop measured against a control.
- `server/review.routes.e2e.test.ts`. A steward who is not an admin works the draft queue, edits a proposed
  role name and accepts a batch; a read failure renders as an error and never as an empty queue.
- `server/loop.e2e.test.ts`. The acceptance criterion for the whole product, and order-dependent: run whole
  files, never `vitest -t`.

## Where to read next

- `docs/CAPABILITIES.md` for the gate, all 31 keys and all 7 steps. Generated and checked.
- `docs/VARIABLES.md` for the Progression category, all 28 rows with their founder-facing descriptions.
- `docs/MODULES.md` for this module's registry facts as the code declares them.
- `docs/modules/module-framework.md` for what a module id, tier, lifecycle and data class mean.
- `docs/modules/badges.md` for the grant and deny paths that sit above this ladder in the gate.
