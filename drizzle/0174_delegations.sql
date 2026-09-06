-- 0174: vote delegation. One table and one column.
--
-- WHAT A DELEGATION IS. A member hands their voice to another member they
-- trust. The delegate's choice is COPIED into the delegator's own ballot_votes
-- row. The weight never moves. That single decision is what keeps the rest of
-- the engine honest: "9 of 12 people voted" still counts nine rows whoever
-- decided them, the frozen electorate still says who may vote and how much
-- each vote counts, and changing a delegation while a ballot runs is the same
-- class of act as changing your own vote, which an open ballot already allows.
--
-- ONE LIVE DELEGATION PER MEMBER, enforced by the primary key rather than by
-- application code. `delegator_id` is the whole key, so a member has at most
-- one row ever; giving a delegation to somebody new overwrites the row, and
-- revoking stamps `revoked_at`. A row with `revoked_at` set is a member who
-- decides for themselves again, which is why the column is nullable and why
-- every read that means "live" says `revoked_at IS NULL` out loud.
--
-- WHY NOT A HISTORY TABLE. A per-change trail was considered and turned down.
-- The delegator already sees the outcome of every delegation they ever gave,
-- because a delegated vote sits in their own row on the ballot it decided and
-- carries `followed_user_id`. That is a per-ballot record of who they actually
-- followed, permanent, on the artifact the decision happened on. A second
-- trail keyed on the member would be a second copy of the same fact, and the
-- two copies would disagree the first time somebody backfilled one of them.
--
-- CHAINS ARE TRANSITIVE, AND CYCLES ARE REFUSED AT CREATION. A delegates to B
-- and B delegates to C, so A follows C. Nothing in this schema can express
-- that rule, so nothing here enforces it: `server/lib/delegation.ts` walks the
-- chain before it writes and refuses a delegation that would close a loop. The
-- refusal has to happen at creation because a cycle discovered at tally time
-- is an infinite loop in the one routine nobody wants to debug at a season
-- boundary. The walker is written with a visited set as well, so a row written
-- by hand around the route stops the walk instead of hanging it.
--
-- No CHARSET clause, deliberately, following 0089: these columns inherit the
-- database's collation because `delegator_id` and `delegate_id` join users.id.
-- No FK constraints, house norm.

CREATE TABLE IF NOT EXISTS `delegations` (
  `delegator_id` varchar(64) NOT NULL,
  `delegate_id` varchar(64) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL means live. Set means this member decides for themselves again.
  `revoked_at` datetime NULL,
  PRIMARY KEY (`delegator_id`)
) ENGINE=InnoDB;

-- Who follows me, which is the read the concentration view and every
-- re-derivation perform. Non-unique on purpose: many members may follow one.
CREATE INDEX `idx_delegations_delegate` ON `delegations` (`delegate_id`);

-- PROVENANCE ON THE VOTE ITSELF. NULL means the member decided this one
-- themselves, and an own vote is never overwritten by delegation machinery.
-- A value is the member whose choice was copied here, which is the FINAL
-- decider at the end of the chain rather than whoever the delegator named.
-- A delegator who named B and was decided by C four hops away needs to read
-- C, because C is the concentration the transparency ruling exists to show.
ALTER TABLE `ballot_votes` ADD COLUMN `followed_user_id` varchar(64) NULL;
