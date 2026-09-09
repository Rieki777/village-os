# Module design: messaging

<!-- describes: server/lib/messaging.ts drizzle/0066_messaging.sql client/src/lib/messaging.ts -->

Provenance: platform

> Built 2026-08-10 as a platform primitive, deliberately ahead of the module that first wanted it.
> Registry id `messaging`; the client page is `client/src/pages/Messages.tsx`; the repo layer is
> `server/lib/messaging.ts`; the schema is `drizzle/0066_messaging.sql`.

**N-party conversations with names, membership, messages, and per-member read state, plus an inbox and a thread view. Direct messages are the two-party case of the same table, never a separate path.**

## Why it exists as a substrate

The quest crews build needed somewhere for a named group to talk, and this platform had no
messaging of any kind: no direct messages, no group threads, no read state, no inbox. Crews
shipped with the smallest honest thing instead, a quest-scoped thread riding the forum and
notification spines. That works for crews. It is not messaging.

The sibling game (regen-civics) reached the same wall from the other side. Its `conversations`
schema was genuinely N-party and its push fan-out already reached every participant, but
everything above it was hard-coded 1:1: the list procedure returned a singular `otherUser`, the
Messages UI rendered around that, and there was no conversation name and no system-message
concept. When its quest-parties spec needed group threads, it had to absorb a scoped messaging
rework nobody had budgeted, and the estimate moved from days to a week and a half.

So this ships as a primitive. The modules that want group conversation later consume it.

## Data model

Four tables, `drizzle/0066_messaging.sql`. Ids are `varchar(64)` like every other id in this
schema: `users.id` is a varchar, and an integer `author_id` would not join to it.

### `conversations`

| column | type | notes |
|---|---|---|
| id | varchar(64) | PK, `cnv-…`. |
| kind | enum('direct','group','crew') | Ships COMPLETE. A live enum ALTER is the forbidden migration class here, so `crew` exists before any crew does. |
| name | varchar(120) NULL | NULL for direct threads: their title is the other person's name, which is a per-viewer fact and not something a row can hold. |
| context_type / context_id | varchar(40) / varchar(100) NULL | `'quest'` + the quest id when a crew thread. Indexed together. |
| created_by | varchar(64) | The opener; for a group, its first owner. |
| direct_key | varchar(160) NOT NULL | UNIQUE. Direct rows key on the sorted member pair (`d:<a>|<b>`); every other row keys on its own conversation id. |
| last_message_at | timestamp NULL | A CACHE. See below. |

**`direct_key` is NOT NULL and that is load-bearing.** A MySQL unique index exempts NULLs, so a
nullable dedupe column admits unlimited duplicate direct threads between the same two people. A
shared `''` sentinel would not work either, because every group row would then collide on it.
Keying non-direct rows on their own id gives one index that serves both cases with no sentinel.

### `conversation_members`

PK `(conversation_id, user_id)`. Carries `role` (owner/member), `joined_at`, `last_read_seq`,
`muted`, `left_at`.

**Read state is per member, not per message.** `last_read_seq` is one integer, so an unread count
is one comparison and costs the same at ten messages and at ten thousand. It advances through
`GREATEST`, so two tabs reporting different positions settle on the further one and a retried
request from a flaky connection can never mark read messages unread again.

A member who leaves keeps their row. Their history stays theirs, old lines keep a name in the
roster, and `left_at` takes them out of every membership check.

### `messages`

PK is the `varchar(64)` id; `seq` is a `bigint AUTO_INCREMENT` with its own unique key, because
AUTO_INCREMENT has to lead an index.

**Why a sequence and not the id or the timestamp.** Read state needs a total order. Timestamps tie
at the same second, and the random suffix on a generated id orders arbitrarily. `seq` is the only
thing here that is monotonic by construction.

`deleted_at` is a soft delete: a tombstone, never a hole. The row keeps its seq, so nobody's
unread count moves because somebody else removed a line, and the thread never grows a gap where a
message used to be.

### `message_reports`

`UNIQUE (message_id, reporter_id)` with both columns NOT NULL, so report-once-per-person actually
holds. Deliberately NOT the forum's auto-hide-at-N-reporters rule: that rule reads a community's
judgement off a public thread, and a private conversation has no community to read from. These
rows go to a human through `GET /api/admin/messages/reports`.

## The `last_message_at` cache

Held to the `token_balances` rule: **recompute, never increment.** Every send re-derives it from
`messages` rather than stamping "now", tombstones included, because a conversation that was active
at that moment really was.

`auditLastMessageAt()` re-derives every row and reports drift by id. It runs at boot when the
module is non-off, and logs loudly when anything was wrong. The ledger's lesson, applied: a
denormalized number only ever written by the code that also writes its source is a number nobody
checks.

