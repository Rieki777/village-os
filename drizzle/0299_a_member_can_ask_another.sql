-- 0299: a member can ask another.
--
-- One new table and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes it, and rolling an image back over a
-- migrated database leaves one table nobody asks about. No ALTER.
--
-- THE RULES ARE shared/memberAsks.ts: who may ask whom, the cap on open
-- blocking asks, what a link may be, and the order "Waiting on you" draws
-- them in. server/routes/memberAsks.ts holds the doors.
--
-- WHAT IT HOLDS. One member asking another to review, edit, approve or finish
-- something: the link, why, an optional due date, and whether the asker is
-- stuck until it is done. Only the two of them ever read a row. The erasure
-- sweep deletes every row either of them is on (server/lib/erasure.ts,
-- "member-asks"), because a row is the two of them and nobody else.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `member_asks` (
  `id` varchar(64) NOT NULL,
  `asker_user_id` varchar(64) NOT NULL,
  `asked_user_id` varchar(64) NOT NULL,
  `link` varchar(1000) NOT NULL,
  `why` varchar(300) NOT NULL,
  -- A civil date in the village's zone, or none.
  `due_on` date NULL,
  `blocking` tinyint(1) NOT NULL DEFAULT 0,
  -- open: waiting on the asked member. done: they did it. handed_back: they
  -- said it is not theirs. withdrawn: the asker took it back.
  `status` enum('open','done','handed_back','withdrawn') NOT NULL DEFAULT 'open',
  -- What the asked member said when handing it back, or none.
  `hand_back_note` varchar(300) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `member_asks_asked_idx` (`asked_user_id`, `status`),
  KEY `member_asks_asker_idx` (`asker_user_id`, `status`)
);
