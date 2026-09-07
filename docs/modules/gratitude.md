# Module design: Gratitude — module id `gratitude`

Provenance: platform

<!-- describes: server/lib/gratitude.ts server/lib/gratitude-cycles.ts server/lib/cyclePool.ts server/lib/economy.ts server/lib/ledger.ts server/lib/erasure.ts server/lib/calendarProviders.ts server/lib/examples.ts server/repos/gratitude.ts server/index.ts shared/gameVariables.ts shared/gameConfig.ts shared/modules.ts shared/lunar.ts client/src/lib/settlement.ts client/src/pages/GratitudeWall.tsx -->

> Recognition sends, the lunar clock they are filed under, and the value pool an admin releases
> at each close. The send rules live in `server/lib/gratitude.ts` over the locked engine in
> `server/lib/economy.ts`; the cycle arithmetic is pure and lives in
> `server/lib/gratitude-cycles.ts` over `shared/lunar.ts`; the routes and the whole close are in
> `server/index.ts`. It is core, so no village can switch it off, and every fork inherits exactly
> this contract on day one.

## This is not the Village Feed module

`docs/modules/gratitude-feed.md` is a different module. Its registry id is `feed`, its name is
Village Feed, it is not core, and a village can turn it off. The two are joined at one point and
it is worth being exact about which:

- **This module** owns the allowance, the per-recipient ceiling, the `gratitude_log` table, the
  lunar cycle and the pool. It answers `/api/game/gratitude/*`, `/api/game/cycle*` and
  `/api/admin/cycles/*`.
- **`feed`** owns the feed surface and the heart button. A heart is not a separate currency: the
  route `POST /api/feed/threads/:id/heart` calls `sendGratitude` in `server/lib/gratitude.ts`
  with `kind: 'heart'`, so it spends the same allowance, obeys the same per-recipient share, and
  lands in the same table as a written acknowledgment.

If you turn the feed off, this module keeps working and the heart channel goes away. If you read
[gratitude-feed.md](gratitude-feed.md) looking for the allowance rules, you are in the wrong
file: that document is a pre-build design record and still describes caps this build retired.

## What this module is, and why it is core

The registry entry in `shared/modules.ts` marks `gratitude` as `core: true`, tier `included`,
shelf `recognise`, data class `member-pii`, `requires` and `recommends` empty. `setModuleLifecycle`
in `server/lib/modules.ts` refuses any lifecycle change for a core module with `"is core and
cannot change lifecycle in v1"`, and `effectiveLifecycle` returns `public` for it unconditionally.
Three consequences a fork operator meets:

- **No route here sits behind `requireModule`.** `server/lib/dryRun.ts` records this deliberately:
  `/api/game/gratitude/send` mounts with no module guard, which is why the dry run can assert the
  written allowance holds whatever the catalog says.
- **Its declared `variableKeys` decide nothing, and are still rendered.** Three readers, and
  the two that gate do not gate the same way. `GET /api/admin/variables` in `server/index.ts`
  hides the keys of **non-core** modules whose lifecycle is `off`. `GET /api/game/mechanics`
  hides the keys of non-core modules ranked BELOW `members`, so off *and* preview, because
  that page is anonymous and a preview module's dials would leak what the village is trying;
  the code comment beside it says "Rank test, not an off test". Both skip core, so neither can
  touch this list. The third reader shows it anyway: the admin module catalog
  (`server/index.ts`) puts `variableKeys` on every row, core included, and
  `client/src/pages/Admin.tsx` prints `tunables: 5` in the Gratitude listing detail with no
  `core` guard. The list is inert everywhere it is enforced and visible as a count on the
  modules panel, which is also where the omission noted under Game variables shows up as a
  number one short.
- **It is not metered.** `served` in `server/lib/modules.ts` mounts the usage meter inside
  `requireModule`, and core modules do not mount behind it. The module pool never counts a
  gratitude send.

The declared `apiPrefixes` are similarly inert today: the only reader is the vendor-lapse loop in
`server/index.ts`, which iterates `vendorModules()`, and nothing in the catalog is above
`included`.

## Data model

Three tables, all created before the module framework existed.

| table | born in | what it holds |
| --- | --- | --- |
| `gratitude_log` | `drizzle/0001_init.sql` | one row per send, either channel |
| `gratitude_cycles` | `drizzle/0002_roles_and_cycles.sql` | one row per lunation, only ever written by the close |
| `gratitude_distributions` | `drizzle/0002_roles_and_cycles.sql` | the settled split, one row per recipient per cycle |

`gratitude_log` grew in three passes. `drizzle/0010_gratitude_riders.sql` added `kind`,
`cycle_number`, `context_type`, `context_ref` and the unique index
`gratitude_heart_unique (from_id, kind, context_type, context_ref)` that enforces one heart per
sender per piece of content; plain sends carry NULL context and MySQL exempts NULLs from unique
indexes, so acknowledgments are untouched by it. `drizzle/0071_economy_core.sql` added
`village_id` (default `'local'`), `tag`, `structure_key`, `quiet`, `client_nonce` and the second
unique index `gratitude_log_nonce (village_id, client_nonce)`.

