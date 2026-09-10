# Module design: Profiles — module id `profiles`

Provenance: platform

<!-- describes: server/routes/profile.ts server/lib/profile.ts server/lib/characters.ts server/lib/erasure.ts server/repos/users.ts server/routes/characterPortraits.ts server/lib/characterPortraits.ts server/repos/characterPortraits.ts shared/characterPortraits.ts client/src/pages/Profile.tsx client/src/pages/PublicProfile.tsx client/src/pages/Characters.tsx client/src/components/ProfileSheet.tsx client/src/components/ProfileHero.tsx client/src/components/ProfileJourney.tsx client/src/components/characters/PortraitStudio.tsx drizzle/0070_profile_body.sql shared/modules.ts -->

> Profiles is member identity: the handle a stranger reaches somebody by, the account record behind
> a bearer token, the character sheet that renders a member's standing, the studio where a member
> puts their own face on that sheet, and the two doors marked "download everything you hold on me"
> and "delete my account". It is core, so a village cannot turn
> it off. It stores very little of its own: the sheet is a lens over the ledger, the gratitude log,
> the badge and role tables and the quest claims, all of which are older than this module and none of
> which it owns. Its logic lives in `server/lib/profile.ts`, `server/routes/profile.ts`,
> `server/lib/characters.ts` and `server/lib/characterPortraits.ts`, its
> remaining handlers sit in `server/index.ts`, and its five screens are `client/src/pages/Profile.tsx`,
> `client/src/pages/PublicProfile.tsx`, `client/src/pages/Characters.tsx`,
> `client/src/components/ProfileSheet.tsx` and `client/src/components/ProfileHero.tsx`.

## What this module is, and why it is core

The registry entry in `shared/modules.ts` declares it `core: true`, tier `included`, group `connect`,
dataClass `member-pii`, `setup: "none"`, no capabilities, no variable keys, and one API prefix,
`/api/profile`. The generated fact table is in [docs/MODULES.md](../MODULES.md) and is authoritative
for all of that; do not trust this paragraph over it.

Core means the lifecycle route refuses to move it. There is no "turn Profiles off" and there is no
degraded mode: every other module that names a member, credits a member, or shows a byline reads
through the same `users` row this module owns. That is why the interesting questions here are not
"should I run it" but "what is already public", "what happens when somebody leaves", and "what did
the builders decide that reading the code cold will not tell me".

