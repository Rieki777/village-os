# Module contract: How Resources Flow

<!-- describes: server/lib/resources.ts shared/capitals.ts -->

Provenance: platform

> As-built, written with the code it describes (round 4, lane L3, migration 0084).
> Where this file and the code disagree, **the code wins**; fix the file.

**A map of rules, never a wallet: a village declares who may spend what, with whose approval, paid from where, and where the money comes from, drawn as a lens over the power map beside the measured inflows the ledger and the charges table already know. One action, Request approval, opens a forum decision pre-filled from the rule through the existing decision primitive. Nothing in this module debits, credits or settles anything.**

## What it holds

Three tables of declarations, all carrying `is_example`:

- `spending_rules`: scope (a circle or a seat), a ceiling in minor units plus a unit code, who says yes (`none`, `circle-consent`, `lead`, `founders`, `treasury`, `hypha`, `other` with a required note), which pot pays (`treasury`, `circle-budget`, `member`, `grant`, `sponsor`, `other` with a required note), and visibility (`village`, or `holders` of that scope only). Two rows per scope answer the pair "alone" and "with permission".
- `funding_sources`: name, kind (`donations`, `memberships`, `stays`, `grants`, `sales`, `land-or-lease`, `investors`, `other` with a required note), and either a share of the whole or an amount a year. Both amounts absent is a real answer.
- `circle_budgets`: a declared envelope per circle, per season or standing. Nothing decrements it; a budget is a story about intent, never a balance.

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
