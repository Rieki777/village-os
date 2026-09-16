-- A member arrives by invitation.
--
-- Rye's ruling, 2026-09-09: "invite members (all members are by invitation) at
-- the top of the profile that creates a special link that lets that new user
-- sign up." Somebody without a link can look around at everything, and joining
-- is a request that lands in the admin queue.
--
-- ONE ROW PER LINK. A link opens sign-up for exactly one new account, for
-- fourteen days, and it is the inviter's vouch for whoever uses it: the ruling
-- of 2026-09-08 counts the inviter's vouch as the first of the three.
--
-- THE TOKEN IS NEVER STORED. `token_hash` is its SHA-256, so a read of this
-- table, a backup of it, or a logged query against it cannot sign anybody up.
--
-- EXPIRY IS WRITTEN AND COMPARED BY THE DATABASE. `expires_at` is set from
-- CURRENT_TIMESTAMP and read against CURRENT_TIMESTAMP, never against a clock
-- in the application, because the app pool pins UTC and a test pool does not.
-- It is nullable only so that no engine invents a zero default for a second
-- TIMESTAMP column. Every writer sets it, and a NULL reads as expired.
--
-- USED AND REVOKED ARE ONE-WAY. A link is taken by a conditional UPDATE that
-- matches only an unused, unrevoked, unexpired row, so two sign-ups racing for
-- one link leave exactly one account holding it. The one write that clears
-- `used_at` gives a link back when the account it was taken for was never made.
--
-- NO CHARSET OR COLLATE CLAUSE, for the reason 0198 gives: these ids are joined
-- against `users`, and a pinned collation would put this table in a different
-- collation era from those rows.
--
-- Expand-only: a new table. The previous release does not know it exists.

CREATE TABLE IF NOT EXISTS `member_invites` (
  `id` varchar(64) NOT NULL,
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  `token_hash` char(64) NOT NULL,
  `inviter_user_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` timestamp NULL,
  `used_at` timestamp NULL,
  `used_by_user_id` varchar(64) NULL,
  `revoked_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `member_invites_token` (`token_hash`),
  KEY `member_invites_inviter_idx` (`village_id`, `inviter_user_id`)
);
