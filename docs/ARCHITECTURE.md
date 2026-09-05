# game-amora: architecture of the shipped system

<!-- describes: server/index.ts server/lib/ server/routes/ shared/modules.ts shared/capabilities.ts shared/gameVariables.ts drizzle/ -->

> The canonical description of what is actually running. Where an older
> planning document disagrees with this file, this file wins; where this file
> disagrees with the code, the code wins and this file has a bug: fix it.

## 0. How to read this file, and how to add to it

**It carries no line numbers and no verification date.** Both were tried and
both failed inside a day. A hand-corrected pass on 2026-09-04 at 12:26 was
stale again by 14:11, because `server/index.ts` lost roughly 2,500 lines to
route extraction while the corrections were being written, and roughly twenty
of the twenty-six citations landed on unrelated code. A header that says
"verified as of build marker X" and is never re-stamped is a lie with a
timestamp attached, and it named a marker that cannot exist:
`server/buildMarker.test.ts` refuses any literal date in `BUILD_MARKER`.

So every reference here is a path plus a thing you can search for: an exported
symbol, a route, a constant, a table or a heading. That survives any edit short
of a rename. `docs/GOVERNANCE_EVOLUTION_PROMPT.md` states the same rule for the
governance brief: anchors are syntax and exported symbols, never line numbers.
Follow it when you add to this file.

**Figures a script derives are not copied here**, because a number nobody
writes down cannot go stale. Run the script:

```bash
node scripts/module-facts.mjs             # module registry, capability keys, the ordered CI gate list,
                                          # the module library contract version, the live CI budgets
node scripts/check-server-index-size.mjs  # server/index.ts line count and route count, with the baseline
node scripts/check-doc-links.mjs          # every path this file names still resolves on disk
```

The contract semver is `PLATFORM_VERSION` in `server/lib/identity.ts`. The
running build is `BUILD_MARKER`, composed whole in `scripts/build-server.mjs`
from the commit SHA and the commit date, never typed by hand.

---

## 1. What the platform is

A white-label village-coordination platform. One Node process serves a React
19 SPA and an Express API over MySQL. The product is a loop: someone arrives,
finds a path, does useful work, a human consents to it, recognition carries
value, they do more. Around that loop sit the optional modules declared in
`MODULES` in `shared/modules.ts`, every one of which ships OFF and is enabled
per deployment by an admin. `node scripts/module-facts.mjs` counts them and
says how many are core. Real value
(equity, voice) lives on Hypha and is only ever displayed here; the
platform's own ledger is double-entry-lite with conservation provable at
every boot. "Amora" is merely the first tenant: identity is an overlay,
behaviour is data, and a fork inherits the platform by pulling, not by
find-and-replace.

---

## 2. The one-page map

**Processes.** Exactly one: `dist/index.js`, the esbuild bundle of
`server/index.ts` built by `scripts/build-server.mjs`, which also stamps
`BUILD_MARKER` into it. It runs migrations, serves `/api/*`, serves the built
SPA from `dist/public`, and hosts the scheduler. One process per deployment
(Railway) is a load-bearing assumption: the S12 store caches are sound
*because* there is no second writer (the file header of
`server/repos/store-db.ts`). MySQL is the only
authority; the `data/` volume holds only uploads and archived JSON
(`docs/FORK_RUNBOOK.md` "Backups").

**Directories.**

| Path | What lives there |
|---|---|
| `server/index.ts` | The one Express server: auth, boot, and the routes not yet extracted. Its line count and route count are ratcheted downward by `scripts/check-server-index-size.mjs` and stored in `scripts/server-index-size-baseline.json`. Both figures used to be written out here and both were wrong within a day of every correction, so they live in the script now: run it. |
| `server/routes/*` | Route modules, one per domain, each exporting `register(app, deps)`. Where new routes go. |
| `server/lib/*` | Domain libraries: ledger, modules, payments, exchange, notify, scheduler, events, secrets, identity, launch, feedback, exit, health, member tokens, the admin-gate marker, `appDeps` … |
| `server/db/` | `migrate.ts` (the engine), `testDb.ts` (S5 harness), `pool.ts` (the connection), `maintenanceMode.ts` (the page a failed migration serves), `provisioningReport.ts` (the run summary and the hollow-run verdict). There is no schema.ts here: the schema is the numbered SQL in `drizzle/`. |
| `server/repos/` | `store-db.ts` (MySQL-authoritative, memory-cached, write-through stores), `users.ts`, `quests.ts`, `gratitude.ts` |
| `server/seeds/` | Fork-onboarding seeds (content, quests) — a declared brand home |
| `shared/` | Isomorphic registries: `modules.ts`, `capabilities.ts`, `gameVariables.ts`, `gameConfig.ts`, `launchRequirements.ts`, `hypha.ts`, `lunar.ts` |
| `client/src/` | React 19 + Vite + wouter SPA; `client/src/modules/ModuleProvider.tsx` is the client's one module-truth source |
| `drizzle/` | Numbered SQL migrations, applied by the custom runner in `server/db/migrate.ts`. `ls drizzle/` is the range; do not trust a number written in prose (see trap 1) |
| `scripts/` | `module-facts.mjs` (reads the registry and the workflow, and prints what this file refuses to restate), `check-brand-refs.mjs` (the ratchet), `run-migration.ts`, `smoke-all-modules.mjs`, `enable-all-modules.mjs` |
| `docs/` | This file, `FORK_RUNBOOK.md`, `FEEDBACK_HUB_CONTRACT.md`, per-module design docs |

**Request path.** Registration order in `startServer()` is the order of the
pipeline, and every step below is an `app.use` you can search for:

1. The raw-body Stripe webhook, `POST /api/webhooks/stripe`, mounted *before*
   `express.json()` so the HMAC sees the bytes Stripe signed. The Hypha voice
   callback is mounted beside it for the same reason.
2. `express.json()`, 1 MB, with a wider ceiling for `/api/map/draft` and
   `/api/map/publish` (`SCENE_BODY_LIMIT`).
3. The agent-token resolver: a `vat_` bearer is honoured under `/api/agent/v1`
   and answers 401 anywhere else.
4. Automatic admin audit: any non-GET under `/api/admin` that succeeds with an
   attached admin account writes an attributed audit event.
5. The admin default-deny gate under `/api/admin`, which refuses any admin
   response that succeeded without a `markAdminGate` mark. `/bootstrap` is its
   one exception.
6. CORS, granted only to `FRONTEND_URL` when the operator named one.
7. `requireModule(id)` for every prefix a module declares in `apiPrefixes`.
8. Per-route auth (`authedUser` / `isAdmin`) and capability checks
   (`guardCapability`, `mayAct`, `mayStillSee`, or `hasCapability` over
   `capabilityCtx`).
9. Handler, then repos and pool.

Express 5 forwards a rejected handler promise to the terminal error handler by
itself, on every verb; that handler answers JSON 500. The hand-rolled wrapper
around the registration verbs that Express 4 needed is gone.

**Boot sequence, in order** (`startServer()` in `server/index.ts`). Read it
top to bottom in that function; the stages below are the landmarks:

1. **Crash reporting, ahead of everything.** `wireErrorReporting` and
   `installCrashHandlers`. Deliberately first: a boot that dies on a failed
   migration is exactly the crash nobody was watching for.
2. **Migrations.** `applyPending` from `server/db/migrate.ts`, the same engine
   the CLI (`pnpm db:migrate`) and the test harness use. Ledger table
   `_migrations_applied`. No `DATABASE_URL` throws. A migration that FAILS no
   longer refuses to bind: `startMaintenanceServer` binds the port and serves
   one plain-language page saying what failed and that no data was lost,
   because the old shape gave a steward who cannot read a stack trace a bare
   502 after Railway gave up on three restarts.
3. **Token registry and the economy's vocabulary.** `loadTokenRegistry` reads
   the `tokens` table into memory. `ensureStayToken` and `ensureLibraryToken`
   create module tokens even while their modules are off, so rewards never
   race an enable click. `seedEconomy` upserts the archetypes and inserts the
   starting rules only when absent, then the registry reloads and
   `startEconomyEpoch` starts the clock before the first confirmed quest is
   measured against it.
4. **Ledger invariants refuse boot.** `checkLedgerInvariants` in
   `server/lib/ledger.ts`; any problem throws and the process does not serve.
   "A server that boots over a broken ledger normalizes the break."
5. **Stores, variables, identity and secrets.** `initStores()` fills every S12
   repo cache (roles, brand, season, settings and the rest) plus
   `loadVariables`, then mints or reads the permanent instance UUID
   (`ensureInstanceIdentity`), the document signing key (`ensureSigningKey`)
   and the write-only secrets store (`loadSecrets`). Anything that reads a
   game variable must sit AFTER this call or it silently reads the platform
   default; `assertVoiceSecret` is the guard that learned it.
6. **Scheduler jobs registered.** `registerJob` calls, and `startScheduler` is
   deliberately NOT called here: arming the tick is the last thing boot does,
   so a failure in a later stage can never leave a live scheduler on a dead
   server. A job registered and never listed is a job nobody remembers is
   running, so enumerate them rather than trusting a count in prose:

   ```bash
   grep -n 'registerJob(' server/index.ts server/lib/*.ts
   ```

   Each module-owned job checks `effectiveLifecycle` and sleeps while its
   module is off, so a village that runs three modules pays for three.
7. **Module framework.** `loadModuleSettings`, `loadExampleState`,
   `wireExampleCaches`, `assertModuleGraph` (loud demotion, one-seller-
   per-token assertion), `wireModuleAuth`, `initModuleUsage`, then the
   server-side `openStateCheck` closures are attached to every module that
   needs the pool.
8. **Economy firewalls re-proven, and they QUARANTINE rather than refuse.**
   `assertExchangeFirewalls`, `assertBadgeInvariants`,
   `assertLibraryInvariants` and `assertCapabilityHoldingInvariants` each run
   inside `quarantineOnInvariantFailure`, which turns that one module off and
   lets the village serve. They used to throw straight out of `startServer()`
   and take the forum, the map and the front door down over one bad listing
   row, on deployments where nobody can run SQL against production. What
   stays fatal is migrations and the ledger conservation check above: those
   are village-wide truths with no single module to quarantine.
   `repairTaintedListings` then auto-delists loudly (automated authority may
   narrow the market, never widen it), `assertSwapFirewalls` still THROWS on a
   problem and only warns on a stale legal card, and `reconcileSwapOrders`
   reaps swaps whose legs already tell the truth.
9. **Payment handlers.** `registerPaymentHandlers` for commerce, stays and
   exchange.
10. **Seeds.** The quest library seeds only into an *empty* table, then
    `ensureDataFiles`, `seedExamplesAtBoot` and the `runOnce` data-migration
    chain.
11. **Routes serve.** Express app, the webhook seam, the middleware pipeline
    above, the route registrations in `server/index.ts` plus the
    `register(app, deps)` call for each `server/routes/*` module, the static
    SPA fallback, the terminal JSON error handler, `startScheduler`, then
    `server.listen` on `PORT || 3000` and `installShutdownHandlers` so a
    Railway SIGTERM drains instead of cutting a settle in half.

---

## 3. The subsystems

### 3.1 The ledger keystone — `server/lib/ledger.ts`

**What it is.** Every token movement is a transfer FROM one account TO
another, amount a strictly positive integer, in `token_ledger`.
`token_balances` is a cache. Two disciplines carried from regen-civics
(the file header names them): **recompute, never increment** (both touched
balances are rewritten from `SUM(transfers)` inside the posting
transaction), and **every write carries an idempotency key** (the UNIQUE
index is the dedupe; a replay returns `duplicate: true`, it never posts
twice).

**Accounts.** `mem:<userId>` (materialised on first touch), and system
accounts that must already exist — a typo'd system id is an error, not a new
account. Faucets may run negative and their negative balance IS
issued-to-date supply: `sys:gratitude-pool`, `sys:cycle-pool` (seeded by
`drizzle/0009_ledger_accounts_and_transfers.sql`), `sys:mint` (0011), `sys:library-mint` (0024). Deliberately
NOT faucets: `sys:treasury` (an ordinary vault — selling more than was
stocked *fails*, out of stock is never a mint), `sys:exit-settlement`
(0027), `sys:library-escrow/pool/sink` (0024). Conservation is therefore
checkable: per token, `SUM(balance)` over all accounts ≡ 0.

