# The economics session

You own the village economy: what is true about it, what keeps that true, and
proving it works before a real person is the one who finds out.

Four deliverables, in this order. The order is load-bearing and the reasons are
given where each is described.

1. **`docs/ECONOMICS.md` becomes the single source of truth**, describing what
   the code actually does rather than what it intends.
2. **A pipeline that keeps it accurate**, so it cannot silently drift the way
   every other document in this repo has.
3. **The economics model for the shared dry run**: the feature any village runs
   during setup to see its economy work, and afterwards to model a proposed
   change before voting on it. It is a product feature, not a test, and it is
   SHARED with governance. You build the economics half; the governance session
   owns the engine. Read that section before assuming its shape.
4. **Decimals: RULED. Village Credits to 2 decimals, the 4-across-the-board
   sweep cancelled** (2026-09-04). The decision is made; the work is yours. It is
   one token, not seven, and it is still not a column change. See deliverable 4.

You are one of three sessions on this. **Read "The governance contract" below before deliverable 3**: it carries the founder's rulings that bind money to governance and the dry-run engine's interface. The governance session owns the shared
simulation engine, the coordinator lands every merge, and there is a written plan
both of them are working from. See "Who you work with".

---

## Read these first, in this order

1. `docs/ECONOMICS.md`, the current state of the truth. It is yours to replace.
2. `docs/TOKENS.md`, GENERATED from the code and guarded, so it cannot drift.
   Read `scripts/generate-token-doc.mjs` and `scripts/check-token-doc.mjs`
   alongside it: that pair is the pattern deliverable 2 should follow.
3. `PLAN_TO_A.md`, where Economy sits among eleven graded dimensions, and what
   blocks it. Claim the Economy row.
4. `server/lib/economy.ts`, `server/lib/ledger.ts`, `server/lib/spending.ts`,
   `server/lib/exit.ts`, `server/lib/voiceClaim.ts`.
5. `SESSION_HANDOFF.md` for the environment traps.

---

## What is true today, measured

Read from the live Amora database on 2026-09-03. Re-measure before you rely on
any of it; these are timestamped facts, not standing ones.

| | |
|---|---|
| `token_ledger` | **0 entries** |
| `token_balances` | **0 rows** |
| `gratitude_log` | **0 rows** |
| `users` | 5, three of them examples |
| `quest_claims` | 1, never confirmed |
| foreign keys in the whole schema | **0**, across 153 tables |
| migrations applied | 114, at boot, with no approval gate |

**Nothing in this economy has ever run for a real person.** That is the single
most important fact you have. It means every mistake is still free, and it means
no part of this may be described as proven in production.

Seven real tokens. `village-voice` has `decimals = 3`; every other token is `0`.
Five faucets: `sys:gratitude-pool`, `sys:cycle-pool`, `sys:voice-mint`,
`sys:mint`, `sys:library-mint`. A faucet's negative balance IS the issued supply.

---

## What has been proven, and what is broken

An audit drove real value through a scratch database and through the built
production server. Both halves matter and you should not re-derive either.

**Proven.** Conservation never broke: not through a gratitude give, a confirmed
quest, a settlement, a sink spend, an exit sweep, a hand mint, a deliberate
nine-quadrillion posting, or three kinds of race. Idempotency is real: the same
claim confirmed four times at once paid exactly once, and five settlement runs on
one cycle wrote exactly eight rows per token. The allowance cannot be overspent
by a member racing themselves: sixty simultaneous gives of 5 against an allowance
of 100 spent exactly 100, three runs running. **That keystone is genuinely well
built. Do not rewrite it.**

**Broken.** All of it in `docs/ECONOMICS.md` section 10 with measurements. Two
are being fixed as this is written, on `wt/fix-gratdead` and `wt/fix-decimals`;
check whether they landed before touching them:

- **Two members thanking at the same moment deadlock.** At twelve concurrent
  givers, ten fail. `writeGratitudeRow` ran at SERIALIZABLE, whose gap locks
  cover a range every giver shares.
- **A member can be charged for a credit that was never delivered.** `give()`
  spends the allowance, then posts the credit outside the lock. 20 to 30 of every
  100 charged units vanished, and `checkLedgerInvariants` cannot see it because
  nothing was created at all.
- **The wallet renders Village Voice 1000x too large.** `fromLedgerUnits` has one
  non-test caller.
