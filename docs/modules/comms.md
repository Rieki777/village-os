# Module design: comms

Provenance: platform

> Registry id `comms`, catalogue name Village Comms. Built 2026-10-02 from the plan Rye approved
> that day. The build spec every lane works from is kept in the maintainers' private operations
> repository, and code comments cite its sections as "the comms build spec". The schema is
> `drizzle/0228_every_email_is_recorded_before_it_is_sent.sql`,
> `drizzle/0229_a_gathering_asks_when_and_remembers_who_came.sql` and
> `drizzle/0230_a_path_remembers_who_walks_it.sql`.

**Every email the village sends passes through one post office, is recorded before it goes, and
reaches only people who agreed to that kind of email. The automations that write those emails
live in this module, and the module ships off.**

This is the skeleton. The lanes that build each part complete it.

## What it is

One post office, one address book with permissions, words a village can edit, and one journey
engine that runs both event emails and path emails. On top of those: guest RSVPs, attendance and
recaps, a live vote on a session time, and letters to the people who asked for them. A Comms
section in Admin holds every part, including everything a founder has to supply.

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
- **The delivery-report webhook.** The provider's reports of delivered, bounced and complained
  are stored and applied once each, whatever else is switched off. A permanent bounce or a
  complaint puts the address on the suppression list.
- **Member notices.** The notification spine's emails follow each member's own preferences
  exactly as they did before this module existed.

## What ships off

Every journey, guest RSVPs, time-vote emails and letters. With the module off, nothing enrolls
and nothing automated is sent.

| Lifecycle | What happens |
|---|---|
| `off` | No journey enrolls or sends. Guest RSVPs, time-vote emails and letters are off. The plumbing above runs. |
| `preview` | Rehearsal. Everything runs, and every email of kind `events`, `paths` or `letters` goes to the rehearsal inbox instead of the person, marked with who it would have reached. Essential mail and notices still reach the real person. |
| `members` | Live. |
| `public` | Live, and guests with no account may say they are coming to a public gathering. |

Each journey also ships off inside the module: a village turns each one on by itself.

## Who runs it

`comms.manage`, a power the village can hand to a role and hold: turning automations on and
off, changing their words, and sending letters to people who agreed to get them. The provider
key, the sending domain and the sender stay with the admin in the secrets plane.

## Setup

`setup: "required"`. A village supplies its own provider key, a verified sending domain, a
sender on that domain, delivery reports and a postal address for the footer, then sends itself a
test, all in Comms Settings. Until then the module reads as not ready.

## Where it lives

- **The sink.** Domain code tells comms something happened through `server/lib/commsSink.ts` and
  imports nothing under `server/lib/comms/`. `fire()` never throws and never waits; the server
  registers the one handler at boot, from `server/lib/comms/dispatch.ts`, where each lane adds the
  cases it acts on.
- **The post office.** `server/lib/comms/postOffice.ts` writes the ledger row, then sends.
  Essential mail is always sent inside the request that asked for it, its words are never stored
  (most of it carries a link that acts for the person), and a ledger fault never stops it going.
  The old mailer keeps its names in `server/lib/comms/mailer.ts`, as a thin call to the post
  office.
- **The one door out.** `server/lib/comms/transport.ts` is the only code that calls the email
  provider. `RESEND_API_BASE` points it at the fake provider in tests
  (`server/testkit/fakeResend.ts`), and `scripts/check-one-mail-door.mjs` fails CI on any other
  file that names the provider, imports a mail SDK, posts to its send path or speaks SMTP.
- **The drain.** `drain()` in `server/lib/comms/postOffice.ts` sends what is queued, on the
  `comms-post-office` job and on "run now". Each row is claimed by one drain, asked every
  question again (suppression, permission, Pause all, the daily cap, rehearsal), and retried at
  1 minute, 5, 30, 2 hours and 6 hours before it is marked failed.
- **The suppression list.** `server/lib/comms/suppressions.ts`. One row per address, holding the
  strongest reason it was given; lifting a complaint asks for a reason.
- **Sent mail.** `server/routes/commsSent.ts` lists and opens the record, tries a failed email
  again and cancels a queued one.
- **Signed links.** `server/lib/comms/links.ts` signs every one-click link under a key of its own,
  ids only, and nothing acts on a GET.
- **Delivery reports.** `server/routes/commsWebhook.ts` registers before `express.json()`, proves
  each report with `server/lib/comms/webhook.ts`, stores it once, and applies it to the email it
  names, found by the provider's id or the `msg` tag and never by address.
- **Journeys.** `server/lib/comms/journeys.ts` enrolls, stops and touches; the defaults it plans
  from are `shared/comms/defaults/journeys.ts`.
- **Routes.** `server/routes/comms.ts` (Admin, gated per route, never wholesale),
  `server/routes/commsPublic.ts` (unsubscribe and preferences, never gated) and
  `server/routes/commsEvents.ts` (on one gathering, behind the events module's gate).
- **Admin.** The Comms group in the rail, one screen per file in
  `client/src/components/admin/comms/`. Settings and Sent mail show whatever the module says.
- **Tables.** All SQL is in `server/repos/commsMessages.ts`, `server/repos/commsContacts.ts`,
  `server/repos/commsSuppressions.ts` and `server/repos/commsJourneys.ts`.
