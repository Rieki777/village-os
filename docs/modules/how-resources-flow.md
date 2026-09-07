# Module contract: How Resources Flow

Provenance: platform

> As-built, written with the code it describes (round 4, lane L3, migration 0084).
> Where this file and the code disagree, **the code wins**; fix the file.

**A map of rules, never a wallet: a village declares who may spend what, with whose approval, paid from where, and where the money comes from, drawn as a lens over the power map beside the measured inflows the ledger and the charges table already know. One action, Request approval, opens a forum decision pre-filled from the rule through the existing decision primitive. Nothing in this module debits, credits or settles anything.**

## What it holds

Three tables of declarations, all carrying `is_example`:

- `spending_rules`: scope (a circle or a seat), a ceiling in minor units plus a unit code, who says yes (`none`, `circle-consent`, `lead`, `founders`, `treasury`, `hypha`, `other` with a required note), which pot pays (`treasury`, `circle-budget`, `member`, `grant`, `sponsor`, `other` with a required note), and visibility (`village`, or `holders` of that scope only). Two rows per scope answer the pair "alone" and "with permission".
- `funding_sources`: name, kind (`donations`, `memberships`, `stays`, `grants`, `sales`, `land-or-lease`, `investors`, `other` with a required note), and either a share of the whole or an amount a year. Both amounts absent is a real answer.
- `circle_budgets`: what a circle is given, per season or standing, and SINCE 0181 the row also says WHICH MODEL it runs on. Under `mode = 'cap'`, the original and the default for every row that predates 0181, it is a declared envelope: nothing decrements it, and the two caps (`amount_minor` a season, `cycle_amount_minor` a cycle) are compared against a sum taken over `token_ledger` when somebody asks. Under `mode = 'treasury'` the village mints the circle real tokens up front into `sys:circle:<circleId>`, and the circle keeps whatever it does not spend when the period turns. That difference is deliberate: a cap creates an incentive to spend the whole cap and a treasury creates an incentive to save. A change BETWEEN the two is queued and lands at the next period boundary, so a circle finishes its season on the model it started with (`pending_mode`, `pending_from`). A circle going dormant has its treasury swept to the village's master treasury, or retired through the same account redemption burns to when the village has none, and `dormant_held_minor` records what it held so a steward reviving it can be told; reissuing is a new mint and meets the village's issuance cap.

A unit is an uppercase ISO 4217 code or `token:<slug>` checked against the token registry. Amounts are minor units everywhere, the `ModulePricing` rule.

## What it reads and never writes

The measured side of the picture is SELECT only:

- `fiat_charges`: counts and totals by module and currency, `status = 'paid'`.
- `token_ledger`: counts and totals by token, restricted to the four system accounts (`sys:treasury`, `sys:mint`, `sys:gratitude-pool`, `sys:cycle-pool`). No user ids ride the payload, in any direction.

A unit test reads `server/lib/resources.ts` and holds every INSERT, UPDATE and DELETE to the three declaration tables; an end-to-end test holds the ledger's and the charges table's row counts across the whole surface.

## Tiers

- Admins and declarers (admin, `org.declare`, or a live `represents_circle` seat) read everything. A declarer WRITES only for their own circle: an edit must clear the gate for the row it overwrites, not only the destination it names.
- A member reads `village` rules plus `holders` rules for a seat they hold or a circle they hold a seat in. A rule outside that answers 404, existence hidden.
- A stranger, only while the map's public structure switch is on, reads funding sources as name and kind. No amounts, no rules, no budgets, no measured figures.
- Module off and preview answer the byte-identical 404 every module answers.

`measuredVisibleTo` in the module config narrows the measured strip to admins when a village wants that.

## The one action

`POST /api/resources/requests` validates the ask against the rule: it must name a seat the asker holds, sit at or under the ceiling, carry a purpose, and the rule must actually require an approval. The answer is a pre-fill (category, title, body, `meta.resourcesRequest`) that the client posts ONCE to `POST /api/forum/threads`, the one decision primitive, with the forum composer's own busy guard. The same author asking the same rule and amount again while that decision stays open answers 409 with the open thread's id. The forum's own gates hold unchanged: `proposal.open` to open a decision, the decided-state meta stripped server-side at create.

