-- 0178: the training rung becomes a record the SERVER owns.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- `POST /api/game/journey/sync` stored whatever list of step ids a member sent
-- and `trainingComplete` then asked only whether every real module id appeared
-- in that list. So a member advanced their own stage by posting a list.
--
-- The ids were never secret and could not be: `GET /api/training-modules` takes
-- no authentication at all, by design, because the training page is public. So
-- the whole exploit was one public request to read the ids and one authenticated
-- request to post them back.
--
-- Rye, 2026-09-06, asked which this rung is: "make it a real gate the server
-- owns". This is that.
--
-- ── WHAT THE SERVER CAN HONESTLY OWN ────────────────────────────────────────
--
-- Not that a member read anything. Nothing on a server can know that, and a
-- design that claimed to would be lying in a new place. What it can own, and
-- now does:
--
--   the SET of modules that exist, so an invented id is refused;
--   the INSTANT each completion was recorded, stamped here and never sent;
--   that completions arrive ONE AT A TIME, so there is no bulk self-promotion;
--   that the record is APPEND-ONLY, so nothing rewrites a member's history.
--
-- The member still says "I have done this one". That is inherent to any
-- mark-as-read flow and is not what was wrong. What was wrong was that they
-- said it about ALL of them, in one request, in a field they could overwrite.
--
-- ── NOTHING IS BACKFILLED, DELIBERATELY ─────────────────────────────────────
--
-- `users.journeys.training` holds exactly the self-asserted values this table
-- exists to stop trusting. Copying them in would seed the trusted store from
-- the untrusted one on its first day, and every row would carry a
-- `completed_at` the server invented for an event it never saw. A member
-- re-marks their modules, which costs them a few clicks and is the only way the
-- first row in this table means what the column says.
--
-- `users.journeys` itself is untouched: other journeys are client-side progress
-- that gates nothing, and they keep working. Only `training` moved, because only
-- `training` was load-bearing.

CREATE TABLE IF NOT EXISTS `training_completions` (
  `user_id` varchar(64) NOT NULL,
  `module_id` varchar(64) NOT NULL,
  -- Stamped by the server on insert, never accepted from a caller. A UTC
  -- instant written by the application, like every other instant this codebase
  -- writes, and never `NOW()`: the database's local time and Node's UTC differ
  -- by the server's offset, and mixing them is a defect this repository has
  -- already paid for once in the governance landing loop.
  `completed_at` datetime NOT NULL,
  -- The pair is the key, which makes the insert idempotent: marking the same
  -- module twice is one row and not a second claim.
  PRIMARY KEY (`user_id`, `module_id`),
  KEY `training_completions_user_idx` (`user_id`)
);