- **`reverse()` takes its amount from the caller.** A 25-credit posting was
  reversed into a 1,000,000-credit payment with every invariant green. Still open.
- **`postTransfer` has no deadlock retry** while `postTransferPair` does. Still open.
- **`mint_rules.amount` is `decimal(18,4)` and its tokens are `decimals 0`**, so a
  founder can save a rule for an amount the registry rounds away. Still open.

---

## Deliverable 1: the document

`docs/ECONOMICS.md` exists and is a decent start. Make it the thing a founder, a
contributor and an agent can all rely on.

The bar: **anything in it that is not true is worse than nothing**, because
somebody will act on it. Two rules that produced the current version and should
survive into yours:

- Where the code and the intention differ, say so. Do not describe the intention.
- Where a claim is proven, say what proved it. Where it is not, say that too.
  "Proven by its tests" and "proven" are different words in this file.

What it still lacks:
- The spend side. `server/lib/spending.ts`, the sinks, what a member can actually
  buy, and what refuses them. Currently a sentence.
- The exit path. What a departing member's balance does, who decides, and what
  the village owes. This is the single most litigated question in real intentional
  communities and it is two lines here.
- Worked examples with real numbers. A member joins, completes a quest, gives
  gratitude, holds a seat through a settlement, spends, leaves. Every posting,
  named, with the row it writes. That is the section a founder will actually read.
- The failure modes as a member experiences them, not as the code raises them.

---

## Deliverable 2: the pipeline that keeps it true

Every document in this repository has drifted, including this one within a day of
being written. The generated ones did not. Copy that.

`docs/TOKENS.md` is generated by `scripts/generate-token-doc.mjs` from the code
and enforced by `scripts/check-token-doc.mjs`, which fails CI when the file and
the code disagree and prints both sides. That guard has caught real drift twice.

`docs/ECONOMICS.md` cannot be fully generated, because most of it is judgement.
So split it:

- **The facts are generated.** The token table, the faucets, the mint rules, the
  decimals, the sinks, the conservation invariant, the trigger table. These come
  out of the code and the schema, into marked regions of the file, and a guard
  refuses a mismatch exactly as the token doc guard does.
- **The narrative is guarded differently.** A check that fails when any file in
  the economy's own surface changes without `docs/ECONOMICS.md` being touched in
  the same change. Crude, and right: it cannot know whether the prose is correct,
  but it can refuse to let somebody change how money moves and say nothing.

Name the economy surface explicitly in the guard so the list is reviewable:
`server/lib/economy.ts`, `ledger.ts`, `spending.ts`, `exit.ts`, `voiceClaim.ts`,
the token registry migrations, and the mint-rule routes.

**Give the guard its own self-test**, in the shape of
`scripts/check-identity-keys.test.mjs` or `scripts/check-migration-compat.test.mjs`,
both of which build real fixtures and assert real exit codes. An unrun guard is a
comment; a guard with no self-test is a comment that looks like a guard. This repo
has both mistakes on record, and note that the token doc guard itself does NOT
have a self-test today, which is worth fixing while you are in there.

---

## Deliverable 3: the economics model for the shared dry run

**You do not build the dry run. You build its economics half.** Rye has decided
the shared simulation ENGINE is owned by the governance session, because a
proposal changes economic parameters and governance weight IS a token balance, so
a dry run that models one without the other answers half a question.

Three layers, named apart so nobody builds two of anything:

| Layer | Owner |
|---|---|
| The **engine**: takes a village config plus a set of proposed changes, runs N cycles, writes nothing | governance session |
| The **governance model**: what a ballot does to power | governance session |
| The **economics model**: what a cycle does to balances | **you** |

### What the feature is, in Rye's words

It is *"part of the setup process for any game to also run a governance and
economics dry run to see how it's all working"*, it *"should also stay available
to model changes and how they would affect a game when players are proposing to
change anything"*, and it *"should be able to catch and flag potential issues
during the test phase so we don't have to catch them live."*

So it has three lives: a founder sees a season before thirteen people depend on
them; a proposal carries a preview of what it would do, so a village votes on an
economy rather than on a number; and it runs in CI over a complete cycle so what
was found this session cannot come back.

### Four rules that hold for your half too

