---
name: fork-builder
description: Build or modify a custom village fork of the Village OS platform (formerly game-amora) — module add/remove recipes, invariants, gate, and traps
---

# Fork builder

Operating procedure for building a new village fork or adding/removing modules on any fork.
The platform is white-label: the "Amora" deployment is only the first tenant. A fork is only for a
village that changes code: running a village needs no fork and no access to `ReGen-Civics/village-os`,
only the published image (`START_HERE.md`). A fork deploys through the repository's own
`Dockerfile`, and changes are offered back by pull request from the fork. Everything below is
verifiable in code today; where a claim matters, the enforcing file is named.

## 0. Before writing any code

1. **Read `docs/ARCHITECTURE.md` first. Always.** It is the reference for the shipped system.
2. For provisioning, env vars, seeds and go-live checks, read `docs/FORK_RUNBOOK.md` — it is the
   living runbook every session appends to (one line per new env var/seed/step).
3. Do NOT trust `MODULES_MASTER_PLAN.md` Part 1 — it is known-stale planning prose. The code and
   `docs/ARCHITECTURE.md` win every disagreement.
4. Know the five config planes before touching any of them:
   - **Identity** — `shared/gameConfig.ts` + the brand overlay, a database document (`dbDocument(getPool(), "brand", …)` in `app_config`; Setup Wizard, merged by `mergedConfig()`, served at `/api/game/config`). Names, images, stage ladder.
   - **Behaviour** — `shared/gameVariables.ts` registry; overrides in the `game_variables` table, **delta-only** (only changed values stored, so platform default bumps flow to forks). Read synchronously via `server/lib/variables.ts` (`variable()`, `numberVar()`; unknown keys throw).
   - **Module config** — structural per-module JSON in `module_settings.config`, validated by each module's `validateConfig` (`shared/modules.ts`).
   - **App documents** — `app_config` key/value JSON (instance identity, email config, secrets doc).
   - **Integration secrets** — `server/lib/secrets.ts` (S63): `stripe_secret_key`, `stripe_webhook_secret`, `resend_api_key`, `assistant_api_key`. **Write-only**: reads return `{configured, source, last4, setBy, setAt}`, never the value; resolution is admin-typed first, env var fallback. Never serialise a secret toward a browser.

## 1. Module-add recipe (ordered)

