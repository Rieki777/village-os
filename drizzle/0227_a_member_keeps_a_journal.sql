-- 0227: a member keeps a journal, and the few numbers a village may read back from it.
--
-- Four new tables and nothing else, so this file is expand-only: the previous
-- release neither reads nor writes any of them, and rolling an image back over
-- a migrated database leaves four tables nobody asks about.
--
-- THE CONTRACT IS shared/journal.ts. The practices, the questions, the five
-- pulse metrics and the feedback shapes are named there once, and the enums
-- below spell the same lists. A practice added there is a value ADDED here in a
-- later file, which expand-never-contract allows; one removed there stays legal
-- here forever, because an old row may carry it.
--
-- THE PRIVACY LINE, which every column below follows:
--   - An entry is its author's. No route returns one to anybody else, an admin
--     included. There is no admin read, and no column here exists to serve one.
--   - The pulse's NUMBERS aggregate, and only above a floor
--     (`journal.pulse_floor`). Its words stay in the author's entry, which is
--     why the pulse table holds a number and no text at all.
--   - Feedback reaches its recipient unsigned, in words the author approved,
--     in a weekly batch, and only when the recipient said they want it.
--   - Nothing here is written to `health_events`. `recordEvent` defaults to a
--     public audience, and "member-7 wrote in their journal at 2am" is exactly
--     the fact these tables exist to keep off every other screen.
--
-- NO FOREIGN KEYS, the same as every table in this schema. `user_id`,
-- `author_id` and `recipient_id` are reconciled by the tombstone path:
-- `anonymizeMember` (server/lib/erasure.ts) runs `forgetMemberJournal`
-- (server/lib/journal.ts) after the tombstone, where the member's sessions die,
-- and that deletes every row in all four tables that names them.
--
-- EVERY DEDUPE COLUMN IS NOT NULL. A MySQL unique index exempts NULLs, so a
-- nullable column in one admits unlimited duplicates.
--
-- EVERY FREE-TEXT COLUMN IS BOUNDED, and the store clips to the bound before
-- the insert. Strict MySQL does not truncate an over-long field, it REFUSES THE
-- ROW, so a member typing past a width would lose every word and be told
-- nothing they could act on.

CREATE TABLE IF NOT EXISTS `journal_entries` (
  `id` varchar(64) NOT NULL,
  -- The author, and the only person any route returns this row to.
  `user_id` varchar(64) NOT NULL,
  -- Minted by the client before the first save, so a save retried after a
  -- dropped connection lands on the same row instead of writing it twice.
  `client_id` varchar(64) NOT NULL,
  `practice` enum('morning','evening','pulse','debrief','free') NOT NULL,
  `depth` enum('light','deep') NOT NULL,
  -- JSON: an array of { questionKey, prompt, text }. The prompt travels with
  -- the answer so an old entry reads right after a question is reworded.
  -- At most 20 answers of at most 8000 characters, clipped by the store.
  `answers` mediumtext NOT NULL,
  -- JSON: { metric: value } on a pulse entry, NULL on every other practice.
  -- A copy for the author's own reading; the numbers the village sees are the
  -- rows in `journal_pulse`.
  `scores` text NULL,
  -- When the member wrote it. An offline save arrives late, so this is the
  -- client's instant and never the insert's.
  `written_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The writer's own local hour, 0 to 23, so the guide can notice late nights.
  `local_hour` tinyint NULL,
  -- Travels with an EXPORT only. Everything here is held privately whatever
  -- this says; the tier tells a person's own notes what they may later share.
  `privacy` enum('private','internal','clear') NOT NULL DEFAULT 'private',
  -- JSON: a debrief's { call, seats, quests, portable }, NULL otherwise.
  `meta` text NULL,
  -- The guide's distilled reflection, kept only once the author confirmed it.
  `reflection` varchar(2000) NULL,
  `confirmed` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- ONE ROW PER CLIENT SAVE. Both columns NOT NULL, for the reason above.
  UNIQUE KEY `journal_entries_client_uq` (`user_id`, `client_id`),
  -- The member's own list, newest first, and the guide's last ten.
  KEY `journal_entries_written_idx` (`user_id`, `written_at`)
);

CREATE TABLE IF NOT EXISTS `journal_pulse` (
  `id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  -- The entry that carried this number, so forgetting the entry forgets it.
  `entry_id` varchar(64) NOT NULL,
  -- ISO week in the village's zone, spelled `2026-W40`.
  `week_id` varchar(16) NOT NULL,
  -- A `PULSE_METRICS` key from shared/journal.ts.
  `metric` varchar(32) NOT NULL,
  -- -2..2 for energy, 1..5 for the other four. Validated by the store.
  `value` tinyint NOT NULL,
  `recorded_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- ONE NUMBER PER MEMBER PER METRIC PER WEEK, and the last answer wins. A
  -- member who answers twice in a week moves their own number, and the
  -- aggregate never counts one person twice.
  UNIQUE KEY `journal_pulse_uq` (`user_id`, `week_id`, `metric`),
  -- The aggregate's own question, covering, so the count never reads a row.
  -- No `user_id` in it on purpose: the aggregate's SELECT names none.
  KEY `journal_pulse_week_idx` (`week_id`, `metric`, `value`)
);

CREATE TABLE IF NOT EXISTS `journal_feedback_prefs` (
  -- One row per member who has answered. No row means they have not said yes.
  `user_id` varchar(64) NOT NULL,
  `open` tinyint(1) NOT NULL DEFAULT 0,
  `style` enum('direct','gentle','with-examples') NOT NULL DEFAULT 'gentle',
  -- "How I like to receive feedback", in their own words.
  `note` varchar(500) NOT NULL DEFAULT '',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
);

CREATE TABLE IF NOT EXISTS `journal_feedback` (
  -- A random id. An id built from the clock would tell the recipient when the
  -- message was queued, which is the fact the weekly batch exists to blur.
  `id` varchar(64) NOT NULL,
  -- Never returned to the recipient at any depth. The received read's SELECT
  -- does not name this column.
  `author_id` varchar(64) NOT NULL,
  `recipient_id` varchar(64) NOT NULL,
  -- The four parts the author wrote. Kept for the author's own view.
  `observation` varchar(1000) NOT NULL DEFAULT '',
  `feeling` varchar(1000) NOT NULL DEFAULT '',
  `need` varchar(1000) NOT NULL DEFAULT '',
  `request` varchar(1000) NOT NULL DEFAULT '',
  -- The words the recipient reads, exactly as the author approved them.
  `message` text NOT NULL,
  `status` enum('draft','queued','withdrawn') NOT NULL DEFAULT 'draft',
  -- The first Monday 09:00 in the village's zone at least 48 hours after
  -- queuing. Visible to the recipient once this has passed, and not before.
  `deliver_after` timestamp NULL,
  `response` enum('none','thanks','not-useful') NOT NULL DEFAULT 'none',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- The recipient's inbox: queued, and past its delivery time.
  KEY `journal_feedback_inbox_idx` (`recipient_id`, `status`, `deliver_after`),
  -- The author's own list, and the weekly cap's count.
  KEY `journal_feedback_author_idx` (`author_id`, `created_at`)
);