**The columns are `timestamp(3)`, and that is load-bearing (0073).** 0066 shipped them without
precision, and a MySQL `timestamp` with no precision stores WHOLE SECONDS. Two conversations that
received a message in the same second therefore held equal `last_message_at`, fell through to a
`created_at` that was also whole-second and equal, and ran out of tiebreakers, so the engine was
free to return either order. It reddened main on the ordering test about half the time, but the
test was the messenger: the same ambiguity reorders a real member's inbox between two loads for no
reason they can see.

`messages.created_at` carries the precision too, because it is the SOURCE the cache is derived
from. Raising it on the cache alone would only store whole seconds in a column that can hold
thousandths.

## What the inbox orders by (0074)

**`conversations.last_message_seq`**, the newest message's `seq`. Two conversations can never
share a message, so this key **cannot tie**: the comparator reaches `created_at` and `id` only for
threads nobody has spoken in yet.

`last_message_at` is still what a row DISPLAYS. It is no longer what the list sorts by, and that
split is the reason both columns are recomputed in one statement.

The route went 0066 → 0073 → 0074 and each step is worth keeping straight:

- 0066 ordered on `last_message_at`, declared as whole-second `timestamp`. Two conversations
  active in the same second tied, fell through to an equally-tied `created_at`, and ran out of
  tiebreakers, so MySQL returned either order. Red on main for 75 minutes.
- 0073 made the sort **total** (`, c.id DESC`) and gave the columns `timestamp(3)`. That fixed the
  bug: determinism from the totality, semantic accuracy from the precision.
- 0074 makes it **correct rather than coincidental**. `c.id DESC` only meant "newest first"
  because this module's `newId` keeps the epoch-ms a fixed-width decimal, and messaging is the
  only one of five `newId` implementations in `server/lib` that does (`orgChart`, `orgDrafts`,
  `orgRelations` and `seasonPatterns` all use `Date.now().toString(36)`, which is variable-width).
  Resting the inbox on that was a coincidence waiting to be tidied away.

0066's own header had already made this argument, about read state: seq exists so ordering "never
turns on a timestamp tie or on the ordering of a random id suffix". Read state used it and inbox
ordering did not. 0074 closes that inconsistency.

**`sortInbox()` on the client sorts by the same key.** It re-sorts a list the API already ordered,
so any key it uses that the server does not will reorder the inbox on the next optimistic send.
That has gone wrong once, when the two tie-breakers ran in opposite directions.

**The dangerous edit is now in `auditLastMessageAt()`.** It re-derives wholesale, so if it ever
repairs one column and not the other it does not merely miss a drift, it manufactures one on every
boot, and the inbox sorts on a stale key while rendering a fresh time, with no error and no failing
test. Both columns are compared and both are written in one statement, and the test for that is
written before the happy-path ones on purpose. The same rule binds `recomputeLastMessageAt()`.

Four paths are pinned by tests: the SQL recompute; the audit's JavaScript round-trip, which is the
one that could quietly truncate the milliseconds; the audit repairing each column without
disturbing the other, checked in both directions; and 0074's backfill, read out of the shipped
migration file rather than copied, because the harness applies migrations to an empty schema and
would otherwise never execute that statement at all.

## Endpoints

Every route mounts behind `requireModule("messaging")`.

- `GET /api/messages` — the inbox: conversations by `last_message_at`, each with an unread count, a preview, the roster, and a per-viewer title. Plus `unreadTotal`.
- `GET /api/messages/people?q=` — who you can write to, by search, two characters minimum. Registered BEFORE `/:id` or Express reads "people" as a conversation id.
- `POST /api/messages/direct` — `{ userId }`. Opens or reuses the direct thread; someone who left rejoins the thread they already have.
- `POST /api/messages/groups` — `{ name, memberIds }`. The creator owns it and is always in it.
- `GET /api/messages/:id` — one thread: roster, read state, and a page of messages (`?before=<seq>`).
- `POST /api/messages/:id/messages` — send.
- `POST /api/messages/:id/read` — `{ seq }`, monotonic.
- `PATCH /api/messages/:id` — `{ muted }` for yourself, `{ name }` for a group's owner.
- `POST /api/messages/:id/leave` — anyone, always.
- `POST /api/messages/:id/members`, `DELETE /api/messages/:id/members/:userId`, `POST /api/messages/:id/owner` — owner only, groups only.
- `PATCH /api/messages/:id/messages/:messageId` — author only, behind `message.send`, leaves a public edit marker; refused on a tombstone.
- `DELETE /api/messages/:id/messages/:messageId` — author only, leaves a tombstone.
- `POST /api/messages/:id/messages/:messageId/report` — the report path every thread inherits.
- `GET /api/admin/messages/reports`, `PUT /api/admin/messages/reports/:id` — the moderation queue.

## Authorization

