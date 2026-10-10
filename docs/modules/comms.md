# Module design: comms

<!-- describes: shared/comms/ server/lib/comms/ server/routes/commsPublic.ts server/routes/comms.ts server/routes/commsMembers.ts server/lib/commsSink.ts client/src/components/admin/comms/ client/src/components/comms/ client/src/pages/EmailPages.tsx client/src/pages/VillageEmail.tsx -->

Provenance: platform

> Registry id `comms`, catalogue name Village Comms. Built from 2026-10-02 on the plan Rye approved
> that day. The build spec every lane works from is kept in the maintainers' private operations
> repository, and code comments cite its sections as "the comms build spec". The schema is
> `drizzle/0244_every_email_is_recorded_before_it_is_sent.sql`,
> `drizzle/0245_a_gathering_asks_when_and_remembers_who_came.sql` and
> `drizzle/0246_a_path_remembers_who_walks_it.sql`.

**Every email the village sends passes through one post office, is recorded before it goes, and
reaches only people who agreed to that kind of email. The automations that write those emails
live in this module, and the module ships off.**

## Where the build stands

The comms build lands in waves on one integration branch. This document describes the whole of
it. Two parts were still being built when it was written, each by its own lane, and are marked
**in this release, being built** below: paths (who walks a path, and the tick-box on public
forms) and letters with their outcomes. Everything else named here is on the branch.

## What it is

One post office, one address book with permissions, words a village can edit, and one journey
engine that runs both event emails and path emails. On top of those: guest RSVPs, attendance and
recaps, a live vote on a session time, and letters to the people who asked for them. A Comms
section in Admin holds every part, including everything a founder has to supply, and a member
page shows every journey, email and dial to the people they are sent to.

The vocabulary every part writes into a column is in `shared/comms/kinds.ts`, and the shapes the
lanes build against are in `shared/comms/contracts.ts`. The default words are in
`shared/comms/defaults/templates.ts` and the default journeys, step by step, in
`shared/comms/defaults/journeys.ts`.

## What is plumbing, and always on

These run whatever the module's lifecycle says, because a password link and a person's "stop"
must never wait on a module:

- **The post office.** Every email, from every part of the platform, is written to
  `comms_messages` before it is sent. Essential mail (a password link, a confirmation of
  something a person just did) goes even to an address that has asked to stop everything,
  because the person just asked for it.
- **Unsubscribe and preferences.** One click stops a kind of email, signed out, from any email.
  The preferences page also pauses gathering reminders, path emails and letters for 30 days, or
  stops everything.
- **The delivery-report webhook.** The provider's reports of delivered, bounced and complained
  are stored and applied once each, whatever else is switched off. A permanent bounce or a
  complaint puts the address on the suppression list.
- **Member notices.** The notification spine's emails follow each member's own preferences
  exactly as they did before this module existed. The daily digest and the weekly brief are
  notices too.

## What the module gates

Every journey, guest RSVPs, time-vote emails, letters, and the member page. With the module off,
nothing enrolls and nothing automated is sent.

| Lifecycle | What happens |
|---|---|
| `off` | No journey enrolls or sends. Guest RSVPs, time-vote emails and letters are off. The plumbing above runs. |
| `preview` | Rehearsal. Everything runs, and every email of kind `events`, `paths` or `letters` goes to the rehearsal inbox instead of the person. The subject starts "Rehearsal:", a banner names who it would have reached, and the row records status `rehearsed` with `rehearsal_to`. Essential mail and notices still reach the real person. Only admins see the module's surfaces. |
| `members` | Live. |
| `public` | Live, and guests with no account may say they are coming to a free public gathering. |

Each journey also ships off inside the module: a village turns each one on by itself, on the
Journeys screen. Turning one on adopts the platform's words for it into the village's own table.

**Pause all** (`comms-settings.paused`) holds every kind except `essential` and `notices`. Rows
stay queued, and a row with an expiry may expire while it waits.

The admin routes are gated one route at a time, never wholesale: Settings, Overview and Sent mail
answer at every lifecycle, because a village sets up its sending before it turns anything on,
while Journeys and Words follow the module.

## Who runs it

`comms.manage`, a power the village can hand to a role and hold: turning automations on and
off, changing their words and steps, and sending letters to people who agreed to get them. It is
transferable, so it is in the handover set. A look at any Comms screen asks `mayStillSee`, and a
change asks `guardCapability`. Its consequence line also says what holding it shows: the
village's address book and every email the village still keeps, who it went to, its subject,
whether it arrived, and its words. The provider key, the sending domain and the sender stay with
the admin in the secrets plane.