**THE CARDINAL RULE: a simulation must never write to the real ledger.** Not one
row. Structurally impossible rather than carefully avoided, because the button
will be pressed by founders who do not know what a ledger is. If the engine's
contract does not make that impossible, say so to the governance session before
you build against it, not after.

**Deterministic and seeded.** If two members run the same proposal preview and
see different numbers, they will argue about the tool instead of the proposal.

**Comparative, not absolute.** A preview is a diff. "The gratitude pool runs dry
in cycle 7 instead of never" is something a village can vote on. A table of
absolute postings is not.

**It reads the village's ACTUAL configuration**, not a fixture: its tokens and
their decimals, its `mint_rules`, its `game_variables`, its module state, its
member count and seats.

### What your model must flag

Every one of these is a real failure mode this codebase has or could have, and
each is the kind of thing a founder cannot discover any other way until it hurts:

- **A rule that can never pay.** The engine already computes `unpayable` for
  exactly this: a `from_source` rule on a token the work posts no amount in, a
  missing faucet, an amount below the token's own resolution. It currently ends
  up in a log line. Surface it in words a founder understands.
- **An amount that rounds away.** `mint_rules.amount` carries four decimal places
  and most tokens carry none, so 0.4 credits saves cleanly and pays nothing.
- **A pool that exhausts.** Gratitude allowance times members times cycles
  against the pool. Say which cycle it runs dry in.
- **Concentration**, which is where your half meets governance most directly.
  Rye has ruled founders may self-grant voice and that the protection is
  TRANSPARENCY, so the percentage of total voice a holder commands IS the
  protection. Compute it; the governance model puts it on screen before a vote.
- **Conservation**, asserted at every simulated step: every token summing to zero
  across all accounts including faucets.
- **Negative balances that are not faucets**, and any ceiling never reached or
  always hit, which usually means it was set without thinking.
- **Concurrency.** Several members acting in the same instant. That is what found
  the deadlock, and a serial simulation cannot see that class at all.

### Output

Plain language a founder can act on, not a table of raw postings. The audience is
somebody standing up their first village, and the whole point is that they learn
something before it costs them.

---

## Who you work with

**The governance session** owns the engine and the governance model. Get their
interface contract before you build: what a caller hands the engine, what a
domain model implements, what comes back. If no contract exists yet, ask for one
or offer a strawman. Do not build a second engine because theirs is not ready;
say so and wait, or agree a seam.

**The coordinator session** (`amora-architecture-audit-a4778f-1a`) lands merges
across all sessions. Hand it a branch rather than pushing to `main` yourself.
Every conflict it hit today was in shared state neither side could see: the
ratchet baselines and the identity guard's pending list all conflict silently,
because each lane lowers them to its own measured value, and taking either side's
number records a figure true of neither tree.

Claim the Economy row in `PLAN_TO_A.md` so nobody builds this twice. Three
sessions landed the same lanes today by accident.

---


## Deliverable 4: Village Credits to 2 decimals

**RULED 2026-09-04. The decision is made and the 4-across-the-board sweep is
cancelled. The work is yours, and nobody else changes a token's scale.**

Rye's ruling, in his own shape: *if a bunch of work is already done to move them
all to 4 decimals and we're already nearly there, then finish the work. If not,
all I want is that currency-like tokens (the village credits) need to have 2
decimals.*

**None of that work was done**, which is what settled it. Measured 2026-09-04:
zero migrations change any token's `decimals`, `VOICE_DECIMALS` is still 3, and
no token has moved. The only decimals-adjacent things that landed were `0126`
widening `token_ledger.amount` to `bigint`, which was preparation, and the wallet
and send-card fixes, which were bugs caused by Village Voice's EXISTING 3
decimals rather than sweep work.

### The scope

**In:** `credits`, from 0 to 2. Two decimals is what money looks like everywhere
else, and a village currently cannot price anything at 12.50.

**Out, unless you argue otherwise and Rye agrees:** `library-credit` and
`stay-credit` are vouchers where a whole unit may be the honest shape, because
half a stay credit may mean nothing. `village-voice` stays at 3; it is governance
weight rather than currency, and its scale exists so a rule minting 0.1 voice
does not post zero. `gratitude` is recognition and whole is right. The two Hypha
mirrors are not ours to scale.

### Why it is still not a column change

