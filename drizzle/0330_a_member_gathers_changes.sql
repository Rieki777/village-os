-- 0330: a member gathers several changes into one change request (Rye, 2026-11-06).
--
-- A change request lives BEFORE a mechanics proposal and becomes one at the
-- vote. Everything editable lives here, and a `mechanics_proposals` row is
-- written only when the change request is taken to the vote, frozen, so the
-- 0043 promise holds: a proposal's change set never moves after it is made.
--
-- Three new tables and nothing else, so the previous release ignores them.
-- No row is seeded, so this deploy changes nothing anyone sees.
--
-- `change_requests`: one row per change request. `revision` counts edits, and
-- every edit is a guarded UPDATE on the revision it read, so two tabs cannot
-- both win. `relation` and `relates_to` say where it came from (an undo, a
-- renewal, an override after a veto, a split, a copy). `author_kind` is
-- 'agent' for a change request an outside service filed (I.2), whose author
-- id is then the seated agent's.
--
-- `review_opened_at` is when the review clock last started (it restarts
-- whenever a change or the why is edited in review), and `review_days_at_open`
-- is the review length the village had then: the length that applies is the
-- longer of that and today's, so lowering the dial mid-review shortens nothing.
--
-- `change_request_items`: the changes of every revision, append-only. A new
-- revision writes a new set of rows and the old rows stay, which is the
-- record of what the change request said at each moment. `change_key` is
-- the setting the change touches, in the keys the rest of the app already
-- uses (a dial key, module:<id>, brand:<field>, mint:<rule>:<field>), so a
-- conflict is one indexed lookup. `before_value` is what the setting read
-- when the change was added.
--
-- `change_request_notes`: the review round (questions, concerns,
-- objections, suggested edits, consent, answers). Written by the next slice
-- of this lane; created here so the lane claims one number.

CREATE TABLE IF NOT EXISTS `change_requests` (
  `id` varchar(64) NOT NULL,
  `author_user_id` varchar(64) NULL,
  `author_kind` enum('member','agent') NOT NULL DEFAULT 'member',
  `title` varchar(200) NOT NULL,
  `why` text NOT NULL,
  `state` enum('gathering','in_review','voting','closed') NOT NULL DEFAULT 'gathering',
  `revision` int NOT NULL DEFAULT 1,
  `relation` enum('undoes','renews','overrides','split_from','copied_from') NULL,
  `relates_to` varchar(64) NULL,
  `proposal_id` varchar(64) NULL,
  `closed_reason` varchar(40) NULL,
  `trial_moons` int NULL,
  `review_opened_at` datetime NULL,
  `review_days_at_open` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `change_requests_author_idx` (`author_user_id`, `state`),
  KEY `change_requests_state_idx` (`state`, `updated_at`)
);

CREATE TABLE IF NOT EXISTS `change_request_items` (
  `change_request_id` varchar(64) NOT NULL,
  `revision` int NOT NULL,
  `position` int NOT NULL,
  `item` json NOT NULL,
  `change_key` varchar(191) NOT NULL,
  `before_value` text NULL,
  `added_by` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`change_request_id`, `revision`, `position`),
  KEY `change_request_items_key_idx` (`change_key`)
);

CREATE TABLE IF NOT EXISTS `change_request_notes` (
  `id` varchar(64) NOT NULL,
  `change_request_id` varchar(64) NOT NULL,
  `revision` int NOT NULL,
  `kind` enum('question','concern','objection','edit','consent','answer','system') NOT NULL,
  `author_user_id` varchar(64) NULL,
  `position` int NULL,
  `body` text NOT NULL,
  `proposed_item` json NULL,
  `answers_note_id` varchar(64) NULL,
  `outcome` enum('open','taken_in','turned_down','answered') NOT NULL DEFAULT 'open',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `change_request_notes_cr_idx` (`change_request_id`, `created_at`)
);
