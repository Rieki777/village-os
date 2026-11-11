-- 0374: humans and agents can apply for and fill roles (the lead, 11 Nov 2026).
--
-- org_roles.held_by says who may hold a role: 'person', 'agent' or 'either'.
-- NULL is a role card that has not said, and reads as 'either', which is what
-- every role already allowed: a person applies as before, and an admin with
-- org.seatAgent could already seat an agent on it (shared/agentHolders.ts).
--
-- org_role_assignments.keeper_user_id is the member who keeps an agent seated
-- on a role, shown beside the agent on the chart and the role card. NULL on
-- every seating of a person and on every agent seated before it existed.
--
-- EXPAND ONLY. Two new nullable columns. Every writer of either table names
-- its own columns, so the previous release reads and writes both unchanged
-- if it is put back over a migrated database.
ALTER TABLE `org_roles` ADD COLUMN `held_by` varchar(8) NULL;
ALTER TABLE `org_role_assignments` ADD COLUMN `keeper_user_id` varchar(64) NULL;
