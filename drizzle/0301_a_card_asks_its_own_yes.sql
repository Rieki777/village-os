-- A session card asks its own yes, and finds a puller's cards by an index.
--
-- `member_gene_keys.card_in`: the member's own yes to being read on other
-- people's session cards. Until now a card read anyone who showed their lines
-- and let Maia use them, unless they had said no (`card_out`, 0296). The
-- security review of the module (Module Library Contract clause 13) asked
-- whether "Maia may use my lines" should also mean "read me on the room's
-- card"; whichever way that is ruled, the answer is one constant
-- (`CARDS_ASK_THEIR_OWN_YES`, shared/geneKeys.ts), and this column is what the
-- asking answer reads. Every existing row starts at 0: nobody has said yes yet.
--
-- `session_cards.pulled_by`: erasure deletes every card a member pulled
-- (`forgetCardsNaming`), and that half of its query had no index to use.
--
-- Expand only: one column with a default, one index. Nothing dropped or renamed.

ALTER TABLE `member_gene_keys`
  ADD COLUMN `card_in` tinyint(1) NOT NULL DEFAULT 0;

ALTER TABLE `session_cards`
  ADD KEY `session_cards_pulled_by` (`pulled_by`);
