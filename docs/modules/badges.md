# Module design: badges

Provenance: platform

> Produced by the 13-agent design workflow, 2026-07-26, from the 2020 village-demo deck (slides + speaker notes),
> the platform foundation plan's constraints, and the live codebase. Reconciled by MODULES_MASTER_PLAN.md —
> where this file and the master plan disagree, **the master plan wins** (it applies the two critique passes).

**A config-seeded badge system where self-declared flair, rule-earned achievements, admin/circle-granted recognitions, and expiring warning badges all flow through the one capability gate and one provenance journal — with governance voice structurally impossible to grant (F4), Hypha multisig badges mirrored read-only, and earned rules reading only consented/settled events.**

Estimated sessions: 7

## Design decisions, and why

- KILLED THE 2020 'voting multiplier badges' idea outright. The speaker notes say 'I see these for voting multiplier badges' — that is the exact door F4 welds shut. Improvement: at the time of writing, the platform's Capability union (shared/capabilities.ts) contained no vote/voice/weight key at all, so a badge could not grant governance voice even by admin typo. Voice is a Hypha token, read-only here. Enforced three ways: structural (no key exists), boot assertion (unknown capability key in any badge → refuse to boot, fail-loud like gameVariables), and server rejection of writes. The 2020 deck had no firewall; this design makes the firewall the first invariant. **STALE AS OF ROUND 5 — READ THIS.** The structural half is gone: `ballot.vote` and `member.vouch` are now capability keys, the ballot electorate is built by running the one gate over every member (`server/index.ts`, `buildElectorate`), and a granted badge carrying `ballot.vote` therefore puts its holder in the electorate. The boot assertion and the write rejection still stand, and both only check that a key is KNOWN, which these are. See `docs/BADGE_ARCHITECTURE_REVIEW.md` section 7 for what must change before a `badge_grant` proposal type ships.
- SPLIT DECLARATION FROM AUTHORIZATION. The 2020 slide mixed 'self-professed skills' and 'badges that give rights and powers' in one concept — a self-labeling path to self-authorization. Here kind='self' badges and skill tags are hard-coded to carry zero capabilities (boot assertion rejects a self badge with a nonempty capabilities array), and the UI styles them visibly as 'self-declared'. Why: any badge that grants a right must have provenance someone else stands behind; a personality-type sticker must never be a key.
- PROVENANCE ON EVERY AWARD. The deck treats badges as stickers. Here every award mutation (award/stack/revoke/expire) is an append-only badge_events row with actor, source, reason, cycleId, and evidenceRefs pointing at real records (consented claim ids, settled cycle ids, ledger entry ids) — the same discipline as token_ledger, including unique idempotencyKey varchar(160). A badge is an auditable claim, and its popover shows who issued it, when, and on what evidence.
- ANTI-GAMING BY EVENT CLASS, NOT BY MODERATION. The 2020 'every 1,000 points' and '10,000 contribution to a marketing category' rules would be farmable via circular gratitude. Earned rules here read ONLY consented/settled events: quest_claims.status='consented', gratitude_distributions (which only exist after an idempotent cycle close), and ledger entries with source='quest_consent'. Raw un-settled sends and self-reported activity are structurally invisible to the rule engine. Breadth beats volume: the recognition-based rule keys on distinctSenders (already computed at close), not raw totals, so a two-person mutual-admiration loop cannot mint a badge.
- STACKING AS RECOMPUTATION, NOT INCREMENT. Badges stack in the original concept; here count = floor(metric / threshold) recomputed at each evaluation against maxStack, mirroring the ledger's recompute-never-increment rule, with one badge_events row per tier crossed (idempotency key rule:{badgeId}:{userId}:tier-{n}) so a re-run of cycle close stacks nothing twice.
- WARNING BADGES DE-WEAPONIZED. The deck's 'Sentiment (potential scammer)' badge is a public defamation instrument. Improvement: warning badges are visibility='private' (the member and admins only, never on wall/map/profile-public), require a written reason, auto-expire (lazy expiry — treated as expired at read time, status flipped at next cycle close or admin action, so no scheduler needed), and act through the SAME gate as everything else, as capability DENIES (e.g. forum.post, library.borrow) rather than a parallel punishment system. A timeout silences even a role holder; only the operator bypasses.
- HYPHA BOUNDARY MADE EXPLICIT. The deck's 'multisig issued badges' (Treasury, Ambassador, Bioregional Architect) are circle M-Sig acts — that is governance, so they live on Hypha. Here kind='hypha' badges are read-only mirrors: v1 an admin records the mirror with the Hypha proposal URL as evidence and the chip deep-links to the DHO; the platform never pretends to be the multisig, and mirrored badges grant no platform capabilities (a stale mirror must not be a privilege escalation — if a village wants Hypha badge holders to have in-app powers, an admin grants a role or a platform badge deliberately).
- EXPIRY AND REVOCATION FIRST-CLASS. 2020 badges were permanent. Every award has optional expiresAt, revocation with actor+reason, and a 'restore' path — because seasonal roles lapse, warnings must end, and a revoked badge with no audit trail is a fight waiting to happen.
- SKILL TAGS ACTUALLY WIRED TO THE STATED USE. The deck's parenthetical '(for suggesting members when a new role is created)' becomes a concrete API: GET /api/badges/match scores members by skill-tag overlap + relevant earned badges, surfaced as a MemberMatchPanel in the admin role-creation flow and consumable by the village map concierge module. The suggestion path is explicit about its inputs: self-declared tags SUGGEST, earned badges CORROBORATE, and the panel labels which is which.
- WHITE-LABEL FROM DAY ONE. Registry is config-seeded (server/seeds/badges-seed.json) with zero village-specific copy in platform files; every threshold is a fail-loud game variable so forks inherit defaults and tune without deploys; the whole module ships OFF behind badges.enabled.
- NO SCHEDULER REQUIRED. Point-total badges imply a background job to evaluate them, and this platform has no scheduler. Earned evaluation piggybacks on the existing admin-triggered idempotent cycle close (server/lib/gratitude-cycles.ts flow), and expiry is lazy-evaluated at read. The module works today and gets strictly better when the Phase 3 scheduler lands.
- INSTRUMENTED FOR F13. Every badge event doubles as a health event (append-only), so 'warning badge rate', 'badge concentration per person', and 'earned-vs-granted ratio' are queryable later without retroactive data loss.

