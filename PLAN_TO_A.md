# The plan to A

Eleven dimensions, graded three times. The third grading measured whether things
work for a person rather than how well they are written, and every dimension
either fell or stayed. Nothing is an A.

This file says, per dimension, exactly what stands between it and A- or A, in the
order the work has to happen. It is the coordination document: if you are a
session picking up work, claim a row here.

Graded 2026-09-03 against `main`. Grades in brackets are the challenger's.

| Dimension | Now | Target | Blocking |
|---|---|---|---|
| Economy | B- | A- | 4 defects, 3 in flight |
| Governance | B+ (B-) | A- | 1 critical, plus what is built vs written |
| Security | A- | A | narrow |
| Tests & CI | A- (B+) | A | 2 critical |
| Bridges | B+ (B-) | A- | the receiver has no test |
| Architecture | B+ | A- | residue and a wide seam |
| Data model | B | A- | zero foreign keys, 153 tables |
| Fork-ability | B (B-) | A- | item 1 landed; 2 and 3 open |
| Client | B (B-) | A- | the core loop is silent to a screen reader |
| Operability | B- | A- | no uploads backup, alarm reaches no person |
| Upgrade path | B- (C+) | A- | tags a village cannot pin |

---

## What A means here

Not "we wrote a test". The bar the third grading used:

- **A** works, is proven by something other than its own tests, and fails safely.
- **A-** works and is proven, with a named gap that is written down and bounded.

The distinction that moved every grade: a subsystem that is well written and has
never been exercised is not an A, it is an untested claim. Production has run
almost none of this. `token_ledger` has zero rows.

---

## 1. Economy: B- to A-

The keystone is A-grade and the member-facing economy is not. Conservation never
broke under any path an audit could drive: gratitude gives, confirmed quests,
settlements, sink spends, exit sweeps, hand mints, a deliberate nine-quadrillion
posting, three kinds of race. Idempotency is real. The allowance cannot be
overspent by a member racing themselves. That is hard and it is built.

Then two members act at the same moment and it fails.

### In flight now (branch `wt/fix-deadlock`)

1. **The gratitude deadlock.** `writeGratitudeRow` runs at SERIALIZABLE, taking
   gap locks over the whole `gratitude_log` cycle range, which every giver
   shares. Two simultaneous givers: one fails with a raw driver string. Twelve:
   ten fail, one of them an uncaught throw. The `SELECT ... FOR UPDATE` on the
   users row is what actually serialises a giver against themselves, so
   REPEATABLE READ keeps the allowance guard and removes the contention.
2. **Charge without delivery.** `give()` commits the note, which spends the
   allowance, then posts the ledger credit outside the lock. Measured: 20 to 30
   of every 100 charged units never delivered. `checkLedgerInvariants` cannot see
   it, because nothing was created wrongly; nothing was created at all.
3. **`postTransfer` has no deadlock retry** while `postTransferPair` carries a
   three-attempt one at `ledger.ts:533`.

### In flight now (branch `wt/fix-decimals`)

4. **The wallet is wrong by 1000x.** `fromLedgerUnits` has one non-test caller.
   A member holding 10 Village Voice reads 10 on their profile and 10000 on their
   wallet. This must land BEFORE the 4-decimals sweep: today one token is wrong,
   afterwards every token is wrong by 10,000x on every surface that does not
   divide.

### Still open, nobody assigned

5. **`reverse()` takes its amount and direction from the caller** and only checks
   that some row with the original key exists. An audit reversed a 25-credit
   posting into a 1,000,000-credit payment to the same member with every
   invariant green. Fix: derive from the original ledger row, refuse any caller
   value that disagrees, and add `reversal` to `ALLOW_NEGATIVE_SOURCES` so a
   clawback of already-spent value can complete instead of being refused.
