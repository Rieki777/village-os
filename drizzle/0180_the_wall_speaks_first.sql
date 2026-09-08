-- 0180: anonymous voices for the top of the Gratitude wall.
--
-- WHY THIS IS NOT gratitude_log, WHICH IS THE WHOLE DESIGN
--
-- The wall opens with gratitude itself rather than with a form, and a village
-- with no sends yet needs something true to open with. Every other module
-- solves that with standing examples (docs/STANDING_EXAMPLES.md). Gratitude is
-- one of the two that deliberately seed nothing, and server/lib/examples.ts
-- says why in one line: a gratitude row posts to the ledger at creation, so an
-- example send would either mint real recognition or break conservation.
--
-- That is not a style objection. Boot invariants enforce SUM(balance) over all
-- accounts equals zero and fail LOUD, so seeding gratitude_log would stop a
-- village starting.
--
-- An anonymous voice has no sender, no recipient and no amount, so it is not a
-- send. It never touches the ledger and conservation holds trivially. This
-- table is display-only by construction: there is nowhere in it to record who
-- gave what to whom, and that absence is the safety property. Nothing here can
-- ever be settled, reversed, or counted toward a pool split, because none of
-- those operations have anything to read.
--
-- A NEW TABLE IS THE SAFE HALF OF EXPAND-NEVER-CONTRACT
--
-- Nothing is dropped, no type narrows, no existing column becomes NOT NULL and
-- no unique key lands on an existing table. The previous release does not know
-- this table exists and never queries it, so rolling back over this migration
-- costs a village nothing but the hero it had not had before.
--
-- HOW IT RETIRES, AND WHY NO NEW TRIGGER WAS NEEDED
--
-- `is_example` puts these rows under the standing-examples engine, so
-- `gratitude` joins EXAMPLE_TABLES and behaves like every other module: the
-- ExamplesBanner appears while they stand, Admin -> Modules -> Clear examples
-- removes them, and the first real acknowledgement retires them for good.
--
-- The trigger was already there and already firing. server/index.ts has called
-- onRealItemPublished(getPool(), "gratitude", user.id) on every send since the
-- examples engine shipped, and it has retired exactly nothing this whole time
-- because the module seeded no rows. This migration gives that call something
-- to do.
--
-- WHY sort_order AND NOT created_at
--
-- The set is composed, not chronological. It spans the kinds of care a village
-- runs on, and the order they are read in is a choice about what a founder
-- meets first. Timestamps would sort them by the accident of insert order.

CREATE TABLE IF NOT EXISTS `gratitude_voices` (
  `id` varchar(64) NOT NULL,
  `message` text NOT NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  `is_example` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `gratitude_voices_example_order` (`is_example`, `sort_order`)
);