## Data model

# Data model (Drizzle/MySQL — JSON files first per foundation phase, identical shapes)

V1 ships as JSON stores (data/badges.json, data/badge-awards.json, data/badge-events.json, data/skill-tags.json) with seeds in server/seeds/badges-seed.json + ensureDataFiles() entries, because data/ is still authoritative; the Drizzle tables below go into server/db/schema.ts now so the repository cutover carries them mechanically.

## badges — the registry (config-seeded + admin-created)

| column | type | notes |
|---|---|---|
| id | varchar(64) PK | slug, e.g. `marketing-wizard`, `timeout` |
| name | varchar(120) NOT NULL | |
| description | text | plain language, shown in popover |
| icon | varchar(64) | emoji or icon key |
| kind | enum('self','earned','granted','warning','hypha') NOT NULL | drives every rule below |
| capabilities | json | capability keys GRANTED. MUST be [] for kind self/hypha — boot assertion + server rejection. Keys validated against the Capability union; unknown key → refuse to boot (F4) |
| denies | json | capability keys REMOVED. Only kind='warning' may populate |
| rule | json | only kind='earned': `{metric, threshold, scope?, stackable}` — metric ∈ quests_consented | ledger_earned_total | gratitude_breadth | gene_keys_shown | cycle_streak(v2)\| ledger_earned_total \| gratitude_breadth \| cycle_streak(v2); scope: `{circle?: string}` |
| stackable | boolean default false | |
| maxStack | int default 1 | cap on count |
| defaultExpiryDays | int NULL | warnings default from game variable |
| visibility | enum('public','members','private') default 'public' | kind='warning' forced 'private' server-side |
| hyphaRef | json NULL | `{dhoUrl, hyphaBadgeSlug}` for kind='hypha' deep links |
| active | boolean default true | deactivate, never delete (awards reference it) |
| sortOrder | int default 0 | |
| createdBy | varchar(64) NULL | NULL = config seed |
| createdAt / updatedAt | timestamp | |

