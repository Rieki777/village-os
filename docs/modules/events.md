# Module: Events (0059) — the village calendar

<!-- describes: server/lib/gatherings.ts shared/gatherings.ts server/lib/events.ts server/lib/calendarCommunity.ts client/src/components/calendar/print.css server/lib/calendarBrief.ts -->

Provenance: platform

**Gatherings with a time, a place, a capacity and an RSVP. Other surfaces read
it: the Living Map lights the building something is happening in.**

Written as-built, 2026-08-08. Where this file and the code disagree, the code
wins and this file is stale.

## Why it is a module and not a link

`brand.project.eventsUrl` pointed somewhere else and `/seasonal-festivals` was
prose. Nothing could answer "what is on this week", nothing knew who was
coming, and the map had no way to know a building was busy. The call: events
are their own module, and the foundation other surfaces read.

## Naming, so nobody trips

The module id is `events` and the tables are `events` and `event_rsvps`.
The CODE is called **gatherings** (`server/lib/gatherings.ts`,
`shared/gatherings.ts`), because `server/lib/events.ts` is already the
platform's event SPINE (`recordEvent`, the one way into `health_events`) and
two unrelated things called `events` is a mistake waiting for a tired import.

## Data model

`events` — schema.org/Event shaped on purpose, near enough to emit JSON-LD with
no translation layer (`toSchemaOrg`, `shared/gatherings.ts`).

| column | notes |
|---|---|
| `starts_at`, `ends_at` | **datetime, not timestamp.** MySQL gives the first timestamp column an implicit `ON UPDATE CURRENT_TIMESTAMP`, which would move an event's start date every time anyone edited its description. `ends_at` NULL means the village did not say. |
| `structure_keys` | JSON array. The map's multi-address: a festival occupies the greenhouse AND the commons, and neither is the real one. |
| `capacity` | NULL is uncapped. **0 is a real answer meaning nobody.** Every reader tests `=== null`, never falsiness. |
| `status` | `draft` is ours and never leaves the admin surface; `scheduled`/`cancelled`/`postponed` map straight to schema.org `eventStatus`. Enums are ordinal, so new states go on the END. |
| `visit_type_id` | Nullable and unconstrained: stays ships off, and an event must not depend on a module being on. |

`event_rsvps` — one row per person per gathering (`UNIQUE (event_id, user_id)`),
so changing your mind UPDATEs and counting "going" is a plain COUNT.
`idempotency_key` is **NOT NULL**: MySQL UNIQUE indexes exempt NULLs, so a
nullable dedupe column would read as protection and prevent nothing.

## The one thing to not get wrong

**Capacity is enforced inside the transaction.** `rsvp()` takes
`SELECT ... FOR UPDATE` on the gathering row, then counts, then writes. Reading
a count in the route, deciding, and writing later is check-then-act: two people
answering the last seat both read 9 of 10 and both get in. This codebase has
already paid for that bug twice, in swap caps and in the per-cycle mint cap.

Only a NEW `going` consumes a seat. Someone already counted who re-confirms is
not a second body in the room, and withdrawing frees the seat because the count
is derived rather than a counter somebody has to remember to decrement.

## Gate and capabilities

Both prefixes mount behind `requireModule("events")`, admin included. There is
no settlement webhook and no value in flight, so nothing needs to stay mounted
while the module is off.

- `event.rsvp` — stage floor `guest`. Any account can say it is coming.
- `event.manage` — **not in `STAGE_UNLOCKS`**, deliberately. Putting something
  on the village calendar is an appointment, granted by a role or a badge,
  never reached by climbing.

## Game variables (all three are read)

`events.rsvp_enabled` gates the RSVP route. `events.upcoming_days` and
`events.past_visible_days` bound the list query, two-sided on purpose: a
calendar that drops a gathering the moment it starts tells somebody standing
at the door that nothing is happening.

## Privacy

An RSVP names a person and says where they will be on a given evening, so it
records to the spine with `audience: "admin"`. The gathering is public news;
who is attending is not. Creating one records as `public` unless it is a draft.

## What the map reads

`GET /api/events/by-structure` returns one entry per structure key with the
soonest gathering and its `daysUntil`. Registered ABOVE `/api/events/:id`,
because Express matches in order and would otherwise read `by-structure` as an
id. `daysUntil` is computed in `shared/gatherings.ts` and never in SQL, so the
server, the client and the map cannot drift.

## Prior art

The data model is read from **Gancio** (lean title/when/place core),
**Mobilizon** (participant roles, capacity options) and **Hi.Events** (RSVP as
its own row), plus **schema.org/Event** for portability. All three are AGPL, so
no code is copied: what is borrowed is the shape of the problem.

## The admin surface

Admin → The Game → **Gatherings** (`client/src/components/EventsAdminPanel.tsx`,
self-contained, mounted in one line). Create and edit, publish a draft, cancel
a scheduled gathering, delete, and read the answer list.

Admin tabs in this app are NOT filtered by module lifecycle: the nav is a flat
list and the API 404s instead, which is how every other module tab behaves. So
the panel handles the off state in words, because hiding the tab would leave a
founder hunting for a calendar that used to be there.

The answer list joins `users` with a LEFT JOIN so an answer from a member who
has since deleted their account still counts toward the room, and renders as a
tombstone. It carries names and never emails: an organiser needs to know who is
coming, and a downloadable address list is a different feature with its own
consent question.

## Not built

No recurrence (`RRULE`), no ActivityPub federation, no per-event visibility
beyond `draft`, no waitlist when a gathering fills, and no ticketing or
payments. `is_example` rides on the table but `EXAMPLE_TABLES` is untouched, so
the standing-examples machinery does not retire these rows.

## The community half (0088, round 4 lane L5b)

The calendar grew its community features on top of the one-table core (0085):