## The lens

Drawn through the power map's `lenses` seam and the layout's `pad` argument; no map file changes hands. Declared flows are dotted strokes, measured flows are solid, and the key says both words, because a promise and a count are different facts. Sources ring the village, budgets arc from a treasury node to circle centres with stroke width carrying size, seats wear "up to X alone" pills where an approval-free rule applies, and approval marks point at whoever says yes. A currency pair with no exchange rate on file is said in words and shown unconverted: the ECB's daily list carries no CRC, so a colones amount stays a colones amount until an admin records a manual rate.

## Vocabulary and the village's own words

The three vocabularies ship with platform wording and ids that never change. `config.labels` overrides the words by namespaced id (`approval.founders`, `paidFrom.treasury`, `sourceKind.stays`); the admin tab carries the editor. Every list carries `other`, and `other` always arrives with the village's own note.

## Capitals

`shared/capitals.ts` ships from this lane and is read by both this module and the land map: nine capitals (id, short label, formal name, hue) and the land map's nine media keys with their default capital. One vocabulary, two maps, no drift.

## Examples

Standing examples ride the `is_example` machinery: four rules, two sources and one budget, pointing at the map's and progression's example structure, retired by the village's first real declaration through the admin surface. The admin tab's empty state names the three rows that make the map speak first.

## Whether a circle's period can be judged: `GET /api/resources/completion`

A founder ruling: a circle earns a bonus when it finished under its cap AND the village voted that its work was completed. The first half is the burn reading above. This route is the second half and the join, and it pays nothing: it is a GET, it moves no value, opens no ballot and writes no row.

It reports three components and never merges them into a score. A composite would invite the optimisation it exists to avoid, and it would also destroy the information, since a circle that delivered a great deal cheaply and one that delivered little expensively can land on the same number.

- **Commitment.** What the circle recorded it was taking on, and whether that was written down before the period ended or afterwards.
- **Vote.** What the village answered, off the frozen ballot. Never asked, running, withdrawn, quorum missed, said no and said yes are six states and never fewer. Quorum missed is never rendered as a refusal, because silence is not a refusal.
- **Spend.** Where the issuance landed against the cap that binds, taken straight from the burn reading.

The one aggregate is `blocking`, a list of reasons a bonus cannot be considered yet. It can only ever say no, so an empty list is the absence of an objection and never an authorisation. There is no eligibility flag and no amount anywhere in the payload, and a test asserts that over the serialised reading.

### Two gaps this route names instead of hiding

**Nothing records what a circle took on.** Measured across every table of a migrated schema, `circle_budgets` is the only one carrying both a circle and a period, and it holds an amount, a unit and a note. A note is a label on an envelope. So `commitmentFor` is an injected dependency wired to a reader that finds none, the payload carries `noCommitmentStore` saying so in words, and the reading refuses instead of guessing. A completion vote with no written commitment asks the village to agree with a memory.

That gap also explains the key. `ballots.subject_ref` is varchar(64) and a circle id plus a season id is 129 characters, so a ballot cannot name both. The ballot's subject is the commitment RECORD, whose id fits, the way a mechanics ballot names a proposal. A village with nothing written down has nothing for the ballot to point at, so the two gaps are one gap.

**Who votes has not been decided.** `drizzle/0095_governance_prune.sql` removed `ballots.circle_id` because a circle has no roll to build an electorate from: circles are pointed at by permission groups and by org seats, and neither is a list of who votes. So the electorate is a query parameter, the route serves `village` and refuses `circle` with that reason, and `ruling` rides every answer saying the choice is open. A circle voting yes on its own completion to release its own bonus has the shape of a circle voting itself a bigger budget.

### What the reading cannot see

`blindSpot` rides every response and is not conditional. A circle whose work is care, mediation or hosting can leave almost nothing in any of the three components and still have carried the village through the season. A thin record is not evidence of a thin season, and whoever votes has to weigh what they saw.
