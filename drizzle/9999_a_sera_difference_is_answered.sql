-- 9999: a difference from the outside service is answered, and the old queue says why it went.
-- 9999 is a placeholder: the integrator gives the real number at compose time.
--
-- WHAT THIS IS FOR.
-- The review page lists the ways the outside service's chart and the live chart
-- differ (0337 keeps the service's side). A person now answers each one: takes
-- the service's value into a draft, keeps ours, or writes their own. Four
-- additions carry that.
--
-- `saberra_settled`: one row per difference, keyed by the difference's own key
-- (the subject's page id and the field). It holds HASHES of both sides as they
-- were answered, never the words, so a kept difference stays answered until the
-- service's value changes again. How it was answered (taken, kept, edited,
-- applied, undone or first), through which door (power, admin, moderator,
-- ballot or sync), the role whose power the person acted through, and when. A
-- take names the draft and the change it made, so the draft's own status says
-- whether it is waiting, live, or withdrawn and so open again. `came_with` is
-- the new circle a new role was taken with. `link_made` says the answer tied a
-- page id to ours, so its undo unties it. `lapsed_at` is when the answer
-- stopped applying: the difference it answered left the list after a later
-- read, so the same value coming back is a new suggestion. The actor's user id
-- is the only personal datum and the erasure de-attributes it.
--
-- `saberra_links`: a service page id tied to one of our circles or roles by a
-- person's take or keep, so a rename on either side never breaks the match. Ids
-- only. The actor's user id is de-attributed the same way.
--
-- `external_proposals.edited_at_accept`: when a steward changed a proposal's
-- words at accept. The dedupe key hashes the words folded to lower case, so a
-- change of capitals alone passed for the service's own words. NULL on every row
-- accepted before this, which the reader cannot tell apart from untouched, and
-- says so where it reads it.
--
-- `external_proposals.retired_reason`: why a waiting proposal was retired by the
-- differences list, so a later landing never brings it back.
--
-- EXPAND ONLY. Two new tables and two nullable columns. The previous release
-- never reads the tables, and writes the queue's rows naming columns it knows,
-- so the new ones stay NULL. No backfill, and no row is seeded.

CREATE TABLE IF NOT EXISTS `saberra_settled` (
  `difference_key` varchar(191) NOT NULL,
  `sera_hash` char(16) NOT NULL,
  `ours_hash` char(16) NOT NULL,
  -- taken, kept, edited, applied, undone or first.
  `answer` varchar(16) NOT NULL,
  -- power, admin, moderator, ballot or sync.
  `door` varchar(16) NOT NULL,
  `by_role_id` varchar(64) NULL,
  `actor_user_id` varchar(64) NULL,
  `draft_id` varchar(64) NULL,
  `draft_change_id` varchar(64) NULL,
  `came_with` varchar(191) NULL,
  `link_made` tinyint NOT NULL DEFAULT 0,
  `lapsed_at` timestamp NULL DEFAULT NULL,
  `answered_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`difference_key`),
  KEY `saberra_settled_draft` (`draft_id`),
  KEY `saberra_settled_came_with` (`came_with`),
  KEY `saberra_settled_actor` (`actor_user_id`)
);

CREATE TABLE IF NOT EXISTS `saberra_links` (
  -- circle or role.
  `subject_kind` varchar(8) NOT NULL,
  `page_key` varchar(64) NOT NULL,
  `our_id` varchar(191) NOT NULL,
  -- take or keep.
  `set_by` varchar(16) NOT NULL,
  `actor_user_id` varchar(64) NULL,
  `set_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`subject_kind`, `page_key`),
  KEY `saberra_links_ours` (`subject_kind`, `our_id`),
  KEY `saberra_links_actor` (`actor_user_id`)
);

ALTER TABLE `external_proposals` ADD COLUMN `edited_at_accept` timestamp NULL DEFAULT NULL;

ALTER TABLE `external_proposals` ADD COLUMN `retired_reason` varchar(64) NULL DEFAULT NULL;