Members see every journey and dial, and may propose a change to any of them (below).

## Setup

`setup: "required"`. The Settings screen opens with the checklist, and every item stays editable
there later. The module's readiness reader answers ready when items 1 to 5 and 13 are green, and
the Overview shows a banner pointing at Settings until then.

| # | Item | Where it is kept | Required |
|---|---|---|---|
| 1 | The Resend API key (write-only, last four shown) | secret `resend_api_key` | yes |
| 2 | The sending domain: add it, copy its DNS records, check verification | Resend; `comms-settings.domain` | yes |
| 3 | Sender name and address, the address on the verified domain | `comms-settings.senderName`, `email-config.sender` | yes |
| 4 | Delivery reports: one button makes the webhook and keeps its secret; a pasted secret works too | secret `resend_webhook_secret`; `comms-settings.webhookConnectedAt` | yes |
| 5 | The postal address for the footer | `comms-settings.postalAddress` | yes |
| 6 | Reply-to inboxes per path | `email-config` inboxes | no, the sender answers |
| 7 | Who writes back for each path | `comms-settings.pathContacts` | no |
| 8 | The words beside the tick-box on public forms | `comms-settings.consentText` | no, a default is given |
| 9 | The two recap questions | `comms-settings.recapQuestions` | no, defaults are given |
| 10 | Who runs comms: holders of `comms.manage` | the capability gate | no |
| 11 | Investor words reviewed | `comms-settings.investorWordsReviewed` (who and when) | only for the investor journey |
| 12 | The rehearsal inbox | `comms-settings.rehearsalTo` (empty means the admins) | no |
| 13 | A test email to yourself, delivered | the latest `comms.test` row reaching `delivered` | yes |

The launch requirements check the sender, the verified domain and delivery reports for real, and
step 7 of the go-live plan points at Comms Settings. The founder's own steps are in
`docs/FORK_RUNBOOK.md` (Village Comms setup) and `docs/PROVISIONING.md` (step 4).

## The settings planes

Every comms fact lives in exactly one place:

| Plane | What it holds |
|---|---|
| Secrets (`server/lib/secrets.ts`) | `resend_api_key`, `resend_webhook_secret`. Write-only, read back as the last four. An admin-typed value beats the env var. |
| The `email-config` document | The From address and the reply-to inboxes per path, the old Email Settings, now on the Comms Settings screen. |
| The `comms-settings` document (`shared/comms/settings.ts`) | Sender name, domain and its status, postal address, consent words, recap questions, path contacts, investor review, rehearsal inbox, Pause all, delivery-report connection. Read through `readCommsSettings`, which back-fills every missing field with its default on the way out and never writes; a save is a merge patch, so two founders saving different fields cannot undo each other. |
| Game variables, category "Email and reminders" | The dials, below. A village stores only what it changed. |
| The module lifecycle | `off`, `preview`, `members`, `public`, above. |
| `comms_journeys`, `comms_templates` | A village's own journey steps and words, versioned. Absent rows mean the platform's. |

The dials, with their defaults: `comms.quiet_start_hour` 8 and `comms.quiet_end_hour` 20,
`comms.daily_cap` 2, `comms.event_reminder_minutes` "1440,120", `comms.host_nudge_minutes` 60,
`comms.recap_window_days` 3, `comms.guests_default` on, `comms.time_poll_freeze_hours` 48,
`comms.time_poll_settle_minutes` 0, `comms.letters_per_day` 3, `comms.retention_months` 18,
`comms.send_rate_per_second` 2, `comms.notice_expiry_minutes` 120, `comms.open_tracking` off,
`comms.click_tracking` off. Four are founder-held and never put to a vote: retention, the send
rate, and both trackers. The other eleven are proposable on the Game Mechanics page like any
open dial, once the module is live.

## The person-key convention

A member is their user id. Somebody with no account is `guest:<contactId>`, where the contact is
their row in `comms_contacts`. That one string goes in `event_rsvps.user_id`,
`event_waitlist.user_id` and every `person_key` column (`event_attendance`, `event_feedback`,
`event_time_poll_votes`, `path_enrollments`), so every seat count and waitlist read that existed
before guests counts a guest with no change. Readers that name people learn the prefix and read a
guest's name from `comms_contacts`, never their address. `drizzle/0245_a_gathering_asks_when_and_remembers_who_came.sql`
and `server/lib/comms/guests.ts` say the same.

