-- 0306: after launch, a keystone secret waits for a second person (the setup
-- game's co-sign, SETUP_GAME_COSIGN_DESIGN_2026-10-31).
--
-- `keystoneRule` in shared/guilds.ts has always said what planting a keystone
-- asks for after launch: a second person's co-sign, or a cooling-off pause
-- when nobody else can co-sign. Nothing enforced it, and
-- `PUT /api/admin/integrations/:key` saved at once for any admin. A row here
-- is one such planting, waiting.
--
-- THE ROW PINS WHAT WAS ASKED, the shape `admin_mint_requests` (0106) set:
-- the slot, the value sealed exactly as the secrets store seals it, and who
-- asked. The co-sign reads the value from HERE and never from the co-signer's
-- request, so nobody agrees to a value they were not shown the slot of.
--
-- THE VALUE NEVER OUTLIVES ITS DECISION. `ciphertext`, `iv` and `tag` are
-- NULLed the moment a row leaves `pending`, whichever way it leaves.
--
-- `mode` is `cosign`, or `cooling_off` when nobody else could co-sign at the
-- asking, and then `applies_at` is when it lands unless somebody declines.
-- `status` moves out of `pending` by `UPDATE ... WHERE status = 'pending'`, so
-- two people pressing at once make one decision.
--
-- No CHARSET clause, house norm since 28dace2. No foreign keys, house norm.
-- `--` comments sit on their own lines and never end in a semicolon.
CREATE TABLE IF NOT EXISTS `planting_requests` (
  `id` varchar(64) NOT NULL,
  `slot` varchar(64) NOT NULL,
  `ciphertext` text NULL,
  `iv` varchar(64) NULL,
  `tag` varchar(64) NULL,
  `last4` varchar(8) NOT NULL,
  `requested_by` varchar(64) NOT NULL,
  `requested_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `mode` varchar(16) NOT NULL,
  `applies_at` datetime NULL,
  `expires_at` datetime NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `decided_by` varchar(64) NULL,
  `decided_at` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `idx_planting_open` (`status`, `slot`)
);
