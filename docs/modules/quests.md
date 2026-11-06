# Module design: Quests — module id `quests`

Provenance: platform

<!-- describes: server/routes/quests.ts server/routes/questClaims.ts server/lib/workPay.ts shared/workValue.ts server/repos/quests.ts server/index.ts shared/modules.ts shared/gameVariables.ts shared/questRewards.ts client/src/pages/Admin.tsx client/src/pages/QuestDetail.tsx client/src/components/QuestActions.tsx server/lib/capabilityRegistry.ts server/lib/crews.ts server/lib/questProposals.ts server/lib/calendarProviders.ts server/repos/questOwedPostings.ts client/src/components/review/OwedPostings.tsx -->

> The contribution board. A quest is posted by an admin or by a `quest.approve` holder, claimed by
> a member, submitted with evidence, and consented to by somebody who is not the claimant. Consent
> is the one step that releases value. The board and the two member steps live in
> `server/routes/quests.ts`; the consent route and the queue live in `server/routes/questClaims.ts`,
> and the consent gate they ask, `consentActor`, stays in `server/index.ts`. The tables have three
> homes: `server/repos/quests.ts` holds `quests` and
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
from a neighbouring path, the public Propose a Quest form. A full list of the tables **other**
modules own that a quest write touches sits at the end of this section.

**`quests`** (`drizzle/0001_init.sql`, extended by 0004, 0012, 0021, 0046, 0060, 0062, 0068, 0069,
0085, 0088, 0265). The reward is the interesting column, and since 0265 it is three columns:
`value_minor` and `value_currency`, what the quest is worth in the village's own currency, and
`value_tokens`, the JSON list of token amounts it pays at consent (NULL is no list of its own, so
the village's standard rules pay it). What a consent pays from them is under What a consent pays
below. `gratitude` is the older reward, read by nothing that pays since 2026-10-21, when quests
stopped paying Gratitude. It is a **varchar holding the label a human wrote**, verbatim: `50-100`, `50 to 100`, `75`. It was an `int` on day one and 0004 changed
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
in production data, and around forty hand-written string comparisons read it. `amount` is the Gratitude the
witness granted, and NULL on every consent since 2026-10-21, when a consent stopped granting any. `consented_by` (0070) is who witnessed it, which is the column that makes the
no-self-consent rule checkable after the request is over. `confidence`, `confidence_note` and
`confidence_at` (0055) are the claimant's own account of how it is going, deliberately excluded
from the repo's generic `update()` SET list so no other write path can clobber them.

Two things this table does **not** have, and both absences are now deliberate and written down in
`drizzle/0196_one_live_claim_per_member.sql`.

**There is no unique index on `(quest_id, user_id)`, and there cannot be one.** The rule the routes
actually enforce is `status <> 'declined'`, and they mean it: a declined claim is the quest handed
back, the decline notification says the quest is open again, and the member is expected to pick it
up. So a member declined once legitimately holds two rows for that pair and a member declined
twice holds three, which makes `(quest_id, user_id, status)` wrong as well. The natural key is "at
most one row that is not declined per pair", a partial uniqueness MySQL has no index shape for.
Beyond correctness, a unique key that collides with rows already present would not fail a deploy,
it would stop a village booting, and a new UNIQUE index on an existing table is on the
expand/contract never-list that `scripts/check-migration-compat.mjs` enforces. The invariant lives
in `claimsRepo.openClaim` instead, which locks the quest row `FOR UPDATE` and does the existence
test and the insert underneath it, the same shape `writeGratitudeRowOnce` uses for the gratitude
allowance. 0196 adds the non-unique `(quest_id, user_id, status)` index that lookup wants.

**There is no foreign key to `quests.id`, and adding one would be worse than the gap.** The delete
route refuses only while a claim is `claimed` or `submitted`, so a quest carrying `consented` and
`declined` claims deletes cleanly and those rows survive: `GET /api/game/me` still returns them,
`client/src/pages/QuestDetail.tsx` links each to `/quests/:id`, and `GET /api/quests/:id` answers
`404 {"error":"No such quest"}`. What survives with them is correct, though. `consentedCount`, the
stage ladder and the `quests_consented` badge metric all keep counting a consented claim after its
quest is gone, which is the right answer: the work was witnessed and paid, and tidying a finished
quest off the board must not take a member's stage with it. A `CASCADE` would delete exactly those
rows and orphan the ledger posting keyed to them; a `RESTRICT` would contradict the delete route's
own settle-first design. What is genuinely left broken is the dead link, and the divergence between
the counters that join `quests` (`fieldCounts`, `recentConsented`, which drop the row) and the ones
that do not (`consentedCount`, the badge metric, which keep it).

The settle-first count itself runs inside `questsRepo.remove`, under the quest's row lock, which is
the lock `openClaim` takes. It used to run in the route, through a plain read several awaits before
the delete, and a claim taken in between was left pointing at a quest that no longer existed. Now a
claim that lands first is counted and refuses the delete, and one that arrives after finds the quest
gone.

**`quest_crews`** and **`quest_crew_members`** (0067). A crew is a named group walking one quest.
The roster lives here rather than on `conversation_members` because messaging ships off and quests
cannot, so a crew has to be whole on a village that has never opened a chat room. `invite_code` is
`NOT NULL` and unique, because MySQL exempts NULLs from unique indexes.

**`quest_proposals`** (0141) holds a machine's or an outsider's suggestion for a quest. Its accept
path calls `questsRepo.add`, the same function the admin form calls, so the reward parse and the
calendar write are inherited instead of reimplemented. The accept and reject writes are gated by
`quest.approve` and served from `server/routes/review.ts`, which no module declares; the queue
READ beside them asks a different key. See Capabilities and Endpoints below.

**The public Propose a Quest form writes `quest_proposals`** (Rye, 2026-09-14: people should be
able to propose quests). `client/src/pages/ProposeQuest.tsx`, and the guided chat beside it, call
`sendProposal("quest-proposal", ...)` in `client/src/lib/proposals.ts`, which POSTs
`/api/forms/submit`. That handler in `server/index.ts` stores the submission in the generic
submissions pipeline under `intake.moderate`, as it always did, and then `landPublicSubmission` in
`server/lib/publicForms.ts` derives a proposal from it through `proposeQuest`:

- The idea is copied. The title falls back to the first line of what the person wants to do, the
  description is what they want to do, and what they bring, need, ask for in return and by when
  becomes the rationale, one labelled line each. Each is cut to the width the table keeps before
  anything reads it, because a form body may carry a megabyte. `/review` shows the rationale
  beneath the description and names the form as the idea's source (`PROPOSE_QUEST_MODULE` in
  `shared/questIdeas.ts`).
