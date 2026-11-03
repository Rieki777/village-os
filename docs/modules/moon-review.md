# Module design: moon-review

Provenance: platform

> Registry id `moon-review`. The contract is `shared/moonRecap.ts` (shapes, limits, statuses and their words,
> coverage, invoice lines from terms, the route and payer checks, `endOfMoonFriday`, the approval hash, the work
> summary, and the request and response shapes of every route). Every SQL statement for its tables is in
> `server/repos/moonRecaps.ts`; the schema is `drizzle/0313_a_member_reviews_their_moon.sql` and
> `drizzle/0314_a_member_tags_a_task_to_a_role.sql`.

**Once a moon, each member who holds a role gathers what they delivered, checks it against their role cards and
the season goals, does a role audit and sends a recap. When the adopted terms of one of their roles carry money,
they also send a draft invoice. One person approves the work and a different person approves the invoice, neither
of them the member. The platform records money and never moves it.**

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
2. On the end-of-moon Friday (`endOfMoonFriday`: the last Friday on or before the moon's last day, in village time),
   or by Sunday, they open My moon, bring in their tasks, ask Sera, keep and tag items, and do the role audit.
3. They send the recap. It needs no pay route.
4. If a role's terms carry money, they send the draft invoice with the moon attestation and the pilot
   acknowledgement. Its number comes from the member's own sequence; the payer's record is a separate bill ref.
5. A `moon.approve` holder approves the work, or returns items with a note naming what is missing.
6. A `cash.pay` holder approves the invoice, singly or in bulk (`POST /api/moon-review/invoices/approve`). Approval
   writes one claimed `cash_owed` row per line.
7. Finance sends the invoice with its work summary to the payer and pays outside the platform.
8. Finance records the transfer on the existing `POST /api/cash-owed/transfers`. When every row an invoice wrote is
   paid, the invoice reads Paid and the member reads "Your pay is sent on" the date.

## The rules the contract holds

- **Two people, neither of them the member.** `approvalPersonRefusal` compares user ids, so an admin or a
  break-glass never passes either approval. `workApproverFor` is the one function a later circle lead rule changes.
- **One line per application.** An application covers one to five roles and records its pay once
  (`linesFromTerms`). Monthly terms prorate as amount x 12 / 365.25 x days; part of a moon prorates by days held.
- **Lock and hash.** Sending locks the recap. Each approval binds to `approvalHash`; any change clears both.
- **Payer authority is a note**, never a refusal (`authorityNote`).
- **Who reads what.** Members read sent, kept items marked Members (`memberView`); an Approvers only item shows as
  "1 item held privately". Amounts, routes, legal details and invoices are for the member and `cash.pay` holders.

## Setup

- An admin creates a power group carrying `moon.approve` and seats someone in it to approve the work. Capabilities live on
  power groups, never on org-chart roles. `moon.approve` is not transferable and not badge-grantable, and a
  warning badge may pause it.
- Someone holds `cash.pay` (the Treasury role, and the founding stewards at launch).
- The `payers` document in `app_config` is filled through `PUT /api/moon-review/payers` (see
  `docs/FORK_RUNBOOK.md`). Entity names live there and nowhere in code.
- Roles paid through this flow carry no `org_roles.cash_minor`, so the hourly settlement never owes them.

## Erasure and export

Erasure clears `member_pay_routes`, the From block, the attestation, item text and evidence, the member's own
words, notes, the role audit and the item text inside invoice lines. Amounts, dates, numbers, bill refs and
`moon_review_events` rows stay, as `cash_owed` keeps them.
