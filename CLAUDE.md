# CLAUDE.md

**game-amora** is a white-label village-coordination platform: React 19 + Vite + wouter client
in `client/src`, one large Express server (`server/index.ts` + `server/lib/*`), MySQL with
hand-written SQL migrations in `drizzle/` that a custom runner applies **at boot, fail-loud**
(`server/db/migrate.ts`). Villages fork this repo; "Amora" is only the first tenant. Platform
code carries no village's brand — that rule is enforced mechanically (see Gates).

## Reading order

1. `docs/ARCHITECTURE.md` — the system map. Read it before touching anything.
2. `docs/modules/` — the contract for whichever module you are changing. Filenames do not
   follow module ids; `MODULE_DOCS` in `server/lib/knowledge.ts` is the mapping, in both
   directions, and some modules have no doc.
3. `docs/FORK_RUNBOOK.md` — provisioning, env vars, seeds. **Any session that adds an env var,
   seed, or provisioning step appends one line there, same session.**
4. `docs/FEEDBACK_HUB_CONTRACT.md` — only when touching the feedback relay.
5. **`SEASON2_FLEET_LEDGER.md` section 27, THE LANDING ORDER** — read it before you touch a
   contended resource, and append a row when you claim one. Several sessions run against this
   repository at once, and section 27 is where they stay out of each other's way: migration
   numbers, the six ratchet baselines, `server/index.ts`, `ci.yml`, the shared integration
   worktrees, plus the hazards that have actually cost time (removing a worktree can delete the
   shared `node_modules`; a stale tree runs a major version behind the lockfile). It replaces a
   coordinator session deliberately, because a file cannot hit a session limit mid-merge.

`MODULES_MASTER_PLAN.md` Part 1 is known-stale; never trust it over code. The repo skill lives
in `.claude/skills/`.

## Gates — all of these before calling anything done

The authoritative list is printed straight from `.github/workflows/ci.yml`, in the order CI runs
them, so it is right on the day you run it:

```
node scripts/module-facts.mjs
```

### Running the suite honestly

- **A whole run with no `TEST_DATABASE_URL` now FAILS.** It used to skip 91 files
  (1,190 tests on 2026-09-02, about a third of the suite, the ledger and every route
  among them) and still exit 0, which is a false green nobody can distinguish from a
  real one. A skip is not a pass. The run still prints what it did not do, after the
  summary, and now the exit code says the same thing.
  - No database and you want the smaller suite anyway: `ALLOW_NO_TEST_DB=1 pnpm test`.
    That is a documented path (`CONTRIBUTING.md`), it just costs a word now.
  - Running one file or a glob is unaffected: a filtered run makes no claim about the
    suite, so it needs no opt-out.
  - `pnpm test:full` (REQUIRE_TEST_DB=1) is still the stricter form and still what to
    run before a "green" claim: it also fails when the variable is SET and no schema
    was provisioned, which is a database that could not be reached.
- **Build first.** The e2e suites boot `dist/index.js`. A run whose bundle is older than
  the source it was built from is now refused by name (`server/db/distFreshness.ts`), so a
  green result cannot be about yesterday's code.
- **Never read an exit code through a pipe.** `cmd | tail` reports tail's status, and tail
  always succeeds; this has produced a false green on a red tree four times. Redirect to a
  file and read `$?` on the very next line, or `set -o pipefail` first.
- **`pnpm test:unit`** excludes the e2e files. It is about a quarter of the wall clock and
  proves correspondingly less; it is an inner loop, not a gate.
- **What it costs:** roughly 35 to 50 minutes locally depending on how many lanes share the
  database, against about 7 in CI. The e2e files are two thirds of it.

### If you are one of several sessions: do NOT run the full suite

**A lane runs its own tests. The session that MERGES runs the full suite, once, on the
composed tree.** Put this in every lane brief, verbatim:

> Do NOT run the full suite. Run the test files you added, any existing suite covering the
> files you touched, and the gate scripts. Say plainly that you skipped the full run and
> why. The integrator runs it once on the composed tree.

**Measured on 2026-09-04**, when the opposite was briefed: two lanes at 3h04m each with
their work already committed, a third at 1h55m likewise, one lane running the suite three
times and calling two of the three invalid itself. Roughly twelve machine-hours across the
day, and **not one unique defect found by any full-suite run.** What caught things was the
TypeScript compiler, targeted controls that break a fix and watch a NAMED test fail,
rendered output, the gate scripts, live probes against a booted server, and production. What
the full suites contributed was flakes that three separate agents each had to rule out.

