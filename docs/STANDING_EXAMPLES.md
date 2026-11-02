# Standing examples — the empty-module problem

> Status: BUILT, reviewed, guards closed (2026-08-01). The adversarial review
> and its 28 findings are in `docs/STANDING_EXAMPLES_REVIEW_2026-08-01.md`.
>
> **Content:** `server/seeds/examples-seed.json` — ~70 rows across 16 module
> blocks (gratitude and profiles seed no rows by design), platform-generic
> copy, plus 3 shared example identities.
> **Schema:** `drizzle/0046_standing_examples.sql` — `is_example` on 24 tables
> plus `example_state`.
> **Runtime:** `server/lib/examples.ts` — seeding, retirement, the inert guard
> and the cache reload; hooked into boot (core modules and already-enabled
> ones) and into `PUT /api/admin/modules/:id/lifecycle` (on first enable).
> **Guards:** every mutation that can address an example row refuses it —
> library reserve and write-off, stay request, stay checkout, manual stay
> purchase, product checkout and edit, feed heart, forum reply/subscribe/
> report, quest claim, submit and consent, admin quest edit, badge claim,
> award and edit, exchange buy and listing, network share edit, synthesis
> publish and body edit, call-task accept/dismiss, regen retract, role edit,
> and bootstrap-as-an-example-identity; gratitude sent TO an example identity
> is refused in `sendGratitude`; the earned-badge engine skips example
> definitions. Grep `isExampleRow(` and `EXAMPLE_REFUSAL_BODY` for the live
> list rather than trusting this sentence.
> **Since 2026-08-02:** example badges CARRY real capabilities, example
> identities HOLD seeded awards, and the exchange seeds example TOKENS with
> display-only stock and prices. What keeps that safe: no route can attach an
> example to a real member (award, claim and the earned engine all refuse or
> skip), example identities never authenticate so the gate never reads their
> awards, and no ledger row exists for an example token so conservation holds
> trivially. The refusal surface above is unchanged.
> **Client:** `ExamplesBanner` on twelve module pages, fed by
> `GET /api/examples` (which hides preview-lifecycle modules from
> non-admins); publishing something real drops the banner in-session through
> `forgetExamplesCache`.
> **Admin:** a per-module "Clear examples" panel in the Modules tab over
> `POST /api/admin/modules/:id/examples/clear`, driven by `showingExamples` /
> `examplesRetired` on the modules payload.
> **Tests:** `server/lib/examples.test.ts` (20 cases, the library) and
> `server/examples.routes.e2e.test.ts` (28 cases, the guards, the PAYLOAD flags
> and retirement over HTTP against the built server) — plus three runnable
> provers, `scripts/check-examples.mjs` (virgin-schema inertness),
> `scripts/prove-examples.mjs` and `scripts/prove-remaining.mjs`.

## The problem

Every non-core module ships OFF (`shared/modules.ts`). A founder turns one on
and lands on `No threads yet. Start the first one.` — the module is technically
working and tells them nothing about what it is FOR. The Library page says
`No items yet.`; the Tools Hub says `No tools have been added yet.`; Badges says
`No badges defined yet.` The founder has to imagine the product before they can
use it, and the fork runbook can't carry that imagination for eleven modules.

Standing examples fix this: turning a module on reveals a small, complete,
obviously-labelled set of worked examples, which retire themselves the moment
the village publishes anything real.

## The four rules

1. **Examples are inert.** They render in full, and every mutation against them
   is refused with a specific message. An example is never a ledger row, never
   escrow, never a Stripe object, never open economic state. This is the load-
   bearing rule: an example that could be borrowed or bought would create value
   the village never agreed to, and an example loan would block
   `setModuleLifecycle(id, "off")` through `openStateCheck` — a demo that traps
   you in the module it was demoing.
2. **Examples are labelled at the row, not in the theme.** The row itself
   carries the flag, so no read path can accidentally present one as real.
3. **Examples retire per module, one way.** The first real item published in a
   module deletes that module's examples permanently. Deleting your real items
   later does not bring them back — a village that has spoken for itself is
   never talked over again.