**`postTransfer`**. One leg, one transaction: lock accounts `FOR UPDATE`,
insert the transfer (UNIQUE key rejects replays), recompute both balances in
sorted order (deadlock avoidance), overdraft-check the sender. Non-faucet
accounts can only go negative when the caller sets `allowNegative` AND the
source is in `ALLOW_NEGATIVE_SOURCES`, a static exported set, extended only by
a reviewed one-line change and never at runtime. Read the set itself for its
current members; §5 invariant 10 is the rule it enforces.
`postTransferOn` is the same primitive on a caller's connection.

**`postTransferPair` + `PairGuard`**. Exactly two legs, one transaction, built
for swaps, where sequential `postTransfer` calls could debit without
crediting. Fixed at two legs on purpose: "a generic N-leg API is what makes a
router easy to build, and a router is an automated market maker wearing a
helper function." Rules enforced inside the primitive: `allowNegative` is
illegal in a pair (a swap may never create debt); the two keys must differ;
one sorted `FOR UPDATE` over the deduped account union (lock first, create
member accounts second, so the shared-lock upgrade deadlock is designed out);
a partial idempotency collision, one of two keys already present, *refuses*
instead of guessing; every non-faucet sender is overdraft-checked; deadlock
victims retry up to three times. The `PairGuard` is a veto closure that runs
*inside* the transaction after the locks, for limits living outside the ledger
such as per-cycle swap caps, so check-then-act races are impossible.

**Registry.** The `tokens` table is the registry; the in-memory map is a
boot-loaded cache filled by `loadTokenRegistry` and refreshed by
`registerToken` (table first, then reload: "the table is the truth").
`tokenDef()` returning undefined means "not a token" and callers must fail
loud: `validateLeg` refuses unknown slugs outright ("a typo that silently
became 'gratitude' would be a mint bug wearing a coercion costume") and
refuses to move any `governance: 'hypha'` token.

**Boot invariants** (`checkLedgerInvariants`), re-proven at every boot. The
doc comment above that function is the list and is the thing to read; at the
time of writing it holds six: hypha tokens have zero ledger rows; no orphan
token slugs; conservation ≡ 0 per token; cache agrees with recomputation; no
non-faucet account is negative without an `ALLOW_NEGATIVE_SOURCES` debit
explaining it; and no recognition, equity or voice token is marked
`transferable`, which shipped wrong in 0006 and sat unread for eighty-five
migrations. It also reports `uncredited` as a FINDING that is deliberately not
part of `ok`.

**Extending it.** New issuance = a new `source` string and an idempotency
key grammar (`ord:<id>:leg1`, `exit:<id>:sweep:<token>` are the house
patterns). Never add a balance column anywhere else; never touch
`token_balances` by hand — recompute. If a flow genuinely needs debt, that
is a reviewed edit to `ALLOW_NEGATIVE_SOURCES`, nothing less.

### 3.2 The module framework — `shared/modules.ts` + `server/lib/modules.ts`

**What it is.** ONE registry of everything the platform can be: `MODULES` in
`shared/modules.ts`. The core modules are listed for catalogue honesty, are
not disableable in v1, and are always served `public`; everything else is
optional. `node scripts/module-facts.mjs` prints how many of each there are,
so the count is not written down here. Per-module `<module>.enabled` game
variables from older design docs are void: enablement lives in
`module_settings` and nowhere else (the file header).

**Lifecycle.** `off | preview | members | public`, rank-ordered
(`LIFECYCLE_RANK`). Semantics, spelled out in the header of
`server/lib/modules.ts`: `off` → routes
404, zero nav, variables hidden; `preview` → admins only, and non-admins
get the *identical* 404 body so the catalogue of what a village is trying
never leaks; `members` → signed-in only (anon gets 401 so the client can
prompt login); `public` → everyone, per-route capability checks still apply.
**Absent row = OFF** — delta-only, so every fork inherits each new platform
module as off, and enabling is always a recorded admin act
(`module_events`).

**The gate.** `requireModule(id)` is mounted once per API
prefix declared in the registry's `apiPrefixes`. The Stripe settlement
webhook is NEVER mounted behind it — in-flight orders must settle even when
a module was just disabled.

**Demotion, not bricking.** `effectiveLifecycle` serves a module whose hard
dependency is off as OFF regardless of its stored row; `assertModuleGraph`
logs demotions at fatal volume, lists orphan ids, and *throws* only for the
one-selling-module-per-token violation. `quarantineModule` is the other way a
module reads OFF without an admin touching it: a failed boot invariant
quarantines that module alone (boot stage 8).

**Writes.** `setModuleLifecycle`: core refuses; enabling requires
every hard dep non-off (409 with `missing`); a `legalReview` module refuses
to leave off while a shared password is the only admin credential (403);
disabling refuses while dependents are non-off (409) or while
`openStateCheck` reports open economic state (409 with settle-first
guidance). `setModuleConfig` runs the module's `validateConfig` first. Both
append `module_events` rows.

**The preview-leak guard.** Module code emits public activity through
`moduleActivity`, which is a structural no-op below `members`: "a structural
no-op beats a review-enforced rule."

**Registry entry surface.** `ModuleDef` in `shared/modules.ts` is the type,
and `node scripts/module-facts.mjs` prints every field in declaration order
with which ones are required, so the list is not copied here. The parts worth
knowing before you read it: `requires` is hard and blocks both directions,
`recommends` only warns, `capabilities` names keys ADDED to the one gate and
never a second permission mechanism, `sellsToken` allows at most one selling
module per token and is boot-asserted, and `openStateCheck` is attached
server-side in `startServer()` for the modules that need the pool, which keeps
the shared file import-clean for the client bundle.

### 3.3 The ONE capability gate — `shared/capabilities.ts`

`ALL_CAPABILITIES` is the canonical value the badge validator and unlock
diffs iterate; keep the union and the array in lockstep.
`node scripts/module-facts.mjs` prints how many keys are in the gate, so the
count is not written down here. `capabilityDecision` is the one implementation
and it is pure and isomorphic; `hasCapability` is its yes-or-no projection and
never a second copy of the order. That order IS the policy (Gate E, shipped
S36, amended by 0098):

1. `isAdmin`, on a key the village does NOT hold → true. The operator can
   always act on the scaffolding they are responsible for, through a real role
   on the user record and never a parallel path.
2. `isAdmin`, on a key the village DOES hold: with an explicit break-glass
   → true, and the caller owes the village a record it can read
   (`reachedPastVillage` says so); without one, the admin short-circuit does
   not apply and the same admin is judged on steps 3 to 6 like anybody else.
3. `badgeDenies`, ON A DENIABLE KEY → false. A warning badge's deny beats
   role AND stage grants: "a warning that a role trivially overrides is not a
   warning". `DENIABLE` (0109, R65/R66) says which keys a deny may reach;
   `ballot.vote` and `member.vouch` are a member's own say in a decision,
   nothing takes one away, and the gate ignores a deny that names one.
4. `roleCapabilities` → true (appointments);
5. `badgeCapabilities` → true (earned/granted badges);
6. stage unlock (`STAGE_UNLOCKS`, deliberately only a handful of real
   gates) → true;
7. otherwise false.

On a village-held key a warning badge's deny therefore reaches an ADMIN too,
which is why the break-glass shipped in the same commit: a gate that can lock
an operator out of a live village must never exist without its escape hatch.

Server side, `capabilityCtx(user)` in `server/index.ts` builds the context
once per request; badge grants and denies are only queried while the badges
module is non-off, so off means the gate is byte-identical to its pre-badges
self. Modules extend the union; they never invent a second mechanism.

**A declared capability that no route enforces is not a capability.**
`quest.consent` was granted by the seeded steward-circle role and displayed
to members as authority they held, while both consent routes asked only
`isAdmin` — so every unit of recognition a village released came from
whoever held the founder password, which is the single-founder bottleneck
this whole system exists to prevent. Consent now asks
`mayAct(req, "quest.consent")`, the acting door described in §4 step 4, and
two things ride with that widening
because releasing value is not an ordinary action: **no self-consent** (for
admins too — consent mints from the faucet, grants stay credits and advances
stages, so witnessing your own work must be structurally impossible), and an
explicit `recordEvent` audit row for non-admin actors, since the `/api/admin`
audit middleware only attributes callers `adminActor()` populates.

The same shape applies to appointments: a non-admin holder of
`proposal.decide` may only seat someone into a role whose every capability
they already hold themselves. Without that, the no-self-appointment guard was
one hop from useless — register a second account (open, unverified), seat it
higher, have it seat you.

### 3.4 The five config planes

Each plane exists for a different kind of fact. Do not move facts between
planes.

1. **Identity — `shared/gameConfig.ts`.** Names, paths, the stage ladder,
   images. Code, "the white-label swap point". Not admin-editable; changing
   the stage ladder is a fork of the game, not a re-skin
   (`docs/FORK_RUNBOOK.md` "NOT overlayable").
2. **Brand overlay — the `brand` document.** Edited by the admin Setup
   Wizard, merged over gameConfig by `mergedConfig()` in `server/index.ts`:
   a blank field inherits the platform default,
   so a fork overrides only what differs. Served through `/api/game/config`
   and read by every email, page and the network handshake.
3. **Behaviour — `shared/gameVariables.ts` + `server/lib/variables.ts`.**
   Every tunable number/toggle/threshold as data, typed and bounded, edited
   from Admin without a deploy. **Delta-only**: only changed values are
   stored in `game_variables`; setting a value back to its default DELETES
   the override so the fork keeps inheriting future platform defaults
   (`setVariable`). Readers (`variable`, `numberVar`, `boolVar`, `stringVar`)
   are synchronous against the boot-loaded cache, and an unknown key throws:
   "a typo must not read as 0".

   **The registry is THE single source of truth for game mechanics**
   (Game Mechanics initiative, Rye 2026-07-31). Three additions carry that:

   - **Rings.** Every def resolves to a ring (`ringOf`): `open` (Ring 2 —
     community-governable ceiling, the domain of the coming Hypha proposal
     loop) or `founder` (Ring 1 — legal posture, infrastructure, privacy,
     abuse guards). Ring 0 — the constitution — is not in the registry at
     all: it is code-enforced law, published in plain language from
     `shared/constitution.ts`. Bounds (min/max) are Ring 0: governance moves
     a value within its bounds, never the bounds.
   - **Generated defs.** Per-stage mechanics (`progression.multiplier.<id>`,
     `progression.quests_for.<id>`, `progression.unlock.<capability>`) are
     GENERATED from `GAME_CONFIG.stages` and `STAGE_UNLOCKS` at module load,
     defaults equal to the previously-hardcoded config values — a fork that
     edits its ladder gets matching variables automatically, and an
     untouched village behaves identically. Duplicate keys throw at import.
   - **The amendment ledger** (`mechanics_changes`, drizzle/0042). Delta-only
     storage deletes history by design, so every change writes an
     append-only row — key, old, new (NULL = the platform default at the
     time), actor, source (`admin | governance | platform`), and a
     `proposal_ref` the Hypha loop will stamp with the on-chain proposal id.
     `recordMechanicsChange()` is the one writer. Public surface:
     `GET /api/game/mechanics` (constitution + every visible variable with
     ring/bounds/apply-timing) and `GET /api/game/mechanics/history`.

   Migrated INTO the registry under this doctrine: stage multipliers and
   quest thresholds (out of gameConfig behaviour-space), the STAGE_UNLOCKS
   table (as overridable choice variables threaded through
   `capabilityCtx.stageUnlockOverrides` — the gate's order of authority is
   untouched; only step 5's lookup is parameterized), the Work With Us
   acceptance award (out of the content document, one-shot runOnce), the
   stays/library daily caps, and the donation checkout ceiling.

   **Mechanics proposals** (`server/lib/mechanics.ts` + `mechanics_proposals`
   / `mechanics_proposal_backers`, drizzle/0043) are how the community moves
   Ring-2 dials: any member stages changes on the public page; who may OPEN a
   proposal is itself part of the game — the `mechanics.propose` capability
   through the one gate (stage rung tunable, role/badge grantable, badge-deny
   suspendable) composed with `governance.hypha_threshold` earned standing
   (admins bypass the bar, never a deny). Below the bar, members DRAFT and a
   qualified member's sponsorship opens it. A change-set is validated as a
   WHOLE at creation (open-ring only, bounds, no-ops, ≤12 keys, per-key
   governance cooldown) and never edited after — what is voted on is what was
   checked. Lifecycle: draft → open (in-game sensing, support threshold) →
   to_hypha (the canonical markdown document carries the `[gm:<id>]` marker
   and a machine-readable change-set block) → passed_claimed (the proposer's
   word) or **passed_verified** (the governance hub's signed callback) or
   **failed** → applied. Supports/sponsorships are keyed INSERT IGNOREs — no
   read-modify-write. Proposals are rate-limited per member per cycle
   (`governance.proposals_per_member_per_cycle`).

   **The bridge (game-amora side).** `server/lib/hypha-bridge.ts` is THE ONE
   HOME for action-bearing Hypha URLs (read-only deep links stay in
   shared/hypha.ts — regen-civics' never-hand-roll-a-hypha-URL rule,
   imported): the handoff endpoint returns a pre-filled create-agreement URL
   derived from `hypha.org_url` PLUS the canonical markdown, and the client
   always copies before it opens — prefill params are hints until a DHO's
   create page reads them; the `[gm:<id>]` marker in the TITLE is the
   contract. Outcomes come home through
   `POST /api/webhooks/mechanics-governance`: the ReGen hub runs ONE Alchemy
   listener on Base for all forks and relays ProposalExecuted outcomes with
   the shared `governance_hub_secret` (fail closed, inert-200 discard,
   idempotent on replays — the Riverside posture). A verified pass runs THE
   ONE APPLY (`applyMechanicsProposal`, shared by the admin button, the
   webhook and the cycle close): it revalidates against the CURRENT registry
   and writes through `setVariable`; instant sets apply immediately; a set
   touching ANY cycle-timed dial holds — atomically, the whole set — for the
   next REAL cycle close, so the closing cycle settles under the old rules
   and the next opens under the new. `governance.auto_apply_enabled`
   (founder-held) is the emergency brake: off = verified passes hold for a
   human. Verification metadata (verified_at, tx_hash) lives on the proposal
   (drizzle/0044); the amendment ledger's proposal_ref carries `gm:<id>` plus
   the Hypha reference.
4. **Module structural config — `module_settings.config`.** Validated JSON
   per module (`validateConfig`), seeded from `defaultConfig` — forum
   categories, tools categories, the exchange's `tradingEnabled` +
   version-stamped `legalAck`.
5. **`app_config` documents + integration secrets.** Singleton JSON
   documents in `app_config`: exit policy, the `runOnce` data-migrations
   ledger, email config and the like go through `dbDocument` repos, while
   instance-identity and launch-state are raw INSERT/SELECT rows written
   directly by `server/lib/identity.ts` and `server/lib/launch.ts`;
   and `server/lib/secrets.ts` (S63) for third-party keys. `SECRET_KEYS` is
   the list: a fixed base set (Stripe's two, Resend, the assistant, Riverside,
   the governance hub, Basescan) plus a slot for every `vendor.secretKeys`
   entry a `connected` module library listing declares, so the set grows with
   the catalogue. The one rule: **a secret is write-only.** Reads
   return `{configured, last4, source, setBy, setAt}` and never the value;
   the value leaves the module only toward the service it belongs to.
   Resolution is admin-typed first, env fallback second (the env names
   `FORK_RUNBOOK.md` has always documented). Values are sealed at rest with
   AES-256-GCM under `VILLAGE_SECRETS_KEY`, through `server/lib/sealedBox.ts`,
   the same primitive `server/lib/memberSecrets.ts` uses. Masked-read without
   encryption was an explicit decision on 2026-07-27 whose stated revisit
   condition was backups leaving the trust boundary; `db-backup.yml` uploads a
   full mysqldump as a GitHub Actions artifact, and the repository was public
   while those artifacts were produced, so it was revisited on 2026-08-30. With no key a write refuses rather than falling back to
   plaintext, reads accept both shapes for one release, and the conversion runs
   in `loadSecrets` at boot because the database cannot do AES and is never
   handed the key.

The store substrate under planes 2 and 5 is `server/repos/store-db.ts`:
MySQL-authoritative, memory-cached, write-through; reads synchronous, writes
async and *renamed* (`replaceAll`, `put`) so the compiler forces every write
site through the conversion.

### 3.5 The event spine — `server/lib/events.ts`

`recordEvent()` is the ONE way anything lands in the village's history. The
public Pulse and the admin audit trail are the same `health_events` table
split by `audience`. Every row can carry WHO (`actorUserId`) and WHAT
(`entityType`/`entityRef`). Recording never throws into the caller — "an
event is a trace of a mutation that already happened" (the file header of
`server/lib/events.ts`). Admin mutations under `/api/admin` are audited
automatically by the middleware named in the request path above; richer
endpoints still write their own rows.
Module code must emit public activity via `moduleActivity`, never
`recordEvent` directly, or preview leaks.

### 3.6 The notification spine — `server/lib/notify.ts`

Fresh implementation of regen-civics' *rules* without its warts (the file
header lists them): `dedupe_key` is NOT NULL with a real UNIQUE index (one stable
key per event+recipient; a retried producer inserts exactly once, forever);
delivery is an explicit dispatch step after a fresh insert, never a side
effect; preferences are one typed, junk-tolerant model
(`resolveNotifyPrefs`). The email cap is per member per rolling 24 h, read
from the `notify.daily_email_cap` game variable with the `DAILY_EMAIL_CAP`
constant as its fallback, so a village that tuned the dial is not described by
the constant. Over the cap the in-app row still exists and only the email
drops. Cadence per type, and read the switch in `emailCadenceFor` rather than
this list, which has drifted twice:
quests/roles/mentions/replies immediate by preference, gratitude/stage/
`feedback` daily, `thread_activity` in-app only, `payments_alert`,
`restorative_intake`, `moderation` and `submission_status` always immediate,
unknown types in-app only. `quest_submitted` rides the member's quest
preference, because work arriving for consent is the same conversation as
consent read from the steward's side. The daily digest job batches unread, never-emailed rows from
the last 3 days. `emailed_at` is stamped even when the provider quietly
declined — a late retry email surprises more than a missed one. Tombstones
and claim-pending accounts (no `passwordHash`) get no email.

### 3.7 The scheduler — `server/lib/scheduler.ts`

ONE mechanism, deliberately (regen-civics ran two, unlocked). A registry in
code (`registerJob`), a ledger in the database (`scheduled_jobs`), one claim
rule: every 5-minute tick, `UPDATE scheduled_jobs SET last_run_at = NOW()
WHERE job = ? AND (last_run_at IS NULL OR last_run_at <= ?)` —
`affectedRows` says who won. Restart-safe, multi-process-safe, runs when
DUE not N ms after boot. **What it will never do, written down so nobody
"helpfully" adds it**, in the file header: it does NOT close gratitude cycles
(settlement releases value and is an explicit admin act, `POST
/api/admin/cycles/close`), and it does NOT roll seasons (compute-on-read by
design).

The registry of jobs is the `registerJob` calls themselves, and it has grown
faster than any list in this file could. Enumerate it:

```bash
grep -n 'registerJob(' server/index.ts server/lib/*.ts
```

Each call carries its own interval as its second argument. The shapes worth
knowing: `stay-nightly` is idempotent by keyed ledger legs, `exchange-reconcile`
is a reaper and never a settler, and every module-owned job early-returns while
its module reads off, so a village that runs three modules pays for three.

### 3.8 The payments trio — `server/lib/payments.ts`

Built once (S32), consumed by every fiat module. Three responsibilities:

1. **Checkout.** Stripe Checkout Sessions via the REST API — no SDK. Every
   session is stamped `metadata {module, orderId}`; the webhook dispatches
   on nothing else. Money math: **rounding favours the treasury** —
   `ceilMinor` what the member pays, `floorTokens` what the member receives;
   the property test asserts no round trip extracts value.
2. **Settlement + reversal.** ONE raw-body webhook
   (`POST /api/webhooks/stripe`, mounted before `express.json()`).
   Signature verification is a manual HMAC of Stripe's v1 scheme over the RAW
   body with a 5-minute replay tolerance and `timingSafeEqual`. **Fail
   closed:** a missing webhook secret is a misconfiguration and not
   permission, so unsigned events are rejected 400 and admins alerted. The
   route also carries its own in-memory per-IP ceiling ahead of every other
   guard, because each rejected request used to cost three database writes.
   Event-level dedupe rides the UNIQUE `stripe_event_id` in `payments_log`; a
   failed dispatch *releases* the dedupe claim and answers 500 so Stripe
   retries, and ledger keys make the retries safe. Disputes and refunds are
   **mechanical**: the module's reversal handler claws back exactly what was
   granted (negative balances are the truthful state), the buyer is
   auto-suspended on disputes, though not for refunds the village itself
   issued (the `villageInitiated` check), and admins are notified.
   Never manual reconstruction.
3. **Limits.** `assertCanPurchase` is one cross-module helper over
   `fiat_charges`: suspension check, per-order / 30-day / annual caps from
   the three `payments.purchase_limit_*` variables. "Limits that only see
   one module are theater." (Note: here a 0 variable disables that cap;
   the fail-closed-zero rule belongs to *swap* caps — §3.10.)