## badge_awards — current state, one row per (badge, user)

| column | type | notes |
|---|---|---|
| id | varchar(64) PK | |
| badgeId | varchar(64) NOT NULL | FK → badges.id |
| userId | varchar(64) NOT NULL | FK → users.id |
| count | int default 1 | stack count; RECOMPUTED from rule metric, never incremented |
| status | enum('active','expired','revoked') default 'active' | expiry is lazy: reads treat expiresAt < now as expired even before status flips |
| featured | boolean default false | member picks up to badges.max_featured for bylines/map chips |
| source | enum('self','rule','admin','hypha_mirror') NOT NULL | |
| reason | varchar(500) | required for admin awards + all warnings |
| evidenceRefs | json | `[{type:'claim'\|'cycle'\|'ledger'\|'hypha_proposal', ref}]` |
| ruleKey | varchar(100) NULL | which rule fired |
| cycleId | varchar(64) NULL | cycle of last evaluation, `lunar-000328` format |
| expiresAt | timestamp NULL | |
| revokedAt / revokedBy / revokeReason | timestamp / varchar(64) / varchar(500) | |
| awardedAt | timestamp NOT NULL | |
| — | UNIQUE(badge_id, user_id) | idempotent awards; stacks live in count |

## badge_events — append-only provenance journal (ledger discipline)

| column | type | notes |
|---|---|---|
| id | varchar(64) PK | |
| awardId | varchar(64) NOT NULL | |
| badgeId / userId | varchar(64) | denormalized for audit queries |
| action | enum('award','stack','revoke','expire','restore','unclaim') NOT NULL | |
| delta | int default 0 | count change |
| actorId | varchar(64) NULL | admin, or the member for self-claims; NULL for rule/system |
| source | enum('self','rule','admin','hypha_mirror','system') NOT NULL | |
| cycleId | varchar(64) NULL | |
| reason | varchar(500) | |
| evidenceRefs | json | |
| idempotencyKey | varchar(160) NOT NULL UNIQUE | e.g. `rule:{badgeId}:{userId}:tier-{n}`, `warn:{adminId}:{userId}:{ts}` — 160 because user ids are varchar(64) |
| at | timestamp NOT NULL | |

## skill_tags — self-professed skills (feed role matching; never capabilities)

| column | type | notes |
|---|---|---|
| id | varchar(64) PK | |
| userId | varchar(64) NOT NULL | |
| tag | varchar(64) NOT NULL | normalized lowercase-kebab, e.g. `permaculture-design` |
| note | varchar(255) | e.g. "10 years, certified 2019" |
| createdAt | timestamp | |
| — | UNIQUE(user_id, tag) | capped by badges.max_skill_tags |

## Endpoints