`postTransfer` takes MINOR units. Most of its callers hand it a human number, and
they are correct today only because `credits` sits at 0 where the two are the
same number. **Walk every path that posts `credits`** and decide, per caller,
whether it holds a human figure or minor units. The two obvious repairs are both
wrong: `give()` posts straight through, so a scale change without touching it
posts a hundredth; and converting inside `postTransfer` breaks `sweepBalances`,
which reads balances that are ALREADY minor units and would multiply a departing
member's settlement.

Then the display half. Every surface that renders a credits amount must divide,
and **every input beside one must convert back**. The rule that cost the most
this week: *a surface that divides on one half of a pair and not the other is
worse than one that divides on neither, because both raw at least agree.* A fix
landed that divided a send card's balance and left its input posting minor units,
so a member saw "You hold 10", typed 1, and moved 0.001. `client/src/lib/tokenAmount.ts`
holds `formatTokenAmount`, `toMinorUnits`, `smallestUnit` and `decimalsOf`, with
round-trip tests proving that what a member is shown, typed straight back, is
what the ledger held. Use them and extend that file.

A separate lane is already fixing five surfaces that render a ledger amount raw.
Check what landed before touching a render site.

### The order

The ledger is empty (0 rows on production), so the migration itself is free and
there is nothing to rescale. That will not be true forever. Do the caller sweep
and the display pass FIRST, with tests, then change the column last, so the day
the scale changes every path is already correct.

---


## How this codebase lies to you, and how to not be fooled

This session cost four separate discoveries of the same shape. Read them; they
are the difference between a green run and a true one.

- **A test proves a behaviour is INTENDED, never that it is correct.** A test
  named "pays a confirmed quest in voice and credits" asserted on four columns of
  `mint_rules` and never read a balance. It was green through a bug that cost
  every village its first payout. When you write a test, make it read the
  OUTCOME, and prove it fails when you remove the fix.
- **The first-payout bug is the cautionary tale for this whole area.**
  `economyEpoch` both read the epoch and created it, and its only caller was the
  mint. So the first confirmed quest in a village's life stamped the epoch and
  was then ruled out by it, losing by twenty milliseconds. 3,671 tests were green
  through it. A function that both establishes a boundary and judges against it
  will always let the first case through.
- **An empty state and a real zero are different facts**, and code guarding on
  falsiness cannot tell them apart.
- **A check that reports the same thing when it did not run as when it passed is
  worthless.** Two guards in this repo did exactly that.
- **Never exercised is not working.** It is the rule the third grading used, and
  it is why Economy fell from A to B-.

---

## Working here

- **Your own worktree, at a SHORT path, cut from `origin/main`.** From any clean checkout
  (`C:/Users/taren/Desktop/Amora/wt-govbrief` is one; `hotfix` is another lane's live worktree
  today, never cut from it): `git fetch origin && git worktree add -b wt/econ
  C:/Users/taren/Desktop/Amora/ECON origin/main`, then copy `.env` into it and `pnpm install`. A deep path breaks `git show <rev>:<path>` on
  Windows and the migration guard then reports nonsense.
- **Copy `.env` or your green means nothing.** Without it about a third of the
  suite skips. An unfiltered run with no database now exits 1 and says so.
- **Exit codes after a pipe are the pipe's.** `cmd > /tmp/out.txt 2>&1; echo "RC=$?"`.
- **`main` is production.** A push auto-builds on Railway and applies migrations
  at boot. Commit on your branch; hand it to the coordinator to land.
- **Stage by name, never `git add -A`.** Other sessions share this tree.
- **Gates**: enumerate from the workflows DIRECTORY, never from memory:
  `grep -hoE "node scripts/check-[a-z0-9-]+\.mjs" .github/workflows/*.yml | sort -u`
- **Migrations are immutable once shipped** and apply at boot with no gate. A
  deploy is a schema change.

---

---

## The governance contract, from the governance session (2026-09-03)

Written by the governance coordinator after reading this prompt. Everything below is either a
ruling the founder has made (cited to `docs/GOVERNANCE_EVOLUTION_PROMPT.md` on
`wt/governance-build`, sections 19 to 19G, 20.8, 20.11 and 21) or a seam the two builds share.
Where this section and the text above disagree, this section is the newer reading; say so to the
governance session if you think it is wrong.

### The two kinds of decision, and what that does to money