Modules plug in via `registerPaymentHandlers(moduleId, {settle, reversal,
renew})`; stays, exchange and commerce register at boot. Settle handlers
throw when the order does not exist ("refusing to settle into thin air") and
when the treasury is under-stocked — out of stock surfaces via webhook
retries, never a mint.

#### What a settle handler has to get right

Six rules, each of which was learned by getting it wrong. Any new fiat module
inherits all six.

1. **The period key comes from Stripe, never from a counter.** A failed
   dispatch releases the dedupe claim, so attempt 2 must compute the SAME key
   as attempt 1 or it will look like a fresh charge and pay out twice.
   Precedence is invoice id → payment intent → event id. Note *where* the
   invoice id lives: on a checkout session it is `obj.invoice`, but on an
   `invoice.paid` event the object IS the invoice, so it is `obj.id`.
2. **Completed is not paid.** `checkout.session.completed` arrives with
   `payment_status: "unpaid"` for SEPA, ACH and Boleto, sometimes days before
   the money moves. Deliver on `paid`/`no_payment_required`;
   `checkout.session.async_payment_succeeded` brings the confirmation.
3. **Money in, then goods, then the mark.** Record the charge, attempt
   delivery, and only then record the period as settled. Marking first makes
   a failed delivery permanent; a retry would skip it and the member never
   receives what they paid for.
4. **Mark it in one statement.** `JSON_ARRAY_APPEND … WHERE NOT
   JSON_CONTAINS` under the row lock. Reading a JSON array in one query and
   writing it back in another loses keys when two deliveries interleave, and
   the counter beside it drifts out of agreement with the list.
5. **Reversal claws back only what was delivered.** Because rule 3 records
   the money before the goods, a charge row can exist with nothing granted
   behind it. Clawing back anyway drives the member negative for tokens they
   never held and hands the treasury stock nobody issued — and no boot
   invariant catches it, since conservation still nets to zero and
   `payment_reversal` is on the allow-negative list.
6. **A renewal re-asks checkout's questions.** The renew handler runs the
   same body months later: re-check that the product is active, the token
   still legally sellable, the buyer not suspended. A refusal banks the money
   and withholds the goods with a loud admin alert — it must NOT throw, or
   Stripe retries a decision forever.

A partial `charge.refunded` is not a reversal: compare `amount_refunded` to
`amount` and treat anything less than the whole as money moving, not a
purchase unwinding.

#### Claim versus completion

`payments_log.stripe_event_id` is UNIQUE and the row is written *before* the
work, so a replay is a no-op. But a claim is not a completion: if the handler
throws the claim is deleted and Stripe retries, while if the **process dies**
nothing deletes it and the retry is answered "duplicate" for work that never
happened. `handled_at` (0038) separates the two — an unstamped claim past
`CLAIM_GRACE_MINUTES` is abandoned and the next delivery is allowed through.
The retention sweep never deletes an unstamped row, at any age.

### 3.9 Data lifecycle — retention, export, anonymisation, exit

- **Retention** (`runRetentionSweep` in `server/index.ts`): daily job
  driven entirely by variables — `retention.submissions_days`,
  `map.contact_retention_days` (contact bodies), and
  `retention.notifications_days` (read rows only). 0 disables a sweep.
- **Export** (`GET /api/profile/export`): everything the village
  holds on the member — profile minus secrets, stage, claims, gratitude
  both directions, full signed ledger, balances, stage events, submissions,
  notifications, preferences — as a downloadable JSON (Law 8968 posture).