**The waitlist.** A full gathering takes a queue instead of a shrug.
`POST /api/events/:id/waitlist` joins only when the room is genuinely full,
measured under the same `FOR UPDATE` lock on the events row that `rsvp()`
takes, and promotion runs INSIDE whichever transaction frees a seat (an
answer moving off `going`, a withdrawn answer in the now-transactional
`withdrawRsvp`, a raised capacity in `updateGathering`). Oldest first, no
priority for anyone, `promoted_at` stamped once, and the person is told
through a notification sink that fires only after commit
(`server/lib/calendarCommunity.ts`). Rejoining after leaving goes to the
back of the line.

**Slots.** A gathering declares what it needs (a dish, a ride, childcare,
setup crew; `event_slots`, kinds in `shared/gatherings.ts`). Whoever holds
`event.manage` writes them in the admin panel; members going sign up under
`FOR UPDATE` on the slot row so the cap holds. Counts travel to anyone who
may see the event; names only to a viewer whose own answer is `going` or to
the crew. Never emailed.

**Meet-me windows.** `kind = 'meet-me'`: a member says when and where they
are findable, on the village layer or their own private one, seven open
windows at most, one new one an hour. L7's introductions read them through
`listCalendarItems({ kinds: ["meet-me"] })`.

**Layers in the UI.** Week and month views carry layer chips (a display
filter over what the server already decided; the client never filters FOR
privacy) and per-item pills. A member posts to their own private layer live,
or asks for the public calendar, which saves as a draft the crew approves in
the admin panel. `/api/events/mine` shows the author where their request
stands.

**Who is here.** `GET /api/events/who-is-here` folds stays into the week
view's band: arrivals from `arrive_on`, here-now from `status = 'active'`,
departures only from `status = 'ended'` and the row's own `updated_at`
(stays has no departure date and the band does not invent one). Names at the
`map.viewPeople` tier; counts, with no name or id key at all, below it. 404
while stays is off.

**Print.** The month grid and the year wheel print through one sheet
(`client/src/components/calendar/print.css`): chrome stripped, light
background, the zone and both month names in the header.

**The weekly brief.** Once a week, on an admin-chosen evening in village
time (Sunday 18:00 by default, `module_settings.config` under
`events.brief`), every member gets one digest: arrivals and departures,
meals and gatherings, moon and season marks, open seats, new quests
(`quests.created_at`, added in 0088; older rows stay NULL and are never
called new), and opportunities once L7 wires
`setOpportunitiesProvider(opportunitiesForBrief)` in
`server/lib/calendarBrief.ts`. The whole thing is a template
(`renderWeeklyBrief` in `assistantTemplates.ts`) over readers the village
already has: NO model call, no `assistant_usage` row, no `assistant-day:`
bucket, and the test in `server/lib/calendarBrief.test.ts` holds that line.
Delivery is `runWeeklyBrief` in `notify.ts`: an in-app row (dedupe
`brief:<week>:<user>`, so the evening's later ticks send nothing), an email
with the full HTML for those the daily cap and their prefs allow, and one
`enqueueAgentDelivery(..., { kind: "weekly_digest" })` per member whose
agent listens, every non-ok reason tolerated in silence. Each member's
opt-out is `notify.weeklyBrief` on their profile prefs, switchable inside
the brief panel at `/events?brief=`.

## Seat fees (0092)

A gathering can ask for the village's own credits. `events.seat_price` and
`events.seat_token` on the row; 0 is free and is what every gathering is
until a host prices one. Only a credit-kind platform token can be a price:
recognition is refused by name at the validator, the same separation the
cycle pool's guard enforces at close.

**A PLACE is charged, and a place is a seat OR a queue position.**
`promoteWaitlist` writes a `going` answer with nobody present to agree to a
charge, and it runs inside a transaction that cannot post to the ledger. So
the fee is taken when somebody takes a place, promotion moves no money
because the money is already held, and it comes back whole if the place
never becomes a seat.

**The order is the seat first, then the fee**, the same shape the library's
borrow path uses. `postTransfer` owns its own transaction and cannot join the
one holding the events-row lock, so the seat commits, the fee posts, and a
refused fee COMPENSATES by handing the seat straight back. Charging first
would leave a crash between the two with a member paid for a seat they do not
have; this way a crash leaves a free seat, which somebody can see and fix.

**Every exit refunds, idempotently at two layers.** An atomic claim on
`event_seat_charges` decides the terminal exactly once; the keyed ledger leg
posts whether or not this caller won the claim, because the loser's job is to
finish a winner that may have crashed in between. So a retried cancel refunds
once, and a crashed refund is completed by the next attempt rather than lost.
Withdrawing, answering anything other than `going`, leaving the queue, the
gathering being cancelled, and the gathering being taken back to draft all
come through it. `deleteGathering` refunds BEFORE it deletes anything, which
retires the "there is no ledger value here to preserve" comment it used to
carry.

Money rests in `sys:event-escrow`, which is NOT a faucet, so a refund can only
ever pay out what somebody paid in. `seatEscrowDrift` compares that account
against the sum of open charges and rides in the admin reconciliation payload:
conservation alone cannot see a fee charged and never recorded, because that
still sums to zero. Held fees are open state, so `openStateCheck` refuses to
switch the module off over them. A gathering that HAPPENED releases its fees
to `sys:treasury` on the `seat-fee-settle` job, a day after its end time.

**The Living Map one-tap promise refuses a priced gathering.** Every other
door shows the fee first: the calendar card carries `seatPrice`, the agent
surface echoes the request back for confirmation, and an assistant draft is
confirmed by hand. A lantern is one tap on a building with no price near it.
It answers `closed`, deliberately not a new reason, because the map's copy
table lives inside the generated artifact.