4. **Examples are platform content, not village content.** Copy is written in
   platform language and carries no village's brand, so `check-brand-refs.mjs`
   stays green and every fork inherits the same examples.

## Mechanism

### Marking

Each content table that can hold examples gets `is_example TINYINT(1) NOT NULL
DEFAULT 0`, added in one migration. A column rather than a side table on
purpose: the flag travels with the row through every existing SELECT, so there
is no join to forget and no cache to fall out of step. `DEFAULT 0` means every
row anyone has ever created is already correctly marked as real.

### Bookkeeping

One new table records the per-module state, so seeding is idempotent and
retirement is final:

```sql
CREATE TABLE example_state (
  module_id       varchar(64)  NOT NULL,
  seeded_at       timestamp    NULL,
  retired_at      timestamp    NULL,
  retired_reason  varchar(64)  NULL,   -- 'first_real_item' | 'admin_cleared'
  retired_by      varchar(64)  NULL,   -- who published or cleared, when known
  PRIMARY KEY (module_id)
);
```

`retired_at IS NOT NULL` is the permanent tombstone: seeding checks it and
refuses, so examples cannot return by any path short of a deliberate SQL edit.

### Seeding

`seedExamples(moduleId)` runs when a module's stored lifecycle leaves `off`
(inside `setModuleLifecycle`, after the write succeeds) and is a no-op when the
module has ever been seeded, has ever been retired, or already holds any real
row. Core modules (quests, gratitude, progression, profiles) can never be
enabled, so they seed at boot instead: `seedExamplesAtBoot` walks the module
registry, skips non-core modules that are still `off`, skips anything already
seeded or retired, and leaves the rest to `hasRealContent` — which is what
keeps a village's own 14 live quests from ever being joined by examples. It
runs AFTER the real starter seeds for the same reason.

Since 2026-10-31 (Rye, sheet A8 / 19g) quests HAS no real starter seed: the
`quests` section here is the starter board every fresh village opens on, and
`server/seeds/quests-seed.json` is frozen. Quests is also the one module whose
examples a founder can keep one at a time (`POST /api/admin/quests/:id/keep`,
then `afterExampleKept`, which stamps the tombstone with `all_kept` when the
last one is kept), and its `hasRealContent` counts any claim ever taken, so a
village that emptied a worked board is never re-seeded. See
`docs/modules/quests.md`, "What arrives at boot".

### Retirement

`retireExamples(moduleId, reason)` deletes that module's `is_example = 1` rows
— scoped by id where two modules share a table, so retiring the forum does not
take the feed's examples with it — and stamps `example_state`. A DELETE that
fails for any reason other than a missing table or column leaves the tombstone
UNSTAMPED, so the next trigger retries instead of stranding rows. It is
reached two ways:

- `onRealItemPublished(pool, moduleId, actor)`, called from each module's
  publish path after a real row commits (one trigger per module);
- `POST /api/admin/modules/:id/examples/clear`, so a founder who wants a clean
  slate does not have to publish something and delete it.

One helper, called after the write rather than before, so a failed create never
retires anything.

### Refusal

`await isExampleRow(pool, table, id)` asks the row itself, and the route
returns `EXAMPLE_REFUSAL_BODY` — a 409 carrying `code: "example_immutable"`
and the message *"This is a standing example. Publish your own to replace
it."* Every mutation route that can address an example row calls it, BEFORE
any side effect: the guard has to sit above the INSERT, the Stripe session
and the ledger post, not below them. The client renders the message inline
rather than as an error toast.

## What counts as a "real item", per module

Retirement has to key on publishing something, not on any write at all — a
founder editing an example's title must not silently retire the set. Each
module declares exactly one trigger, and the seed carries it per block as
`_trigger`, so the content and the rule that clears it stay together. The
live wiring is the set of `onRealItemPublished(pool, "<module>", actor)` call
sites in `server/index.ts`; grep that string for the current list rather than
maintaining a second copy here. Two of them are worth naming because they are
not the obvious create route: `automation` retires on an ingested recording
(the Riverside webhook and the RSS job, not only the manual add), and `feed`
keys on a real thread in the feed's own category, because the feed and the
forum share `forum_threads`.