- **Anonymisation = deletion** (`anonymizeMember` in
  `server/lib/erasure.ts`). Value rows are
  NEVER deleted — conservation must keep holding — so the member row
  becomes a tombstone (name/email/handle scrubbed, password removed,
  `tokenVersion` bumped so every session dies) and every denormalised trace
  is scrubbed: gratitude names, claim names, ledger descriptions (keyed by
  structured refs, never string matching), submission PII keys, tool
  clicks, role seats. PUBLIC pulse lines naming them are deleted; ADMIN
  audit rows are kept as the legal record.
  **ORG SEATINGS TOO** (`releaseSeatingsForUser`), which they did not for
  as long as 0049 has existed: "role seats" above means `role_holders`, the
  permission plane, and the org chart is the other thing called role
  (§3.15). A departed member kept a live seating under their real user id
  and `/api/org` republished it at the `map.viewPeople` tier. Seatings END
  rather than delete, the way `endSeating` does it, and `display_name` and
  `note` go from every row live and ended: `claimSeating` keeps the name a
  seating was documented under, so the tombstone on the users row does not
  reach it. A **documented** holder has no account to delete and nothing
  joins their name to a user row, so their only door is an admin act,
  `POST /api/admin/org/seatings/:id/forget`, which ends and de-names every
  seating sharing that `holder_key` and rewrites the key, because
  `documentedKey` derives it from the name and a slug is a name with
  hyphens.
- **Member exit** (`server/lib/exit.ts`, S52/F12): `openStateCheck`
  semantics applied to a person. ENUMERATE every domain's open state
  (loans, stays, orders, debts block; balances, roles, warnings inform);
  SETTLE through each domain's own terminals — exit adds exactly ONE move
  of its own, sweeping positive balances to `sys:exit-settlement`,
  idempotent per `(exit, token)`; RESOLVE refuses until clean, then the
  anonymise tombstone runs. Restorative content flows only to its
  recipients; the `exits` row carries a pointer and a status, never the
  content.

### 3.10 The exchange and the swap firewalls — `server/lib/exchange.ts`

Buy-only shop by default: stock moves `sys:mint → sys:treasury` (under the
same per-cycle mint cap as hand-mints), sales `sys:treasury → buyer`; the
treasury is not a faucet, so over-selling fails the settlement. The
firewalls are enforced at write time AND re-proven at boot so a hand-edited
row can never outlive a deploy (`tradingProblem`): recognition
never trades; hypha tokens never trade; a token another module sells cannot
be listed; `NEVER_LISTED` statically bans `library-credit` (backed by
shelves). Swapping adds the structural faucet test
(`faucetIssuedTokens`): the rule is about **destination, not
source names** — `faucet → sys:treasury` is stocking a shop; `faucet →
anything else` is issuance, and an issued token is permanently unswappable
at every privilege level ("a source-name allowlist rots"). Swap caps are
**fail-closed: 0 means ZERO, never unlimited** (`ExchangeSettings`, and the
comment on `maxSwapOutPerCycle` says so). Trading itself is a per-deployment
opt-in (`tradingEnabled` in module config) behind a version-stamped legal
card, `TRADING_CARD_VERSION` in `server/index.ts`, and an acceptance of any
other card version is refused. At boot, `assertSwapFirewalls` treats trading
enabled under shared-password posture as a PROBLEM and throws, so the village
refuses to serve; a stale card version is only a WARNING, which closes
swapping while the rest of the village keeps serving, because a version bump
is a docs change that must not brick every fork running trading. Quote math is
receive-driven, ceil-on-pay, BigInt throughout via `BigInt()` calls and never
literals (`quoteSwap`).

### 3.11 Instance identity — `server/lib/identity.ts` (S62)

Everything cross-instance needs one stable answer to "which village said
that?". A URL is not it and a name is not it; the identity is a UUID minted
once at first boot (`INSERT IGNORE` into `app_config`, re-read; idempotent
under concurrent boots) and never regenerated. **Deliberately not
configurable**: an admin-editable id lets deployments impersonate one
another, an env var mints a new identity whenever an operator forgets to
pin it (the file header). `PLATFORM_VERSION`, in this file, is the contract
semver, distinct from each fork's `BUILD_MARKER`: peers and the hub compare
versions, humans read markers. Bump MINOR for additive endpoint/field
changes, MAJOR for anything a peer could break on. The constant carries a
comment saying what its current bump was for; read it there rather than
copying the number anywhere.

The signing keypair is minted beside the id, by `ensureSigningKey`, for the
same reason: everything cross-instance hangs off it, so it exists before any
route serves. The boot log says whether the private half is sealed, because a
line reading only "kid abc123" describes three very different villages.

### 3.12 Launch requirements — `shared/launchRequirements.ts` + `server/lib/launch.ts` (S62)

"What's left before launch?" as DATA. The registry declares WHAT must be
true (id, group, founder-facing copy, `severity`
blocking/recommended/optional, `checkKey`, `fixAt`, optional
`appliesWhenModule` and `runbookAnchor`); the server observes WHETHER it is,
via check closures injected from `server/index.ts` (`launchDeps`; they need
the boot-loaded caches, and importing them into `server/lib/launch.ts` would
be a cycle). Three consumers render it, the Journey to Launch page, the admin
banner and Maia's launch-guide mode, and none may invent an item. `manual:*`
checks (DNS, backup drill) are confirmed by a named admin, with who and when
recorded. A registry entry with no wired resolver fails VISIBLY on the page as
a platform bug, with the state `missing`, instead of silently dropping.

**Launching is a vote now, not a founder's press (R74).** The button opens the
village's first ballot; `launchVoteBlocked` is what the checklist gates, and
it gates whether the question may be PUT, never what the answer is. The flag
is written by that ballot carrying, through `recordLaunchCarried`, which uses
an INSERT IGNORE plus a guarded UPDATE rather than the read-edit-write every
other writer in that file uses, so an admin ticking a manual confirmation in
the same moment cannot lose the launch. `launchedAt` is read by the admin
banner, by the Journey page, and by `server/lib/villageMoon.ts` for the moon
counter, which goes through the exported `launchedAtOf` rather than growing a
second query. The separate fact that token issuance is open lives in
`server/lib/gameStart.ts`. Module-gated requirements appear and withdraw with
the module's lifecycle.

### 3.13 The feedback spine — `server/lib/feedback.ts` (S66)

Bugs and ideas from `/feedback` are captured locally ALWAYS
(`feedback_items`); a copy relays to the platform hub every 15 minutes only
while the `platform.feedback_relay` variable stays on. The relay honours
two people at once: the village admin always keeps the full local queue,
and the hub sees CONTENT, never people — the payload carries instance
identity (id, version, build, public name) and item text; `submitted_by`
never leaves the village. Queue-and-forget mechanics: batches of 50 oldest
first, `relayed_at` set only on a 2xx, 10-second timeout, any failure is a
log line and a natural retry — "the hub is a listener, not a dependency."
The 40-hex `fingerprint` (sha256 prefix over kind + normalised text) lets
the hub collapse forty villages hitting one crash into one counted issue.
Hub URL: the `FEEDBACK_HUB_URL` environment variable, **and there is no
default**. The platform's own hub used to be the fallback, so a fork that
configured nothing posted its members' bug reports to an organisation it had
never heard of, every fifteen minutes, from the first submission; the dial
that turns the relay on ships ON. With the variable unset, rows stay in the
local queue, admins still see every one, and the form stops promising a
sharing that is not happening. The hosted deployment must set it. The hub-side
obligations (durable-store-then-2xx, idempotent on
`(instanceId, localId)`, treat `name` as untrusted) live in
`docs/FEEDBACK_HUB_CONTRACT.md`.

### 3.14 The white-label discipline

