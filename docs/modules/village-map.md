# Module design: Village Map — interactive sociocratic map + coordination concierge

<!-- describes: server/seeds/circles-seed.json scripts/import-map-scene.ts shared/mapScene.ts server/lib/mapScene.ts drizzle/0063_map_scene_publish.sql drizzle/0069_characters.sql server/lib/orgChart.ts server/repos/quests.ts shared/power.ts shared/mapLayout.ts shared/money.ts drizzle/0093_place_photos.sql server/lib/placePhotos.ts -->

Provenance: platform

> Produced by the 13-agent design workflow, 2026-07-26, from the 2020 village-demo deck (slides + speaker notes),
> the platform foundation plan's constraints, and the live codebase. Reconciled by MODULES_MASTER_PLAN.md —
> where this file and the master plan disagree, **the master plan wins** (it applies the two critique passes).

> **Superseded on one point, 2026-08-03: what a "role" on this map is.**
>
> Everywhere below, "role" means a row in the `roles` table with the `circle_id`
> and `seats` columns that `0018_village_map.sql` added. That is no longer what
> the map renders. `roles` is a PERMISSION-GROUP carrier whose `capabilities[]`
> is the only per-village source feeding the capability gate, and it held four
> rows (`founders-circle`, `steward-circle`, `treasury`, `practitioners`), so
> the map was drawing permission groups as org-chart seats. Nobody saw it
> because the module ships off.
>
> `0049_org_roles.sql` split them. Seats now live in `org_roles`, holders in
> `org_role_assignments` as dated rows with terms and history, and `/api/map`
> reads that plane. Nothing in it reaches the gate.
>
> What still holds exactly as written: vacancy stays DERIVED with no status
> column (now `seatState`, which gained a fifth state, `expired`, for a seat
> whose holders' mandates have run out); the `map.viewPeople` / `map.contact`
> tiers; the deterministic-first concierge and its unmatched-query log as the
> demand signal. What changed underneath: the concierge scores seat prose in
> the `purpose` bucket and filters stopwords, because seats joining the
> candidate set let a long accountability list outrank the circle it sits in.
>
> `docs/ARCHITECTURE.md` §3.15 is the as-built description of the two planes,
> and §3.16 covers what a season turn does to a seat. Where this file disagrees
> with either, they win.

**A deterministic radial SVG map of circles, roles (holders' faces, vacancies greyed as open calls) and quest satellites that doubles as a coordination tool: type "I want to plant trees" and it routes you to the Food Forest circle lead with a one-click, privacy-respecting contact relay.**

Estimated sessions: 7

## Design decisions, and why

- Closed the loop the 2020 slide left open: the slide was a visualization; every node here has an action — occupied role -> view profile/contact relay, vacant role -> raise-your-hand application into the EXISTING admin submissions inbox (no new moderation surface), quest satellite -> claim via the shipped quest flow.
- Concierge with deterministic-first matching: keyword/tag scoring over circles/roles/quests resolves unambiguous queries with ZERO LLM tokens (the plan's 'deterministic first' pattern); the LLM ('coordination' assistant kind, reusing Maia's guards, caps and injection framing) only disambiguates and drafts the intro message. Slide had no search at all.
- The map is also a demand sensor: every concierge query is logged (F13 'instrument now, dashboard later'), so UNMATCHED queries — things members want to do that no role covers — become the founders' signal for which role to create next. The 2020 concept only displayed supply.
- Deterministic hand-rolled radial orbit layout instead of amcharts force-directed physics: positions are a pure function of (circle sortOrder, node index), so the map is spatially stable between visits (spatial memory), jitter-free, snapshot-testable, SSR-safe, and zero new dependencies — animated with the framer-motion already in the repo.
- A privacy layer the slide never considered: faces/names are member-gated via shared/capabilities.ts (map.viewPeople), contactability is per-user opt-out, emails never render anywhere, and contact goes through a Resend relay with Reply-To so reply-by-email works with no DM system and no address leak in the UI.
- Vacancy is a DERIVED state (zero role_holders rows) plus a seats count, so 'Food Forest crew — 1 of 3 seats filled' renders as a partial call instead of the slide's binary greyed/filled; no status column to drift out of sync.
- Circle name reconciliation: quests.circle free-text values ('Regenerative Agriculture') don't match the hardcoded Circles.tsx page ('Permaculture Council'); circles get an aliases[] column and an admin reconciliation helper, turning an existing latent data bug into structure.
- Mobile-first honesty: below 768px the force/radial canvas is replaced by a circle-accordion list with identical data and actions — the 2020 concept ignored phones entirely, and a network graph at 390px is unusable.
- White-label per the config mandate: all circle names live in server/seeds/circles-seed.json, colors come from CSS theme tokens, the module ships OFF behind map.enabled and contributes nav/route/admin-tab only when on.
- Hypha boundary made explicit where the slide said 'on-chain data nested by circle': v1 sources entirely from platform roles/quests; v2 adds an optional per-deployment read-and-display of a Hypha DHO circle structure with deep-links out — never writes, per the locked rule.

## Data model

## New tables (Drizzle/MySQL; JSON-file twins first, since data/ is still authoritative — `data/circles.json`, `data/contact-requests.json`, `data/concierge-queries.json`, each with a seed in `server/seeds/` + `ensureDataFiles()` entries)

### `circles` (seed: `server/seeds/circles-seed.json` — a village's own names live in the seed, never platform files)
| column | type | notes |
|---|---|---|
| id | varchar(64) PK | slug, e.g. `permaculture-council` |
| name | varchar(120) NOT NULL | |
| purpose | text | one-liner shown on node card |
| aliases | json | legacy `quests.circle` free-text names that resolve here (fixes the Circles.tsx vs quests.json name drift) |
| parent_circle_id | varchar(64) NULL | self-reference; sociocratic nesting (render depth 2 in v1) |
| lead_role_id | varchar(64) NULL | FK-by-convention to `roles.id`; the concierge's default contact |
| icon | varchar(64) | lucide name, same convention as `quests.icon` |
| color | varchar(32) | theme token name, not hex, so forks re-skin via CSS |
| status | enum('active','forming','dormant') DEFAULT 'active' | `forming` renders greyed as a call |
| sort_order | int DEFAULT 0 | drives deterministic layout angle |
| created_at | timestamp DEFAULT now() | |

### `contact_requests` (the "contact event" — NOT a DM system, NOT a shadow notifications table)
| column | type | notes |
|---|---|---|
| id | varchar(64) PK | |
| from_user_id | varchar(64) NOT NULL | member sending |
| to_user_id | varchar(64) NOT NULL | holder resolved at send time |
| role_id | varchar(64) NULL | which role they were contacted AS |
| circle_id | varchar(64) NULL | |
| quest_id | varchar(64) NULL | context ("about Food Forest Tender") |
| query_id | varchar(64) NULL | links back to `concierge_queries` for the funnel metric |
| message | text NOT NULL | required, like gratitude messages |
| source | varchar(32) NOT NULL | 'map' or 'concierge' |
| email_status | enum('queued','sent','failed') DEFAULT 'queued' | Resend relay outcome |
| idempotency_key | varchar(160) NOT NULL UNIQUE | `contact:{fromId}:{toId}:{sha1(message)[0:24]}` |
| created_at | timestamp DEFAULT now() | |

### `concierge_queries` (F13: instrument now, dashboard later; data is unrecoverable retroactively)
| column | type | notes |
|---|---|---|
| id | varchar(64) PK | |
| user_id | varchar(64) NULL | null for logged-out structure view (v2 public concierge, if ever) |
| query | varchar(500) NOT NULL | |
| matched_kind | enum('role','quest','circle','none') | 'none' rows are the role-creation signal |
| matched_id | varchar(64) NULL | |
| method | enum('deterministic','llm') | tracks token spend vs zero-cost resolution |
| contacted | boolean DEFAULT false | flipped when a contact_request cites query_id |
| created_at | timestamp DEFAULT now() | |

## Alterations to existing tables
- `roles`: ADD `circle_id varchar(64) NULL` (validated against `circles.id` on write, same rule as `quests.roleRequired`), ADD `seats int DEFAULT 1` (vacancy = holders < seats, derived, no status column).
- `users`: ADD `contactable boolean DEFAULT true` (JSON: `user.contactable`; opt-out honored server-side, absent = true).
- `quests`: NO column change in v1 — `quests.circle` free text resolves through `circles.aliases`; a proper `circle_id` FK lands with the Phase 1b quest-domain cutover.

## No ledger interaction
This module moves zero tokens. Contact is unpaid; nothing touches `token_ledger`. Stated so nobody adds a "contact costs Gratitude" side-balance later without going through the one ledger.

## Endpoints

- `GET /api/map — whole graph in one payload {circles, roles(+holders w/ userId, first name, avatar), quests(open, resolved circleId), meta}; anonymous callers get structure-only (holder names/avatars stripped to counts) when map.public_structure is on, 404 when map.enabled is off; 60s in-memory cache`
- `GET /api/circles — public circle list (also retires the hardcoded Circles.tsx content over time)`
- `POST /api/admin/circles — create (admin)`
- `PUT /api/admin/circles/:id — edit incl. aliases, leadRoleId, parentCircleId (admin; rejects alias collisions and parent cycles)`
- `DELETE /api/admin/circles/:id — refuses while roles reference it (admin)`
- `PUT /api/admin/roles/:id — set circleId/seats (admin; circleId validated against circles)`
- `POST /api/assistant/coordinate — {query} member-only; deterministic prefilter -> optional LLM 'coordination' kind registered beside PROPOSAL_KINDS with the guard stack (per-IP 30/hr, global daily cap, injection framing) extracted into a shared helper — NOT a second AI plumbing; returns {matches[], contact:{roleId, circleId, holder|null}, draftMessage|null, queryId}; degrades to deterministic-only when no API key`
- `POST /api/map/contact — {toUserId, roleId?, circleId?, questId?, queryId?, message} gated by capability map.contact; checks recipient contactable, sender daily cap, recipient daily cap; writes contact_requests idempotently; relays via sendResendEmail with Reply-To sender; hooks insertNotification(dedupeKey) once the Phase 3 spine exists`
- `POST /api/map/roles/:id/raise-hand — {note} creates a submissions row type='role-application' (reuses shipped submissions inbox + admin review flow); surfaces role.minStage shortfall as a warning, not a block`
- `PUT /api/game/preferences — {contactable} on the member's own record`
- `GET /api/admin/map/contact-log — paginated relay log for abuse review (admin)`
- `GET /api/admin/map/concierge-log?unmatched=1 — query log with the unmatched filter, the 'which role is missing' view (admin)`

## Surfaces

**Pages/components (all under `client/src/`):**
- `pages/VillageMap.tsx` — route `/map`; registered in nav + `config/mobileNav.ts` ONLY when `map.enabled` (module contributes entries, never squats).
- `components/map/mapLayout.ts` — pure deterministic layout function (unit-tested, no DOM).
- `components/map/MapCanvas.tsx` — SVG orbit render, pan/zoom via viewBox transform, hover raise, framer-motion entrance + vacant-node pulse; desktop/tablet ≥768px.
- `components/map/CircleAccordion.tsx` — mobile <768px fallback: circles as accordion sections, role rows (avatar/vacant badge/contact), quest chips; identical data and actions, zero graph.
- `components/map/NodeCard.tsx` — the unused-and-installed `ui/sheet.tsx` as a side sheet: circle card (purpose, lead, members, open quests), role card (description, holders -> `/profile/:id`, Contact button, Raise-hand when vacant, 'requires {stage}' chip from minStage), quest card (deep-link to `/quests`).
- `components/map/ConciergeBar.tsx` — "What do you want to do?" input above the map; renders matches, draft intro (editable before send), contact CTA; hidden when `map.concierge_enabled` off.
- `pages/Profile.tsx` — add "Contactable via the Village Map" toggle.
- `pages/Admin.tsx` — new "Circles & Map" tab (existing activeTab pattern).

**Visibility tiers:** public = structure only (circle/role names, vacancy, counts — no names, avatars, or contact); logged-in (capability `map.viewPeople`, stage floor `guest`) = faces + profiles; capability `map.contact` (stage floor `member`, or role grant) = contact relay. Both new capabilities added to `shared/capabilities.ts` — the one gate, extended not bypassed.

**Mobile:** accordion is the default below 768px with a "view as map" escape hatch (pinch-zoomable but not the primary surface); FAB/bottom-nav entry comes from the existing config-driven mobileNav.

## Mechanics

**Layout (deterministic radial orbit, ~200 LoC, zero deps — d3-force explicitly rejected):** village node at center; circle i of N placed at angle `-π/2 + 2πi/N` (sortOrder order) on radius R1; circle node radius scales `minR + k·log(1+members)`. Roles sit on an inner orbit around their circle (evenly spaced, sorted vacant-last); open quests are smaller satellites on an outer dashed orbit (capped display with a "+n more" chip). Sub-circles (parentCircleId) render as a second-level orbit in v2. Rationale vs d3-force: the data is a strict 2-level tree (~10 circles × ~15 nodes), not an arbitrary graph; a simulation buys nothing but nondeterminism, tick loops, hydration jank and untestability, and recharts is the wrong tool for networks entirely. Pure function -> stable positions -> framer-motion animates mount/hover/pulse.

**Node states:** filled role = avatar chip (member view) / solid dot (public); vacant role (holders < seats) = grey dashed ring + slow pulse + "Open call" badge (the slide's default-faces idea, upgraded); circle status `forming` = whole circle greyed as a call.

**Concierge pipeline (deterministic first):** 1) normalize query, score every circle/role/quest: +3 per quest tag hit, +2 per name hit, +1 per purpose/description hit, aliases count as circle-name hits; 2) if top score ≥3 and leads runner-up by ≥2 -> resolve WITHOUT the LLM; 3) else send top-8 candidates as compact JSON (ids, names, one-line purposes, holder FIRST names only — no emails) to the 'coordination' assistant kind; response schema `{matchKind, matchId, altIds, draft}`; server validates matchId against the candidate set and DISCARDS hallucinated ids (evidence-or-drop). 4) Contact resolution: quest -> its circle's leadRoleId holder; role -> its holders, or circle lead if vacant; circle -> lead; if the resolved seat is itself vacant, the answer becomes the call: "nobody holds this yet — raise your hand." Every query logged to concierge_queries.

