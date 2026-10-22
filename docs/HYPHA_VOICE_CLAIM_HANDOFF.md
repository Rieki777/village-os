# The voice claim: what is built, and the one thing still missing

Voice is earned in this village and settles on Hypha. This document is the state
of that crossing. It replaces the earlier version, which was written when
nothing was built and three things were unknown.

**Two of the three are now settled.** The secret is on Railway. The numbers are
decided and live as dials. What remains is the Hypha space slug, and the two
pieces that cannot be written until a real space exists to send an intent to.

---

## Where it stands

| step | state |
|---|---|
| 1. `requestVoiceClaim` — debit under lock, one open claim per member | **built, 25 tests** |
| 2. The bridge raises one intent per claim | **not built. Claims are gated shut until it is.** |
| 3. The HMAC receiver | **built** |
| 4. The poller, so a dropped webhook cannot strand somebody's voice | **not built. Follows step 2.** |
| 5. Boot assertion on the secret | **built** |

A member can accrue voice, see exactly what their chip says and why, request a
claim, and cancel it. The debit, the refund and every terminal state are proven
against conservation. What a claim cannot yet do is become a proposal on Hypha,
because nothing knows where to send it.

---

## Two tokens cross now: voice and earned equity (0266)

`earned-equity` is the accruing twin of the `equity` mirror, the way
`village-voice` is the twin of `voice`. It is claimed through the SAME code:
`server/lib/voiceClaim.ts` is a set of claim lanes, one per token, each naming
its bridge (`sys:voice-bridge`, `sys:equity-bridge`), its settled account
(`sys:voice-settled`, `sys:equity-settled`), its threshold dial
(`economy.voice_claim_threshold`, `economy.equity_claim_threshold`) and its key
prefix (`voice-claim`, `equity-claim`). One `voice_claims` table holds both,
told apart by `token_slug`, and every read of it filters on that column.

What this means for whoever builds the steps below:

- **The dispatch must raise an intent for either lane.** The row's
  `token_slug` says which mirror the proposal is about (`laneForToken` gives the
  lane, and the lane's `mirror` the slug on Base). The same `intent_key`
  uniqueness covers both, because the two lanes write different prefixes.
- **The poller reconciles per lane.** `bridgeReconciliation(pool, lane)` takes the
  lane and defaults to voice; call it once for each entry in `CLAIM_LANES`.
- **`BRIDGE_DISPATCH_BUILT` gates both.** Flipping it opens equity claims too,
  and `server/earnedEquity.test.ts` has its own case that throws the day it
  turns true, beside the one in `server/voiceClaim.test.ts`.
- **Settlement already handles both.** `settleVoiceClaim` (now an alias of
  `settleClaim`) reads the lane off the stored row, so the receiver below needs
  no change.

---

## The DHO slug, and why setting it does NOT open claims

The slug goes in **Admin → The Mint**, in the card at the top of the page. No
deploy is involved: the field writes through the normal variables path and
applies at once.

**Filling it in is safe and arms nothing.** `BRIDGE_DISPATCH_BUILT` in
`server/lib/voiceClaim.ts` is `false`, and it gates `claimable` and hard-refuses
`requestVoiceClaim` with a 503. That constant is the honest statement of what
this build can do, and it is deliberately not a dial: no village should be able
to open claims by typing in a panel.

This gate exists because of a real trap. A claim debits the member's whole voice
balance at request and waits for Hypha to answer. With no dispatch, Hypha is
never told, so the webhook never fires, so the claim would sit in `requested`
for ever with the member's balance reading zero, recoverable only if that member
happened to know to cancel something nobody told them was stuck. Naming the
space is the last piece of CONFIGURATION, which makes it look like the last
piece of work.

**When you ship step 2, flip the constant in the same commit.**
`server/voiceClaim.test.ts` has a case that throws a written instruction the
moment it turns true, so the suite goes red until the tests are rewritten to
prove the dispatch instead of the gate.

**Set it only to a space the village controls.** A claim is a proposal to move
real value, and an intent aimed somewhere else is value leaving through a door
nobody opened. It is a founder-ring dial for exactly this reason: a governance
proposal cannot redirect it.

---

## The dials, and how they are set

All four live in **Admin → The Mint**, each with the reasoning shown in full
beside it.

| dial | default | what it decides |
|---|---|---|
| Voice needed before a member can claim | **100** | Ten confirmed quests, or two seasons holding a seat. |
| How many days Claims Week stays open | **7** | |
| When each Claims Week begins | **03-21, 06-21, 09-23, 12-21** | The solstices and equinoxes, the rhythm the moon settlement already runs on. Blank keeps claims open all year. |
| Your Hypha space | *(empty)* | The one thing above. |

At the seeded rates a confirmed quest pays **10 voice** and a seat pays **50 a
season**, so the threshold is arithmetic a member can do in their head. Voice is
still stored at three decimals even though every seeded amount is whole: a
founder who later types `0.5` into the Mint with decimals at zero would have it
truncated to nothing and paid silently, which is a bug this codebase has already
been bitten by once.

A founder editing a dial here takes effect at once. The same dial moved by a
governance proposal waits for the next moon, so a vote cannot shift the
goalposts under a season already counting.

---

## What the next session builds, once there is a slug

**Step 2, the bridge.** One intent per claim, idempotent on `intent_key`, which
is `UNIQUE` in `0072` precisely so a retried dispatch reuses the existing Hypha
proposal instead of raising a second one against the same voice. Write the
`hypha_ref` back onto the claim row when the proposal exists. `hypha_ref` is
deliberately NOT part of the dedupe, because it is null until after the call
that would need it.

**Step 4, the poller.** A webhook that never arrives must not strand somebody's
voice indefinitely. Read `voice_claims_state_idx`, which exists for this query,
and settle anything Hypha considers finished. It must call the same
`settleVoiceClaim` the receiver calls, never its own refund path: that function
holds the compare-and-set that makes a racing cancel and confirm safe, and a
second settler that does not go through it would reintroduce the exact double-pay
the receiver is careful to avoid.

**The poller is also the only thing that will ever write `stale`.** That state is
documented in `0072` as the refunding end for a claim nobody acted on, and no
code in the build writes it today. Until something does, a claim Hypha never
answers holds a member's whole balance for ever. Give it an age from a dial and
have it call `settleVoiceClaim(..., "stale")`.

**Two helpers exist for it already, both tested:**

- `retryRefund(pool, claimId)` gives back voice for a refunding claim whose
  reversal failed. It deliberately skips `canSettleClaim`, because the claim is
  already in the right state and what failed was the ledger post. Idempotent, so
  a poller can call it blindly.
- `bridgeReconciliation(pool)` returns `{held, owed, drift, openClaims}`. The
  invariant is `held == owed`: the bridge holds voice against OPEN claims and
  nothing else. **Alert on drift.** A stranded claim, a silently failed refund
  and a double-posted debit all break that equality, and none of them break
  conservation on their own, which is why the boot invariant was never going to
  catch them.

---

## Two things not to change without reading why

**The debit happens at request, not at confirmation.** Voice leaves the
member's balance the moment they ask, so it cannot be spent or claimed twice
while a proposal is pending. Every ending that is not a confirmation gives it
back by REVERSING that debit. A refund that mints is a way to make voice, and
the reversal path inherits every guard the debit passed.

**`sys:voice-bridge` is not a faucet.** Voice held against an open claim came
from a member. A faucet there would let a claim create the voice it claims.
After a confirmation the bridge keeps the balance, which is the truthful record
of voice that settled somewhere else.

---

## The receiver's contract

`POST /api/webhooks/hypha-voice`, mounted beside the Stripe webhook and before
`express.json()`, because an HMAC is over the bytes that were sent and a parsed
and re-serialised body is not those bytes.

- `x-hypha-signature`, hex, optionally `sha256=` prefixed, over the raw body.
- The payload supplies exactly two things: **which claim, and what happened.**
  Village, member, token and amount are read back from the stored row. A
  correctly signed message still cannot redirect a claim or change its worth.
- A replay of a verdict already applied returns **200**, because the sender is
  retrying to be heard and a non-2xx would keep it retrying over a settled claim.
- Fails closed with no secret. The boot assertion means a village with the
  crossing open cannot reach that state anyway.

Verdicts understood: `accepted` / `approved` / `passed` / `executed` confirm;
`rejected` / `declined` / `failed` / `expired` reject and refund. Nothing is
confiscated for losing a vote; the voice re-accrues and can be claimed again.

---

## What is still missing, named plainly

- **No admin surface over `voice_claims`.** Nothing lists open claims, shows the
  reconciliation drift, or offers a repair button. `bridgeReconciliation` and
  `retryRefund` are the two calls such a page needs; the page is not built.
- **The member surface is the wallet, and it is read-only while claims are shut.**
  `GET /api/me/wallet` (server/routes/wallet.ts) gives every token a row with the
  claim chip's sentence and when claims open, and the profile's wallet card
  renders it. Its claim button appears only when `claimable` is true, so none
  renders in this build. `POST /api/me/wallet/claim` is the claim door for any
  lane and answers 503 until the dispatch ships. The older
  `/api/me/voice-claim*` routes still exist; cancel there settles any lane.
- **The rates correction only reaches rows nobody edited.** `0076` repairs the
  seeded 0.1/0.5 to 10/50, scoped to rows still holding the old defaults. A
  village that deliberately set its own number keeps it, which is correct, and
  means a village that edited to something odd before this shipped still needs a
  human to look.

## Traps found by the adversarial pass, so nobody rebuilds them

**A guard placed before `initStores()` reads platform defaults.** `loadVariables`
runs inside `initStores`, so anything earlier in `startServer` that calls
`stringVar`/`numberVar` silently gets the registry default. The boot assertion
sat there first and could never have fired.

**A boot-fatal keyed on a database row is a brick.** `economy.hypha_space` lives
in MySQL and its secret lives in the environment, so an admin typing a slug could
make every container refuse to start at the NEXT restart, with the panel that
could undo it served by the process that would not boot. The refusal now happens
at the write, where the admin can act on it, and only a short or borrowed secret
is still fatal at boot. An empty one is loud and survivable, because the receiver
answers 503 without it.

**`sent.length` is UTF-16 code units; `timingSafeEqual` compares bytes.** The
guard written to stop that function throwing let a 63-hex-plus-one-high-byte
header through and threw a RangeError out of the handler: a 500 and a stack
trace, unauthenticated, at the rate limiter's ceiling. Use `secretEquals`, which
was already in the file and compares buffer lengths.

**`Date.UTC` rolls an out-of-range month forward instead of refusing it.**
`"2026-06-21"` pasted into the Claims Week dates parsed as month 2026 and built a
window in the year 2194, so claims shut for a century and a half and members were
shown that date as the next opening.

## Verifying it

```bash
npx vitest run server/voiceClaim.test.ts server/earnedEquity.test.ts
```

33 tests, plus 16 in `server/earnedEquity.test.ts` for the equity lane. They cover the window arithmetic including the December rollover, the
chip's wording in every refusal state, the debit, both refunding endings, the
confirmation, a cancel racing a confirm, two cancels racing each other, and the
four ways the boot assertion refuses a secret. Each ledger case re-proves
conservation and cache drift afterwards.

If `TEST_DATABASE_URL` is unset the DB cases **skip** while the summary still
reads "passed". Read the skip count and the per-test durations before believing
a green.
