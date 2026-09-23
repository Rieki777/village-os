-- 0212: a game variable can hold a paragraph, not just a line.
--
-- WHY. `value` has been varchar(255) since 0003, and 255 characters is the
-- reason `validateVariable` refuses a longer `text` value: the cap in the code
-- was describing the column. Every dial that wants to carry words a member
-- READS (a village's own description of a process, the sentence shown beside a
-- refusal) has had to be squeezed into a single line or left out of the
-- registry altogether. The new `longtext` variable type is that shape, and it
-- needs somewhere to live.
--
-- EXPAND, NEVER CONTRACT. varchar(255) to TEXT is a widening on the text
-- ladder (scripts/check-migration-compat.mjs), so a release rolled back over
-- this schema keeps working exactly as it did: every value it ever wrote still
-- fits, every SELECT still reads, and nothing it writes can overflow. NOT NULL
-- is unchanged, so no previously-legal write becomes illegal. TEXT holds
-- 65,535 bytes and the code caps a paragraph at 4,000 characters
-- (LONGTEXT_MAX), which cannot overflow the column even at four bytes a
-- character.
--
-- `value_type` IS LEFT ALONE, and that is deliberate rather than an omission.
-- `setVariable` writes the literal 'text' into that column for every dial of
-- every type, so the enum records how the value is stored and never which kind
-- of dial it is; the registry in shared/gameVariables.ts is the authority on
-- the type. Adding a 'longtext' member here would add an enum value nothing
-- writes, and a rollback would then meet rows it has no name for.

ALTER TABLE `game_variables`
  MODIFY COLUMN `value` text NOT NULL;
