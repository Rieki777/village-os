-- A training module says whether finishing it is required to climb.
--
-- Rye's ruling, 2026-09-08: a member states for themselves which training they
-- have done and it shows on their profile, and the MANDATORY ones are what
-- moves them onto the next rung. Optional modules are offered and gate nothing.
--
-- WHY THE DEFAULT IS 1, WHICH IS THE WHOLE SAFETY ARGUMENT.
--
-- `trainingIsComplete` today requires EVERY module id to be finished, so every
-- existing module already behaves as mandatory. Defaulting the new column to 1
-- means every row on all thirteen instances keeps exactly the behaviour it has
-- now, and no member's rung moves when this lands. Marking a module optional is
-- then a deliberate act somebody performs in Admin, never a side effect of a
-- deploy.
--
-- Expand-only: a new column, NOT NULL, with a DEFAULT. The previous release
-- selects a fixed column list and never names this one, so rolling back over an
-- already-migrated database keeps working.
--
-- A WARNING FOR THE WRITE PATH, not for this file. `training_modules` is a
-- dbCollection, and a dbCollection INSERT names every column in its spec, so a
-- DEFAULT never applies to one: `kind: "bool"` writes 0 for an absent key. The
-- default below protects the rows that already exist; it cannot protect a row
-- written later. Every writer has to set this field on purpose, and the seed
-- and the admin panel both do.

ALTER TABLE `training_modules`
  ADD COLUMN `mandatory` TINYINT(1) NOT NULL DEFAULT 1;