An address is keyed by `email_key`: the address trimmed and lowercased, and nothing else folded.

## The post office

`server/lib/comms/postOffice.ts`. One door in, one door out.

- **`post()`** validates the address (a bad one is recorded `skipped:bad_address`), makes sure of
  the contact, and inserts the row before anything else. A duplicate idempotency key answers
  `duplicate` with the first row's id, so a retried caller never sends twice. `urgent` sends
  inside the request with a 10 second timeout; everything else waits for the drain.
- **The checks**, made when the row is written and again when it is sent: the suppression list
  (blocks every kind except `essential`), the person's permission for the kind, Pause all, the
  module lifecycle and rehearsal, the daily cap, and expiry.
- **The daily cap** counts kinds `paths` and `letters` per person over 24 hours. Over it, the row
  waits for the next window and is never dropped. `events`, `essential` and `notices` do not
  count.
- **Expiry** is set by the caller: notices after `comms.notice_expiry_minutes`, gathering
  reminders at the gathering's start, recaps after 7 days, nothing else. An unsent row past its
  expiry becomes `expired`.
- **The drain** (`comms-post-office`, every minute, and "run now") sends due rows oldest first,
  claims each before sending, and sends at `comms.send_rate_per_second`. A `sending` row older
  than 10 minutes goes back to the queue, safely, because the provider's idempotency key is the
  row id. Network errors, 429 and 5xx retry at 1 minute, 5, 30, 2 hours and 6 hours, then fail;
  any other 4xx fails at once with the provider's words in `last_error`.
- **The one door out** is `server/lib/comms/transport.ts`, Resend over `fetch` against
  `RESEND_API_BASE` or the real endpoint. One email per call, `Idempotency-Key` set to the row
  id, tags `msg` and `kind`, and on every kind except essential a signed one-click
  `List-Unsubscribe` with `List-Unsubscribe-Post`. `scripts/check-one-mail-door.mjs` fails CI
  on any other file that sends.
- **Nothing configured** (no key, no sender, no verified domain) is recorded `skipped:not_configured`
  and the caller is told. It never throws.
- **Essential bodies are never stored.** Most essential mail carries a link that acts for the
  person, so its words stay out of the table. A ledger fault never stops an essential email: it
  logs loudly and still sends.
- **The old mailer** keeps its names in `server/lib/comms/mailer.ts` (`sendResendEmail` and its
  config readers) as a thin call to `post()`, so every send that existed before this module now
  appears in Sent mail.

## The address book and permissions

`server/lib/comms/contacts.ts` and `server/lib/comms/permissions.ts`. Five kinds of email:

| Kind | Who gets it |
|---|---|
| `essential` | Always the person who asked. Never stored as a permission. |
| `events` | People who said yes to that gathering. |
| `paths` | A member who chose a path at sign-up or in their profile (basis `account`), or a non-member who ticked the form's box (basis `asked`, with the form and the words they saw as evidence). |
| `letters` | Only an explicit yes. A non-member confirms by email first (the `letters_confirm` double opt-in). |
| `notices` | Follows `users.prefs`, as before. |

A backfilled or newly seen address gains nothing beyond what its source implies. Unsubscribing
writes `no` for the kind and stops that person's journeys of that kind; "stop everything" writes
the suppression `unsubscribed_all`. Answers are read only through `answerFor` and
`permissionFor`, because the 30-day pause lives in the evidence.

Suppressions (`server/lib/comms/suppressions.ts`) hold one row per address with the strongest
reason given: `bounced`, `complained`, `unsubscribed_all` or `manual`. Restoring a complaint asks
for a reason, which is kept.

## Signed links and the public pages

`server/lib/comms/links.ts` signs every one-click link: `base64url(json).base64url(hmac)`, an
HMAC-SHA256 under a key derived from `VILLAGE_SECRETS_KEY`, ids only in the payload and never an
address. Nothing acts on a GET, because mail scanners open every link: a page shows what will
happen and acts on a POST, and one-click unsubscribe is the RFC 8058 POST.

