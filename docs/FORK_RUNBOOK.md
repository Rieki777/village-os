# Fork Onboarding Runbook (living document)

**Rule (from MODULES_MASTER_PLAN.md v3, S56):** every session that adds an env
var, seed file, or provisioning step appends one line here, so extraction
assembles this runbook instead of reverse-engineering it. Keep entries terse:
what, where, what breaks without it.

## Provisioning

- Railway project + service (nixpacks), volume mounted at `/app/data` — seeds
  live in `server/seeds/`, never in `data/` (volume shadows the image).
- MySQL service on the private network; `DATABASE_URL` referenced on the app
  service. Run `pnpm db:migrate`; verify with `pnpm db:status`.
- GitHub repo connected with auto-deploy on `main` (Railway GitHub App needs
  repo access; sudo-mode approval required once).

## Environment variables

| Var | Purpose | Without it |
|---|---|---|
| `AUTH_TOKEN_SECRET` | Signs member tokens | **Silently degrades to per-process sessions** — logins die on every restart |
| `ADMIN_PASSWORD` | Bootstrap-only (S1): each fork sets its own value and uses it once to create its founder via `POST /api/admin/bootstrap`. **That response carries `claimUrl`, and on a fresh install it will also carry `emailed: false` and an `emailNote` saying why: a new deployment has no mail provider, so open the claim link yourself rather than waiting for an email. It used to answer `emailed: true` in exactly that case.** Inert after bootstrap — keeping it set is fine (foundation policy, Rye 2026-07-26); deleting it is optional hygiene. | No founder can be created |
| `JOURNEY_PASSWORD` | Legacy Command Centre gate — retired at v3 S2 | — |
| `BREAK_GLASS_ADMIN_EMAIL` | (from S1) may re-elevate exactly that account | No recovery if all admins are demoted |
| `ANTHROPIC_API_KEY` | Maia guided proposals (`/api/assistant/*`), the launch guide, the map concierge tie-break, and call synthesis (S54). **S63: settable from Admin → Integrations instead** — an admin-typed key beats this env var; reads are masked (last4 only). | Assistant hides; forms still work; call synthesis refuses with an honest 503 while ingestion, transcripts and publishing keep working |
| `ANTHROPIC_BASE_URL` | (optional, dev/CI) points the assistant at a stub instead of api.anthropic.com | Defaults to the real API |
| `PLATFORM_ASSISTANT_KEY` | (S76, optional) A ReGen-provisioned key this deployment may BORROW until the village adds its own. Set at provisioning by whoever has deploy access, deliberately never an admin toggle: a screen that lets a deployment start spending someone else's money is a screen that eventually does. The village's own key (Admin → Integrations, or `ANTHROPIC_API_KEY`) always wins the moment it exists, with no restart. A borrowed key must not survive handoff, since the village loses Maia the day it rotates. | No borrowing: the assistant is simply unavailable until the village adds a key |
| `PLATFORM_ASSISTANT_DAILY_CAP` | (S76, optional) Calls per day allowed against the borrowed key, counted separately from every per-mode budget so a demo fork cannot spend a production village's headroom. `0` means zero, never unlimited. | 100 |
| `MEMBER_SECRETS_KEY` | (round 4, Your agent) 32 random bytes as 64 hex characters (`openssl rand -hex 32`), set at provisioning. Encrypts each member's own LLM key at rest (AES-256-GCM, `server/lib/memberSecrets.ts`) and derives each member's agent-inbox signing secret. **Rotating it makes every stored member key unreadable**: members re-enter theirs and re-save their inbox URL. Deliberately no per-process fallback: a random key would store credentials this deployment could never read again after its next restart. Agent tokens (`vat_`) do NOT depend on it; they are hashed. Optional flag beside it: `AGENT_INTENT_WRITE=1` opens `POST /api/agent/v1/intents` once the introductions module has landed (leave unset until then). | The profile's "Run the assistant on your key" and "Agent inbox" sections say "this deployment has no member-secrets key; ask your operator" and refuse to store anything; bring-your-agent tokens, the skills and every read still work |
| `RESEND_API_KEY` | Transactional email. **S63: settable from Admin → Integrations instead** — admin-typed beats env, masked on read. | Emails silently skipped (logged) |
| ↳ *sender domain* | **Every fork must verify its sender domain in Resend (resend.com/domains: SPF + DKIM records in the domain's DNS).** Resend returns 200 on unverified domains and delivers NOTHING — email death is silent. **Amora handoff item (Rye, 2026-07-26): `amora.cr` is unverified and only its team can add the DNS records — verify it during handoff.** | Claim links & notifications never arrive |
| `EMAIL_FROM` | The `From:` address every village email leaves under — `name@example.org` or `Village Name <name@example.org>`. **Settable from Admin → Email config instead** (admin-typed beats this env var, and a malformed value there is refused at the door). Must be on the domain verified in Resend, or the send 200s and delivers nothing. **Set this during any fork's provisioning** — otherwise mail goes out under the platform's fallback sender, which is the first village's domain. | Falls back to the platform's own sender address |
| `FRONTEND_URL` | This village's own public address, e.g. `https://village.example.org`. Two things read it: the CORS allow-origin header, and every absolute link this server writes into an outgoing email (claim links, digests, the weekly brief). **Set it during any fork's provisioning.** It used to fall back to one specific project's domain, so a fork that left it unset mailed its own members a link to somebody else's login page and nobody found out until a member clicked one. That fallback is gone. | No CORS grant is sent at all, which refuses cross-origin readers rather than trusting a stranger. Email links fall back to the address this server has actually been reached at, taken from the first inbound request's proxy headers. If nothing has reached it yet, links have no absolute address and one log line names this variable |
| `STRIPE_SECRET_KEY` | (S32) Stripe API key (`sk_live_…`) — powers card checkout for every fiat module (stays, exchange). **S63: settable from Admin → Integrations instead — no Railway access needed.** **Amora handoff item (Rye, 2026-07-26): the Amora team creates its own Stripe account and connects it during handoff** — until then card checkout answers an honest 503 and manual payments carry stays. | Card checkout disabled (503); manual payment path still works |
| `STRIPE_WEBHOOK_SECRET` | (S32) Signing secret (`whsec_…`) for the ONE webhook endpoint `POST /api/webhooks/stripe`. **S63: settable from Admin → Integrations, which also displays the exact URL to paste into Stripe.** Create the endpoint in the Stripe dashboard (Developers → Webhooks) pointing at `https://<your-domain>/api/webhooks/stripe`, subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `charge.refunded`, `charge.dispute.created`, then copy its signing secret here. **All five matter**: `invoice.paid` is how every recurring product renews (without it a subscription charges the member forever and delivers only the first period), and `checkout.session.async_payment_succeeded` is how delayed-notification methods — SEPA debit, ACH, Boleto — confirm days later (without it those purchases never settle at all, because `completed` arrives `unpaid` and is correctly ignored). **Amora handoff item (Rye, 2026-07-26): create the endpoint + set this secret together with `STRIPE_SECRET_KEY` — a missing secret means unsigned events are processed only in dev shapes; a wrong one rejects every settlement with `sig_fail` alerts to admins.** Test with `stripe listen --forward-to` before go-live. | Settlements unverified or rejected; orders never credit |
| `RIVERSIDE_WEBHOOK_SECRET` | Shared secret for `POST /api/webhooks/riverside` (automation module). **Settable from Admin → Integrations instead** — admin-typed beats env, masked on read. The webhook **fails closed**: without a configured secret, or without a matching `x-riverside-secret` header on the delivery, every payload is discarded with an inert 200 (the automation admin card shows a warning while unset). Configure Riverside to send the same value as the `x-riverside-secret` header. | Riverside deliveries are silently discarded until the secret is set |
| `GOVERNANCE_HUB_SECRET` | Shared secret for `POST /api/webhooks/mechanics-governance` — how a Hypha vote's outcome comes home. **Settable from Admin → Integrations instead** (admin-typed beats env, masked on read). The ReGen hub runs ONE Alchemy listener on Base for every fork; when a proposal carrying a `[gm:…]` marker executes on-chain, the hub POSTs the outcome here with this secret as the `x-governance-hub-secret` header. **Fails closed**: unset or mismatched = every delivery discarded with an inert 200. Until your fork is registered with the hub, outcomes are reported by the proposer and applied by an admin ("Verify & apply"). | Verified outcomes never arrive; the human verify-and-apply path still works |
| `BASESCAN_API_KEY` | (optional) Etherscan/Basescan API key for **Admin → Game Mechanics → Hypha Bridge**: after the founder issues themselves a token on Hypha, the token's contract address on Base is discovered from the founder's account history (`hypha.founder_base_address`) and listed for the founder to confirm. **Settable from Admin → Integrations instead** (admin-typed beats env, masked on read). One free key from etherscan.io serves Base via the V2 API. | The contract lookup answers 409 with guidance; contract addresses can still be pasted by hand from basescan.org |
| `FEEDBACK_HUB_URL` | (S66, optional) **must be `https://` and publicly resolvable** — the relay now dials through the pinned-IP guard, which refuses plain http and any private/loopback/CGNAT address. A self-hosted hub on a VPC-internal or `http://` address will simply never receive anything (rows stay queued locally, no data is lost, one log line per attempt). Where the feedback relay POSTs. **There is no default, and that is deliberate**: the relay is ON by default (`platform.feedback_relay` game variable) and it ships up to 8000 characters of member-written detail per item, so a hardcoded destination meant every fork posted its members' words to one specific organisation without ever choosing to. **A deployment that wants the relay must name its hub here, including the hosted one.** It sends CONTENT only (never who submitted), queues locally and retries while the hub is unreachable; turning the dial off keeps everything in Admin → Feedback, local-only. | The relay does not run. Feedback stays local, admins still see every item in Admin → Feedback, and the submission form correctly says it is not shared |
| `ERROR_WEBHOOK_URL` | (optional, PY6) an HTTPS endpoint that receives a JSON POST when something crashes — a Slack or Discord incoming webhook, a Sentry store URL, or your own collector. Admins are ALWAYS notified in-app regardless; this puts the same alert where your team actually looks. Deduped to one alert per distinct failure per hour, and dialled through the pinned-IP guard like every other outbound call. | Crashes are still logged and still alert admins in-app, but nothing reaches an external channel |
| `TRUSTED_PROXY_HOPS` | (optional, default `1`) how many proxies sit in front of this process. `X-Forwarded-For` grows left to right, so the client's real address is the Nth entry from the RIGHT, where N is this number — and everything to its left is caller-supplied and forgeable. Every rate limit (checkout attempts, sign-in throttling, the assistant's cost cap, the abuse guard) keys on the result. `1` is correct on Railway, Fly and Render; raise it if the fork puts its own CDN or load balancer in front; `0` means no proxy and the socket address is used directly. | A value too LOW trusts a forged header and lets one caller bypass every rate limit; too HIGH buckets unrelated visitors together and throttles innocents |
| `PLATFORM_SUPPORT_URL` | (module library, optional) Where a village is sent when the PLATFORM is the supporting party: every Included module, and every Managed listing. Whoever operates this deployment is its own support desk, so platform code carries no address and this is where the fork puts one. It appears in the 503 body a lapsed Managed listing answers with. | The lapse body still says "this one is on us" and still says what keeps working; it just gives nowhere to write |
| `PLATFORM_SUPPORT_EMAIL` | (module library, optional) The same, as an address. Used when `PLATFORM_SUPPORT_URL` is unset. | As above |
| *a Managed listing's key* | (module library, per listing) Each Managed listing names its own env var in `vendor.managedEnvKey` in `shared/modules.ts`. The key is the PLATFORM's, is read from env at call time, is never added to `SECRET_KEYS`, and is never returned to a village by any route, not even masked (hub ADR-49). Set it at provisioning by whoever has deploy access; there is deliberately no admin screen for it, exactly as with `PLATFORM_ASSISTANT_KEY`. | That listing answers 503 with "this one is on us" and its Integrations card reads "Not on your plan". Everything else keeps working |
| *a Connected listing's key* | (module library, per listing) Each Connected listing names its slots in `vendor.secretKeys`. They join `SECRET_KEYS` automatically, so they are settable from **Admin → Integrations** with source and last4 shown, and this env var (the slot name uppercased, e.g. `example_api_key` → `EXAMPLE_API_KEY`) is the fallback. The village holds its own account and can rotate the key unaided. | That listing answers 503 naming the vendor and their support link. Everything else keeps working |
| `SATELLITE_PROVIDER` | (2026-09-02) Which aerial-imagery source the Living Map's land pages fetch from. One of `village-upload`, `sentinel2`, `mapbox`, `google`, `esri`, each of which then needs its own key below. `village-upload` needs no key, no account and no third-party licence: the founder's own photograph goes through the ordinary upload path. There is deliberately NO default and no keyless fallback, because a map quietly showing a different picture from the one the founder configured is a worse failure than a map saying nothing is configured. | The land page shows an honest empty state naming this variable |
| `SENTINEL_WMS_URL` / `MAPBOX_TOKEN` / `GOOGLE_MAPS_STATIC_KEY` / `ESRI_API_KEY` | (2026-09-02) The key for whichever provider `SATELLITE_PROVIDER` names (`keyEnv` in `server/lib/satellite.ts`). Sentinel takes a WMS base URL rather than a key, because every keyless route to Sentinel-2 is a WMS somebody operates and naming one here would point every village at a host this project does not run. Mapbox and Google forbid serving their imagery from a cache; Esri's standard layer is not licensed for holding tiles offline. | That provider reports not ready and names the exact missing variable |
| `BACKUP_EXPORT_TOKEN` | (2026-09-02) Authenticates `GET /api/admin/backup/uploads-archive`, which is how the scheduled backup pulls the uploads volume. This route is gated by the token and NOT by an admin session. 32 bytes of hex; mirror it as the backup workflow's secret. | The route answers 503, member uploads are in no backup, and the database dump keeps succeeding so the backup still looks green |
| `SCHEDULER_ENABLED` | (2026-09-02) Turns the background scheduler off when set to `0`/`off`/`false`/`no`. **Unset means ON**, which is correct. | Set by accident: loans never settle, cycles never close, digests never send, and the only signal is one boot-log line saying NOT STARTED and naming this variable |
| `HYPHA_LISTENER_*` | (2026-09-02) Fifteen variables for a village running its OWN Base listener process (`server/lib/hypha/selfHostedListener.ts`) instead of the shared ReGen hub. **The web process imports none of them**, so setting them changes nothing until that second process is started. Required: `CONTRACT_ADDRESS`, `RPC_URL`, `WEBHOOK_URL`, `WEBHOOK_SECRET`, `START_BLOCK` on a first run, and at least one of `PASSED_TOPIC0`/`FAILED_TOPIC0`. Optional: `AGREEMENT_ID_TOPIC_INDEX` (0-3), `SPACE_ID`, `CONFIRMATIONS`, `POLL_INTERVAL_MS`, `MAX_ATTEMPTS`, `DATA_DIR`, `CHECKPOINT_PATH`, `DEADLETTER_PATH`. | The listener refuses to start and names the first missing one. The shared hub path (`GOVERNANCE_HUB_SECRET`) is unaffected |
| `GOOGLE_TOKEN_ENDPOINT` | (dev/CI only) Points the Google token exchange at a local stand-in. Enforced: a value that is not an http loopback address is logged and ignored, and the real Google endpoint is used. | Google is used, which is correct in production |
| `TEST_DATABASE_URL` | (dev/CI only, local .env) scratch-schema MySQL for DB-backed tests. The harness creates a uniquely-named `village_test_*` schema per provision and drops it after; never point it at the app schema. It also keeps a `village_tpl_*` TEMPLATE schema, migrated once and cloned per suite, swept after 24 hours — so the account needs CREATE/DROP DATABASE rights and will show two families of scratch schema. `pnpm measure:provisioning` prints what that costs. | DB suites skip AND an unfiltered run fails; `ALLOW_NO_TEST_DB=1` accepts the smaller suite |