The reasoning is not only economic. **N greens on N sibling branches say nothing about the
tree they merge into**, and that tree has to be tested anyway. A lane's suite is a tax on
confidence you were already going to buy.

Two things that follow:

- **A lane that has finished and is running a suite looks exactly like a hung lane.** Before
  concluding a session is stuck, check its worktree: `git status` and the commit count.
  Twice on 2026-09-04 the work was committed and the tree clean while the panel showed 0/2.
- **Stopping such a lane and taking its committed work is correct**, not a shortcut. Verify
  the branch yourself with the gates plus the targeted suites, which is what should have
  happened anyway.

**And the integrator should PUSH the composed tree and read the run, rather than running the
full suite locally.** Same rule, one step further, and it only became true when the repository
went public: `verify` is 8 to 10 minutes on a clean machine with the pinned Node 22 and MySQL 8,
against 25 minutes locally on a quiet box and 46.6 measured under load, and it now costs nothing.
The composed tree is not an obstacle, because a composed tree can be pushed to a branch and CI
will read it there. The one case with no ref to push is a pair-merge scratch, and even there run
only the suites the two branches share.

Two things that stop this producing a false green, both paid for on 2026-09-04. Read the STEP
COUNT and WHICH step: a healthy `verify` is 45 steps, the billing outage produced runs that died
in 2 to 3 seconds having started nothing, and an npm outage failed one dependency step on a run
where everything else passed. And a cancelled run is not a red, since `ci.yml` cancels superseded
runs per ref. Full detail, with the traps, in `SEASON2_FLEET_LEDGER.md` section 27d.

Two CI budgets cap the client: main JS and total `dist/public`, both
measured after `pnpm build`. Read the numbers off `MAX_MAIN_JS_KB` and `MAX_TOTAL_DIST_KB` in
`.github/workflows/ci.yml`, which is the authority: this block said 6 MB for as long as the
ceiling was 6000, and stayed at 6 MB when `dbb4f9c` raised it to 6600 for the catalog art.
`node scripts/check-dist-budget.mjs` reproduces the CI measurement locally and CI runs the same
script, so the METHOD no longer differs between the two. It was checked against a real ext4
volume on five different built trees and matched `du -sk` to the kilobyte on every one.

**This block deliberately no longer quotes today's figure.** It has held a stale one twice: it
said 6 MB for as long as the ceiling was 6000 and stayed at 6 MB when `dbb4f9c` raised it, and it
then carried a measured 5432 KB / 477 KB long after several lanes had pushed the real numbers
past them. Every merge moves both totals, so a number written here is wrong by the next landing.
**Run the script and read your own tree.** A number in a doc is a claim about a moment; the script
is a measurement of now.

**Read the number off the PUSH run, never the pull_request run, and know why they differ.** A
`pull_request` run builds your branch ALREADY MERGED with main, so it carries whatever other
lanes have landed since you branched and reads higher than your branch alone. On `f8c7b14` the
two runs of the same commit reported **5432 KB** (push, the branch) and **5460 KB** (pull_request,
the branch plus main), a 28 KB gap that is entirely other people's work. The push run agreed with
this machine to the kilobyte and emitted the same content hash for the CSS, so a local
measurement IS the CI measurement for the tree you built. What it cannot see is what has landed
on main while you worked. Rebase before you trust a number near the ceiling.

**The total is measured in 4 KB BLOCKS, and that changes what a fix looks like.** CI sizes the
tree with `du -sk`, and `du` counts allocated blocks: on the runner's ext4 filesystem every file
takes a whole 4096 bytes however small it is. A 400-byte chunk spends four kilobytes of the
ceiling. At `ec8d147` that rounding was **729 KB** of the 6600, and ninety-six files under 4 KB
burned 302 KB of it between them: the gate read 6536 KB against a tree holding 5806 KB, and
nothing local reproduced the gap.

The consequence is counter-intuitive and it is worth holding onto, because the build spent a
long time fighting it: **the two budgets pull in opposite directions.**

- **MAX_MAIN_JS_KB is REAL bytes on one file.** Splitting a route out of the main chunk lowers
  it. Splitting is the fix, which is exactly what the workflow comment tells you.