- `GET /api/badges — active registry, public fields only (module toggle checked; 404 when badges.enabled=false)`
- `GET /api/badges/mine — my awards (all visibilities incl. my own warnings) + my skill tags`
- `GET /api/badges/of/:userId — another member's awards filtered by visibility (public, or members if requester authed); warnings NEVER returned here`
- `POST /api/badges/self/claim — {badgeId} where kind='self'; capped by badges.max_self_badges; writes award + 'award' event`
- `POST /api/badges/self/unclaim — {badgeId}; 'unclaim' event`
- `PUT /api/badges/featured — {badgeIds: string[]} capped by badges.max_featured; only own active awards`
- `GET /api/skills/mine · POST /api/skills {tag, note?} · DELETE /api/skills/:tag — skill tag CRUD, normalized server-side`
- `GET /api/badges/match?tags=a,b,c&badgeIds=x,y — ranked member suggestions (tag overlap + corroborating earned badges); gated: admin or quest.consent capability; consumed by admin role-creation panel and the village map concierge module`
- `POST /api/admin/badges — create registry entry; rejects capabilities on kind self/hypha, denies on non-warning, unknown capability keys (F4)`
- `PUT /api/admin/badges/:id — edit; same validation; deactivation via {active:false}`
- `POST /api/admin/badges/:id/award — {userId, reason, expiresAt?}; kind='granted'; provenance recorded with actor`
- `POST /api/admin/badges/:id/revoke — {userId, reason}; flips status, 'revoke' event`
- `POST /api/admin/badges/warnings — {userId, badgeId, days?, reason}; kind='warning' only; expiresAt = now + (days ?? badges.warning_default_days); denies take effect immediately via the gate`
- `POST /api/admin/badges/hypha-mirror — {userId, badgeId, hyphaProposalUrl}; kind='hypha'; records read-only mirror with the proposal URL as evidenceRef (v1 manual; v2 automated read)`
- `POST /api/admin/badges/evaluate — manual earned-rule run (same idempotent engine the cycle-close hook calls); returns {awarded, stacked, expired}`
- `GET /api/admin/badges/events?badgeId=&userId=&action= — paged audit journal`
- `(internal) evaluateEarnedBadges(cycleNumber) called from the existing admin-triggered cycle close after distributions settle — not a new HTTP path, extends the current close flow in server/lib/gratitude-cycles.ts callers`

## Surfaces

Pages/components (all platform-generic, copy from config/seeds):

- **Profile.tsx** gains `client/src/components/badges/BadgeShelf.tsx` — awards grouped by kind with stack counts ("×3"), self-declared badges visually distinct (outline style + "self-declared" microcopy), `BadgeProvenancePopover.tsx` (issued by whom/when/why, evidence links, Hypha deep link for mirrors), `FeaturedBadgePicker.tsx`, and `SkillTagEditor.tsx`. Own warnings visible only to self, in a private "notices" section with expiry countdown.
- **GratitudeWall.tsx / Village Pulse byline**: up to badges.max_featured chips (`BadgeChip.tsx`) next to names when badges.show_on_byline is on.
- **Village map nodes** (parallel module): consumes GET /api/badges/of/:userId featured chips — read-only integration, no coupling.
- **Roles page / admin role creation**: `MemberMatchPanel.tsx` — "who could fill this role" ranked by skill-tag overlap + corroborating earned badges, labeling self-declared vs earned evidence.
- **Admin.tsx**: new "Badges" tab following the existing tab pattern → `client/src/components/admin/AdminBadges.tsx` (see adminControls).
- **Nav**: no top-level page in v1 (badges live on profiles); v2 adds an optional "/badges" directory page (who holds what, public kinds only) contributed to nav only when the module is on.
- **Mobile**: chips are inline elements, shelf wraps; no FAB entries needed.
- **shared/badges.ts**: types + rule schema + validation, pure and shared, like shared/capabilities.ts.

## Mechanics

# Gate integration (the core mechanic)

shared/capabilities.ts `hasCapability` ctx gains `badgeCapabilities: readonly string[]` and `badgeDenies: readonly string[]`. Evaluation order:
1. isAdmin → true (operator always acts)
2. badgeDenies includes cap → **false** (a timeout silences even a role holder)
3. roleCapabilities includes cap → true
4. badgeCapabilities includes cap → true (the THIRD grant source)
5. stage unlock → true
6. else false

Server composes ctx once per request: badgeCapabilities = union of `capabilities` over active, non-expired awards whose badge kind ∈ {earned, granted}; badgeDenies = union of `denies` over active, non-expired warning awards. Pure function stays unit-testable and identical client/server.

# F4 invariant (stated as invariant, per instruction)