## Account recovery

Members can reset their own password: **"Forgot your password?"** on `/login` →
`/forgot-password` → a one-hour, single-use link. The route answers the same
200 for every address, known or not, so it cannot be used to discover who is a
member — which also means a fork with an unverified sender domain shows the
same success page while nothing is delivered. **Verify the sender domain
before launch** (see `RESEND_API_KEY` above); recovery depends on it.

Two admin levers sit beside it, for the member whose address on file is wrong:
`POST /api/admin/users/:id/send-password-link` (emails a link, never returns
it; a plain admin may not target a founder) and the existing
`POST /api/admin/users/:id/revoke-sessions`.

Note the session semantics, because members notice: `tokenVersion` is the only
revocation lever there is, so **signing out, or setting a new password, ends
every session on every device**. Per-session sign-out would need a sessions
table.

## Game mechanics: rings, the public snapshot, the amendment ledger

Every mechanic lives in the variables registry (`shared/gameVariables.ts`) —
the single source of truth. Each variable carries a **ring**: `open` dials are
the community-governable surface (the coming Hypha proposal loop operates only
on these); `founder` dials (infrastructure, legal posture, privacy windows,
abuse guards) stay admin-held. The **constitution** (`shared/constitution.ts`)
is the plain-language list of what no vote can change — shown at the top of
the public page; edits there change copy, never enforcement.

Two public, unauthenticated endpoints serve the whole story:
`GET /api/game/mechanics` (constitution + every variable of every running
module, with ring, bounds, default, current value, and when a change takes
effect) and `GET /api/game/mechanics/history` (the amendment ledger: every
change with actor first-name, source, and — once the governance loop lands —
the Hypha proposal reference). Everything is deliberately visible: rule sets
are how future players compare forks.

The per-stage mechanics (`progression.multiplier.*`, `progression.quests_for.*`,
`progression.unlock.*`) are generated from your stage ladder in
`shared/gameConfig.ts` — edit the ladder and the registry follows at next
deploy, with your config values as the defaults.

**Members change the rules from the page.** Community dials are editable in
place on `/game-mechanics`: staged changes become a proposal (title +
rationale), which gathers in-game support, goes to your Hypha for the binding
vote (the copy carries a `[gm:…]` marker — keep it in the Hypha proposal
title), and is applied by an admin after verifying the pass ("Verify & apply"
on the proposal card; automated on-chain verification is the next phase).
Who may propose is yours to tune: the base is ANY MEMBER
(`progression.unlock.mechanics.propose`, default member); raise the rung, set
it to role/badge-only, require earned recognition
(`governance.hypha_threshold`), demand in-game supporters before the vote
(`governance.proposal_support_threshold`), cool changed dials down
(`governance.change_cooldown_days`), and cap proposals per member per cycle
(`governance.proposals_per_member_per_cycle`). Members below the bar can
always draft; a qualified member's sponsorship opens the draft.

## Tunable abuse guards

The throttles are game variables (Admin → Game Mechanics → *Abuse guards*), so
a village can loosen or tighten them without a deploy: registrations per IP
per hour, failed sign-ins per IP and **per account** per 15 minutes (successful
sign-ins never count against either), password-reset requests per IP per hour,
and investor-packet requests per IP per hour. Every bucket is per-IP unless it
says per-account, so **one shared village connection is one bucket** — set them
above the size of a gathering, not to the size of one person's usage.

- Messaging adds two more (visible once the `messaging` module is on): `messaging.sends_per_minute` (default 20) is per MEMBER across every conversation, with a looser per-IP bucket beside it so one stolen token cannot spray the village; `messaging.max_members` (default 50) caps a group conversation and is therefore also the size of the loudest single send anyone can make. The module needs no env var, no seed, and no provisioning step: it ships OFF like every non-core module, and enabling it is the whole setup.

## Seeds & per-deployment data

- `server/seeds/content-seed.json`, `quests-seed.json` — page copy + quest
  library (self-heals via `seedIfMissingOrEmpty`).
- `server/seeds/examples-seed.json` — STANDING EXAMPLES: platform-authored
  worked content revealed when a module is first enabled, so a founder meets a
  working module instead of "No items yet." Inert (every mutation refused) and
  retired permanently by the first real item that module receives. Seeds AFTER
  the real seeds above, so it never displaces your starter content. Clear early
  with `POST /api/admin/modules/:id/examples/clear`; prove inertness with
  `node scripts/check-examples.mjs`. See `docs/STANDING_EXAMPLES.md`.
- `tokens` table rows (a fresh village seeds gratitude/equity/voice/credits,
  and stay-credit, library-credit and village-voice arrive at first boot) - a
  fork renames its recognition token HERE AND NOWHERE ELSE, through Admin,
  The Game, Tokens. The registry is the single source of truth for a token's
  display name (`mergedConfig()` reads `tokens`.`name` ahead of both the brand
  overlay and `shared/gameConfig.ts`). Rename the NAME only: the slug is what
  every ledger row and balance is written against, so the API refuses a slug
  edit and says why.
- The `brand` row of the `app_config` table, via the admin Setup Wizard
  ("Make This Yours"): identity, images (uploaded, sharp-compressed), dues,
  personas.
- Game variables: only CHANGED values are stored; platform defaults inherit.

## Brand overlay (make it yours)

The platform keeps three layers apart, on purpose: **identity** in
`shared/gameConfig.ts` (names, paths, the stage ladder, images),
**behaviour** in `shared/gameVariables.ts` (how much, how often, which
mode), **per-deployment data** in DB rows and seeds. A fork edits the last
two from the admin panel and almost never touches the first.

- **The overlay:** the `brand` row of the `app_config` table, edited by the
  admin Setup Wizard ("Make This Yours"), is merged OVER `gameConfig.ts` by
  `mergedConfig()` and served at `/api/game/config`. A blank field inherits
  the platform default, so a fork overrides only what differs.

  There is NO FILE. The overlay was a file at data/brand.json before the MySQL
  cutover, and three documents went on naming that path for months, which cost
  a lane a day of looking for a file no code reads. The path is written here
  without backticks on purpose, so that scripts/check-doc-links.mjs never has
  to resolve a path this sentence exists to say is gone. The live read path is
  `dbDocument(getPool(), "brand", DEFAULT_BRAND)` at `server/index.ts:1361`,
  defined in `server/repos/store-db.ts`.

  **That document is cached in the process, and only boot fills the cache.**
  `dbDocument.get()` is synchronous and answers from memory; `put()` writes
  the row and refreshes the cache in the process that served the write, and
  every `load()` call site for a document is in the boot block. So a change
  written to the row by SQL, by a script, or by another container does not
  reach a running server. `GET /api/admin/brand/preview` reads the row
  directly and reports the disagreement, and `POST /api/admin/brand/resync`
  reloads the document without a deploy.
- **What you call whoever runs the village** (`project.catalystName`,
  2026-09-03): a brand-overlay field like the rest, default **Catalyst**, set in
  Identity beside "what a member is called". Every member-facing sentence that
  names one of those people reads your word instead: closing a vote, applying a
  draft, turning a module on, asking for help at sign-in.

  **It is a LABEL and it grants nothing.** There is no Catalyst role and no
  Catalyst capability. `isAdmin` and the single capability gate in
  `shared/capabilities.ts` are untouched, so the same accounts can do exactly
  what they could before and renaming this changes no permission anywhere. The
  ADMIN PANEL keeps its own name too, `/admin` included: a place is not a
  person, so "the admin panel" stays what it is called and only the human takes
  your word. Two words are derived and not typed: the article ("a" or "an") and
  the plural, so a village that types Elder reads "an Elder" and "Elders".
- **Wizard order:** Identity (project + village name, tagline, what a member
  is called, what whoever runs the village is called, main-site / events URLs,
  footer introduction) → Pictures (uploaded,
  sharp-compressed, never hotlinked — including the header logo, footer mark
  and browser tab icon, all live with no deploy) → Numbers (dues, budgets —
  these write game variables) → Content (page copy, FAQs) → Map & styling →
  Go live.
- **Map & styling (step 5)** writes `brand.skin`, which is the Living Map's
  OWN export format, field for field (`shared/mapSkin.ts`). Style the land
  inside the map, export, and the JSON drops straight in. Blank keeps the
  map's own look. Served to the map at `GET /api/map/skin`, which inherits
  the `map` module's gate. `painterly.brush` / `painterly.palette` are stored
  and round-trip through export, and the map does not re-apply them on load
  yet, so they change nothing on screen today.
- **The shell is overlay-driven.** The header logo, tab icon, footer mark,
  footer introduction, "Main Site"/"Events" links and copyright name all come
  from the brand config; a blank `siteUrl` renders NO outside links rather
  than a dead one. `client/index.html` is deliberately NEUTRAL — no village
  name, no canonical URL, no og:image — because it is served byte-for-byte
  to every deployment; the client repaints title and favicon from live
  config. A fork that wants crawler-visible metadata (og:image, canonical)
  adds it in its own fork where those values are actually true.
- **Fonts:** the platform self-hosts an all-OFL catalogue (@fontsource, latin
  subset, bundled with content hashes — no request ever leaves the origin for
  a typeface; offerings in `shared/fontCatalog.ts`). Admin → Make This Yours →
  Typography picks heading/body/accent faces with live previews, or uploads
  the village's own font file (.woff2 best; magic-byte-verified, stored in the
  uploads volume, served immutable) behind a **web-embedding licence
  acknowledgment** that gates the server and is recorded with who/when —
  "free to download" almost never includes web embedding, and the village
  that chooses a font carries its licence. Power path: set
  `brand.theme.fontImportUrl` to a hosted CSS file carrying `@font-face`.
  `/api/brand/theme.css` emits everything, sanitised; blank fields = neutral
  defaults; changes apply live with no deploy.
- **NOT overlayable** (code-level edits, deliberately): the stage ladder and
  its ids, the path definitions, season cadence semantics. Those are game
  DESIGN; changing them is a fork of the game, not a re-skin.
- **The guard:** `node scripts/check-brand-refs.mjs` runs in CI. Platform
  zones (`server/lib/**`, `shared/**` except `gameConfig.ts`) must contain
  no village's brand at all; the app shell, client pages, applied
  migrations and test fixtures are ratcheted — their counts may only fall.
  Forks extend the banned-terms list in that script with their own names.