**Every read authorizes on membership, and the refusal is indistinguishable from a miss.** A
conversation id in a URL proves nothing. All four of these answer with the same `404 { error: "Not
found" }`:

- the conversation does not exist;
- it exists and you were never in it;
- it exists and you left it;
- (at the framework layer, with its own `module_disabled` body) the module is off.

The strongest case, and the one `server/messaging.routes.e2e.test.ts` pins: **an admin reading a
thread they are not a member of gets the 404 too.** Admin is the operator's key to the deployment.
It is not a key to other people's private conversations through the member API. Moderation reaches
message bodies through the reports queue, where a human has asked for review and the reading is
recorded.

**Every id in a path is scoped to the conversation the caller proved.** A message id alone is never
enough. The security review of 2026-08-10 found `softDeleteMessage` reaching messages by id with no
`conversation_id` in the WHERE clause, which made the membership check on the URL decorative: a
member removed from a thread could still tombstone their own messages in it, from any other
conversation they were in, erasing the bodies attached to any report about them. Both the repo test
and the route test now pin the scoped form.

**Roles are a property of ACTIVE membership, never a residue.** The same review found that leaving
did not demote, and `addMembers`'s `ON DUPLICATE KEY UPDATE` cleared `left_at` without resetting
`role`, so a former owner re-admitted through the ordinary flow came back holding every owner-gated
route and could eject the owner who had just let them in. Leaving and being removed now both demote,
and re-admission always writes `member`. Two writes belt-and-braces, because the escalation is
silent and the add-member API exposes no role for an owner to notice.

## The one gate

`message.send` (`shared/capabilities.ts`), stage-unlocked at `member`, the same rung as
`forum.post`: once you have joined, you can talk to the people you joined.

**Reading is membership, not a capability.** Suspending someone's ability to write is the remedy;
taking away their ability to see what was already sent to them is a different and harsher act, so
a member who has lost `message.send` still reads their inbox.

A warning badge's deny suspends messaging, and that is the whole reason the deny path outranks
role and stage in the gate's order of authority. There is no per-module mute, no second permission
mechanism, and nothing gates anywhere but `hasCapability`.

**What the capability covers, and what it deliberately does not.** It gates sending, opening a
conversation, renaming a group, and adding, removing or promoting members. A rename reaches every
member's inbox title and every notification email subject, so it pushes text at people exactly the
way a message does; adding somebody hands them the whole thread's history. A suspension that a
`PATCH` walks around is not a suspension. It does NOT gate reading, muting, leaving, deleting your
own line, or reporting: those are self-protective or self-limiting, and a member under suspension
must always be able to do them.

## Notifications

Type `message`, on the S16 spine. Email cadence is a member preference (`messagesEmail`, default
immediate) alongside mentions and replies.

**One notification per unread RUN per recipient, not one per message.** The dedupe key is
`msg:<conversationId>:<recipientId>:<lastReadSeq>`, so twenty messages into an unread thread
produce one row, and reading the thread moves the seq and re-arms the next one. Without this a
busy thread is a notification flood, and `notifications.dedupe_key` is NOT NULL with a real unique
index, so the collapse is enforced by the database rather than by a check somebody can reorder.

Muted members and members who left get nothing. Tombstoned and claim-pending accounts get nothing,
because a notification addressed to an account nobody can sign into is litter.

**No `moduleActivity` call, deliberately.** A private conversation is not village news and the
Pulse is a public surface. The only event messaging records is a report, at `audience: "admin"`.

## Disabling: no `openStateCheck`, on purpose

`openStateCheck` exists for modules holding VALUE somebody is owed: open loans, active stays,
unsettled orders, standing warnings. Invariant 13 is about value, and **an unread message is not a
debt.**

So messaging may be switched off whenever a village likes. Off hides the surface; the conversations
stay in their tables and come back intact when it is switched on again, which the route test
asserts rather than only asserting the doc. Nothing hard-requires messaging, so nothing blocks the
switch from the dependency side either.

If a later module makes a conversation load-bearing for something that IS value, that module adds
the check, and this paragraph is the thing to argue with first.

## Game variables

Both are read on the paths they name. A knob nothing reads is a lie with a save button.

- `messaging.sends_per_minute` (20, 1-120) — the per-member send limit, counted across every conversation. Enforced with a second, looser per-IP bucket beside it, so one stolen token cannot spray the village from a script.
- `messaging.max_members` (50, 2-500) — the largest group. Also the size of the loudest single send anyone can make, since every message notifies everyone who has not muted.

## Surfaces

`/messages` is the inbox, `/messages/:id` the thread. Lazy-loaded like every module route (17 kB
gzipped 5 kB, off the main bundle).