Every proposal the village votes on is one of two kinds, classified once in a table the governance
build exports (`governanceKinds` (on `wt/governance-build`), or wherever the dispatcher lane put it; read it):

- **A TOKEN_SEND** (a payout, a distribution, a founding allocation, a power transfer that moves
  balances) **executes the moment its ballot closes passed** when its timing is "at acceptance",
  which is the default for this kind. A seated steward's NO vote on a token send fails it at close,
  with a recorded reason; there is no window after it executes. **A minted token cannot be
  un-minted by governance**: a veto reaches a payout only while its ballot is open, never after.
- **A GAME_CHANGE** (a setting, a mint rule, a pool dial, a threshold, a role, a module, the vote
  mode) **never executes at close**. It lands at `lands_at`, the later of the next boundary of the
  village's active cycle clock and 72 hours after the close, unless a steward vetoes inside that
  window. Its default timing is the new moon.

Consequences you must build to:

1. **Mint rules and cycle-timed dials land through `applyDueGovernance`**, the governance build's
   five-minute scheduler job (`applyDue` (on `wt/governance-build`)), which also runs from the human cycle close.
   `applyPendingRules` (the mint-rule promotion at `pending_from_cycle`) is being routed through it
   and the intended landing cycle is passed in rather than recomputed from `new Date()`. **Do not
   build a second "later" mechanism in the economy**, and do not move the promotion back into
   `runSettlement`. If the economy needs something to happen at a boundary, it registers a hook the
   landing job calls, or asks the governance session.
2. **Settlement reads the value in force during the cycle it settles.** A cycle-timed dial or a mint
   rule cannot be applied while an ended, unclosed cycle exists; the landing job refuses it. If
   `runSettlement` reads a dial at run time rather than at the cycle it settles, that is a defect the
   dry run must flag and the economics session must fix.
3. **A bundle waits as a whole.** A proposal mixing a payout with a Game change lands as one Game
   change at one instant. Your model does not need to handle a half-applied bundle: the changeset
   applies in two phases (validate everything, then apply with irreversible ledger writes LAST) and
   writes one `governance_element_ledger` row per element (`ballot_id`, `element_index`, kind, the
   row written, old value, new value). Read that ledger for "what changed this moon"; never
   re-derive it.
4. **`reverse()` taking its amount from the caller is in your path and on ours.** Trial moons and
   sunset clauses (brief section 21.2) schedule a REVERSION of a Game change; a reversion never
   claws back a token that was paid under the trial value. But every reversal the economy offers
   must take its amount from the posting it reverses, or the governance override and redaction
   paths inherit the 1,000,000-credit hole. Fix `reverse()` before either build lands.

### The cycle clock is governance's, and it is a setting now

The founder ruled the cycle rhythm is a village setting again, lunar by default (19 Q5, 19F).
`cycleClock` (on `wt/governance-build`) (built in Phase 1b) is the one clock: `boundsFor`, `idFor`, `parseId`,
`startOf`, `nextBoundaryAfter`, `cycleNumberAt`, with the lunar implementation unchanged from
`shared/lunar.ts` and a calendar implementation under its own id prefix. **Every cycle id, cap,
allowance and settlement boundary in the economy reads the clock through that seam**, never
`shared/lunar.ts` directly, and past cycles keep the ids they closed under. A `cycle.mode` switch is
a constitutional Game change that lands only at an instant that is a boundary under both clocks
with the open cycle settled first. Your model must simulate a village on either clock.

### Voice, weight and decimals

- **`village-voice` is THE Voice.** The founder settled it (19B, 19F). Governance changes the
  default of `governance.weight_token` from `gratitude` to `village-voice`; ruling 4 in
  `scripts/generate-token-doc.mjs` has already been rewritten by the governance docgen lane
  ("half built": the switch is reversible and holdings survive; what was missing was the village's
  own vote, which now exists as the `governance_mode` subject). Coordinate before you touch that
  generator again: two lanes editing one generator produce a guard that is red for both.
- **Quorum and unity are pure token weight** (19F), computed over `village-voice` balances (or
  heads under one-person-one-vote). Your decimals sweep therefore changes the number every ballot
  is decided on. The governance surfaces that must move with the sweep, and that the governance
  build owns: `server/lib/governanceWeights.ts` (`weightsFor`, `shareOfTotal`), the standing and
  weights routes, `MyStanding`, `WeightRecord`, `voteBars.ts`, the Birthing document's distribution
  table, and the admin mint form's units hint. **Hand the governance session the exact
  `toLedgerUnits` / `fromLedgerUnits` contract you settle on and the commit it lands in**, and do not
  convert inside `postTransfer` (the prompt above says why).