**Contact relay state machine:** capability check -> contactable check -> caps (sender/day, recipient/day via variables) -> insert contact_requests (idempotency_key unique = safe retry) -> sendResendEmail to recipient with Reply-To = sender email, subject "[{project.name}] {First} wants to connect about {role}" -> email_status queued->sent|failed. Reply happens in the recipient's mail client; no DM system. Deliberately NOT written to the public Village Pulse (contact is private). When the Phase 3 spine lands, the same insert also calls insertNotification(dedupeKey=`contact:{id}`) — until then the only in-app trace is the recipient's own contact list on their profile, which reads the domain table directly and is not a shadow notification system.

**Module gating:** `map.enabled=false` platform default; when off, GET /api/map 404s, no nav entry, no admin tab. Declared deps: roles (required, shipped), circles (built here), assistant (optional — concierge degrades to deterministic), email (optional — contact button hidden without Resend config).

## Game variables

- map.enabled: false — master module toggle; ships OFF, contributes route/nav/admin tab only when on
- map.public_structure: true — logged-out visitors may see the structure-only map (names/faces always require login regardless)
- map.concierge_enabled: true — natural-language concierge bar; falls back to deterministic matching when no assistant API key is configured
- map.contact_daily_cap: 5 (0–50) — contact requests one member may send per day; 0 disables the relay entirely
- map.contact_recipient_daily_cap: 3 (1–20) — max contacts one recipient receives per day; further senders are pointed to the circle's open quests instead
- map.show_quests: true — render open quests as satellite nodes around their circles
- map.vacant_highlight: true — grey + pulse vacant roles and forming circles as open calls