- **The rule** (invariant 2.1 #2): identity in `shared/gameConfig.ts`,
  behaviour in `shared/gameVariables.ts`, per-deployment data in DB rows
  and seeds. A fork inherits the platform by pulling; a welded-in village
  name travels with it.
- **The guard** — `scripts/check-brand-refs.mjs`, run in CI. Three zones:
  **hard-clean** (`server/lib/**`, `shared/**` except the declared identity
  home, and every file not in the baseline — any hit fails), **declared
  homes** (gameConfig, seeds, docs, markdown — brand belongs there), and
  the **ratchet** (`server/index.ts`, `client/`, `drizzle/`, test fixtures
  — counts may only ever DECREASE against the committed baseline;
  `--update-baseline` after removals). The guard reads CODE, not
  commentary: provenance comments are counted and reported, never failed;
  genuine false positives carry an inline `brand-ok: <reason>`. Forks
  extend the `BANNED` list with their own terms.
- **The overlay.** The Setup Wizard ("Make This Yours") writes the brand
  document; `mergedConfig()` overlays it on gameConfig; blank inherits.
  Wizard order and the not-overlayable list are in `FORK_RUNBOOK.md`.
- **The handshake**, `GET /api/platform/info` in `server/index.ts`:
  public, unauthenticated; name/tagline
  /location from the merged overlay (never a literal), `instanceId`,
  `version`, `build`, the served module list, and whether Hypha is
  configured. A future village directory reads it; the fork smoke test
  reads it to prove no code path hardcodes a brand.
- **The runbook** — `docs/FORK_RUNBOOK.md` is a living document: every
  session that adds an env var, seed, or provisioning step appends one
  line. Env table, token naming (Gate D), backups (restore-verified daily
  dump), `enable-all-modules.mjs`, `smoke-all-modules.mjs` (which prints its
  own check count on every run), and the trading caution table live there.
- **The Hypha boundary** — `shared/hypha.ts`: one root variable
  (`hypha.org_url`), four named deep links derived by convention, each
  overridable; blank root hides every Hypha surface so a dead governance
  button is impossible. The platform reads, displays and deep-links; it
  never posts, mints, moves or prices anything Hypha governs.

### 3.15 The org chart — `server/lib/orgChart.ts` (0049)

**"Role" means two unrelated things and they share nothing but the word.**
Get this wrong and you will edit the capability gate while believing you are
editing an org chart.

| | `roles` + `role_holders` | `org_roles` + `org_role_assignments` |
|---|---|---|
| Answers | may this account press this button | what work exists, who holds it |
| Payload | `capabilities[]` feeding the ONE gate | aim, domain, accountabilities, seats |
| Rows a fork is born with | `founders-circle`, `steward-circle`, `treasury`, `practitioners` | the village's own seats |
| Edited at | Admin, Game Roles | Admin, Org Chart |

Nothing in `orgChart.ts` reads or writes `roles`, and no seat grants anyone a
capability. The bridge that would let holding a seat grant a permission group
is deliberately **not built**; when it is, it touches the gate and gets its own
review.

Three properties worth keeping:

- **Vacancy is derived** (`seatState`), never a column. The content cards this
  replaced shipped two seats marked "filled" with nobody named in them.
  `statusOverride` exists for when a village knows better, and it carries an
  expiry so it lapses back instead of outliving the moment somebody meant it.
- **A holder is an account OR a documented name.** `holder_kind='documented'`
  is how a real person occupies a real seat before they have a login, and how
  an external advisor or a past holder stays representable. A documented holder
  cannot be reached by the contact relay, and the map says so rather than
  offering a button that cannot deliver.
- **`active_holder_key`** is a STORED generated column (`holder_key` while
  live, NULL once ended) under `UNIQUE(org_role_id, active_holder_key)`. It
  uses MySQL's NULL exemption on purpose: one live seating per person per seat,
  unlimited ended ones, so somebody can hold a seat, leave, and hold it again
  years later without colliding with their own history.

Not a `dbCollection`, on purpose: `replaceAll` writes only spec'd columns, and
these are history tables.

**Both tables ARE registered with the standing-examples machinery, and 0049's
own header says they are not.** That header was true when it was written and
has been false since: `examples.ts` lists
`progression: ["org_role_assignments", "org_roles", "roles"]` and seeds both
with `is_example = 1`. The file is not edited to fix it, because a part-applied
migration resumes at its recorded statement offset instead of replaying DDL, so
this line is the correction. So every read over these tables has to answer the
example question. `unclaimedSeatingsFor` and `claimSeating` did not, and a
member whose name matched a documented demo holder could claim the demo seat
and become its real holder; both filter `is_example` now and the claim route
answers `EXAMPLE_REFUSAL_BODY`.

**And progression's example block does not currently seed at all.**
`hasRealContent` reads every table in `EXAMPLE_TABLES`, `roles` is one of them,
and `ensureDataFiles()` fills `roles` with the four starter permission groups
one line before `seedExamplesAtBoot()` runs. So the module reads as already
having real content on the first boot of every fork, and the `orgRoles` block
added to the seed for the empty map state has never appeared on one. Recorded,
not changed: making it seed would put demo seats on every fork's map, which is
a product decision and not a correction. The guard still has to hold, because
the dev seeder forces a seed and a fork that empties `roles` gets them.

**The recruitment pack.** `authority`, `first_year_outcomes`,
`first_90_day_outcomes`, `location_expectations`, `compensation_reality` and
`evidence_required` are six columns 0049 created and `WRITABLE` has always
accepted, while `ROLE_COLS` selected none of them: an admin could write a seat's
pay reality through the API and never see it again. They are read back now and
they are ADMIN ONLY on `/api/org`. They are not structure. A column called
`compensation_reality` sitting unread beside a public export is a trap for the
next author, and the fix for a trap is to make the tier explicit rather than to
leave the column invisible.

**Terms end, and nothing is revoked when they do.** `isLapsed` derives it on
every read from `min(term_ends_at, the season boundary)` against the seating's
own `season_id`, so a season turn writes nothing and the state cannot drift
from the calendar. A lapsed holding is still a holding: the person is still
acting, and a seat going dark on a Tuesday for reasons nobody chose is worse
than one saying out loud that it is overdue. `seatState` needed a fifth value
for this, `expired`, because a seat whose holders have all lapsed is not
`filled` and calling it `open` would erase people still doing the work.

A seat can opt out on its own card (`expires_each_season = false`, for a
treasurer or an entity steward), and a term written on ONE seating outranks the
village-wide cadence even when that cadence is `never`: somebody wrote a date
down, and a global setting does not get to quietly overrule a commitment made
about one seat.

Surfaced twice, to two audiences. The Org Chart admin tab lists overdue
mandates first, and the `term-watch` job tells the HOLDER, who is the one who
can say whether they want to carry on. That job fires **once per assignment per
event** (`term-soon:` and `term-ended:` keys): `dedupe_key` is globally unique,
so a key carrying a week bucket would re-fire forever, and a mandate nobody has
acted on is a governance problem that a weekly ping does not solve.

**The fractal.** `circles.grown_from_org_role_id` records which seat a circle
grew out of. A project starts with one seat covering a whole domain; as it
grows the seat becomes a circle and its accountabilities fan out into new seats
beneath it. The seat row keeps its identity, so its history and past holders
stay continuous across the transition. This is how one model covers a
four-person project and a four-hundred-person one.

### 3.16 Season shapes — `server/lib/seasonPatterns.ts` (0050)

A season carries a **pattern**: which circles, seats, badges and quests are
live while it runs. Membership only, never a copy, so one seat can be in the
festival and the building season at once with unbroken history.

**The resolution rule, and why this is safe to ship to villages that never
asked for it:**

> A row with NO pattern memberships at all is permanent and always live.

"Not in this pattern" and "in no pattern" must never collapse into the same
branch. `shared/seasonResolution.test.ts` exists to protect exactly that.

**The roll writes lifecycle columns rather than adding a filter dimension.**
`circles.status`, `quests.status` and `org_roles.active` are already respected
by every existing query; teaching ~40 hand-written reads a second question is
how `is_example` needed three adversarial passes and still misses sites. The
roll is a HUMAN act with a dry run (invariant 14), and it refuses whole while
anything is unsettled, the same settle-first rule that governs deleting a quest
with claims in flight. Every change lands in `season_roll_log`.

**Badges declare their scope at creation.** `permanent` powers never lapse;
`seasonal` powers sleep between their seasons while the award row, the profile
history and `badges.active` are untouched. This costs one clause in
`badgeGrantsFor`, which is the single seam every badge-granted capability flows
through. Two rules are enforced, not assumed: **denies never sleep**, and a
`warning` badge may not be seasonal, because a sanction that lapses at a season
turn is not a sanction. `badges.multiplier` scales a consent payout, is capped
at 3 on both the badge and the stack, and may not ride a `self` or `hypha`
badge, which are self-claimable and gate nothing by design.

**A season's end date is optional.** A founding season runs until somebody
starts the next one; the latest started-and-unended season is the current one,
and `daysLeft` is null rather than 0, which would read as "ends today".

The **retrospective** (`server/lib/seasonRetrospective.ts`) reads a season that
has run: what the pattern declared against what was used, each observation
carrying the edit it implies. It writes nothing, publishes no composite score
(a village optimises whatever number it is shown), and a season too quiet to
read says so instead of inventing signal. It reads concentration **per person**,
never per seat, because events carry an actor and not a seat: attributing them
to seats would make anyone holding three seats look equally overloaded in all
three.

**The per-node journal** is a READ over the event spine, not a second table
(invariant 15). `health_events` already carried who, what, when and which
entity; 0051 adds the `(entity_type, entity_ref, at)` index that lets you ask
for one node's history without scanning the table every module appends to.

Structural writes record a described change rather than a verb:
`describeOrgChange` diffs before against after, so the line reads "renamed:
Gate Steward -> Gatekeeper" instead of "PUT /api/admin/org/roles/gate", which
is all the generic admin audit can say. Prose fields report as "domain
rewritten" and accountabilities as a count, because a journal entry carrying
two paragraphs is one nobody reads.

**Role hoarding** (`structuralLoad`, `orgChart.ts`) is the third read over the
same rows, and the only one that answers "if this person stops, what stops with
them". The map reads VACANCY, the retrospective reads ACTIVITY, and a village
can pass both while resting entirely on one person: a sole-held seat whose
holder was busy all season looks like a seat that works.

The finding is `soleHeld`, seats with no second holder. Seats-held alone is
context and not a signal (a four-person village with twenty seats gives
everybody five, which describes being early), and `soleHeldCritical` separates
the seats the village already marked high, because sole-holding the one
critical seat is a different risk from sole-holding three ordinary ones.

Two properties that are load-bearing. A **lapsed** holding still counts: nothing
is revoked at a season turn, so dropping lapsed holders would report a village
as less dependent on someone exactly when their mandate ran out. And one human
under two holder keys (named on a card, seated as a member) is **flagged, never
merged** — merging on a name asserts an identity nobody confirmed, and that is
what the seat-claim flow exists to do with a human in the loop. The split
understates load, so the flag says which direction the number is wrong in.

On `/api/health/summary` the SHAPE is public and the PEOPLE ride behind
`map.viewPeople`, the tier `/api/roles` and `/api/org` already apply. That page
ends with "no leaderboards, no ranks", and a list of members sorted by seats
held is a rank; a count of seats with no second holder is a fact about the
village that names nobody.

### 3.17 The village that publishes itself — `server/lib/villageExport.ts`

Three unauthenticated documents at predictable URLs: `/.well-known/village.json`
(discovery), `/api/public/org.json` (the org chart as data), and a Markdown
mirror at `/org/index.md`, `/org/circles/<id>.md`, `/org/roles/<id>.md`. Peerdom's
OKF export is the idea, and it pays off with ONE village: a founder points an
agent at a URL and gets the whole organisation with no integration.

**The privacy rule has no exceptions: no names.** Not full ones, not first
ones, not documented holders' display names, not user ids, not `focus` strings
or holder notes. `/api/org` can tier those behind `map.viewPeople` because it
has a session to check; these documents have none by construction, and a
fetched document can be cached, relayed, indexed and handed to an agent
forever. The test that enforces this serialises the whole export plus every
Markdown page and asserts no private string survives anywhere in the bytes,
because a field-by-field assertion only catches the fields somebody remembered.

**Live only while `effectiveLifecycle("map") === "public"` AND
`map.public_structure` is on.** That pair is already the village's answer to
"may a stranger see our structure", given on the map page; publishing the same
structure at a second URL when the village said no there would be a bypass
wearing a different path. `members` is deliberately not enough: that lifecycle
means signed-in members only. No new admin switch, because a second knob
meaning almost the same thing is how two settings end up disagreeing.

**Discovery answers unconditionally and degrades by shrinking.** When the org
export is dark, `supports` is `[]` and the `org` links are absent, rather than
advertising `org/1` and sending every reader to a 404, which would teach them
this village is broken instead of private. Consumers branch on `supports`,
never on version ordering: a fork that turned a module off is not older, it is
differently shaped. `/api/platform/info` keeps answering forever as the v0
fallback, because a peer that learned to read it must never break when a newer
document appears.

**Signed with ed25519, minted at first boot** by the same INSERT IGNORE
read-or-mint that mints `instanceId`. Built before anybody consumes these
documents on purpose: it is the one piece that is painful to retrofit, since
once peers trust unsigned payloads, adding signatures later either breaks them
or is ignored. `canonicalJson` sorts keys recursively so a verifier
reconstructing the document from parsed JSON gets the same bytes that were
signed; arrays keep their order because their order is meaning. `verifyDocument`
is exported so the round trip is testable and a peer has a reference, since a
signature nobody can check is ceremony.

**It signs for INTEGRITY, and identity is bound one layer up.** The public key
travels inside the document it signs, so `verifyDocument` against a
self-published key authenticates the bytes against whoever answered, never the
answerer against an identity: an impostor mints its own keypair, publishes its
own `publicKey` block, signs a document claiming somebody else's `instanceId`,
and verification passes. What decides the question is which key the caller
verifies against, and that is `network.ts` (§3.20), not this file.

Four defects a recon pass caught in the first draft, each now a test:

- **Example seatings inflated real counts.** `org_role_assignments` carries
  `is_example` and `ASSIGN_COLS` was not selecting it, so every read in the
  codebase handed back demo seatings nothing could tell from real ones. The
  `progression` module is CORE, so a fresh fork has them before a human enables
  anything.
- **A seat could argue with itself.** `land-steward` ships with a 60-day
  `statusOverride` of "filled" and no holder recorded, which published as
  `{seats: 1, filled: 0, state: "filled"}` and read "Held. 0 of 1 held." The
  override survives (it exists for when a village knows better than the count)
  and now carries `stateSource: "declared"`, and the Markdown states the two as
  the separate facts they are.
- **Dangling cross-references.** `circleId` was guarded from the start;
  `parentCircleId` and `grownFromOrgRoleId` were not, so an agent following
  links walked into a 404.
- **The refusals carried no CORS headers**, so a browser could not tell "this
  village keeps its structure private" from "this village is broken". The
  refusal is part of the protocol, so it answers with the same headers as the
  answer.
- **`updatedAt` was the fetch timestamp**, so every response was a different
  document with a different signature and nothing could tell a real change from
  a re-fetch. It is now the max of `org_roles.updated_at` and the seating
  timestamps, and the document is signed AT that time, so two fetches of an
  unchanged chart are byte-identical.
- **`policy.acceptsPeers` used `!== "off"`** while the `modules` list two lines
  above correctly floored at `members`, so a village that had only PREVIEWED
  the network module announced that it accepts peers.
- **A village's own punctuation broke the Markdown.** A seat named
  "Water (springs)" closed every link that mentioned it, and an aim beginning
  `#` opened a heading mid-page. Link labels and prose are escaped; the words
  are untouched.

**One pre-existing leak had to close with it.** `/api/content/:section` is
unauthenticated with no module gate, and the `roles` section is the CARD-shaped
org chart 0049 replaced. Its cards kept `holders` and `holderNote`, so that
endpoint was answering anonymous callers with real names and notes like "Away
and inactive" (verified live in production, 2026-08-03) while `/api/org` tiered
the same fields behind `map.viewPeople`. Publishing a document that promises
anonymity beside an open side door would be a promise about one URL and not
about the village. The two person-shaped fields are stripped for non-admins;
the cards still serve, and `circles.members` stays because it is a list of seat
titles. `/api/admin/content` is unchanged.

Found in the same pass and NOT fixed here, CLOSED since: `anonymizeMember` never
touched `org_role_assignments`, so a member who exercised deletion kept a live
seating, and a documented holder's `display_name` was scrubbed by nothing. The
export could not leak either (it carries no names) and `/api/org` could. Both
doors are in §3.9.

`/org/**` 404s like `/api/**` and `/assets/**` rather than falling through to
the SPA, and `/.well-known/**` does the same. Both are document namespaces, so
a typo must not read as a success.

**The handshake this unlocked.** `addPeer` used to fetch `/api/platform/info`
and refuse anything whose `platform` string was not the literal
`custom-game-foundation`, so only forks of this repository could ever federate:
a Peerdom organisation, a bioregional council or a hand-written static file
could answer every question correctly and still be turned away. `discoverPeer`
tries `/.well-known/village.json` first and accepts any document carrying
`protocol: "village/*"` and an `instanceId`, whatever code it runs. `syncPeers`
uses the same seam, so a peer that upgrades between sweeps keeps being
recognised instead of looking like it went dark.

The v0 branch stays EXACTLY as strict as it was. It is the legacy path, not a
second and looser front door, so without a `protocol` field the platform string
is still the only thing that identifies a peer. A v0 peer costs one extra
request per six-hourly sweep; recording which document answered would need a
column and is not worth one yet.

What a peer speaks is cached in `peer_shared_cache.payload` (JSON, so no
migration) and surfaced as `protocol`, `supports` and an `orgUrl` that appears
only when the peer claims `org/1`. The shared-items fetch is NOT gated on
`supports`: no village advertises a shared-items capability yet, so branching on
one would silently stop syncing every peer that already works.

### 3.18 Links, confidence and drafts — the last three Peerdom lessons

**Links between nodes** (`server/lib/orgRelations.ts`, 0054). Types are the
village's own vocabulary (deputy, successor, mentor, prerequisite, works-with
ship as a starter set seeded ONLY into an empty table, so a deleted one never
comes back). The rule that makes this safe: **endpoints are nodes, never
people.** There is no `user` node kind. "Ada mentors Bo" would be a statement
about two people that then has to be kept out of the public export by
filtering, and filtering is how leaks happen; "the Water Steward seat is
deputised by the Gate Steward seat" says the useful part, outlives both
holders, and publishes by construction.

