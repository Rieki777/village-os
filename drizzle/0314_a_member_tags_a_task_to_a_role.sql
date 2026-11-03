-- A member tags a task on their profile to a role and a season goal, so the
-- end-of-moon recap (0313) starts half-tagged.
--
-- role_id is an org_roles id. serves_goal_id is a season goal id from the
-- season document in app_config. Both are NULL for every existing row and for
-- any task nobody tagged, which the previous release never reads.
--
-- Expand only: two nullable columns. Nothing dropped, renamed or narrowed.

ALTER TABLE `member_tasks`
  ADD COLUMN `role_id` varchar(64) NULL,
  ADD COLUMN `serves_goal_id` varchar(64) NULL;