## Admin controls

One new Admin tab, "Circles & Map" (existing tab pattern in Admin.tsx): (1) Circles CRUD — name, purpose, icon, theme color token, parent circle, lead role picker, status, aliases editor; (2) role-to-circle assignment + seats, with an unassigned-roles bucket; (3) alias reconciliation helper — lists every distinct `quests.circle` value with no matching circle/alias ("4 quests reference 'Regenerative Agriculture' — map to Permaculture Council?") and one-click-adds the alias; (4) contact relay log (from, to-as-role, date, email status; message bodies collapsed behind an explicit 'view for abuse review' click); (5) concierge query log with the Unmatched filter — the 'what role is the village missing' report; (6) role-application submissions arrive in the EXISTING submissions inbox, no new surface. All seven map.* variables edited in the existing Game Variables admin surface (fail-loud registry).

## Dependencies

- Roles-as-data + role_holders (SHIPPED — the map's spine)
- shared/capabilities.ts one-gate (SHIPPED — extended with map.viewPeople, map.contact)
- Game variables registry shared/gameVariables.ts + server/lib/variables.ts (SHIPPED)
- Maia assistant infra: guard stack extracted from handleProposalAssistant, 'coordination' kind registered beside PROPOSAL_KINDS (SHIPPED, optional at runtime)
- sendResendEmail() relay (SHIPPED, optional — contact hidden without email config)
- Submissions inbox for role applications (SHIPPED)
- ensureDataFiles() + server/seeds/ convention for the three new JSON files (data/ still authoritative until Phase 1b cutover)
- ui/sheet.tsx (installed, unused — free NodeCard scaffolding)
- Phase 3 notification spine — OPTIONAL integration point, explicitly not a blocker
- framer-motion, wouter, Tailwind (in repo); NO new npm dependencies

## v1 (ship first, useful alone)

Ships useful alone in 5 sessions: (S1) circles as data — schema + circles.json/seed/ensureDataFiles, roles.circleId + seats, GET /api/circles, admin Circles CRUD + alias reconciliation, aliases resolving quests.circle; (S2) GET /api/map + mapLayout.ts pure function with unit tests + MapCanvas SVG orbit render with pan/zoom, public-vs-member payload tiers via map.viewPeople; (S3) NodeCard sheet + CircleAccordion mobile fallback + nav/route/mobileNav gated behind map.enabled + vacant-role pulse + raise-hand into submissions; (S4) contact relay — users.contactable, contact_requests + idempotency, caps, Resend Reply-To relay, profile toggle, admin contact log, map.contact capability; (S5) concierge — deterministic matcher + concierge_queries logging + 'coordination' assistant kind with candidate-set validation + ConciergeBar + admin unmatched-queries view. Each session leaves the app deployable; sessions 1–3 already deliver a dynamic, legible sociocratic map; 4–5 make it the coordination tool.

## v2 (the rest of the design)

The full slide vision plus what Phase 3+ unlocks (~2 sessions): nested sub-circle orbits (parentCircleId depth 2+, collapse/expand per circle — the amcharts 'collapsible tree' behavior, still deterministic); accounting-budget colored tags on nodes once a budget object exists (slide's second grouping axis — depends on the F5/F8 governance work, not built here); notification-spine integration (contact -> insertNotification + bell + daily-digest inclusion, replacing email-only); concierge funnel dashboard (query -> match -> contact -> quest-claim conversion, on top of the v1 instrumentation); optional per-deployment Hypha DHO circle read — display a village's on-chain circle/role structure alongside platform roles with deep-links to app.hypha.earth (read-and-display only, per the boundary); map snapshot on the founder command centre (Phase 8) showing vacancy heat.

## Risks

- Circle-name drift: a village's free-text quest circle names and its circle records drift apart, which is why aliases exist. Circles.tsx read hardcoded names when this was written and reads /api/org now, so the drift that remains is between quests.json and the circle records — the alias system absorbs it, but until quests get a real circle_id FK (Phase 1b), a typo'd new quest silently lands uncircled; the admin reconciliation helper is the mitigation, write-time validation is the cure.
- Contact relay abuse/harassment: caps + opt-out + admin log cover volume, but there is no per-pair block yet; a recipient's only hard stop is going fully uncontactable. Flag for a block-list follow-up before real membership scales.
- Reply-To exposes the SENDER's email to the recipient by design (that is what makes reply-by-email work) — must be disclosed in the compose UI; if unacceptable, v2 needs a tokenized reply relay, which is real work.
- Storing contact message bodies + concierge queries is personal data — retention window and the 'admin can read messages for abuse review' posture should get a real legal/privacy pass before a fork sells this to a village in a GDPR jurisdiction.
- JSON-file interim: contact_requests appends ride the same non-atomic readJson/writeJson as everything else, so two simultaneous contacts can drop one until the Phase 1b cutover; idempotency keys make client retry safe, which contains it.
- LLM matcher can hallucinate or be prompt-injected via the query text — mitigated by candidate-set validation server-side (discard unknown ids), the existing injection framing, and deterministic fallback; never let the model's text choose the recipient directly.
- If the map ships before the Phase 3 spine, the recipient-side in-app surface must stay a domain read of contact_requests and NOT grow unread-counts/preferences/digests, or it becomes the second notification system the plan forbids.
- Layout crowding past ~120 visible nodes: v1 caps quest satellites with a '+n more' chip; genuine scale needs v2's per-circle collapse.
- Scope temptation: 'circle lead' here is a display/contact convention (circles.leadRoleId), not a governance object — actual circle authority/domains belong to the F5 agreements work on Hypha's side of the boundary; keep the map from quietly becoming a governance UI.

## Publishing the land (0063 / artifact D8)

Build mode used to end at `Export scene`: a file, a person with database
access, and `scripts/import-map-scene.ts`, which skips `structures`, `zones`
and `flows` because the geometry had nowhere to land. The scene now has a home,
so the founder's hand reaches the live map.

| piece | where |
|---|---|
| Envelope, verbs, size ceiling, edit words | `shared/mapScene.ts` |
| Draft/publish/undo repository | `server/lib/mapScene.ts` |
| Tables | `drizzle/0063_map_scene_publish.sql` |
| Routes | `/api/map/draft` (GET/PUT/DELETE), `/api/map/publish`, `/api/map/revisions`, `/api/map/revisions/:v/restore` |
| Shell relay | `client/src/pages/LivingMap.tsx` |
| Artifact | `patch_d8_publish.py`, `patch_d8b_standalone_hand.py`, `patch_d8c_discard.py` |
| Gate | `qa/verify_publish.js` |

**The scene is stored verbatim.** `longtext`, not `json`: MySQL's json type
reorders keys and strips duplicates, which would quietly make "stored exactly
as the map wrote it" false. It is parsed on the way in to be CHECKED and the
original text is what is written. A field-by-field sanitiser here would be the
round-D boundary bug with twenty blocks of surface, firing every time the map
lane adds a field.

**The race is settled by the database.** `map_scene_revisions.base_version` is
UNIQUE, so two admins publishing from the same base means the second insert
fails with `ER_DUP_ENTRY` and is told who moved it. A read-then-write would
have a window, and the window is where a founder's afternoon disappears. Six
concurrent publishes are pinned in `server/lib/mapScene.test.ts`.

**Undo appends.** Restoring version 3 publishes a NEW revision carrying that
scene with `restored_from = 3`. Nothing is deleted or mutated, so the version
that was live when somebody pressed undo is still there to go back to, which
is what makes undo safe to press when unsure.

**A push never repaints over unpublished work.** If a colleague publishes while
you are mid-drag, your land does not move and your `BASE_VERSION` deliberately
stays stale, so your next publish is REFUSED and explains itself. Silently
rebasing you is how one admin overwrites another with neither noticing.

**Two capability keys, not one.** `map.edit` opens build mode and a private
draft; `map.publish` puts a change in front of every visitor. Split, a member
can shape a proposal without holding the live land. Neither is in
`STAGE_UNLOCKS`: both are appointments, granted by a role or the Cartographer
badge that 0063 seeds. A warning badge's deny suspends publishing on its own,
because the gate is the one gate.

**The gate is the server's, always.** `grounds-v0.html` is a static file at a
URL anyone can open, so its Build button is decoration. Every route asks
`hasCapability` itself; what the artifact is told only decides what it draws.

**Silence means local only.** With no shell there is no village to ask, so the
artifact keeps the founder's full hand and stays the standalone design tool it
has always been. Reading silence as a refusal is what made D8's first cut
invisible from `file://`, caught by `verify_doors` in one line.

## The org lens on the land (L5)

The Circles chart and the living map used to disagree about what an org is. The
chart drew circles with role satellites; the lens drew a ring around every one
of the twenty-two buildings, in grey where a building had no circle at all. The
lens now draws what the chart draws, on the land.

| piece | where |
|---|---|
| Halos, satellites, three inks, the governing fallback | `patch_h5_01_lens.py`, `patch_h5_02_satarc.py`, `patch_h5_03_keyline.py` |
| Round trip, the party, the live seat states | `patch_h5_04_roundtrip.py`, `patch_h5_06_live.py`, `patch_h5_07_reapply.py` |
| Marks that answer to the party | `patch_h5_05_badges.py` |
| Hardening (declaration order, canvas state) | `patch_h5_08_tdz.py`, `patch_h5_09_ctxstate.py` |
| The drawn record, the lens plane, the ground line | `patch_h5_10_satlog.py`, `patch_h5_11_overcanvas.py`, `patch_h5_12_footline.py`, `patch_h5_13_plane.py`, `patch_h5_14_platedodge.py` |
| A role gathers at its own circle's home; the fan opens | `patch_h5_15_govhome.py`, `patch_h5_16_fanwidth.py` |
| Braided rim, prototype-safe name index, tooltip | `patch_h5_17_three.py` |
| Circle tables a scene file cannot reach through | `patch_h5_18_circtables.py` |
| Class tags on a seat | `drizzle/0069_characters.sql`, `server/lib/orgChart.ts` |
| Shell relay | `client/src/pages/LivingMap.tsx` |
| Gates | `qa/verify_org_lens.js` (the model), `qa/verify_org_ground.js` (the screen), `server/lib/orgArchetypes.test.ts` |

**A halo marks a circle, not a building.** The ten curated `CIRCLE_HOMES` are
the only anchors, so the lens and the chart cannot disagree about where a circle
lives.

**No two halos overlap, by construction.** Each takes half the distance to its
nearest neighbour, capped at 46, so for any pair the two radii sum to at most
the distance between them. A flat 46 left eight overlapping pairs on this land,
because five homes sit inside the heart district.

**A governing function gathers at ITS OWN CIRCLE'S HOME, at DRAW TIME, and is
never written down.** `roleHome()` asks `classify()`, the artifact's own
provenance predicate: an address a person chose reads `creator` and is never
moved, while a resolver guess and silence both gather at `CIRCLE_HOMES[circle]`.
`ROLE_GOV_HOME` is only what is left when that circle has no home on the land,
and it fires zero times here. It used to be the rule rather than the fallback,
and it contradicted `CIRCLE_HOMES` for three of the four circles it claimed:
Outreach lives at the gate, Finance at the market, Wisdom at the council fire.
The map said so out loud - three Wisdom roles addressed at the council fire were
dragged to the Community Center, whose hovercard then read "0 seats open" with
no seal while the lens drew three satellites on it, and the council fire's read
"4 seats open" with a seal while the lens drew one. Writing a home onto the row
would destroy the difference between a default and a founder's choice, which is
the distinction `0060` exists to preserve.

**The two seat counts on the map are now compared.** `seatsAt()` answers "which
seats are ADDRESSED here" and feeds the hovercard and the seat seal;
`roleSeatsBy()` answers "which seats DRAW here" and feeds the lens. Both were
computed every frame and compared by nothing. `verify_org_ground.js` S1-S4 reads
the rendered hovercard's own text and the seal in the badge plane - the two
surfaces a person reads - and requires them to equal what the lens drew, then
forces a role apart to prove the comparison is live.

**A satellite never lands on the building it belongs to, and never under a mark.**
Two separate laws, and both were found by looking at the screen rather than at
the model:

- *The ground line.* A halo is a circle around an anchor and a sprite is a tall
  box standing on it, so at the crowded homes the ring is INSIDE the sprite: the
  no-overlap solver takes the Community Center's ring to 29.1 scene units while
  its painted sprite reaches 31.6 below the same anchor and 43 to either side.
  The satellite's `py` takes a floor at the sprite's own foot, published by
  `syncBanners` as `s._footU` from the same `sc`/`psc`/`k` it writes into the
  sprite's transform on the same line, so the two cannot drift. `px` is
  untouched, so nothing reaches further sideways than the halo already did and
  no satellite can migrate into a neighbour's circle. Raising the radius instead
  is not available: the Community Center's sprite is 43 of half-width and the
  Library's is 36.7 and they stand 58 apart, so the sprites themselves overlap.
- *The plane.* `#lens` sits at z 13, above the sprites at 10, the name plates at
  11 and the seals at 12, and `body.org-lens` dims `#badges` to a third while it
  is on. Edge-to-edge clearance from the seals is not achievable on this land -
  fifty are on screen at the Community Center at cam.z 2.4, on rings around five
  buildings that `layoutBadges` deliberately does not space against each other -
  so the lens is a MODE that owns the top while it is on. In exchange the
  satellites join `window.BADGE_PTS`, so the name plates dodge them the way they
  already dodge every seal. That costs at most one building name of the dozen on
  screen, measured, and bounded at one by `verify_org_ground.js` G7b.

**No name a scene file chose is looked up on an object with a prototype.**
Seat names key the live-state merge in `roleApplyLive`, and circle names key
`CIRCLE_COL`, `CIRCLE_HOMES` and `ROLE_GOV`. All four were plain objects, so a
seat called `constructor` matched a phantom row, drew open and incremented the
count the shell reports; a circle with that name was treated as governing, was
gathered off the building it is addressed to, and took a Function as its colour
- which canvas refuses by KEEPING THE PREVIOUS strokeStyle, so the satellite is
drawn in another circle's ink rather than being visibly wrong. The `||` and
`&&` fallbacks that look like they cover this cannot, because an inherited
value is truthy. `Object.create(null)` on all four; nothing calls a method on
any of them and every reader uses `Object.keys`, `in`, or a bracket lookup.

**The two org suites are separate on purpose.** `verify_org_lens.js` proves the
model and never looks at the screen: it drives `roleSat` onto canvases made with
`createElement`, which is right for the three inks and blind to everything
geometric. It reported 38 of 38 green while two of the three governing
satellites were invisible. `verify_org_ground.js` reads only the composited page
and rects off the live DOM, and carries `BREAK=floor` and `BREAK=plane` negative
controls that must take it red.

**The lens reads state; it never stores it.** `x.state` is what a scene file
says and round-trips through `restoreScene` and the export. `x._state` is what
the village says this minute, merged by name off the credentialed hand and
carrying the leading underscore this file uses for read-but-never-saved. The
export names its fields one by one and `_state` is not among them, so a
Tuesday's holder count can never freeze into the map a founder drew.

**Character identity rides its own credentialed message.** `/api/map/config` is
fetched without credentials and returns the same answer to every reader, so the
party cannot travel on it. It travels on `lens`, which is separate from `hand`
on purpose: `hand` decides whether the Build button works and must not wait on
`/api/map`, which is four queries and reads the whole `users` table when the
caller may see people. `lens` only narrows what is drawn, so it can land late,
and if it never lands the map shows every mark and draws every seat as the scene
wrote it. It is pushed once, on the boot handshake, so a party edited in another
tab reaches the map on the next open.

**Empty means every class, everywhere.** `org_roles.archetypes` is nullable, so
"tagged for nobody" and "not tagged at all" arrive as the same `[]` from
`asList` and take the one branch every reader takes. A village that has tagged
nothing sees no narrowing at all, and a class never reaches `hasCapability`.

**The quest half of the filter is wired and has no data yet.** 0069 tagged
`quests` as well as `org_roles`, but `server/repos/quests.ts` does not select
the column and `/api/map` does not emit it, so a quest reaches the map untagged
and `roleAny` answers true for every quest mark. Closing it is the same four
moves the seat side took: select the column, emit it, send it, merge it. Until
then only the seat mark narrows, which is the honest behaviour rather than a
guess about who a quest is for.

## Open questions

- Source of truth for circles per deployment: some villages will already model circles in their Hypha DHO — should map.circles_source (platform | hypha-readonly) be a v2 deployment choice, and if hypha, does the concierge still resolve contacts against platform role_holders?
- Confirm the 'members see people' floor: design uses any logged-in account (stage guest) for faces and stage member for contacting. Should faces be member-gated too?
- Retire or keep Circles.tsx: fold the marketing content page into the /api/circles-driven map (one source of truth) or keep both during transition?
- Should raise-your-hand hard-block below role.minStage, or warn-and-allow so founders can consider exceptional applicants (design currently warns)?
- Investors: automatically excluded since they hold no roles — but should an investor account be able to USE the concierge/contact (currently yes, if stage/capability allows)?
- Does contact deserve a Gratitude-adjacent gesture later (e.g. attach thanks after a successful connection), and if so it must route through the one ledger — deliberately out of scope now?

## How Power Is Held: the /map/circles rebuild (round 4, lane L2, 0083)

`/map/circles` is the POWER MAP now: the adopted 14-point interaction spec
(`SOCIOCRACY_MAPS_RESEARCH_2026-08-16.md`) plus the R29 layers. The page's H1
says "How Power Is Held"; the nav label and catalog rename are the
coordinator's and L1's respectively.

**Three layers and a lens.** The village declares a SHAPE (circle, pyramid,
council, flat, steward, network, other) and a default way of deciding, stored
as `power: {shape, shapeGloss?, decidesBy, decidesByGloss?}` in the map
module's config, validated by `orgChart.villagePowerProblem`. Each circle may
declare its own `decides_by` (+gloss), and may override it for exactly four
domains: money, people, space and land, rules (`decides_by_domains` JSON).
The "How we decide" lens colours circles by the resolved method: domain
override, else circle, else village default. Vocabulary ids are CLOSED
(`shared/power.ts`); `other` requires a one-line gloss the legend shows (R28).

**The picture morphs.** `layoutForShape` (`shared/mapLayout.ts`) draws one
`NestedLayout` per shape; `circle` is `layoutNestedMap` byte for byte, under
test, so today's map cannot drift. The camera is a pure reducer
(`components/power/camera.ts`) on van Wijk's `interpolateZoom`: tap a circle
to fly in (`?focus=` in the URL), tap the focused ring or backdrop to go out,
and a tap on a SEAT never moves the camera. Five seat states draw as five
glyphs, colour never alone.

**Who may declare (P10, N5).** `mayDeclare` in `orgChart.ts`: admin, the
`org.declare` capability (an appointment, never a stage rung), or a live
holder of a seat flagged `represents_circle`, for that one circle only. The
third door is the single sanctioned bridge from the seat plane to a
permission: `docs/ADR_2026-08_REPRESENTS_CIRCLE_DECLARES.md`, pinned by
`server/lib/orgDeclare.test.ts`.

**Now | Vision (P1, N2).** Vision draws open `org_drafts` as ghosts, each
with a `vision` block `{objectives[{text, metric, target, current, source,
done}], trigger}`. Measured metrics v1: `seats_filled`,
`seats_filled_in:<circleId>`, `members_at_stage:<stageId>`,
`seasons_completed`. When every objective is met the panel PROMPTS and links
a human to the existing publish button; nothing applies itself
(`visionNeverApplies.test.ts`).

**Currency (P8, N4).** Display only: `project.country` + `project.fiatCurrency`
(blank resolves to CHF), a per-viewer display currency (prefs or browser),
`shared/money.ts` for formatting and cross rates, and the `fx-rates-daily`
job caching the ECB daily list (base EUR) through the guarded dialer into
`fx_rates`. The ECB list carries no CRC (measured 2026-08-21): colones show
unconverted until an admin records a `manual` row, and the picker says so.
Stripe settlement never reads any of it.

**Publish surface.** `org.json` gains a top-level `shape`; circles gain
`decidesBy` and `decidesByDomains`, ids only and sanitised against the closed
sets, because a gloss is free text and free text can hold a name. The circle
markdown adds "Decides by: consent."

**The setup walk (§8 item 16).** Admins walk every open or partial seat
(assign / skip / open call), then every circle without a method, then the
shape, ending at "publish structure to the network?". Assignment posts to the
existing seating endpoint, so it stays a dated row.

## Photographs of a place (round 5, 0093)

The ask: sprite cards accept photos, and past that a place works like a
maps listing where the community uploads its own. A place stops being a
drawing with facts attached and becomes a place people have photographed.

**Why it earns its schema.** Every other number on this map is something a
person could have typed from anywhere. A photograph is somebody standing on
the land with a camera, so attribution and the date it was taken are columns,
not decoration.

**Tables** (`drizzle/0093_place_photos.sql`): `place_photos` keyed on the map's
own `structure_key` (0062 doctrine, no FK: structures live inside the published
scene JSON, so there is nothing to reference), and `place_photo_reports` with
two kinds, `concern` and `subject`.

**Two capabilities** (`shared/capabilities.ts`): `map.photograph` unlocks at
the `member` rung, so a warning badge's deny suspends posting pictures;
`map.curatePhotos` has no rung at all and arrives by role, badge or admin,
because deciding what stays in the village's record is an appointment. The
curator's queue lives at `/api/places/reports` and NOT under `/api/admin`,
which is the R54 claim: a curator who is not an admin can work it, and the
e2e suite proves it with a badge-granted curator holding nothing else.

**Five dials** (`shared/gameVariables.ts`, all read):
`map.photo_max_mb`, `map.photos_per_place`, `map.photos_per_member_daily`,
`map.photo_report_hide_threshold`, `map.photo_tombstone_days`.

**The subject's own right.** A person may ask for a photograph of themselves to
come down, and it needs no capability, waits for no threshold and is not
governed by a dial a village can switch off. Filing hides the picture in the
same call AND suppresses the file, so `/api/uploads/<name>` stops answering:
a hidden row whose bytes stay fetchable by anyone holding the address is the
whole of what the person was asking to stop. A curator then restores it or
takes it down for good.

**Location data.** `server/lib/placePhotos.ts` re-encodes through sharp and
then READS THE ENCODED BYTES BACK, throwing before anything reaches the volume
if any metadata survived. `server/lib/placePhotos.test.ts` builds a JPEG with a
real GPS IFD, proves the fixture carries it, and asserts the output does not;
`server/placePhotos.routes.e2e.test.ts` repeats the proof against the file the
running server wrote.

**Volume.** Photographs are stamped `place-<stamp>.webp` with a
`.thumb.webp` beside them, so `/health` reports `uploads.photoFiles` and
`uploads.photoMb` beside the totals from the same directory walk. The daily
retention sweep forgets a takedown's tombstone after
`map.photo_tombstone_days` and unlinks any file the takedown failed to remove,
skipping every filename a live photograph still points at.

**Surfaces.** `/places` (the shelf, plus the curator's queue) and
`/places/:key` (one place), both rendering
`client/src/components/places/PlaceGallery.tsx`. The Living Map's place panel
carries a **Photos tab at index 3** (`docs/prototypes/patch_r5_photos.py`, a
guarded patch that writes zero bytes on a second run). It draws whatever the
shell pushed into `window.PLACE_PHOTOS`, escaping every member-authored string,
and always offers the door to `/places`, because adding a photograph, flagging
one and asking for a photograph of yourself to come down all happen on the
site. `pushPhotos` in `client/src/pages/LivingMap.tsx` sends it, reading
`GET /api/places?gallery=1`, which is one query for every place at once.
`docs/prototypes/qa/_probe_photos_tab.js` asserts the tab is present, that a
click at its own centre lands on it rather than on something covering it, and
that the room paints alt text, attribution and the door.