- **MAX_TOTAL_DIST_KB is BLOCK-CHARGED across the tree.** Splitting a small module into its own
  chunk adds a full block whatever the module weighs, so splitting RAISES it. **Merging is the
  fix.**

A sibling lane proved the arithmetic exactly: swapping three single-use icons that were each
their own ~400-byte chunk saved precisely 12 KB, which is 3 x 4096 and has nothing to do with
the icons. Going the other way, grouping `lucide-react` into one `icons` chunk
(`manualChunks` in `vite.config.ts`) removed about eighty such files and took the total down
276 KB while the MAIN chunk also fell, from 503 KB to 477 KB, because the shell's own icons
left with them. `output.experimentalMinChunkSize` was measured against the same tree and is the
weaker knob: about 64 KB at 4096, a plateau by 20000, and it pushes real bytes into the main
chunk. Dropping the legacy `.woff` fallback (below) took another 828 KB off the same ceiling.

So before you split anything, run `node scripts/check-dist-budget.mjs` and read BOTH numbers.
It prints real bytes, block-charged bytes, the overhead between them, a size histogram and the
files paying the most padding. When the total is genuinely full of content, the fix is the
uploads volume, never a bigger number here.

Images are WebP. `scripts/check-image-budget.mjs` enforces it on `client/public`, and the
exemptions are DERIVED, never typed: whatever `shared/gameConfig.ts` names as the favicon and
whatever `client/index.html` declares as an icon or a social card, because those surfaces have
no dependable WebP support. The total in `scripts/image-budget-baseline.json` is a ratchet and
`--update-baseline` refuses to raise it. New art belongs in the uploads volume, which is
hashed and swappable; `client/public` is cached one-year-immutable and cannot be replaced.
Member uploads are shrunk in the browser first (`client/src/lib/imagePrep.ts`), which falls
back to the original file whenever the browser cannot encode WebP.

Fonts ship as WebP's equivalent: **woff2 only**. @fontsource declares a legacy `.woff` beside
every `.woff2`, and that second set was 32 files and 758 KB of a budget no browser could ever
spend, because woff2 landed in every engine before ES modules did and `client/index.html` boots
the app from a single `<script type="module">`. A browser old enough to want the fallback cannot
run the app. `dropLegacyWoffFallback` in `vite.config.ts` strips the fallback from the `src:`
list before vite resolves the url, which is what stops the file being emitted. Member-uploaded
display faces are a different path and still accept `.woff` (`server/index.ts` sniffs `wOFF`).

The build marker is composed WHOLE in `scripts/build-server.mjs`, from the commit date and the
git SHA, and injected as `__BUILD_MARKER__`; `server/index.ts` only reads that define and falls
back to `"dev"`. Neither half is hand-written, which is why `/health` cannot report a build that
isn't running, and `server/buildMarker.test.ts` fails if a date literal or a `BUILD_LABEL`
constant comes back.

## Loop-test rules

- `server/loop.e2e.test.ts` is the acceptance criterion for the whole product. It boots the
  **built** `dist/index.js` as a subprocess — run `pnpm build` first or you test stale code.
- It is **order-dependent**. Never filter with `vitest -t`; run whole files or the whole suite.
- DB-backed suites need `TEST_DATABASE_URL` in the local `.env` (the S5 harness in
  `server/db/testDb.ts` drops/recreates a scratch schema — never point it at the app schema).
  Without it they skip, and an unfiltered run fails on the way out (`ALLOW_NO_TEST_DB=1`
  accepts the smaller suite). See "Running the suite honestly" above.
- **Provisioning migrates once per run, not once per suite.** Every file in `drizzle/` provisions
  a schema, and that count only grows (`ls drizzle/*.sql | wc -l` is the only figure worth
  trusting);
  the harness migrates into a `village_tpl_<hash>` template and clones it, so each suite
  still gets a private schema for a fraction of the cost. Every run prints what it paid, and
  `pnpm measure:provisioning` prints the template build, the per-clone cost and the
  per-migration-file price. Read that number before adding ten migrations. If a run prints
  `[testDb] could not clone template`, provisioning fell back to the slow path and the
  message says why.
- Unit anchors: `server/ledger.test.ts`, `server/swap.test.ts`, `server/payments.test.ts`.

## Non-negotiable invariants

**Economy** (`server/lib/exchange.ts`, `server/lib/ledger.ts`):
- Fiat flows IN only; tokens are never sold for fiat. The exchange is BUY-ONLY.
- Recognition-kind tokens are never purchasable or swappable. Hypha-governed tokens never
  trade — read-only display.
