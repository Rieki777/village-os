# Village OS — Master Plan (v3, unified & hardened)

**Created:** 2026-07-26 (v1: module designs + critiques). **v2:** same day — the
foundation session was stopped and handed off; one session now builds everything.
**v3:** same day — v2 was itself attacked by five adversarial reviewers (facts,
sequencing, traps-compliance, gaps, cold-read executability; 58 findings) and this
revision folds every accepted fix in. 53 tests green at the commit introducing this
revision; the enum→registry ledger fix is committed (`339a093`) and applied live.

**Precedence, read carefully:**
- **Part 3 of this document supersedes ALL earlier build orders** — the foundation
  plan's phases, the handoff's §4 sequence, and the critiques' 42-session
  parallel-track plan. Those documents remain authoritative for **traps, findings,
  locked decisions, and specs** — not for ordering.
- The foundation upgrade plan (an internal note, in the maintainers' private operations repository since 2026-10-02) is superseded **in its build order only**: its
  locked decisions (revisions 2–3), its explicitly-NOT-ported list, and its
  codebase traps remain binding. Its status tables are stale — trust this document.
- Where a module spec in `docs/modules/*.md` contradicts Part 2 here or a fix in
  the two CRITIQUE files, **the fix wins**; the specs are deliberately left
  unedited as design references.

**Reading order for any session picking this up:**
1. This document, whole.
2. The 2026-07-26 foundation handoff §3, the traps (an internal note, in the maintainers' private operations repository since 2026-10-02). Twice.
3. `docs/modules/<module>.md` + both `docs/modules/CRITIQUE-*.md` findings for
   whatever you are building.
4. The foundation upgrade plan rev 2–3 for locked-decision context, and the
   2026-07-17 foundation levers fix list for the F1–F16 levers (an internal note, in the maintainers' private operations repository since 2026-10-02).

## What this is

The 2020 village-demo deck sketched a village operating system with live Hypha tech
woven into an imagined whole. Six years later the split is clean: **everything
governance-shaped is Hypha's job** (each village configures its DHO URL; we
deep-link, never rebuild), and **what remains is the village coordination layer** —
admin-toggleable modules on one ledger, one gate, one config story:

| Deck | Module | Spec |
|---|---|---|
| substrate | Module framework (lifecycle, toggles, Hypha links) | `docs/modules/module-framework.md` |
| substrate | Token registry + ledger (keystone) | `docs/modules/token-registry-ledger.md` |
| 25+26 | Internal exchange (buy closed-loop credits; swap deferred) | `docs/modules/internal-exchange.md` |
| 32 | Stays / accommodation payments | `docs/modules/stays.md` |
| 33 | Material library (flagship) | `docs/modules/material-library.md` |
| 28 | Village map + coordination concierge | `docs/modules/village-map.md` |
| 30 | Tools hub | `docs/modules/tools-hub.md` |
| 31 | Gratitude feed (a forum lens, hearts pay real budget) | `docs/modules/gratitude-feed.md` |
| 34 | Village health dashboard | `docs/modules/health-dashboard.md` |
| 38 | Badges | `docs/modules/badges.md` |
| 43–45 | Crowdpool commitments dashboard (deferred to trigger) | `docs/modules/crowdpool-dashboard.md` |

Every module ships **OFF by default**, enabled per deployment through a lifecycle
(off → admin-preview → members-only → public), config-driven, zero village brand in
platform files.

---

# Part 1 — Ground truth (re-verified during the v3 hardening pass)

- **Shipped and committed:** loop e2e test (boots `dist/index.js`, walks
  register→path→claim→submit→consent→gratitude→wall→pulse→progression; **currently
  authenticates admin steps with the shared password — S1 deliberately rewrites
  that plumbing**); consent-requires-submission; lunar cycles + idempotent close
  (settlement audit — **credits nobody**); roles as data + `role_holders` +
  `shared/capabilities.ts` (stage unlock OR role grant); the variables layer —
  **API-only**: `GET /api/admin/variables`, `PUT /api/admin/variables/:key`,
  `GET /api/game/rules` exist and are loop-tested, but **no editor UI exists
  anywhere** (the "Variables" tab on `/journey-to-launch` is an unrelated
  copy-placeholder sheet — do not wire it to game variables); stage events; quest
  reward ranges (`shared/questRewards.ts` is the ONLY parser); token ledger
  (`server/lib/ledger.ts`, JSON-backed, recompute-never-increment, idempotency
  keys, hypha-mint refusal) with `hearts_balance → recognition_balance`; **runtime
  token registry** — `tokens` table live in MySQL, `token_type` varchar(32),
  fail-loud slug guard; note the in-process registry currently mirrors the 0006
  seeds from a hardcoded constant — **wiring `creditTokens` to read the `tokens`
  table is part of the ledger-domain conversion (S7–S9)**; repository seam
  (`server/repos/*`: bespoke `usersRepo`, generic `collectionRepo`/`documentRepo`;
  zero `readJson`/`writeJson` **call sites** remain in `server/index.ts` — the two
  dead definitions still exist and can be deleted in passing).
- **Database:** MySQL live on Railway private network, migrations 0001–0006
  applied, `scripts/run-migration.ts --status|--all`, `pnpm db:migrate|db:status|
  db:import`. **The app still reads JSON** through synchronous repos; `data/` is
  volume-mounted and authoritative; `token_ledger` has 0 rows.
- **Identity columns exist unused:** `users.role`, `users.handle`,
  `users.wallet_address`, `users.wallet_verified_at` (0003) — **MySQL columns only;
  nothing reads them, and the app's user records live in JSON until S6.** S1 lands
  identity on the JSON usersRepo; the columns receive values at the S6 cutover.
- **Admin auth is one shared password** (`requireAdmin`, ~70 inline call sites;
  `Admin.tsx` threads a password prop through ~15 tabs / 40+ fetches). Legacy
  `?password=` auth is gone (header-only, verified). `/journey-to-launch` sits
  behind a second shared password (`requireJourney`, 4 routes).
- **No admin UI exists for:** role holders (API `POST /api/admin/roles/:id/holders`
  works and is loop-tested — appointing currently requires curl), game variables
  (API-only, above), admin accounts (concept doesn't exist yet).
- **Tests:** 53 across 4 files (loop 17, ledger 14, usersRepo 12, lunar 10);
  `pnpm check && pnpm build && pnpm test` before every commit. The loop test is
  the veto (rule 2.1 #1) — **on behavior, not on its literal auth plumbing**.
- **Ops reality:** pushing `main` auto-deploys production; **no CI exists** (no
  .github/workflows), no staging, no error tracking, no scheduler/cron (season
  "auto-rollover" is compute-on-read by date, not a job); rate limiting and the AI
  daily cap are in-memory and reset on every deploy; email is fire-and-forget.
- **This session's earlier product work, live:** Maia unified proposals, seasons
  (list + rollover-by-read + goals + timezone), sharp image uploads, admin
  "Project Settings" posture, milestones staleness nudges, mobile FAB/tab bar.
- **Production:** healthy, cycle 328, 14 quests. One manual volume backup:
  `Desktop/Amora/backups/amora-data-2026-07-26_000010.tar.gz`; importer replays
  JSON (`--dir`). **No MySQL backup story exists yet** (S12 fixes this).

---

# Part 2 — Standing rules

Merged non-negotiables: foundation ground rules, handoff traps, critique fixes.
Every session inherits all of them. **Where a fix names an owning session, that
session's acceptance includes it** — standing rules with no home get skipped.

## 2.1 Product rules

1. **The loop test is the acceptance criterion** — for the *behavior* it protects.
   Sessions that change auth or storage are expected to grow/rewrite its plumbing
   (S1 explicitly does); what may never regress is the loop itself.
2. **No village's brand in platform code.** Identity in `shared/gameConfig.ts`,
   behaviour in `shared/gameVariables.ts`, per-deployment data in DB rows/seeds.
3. **Gratitude economics follow the ReGen Civics model (Rye directive,
   2026-07-26 — supersedes revision 3's settlement-audit-only close and this
   rule's earlier wording).** Recognition is the SIGNAL: sends stay budgeted,
   message-required, capped per recipient, and recognition points move at send
   exactly as before — but recognition is never the value. VALUE arrives at
   cycle close: an admin-sized pool (`gratitude.pool_per_cycle`) of a separate,
   admin-named platform token (`gratitude.pool_token`, per-module tokens per
   Gate D; default "Village Credits") distributes to recipients ∝ recognition
   received that lunation, floored, idempotent per (cycle, member). Admins set
   the pool size and the sending budget ("full value sends" =
   `gratitude.base_budget` × stage multiplier). The double-pay trap (3.1) is
   restated, not retired: **value pays exactly once, in exactly one token, at
   exactly one moment (close); the pool token can never be the recognition
   token (fail-loud at close); recognition stays unbuyable and unsellable.**
   Mechanics reference: the 2026-07-17 foundation levers fix list §1.1a (private operations repository).
4. **The ledger recomputes, never increments; every write carries an idempotency
   key;** hypha-governed tokens are un-mintable; unknown token slugs fail loud.
5. **One gate** (`shared/capabilities.ts`): stage unlock OR role grant; badges add
   the third source in their own exclusive session. Never a parallel path.
6. **Hypha boundary:** governance, voting, equity, anything share-like → the
   configured DHO via the single `hypha.org_url` home + `<HyphaLink>`. Read and
   display; never mint, move, or price.
7. **i18n posture (decided):** English-only UI is an explicit v1 non-goal, but
   from the module framework (S13) onward, module UI copy goes through a
   per-module strings object so extraction stays cheap. Revisit at S56.
8. **Interop posture (Rye, 2026-07-26): design principle only, no cross-village
   features yet.** Every fork keeps: stable public slugs/ids, a versioned
   `GET /api/platform/info` (name, version, enabled modules — lands with the
   framework S13), documented export formats, and config shapes that inherit
   platform upgrades (delta-only storage everywhere). Village directory,
   cross-village balances, and shared identity become possible later without
   migrations because of this rule — none are built now.

## 2.2 Economy invariants (build-blocking; owning sessions named)

1. **Per-source-event single payout** — while any token pays at send, no release
   job may weight on that token's send/ack rows when crediting ANY token. Pinned
   test in **S7**: one ack row funds at most one ledger credit, ever.
2. **No swappable/purchasable faucet tokens** (boot assertion, **S33**);
   library-credit seeds non-swappable.
3. **One selling module per token** (boot assertion, **S13** framework +
   consumed by S33).
4. **Non-negative system accounts except declared faucets** (**S7**); steward
   reward = min(pct × inflow, pool balance); cycle attribution by stamping cycleId
   on ledger rows at write time, never timestamp windows.
5. **No per-token balance columns on `users` — ever.** Balances read the
   keystone's `token_balances` recomputed cache. Strike `users.stayCreditBalance`
   / `users.library_credit_balance` from the Stays/Library specs when building.
6. **System accounts are never rows in `users`** (no `sys-treasury` fake members),
   regardless of the Gate A outcome — `ensureSystemAccount()` / `ledger_accounts`
   only (**S7**).
7. **Intake mint controls** (library, **S41+**): award ≤ 100% of appraisal,
   per-member per-cycle mint cap, dual sign-off above a threshold, high-value
   escrow covered by non-intake credits, supply-vs-backing red flag from day one.
8. **One terminal settle per loan** (`loan:{id}:settle`, row-locked settleLoan(),
   **S41+**); escrow account reconciles to SUM(open loans) at all times.
9. **Sybil eligibility filter** — breadth/recognition metrics and badge rules
   count only senders at stage ≥ member or with ≥ 1 consented quest. Ships as a
   shared helper **with the feed hearts (S27)**; badges (S37+) consume it, never
   re-implement. Capability-bearing badges key on quest-consent metrics only.
10. **Fiat trio before any fiat module** (**S32**): one `server/lib/payments.ts`;
    ONE raw-body Stripe webhook route mounted before `express.json()`, dispatching
    on metadata, **exempt from module-off 404s**; dispute/chargeback handling in
    v1 (reversal entries may go negative + auto-suspend + admin queue); one
    cross-module per-member purchase-limit helper. Rounding favors the treasury;
    A→B→A no-profit property test; positional idempotency leg keys
    (`ord:{id}:leg{n}`).
11. **Admin power is bounded:** per-admin identities (S1) AND
    `ledger.admin_mint_cycle_cap` (aggregate per lunar cycle across all mints,
    **S8**) beside the per-call cap.
12. **Ops readiness is a go-live precondition for funds-bearing modules,** equal
    in rank to #11: tested MySQL backup+restore (S12), CI gating main (S0), error
    tracking + webhook/settlement failure alerts (S32 rider). The framework's
    legal caution card **refuses** enablement without #11 and this.
13. **Module disable respects open economic state** — `openStateCheck()` on
    ModuleDef (**S13**); settlement webhooks exempt from module-off 404s (**S32**).
14. **Preview-lifecycle leak guard** — module activity emits via
    `moduleActivity(moduleId, …)` (**S13**).
15. **Exchange consolidation details** (from the two-registries fix, **S33**):
    commerce flags live in a satellite `token_exchange_settings` keyed on
    `tokens.slug`; the kind vocabulary is the keystone's
    (recognition|credit|ticket|equity|voice — `governance='hypha'` subsumes
    "external"); `currency_prices` survives pointed at the tokens registry.

## 2.3 Verification & infra discipline (traps as policy)

- A green suite says nothing about lines no test exercises; before trusting green,
  ask what covers your change; drive uncovered endpoints by hand (trap 3.2).
- When you assert a refusal, check **which guard fired**; always include a control
  case that must SUCCEED (trap 3.3).
- Behaviour-preserving refactors: bump the `/health` build marker for deploy-level
  proof (trap 3.4).
- Row counts prove nothing about column fidelity — every domain added to the
  importer gets value-level checks (trap 3.5). **S6 adds role/handle checks for
  the S1-era fields.**
- Quest rewards parse only in `shared/questRewards.ts` (trap 3.6). No regex over
  brace structures (trap 3.7). Before fixing anything a tool reports, confirm a
  user can experience it (trap 3.8).
- **Every mysql2 connection sets `timezone: 'Z'`** — none do today (the runner and
  the importer both run at 'local'; the importer is the blessed restore path, so a
  replay on this UTC-6 machine would shift every timestamp). **Fix both scripts in
  S5**, and the restore drill (S12) asserts a round-tripped timestamp value.
- Idempotency keys: **widen `idempotency_key` to varchar(191) during the S7
  cutover** (concatenated multi-leg keys exceed 160; truncation silently merges
  keys and drops a swap leg).
- Pushing `main` deploys production — land non-deploy work on `claude/*` branches;
  after S0, main is CI-gated.
- **If another session is ever active in this tree again:** never stage a shared
  file wholesale; assemble commits from a worktree cut off fresh `origin/main`
  re-applying only your own edits. (Single-session today; the rule outlives the
  era because it has already saved this repo once.)
- Fresh worktrees: `pnpm install --frozen-lockfile`; never junction
  `node_modules`. `py`, not `python3`. Railway volume CLI lies without 2FA —
  verify, don't trust exit codes. Ids are varchar(64), so composite keys run long.
- **Back up before conversions:** the volume tarball before each Block 2 domain
  cutover; from S12 on, scheduled MySQL dumps with a **tested** restore.

## 2.4 Design decisions carried (v1, unchanged)

D1 one ledger spec (keystone owns all token DDL) · D2 one module framework
(lifecycle in `module_settings`, never game variables; tools-hub demoted to
reference consumer) · D3 one Hypha home · D4 event spine before modules · D5 feed
is a forum lens (riders baked into the forum session) · **D6 (updated per Gate B):
exchange v1 is buy-only; internal token↔token trading ships as the exchange's
explicit opt-in capability (S33+ builds it OFF-by-default rather than deferring it
indefinitely) — treasury-as-counterparty at admin-posted prices, never an AMM,
never fiat-out, faucet tokens never swappable** · D7 crowdpool deferred to
trigger, `crowdpool.fulfill_recognition` deleted.

## 2.5 Known live hazards (inherited from the foundation plan's v1 list — still
live, each with its kill-point)

| Hazard | Dies at |
|---|---|
| No dev API proxy in `vite.config.ts` (`pnpm dev` = SPA with no backend) | **S0** (ten-minute fix) |
| No login/admin-attempt throttling; shared password brute-forceable | **S1** (throttle rider) |
| No session revocation for 30-day member tokens | **S1** (`tokenVersion` on the user record) |
| `questIdFromTitle()` derives quest ids client-side; a rename breaks claims | **S10** (quests domain conversion adds real id references) |
| Rate-limit + AI-cap state in-memory, resets per deploy, per-process | **S12** (state moves to MySQL with the last domains) |
| `readJson` returns null on corrupt files (corrupt = silently empty) | **S12** (data/ stops being read) |
| No client code splitting; bundle grows monotonically with 11 modules | **S13** (framework registers module routes as `lazy()` chunks; CI bundle line from S0) |
| Stale statuses in older planning docs | **S0** (supersession banners added to both docs) |

---

# Part 3 — The build order

One session ≈ one focused block shipping a deployable increment that leaves
`pnpm check && pnpm build && pnpm test` green. Strictly ordered; the two things
everything waits on come first: **identity** and **storage truth**. Honest total:
**~56 sessions** (the v2 "~50" hid compression the reviewers priced).

## Block 0 — Ops bootstrap

**S0.** GitHub Actions running check/build/test on every push; branch protection
on `main` so the deploy branch is CI-gated; `pnpm audit` in CI; bundle-size line
in CI output; the vite dev proxy (hazard table); supersession banners on
The foundation upgrade plan and the handoff, both in the private operations repository ("decisions stand; statuses
and build orders are stale — see MODULES_MASTER_PLAN.md"). Half a session, pays
for itself by S6.

## Block 1 — Identity & founder self-service

**S1. Admin identities (auth).** Fully specified so nothing is guessed:
- **Storage:** lands on the **JSON usersRepo** (`role`, `tokenVersion` fields +
  seeds). Do NOT read the 0003 MySQL columns — they receive values at S6.
- **Roles (template concept, Rye 2026-07-26):** `role ∈ member | admin |
  founder`. **Founder is the master-admin tier every fork inherits:** implies
  admin everywhere (`requireAdmin` accepts both), can promote/demote admins,
  cannot be demoted by non-founders, and the last founder cannot be demoted at
  all. Amora's founder: **rieki.cordon@gmail.com**.
- **Mechanism:** `requireAdmin(req)` = valid member token AND role in
  (admin, founder). **While zero admins/founders exist**, `POST
  /api/admin/bootstrap {password, email, name?}` (password = current
  `ADMIN_PASSWORD`) makes that account the **founder** — elevating the member if
  one exists with that email, or **creating the account and emailing a
  short-lived signed set-password link** (Resend is live; if email fails the
  claim link is returned to the operator). Self-sequencing rollout: the same
  deploy is safe on production because the password authenticates nothing once
  a founder exists. `BREAK_GLASS_ADMIN_EMAIL` env var can re-elevate only that
  account. After bootstrap on prod is verified (an admin-token mutation
  succeeds), `ADMIN_PASSWORD` is deleted from Railway. The set-password token
  path doubles as the platform's password-reset primitive later.
- **Client:** `Admin.tsx` PasswordGate becomes a login-aware gate (logged out →
  member login; non-admin → refusal screen); all tabs drop the password prop for
  standard member-token `authHeaders`. No dual-accept window except bootstrap.
- **Audit home (decided):** S1 ships a minimal `admin_audit` collection behind
  `collectionRepo` (`{at, actorUserId, action, targetType, targetId}`); **S11's
  `recordEvent()` subsumes it** (rows become health_events with actorId). Every
  admin mutation writes one.
- **Riders:** login/bootstrap throttling; `tokenVersion` so one member's sessions
  can be revoked; the loop test **grows** (bootstraps an admin inside the run,
  consents via admin token, asserts the audit row — rule 2.1 #1 note applies).
- **Acceptance:** every admin surface works via an admin account on production;
  an audit row names a real user; the shared password authenticates nothing.

**S2. Handles + admin management + journey gate.** `users.handle` (backfilled
from name, unique, member-editable — the thing @mentions and audit views show;
emails never leak); admin management UI (list/promote/demote with provenance);
**`/journey-to-launch` migrates from `JOURNEY_PASSWORD` to the admin/founder
check and the second shared password is retired** (S48 later adds economics to
that page — it must not sit behind a shared secret).

**S3. Founder self-service.** Roles holder management UI on `/admin` over the
tested API (appointment enforces the stage-floor check the API already applies),
and **build the game-variables editor from scratch** on `/admin` (list by
category, typed inputs, bounds from `validateVariable`, change reasons) — none
exists anywhere today. Acceptance: founder appoints/removes a role holder and
edits one variable end-to-end on `/admin` with an admin account; both write
audit rows; no curl.

**S4. Profiles.** The page over the live endpoints (progression, gratitude
flows, ledger, balances). Zero dependencies; pulled forward from the v2 plan's
S11 — first member-visible ship, and it freezes a regression surface over the
exact read endpoints Block 2 must keep stable.

## Block 2 — Storage truth

**S5. Test-DB harness (prelude — the loop-test gate depends on it).** Ephemeral
MySQL strategy for vitest (local/docker or a dedicated scratch database;
migrations 0001–000N run in setup; `DATABASE_URL` override joins the `DATA_DIR`
override), baseline redefined; **`timezone: 'Z'` added to the migration runner
and importer connections** (2.3). Without this session, S6 has no gate.

**S6. Users domain conversion.** Async usersRepo over MySQL; importer value
checks for role/handle/tokenVersion (trap 3.5); volume backup first; loop test
green against the DB; routes split out as they move (the index.ts split runs
through all of Block 2, not after it).

**S7–S9. The ledger keystone (Gate A executed here — see Part 5).**
- **S7:** `ledger_accounts` (+`faucet` flag) + transfer-row `token_ledger` +
  `token_balances` cache + `postTransfer()` + `ensureSystemAccount()`; registry
  wired to the `tokens` TABLE (replacing the in-memory mirror);
  `idempotency_key` → varchar(191); byte-exact idempotency-preserving import
  (existing entries become transfers from their source faucets); boot invariants
  (hypha-never-mints, per-source-event single payout — the pinned double-pay
  test); conservation test: per-token global SUM ≡ 0 with faucets declared.
- **S8:** gratitude domain conversion through the final ledger API; the **D5
  riders** in one migration (`gratitude_log` kind/contextType/contextRef, the
  `(from_id, context_ref, kind)` unique heart index, int cycle FK +
  `legacy_cycle_month` cleanup); `sendGratitude()` extracted as the one service
  wall and future hearts both call; `ledger.admin_mint_cycle_cap` variable.
- **S9:** Tokens + Ledger admin tabs, reconciliation panel (cache-vs-SUM drift,
  per-token conservation, system-account balances) — the keystone scope v2
  silently dropped.

**S10. Quests/claims conversion.** Consent rewires through `postTransfer()`
**once** (this is why the ledger precedes it); quest ids become real references
(kills `questIdFromTitle`, hazard table); importer column checks (the reward-range
lesson lives here — trap 3.5's original victim).

**S11. Event spine = the activity domain conversion.** `recordEvent()` +
`health_events` (DB-native) + actor/entity columns; ALL `addActivity` call sites
converted (10 today — count at build time, it drifts); Pulse endpoint cutover;
`admin_audit` subsumed; backup + fidelity checks like any domain. This is
deliberately right after S10 — every session it waits is actor-attributed data
lost forever, and S49's dashboard needs lunations of it.

**S12. Remaining domains + the authority flip.** Everything left, enumerated:
`roles`, `role_holders`, `stage_events` (capability hot path — one session's
care), `milestones`, `training_modules`, `investor_docs`, `submissions`,
`journey` state, seasons + the config documents. **Only after this session:**
`data/` stops being authoritative (JSON becomes export format); rate-limit/AI-cap
state moves to MySQL; **scheduled `mysqldump` cadence starts (Railway cron or
external — do not wait for S16's app scheduler) and one restore drill is executed
against a scratch DB and documented, asserting a round-tripped timestamp.**

## Block 3 — Module substrate

**S13–S14. Module framework v1.** `module_settings` (DB-native) + lifecycle +
`requireModule` + boot dependency reconciliation + **`openStateCheck()`** +
**`moduleActivity()`** + module routes as `lazy()` chunks + per-module strings
objects (2.1 #7) + Admin Modules tab + `hypha.*` variables + `shared/hypha.ts` +
`<HyphaLink>` + the CoCreatorsGuide `[YOUR-DHO-SLUG]` fix + the one-selling-
module boot assertion + legal caution cards that **refuse** funds-bearing
enablement without 2.2 #11–#12.

**S15. Tools hub** as the framework's reference consumer (registry CRUD,
audience visibility, click beacon, SSRF-guarded link check).

## Block 4 — Communication spine (moved ahead of the map so the map consumes it)

**S16–S17. Notification spine + scheduler.** `insertNotification` with
dedupeKey; precedence rule (mention > direct reply > follow) and caps ported
from regen (leave forum-notify.ts behind — foundation plan rule); prefs live
on the user record (the map's contact opt-out will be one of these prefs, not a
bespoke flag); email + web push; the cron host (which also absorbs nothing from
seasons — rollover stays compute-on-read; say so to prevent "helpful"
migration).

**S18. Data lifecycle.** Retention variables + scheduler sweeps for contact
messages, concierge queries, notifications; member data export; account
deletion path that anonymizes actor references and **never deletes value rows**
(ledger entries persist, actor becomes a tombstone). Gate F's legal scope
explicitly includes data protection (Costa Rica Law 8968) — every fork inherits
this posture.

## Block 5 — Coordination surfaces

**S19–S23. Village map v1** (5 sessions per spec): circles as data + alias
reconciliation; deterministic radial map; mobile accordion; raise-your-hand on
vacant roles; contact relay **consuming S16 prefs + insertNotification**
(Reply-To disclosure in the compose UI); deterministic-first concierge with the
`coordination` Maia kind; unmatched queries logged as demand signal.

**S24–S26. Forum + decision primitive.** Written fresh, shipped AS a module,
**with the D5 riders** (thread kind/meta/imageUrl/heartCount, tags, reports);
@mentions use `handle` from S2; notifications via S16.

**S27–S29. Gratitude feed v1.** The forum lens; hearts are real budgeted sends
through `sendGratitude()`; **the shared Sybil eligibility helper ships here**
(2.2 #9); settlement report splits heart totals from acknowledgment totals (the
founders carry it to Hypha — don't blend channels silently).

## Block 6 — The village economy (gated on S1 + Gates B/D; Gate F engaged since ~S16)

**S30–S32. Stays v1** (3 sessions; S32 = the fiat trio built ONCE + the
webhook module-off exemption + the ops-readiness rider: error tracker wired,
alerts on webhook signature/settlement failures and health-check regression,
payment-path request log — 2.2 #12 verified before go-live).
**S33–S35. Exchange v1, buy-only** (consumes the trio; 2.2 #15 consolidation).
**S36. Badges gate session** — capabilities grant/deny semantics, exclusive,
heavily tested, Rye signs off deny-beats-role-grant (Gate E).
**S37–S40. Badges v1** (earned engine reads settled events only; consumes the
Sybil helper).
**S41–S46. Material library v1** (6 sessions per spec; real transactions,
single settleLoan(), intake controls, pool non-negativity, reservation no-show
strikes, dispute deadlines with default outcomes).

## Block 7 — Money legibility & steering

**S47. Economics section.** Base reads for Amora/Voice — `decimals()`,
fixed-point storage, **null on RPC failure, never zero**; balances only against
`wallet_verified_at` bindings (signed-message challenge).
**S48. Command centre.** Extend `/journey-to-launch` (admin-gated since S2)
with founder economics: cycle settlement report, module health, pending
consents, stale milestones. Never a second command centre.
**S49–S51. Health dashboard remainder.** Snapshots at cycle close, regen
metrics entry, dashboard page + season-goals overlay. **Calendar guard:** if
fewer than ~3 lunations of health_events exist when this comes up, run Block 8
first and return — the automation pipeline doesn't need the dashboard.

## Block 8 — Exit, automation, extraction

**S52. Member exit (F12 — Rye's "exit from the get-go").** openStateCheck
semantics applied to a departing member: enumerate open loans/stays/roles/
balances, define settlement, restorative-flow hooks per the F12 spec. Scheduled
here because Blocks 5–6 create the state that makes exit painful; it must exist
before the community is big enough to need it.
**S53–S55. Automation pipeline.** Recording → transcript → LLM synthesis →
forum thread → role-targeted proposals. Evidence rule verbatim (quote +
timestamp or dropped); deterministic first; suggestions never timer-mutations;
backpressure; write-once AI bodies.
**S56+. Extract Custom-Game-Foundation.** The CI brand-reference guard, plus
the **fork onboarding runbook** as a first-class deliverable: provision → env
(the full var list, incl. AUTH_TOKEN_SECRET's silent-degrade warning) → seeds →
brand overlay → DHO config → token naming (Gate D) → smoke test. **Standing
rule starting NOW: every session that adds an env var or seed appends one line
to `docs/FORK_RUNBOOK.md`** so S56 assembles rather than reverse-engineers.

**Deferred, with triggers:** crowdpool (a passed regen-civics campaign + the
webhook/export contract in that repo — pre-agree only the material-library
draft-item back-ref shape); exchange swap (demand); module v2s (demand); AI
forum elders (Rye's call).

**Milestones:** founders self-sufficient after S3; first member-visible ship S4;
storage truth done S12; first module S15; first money-touching ship S32. The
live loop never stops running while this builds underneath.

---

# Part 4 — The definition of done (the extended loop)

One end-to-end run in `server/loop.e2e.test.ts`, growing with each block:

> Register → declare a path → claim → submit → consent (by an **admin member
> token**) → Gratitude lands → send to a peer → **a heart on a feed post moves
> real budget** → cycle closes (credits nobody; settlement report splits hearts
> from acknowledgments) → a stage advances and **unlocks a capability refused
> earlier in the same run** → a role-targeted notification reaches one member
> and not another → the economics endpoint returns last-known-with-staleness
> (never zero) when the RPC is stubbed to fail → **an admin action writes an
> audit row naming a real user** → **a module at preview is invisible to a
> member and its activity leaks nothing** → **a library loan settles exactly
> once though two terminal paths race** → **per-token conservation sums to zero
> with faucets declared**.

The conservation assertion presumes Gate A's recommended shape — see Part 5;
the gate and this run are not allowed to disagree silently.

---

# Part 5 — Decision gates (ALL RATIFIED by Rye, 2026-07-26)

| Gate | Decision |
|---|---|
| ~~0~~ | enum → registry — **DONE** (`339a093`, live) |
| ~~C~~ | per-admin identities — **ABSORBED into S1** |
| **A** | **RATIFIED: `ledger_accounts` + transfer rows + faucet flag.** S7 builds it; rules 2.2 #1/#4/#6/#8 and Part 4's conservation assertion stand as written. |
| **B** | **RATIFIED, refined:** Base-governed tokens (equity, Voice, anything Hypha mints) NEVER trade here — read-only display; they trade on Base/Coinbase-connected exchanges. **Platform-governed tokens (our DB) CAN trade token↔token internally — but internal trading is a separate opt-in capability, OFF by default,** enabled explicitly per deployment with the legal caution card. The deployment declares each token's value semantics (`kind`: share-like / utility / credit / etc.) — the platform provides capability, the village owns the meaning and the legal posture. Invariant 2.2 #2 (no swappable faucet tokens) holds even when trading is enabled. |
| **C2** | **RATIFIED (fiat direction): fiat flows IN only.** Tokens can be BOUGHT with national currency (Stripe + **Zeffy** — learn the Zeffy pattern from core.regencivics.earth's existing integration, else link-out + admin reconcile); tokens can NEVER be sold for fiat on the platform (cash-out is Hypha/Base's job). Once bought, tokens trade internally per Gate B. `payments.ts` is provider-agnostic from day one: stripe + zeffy adapters over one idempotent order path. |
| **D** | **RATIFIED: per-module tokens.** Each module's enable/configure flow includes naming its token(s) — registry rows are created at module-enable time with admin-chosen names. No shared credit token. |
| E | Deny-beats-role-grant for warning badges — pending, decide by S36 |
| F | Legal review (CR 13% IVA lodging, consumer refund, gift-certificate/escheatment, **Law 8968 data protection**) — **engage counsel around S16** |

---

# Handoff Breakdown — Who Does What

### YOU (Rye)

| # | Task | Why only you | When |
|---|---|---|---|
| 1 | Ratify (or priced-veto) Gate A; answer B, D, E; engage F counsel | Product/governance/legal | A by S7; B/D before Block 6; E by S36; F around S16 |
| 2 | Delete two orphaned MySQL volumes: `mysql-volume-PSJY`, `mysql-volume-Jin7` — **924MB each (~1.85GB billed)**, invisible on the canvas (no attached service); `railway volume list` shows them; the CLI's delete lies without 2FA | Dashboard + 2FA | Any time — it's live billing |
| 3 | Confirm your Hypha DHO deep-link URL shapes | Your Hypha org | Before S14 |
| 4 | regen-civics crowdpool contract (or let the spec drive it) | Cross-repo call | When a campaign approaches |

### CLAUDE CODE — in order

| # | Task | Status |
|---|---|---|
| 0 | Absorb the foundation handoff; commit the enum fix on their ledger base; verify 53 green | **DONE** (`339a093`) |
| 1 | v3 of this plan (5-reviewer hardening pass, 58 findings folded) | DONE |
| 2 | S0 → S1 → … per Part 3 | READY — S0/S1 are unblocked now |

### WAITING ON YOU

- Nothing before S7 except Gate A's ratification (recommended default already
  encoded; a veto is the only thing that changes course).
- B/D before Block 6; E before S36; F engaged ~S16.
