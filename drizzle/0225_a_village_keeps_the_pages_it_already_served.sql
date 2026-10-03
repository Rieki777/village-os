-- 0225: a village keeps the brochure pages it was already serving, and a new
-- village starts without them.
--
-- The brochure pages are the first village's own story, compiled into the
-- client (the list and the reasoning are in shared/brochure.ts). From 1.2.0 the
-- server serves them only when `app_config` holds a `brochure-pages` document
-- reading enabled true, and an ABSENT document means off. Off has to be the
-- default, because a new village should not open its doors wearing somebody
-- else's history, journeys and membership form.
--
-- That default cannot be allowed to reach a village that is already live.
-- Every database that exists today has been serving these pages since it was
-- created, and turning them off on deploy day would remove its home page
-- content, its footer links and its membership form with nobody having asked.
-- So this writes the switch ON, explicitly, wherever the evidence says the
-- village is already in use, and writes nothing anywhere else.
--
-- THE EVIDENCE is one member row. Migrations run at boot before anything can
-- create an account, so a fresh database has no users when this runs and gets
-- no row: its pages stay off, which is the point. A database with members has
-- been serving the pages to them and keeps doing so. Scratch test schemas are
-- empty when they migrate, so every suite sees a new village unless it writes
-- the document itself.
--
-- The note travels inside the document so that anybody reading app_config
-- learns where the ON came from without having to find this file.
--
-- Idempotent: INSERT IGNORE on the primary key. A re-run is a no-op, and a
-- village that has since turned its pages off keeps the row it wrote.

INSERT IGNORE INTO `app_config` (`config_key`, `value`)
SELECT
  'brochure-pages',
  '{"enabled": true, "note": "Already serving the brochure pages when 1.2.0 arrived, so migration 0225 kept them on. A new village starts without them."}'
FROM DUAL
WHERE EXISTS (SELECT 1 FROM `users`);