- Who they are is not. Name and email stay in `submissions`, which the admin inbox, the member
  export and erasure already handle, and which `runRetentionSweep` sweeps once they age past
  `retention.submissions_days` in any status but `new`. The proposal points back through
  `source_ref` (`submission:<id>`), and a signed-in member's id goes in `proposed_by`. The member
  export lists those rows as `questIdeas`, and the erasure sweep clears `proposed_by` (the
  `quest-proposals` step, through `forgetProposer` in `server/repos/questProposals.ts`). Nothing
  else on the row is made from the member: the batch id names the submission.
- An idea is held back when it carries an email address, has nothing to title it by, or would pass
  an allowance: three open ideas per member (`OPEN_IDEAS_PER_MEMBER`, counted on `proposed_by`),
  and ten from visitors taken together (`OPEN_VISITOR_IDEAS`), because a visitor has no identity to
  count against. The count and the insert run under one named lock (`withIdeaLock`), so ideas sent
  together cannot pass an allowance. Each idea held back is counted in `external_proposal_drops`
  under `propose-quest` (`contained_an_email`, `empty_payload`, `over_allowance`), which `/review`
  reads out beside the queue, saying that each one is kept in the admin inbox. A database error
  keeps an idea out too. In every case the submission stands and the steward inbox still receives
  it, and the form's answer says where the idea went: `idea` is `{ queued: true }`, or
  `{ queued: false, held, member, allowance }` naming the hold-back (`IdeaReceipt` in
  `shared/questIdeas.ts`, built by `server/lib/questIdeaReceipt.ts`). The page tells its sender
  the idea was held and why, where it used to say "Your Quest idea is in." for every one.