- **Share of total voice is one function.** `shareOfTotal` lives in `governanceWeights`
  (governance-owned) and both the dry run's concentration flag and the ballot page call it. Do not
  write a second one in the economics model; import it.
- **The founding allocation** (19 Q2, 19G): before the Birthing, catalysts issue `village-voice`
  through ONE faucet exempted from the launch gate in `server/lib/gameStart.ts`, recorded as a
  proposal-shaped entry, with each catalyst's share of the total shown. The governance `birthing`
  lane builds the exemption; **your conservation invariant and your generated token document must
  accept and describe it**, and your dry run must model a village whose only pre-launch supply is
  that allocation. Self-grant is allowed there with transparency as the protection.
- **A non-human seat votes** (19G): a river or a mountain holds a voting seat through a human or a
  bot representative, and whether its weight counts toward quorum is a setting, excluded by
  default. Your model's concentration figures must be able to attribute a seat's Voice to its
  representative.

### The shared dry run: the engine's contract, strawman

The governance session owns the engine and will build it in its Phase 2 as the `dryrun-engine`
lane, on top of `proposalDryRun` (on `wt/governance-build`) (Phase 1b), which already shares the changeset
validator with the executor so the thing previewed is the thing that will run. Build your model
against this contract; if you need it changed, say so before you build, and we change it together.

```ts
// shared dry-run types module (governance-owned, on wt/governance-build; both models import it)
export interface VillageSnapshot {          // read once, then plain data; no pool, no connection
  atIso: string; clock: CycleClockSpec;      // lunar | calendar, timezone
  tokens: TokenSpec[];                       // slug, kind, decimals, faucet, sinks
  balances: Record<string, Record<string, bigint>>; // accountId -> slug -> minor units
  mintRules: MintRuleSpec[]; variables: Record<string, string>;
  members: MemberSpec[];                     // id, stage, seats, isRepresentative?, representsSeatId?
  modules: Record<string, Lifecycle>;
}
export interface ProposedChange { kind: ChangeItemKind; key?: string; from?: unknown; to?: unknown; timing: 'at_acceptance' | 'next_moon'; expiresAfterCycles?: number }
export interface SimInput { snapshot: VillageSnapshot; changes: ProposedChange[]; cycles: number; seed: number; concurrency?: number }
export interface DomainModel {
  name: 'governance' | 'economics';
  step(state: SimState, cycle: number, rng: Rng): SimState;   // pure; returns a new state
  flags(state: SimState, cycle: number): Flag[];               // plain-language, actionable
  invariants(state: SimState): Violation[];                    // conservation, non-negative non-faucets
}
export interface SimResult { baseline: CycleResult[]; proposed: CycleResult[]; diff: Diff[]; flags: Flag[]; violations: Violation[]; seed: number }
export function simulate(input: SimInput, models: DomainModel[]): SimResult   // writes nothing: takes no pool, no connection, no fs
```

Rules the engine enforces so the cardinal rule is structural: `simulate` receives plain data and
has no import path to the pool; the snapshot is taken by a governance-owned reader that opens a
READ-ONLY connection (`SET TRANSACTION READ ONLY`) and returns plain objects; models are pure
functions of state; the seed is part of the input and printed in the output; the diff is against
a baseline run of the same snapshot with no changes. Your economics model implements
`DomainModel` and owns everything in `step` that moves balances: settlement, mint rules,
allowances, sinks, exits, the pool. The governance model owns thresholds, weights, concentration,
windows and landing instants. The engine composes them in a fixed order per cycle (governance
landings first, then the economics step, then flags and invariants from both) and stops at the
first violation with the cycle and the posting named.

### Who owns which file (so the merge agent never takes either side)

**Files named below without an extension live on `wt/governance-build` and are not on `main` yet; the doc-link guard is why they are written that way.**

