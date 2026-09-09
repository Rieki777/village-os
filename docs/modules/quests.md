# Module design: Quests — module id `quests`

Provenance: platform

<!-- describes: server/routes/quests.ts server/repos/quests.ts server/index.ts shared/modules.ts shared/gameVariables.ts shared/questRewards.ts client/src/pages/Admin.tsx client/src/pages/QuestDetail.tsx client/src/components/QuestActions.tsx server/lib/capabilityRegistry.ts server/lib/crews.ts server/lib/questProposals.ts server/lib/calendarProviders.ts -->

> The contribution board. A quest is posted by an admin or by a `quest.approve` holder, claimed by
> a member, submitted with evidence, and consented to by somebody who is not the claimant. Consent
> is the one step that releases value. The board and the two member steps live in
> `server/routes/quests.ts`; the consent route, the queue and the gate helpers live in
> `server/index.ts`. The tables have three homes: `server/repos/quests.ts` holds `quests` and
> `quest_claims`, `server/lib/crews.ts` holds the two crew tables, and `server/lib/questProposals.ts`
> holds `quest_proposals`. It shipped in the first migration and fourteen more have extended it.

## What this module is, and why it is core

`shared/modules.ts` carries `core: true` on the `quests` entry. That word does four things in
this codebase, and none of them is a label:

- `effectiveLifecycle` in `server/lib/modules.ts` returns `"public"` for a core module before it
  looks at any stored setting, so the routes are always mounted and the surfaces always render.
- `setModuleLifecycle` in the same file refuses a lifecycle write on a core module with
  `400 "core and cannot change lifecycle in v1"`. There is no admin path to turn quests off.
- Both variable-hiding filters, in `GET /api/admin/variables` and `GET /api/game/mechanics`,
  select on `!m.core`. A core module's dials are therefore never hidden, whatever the lifecycle
  machinery is doing elsewhere.
- It has a fourth effect nobody intended. `markModuleUse` (`server/lib/moduleUsage.ts`) is reached
  from exactly one place, the `res.on("finish")` hook inside `requireModule`, and
  `requireModule("quests")` appears nowhere in the tree, because a core module mounts without it.
  So `module_usage` records no quests row on any village, and the counts that feed `membersReached`
  and the `activeMembers` denominator have the busiest surface in the product cut out of them.

A fork operator does not choose whether to run this. What they choose is what the board pays and
who may say so.

One consequence is worth knowing before reading the registry entry as a map of the module. The
`apiPrefixes` list is consumed in exactly one place, the vendor-lapse mount loop in
`server/index.ts`, which iterates `vendorModules()` only. Nothing above the `included` tier exists
today, so that loop is a no-op, and for a core module it would be a no-op regardless. The declared
prefixes `/api/quests` and `/api/game/quests` are documentation, and they are incomplete
documentation: this module also answers on `/api/crews`, `/api/og/quest`, `/api/admin/quests`,
`/api/admin/quest-claims` and `/api/game/quest-claims`. Nothing breaks because of that today.
Treat the Endpoints section below as the real list.

## Data model

Five tables. Four are written by this module's own routes; the fifth, `quest_proposals`, is written
only from a neighbouring path, and today from nothing at all. A full list of the tables **other**
modules own that a quest write touches sits at the end of this section.

**`quests`** (`drizzle/0001_init.sql`, extended by 0004, 0012, 0021, 0046, 0060, 0062, 0068, 0069,
0085, 0088). The reward is the interesting column. `gratitude` is a **varchar holding the label a
human wrote**, verbatim: `50-100`, `50 to 100`, `75`. It was an `int` on day one and 0004 changed
it, because the int coerced all fourteen seeded quests to 0 while a row-count verification passed.
`gratitude_min` and `gratitude_max` are integers **derived** from that label by
`parseRewardRange` in `shared/questRewards.ts`. Nothing **authors** them: every writer parses the
label instead of accepting a number beside it. But they are derived in four places, not one, and
a reader chasing a stale bound needs the list:

- `questParams` in `server/repos/quests.ts`, for every real quest. This is the one the admin form,
  the seeder and the quest-proposal accept path all reach through.
- `server/lib/examples.ts`, for the standing example quests, which are inserted directly.
- `scripts/import-json-to-mysql.ts`, twice: once on the INSERT and again in its own verification
  table.
- `scripts/seed-examples.mjs`, the standalone example seeder.

A new write path into this table has to parse the label itself or the bounds go stale against the
contract the board is advertising.

