-- 0169: a settled cycle records which clock it was played on.
--
-- The founder reopened the rhythm setting on 2026-09-02 ("Yes the cycle
-- structure can be changed"), so a village can move from lunations to
-- calendar months. Everything about that switch turns on one promise: every
-- cycle closed before it keeps the id and the bounds it closed under.
--
-- The id already carries the clock (lunar-000330 against month-2026-09), and
-- the cycle number does too, because calendar numbers start at a million.
-- This column says the same thing in a word, for the human reading the table
-- and for any query that wants to group a village's history by the rhythm it
-- was living. A fact that can only be recovered by parsing a string is a fact
-- that gets parsed wrong once.
--
-- NOT NULL WITH A DEFAULT, and that is safe here for a reason worth stating.
-- The house rule is that a column DEFAULT never applies to a `dbCollection`
-- write, because those name every spec'd column and send an explicit NULL for
-- anything the caller left out. `gratitude_cycles` is not written that way:
-- `gratitudeCyclesRepo.upsert` is a hand-written INSERT naming its columns, so
-- a release that predates this column simply does not name it and the default
-- applies. Rolling back to that release keeps working.
--
-- 'lunar' is the right default for every existing row because lunar is the
-- only clock any village has ever run. `0108` retired the dial that offered
-- the other one before anything read it, and `0105` decided the older
-- `YYYY-MM` rows are never remapped.

ALTER TABLE `gratitude_cycles`
  ADD COLUMN `clock` VARCHAR(16) NOT NULL DEFAULT 'lunar';