`is_cover` is what stops this being a table nobody reads. `structuralLoad`
already reports seats with no second holder; a seat with a deputy written down
is the difference between a risk and a plan, and `soleHeldWithCover` is how the
health read can now tell them apart. Cover is DIRECTIONAL: a seat deputised by
another is covered, the deputy is not thereby covered itself, or one link would
report a whole chain as safe.

**Confidence on a claim** (0055). `quest_claims.confidence` is
`on_track | at_risk | stuck`, NULL by default, set only by the holder and only
while the claim is open. It catches a failure nothing else could see: a claim
sits in `claimed` for six weeks and looks identical whether somebody is halfway
through or quietly stuck, and the retrospective can already spot "claimed,
never consented" but only once the season has ENDED. Nothing is computed from
it and nothing is paid on it, because a confidence rating that feeds a reward
is one people learn to inflate. A steward cannot set it: that would make it a
judgement of somebody's work instead of a signal from them.

**Structural drafts** (`server/lib/orgDrafts.ts`, 0054). A reorganisation you
can read before it is true, applied all-or-nothing on one transaction, with
`before_json` captured AT APPLY TIME so a revert undoes what was actually there
rather than what somebody saw a fortnight ago.

**Scope is the org plane only: seats, their circle assignment, and their
holders. Creating or deleting a CIRCLE is not draftable.** That is a real
constraint. `circles` is written through a dbCollection whose `replaceAll`
opens its OWN transaction on its OWN connection and swaps the in-memory cache
after committing, so a circle write cannot join anybody else's transaction and
cannot be rolled back once it returns. A draft claiming atomicity across both
planes would be lying about the half it cannot undo. Moving a seat BETWEEN
circles is `org_roles.circle_id` and is fully covered.

It follows the shape `applyMechanicsProposal` already set: revalidate against
current reality rather than trusting the captured proposal, idempotent by
status, and refuse the WHOLE thing rather than half-applying. `thread_id` is a
soft link to a forum decision because there is nothing firmer to bind to:
`forum_threads.kind` is a frozen enum, and deciding LOCKS the thread. And
`before_json` is revert data, not history: the journal cannot serve that
purpose, because `recordEvent` swallows its own errors by design and an archive
may not be lossy.

A seat the draft created is RESTED on revert, never deleted, because deleting
it would take its journal and holding history with it.

### 3.19 The serving layer — what every byte costs

Every image, script and stylesheet is served by the **same single Node process**
that runs the ledger, the scheduler and every module route. There is no CDN and
no object storage. So page weight is not a cosmetic concern here: image
bandwidth competes directly with quest consent and gratitude posting on one
event loop, on the ~50 KB/s links this platform is built for.

Four rules, each of which was a real defect first:

1. **Routes are lazy** (`client/src/App.tsx`). Only Home, Login and the 404 are
   eagerly imported; every other page is `React.lazy`. Before this the main
   bundle was 1382 KB against a 1400 KB CI ceiling and every visitor downloaded
   Admin's 6,980 lines and Project History's 2,870 before anything rendered.
   Splitting took first-paint JS to ~494 KB. A new page goes in the lazy list
   unless it renders on first paint for a signed-out visitor.

2. **Uploaded images cache for a year; documents never do**
   (`/api/uploads/:filename`). Every writer into `UPLOADS_DIR` stamps
   `${Date.now()}-${random}` into the filename, so a URL's bytes never change —
   replacing an image mints a new URL. That makes `max-age=31536000, immutable`
   correct rather than merely fast. Without it Express falls back to a
   conditional request per image per page view. PDFs get `private, no-cache`
   instead: they are gated business documents and shared proxies should not
   hold them.

3. **Foundation art never goes in `client/public/assets/`.** That directory is
   served one-year-immutable and Vite does **not** content-hash passthrough
   files, so replacing a file there leaves returning members stale for a year
   with no way to bust it. It once held 1.7 MB of logos — a single 449 KB PNG
   at 3458×3458 for a mark drawn at 40px. `scripts/compress-static-images.mjs`
   re-encodes what is already there; anything new belongs in the uploads
   volume, which is stamped, cached correctly and swappable.

4. **CI measures all three, not just one.** `MAX_MAIN_JS_KB`,
   `MAX_TOTAL_DIST_KB` and `MAX_SINGLE_IMAGE_KB` are set in
   `.github/workflows/ci.yml`; `node scripts/module-facts.mjs` prints the live
   values and `node scripts/check-dist-budget.mjs` reproduces the measurement
   locally, so the numbers are not copied here. The budget used to cover main
   JS alone, so 178 KB of CSS and 1.7 MB of images grew entirely unwatched.
   The two budgets point in opposite directions on purpose: main JS is real
   bytes on one file, total dist is block-charged across the tree, so
   splitting a route helps one and slightly costs the other. When one goes
   red, split or compress. Do not raise the number.

### 3.20 Peer identity — `server/lib/network.ts` (0057)

Two checks, and only one of them costs an attacker anything.

`instanceId` is learned at add time and re-checked every sweep. It is the
copyable half: a uuid read off a public document is exactly as easy to claim as
the `platform === "custom-game-foundation"` string it replaced, so it answers
"does this address still CLAIM to be the village we agreed to hear" and nothing
more.

The **pinned signing key** is the half that cannot be copied, and the reason it
works is not the comparison. A public key is public, so an impostor lifts the
whole `publicKey` block out of the real village's document and matches any
stored string. What an impostor cannot do is produce a signature over a new
document with a private key it does not have. So the pin is only worth
something because `discoverPeer` verifies the discovery document's proof, and
`syncPeers` verifies it against the PINNED key. `verifyDocument` (§3.17) is
integrity either way; identity is the caller's choice of key.

Three properties worth keeping:

- **A key is pinned only once its holder has proved it.** `provenKey` returns
  null unless the document publishes a key AND its own proof verifies against
  that key, and the PEM is rebuilt from the raw 32 bytes rather than read from
  the document: a peer publishing the real village's `publicKeyBase64url`
  beside its own `publicKeyPem` would otherwise match the pin and verify its
  own signature in the same breath.
- **An unsigned peer still federates.** A hand-written static file answering
  the shape is the peer the discovery handshake exists to admit, and the v0
  document was never signed at all. Those pin nothing and keep exactly the
  trust-on-first-use posture every peer had before 0057. A peer that starts
  signing later pins on the first sweep that offers a key.
- **A changed key pauses the peer, and does not guess why.** A rotation and an
  impostor are the same event from here, and this platform has no rotation
  protocol yet, so the message says so. The way out is the door that already
  existed for an identity change: "accept & resume" re-reads the handshake and
  re-pins whatever answers, which is a human agreeing to the rotation.
- **A peer that stops proving a key pauses too.** Answering without one is
  what a rollback to a pre-signing build looks like and what a downgrade
  attack looks like, and picking the friendlier reading would mean any
  attacker can turn the check off by serving the unsigned v0 document. The
  cost is real and is the right way round: a village that rolls back pauses on
  its peers until somebody looks.

### 3.21 The uploads volume: many writers, one reader, one sweep

`UPLOADS_DIR` is flat, it is a mounted disk, and several doors write into it.
Any code that reasons about a file on it has to know ALL of them, because a
rule that knows all but one is a rule that eventually deletes a member's
photograph. This section carried a hard count of five for months while three
more doors were added around it, which is the failure it warns about, so the
count is gone and the enumeration is a command:

```bash
grep -rn 'writeToVolume(' server --include='*.ts' | grep -v uploads.ts
```

Every byte goes through `server/lib/uploads.ts` (`sanitiseForVolume` and
`writeToVolume`), which `scripts/check-upload-strip.mjs` enforces, so that grep
is exhaustive by construction. The table below is a reading aid for what the
doors are FOR and where each reference lives; the grep is the list.

| Door | Filename | The reference that keeps it |
|---|---|---|
| `POST /api/work-with-us/attachment` (public) | `proposal-<stamp>` | `submissions.data.attachment`, a **bare filename** with no `/api/uploads/` prefix |
| `POST /api/admin/brand/image` (`server/routes/brandUploads.ts`) | `brand-<stamp>.webp` and `brand-<stamp>.thumb.webp` | the `brand` document in `app_config`; the THUMBNAIL is named by nothing, because `BrandImageField` discards `data.thumbUrl` |
| `POST /api/admin/brand/font` | `brand-font-<stamp><ext>` | `brand.theme.fontFaceUrl`, and the filename again inside `brand.theme.fontLicenceAck.file` |
| `POST /api/admin/investor-docs/upload` | `<document's own name>-<stamp><ext>` | `investor_docs.url` (0099) |
| `POST /api/places/:key/photos` | `place-<stamp>.webp` and `place-<stamp>.thumb.webp` | `place_photos.url` and `.thumb_url` |
| `POST /api/me/portraits/:key/upload` and `/forge` (`server/lib/characterPortraits.ts`) | `portrait-<stamp>.webp` | `character_portraits.file_name` and `.candidate_file_name` (0158) |
| The land imagery cache (`fetchAndCache`, `server/lib/satellite.ts`) | `land-<provider>-<stamp><ext>` | `village_land.imagery_filename` (0123) |
| `POST /api/admin/site-pull/assets` (`server/routes/sitePull.ts`) | `sitepull-<stamp><ext>` | **nothing, until an admin pastes the URL somewhere.** The route hands back `/api/uploads/<name>` and persists no row, so a pulled picture nobody used is genuinely unreferenced and the orphan sweep is right about it |

**The stamp is a contract, not a convention.** Every one of those names carries
`-<13 digit millisecond>-<random>` before its extension, minted by
`stampedName()`. Three separate mechanisms rest on it: the one-year immutable
cache on `/api/uploads/:filename` is only correct because a URL's bytes never
change; the grace window below reads the millisecond as a second clock; and the
reference scan uses the thirteen digits to make "does anything name this file"
an exact question over a whole database.

**Removing a file that nothing points at** is Admin > Documents > Uploaded
Files (`GET /api/admin/uploads/orphans`, then
`POST /api/admin/uploads/orphans/remove`). The rules, all in
`server/lib/uploadsSweep.ts`:

- **Unreferenced is proven, never guessed.** `server/repos/uploadRefs.ts` reads
  every text-shaped column of every base table in the LIVE schema from
  `information_schema`, from the database and never from a repo cache. There is
  no hand-kept list of reference columns, because a hand-kept list is a promise
  that every future column joins it.
- **A scan that did not finish offers nothing.** Any unreadable column marks
  the whole report incomplete and the removal refuses.
- **Only a stamped name is judged.** Anything else is reported as unknown and
  left where it is.
- **Both clocks clear the window.** `uploads.orphan_grace_days` (default 30)
  is measured against the more recent of the file's mtime and its stamp, which
  is what protects a brand image somebody replaced yesterday.
- **A thumbnail and its picture are one decision**, in both directions.
- **Symlinks and directories are never followed, never removed, always reported.**
- **The press carries a fingerprint of the list, never a filename.** The sweep
  enumerates the volume itself; nothing a request says can aim it at a file.
- **The audit line records counts and never names.** `health_events` is a table
  the reference scan reads, so a file named in the trail would look referenced
  from that moment on.

The daily retention sweep MEASURES and never reclaims. `/health` carries
`uploads.orphanFiles` and `uploads.orphanMb` from the last measurement, and
the deletion stays a person's press. `docs/DESIGN_TOKENS_SPEC.md` A1 is the
record of what a slightly-wrong automatic sweep costs.