Also on `quests`: `status` (varchar, default `open`), `min_stage` and `requires_role` (the
**enforced** gates, added by 0012), `role_required` (display prose from 0001, enforced by
nothing), `stay_credit_reward` (0021, a second currency), `is_example` (0046),
`archetypes` and `archetypes_suggested` (0069, read by `server/lib/characters.ts` and neither read
nor written by `questsRepo`), `map_key` (0062, unique), `starts_at` / `ends_at` / `due_at` (0085,
which put a dated quest on the village calendar through the repo's own save path),
`structure_key` and `address_source` (0060, written only by `scripts/import-map-scene.ts` and read
by `server/routes/mapScene.ts`), and `created_at` (0088). That last one is worth a second look:
0088 adds the column with a `CURRENT_TIMESTAMP` default and then runs
`UPDATE quests SET created_at = NULL` on purpose, so every quest that predates it has no creation
date at all. `server/lib/calendarBrief.ts` filters on `created_at IS NOT NULL`, so the weekly brief
is permanently silent about an inherited board and speaks only about quests posted since.

**`quest_claims`** (0001, extended by 0055 and 0070). One row per member per quest attempt.
`status` is a MySQL enum with four values: `claimed`, `submitted`, `consented`, `declined`. 0070
records why they were not renamed to the build document's words: the enum is ordinal, it is live
in production data, and around forty hand-written string comparisons read it. `amount` is what the
witness granted. `consented_by` (0070) is who witnessed it, which is the column that makes the
no-self-consent rule checkable after the request is over. `confidence`, `confidence_note` and
`confidence_at` (0055) are the claimant's own account of how it is going, deliberately excluded
from the repo's generic `update()` SET list so no other write path can clobber them.

Two things this table does **not** have, both load-bearing. There is no unique index on
`(quest_id, user_id)`: 0001 declares a primary key on `id` and three non-unique keys, so the
one-non-declined-claim-per-member rule is a read-then-write in the claim route and nothing under
it. And there is no foreign key to `quests.id`. The delete route refuses only while a claim is
`claimed` or `submitted`, so a quest carrying `consented` and `declined` claims deletes cleanly
and those rows survive pointing at nothing: `GET /api/game/me` still returns them,
`client/src/pages/QuestDetail.tsx` links each to `/quests/:id`, where `GET /api/quests/:id` answers
`404 {"error":"No such quest"}`, and `consentedCount` still counts them, so a deleted quest keeps
advancing the stage ladder and keeps feeding the `quests_consented` badge metric.

**`quest_crews`** and **`quest_crew_members`** (0067). A crew is a named group walking one quest.
The roster lives here rather than on `conversation_members` because messaging ships off and quests
cannot, so a crew has to be whole on a village that has never opened a chat room. `invite_code` is
`NOT NULL` and unique, because MySQL exempts NULLs from unique indexes.

**`quest_proposals`** (0141) holds a machine's or an outsider's suggestion for a quest. Its accept
path calls `questsRepo.add`, the same function the admin form calls, so the reward parse and the
calendar write are inherited instead of reimplemented. The accept and reject writes are gated by
`quest.approve` and served from `server/routes/review.ts`, which no module declares; the queue
READ beside them asks a different key. See Capabilities and Endpoints below.

**Nothing in the running product writes `quest_proposals`.** `proposeQuest` in
`server/lib/questProposals.ts` holds the only INSERT into the table, and it has no caller anywhere
outside its own test file. (Control: the same search finds `acceptQuestProposal` called from
`server/routes/review.ts`, so the absence is real and not a bad search.) The public suggestion form
goes somewhere else entirely: `client/src/pages/ProposeQuest.tsx` calls
`submitProposal("quest-proposal", ...)` in `client/src/lib/proposals.ts`, which POSTs
`/api/forms/submit` into the generic submissions pipeline under `intake.moderate`, and those rows
are swept by `runRetentionSweep` once they age past `retention.submissions_days` in any status but
`new`. So the table, the batch cap, the dedupe key and the accept and reject routes are a landed
intake path with no ingress: a fork operator who grants `quest.approve` will find the quest half of
the queue permanently empty.

What this module writes that other modules own, on its own request paths: `village_calendar`
(`syncQuestCalendar` on every quest add and update), `season_pattern_members`
(`captureIntoCurrentPattern`, from `POST /api/admin/quests` only), `health_events` (every
`recordEvent` and `addActivity`), `notifications` (the submit sweep, the consent and decline bells,
the stay-credit bell), `token_ledger`, `token_balances` and `users.recognition_balance` (the consent
post), `stage_events` (`recordStageEvent`), `conversations` and `conversation_members` (crew
threads), and `rate_hits` (one row per share-card cache miss). That second list is what tells a fork
operator which other subsystems a quest write can fail against.

## Endpoints

The board, the crews, the admin CRUD and the two member steps are registered by `register` in
`server/routes/quests.ts`. **Registration order in that file is load-bearing**: `/api/quests/field`
is registered before `/api/quests/:id` so the literal path keeps winning over the parameter, and
`register()` is called from the exact point in `server/index.ts` the run used to occupy. Sorting
that file alphabetically would make `field` a quest id that does not exist.

| Route | Who | Notes |
| --- | --- | --- |
| `GET /api/quests` | anyone | The whole board, examples included. |
| `GET /api/quests/field` | anyone | Life signs: two aggregate queries, not three table loads. Example quests and example members are excluded on both sides. First names only. |
| `GET /api/quests/:id` | anyone | One quest plus three related from the same circle, filtered to the same example-ness and to `status = open`. |
| `GET /api/og/quest/:id` | anyone | The 1200x630 share card. No text is drawn into the raster because the renderer has no installed font. Cached on `id + imageUrl + circle`, 64 entries, oldest evicted first. The rate limit sits **after** the cache: 120 misses per IP per hour, then 429 with `Retry-After`. |
| `GET /api/quests/:id/crews` | signed-in member | The read is gated too: who is walking a quest with whom is not for crawlers. `inviteCode` is returned only to members of that crew. |
| `POST /api/quests/:id/crews` | signed-in member | Refuses an example quest. Crew size is clamped to 2..12, default 5. |
| `POST /api/crews/join/:code` | signed-in member | Refuses a disbanded crew and a full one. |
| `POST /api/crews/:id/leave` | signed-in member | Leaving the crew also leaves its conversation, where messaging is on. |
| `POST /api/admin/quests` | `isAdmin` | Off-site image URLs refused: a poster comes through the village's own upload. |
| `PUT /api/admin/quests/:id` | `isAdmin` | Refuses an example row, so an example cannot be edited into real work. |
| `DELETE /api/admin/quests/:id` | `isAdmin` | Refuses an example row, and refuses with 409 while any claim on it is `claimed` or `submitted`. |
| `POST /api/game/quests/:id/claim` | signed-in member | Enforces `min_stage` and `requires_role`, refuses an example, refuses a second non-declined claim. |
| `POST /api/game/quests/:id/submit` | signed-in member | Needs a link or a note. Accepts a second submit on an already-submitted claim. Notifies everyone who may consent. |
| `PUT /api/game/quest-claims/:id/confidence` | the claim's holder | Only while the claim is `claimed` or `submitted`. Only `at_risk` and `stuck` ring a bell. |
| `GET /api/admin/quest-claims` | `mayStillSee("quest.consent")` | A read, so it asks the see-path and never `mayAct`. There is no break-glass on a GET. |
| `POST /api/admin/quest-claims/:id/consent` | `mayAct("quest.consent")` | The whole of Mechanics below. |
| `GET /api/admin/quest-claims/attention` | `isAdmin` | The flagged-claims queue. Note the gate: this one is `isAdmin` and not the capability, unlike the two rows above it. |
| `GET /api/review/queue` | `guardCapability("intake.moderate")` | Served from `server/routes/review.ts`. Returns the full prose, rationale, quote and source ref of every `proposed` quest, through `questProposalQueue(pool, "proposed")`. A different key from the `quest.approve` on the accept and reject routes below. |

### Writes to this module's tables from outside

One route outside this module writes `quest_claims`:

- `POST /api/map/promise` (`server/index.ts`, behind `requireModule("map")`) is a second claim
  path. It reads the same stage and role gates instead of inventing its own, and it is the
  **only** route in the platform that can put an unstarted claim back.

These write `quests`, and none of them is `questsRepo.add` from the admin form:

- `POST /api/review/quests/:id/accept` and `/reject` (`server/routes/review.ts`) turn a proposal
  into a real quest under `quest.approve`. They write `quests` and `quest_proposals`. Neither one
  touches `quest_claims`, so an operator auditing what can create a claim will read this file and
  correctly find nothing.
- `POST /api/admin/seasons/roll` reaches `applyRoll` in `server/lib/seasonPatterns.ts`, which runs
  `UPDATE quests SET status = ?` in raw SQL, outside `questsRepo`. No calendar sync and no reward
  re-derive follow it. Its planner also refuses the **whole** roll when any governed quest carries
  a `claimed` or `submitted` claim, so one unconsented claim on one governed quest blocks a
  village's entire season turn.

And two more, on tables this module owns:

- `server/lib/erasure.ts` runs `UPDATE quest_claims SET user_name = ?` when a member is tombstoned.
- `scripts/import-json-to-mysql.ts`, the legacy JSON importer, inserts into both `quests` and
  `quest_claims`. Its claim rows carry a `status` (`consented` included) and an `amount`, with no
  ledger post, no `token_balances` recompute, no notification and no stage recompute. So an
  imported board arrives holding consented claims that `questCreditsFor` can find no ledger row
  for: `GET /api/game/me` shows `amount` with no `credited`, and the ledger's history is silent
  about every pre-migration payment.

## Surfaces

- `client/src/pages/Quests.tsx` is the board. It reads `rewardCeiling` from
  `shared/questRewards.ts` rather than splitting the label itself, which is the whole reason that
  module exists: two client call sites once split on an en dash specifically, so a quest written
  with a plain hyphen produced `NaN`.
- `client/src/pages/QuestDetail.tsx` is the quest's own page and where claiming and submitting
  happen, through `client/src/components/QuestActions.tsx`.
- `client/src/components/QuestCrews.tsx` is the crew panel, signed-in only.
- `client/src/pages/ProposeQuest.tsx` is the suggestion form. It is not an authoring surface: a
  quest is created by an admin, or by a holder of `quest.approve` accepting a proposal. Its
  submission lands in `submissions`, not in `quest_proposals`.
- `client/src/pages/Admin.tsx` holds both admin surfaces, `QuestsTab` (the CRUD) and
  `QuestClaimsTab` (the consent queue).
- `client/src/pages/Review.tsx` is the steward surface for `quest.approve`. It does not carry the
  consent queue.

**What `QuestsTab` cannot set.** The edit form renders title, description, reward, circle, status,
difficulty, duration, subtitle, first step, why it matters, what changes, steps, tips, deliverable
and poster path. It has no field for either **enforced** gate (`min_stage`, `requires_role`), none
for the second currency (`stay_credit_reward`), and none for the three calendar dates
(`starts_at`, `ends_at`, `due_at`). `questParams` persists all six, and
`PUT /api/admin/quests/:id` does `Object.assign(q, req.body, { id: q.id })`, so all six are
reachable by curl, by the seed file, and by `acceptQuestProposal`. Everything Mechanics and
Endpoints say those columns do is true and unreachable from the admin browser. `Review.tsx` is the
one surface that can set two of them, `gratitude` and `stayCreditReward`, and only on the accept of
a proposal that nothing currently creates.

## Mechanics

**The four states.** `claimed` on pickup, `submitted` when evidence arrives, then `consented` or
`declined`. A member may hold one non-declined claim per quest, so a declined claim can be picked
up again and a consented one cannot. A second submit on an open claim overwrites the evidence and
does not ring the stewards twice, because the notification's dedupe key is
`quest-submission:<claimId>:<recipientId>`.

**Who may consent.** `consentActor` in `server/index.ts` asks `mayAct(req, "quest.consent")`, so a
warning badge's deny beats a role grant, an admin outranks all of it while the village holds
nothing, and a village that has taken the power on refuses an admin who did not say they meant to
reach past it. The queue read asks `mayStillSee` instead, deliberately: opening a list is looking,
and `mayAct` would have written "acted on a power this village holds" to the public pulse for a
page view.

What the pulse **does** record is the act itself. Every successful consent calls
`addActivity("quest", "<first name> completed the quest \"<title>\"")`, and `addActivity` passes no
`audience`, which `server/lib/events.ts` defaults to `public`. The claimant's first name and the
quest title are village-readable news. The audit rows the same handler writes
(`quest:consented:`, `quest:declined:`, `quest:self-consent:solo-founder:`, `quest:deleted:`) all
pass `audience: "admin"` and are not.

**No self-consent, and it is enforced in exactly one place.** The `claim.userId === actor.userId`
branch in `POST /api/admin/quest-claims/:id/consent` is the whole of it. There is no backstop
underneath: `mintForConfirmedClaim` is handed `{ id, questId, userId, confirmedAt }` and is never
told who the confirmer is, so it cannot check; `postTransfer` on the recognition leg does not
check either. `canConfirm` in `server/lib/economy.ts` does exist and does enforce this rule, but on
two other paths, the event check-in and the intake-proposal reward, and neither one runs here.
`consented_by` (0070) is the only after-the-fact check. A fork operator who loosens that one branch
has nothing catching them.

One exception: `quest.self_consent_until_members` (default 6). While the count of living members is
below it, an **admin or founder** may consent to their own claim, and the route writes an audit
event saying so. Stewards never get the exception, because role authority is not founder authority.
Three kinds of row are excluded from the count: standing examples, tombstoned members (email ending
`@anonymized.invalid`), and any member row carrying no email at all, since the filter reads
`!u.isExample && u.email && !endsWith("@anonymized.invalid")`. Phantom identities would otherwise
shrink a six-member window to three, and an emailless row widens it the other way.

**The order of the consent checks**, because a fork operator changing any of them needs to know
what runs first:

1. The gate (`consentActor`).
2. The claim exists.
3. Example refusal, on the approve branch only. Declining an example claim stays legal, because a
   stranded claim has to be clearable and a decline creates nothing.
4. Self-consent, unless the solo-founder window is open.
5. The decline branch returns here.
6. `quest.require_submission_before_consent` (default on): the claim must be `submitted`.
7. `granted <= 0` is refused unless `quest.allow_zero_consent` is on.
8. If the cap mode is not `unlimited` and the label is unreadable, 409.
9. The cap comparison itself.
10. `issuanceRefusal`: the launch vote must have carried before any token issues. **Asked before
    the claim flips**, and this is the only faucet caller in the file that does so. Finding out
    afterwards would leave the claim `consented`, the credit refused, and no way to re-run it,
    because consenting again would 409 on a claim that is no longer submitted.
11. The claim flips, then the ledger post, then the rule mint, then the stay credits.

**Step 11 is four separate commits and not a transaction**, and the reasoning behind step 10 covers
exactly one of the ways the post can fail. `claimsRepo.update` commits on its own connection, and
only then does `postTransfer` run. If that post fails for any reason the launch-vote check did not
already catch, the route answers `500` with "The claim was marked consented but the credit could
not be posted", and the claim is permanently `consented`: the member is credited nothing,
`quest.require_submission_before_consent` refuses a re-consent on a claim that is no longer
`submitted`, no route reverts a consented claim (`claimsRepo.remove` deletes only `status =
'claimed'`), and nothing in the product can retry it. The idempotency key
`quest_consent:<claimId>` makes a hand-made repair post safe, and a hand-made repair post is the
only repair there is.

**Conflicting writes.** The handler reads the claim with `claimsRepo.byId`, a plain SELECT taking
no lock, runs all ten checks, and only then calls `claimsRepo.update`, which takes `FOR UPDATE`
inside itself. Two stewards consenting the same submitted claim therefore both pass the
`status !== "submitted"` check. The second `postTransfer` hits `ER_DUP_ENTRY` on
`quest_consent:<claimId>`, and `server/lib/ledger.ts` answers a duplicate with
`{ ok: true, duplicate: true, toBalance }`, so the loser's write succeeds silently: `amount` and
`consented_by` end up holding a figure and a witness the ledger never paid for. The one-claim rule
has the same shape one step earlier, a read-then-write with no database constraint behind it, so
two concurrent claims both land.

**The cap.** `quest.consent_cap_mode` reads the quest's advertised label through
`parseRewardRange` and compares it to the amount in the request body:

- `posted` (the shipped default) refuses `requested < range.min || requested > range.max`. Note
  the floor. This mode is not only a cap.
- `capped` computes `Math.round(range.max * quest.consent_cap_multiplier)` and refuses only
  `requested > ceiling`. There is no floor in this branch.
- `unlimited` compares nothing, and is the only mode exempt from the unreadable-label refusal.

Both sides of every one of those comparisons are whole tokens. `gratitude` is seeded with
`decimals` at the column default of 0 in `drizzle/0006_token_registry.sql`, and `registerToken` in
`server/lib/ledger.ts` deliberately omits `decimals` from its upsert's update list, so neither a
boot nor an admin write can re-denominate it. See Sharp edges for why that matters.

**What the ledger records.** A single `postTransfer` from `RECOGNITION_FAUCET` to the member's
account, `source = "quest_consent"`, `sourceRef` the claim id, `idempotencyKey`
`quest_consent:<claimId>`. The member's `recognitionBalance` column is **recomputed** from the
post's returned balance rather than incremented. At `granted === 0` there is nothing to post and
the cache write is skipped entirely; an earlier version assigned the failed post's `toBalance` of
0 and wiped the member.

**On top of the ledger post**, in order: a standing badge's reward multiplier (see Sharp edges),
`mintForConfirmedClaim` for any `quest.completed` rule on a token that is not recognition, and
`mintStayCredits` for `stay_credit_reward` under its own key `queststay:<claimId>`. The last two
are best-effort. A rule mint that throws is logged and the response is unaffected; a stay-credit
failure is logged and the recognition still stands. `drizzle/0021_stays_and_payments.sql` describes
the stay credit as released "in the same consent transaction", which is the intent and not the
implementation: these are separate posts made after the claim has already flipped.

**Progression.** `computeStage` in `server/index.ts` has a rule type `quests` that compares
`claimsRepo.consentedCount(userId)` against `progression.quests_for.<stage>`. Those keys belong to
the `progression` module. Consenting is therefore the act that moves somebody up the ladder, and
`stageBefore` is snapshotted before the claim flips, because taking it afterwards would always
compare equal and the advancement event would never fire.

**The cycle close reads this module and freezes what it finds.** `snapshotCycle` in
`server/lib/health.ts` counts `quest_claims` where `status = 'consented'` and `consented_at` falls
inside the lunation, and writes it as `quests_consented_cycle`. It is called from inside the
gratitude cycle close, in the block whose own comment says this is the only moment those
point-in-time facts are true. A village that suppresses or delays a close loses that number
permanently: nothing recomputes it afterwards.

## What arrives at boot

**A village with an empty `quests` table is seeded with fourteen real quests.** The block in
`server/index.ts` guards on `existing.length === 0 && fs.existsSync(QUESTS_SEED_FILE)` and loops
`questsRepo.add` over `server/seeds/quests-seed.json`. `QUEST_COLS` omits `is_example`, whose
column default is 0, so all fourteen are **real** rows: claimable, consentable and payable from the
faucet. They advertise 40 to 300 recognition apiece (`50-100`, `40-80`, `100-200`, `80-200`,
`100-300` and so on), one carries `minStage: "member"`, one carries
`requiresRole: "practitioners"`, and one ships `status: "Seasonal"`. Reviewing those fourteen reward
labels is the first thing a fork operator does before go-live, because on the day the village opens
they are the contract.

Two things the code comment beside that block gets wrong, and a reader should not inherit. It says
"INSERT IGNORE + the empty check", and `questsRepo.add` uses a plain `INSERT INTO`. It says "a
village that deleted quests on purpose never has them resurrected", and the guard is
table-emptiness: a village that deletes every quest gets all fourteen back on the next restart.

Three more boot paths write `quests`:

- **`suggestClassTags`** (`server/lib/economySeed.ts`) runs on **every** boot. It updates
  `archetypes` and `archetypes_suggested` for every real quest `WHERE archetypes IS NULL`, so a tag
  a human confirmed or cleared is never overwritten and a fresh village is never left with classes
  that appear to open nothing.
- **`backfillQuestStories`** fills subtitle, story, first step, deliverable, poster, steps and tips
  from the seed file into live rows, and only where the live value is empty. It is a `runOnce`
  one-shot, twice (`quest-story-2026-08-10`, `quest-posters-2026-08-10`). It **throws** when the
  seed file is missing, which deliberately leaves the id unrecorded so the next boot retries rather
  than recording a job that filled nothing.
- **The voice sweep** (`voice-sweep-2026-08-01-part-2`, also a `runOnce`) walks
  `questsRepo.all()`, matches rows against the seed file by id, and rewrites a string field only
  where `sameWords(have, want)` holds: same words, different punctuation. An edit that changed a
  word is left alone by construction. A fork that repunctuated seeded quest prose can have that
  repunctuation reverted; a fork that rewrote it cannot.

## Scheduled work

`registerJob("calendar-mirror", 60 * 60 * 1000, ...)` in `server/index.ts` runs
`mirrorCalendarSources` hourly. Its `runSource("quests", ...)` in `server/lib/calendarProviders.ts`
re-reads every quest carrying a `starts_at`, `ends_at` or `due_at`, rewrites its `village_calendar`
row through `calendarUpsert`, and retires whatever it did not see via `calendarRemoveMissing`.

Two facts about that job matter here. It is **not** wrapped in the `moduleOn` check the other
sources use, so quest calendar rows are mirrored whether or not the `events` module is on. And its
retirement pass is the **only** cleanup for a deleted quest: `questsRepo.remove` is a bare
`DELETE FROM quests WHERE id = ?` and never calls `calendarRemove`, unlike `add` and `update`,
which both call `syncQuestCalendar`. So deleting a dated quest leaves a live calendar row standing
for up to an hour.

## Game variables

Five keys carry the `quest.` prefix in `shared/gameVariables.ts`. All five are ring `open` (the
whole village may change them) and apply timing `instant`. `docs/VARIABLES.md` carries the full
generated tables; what follows is what each one **does** in the code.

| Key | Default | What the code does with it |
| --- | --- | --- |
| `quest.consent_cap_mode` | `posted` | Selects one of the three comparison branches above. |
| `quest.consent_cap_multiplier` | `2` | Read only inside the `capped` branch, as `Math.round(range.max * value)`. Inert under the other two modes. |
| `quest.require_submission_before_consent` | `true` | Blocks the approve branch when the claim is not `submitted`. Never blocks a decline. |
| `quest.allow_zero_consent` | `false` | Lets `granted === 0` past the amount floor. Read Sharp edges before turning it on. |
| `quest.self_consent_until_members` | `6` | The living-member count below which an admin may witness their own claim. `0` means never. |

The registry entry in `shared/modules.ts` declares only the first three under `variableKeys`, and
`docs/MODULES.md` reproduces that list because it is generated from it. The two omissions have no
runtime effect here, since both filters that consume `variableKeys` skip core modules, but a
reader taking the generated table as the module's full set of dials will miss the two that govern
self-consent and zero consent.

`GET /api/game/rules` publishes `quests.consentCapMode` to any anonymous caller as part of its
deliberate whitelist. Nothing under `client/src/` reads it today.

## Capabilities

One declared key, and one that is worth knowing about.

`quest.consent`, "Release value on someone else's quest". Declared in `shared/capabilities.ts`,
transferable, described in `server/lib/capabilityRegistry.ts` as covering
`/api/admin/quest-claims/:id/consent` and `/api/events/:id/checkin`. The events module reuses the
key: witnessing that somebody was there is the same act of witness.

A refusal has three shapes, and they differ on purpose:

- No signed-in user: `401 {"error":"Unauthorized"}`.
- A member who does not hold it: `403 {"error":"Consenting to finished work is for stewards"}`.
- An admin, on a key the **village** holds, who did not break the glass: `409` with the body
  `overrideRefusal` builds, carrying `capability`, `villageHolds`, `requiresOverride`, `holder`,
  `title` and `consequence` alongside the sentence. That body exists so a browser control can
  write its own sentence; the `error` string is the answer for curl. This route carried a
  hand-built twin of that body once, and the twin drifted the day the shared one grew the three
  facts a browser needs.

`quest.approve`, "Put a proposed quest on the board and set what it pays", is a real key enforced
by `guardCapability` on the two `/api/review/quests/:id/*` routes, and **no module declares it**.
The read and the write on a proposed quest are different keys: `GET /api/review/queue`, the only
route that lists them, asks `intake.moderate`. A holder of `intake.moderate` alone can read every
proposed quest and put none on the board; a holder of `quest.approve` alone can accept a proposal
they are not allowed to see.
`docs/CAPABILITIES.md` lists it among eleven such keys and states the rule: a key reaches the gate
from any route that asks for it, and the admin surfaces these cover sit outside every module. So
the absence is not a hole in the gate. It does mean that auditing "what powers does the quests
module add" from `shared/modules.ts` alone misses the power that decides what a quest pays before
anybody claims it.

## Dependencies

What this module reads that it does not own:

- **The ledger** (`server/lib/ledger.ts`, `server/lib/economy.ts`) for the recognition post, the
  faucet, and `questCreditsFor`.
- **`gameStart`** for `issuanceRefusal`. No consent above zero can pay before the launch vote
  carries.
- **`badges`** for `rewardMultiplierFor` in `server/lib/seasonPatterns.ts`, skipped entirely when
  the badges module is off.
- **`stays`** for `mintStayCredits`, when a quest carries `stay_credit_reward`.
- **`messaging`** for crew conversations. Every call is best-effort, because failing to open a
  chat must never fail the act of forming a crew, and a village that turns messaging off later
  keeps its crews and loses only the rooms.
- **`map`** for `POST /api/map/promise`, and for the `map.show_quests` dial.
- **`progression`** for the `progression.quests_for.<stage>` thresholds.
- **`examples`** (`server/lib/examples.ts`) for `isExampleRow`, `EXAMPLE_REFUSAL_BODY` and
  `onRealItemPublished`.
- **`seasonPatterns`** for `captureIntoCurrentPattern`, which files an admin-posted quest into the
  running season's pattern so it returns next year. `POST /api/admin/quests` calls it and
  `POST /api/review/quests/:id/accept` does not, so a quest accepted from review joins no pattern
  and does not retire the standing examples either (`onRealItemPublished` is on the admin path
  only). The accept is also two statements and not one transaction: `questsRepo.add`, then a
  separate `UPDATE quest_proposals SET status = 'accepted'`. A failure between them leaves the
  quest on the board with the proposal still `proposed`, and a second accept then creates a second
  quest.
- **The calendar** (`server/lib/calendar.ts`, `server/lib/calendarProviders.ts`) for
  `syncQuestCalendar`, which runs on the quest's own save path unconditionally, whatever the
  `events` module's lifecycle is doing. `questCalendarInput` treats a wider status vocabulary as
  closed than anything else in this module reads: `closed`, `archived`, `done`, `complete` and
  `completed` all cancel the mark, against the `Open` and `Closed` the admin form offers.

What reads quest data and does not own it: `server/lib/badges.ts` (consented counts and the
`quest_consent` ledger sum), `server/lib/health.ts` (consented claims per window),
`server/lib/intents.ts`, `server/lib/seasonRetrospective.ts` (per-quest claim, consent, in-flight
and flagged counts), `server/lib/characters.ts` (open non-example quests tagged with an
archetype), and `reciprocalConfirms` in `server/lib/economy.ts`, which surfaces pairs who witnessed
each other this moon and never blocks them.

`server/lib/erasure.ts` is a **writer**, not a reader, and what it leaves behind is worth stating.
It runs `UPDATE quest_claims SET user_name = ?` and touches nothing else: `user_id` and
`consented_by` are never rewritten, so a tombstoned member stays joined to their claims by id.
`consentedCount` still counts them, which is what `computeStage` and the `quests_consented` badge
metric read; `GET /api/admin/quest-claims` still returns them; `consented_by` keeps naming a
departed witness. The consent route's own living-member filter excludes `@anonymized.invalid`
emails from the solo-founder window, so this module already knows tombstones exist and treats them
two different ways.

## Sharp edges

**The cap governs the grant, not the payout.** This is the one to read first. After the cap
comparison passes, `payout = Math.floor(granted * multiplier)`, where `multiplier` comes from every
standing badge the member holds, compounding, clamped to `MAX_REWARD_MULTIPLIER = 3` in
`server/lib/seasonPatterns.ts`. So a village running the shipped `posted` mode, whose dial hint
reads "Safest. The board is the contract", can pay 300 for a quest advertising 100. The code says
why: the cap is a question about the work, and a multiplier is a standing the person carries into
every quest. The consequence is that `quest_claims.amount` is what the witness decided and **not**
what moved. `GET /api/game/me` resolves the gap by joining the ledger through `questCreditsFor`
and returning `credited` alongside `amount`, and the member's notification names the credited
figure. Anything else reading `quest_claims.amount` as a payout is reading the wrong column for
every badge holder. The copy on `client/src/pages/QuestDetail.tsx` says "What a quest advertises is
what it pays", which is true of the grant and not of the credit.

**The consent queue's amount box does not know what the quest advertises.** `QuestClaimsTab` in
`client/src/pages/Admin.tsx` renders `value={amounts[c.id] ?? 50}` and posts `amount: amounts[id] ?? 50`.
The claim row it draws carries the member's name, the quest title, the note and the artifact link,
and nothing at all from `quest.gratitude`. Under the shipped `posted` mode, pressing "Consent +
credit" on an untouched box consents at 50, which is refused for every quest whose advertised range
does not contain 50. The refusal is at least legible: the panel surfaces the server's own sentence
rather than "Action failed", and that sentence names the range. But a steward on a village whose
quests pay 100 to 200 meets a 409 on every first click, and the number they have to type is on a
different page.

**`capped` is more permissive at both ends, not one.** `posted` enforces a floor and a ceiling;
`capped` enforces only a ceiling. A village moving from `posted` to `capped` to allow a bonus for
exceptional work also, in the same edit, allows a consent of 1 on a quest advertising 200. The
label on the dial, "Up to a multiple of the posted amount", describes the ceiling it raises and
says nothing about the floor it drops.

**`quest.allow_zero_consent` does nothing under the shipped cap mode.** Turning it on lets
`granted === 0` past the amount floor at step 7, and then step 9 runs. Under `posted`, zero fails
`requested < range.min` for every quest advertising a nonzero amount, so the consent is refused
with a range error. The dial's description promises "a claim can be consented with an amount of 0,
meaning 'acknowledged, no recognition'", and that promise is kept only under `capped` or
`unlimited`, or on a quest whose label is literally `0`. A village wanting acknowledge-only
behaviour has to change two dials, and nothing tells them so.

**A steward who holds `quest.consent` has no browser.** The server has accepted a non-admin holder
on the consent routes since the 0103 capability round. (That number is a release label, not a
migration: there is no `drizzle/0103_*.sql`, the numbering runs 0102 then 0104, and every other
bare four-digit number in this document is a file you can open.) The only client surface is `QuestClaimsTab` inside
`client/src/pages/Admin.tsx`, and `AdminGate` in that same file refuses any signed-in account whose
role is not `admin` or `founder` with a "Not an admin" screen before any tab renders. The submit
sweep notifies every capability holder with `link: "/admin?tab=quest-claims"`, so a steward is rung
to a page that will refuse them. `client/src/pages/Review.tsx` states this dead end in its own
header and then solves it for `quest.approve` rather than for `quest.consent`. The capability is
exercisable today only with curl.

**The only way to put a claim back needs three things, and a village is unlikely to have any of
them.** `claimsRepo.remove` has exactly one caller, the `POST /api/map/promise` handler.
`POST /api/game/quests/:id/claim` has no un-claim counterpart. So releasing a quest needs the map
module on; **and** somebody to have hand-run `npx tsx scripts/import-map-scene.ts <scene.json>`,
the only writer of `quests.map_key` anywhere in the tree, against a scene whose quest titles match
the board verbatim (the importer matches on the key when there is one and bootstraps from the title
when there is not); **and** the quest still carrying the key that import stamped, because
`rowByMapKey` resolves on `map_key` and nothing derives it. Until all three hold, no village can
put a claim back at all: a member who picks up a quest and changes their mind cannot release it,
and a steward has to decline the claim, which writes a decline into the record for something that
was never a judgement. The repo method's own comment draws that distinction carefully, and one
surface honours it.

That route also answers **200 for every refusal**, with `{ ok: false, state, reason }` and a reason
drawn from `not-here | gone | closed | not-yet | error`, because the map is an iframe whose console
nobody can see. `missingReason` answers `not-here` for every key until some quest carries a map
key, which is the honest answer for a village that never imported a scene.

**A closed quest is still claimable, and nothing hides it.** The claim route checks the example
flag, `min_stage`, `requires_role` and the member's existing claims. It does not read
`quest.status`. Nor does anything upstream: `GET /api/quests` is `res.json(await questsRepo.all())`
with no filter, and the board's own filter in `client/src/pages/Quests.tsx` is
`circleMatch && diffMatch`, which never reads status. `statusIs` in
`client/src/lib/questBoard.ts` exists but does not filter the board; its three consumers draw a
"Seasonal" chip twice and filter `suggestNext` once. So a quest an admin marked Closed renders on
the board like any other card, with a working claim button, and walks through to consent normally.
No deep link is needed. Making Closed mean closed is a check in the claim route and in the
`map.promise` branch, not in the client.

**Two spellings of "open", and the capital is the one that ships.** `POST /api/admin/quests` seeds
`status: "Open"`, `acceptQuestProposal` writes `"Open"` too, and the Admin edit form offers `Open`
and `Closed`. The column default from 0001 is lowercase `open`, and the boot seeder spreads the
seed row **after** its own default (`questsRepo.add({ ..., status: "open", ...q })`), so the seed
file wins: `server/seeds/quests-seed.json` ships `"Open"` on thirteen of its fourteen quests and
`"Seasonal"` on the fourteenth. Only `server/seeds/examples-seed.json` ships lowercase, and those
are the example rows the SQL readers exclude with `is_example = 0` anyway.

JavaScript readers normalise (`statusIs`, and the related-quest filter in
`server/routes/quests.ts` lower-cases before comparing); the SQL readers compare against the
lowercase literal and rely on the column's collation being case-insensitive.
`drizzle/0001_init.sql` pins no charset on `quests`, so it inherits, and on a MySQL 8 default that
inheritance is `utf8mb4_0900_ai_ci` and the comparison holds. On a fork whose server default is a
`_bin` or `_cs` collation, `openPathsFor` in `server/lib/characters.ts`
(`WHERE status = 'open' AND is_example = 0`) counts zero for every seeded quest, every
admin-created quest and every proposal-accepted quest, which is to say all of them, while the board
looks full.

**The consent amount is a ledger amount, and nothing converts it.** `requested` comes straight off
the request body and reaches `postTransfer` as `amount` without passing through `toLedgerUnits`.
That is correct only because `gratitude` carries 0 decimals, where a whole token and a ledger unit
are the same number. `server/lib/economy.ts` records the same class of defect being fixed in the
two hand-mint dials, which were compared straight against a ledger amount and were enforcing 10
Voice per lunar cycle while their description said something else. This route is safe by the same
accident, protected by `registerToken` refusing to re-denominate an existing token. A fork that
ever pays quests in a token with decimals will find this line is where the board's number and the
ledger's number stop being the same quantity.

**Deleting a quest is refused two ways, and one of them is not obvious.** (The handler has four
exits that are not a delete: `401 auth_required` when the caller is not an admin, the two refusals
below, and `404 Not found`. The two below are the ones that refuse a legitimate admin.) An example
row is refused outright, because deleting examples one at a time empties the board without stamping a
tombstone: `refreshRowPresence` runs at boot, on a seed and on a retirement, so the explanatory
banner would sit over nothing until the next restart. "Clear examples" in Admin is the supported
path. A quest with any `claimed` or `submitted` claim is refused with a count and a settle-first
sentence, because badges and health both still join against the quest row and deleting it strands
the work. Everything else deletes and writes an audit event, including a quest whose only claims
are `consented` or `declined`: those rows survive with nothing to point at. See the `quest_claims`
entry in Data model for what that costs.

**The cap enforces the label as it reads at consent, not as it read at claim.** The consent handler
loads the quest fresh (`questsRepo.byId(claim.questId)`) and parses `gratitude` there, and
`PUT /api/admin/quests/:id` has no settle-first guard: only `DELETE` counts in-flight claims. So an
admin may rewrite the reward on a quest with submitted claims sitting in the queue, and the cap then
enforces the new label against work done under the old one. A quest advertising 100 to 200 can be
edited to 10 to 20 while somebody's submission waits, and under the shipped `posted` mode the
consent refuses every honest amount. Either the edit route grows the same in-flight check `DELETE`
has, for a `gratitude` change, or a village has to know not to reprice work it has not settled.

**The share card's rate limit sits after its cache, on purpose.** A crawler walking a hundred-quest
board pays the `sharp` raster once per quest and is never counted against the 120-per-hour bound.
What the bound catches is a caller cycling ids to make the village raster on demand. Adding a query
parameter to the cache key hands that caller a free miss generator.

The bound also costs a `rate_hits` row per miss and **fails open**: `overLimit` catches its own
database error, logs "[abuse-guard] check failed (failing open)" and returns false. So a database
problem removes the only protection on the one route in this module that rasters an image for an
anonymous caller.

**The submit sweep runs inside the response path, unguarded.** In
`POST /api/game/quests/:id/submit` the claim is flipped and committed first, then the loop over
`questConsentRecipients()` awaits `notify` for each one with no try/catch, and only then does
`res.json(updated)` run. A notification failure therefore answers 500 to a member whose work is
already `submitted`, and the sweep stops at the failing recipient, so the stewards after them are
never rung. Every other best-effort call in this module is wrapped: the crew thread calls, the rule
mint, the stay credit. This one is not.

**Crews touch no value, and that is structural rather than conventional.** Every member of a crew
claims, submits and is consented to individually. There is no pooled claim, no shared reward, and
no crew-level row in `quest_claims`. Adding one would put a value path around the human gate this
whole module is built on.