1. **Register the module** in `shared/modules.ts` `MODULES[]`: `id`, founder-facing `name`/`description`
   (platform copy — no village's brand), `requires` (hard deps, block enable/disable), `recommends`
   (warn only), `capabilities`, `variableKeys`, `apiPrefixes`, plus as needed: `legalReview: true`
   (funds-bearing — enable refused under shared-password posture), `sellsToken` (at most one selling
   module per token, boot-asserted), `defaultConfig`/`validateConfig`, `hyphaLinks`/`hyphaOnly`.
2. **New capabilities**: extend BOTH the `Capability` union and `ALL_CAPABILITIES` in
   `shared/capabilities.ts` (they must stay in lockstep or badges cannot grant it), and add a
   `STAGE_UNLOCKS` entry only if a stage should grant it. Never invent a second permission
   mechanism — `hasCapability()` is THE ONE GATE, order of authority: admin → badgeDenies → role →
   badgeCapabilities → stage (a warning badge's deny beats role and stage; only admin outranks it).
3. **New game variables**: add `VariableDef`s to `shared/gameVariables.ts` with platform defaults.
   If a rule of the game is a literal in code, it belongs here instead. **Wire it in the same
   change.** A registered variable nothing reads is a lie with a save button — an admin sets it,
   believes the village behaves differently, and tells members so. Three were found in one sweep
   (`village.pulse_max_entries` had a hard-coded 30 beside it). If the behaviour genuinely cannot
   be built yet, make the write path REFUSE a non-default value and say why, as
   `stay.credit_expiry_days` does. And when you wire a knob that was previously dead, set its
   default to the value that was already being served — turning a setting on must not silently
   change what every existing village sees.
4. **Migration**: next-numbered `drizzle/00NN_<name>.sql`. The custom runner
   (`server/db/migrate.ts`) auto-applies at boot, before the server listens, fail-loud, recorded in
   `_migrations_applied`. There is no manual migrate step; `npx tsx scripts/run-migration.ts
   --status` only inspects. A fork's own migrations take numbers from 9000 up and are checked with
   `node scripts/check-migration-numbers.mjs --village`.
   Obey its parser: statements split on end-of-line semicolons after comment lines are stripped
   (`splitStatements`, line ~30). See traps §6 before writing SQL.
5. **Server library**: `server/lib/<module>.ts` for domain logic. New routes go in
   `server/routes/<domain>.ts`, registered from `server/index.ts`, which is ratcheted and may not
   grow (`scripts/check-server-index-size.mjs`). Every prefix is mounted behind the gate:
   `app.use("/api/<x>", requireModule("<id>"))`, and the `register()` call must come after that
   mount (`server/lib/modules.ts` ~167). **Exception**: settlement webhooks are NEVER behind
   `requireModule` — in-flight orders must settle while a module is off (invariant #13).
6. **Tokens**: if the module has its own token, create it idempotently at boot (`ensureStayToken` /
   `ensureLibraryToken` pattern, `server/index.ts` ~1871) BEFORE `checkLedgerInvariants` runs. All
   movement goes through `postTransfer` / `postTransferPair` (`server/lib/ledger.ts`) with an
   idempotency key per leg; use a `PairGuard` for limits that must be checked under the pair's lock.
7. **Fiat**: never a second webhook or checkout path. Register
   `registerPaymentHandlers(moduleId, {settle, reversal, renew})` with `server/lib/payments.ts`
   (raw-body HMAC, event-level dedupe on `stripe_event_id`, mechanical reversal that claws back and
   auto-suspends). Rounding favours the treasury: ceil what the member pays, floor what they receive.
   **Read `docs/ARCHITECTURE.md` §3.8 "What a settle handler has to get right" before writing one** —
   six rules, each learned by getting it wrong, and a handler that ignores any of them takes money
   without delivering or delivers twice. In short: the period key comes from Stripe and never from a
   counter; "completed" is not "paid"; record money → deliver → mark settled, in that order; mark it
   in ONE statement; reverse only what was actually delivered; a renewal re-asks checkout's questions
   and never throws.
8. **Spines, not bespoke plumbing**: public activity via `moduleActivity()` (the preview-leak guard —
   nothing lands on the Pulse below `members`); history via `recordEvent()` (`server/lib/events.ts`,
   never throws into the caller); notifications via `server/lib/notify.ts` with a stable
   `dedupeKey`; periodic work via `registerJob()` (`server/lib/scheduler.ts`) with an early return
   while the module is off. The scheduler never closes cycles and never rolls seasons.
9. **openStateCheck**: if disabling should be blocked by open economic state (loans, active stays,
   standing warnings), attach it at boot in `server/index.ts` (~1955):
   `MODULES_BY_ID["<id>"].openStateCheck = () => xOpenState(getPool())` — the shared registry stays
   import-clean for the client bundle.
10. **Launch requirements**: if the module needs per-deployment setup, add an entry to
    `shared/launchRequirements.ts` with `appliesWhenModule: "<id>"` and a matching check closure in
    the `LaunchDeps` wiring in `server/index.ts` (resolved by `server/lib/launch.ts`). One entry
    there, one check here — no consumer invents items.
11. **Client**: pages under `client/src`, nav entries hidden while the module is off (off = 404 with
    the same body preview shows outsiders — existence is hidden).
12. **Tests + runbook**: unit tests beside the lib; extend `scripts/smoke-all-modules.mjs`; append
    one line to `docs/FORK_RUNBOOK.md` for any new env var, seed or provisioning step.
13. **Ship it OFF.** Absent `module_settings` row = off. Enabling is a deliberate admin act recorded
    in `module_events`. Never seed a lifecycle row in a migration.

## 2. Module-remove recipe

1. **Prefer `off` to deletion.** `setModuleLifecycle(id, "off", …)` already refuses while dependents
   are non-off or `openStateCheck` reports open state ("settle first" guidance, 409). Off routes
   404, nav and admin tabs vanish, variables hide; settlement webhooks keep settling.
2. For genuine removal from a fork's codebase: confirm nothing `requires` it; settle open state;
   delete the `MODULES[]` entry (a leftover `module_settings` row becomes an **orphan** — logged
   loudly at boot, listed in admin, never served); remove its routes, `server/lib` file and client
   pages; remove its capabilities from `shared/capabilities.ts` (both places) and its variables.
3. **Never rename, renumber or delete applied migrations** — the runner dedupes by FILENAME in
   `_migrations_applied`, so a renamed or renumbered applied file is a NEW identity that re-runs
   on existing deployments (and the old name stays recorded). Ledger rows are never deleted.
4. Run the full gate (§4). Expect the brand-refs baseline to need `--update-baseline` if you removed
   ratchet-zone files.

## 3. Invariants you may never violate (and what catches you)

| Invariant | Enforcement point |
|---|---|
| Fiat flows IN only; tokens are never sold back for fiat | No code path exists; do not build one. Legal card copy + `docs/FORK_RUNBOOK.md` state it as product law |
| Hypha-governed tokens (equity, voice) never move here — read-only mirrors | `validateLeg` refuses non-platform governance (`server/lib/ledger.ts` ~206); boot invariant #1 refuses to serve if any hypha ledger row exists (`checkLedgerInvariants` ~575) |
| Conservation: per token, SUM(balances) ≡ 0; cache = recomputation | Boot invariants #3/#4; every post RECOMPUTES both touched rows in-transaction — never increment a balance by hand |
| Non-faucet accounts never overdraft | In-transaction check in `postTransfer`/pair; exceptions only via `allowNegative` + `ALLOW_NEGATIVE_SOURCES` (`stay_night`, `payment_reversal` — static on purpose, ledger.ts line 144); boot invariant #5 catches illegal negatives |
| Every ledger write carries an idempotency key | UNIQUE index is the dedupe; replays return `duplicate: true` |
| A swap is exactly two legs, one transaction, never debt | `postTransferPair` is fixed at two legs; `allowNegative` in a pair is a hard error |
| Recognition never buyable or swappable; faucet-issued tokens never swappable (destination-based test) | Exchange firewalls in `server/lib/exchange.ts` (`assertSwapFirewalls`); exercised by `scripts/smoke-all-modules.mjs` and swap tests |
| One selling module per token | `assertModuleGraph()` THROWS at boot (`server/lib/modules.ts` ~134) |
| Swap-out caps fail closed: 0 means ZERO, never unlimited. The cross-module fiat PURCHASE caps are the OPPOSITE convention — 0 disables the cap (`assertCanPurchase`, `server/lib/payments.ts` ~361). Know which convention you are copying | Exchange cap logic + FORK_RUNBOOK trading table; `assertCanPurchase` for fiat |
| Trading is per-deployment opt-in behind a version-stamped legal card | `exchange` `validateConfig` demands `legalAck {cardVersion, acceptedBy, acceptedAt}` (`shared/modules.ts` ~300) |
| Funds-bearing modules refuse to enable under a shared-password posture | `setModuleLifecycle` guard (`server/lib/modules.ts` ~224) |
| Every module ships OFF; absent row = off | `storedLifecycle` default; boot reconciliation demotes (serves OFF, never bricks) when a hard dep is off |
| No village's brand in platform code | `scripts/check-brand-refs.mjs` fails CI (see §5) |
| Cycles close by human act; seasons roll compute-on-read | Scheduler host header, `server/lib/scheduler.ts` — do not "helpfully" add either |
| A cap that lives outside the ledger is enforced INSIDE the transaction | `PairGuard` (`postTransferPair`) and `TransferGuard` (`postTransfer`). Reading a running total, deciding, then posting several awaits later is check-then-act — two callers read the same stale total and both proceed. Found twice: swap caps and the per-cycle mint cap |
| Every module that holds outstanding value has an `openStateCheck` | Attached at boot in `server/index.ts`. Commerce was the last one missing it: turning it off unmounts the webhook, so an in-flight bank debit had nowhere to land |
| Measured facts are retracted, never deleted | Regen entries (0040) carry `retracted_at`/`retraction_note`/`superseded_by` and drop out of totals. The village carries these numbers to funders — a figure that can vanish without trace is one nobody outside can audit |
| Anonymisation covers rows the users-table tombstone does not reach | `anonymizeMember`. Most identity here is a JOIN and de-attributes for free; what does not is anything that RESTATES the person (skill tags in a public directory) or keeps a live CHANNEL open (push subscriptions, thread subscriptions) |
| "Export everything" means every domain | `/api/profile/export`. It said "everything the village holds about me" and returned eleven of nineteen |

## 4. The gate — run before every commit

```bash
pnpm check                          # tsc --noEmit
node scripts/check-brand-refs.mjs   # the brand guard
pnpm build                          # vite + esbuild -> dist/ (BEFORE test: the loop boots dist/index.js)
pnpm test                           # vitest run — whole suite, no -t filters
```

CI (`.github/workflows/ci.yml`) runs exactly: Typecheck → Brand guard → Build → Test → **Bundle
budget** → **Dependency audit** — the last two BLOCK now, having been advisory for a long time.

- The bundle budget caps the main JS at `MAX_MAIN_JS_KB` (1400 KB; ~1345 KB today). When it goes
  red, split a route (`React.lazy` on `/admin` is the obvious first cut) rather than raising the
  number — a village on rural mobile data pays for every kilobyte.
- `pnpm audit --prod --audit-level high` blocks. An advisory with an upstream fix is FIXED. One
  without a fix goes in `package.json` → `pnpm.auditConfig.ignoreGhsas` **and**
  `docs/SECURITY_ADVISORIES.md` with its reachability reasoning; one without the other is not
  allowed, because an unexplained suppression looks like diligence. Before accepting anything,
  check whether the package is load-bearing at all — the first pass here deleted `axios`, a direct
  dependency with thirteen high advisories that no file imported.

DB-backed suites need `TEST_DATABASE_URL` (scratch schema — the S5 harness DROPs/CREATEs
`village_test`; never the app schema); without it they **skip loudly**, which is not a pass.

A migration that ALTERs a populated table gets
`node scripts/verify-migration-on-data.mjs <first-new-prefix>` — it applies everything up to the
cut, seeds awkward rows, then applies the rest, because production applies migrations at boot,
fail-loud, to tables full of real data.

After deploy: `node scripts/smoke-all-modules.mjs --base … --email … --password …`
(47 checks, ends by asserting per-token conservation).

## 5. White-label rules

- **No brand literals in platform code.** Identity lives in `shared/gameConfig.ts` and the brand
  overlay (the `brand` document in `app_config`, via the Setup Wizard); behaviour in
  `shared/gameVariables.ts`;
  per-deployment data in DB rows and seeds.
- **The guard's three zones** (`scripts/check-brand-refs.mjs`): RATCHET — `server/index.ts`,
  `client/`, `drizzle/`, `vitest.config.ts`, `scripts/`, plus every `*.test.ts(x)` file,
  baseline-capped: counts may only ever DECREASE against `scripts/brand-refs-baseline.json`;
  DECLARED HOMES — exempt (`gameConfig.ts`, `server/seeds/**`, docs, markdown); HARD-CLEAN —
  everything else, where any hit fails. Comments are provenance, counted not failed;
  a genuine false positive gets an inline `brand-ok: <reason>`. After removing references:
  `node scripts/check-brand-refs.mjs --update-baseline`. Forks extend the `BANNED` list with their
  own village's terms.
- **Instance identity** (`server/lib/identity.ts`, S62): a UUID minted once at first boot into
  `app_config`, deliberately not configurable. `PLATFORM_VERSION` is the platform semver (bump MINOR
  for additive endpoint/field changes, MAJOR for anything a peer could break on) — distinct from the
  fork's `BUILD_MARKER`.
- **The handshake**: `GET /api/platform/info` (`server/index.ts` ~4187) returns project name,
  version and enabled modules — the interop surface and the proof no path hardcodes a brand.
- **Launch readiness** is data: `shared/launchRequirements.ts` (copy + grouping, isomorphic) +
  `server/lib/launch.ts` (live checks; `manual:*` items are admin-confirmed, attributed). "Launched"
  is a one-way founder act, never auto-derived.
- **Feedback spine** (S66): `server/lib/feedback.ts` captures locally ALWAYS; the relay
  (`platform.feedback_relay`, on by default) sends CONTENT plus instance identity, never who
  submitted. Queue-and-forget: a down hub is a log line, never a village's problem. Contract in
  `docs/FEEDBACK_HUB_CONTRACT.md`.

## 6. Traps (each one is verified history)

| Trap | Symptom |
|---|---|
| A comment line ending in `;` inside a migration | The runner splits the statement in half — boot fails with a SQL syntax error on a half-statement (0015 learned this; `server/db/migrate.ts` now strips comment lines first, but only FULL comment lines — never end an inline `--` comment with `;`) |
| PowerShell `Set-Content -Encoding utf8` | Double-encodes existing UTF-8 — mojibake in copy, phantom diffs. Use the Write/Edit tools or `Out-File` with care |
| MySQL UNIQUE indexes exempt NULLs | "Deduped" rows duplicate silently. Any dedupe column (e.g. `dedupe_key` in notifications) must be NOT NULL |
| BigInt literals (`123n`) | Break the below-ES2020 build target — use `BigInt()` calls (see `server/lib/exchange.ts` ~454) |
| `vitest -t` filters on the loop test | `server/loop.e2e.test.ts` is ORDER-DEPENDENT — filtering skips setup steps and produces false failures. Run whole files; `fileParallelism: false` is already set |
| Stale `dist/` | The loop test boots `dist/index.js` — without a fresh `pnpm build` you are testing yesterday's server |
| Missing `timezone: 'Z'` on a new mysql2 connection | Timestamps shift six hours; lunar-cycle boundaries drift. Every connection sets it (`server/db/migrate.ts` header) |
| Seeding module lifecycle or every-variable rows in migrations | Freezes defaults forever — both stores are delta-only by design |
| Enabling a module before its hard dependency | Boot reconciliation demotes it straight back to off and the routes 404. `feed` requires `forum`. In a test this reads as an unrelated failure three assertions later |
| `railway up` and the build marker | `railway up` uploads a tarball with no git metadata, so `__BUILD_SHA__` falls back to the literal `dev` and `/health` cannot tell you which commit is live. Verify functionally: fetch `/`, take the hashed `/assets/index-*.js` name, grep the bundle for a string only the new code contains. A container serving at all also proves boot migrations applied, since they are fail-loud |
| `VILLAGE_SECRETS_KEY` set on Railway and still refused | `keyFromEnv` (`server/lib/sealedBox.ts`) answers null for a malformed value exactly as for a missing one: quotes, a pasted `NAME=`, base64, a wrong length. `describeKeyEnv` and `keyEnvSentence` beside it name which, never any of the value, and that sentence leads the `[secrets]` and `[identity]` boot lines, the Admin, Integrations banner and the launch row. Still "not set" means the variable is on the wrong service (the database) or the deploy carrying it is not Active yet. `docs/FORK_RUNBOOK.md`, "Setting VILLAGE_SECRETS_KEY on Railway, and when it is set but still refused" |
| An `onClick` on an SVG shape | Mouse-only: no focus, no keyboard, nothing announced. Needs `role="button"`, `tabIndex={0}`, an `aria-label` and an Enter/Space handler — the village map shipped this way and could not be used without a mouse |
| A `title` attribute as the only label on a touch surface | `title` is a hover tooltip and a phone has no hover. An icon-only control needs a real label and, if it must stay icon-only, a press-and-hold affordance (see `AdminNav` and `client/src/lib/gestures.ts`) |
| A 44px tap-target rule that lists `button` but not `a[href]` | Every link keeps whatever hit area its text gives it, and individual small targets get raised one at a time forever instead of the rule being fixed once. Exclude prose links (`p a`, `li a`) or paragraphs stack invisible boxes |

## 7. Finishing a feature — the half-built failure mode

The gate proves the code compiles, builds and passes. It does not prove the feature EXISTS for
anyone. A sweep of this codebase found the same shape over and over: a server that writes and no
reader, an API that supports a parameter no client sends, a queue of raw ids no human could act on.
Every one passed CI for months.

Before calling a feature done, answer all five:

1. **Does something read what this writes?** `module_events` recorded every lifecycle change and had
   no reader anywhere. The library's item journal appended on every intake, pickup and settlement and
   was never read back. A write-only table is a feature nobody has.
2. **Does the client send what the server accepts?** The feed supported `?tag`, `?kind` and `?before`
   from the day it shipped; the page sent none of them, so it was frozen at the newest twenty items.
3. **Can a human act on what the endpoint returns?** The moderation queue returned `thread_id` and
   `reporter_id`. That is why no surface was ever built on it — join the title and the name, or the
   endpoint stays theoretical.
4. **Can the person who should do this actually do it?** Logging the land's measurements was
   admin-only, so the land steward either never recorded anything or was handed admin. When a task
   belongs to a role, it needs a capability, not a password.
5. **Is every number on the screen real?** A profile rendered "Coming Soon", "Exploring" and "0"
   styled exactly like the live metrics beside them. Numbers that cannot change teach people not to
   trust the ones that can. Show the real figure or say plainly that it is not built.

## 8. Boot order (what a fork's server proves before serving)

Migrations apply (fail-loud) → token registry loads from the `tokens` table → module tokens ensured
→ `checkLedgerInvariants` (refuses to serve on any violation; the healthy log line is
`[ledger] invariants hold`) → store caches fill → scheduler jobs register → module settings load,
graph reconciles loudly, `assertModuleGraph()` asserts one-seller-per-token → openStateChecks attach
→ routes mount. All in `startServer()`, `server/index.ts` ~1845. Anything you add must respect this
ordering: registries before invariants, invariants before routes.