**Three of those columns are written and never read back.** `gratitudeLogRepo.all()` in
`server/repos/gratitude.ts` selects `id, kind, from_id, from_name, to_id, to_name, amount,
message, context_type, context_ref, cycle_id, cycle_number, at` and nothing else, so `quiet`,
`tag` and `structure_key` reach no reader in this module. `quiet` is the one that matters,
because it carries a promise: `POST /api/gratitude` honours it in exactly one place, the
notification (`title: quiet === true ? "Someone thanked you" : ...`, `actorUserId: quiet === true
? null : user.id`), and the comment beside that line says a quiet gift "names nobody, here and
everywhere else it is ever rendered". Everywhere else cannot see the flag. The public wall,
`/me`, `/flows`, the member export and the close are all blind to it. A Hearts-door row happens
to render nameless on the wall for an unrelated reason (see the two doors below), so the promise
looks kept from the one surface where it would show.
`drizzle/0105_one_cycle_one_name.sql` rewrote live `moon-NNN` ids to `lunar-NNNNNN` and
backfilled `cycle_number`; read its header before touching cycle ids, it is the clearest account
in the repository of what a two-formatter column costs.

Three more migrations shaped this module and are easy to miss.
`drizzle/0041_gratitude_context_idx.sql` adds `gratitude_context_idx (context_ref, kind)`, which
is the answer to "why is there an index on a column pair nothing in this module queries": the
heart-count recompute (`UPDATE forum_threads SET heart_count = (SELECT COUNT(*) FROM
gratitude_log WHERE context_ref = ? AND kind = 'heart')`) is a `feed` write, and without the
index it full-scanned this table on every heart tap.
`drizzle/0005_ledger_and_recognition_balance.sql` is where `users.recognition_balance` comes
from, renamed there from `hearts_balance`. `drizzle/0110_one_allowance_one_share.sql` is the
migration that actually retired `gratitude.max_per_recipient_per_cycle` and the two engine
dials, and its header is the primary source for the R73 story this document tells twice.

`gratitude_distributions` gained `credited` and `pool_token` in `0010` and the channel split
`received_hearts` / `received_acks` in `drizzle/0020_feed_settlement_split.sql`. Its natural key
is `(cycle_id, user_id)`.

Value itself is not stored here. The recognition credit and the pool payout are rows in
`token_ledger`, owned by `server/lib/ledger.ts`. `users.recognitionBalance` is a recomputed cache
of the ledger, **and only one of the two doors refreshes it**: `sendGratitude` writes it after
the credit commits, and `POST /api/gratitude` takes the balance back out of `give()` and never
calls `members.update`, so every Hearts-door give leaves the column behind. That drift is what
`GET /api/game/ledger` measures: it returns the summed ledger as `balance`, the column as
`cachedBalance`, and `inSync` for whether they agree. The quest-consent, Work With Us and
admin-mint credits all write the column; this door is the exception.

### Leaving

A member's erasure keeps the value and rewrites the names. `anonymizeMember` in
`server/lib/erasure.ts` first rewrites `token_ledger.description` to "Gratitude from a departed
member" for every `gratitude_received` / `heart_received` posting whose `source_ref` is one of
that member's rows, then runs `UPDATE gratitude_log SET from_name = ?` and `SET to_name = ?`
with "A departed member". Nothing is deleted: ids, amounts, message text and cycle ids all
survive, because deleting a value row would break the conservation proof. So settlement is
untouched by an erasure, a departed member's sends still count toward their recipients'
`received`, and a pool share still posts to `mem:<their id>`.

`GET /api/profile/export` is the "everything the village holds about me" document and carries
`gratitudeSent` and `gratitudeReceived` out of `gratitudeRepo.all()`. It carries no
`gratitude_distributions` rows, so a member's own settled totals, their distinct-sender count
and what the pool credited them are not in their export. That is a gap, not a decision anybody
wrote down.

## Endpoints

Signed-in member:

- `POST /api/game/gratitude/send` — the acknowledgment door. Body is `{ to | toEmail, amount,
  message }`. `to` is what the member typed; `resolveTyped` in `server/lib/gratitude.ts` reads a
  leading `@` or a bare word as a handle and an interior `@` as an address. The response omits the
  amount and carries the giver's refreshed budget.
- `GET /api/game/gratitude/me` — the member's own journal: everything received, everything sent,
  and the budget.
- `GET /api/game/gratitude/flows` — the profile economics tab: balance, budget, lifetime totals,
  distinct acknowledgers, and the per-moon rows from `memberMoonFlows` in
  `server/lib/villageMoon.ts`.

Anonymous:

- `GET /api/game/gratitude/wall` — the public wall. Filters `kind !== 'heart'` first, then takes
  the last 60 and reverses, and renders first names only. The filter-before-slice order is
  load-bearing and is described under Sharp edges.
- `GET /api/game/cycle` — the open lunation, days remaining, moon phase. The `budget` key is
  always present and is `null` for an anonymous caller (`budget: user ? await
  gratitudeBudget(user) : null`), so a client testing `'budget' in response` gets true either
  way.
- `GET /api/game/cycle/distributions` — the public settlement report, `status === 'closed'` only,
  first names, with the channel split and what each member was credited.

Admin:

- `GET /api/admin/cycles/pending` — the settlement preview. Reads only.
- `POST /api/admin/cycles/close` — the settlement itself.

Both admin routes check `isAdmin(req)` directly and answer `401 auth_required` otherwise. The
Admin rail does not gate the Cycles tab on any module: `TAB_MODULE` in `client/src/lib/adminNav.ts`
deliberately omits `cycles` with the note that gratitude is core and its close route is behind no
gate.

**Readers outside this module's prefixes.** Four surfaces read these tables through routes the
list above does not cover, each with its own SQL and its own definitions:

- `GET /api/admin/command-centre` in `server/index.ts` reads the last six closed lunations out
  of `cyclesRepo.all()` and `distributionsRepo.all()` and reports `received`, `receivedHearts`,
  `receivedAcks`, `distinctSenders` and `credited` per member per cycle. It resolves each
  recipient with `(await members.byId(id))?.name ?? "(anonymized)"`, so this is the one surface
  that puts **full names** against settled totals; the public report and the settlement preview
  carry first names only.
