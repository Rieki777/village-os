-- A project is not always one piece of ground.
--
-- `village_land` was built with a UNIQUE key on `village_id`: exactly one row
-- per deployment, one centre, one span, one photograph. That is right for a
-- village that is one parcel and wrong for most of the projects this platform
-- is now being built for, which hold several pieces of land in different
-- places. Rye's requirement: each parcel is its own map, with a way to jump
-- between them.
--
-- Each parcel is its OWN map on purpose. Two parcels forty kilometres apart
-- share no honest coordinate space, and drawing them on one world rect would
-- invent the ground between them. So this migration gives a parcel an
-- identity and an order; it does not give it a shared frame.
--
-- ── WHY THE WAIVER BELOW IS HONEST ───────────────────────────────────────
--
-- The contract check forbids a new UNIQUE index, because "the previous
-- release does not know the pair must be unique and writes a duplicate".
-- Read against THIS change, that risk does not exist, and the reason is the
-- default on `slug`:
--
--   The previous release's only write to this table is the upsert in
--   server/routes/land.ts, which never names `slug`, so every row it writes
--   takes slug='home'. On those rows UNIQUE(village_id, slug) is exactly as
--   permissive as UNIQUE(village_id) was. The old release cannot write a
--   duplicate it could not already write, and its ON DUPLICATE KEY UPDATE
--   still collides on the same row it always collided on.
--
-- So a rollback over this schema is safe: the previous image keeps reading
-- and writing the one parcel it knows about. The most it loses is that its
-- `LIMIT 1` read may return a parcel other than the first when a founder has
-- added one, which is a wrong picture and never a failed boot.
--
-- The old key is dropped rather than kept because keeping it is precisely
-- what forbids a second parcel. There is no expand-only shape of this change.
--
-- compat-ok: UNIQUE(village_id, slug) subsumes the dropped UNIQUE(village_id) for every row the previous release can write, because that release never names slug and the column defaults to 'home'. Rollback keeps working on the one parcel it knows.

ALTER TABLE `village_land`
  -- The parcel's stable name in an address, never typed by a founder: it is
  -- derived from the label. 'home' is the first parcel of every village that
  -- already exists, which is what makes the key swap below a no-op for them.
  ADD COLUMN `slug` varchar(64) NOT NULL DEFAULT 'home',

  -- What the founder calls this piece of ground: "The ridge", "North field".
  -- Empty is a real and ordinary state, not a missing value: a project with
  -- one parcel has no need to name it, and the map says "the land" for it.
  -- Defaulting to a made-up name would put words in a founder's mouth on
  -- every village that already exists.
  ADD COLUMN `label` varchar(120) NOT NULL DEFAULT '',

  -- Which parcel a reader lands on, and the order of the jump control.
  -- DELIBERATELY NOT an `is_primary` flag. A flag has a second state nothing
  -- enforces -- two rows can both claim it, or none can -- and every reader
  -- would need a tie-break anyway. An ordering has exactly one first row, so
  -- "the parcel to open" is a question with one answer: lowest sort_order,
  -- then oldest. Existing rows take 0 and stay first.
  ADD COLUMN `sort_order` int NOT NULL DEFAULT 0;

-- ── THE SWAP IS ONE STATEMENT, AND IT HAS TO BE ────────────────────────────
--
-- An earlier draft of this file dropped the old key in one statement and
-- added the new one in the next, and excused the gap between them on row
-- count. Row count was never the danger. Between those two statements the
-- table has NO unique key, and the previous release's only write is an
-- ON DUPLICATE KEY UPDATE, which with nothing to collide on quietly INSERTs.
--
-- Railway deploys by rolling: the old container keeps serving while the new
-- one boots and runs this file. A founder saving their land in that gap
-- writes a second (village_id, 'home') row, the ADD that follows then fails
-- on the duplicate, and a migration that fails at boot is a village that
-- cannot start. Rolling the image back does not remove the row, so the next
-- deploy fails the same way, and the only recovery is deleting a row by hand
-- in production.
--
-- Found by the merge-conflict lane reading this file before it merged, and
-- reproduced before it was fixed: split, the gap write leaves two rows and
-- the ADD dies with ER_DUP_ENTRY; combined, the same write collides on both
-- sides and the ALTER succeeds on a populated table. MySQL applies every
-- clause of one ALTER TABLE together, so there is no moment with no key.
--
-- server/routes/land.upsert.e2e.test.ts holds the class, not this instance:
-- it applies this file through the boot runner's own statement splitter and
-- issues the previous release's write at EVERY statement boundary.
ALTER TABLE `village_land`
  DROP INDEX `village_land_village_uniq`,
  ADD UNIQUE KEY `village_land_parcel_uniq` (`village_id`, `slug`);