## What the build run proved

Four things that were guesses in the design and are now facts:

1. **Name-based labelling is not enough.** The example identities are named
   "Mira (example)", but the Forum renders authors by first name only, so the
   byline reads "Mira" and the marker vanishes. The tombstone precedent —
   a real row whose display name carries the meaning — does not survive
   first-name rendering. The client must read `is_example` and render a chip.
2. **Visibility rules already do useful work.** A signed-out visitor sees one
   of the three example tools, because the other two are `members`; and two of
   the three example network items, because the third is `closed`. The
   examples exercise the audience rules rather than bypassing them, which is
   worth keeping.
3. **The example set is enough to unlock trends.** Three lunations of
   snapshots put the Village Health dashboard into its real trend state rather
   than its "N of 3 lunations collected" state, which is the only way to see
   what the module actually looks like in use.
4. **Seeding examples into an empty table suppresses the real seeds.** Example
   circles, roles and quests occupied their tables, so `circles-seed.json`,
   `roles-seed.json` and `quests-seed.json` were skipped at boot. That is
   correct for a fresh fork and wrong for a village that wanted the shipped
   starter content. The seeding hook must run AFTER the real seeds, never
   instead of them.

## What the adversarial review caught that the tests did not

An independent review (`STANDING_EXAMPLES_REVIEW_2026-08-01.md`) raised 29
findings, 28 confirmed: 5 blockers, 10 majors, 13 minors — against a set whose
own 9 tests and 2 provers were green. The reason is worth keeping: **the tests
walked only the routes that had already been guarded.** Coverage of the guard
list is not coverage of the mutation surface.

The five blockers, all fixed:

1. **`replaceAll` laundered examples into permanent real content.** The tools,
   circles and roles column specs omitted `is_example`, and `replaceAll` is
   DELETE-all + re-INSERT of the spec'd columns only — so the flag came back as
   DEFAULT 0. The tools-link-check job runs `replaceAll` DAILY, so within ~24h
   every example tool became real content that retirement could not find, the
   clear button could not remove, and the inert guards no longer refused. The
   write-direction twin of the cache bug below; fixing reads was half the job.
2. **Example quests were claimable**, and consent mints recognition, grants
   stay credits and advances a stage. On a fresh fork the whole quest board is
   examples, so this was the default path.
3. **`POST /api/stays/checkout` was unguarded** — an example room opens a real
   Stripe session and leaves a pending purchase that blocks module-off.
4. **Example identities were valid gratitude recipients.** Their addresses are
   fixed and public, so any member could spend real budget sending recognition
   into an account belonging to nobody, which the cycle close then pays a real
   pool share to.
5. **Forum/feed retirement was not scoped**, though the comment claimed it was:
   they share `forum_threads`, so the first real forum thread deleted the
   feed's examples while leaving the feed's banner over an empty page.

Also fixed: the exchange listing that deleted itself (a real listing updates the
example row in place, then retirement removed it); forum reply/subscribe/report
guards; health reading the infrastructure-written snapshot spine as village
content; the network job dialling the example peer every 6h; library backing
counting example shelves; the Sybil helper, solo-founder count and cycle
snapshots counting examples as people and activity; and bootstrap promoting an
example identity to a founder the roster hides.

Also closed: the six unguarded admin routes (product edit, network share
open/close, synthesis publish — which turned example content into a real forum
thread — regen retract, library write-off, badge edit).

The last seven, now closed too:

- **Banners on the missing pages.** Quests, the village map and the wallet's
  exchange section were rendering example rows with no signal at all. (Roles
  and Circles are hardcoded marketing pages that read no DB, so they carry no
  examples to label.)
- **The stale banner.** `forgetExamplesCache` had no callers, and clearing the
  cache alone could not re-render a mounted banner — its effect only re-runs on
  a `moduleId` change. It now notifies subscribed banners, drops the module
  OPTIMISTICALLY (retirement is one-way, so optimism cannot be wrong, and an
  immediate re-fetch would race the fire-and-forget server retirement), and is
  called from the forum, feed and network publish paths.
