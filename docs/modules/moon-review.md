# Module design: moon-review

Provenance: platform

> Registry id `moon-review`. The contract is `shared/moonRecap.ts` (shapes, limits, statuses and their words,
> coverage, invoice lines from terms, the route and payer checks, `endOfMoonFriday`, the approval hash, the work
> summary, and the request and response shapes of every route). Every SQL statement for its tables is in
> `server/repos/moonRecaps.ts`; the schema is `drizzle/0313_a_member_reviews_their_moon.sql`,
> `drizzle/0314_a_member_tags_a_task_to_a_role.sql`, `drizzle/0315_an_approval_can_be_the_members_own.sql`,
> `drizzle/0316_a_member_sets_the_next_moons_goals.sql` and `drizzle/0317_a_moon_keeps_its_rhythm.sql`. The dates are
> `shared/moonRhythm.ts`.

**Once a moon, each member who holds a role gathers what they delivered, checks it against their role cards and
the season goals, does a role audit and sends a recap. When the adopted terms of one of their roles carry money,
they also send the app's draft invoice beside the invoice they issue themselves. One person approves the work and a
different person approves the invoice, neither of them the member, except where a village has granted one of the two
held-back keys below. The platform records money and never moves it.**

## Status

Ships OFF, like every non-core module, and `scripts/enable-all-modules.mjs` holds it: it is member-pii and holds
pay routes and invoices, so a village turns it on for its own team deliberately. `preview` serves admins only; after
launch, `members` takes a `module.switch` holder or a vote.

## What it never carries

- **Hours.** Pay is for approved deliverables. No column, line or payload holds a duration. `member_tasks.minutes`
  and a role's CCOS time commitment are never read.
- **Quests.** Quest claims never become items or invoice lines.
- **Bank or card details.** The invoice says payment goes to the account the member has on file with Finance. A
  change of bank account records only its date and the role that confirmed it.
- **A tax id or a document number.** A pay route stores the status expiry date and the tax form's kind and dates.

## The flow for one moon

1. The member keeps their tasks on the profile through the moon, tagged to a role and a season goal where they like
   (`member_tasks.role_id`, `member_tasks.serves_goal_id`).
2. By the end-of-moon Friday (`endOfMoonFriday`, the prepare-by day: the last Friday on or before the moon's last day,
   in village time) they open My moon, bring in their tasks, ask Sera, keep and tag items, mark each task Done, Partly,
   Carry, Let go or Redirect, score last moon's goals, set three to five for the next, and do the role audit. They send
   by the circle Monday (`sendBy`, `circleMonday` in `shared/moonRhythm.ts`): the first Monday after the end-of-moon
   Friday, which is the last Friday before the closing new moon's civil date. A village can move either day for one
   cycle in the `moon_rhythm` document.
3. They send the recap. It needs no pay route.
4. If a role's terms carry money, they issue their own invoice (by email, through the electronic invoice system, or
   however they invoice today) and send the app's draft for approval with that invoice's number, the moon attestation
   and the pilot acknowledgement. On the contractor route the electronic invoice key goes with it. The draft is a
   support document and never the legal invoice. The payer's record is a separate bill ref.
5. A `moon.approve` holder approves the work, or returns items with a note naming what is missing.
6. A `cash.pay` holder approves the invoice, singly or in bulk (`POST /api/moon-review/invoices/approve`). Approval
   writes one claimed `cash_owed` row per line. If Finance changes a range amount, the invoice goes back to the member,
   who voids and reissues their own invoice and sends it again with its new number.
7. Finance pays outside the platform.
8. Finance records the transfer on the existing `POST /api/cash-owed/transfers`. When every row an invoice wrote is
   paid, the invoice reads Paid and the member reads "Your pay is sent on" the date.

## The rules the contract holds

- **Who approves.** `approvalDecision` is the one rule. By default two people, neither of them the member. A holder
  of `moon.approve_alone` (granted once to the founders' and stewards' power groups) may give both approvals alone,
  never on their own recap. A holder of `moon.approve_own` (granted once to the Treasury power group, an interim
  step) may approve their own recap and invoice, and every such approval carries `self_approved`, read as "Approved
  by the member themselves" on the invoice, in the events and on the payouts desk for review after the fact. Keys come
  from the roles a member is seated in, so an admin, a break-glass or a badge never passes an approval. The SQL holds the same line
  unless the caller passes the widening the rule granted. `workApproverFor` is the one function a later circle lead
  rule changes.
- **One line per application.** An application covers one to five roles and records its pay once
  (`linesFromTerms`). Monthly terms prorate as amount x 12 / 365.25 x days; part of a moon prorates by days held.
- **Lock and hash.** Sending locks the recap. Each approval binds to `approvalHash`; any change clears both.
- **Payer authority is a note**, never a refusal (`authorityNote`).
- **Who reads what.** Members read sent, kept items marked Members (`memberView`); an Approvers only item shows as
  "1 item held privately". Amounts, routes, legal details and invoices are for the member and `cash.pay` holders.

## The score (decision 20)

- **Task score** (`taskScore`): (Done + half of Partly) over (Done + Partly + Carry), stored at send in half-points.
  Only tasks set this moon count; a task set in the final seven days counts only when Done. Let go (which needs a
  reason) and Redirect (which names who it belongs to) are left out.