- Faucet-issued tokens are never swappable. The test is destination-based: faucet →
  `sys:treasury` is stocking; faucet → anything else is issuance and taints the token.
- Caps fail closed: 0 means zero, never unlimited.
- Trading is per-deployment opt-in behind a version-stamped legal card; a stale ack
  (`legalAckVersion !== cardVersion`) closes swapping.

**Ledger** (`server/lib/ledger.ts`):
- Per token, SUM(balance) over all accounts ≡ 0. Boot invariants enforce this with a loud
  failure, not a comment.
- `token_balances` is a cache: **recompute, never increment**.
- Only faucet accounts go negative. Non-faucet exceptions exist only via
  `ALLOW_NEGATIVE_SOURCES` (`stay_night`, `payment_reversal`) with `allowNegative` set.
- All movement goes through `postTransfer` / `postTransferPair` (+ `PairGuard`). No raw
  ledger writes, ever.

**Modules & access**:
- Every NON-CORE module ships OFF (absent `module_settings` row = off); the four core modules
  (quests, gratitude, progression, profiles) are always public and cannot be disabled.
  Lifecycle is
  `off|preview|members|public` (`shared/modules.ts`); routes mount behind `requireModule()`
  (`server/lib/modules.ts`); missing dependencies demote a module to off at boot;
  `openStateCheck` refuses `off` while value is outstanding (settle first).
- ONE capability gate (`shared/capabilities.ts`): **admin → badgeDenies → role →
  badgeCapabilities → stage**. A badge deny beats role and stage; only admin outranks it.
  Never gate anywhere else.

## Five config planes — know which one before adding any knob

1. `shared/gameVariables.ts` — behaviour (how much, how often, which mode). DB stores
   **changed values only**; platform defaults inherit.
2. Brand overlay — identity (names, images, dues, personas) via the admin Setup Wizard →
   the `brand` database document in `app_config` (`dbDocument(getPool(), "brand", …)`,
   `server/index.ts`); the in-code identity home is `shared/gameConfig.ts`.
3. Module lifecycle + per-module config JSON — `module_settings` table.
4. `app_config` documents — keyed JSON (instance-identity, launch-state, email config…).
5. Integration secrets — `server/lib/secrets.ts` (S63): **write-only**, reads masked to
   last4, admin-typed value beats the env var. Sealed at rest (AES-256-GCM under
   `VILLAGE_SECRETS_KEY`, via `server/lib/sealedBox.ts`) since 2026-08-30; with no key a
   write refuses rather than storing plaintext.

## The spines

- Events: `recordEvent()` (`server/lib/events.ts`) is the ONE way into `health_events`.
- Notifications: `server/lib/notify.ts` — `dedupe_key` NOT NULL + unique index; one stable
  key per (event, recipient); a retried insert is a no-op.
- Scheduler: `registerJob()` (`server/lib/scheduler.ts`). Jobs never close gratitude
  cycles — settlement releases value and is a human act.
- Payments: `server/lib/payments.ts` — HMAC over the **raw** body, event-level dedupe on
  `stripe_event_id`, reversals are mechanical claw-backs via registered handlers.
- S62–S66: instance identity + `PLATFORM_VERSION` (`server/lib/identity.ts`; the
  `/api/platform/info` handshake), launch requirements as data
  (`shared/launchRequirements.ts`, checks in `server/lib/launch.ts` by `checkKey`),
  feedback relay (`server/lib/feedback.ts` — captured locally always, relays content only,
  queue-and-forget; the hub is a listener, not a dependency).

## Writing a migration

Thirteen founder instances run one image and apply `drizzle/*.sql` **at boot, fail-loud**.
There is no separate migrate step and no approval: the container starts, the schema changes,
and the village is on the new schema whether or not the new code works. So a bad migration is
not a failed deploy, it is a village that cannot start, and the only lever anybody has is to
put the previous image back.

**Expand, never contract.** A migration may ADD. It may not take away. Rolling one release
back over an already-migrated database has to work, so the previous release must still be able
to read and write whatever the migration produced.

| Safe to land now | Never in the same release |
|---|---|
| a new nullable column | dropping a column or a table |
| a new column, NOT NULL, with a DEFAULT | making an existing column NOT NULL |
| a new table | narrowing a type, or removing an enum value |
| a new non-unique index | a new UNIQUE index or FOREIGN KEY on an existing table |
| a backfill with a WHERE | `TRUNCATE`, or `DELETE`/`UPDATE` with no `WHERE` |