- **The preview leak.** `GET /api/examples` is unauthenticated and named every
  seeded module, including ones only in admin-preview — telling anonymous
  visitors what a village is quietly trying out. It now filters by what the
  caller may know exists, and the client fetch goes through `gameFetch` so an
  admin previewing a module still sees the label.
- **The feed's two definitions.** Seeding asked "any non-example `kind='post'`
  thread anywhere", retirement fired only on the feed's own category. A real
  micropost elsewhere therefore suppressed seeding forever without retiring
  anything. Both are now category-scoped.
- **Integration-fed recordings.** The Riverside webhook and the YouTube RSS job
  create real recordings without touching the manual route, so an
  integration-fed village kept its example recording indefinitely. Both now
  retire on a fresh ingest.

## The second adversarial pass — including a regression the fixes introduced

Three independent reviewers attacked the FIXES. The headline is that the first
round's fixes contained their own defects, one of them worse than the bug it
replaced.

**A timer was firing the permanent tombstone.** Retiring automation examples on
integration ingest put `onRealItemPublished` inside the 6-hourly YouTube RSS
job, so a poll of a channel — no human act, no undo — would delete every
automation example and, if automation held the last of them, the three shared
example identities with it. Reverted: **retirement fires only on acts a person
took.** The Riverside webhook keeps its trigger (somebody finished recording a
call); the timer does not.

**Scoping traded a deletion bug for a labelling bug.** Scoping forum/feed
retirement by id prefix stopped the cross-deletion, but both modules' examples
sit in the same category and both list queries are category-wide (the forum's
"All" tab sends no category at all). So retiring one dropped its banner and
left the other's rows rendering with no label — platform fiction presented as
village content, which is a worse failure than deleting too much. Fixed by
retiring the two **together** (`RETIRE_TOGETHER`) while each still deletes only
its own rows and stamps its own tombstone.

**Examples were leaving the village.** `GET /api/network/published` had no
filter, so seeded demo needs and offers federated out to every peer and were
cached there as this village's real ones — other villages acting on them and
writing to `build@example.org`. Inbound sync was guarded; outbound was not.

**Examples were being counted as real numbers** in eight more places, including
`regenTotals` (the figure a village carries to funders), the snapshot series
that gates `trendsUnlocked`, all-time governance concentration, library
utilisation (frozen into snapshots and unrepairable), and the synthesis
ready-queue gate that a demo row was silently throttling.

**Two boot assertions could refuse to serve** over a seeded row — and because
seeding runs after them, a bad row would land quietly on one boot and brick the
next. Examples are now skipped by `assertBadgeInvariants` and
`assertExchangeFirewalls`.

Also closed: example quests offered to guests as paid work by the stay-nightly
suggester (`QUEST_SELECT` did not even select the flag, so nothing downstream
could filter); the daily tools link-check dialling example.org and alerting
stewards about unfixable broken links; example events on the public Pulse; and
unguarded role raise-hand and holder appointment.

## Three bugs the runtime build found, all of them invisible on the page

Each of these passed review and typecheck and was caught only by running the
flow end-to-end against a real database.

1. **A raw DELETE cannot reach a memory-cached collection.** `tools`, `circles`
   and `roles` are served by `store-db.ts` caches. Retirement deleted the rows
   from MySQL and the API kept serving all three examples from memory — the
   worst possible state, since the data was gone and the page said otherwise.
   Fixed with `wireExampleCaches()`, injected at boot like `wireModuleAuth`,
   and called after both seeding and retirement. Seeding had the same hole:
   boot seeding runs after `initStores`, so freshly seeded rows would have been
   invisible until the next restart.