**Badges must NEVER grant governance voice. Voice is a Hypha token; formal decisions bind on Hypha.** Enforcement: (a) structural — no vote/voice/weight key exists in the Capability union, so there is nothing to grant; (b) boot assertion in ensureDataFiles()/config load — any badge carrying an unknown capability key, a self/hypha badge with nonempty capabilities, or a non-warning badge with denies → log fatal, refuse to boot; (c) server rejects violating writes with a clear error; (d) server/badges.invariants.test.ts locks it.

**Round 5 amendment: (a) no longer holds.** The on-site governance engine put decisions on the platform, and with them `ballot.vote` and `member.vouch` as ordinary capability keys. A badge can carry either. (b), (c) and (d) still hold and are unchanged, and they enforce that a key is known rather than that it is harmless. The invariant above stays the intent; the mechanism that made it structural has to be rebuilt on the `badge_grant` proposal type, which is where the grant-by-vote decision now lives. `docs/BADGE_ARCHITECTURE_REVIEW.md` section 7 states the two conditions, and its section 4 carries a second finding this contract does not cover: editing a badge's `capabilities` array through `PUT /api/admin/badges/:id` silently re-writes what every existing holder can do, with no notification and only a coarse `badge:edit` audit row. The route already refuses a silent `kind` change for exactly this reason and never had the same guard extended to the capability set.

# Earned-rule evaluation (v1: at cycle close — no scheduler exists)

Hooked after distributions settle in the existing idempotent admin-triggered close. For each active kind='earned' badge, per member:
- quests_consented: metric = COUNT(quest_claims WHERE status='consented' [AND quest.circle = scope.circle])
- ledger_earned_total: metric = SUM(token_ledger.amount WHERE source='quest_consent' AND tokenType='gratitude') — earned work only, received gifts excluded (anti-loop)
- gratitude_breadth: metric = distinctSenders from the just-settled gratitude_distributions row
- cycle_streak (v2): consecutive settled cycles with ≥1 consented claim or distribution row

targetCount = min(floor(metric / threshold), maxStack) for stackable; else metric ≥ threshold ? 1 : 0. If targetCount > current count: upsert award, write one 'stack'/'award' event per tier crossed with idempotencyKey `rule:{badgeId}:{userId}:tier-{n}` — re-running close awards nothing twice (unique key is the dedupe, not a flag). targetCount never decreases an earned award; only revocation does.