The pages live in one lazy chunk, `client/src/pages/EmailPages.tsx`: `/email/preferences`,
`/email/unsubscribe` and the action page `/email/a`, which answers whatever action a link names
through the action registry (`server/lib/comms/actions.ts`). Registered actions: letters
confirm, preferences, guest confirm, can't make it, recap answer, RSVP to the next gathering,
and the time vote. Every public route takes a per-IP `overLimit` bucket.

## Words

`server/lib/comms/render.ts` and `server/lib/comms/templates.ts`, with the renderer in
`shared/comms/markdown.ts` and `shared/comms/letterHtml.ts` (ported from ReGen Civics' markdown
letters): table-based buttons, a plain-text part, a preheader, the village's brand colours and
logo, and a footer with the village name, the postal address, why the reader got it, and their
preferences link.

- **Merge fields** are catalogued in `shared/comms/mergeFields.ts`, with a fallback each. A line
  holding a fact nobody has is left out of the email, never sent half empty.
- **Reads:** the village's live row in `comms_templates` when it has one, else the platform's.
- **Adopting:** turning a journey on, or saving an edit, copies the default with
  `platform_version` set. From then on the village holds its own copy.
- **Edits** make a new version and retire the old; restore brings an old one back.
- **Platform upgrades:** when a village's `platform_version` is below the default's version,
  Words shows "an improved version is available" side by side, and adopting is one click.
  Nothing changes a village's words by itself.
- **Preview equals send:** the preview calls the same `renderTemplate` the senders use, and "Send
  me a test" posts it as essential to the admin who asked.