The one sentence to carry out of this document: **the module's declared API prefix covers eight of
its handlers and none of its public ones.** `/api/profile` really does cover all eight: the three in
`server/routes/profile.ts` and the five in `server/index.ts`, export, exit and delete among them, so
a gate mounted on the prefix reaches every one of them. What it does not reach is
`/api/profiles/:handle`, the only endpoint on the platform that serves one NAMED member's record to
an unauthenticated stranger, keyed by their handle. Express matches `/api/profile` at a segment
boundary, so the trailing `s` puts that route outside the prefix, and it always has been. See
[Sharp edges](#sharp-edges).

`GET /api/game/gratitude/wall` is worth knowing about beside it: it is also unauthenticated and it
also serves member data (up to sixty rows of first names and the messages between them). It is not
keyed by a member, which is the only reason the sentence above says "one named member's record". An
operator auditing what the open internet can read has two doors to look at here, not one.

## Data model

Everything member-identifying lives on `users`. There is no `profiles` table. Four further tables
belong to this module, and a fifth is written on the way out.

| Column on `users` | Added by | Written by |
| --- | --- | --- |
| `id`, `name`, `email`, `password_hash`, `paths`, `contributions`, `quests`, `bio`, `avatar`, `stage_granted`, `training_complete`, `joined_at` | `drizzle/0001_init.sql` | `server/repos/users.ts` |
| `handle` (varchar 40, `users_handle_unique`), `wallet_address`, `wallet_verified_at` | `drizzle/0003_variables_and_stage_events.sql` | `server/repos/users.ts` |
| `recognition_balance` | `drizzle/0005_ledger_and_recognition_balance.sql`, renaming `hearts_balance` | `server/repos/users.ts`, and it is a CACHE of the ledger |
| `journeys`, `prefs`, `contactable`, `token_version`, `role`, `is_example`, `membership_granted` | later migrations | `server/repos/users.ts` |
| `primary_character_id` | `drizzle/0069_characters.sql` | `addCharacter`, `setPrimary` and `removeCharacter` in `server/lib/characters.ts`, all three by raw SQL |
| `title`, `home_structure_key`, `verified_at`, `privacy` | `drizzle/0070_profile_body.sql` | **nothing** |

`addCharacter` is the write that runs most often and it is the easiest to miss: it sets
`primary_character_id` outright when the caller asks for `primary`, and otherwise runs
`COALESCE(primary_character_id, ?)`, which is what makes the first character a member walks their
primary without anybody choosing.

That last row is not a typo and it is the most load-bearing fact in this section. `COLUMNS` in
`server/repos/users.ts` is the complete write surface of the members repository, and `title`,
`home_structure_key`, `verified_at` and `privacy` are not in it. No route, job, or admin screen
writes them by raw SQL either. `loadProfile` in `server/lib/profile.ts` selects three of the four,
the public page renders two of those and the owner's page renders one, so the shipped state is:
every member's `title` is NULL, every
member's `home_structure_key` is NULL, and every member's `privacy` is NULL, which means every
member is served the frozen defaults in `PRIVACY_DEFAULTS`. Consequences are in
[Sharp edges](#sharp-edges).

`verified_at` is the fourth and it is a stronger case than the other three. `loadProfile` does not
select it. Nothing in the repository writes it, selects it or reads it: a search for the name finds
`users.wallet_verified_at`, `mechanics_proposals.verified_at`, and the single `ADD COLUMN` in
`drizzle/0070_profile_body.sql` that created it. It exists only as that ALTER.

The module's own tables are `archetypes` and `player_characters` (`drizzle/0069_characters.sql`) and
`character_portraits` and `portrait_grants` (`drizzle/0158_character_portraits.sql`). A member's
"party" is their set of
player characters, one per archetype, with a pointer on the user row naming which one fronts the
sheet. `drizzle/0069_characters.sql` records why the pointer is a column on `users` rather than an
`is_primary` flag on the character: exactly-one is a schema property that way. `archetypes` is read
by `listArchetypes` in `server/lib/characters.ts` and served publicly; `portrait_grants` is the
forge budget, written by `loadCounters`, `applyAccrual`, `spendGrant` and `refundGrant` in
`server/repos/characterPortraits.ts`. Neither `archetypes` nor `portrait_grants` has an admin
screen.

`subject_refs` is the fifth. It is not this module's table, but this module's erasure path is what
writes it: `server/lib/subjectRefs.ts` drops a departing member's reference when every connected
store confirmed, and otherwise KEEPS it and stamps `erasure_pending_since` / `erasure_unconfirmed`.
See [Leaving](#mechanics) and [Capabilities](#capabilities).

Everything else the sheet shows is read, never stored: `token_balances` and `token_ledger`
(see [token-registry-ledger.md](token-registry-ledger.md)), `gratitude_log`
(see [gratitude-feed.md](gratitude-feed.md)), `quest_claims`, `badge_awards`, `notifications`,
`exits`, `voice_claims`.

## Endpoints

### The account record, behind a bearer token

Registered by `register` in `server/routes/profile.ts`, called from `startServer` at the point the
handlers used to occupy, because Express matches in registration order.

| Route | Who | Answers |
| --- | --- | --- |
| `GET /api/profile` | the signed-in member | `publicUser(user)`: the whole account record minus `passwordHash`, `tokenVersion` and `prefs.googleLink` |
| `PUT /api/profile` | the signed-in member | `name`, `bio`, `avatar`, `handle`, `paths`, each optional |
| `POST /api/profile/contribution` | the signed-in member | a journal entry, `type` and `description`, clipped to 120 and 2000 characters |
| `GET /api/profile/prefs` | the signed-in member | `{ notify }`, `sheetSeen` and `displayCurrency` |
| `PUT /api/profile/prefs` | the signed-in member | accepts and echoes `notify` PLUS `displayCurrency` |
| `GET /api/profile/export` | the signed-in member | roughly thirty domains of their own data, as a download |
| `POST /api/profile/request-exit` | the signed-in member, password confirmed | opens a departure |
| `POST /api/profile/delete-account` | the signed-in member, password confirmed | anonymises the account |

The prefs pair used to be asymmetric, and it is worth recording what the asymmetry was.
`GET` answered `{ notify, sheetSeen }` while `displayCurrency` was validated, written and echoed by
PUT alone, so a client reading its own display currency from the GET got `undefined` and had no way
to tell that from "no choice made". `CurrencyPicker` was never bitten because it reads the whole
prefs blob off `GET /api/profile` instead, which is why the gap survived: the one live caller was
using a different door. The GET now answers with the currency too, and `null` means no choice.

**That `notify` blob is the switchboard for every email the platform sends a member, and it is
opt-OUT.** `registerJob("notification-digest", 24h)` in `server/index.ts` runs `runNotificationDigest`
against exactly this blob, through `resolveNotifyPrefs` and `emailCadenceFor` in
`server/lib/notify.ts`. A member who has never opened the panel resolves to `gratitudeEmail` daily,
`questsEmail` / `rolesEmail` / `mentionsEmail` / `repliesEmail` / `messagesEmail` immediate,
`governanceEmail` daily, `weeklyBrief` on, `celebrations` on. Every member a fork imports is
therefore subscribed to outbound mail until they say otherwise, and `PUT /api/profile/prefs` is the
only member-facing switch.

**The export omits this module's own tables.** The `exportDoc` literal in `server/index.ts` has no
query against `player_characters`, `character_portraits` or `portrait_grants`, so a member's party,
the pictures they uploaded or forged and their forge budget are absent from the one file whose own
comment says "EVERYTHING THE VILLAGE HOLDS ABOUT ME HAS TO MEAN EVERYTHING". The eight domains that
comment names were added; the tables this module has grown since were not. This is the paragraph a
fork operator answering a data-rights request needs, and it is repeated in
[Sharp edges](#sharp-edges).

Every one of these refuses a stranger with `401 {"error": "auth_required"}`. The `prefs`, export,
exit and delete handlers live in `server/index.ts` rather than in the routes file; the module's own
header explains the split as "none of them reads another member's row", and that sentence is stale.
Two of the three do. `PUT /api/profile` runs `(await members.all()).some(...)` for the handle-clash
scan, which is a read of every member row on the deployment, and that is exactly why the slice is
`members` and not a single-row getter. The header in `server/routes/profile.ts` still carries the
old claim; do not read it as the current one.

### The character sheet

| Route | Who | Answers |
| --- | --- | --- |
| `GET /api/me/profile` | the signed-in member | the full sheet: view, standing, gratitude, party, gratitude allowance, voice-claim readiness |
| `GET /api/profiles/:handle` | **anybody, signed in or not** | `publicView` of the same sheet, or the full sheet when the viewer is the subject |
| `GET /api/me/characters`, `POST /api/me/characters`, `POST /api/me/characters/:id/primary`, `DELETE /api/me/characters/:id` | the signed-in member | the party, and writes to it |
| `GET /api/archetypes`, `GET /api/archetypes/:key/paths` | anybody | the classes this village names |

"The classes this village names" is narrower than it sounds, and a fork operator should know the
line before planning around it. `listArchetypes` reads the `archetypes` table, so the LABELS are
data. The KEYS are code: `ARCHETYPE_KEYS` in `server/lib/characters.ts` is a fixed five with the
comment "A village renames the LABELS, never these", and `AVATARS` is a closed set of thirty
filenames built from those five keys times `PRESENTATIONS` times `TONES`. `avatarFor` returns null
for anything absent, so a village that inserts a sixth archetype row gets a medallion instead of art
on every surface that renders a party. The stock art is thirty fixed files under `client/public`,
which is inside the image-budget ratchet, and the `archetypes` table has no admin screen: editing it
is raw SQL.

`GET /api/profiles/:handle` calls `authedUser(req)` but does not require it. A null viewer is a
stranger, gets `publicView`, and is served. There is no `app.use` gate over `/api/profiles`, and
there is no rate limit either: the handler never calls `overLimit`, and
`scripts/check-route-limits.mjs` deliberately exempts public reads, so no gate will ever raise it.
See [Sharp edges](#sharp-edges) for what one anonymous request costs.

Three member-scoped routes sit in the same block of `server/index.ts` and belong to no documented
module: `POST /api/me/voice-claim`, `POST /api/me/voice-claim/:id/cancel` (which refunds) and
`GET /api/me/voice-claims`. They act on the voice-claim readiness this module's sheet renders, but
hypha's declared prefixes are `/api/hypha` and `/api/admin/hypha`, so these three fall outside every
declared prefix on the platform. The only writing on them is
[docs/HYPHA_VOICE_CLAIM_HANDOFF.md](../HYPHA_VOICE_CLAIM_HANDOFF.md), which is a handoff and not a
module contract.

### The portrait studio

Registered by `registerCharacterPortraitRoutes` from `server/routes/characterPortraits.ts`. Seven
routes, every one scoped to the caller, none of them taking an owner parameter.

| Route | Who | Answers |
| --- | --- | --- |
| `GET /api/me/portraits` | the signed-in member | every portrait of theirs, plus the forge budget |
| `POST /api/me/portraits/:key/upload` | the signed-in member | a file they chose. Costs no grant |
| `POST /api/me/portraits/:key/forge` | the signed-in member | spends a grant, returns a candidate |
| `POST /api/me/portraits/:key/keep` | the signed-in member | the candidate becomes the portrait |
| `POST /api/me/portraits/:key/discard` | the signed-in member | drops it. The grant stays spent |
| `POST /api/me/portraits/:key/publish` | the signed-in member | **the one act that makes a picture public** |
| `DELETE /api/me/portraits/:key` | the signed-in member | removes the row and unlinks the file |

This is the module's only file-upload door, its only outbound-vendor call (`portraitForge`), and the
only writer of `published_at`, which is the single flag deciding whether a member's own photograph
is served to anonymous strangers. Authorisation runs before multer, so an unsigned caller cannot make
the server write to the shared volume.

### Member-facing reads that belong to this module's subject and live elsewhere

| Route | Who | Answers |
| --- | --- | --- |
| `GET /api/game/ledger` | the signed-in member | every ledger row where they are either side, plus per-token balances and the cached-versus-ledger comparison |
| `GET /api/game/gratitude/flows` | the signed-in member | given, received, distinct acknowledgers, and per-moon settlements |
| `GET /api/game/me` | the signed-in member | stage, ladder, quests, journeys, membership |
| `POST /api/game/journey/sync` | the signed-in member | writes `journeys[journeyId] = steps` on their own row |
| `GET /api/paths/ladders` | the signed-in member | their ladders, one per path they walk. Registered next to this module's routes, read by `usePathLadders` in `client/src/pages/Profile.tsx`, documented in no module contract |
| `GET /api/game/progression` | the signed-in member | stages and the capability catalogue, read by `Profile.tsx` and `ProfileJourney` |
| `GET /api/game/config` | anybody | the stage and path definitions the sheet renders against |
| `GET /api/game/gratitude/me` | the signed-in member | received, sent, and this cycle's budget. Drives `ProfileJourney`'s acknowledgment bloom |

None of these sit under `/api/profile`.

### What a refusal looks like

`401 {"error":"auth_required"}` for no token or a revoked one; every member route decodes through
`authedUser` in `server/index.ts`, which compares `(decoded.v ?? 0)` against
`(user.tokenVersion ?? 0)`, so a second decode path cannot skip the revocation check. The one other
`decodeToken` call site, the module-usage meter, says in its own comment that it is not a session
test and sits behind `isAuthed`. **There is no symbol called `requireUser` in this repository.** The
name survives only in a stale comment above `GET /api/profile`, so an operator grepping for it finds
nothing and reasonably concludes the doc describes a different codebase.

That 401 body is exact for the eight `/api/profile*` handlers. The `/api/me/*` half of the module
answers `{"error":"auth_required","message":"Sign in first"}`: the `error` word is stable, as the
auth helper promises, and the body shape is not.

`403` on exit and delete, in two different sentences. `POST /api/profile/request-exit` answers
`{"error":"Confirm with your password"}` and `POST /api/profile/delete-account` answers
`{"error":"Confirm with your password to delete your account"}`. Neither is a machine word, and a
caller matching on the string gets one of the two.
`400` with a sentence for a malformed handle or an unknown path id. `409 {"error":"That handle is
taken"}`. `409` with a `blocking` array naming each domain when a departure would strand open
economic state. `404 {"error":"Not found"}` for an unknown handle, and the same for an example
identity, because `userIdForHandle` and `loadProfile` both carry `is_example = 0`.

## Surfaces

- `client/src/pages/Profile.tsx`. The member's own sheet, composed of `ProfileHero` (party and
  moons), the next-step card, `PathsPanel`, `MaturityLadder`, `PowersMap`, the contributions list,
  `ProfileJourney`, `ProfileSheet`, `WalletCard`, `SendTokensCard`, `OnchainCard`,
  `NotifyPrefsPanel` (which carries the export and delete buttons) and `YourAgentPanel`. Its header
  comment states the rule the page keeps: every figure comes off a payload, and a count with no
  payload behind it is not rendered.
- `client/src/pages/PublicProfile.tsx`, at `/profile/:handle`. A separate page from the owner's, on
  purpose. Every section is conditional on the FIELD BEING PRESENT and never on a flag, because an
  absent field means the server withheld it and the page has nothing to say about why.
- `client/src/components/ProfileSheet.tsx`. Standing chips, gratitude both directions, this moon's
  allowance. Owns its own fetch of `/api/me/profile`, and renders nothing at all for a member with
  no balances, no party and no thanks, so a new member does not meet a screenful of zeros.
- `client/src/components/ProfileHero.tsx`. The primary character's art at the top of the page, with
  a three-state load so an empty party is never claimed before the answer arrives.
- `client/src/components/ProfileJourney.tsx`. Stage history, capabilities and roles held, gratitude
  breadth, per-cycle settlements, and the ledger, over four endpoints: three share a loader
  (`SECTIONS`: `/api/game/progression`, `/api/game/gratitude/flows`, `/api/game/ledger`) and a
  fourth, `/api/game/gratitude/me`, drives the acknowledgment bloom. The file's own header says
  three and is one read out of date.
- `client/src/pages/Characters.tsx`, at `/profile/characters`. The party editor: it reads
  `/api/archetypes`, `/api/me/characters`, `/api/archetypes/:key/paths` and `/api/me/portraits`, and
  it mounts `client/src/components/characters/PortraitStudio.tsx`, the only surface anywhere that
  can upload, forge, keep, discard, publish or delete a portrait. `client/src/App.tsx` routes
  `/profile/characters` BEFORE `/profile/:handle`, and that order is load-bearing: wouter takes the
  first match, so a later registration would make this page unreachable behind a handle lookup.

## Mechanics

**There are two profiles, and their field sets barely overlap.** `GET /api/profile` returns the
account record shaped by `publicUser` in `server/index.ts`, which spreads whatever `rowToMember`
built in `server/repos/users.ts` minus `passwordHash`, `tokenVersion` and `prefs.googleLink`. Read
`rowToMember` for the list; transcribing it here is how a doc rots. The three keys worth naming
because a reader expects otherwise: there is no `wallet` object on this shape (`wallet: { address,
verifiedAt }` belongs to a different route), it is `walletAddress` and `walletVerifiedAt` as flat
keys, and the record also carries `contactable`, `stageGranted`, `trainingComplete`, `isExample` and
`membershipGranted`.
`GET /api/me/profile` returns the character sheet shaped by `loadProfile`: handle, name, title,
joinedAt, moonsOnTheLand, primaryCharacterId, homeStructureKey, privacy, standing, gratitude, party,
allowance, voice. `title`, `moonsOnTheLand` and `standing` are absent from the first; `email`,
`role`, `bio` and `paths` are absent from the second. A fork that adds a field to one has added it
to neither of the others.

**`publicUser` is not the public view.** The name predates `publicView` and means "safe to put in an
API response to the account's owner". It strips exactly three things: `passwordHash`, `tokenVersion`,
and `prefs.googleLink`. It returns `email`. Nothing but the owner's own token ever reaches it.

**`publicView` is additive, and that is the invariant.** `publicView` in `server/lib/profile.ts`
builds a stranger's copy by starting from six fields and adding what the flags permit, never by
deleting from a full one. Deletion is the shape that leaks: a field added later is a field nobody
remembered to delete. A new field on `ProfileView` is private until somebody writes the line that
publishes it. `server/profile.test.ts` asserts the exact key set `publicView` returns, and proves it
by handing the function an unknown extra field and checking it does not come out, so adding a field
to the public half is a deliberate act with a red test in front of it.

**But there is a door cut through that invariant, and it is `party`.** The handler spreads
`party: await partyFor(...)` into the response AFTER `publicView` has run, so `party` never passes
through the additive builder at all. A stranger who knows a handle receives, per character:
`archetypeKey`, `presentation` (`f` or `m`), `tone` (`deep`, `olive` or `light`), `avatar`,
`stockAvatar`, `portrait` source and published flag, `isPrimary` and `chosenAt`. That is deliberate,
and `partyFor` documents the stranger case at length: its `viewerId` parameter has no default, and
`portraitsByArchetype` runs a published-only query for anyone but the owner. What is worth saying
plainly is that no privacy flag governs any of it, and that
`server/profile.test.ts` asserts the key set of `publicView`'s RETURN VALUE and not of the route's
response. A field added to the route's spread has no red test in front of it.

**A missing privacy flag reads as its default, and the defaults are frozen.** `resolvePrivacy` fills
from `PRIVACY_DEFAULTS` rather than reading the stored JSON directly, and honours only real
booleans: a string `"false"`, a `0` or a `null` in the column are junk from a hand-edited row and
fall back to the default rather than being coerced. `Object.freeze` on the defaults means the day a
new flag ships, every row written before it existed inherits the conservative answer instead of
being opted in to something nobody saw. The split follows the doctrine: what a member chose to EARN
is shown (`showBadges`, `showRoles`, `showHearts`, all true), what describes their LIFE is not
(`showHome`, `showInventory`, `showCalendar`, all false).

**Handles.** Assigned at registration by `slugifyHandle` then `uniqueHandle` in `server/index.ts`:
NFKD normalise, strip combining diacriticals as escapes rather than as a literal range, collapse
everything outside `[a-z0-9]` to dashes, trim, cut to 24 characters, fall back to `member`, then
append `-2`, `-3` and so on until free. Changed through `PUT /api/profile`, which lowercases, trims,
and tests `HANDLE_RE` (three to thirty characters of letters, numbers, dashes and underscores,
opening on a letter or a number), then scans `members.all()` for a clash. `users_handle_unique` has
existed since `drizzle/0003_variables_and_stage_events.sql`, and `drizzle/0070_profile_body.sql`
released any empty-string handles to NULL, because an empty string occupies a unique index once and
then refuses every later member who saves a blank one.

**There is a third handle-assignment path and it runs at boot.** `startServer` calls
`runOnce("backfill-member-handles", backfillMemberHandles)`, which loads the whole roster and mints a
handle from `u.name` for every member without one. For a fork that imports an existing membership
list, first boot therefore turns real names into permanent public identifiers at the one endpoint
anybody on the internet can read. `runOnce` swallows the error and records the id only on success, so
a partial backfill logs `[MIGRATION] backfill-member-handles failed (continuing)`, leaves some
members with handles and some without, and retries on the next boot. The only signal is a console
line.

**The portrait forge budget is a timer that nothing schedules.** `shared/characterPortraits.ts`
grants `SETUP_GRANTS = 3` at first read and accrues one per lunation up to
`MOON_GRANT_CEILING = 3`; spending takes the moon half first. `readBudget` in
`server/lib/characterPortraits.ts` does the accrual ON READ, from
`cycleBoundsFor(now).cycleNumber` in `shared/lunar.ts`, so no job runs and a member who never opens
the studio still accrues, arriving to find whatever the arithmetic says. `applyAccrual`'s
`moon_cycle < ?` clause is what makes two concurrent readers grant once rather than twice. The
refund rules are three and they are not symmetrical: `POST /forge` takes the grant BEFORE the
provider is called, a missing provider refunds it (503 `no_forge`), a throwing provider refunds it
(502 `forge_failed`), and `POST /discard` never refunds, because the cost is the generation and not
the keeping.

**Paths are validated against a closed set that includes what you already hold.** `claimPaths` in
`shared/gameConfig.ts` accepts an array of known path ids, plus every id already in the member's
stored list even when this build's config no longer names it. Without that, a village that renamed a
path would lock every member holding the old id out of the control entirely: their own stored value
would fail validation and take down the request that was going to drop it. Duplicates collapse,
order is the caller's. Before this ran, `PUT /api/profile` wrote any JSON at all into the column, and
`server/profilePaths.routes.e2e.test.ts` exists because of it.

**Moons.** `moonsSince` counts whole synodic months (29.53058867 days) since `joined_at`, floors,
and clamps at zero, so a future join date is a clock problem rather than a negative on a profile. It
is computed on every read and stored nowhere.

**The member's own ledger goes through the same accounting as the village's.** `entriesForMember` in
`server/lib/ledger.ts` selects from `token_ledger` where the member's account is either side, and
signs each row by direction. `loadStanding` reads `token_balances` joined to the `tokens` registry,
drops zero balances (a chip reading 0 is an accusation) and drops inactive tokens, and carries
`decimals` with every chip because the ledger stores minor units. There is no second set of books:
`GET /api/game/ledger` returns `balance` (summed from the ledger), `cachedBalance` (the
`users.recognition_balance` column) and `inSync`, and says in the handler that if they disagree the
ledger wins. The minor-units conversion happens once, in `client/src/lib/tokenAmount.ts`, after three
surfaces each carried their own spelling of it and the wallet carried none.

**Leaving.** `POST /api/profile/delete-account` is an anonymisation, not a deletion.
`anonymizeMember` in `server/lib/erasure.ts` renames the row to "A departed member", rewrites the
email and handle to tombstones, bumps `tokenVersion` so every session dies, clears bio, avatar,
paths, journeys, prefs and contributions, then sweeps the tables that restate the person
independently of the join (`gratitude_log` names, `quest_claims.user_name`, notification titles and
bodies, skill tags, push subscriptions, forum subscriptions, wallet challenges, concierge queries,
contact request messages, intents, vendor records, the character sheet and every portrait including
the files on the volume), releases org seatings and role holdings, and
asks the external stores last so a slow vendor never delays the local sweep. Value rows stay: the
ledger, gratitude, claims, loans, orders and badge awards are the village's record of what happened
and what is owed, and deleting them would break the conservation proof.

**The sweep is a sequence and not a transaction, on purpose, and it resumes.** `server/lib/erasure.ts`
opens no connection and calls no `beginTransaction`, and its header argues at length why it must
not: three of the participants are repositories that take their own connections and hold their own
caches, one makes network calls to outside vendors, and one unlinks a file. What it has instead is a
named, ordered list of steps that are each idempotent by construction (a DELETE keyed on the member,
or an UPDATE writing a constant keyed on the member), with `member_erasures` recording that a sweep
began, which steps landed, and where it stopped. A throw partway still leaves the member anonymised
in the tables already swept, still returns a 500, and now says so in a row a steward can see and
finish. `resumeErasure` runs only the steps the record does not hold, and `server/lib/erasure.test.ts`
interrupts a real sweep and asserts what a resume does, because a test over the happy path passes
whether or not any of this exists.

**A store that does not confirm leaves a member half-erased, and only a person clears it.**
`forgetMemberEverywhere` retires the subject reference only when every connected store confirmed.
When one does not, `server/lib/subjectRefs.ts` KEEPS the mapping deliberately (`markErasurePending`),
because the village still owes that member a confirmation and chasing it later needs the reference
to resolve. That state is invisible everywhere except `GET /api/review/erasure`, the retry is a
button somebody presses, and nothing ages it out. See [Capabilities](#capabilities) for the key
those two routes are gated on.

## Game variables

None of its own. `variableKeys` is empty in `shared/modules.ts` and there is no `profile` key in
`shared/gameVariables.ts`, so this module DECLARES no dial. That is not the same as "nothing on
these surfaces is tunable from Admin", and the difference matters on a fresh village.

Numbers and switches the sheet obeys are owned elsewhere and read here: `gratitude.base_budget` and the
stage multiplier behind the allowance bar, `economy.voice_claim_threshold` and `economy.hypha_space`
behind the voice chip, the token registry's `decimals` and `active` behind every standing chip, and
`tokens.show_economics_section`, **default `"false"`**, behind `OnchainCard`. That last one is worth
holding: the registry describes it as "Displays token balances and Gratitude flows on member
profiles", `server/index.ts` reads it to withhold the on-chain block from `GET /api/wallet` and
serves it to the client as `tokens.showEconomics`, and `OnchainCard`, which this document lists in
`Profile.tsx`'s composition, renders nothing at all until a founder turns it on. A component named
in this doc is dark by default on every village that has not touched Admin.
[docs/VARIABLES.md](../VARIABLES.md) is generated from the code and is authoritative for all of them.

The one identity axis that is NOT a variable is the path list. `GAME_CONFIG.paths` in
`shared/gameConfig.ts` is a hardcoded array of four, `claimPaths` validates against it, and
`GET /api/game/config` serves it raw rather than through `mergedConfig()`. A fork that wants
different paths edits the constant and redeploys. That is deliberate in the sense that no variable
was ever defined; it is not deliberate in the sense that anybody wrote down why.

## Capabilities

None declared. `capabilities` is empty in `shared/modules.ts`, and no handler under `/api/profile`,
`/api/me` or `/api/profiles` calls a capability gate.
[docs/CAPABILITIES.md](../CAPABILITIES.md) is generated and authoritative.

The access rules here are not capability keys, they are four simpler tests, and a fork operator
should hold them separately in their head:

1. **Do you hold a valid token for this account.** Every `/api/profile` and `/api/me` route.
2. **Do you know this account's password.** Exit and delete only.
3. **Do you hold the admin token.** `GET /api/admin/players` (`server/routes/players.ts`) returns
   every member's name, email, handle, role and paths; `PUT /api/admin/players/:id/stage` writes
   `stageGranted` on their row; `DELETE /api/admin/players/:id` runs the same `anonymizeMember` on
   any member. This module's row is admin-readable and admin-writable, and a reader who takes the
   first two tests as the whole model will miss it.
4. **Nothing at all.** `GET /api/profiles/:handle` and `GET /api/archetypes`.

There is one capability in the picture and it belongs to another module. `server/routes/erasureQueue.ts`
gates `GET /api/review/erasure` and `POST /api/review/erasure/retry` on `intake.moderate`. Those two
routes exist only because of this module's erasure path: a departing member whose deletion a
connected store never confirmed keeps their subject reference, and this is the only place that state
is visible or clearable. So the obligation this module creates is discharged by a key it does not
own, by hand, with nothing ageing it out.

Because the module declares no capabilities of its own, no badge, role or stage can widen or narrow
the four tests above. A village that wants members-only profiles has no dial to turn.

## Dependencies

`requires: []` and `recommends: []`, and both are honest: nothing here throws when another module is
off. But the sheet is a lens, so what it can SAY depends on what else is running.

Read the third column carefully: three of these sources cannot be turned off at all, and the table
would otherwise invite an operator to plan for a configuration the lifecycle route refuses.

| Reads | From | If that source is off |
| --- | --- | --- |
| `token_balances`, `token_ledger`, the `tokens` registry | platform infrastructure, not a module | **Cannot be off.** There is no `token registry and ledger` id in `shared/modules.ts`, no `module_settings` row and no lifecycle. [token-registry-ledger.md](token-registry-ledger.md) is a design document for a keystone, not a module contract |
| `gratitude_log`, the allowance | gratitude | **Cannot be off.** `core: true` |
| `quest_claims`, stage events | quests, progression | **Cannot be off.** Both `core: true` |
| `badge_awards`, roles | badges | `ProfileJourney` shows less |
| `voice_claims`, `economy.hypha_space` | hypha and the economy | the voice chip is absent |
| `archetypes`, `player_characters` | this module's own tables, served through `server/lib/characters.ts` | not applicable |
| `character_portraits`, `portrait_grants` | this module's own tables, served through `server/lib/characterPortraits.ts` and `server/repos/characterPortraits.ts`, with routes in `server/routes/characterPortraits.ts` | not applicable |
| the module drivers, for export and erasure | every listed module | `server/lib/memberDrivers.ts` reports the store as unconfirmed rather than silently skipping it |

The four core modules are quests, gratitude, progression and profiles, and `core: true` is what the
lifecycle route refuses to move. So the only genuinely optional sources this sheet reads are badges
and hypha.

The privacy rule for portraits belongs to `partyFor` in `server/lib/characters.ts` and not to this
module: `viewerId` is a required parameter with no default, so the "who is looking" question cannot
be skipped on any of the five paths that render a party, and a request from anyone but the OWNER
runs a different query carrying a published-only clause. `portraitsByArchetype` in
`server/lib/characterPortraits.ts` branches on `viewerId !== null && viewerId === ownerId`, so a
signed-in member looking at somebody else is filtered exactly as an anonymous reader is. That is the
stronger guarantee and it is the one the code actually gives. `PublicProfile.tsx` therefore needs no
rule of its own and has none.

## Sharp edges

**A member's token balances are readable by the open internet, and no member can stop it.**
This is the one to read twice. `GET /api/profiles/:handle` is unauthenticated. `publicView` publishes
`standing` and `gratitude` when `showHearts` is true. `showHearts` defaults to true in
`PRIVACY_DEFAULTS`. And nothing on the platform writes the `privacy` column, because it is not in
`COLUMNS` in `server/repos/users.ts` and no raw SQL sets it. So `showHearts` is true for every member
of every village, permanently, and anyone who learns a handle can read that member's per-token
balances and their season's gratitude counts without an account. Handles are not secret: the forum
publishes an author handle on every thread and reply. `publicSupply` in `server/lib/economy.ts` and
the `/api/economy/supply` handler both go out of their way to avoid deanonymising individual holdings
by arithmetic, naming "a member who set `showHearts` false" as the person being protected. No member
has ever been able to set it.

`Privacy` has six flags, and four of the other five are declared, defaulted, resolved and read by
nothing at all: `showInventory`, `showCalendar`, `showBadges` and `showRoles` have no reader outside
`server/lib/profile.ts` and its test, and `publicView` publishes neither badges nor roles regardless.
`showHome` is the one that is read, at the single line in `publicView` that publishes
`homeStructureKey`.

**One anonymous request to `/api/profiles/:handle` costs four database round trips, and nothing
bounds them.** `loadProfile`, `loadStanding`, `loadGratitude` (two `COUNT DISTINCT`s and a `SUM` over
`gratitude_log`) and `partyFor`, on every call, with no `overLimit` anywhere in the handler.
`scripts/check-route-limits.mjs` will not flag it: its own header says a public GET that reads a row
and returns JSON is what a village website IS, and bounding those writes a reverse proxy inside the
application. That is a defensible rule and this is the route where it costs the most, because
handles are published on every forum thread and reply, so the whole village's per-token balances are
scrapeable in one pass at whatever rate the caller likes.

**Handles are recyclable, with no history, no cooldown and no redirect.** `PUT /api/profile` checks
only for a LIVE clash. No migration in `drizzle/` defines a handle-history table and nothing records
what a handle used to be, so a member who renames releases their old handle immediately and
`/profile/<old handle>` can come to name a different person. Every external link that pointed at
them answers 404, because `userIdForHandle` returns null and there is nothing to redirect to. This
is the platform's one public identity URL.

**A departed member's title and home still survive the tombstone. Their characters and portraits do
not, any more.** `anonymizeMember` writes through `members.update`, so it can only clear columns the
users repository owns, and `title` and `home_structure_key` are not among them. The tombstone handle
is deterministic (`departed-` plus the last eight characters of the user id) and appears on their
forum bylines, so `GET /api/profiles/<that handle>` still answers with their remaining standing
chips, whatever `title` they carried and wherever `home_structure_key` says they sleep. Both columns
are READ (`server/lib/profile.ts` names them in its SELECT and publishes them) and NEITHER is
written by anything in the tree: no route, no repository and no migration sets either one. So the
exposure is latent rather than live, and it is latent in the way that ends in one commit. A fork
that adds a title editor, or a "where I sleep" control, without also adding a line to the erasure
sweep makes it live the day it ships. **Both are still open**, and closing them means a repository
statement of their own, because the tombstone writes through `members.update` and cannot reach a
column the users repository does not map.

The `player_characters` and `character_portraits` halves are closed. The sweep now runs a
`character-sheet` step (`forgetCharactersForMember`, which clears `users.primary_character_id`
first and then drops the rows) and a `portraits` step, so the party and the pictures leave with the
person.

**A portrait URL is a bearer capability, and both doors now revoke it.** `portraitUrl` in
`server/lib/characterPortraits.ts` returns `/api/uploads/<stamped name>`, and `server/index.ts`
states in its own comment that "`/api/uploads/:filename` has no authentication, so the file IS the
capability". That makes an address a thing that has to be taken away, and until 0195 neither door
took it away. `POST /api/me/portraits/:key/publish` with `published: false` cleared `published_at`
and nothing else, so a member taking their picture back removed it from the sheet while the bytes
stayed served at the same one-year-immutable URL to anybody who had ever seen it, and
`server/lib/erasure.ts` unlinked nothing at all, so account deletion left both the rows and the
files.

Withdrawing now MOVES the bytes: they are copied to a fresh stamped name, the row is pointed at the
copy, and the old file is unlinked, so the old address answers 404 and the member still has their
picture. Withdrawing is not deleting, and `DELETE /api/me/portraits/:key` stays the other door. The
response carries `addressRevoked`, because a best-effort move that failed silently would be the
original defect wearing a fix. Erasure does the blunter version: rows, forge budget and files all go.

**The export contains this module's own tables.** `party`, `portraits`, `portraitBudget` and
`gratitudeDistributions` were all absent from the `exportDoc` literal, so a departing member's
party, the pictures they uploaded or forged, their forge budget and what the value pool credited
them were missing from the file whose button says everything. All four are read now, each through
its own repository function keyed on the member alone.

**The erasure sweep is resumable, and deliberately not one transaction.** It used to be twenty-odd
sequential queries with no `beginTransaction` and no `try`/`catch` anywhere in the file, so a
failure partway was a half-anonymised member, a 500, and a state nothing would notice or retry. It
is now a named, ordered list of idempotent steps recorded in `member_erasures` (0195): the row says
a sweep began, which steps landed, where it stopped and what the error said, and
`resumeErasure` finishes it from the steward's queue at `/review`.

One transaction was considered and rejected, and the reasoning is in the file's own header so that
somebody reaching for `beginTransaction` reads it first. A MySQL transaction lives on one
connection; `members`, `submissionsRepo` and `roleHoldersRepo` take their own and keep their own
caches, `forgetMemberEverywhere` makes network calls to outside vendors, and unlinking a file is not
transactional in any database. A wrapper around the statements that COULD join one would leave the
rest outside it, still able to fail half way, while looking closed, which is worse than an honest
sequence because a reviewer sees `beginTransaction` and stops asking.

**The headline balance on the member's own profile is unformatted minor units.**
`client/src/pages/Profile.tsx` renders the member's `recognitionBalance` directly, with no `decimals`
and no `formatTokenAmount`. `recognition_balance` is a cached copy of the ledger and the ledger
stores minor units, which `GET /api/game/me` says explicitly where it ships the same number with a
`decimals` beside it. **Every token but Village Voice ships at `decimals = 0`; Voice ships at 3**
(`VOICE_DECIMALS` in `server/lib/economy.ts`, passed by `ensureVoiceToken`; every other registration
omits the field and takes the column default of 0 from `drizzle/0006_token_registry.sql`). The
recognition token is one of the zeros, so today the raw number on THIS surface is right. Carry the
premise anywhere else, to the Voice chip, the wallet, or a downloaded export, and it is a 1000x
error. Raise
the recognition token's decimals in the registry and this figure reads ten thousand while
`ProfileSheet` renders the correct ten an inch below it, on the same page, from the same balance.
The display-side sweep this surface was missed by lives in `client/src/lib/tokenAmount.ts`, whose
header names the surfaces and the ruling of 2026-09-04.
`drizzle/0126_ledger_amount_matches_the_balance_it_makes.sql` is the SCHEMA half and nothing else:
it widens `token_ledger.amount` to bigint, says twice in its own header that it changes no token's
`decimals`, and scopes a different sweep, the WRITE side, where 39 of `postTransfer`'s 44 callers
pass a human number straight through. Following that reference expecting a rendering site leads to a
migration that never mentions one.

**`GET /api/profile` returns the member's email address.** It is their own record, read with their
own token, so this is correct. It is worth knowing anyway, because it means any client-side code
holding the auth context holds a live email, and because a fork that reuses `publicUser` for any
other audience leaks it. `publicUser` has exactly one caller shape today: the account's owner.

**`PUT /api/profile/prefs` writes whatever JSON arrives under `notify`.** The incoming object is
spread into the member's notify blob with no key allowlist; only `displayCurrency` is validated. The
read side is safe, because `resolveNotifyPrefs` answers from a known set and a junk write reads back
as defaults, so the damage is bounded to unbounded keys sitting in a JSON column.
`server/lib/oauthAccounts.ts` carries a note naming this route as the attack surface for the
sign-in-plumbing keys that share the blob.

**`POST /api/game/journey/sync` is a member-writable free-form store on their own row.** Any journey
id string, any array of steps, stringified and written. No key allowlist, no length cap beyond the
1 MB express body limit. It is scoped to the caller's own record, so it is a growth question and not
an access one.

**The member's ledger read has no LIMIT.** `entriesForMember` selects every row where the member is
either side, and `GET /api/game/ledger` then resolves each distinct send counterparty with a separate
`members.byId`. Fine for a village of forty in its first year. Not fine for the fifth year of an
active market, and there is no pagination to reach for.

**The handle clash check is a full roster scan and is not atomic.** `PUT /api/profile` loads
`members.all()` into memory to look for a clash. Two members racing for the same handle both pass the
scan and the second hits `users_handle_unique`, which surfaces as a 500 rather than the 409 the same
handler produces one line earlier. Cheap to hit only if two people are trying at once.

**An auto-assigned handle can be shorter than a member is allowed to save.** `slugifyHandle` has no
minimum, so a member named "Al" is assigned `al`, while the handle pattern demands three characters.
That member can never re-save their own handle without changing it, and a name written entirely
outside the ASCII alphanumerics after normalisation collapses to `member`, `member-2`, `member-3`.

**`loadProfile` takes a `villageId` it does not use.** `users` has no `village_id`
column: one deployment is one village. The parameter is inert. Read it as a shape kept for symmetry
with the tables that ARE scoped (`player_characters`, `gratitude_log`, `voice_claims`), not as
isolation this query provides. The two neighbours differ and it is worth not confusing them:
`loadStanding(pool, userId)` takes no `villageId` at all, so there is no per-village scope on the
standing query to go looking for, and `loadGratitude` takes one and filters all three of its
subqueries on it.

**The contributions card can render a missing amount.** Two writers append to `users.contributions`:
the Work With Us acceptance path in `server/index.ts`, which sets `recognitionEarned`, and
`POST /api/profile/contribution`, which deliberately does not, because it used to add a
caller-supplied amount straight onto the balance, which was self-service minting off the ledger.
`client/src/pages/Profile.tsx` renders the amount unconditionally with a leading plus sign. No
shipped client calls the contribution route, so this is latent; the card's own empty state names the
acceptance path instead. A fork that wires up a journal control meets it immediately.

**"held in all" is a lifetime sum, not a balance.** `ProfileSheet` prints the gratitude `lifetime`
figure under the phrase "held in all", and `loadGratitude` computes `lifetime` as a SUM over every
`gratitude_log` row addressed to the member. It is everything they were ever given, which equals what
they hold only while nothing is ever spent or decayed. The two headline counts beside it are
deliberately PEOPLE and not hearts, because "thanked by 14 members" says something true about a
person and a running total says something about a scoreboard.

**Both moon labels are unpluralised.** `PublicProfile.tsx` and `ProfileHero.tsx` interpolate the
count straight into "moons on the land", so a member in their second lunation reads "1 moons on the
land". Zero is handled ("New on the land"); one is not.