A rename is two releases. Release N adds the new column and writes to both; release N+1, once N
has run on all thirteen, drops the old one. `node scripts/check-migration-compat.mjs` enforces
this and its header states what it cannot see.

Making an existing column NOT NULL is unsafe here **even with a DEFAULT**, which is unusual and
worth knowing: `server/repos/store-db.ts` names every spec'd column on every INSERT, so the
previous release writes an EXPLICIT NULL and the default never applies. Same root cause as the
`dbCollection` trap below.

**Numbering.** Claim the number in `SEASON2_FLEET_LEDGER.md` section 3 before creating the file,
then `node scripts/check-migration-numbers.mjs --next` to confirm. Numbers only go forward: a
gap is never filled, because some branch or some instance may still hold a file with that name.
**9000 and above is reserved for migrations a village writes for its own instance**; upstream
never takes a number in that band, and because the runner sorts by filename a village's own
migration therefore always runs after every upstream one. A fork adding its own runs the number
check with `--village`.

## House traps — each one cost a real session

- **Migration SQL**: the runner splits statements on line-final `;`
  (`splitStatements`, `server/db/migrate.ts`). A `--` comment ending in `;` once cut a
  statement in half (migration 0015). Comment lines are now stripped first, but keep `--`
  comments on their own lines and never end one with `;`.
- **A shipped migration file is never edited.** A part-applied file resumes at its
  recorded statement offset (`_migrations_partial`) instead of replaying DDL, so editing
  one that has run anywhere resumes at the wrong place. Worse, `_migrations_applied` keys on
  FILENAME and stores no checksum: an instance that already ran the file has its name recorded
  and will never run the new body, while a fresh instance gets it, and the two databases
  diverge with no error anywhere. Fix forward with a new file.
  `node scripts/check-migration-compat.mjs` now enforces this against the base ref; it was
  convention alone until 2026-08-30.
- **PowerShell**: `Set-Content -Encoding utf8` double-encodes non-ASCII. Write files with
  the Write/Edit tools, never shell redirection.
- **MySQL UNIQUE indexes exempt NULLs** — a nullable column in a unique key admits infinite
  duplicates. Dedupe columns must be NOT NULL.
- **A hand-kept map typed `Record<string, T>` is a promise nobody checks.** The client keeps
  lookup tables beside the unions the server sends, and a member added to the union in
  `shared/` makes the page render NOTHING where a sentence belonged: no error, no console
  line, an empty paragraph. Key them by the union and the compiler does the whole job.
  `node scripts/check-mirror-annotations.mjs` suggests it wherever it is free. Reach for
  `noUncheckedIndexedAccess` and you get 282 errors repo-wide and it still does not flag
  `Record<Union, T>[keyTypedAsUnion]`, which is the shape that actually shipped.
- **A column DEFAULT never applies to a `dbCollection` write.** `insert` and `replaceAll`
  build one INSERT naming EVERY column in the spec, so a key the caller did not set arrives
  as an explicit NULL, and an explicit NULL is not an absent column. On a NOT NULL column
  that is a guaranteed violation however good its DEFAULT is, which is how two routes shipped
  that could never once succeed. `toDb` rescues exactly two cases: `kind: "bool"` writes 0 and
  `defaultNow` writes now. **`kind: "int"` is NOT one of them** — the `v == null` branch
  returns before the switch that would coerce it. `node scripts/check-repo-payloads.mjs`
  enforces this, and states in its own header what it cannot see.
- **BigInt literals** (`123n`) break the build target. Use `BigInt("...")`.
- **`vitest -t`** breaks the order-dependent loop test. Run whole files.
- **A copy change can break a test by capitalization alone.** Assertions use `toContain`
  on a phrase; turning an em-dash into a period capitalizes the next word and the match
  dies. Grep test files CASE-SENSITIVELY before editing any string, and reach for a colon
  or a comma when the asserted phrase would otherwise start a new sentence.