| Governance session owns | Economics session owns | Shared, edit by category only |
|---|---|---|
| `applyDue` (on `wt/governance-build`), `changeset`, `governanceKinds`, `proposalDryRun`, `stewardship`, `delegation`, `governanceWeights`, `ballots`, `mechanics`, `governanceWindows`, `moonDigest`, `cycleClock` (on `wt/governance-build`), `shared/governanceEngine.ts`, `shared/ballotSubjects.ts`, the shared dry-run types, the governance route modules, `delegation`, `constitution`, `generate-governance-doc` (on `wt/governance-build`) and its guard, `GOVERNANCE` (on `wt/governance-build`) | `server/lib/economy.ts`, `ledger.ts`, `spending.ts`, `exit.ts`, `voiceClaim.ts`, `economySeed.ts`, `gratitude.ts`, the mint-rule routes, `economicsModel` (on `wt/governance-build`), `scripts/generate-token-doc.mjs` and its guard (tell governance before editing ruling text), `docs/TOKENS.md`, `docs/ECONOMICS.md` and its guard | `shared/gameVariables.ts` (Governance category is governance's; Gratitude, Economy and Ledger categories are economics'; the Cycle keys are governance's), `server/index.ts` (two exempt lines per route module; no net lines), the settlement job registration (governance registers `applyDueGovernance`; economics owns `runSettlement`; neither reaches into the other's body) |

### Numbers, branches and how to reach us

- **Migration numbers:** governance holds 0132 to 0139 and 0144; the bridge lane holds 0140 to
  0143; **economics takes 0145 to 0149**. Re-measure three ways immediately before creating a
  file; a green pull request is invalidated from above when another lane lands a higher number,
  and every lane renumbers at landing time from whatever the ceiling is then (never after a
  migration has run on a real instance).
- **Branches:** governance integrates on `wt/governance-build`; cut your worktree from
  `origin/main`, never from `C:/Users/taren/Desktop/Amora/hotfix`, which is another lane's live
  worktree today. Land through the coordinator.
- **The generated documents are a pair.** `docs/TOKENS.md` and `GOVERNANCE` (on `wt/governance-build`) each carry a
  guard; a change that moves either regenerates BOTH in the same commit, or the other guard goes
  red on the next merge. The governance doc reads `SUBJECT_CLOSERS`, the Governance dials and the
  clock; yours reads the registry and the faucets; the dry-run engine's types will be read by both.
- **Reach the governance session** with `SendMessage` to the session named "Amora Governance engine
  documentation" (the coordinator of the `gb-*` swarm), and the bridge and economy-fixes session as
  "amora-ec". Say which file you are about to touch when it is on the shared list, before you touch
  it, and expect the same.

### Two more questions for Rye, from the governance side

5. **Should the dry run's proposal preview be frozen into the ballot document?** Governance's
   storytelling rule (21.1) freezes the dry run's effects into a constitutional proposal's document
   so the village votes on what it saw. If the numbers move between proposing and landing, the
   landing job re-validates and refuses with the element named. That answers your question 3 for
   Game changes; for a payout, the preview is the amount, and the amount is frozen.
6. **When a trial moon changes the cycle pool and the moon pays out under it, is that payout the
   village's to keep?** The governance reading is yes: a reversion undoes the dial, never the
   tokens. Say so if he rules otherwise.

---

## Questions for Rye, when you reach them

1. **What does a departing member get?** The exit sweep moves their balance to a
   settlement account. Whether they are owed anything, in what, and who decides,
   is a governance and possibly a legal question, and it is the one that most
   often breaks real communities.
2. **Should the dry run be able to run against the LIVE village's real numbers**,
   or always against a copy? Real numbers are more useful and closer to the thing
   that must never write.
3. **When a proposal carries a dry run, is that preview binding on the proposal?**
   If the numbers change between proposing and executing, does the village vote
   on what it saw?
4. **Unspent gratitude expires at cycle close, by ruling.** Should the dry run
   show a village what it is losing that way, and is that a number you want
   visible?

---

## What to do first

1. Re-measure the production figures at the top of this file. They have a
   timestamp and you should not trust them.
2. Check whether `wt/fix-gratdead` and `wt/fix-decimals` have landed. Do not
   duplicate them; build on them.
3. Write the smallest honest version of the dry run: one cycle, one member, one
   quest, conservation asserted at every step. Get that true before you make it
   broad. The value of this feature is entirely in whether its answers can be
   trusted, and a broad simulator that is subtly wrong is worse than no simulator,
   because a founder will believe it.
