-- 0187: what one member says they need, and how they are doing on it. (R20; lane N4)
--
-- R20, the founder's words: "Part of a profile onboarding is asking players to
-- identify the depth and breadth of the needs they intend to meet - and a
-- 'anonymous complaint board' for when needs go unmet they can report it to a
-- shared database for us to evolve our game from. So this way we have the
-- target (what we aggregate as all the needs we're wanting to meet together)
-- and we have Realtime feedback for when we're failing to do so."
--
-- 0186 carries the TARGET: `village_needs` is what the village said it is for.
-- This file carries the OTHER half: one row per member per need per moon,
-- saying where that member actually is. The village never reads a row. It
-- reads counts, and only above a floor.
--
-- THE ROW IS A CONFESSION ABOUT SOMEBODY'S LIFE. "Deprived" on Love is not a
-- rating, it is a person saying they are lonely, filed under their user id in
-- a village of thirteen. Every decision below follows from that one sentence.
--
-- WHY `visibility` IS AN ENUM OF EXACTLY ONE VALUE. The design (A.1.4) draws
-- it as enum('private','stewards','village'), on the reasoning that a member
-- may raise their own row. Nobody has built the screen that would ask, nobody
-- has decided what a steward sees when a row is raised, and an enum admits
-- whatever a future caller passes. So this release ships the column with one
-- legal value and the database itself refuses the rest. A later release ADDS a
-- value, which the expand-never-contract rule allows; removing one is what it
-- forbids, and shipping three today would have meant asking the village to
-- live with a door nobody had specified. The route refuses a non-private
-- value by name before the write, so a client gets a sentence and the column
-- is the second line of defence rather than the only one.
--
-- WHY THE COLUMN EXISTS AT ALL rather than being implied: a table with no
-- visibility column has to grow one later on an existing table, and the
-- previous release then writes an explicit NULL into it (see the dbCollection
-- trap in CLAUDE.md). Shipping the column now, NOT NULL with a default and one
-- legal value, is the safe half of the same decision.
--
-- NO FOREIGN KEYS. This schema has zero of them on purpose, the same as 0186.
-- `user_id` is reconciled by the tombstone path, not by the database: exit
-- resolve calls `anonymizeMember`, and `forgetMemberNeeds` in
-- server/lib/needs.ts is what that path calls to take these rows with it.
--
-- WHY `cycle_id` IS ON THE ROW. Every figure in this build is attributed by a
-- write-time cycle stamp, for the reason stated at server/lib/health.ts. An
-- answer about how somebody is doing is exactly that kind of fact: it is true
-- of one moon and it is not true of the next one. The string is spelled by
-- `cycleIdFor` (server/lib/gratitude-cycles.ts), which that file's own header
-- calls the only function allowed to make one. A second formatter in this
-- column is the whole of the defect that header describes.
--
-- WHY `note` IS varchar(500) AND NOT text. Strict MySQL does not truncate an
-- over-long field, it REFUSES THE ROW, so a member typing a long paragraph
-- would lose the whole answer and be told nothing useful. A bounded width the
-- store clips to (and the textarea's own maxLength) makes the limit visible on
-- both sides. 500 characters is a paragraph, and this is a card and not a
-- journal.

CREATE TABLE IF NOT EXISTS `member_needs` (
  `id` varchar(64) NOT NULL,
  -- The member. NEVER joined against in a read that leaves this village, and
  -- never returned by any route to anybody but its owner.
  `user_id` varchar(64) NOT NULL,
  -- A `HUMAN_NEEDS` id from shared/needs.ts, or `custom:<slug>`. A member may
  -- answer on a need this village has NOT taken on: what the village is for
  -- and what one person needs are different questions, and forcing the second
  -- to be a subset of the first is how a village learns nothing.
  `need_key` varchar(64) NOT NULL,
  -- Where this member says they are, on the deck's own ladder. Same five rungs
  -- and same order as `village_needs.depth_target`, so "at or above the
  -- target" is one comparison and never a translation.
  `depth` enum('deprived','unmet','alive','satisfied','thriving') NOT NULL,
  -- The "I feel ____" half of the deck's card, in the member's own word.
  `feeling` varchar(64) NULL,
  -- The rest of the sentence, when they want to say more. Clipped by the store
  -- to this width before the insert, never by MySQL after it.
  `note` varchar(500) NULL,
  -- One legal value this release. See the header.
  `visibility` enum('private') NOT NULL DEFAULT 'private',
  -- The lunation this answer belongs to, spelled `lunar-000329`.
  `cycle_id` varchar(64) NOT NULL,
  `recorded_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- ONE ANSWER PER MEMBER PER NEED PER MOON. All three columns are NOT NULL,
  -- because MySQL unique indexes exempt NULLs and a nullable column in a
  -- dedupe key admits unlimited duplicates.
  --
  -- This key is also the index on user id: MySQL uses a composite key's
  -- leftmost prefix for `WHERE user_id = ?`, which is every read a member
  -- makes of their own card and the delete the tombstone runs. A second index
  -- on that one column would be written on every insert and read by nothing.
  UNIQUE KEY `member_needs_uq` (`user_id`, `need_key`, `cycle_id`),
  -- The aggregate's own question: for one need in one moon, how many members
  -- are at each rung. Covering, so the count never touches a row.
  KEY `member_needs_need_idx` (`need_key`, `cycle_id`, `depth`)
);