2. **The shared event spine made a module look already-populated.**
   `health_events` was in the feed's table list, and it is never empty — every
   boot and toggle writes to it — so the "does this village already have real
   content?" check said yes and the feed silently never seeded. Shared spine
   tables are now excluded from that question, and the feed gets a custom check
   (a non-example thread in the feed's own category).
3. **Modules that seed nothing claimed to be showing examples.** `gratitude`
   and `profiles` are stamped seeded so the attempt is not retried every boot,
   which put them in `modulesWithExamples()` and would have banner-labelled a
   page with nothing on it. Membership now requires rows that actually exist.

## The third pass — what the fixes to the fixes got wrong (2026-08-02)

A pass over the second round of fixes found the same shape a third time: the
guard existed, and the thing it guarded never reached it.

**The whole of the new ThreadView labelling was dead code.** `forumThreadById`
builds its record from an EXPLICIT column list, so `is_example` never reached
the client and `thread.isExample` was permanently `undefined`. The banner never
rendered, and the reply composer, Follow, Report and the decision recorder all
stayed on screen over an example, which is the "discovered by pressing the
button" failure the change said it closed. The flag now rides the detail read,
the list read and the feed lens, and the e2e suite asserts the PAYLOAD rather
than only walking the refusal.

**A row-level label was let out on parole by module state.** `ExamplesBanner`
short-circuits on `useExamplesState`, so even once the flag arrived the label
would vanish on the first paint, during the retirement reconciliation window,
and for a module cleared while its twin still held rows. It takes a `row` prop
now: when the ROW says example, the module answer is not allowed a veto. The
module was also being picked by `kind`, which examples.ts warns against by
name (`ex-feed-3` is an announcement); it comes from the seeded id prefix.

**The clear button was exempt from `RETIRE_TOGETHER`.** It called
`retireExamples` directly, so clearing the forum stamped one tombstone, dropped
one banner, and left the feed's three example threads on the forum's "All" tab
with no label at all. `retireExamplesWithPair` is now the door both the publish
trigger and the button go through, and the client stopped mirroring the
asymmetry.

**A 2s timer could resurrect the banner over a member's own new content.** The
reconciliation check could not tell "retirement failed" from "retirement has
not finished", and retirement is fire-and-forget across ~25 COUNTs per module,
fired for two modules at once on a forum post. One slow database and the banner
came back permanently. It backs off (2s / 5s / 15s) and only restores on the
last attempt, and the admin clear path skips it entirely because that response
IS the server's awaited answer.

**A failed admin clear was spending the automatic path's budget.**
`countRetireFailure` ran for every reason, so five unlucky presses of the
escape hatch switched off `first_real_item` retirement for that module forever
— against a comment saying the button ignores the ceiling on purpose. Only the
automatic path counts now.

Also closed: the two unguarded stays admin routes (the price one deactivates
every posted rate before re-inserting, so a half-filled form left the demo's
rates off for good); exchange price, halt and resume; promoting an example
identity through the role route; a real warning badge awarded ONTO an example
identity, which `badgesOpenState` counts and which outlives its holder's
deletion; `relevantSyntheses` feeding the seeded demo call to the model as
"THIS VILLAGE'S OWN RECORD, highest authority"; the shelf-transparency count of
the same table; `members_active_cycle`, the last unfiltered read in the frozen
snapshot path; the sessionStorage first-paint hint surviving a sign-out; a
stale pre-sign-in answer still reaching component state after the cache guard
rejected it; unlabelled example rows in the Quests, Circles, Roles, Stays and
Network admin surfaces and in the peer list; the Village Health banner claiming
a page whose headline said "Nothing recorded yet"; an unreachable example
branch in the exchange listings table (`listableTokens` filters examples out
and drops the flag, and the filter is the half worth keeping); and a `runOnce`
key dated two days into the future, which would have silently consumed the id a
real 2026-08-04 revision needed.

## Open questions for Rye

1. **Interactivity** — confirmed inert, or do you want the harmless ones
   (replying to an example forum thread, hearting an example feed post) to be
   live? Hearts move real budget, so "harmless" is not quite free.
2. **Authorship** — examples need an author. Proposed: one reserved non-member
   identity that cannot log in and is excluded from member lists, gratitude
   eligibility, Sybil metrics and health counts. The alternative — a small cast
   of named placeholder villagers — demos better but puts fake people in
   `users`, which the architecture warns against.
3. **Retirement scope** — per module (proposed), or platform-wide, where the
   first real item anywhere clears every module's examples at once?