**A door's own sweep may only reach that door's own files.** The retention
sweep unlinks a handled submission's attachment, and that filename arrives
through a public unvalidated route, so it is checked against
`isProposalAttachment` first. Without that check a stranger could post the
village's hero image as `data.attachment` and have it unlinked the day that
submission aged out.

---

## 4. Modules: how to add one, how to remove one

### Adding a module end-to-end

1. **Registry entry** in `shared/modules.ts`: id, founder-facing catalogue
   copy (platform language — the brand guard will hold you to it),
   `tier`, `dataClass`, `requires`/`recommends`, `apiPrefixes`,
   `variableKeys`, `capabilities`, and — as applicable — `legalReview`,
   `sellsToken` (remember: one seller per token is boot-asserted, and the
   exchange refuses to list what you sell), `defaultConfig` +
   `validateConfig`.
   - `tier` is `included` for anything the platform itself writes and
     carries. `connected` and `managed` are module library listings and
     carry the extra obligations in step 12.
   - `dataClass` is the WIDEST class the module's own tables hold, never
     the average. Most of this platform is `member-pii`, because a booking,
     an RSVP, a loan and a private message each identify a named person.
2. **Migration** in `drizzle/` — next number, plain SQL, one statement per
   `;`-at-end-of-line (see trap 1). Seed any system ledger accounts here
   with `INSERT IGNORE`, and say in a comment whether each is a faucet and
   why (0009/0024 are the model).
3. **Tokens.** If the module has a credit, create it via the token registry
   (`registerToken`, or an `ensure<X>Token` called at boot *before* the
   invariant check, the way `ensureStayToken` is), and
   issue only through `postTransfer` with idempotency keys. No private
   balance columns — the framework gives modules no place to keep one.
4. **Routes** in `server/routes/<id>.ts`, **not** in `server/index.ts`,
   mounted behind `app.use("<prefix>", requireModule("<id>"))` for every
   prefix declared in the registry. Settlement webhooks (if fiat) go
   through `registerPaymentHandlers`, never behind the module gate.

   **The route module shape.** One export that touches Express, and an
   explicit list of what the routes may reach:

   ```ts
   import type { Express } from "express";
   import type { AppDeps } from "../lib/appDeps";

   type Deps = Pick<AppDeps, "isAdmin" | "guardCapability" | "thingRepo">;

   export function register(app: Express, deps: Deps): void {
     const { isAdmin, guardCapability, thingRepo } = deps;
     app.get("/api/thing", async (req, res) => { /* ... */ });
   }
   ```

   Then one line in `startServer`, at the point in the file where the
   routes belong: `registerThingRoutes(app, { isAdmin, guardCapability,
   thingRepo });`. **Where you call it is part of the behaviour**, because
   Express matches in registration order; moving a registration past
   another route that could also match the same path changes which handler
   answers.

   Take a `Pick<AppDeps, …>`, never the whole `AppDeps`. Those names are
   the complete list of what the module can reach, and widening it is then
   a visible line in a diff rather than a new free variable nobody
   notices. Add the entry you need to `server/lib/appDeps.ts`; that type
   grows one entry per extraction on purpose.

   **Take the gates from `deps`. Do not import your own.** `isAdmin`,
   `authedUser`, `mayAct`, `guardCapability` and `mayStillSee` each call
   `markAdminGate` (`server/lib/adminGate.ts`) on entry, and the
   default-deny middleware under `/api/admin` refuses any admin response
   that succeeds without that mark. A hand-rolled gate passes review and
   then turns every admin route in your module into a 403.

   `server/routes/faqs.ts`, `training.ts` and `milestones.ts` are the
   worked examples, in ascending order of how much they need.

   **Why not `server/index.ts` any more.** That file holds tens of thousands
   of lines and hundreds of route registrations in one `startServer` closure,
   and this recipe telling every contributor to add to it is a large part of
   why. Run `node scripts/check-server-index-size.mjs` for the two current
   figures; they are deliberately not written down here, because every time
   they were, they were wrong within a day. It is
   now ratcheted by `scripts/check-server-index-size.mjs`: its line count
   and its route count may only ever fall, `--update-baseline` refuses to
   write a higher number, and a file under `server/routes/` is capped at
   2000 lines so the monolith cannot simply move house. A route added to
   `server/index.ts` fails CI. Extraction work lowers the baseline; run
   `node scripts/check-server-index-size.mjs --update-baseline` when you
   have taken some out.

   **Capability checks: which of the two, and why it matters.** This line
   used to say `hasCapability(cap, await capabilityCtx(user))` for every
   route, and following it is what made seven powers unable to leave the
   admin panel. That call never sees the request, so it cannot carry the
   break-glass and cannot write the record that makes a village-held power
   real, which forced `TRANSFERABLE` to mark each of those keys `false`.
   Ask the question the route is asking:

   - A route that REFUSES on the key is an ACT. Use
     `guardCapability(req, res, cap)`, or `mayAct(req, cap)` when the route
     has a second door beside the capability (an author editing their own
     thing, a proposer closing their own ballot). Both read `override` and
     `x-capability-override`, both answer 409 with the holder's name, and
     `mayAct` writes the public record.
   - A route that only REPORTS the key, in a payload flag or a decision
     about how much to build, is a LOOK. Use
     `hasCapability(cap, await capabilityCtx(user))`, which reads no
     override and writes nothing. Pointing a look at `mayAct` puts "acted
     on a power this village holds" on the public pulse for somebody who
     opened a page, and that defect has shipped once already.
   - A read that REFUSES is a look that would otherwise strand an
     operator, because a GET carries no break-glass. Use `mayStillSee`.
5. **Variables** in `shared/gameVariables.ts`, namespaced `<id>.*`, bounded,
   founder-readable descriptions. Admin hides the group while the module is
   off.
6. **Capabilities**: extend the union AND `ALL_CAPABILITIES` in
   `shared/capabilities.ts` (lockstep or badges cannot grant it), add a
   `STAGE_UNLOCKS` row only if the ladder should grant it, and classify it
   in `TRANSFERABLE`. That last one is a `Record` and not a `Set` on
   purpose: a new key with no line there is a type error, so whether a
   village may ever hold this power is a decision somebody makes rather
   than a default somebody inherits. Mark it `true` ONLY in the same commit
   that puts its acting routes behind `guardCapability`/`mayAct` (step 4),
   never one without the other.
7. **Public activity** through `moduleActivity(id, …)` only;
   notifications through `insertNotification` with a stable dedupe key and
   a cadence entry in `emailCadenceFor` if it should ever email.
8. **openStateCheck**: if the module creates economic state that must
   settle before disabling, attach the closure in `startServer()` next to the
   other `MODULES_BY_ID[...].openStateCheck =` lines, and add the
   member-level equivalent to
   `exitOpenState` if a departing member could hold it.
9. **Client**: page under `client/src/pages/`, gated by
   `useModules()`/`ModuleGate`; nav from the module manifest, never a
   hardcoded entry; the Admin Modules tab picks the module up from the
   registry automatically.
10. **Launch requirement** (only if a founder must act before the module is
    honest to run): one entry in `shared/launchRequirements.ts` + one check
    closure in `launchDeps` — every consumer updates itself.
11. **Docs + tests**: a design doc in `docs/modules/`, its `MODULE_DOCS`
    entry in `server/lib/knowledge.ts` (a deliberate allowlist, never a
    glob, and filenames do not follow module ids), a **`Provenance:` line
    under its title** or it cannot join Maia's shelf at all
    (`server/lib/moduleDocProvenance.ts`; the test beside it is the gate),
    a `docs/FORK_RUNBOOK.md` line for any new env var or seed **in the same
    session**, unit tests beside the lib, and a `smoke-all-modules.mjs`
    section. Also add the module to `scripts/enable-all-modules.mjs`
    TARGETS and PROBES, or it hard-exits 3 refusing to claim completeness.

### Additionally, for a module library listing

A listing is a connector to an outside paid service. Everything above still
applies; these are the obligations `tier: "connected"` or `"managed"` adds.
`shared/modules.ts:moduleListingProblems` asserts most of them at boot, and
`shared/moduleListing.test.ts` asserts them in CI without booting anything.

12. **The `vendor` record**, and it is data rather than prose: a legal name,
    the EXACT product URL (never the bare product name), a support URL AND a
    support email (both required at every tier, both validated — a listing
    with nowhere to send a person cannot exist), a status URL, a terms URL,
    and a `liveness` expectation, either a window inside which a success is
    normally expected or an explicit "on demand, silence is normal".
13. **The credential plane, which IS the tier.** `connected` names slots in
    `vendor.secretKeys`; those join `SECRET_KEYS` automatically and a village
    admin holds the key and sees its source and last4. `managed` names an env
    var in `vendor.managedEnvKey` instead, holds nothing in the store, and
    never returns that key to any village even masked (hub ADR-49). Putting a
    managed credential in the store is refused twice, at boot and in the
    derivation.
14. **`provides`**, the domain this listing claims. Data today. The
    at-most-one-driver-per-domain refusal on the enable path waits for a
    second vendor inside one domain, because a catalog is supposed to list
    two services side by side and only an ENABLE of the second is a conflict.
15. **`forgetMember` / `exportMember`**, wired through
    `registerMemberDriver` (`server/lib/memberDrivers.ts`) at boot, if the
    listing holds anything about a member. Not optional and not a roadmap
    item: without them the published constitution's "leaving well is
    guaranteed" becomes false and nothing goes red.
16. **Every outbound call through `callVendor`** (`server/lib/integrations.ts`).
    It mints the correlation id, sends it as a header, and writes the health
    row. A driver that calls out around it produces no evidence at all.
    Nothing anywhere may read `secretStatus.setAt` as evidence a credential
    works: that is when somebody TYPED it.

Nothing else is needed. The catalog pill, the support line, the Integrations
card, the 503 lapse gate on every declared prefix, the launch requirement and
the tier stamp at enable time are all derived from the registry entry.

### Removing (disabling) one safely

Disabling is the product's own flow — use it, do not hand-edit tables:
`setModuleLifecycle(id, "off")` refuses while (a) any non-off module still
`requires` it, or (b) `openStateCheck` reports open state (open loans,
active stays, pending orders, standing warnings), with settle-first
guidance. In-flight fiat orders still settle after the switch because the
webhook is outside the gate. Data is left in place — OFF hides surfaces, it
does not delete history; ledger rows are never deleted under any flow.
Removing a module from the *registry* entirely leaves its stored settings
row as a loudly-logged orphan (listed, never served) — acceptable for a
fork, but drop the row deliberately when you do it.

---

## 5. The standing invariants

1. **Fiat flows IN only.** Tokens are never sold back for money; there is
   no path out and adding one is not a setting — this is what keeps closed-
   loop credits from becoming securities-shaped.
2. **Hypha-governed tokens never trade and never move here.** The platform
   would otherwise quietly become the cap table's source of truth; refused
   in `validateLeg`, re-proven at every boot.
3. **Recognition is never buyable or swappable.** Appreciation with a price
   is a price, not appreciation (`tradingProblem`).
4. **Faucet-issued tokens never swap** — destination-based test, no
   override at any privilege level: what the village can conjure must never
   become a claim on goods someone paid real money for.
5. **One selling module per token**, boot-asserted — two sellers means two
   prices for the same promise.
6. **Swap caps fail closed: 0 = zero**, never unlimited — an unset cap must
   not be an open tap.
7. **Trading is per-deployment opt-in behind a version-stamped legal card**;
   amended terms force a re-read, and shared-password deployments cannot
   trade at all.
8. **Every module ships OFF; absent row = off.** Enabling is a recorded
   human decision, and forks inherit new modules dormant.
9. **Conservation ≡ 0 per token; recompute, never increment; every write
   carries an idempotency key.** The economy is checkable, not promised.
10. **Non-faucet accounts never go negative** except through the
    statically-listed truthful-debt sources in `ALLOW_NEGATIVE_SOURCES`. A
    negative balance is a fact, never a convenience, and that set is extended
    only by a reviewed edit.
11. **Funds-bearing modules refuse to enable under shared-password
    posture** — money needs attributable humans.
12. **In-flight orders settle even when their module is off** — the webhook
    lives outside `requireModule`; a village's toggle must not eat a paid
    order.
13. **Value rows are never deleted.** Deletion is anonymisation; the
    tombstone keeps conservation and settlements explicable.
14. **Cycle close and season roll are never automated.** Releasing value is
    a human act; the scheduler's charter says so in writing.