**Mobile-first, designed at 390px.** The thread is a full-height column: header pinned to the top
with the back arrow in it, message list the only thing that scrolls, composer pinned above the
keyboard. Every tap target clears 44px. The wide layout is the same column, centred and boxed.

The site-wide `prefers-reduced-motion` rule in `index.css` covers CSS transitions but cannot reach
`scrollIntoView`, which is a script API, so the thread's scroll-to-newest checks the media query
itself and jumps instead of gliding.

**The members panel carries the owner's powers**, which were routes without a surface for a while:
add people (the same search that starts a conversation, with existing members filtered OUT of the
results rather than shown and refused), remove someone, and hand the conversation on. Each control
is drawn only when the server would actually accept it — owner-only, group-only, and never against
yourself — because a button that always answers 400 teaches people the app is broken rather than
that they lack a permission. Every member sees rename state, mute, leave, and per-message edit,
delete and report.

Pure logic lives in `client/src/lib/messaging.ts` with unit tests beside it, the same shape as
`questBoard.ts`: titles, member summaries, unread badges, relative timestamps, day grouping, and
the owner-affordance mirrors. Those mirrors keep the UI honest and are never the gate.

## Sanitization

Bodies and names go through `cleanText()`: newlines normalized, C0/C1 controls stripped (tab and
newline kept), and zero-width, line-separator and **bidi-override** characters removed. The last
of those matters most here: an override makes stored text display in an order nobody typed, which
is a spoofing surface on a screen two people are trusting.

Text is stored as the member typed it otherwise. Every render path escapes already (React by
default, `escapeHtml` on the email path in `notify.ts`), and storing pre-escaped text would
double-escape the moment a second surface renders it. There is no HTML pipeline, the same posture
the forum takes.

## Tests

- `client/src/lib/messaging.test.ts` — 23 cases over the pure helpers.
- `server/messaging.test.ts` — 29 cases over the repo layer against a real scratch schema: membership authorization, direct-thread dedupe from both sides, per-member unread counts, monotonic read advance, tombstones, the one-per-unread-run notification, the cache audit, ownership succession, report-once, and backwards paging.
- `server/messaging.routes.e2e.test.ts` — 11 cases over HTTP against the BUILT server: the module-off 404, the capability refusal, the identical-404 posture including the admin case, and the off-then-on round trip proving nothing was deleted. Order-dependent within the file (the lifecycle is under test); run the whole file, never a `-t` slice.

## Migrating crews onto it, later

A separate pass, after this substrate's tests are green, never in the same change:

1. Crew threads become `conversations` rows with `kind='crew'`, `context_type='quest'`, `context_id=<quest id>`. The enum already holds `crew`, so this is data, with no DDL.
2. A forward migration moves existing crew thread content. The crew's own tables stay the roster of record: the conversation is where they talk, the crew is who they are.
3. The quest page's crew panel links into the thread view instead of rendering its own message list.

## Deliberately out of scope

Attachments, typing indicators, presence, reactions, threading within a thread, search, and push
beyond the existing notification spine. Each is a real feature and each is its own decision.

## Open questions

- **No per-member "who may start a conversation with me" control.** Any member may open a direct thread with any other member today. The remedies are per-conversation mute, leave, the report path, and a warning badge's deny. The map's `contactable` toggle was NOT overloaded for this: its label says "Contactable through the Village Map (role holders only)", and silently widening a setting somebody chose under one description is a worse surprise than not having the control yet. If a village asks for one, it is a new pref with its own copy.
- **Ownership succession is automatic.** An owner who leaves a group hands it to the longest-standing remaining member rather than being refused until they nominate someone. A thread with members and no owner has nobody who can add anyone, and the only way back would be an admin editing a table by hand. Refuse-until-nominated is the other defensible answer.
- ~~**Message editing is not built.**~~ **Built.** `PATCH /api/messages/:id/messages/:messageId`, author-only, scoped to the conversation, refused on a tombstone (editing one would restore a body while `deleted_at` stayed set, so it would read as deleted and render as text). The marker is public and permanent, the posture the forum already takes: a message that can change after it was read, with no sign it changed, is worse than one that cannot change at all. Behind `message.send` unlike deleting, because an edit puts NEW text in front of people; deleting your own words stays available under suspension since removing text is self-limiting. No notification fires, because an edit is not a new message and re-ringing a thread for a typo is how people learn to mute it.
- **Group conversations have no `context` consumer yet.** `context_type`/`context_id` are indexed and unused until crews land.
- **Leaving a direct thread is archiving, not blocking.** `openDirect` clears `left_at` for both parties, so the other person writing again brings the thread back into your inbox. That is deliberate: the alternative is that they talk to a wall and are never told, and nothing stops them opening a fresh thread anyway. Mute is the control for "stop tapping me on the shoulder". A real block is a different feature, and it belongs with the per-member "who may start a conversation with me" question above.