Vendor intake still writes nothing here: external `quest.proposed` records land in
`external_proposals`, and the form is `proposeQuest`'s only caller. `quest_proposals` has no
retention sweep of its own, so a decided proposal stays after the submission it came from ages
out.

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
| `GET /api/og/quest/:id` | anyone | The 1200x630 share card. No text is drawn into the raster because the renderer has no installed font. Cached on `id + imageUrl + circle`, 64 entries, oldest evicted first. The rate limit sits **after** the cache: 120 misses per IP per hour, then 429 with `Retry-After`. When the guard cannot reach its table at all, this route answers **503** and rasters nothing, alone in the platform (Rye, 2026-09-23). |
| `GET /api/quests/:id/crews` | signed-in member | The read is gated too: who is walking a quest with whom is not for crawlers. `inviteCode` is returned only to members of that crew. |
| `POST /api/quests/:id/crews` | signed-in member | Refuses an example quest. Crew size is clamped to 2..12, default 5. |
| `POST /api/crews/join/:code` | signed-in member | Refuses a disbanded crew and a full one. |
| `POST /api/crews/:id/leave` | signed-in member | Leaving the crew also leaves its conversation, where messaging is on. |
| `POST /api/admin/quests` | `isAdmin` | Off-site image URLs refused: a poster comes through the village's own upload. |
| `PUT /api/admin/quests/:id` | `isAdmin` | Refuses an example row, so an example cannot be edited into real work. |
| `DELETE /api/admin/quests/:id` | `isAdmin` | Refuses an example row, and refuses with 409 while any claim on it is `claimed` or `submitted`, counted under the quest's row lock. |
| `POST /api/game/quests/:id/claim` | signed-in member | Enforces `min_stage` and `requires_role`, refuses an example, refuses a closed quest, refuses a second non-declined claim (under the quest's row lock, via `claimsRepo.openClaim`). |
| `POST /api/game/quests/:id/submit` | signed-in member | Needs a link or a note. Accepts a second submit on an already-submitted claim, and refuses with 409 a claim a steward resolved first (`claimsRepo.submitOnce`, under the claim's row lock). Notifies everyone who may consent, and nobody on a refusal. |
| `PUT /api/game/quest-claims/:id/confidence` | the claim's holder | Only while the claim is `claimed` or `submitted`. Only `at_risk` and `stuck` ring a bell. |
| `GET /api/admin/quest-claims` | `mayStillSee("quest.consent")` | A read, so it asks the see-path and never `mayAct`. There is no break-glass on a GET. Each claim carries `pay`, what saying yes will release: the quest's value and the token lines `questPay` (`server/lib/workPay.ts`) states from the rules in force, the same answer the quest's card gives, or `null` when the claim's quest is gone. |
| `POST /api/admin/quest-claims/:id/consent` | `mayAct("quest.consent")` | The whole of Mechanics below. |
| `GET /api/admin/quest-claims/owed` | `mayStillSee("quest.consent")` | What consents recorded as owed and have not paid: rows still owed, with the ledger's last reason, and rows refused for good. A read, so it asks the see-path. `/review` renders it as `OwedPostings`. |
| `POST /api/admin/quest-claims/:id/owed/pay` | `mayAct("quest.consent")` | Pays what one consent still owes, each row in its own transaction that marks it posted in the same commit. It decides nothing, because the amounts and keys were fixed when the consent recorded them, and a second press finds nothing owed. A steward's press writes an admin audit row naming the tokens paid. |
| `GET /api/admin/quest-claims/attention` | `isAdmin` | The flagged-claims queue. Note the gate: this one is `isAdmin` and not the capability, unlike the two rows above it. |
| `GET /api/review/queue` | `mayStillSee("intake.moderate")` or `mayStillSee("quest.approve")` | Served from `server/routes/review.ts`. Returns the full prose, rationale, quote and source ref of every `proposed` quest, through `questProposalQueue(pool, "proposed")`. `intake.moderate` reads both halves of the queue. `quest.approve` alone reads this quest half, and the proposal half and the dropped-batch summary are never queried for it. `scope` in the response names the halves that were read, so a page can tell an empty half from a hidden one. Neither key: `401 {"error":"auth_required"}`, as before. |

### Writes to this module's tables from outside

One route outside this module writes `quest_claims`:

- `POST /api/map/promise` (`server/index.ts`, behind `requireModule("map")`) is a second claim
  path. It reads the same stage and role gates instead of inventing its own, and it is the
  **only** route in the platform that can put an unstarted claim back.

These write `quests`, and none of them is `questsRepo.add` from the admin form:

- `POST /api/review/quests/:id/accept` and `/reject` (`server/routes/review.ts`) turn a proposal
  into a real quest under `quest.approve`. They write `quests` and `quest_proposals`, and each tells
  a signed-in proposer the outcome through the notify spine: `quest_idea_on_board` links to the new
  quest, and `quest_idea_declined` carries the reason the steward typed, its only free text. A
  visitor's or a machine's proposal tells nobody. Neither one touches `quest_claims`, so an operator auditing what can create a claim will read this file and
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
  submission lands in `submissions`, and a proposal derived from it lands in `quest_proposals`
  for review (see Data model).
- `client/src/components/admin/QuestsTab.tsx` is the CRUD, moved out of `client/src/pages/Admin.tsx`
  on 2026-10-21, and Admin keeps `QuestClaimsTab`, which since 2026-09-14 is only a door to `/review`.
  Both quest forms set what a quest is worth and pays through `client/src/components/WorkValueEditor.tsx`,
  which offers the tokens `GET /api/quests/pay-options` names; a new quest is refused without a value.
- `client/src/components/WorkPayBlock.tsx` is what every quest and role card says a piece of work pays,
  from the `pay` the server attaches: the value in the village's currency with a conversion beside it,
  every token by its live name, a role's cash per its agreement, or "Inquire for payment details".
- `client/src/pages/Review.tsx` is the steward surface, one section per key. `intake.moderate` or
  `quest.approve` reads the proposed quests, and the queue's `scope` names the halves it answered.
  `quest.consent` reads the consent queue, rendered by `client/src/components/review/ConsentQueue.tsx`:
  each claim shows the `pay` saying yes will release, and a consent is a yes with no amount to type.
  Both bells, the submit sweep's and the confidence flag's, link to `/review`.

**What `QuestsTab` cannot set.** The edit form renders title, description, value and token amounts, circle, status,
difficulty, duration, subtitle, first step, why it matters, what changes, steps, tips, deliverable
and poster path. It has no field for either **enforced** gate (`min_stage`, `requires_role`), none
for the second currency (`stay_credit_reward`), and none for the three calendar dates
(`starts_at`, `ends_at`, `due_at`). `questParams` persists all six, and
`PUT /api/admin/quests/:id` does `Object.assign(q, req.body, { id: q.id })`, so all six are
reachable by curl, by the seed file, and by `acceptQuestProposal`. Everything Mechanics and
Endpoints say those columns do is true and unreachable from the admin browser. `Review.tsx` is the
one surface that can set one of them, `stayCreditReward`, with the value and token amounts, and only on the accept of
a proposal, which today means an idea from the public form. Each proposal is a `QuestProposalCard`
(`client/src/components/review/QuestProposalCard.tsx`), where the steward types the reward and may
change the title and description first, because a person's idea goes onto a public board and only
an email address is screened on the way.

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
underneath: `owedForClaim` is handed `{ id, questId, userId, stay, valueTokens }` and is never
told who the confirmer is, so it cannot check; `postTransfer` on the recognition leg does not
check either. `canConfirm` in `server/lib/economy.ts` does exist and does enforce this rule, but on
two other paths, the event check-in and the intake-proposal reward, and neither one runs here.
`consented_by` (0070) is the only after-the-fact check. A fork operator who loosens that one branch
has nothing catching them.

One exception: `quest.self_consent_until_members` (default 6). While the count of living members is
below it, an **admin or founder** may consent to their own claim, and the route writes an audit
event saying so. That row is written after the consent commits, so a founder who declines their own
claim, or whose amount the dials refuse, leaves none: the row records uses of the window and not
attempts at it. Stewards never get the exception, because role authority is not founder authority.
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
5. The decline branch returns here, through `claimsRepo.declineOnce`: from `claimed` or
   `submitted` only, under the claim's row lock, and a resolved claim is refused with 409.
   A claim that is already `declined` is the exception: the row and the request agree, so the
   route answers the row with 200 and writes nothing, which is what a second press and a
   retried request both want. Every other resolution, `consented` above all, is still 409.
6. `issuanceRefusal`, asked only when the consent would pay something (a token line on the quest's
   card, or stay credits): the launch vote must have carried before any token issues. A refusal
   leaves the claim at `submitted`, where a consent after launch finds it and pays it in full. A
   quest that pays nothing can be witnessed before launch, because refusing that would withhold an
   acknowledgement that costs no tokens.
7. `claimsRepo.consentOnce`: one transaction that locks the claim row, re-checks the status,
   flips the row, and records what the consent owes (`owedForClaim` into `quest_owed_postings`) on
   the same connection.
8. After it commits: paying what the consent owes (`settleOwedForClaim`), the stay credits'
   notification, the activity line, the notification naming what posted, and the stage event.

**Step 7 is one commit**, and `quest.require_submission_before_consent` is enforced inside it
rather than as a separate read: the variable decides which statuses `consentOnce` accepts
(`submitted` alone when it is on, `claimed` or `submitted` when it is off), and the status is
re-read under the claim's own row lock. Both of the gaps this used to have are closed by the same
change.

**What a consent owes beyond recognition is recorded in that commit, and paid after it.** The rule
tokens and a quest's stay credits used to post after the commit, best effort, and a failure was
lost: nothing retried it, and a resolved claim refuses a second consent. `owedForClaim` now prices
them on the consent's own connection, and `recordOwed` writes them to `quest_owed_postings` (0210)
before the commit. `settleOwedForClaim` pays each row straight after, in a transaction that locks
the row, posts it through `postOwedOn` and marks it posted in the same commit. A row that does not
go through stays owed with the ledger's reason (`not_launched`), or is marked refused when no retry
can change it (`key_clash`, `rule`). `/review` lists both through `GET /api/admin/quest-claims/owed`,
with a press for the owed ones. Nothing pays twice, which was Rye's one condition for this repair
path (2026-09-14): the row's key is the ledger's occurrence key, a second press finds the row
posted, and a posting that already landed answers duplicate and moves nothing.
`server/routes/questOwedPostings.test.ts` drives each of those against the real ledger, two
simultaneous presses included.

The first gap was that `claimsRepo.update` committed on its own connection and only then did
`postTransfer` run. A post that failed for any reason the launch-vote check did not already catch
answered `500` over a claim permanently marked `consented`, with the member credited nothing and
nothing in the product able to retry it: `quest.require_submission_before_consent` refuses a
re-consent on a claim that is no longer `submitted`, and `claimsRepo.remove` deletes only
`status = 'claimed'`. A refused post now rolls the flip back with it and answers `409` saying
nothing was recorded, so consenting again is a real retry.

The second gap was concurrent stewards. The handler read the claim with `claimsRepo.byId`, a plain
SELECT taking no lock, ran every check, and only then called `claimsRepo.update`, which took
`FOR UPDATE` inside itself. Two stewards consenting the same submitted claim both passed the
status check; the second `postTransfer` hit `ER_DUP_ENTRY` on `quest_consent:<claimId>`, and
`server/lib/ledger.ts` answers a duplicate with `{ ok: true, duplicate: true, toBalance }`, so the
loser's write succeeded silently and `amount` and `consented_by` ended up holding a figure and a
witness the ledger never paid for. `consentOnce` re-reads the status under the lock and refuses the
loser with the status it actually found, which the route turns into a `409`. Both races are driven
concurrently against a real MySQL in `server/repos/questClaimConcurrency.test.ts`; that file's
header records what the pre-fix algorithm produced under the same driver (five duplicate claim rows
from five taps, and a row saying 90 by one steward over a ledger that moved 60 for another).

**The two doors beside consent take the same compare-and-set.** The decline branch and
`POST /api/game/quests/:id/submit` used to write through a generic `claimsRepo.update` that locked
the row and then wrote over whatever it found. So a steward whose queue page predated a colleague's
consent could decline work already witnessed and paid: the posting stood, the member's consented
count fell, and because a declined claim frees the quest, the member could claim it again and be
consented under a second `quest_consent:<claimId>` key. And a member correcting their evidence while
a steward consented wrote `submitted` back over the consented claim, returning it to the queue for a
second consent to record a new figure and witness over a posting the ledger would answer
`duplicate: true`. `declineOnce` and `submitOnce` now move a claim only from `claimed` or
`submitted`, re-read under the row lock, and the routes answer `409` with the status they found.
`ClaimsRepo` has no generic `update` any more, so a new door has to name the statuses it may start
from. Both doors, and the quest delete, are driven through their real handlers with the other actor
committed inside the gap in `server/routes/questClaimTransitions.test.ts`.

Note what a warmed connection pool has to do with any of this: mysql2 opens connections lazily, so
an unwarmed fan-out is serialised by the driver and every one of these races is invisible. The same
five taps left one row unwarmed and five rows warmed, on identical code.

**What a consent pays (0265, Rye 2026-10-21).** A consent is a yes. The witness confirms the work
was done, and the quest pays what it says: no amount is typed, and an `amount` in the request body
is read by nothing. Gratitude is never paid for a quest, because its only job is sharing out the
cycle pool. Every figure comes from `quoteWorkPay` in `server/lib/economy.ts`, the same function the
quest's card renders from (`questPay` in `server/lib/workPay.ts`), so the board can never promise a
token amount the consent would not post:

- **A quest with its own list** (`quests.value_tokens`, human amounts) is paid that list. Each line
  pays the quest's own figure, clamped to the ceiling of the village's enabled `quest.completed`
  rule on that token, whatever amount the rule itself carries. A token the list does not name pays
  nothing, so a valued quest is never also paid the flat amounts. A token with no enabled rule
  behind it cannot pay, because nothing caps it; the admin save refuses it before it is stored, and
  the pricing reports it if it is ever reached. An empty list pays no tokens.
- **A quest with no list** is paid every enabled rule's fixed amount, exactly as before 0265. A rule
  that reads its amount from the work (`amount` NULL) pays the quests that name an amount for its
  token, and is quiet on one that names none.
- **The quest's stay credits** (`stay_credit_reward`) are its own payment and release on every
  consent, keyed `queststay:<claimId>`.

The value itself (`quests.value_minor` and `value_currency`) is what the work is worth in the
village's currency. It is shown on the card and converted for display there, and it is not paid by
the platform: the token amounts are how the platform pays it. `POST /api/admin/quests` refuses a
new quest without a value, and both quest saves stamp the village's currency on the server rather
than reading one from the body.

The three dials that bounded a Gratitude grant (`quest.consent_cap_mode`,
`quest.consent_cap_multiplier`, `quest.allow_zero_consent`) left the registry with the grant, and so
did the module that held their arithmetic. A village's stored row for one is harmless and read by nothing.
A standing badge's reward multiplier lifted that grant and now has nothing to lift;
`rewardMultiplierFor` in `server/lib/seasonPatterns.ts` stays, read by nothing, until the founder
says whether a badge should lift a quest's token pay instead.

**What the ledger records.** No posting from `RECOGNITION_FAUCET`, and `quest_claims.amount` is
written NULL: a consent grants no recognition, and the column keeps what older consents granted.
`owedForClaim` prices the list or the rules and the stay on the consent's own connection,
`recordOwed` writes them into `quest_owed_postings` (0210) in the consent's commit, and
`settleOwedForClaim` posts each one after it, under its occurrence key. The member's notification
names what actually posted, read off the settled rows: "Your quest was consented: <title> (+40
Village Credits)".

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

**A fresh village opens on starter quests that are standing examples** (Rye, sheet A8 / 19g,
2026-10-31: "a new village starts with a neutral, fully editable starter set"). They come from the
`quests` section of `server/seeds/examples-seed.json`, which is the ONE source of truth for what a
new village starts with, and `seedExamplesAtBoot` writes them because quests is a core module. They
are inert like every example: nobody can claim one, and the admin save and delete refuse them. They
carry the whole story layer and no value, because a quest's value is set on its card by the village.
One carries `minStage: "member"` and one `requiresRole: "practitioners"`, so the board's rings are
there to read.

They seed only where the village has no quest and **no claim** of its own (`villageHasOwnQuests`,
`server/repos/questExamples.ts`), so a village that worked its board and then emptied it is never
talked over. A founder decides each starter in Admin, Quests:

- **Keep** (`POST /api/admin/quests/:id/keep`, `keepExampleQuest` in `server/repos/quests.ts`)
  turns that one row real, with the founder's edits and a required value, in one write under the
  row lock. The other starters stay. Keeping the last one stamps the tombstone (`all_kept`).
- **Clear** (`POST /api/admin/modules/quests/examples/clear`) retires the rest.
- **Posting a quest of the village's own**, or accepting a quest proposal, retires them all.

The Journey to Launch row `starter-quests` reads the count of example quests still on the board and
is done at zero. A village seeded before 2026-10-31 holds none, so it reads as done.

**`server/seeds/quests-seed.json` is FROZEN and seeds nothing.** Until 2026-10-31 the boot looped
`questsRepo.add` over it onto any empty table, writing fourteen live, claimable, payable quests
that nobody reviewed (and writing them back after a village deleted them all). Villages seeded that
way are running today, and the two passes below still match their rows to it by id, so its words
never change: `server/lib/legacyQuestSeed.test.ts` pins its hash.

Three more boot paths write `quests`:

- **`suggestClassTags`** (`server/lib/economySeed.ts`) runs on **every** boot. It updates
  `archetypes` and `archetypes_suggested` for every real quest `WHERE archetypes IS NULL`, so a tag
  a human confirmed or cleared is never overwritten and a fresh village is never left with classes
  that appear to open nothing.
- **`backfillQuestStories`** (`server/lib/legacyQuestSeed.ts`) fills subtitle, story, first step,
  deliverable, poster, steps and tips from the frozen seed file into live rows, and only where the live value is empty. It is a `runOnce`
  one-shot, twice (`quest-story-2026-08-10`, `quest-posters-2026-08-10`). It **throws** when the
  seed file is missing, which deliberately leaves the id unrecorded so the next boot retries rather
  than recording a job that filled nothing.
- **The voice sweep** (`voice-sweep-2026-08-01`, also a `runOnce`; the quest half is
  `repairSeededQuestCopy`) walks `questsRepo.all()`, matches rows against the frozen seed file by id, and rewrites a string field only
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
| `quest.require_submission_before_consent` | `true` | Blocks the approve branch when the claim is not `submitted`. Never blocks a decline. |
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
- An admin, on a key the **village** holds, whom the gate refused: `409` with the body
  `overrideRefusal` builds, carrying `capability`, `villageHolds`, `requiresOverride`,
  `overrideAvailable`, `holder`, `title` and `consequence` alongside the sentence.
  `overrideAvailable` is true only for a founder seated as a steward with the veto (Rye,
  2026-09-21), and only that founder's glass is accepted. That body exists so a browser control can
  write its own sentence; the `error` string is the answer for curl. This route carried a
  hand-built twin of that body once, and the twin drifted the day the shared one grew the three
  facts a browser needs.

`quest.approve`, "Put a proposed quest on the board and set what it pays", is a real key enforced
by `guardCapability` on the two `/api/review/quests/:id/*` routes, and **no module declares it**.
It also opens the read: `GET /api/review/queue`, the only route that lists proposed quests, answers
`quest.approve` with the quest half of the queue. Until 2026-09-14 that route asked
`intake.moderate` alone, so a holder of `quest.approve` alone could accept a proposal they were not
allowed to see. A holder of `intake.moderate` alone still reads every proposed quest and puts none
on the board, which is exactly what that key grants: reading a proposal creates no obligation.
`docs/CAPABILITIES.md` lists it among eleven such keys and states the rule: a key reaches the gate
from any route that asks for it, and the admin surfaces these cover sit outside every module. So
the absence is not a hole in the gate. It does mean that auditing "what powers does the quests
module add" from `shared/modules.ts` alone misses the power that decides what a quest pays before
anybody claims it.

## Dependencies

What this module reads that it does not own:

- **The ledger** (`server/lib/ledger.ts`, `server/lib/economy.ts`) for `quoteWorkPay`, the owed
  rows, the faucets, and `questCreditsFor`, which still reads the recognition older consents posted.
- **`gameStart`** for `issuanceRefusal`. No consent that would pay anything can land before the
  launch vote carries.
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

**The card and the consent read one function** (0265). `QuestCard` and `QuestDetail` render the
`pay` that `GET /api/quests` and `GET /api/quests/:id` attach, which is `questPay` over
`quoteWorkPay`, the function `owedForClaim` prices from. A rule change between the card and the
consent can still change what posts, so the member's notification names what the settled rows
posted, never what the card said. The card never converts a token into money: a token only has a
price when the exchange posts one, and "no price set" is not "worth nothing". It converts the
value, which is held in money, through the daily rates (`shared/money.ts`).

**A badge's reward multiplier lifts nothing now.** It lifted a Gratitude grant toward the consent
cap (Rye, 2026-09-14), and a consent grants none since 2026-10-21. `rewardMultiplierFor` stays in
`server/lib/seasonPatterns.ts`, read by nothing, until the founder says whether a badge should lift
a quest's token pay instead. `quest_claims.amount` on an older consent is still what that witness
decided, and `GET /api/game/me` still joins the ledger through `questCreditsFor` for it.
`server/routes/questConsentPayout.test.ts` drives what a consent moves through the real handler
into the real ledger.

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

**Closed now means closed, and the check is on the server because the client never had one.** The
claim route used to check the example flag, `min_stage`, `requires_role` and the member's existing
claims, and never `quest.status`. Nothing upstream covered for it either: `GET /api/quests` is
`res.json(await questsRepo.all())` with no filter, and the board's own filter in
`client/src/pages/Quests.tsx` is `circleMatch && diffMatch`, which never reads status. `statusIs`
in `client/src/lib/questBoard.ts` exists and does not filter the board; its consumers draw a
"Seasonal" chip and filter `suggestNext`. So a quest an admin marked Closed rendered on the board
like any other card, with a working claim button, and walked through to consent normally. No deep
link was needed.

`questClosed` in `server/repos/quests.ts` is now asked by both doors: `POST
/api/game/quests/:id/claim` answers `409`, and the `map.promise` claim branch answers
`reason: "closed"`, which that vocabulary already defines as "not taking answers". It is a
**deny-list on the single word `closed`**, not an allow-list on `open`, because the column is a free
varchar: Admin offers `Open` and `Closed`, `server/seeds/quests-seed.json` ships a `Seasonal` quest,
`server/seeds/examples-seed.json` writes lowercase `open`, and a village can type its own word.
Refusing everything that is not `open` would have locked a village out of its own board, which is a
worse failure than the one being closed. Case and whitespace are tolerated, matching `statusIs`.

**Submit is deliberately not guarded this way.** Closing the board must never strand work already
in flight: a member holding a claim from before the quest closed still hands it in and is still
consented.

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
sentence (counted under the quest's row lock, see Data model), because badges and health both still
join against the quest row and deleting it strands
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

The bound costs a `rate_hits` row per miss, and **this one route refuses when the guard cannot
check**. Everywhere else in the platform an unreachable guard table reads as "not over limit",
because a guard that takes a public form down during an outage costs the village real leads.
Here the trade runs the other way and Rye chose it on 2026-09-23: this is the only route in the
module that spends `sharp` on a caller with no account, so failing open would drop its only
bound at the moment the database is already in trouble. The cost of refusing is a share card
that does not render while the database is unwell, which is a poster and not a person's work.

`server/repos/rateHits.ts` answers `under`, `over` or `unavailable`; `overLimit` in
`server/index.ts` folds the third into "not over limit" for every other caller, in one visible
place, and the raster reads it for itself. 503 rather than 429, because the caller did nothing
wrong and the same request works as soon as the guard can answer.

Two things about that guard were also wrong until 2026-09-23, and both meant it bounded nothing.
It measured its window with a timestamp computed in Node while `at` is written with the
database's `CURRENT_TIMESTAMP(3)`, which are different clocks on any database session that is
not UTC, so the count came back 0 and every caller passed. And it counted in one statement and
inserted in the next, so a burst arriving together all read a count below the bound and all
passed. The window is now arithmetic the database does on its own clock, and the count and the
insert happen under one named lock per bucket.

**The submit sweep runs inside the response path, and is guarded twice.** In
`POST /api/game/quests/:id/submit` the claim is flipped and committed first, then the loop over
`questConsentRecipients()` rings each steward, and only then does `res.json(updated)` run. Until
2026-09-19 that loop awaited `notify` with no try/catch, so a notification failure answered 500 to
a member whose work was already `submitted`, and the sweep stopped at the failing recipient, so the
stewards after them were never rung. The member then read the failure, submitted again, and the
dedupe key correctly rang nobody twice: the skipped stewards stayed skipped.

There are two guards now, because there were two failures. The inner one wraps each `notify`, so
one recipient's failure costs the others nothing. The outer one wraps the read of who to ring,
which is a database call and fails the same way. Neither can reach the response, and both log what
did not happen, because a bell nobody hears leaves no other trace.
`server/routes/questSubmitSweep.test.ts` drives all four cases through the real route, and its two
controls fail one named case each: rethrowing from the inner guard loses the stewards after the
failing one, and rethrowing from the outer guard answers 500 for work that is already in.

Every other best-effort call in this module is wrapped the same way: the crew thread calls, the
rule mint, the stay credit.

**Crews touch no value, and that is structural rather than conventional.** Every member of a crew
claims, submits and is consented to individually. There is no pooled claim, no shared reward, and
no crew-level row in `quest_claims`. Adding one would put a value path around the human gate this
whole module is built on.
