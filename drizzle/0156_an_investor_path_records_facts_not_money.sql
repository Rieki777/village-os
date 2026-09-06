-- 0156: where a member stands on the investor path, recorded as dated facts
-- and carrying no figure of any kind.
--
-- ── WHAT EXISTED BEFORE THIS, AND WHY NONE OF IT IS A MEMBER RECORD ──────
-- Three tables sound like they might already answer "how far along the
-- investor path is this person", and not one of them does:
--
--   payments_log (0021)   a Stripe WEBHOOK AUDIT. stripe_event_id, outcome,
--                         latency_ms, a dedupe key. It has no user column at
--                         all, because it is the ops rider for the payment
--                         path and not a record about anybody.
--   investor_docs (0001)  a DOCUMENT SHELF: title, url, sort_order, and
--                         since 0104 an in_packet flag an admin sets one
--                         document at a time. It describes documents.
--   submissions (0001)    an anonymous intake blob. The investor packet is
--                         released today to whatever address a stranger
--                         types into a form, so the row it leaves behind
--                         says an email asked, and not that a member did.
--
-- So the investor path is the one path of the four with no per-member fact
-- anywhere, which is why this table exists and the resident one (0159) did
-- not need to.
--
-- ── THIS IS NOT A LEDGER, AND HERE IS THE MECHANICAL GUARANTEE ───────────
-- THERE IS NO NUMERIC COLUMN IN THIS TABLE. Not an amount, not a unit count,
-- not a currency, not a valuation, not a percentage. That is the design, and
-- it is deliberately enforced by the schema itself rather than by a comment
-- asking people to be careful, because a comment cannot stop an INSERT.
--
-- The reason is the one server/lib/ledger.ts states in its own header:
-- equity and voice are HYPHA-GOVERNED tokens that live on Base and are
-- mirrored here READ-ONLY, and if this platform ever posted one "it would
-- quietly become the source of truth for the cap table, which decision 5
-- says it must never be". Boot invariants fail loud on it. A column here
-- holding how much somebody put in would be exactly that forbidden second
-- source: a member-facing number about capital, written outside
-- postTransfer, outside the per-token SUM(balance) = 0 invariant, outside
-- token_balances' recompute-never-increment discipline, and reconciled
-- against nothing. On the day it disagreed with Base there would be no way
-- to say which one lied, and this table would be the more convenient one to
-- believe.
--
-- So the two live at right angles and cannot contradict each other, because
-- they answer different questions and neither can express the other's:
--
--   the ledger        HOW MUCH, and it is the only thing that may say so.
--   this table        WHAT HAPPENED AND WHEN, in words and dates only.
--
-- A ladder rung that is about holdings is therefore DERIVED at read time
-- from the ledger's mirror, never from a row here. Nothing in this file
-- duplicates a ledger value, so nothing in this file can drift from one.
--
-- `detail` is free words a human reads. It is never parsed, never summed and
-- never indexed, and a figure typed into it is a note rather than a number
-- the platform knows.
--
-- ── FACTS WITH DATES, NEVER A RUNG ───────────────────────────────────────
-- One row is one thing that happened to one person, with the day it started
-- and, when it stops being true, the day it stopped and why. No row holds a
-- position, a level or a rung. Position is computed from the rows that are
-- live at the moment somebody looks, exactly the way computeStage in
-- server/index.ts computes the Path of Growth from quests, membership and
-- training instead of reading a stored stage.
--
-- That is what makes a rung DROP with no update path: revoking packet access
-- ends one row, the next read finds one fewer live fact, and the position
-- falls out lower on its own. Nothing had to remember to write it down, so
-- nothing can forget to.
--
-- ── WHY THERE IS NO SEPARATE CROSSING-EVENT TABLE ────────────────────────
-- The brief pointed at stage_events (0003) as the precedent for keeping
-- history when a position falls. The history requirement is real and this
-- shape already meets it: every row is an INTERVAL, so a fact that ended
-- last spring is still sitting here with its started_at, its ended_at and
-- its ended_reason. Reading history means reading this table with the live
-- filter dropped.
--
-- A second table logging crossings would store `to_rung` with a date, which
-- is a stored rung wearing a different hat, and it would be a second record
-- of the same event that can disagree with the first. stage_events survives
-- that objection because it is an audit of an ACT an admin performed and
-- computeStage never reads it; a crossing log for a derived ladder has no
-- such independent thing to be about. So the interval columns carry the
-- history and no rung is written anywhere.
--
-- ── SHAPE, COPIED FROM org_role_assignments (0049) ───────────────────────
-- The steward path already solves "a thing that is true for a while and then
-- stops" and this follows it column for column: started_at / ended_at /
-- ended_reason, plus the generated active-key trick that makes MySQL's NULL
-- exemption work FOR the design instead of against it. active_fact_key is
-- the (user, fact) pair while the fact is live and NULL once it ends, so one
-- member may hold one fact once at a time and may hold it again years later
-- without colliding with their own history.
--
-- varchar and not enum for `fact`, the reason 0077 gives for taken_source
-- and 0060 for address_source: the set will grow, an enum change is a table
-- rebuild, and removing an enum value is forbidden by the compat rule.
-- The values this build writes:
--
--   interest_registered      they asked, as a signed-in member.
--   packet_released          the investor packet was released to them.
--   accreditation_declared   they stated they qualify. A declaration is not
--                            a verification and this column never claims it
--                            is.
--   agreement_signed         a signed agreement exists. The DOCUMENT is the
--                            fact; its contents, and every figure in them,
--                            are not this platform's to hold.
--
-- No foreign key on document_id, matching 0077's reasoning: investor_docs
-- rows are administered independently and a reference to a document that
-- has since been removed should leave the fact standing rather than block
-- the delete or vanish with it.
--
-- No CHARSET clause, deliberately. This table joins to `users`.`id`, and
-- `users` (0001) inherits the schema default. Pinning utf8mb4 here while the
-- join target inherits is what produces the cross-era collation mismatch
-- that breaks these joins off the primary host. 0049, 0122 and 0123 all
-- inherit for the same reason.
--
-- ── EXPAND, NEVER CONTRACT ───────────────────────────────────────────────
-- A new table, which takes nothing away from anybody. The previous release
-- has never heard of it and runs unchanged. The UNIQUE key is legal because
-- it is born with the table: the compat rule forbids a new UNIQUE key on an
-- EXISTING table, where rows are already in place to violate it.