15. **One gate, one ledger, one event spine, one scheduler, one webhook.**
    Any second mechanism for permissions, balances, history, cron or
    settlement is a bug by definition.
16. **Nothing person-shaped reaches an unauthenticated surface.** Not a full
    name, not a first name, not a documented holder's `display_name`, not a
    user id, not a focus string or a holder note. A route with a session may
    tier those behind `map.viewPeople`; a route without one has nothing to
    tier with, and a fetched document can be cached, relayed, indexed and
    handed to an agent forever. `SELECT *` on any table carrying a person is
    how this breaks every time, because the leak arrives with the next
    migration rather than with the code that reads it. Publish the count and
    not the person.

---

## 6. The trap list (all real, all paid for)

1. **Comment lines ending in `;` split SQL statements.** The migration
   runner splits on `;` at end of line and strips comment lines *before*
   splitting (`splitStatements` in `server/db/migrate.ts`), and only FULL
   comment lines.
   Migration 0015 was cut in half by `-- …live in game_variables;`. Keep
   comments off statement tails; never end a comment line with `;`.
   **And a shipped migration file is never edited** — not a style rule, a
   hard invariant. A file that fails part-way records its progress in
   `_migrations_partial` and RESUMES at that statement on the next boot
   (without which a mid-file failure replays already-applied DDL on every
   boot and bricks the deployment permanently). Editing a partially-applied
   file therefore resumes at the wrong offset. Correct a shipped migration
   with a NEW numbered file.
2. **PowerShell `Set-Content -Encoding utf8` double-encodes.** UTF-8 text
   written through it becomes mojibake; several section rules in
   `server/index.ts` still carry the scars (`â”€â”€ Seasons â”€â”€`,
   line numbers left out on purpose, since the grep below finds every one).
   Write files with tools that respect the bytes;
   verify with a grep for `â` after any scripted edit on Windows.
3. **MySQL UNIQUE indexes exempt NULLs.** Multiple NULLs happily coexist
   under a unique index, which silently kills NULL-keyed dedupe. This is
   why `notifications.dedupe_key` is NOT NULL with a real unique index (the
   first bullet of the `server/lib/notify.ts` header). Any new dedupe column
   must be NOT NULL.
4. **BigInt literals break the build.** The bundle targets below ES2020, so
   `123n` fails; use `BigInt(123)` calls. The swap quote math does exactly
   this on purpose, and says so in a comment (`quoteSwap` in
   `server/lib/exchange.ts`).
5. **Never filter the test run with `-t`.** `server/loop.e2e.test.ts` is
   order-dependent by design — each step of the loop builds on the last
   against one live server process. A `-t` filter skips earlier steps and
   fails later ones spuriously. Run the whole file or the whole suite.
6. **Build before test.** The loop test boots `dist/index.js` and throws
   "Run `pnpm build` before the loop test" if it is missing (the `DIST`
   constant in `server/loop.e2e.test.ts`); CI orders build before test for
   this reason (`.github/workflows/ci.yml`).
7. **`timezone: 'Z'` on every MySQL connection.** mysql2 defaults to local
   time; a timestamp written local and read Z shifts every lunar boundary
   six hours (the file header of `server/db/migrate.ts`). The engine, the pool and the
   harness all set it — so must any new connection.
8. **`AUTH_TOKEN_SECRET` unset degrades silently** to per-process sessions:
   every restart logs everyone out. It is now a blocking launch requirement
   (`session-secret`) rather than only a console warning.
9. **A limit read outside the transaction that enforces it is not a limit.**
   Read the total, decide, post three awaits later, and a concurrent request
   reads the same stale total and also decides yes. This has been found twice
   — swap caps (fixed with `PairGuard`) and the per-cycle mint cap (fixed with
   `TransferGuard`). Any new cap that lives outside the ledger goes in a
   guard, under the lock that already orders the writes.
10. **A dependent module enabled before its dependency is demoted straight
    back to off.** `feed` hard-requires `forum`; enabling feed first looks
    like it worked and leaves the routes 404ing. Enable dependencies first —
    including in tests, where this reads as an unrelated failure.
11. **`railway up` stamps the build marker `-dev`.** The SHA comes from
    `RAILWAY_GIT_COMMIT_SHA` or `git rev-parse`, and a `railway up` tarball
    has neither, so `/health` cannot confirm which commit is live after one.
    Verify functionally instead: fetch `/` for the hashed asset name and grep
    the bundle for a string only the new code contains.
12. **A knob nothing reads is a lie with a save button.** Three were found in
    one sweep: `village.pulse_max_entries` (route used a hard-coded 30),
    `stay.credit_expiry_days` and `stay.credits_transferable` (no enforcement
    exists, deliberately — see §5). Either wire a variable when you register
    it, or make the write path refuse a value and say why.
13. **A field the repo's column list does not carry is dropped in silence.**
    `usersRepo` builds its UPDATE from `COLUMNS`, so `m.membershipGranted =
    true` set the in-memory record, wrote nothing, and returned the mutated
    record to the caller, which then logged a success. `hasMembership` read
    that field as a gate and the boot migration that was meant to protect
    existing members wrote a count to the log and no rows to the table. 0058
    gives it a column. The reverse case is the same class: six `org_roles`
    columns were in `WRITABLE` and in no SELECT, so the API accepted them and
    swallowed them. **A write path and a read path that disagree fail
    quietly** — check both when you add either.

---

## 7. Testing doctrine and the gate

**Harness (S5).** `server/db/testDb.ts` provisions a scratch schema and applies
*every* migration through the production engine. The schema name is UNIQUE per
provision, `village_test_<epoch>_<pid>_<n>` (`nextSchemaName`), and it is not
reused. A fixed name was the old design and it broke: two parallel runs
DROP/CREATEd the schema out from under each other, twice in an hour, presenting
as `Unknown database 'village_test'` halfway through a migration and as
cascades of 500s in loop sections that pass on any quiet run. `TEST_SCHEMA`
overrides the name and survives only as a pin for CI's named service container.

Unique names give up the cleanup the old fixed name provided, where
DROP-and-recreate erased the last run's leftovers, so provisioning SWEEPS
instead. Any `village_test_*` schema whose embedded epoch is more than **two
hours** old is dropped as a crashed run's orphan (`STALE_SCHEMA_MS`), while a
live parallel run's schema, minutes old, is never touched. A leaked schema
younger than that window therefore survives on the server by design, and a
schema you find there is not evidence of a live run.

Sources: CI uses a
`mysql:8` service container; locally, `TEST_DATABASE_URL` in `.env` points
at a scratch-capable server, never the app schema. No `TEST_DATABASE_URL`
→ the DB-backed suites skip AND the run **fails** (`hollowRunVerdict` in
`server/db/provisioningReport.ts`), because a skipped third that exits 0
cannot be told apart from a pass. `ALLOW_NO_TEST_DB=1` opts into the smaller
suite; a filtered run needs no opt-out; `CI` and `REQUIRE_TEST_DB` outrank
the opt-out.

**Migrate once, clone per suite (2026-08-22).** 44 test files provision a
schema and 47 calls do it, so "applies every migration" used to mean applying
88 files 47 times: roughly five minutes of every CI job, growing by that
multiple with every migration anyone added. One PR-merge job was cancelled on
the workflow's 15-minute cap while the push job for the same commit finished in
4m38s, so the headroom this spent is what made runner variance fatal.

MySQL has no `CREATE DATABASE ... TEMPLATE`, so `provisionTestDb` builds the
equivalent: migrate ONCE into a template schema named
`village_tpl_<sha of every migration's name and bytes>_<collation>`, then give
each suite a copy assembled from that template's own `SHOW CREATE TABLE` plus a
server-side `INSERT … SELECT` for the tables migrations seed. The DDL is the
server's own rendering, replayed on the same server, so nothing is translated
between engines and MariaDB locally and MySQL in CI each clone their own
dialect exactly. `applyPending` still runs on the clone and must find nothing
to do; it says so loudly if it does.

What that keeps: each suite still gets a private, uniquely-named scratch schema
nobody else writes to, `drop()` and the two-hour orphan sweep are unchanged,
and the fail-loud skip is unchanged. Templates get a sweep of their own
(`STALE_TEMPLATE_MS`, 24 hours), skipping the one in use by name and any one a
builder holds a MySQL named lock on. Anything that goes wrong in the clone path
falls back to migrating the schema in full and **prints why**, because a silent
fallback is exactly the five minutes this exists to save.
`server/db/harness.test.ts` proves a clone is column-for-column, index-for-index
and row-count-for-row-count identical to a schema built by running the
migrations, against whichever engine the run is on.

The price is printed. Every run ends with a provisioning summary from
`server/db/provisioningReport.ts` (wired as vitest's `globalSetup`), and
`pnpm measure:provisioning` prints the template build, the per-clone cost, the
per-migration-file cost and the whole-run total.

Measured on a local MariaDB 12.3 at 88 migrations, on a quiet box: template
**2.1s** (24ms per migration file), clone **0.7s**, whole-run provisioning
**129s → 34s**. The same tree under load, with other lanes working the same
machine, measured template **8.8s** and clone **4.1s** and whole-run
provisioning **569s → 189s**. **The ratio is the stable number, roughly a
quarter of what provisioning cost, and the absolute figures move 4x with what
else is running** — which is the local version of the spread CI runners show on
identical content. Read the run's own printed summary, never a remembered
figure.

**The loop test** (`server/loop.e2e.test.ts`) is the acceptance criterion
for the whole product, not a unit test: it boots the BUILT `dist/index.js`
as a subprocess against a scratch schema and a throwaway data dir, then walks
register → path → claim → submit → admin consent →
gratitude lands → peer send → wall → Pulse → progression. It is
order-dependent; never `-t`-filter it. If a change makes it fail, the
change is wrong.

Its port is derived from the pid, `17900 + (process.pid % 2000)`, for the
same reason the schema name is: a shared fixed port is a shared mutable global
with extra steps, and on 2026-08-01 two parallel sessions on the old fixed
3781 took each other down. The second server's bind failed quietly, its health
check answered from the FIRST session's server, and 43 failures of pure noise
followed. Read `PORT` in `server/loop.e2e.test.ts` rather than expecting a
number, and never hardcode one when adding to this suite.

**Unit suites** live beside their subjects: `server/ledger.test.ts`,
`server/swap.test.ts` (quote/conservation properties),
`server/payments.test.ts`, `server/automation.test.ts`,
`server/lib/gratitude-cycles.test.ts`, `server/repos/users.test.ts`,
`server/db/harness.test.ts`, `server/base-reads.test.ts`, and the
isomorphic `shared/*.test.ts` (capabilities, lunar, mapLayout). Vitest runs
in node env, `fileParallelism: false` (one server process per file, no port
fights), 120 s test timeout (`vitest.config.ts`).

**The gate** is the same commands locally and in CI
(`.github/workflows/ci.yml`). There are more than thirty of them and the list
grows most weeks, so it is not transcribed here. Print it in the order CI runs
it:

```bash
node scripts/module-facts.mjs   # ends with "Gates, in the order CI runs them"
```

The four that fail most often, and the order that matters:

```bash
pnpm check                        # tsc --noEmit; note it does NOT typecheck tests
npx tsc -p tsconfig.tests.json --noEmit   # the tests, which the line above excludes
pnpm build                        # vite build + the server bundle, BEFORE tests
pnpm test                         # vitest run, the FULL suite, loop included
```

Two of the CI steps have no local `pnpm test` equivalent and both BLOCK:

- **The bundle budget**, a shell block in the workflow, reproduced locally by
  `node scripts/check-dist-budget.mjs`. See §3.19 rule 4 for what it measures
  and where the numbers live. When it goes red the fix is splitting a route,
  usually `React.lazy` on a heavy page, and never raising the number. A
  village on a phone on rural mobile data pays for every kilobyte.
- **`node scripts/dependency-audit.mjs`**, blocking since the commerce
  hardening. It blocks on an ANSWER carrying a high advisory and deliberately
  not on a registry that will not answer, because `pnpm audit` returns one
  exit code for both and a hung audits endpoint stopped every merge in this
  repository on 2026-09-04 with nothing wrong in any code. Advisories with no
  upstream fix that have been checked for reachability go in `package.json`
  under `pnpm.auditConfig.ignoreGhsas` AND in `docs/SECURITY_ADVISORIES.md`;
  an entry in one without the other is not allowed. The first pass of this
  removed `axios`, a direct dependency carrying thirteen high advisories that
  no file imported.
Pushing `main` deploys production, so the gate is the release process:
nothing merges red, and nothing green is assumed to work until the loop has
closed against the artefact that ships.