- **Role coverage** (`seatCoverage`): the share of the member's role accountabilities with a kept item. Outside my
  roles work counts toward season goals and never here; it feeds the role audit (`outsideRolesAudit`), where two or
  more items under a role nobody holds raise a Fill signal.
- **Goals** (`goalScore`, `moon_goals`): the same formula over the member's moon goals. Partly and Carry roll into the
  next moon with one more carry; a goal carried twice is flagged for the circle.
- **Closing the loop in Sera** (`seraClosures`): once the work is approved, each item Sera sent that the member marked
  Done or Let go closes through the feedback outbox, and each Redirect goes with its words. Only tasks Sera sent.

## The deep dive and the moon pack (spec section 17, A1 to A4)

- **Deep-dive items** (origin `claude`) carry their proof's kind (`sera`, `artifact`, `mail`, `notes`, `drive`, `file`,
  `build`) and date, and for Outside my roles work the role it belongs to in words. Another member never reads a
  mail, notes, drive or file link. An imported item starts Approvers only. Built-but-not-live work imports as Partly.
- **The moon pack** (`validatePack`): a strict v1 document from the member's own Claude, previewed (add, merge, skip,
  each skip with its reason) and then written only when the confirm carries the preview's hash. A pack is refused
  whole when it names any money, rate or tax key at any depth, any field it does not have, more than 300 items or
  five next goals, or another moon's dates. A Sera task the recap already holds merges into that item.
- **One Sera key** (`seraCloseKey`): `moon:<moon start>:<sera task id>`, with the reason codes the skill sends
  (`already_done`, `not_a_task`, `not_mine`), so a task closed from either side lands once.
- **Reading the score** (`readingOf`, `seatReadingOf`): a band, its sentence and context lines, compared on
  half-points. Two guards: when more than a third of the tasks set were let go or redirected and the score is 60% or
  more, the reading stops at Steady with its own line, the number unchanged; when the score is under 60% and Outside my
  roles items number at least the larger of 3 and Done, it reads "Covering an empty role". The score never sets pay
  and is never ranked.
- **Thanks** (`parseThanks`, `moon_recaps.thanks_json`): who helped, up to ten, each a member or a named person with a
  short note that shows to other members only when the member chooses. The recap text carries a THANK YOU section. A
  thanked member is told once per recap. Gratitude moves only when the member sends it through the gratitude flow.
- **Reminders** (`moon_nudges`): one row per member, cycle and kind (`eom_prep` on the last Wednesday before the
  walkthrough day, `eom_day` on the walkthrough day, `halfway` at the full moon); the insert is the claim. A moon is
  named by the month of its full moon (`moonName`).

## Nothing village-specific in code (decision 22)

Every value one village decides is data with an admin editor on the Cash payouts desk, edited by `cash.pay` holders,
and every change writes a `moon_review_events` row with old and new values:

- **Payers** (`payers` in `app_config`, `PUT /api/moon-review/payers`): legal name, address, tax number, country,
  currencies, invoicing on or off, the authority note, `invoiceTo` and `invoiceCc`, and the routes each payer pays.
- **Settings** (`moon-review-settings` in `app_config`, `PUT /api/moon-review/settings`): the host country (code and
  name), its VAT rate, its exchange-rate source and its currency, the tax forms kept on file, the routes that need one,
  the hold rules, and the pilot acknowledgement with its version. A new version asks every member to accept again.
  The attestation and the route words are templates filled from these.
- **The moon rhythm** (`moon_rhythm` in `app_config`): a moved walkthrough or circle day for any one cycle
  (`{cycleId: {walkthrough, circle}}`), the hour reminders go out, and `guideUrl`, the village's own End of Moon guide
  (https only). Empty by default: with no guide set, no guide link shows anywhere.

What stays in code: the closed list of route kinds (`pending`, `abroad`, `nomad`, `local_contractor`,
`local_employee`, `visitor`), the status words, the scoring rules and the safety checks. Defaults ship empty: until a
payer, the host country and the acknowledgement are filled in, an invoice is refused with "Name who you pay first", and
a recap still sends.

## Setup

- An admin creates a power group carrying `moon.approve` and seats someone in it to approve the work. Capabilities live on
  power groups, never on org-chart roles. `moon.approve`, `moon.approve_alone` and `moon.approve_own` are not
  transferable and not badge-grantable, and a warning badge may pause each. The two widening keys are granted once at
  boot (`grantMoonReviewKeys` in `server/lib/starterRoles.ts`, in TypeScript because appending to the JSON
  capabilities column needs a SQL function production has never run), so a village that takes one off a group keeps
  it off.
- Someone holds `cash.pay` (the Treasury role, and the founding stewards at launch).
- The `payers` and `moon-review-settings` documents are filled on the Cash payouts desk (see
  `docs/FORK_RUNBOOK.md`). Entity, country, tax and rate names live there and nowhere in code.
- Roles paid through this flow carry no `org_roles.cash_minor`, so the hourly settlement never owes them.

## Erasure and export

Erasure clears `member_pay_routes`, the From block, the attestation, item text and evidence, the member's own
words, notes, the role audit and the item text inside invoice lines. Amounts, dates, numbers, bill refs and
`moon_review_events` rows stay, as `cash_owed` keeps them.
