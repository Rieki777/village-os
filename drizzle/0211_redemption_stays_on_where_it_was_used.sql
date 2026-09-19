-- 0211: redemption becomes a module that ships OFF, and stays ON wherever a
-- member already used it.
--
-- Ruling 22 (2026-09-15). Until this release redemption was ungated: its routes
-- mounted for every village and no registry entry named it. The release that
-- adds the `redemption` module mounts those routes behind `requireModule`, and
-- an absent `module_settings` row is OFF. Without this file every village that
-- already had requests open would find them 404 on the deploy, the member's
-- panel gone and the steward's queue with it, while the tokens stayed held.
--
-- So: a village with ANY row in `redemptions`, open or ended, is recorded at
-- `members`, which is exactly who could reach it before (every route checks
-- for a signed-in member itself). A village with none gets no row and inherits
-- the platform default, off, like every other module.
--
-- An ended row counts, not only an open one, on purpose. A village whose members
-- have redeemed has adopted the feature, and switching it off under them is a
-- founder's decision to make on the Modules tab, not a side effect of a deploy.
--
-- NO PRECEDENT, measured: no earlier migration writes `module_settings`. Every
-- module before this one was new when it shipped, so absent-means-off never
-- took anything away from anybody.
--
-- The event row is written FIRST and only while no settings row exists, so the
-- enable is recorded once, as the framework records every lifecycle move, with
-- no actor because no person made it. `INSERT IGNORE` on both primary keys, and
-- the NOT EXISTS on the event, make a second run change nothing, and a founder
-- who later switches the module off is never switched back on by a replay.

INSERT IGNORE INTO `module_events` (`id`, `module_id`, `kind`, `from_value`, `to_value`, `by_user_id`)
SELECT 'mev-0211-redemption-carried', 'redemption', 'lifecycle', 'off', 'members', NULL
FROM DUAL
WHERE EXISTS (SELECT 1 FROM `redemptions`)
  AND NOT EXISTS (SELECT 1 FROM `module_settings` WHERE `module_id` = 'redemption');

INSERT IGNORE INTO `module_settings` (`module_id`, `lifecycle`, `updated_by`)
SELECT 'redemption', 'members', NULL
FROM DUAL
WHERE EXISTS (SELECT 1 FROM `redemptions`);
