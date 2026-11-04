-- Agents in the village (End of Moon addendum v6, B4, B6 and B7).
--
-- users.is_agent marks an account a software agent holds: the Operations
-- agent (B6) and Sera's agent (B7). NULL and 0 both mean a person. An agent
-- account holds no seat (server/lib/orgChart.ts refuses it) and is shown with
-- an Agent badge.
--
-- agent_oauth_clients and agent_oauth_codes carry the OAuth 2.1 sign-in for
-- Claude's custom connectors (B4): a client registered dynamically, and a
-- single-use ten-minute code exchanged for an ordinary vat_ token. Codes name
-- a member and go in member erasure.
--
-- agent_actions records what an agent did through the connector's admin and
-- Sera scopes: the tool, the method and path or the Sera action, the echo
-- hash, and for an undoable action what puts it back. B7's Undo reads it.
-- Rows naming a member go in member erasure.
--
-- sera_person_links.how admits 'sera', for a link Sera's agent writes (B7).
-- Adding an enum value at the end; none is removed.
--
-- Expand only: one nullable column, three new tables, one widened enum.

ALTER TABLE `users`
  ADD COLUMN `is_agent` tinyint(1) NULL;

CREATE TABLE IF NOT EXISTS `agent_oauth_clients` (
  `client_id` varchar(64) NOT NULL,
  `name` varchar(120) NOT NULL,
  `redirect_uris_json` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`client_id`)
);

CREATE TABLE IF NOT EXISTS `agent_oauth_codes` (
  `code_hash` char(64) NOT NULL,
  `client_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `scopes_json` text NOT NULL,
  `code_challenge` varchar(128) NOT NULL,
  `redirect_uri` varchar(2000) NOT NULL,
  `expires_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `used_at` timestamp NULL,
  PRIMARY KEY (`code_hash`),
  KEY `agent_oauth_codes_user` (`user_id`)
);

CREATE TABLE IF NOT EXISTS `agent_actions` (
  `id` varchar(64) NOT NULL,
  `token_id` varchar(64) NOT NULL,
  `actor_user_id` varchar(64) NOT NULL,
  `scope` varchar(32) NOT NULL,
  `tool` varchar(64) NOT NULL,
  `method` varchar(8) NULL,
  `path` varchar(500) NULL,
  `subject_user_id` varchar(64) NULL,
  `echo_hash` char(64) NOT NULL,
  `state` varchar(16) NOT NULL DEFAULT 'done',
  `undo_json` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `undone_at` timestamp NULL,
  `undone_by_user_id` varchar(64) NULL,
  PRIMARY KEY (`id`),
  KEY `agent_actions_actor` (`actor_user_id`, `created_at`),
  KEY `agent_actions_subject` (`subject_user_id`)
);

ALTER TABLE `sera_person_links`
  MODIFY COLUMN `how` enum('steward','email','sera') NOT NULL DEFAULT 'steward';
