-- 0269: a role hears a tension.
--
-- One new table and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes it, and rolling an image back over a
-- migrated database leaves one table nobody asks about. No ALTER, no ADD
-- COLUMN, no backfill.
--
-- THE CONTRACT IS shared/roleTensions.ts. The statuses, the widths, who may
-- read the words and every sentence a member reads are named there once; the
-- widths below follow it, and the store cleans and clips to them first.
--
-- WHAT IT HOLDS. Any signed-in member may raise a tension with a role: a few
-- words about something the role could do differently. It lands with every
-- live holder of the role, in the bell and in Waiting on you on their task
-- board. While it is open, only the holders and the member who raised it may
-- read its words, because a tension often names a person. A holder takes it,
-- answers it, or brings it to the role's circle; only the last makes the words
-- readable to every member, and it does so by writing a `tension` entry into
-- the circle's backlog (`live_session_entries`, carried into its next session).
--
-- STATUS is open, taken, answered or brought_to_circle. `answered_by` is the
-- holder who last took or answered it, and `answered_at` is set once it is
-- answered or brought to the circle. `circle_entry_id` is the backlog entry a
-- bring wrote, so the two records can be read side by side.
--
-- ERASURE (server/lib/roleTensions.ts `forgetRoleTensionsFor`): a member who
-- leaves is taken off every tension they raised or answered (`raised_by` and
-- `answered_by` NULL), the words of every tension they raised that was never
-- answered are cleared, and so is any answer note they wrote. That is why
-- `raised_by` is nullable.
--
-- Every instant here is written from Node's clock and read back with
-- UNIX_TIMESTAMP(col), so the database's own zone never moves one.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `role_tensions` (
  `id` varchar(32) NOT NULL,
  -- The role it was raised with, `org_roles`.`id`.
  `org_role_id` varchar(64) NOT NULL,
  -- Who raised it. NULL once they have left the village.
  `raised_by` varchar(64) NULL,
  -- The words, in the raiser's own hand. Empty once cleared by an erasure.
  `text` varchar(600) NOT NULL,
  -- open, taken, answered or brought_to_circle.
  `status` varchar(20) NOT NULL DEFAULT 'open',
  -- A holder's optional word back.
  `answer_note` varchar(300) NULL,
  -- The holder who last took or answered it.
  `answered_by` varchar(64) NULL,
  -- The `live_session_entries` row a bring to the circle wrote.
  `circle_entry_id` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `answered_at` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `role_tensions_role_idx` (`org_role_id`, `status`),
  KEY `role_tensions_raiser_idx` (`raised_by`),
  KEY `role_tensions_status_idx` (`status`, `created_at`)
);