CREATE TABLE IF NOT EXISTS `investor_path_facts` (
  `id` varchar(64) NOT NULL,
  -- Same scope column every table in the 0069+ sequence carries.
  `village_id` varchar(64) NOT NULL DEFAULT 'local',
  -- NOT NULL. Unlike housing_reservations, which exists to accept leads from
  -- people with no account, every row here is ABOUT a member: a fact with no
  -- member is not a fact on anybody's path. A lead who has not signed up is
  -- already recorded, as a submission.
  `user_id` varchar(64) NOT NULL,
  `fact` varchar(48) NOT NULL,
  -- Words a human reads. Never parsed, never summed, never indexed.
  `detail` varchar(280) NULL,
  -- investor_docs.id when this fact is about one document, NULL otherwise.
  `document_id` varchar(64) NULL,
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL means still true. This column, and not any stored position, is what
  -- makes a rung fall.
  `ended_at` timestamp NULL,
  `ended_reason` varchar(160) NULL,
  -- Who recorded it. NULL when the member's own action created it.
  `recorded_by` varchar(64) NULL,
  -- Standing-example row: display only, and never counted by a ladder. Same
  -- column and same hazard as org_role_assignments, where an example seating
  -- must not promote a real member.
  `is_example` tinyint(1) NOT NULL DEFAULT 0,
  `active_fact_key` varchar(120) AS (IF(`ended_at` IS NULL, CONCAT(`user_id`, ':', `fact`), NULL)) STORED,
  PRIMARY KEY (`id`),
  -- One live instance of one fact per member per village. A double-pressed
  -- button fails its second INSERT instead of leaving two live rows that
  -- disagree about when something happened.
  UNIQUE KEY `investor_path_facts_active_uq` (`village_id`, `active_fact_key`),
  -- The ladder read: one member's live facts, a prefix lookup.
  KEY `investor_path_facts_user_idx` (`village_id`, `user_id`, `ended_at`),
  -- The founder's read: everyone who currently holds one fact.
  KEY `investor_path_facts_fact_idx` (`village_id`, `fact`, `ended_at`)
);