**The default words** follow the copy key (`docs/COPY_STYLE_KEY.md`, R46 and R47 "the four
voices"). After the greeting, each email names its one next step; it says what happens and never
how the village does it; warmth goes where a reply reaches a person; and an email ends with at
most one Lore line. The R47 pass moved 28 templates to version 2. The investor path's five emails
stayed at version 1, word for word, because they wait on Rye's or counsel's review.
`shared/comms/defaults/words.test.ts` renders every one and holds it to all of this.

## Journeys

`server/lib/comms/journeys.ts`: `enroll`, `stop`, `touch` and the tick. Definitions are in
`shared/comms/defaults/journeys.ts`; a village's own steps are in `comms_journeys` with every
save versioned in `comms_journey_versions`, and an enrollment keeps the version it started on.

| Journey | Starts when | Steps |
|---|---|---|
| `gathering.going` | someone says yes, or a guest confirms | confirm (at once, urgent, with an `.ics`); the day before (skipped if they said yes under 36 hours before); two hours before. Stops: withdrew, cancelled, removed. |
| `gathering.host` | a gathering is published; enrolls the host | nudge an hour after the end, skipped if the recap went or nobody said yes. |
| `member.welcome` | a member joins | day 0, 3, 7 and 14. |
| `joining.request` | someone asks to join | day 0, 5 and 14. Stops: admitted, declined. |
| `path.<id>` | someone starts a path | day 0, 2, 5, 10 and 21. |

- **The dials shape the gathering journeys.** While a village runs them unedited, the reminder
  steps come from `comms.event_reminder_minutes` and the nudge from `comms.host_nudge_minutes`.
  Once a village edits one on the Journeys screen, its own steps hold, and the screen says so.
- **Windows.** Path, member and joining steps wait for daytime in the reader's zone
  (`comms.quiet_start_hour` to `comms.quiet_end_hour`, the village's zone when theirs is
  unknown). Gathering steps are bound to the gathering's clock and are not held.
- **The planner** (`shared/comms/journeyPlan.ts`) is pure. It answers what is due and when, what
  is skipped and why, when to look again, and whether the journey is finished. A step whose time
  passed before enrollment by more than its `maxLateMinutes` is skipped, and `catchUp: "latest"`
  sends only the newest of several overdue steps, which is what stops "in 7 days" going out a
  day before.
- **The tick** (`comms-journeys`, every five minutes, and "run now") reads due enrollments, loads
  their facts live, applies the stop rules, posts each due step under the key
  `j:<journey>:<step>:<enrollmentId>`, and writes when to look next. It returns at once while the
  module is off.
- **Conditions and stop rules** are registered by key (`server/lib/comms/conditions.ts`), one
  query each, and the keys are fixed in `shared/comms/contracts.ts` (`CONDITION_KEYS`,
  `STOP_KEYS`). Facts and merge values come from registered providers and builders
  (`server/lib/comms/journeyRegistry.ts`).
- **No gathering step goes while its time is still being voted.** The steps wait for the lock.
- **The Journeys screen** shows each timeline, turns journeys on and off, edits a step's offset,
  window, audience, words and skip rules, sends a step to yourself, stops one person's journey,
  and walks a real or made-up person through every email they would get and when.

## Gathering emails

`server/lib/comms/eventEmails.ts`, fired through the sink from the RSVP, waitlist and gathering
routes. A yes enrolls `gathering.going`, whose confirmation carries an `.ics` (stable UID,
SEQUENCE from `event_comms.ics_sequence`, `server/lib/comms/ics.ts`) and add-to-calendar links.
Withdrawing stops the journey and sends nothing. Joining the waitlist sends
`gathering.waitlisted`; a seat opening sends `gathering.promoted` and enrolls. A change of time or
place bumps the sequence, sends `gathering.changed` with an updated `.ics` to everyone going, and
re-plans their reminders. Cancelling sends `gathering.cancelled` (METHOD:CANCEL) to everyone
going or waiting, and stops every journey on it. Online gatherings link to `/events/:id/join`,
which redirects to the current room, so a changed room never breaks an old email. "Can't make it"
is a signed link to a confirm page whose POST gives the seat back and serves the waitlist.

Per gathering, anyone holding `event.manage` sets reminders (the village's, its own times, or
none), guests (the village's setting, on or off) and who hosts, kept in `event_comms`.

## Guests

`server/lib/comms/guests.ts`. A guest is somebody with no account. They may say they are coming
when the module is `public`, the gathering's layer is public, it is scheduled, its seat price is
zero, and its guest setting resolves to on. They give a name, an address and their time zone; we
write a pending request whose token only the email holds, and post `gathering.guest_confirm`
(essential and urgent, because they just asked). Nothing else happens until they press it.
Confirming calls the ordinary `rsvp()` inside its row lock, so capacity holds exactly, and the
`guest_confirmed` trigger enrolls them. Requests are limited per network and per address, and the
organiser's list shows a name marked "guest", never the address.

## Attendance, recaps and feedback

The host ticks who came (`event_attendance`, `came` or `missed`, with "everyone who said yes
came" as one button). The composer (`client/src/components/comms/HostRecapPanel.tsx`) takes the
recap, an optional note for people who missed it, and a recording link. With attendance marked,
people who came get `gathering.recap_came` and people who missed it `gathering.recap_missed`;
with none marked, everyone who said yes gets the first, whose words read right either way. Each
recap carries the two questions as signed links and the next gathering with a one-click RSVP.
Answers land in `event_feedback` and show in the host's panel. The host nudge links straight to
the composer; no separate survey email is ever sent.

**"Draft it for me"** builds a draft from facts: the gathering, the date, how many came, and the
host's notes (`server/lib/comms/recaps.ts`). When the platform assistant is configured and the
host wrote notes, the draft route asks it to polish them on the platform's existing assistant
path (`server/lib/comms/recapPolish.ts`, prefetched facts, no tools, twenty an hour per host). A
refusal, a cut-off answer, or words the voice check refuses serve the plain draft. It never
sends: the words go back into the host's box, and a person presses Send (ruling of 2026-09-24).
The automation module's call syntheses carry no link to a gathering, so none is folded in.

## The live time vote

`server/lib/comms/timePolls.ts`, with the pure rules in `shared/comms/timePoll.ts`. Anyone holding
`event.manage` can give a gathering a vote: `once`, two to eight candidate starts, or `weekly`,
candidate weekly slots for a recurring series. Voting is approval voting, changeable while open;
members vote on the gathering page and guests from one-click links.

The gathering's own time follows the leader live, marked "time still being voted", because that
is what Rye asked for. The leader has the most approvals, a tie keeps the current leader, and
with no votes the first option leads. The applied time is the pin when set, else the leader once
it has led for `comms.time_poll_settle_minutes`, else the time last applied. A `once` vote locks
at its close (default: the earliest candidate minus `comms.time_poll_freeze_hours`) and sends
`poll.locked` with an `.ics`; reminders start then. A `weekly` vote stays open, never moves an
occurrence inside the freeze, and sends `poll.moved` once per move. Every move goes through
`updateGathering`, so seat fees, the waitlist and the sink see an ordinary edit. Voter names show
to signed-in members when the poll allows it; the public sees counts. The job is
`comms-time-polls`, every minute, and "run now" drives it.

## Paths (in this release, being built)

`path_enrollments` holds one row per person and path, written when somebody chooses a path at
sign-up or in their profile, when a public form that maps to a path arrives with its box ticked,
and when a housing request (resident), an investor packet request (investor), a Work With Us
proposal (prosperity-creator) or steward interest (steward) arrives. Leaving a path sets
`left_at` and stops the journey.

- **The tick-box** on every public form that feeds a path shows `comms-settings.consentText`.
  Unticked means the acknowledgement only; ticked records a `paths` permission with basis
  `asked` and the form and words as evidence.
- **Each path journey** sends a welcome, a first step (skipped once done), "come meet us" with the
  next public gathering (skipped when they are already coming), stories, and on day 21 a
  hand-off: the check-in, plus a notice to the path's contact person (`comms_path_handoff`)
  naming the person by first name. The contact is `comms-settings.pathContacts`, falling back to
  the path's inbox.
- **Goals stop the journey:** resident, a housing reservation reserved; investor, an agreement
  signed or until that has a writer an investor call accepted; steward, seated in a role;
  prosperity creator, a venture listed or until then the proposal accepted; joining, admitted or
  declined; new members, took part in a Quest or came to a gathering.
- **The investor journey** sends only its welcome and its hand-off until
  `comms-settings.investorWordsReviewed` is set; the Journeys screen says why.
- **Backfill:** members' current paths are recorded with source `backfill` and get no email
  unless an admin chooses "include people already on this path" on the journey.
- **Rung emails**, optional per journey and off by default, say "you reached X, here is the next
  step" when a person's derived rung moves.

## Letters and outcomes (in this release, being built)

Letters are the village's news, sent only to people who said yes. They port ReGen Civics'
Outbound safe send: a confirm token bound to the body's hash, the audience and the count for 15
minutes; an idempotency key and a status claim, so a letter confirmed twice sends once; a
snapshot of the recipients, then one `post()` per recipient as kind `letters`, which asks each
person's permission again at send time. A letter goes now or at a scheduled time, can be
cancelled or rescheduled, and a send that stopped part-way resumes. At most
`comms.letters_per_day` letters a day, 10 minutes apart. Audiences: members with letters yes,
people on a path, a gathering's attendees, and every contact with letters yes; the preview shows
the count and the first few names. The Letters screen writes, previews with the real renderer,
sends a test, confirms, and keeps a history with sent, delivered, bounced, complained and
skipped per letter.

**Outcomes** count, per journey step: sent, delivered, bounced, unsubscribed after, and what
people did next (said yes to a gathering, came, took the path's next step, reached the goal
within 7 days of the step). The Journeys screen shows them. Opens are not tracked.

## Members see it, and may propose a change

Ruling of 2026-09-25: the dials are visible and proposable. The member page (`/village-email`,
`client/src/pages/VillageEmail.tsx`, reached from the Game Mechanics page and the Guides menu
while the module is live) lists every journey with whether it is on, its steps and their timing,
each email rendered with sample data greeting the reader by name, the emails no journey sends,
and the comms dials. It is read-only.

Every item has a "Propose a change" door (`shared/comms/memberView.ts`):

- **A dial the village votes on** links to the Game Mechanics page with the dial named
  (`/game-mechanics?dial=<key>`), the village's existing proposal path for dials
  (`mechanics_proposals`). `POST /api/comms/village/propose` refuses an open dial and answers
  that link, so a dial has one way to be proposed.
- **Everything else** (a journey, one step's timing, an email's words, a founder-held dial)
  becomes a `comms-change` row in `submissions`, which lands in the admin queue with the
  founders' bell.

Proposing changes nothing. Writes stay behind `comms.manage`, or the village's vote for a dial.
The routes are `server/routes/commsMembers.ts`, gated by the module one route at a time.

## Privacy

- Every table holding an address or a person joins erasure (`server/lib/erasure.ts`), the
  profile export, and the retention sweep.
- **Retention** (`server/lib/comms/retention.ts`, Rye's ruling of 2026-10-09): an email's words
  live with its row and are deleted with it, under the one dial `comms.retention_months` (18 by
  default), so whoever runs the village's email can read what was said for as long as the record
  is kept. A row still waiting to go is never deleted. Raw delivery reports are deleted after 30
  days; what they said is already on the rows they were applied to.
- **Essential mail's words are never stored**, whatever the dial says.
- **Erasure** clears a person's words at once, ahead of the dial: it deletes the person's contact, permissions, journeys, path enrollments, guest
  requests, votes, attendance and feedback, and blanks their message rows' address, subject and
  words. It keeps no suppression, because a suppression is the address under another name.
- **Sensitive notices** (restorative intake, conflict) never carry content into an email. They
  link to the app.
- Opens and clicks are not tracked; both dials ship off.

## Testing

- **The fake provider**, `server/testkit/fakeResend.ts`, answers the send, domain and webhook
  calls, records every request, can fail the next N calls with 429, 500 or 422, and delivers
  signed webhooks. It is never imported by server code. E2e suites boot the built server with
  `RESEND_API_BASE` pointed at it, so no test sends a real email.
- **"Run now"** (`POST /api/admin/comms/run` with `drain`, `journeys` or `polls`) drives time in
  the e2e suites, which run with the scheduler off.
- Each lane's e2e suite takes its own port window, chosen through `scripts/check-e2e-ports.mjs`.

## Where it lives

- **The sink.** Domain code tells comms something happened through `server/lib/commsSink.ts` and
  imports nothing under `server/lib/comms/`. `fire()` never throws and never waits; the server
  registers the one handler at boot, from `server/lib/comms/dispatch.ts`, where each part adds
  the triggers it acts on.
- **The post office:** `server/lib/comms/postOffice.ts`, `server/lib/comms/transport.ts`,
  `server/lib/comms/suppressions.ts`, `server/lib/comms/webhook.ts`.
- **People:** `server/lib/comms/contacts.ts`, `server/lib/comms/permissions.ts`,
  `server/lib/comms/preferences.ts`, `server/lib/comms/actions.ts`, `server/lib/comms/backfill.ts`.
- **Words:** `server/lib/comms/render.ts`, `server/lib/comms/templates.ts`.
- **Setup:** `server/lib/comms/settings.ts`, `server/lib/comms/setup.ts`,
  `server/lib/comms/resendAdmin.ts`.
- **Journeys:** `server/lib/comms/journeys.ts`, `server/lib/comms/journeyDefinitions.ts`,
  `server/lib/comms/conditions.ts`, `server/lib/comms/journeyRegistry.ts`,
  `server/lib/comms/journeyFacts.ts`.
- **Gatherings:** `server/lib/comms/eventEmails.ts`, `server/lib/comms/gatheringVars.ts`,
  `server/lib/comms/guests.ts`, `server/lib/comms/attendance.ts`, `server/lib/comms/recaps.ts`,
  `server/lib/comms/recapPolish.ts`, `server/lib/comms/timePolls.ts`, `server/lib/comms/ics.ts`.
- **The member page:** `server/lib/comms/memberView.ts`.
- **Routes.** `server/routes/comms.ts` registers the admin routes (`/api/admin/comms/*`):
  `server/routes/commsSettings.ts`, `server/routes/commsPeople.ts`, `server/routes/commsWords.ts`,
  `server/routes/commsJourneys.ts`, `server/routes/commsSent.ts`. `server/routes/commsPublic.ts`
  registers the public ones (`/api/comms/*`, unsubscribe, preferences and actions never gated)
  and the member page. `server/routes/commsEvents.ts` registers the gathering routes behind the
  events module's gate: `server/routes/commsGatherings.ts`, `server/routes/commsGuests.ts`,
  `server/routes/commsPolls.ts`. `server/routes/commsWebhook.ts` registers before
  `express.json()` for the raw body its signature covers.
- **Tables.** All SQL is in `server/repos/`: `commsMessages.ts`, `commsContacts.ts`,
  `commsPermissions.ts`, `commsSuppressions.ts`, `commsTemplates.ts`, `commsJourneys.ts`,
  `commsPeople.ts`, `commsSettings.ts`, `commsOverview.ts`, `commsEventFacts.ts`,
  `eventComms.ts`, `timePolls.ts`.
- **Admin.** The Comms group in the rail, one screen per file in
  `client/src/components/admin/comms/`: Overview, Journeys, Words, People, Letters, Sent mail,
  Settings. The old `email-settings` key renders Settings, so old links still land.
- **Event-page widgets** in `client/src/components/comms/`: the guest door, the time vote, the
  host's recap panel, attendance, and each gathering's email settings.
