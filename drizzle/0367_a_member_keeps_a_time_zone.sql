-- Role journey L6: a member's own time zone (IANA name). Expand only.
-- No row means the member has not chosen one; screens then use the browser's.
CREATE TABLE IF NOT EXISTS `member_time_zones` (
  `user_id` varchar(64) NOT NULL,
  `time_zone` varchar(64) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
);