6. **`mint_rules.amount` is `decimal(18,4)` while its tokens are `decimals = 0`.**
   A founder can save a rule for an amount the registry silently rounds away.
   Refuse a non-whole number of the token's minor units at save time in
   `queueRuleChange`, and have the mint report the units it posted rather than
   the human figure it read.
7. **Decimals: OWNED BY THE ECONOMICS ENGINE SESSION (2026-09-04).** Not this
   plan's to close, and nobody else should change a token's scale. Rye ruled 4
   across the board, then stopped that work, then clarified he wants 2 decimals
   for currency-like tokens as the world standard, believing we already had it.
   We do not: measured on production, `credits` is at 0 and is the only sendable
   token, and only `village-voice` carries any scale at 3. Full history and the
   narrowed question in `docs/ECONOMICS.md` section 11.

### To reach A

The economy has to have run. One real cycle in Amora with real people: a
confirmed quest, a settlement, a spend at a sink, and at least one moment where
several members act at once. Then read `token_ledger`, `token_balances` and the
reconciliation panel and compare them against what the members' own wallets
showed. Nothing short of that separates "proven by its tests" from "proven".

---

## 2. Governance: B+ to A-

Owned by the `gb-*` swarm, integrating into `wt/governance-build` (43 files,
+10,410 lines at time of writing). Do not reach into that branch from outside;
its own coordinator is integrating.

1. **Critical, found by grading:** a carried `role_seat` ballot seats a member
   who left the village while the vote was running. Delete the subject mid-ballot,
   close, and the seat is granted anyway.
2. **Separate what is built from what is written.** `docs/GOVERNANCE_EVOLUTION_PROMPT.md`
   describes stewards, vetoes, delegation, governance weeks and an assembly that
   turns admin edits into proposals. Produce a per-feature verdict: in code,
   partially built, or only written. Grade the code; note the document separately.
3. **The close dispatcher.** A passed proposal whose subject type has no handler
   executes nothing. The village votes, it passes, and nothing happens, with
   nobody told. Every subject type needs either a handler or a loud refusal at
   raise time.
4. **Frozen electorate and weights.** Prove a ballot's roll and weights are fixed
   at open: someone joining, leaving or gaining voice mid-ballot must not change
   the tally.
5. **Concentration must be visible.** Founders may self-grant voice by ruling,
   with transparency as the control. So the percentage of total voice a holder
   commands has to be shown where a voter sees it before voting, not buried.

---

## 3. Tests & CI: A- to A

Two critical findings, both structural.