- `GET /api/profiles/:handle` calls `loadGratitude` in `server/lib/profile.ts`, which is
  village-scoped, windowed to the season, and counts distinct **people** where everything else
  in this module counts amount. `client/src/pages/PublicProfile.tsx` renders it.
- `snapshotCycle` in `server/lib/health.ts` queries `gratitude_log` directly instead of through
  the repo, which is why a repo change does not reach it.
- `GET /api/profile/export` reads the whole log for the member's own copy (see Leaving).

**Two doors write `gratitude_log`, and only one of them is under this module's prefixes.**
`POST /api/gratitude` in `server/index.ts` is the Hearts economy give path: it calls `give()` in
`server/lib/economy.ts`, carries a tag, a structure key, a quiet flag and a client nonce, and is
inert (404) until `economyReady` says the village's rules are seeded. Since R73 both doors read
`gratitude.base_budget` times the stage multiplier for the allowance and
`gratitude.max_share_per_recipient` for the per-recipient ceiling, through the same functions.

Three things they still differ in:

- **What they record.** `/api/gratitude` carries a tag, a structure key, a quiet flag and a
  client nonce; `sendGratitude` carries a context type and ref for hearts.
- **Names.** `sendGratitude` passes `fromName: user.name` and `toName: recipient.name` into
  `writeGratitudeRow`; `give()` passes neither, and the insert writes `input.fromName ?? null`.
  So every Hearts-door row carries NULL names and the repo maps them to `""`. `give()` writes
  `kind: 'gratitude'`, so those rows are not filtered off the public wall, and
  `GET /api/game/gratitude/wall` renders `from: firstName(g.fromName)` as an empty string on
  every one of them. The journal reads the same columns.
- **`gratitude.require_message`.** Only `sendGratitude` reads it.

And a shape a fork should know about before it adds a third door: **the two doors say different
things about a duplicate.** `writeGratitudeRow` turns `ER_DUP_ENTRY` from either unique index
into `{ ok: false, error: "duplicate", duplicate: true }` after rolling back. `sendGratitude`
translates that to `409 "You have already acknowledged this"`; `POST /api/gratitude` translates
it to `400 "That thanks is already sent"`. Both are sentences a member can read, and neither is
a replay: a client retrying with the same `client_nonce` is REFUSED, and does not receive the
original result back. The nonce index makes the write idempotent and does not make the call
idempotent.

## Surfaces

- `client/src/pages/GratitudeWall.tsx`, mounted at `/gratitude` in `client/src/App.tsx`. The send
  form, the budget chip, the wall. Its recipient field is `type="text"` on purpose: `type="email"`
  made the browser refuse the handle, which is the only identifier this site actually publishes.
- `client/src/components/CycleClock.tsx` — the lunation and the year drawn from `shared/lunar.ts`
  directly, with no server round trip except the season name.
- `client/src/pages/Admin.tsx`, `CyclesTab` — the settlement desk. Three reads (`/api/game/cycle`,
  `/api/admin/cycles/pending`, `/api/game/cycle/distributions`), one confirmation, one report.
- `client/src/lib/settlement.ts` — the desk's pure copy and arithmetic: `settlementIntent`,
  `settlementBlocked`, `closeReport`, and `CLOSE_CONSEQUENCES`, which is the list of five things a
  close sets in motion. Four of them are invisible from the button, which is why the list exists.
- `client/src/components/ProfileJourney.tsx` — reads `/me` and `/flows` for the member's own view.
- `client/src/pages/GameMechanics.tsx` — where the village reads and proposes changes to the dials.

## Mechanics

### The send

`sendGratitude` in `server/lib/gratitude.ts` is the one send path. The **order of refusals is part
of the contract**: bad input, then missing message when required, then unknown recipient, then
self-send, then standing-example recipient, then zero stage budget, then (inside the lock) over
budget, then the heart tap count, then the per-recipient share, then whether this village may
issue at all. The launch gate is last of the guards on purpose: a member who is over budget
should hear about that, not about the launch vote.

