-- 0371: the address book remembers the language a person was using on the
-- site when they gave us their address (an email-list or guest signup), so
-- the village can write to them in it. A role proposal's emails read it as
-- the second source of an applicant's language (shared/applicantLanguage.ts).
--
-- Expand only and nullable. A site language tag such as es. Null for every
-- address met before this. Removed with the contact row.
ALTER TABLE `comms_contacts`
  ADD COLUMN `locale` varchar(16) NULL;