- **CI runs Node 22 and this machine does not.** `.github/workflows/ci.yml` pins
  `node-version: 22` and `.node-version` says 22; dev boxes here are on 25.x. Every local
  gate therefore runs on a runtime three majors from the one that decides, and a dependency
  whose behaviour differs across that gap builds green locally and goes red in CI with no
  local signal at all. **`engines` does not describe the gap and reading it actively
  misleads.** The live example: `nanoid@6` declares `engines.node` as
  `^22 || ^24 || >=26`, which ALLOWS Node 22, while `"type": "module"` makes it ESM-only,
  and the module format is the risk rather than the version range. Before bumping or adding
  a dependency, check `npm view <pkg> type` alongside `engines`, and treat any ESM-only
  package as needing a CI run before it is believed.

- **An absent substring proves nothing about a fix.** Checking whether
  `anonymizeMember` handled org seatings by counting `org_role_assignments` in its
  body returned zero, and the correct answer was "handled, via
  `releaseSeatingsForUser`". A fix that gets factored into a well-named helper
  makes the old string disappear, which is what factoring is FOR. The same shape
  bites the other way: a test asserting a payload does `not.toContain("holders")`
  fails on a seat accountable for "external financial and legal stakeholders".
  **Verify a behaviour or a call graph, never the presence or absence of a
  string.** For "is this defect still real", the cheap correct check is to follow
  what the function CALLS, or to exercise the path.

## Worklists: when a fix list may be deleted

Records of completed work are deleted, and anything forward-looking is kept.
That rule is right and the whole risk lives in deciding which one a file is.

**Verify every item before the file goes, and verify it the way the trap above
demands.** A worklist is a set of claims about the code; deleting it asserts all
of them are now false. Twelve worklists came out in `2069f32` and the call was
sound, but nothing in the process required the check, so a wrong one would have
gone out silently with the right ones.

Three rules that make the deletion safe:

1. **Check each item against the code, not against memory or a commit message.**
   Fixed items usually leave a comment saying what they fixed; that comment is
   the evidence, and its absence is not counter-evidence.
2. **If any item survives, do not keep the whole file.** Move the survivors into
   a new short file carrying nothing finished, and delete the original. A
   backlog with ninety percent completed items is one nobody re-reads.
3. **Say in the commit message which items you verified and how.** The next
   person deleting a worklist inherits your standard, and "I checked" is not a
   standard.

## House voice

`scripts/check-voice.mjs` holds shipped language to the writing rules in
`second-brain/90 Voice Profile/Rye Voice Profile.md`: no em-dashes or en-dashes (hyphens are
fine), no contrast framing (`not X but Y`, `rather than`), no AI filler vocabulary, no
rhetorical-question openers used as filler, no passive inspiration.

It parses every file with the TypeScript compiler and reads ONLY real copy: JSX text and
string or template literals. Comments, identifiers, imports and className soup are invisible
to it, which is why it can be a hard gate instead of a warning. Attribute and property names
that carry machinery rather than prose (`className`, `href`, `slug`, `icon`, and the rest of
`NON_COPY_KEYS`) are skipped, and tests are exempt. `--json` emits a worklist.

A genuine false positive takes an inline `voice-ok: <reason>`; waivers are counted and
printed so they stay honest. New copy is born clean.

## White-label discipline

`scripts/check-brand-refs.mjs` (S56) has four zones: a RATCHET (`server/index.ts`, `client/`,
`drizzle/`, `vitest.config.ts`, `scripts/`, plus every `*.test.ts(x)` file — baseline-capped
against `scripts/brand-refs-baseline.json`, counts may only ever decrease), DECLARED HOMES
(exempt: `gameConfig.ts`, `server/seeds/`, `docs/`, markdown), the SHOPFRONT (public brochure
pages — a fork REPLACES those wholesale, so its own name is not debt there; the list is in the
script, and the line is drawn at product: anything a signed-in member coordinates through stays
ratcheted), and HARD-CLEAN — everything else, where any brand hit fails. A genuine false
positive takes an inline `brand-ok: <reason>` ON THE LINE ITSELF; a waiver on the line above
does nothing. New code is born clean, everywhere.

The comment stripping lives in `scripts/brand-strip.mjs` and is tested by
`node scripts/check-brand-refs.test.mjs` — it was wrong twice, and both times the guard reported
a different answer for the same commit on different machines. **Carriage returns come off before
any anchored rule** (JS `.` excludes `\r`, so on a CRLF checkout `//.*$` never matched and every
comment counted as code), and **`//` inside a URL is not a comment** (the old rule cut the line at
`https://` and hid 41 references). Read the exit code, never `tail -1`: a failing run's last line
is blank.