**Item 1 is done (#155).** The suite now carries `if: ${{ !cancelled() }}`, so a
failing guard no longer hides it. `!cancelled()` rather than `always()` on
purpose: cancel-in-progress is on and runs are cancelled constantly at this
merge rate, and `always()` would run a ten-minute suite on every cancelled one.
Splitting the job is still worth doing and is still open.

**A green on a branch behind main is not a green on CI.** A pull request runs
the workflow file on ITS OWN branch, so a branch cut before a gate existed is
never judged by that gate. Measured 2026-09-03: two branches 23 commits behind
main passed `verify` in about ten minutes each while carrying two
`check-village-facts` violations, because the step that catches them is not in
the ci.yml being executed. Thirty-three steps ran and the two that mattered
were never invoked. The green was entirely true about what it tested and
entirely silent about what will judge the branch at rebase. The honest
statement is "green on N of the M gates that will judge it", and the way to
get the real answer before rebasing is to run the gates from a merged tree:

```bash
T=$(git merge-tree --write-tree origin/main HEAD)   # empty output means conflict
mkdir /c/m && git archive "$T" | tar -x -C /c/m
(cd /c/m && node scripts/check-village-facts.mjs)   # needs node_modules
```

1. **`ci.yml` is one job of sequential steps with no `if: always()`, and the
   test suite is the second-to-last of them.** Any guard before it failing
   means the suite never runs, and the build still reports a single red step.
   This is not hypothetical: CI was red for five commits this way, and for
   those commits nothing ran the tests at all. Split the job, or mark the
   suite `if: always()`, so a guard failure and a test failure are different
   facts.

   The count is deliberately not written here any more. This entry said "33
   sequential steps" and "`pnpm test` is step 28" when it was written on
   2026-09-03, and both were stale by that afternoon: the fork env audit and
   the village-fact guard landed the same day and pushed the suite back twice.
   Three lanes had already been briefed on a number from an earlier reading
   and would have reported it back as completeness. Measure it instead, which
   takes one command and is never stale:

   ```bash
   grep -cE '^      - name: ' .github/workflows/ci.yml   # steps in the verify job
   grep -n  '^      - name: ' .github/workflows/ci.yml   # and where the suite sits
   ```

   At b5ef673 that reads 35 steps with the suite at 33, so 32 guards gate one
   test run. The number moves every time a lane adds a gate, and the finding
   gets worse each time, which is the argument for fixing the structure rather
   than tracking the figure.
2. **Nothing checks that a client fetch reaches a route that exists.** An audit
   pointed the member-facing quest-claim button at a nonexistent endpoint and the
   suite stayed green. A guard comparing every `fetch("/api/...")` in
   `client/src/**` against the server's registered routes would have caught it.
3. **Sample the assertions.** At least one test named for an outcome asserted on
   configuration and stayed green through a bug that cost every village its first
   payout. Find the others: a test that would still pass if the feature were
   deleted is not coverage.


   **Do not try to find these with a static scan. That was tried and it does
   not work.** A scanner looking for assertion-shaped defects (no `expect` in
   the block, presence-only assertions, an expectation that mirrors the
   implementation) returned 70 candidates across the 286 test files. Five were
   checked by hand and all five were false positives: assertions living in a
   helper such as `expectRefused()` are invisible to it, and `f(x) === f(x)` is
   the correct way to assert determinism or clamping, not a defect.

   The reason is in the calibration case, 17a5a3b. The assertion that hid the
   lost first payout was `expect(total).toBe(50)` with a comment describing the
   mechanism exactly. Its own words: "The number was not wrong about the
   engine; it was right about an engine that was wrong." Nothing about that
   line looks wrong on any axis a parser can see, because nothing about it IS
   wrong except the world it was measured against.

   So the method is mutation, which is the plan's own wording taken literally:
   delete or neuter the feature, run the suite, and list every test that stayed
   green. It needs a working `TEST_DATABASE_URL` first, because 92 files and
   157 guarded describe blocks are database-gated and silently do not run
   without one, which would itself produce a hollow pass. Start from the
   economy paths that 17a5a3b touched. Budget it as its own session.
---

## 4. Bridges: B+ to A-

1. **The Hypha claim receiver has no test of any kind.** Not the HMAC
   verification, not the hex-shape guard that was written to fix a real
   500-from-RangeError, not the rate limiter. This is the door money comes
   through from outside.
2. **`bridgeReconciliation` and `retryRefund` have no caller outside the test
   file.** The design leans on a confirmed-but-unmoved claim surfacing as a
   reconciliation item; nothing surfaces it.
3. Replay protection and a confirmation that never arrives, arrives twice, or
   arrives for the wrong amount all need a decided behaviour and a test.

---

## 5. Architecture: B+ to A-

The extraction is proven behaviour-preserving by two independent audits, one of
which dumped the built server's live registration order. What is left is residue
and the shape of the seam.

1. **72 dead imports of 808** in `server/index.ts`, every sampled one belonging
   to an extracted domain. Removing them lets the ratchet come down further.
2. **`appDeps.ts` is 369 lines declaring about 86 fields.** A module reaching
   into a bag of 86 for twenty things has a filing system, not a contract.
   Narrow each module's dependency surface to what it actually uses, and make
   that surface the reviewable thing.
3. **28,478 lines still in `index.ts`.** Name the next honest extraction by
   cohesion rather than size, and say what genuinely belongs at the top level.

---

## 6. Data model: B to A-

Measured on production: **zero foreign keys across 153 tables**, one check
constraint, 114 migrations applied at boot with no approval gate.

1. Every relational invariant is enforced in application code. That is a
   defensible choice, but it is currently undocumented and unenumerated. Produce
   the list: for each relationship that would be a foreign key, name what
   enforces it and what happens when nothing does.
2. **Add foreign keys where they cost nothing**, starting with the ledger's
   account references. Where a key genuinely cannot be added, add a reconciler
   that reports divergence rather than leaving it to chance.
3. **Every cache-of-a-derived-truth needs a reconciler that runs.**
   `token_balances` caches `SUM(token_ledger)` and `checkLedgerInvariants` checks
   it. Find the other cache pairs and give each the same.
4. Good news, already landed: maintenance mode is wired in at
   `server/index.ts:5371`, so a failed boot migration shows a cause instead of a
   bare 502.

---

## 7. Fork-ability: B to A-

1. **`scripts/fork-env-audit.mjs` is referenced in four documents and wired into
   zero workflows and zero package.json scripts, and it exits 1 today.** A guard
   that does not run is a comment. Wire it into `ci.yml` and fix what it reports.
   **LANDED (#149).** Wired into `ci.yml` beside the
   brand guard and into `package.json` as `audit:fork-env`. The one thing it
   reported was `VILLAGE_TEST_RUN_ID`, which the vitest globalSetup assigns to
   itself before any worker starts, so it is declared INTERNAL and the omission
   is stated in `.env.example` rather than left silent. Exits 0. Verified it
   still bites: a new undocumented env read, and a deleted `.env.example` line,
   each turn it red.
   Also checked, so nobody has to ask again: every other `scripts/*.mjs` was
   measured for the same shape, named in a document and wired into neither
   `ci.yml` nor `package.json`. Thirteen are, and none of them is a guard.
   `check-examples` and `prove-remaining` need a live database,
   `prove-examples` and `smoke-all-modules` need a running server on 3911 and
   3901, `verify-migration-on-data` needs a migration prefix as an argument,
   and the rest are hand-run tools (`fork-init`, `seed-examples`,
   `compress-static-images`, `brand-strip`). None can run in a fresh clone, so
   none belongs in CI as it stands. `fork-env-audit` was the only static check
   among them, which is why it was the one worth wiring.
2. **`project.fiatCurrency` defaults to `CRC` and has no field anywhere in
   `client/src`.** It is the last entry on the identity guard's pending list, and
   the guard's own exit condition is that a founder sets it in Admin, on a screen
   that does not exist. Build the field, then the list reaches zero.
3. Walk `docs/FORK_RUNBOOK.md` and `docs/PROVISIONING.md` as a founder with no
   developer. Every step that says "edit this file" is a finding.

---

## 8. Client: B to A-

The one dimension whose improvement lane produced nothing. Both findings are
about the core loop, which is the worst place for them.

1. **Every success on the core loop is unannounced and destroys focus.** Clicking
   "Claim this quest" swaps the label to "Submit your work", raises no
   announcement, and moves focus nowhere. A screen reader user cannot tell
   whether it worked.
2. **No hand-rolled modal traps focus or restores it on close.** Nine files with
   `fixed inset-0` overlays, zero Tab handlers, zero restore-focus.
3. Establish whether any internationalisation mechanism exists at all. If the app
   is hardcoded English, say what adopting a framework would cost. Do not adopt
   one as part of this.

---

## 9. Operability: B- to A-

The runbook earns its grade: 519 lines, symptom-first, and the restore procedure
goes into a scratch database before the real one.

1. **Amora's uploads volume has no backup of any kind.** Two secrets switch it
   on: `openssl rand -hex 32` gives `BACKUP_EXPORT_TOKEN`, set it on the Railway
   app service and as a GitHub Actions secret, then set `BACKUP_EXPORT_ORIGIN` to
   the village base URL. **This is a founder action; nobody else can do it.**
2. **The oldest trustworthy database backup is about three days old.** Before
   2026-08-31T14:39 the backup was dumping a different database entirely: the
   pre-repoint one had 89 users and no `token_ledger` table.
3. **The alarm opens a GitHub issue and stops there.** Decide what the
   notification chain to an actual person is, and test that it reaches one.
4. Already fixed today: `ops/roll.mjs check`, the rollback-verification command
   the runbook sends an operator to, reported RED against a healthy village
   because the build marker format changed underneath it.

---

## 10. Upgrade path: B- to A-

1. **The version tags a village is told to pin are not immutable**, and no real
   pin, a digest, is documented anywhere a village can read. `release.yml`
   computes the digest and puts it only in the Actions job summary.
2. **Both new documents name `docs/SECURITY_ADVISORIES.md` as the channel for
   urgent notices to villages.** That file is a pnpm-audit exceptions list. Either
   make it the channel or stop pointing at it.
3. `ops/RELEASES.md` still carries its own six-step release procedure that omits
   the new rollback check, while both new documents cite it as the reference.

---

## 11. Security: A- to A

The narrowest gap of the eleven. What would settle it:

1. Every route in `server/routes/**` carries the same authorisation as its
   equivalent did in `index.ts`, proved mechanically rather than by reading, with
   particular attention to prefix guards mounted by `app.use`.
2. `server/lib/sitePull.ts` fetches a URL a founder supplies. The whole
   server-side-request-forgery class needs a decided answer, not just the IPv6
   literal case that has a test.
3. The village signing key is reportedly still plaintext in `app_config`.

---

## Sequencing

Some of this has to happen in order.

1. **Wallet decimals before the 4-decimals sweep.** Otherwise one token wrong by
   1000x becomes every token wrong by 10,000x.
2. **The deadlock and charge-without-delivery before Amora runs a real cycle.**
   The cycle is what moves Economy to A, and it must not be the thing that
   discovers these.
3. **`fork-env-audit` wired into CI before more environment variables are added**,
   or the drift it exists to catch accumulates while it watches nothing.
4. **CI job split before trusting any future green.** While `pnpm test` is step
   28 of a single job, a guard failure hides the suite.
5. **Governance ballot fixes before any village runs a real vote.**

## How sessions coordinate

- **Do NOT run the full suite in a lane.** Run your own test files, any suite
  covering what you touched, and the gate scripts, then say you skipped the full
  run and why. The session that merges runs it once on the composed tree.
  Measured 2026-09-04: twelve machine-hours of lane full-suite runs across one
  day, zero unique defects found, and several flakes that cost three agents real
  effort to rule out. Full reasoning in `CLAUDE.md`.
- **`git fetch origin` and branch from `origin/main`, never local `main`.** Prove
  it with `git merge-base --is-ancestor origin/main HEAD` before you start. On
  2026-09-04 three lanes branched from a stale local ref; one reimplemented a fix
  that had landed 87 minutes earlier, and a verifier proved the reimplementation
  measurably worse than what was already there.
- **Claim a row** by putting your branch name next to it here.
- **One session per directory.** Never `git checkout -b` in a tree another
  session is working in; that happened today and a lane checked out its branch
  under the coordinator mid-edit.
- **Stage by name.** Never `git add -A`.
- **Branch off `main`, not off another lane**, unless you mean to depend on it.
  Four lanes branched off each other today and their work interleaved into one
  stack that had to be untangled by content rather than by ancestry.
- **The ratchet baselines are shared state.** `server-index-size-baseline.json`,
  `image-budget-baseline.json`, `tailwind-gray-baseline.json`,
  `theme-literals-baseline.json` and the identity guard's pending list all
  conflict silently, because each lane lowers them to its own measured value.
  Whoever merges must re-measure the combined tree, not take either side.
- **Before you push, re-check that `main` has not moved.** It moved five commits
  under an audit today, so three agents measured a tree that would never land.
