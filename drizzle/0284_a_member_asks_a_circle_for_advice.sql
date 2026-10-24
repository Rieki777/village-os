-- 0284: a member asks a circle for advice.
--
-- Two new tables, so this file is expand-only: the previous release neither
-- reads nor writes either, and rolling an image back over a migrated database
-- leaves two tables nobody asks about.
--
-- THE CONTRACT IS shared/sessionAdvice.ts. Feature 4 of the sessions program
-- (Rye, 2026-10-22): before deciding something that touches others, a member
-- asks the people it touches. They name what they mean to decide, why, and by
-- when, and ask a circle; everybody with standing in it is asked.
--
-- WHAT IT HOLDS. One row in `live_session_advice_requests` per request: the
-- circle asked, the asker (a number in `live_session_members`), their words,
-- the decide-by date (a village date), and once settled the status and what
-- they decided. One row in `live_session_advice_asks` per person asked, with
-- their advice once they give it. A person is a number, the same as every
-- other table of this module.
--
-- ERASURE (server/repos/sessionAdvice.ts `forgetMember`): the requests a
-- member made go, with every ask and every word of advice on them, since
-- those were answers to their words; and every ask of theirs goes, their
-- advice with it.
--
-- Every instant here is written from Node's clock.
--
-- NO FOREIGN KEYS, the same as every table in this schema.

CREATE TABLE IF NOT EXISTS `live_session_advice_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `circle_id` varchar(64) NOT NULL,
  `asker_no` int NOT NULL,
  `intent` varchar(600) NOT NULL,
  `context` varchar(1200) NULL,
  -- YYYY-MM-DD, a village date.
  `decide_by` varchar(10) NOT NULL,
  -- open, decided or withdrawn.
  `status` varchar(16) NOT NULL DEFAULT 'open',
  `decision` varchar(600) NULL,
  `settled_at` timestamp(3) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `live_session_advice_requests_asker_idx` (`asker_no`, `status`)
);

CREATE TABLE IF NOT EXISTS `live_session_advice_asks` (
  `request_id` int NOT NULL,
  `member_no` int NOT NULL,
  `advice` varchar(1200) NULL,
  `advised_at` timestamp(3) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`request_id`, `member_no`),
  KEY `live_session_advice_asks_member_idx` (`member_no`)
);
