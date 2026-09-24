-- 0221: a seat carries what a module knows about it.
--
-- WHAT THIS IS FOR.
-- A connected module reads an outside service that holds far more about a role
-- or a circle than this village's own chart models. The service knows a role's
-- type, how it is assigned, when it was last audited and when it is next due.
-- Our seat knows its name, its aim, its accountabilities and who sits in it.
-- Both are right and they are not the same vocabulary.
--
-- Rye's ask, 2026-09-24: when the module is on, a member looking at a role can
-- open a panel and read what the service holds, so they can judge what a seat
-- actually involves before putting their hand up for it. That needs somewhere
-- for the service's own fields to live.
--
-- WHY NOT COLUMNS ON `org_roles`.
-- Three reasons and the third is the one that decided it.
-- A migration per vendor field bakes one service's vocabulary into this
-- platform's core schema, and a second service would need its own.
-- `server/lib/orgChart.ts` already carries the scar: six columns have been
-- writable since 0049 and are selected by nothing, so the data went in and was
-- never seen again.
-- And a column on a core table cannot be revoked. Turning a module off is the
-- lever a village has, and 0140 states the rule this table obeys: every row a
-- module produced has to be findable by that module's id alone.
--
-- WHY `module_id` IS A PLAIN STRING.
-- Exactly as in `external_proposals`. It is not a foreign key to any listing,
-- because a listing can be withdrawn while its rows must stay findable, and
-- because a village can hold rows from a module this deployment no longer
-- ships. The id is the revocation grain, not a reference.
--
-- WHY `fields` IS JSON AND OPAQUE.
-- The keys are the VENDOR'S OWN field names and nothing here interprets a
-- value. That is structural rather than a matter of discipline: a status whose
-- enumeration nobody has sent us cannot be acted on if no code can name it. The
-- allow list in `server/lib/saberraRecords.ts` decides what may be in here at
-- all, and no field that names a person is in that list.
--
-- WHY `entity_id` IS NULLABLE.
-- A record can arrive before the thing it describes exists here. A circle the
-- service holds and this village has not created yet still has detail worth
-- keeping, and it is attached by NAME in `attaches_to` until a seat or circle
-- id exists to point at. Nullable is the honest state rather than a gap.
--
-- ROLLBACK.
-- A new table and nothing else. The previous release neither reads nor writes
-- it, so putting the old image back over a migrated database is safe.

CREATE TABLE IF NOT EXISTS module_entity_facts (
  id VARCHAR(64) NOT NULL,
  village_id VARCHAR(64) NOT NULL,
  module_id VARCHAR(64) NOT NULL,
  entity_kind VARCHAR(24) NOT NULL,
  entity_id VARCHAR(96) NULL,
  vendor_kind VARCHAR(40) NOT NULL,
  vendor_record_id VARCHAR(200) NOT NULL,
  attaches_to VARCHAR(200) NULL,
  fields JSON NOT NULL,
  source_url VARCHAR(400) NULL,
  observed_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_module_record (module_id, vendor_kind, vendor_record_id),
  KEY ix_entity (entity_kind, entity_id),
  KEY ix_module (module_id)
) ENGINE=InnoDB;
-- No CHARSET or COLLATE clause, deliberately, for the reason 0198 and 0106
-- give: these ids are joined against columns in tables that inherited the
-- database's own collation, and naming one here splits a fork whose database
-- default differs.
