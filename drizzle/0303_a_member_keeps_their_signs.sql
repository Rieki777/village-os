-- A member keeps their own Western Sun, Moon and rising signs.
--
-- Rye asked for the Gene Keys onboarding to give "gene keys + human design and
-- astrology" (2026-11-01). The signs are read in the member's browser from the
-- same birth date and town the Gene Keys page already asks for
-- (`natalSigns` in shared/geneKeysSky.ts), and only the numbers arrive here:
-- 0 Aries to 11 Pisces, tropical. No birth date, time or place is stored, as
-- before.
--
-- Each is NULL when it is not known: the Moon (or on a cusp day the Sun)
-- changed sign inside the span the birth could fall in, or, for the rising
-- sign, no exact birth time was given. The rising sign also needs the birth
-- town's coordinates, which the town list does not carry yet, so it stays NULL
-- until it does.
--
-- Member-pii (Module Library Contract clause 13): shown to the member alone,
-- in their export, and deleted with the row on erasure.
--
-- Expand only: three nullable columns. Nothing dropped or renamed.

ALTER TABLE `member_gene_keys`
  ADD COLUMN `sun_sign` tinyint NULL,
  ADD COLUMN `moon_sign` tinyint NULL,
  ADD COLUMN `rising_sign` tinyint NULL;
