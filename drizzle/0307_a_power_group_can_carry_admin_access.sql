-- 0307: a power group can carry admin access (sheet 19, Rye 2026-10-31:
-- "admin access only, for Founders Circle and steward roles").
--
-- One new column and a backfill scoped by id, so this file is expand-only: the
-- previous release never names the column, and a rollback reads `roles` as it
-- always did.
--
-- WHAT IT MEANS IS server/lib/groupAdmin.ts. A member who holds a group with
-- this switch on, in a holding whose term has not run out, may open the admin
-- panel. It is read live from `role_holders` on every request, so access ends
-- the moment the holding does, with nothing written to say so. It is admin
-- access only: the capability gate's admin short-circuit still reads the
-- account's own role, so the switch hands nobody a decide power or the veto.
--
-- NOT NULL with a DEFAULT, on a column `rolesRepo` names as `kind: "bool"`,
-- which is one of the two cases dbCollection writes as a value and never as
-- an explicit NULL (CLAUDE.md, house traps).

ALTER TABLE `roles` ADD COLUMN `grants_admin` tinyint(1) NOT NULL DEFAULT 0;

-- The two groups the ruling names start with the switch on. Every other group,
-- seeded or made by a village, starts off.
UPDATE `roles` SET `grants_admin` = 1 WHERE `id` IN ('founders-circle', 'steward-circle');
