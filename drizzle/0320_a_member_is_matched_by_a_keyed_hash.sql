-- sera_link_reviews: members the keyed-hash match could not link on its own.
-- Sera answered no owner id, or several, for a member's verified email hash.
-- A steward links them by hand with the existing Link to Sera control, which
-- clears the row. No email and no hash is ever stored here: only the member,
-- what the answer was, how many ids came back, and which secret version asked.
CREATE TABLE IF NOT EXISTS `sera_link_reviews` (
  `user_id` varchar(64) NOT NULL,
  `outcome` enum('none','several') NOT NULL,
  `matches` int NOT NULL DEFAULT 0,
  `secret_version` int NOT NULL DEFAULT 1,
  `checked_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
);
