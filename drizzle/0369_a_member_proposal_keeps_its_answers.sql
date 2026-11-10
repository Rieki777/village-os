-- 0369: a member's role proposal keeps the answers the member door asks
-- (guide v2, B1; coordinator's ruling 10 Nov 2026). The open form keeps the
-- same answers in its proposal's body_json; a member proposal had nowhere to
-- keep them but its free-text deliverables, so its status card showed "No
-- season plan filed yet" for an aim the member had just written.
--
-- One JSON column, read by shared/seatApplications.ts parseApplicationAnswers:
-- the aim, the season goal the work serves, the time zone, the usual times,
-- the earliest start and the terms choice. Null for every proposal made
-- before this, and for any not made through the member door.
--
-- Expand only and nullable. The member's own words: cleared with the note and
-- the deliverables when they ask to be forgotten (eraseApplicationWords).
ALTER TABLE `seat_applications`
  ADD COLUMN `answers` json NULL;