**That order is enforced by the code and by nothing else.** `server/loop.e2e.test.ts` ("holds
the economy's guard rails") is the only place that drives these refusals, and every request in
it violates exactly one guard, so none of them pin a relative order. It reaches five of the ten
and asserts the message text of two: the share (`409`, and the error contains
`gratitude.max_share_per_recipient`) and an unknown handle (`404`, "No villager with that
handle"); self-send, missing message and an empty recipient are asserted by status alone. The
standing-example refusal, the zero-stage-budget refusal, the over-budget refusal and the heart
tap cap are not exercised there at all, and the only assertion anywhere on an over-budget
message is
`server/cycleId.test.ts`, inside "counts a member's spending once, whichever door they came
through". The launch gate has its own file,
`server/lib/gratitude.gameStart.test.ts`, which also asserts no ordering. If a fork means to
hold the order, it needs a test that violates two guards at once and asserts which message wins.

**Amounts are floored before the first guard.** `const amt = Math.floor(Number(input.amount) ||
0)`, and the refusal that follows fires on `amt <= 0`. So a send of 1.9 succeeds at 1 with no
word about the rounding, and a send of 0.5 is refused with "Recipient and a positive amount are
required", which is a sentence about a recipient. Every downstream number is an integer by
construction because of this line: the log row, the ledger leg, `receivedEligible` and the pool
split. It is also why the decimals sharp edge below has cost nothing on the send path so far.

Everything from the allowance read to the log write to the ledger credit happens in **one
transaction at REPEATABLE READ, holding `SELECT id FROM users WHERE id = ? FOR UPDATE` on the
giver**, in `writeGratitudeRow` in `server/lib/economy.ts`. Three properties follow, and one
thing sits outside them:

- A giver is serialised against themselves, so the allowance is exactly enforced. Twelve different
  members sending at once do not block each other; the transaction was SERIALIZABLE once and the
  gap locks its plain SELECTs took made 10 of 12 concurrent givers fail.
- The credit posts on that same connection **before** the note commits. A ledger refusal or a
  throw rolls the note back, so there is never a record saying gratitude was given with no
  gratitude. A retry cannot double-charge because a rolled-back attempt wrote nothing at all.
- Deadlocks and lock-wait timeouts are tried **three times in all** with backoff (the loop gives
  up at `attempt >= 3`, so the original plus two retries), and anything the engine did not decide
  is translated into one written sentence by `unwritableGratitude`. Members used to be shown
  `ER_LOCK_DEADLOCK` verbatim.
- **Three effects run after the commit and are outside that guarantee.** The
  `POST /api/game/gratitude/send` handler in `server/index.ts`, once `sendGratitude` has
  returned, calls `addActivity` (a village activity line naming both first names), `notify`
  (the first 140 characters of the private message into the recipient's inbox, keyed
  `gratitude:<entryId>`) and `onRealItemPublished(getPool(), "gratitude", user.id)` (which
  retires this module's explanatory empty state on the first real send). None of them is
  retried, and the heart route runs its own `notify` with a different title. A crash between
  the commit and these leaves a recorded, credited send that nobody was told about and that
  never reached the activity feed. A fork adding a fourth side effect belongs here, outside
  the transaction, for the same reason these are.

Recognition **issues** at send: `postTransferOn` moves it from the `sys:gratitude-pool` faucet to
the recipient. The sender spends budget, never balance.

### Recognition issues four ways, and only one of them is here

This module's dials bound the send channel and nothing else. Every one of these posts the same
recognition token, and none of them writes `gratitude_log`, spends an allowance, or respects
`gratitude.max_share_per_recipient`:

1. **The send** (this module), from `RECOGNITION_FAUCET`, bounded by `gratitude.base_budget`
   times the stage multiplier and by the share.
2. **Quest consent**, `POST /api/admin/quest-claims/:id/consent` in `server/index.ts`, posting
   `source: "quest_consent"` from the same faucet, at an amount a steward types out of the
   quest's advertised `quests.gratitude` range, multiplied by `rewardMultiplierFor` (a standing
   badge).
3. **Work With Us acceptance**, posting `source: "proposal_accepted"` from the same faucet for
   `gratitude.proposal_accept_award`.
4. **The admin mint**, `POST /api/admin/tokens/:slug/mint` and
   `POST /api/admin/mint-requests/:id/approve`, posting from `sys:mint` and bounded only by
   `ledger.admin_mint_cycle_cap`, the co-sign threshold and the self-grant refusal.

`faucetFor(HEARTS)` in `server/lib/economy.ts` also routes any `mint_rules` payout of
recognition to `sys:gratitude-pool`, and `server/lib/economySeed.ts` ships a `role.cycle` /
HEARTS rule seeded `enabled: false` that the hourly `moon-settlement` job would pay the moment a
village switches it on.

The consequence for the Sharp edge below: `gratitude.max_share_per_recipient` bounds
concentrated voice **on gratitude sends**. Because `governance.weight_token` defaults to
`gratitude`, standing arriving through any of the other three doors is unbounded by it.

### The allowance

`allowanceFor` in `server/lib/economy.ts` is the one computation, and it is a **sum, never a
counter**:

```
total     = round(gratitude.base_budget * stage multiplier)
given     = sum(gratitude_log.amount)  WHERE village_id = V AND from_id = me
                                       AND at IN [cycle start, cycle end)
back      = sum(token_ledger.amount)   WHERE source = 'reversal'
                                       AND at IN [cycle start, cycle end)
                                       AND source_ref LIKE 'gratitude.given:V:%'
spent     = max(0, given - back)
remaining = max(0, total - spent)
```

The `given` leg is scoped to the village and to this giver. **The `back` leg is scoped to
neither.** Read the query above literally: it carries no `from_id`, joins nothing back to the
giver, and `source_ref` (`gratitude.given:<village>:<noteId>`) does not encode who gave. So one
member's reversed gift reduces the computed `spent` of **every** member in the village. It is
also windowed on the REVERSAL's `at` and not the gift's, so reversing a gift from three moons
ago hands allowance back in the current moon. Neither is what the shape of the formula suggests,
and a fork operator reading only the first line would not expect it.

The `LIKE` prefix is `keys.gratitudeGiven`, and it is written at exactly one call site: `give()`
in `server/lib/economy.ts`, the `/api/gratitude` door. This module's own door, `sendGratitude`,
posts with `idempotencyKey: gratitude_received:<noteId>`, and `reverse()` copies the original key
into `source_ref`, so a reversed acknowledgment or a reversed heart never matches. The refund
covers gifts given through `/api/gratitude` and nothing else. `server/cycleId.test.ts` says so in
its own words: the gift in that test goes through the Hearts door because that is the door whose
ledger posting carries a `gratitude.given:` key.

**Today the reversal term fires for nothing.** No route in this build reverses a gratitude
posting. `reverse()` has two non-test callers, both in `server/lib/voiceClaim.ts`, and both
reverse a voice-claim `debit_key`; `server/index.ts` does not import it, and the payment
clawbacks post `source: "payment_reversal"`, which the `source = 'reversal'` filter excludes. The
term is defensive, exercised by tests and waiting for a future admin correction. That is the
argument for computing rather than storing: a sum has nothing to remember to do. It is not
evidence that the refund path works, because nothing has run it in production.

Two things a fork adding a reversal route inherits. If it reverses on the acknowledgment door it
must change either the key or the query, or the refund silently does not happen. And
`settleCycle` sums `gratitude_log` with **no reversal term at all**, so a reversed gift still
counts toward the recipient's `received` and `receivedEligible` and still earns a share of the
pool.

`budgetFor` in `server/lib/gratitude.ts` is now only a field-name shim over this computation;
nothing in the host reaches it.

The per-recipient ceiling is `shareCapFor(total)`, which returns 0 when `total <= 0` and
otherwise `max(1, floor(total * share / 100))`. The zero branch is unreachable from the send
path, where `total <= 0` is refused several guards earlier. The running total the cap is
compared against sums **all kinds** for that pair in the cycle window, so a heart cannot carry
what an acknowledgment was refused. The floor of 1 is a bound, not a rounding convenience: 1% of
an allowance of 50 rounds to zero, and a zero there would refuse every send in the village while
both dials still read as sane numbers.

### The cycle

`shared/lunar.ts` is the only lunar arithmetic in the product. Cycle ids are
`lunar-` plus the lunation number padded to six digits, produced only by `formatCycleId` in
`server/lib/gratitude-cycles.ts`, and the padding exists so a plain string sort is a chronological
sort. Boundaries below `TRUE_CLOCK_FROM_CYCLE` (330) keep the mean-formula instant bit for bit;
from 330 on they are the true new moon out of `shared/lunarTable.json`. The past is frozen because
cycle numbers are a natural key on settlement rows.

**The true clock has an upper bound too, and it is silent.** `shared/lunarTable.json` declares
`fromYear: 2020, toYear: 2050`, holding 383 new moons and 384 full moons. `trueLunationFor` and
`moonPhase` in `shared/lunar.ts` both fall back to the mean formula outside that range, with no
warning, no log line and no gate. `TRUE_CLOCK_FROM_CYCLE` exists to make the switch explicit at
the near end; the far end has nothing equivalent. Regeneration is `scripts/gen-lunar-table.mjs`,
and a regeneration must not move any boundary a settlement row already keys on.

**There is no rhythm dial.** `gratitude.cycle_mode` used to offer "lunar" or "month", was live in
the admin panel, and exactly one branch read it, so a village could switch its whole rhythm and
nothing changed. Rye retired it rather than wiring it (2026-08-29); `drizzle/0108_retire_cycle_mode.sql`
deletes the stored rows and explains why it does not touch a single gratitude row.

### Boot

Two things run before this module can serve a request, and only one of them can stop the village.

**Fatal.** `startServer()` in `server/index.ts` runs `checkLedgerInvariants(getPool())` and, on
any problem, throws `ledger invariants violated (N), refusing to serve`. Every gratitude send
posts a recognition leg, so a broken gratitude ledger state is a village that will not start, and
the only lever anybody has is to put the previous image back. Boot also runs `seedEconomy` (which
seeds the disabled `role.cycle` / HEARTS mint rule named above) before `initStores()`.

**Reported and not fatal.** The same function in `server/lib/ledger.ts` carries a
gratitude-specific probe:

```sql
SELECT COUNT(*), SUM(g.amount), MIN(g.id), MAX(g.at)
FROM gratitude_log g
LEFT JOIN token_ledger t ON t.to_account = CONCAT('mem:', g.to_id)
                        AND t.source_ref = g.id
                        AND t.source IN ('gratitude_received', 'heart_received')
WHERE t.id IS NULL AND g.amount > 0
```

It reports "N gratitude note(s) charged X and delivered nothing", with the earliest id and the
latest timestamp. That result lands in `uncredited`, which is deliberately not folded into
`problems`, so `ok` stays true and boot proceeds. The one surface that renders it is
`GET /api/admin/ledger/reconciliation`, the founder's reconciliation panel, which reruns the
same check on demand; the route rebuilt the object as `{ ok, problems }` and dropped the field
for a while, which is why the founder could not see it. Note what the probe can see:
`gratitude_log` rows only, so recognition minted by the three non-send doors is invisible to it
by construction.

### Scheduled work

`POST /api/admin/cycles/close` is explicitly a human act. `server/lib/scheduler.ts` names it in
the list of things the job host will never do, so that nobody helpfully adds a timer. That is one
thing the scheduler does not do, and it is not the same as the scheduler doing nothing here. Two
registered jobs touch this module every hour:

- **`calendar-mirror`** (hourly, `server/index.ts` → `mirrorCalendarSources` in
  `server/lib/calendarProviders.ts`). Its `runSource("gratitude", ...)` reads `SELECT
  cycle_number, starts_at, ends_at, status FROM gratitude_cycles`, writes two calendar rows per
  cycle (`cycle:<n>:open` and `cycle:<n>:close`, the close row worded for whether the cycle is
  settled), adds rows for the current and next lunation straight off the clock, and calls
  `calendarRemoveMissing` to retire any it did not write. This is why cycle marks appear on the
  village calendar, and why they disappear if the mirror stops. It moves no value.
- **`moon-settlement`** (hourly, `runSettlement` in `server/lib/economy.ts`) runs on the same
  lunar `cycleKey`, pays seat holders and promotes queued mint-rule changes. It does not settle
  a gratitude cycle.

What does not run on a timer is the value release.

### The close

Order of operations, per due lunation, oldest first:

1. `cyclePoolProblem(poolSize, poolToken)` from `server/lib/cyclePool.ts` refuses before anything
   settles: an unregistered token, a token whose `governance` is anything other than `platform`
   (hypha is one case of that, not the whole test), or the recognition token itself. **The guard
   opens with `if (!(poolSize > 0)) return null`**, so none of it is evaluated while
   `gratitude.pool_per_cycle` is 0. A village that misconfigures `gratitude.pool_token` with
   distribution switched off hears nothing, on the preview card or anywhere else, until the moon
   it raises the pool above zero and presses close.
2. `unreadableCycleProblem` refuses if any `gratitude_log` row carries a cycle id this build
   cannot parse, naming up to five of them and the row count. This was once a quiet skip, and it
   cost 30 of 130 units out of a settlement with no surface anywhere saying a number was missing.
3. `settleCycle` computes, per recipient: `received` (the honest total), `receivedHearts`,
   `receivedAcks`, `distinctSenders` and `receivedEligible`.
4. Every row of the split is persisted **before any value moves** (the sticky split), then the
   payout is posted from what was persisted, not from what was just computed.
5. The cycle is upserted to `closed`, recipients with `received > 0` are notified, the health
   snapshot is frozen, earned badges are re-evaluated, and passed proposals are applied while
   `governance.auto_apply_enabled` is on. Failures in steps after the upsert are caught and
   logged; none of them unclose a cycle.

**Step 5 is the village-wide governance apply point, and it is wider than "cycle-timed dials".**
The query is `SELECT * FROM mechanics_proposals WHERE status IN ('passed_verified',
'passed_onsite') ORDER BY verified_at, id`, with no timing filter, and `applyMechanicsProposal`
then filters each change only on `isMintRuleKey`, presence in `VARIABLES_BY_KEY`, and
`ringOf(def) !== "open"`. It never consults `applyTimingOf`. The helper that does test cycle
timing, `changeSetWaitsForCycleClose`, is used only at pass and verify time to decide whether to
apply immediately. So the pending set the close drains is whatever has accumulated, across every
module in the village, and there are three ways a proposal with no cycle timing gets into it:
it holds a cycle-timed dial and waited correctly; an earlier apply partially failed and left it
at `passed_verified`; or it passed while `governance.auto_apply_enabled` was off and is still
sitting there when the brake comes back on. Pressing "Close cycle" applies all of them.
`CLOSE_CONSEQUENCES` item 5 in `client/src/lib/settlement.ts` carries the same narrowing and
should be re-worded with this.

**The split, exactly.** For each recipient:

```
credited = poolSize > 0 && totalEligible > 0
  ? floor((receivedEligible / totalEligible) * poolSize)
  : 0
```

`totalEligible` is the sum of `receivedEligible` across all recipients in that lunation, not the
sum of `received`. `receivedEligible` counts only recognition from senders in the set
`eligibleSenderIds` returns: not a standing example, and either at stage `member` or above, or
holding at least one consented quest. The same test decides `distinctSenders`. Splitting by the
raw total instead would have left the Sybil filter guarding the leaderboard and leaving the
treasury open.

Payment is one `postTransfer` per credited member from the `sys:cycle-pool` faucet, keyed
`gratitude_pool:<cycleNumber>:<userId>`, so a re-run credits nothing twice. `totalCredited` counts
only non-duplicate postings, which is what makes a second press report honestly as nothing.

## Game variables

Five keys, listed with their generated definitions in [../VARIABLES.md](../VARIABLES.md) under the
Gratitude category, and in [../MODULES.md](../MODULES.md) under this module's entry. What each one
does in the code:

- **`gratitude.base_budget`** (integer, default 100). Multiplied by the giver's stage multiplier to
  give `Allowance.total`. The multiplier is not read from the ladder: `stageMultiplierFor` reads
  the variable `progression.multiplier.<stageId>`, one of which is generated per stage in
  `shared/gameVariables.ts` with `gratitudeMultiplier` from `shared/gameConfig.ts` as its
  **default**. A village that tuned that dial has a different ladder from the one the config file
  shows. `shared/gameConfig.ts` ships **twelve** stages and one `progression.multiplier.<id>` key
  per stage, so a fork tuning the ladder has twelve dials to find. The stock defaults step UP at
  six of them (0 at Visitor, 1 at Guest, 2 at Member, 3 at Co-Creator, 4 at Guide, 5 at Sage) and
  the other six share a multiplier with the rung below: Immersant and Participant sit at 1,
  Contributor, Quest Seeker and Initiate at 2, Role Holder at 3. So 100 becomes 0 to 500 across
  the ladder. A total of 0 or less is refused with "Your sending budget unlocks as you progress on
  the path", which is also the sentence a village that set this dial to 0 gets.
- **`gratitude.require_message`** (boolean, default true). Checked in `sendGratitude` for
  `kind === 'gratitude'` only. Hearts derive their message from the post; the `/api/gratitude`
  give door does not read this key at all.
- **`gratitude.max_share_per_recipient`** (percentage, default 25). Feeds `shareCapFor`. This is
  the dial that bounds concentrated **voice** on the send channel, because
  `governance.weight_token` defaults to `gratitude`: it decides how much of one member's standing
  may come from one relationship. It replaced two caps, one of which counted sends and defaulted
  to 1, and therefore bounded how often one member could thank another and never how much. Read
  "Recognition issues four ways" above before treating it as a bound on standing itself: quest
  consent, Work With Us acceptance and the admin mint all issue the same token past this dial.
- **`gratitude.pool_per_cycle`** (integer, default 1000). The numerator of the split. 0 turns
  distribution off and the close still records the totals.
- **`gratitude.pool_token`** (text, default `credits`). `credits` is seeded by
  `drizzle/0007_village_credits_token.sql` as a platform-governed, non-transferable token of kind
  `credit`. The type stays free text so the fail-loud refusal at close keeps catching a value set
  by any other route; `decorateChoices` in `server/index.ts` decorates the admin **form** with
  this village's own eligible tokens so the ordinary path cannot reach that refusal.

`gratitude.proposal_accept_award` (default 100) is also in the Gratitude category, is read by the
Work With Us acceptance path in `server/index.ts`, and is **not** in this module's declared
`variableKeys`. No access decision follows from that, because a core module's key list gates
nothing. One thing does: the Gratitude row on the admin modules panel prints `tunables: 5`
straight off the list, so a founder is already reading a count that is one short of the keys in
the category. `feed.heart_amount` and
`feed.max_hearts_per_recipient_per_cycle` are filed under the Gratitude category too and belong to
the `feed` module.

Four of the five (all but `require_message`) are in `CYCLE_APPLY_KEYS` in `shared/gameVariables.ts`,
so `applyTimingOf` reports `cycle-close`. Read the Sharp edges before believing what that means.

## Capabilities

None. `capabilities: []` in the registry, and [../CAPABILITIES.md](../CAPABILITIES.md) lists none
for this module. Access to each door is decided by plain checks instead:

- The send doors need a signed-in member and answer `401 auth_required` otherwise.
- The wall, the open cycle and the settlement report are anonymous.
- The two admin routes call `isAdmin(req)` and answer `401 auth_required`.
- Every faucet posting, both the send credit and the pool payout, is refused by `issuanceRefusal`
  in `server/lib/gameStart.ts` until the village's launch vote carries. On the send path a member
  reads that refusal in the gate's own words and keeps their allowance and their message.

## Dependencies

The registry declares no `requires` and no `recommends`, and that is true of the module system.
The code reads plenty it does not own:

- `server/lib/ledger.ts` for `tokenDef`, `postTransfer`/`postTransferOn`, the two faucets and the
  member account naming. A token this ledger does not govern cannot be paid by the pool.
- `server/lib/economy.ts` for the lock, the allowance, the share cap and the cycle window.
- `server/lib/gameStart.ts` for the launch gate.
- Progression, for `stageMultiplierFor`. A stage change moves everybody's allowance.
- `shared/lunar.ts` for every boundary.
- `server/lib/health.ts` (`snapshotCycle`), `server/lib/badges.ts` (`evaluateEarnedBadges`) and the
  mechanics apply path all hang off the close and are named in `CLOSE_CONSEQUENCES`.
- The `feed` module supplies the heart channel through `sendGratitude`.
- `health` recommends `gratitude` and `quests` in the registry; the badge breadth metric reads
  `gratitude_distributions.distinct_senders` and never re-derives breadth for itself.

**Standing examples.** `EXAMPLE_TABLES` in `server/lib/examples.ts` maps
`gratitude: ["gratitude_log"]`, which is what the retire sweep and the row-presence recount look
at for this module. The module is stamped `seeded` while deliberately creating no rows, and the
file says why: a gratitude row posts to the ledger at creation, so an example send would either
mint real recognition or break conservation. `modulesWithExamples()` filters on `withRows` for
exactly that reason, so gratitude never reports itself as showing examples. What the first real
send does instead is retire the module's explanatory empty state, through
`onRealItemPublished(getPool(), "gratitude", user.id)` in the send route. The example filter
appears twice in this module: `isExampleUser` refuses a send to a standing example, and it keeps
example identities out of `eligibleSenderIds` so a seeded profile cannot widen the settlement.

## Sharp edges

**A settlement is priced when it is settled, not when it happened.** The close reads
`gratitude.pool_per_cycle`, `gratitude.pool_token` and `eligibleSenderIds()` at the moment the
button is pressed. Settle three lunations late and all three are split out of today's pool size,
in today's token, using today's eligibility set, so a member who has since crossed into
eligibility retroactively enlarges the share of everyone they thanked months ago. Nothing warns
about this, and the preview shows the same numbers the button will honour, so it is consistent
rather than surprising. It does mean a village that lets closes pile up is choosing a different
settlement from the one it would have got on time.

**"Takes effect at the next cycle close" is true of the proposal path only.** `applyTimingOf`
reports `cycle-close` for four of the five dials, `server/lib/mechanics.ts` prints
"takes effect at the next cycle close, never mid-cycle" on the proposal card, the close applies
held proposals at the boundary, and [../VARIABLES.md](../VARIABLES.md) states it as a plain fact
about the dial. `PUT /api/admin/variables/:key` in `server/index.ts` enforces none of it: an admin
saving `gratitude.base_budget` in Admin → Game Mechanics is told "Saved. The rule is live", and it
is, mid-cycle. Because `allowanceFor` recomputes `total` from the current variable on every read,
lowering the base budget mid-cycle can leave a member who already spent to the old ceiling with
`remaining` of 0 and a `spent` greater than their new total. Raising it hands everybody more, at
once. If you want the cycle-close semantics the documentation describes, change these dials
through a mechanics proposal, not through the admin form.

**The pool can pay nobody, and it says the same thing as a pool that is switched off.** Two
reachable cases. First, `totalEligible === 0`: everyone who gave that lunation was below the
`member` stage with no consented quest, which is the ordinary state of a young village, so
`credited` is 0 for every recipient even though `received` is not. Second, `floor` collapsing every
share: a pool of 5 across 20 recipients pays each of them `floor(0.25) = 0`. In both cases
`closeReport` in `client/src/lib/settlement.ts` says "The pool released nothing. Recognition was
recorded all the same", which is exactly what it says when `gratitude.pool_per_cycle` is 0. The
admin can see the configured pool size on the card next to it, and nothing tells them which of the
three situations they are in.

**The remainder is not kept anywhere.** The comment at the split says `floor()` "keeps the
remainder in the pool rather than minting dust", and the pool is a faucet rather than a balance:
`gratitude.pool_per_cycle` is minted fresh each close. So the undistributed remainder is simply
never minted. It does not accumulate, and it does not roll into the next lunation.

**The first split wins, forever.** `distributionsRepo.add` is `ON DUPLICATE KEY UPDATE id=id`:
add-if-absent, never update. The close persists the whole split before posting anything, then pays
from what it read back. A close that dies after paying two of five members leaves the cycle open
and the rows on record; the retry finds the first run's basis, and the idempotency keys mean the
two already paid are paid once. Recomputing on retry from live data was the old behaviour, and it
let the ledger legs and the report rows disagree permanently. `GET /api/admin/cycles/pending`
therefore shows a cycle with a persisted split **from that split**, and flags it with
`fromPersistedSplit` so the desk can say so.

**An unreadable cycle id stops the settlement and does not stop the budgets.** `settleCycle` and
`dueCycles` both call `refuseUnreadable` and throw on any id that is not `lunar-NNNNNN`, so one bad
row freezes settlement for the whole village until somebody migrates it. Meanwhile `allowanceFor`
filters on `village_id` and the `at` timestamp window, not on `cycle_id`, so those same rows keep
counting against their giver's allowance normally. That asymmetry is deliberate on both ends: a
total that quietly omits rows is wrong in a way nobody can see afterwards, and an allowance that
quietly omits rows would be a way to spend twice.

**The wall is anonymous, and the filter order is why hearts are not on it.** `.slice(-60)` used to
run before the `kind` filter, so whatever the last sixty rows happened to be went out on an
endpoint with no authentication, and a heart's message quotes the feed post's title (falling back
to its opening 80 characters when the post has no title, wrapped as `❤ on "..."`). In a village
whose feed is members-only, that put member-only prose on a public route, and the busier the feed
the more of the wall it became. Filtering first is what keeps it to written acknowledgments. If
you change that route, keep the filter before the slice.

**The dial the wall's comment cites does not exist.** The comment above that filter says
"Filtering first also matches the documented `feed.hearts_on_wall` default of false", and
`docs/modules/gratitude-feed.md` lists `feed.hearts_on_wall` as a dial. It appears zero times in
`shared/gameVariables.ts`, whose only `feed.*` keys are `category_slug`, `show_system_events`,
`max_post_length`, `heart_amount` and `max_hearts_per_recipient_per_cycle`. The behaviour is
hardcoded and no village can change it, so a fork that wants hearts on the wall is editing the
route. The `feed` doc's dial list needs the same correction.

**The pool guard and the pool picker do not test the same thing.** `cyclePoolProblem` refuses a
token that is unregistered, whose `governance` is anything other than `platform`, or whose slug
is literally `gratitude`, and it refuses none of them while `gratitude.pool_per_cycle` is 0.
`decorateChoices` builds the admin dropdown from tokens that are `active`, platform-governed,
`kind !== 'recognition'` and not examples. So the guard tests a slug where the form tests a kind,
and the guard does not test `active` at all: a token deactivated in the registry is dropped from
the picker and still paid by a close, because `validateLeg` in `server/lib/ledger.ts` does not
check `active` either.

**Pool amounts are posted as ledger minor units with no conversion.**
`gratitude.pool_per_cycle` is described to founders as a count of tokens, and the close passes it
into `postTransfer` unconverted. Every token in the shipped registry except `village-voice` sits at
`decimals = 0`, where the two are the same number, so nothing is wrong today. The hand-mint dials
went through exactly this and were wrong for Voice until they were routed through `toLedgerUnits`.
`drizzle/0126_ledger_amount_matches_the_balance_it_makes.sql` is the standing record: 39 of
`postTransfer`'s 44 callers pass human numbers, the fix is per-caller, and the decimals ruling
needs its own pass. If your fork raises a token's `decimals`, audit this call before you do.

**Every gratitude read loads the whole table, and two of them are anonymous.**
`gratitudeLogRepo.all()` is `SELECT ... FROM gratitude_log ORDER BY at, id` with no `WHERE`, no
`LIMIT`, and no `village_id` scope. Six callers: `/wall`, `/me`, `/flows`,
`GET /api/admin/cycles/pending`, the close, and `GET /api/profile/export`. At village scale this
is fine, and it is the reason the settlement functions can be pure and unit-testable with no
database.

The part that is not only a scale note: `GET /api/game/gratitude/wall` and
`GET /api/game/cycle/distributions` both take `_req`. No `authedUser`, no `isAdmin`, no session
of any kind, and no `overLimit()` bound. `/wall` loads the whole log and slices its last 60 in
JavaScript; `/cycle/distributions` loads `cyclesRepo.all()`, `distributionsRepo.all()` **and**
`members.all()` and returns every closed cycle ever, unpaginated. `scripts/check-route-limits.mjs`
is the CI gate that asks this question and passes them because its rule is scoped to routes that
CREATE something, which these do not. They are the first thing a fork with a public URL should
bound.

**`GAME_CONFIG.gratitude` is dead, and one of its values is a rule this build removed.**
`shared/gameConfig.ts` still ships `gratitude: { monthlyBudget: 100, maxPerRecipientPerCycle: 1,
requireMessage: true }` and it is typed in the config interface. Nothing reads any of the three.
`maxPerRecipientPerCycle: 1` is the retired sends cap that R73 replaced with
`gratitude.max_share_per_recipient`; a fork operator reading that file would conclude a member may
thank one person once per cycle, which has not been true since 2026-08-29. The live dials are in
`shared/gameVariables.ts`.

**Recognition is marked transferable in the token registry and cannot be sent.**
`drizzle/0006_token_registry.sql` seeds `gratitude` with `transferable = 1`, and `sendRefusal` in
`server/lib/spending.ts` refuses it anyway, by kind, with "recognition is a record of what
happened. It is given, never handed over". The kind test is the one that governs, and the column
is misleading rather than dangerous.
