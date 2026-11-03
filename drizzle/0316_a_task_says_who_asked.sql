-- Who asked for a library task, and the role it sits with (Sera, Nov 3).
--
-- member_tasks.requested_by: the library's free-text "requested by" (up to 200
-- characters), shown to the member as "Asked by ...". Display only.
-- member_tasks.sera_role_id: the library's role id when a member's task moved
-- to a role with nobody holding it (status Needs Owner on the library side).
-- member_task_import_queue.sera_role_id: the same for tasks that never had an
-- owner here, so the Needs Owner queue can name the role.
--
-- Member-pii: both member_tasks columns sit on rows already deleted with the
-- member on erasure (forgetMemberTasks). The queue names no member.
--
-- Expand only: three nullable columns.

ALTER TABLE `member_tasks`
  ADD COLUMN `requested_by` varchar(200) NULL;

ALTER TABLE `member_tasks`
  ADD COLUMN `sera_role_id` varchar(64) NULL;

ALTER TABLE `member_task_import_queue`
  ADD COLUMN `sera_role_id` varchar(64) NULL;
