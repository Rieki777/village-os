-- 0239: a seat says what it offers whoever holds it.
--
-- WHAT THIS IS FOR.
-- Seat settings (2026-10-09). A seat's terms on offer are the settings object
-- in shared/seatSettings.ts: how long the seat runs, the clocks it keeps, its
-- rhythm, what it records as pay, allowance and bonus, its quests, its
-- scoreboard and how it ends. Every member reads them through the `terms.read`
-- capability, which opens at the member rung; a visitor and a signed-in guest
-- read none of it. Money in here is a RECORD: nothing in the platform reads
-- these columns to post, pay, settle or promote anything.
--
-- WHY COLUMNS ON `org_roles` AND NOT A TABLE.
-- An offer is seat-scoped and one per seat, so it lives beside the seat it
-- describes and is read through the one seat projection
-- (server/lib/seatProjection.ts), which attaches it only at the terms tier.
-- A second table would be a second place to forget the tier.
--
-- WHO WRITES THEM.
-- Only an org draft, on publish (server/lib/orgDrafts.ts `applyChange`), and
-- only a draft a HUMAN wrote: a vendor's or Saberra's draft carrying terms is
-- blocked at preview and refused again at apply, so terms never cross the
-- bridge. Revert puts the three back from `before_json`.
--
-- `compensation_reality` IS UNTOUCHED. It stays the admin-only private note it
-- has been since 0049, and the drawer never shows it.
--
-- `terms_offer_by` is the member who published the offer, a user id, so the
-- record de-attributes through the tombstoned user row without remapping ids.
--
-- EXPAND ONLY, AND THE ROLLBACK HOLDS.
-- Three nullable columns with no default on a table every writer reaches with
-- raw SQL naming its own columns (`createOrgRole`, `updateOrgRole`, the draft
-- apply and revert paths, the examples seed). The previous release names none
-- of the three, so it keeps reading and writing `org_roles` unchanged if it is
-- put back over a migrated database. NULL means "no terms on offer yet", which
-- is the honest answer for every seat that existed before this file.

ALTER TABLE `org_roles`
  ADD COLUMN `terms_offer` json NULL,
  ADD COLUMN `terms_offer_at` datetime NULL,
  ADD COLUMN `terms_offer_by` varchar(64) NULL;
