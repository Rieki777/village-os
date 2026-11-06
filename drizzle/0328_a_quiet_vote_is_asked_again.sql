-- 0328: a vote too few of us answered is asked again, once, at half the bar.
--
-- Rye, 2026-11-06, answering the quorum fallback note: a village with no
-- stewards decides everything by ballot, and a ballot that misses quorum
-- simply ends. A village quiet for a season could then decide nothing at all.
-- So a village may turn on `governance.quorum_fallback`: a ballot that misses
-- quorum is re-run once, on the same subject, at half its quorum; a re-run
-- that misses too is decided by a simple majority of the votes cast.
--
-- WHY A NEW, LINKED BALLOT AND NOT THE SAME ONE REOPENED. Every ballot freezes
-- its dials when it opens (the snapshot law, server/lib/ballots.ts), so
-- lowering `quorum_pct` on a live ballot would change the rules mid-vote. The
-- re-run is its own ballot with its own frozen dials, and `rerun_of` names the
-- first ballot it follows.
--
-- WHY THE DIAL IS FROZEN ONTO THE ROW. A ballot opened before the village
-- turned the fallback on must never re-run, for the same snapshot reason: the
-- electorate was asked under the rules of the day it opened.
--
-- EXPAND, NEVER CONTRACT. Two new columns on a populated table:
--
--   `rerun_of`         nullable, NULL on every first ballot and every ballot
--                      opened before this release, which is the honest value.
--   `quorum_fallback`  NOT NULL DEFAULT 0. The previous release inserts an
--                      explicit column list on this table that does not name
--                      it, so a ballot that release opens gets the default,
--                      and 0 is OFF. Rolling back is safe: the old code never
--                      re-runs anything, and every row it writes says so.
--
-- The new status `no_quorum_rerun` needs no DDL: `ballots.status` is
-- varchar(16) since 0089 and the word is fifteen characters.
--
-- No index. `rerun_of` is read with the ballot it belongs to, by primary key.

ALTER TABLE `ballots`
  ADD COLUMN `rerun_of` varchar(64) NULL;

ALTER TABLE `ballots`
  ADD COLUMN `quorum_fallback` tinyint(1) NOT NULL DEFAULT 0;