- **The second guard, for the slots a word list cannot see:**
  `node scripts/check-identity-keys.mjs` checks every identity slot in
  `gameConfig.ts` is empty or platform-neutral, by key PRESENCE rather than by
  matching words. Two of the three strings that once leaked one village's
  identity into every fork's defaults carried no village name at all
  ("Co-Become the Most Beautiful Village"), so no word list could ever have
  seen them. A fork passes `--fork` and gets the report with exit 0, because a
  fork's `gameConfig.ts` is supposed to carry its own name.
  **Pending list: 3 as of 2026-09-02, down from 5.** `project.tagline`
  graduated on 08-31; `project.country` graduated on 09-02 (it was the only one
  of the four with no reader anywhere in `server/`, `shared/` or `client/src/`,
  so blanking it changed no pixel). `project.location`, `project.fiatCurrency`
  and `project.footerBlurb` all still render somewhere and still wait on the
  founder entering them in Admin first.
- **The third guard, for `.env.example`:** `node scripts/fork-env-audit.mjs`
  fails when the server reads a variable the template does not name, and when
  the template names a village. It exists because that file is not scanned by
  the brand guard (wrong extension) and had been drifting behind the code for
  25 variables, eight of which are also invisible to grep because the code
  reaches them through a string.
- **THE NINETEEN BROCHURE PAGES ARE STILL CODE, and this is the standing gap
  in fork-ability.** `SHOPFRONT` in `check-brand-refs.mjs` lists them; they
  carry 39 references to the first village and roughly 11,500 lines of its
  story. The exemption is correct (a village's prose about its own land is
  supposed to name it) and the consequence is not: replacing them is the one
  step in provisioning that still needs somebody who can edit TSX, and there
  is no per-page visibility switch, so a village that has not rewritten them
  is publishing them. Five pieces have been lifted into Admin already, by the
  pattern to keep using: the Team page, the Legal and Jurisdiction Notices
  (22 claims, commit fe3f3e1), the two Love Letter covenant paragraphs
  (`server/seeds/pages-covenant-seed.json`), the FAQs and the milestones. Each
  extraction is a section in `client/src/components/admin/contentSections.ts`
  plus a read through the generic `/api/content/:section` route. Nothing about
  the remaining pages needs new infrastructure, only the work.
  `docs/PROVISIONING.md` step 7 now tells founders this before they launch.
- **Images are WebP, and CI enforces it.**
  `node scripts/check-image-budget.mjs` walks `client/public` and fails on any
  raster that is not WebP or AVIF, on any single file over 400 KB, and on a
  total above `scripts/image-budget-baseline.json`. That total is a RATCHET:
  `--update-baseline` writes the new number only when it is lower, so the
  figure falls and never climbs.
  **What a fork needs to know.** Your own art goes in
  `client/public/assets/images` as WebP —
  `node scripts/compress-static-images.mjs --write` converts and right-sizes a
  directory of PNGs in one pass. Two kinds of file are exempt and you never
  edit the guard to say so: whatever `shared/gameConfig.ts` names as
  `images.favicon`, and whatever `client/index.html` declares as an icon or a
  social card. Those stay PNG because Safari's touch icon and link-preview
  crawlers have no dependable WebP support, and because the PWA manifest
  labels any non-SVG icon `image/png` regardless of what it really is.
  **A renamed brand file keeps working.** `/assets/images/<name>.png` falls
  back to `<name>.webp` when the PNG is gone (`server/index.ts`), so a path a
  wizard typed into the brand overlay two years ago still resolves after the
  conversion. No database migration is needed.
  **Large art belongs in the uploads volume**, not in `client/public`. The
  volume is content-addressed, cached correctly and swappable;
  `client/public` is served one-year-immutable and cannot be replaced for a
  year once a browser has it.
- **Member uploads are shrunk in the browser** by
  `client/src/lib/imagePrep.ts`: it draws to a canvas, encodes WebP and
  returns the ORIGINAL file whenever it cannot do that safely (SVG, GIF, a
  file already small, a browser whose canvas ignores the WebP mime and hands
  back PNG). That turns an 8 MB phone photo into a few hundred KB before it
  reaches the wire, which is minutes on the links this platform is built for.
- **Character portraits also live in the volume** (0158). A member may keep one
  picture per character class, from an upload or from a forge, stored as
  `portrait-*.webp` by `server/lib/characterPortraits.ts` and served from
  `/api/uploads/`. Every one is cropped to a fixed 3:4 at 900x1200 and
  re-encoded before it is written, so the per-file cost is bounded and one
  member can hold at most one file per class plus one undecided candidate.
  **They are PRIVATE until the member publishes them**, which is a rule the
  database enforces (`published_at IS NOT NULL` in the query a stranger's
  request runs), and it is why this surface has no moderation queue: an
  unpublished portrait has an audience of one. No env var, no seed and no
  provisioning step; the volume and the backup token above already cover it.
  Portrait FORGING needs an image provider and there is none in this build.
  `server/lib/assistantProviders.ts` is text-only, so the forge answers a
  readable refusal, hands back any grant it took, and the upload path works on
  its own. A village that wants forging installs a provider through
  `installPortraitForge`; nothing else has to change.
  The server still re-encodes what arrives, so the two are belt and braces.

## Token naming (Gate D)

**ONE PAGE NAMES EVERY TOKEN: Admin → Tokens.** That is the whole surface.

`docs/TOKENS.md` is the full account of what a fresh village holds: every
token, who issues it, who may move it, what a mint rule pays and what
happens at cycle close. It is generated from the migrations and the server
source and a build step fails when it drifts, so it is the one description
of the tokens that cannot go stale. This section is the operating
instructions; that file is the reference.

This section used to tell a founder to rename the recognition token in the
`tokens` row, in `shared/gameConfig.ts` AND in the brand overlay. Only the
first of those three was ever read. `mergedConfig()` (server/index.ts) computes
`pick(registryName, pick(brandName, configName))`, so the registry beats the
brand overlay, which beats the compiled default. The Setup Wizard's
"Recognition currency name" and "Currency, lowercase" boxes wrote the middle
layer and could never win; both boxes have been removed and the wizard now
links here instead. The launch checklist read the same dead field, so a
founder who renamed correctly stayed red forever and a founder who typed in the
dead box went green while changing nothing. It reads the registry now.

Three kinds of token, one naming surface:

1. **The recognition token** (the village's own word for appreciation):
   rename it in Admin → Tokens → rename. Every member-facing surface follows,
   because they all read `/api/game/config`, which reads the registry. The
   recognition token is a SIGNAL with no financial value; the public pages say
   so, and any renamed copy has to stay honest about that.
1b. **The value token** (whatever token `gratitude.pool_token` names,
   `credits` by default): the same rename, on the same page. Wallet, exchange
   and the public pages follow, reading the name from `/api/game/config`
   (`currency.value`). This is the token the cycle pool distributes across
   recognition, and the one the "converts to cash or equity as the village
   matures" promise attaches to.
2. **Per-module tokens, named at enable time (Gate D):** each funds-bearing
   module's token is created through Admin → Tokens with a name the village
   chooses (stay credits, library credits, whatever the village calls
   them). There is no shared platform credit token — one seller per token
   is boot-asserted, and the exchange refuses to list a token another
   module already sells.

**A SLUG IS NEVER RENAMED.** `slug` is the primary key of `tokens` and every
repeat-protection key in the ledger carries it, so a rename touches the display
name column and nothing else. Admin → Tokens states this on each row. A
renamed token cannot mint and cannot re-denominate history.

**A module's token is listed while its module is on.** Switch the module off
and its token leaves the Tokens page, and every balance stays exactly where it
is. A token somebody already holds keeps its row on that page even with its
module off, saying so, because a steward has to be able to answer for a
balance.

Verify after naming: the boot log prints `[ledger] invariants hold`; the
cycle pool refuses to pay the recognition token (a fail-loud 400 if
`gratitude.pool_token` is misconfigured); Admin → Ledger reconciliation
shows conservation at zero for every token.

### Where the value token can be SPENT (0092)

The pool pays real value, so the value token needs somewhere to go. A fork
that never opens one of these ships a village where a member does the work,
gets thanked, receives a number, and there it ends. **Journey to Launch
BLOCKS on this** (`pool-token-spendable`), and the check reads live rows: a
module being switched on proves nothing.

Three doors, any one of which satisfies it:

- **Nights.** Admin → Stays → a room's posted prices now takes a rate in the
  village's own credits beside stay credits and usd. A stay is ACTIVATED in
  one token (the desk picks it beside the Activate button) and that choice is
  snapshot with the rate. Either accepted, never a rate between the two:
  nothing converts one token into the other, because buying stay credits with
  village credits would turn a faucet-issued token into a purchased one.
- **Seats.** Admin → Calendar → a gathering carries a seat fee and a token.
  The fee is held in `sys:event-escrow` from the moment somebody takes a place
  (a seat OR a queue position) and returned in full on every way out:
  withdrawing, changing the answer, leaving the queue, the gathering being
  cancelled or taken off the calendar. A gathering that HAPPENS releases its
  fees to `sys:treasury` on the `seat-fee-settle` job, a day after it ends.
- **Each other.** Admin → Tokens → the `sending` switch opens member-to-member
  transfers on a token; members send from their own profile. **On by default
  for the seeded `credits` token**, which is why a stock fork passes the check
  with nothing configured. The switch exists only on credit-kind platform
  tokens: recognition is never sendable, the admin route refuses to open it by
  kind, and a boot invariant refuses to serve a database where a recognition,
  equity or voice token is marked transferable.

Seeded by 0092, no env var and no manual step: the `sys:event-escrow` ledger
account, `credits` becoming transferable, and every recognition/equity/voice
token being set non-transferable (0006 seeded `gratitude` as transferable and
nothing had ever read the column).

## Integrations

- Hypha (DHO config): set `hypha.org_url` (v3 S13) — every governance
  surface deep-links from this one value; blank hides all Hypha buttons.
  Confirm the four derived links resolve against your own DHO
  (governance `/`, proposals `/agreements`, treasury `/treasury`, members
  `/members`); override individually only if your DHO differs. The
  boundary is absolute: this platform READS and DISPLAYS what Hypha
  governs and never mints, moves, or prices it.
- Hypha Bridge module (`hypha`, R58; `drizzle/0096_hypha_module.sql` + `0097` add
  `hypha_token_bindings`, `hypha_village_reads` and `hypha_outcomes`). Ships
  OFF and free; every surface above keeps working while it is off. Turning it
  on needs `hypha.org_url` plus one token contract a human confirmed, and
  reading Base at all needs an endpoint somebody pays for. New game variable:
  `hypha.treasury_address` (blank shows total supply only). Who watches Base is
  DERIVED from the hosting relationship rather than set: a village holding the
  `governance_hub_secret` is on the hub's listener, a village with its own
  dedicated `tokens.base_rpc_url` runs its own, and a village with neither
  records outcomes by hand. `hypha.space_id` now does what it always claimed:
  a governance callback naming a different space is refused. See
  `docs/modules/hypha.md`.
- Stripe (v3 S32+): per-fork keys; ONE webhook endpoint (`/api/webhooks/stripe`,
  raw-body signature verification — see the two `STRIPE_*` env rows above for
  the full setup checklist); test with the CLI before go-live; dispute
  handling is mandatory, not optional — a dispute auto-suspends the buyer and
  claws back what was granted, and admins hear about it on the bell.

## Backups (S12 — MySQL is the ONLY authority now)

- **What's authoritative:** everything lives in MySQL. The `data/` volume
  holds ONLY uploaded images (`data/uploads/`) plus historical JSON kept as
  an archive. `scripts/import-json-to-mysql.ts` remains the restore/cutover
  tool for that archive format.
- **Automated:** `.github/workflows/db-backup.yml` dumps the production
  schema daily (09:17 UTC), keeps 30 days of artifacts, and — on every run —
  RESTORES the dump into a scratch MySQL and asserts row counts plus an
  exact round-tripped timestamp against a manifest taken at dump time. A red
  `db-backup` run means the backup is bad, not just late. Requires the
  `PROD_DATABASE_URL` repo secret (the Railway MySQL public-proxy URL);
  every fork sets its own.
- **Manual restore:** download the artifact →
  `gunzip -c dump.sql.gz | mysql <target-url>` → point `DATABASE_URL` at the
  target. Boot migrations and invariants verify the rest.

## Turning modules on

Everything ships OFF. To open them all at once (dependency order handled,
each surface verified afterwards):

```bash
node scripts/enable-all-modules.mjs --base https://your-village.example --email founder@example.com --password '…'
```

`--dry` reports what would change without changing it; `--preview` opens
them admin-only first. Funds-bearing modules (stays, exchange) refuse while
a shared password is the only admin credential — bootstrap per-admin
identities first.

**Every exit prints the state it left you in.** The run ends with a table of
every module and its lifecycle, and so does the refusal it gives when its own
list has gone stale. An operator who reads "this script is out of date" should
never have to guess which modules their village now has. A module the server
declines to enable counts as a failure and the exit code says so, which it did
not before: one module sat above the module it requires, came back 409, stayed
off, and the run still reported success.

**Modules that declare `setup: "required"` and are not in the script's own list
are skipped**, read from the server's field for the same reason the tier is.
The Hypha bridge is the live case: turning it on for a village with no DHO
gives that village a governance surface pointing at nothing.

**Module library listings are skipped by that script, deliberately.** It reads
the tier from the server and leaves anything above `included` alone: turning a
listing on without its credential probes a surface that cannot answer, and for
a Managed listing, enabling it is the village accepting a support arrangement
and a stamped contract version, which is not a thing a convenience script gets
to do on somebody's behalf. Enable each one from Admin → Modules after reading
its card and setting its key. <a id="module-library"></a>

### The module library (tier, vendor, and the 503)

Some modules connect this village to an outside paid service. Every one of them
is first-party code in this repository: a connector written and maintained here
against somebody's API. No vendor code runs inside your server.

Each listing sits in one tier, and the tier answers the only two questions
anybody asks when something breaks: **who do I pay, and who do I call.**

| | Included | Connected | Managed |
|---|---|---|---|
| Billed by | the platform price | the vendor, direct to you | the platform |
| You call | the platform | the vendor for the service, the platform for the wiring | the platform |
| The credential | none, or your own upstream account | **yours**, set in Admin → Integrations, source and last4 visible | platform-held, env only, you never see it |
| You have an account with them | n/a | **yes** | no |

Included shows no badge in the catalog; Connected and Managed each show a pill
and a line saying who supports it.

**When a listing's key is missing or its service is down, its routes answer 503
and never 404.** A 404 means "this module is off" and is how a village hides
what it has not turned on. A paid, enabled module that answers 404 would tell
your members the feature was deleted. The 503 body carries a sentence your
pages already render: Connected names the vendor and their support link,
Managed says the platform is on it and never names anybody. Everything else in
the village keeps working either way.

**What a village agreed to is stored.** Enabling a listing writes the tier and
the library contract version into that module's `module_settings.config` and
appends a `module_events` row of kind `listing`. The registry tier is the
offer; that stamp is what you are on. A later tier change is therefore a
re-acceptance somebody reads, never a silent rewrite of your support
arrangement.

**Health is measured, never assumed.** A key being set is not a key that works.
Every outbound call is wrapped, carries an `x-correlation-id` header the vendor
is asked to log, and writes one `integration_health` row per (module,
operation) with the last success, the last failure and its status. With no
recorded success, Admin → Integrations says "never confirmed working", which is
the truthful answer and is not the same as broken.

**A price is data, and the credential is the licence.** A listing may carry a
price (amount, currency, period, a billing URL) and it renders in the catalog,
on the listing detail and on that listing's Integrations card. **The developer
bills you directly; this platform processes no payment and takes no cut.** What
a paid listing's paid features actually validate against is a licence key you
buy from the builder and hold in your own secrets store, where you see its
source and last4 and can clear it unaided. That is deliberate: you own this
repository and could delete any code gate in it, so a price can only honestly
rest on a credential the other party holds. While the licence is blank the
listing answers the same 503 as any other missing key and the rest of the
village carries on. A listing may never disable a village surface, lock an
admin screen, or touch your data when its licence lapses.

**`builtBy` is a credit line and never a tier.** It renders wherever a listing
does, at every tier including Included, so somebody who contributed a module
without becoming its counterparty is still named.

**A withdrawn listing is marked, never deleted.** Admin → Modules banners any
withdrawn listing you are running and shows the date. Withdrawn blocks a NEW
enable with a 409; it changes nothing already serving, so yours keeps running
and you can still move it between preview, members and public, or switch it
off. Switching it off is one way, because it cannot be turned back on. The
registry entry stays, which is what stops your `module_settings` row becoming
an orphan.

**A `member-pii` listing owes you a deletion driver.** Any Connected or Managed
listing whose data class is `member-pii` raises a **blocking** launch
requirement until it registers a `forgetMember` and `exportMember` driver.
Without one, erasing a member reaches only this village's own tables while an
outside service keeps its copy. It fails visibly on the launch journey and in
the admin banner, and it never blocks boot.

**Linting a listing.** `node scripts/validate-module.mjs [module-id]` checks the
registry shape, the vendor record, the pricing and licence slot, the member
driver, the contract doc and its provenance marker, and the launch requirement.
It then prints everything it cannot check, because a check that silently skips
turns "unchecked" into "passed". `docs/modules/BUILDING_A_MODULE.md` is the
guide for whoever is writing the module.

### The Living Map artifact (`/map`)

`/map` serves `docs/prototypes/grounds-v0.html` straight from that path: the
server routes `/grounds/index.html` and `/grounds/manifest.json` to it
(`server/index.ts`), and the vite dev plugin does the same for `pnpm dev`.

**Caching.** The artifact also answers on a content-hashed name,
`/grounds/grounds-<hash>.html`, served `immutable` for a year; the manifest
names the current one in its `url` field and is itself `no-store`. The shell
uses that url, so a 4 MB map is fetched once per version instead of
revalidated on every visit. The hash is memoised on (size, mtime), so swapping
the artifact is picked up without a restart, and a request for a stale hash
redirects to the current one rather than 404ing. `/grounds/index.html` still
works and revalidates. The probe contract (`present`, `bytes`) is unchanged;
`url` is additive.

**There is deliberately no second copy.** It was briefly staged into
client/public/grounds/ at build time, which put 4 MB into `dist/public` and
took the total to 7.8 MB against the CI bundle budget's 6 MB ceiling. That gate
exists to catch exactly that, and the fix is to serve one copy rather than to
raise the number. Nothing to provision and no env var; the artifact simply
needs to be committed. A deployment without it builds and runs fine, `/map`
says the map is not installed, and the org view at `/map/circles` needs no
artifact at all.

### The map address plane (0060)

Additive, nullable columns that record WHERE a thing lives on the Living Map
and WHO SAID SO: `circles.home_structure_key`; `structure_key` +
`address_source` on `org_roles` and `quests`; `structure_keys` +
`address_source` on `forum_threads`. No provisioning, no env var, nothing to
turn on.

`address_source` is `creator`, `creator-board` or `resolver-guess`, enforced in
code (`shared/mapAddress.ts`) rather than by an enum, because the list is
expected to grow and a widening enum is an ALTER on four populated tables every
time. NULL means nobody has said anything yet, which is deliberately different
from `creator-board`: one is silence, the other is a person choosing the Board.

**The doctrine: a `creator` or `creator-board` row is never overwritten by
anything automated.** Only NULL and a stale `resolver-guess` may be replaced.
Every writer asks `mayOverwriteAddress()`; nothing reimplements the comparison.
The scene importer obeys it and prints what it left alone.

Four values travel, three are stored. A scene may carry `pool`, which is the
exporter's derived "no structure was set", and it lands as NULL. The artifact
publishes the whole contract in `map_scene.address_source_vocabulary` (values
plus the law), and the importer compares that list against its own on every
run: a scene declaring a source this platform cannot handle prints a NOTE
naming it, and those rows import unaddressed rather than silently vanishing.
One legacy spelling, `lexicon guess`, maps to `resolver-guess`; the map
normalises it at its own export boundary now, so only older scene files carry
it.

The founder's own words for roads, water and zones live in the
`map_vocabulary` document in `app_config`, served at `GET /api/map/vocabulary`
(behind the `map` module's gate) and written by `PUT
/api/admin/map/vocabulary`. The same document carries `media` (what flows along
a line, with the colour and glyph it is drawn in) and `phases` (what a build
phase is called, keyed by the number the scene stores).

### Promises made on the map (0062)

`quests.map_key` and `events.map_key`: varchar(190), nullable, UNIQUE. The name
the MAP uses for a row, stored exactly as it arrived and never computed here.
No provisioning, no env var, nothing to turn on.

A visitor can RSVP to a gathering and claim a quest from inside the map. When
they do, the map posts the only id it has: a scene event id (`e1`) or the key
it derived from a quest title once and then kept. `POST /api/map/promise`
(behind the `map` module's gate) turns that into a row and answers.

**Nothing here derives a key.** Two implementations of one slug rule must agree
forever, and the first title edit breaks them apart, which is the exact failure
this column ends: the map renamed three of its own seed quests in one afternoon
and every one stopped matching on title. The importer stamps the key on the
first pass, matching by title because that is all there is, and matches on the
key every pass after. A renamed quest keeps resolving.

The route always answers **200 with a body**, because the shell relays a
result and a bare status code leaves the map guessing. `reason` is one of
`anonymous` (401; `href` is the way in), `not-yet` (the capability gate or a
quest's stage and role rules; signing in again fixes nothing), `closed`,
`full`, `not-here`, `gone`, `error`.

**`not-here` and `gone` are different and `not-here` is the common one.** A
village that has never imported a scene has no row for ANY key the map sends,
which is the default state of a fresh fork. It is not a deletion and must not
read like one. The discriminator is whether the table holds any map keys at
all.

Withdrawing a claim removes it only while it is still `claimed`. Once it is
submitted or consented, work or recognition is attached and the route refuses
with `closed`.

### App mode, the Welcome Walk, and installing the map

`/map` renders with no site header and no page scroll: the frame is `100dvh`
(not `vh`, which on a phone measures the viewport with the browser chrome
hidden and leaves the last strip behind the address bar). Leaving happens two
ways that run the same code: the artifact's own exit posts `{type:'exit'}`,
and the browser Back button pops a marker history entry pushed on open.

`GET /api/map/config` returns `{skin, walk, vocabulary}` in one call, and the
shell pushes it as a single `{type:'config'}` message on `grounds-ready`. The
walk lives in a `map_walk` document keyed by language (`en` default);
**an absent or empty walk means the artifact runs its own seed**, which is why
the shell omits the key instead of sending `[]`. Edit it in Admin, Make This
Yours, step 5, which can preview a draft on a real map without saving.
`GET /api/admin/map/structures` feeds the step picker from addresses the
village has actually set (0060).

`/manifest.webmanifest` is generated from the brand overlay, so a fork gets
its own install prompt with no deploy, and `client/index.html` stays neutral.
`client/public/sw.js` caches ONLY the content-hashed map artifact and passes
everything else straight through; a broader worker is how a village ends up
served yesterday's build with no way to force a refresh.

### Importing a map scene

```bash
npx tsx scripts/import-map-scene.ts <amora-scene.json> --dry
```

`--dry` needs no database and writes nothing. Without it, set `DATABASE_URL`.
It refuses a scene whose version it does not know, matches rows by name and
title and **never creates** one, and prints three lists every run: what it
skipped, what it could not match, and what a person had already placed. Events
import as drafts.

### Events (0059)

Ships off like everything else. Turning it on mounts `/events` and the
calendar API. It holds no value, so its `openStateCheck` is guidance rather
than a money guard: it asks an admin to cancel or wait out gatherings still
on the calendar before switching the module off, so members are not sent to
a page that 404s. Putting something on the calendar needs `event.manage`,
which is role-granted and never reached by stage; answering one needs
`event.rsvp`, which any account has. No seeds, no env vars.

### Selling library credits (`library.creditSaleEnabled`) — opt-in, off forever by default

By default a library credit is backed by a physical item on the shelf and
can never be bought. Opening sales (Admin → Exchange, the L9 caution card)
makes it purchasable for fiat like any credit token — backed by money
instead of an item, indistinguishable from earned credits after the sale.
The card states the risk: oversell against the shelves and every credit's
promise weakens. Swapping stays sealed regardless — this card opens the
shop, never the market. The ledger keeps the two provenances separate
forever (`sys:library-mint` = shelf-backed intake, `sys:mint` = sold
stock), and revoking the card refuses the next sale, not the next deploy.
Prepaid credits can be a regulated product where you operate — ask a
lawyer first.

### Token-for-token swapping (`exchange.tradingEnabled`) — opt-in, off forever by default

Enabling the exchange module gives you a **shop**: members buy listed tokens
with a card. It does not give you a **market**. Letting members trade one
village token for another is a second, separate switch, and it stays off
until a named admin accepts a version-stamped caution card in Admin →
Exchange. The server records who accepted it and when, refuses an acceptance
of any card but the current one, and refuses to boot with trading on while a
shared password is your only admin credential.

Before you flip it, know what you are taking on:

| Property | What it means for your village |
|---|---|
| Regulated activity | Members trading tokens at posted prices can be a regulated activity where you operate. This is the point to ask a lawyer. |
| Fiat is one-way | Tokens never convert back to money. There is no path out and adding one is not a setting. |
| Faucet tokens can never swap | Anything a faucet has paid a member — recognition, quest rewards, hand-mints — is permanently unswappable, however it was earned. It can still be bought. |
| Swaps are final | No reversal, no dispute queue, no chargeback. The only way back is swapping again at the posted prices. |
| Caps are fail-closed | Every open token needs a per-cycle and a per-member-per-cycle cap. **0 means zero, not unlimited.** Set both before you announce anything. |
| Card-bought tokens are held | `exchange.swap_fiat_hold_days` (default 45) freezes recently purchased tokens from swapping so a chargeback still finds them unconverted. |
| Halt is one click | Any token can be paused instantly. Resuming requires a written sentence, recorded in the audit log. |

Practically: most villages should leave this off. It exists for deployments
that have two or more genuinely distinct credit tokens (say, a lodging credit
and a workshop credit) which members have a real reason to move between. If
fewer than two of your tokens pass the faucet firewall, there is nothing to
turn on — the Exchange admin tab will tell you which tokens are refused and
why.

## Smoke test after provisioning

**Automated (47 checks across every module):**

```bash
node scripts/smoke-all-modules.mjs --base https://your-village.example --email founder@example.com --password '…'
```

It registers throwaway members and walks the real loop: quest claim →
submit → consent → gratitude → forum → feed heart → tools → badges (incl.
the earned engine) → library intake/loan/settle with escrow reconciliation
→ stays pricing/purchase/activation/nightly posting → exchange firewalls,
pricing, stocking → health regen + sparse-data honesty → automation
ingestion + the honest 503 without an API key → exit enumeration → the
command centre → and finishes by asserting per-token conservation. Run it
against a fresh deployment; every line should be a ✓.

**The loop, by hand:** `/health` → ok, and its `build` reads
`<label>-<git sha>` — the SHA is stamped at build time, so if it does not
match the commit you just pushed, the deploy has not landed yet (a marker
that never changes is the bug this replaced). Then:
register → claim → submit → consent (admin) → gratitude send → wall shows
it; `/api/season` shows the seeded season; admin Modules tab lists
everything OFF.

**The postures** (each one is a thing that has silently broken before):

- `GET /api/platform/info` returns your project name, version and enabled
  modules — the interop handshake, and proof no path hardcodes a brand.
- Blank `hypha.org_url` → every Hypha button is gone, not dead.
- Without `STRIPE_SECRET_KEY` → card checkout answers an honest 503 and the
  manual payment path still grants credits.
- Boot log shows `[ledger] invariants hold` and, once the library module is
  on, escrow reconciliation green in Admin → Library.
- The exit policy renders at `/exit-policy` (placeholder banner until your
  community writes its terms).
- `node scripts/check-brand-refs.mjs` passes with YOUR village's terms
  added to its banned list.
- The `db-backup` workflow runs green against your `PROD_DATABASE_URL` —
  it restores the dump and asserts counts, so green means restorable.

## Extraction preconditions (who does what)

The platform is fork-ready; these steps need a human with accounts:

| Step | Who | Note |
|---|---|---|
| New GitHub repo / org for the fork | Village operator | The platform is pulled, not copied by hand |
| Railway project + MySQL + volume at `/app/data` | Village operator | See Provisioning |
| Resend sender-domain DNS (SPF + DKIM) | Whoever controls the domain | Unverified = silent email death |
| Stripe account, keys, ONE webhook endpoint | Village operator | See the two `STRIPE_*` rows |
| Hypha DHO + its URL | Village governance | Blank hides the surfaces cleanly |
| Token names (Gate D) | Village admins | Recognition token + per-module tokens |
| Exit-policy terms (F12) | The community | The flow ships; the terms are theirs |

## Language

The platform ships English-only. Every module's copy lives in its own page
components rather than a locale layer, so translation is a fork-level
decision, not a platform dependency — nothing in the server or the shared
registries assumes a language. If a fork needs another language, the work
is a locale layer over the client pages plus the seeds; the game rules,
variables and invariants are language-free by construction.

- Seeds: **there is no org-chart seed any more, and a fresh village starts with no seats and no team cards.** server/seeds/org-chart-2026-08.json and its corrections file used to ship one village's real org chart in this repository: twelve seat holders, ten named people, internal availability notes, and two team cards with surnames and portraits. A fork seeded all of it into its own database on first boot and served the names to anyone with the URL, because a village's people are public by default (R57). Those people agreed to appear on one project's site.
  The code that read those files still guards on their existence, so their absence is a clean no-op, and a village that was already seeded keeps everything: measured with `scripts/qa/r6-fork/measure-seed-dependence.ts`, which boots twice against one schema with the files moved aside the second time and gets byte-identical output. Build your chart in **Admin, Org Chart**, which the Setup Wizard now points at.

## Org chart and seasons (0049, 0050)

- `drizzle/0049_org_roles.sql` creates `org_roles` and `org_role_assignments`
  and adds `circles.grown_from_org_role_id`. The `roles` table is untouched:
  it stays the permission-group carrier feeding the one capability gate.
- `drizzle/0050_season_patterns.sql` creates `season_patterns`,
  `season_pattern_members` and `season_roll_log`, and adds
  `badges.season_scope` and `badges.multiplier`.
- Seed (removed, see the seeds note above): server/seeds/org-chart-corrections-2026-08.json was per-deployment
  data, applied once by the `org-roles-backfill-2026-08` runOnce when the
  card-shaped org chart becomes rows. A fork with its own cards keeps them;
  the corrections file only moves seats between circles and names holders.
- New game variable: `org.reassignment_cadence` (default `season_turn`).
- The public `/roles`, `/circles` and `/team` pages read `GET /api/org`. The
  Content card editors for those three sections no longer drive them; the
  editing surface is Admin, Org Chart.
- New game variable, no migration: `org.public_people` (default `true`,
  founder-held, category "The village's people"). On, a signed-out visitor
  reads the first names of the people holding each seat on those three pages.
  Off is Rye's "secret society" setting: the names become members-only and the
  structure stays open. Deliberately outside the map module's `variableKeys`,
  because those three pages have no module gate and `/api/org` answers with the
  map module off. Three tiers on that route now: anyone (a first name and
  nothing else), `map.viewPeople` (the holder rows, with focus and note), and
  admin (seating ids and the recruitment pack).
- Seed refresh: the `examples-refresh-featured-awards-and-members-product`
  runOnce reapplies the `badges` and `commerce` example rows. It exists
  because no example award carried `featured` (bylines render featured awards
  only, so every example member's byline came back empty) and every example
  product was `public` (the members-only branch of the catalogue had nothing
  to show). A fresh instance picks both up from the seed and needs no refresh.

## Publishing your village (0051, no migration)

Three unauthenticated documents. Anyone, including an AI agent, can read your
whole org chart from one URL with no integration:

- `/.well-known/village.json` — discovery. **Always on.** It publishes what
  `/api/platform/info` already did, plus a public key and a `links` block.
- `/api/public/org.json` — the org chart as data.
- `/org/index.md`, `/org/circles/<id>.md`, `/org/roles/<id>.md` — the same
  chart as linked Markdown.
- `/api/platform/module-usage` — your module usage, per lunar cycle. **Always
  on**, and its own section below.

**The last two are dark until BOTH are true:** the `map` module is at `public`
lifecycle, and the `map.public_structure` variable is on (it defaults on). That
pair is already your answer to "may a stranger see our structure", so there is
no separate publish switch to find. Set `map` to `off`, `preview` or `members`
and the org documents 404 while discovery keeps answering, with `org/1` gone
from its `supports` array. `module-usage/1` stays, because it is counts of
people and never a person and it is unconditional; the section below says
exactly what it holds.

**They never carry names.** Not full names, not first names, not the names of
documented holders, not focus strings or holder notes. Seat counts and how many
are filled, and nothing else. If you want a public people directory, that is a
different thing and it needs per-member consent first.

Every document is signed with an ed25519 key minted at your first boot and
stored in `app_config` under `village-signing-key`. The public half is in the
discovery document. **Back it up with your database.** Losing it loses no data,
and since 0057 it has a cost that is easy to miss: every village that peered
with you PINNED that key, so a new one pauses you on their side until one of
their admins presses "accept & resume". Restore the key with the database and
nothing happens; restore the database without it and every peer goes quiet at
once.

Check yours after provisioning:

```bash
curl -s https://<your-domain>/.well-known/village.json | jq '.supports, .publicKey.kid'
curl -s https://<your-domain>/org/index.md | head -20
```

## What your fork counts, and who may read it (0101, no new migration)

**This runs from your first boot and there is nothing to switch on.** Every fork
inherits it by pulling, which is the point: a game that cannot say who built
what and how much it was used cannot pay anybody, and a fork cannot be on
somebody else's hand-kept list.

**What is measured.** A signed-in member getting a response under 400 on a
route belonging to a non-core module counts **1**, for that module, for that
lunar cycle. Opening it again counts 0. Writing in it counts 0. Admin routes are
excluded and refused requests are excluded. The unit saturates on purpose: the
one thing that moves a module's number is more different people opening it.

**What survives a cycle.** While a cycle is open, `module_usage_marks` knows
which member opened which module. When the cycle turns, the hourly seal job
aggregates the marks into `module_usage_cycles`, records `sealed_at`, and
**deletes the marks in the same transaction**. After that your database can no
longer answer "which modules did this member open", this cycle or ever. That is
a privacy guarantee and not a storage decision, and it is the reason the
counting is safe to publish at all.

**What you publish.** `/api/platform/module-usage` serves one cycle at a time,
signed with the same key your discovery document publishes. Per module it
carries members reached, active members, the reach fraction, the builder's
credit line, their handle, the account system that asserts the handle, whether
the platform built the module, whether it may draw from the pool at all, and
where its share goes. **A module that charges a price, and one that was
withdrawn, still appear with their real usage and are marked out of the pool.**
Dropping them would hide usage from a fork counting itself; failing to mark them
would let them dilute a split. Per cycle it carries
the cycle id, whether it is sealed, the seal time, and your instance id. **No
member, in any field, ever.**

```bash
curl -s https://<your-domain>/.well-known/village.json | jq '.supports, .links.moduleUsage'
curl -s https://<your-domain>/api/platform/module-usage | jq '.cycleId, .sealed, .sealedAt, .modules[0]'
curl -s "https://<your-domain>/api/platform/module-usage?cycle=<a-past-cycle>" | jq '.sealedAt'
```

**Who reads it is not decided here.** This is a pull and never a push: your
deployment holds nobody's address and reports to nobody. Anyone who can read
your discovery document can follow the link, verify the signature against the
key it publishes, and count you. A fork that nobody counts keeps exactly the
same books, and `/api/modules/pool` shows your own reading of them either way.

**If you carry a module of your own**, set all three of `builtBy`,
`builtByAccount` and `builtByNamespace` on its registry entry. The last is the
host of the account system that holds the handle, and a handle without one is
refused at boot: a bare handle only resolves while everybody shares one roster,
and in a network of counters it pays the wrong person.

**Nothing pays anybody yet.** There is no wallet in this codebase and no
transfer. What exists is the counting and the publishing.

## Peering with another village (0057)

`drizzle/0057_peer_public_key.sql` adds `peer_instances.public_key`. When you
add a peer, this village records the signing key their discovery document
proved it holds, and every six-hourly sweep checks the next document against
it. Nothing to configure.

What you will see:

- **A peer pauses with "signing key changed".** They rotated their key, or
  restored a database without it, or somebody else is answering at their
  address. Ask them, then press **accept & resume** on the Network page, which
  re-reads their handshake and pins whatever answers now.
- **A peer pauses with "signing key no longer proved".** They used to sign and
  have stopped, most likely a rollback to an older build. It reads the same as
  somebody stripping the check by serving the old unsigned document, so this
  village refuses either way. Same door out.
- **A peer that never signed keeps working.** A village running an older build,
  or a hand-written static file answering the discovery shape, pins nothing and
  is trusted exactly as much as it was before. It pins itself the first sweep
  it starts signing.

## Forgetting a documented holder

A member deletes their own account and everything of theirs goes, org seats
included. A **documented** holder is a real person with no account here, so
nothing joins their name to a user row and nothing scrubs it. If one asks to be
forgotten, an admin does it:

```bash
curl -X POST https://<your-domain>/api/admin/org/seatings/<seating-id>/forget \
  -H "Authorization: Bearer <admin-token>"
```

Every seat recorded under that name ends and loses the name and the note, past
seats included. The seats keep their history and their counts; only the person
goes.

## Characters and the economy (0069 to 0072)

Four migrations arrive together. Snapshot first, then boot: the runner applies
them fail-loud before the server serves.

Nothing here needs an env var. The two Hypha secrets the voice claim will need
are NOT wired yet and are named in the PR, not here, so nobody sets a variable
that nothing reads.

**Seeded at every boot**, beside `ensureStayToken` and `ensureLibraryToken`:

- the village voice token (`village-voice`), platform-governed so it can accrue
  here, at 3 decimals so a rule of 0.1 posts 100 thousandths rather than
  truncating to zero;
- the five classes (`archetypes`), which UPSERT, so an improvement to the copy
  reaches every village on the next deploy;
- the starting `mint_rules`, which INSERT ONLY WHEN ABSENT and are never
  updated. An amount your village has edited is never restored to the platform
  default by a redeploy. To change one, edit the row.

Re-running seeds nothing twice and grants nobody anything: value only ever
enters through the engine.

**One new scheduled job**, `moon-settlement`, hourly. Hourly is how often it
ASKS, not a payment cadence: every mint is keyed on cycle, seat and holder, so
twenty-four runs a day pay exactly what one does and an interrupted run
finishes on the next tick. It thanks seat holders at the amounts the rules
already promised. It does NOT close a gratitude cycle, which stays a human act.

**No new variables.** The engine's give path reads the same two dials the
acknowledgement flow does, in Admin under Gratitude:

| key | default | what it sets |
|---|---|---|
| `gratitude.base_budget` | 100 | The allowance a member may give each cycle, before their stage multiplier |
| `gratitude.max_share_per_recipient` | 25 % | The most of that allowance any one person may receive |

It shipped with a second pair of its own, `economy.giving_allowance_per_moon`
(a flat 30) and `economy.hearts_per_recipient_per_moon` (10 to one person),
beside `gratitude.max_per_recipient_per_cycle` (1 SEND to one person). R73
retired all three, and 0110 deletes any override rows a fork had written.

The reason the sends cap had to go: a cap on the COUNT bounds how OFTEN one
member acknowledges another and never how MUCH, so a member at the top of the
ladder could hand one person 500 Gratitude in a single send and break no rule.
Gratitude is `governance.weight_token` by default, so that was a limit on how
much voice one member may concentrate in another, and it did not exist. A share
is stage-proof and edit-proof: it means the same thing at 100 and at 500, and
doubling the base budget cannot silently double how much of one person's
standing comes from one relationship.

Both doors still write `gratitude_log` and both sum their spending out of the
same rows. They now agree about the total as well.
`feed.max_hearts_per_recipient_per_cycle` survives as the last count cap in the
village, because a heart is a tap whose size `feed.heart_amount` already fixes.

**Avatars.** `scripts/gen_avatars.py` needs `GEMINI_API_KEY` in the
environment, never committed, and is only ever run by hand. It keeps its 2K
masters in scripts/avatar-bases/ (gitignored, so it is absent from a fresh clone) and delivers 1024px webp, which
is what keeps 30 portraits inside the CI budget of 6000 KB for the whole of
`dist`. Re-running skips what exists.
## Who may shape the living map (0063)

Build mode edits a PRIVATE draft. Nothing a member drags is visible to anyone
else until they press Publish, and one member publishing never touches another
member's draft.

Two capability keys govern it, and neither is reachable by climbing the stage
ladder because both are appointments:

- `map.edit` opens build mode and keeps a draft.
- `map.publish` makes a draft the map every visitor sees.

Migration 0063 seeds a **Cartographer** badge carrying both. It is an ordinary
granted badge, so award it from the admin badge screen like any other. Admins
and founders pass every gate already and need no badge. To let someone draft
proposals without handing them the live land, make a role carrying only
`map.edit`.

The badge row is seeded with `INSERT IGNORE`, so a deployment that already made
its own `cartographer` badge keeps theirs untouched. While the badges module is
off the row simply exists and grants nothing.

Nothing to provision: no env var, no seed file, no extra step. A village that
has never published serves `scene: null` from `GET /api/map/config` and the map
draws its own seed, which is the correct state for a fresh fork.

## The other appointments, and which seeded role carries them

Five capabilities are appointments the same way `map.edit` and `map.publish`
are: no stage rung reaches them, so a role or a badge has to grant them. The
platform documented that and then shipped no role or badge carrying any of
them, which made them admin-only in practice on a fresh village. They now ride
the seeded roles whose descriptions already claimed the work
(`server/seeds/roles-seed.json`):

| Capability | Seeded role |
| --- | --- |
| `feed.announce` | Steward Circle |
| `health.record` | Steward Circle |
| `event.manage` | Steward Circle |
| `exchange.manage` | Treasury |
| `org.declare` | Founders Circle |
| `map.edit`, `map.publish` | the Cartographer badge (0063) |

Nothing to provision. `roles-seed.json` is applied ONLY when the `roles` table
is empty, so a running village keeps every role it has and an admin adds these
through the role editor. A fresh fork gets them at first boot. A role grants
nothing until somebody holds it, exactly like a badge.

- Seeds: `server/seeds/quests-seed.json` carries the story layer per quest (0068: `subtitle`, `story`, `firstStep`, `steps`, `deliverable`, `tips`, optional `imageUrl`). On an already-running village the `quest-story-2026-08-10` runOnce fills those fields from the seed ONLY where the live row is empty, so admin-written copy is never overwritten, and `quest-posters-2026-08-10` replays the same fill to pick up `imageUrl` on villages that ran the first one. Both throw when the seed file is missing or unreadable, so a broken deploy retries on the next boot instead of recording itself as applied. Look for `filled N quest(s)` or `found nothing to fill` in the boot log: those are different facts.
- Quest poster art: a quest's `imageUrl` must be a path under `/api/uploads/` (the API refuses anything else, the same rule the forum's image field follows), so posters are uploaded into the `data/uploads/` volume, never committed to `client/public`. That directory is served one-year-immutable and is not content-hashed, and CI caps `dist/public` at 6 MB total and 400 KB per image. A village with no poster files needs no action: each card paints a gradient scene from its circle, and a quest whose `imageUrl` points at a missing file falls back to the same scene rather than showing a broken image.
- Quest crews (0067, `quest_crews` + `quest_crew_members`): a small named group walking one quest, formed by any signed-in member and joined by invite link. Nothing about a crew touches value: members claim, submit and are consented to individually, so the consent gate never learns crews exist. Every crew route requires a signed-in member INCLUDING the read, because quest pages are public and who walks with whom is not for crawlers. Crews work with messaging off, and the roster is the crew. With messaging on, forming a crew also opens a conversation through `crewsRepo.attachConversation` (`kind` 'crew', `context_type` 'quest', `context_id` the quest id), joining the crew joins that thread, and leaving the crew leaves it. All three calls are best-effort and logged on failure, so a room that will not open never fails the act of forming a crew, and a village that switches messaging off later keeps its crews and loses the rooms.
- Uploads, every door (`server/lib/uploads.ts`): every byte that reaches `data/uploads/` goes through `sanitiseForVolume` first. An image is re-encoded in its own format AT ITS OWN DIMENSIONS with no metadata, and the result is read back and asserted before it is written, so a picture cannot publish the coordinates of the land it was taken on. A PDF is scanned for an embedded geotagged photograph and REFUSED with a sentence when it holds one (a PDF is not re-encoded: that needs a new runtime dependency, and a PDF's own metadata carries author and producer, never GPS). Fonts, spreadsheets and everything else pass through untouched. No env var and no seat of configuration: this is not tunable, deliberately, because it protects a person from a consequence they cannot see. `node scripts/check-upload-strip.mjs` is a CI gate that fails when any new writer reaches the volume without coming through that module, and `multer.diskStorage` is refused outright because it writes a stranger's bytes before any handler can look at them. Two log lines are worth an alert: `[uploads] refused a proposal attachment whose metadata survived the strip` and its vault twin both mean the runtime assertion fired, which should never happen.
- Place photographs (0093, migration `0093_place_photos.sql`): members photograph the places on the living map at `/places`. No env var and no seed. Files land in the `data/uploads/` volume as `place-<stamp>.webp` plus a `.thumb.webp`, and `/health` now reports `uploads.photoFiles` and `uploads.photoMb` beside the totals so an operator can see how much of the volume the community's own uploads are taking. Sizing the volume is the one provisioning decision this adds: `map.photos_per_place` x `map.photo_max_mb` is the ceiling per place, and the platform defaults (60 photographs, 8 MB) put a busy place near 500 MB before the browser-side shrink, well under it after. Location data is stripped and the strip is asserted at runtime, so an upload that kept its EXIF fails with a 500 and writes nothing; `[places] refused an upload whose metadata survived the strip` in the log is that case and it needs a look.
- Quest share cards: `/quests` and `/quests/:id` are rendered with per-request Open Graph tags (the static `client/index.html` stays brand-neutral, so the server splices identity in from its brand document and the request host). `GET /api/og/quest/:id` renders a 1200x630 JPEG from the quest's poster, or from its circle's gradient scene when there is no poster. No env var and no extra step.

## What the assistant costs, and the village's own record (0078)

**One new table**, `assistant_usage` (0078). Every call the assistant makes now
writes what it cost: all four token fields, the model, whether the key was the
village's own or the borrowed platform one, the member who asked, and the
number of upstream calls behind one answer. Nothing before this recorded a
token count, so "what does the assistant cost" was answered by guessing.
`rate_hits` counts events in a bucket and knows nothing about their size.

Nothing to provision: no env var, no seed file, no extra step. The table fills
itself the first time anyone uses any assistant surface, and a village that
never configures a key simply has no rows.

**One added column**, `path` (0081), which says which road produced the answer.
`loop` is the two-POST tool loop and the default, so every row written before
0081 reads as one truthfully. `prefetch` read the reader first and made one
call. `deterministic` answered straight from the village record with no model
at all, and those rows carry zeros in all four token fields and 0 in
`iterations`, because that is the honest count of upstream calls behind them.

The number worth watching is the ratio, not the average:

```sql
SELECT path, COUNT(*) AS answers, SUM(input_tokens + output_tokens) AS tokens
FROM assistant_usage WHERE created_at > NOW() - INTERVAL 30 DAY GROUP BY path;
```

A deterministic answer costs nothing and charges no daily budget, so a village
whose budget is spent, or which has no key configured at all, can still ask
what its own record holds. Questions the router is not sure about take the loop
exactly as before.

**One new scheduled job**, `record-derive`, daily. It reads decided forum
threads and files each one into `village_record` so members can be answered
about decisions made before they arrived. It early-returns while the forum
module is off. It is idempotent on `(source, source_ref)`, so re-running it
changes nothing, and it walks the backlog oldest first. Its result line reads
`N decided, N filed, N already there`; a trailing `N lost to a slug collision`
means two decisions carried the same title on the same day and the second one
could not be filed. That is a real loss and it is reported rather than hidden.
Give one of them a distinct title and the next run files it.

The record is fork-local. It is excluded by name from the feedback relay, the
peer publish surface and the platform handshake, and a test enforces that.

## Half-price call syntheses (`assistant.synthesis_batch`, 0082) — opt-in, off by default

Call synthesis is the most token-expensive thing the platform does: up to 400
transcript segments against a 2000-token reply cap. Anthropic's Message Batches
API charges **half** for every token in a batch. What you pay instead is time:
results usually arrive **within about an hour**, and are allowed to take up to
24. Not seconds.

That trade only makes sense when nobody is waiting, so the switch draws exactly
that line:

| Path | Behaviour |
| --- | --- |
| **Admin → Calls → Synthesize** | Unchanged. Synchronous, answers in seconds, full price. A person clicked it and is watching. This is true whether the setting is on or off. |
| **The `synthesis-batch-poll` job** | Only runs when the setting is on. It picks up recordings that have a transcript and no synthesis, submits them as one batch, and writes each synthesis when the results come back. |

**Two new tables** (0082), `synthesis_batches` and `synthesis_batch_items`.
Nothing to provision: no env var, no seed, no extra step. They stay empty on a
village that leaves the setting off.

**One new scheduled job**, `synthesis-batch-poll`, every 5 minutes. It polls
open batches first and then submits a new one, and it early-returns while the
automation module is off, while the setting is off, or with no assistant key
configured. Its result line reads `N open, N ended, N written, N unusable, N
errored, N expired, N canceled` plus what it submitted. It applies the same
three brakes the Synthesize button applies: the ready-queue backpressure
(`maxReadyQueue` in the automation module config), the global assistant daily
cap, and the key check.

Before turning it on, know what changes:

| Property | What it means for your village |
| --- | --- |
| Synthesis stops being a human act | Today a draft appears because an admin asked for one. On, drafts appear because recordings exist. Nothing publishes itself either way: publishing to the forum is still a human act, and so is accepting a task. |
| Standing examples are never touched | The seeded example recording is excluded by the query, so no tokens are ever spent drafting over a sample. |
| Retries are bounded at one | A request that errors, expires or is canceled is retried exactly once. The second failure marks it `failed` and leaves it for a person. |
| One synthesis per recording, still | Enforced by the database (`call_syntheses.recording_id` is unique), so a re-poll or a restart mid-read cannot produce a second draft. |
| Token counts are recorded, prices are not | `assistant_usage` records real token counts for batch calls the same as for synchronous ones. The 50% is a billing fact, so apply it in the rollup, not by halving the counts. |

Turn it off and any batch already in flight still lands: the poll keeps
draining open batches. Nothing new is submitted.

## Investor vault documents (0099, migration `0099_investor_vault_document_fields.sql`)

No env var and no seed. `page_link` and `uploaded_at` join `investor_docs`, both
nullable, so rows loaded by `scripts/import-json-to-mysql.ts` stay valid and a
row pointing at an external `url` renders the same as an uploaded one.

The provisioning note is about the uploads volume, and it is a cleanup rather
than a sizing change. `POST /api/admin/investor-docs/upload` could never save
its row (`title` is NOT NULL and the handler never set it), and the file reached
the volume before the row was attempted, so **every press of that button since
the route shipped left a file nothing references.** A village that has been
running for a while may hold a pile of them. They are the vault's own naming
shape, `<document-name>-<stamp>-<suffix>.<ext>`, and any of them that predates
this migration is unreferenced by definition, because no `investor_docs` row
could exist to name it. Compare the volume against `SELECT url FROM
investor_docs` before deleting anything, since uploads from other doors share
the directory. `/health` reports the volume totals.

## Backup encryption, the uploads volume gap, and after a suspected exposure (2026-08-30)

**What was found.** `.github/workflows/db-backup.yml` dumped the whole
production schema daily, gzipped it, and uploaded it as a plain GitHub
Actions artifact. Actions artifact download follows repository read access.
It is not a separate permission. On a repository set to public, that made
every daily dump fetchable by any signed-in GitHub account for the whole
30-day retention window. The dump held, in plaintext: every `app_config`
integration secret (Stripe keys included), the village's own ed25519 signing
key (the one this document's Publishing section says to back up), private
message bodies, ballot reasons, and every `passwordHash`, a mix of bcrypt and
legacy unsalted SHA-256 for any account that has not logged in since the
bcrypt migration (`legacySha256` in `server/index.ts`, upgraded transparently
on next successful login and not before).

**Making the repository private and rotating the exposed secrets are actions
only the founder can take**, and both are logged in the fleet ledger's
blocker list as of this date. Nothing below substitutes for either. What
follows is the code and documentation side: closing the hole so a fork
cannot reopen it by accident, and giving a steward a checklist for the day
one of those two human actions turns out to be needed for real.

### The database dump is now encrypted before it ever leaves the runner

`db-backup.yml` now bundles `dump.sql.gz` and the fidelity `manifest.txt`
together and encrypts that bundle with GPG before upload. Nothing
unencrypted is written to an artifact. It encrypts to two recipients, for two
different reasons, and the distinction matters:

- **`BACKUP_GPG_PUBLIC_KEY`.** The real recovery key. Only the public half
  ever reaches this repository. Generate the pair somewhere that is not this
  machine's shell history and not a chat log, keep the private half offline
  (a password manager's secure note or an encrypted drive, never a plain
  file in `data/` or anywhere git-tracked), and paste only the public half
  into the GitHub secret:

  ```bash
  gpg --batch --full-generate-key <<'EOF'
  %no-protection
  Key-Type: EDDSA
  Key-Curve: Ed25519
  Subkey-Type: ECDH
  Subkey-Curve: Cv25519
  Name-Real: <your village> backup recovery key
  Name-Email: backup-recovery@<your-village-domain>
  Expire-Date: 0
  %commit
  EOF
  gpg --armor --export backup-recovery@<your-village-domain>
  ```

  `%no-protection` above only means GPG will not ask for a passphrase while
  generating locally. It says nothing about where the private half then
  lives, that part is the operator's own care. A founder more comfortable
  with a passphrase-protected key should add one; the workflow never touches
  this key's private half either way.

- **`BACKUP_DRILL_GPG_PUBLIC_KEY`** and **`BACKUP_DRILL_GPG_PRIVATE_KEY`.** A
  second, throwaway keypair whose only job is letting the `restore-drill` job
  prove, automatically, on every run, that the artifact it just built
  actually decrypts and restores. Its private half lives in CI secrets on
  purpose: it carries no real recovery value (rotating it loses nothing, and
  it is never the key that protects a real founder's data), so this is the
  one place "the private key never enters CI" does not apply. Generate it the
  same way as above with a name that says what it is, then set both halves:

  ```bash
  gpg --armor --export <drill-key-id> > drill_pub.asc          # -> BACKUP_DRILL_GPG_PUBLIC_KEY
  gpg --armor --export-secret-keys <drill-key-id> > drill_priv.asc   # -> BACKUP_DRILL_GPG_PRIVATE_KEY
  ```

Multi-recipient GPG stores an independent encrypted session key per
recipient, so the drill job decrypting with its own key never needs, and
never sees, the founder's recovery private key. This was verified locally
before landing: a bundle encrypted to both a throwaway "founder" key and a
throwaway "drill" key decrypts correctly holding only the drill private key,
and a copy of the same ciphertext with 32 bytes flipped at its midpoint is
refused by GPG's own integrity check (`gpg: WARNING: encrypted message has
been manipulated!`, non-zero exit) rather than silently producing garbage.
The workflow's `restore-drill-negative-control` job runs that exact
corruption test against the real artifact on every run, specifically so a
green `restore-drill` means something: if tampering or truncation ever
stopped being detected, that job goes red on its own, before anyone has to
notice a bad restore by hand.

**All three secrets are required.** The `backup` job checks for both public
keys before it dumps anything and refuses to run if either is missing,
rather than falling back to an unencrypted upload. `restore-drill` and its
negative control both refuse the same way if the drill private key is
missing. A skipped assertion that still exits 0 is the false-green failure
mode the fleet ledger's own section 7 already caught once; none of these
three checks are allowed to be that.

### The uploads volume: not covered yet, and here is exactly what closing it needs

**Honest status: `data/uploads/` has no backup of any kind, before this round
and after it.** The workflow above only ever touched MySQL. Member
photographs, brand images and investor documents live on the Railway volume
mounted at `/app/data`, and this document already says elsewhere that a
photograph there is not recoverable from anywhere if it is lost. That
sentence is still true today.

**What a GitHub Action genuinely cannot do:** reach into a Railway volume
directly. There is no API for "give me a tarball of this service's mounted
volume" that a scheduled Action can call, and this repository already has a
live data point on the alternative: `AMORA_FOUNDATION_UPGRADE_PLAN.md`
records a one-time volume pull over `railway ssh`, done by hand, once. The
Railway CLI's `ssh` subcommand is built for an interactive session, and nothing
in this codebase or its history demonstrates it running unattended, on a
schedule, on a headless CI runner, without a human at the keyboard. Wiring an
unverified `railway ssh` pipe into a scheduled workflow and hoping it keeps
working would be exactly the kind of half-built check this round exists to
avoid: it would either fail silently on a schedule nobody is watching, or
report success while quietly doing nothing, and nobody would find out until
the volume was needed for real.

**What actually closes the gap: an authenticated export endpoint on the
server**, specified here precisely enough for the lane that owns
`server/index.ts` to build it without redesigning it:

- **Route.** `GET /api/admin/backup/uploads-archive`.
- **Auth.** Not an admin session cookie or bearer login token; a GitHub
  Actions runner cannot hold either. A dedicated secret,
  `BACKUP_EXPORT_TOKEN`, set as a Railway env var on the app service and
  mirrored as a GitHub Actions secret, checked against a request header
  (`x-backup-export-token`) with a constant-time comparison. This follows the
  same fail-closed shape already used for `RIVERSIDE_WEBHOOK_SECRET` and
  `GOVERNANCE_HUB_SECRET` above: unset or mismatched means the route answers
  401 and does nothing, never a silent pass-through.
- **Body.** A streamed `tar` of `data/uploads/`, written directly to the
  HTTP response as files are read rather than buffered in memory first. The
  volume can reach hundreds of megabytes from photographs alone (see the
  `/health` `uploads.mb` figure and the place-photo sizing note above);
  buffering that in the one Node process that also serves live traffic risks
  the same process, so this has to stream.
- **A fidelity manifest, on the same shape as the MySQL one.** Before or
  alongside the stream, the route should make available: total file count,
  total bytes, and a SHA-256 of one deterministic canary file (the
  lexicographically first filename, so it needs no extra bookkeeping to
  choose) recorded at export time. That is what a restore-drill for this
  archive would assert against, exactly like the MySQL job asserts row
  counts and a round-tripped timestamp: decrypt, untar, count the files,
  sum the bytes, re-hash the canary, compare. There is no scratch Railway
  volume to actually redeploy into inside a GitHub Action, so this drill
  proves the bytes are intact and complete, not that a fresh deploy boots
  from them; that is the honest ceiling of what CI alone can assert here.
- **Audit.** Log each successful call (timestamp, at minimum) the same way
  other sensitive admin actions in this codebase are logged, so a call
  outside the daily schedule is visible.
- **Once it exists**, the GitHub Action side is a short addition to
  `db-backup.yml`: curl the endpoint with the token header, tar the response
  alongside its manifest, encrypt with the same two-recipient GPG pattern
  already landed for the database dump (reusing `BACKUP_GPG_PUBLIC_KEY` and
  `BACKUP_DRILL_GPG_PUBLIC_KEY`, no new keys needed), upload, and add a
  restore-drill step that decrypts with the drill key and asserts the
  manifest.

**Built 2026-08-31.** The route above exists. What follows is the contract, so
the lane that owns `.github/workflows/**` can wire the workflow half without
reading the server.

### The uploads export contract, as built (2026-08-31)

```
GET  {origin}/api/admin/backup/uploads-archive
     x-backup-export-token: $BACKUP_EXPORT_TOKEN
```

**Statuses.** `200` with the archive. `401` for a missing or wrong token (rate
limited to 10 failures per IP per hour). `503`, with a sentence naming
`BACKUP_EXPORT_TOKEN`, when the variable is unset on the server, so a village
that never configured it learns that instead of being told its correct token
is unauthorized. `409` when an export is already running on that instance.

**Body.** `Content-Type: application/x-tar`, chunked, no `Content-Length`. The
volume is streamed 64 KB at a time and is never assembled in memory, because
this is the same Node process that serves every member.

**Entries, in order.**

| Entry | Position | What it holds |
|---|---|---|
| `MANIFEST.txt` | first | `takenAt`, `files`, `bytes`, `canary`, `canarySha256`, `manifestEntry`, `statusEntry`, `archiveEntries`, `excludedOversize` |
| every upload file | middle | the volume, byte for byte, original filenames (long names travel as PAX records) |
| `EXPORT-STATUS.txt` | last | `complete=yes\|no`, `entries`, `contentBytes`, `degradedCount`, one `degraded=<name>` line per file that changed under the walk |

`files` and `bytes` count the upload files only. `archiveEntries` is that
count plus the two manifest entries, so a drill counting `tar -t` output has a
number to compare against rather than a subtraction to remember.

**The same manifest also rides in response headers**, so a drill can check the
numbers before spending disk on an untar: `x-uploads-taken-at`,
`x-uploads-files`, `x-uploads-bytes`, `x-uploads-canary`,
`x-uploads-canary-sha256`. They are written from one plan object, so the
headers and `MANIFEST.txt` cannot disagree.

**What a restore drill should assert**, in the shape the MySQL drill already
uses: decrypt, `tar -x`, count the files (minus the two manifest entries),
sum their bytes, re-hash the canary named in `MANIFEST.txt`, compare all three
against the manifest, and require `complete=yes` in `EXPORT-STATUS.txt`.

That last one is the assertion that stops a false green, and it is worth
saying why. A tar is a stream. One that dies at 60 percent still untars: you
get most of the files and no error worth noticing, and counts alone cannot
tell a truncated export from a small volume. `EXPORT-STATUS.txt` is written
after the last file, so a drill that can read it has proof the server reached
the end. `degraded` covers the other half: a file deleted between the stat
pass and the read pass leaves a correctly sized, zero padded hole, so the
count matches, the byte total matches, and the contents are wrong. Nothing
else in the archive would ever say so.

**`files=0` is a young village, not a broken export.** A fresh instance with no
uploads answers 200 with an archive holding only the two manifest entries,
`canary=` empty, and `complete=yes`. A drill that treats zero as failure will
go red on every new village.

**Two things this route does NOT do**, both deliberate. It does not encrypt:
the workflow reuses the two-recipient GPG pattern already landed for the
database dump (`BACKUP_GPG_PUBLIC_KEY` plus `BACKUP_DRILL_GPG_PUBLIC_KEY`, no
new keys), so there is one encryption implementation rather than two. And it
does not prove a fresh deploy boots from the bytes, because there is no
scratch Railway volume to redeploy into inside a GitHub Action. Intact and
complete is the honest ceiling.

**Still needed from a human**, and blocked on them: `BACKUP_EXPORT_TOKEN` has
to be generated (`openssl rand -hex 32`), set as a Railway environment
variable on the app service, and mirrored as a GitHub Actions secret. Until
both exist the route answers 503 and the workflow step has nothing to call.

### Secrets rotation checklist, for a steward, after any suspected exposure

Use this any time a backup artifact, a database dump, or a `.env` file may
have reached someone who should not have had it. It does not require reading
code. Where a step needs a technical helper, that is called out.

1. **Confirm the repository is private.** GitHub, the repository's own page,
   Settings, General, scroll to "Danger Zone", "Change repository visibility".
   If it says Public, change it to Private now, before anything else on this
   list. This alone stops new artifact downloads; it does not undo one that
   already happened.
2. **Stripe.** Log in to the Stripe dashboard, Developers, API keys. Roll the
   secret key. Update it wherever this village stores it (Admin,
   Integrations, if set there; otherwise the `STRIPE_SECRET_KEY` Railway env
   var). Also roll the webhook signing secret (Developers, Webhooks, the
   endpoint, "roll secret") and update `STRIPE_WEBHOOK_SECRET` the same way.
   Card checkout answers an honest 503 in the gap; nothing is lost by taking
   a few minutes here.
3. **Every other integration secret held in this app.** Resend, Riverside,
   the Governance Hub secret, a Basescan key, an Anthropic key, a feedback
   relay URL if it carries a token, an error webhook URL. Admin, Integrations
   lists what this village has configured and where each one came from
   (source and last four characters shown). For each one that has a
   provider-side dashboard, roll it there first, then paste the new value in.
   For one that is env-only with no admin screen (a Managed listing's key),
   ask a technical helper to rotate it on the Railway service.
4. **The village signing key.** This is the ed25519 key in `app_config`
   under `village-signing-key`, the one every peer village has pinned (see
   Peering, above). Rotating it is not a simple swap: every peer will pause
   with "signing key changed" until an admin on their side presses "accept
   and resume". Do this one deliberately, and tell peer villages it is
   coming, rather than as a reflexive part of this checklist. Ask a technical
   helper; it needs a database write, not an admin screen.
5. **Passwords.** Ask a technical helper to check how many accounts are
   still on the legacy hash (`passwordHash` not starting with `$2`, a plain
   64-character hex string). Any account in that state has a password that
   was crackable offline the moment the dump leaked, not merely guessable.
   The safe, simple answer that needs no query at all: force every member to
   reset their password (`POST /api/admin/users/:id/send-password-link` per
   account, or ask everyone to use "Forgot your password?" on `/login`).
   Every session ends the moment a password changes, so this also closes any
   session token that leaked alongside a hash.
6. **`AUTH_TOKEN_SECRET`.** Rotating this signs every existing session out at
   once, including yours. Do it after the password step above, not before,
   so members are not asked to sign back in twice in one day. A technical
   helper updates the Railway env var and redeploys.
7. **Write down what happened.** Date, what was exposed, what was rotated,
   and when. Keep it with the village's own records. The next person who
   asks "has this ever happened before" should not have to reconstruct the
   answer from memory.
## 2026-08-30: the onboarding kit

This document stayed the only onboarding material: no `README.md`, no
`.env.example`, no script that turns "a village name and a few answers" into
a running instance. A founder with no coding background had no path through
it. Four new files now sit beside it:

- `README.md` routes by audience instead of explaining everything: a
  founder standing up an instance, an operator running one, a developer
  changing the platform.
- `.env.example` names every environment variable this platform reads with
  a one-line comment on what breaks without it, generated from the table
  above so the two describe the same set. If you add a variable here,
  add the matching line there in the same session, the way this document's
  own opening rule already asks.
- `scripts/fork-init.mjs` writes a filled-in `.env` for a new instance: the
  generated secrets, whatever the founder answered, and an honest report of
  every variable it could not resolve because the value needs a human step
  (a Stripe account, a verified Resend domain) this script cannot perform.
  It does not touch `shared/gameConfig.ts` or any client file, because
  nothing about a village is a per-instance file to edit: identity lives in
  the database, set from Admin, Make This Yours, exactly as the Brand
  overlay section above already describes.
- `docs/PROVISIONING.md` is the ordered, imperative walkthrough distilled
  from this document, covering both the self-host and ReGen-hosted paths
  and naming the steps only a human can do (DNS, Resend domain
  verification, opening a Stripe account).
  `docs/FOUNDER_SETUP_PROMPT.md` is the same walkthrough as a single prompt
  a founder with no terminal experience can hand to their own Claude
  session.

**A verified trap while building this, and how it was closed.** Running
`pnpm test` with `TEST_DATABASE_URL` unset used to neither fail nor warn.
Every database-backed test file skips itself through `describe.skipIf`, the
run exited 0, and nothing on screen said a third of the suite had not run
except the summary line's own skip count. Re-measured 2026-09-02: 91 files,
1,190 tests, exit code 0.

Since 2026-09-02 an unfiltered run with the variable unset FAILS, prints the
count and names both ways forward. The smaller suite is still available and
now costs a word: `ALLOW_NO_TEST_DB=1 pnpm test`. `CI` and `REQUIRE_TEST_DB`
(`pnpm test:full`) outrank that waiver, so a run that declared the database
mandatory cannot be silenced by an env var in somebody's `.env`. The decision
is one function, `hollowRunVerdict` in `server/db/provisioningReport.ts`, with
its table in `server/db/provisioningReport.test.ts`.
## `VILLAGE_SECRETS_KEY`: your integration secrets at rest (2026-08-30, secrets lane)

**Set this before you set any key in Admin, Integrations.** Without it that
screen refuses to save.

```bash
openssl rand -hex 32        # 32 bytes as 64 hex characters
```

### What it is

The key that encrypts every credential a village types into Admin, Integrations:
`stripe_secret_key`, `stripe_webhook_secret`, `resend_api_key`,
`assistant_api_key`, `riverside_webhook_secret`, `governance_hub_secret`,
`basescan_api_key`, every slot a Connected listing contributes, and every
external calendar address. AES-256-GCM, in `server/lib/secrets.ts` on top of
`server/lib/sealedBox.ts`, the same primitive `MEMBER_SECRETS_KEY` uses.

It is a SEPARATE variable from `MEMBER_SECRETS_KEY` on purpose. That one holds
a member's own LLM key and derives their agent-inbox signing secret; losing it
costs a member a retyped key. This one holds the village's money. The two are
rotated for different reasons and by different people, so they do not share a
value. Setting both to the same string is not refused by anything, and it still
should not be done.

### Why this exists now

Storage in this document used to be plaintext JSON, by a written decision on
2026-07-27 that named its own revisit condition: revisit if backups start
leaving the deployment's trust boundary. `.github/workflows/db-backup.yml`
mysqldumps the whole database and uploads it as a GitHub Actions artifact kept
for 30 days, and the repository was public while those artifacts were produced,
so the condition had already fired. The repository was made private on
2026-08-30, which narrows who can fetch the artifacts that already exist and
does not un-produce them. A hosted fleet fires the condition a second time:
once ReGen holds another village's Stripe key, "the operator can read the
database anyway" stops being an answer, because the operator is no longer the
credential's owner.

### Who generates it

Whoever provisions the deployment, once, before handover.

- **A ReGen-hosted village.** ReGen generates it and sets it in the deployment's
  environment. It never travels by email or chat, and it is not the same value
  on two villages: one dump plus one leaked key must never open a second
  village. Hand the village its own key at handover if it may ever self-host.
- **A self-hosted village.** You generate it yourself with the command above and
  set it wherever your host keeps environment variables. Write it down somewhere
  that survives losing the server, because the database backup alone will not
  restore your Stripe key without it.

### What breaks if it is missing

- The server still boots and still serves. Reads fall back to environment
  variables exactly as they always have, so a village that configures Stripe
  through `STRIPE_SECRET_KEY` rather than through Admin notices nothing.
- **Every save in Admin, Integrations refuses** with "this deployment has no
  village-secrets key; ask your operator". Nothing is written in the clear.
- Clearing a key still works without it. Deleting an exposed value is never the
  dangerous direction, and an operator who has lost the key must still be able
  to take a credential out of the database.
- A boot log line names every key still sitting in plaintext from before the
  upgrade, by key name and never by value.
- One narrow case refuses to boot rather than serve: a deployment still holding
  a legacy `resend_api_key` or `assistant_api_key` inside the old email-config
  document has a one-time move to make at startup, and that move is a write. Set
  the key and restart. Any deployment that has booted since S63 has already done
  that move and is unaffected.

### What breaks if it is lost or rotated

Every value stored through Admin becomes unreadable. It is not recoverable:
that is what encryption at rest means.

What actually happens is quieter than a crash, which is why the panel says so
out loud. Each affected slot reports `unreadable: true` and falls back to its
environment variable, so a village with `STRIPE_SECRET_KEY` set in its
environment keeps taking payments and a village without it starts answering 503
on checkout. The fix is to re-enter each key in Admin, Integrations, which
re-seals it under the new value. A slot marked unreadable names itself, so you
know which keys to go and fetch; the four characters of the lost value are not
shown, because they describe a credential you can no longer use.

Rotating it deliberately, after a suspected exposure, is therefore a two-step
job: set the new value, restart, then re-enter every key the panel now marks
unreadable. Rotate the credentials themselves at the same time, since the reason
you are rotating this key is that somebody may hold the old one.

### Upgrading a village that already has secrets

Nothing to run by hand and no SQL migration. The database cannot do AES and is
deliberately never handed the key, so the conversion happens in the server at
boot: `loadSecrets` seals any plaintext entry in place and writes the document
back once. A second boot finds nothing to convert and writes nothing.

For one release the store reads both shapes, so a village that upgrades before
setting the key keeps working on its existing plaintext values. The follow-up
release stops accepting them, and any entry not converted by then reads as
absent with the environment variable taking over. Set the key before that
follow-up.
## Your village's own moon count (no migration)

Your moons are numbered from **your** first moon, so your village reads "Moon 7"
where another village reading the same sky reads "Moon 41". The number is worked
out every time a screen is drawn (`shared/villageMoon.ts` and
`server/lib/villageMoon.ts`) and is never stored: the database still files every
row under the absolute lunation id (`lunar-000336`), which is the one key
settlement matches on and the one key support can trace.

- **Moon 1 by default** is the moon your village launched under, taken from
  `launchedAt` in the `launch-state` document (`server/lib/launch.ts`). Nothing
  to set up.
- **New game variable, no migration:** `village.first_moon_at` (default blank,
  founder-held, category "Village"). A plain date such as `2026-03-19` moves
  Moon 1 to the moon containing that date. Blank goes back to the launch moon.
  It is deliberately outside the Village Calendar module's `variableKeys`,
  because every village counts moons whether or not it runs a calendar.
- **ONE MOON NUMBER, EVERYWHERE (2026-09-03).** Dating something takes one
  number and never a pair: "Moon 47", never "year 2, moon 3". The calendar's
  grid, week, year wheel, moon roll and .ics feed all print this count now,
  where they used to print the moon's place in the lunar year and reset it
  every year. `calendar.year_anchor` STAYS and still does its job: it decides
  where a lunar year begins, whether it holds twelve moons or thirteen, and
  which of the thirteen NAMES each moon carries. What it no longer supplies is
  a number anybody reads. Admin, Events keeps the thirteen name slots and says
  "of the year" on each so the two numbers cannot be confused.
- **Before your first moon**, screens show a moon's dates with no number on
  them. That covers a village that has not launched, rows older than the anchor,
  and a first-moon date set in the future. No screen shows "Moon 0" and none
  shows a negative moon.
- **Moving the date renames, and moves nothing.** Moon numbers people saw last
  week will read differently after the change; every settled total, credited
  amount and stored cycle id is untouched, because the number was never in them.

## Writing your own migration (2026-08-30, safety lane)

Your village may add SQL migrations of its own. Number them **9000 and above**.

That band is reserved for you and this repository promises never to take a number
in it; `scripts/check-migration-numbers.mjs` fails upstream CI if it ever does.
The reservation is not a formality. `server/db/migrate.ts` discovers migrations
by filename, sorts them **by filename**, and records each applied file in
`_migrations_applied` **by filename, with no checksum**. Two consequences follow,
and both of them are quiet.

- A file numbered `9001_...` sorts after every upstream number that will ever
  exist, so your migration always runs last and always builds on a complete
  upstream schema.
- If instead you take the next free upstream number, say `0121`, the week we
  ship our own `0121` you have two files on one number. If the descriptions
  differ, both run, in the alphabetical order of the descriptions. If the
  descriptions match, the pull overwrites your file, your database already has
  that filename recorded as applied, and **our version never runs on your
  instance and nothing tells you.** Every migration after it then assumes a
  schema you do not have.

Run the check yourself before you commit one:

```
node scripts/check-migration-numbers.mjs --village
```

`--village` (or `VILLAGE_LOCAL_MIGRATIONS=1` in your CI) is what tells it that a
9000+ file is expected here rather than an upstream mistake. It still refuses
two files on one number.

**Never edit a migration file that has already run**, ours or your own. The
ledger holds only the filename, so the edited body will never be applied on the
instance that ran it. Fix forward with a new file.

**And when you write one, expand rather than contract**, for the same reason we
do: adding a column is safe to roll back over, dropping one is not. The full
rule, with the table of what is safe to land and what is not, is in `CLAUDE.md`
under "Writing a migration", and `node scripts/check-migration-compat.mjs`
enforces it.

## Where a member stands on each path (0159, 0156, 0157)

Your fork ships four member paths, declared in `shared/gameConfig.ts` under
`paths`. A member's position on one of them is DERIVED from facts that are true
right now, and no position is ever stored. That is what lets a position fall on
its own when the fact behind it goes away, with nobody having to remember to
write the change down.

Nothing here needs an env var, a seed, or a provisioning step. Three migrations
apply at boot like every other. A migration file costs a fraction of a second
of the one-off schema build a test run pays once, and the figure moves with
machine load: two runs on this tree measured 261ms and 188ms per file. So read
your own with `pnpm measure:provisioning` rather than trusting either number
here, the same way the dist budget is read and never quoted.

| Path | Where its facts live | What makes a position fall |
|---|---|---|
| steward | `org_role_assignments` (0049) | a seating ends, or its season lapses |
| resident | `housing_reservations` (0077, indexed for this in 0159) | the reservation status moves to `withdrawn` |
| investor | `investor_path_facts` (0156) | a fact gets an `ended_at` |
| prosperity creator | `member_ventures` (0157) | the venture gets a `closed_at`, or is unlisted |

The server-side readers are `reservationsForMember` in `server/repos/housing.ts`,
`server/repos/investorPath.ts` and `server/repos/ventures.ts`.

**`investor_path_facts` holds no money, and that is not a style preference.**
The table has no numeric column at all, so it cannot store an amount even by
accident. Equity and voice are Hypha-governed tokens that live on Base and are
mirrored into your village READ-ONLY; a writable capital figure sitting beside
them would quietly become a second cap table, which is exactly what
`server/lib/ledger.ts` refuses to let this platform become. If you want to know
how much somebody holds, the ledger is the only thing that may answer, and it
answers from the mirror. What this table records is what happened and when:
they registered interest, the packet was released to them, they declared they
qualify, an agreement was signed. Words and dates.

The same rule applies to `member_ventures`: no revenue, no valuation. A
member-editable number about what a venture is worth is a claim your village
cannot stand behind, so the table does not offer one.

A prosperity creator's venture is PLATFORM data owned by the core `profiles`
module, and not a module of its own. That matters to you because a non-core
module ships OFF: put one of the four paths behind one and a village that never
turns it on shows three ladders and a hole. `profiles` is core and cannot be
disabled, which is why it owns this.

Both new tables carry `is_example`, the same standing-example flag
`org_role_assignments` uses. An example row is display only and is never
counted when a real member's position is worked out.
