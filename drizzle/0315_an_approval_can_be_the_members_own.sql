-- An end-of-moon approval can be the member's own (decision 19, 3 November).
--
-- A holder of moon.approve_own (the Treasury power group only, an interim
-- step) may approve their own recap and invoice. Every such approval is
-- marked, so the invoice, the events and the cash payouts desk can read
-- "Approved by the member themselves" and the founders' and stewards' groups
-- can review it after the fact.
--
-- self_approved is 1 when the member gave an approval on their own recap.
-- The repository names it on every write, so its DEFAULT is a floor for the
-- previous release, which never writes these tables.
--
-- Expand only: three NOT NULL columns with a DEFAULT, on tables 0313 made.

ALTER TABLE `moon_recaps`
  ADD COLUMN `self_approved` tinyint(1) NOT NULL DEFAULT 0;

ALTER TABLE `moon_invoices`
  ADD COLUMN `self_approved` tinyint(1) NOT NULL DEFAULT 0;

ALTER TABLE `moon_review_events`
  ADD COLUMN `self_approved` tinyint(1) NOT NULL DEFAULT 0;
