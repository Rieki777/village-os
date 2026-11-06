# Module design: funding-rounds

Provenance: platform

> Registry id `funding-rounds`. The count is `shared/equalShares.ts`; the stages and the idea shape are
> `shared/fundingRounds.ts`. Routes in `server/routes/fundingRounds.ts`; the rules in
> `server/lib/fundingRounds.ts`; every statement in `server/repos/fundingRounds.ts`; the schema in
> `drizzle/0333_the_village_chooses_which_quests_to_fund.sql`.

**The village chooses together which quests the season funds, within a pot. Members share rough ideas, shape
them into quests, and tick every one they would fund. The count runs two ways on the same ticks: by Voice, and
by one member, one vote. Where the two differ, the village sees it. Funded quests hold an earmark on the pot and
are paid only when their work is done.**

## Status

Ships OFF, like every non-core module. An admin, or a holder of `module.switch`, turns it on.

Built so far:
- **S1:** the count (`shared/equalShares.ts`).
- **S2, this release:** pots, rounds and the seed stage. Members share ideas, named or without a name by their
  own tick, and each idea opens a forum discussion thread when the forum is on for members.

Not built yet: the grow, choose and harvest doors (S3), the counted-Voice guardrails (S4), and the Treasurer's
season board (S5). A round's stage is already derived from its dates, so a round whose grow date is not set
stays in seed for as long as the pot's holder leaves it that way.

Rulings it follows (Rye, 2026-11-06, relayed by the master coordinator):
- A pot is a power held by the Treasurer by default: `pot.steward`, granted to the seeded Treasury role.
- Choosing is earmarking. Money is sent only when a quest is completed, so nothing is paid in advance and
  nothing ever returns. An earmark is held, owed, paid or released.
- Anonymous or named is the submitter's tick.
- No tokens for voting or posting. Every interaction is recorded, privacy-aware, to found later rewards.
- Ticks are shown with names when a round closes.
- Each village chooses its clock: lunar, seasonal or fixed days.

## The stages

| Stage | Opens at | What happens |
|---|---|---|
| seed | `seed_at` | Members share rough ideas. |
| grow | `grow_at` | The proposer shapes an idea into a quest: deliverable, price, rubric check. (S3) |
| choose | `choose_at` | Members tick every quest they would fund. Ticks are hidden until close. (S3) |
| harvest | `harvest_at` | Both counts run. Funded ideas become quests holding an earmark. (S3) |

A later date that is NULL holds the round in the stage before it.

## Setup

Seat someone in the Treasury role (or another role carrying `pot.steward`). They open a pot (its unit is a
currency code such as CRC, or any registered token id) and a round on it.

## Privacy and erasure

- An anonymous idea's author is stored and never sent. Every idea leaves the server through `ideaView`, whose
  byline is "a member". Its forum thread is posted under the account that opened the round, with a line saying
  so.
- `interaction_events` holds references, never content. An anonymous idea's author's rows are `private`.
- Erasure deletes a member's private interaction rows and de-attributes the rest; deletes their ticks; deletes
  their ideas still in seed; and keeps ideas already on a round's record, shown as "a member".
- The member export includes their ideas, anonymous ones too, and their interaction rows.

## Turning it off

While a round is past seed and not closed, the module stays on (`openStateCheck`). Off deletes nothing:
pots, rounds, ideas and the record stay, and funded quests stay on the quest board.