**Anti-gaming rule (invariant #2): rules read consented/settled events ONLY** — consented claims, post-close distributions, quest_consent ledger credits. Never raw sends, never un-consented submissions, never self-reported anything.

# Award state machine

active → expired (lazy: expiresAt < now filters at read; status flip + 'expire' event swept at next cycle close or admin action) · active → revoked (admin, reason required) · revoked/expired → active via 'restore' (admin, new event). Self badges: claim/unclaim freely within cap.

# Matching score (v1, deterministic — no LLM)

score = 2×|requested tags ∩ member tags| + 1×|corroborating earned badges| (badge relevant if its rule scope.circle or slug matches a requested tag); ties by recency of last consented claim. Deterministic-first per the plan; Maia enrichment is v2.

# Pulse + health events

Public-visibility awards emit addActivity("badge", "{firstName} earned {badge} ×{n}"); warnings emit nothing publicly. Every event row doubles as an F13 health event (append-only, queryable later).

## Game variables

- badges.enabled: false (boolean) — master module toggle; OFF by default, per-deployment admin enables; when off: no nav, endpoints 404, gate contributes nothing
- badges.max_self_badges: 5 (0–50) — cap on self-declared flair per member
- badges.max_skill_tags: 12 (0–100) — cap on self-professed skill tags
- badges.max_featured: 3 (0–10) — badges shown in bylines/map chips
- badges.warning_default_days: 14 (1–365) — default warning/timeout expiry when the issuer sets none
- badges.evaluate_on_cycle_close: true (boolean) — run the earned-rule engine as part of cycle close
- badges.earned_points_per_stack: 1000 (1–1000000) — the original 'every 1,000 points' threshold for the defaultmetric ∈ quests_consented | ledger_earned_total | gratitude_breadth | gene_keys_shown | cycle_streak(v2)badge (unit: Gratitude, quest-consent credits only)
- badges.gratitude_breadth_threshold: 5 (1–1000) — distinct senders in one settled cycle for the breadth badge
- badges.streak_cycles: 3 (2–24) — consecutive active cycles for the streak badge (v2)
- badges.show_on_byline: true (boolean) — featured chips on wall/pulse bylines
- badges.self_badges_public: true (boolean) — whether self-declared badges show on public profiles or members-only. All registered in shared/gameVariables.ts (category 'Badges') — unknown key throws, only changed values stored, forks inherit defaults.

## Admin controls

Admin.tsx "Badges" tab (AdminBadges.tsx), following the existing tab pattern, contributed only when badges.enabled: (1) Registry editor — list/create/edit/deactivate badges; kind picker drives the form (capabilities multi-select from the Capability union appears only for earned/granted; denies only for warning; rule builder only for earned; hyphaRef only for hypha); server-side F4 validation mirrored client-side with the same messages. (2) Award console — grant a 'granted' badge (member picker, reason required, optional expiry), revoke with reason, restore. (3) Warnings desk — issue timeout/warning with days + required reason, see active warnings with expiry countdowns, lift early (revoke); private, never listed on public surfaces. (4) Hypha mirror — record a mirrored DHO badge against a member with the proposal URL (v1 manual). (5) Evaluate button — manual earned-rule run with a result summary (awarded/stacked/expired), same engine as the cycle-close hook. (6) Audit journal — filterable badge_events view (who/what/when/why/evidence). Game-variable tuning stays in the existing Game Mechanics variables editor (category 'Badges').

## Dependencies

- shared/capabilities.ts — extended, not bypassed: badges are the third grant source and first deny source in the one gate
- token_ledger + server/lib/ledger.ts — earned rules read quest_consent credits; event journal copies its idempotency discipline
- Lunar cycle close (server/lib/gratitude-cycles.ts + gratitude_distributions) — v1 evaluation trigger and the source of settled breadth data
- shared/gameVariables.ts + server/lib/variables.ts — all thresholds fail-loud, admin-editable
- roles-as-data (roles, role_holders) — role creation flow hosts the MemberMatchPanel; role grants remain a separate grant source
- quest_claims (status='consented') — the consent gate is the anti-gaming substrate
- Village Pulse addActivity() — public award announcements
- ensureDataFiles() + server/seeds/ — badges-seed.json and four data files (JSON authoritative until the repository cutover)
- Admin.tsx tab pattern — new Badges tab
- Optional/consumed-by: village map module (featured chips via /api/badges/of/:userId), forum bylines (Phase 4), notification spine (Phase 3, v2), Maia PROPOSAL_KINDS (v2 skill extraction)
- Hypha DHO (app.hypha.earth, per-village URL) — mirror-and-deep-link only; the platform never issues or reads-as-authority multisig badges

## v1 (ship first, useful alone)

Ships alone and useful (4 sessions): Session 1 — shared/badges.ts (types, rule schema, validation), four JSON stores + seeds + ensureDataFiles entries, Drizzle tables in schema.ts, capabilities.ts extension (badge grants + warning denies, evaluation order), F4 boot assertions, server/badges.invariants.test.ts + gate unit tests. Session 2 — AdminBadges tab: registry CRUD with kind-driven validation, granted-badge award/revoke/restore with provenance, warnings desk with expiry (lazy expiry at read + sweep), manual Hypha mirror, audit journal, pulse entries; gate enforcement live on forum.post etc. Session 3 — member surfaces: self-claim/unclaim, skill tags, BadgeShelf + provenance popover + featured picker on Profile, /api/badges/of/:userId with visibility rules, byline chips on the Gratitude Wall. Session 4 — earned engine: evaluateEarnedBadges hooked into cycle close (quests_consented,metric ∈ quests_consented | ledger_earned_total | gratitude_breadth | gene_keys_shown | cycle_streak(v2)stacking, gratitude_breadth), idempotent tier events, recompute-based stacks, /api/badges/match + MemberMatchPanel in role creation. Default seed set (platform-generic): First Quest, Steady Hands (5 consented quests), Widely Thanked (breadth), Village Craftsperson per-circle (stacking), Timeout (warning, denies forum.post), Hypha Treasury Mirror (display-only example).

## v2 (the rest of the design)

The rest of the design (3 sessions): Session 5 — automated Hypha badge reads (poll the village's configured DHO for badge assignments, refresh mirrors read-only, stale-mirror indicator, deep links) replacing manual mirror entry; flag: needs confirmation of a usable Hypha read API. Session 6 — notification spine integration ('you earned X' in-app + email via Phase 3 dedupeKey infra), cycle_streak rules, warning-expiry notifications, Maia skill extraction (post-process existing proposal conversations to SUGGEST skill tags the member confirms — extends PROPOSAL_KINDS plumbing, never auto-writes). Session 7 — public /badges directory page (who holds what, public kinds only, opt-in), village map featured-chip integration hardened, forum byline chips (Phase 4), F13 health views over badge_events (warning rate, badge concentration, earned-vs-granted ratio) in the command centre.

## Risks

- Capability creep: granted badges + role grants are two admin-controlled permission paths; mitigation is provenance (every grant names an actor and reason) and the audit journal, but a sloppy admin can still fog who-can-do-what — the admin UI should show 'effective capabilities' per member (small add, high value)
- Cycle-close coupling: if a village never closes cycles, earned badges never evaluate and warnings never sweep; the manual /evaluate button is the escape hatch, and the Phase 3 scheduler removes the coupling — document it loudly until then
- Warning badges are still moderation power: private visibility and expiry reduce harm, but an admin can silence a member indefinitely by re-issuing; consider surfacing re-issue counts in the audit view
- Defamation/legal: the original 'potential scammer' concept is deliberately dropped; if any fork re-adds public negative badges via the admin registry, that is a real legal exposure — the platform forces kind='warning' to private, but flag for legal review whether even private conduct labels need a retention/appeal policy
- Badge inflation: unlimited admin-created badges cheapen the earned ones; social problem, partially mitigated by visual separation of kinds and no public leaderboard (F3 posture)
- JSON concurrency until the repository cutover: award + event are two file writes; keep both behind one store module so the cutover makes them one transaction, and accept the small race window the whole app currently has
- Hypha mirror staleness (v2): a revoked DHO badge could display here until refresh; show 'as of {date}' on mirrored chips and never attach platform capabilities to them (already an invariant)
- Skill-tag junk data: free-text tags fragment ('permaculture' vs 'perma-culture'); normalization helps, a per-village curated vocabulary may be needed — left as an open question

## Open questions

- Should received recognition count toward the points-per-stack badge, or only quest-consent credits? v1 says quest-consent only, which stops a badge being farmed on the recognition it scores. A village that wants breadth-weighted received recognition counted changes the registry rule and takes that loop on knowingly.
- Personality-type self badges: which taxonomy? MBTI naming carries trademark considerations, so the recommendation is a village-defined self-badge set in the seed.
- Warning visibility: member + admin only, or also circle leads (who may be the ones affected by e.g. a borrowing timeout)? V1 ships admin+self only
- Does 'circle-lead issued' granting need its own capability (badge.grant scoped per circle) in v1, or is admin-only granting enough until circles are first-class? V1 ships admin-only with the capability key reserved
- Is there a usable Hypha API/chain read for badge assignments per DHO, and what auth does it need? Determines whether v2 session 5 is automated or stays manual
- Should featured badges appear on the public Team page and in Maia's context when suggesting members? Both are cheap adds once /api/badges/of/:userId exists
- Skill-tag vocabulary: free (normalized) vs curated-per-village list — affects match quality; could be a game variable choice
- Does the village map concierge want match results ranked or raw (it may apply its own scoring)? Coordinate the /api/badges/match response shape with that module before session 4
