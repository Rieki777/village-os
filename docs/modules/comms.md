# Module design: comms

Provenance: platform

> Registry id `comms`, catalogue name Village Comms. Built 2026-10-02 from the plan Rye approved
> that day; `docs/comms/BUILD_SPEC.md` is the build spec every lane works from. The schema is
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
  are stored once each, whatever else is switched off.
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
