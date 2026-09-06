-- Opaque subject references: the mapping that lets an outside service name a
-- member without ever learning who that member is.
--
-- WHY THE TABLE EXISTS AT ALL.
-- The module library contract has promised vendors "an opaque subject
-- reference, a seat and a term. Never an email and never our internal member
-- id" since its first revision. Nothing issued one. `external_proposals`
-- already carries a `subject_ref` column whose own comment describes an opaque
-- reference to a person, and no code in the tree ever made one, so the column
-- has been waiting since 0140 for a scheme that did not exist.
--
-- WHY A STORED MAPPING RATHER THAN A DERIVED REFERENCE.
-- An HMAC of the member id under an instance secret needs no table. It fails
-- in two ways that only show up after a vendor has stored references, which is
-- the worst moment to discover either. Rotating the secret invalidates every
-- reference every vendor holds at once, with no way to hand out the new ones.
-- And a derived reference cannot be retired for one member: revoking one means
-- changing the secret, which revokes everybody's. A row per member costs this
-- table and buys per-member revocation plus the reverse lookup an erasure
-- needs. See server/lib/subjectRefs.ts for the full argument.
--
-- BOTH COLUMNS ARE NOT NULL AND THAT IS DELIBERATE.
-- MySQL unique indexes exempt NULLs, so a nullable `user_id` inside the unique
-- key would admit unlimited duplicate references for one person. Two
-- references for one member is the worst failure this table can have: an
-- erasure clears one of them, reports success, and leaves the other resolving.
--
-- EXPAND ONLY. A new table with no foreign key and no change to anything
-- already running, so the previous release reads and writes exactly as before
-- and a rollback over this migration is a no-op.

CREATE TABLE IF NOT EXISTS `subject_refs` (
  -- The reference we hand out. 128 bits of randomness behind a `sub_` prefix,
  -- carrying nothing about its subject and unguessable from any other one.
  `ref` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  -- When this member was first referenced by anything outside the village.
  -- A village that connects no module never issues a reference, so an empty
  -- table is the normal state rather than a sign of a failure.
  `issued_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ref`),
  UNIQUE KEY `subject_refs_user_uq` (`user_id`)
);
