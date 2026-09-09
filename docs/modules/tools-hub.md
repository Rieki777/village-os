# Module design: tools-hub

<!-- describes: shared/modules.ts shared/toolsVisibility.ts -->

Provenance: platform

> Produced by the 13-agent design workflow, 2026-07-26, from the 2020 village-demo deck (slides + speaker notes),
> the platform foundation plan's constraints, and the live codebase. Reconciled by MODULES_MASTER_PLAN.md —
> where this file and the master plan disagree, **the master plan wins** (it applies the two critique passes).

**An admin-managed, audience-aware registry of every tool the village uses — one grid page with an auto-generated Hypha governance card — shipped as the proof-of-concept for the platform's toggleable-module framework.**

Estimated sessions: 2

## Design decisions, and why

- The original concept was a static hardcoded grid; this is an admin-managed registry so any village edits its toolbox without a developer or deploy — the white-label mandate applied to the cheapest possible surface.
- Per-audience visibility (public / members / role-gated) — the slide showed Gitlab and Hubspot to everyone; here guests never see core-team internals, and 'core team' is deliberately NOT a new enum: it is a seeded role, reusing roles-as-data instead of inventing a parallel permission concept.
- The Hypha card is auto-generated from one new global game variable (governance.hypha_org_url) and carries the four governance deep links already drafted in CoCreatorsGuide.tsx (Create Agreement, Contribution Claim, Pay Expenses, Members). This makes the Tools Hub the canonical 'all governance and pay happens on Hypha' surface AND kills the live [YOUR-DHO-SLUG] placeholder bug at CoCreatorsGuide.tsx:54 by refactoring that page to read the same variable.
- Per-tool 'getting started' note. The purpose of a tools page is that a core team knows every tool it needs to get things done, and a collapsible onboarding note per card serves that where a bare JOIN button does not.
- Click-through analytics (tool_clicks, DB-native, fire-and-forget beacon) — F13 says instrument now, dashboard later, and 'which tools does the community actually use' is exactly the data that is unrecoverable retroactively. Feeds the future health dashboard for free.
- Dead-link checking as an admin-triggered button in v1 (no scheduler exists yet) and scheduled in v2 — the classic death of every 'tools wiki' is silent link rot; the slide had no answer to it.
- Configurable CTA label per tool (Open/Join/View) — preserves the slide's one nice detail (JOIN vs OPEN vs VIEW communicated relationship to the tool) as data instead of design.
- Icon system: lucide icon slug by default (zero upload friction, theme-consistent in dark/light) OR a real logo uploaded through the existing sharp pipeline resized to 256px WebP — the slide's pasted logos, but consistent and volume-persisted.
- Module framework proof-of-concept: ships OFF by default, toggled per-deployment via a fail-loud game variable, declares dependencies, and contributes its nav entry, route, and admin tab only when on — the pattern every subsequent module (forum, economics, command centre) reuses.
- Village Pulse integration: addActivity('tools', ...) when a tool is added, so the hub stays discoverable instead of being a page nobody knows exists.
- Deliberate non-goals kept it the cheapest module: no OAuth, no embedding, no third-party status polling, no membership provisioning behind the JOIN buttons. Links out only — zero legal surface, zero token surface, zero Hypha-boundary risk.

## Data model

**`tools`** — v1 lives in `data/tools.json` (seeded from `server/seeds/tools-seed.json`, registered in `ensureDataFiles()`) behind a `toolsRepo` module so the Phase 1b MySQL cutover is mechanical; the Drizzle table ships in `server/db/schema.ts` in the same session so the import script picks it up.

| column | type | notes |
|---|---|---|
| id | varchar(64) PK | slug, e.g. `telegram` |
| name | varchar(120) NOT NULL | |
| purpose | varchar(200) NOT NULL | the card one-liner (slide's "Video Conferencing") |
| description | text NULL | longer copy, expandable on card |
| url | varchar(1000) NOT NULL | https-only, validated on write |
| ctaLabel | varchar(24) default 'Open' | Open / Join / View |
| category | varchar(64) NOT NULL | must match a category id (validated on write, like quests.roleRequired) |
| iconKind | enum('slug','upload') default 'slug' | |
| icon | varchar(255) | lucide slug or `/api/uploads/tool-*.webp` |
| visibility | enum('public','members','roles') default 'members' | core team = a role, not an enum value |
| roleIds | json NULL | role ids; validated against `roles.id` on write |
| gettingStarted | text NULL | optional onboarding note |
| sortOrder | int default 0 | drag-to-reorder target |
| enabled | boolean default true | hide without delete |
| lastCheckedAt | timestamp NULL | link checker |
| lastCheckStatus | int NULL | HTTP status from last check |
| createdAt / updatedAt | timestamp | |

**`tool_clicks`** — DB-native from day one (append-only analytics, no JSON counterpart, so no cutover debt; if the DB write fails the click is silently dropped — analytics, not truth).

| column | type | notes |
|---|---|---|
| id | varchar(64) PK | |
| toolId | varchar(64) NOT NULL | index (toolId, at) |
| userId | varchar(64) NULL | null for anonymous/public viewers |
| at | timestamp defaultNow NOT NULL | |

**Categories** — tiny, so no table: `{ categories: [{id, label, sortOrder}] }` stored in the same `data/tools.json` doc (post-cutover: `app_config` key `toolCategories`). Seeded generically (Governance, Communication, Documents, Coordination) — seeds are the per-village swap point, per the config-driven mandate.

**The Hypha card is NOT a row.** It is injected virtually by the server at read time from `governance.hypha_org_url`, pinned first, non-editable, non-deletable. One source of truth for the DHO URL; deleting the card = blanking the variable.

## Endpoints

- `GET /api/modules — public; returns [{id, enabled}] for every registered module, resolved through the one fail-loud variables reader; client nav filters on it`
- `GET /api/tools — public; resolves viewer from optional auth token, filters cards by visibility (public-only for anonymous, + members tools for account holders, + role tools for holders), injects the pinned Hypha card when governance.hypha_org_url is set; 404s when module.tools.enabled is false (shared requireModule('tools') helper)`
- `POST /api/tools/:id/click — beacon target; fire-and-forget insert into tool_clicks (userId attached when a valid token is present); reuses rateLimited(); no-op when tools.click_tracking is false`
- `GET /api/admin/tools — full list including disabled tools + 30/90-day click counts`
- `POST /api/admin/tools — create; validates url https, category exists, roleIds exist in roles`
- `PUT /api/admin/tools/:id — update, same validation`
- `DELETE /api/admin/tools/:id — delete (click rows retained, orphan-tolerated)`
- `PUT /api/admin/tools/order — bulk reorder, body is the full ordered id array, rewrites sortOrder atomically`
- Categories live in the module config, not on a route of their own: `PUT /api/admin/modules/tools/config` replaces the whole document and the module's `validateConfig` checks it. Edited from Admin -> The Game -> Tools.
- `POST /api/admin/tools/icon — multer memory + sharp: rotate, resize 256x256 fit inside, webp q82, saved as tool-{stamp}.webp in UPLOADS_DIR (exact clone of the brand-image pipeline; raster only, SVG explicitly rejected)`
- `POST /api/admin/tools/check-links — admin-triggered (no scheduler exists): HEAD each enabled tool url with a 5s timeout, store lastCheckedAt/lastCheckStatus; https-only and private-IP ranges refused (SSRF guard)`
- `GET /api/admin/tools/analytics — clicks per tool per window, the F13 'instrument now' readout (v2 polish; raw counts already on GET /api/admin/tools in v1)`

## Surfaces

**Pages/components (client):** `client/src/pages/ToolsHub.tsx` at route `/tools` — category-grouped responsive grid (3-col desktop, 1-col at 390px), each card: icon, name, purpose, optional expandable description + getting-started note, CTA button (target _blank, rel noopener noreferrer, onClick fires `navigator.sendBeacon('/api/tools/:id/click')`). `client/src/components/tools/ToolCard.tsx` and `HyphaGovernanceCard.tsx` (pinned first: DHO name, "Governance & Pay", the four deep links — Create Agreement, Propose Contribution, Pay Expenses, Members — as sub-actions on one card).

**Nav:** module framework contributes a "Tools" drawer entry in `Layout.tsx` and an optional FAB action row in `client/src/config/mobileNav.ts`, both filtered through a `useModules()` hook reading GET /api/modules (fail-closed: fetch failure hides module nav, never crashes the drawer). TAB_SLOTS stays at its fixed five — Tools does not displace a tab slot.

**Admin:** two tabs in the existing `Admin.tsx` pattern. **Modules** tab (the framework PoC): every registered module with description, dependencies, and a toggle that writes `module.*.enabled` through the existing PUT /api/admin/variables path. **Tools** tab: list with click counts and last-check status dot, add/edit form, audience picker (public/members/role multi-select from /api/admin/roles), lucide-slug picker or logo upload, framer-motion `Reorder.Group` drag-to-reorder (framer-motion already in the stack), per-tool enable toggle, "Check links now" button, category editor.

**Framework:** `shared/modules.ts` — `MODULES: ModuleDef[]` where `ModuleDef = { id, label, description, dependsOn: string[], enabledKey, nav: {label, route, icon}, adminTabs: string[] }`. Kept to ~100 lines on purpose: registry + variable-backed toggles + one hook + one server helper. No plugin loading, no dynamic imports.

**Refactor rider:** `CoCreatorsGuide.tsx` HYPHA_BASE (line 54) switches to the shared variable — the hub and the guide can never disagree about where governance lives.

## Mechanics

**Module gating (the framework PoC):** every module ships OFF. `module.tools.enabled` is a boolean game variable — fail-loud (unknown key throws), admin-editable, platform default `false` so forks inherit OFF. Server routes mount unconditionally but every handler passes through `requireModule('tools')` which 404s when disabled (simpler and safer than conditional mounting — no route-table drift between restarts). Client nav renders only enabled modules via useModules(). Dependency declaration is data (`dependsOn: []` for tools — it deliberately has none); the Modules admin tab refuses to enable a module whose dependencies are off.

**Visibility resolution (respects ONE GATE):** not a new permission system. `shared/toolsVisibility.ts` exports `canSeeTool(tool, ctx)` consuming the exact same ctx shape as `hasCapability` in `shared/capabilities.ts` (stageIndex, roleCapabilities/role ids, isAdmin): `public` → always; `members` → stageIndex >= index('guest') (has an account); `roles` → holds any of tool.roleIds; admin sees everything plus a per-card badge showing who else can. No new Capability keys are added — the union stays closed; per-entity audience lists are data, like quests.roleRequired.

**Hypha boundary, honored by construction:** the module never touches tokens, balances, or votes. The Hypha card is read-and-display + deep-link only — literally a URL composed from `governance.hypha_org_url` + fixed suffixes (`/agreements/create`, `/agreements/create/propose-contribution`, `/agreements/create/pay-for-expenses`, `/members`). Nothing to firewall because nothing crosses.

**Click analytics:** sendBeacon on click (survives the tab navigating away), server inserts one tool_clicks row, no dedupe (repeat opens are signal), rate-limited per IP via the existing in-memory rateLimited(). Rows go straight to MySQL because this is new append-only data with no JSON legacy — the one place this module is DB-native ahead of the cutover. Ordering: sortOrder asc, then name; Hypha card always position zero.

**Link checker:** admin-triggered HEAD (fallback GET on 405) with 5s timeout; only https URLs; resolves DNS and refuses private/loopback/link-local ranges before fetching (SSRF guard — admin-entered URLs are still server-side fetches). Status stored, rendered as a green/amber/red dot in the admin list only (never shown to members). v2 moves it onto the Phase 3 scheduler at `tools.link_check_days` cadence.

**Pulse:** addActivity('tools', '<Tool> was added to the village toolbox') on create — reusing the existing feed, no new event system.

## Game variables

- module.tools.enabled: false (boolean) — master toggle; the module framework's canonical example. OFF by default so every fork opts in.
- governance.hypha_org_url: "" (text, https-validated by the existing _url-suffix rule in validateVariable) — the village's Hypha DHO base URL, e.g. https://app.hypha.earth/en/dho/your-village. Drives the auto-generated Governance & Pay card AND the CoCreatorsGuide action cards. Blank = no Hypha card shown, nothing fake rendered.
- tools.click_tracking: true (boolean) — villages that don't want usage analytics switch it off; the beacon endpoint becomes a no-op.
- tools.link_check_days: 0 (integer, 0–90, unit: days) — v2: scheduler cadence for automatic dead-link checks once Phase 3 lands; 0 = manual-only (the v1 behavior).

## Admin controls

Two tabs following the existing Admin.tsx activeTab pattern. (1) **Modules** — every entry in shared/modules.ts with label, description, declared dependencies, and an on/off switch writing module.*.enabled through the existing variables endpoint; disabled switch with explanation when a dependency is off. (2) **Tools** — full CRUD: name, purpose, description, url, CTA label (Open/Join/View), category (from the editable category list), icon (lucide slug picker with live preview, or logo upload through the sharp pipeline), audience (public / members / specific roles multi-select fed by /api/admin/roles), getting-started note, per-tool enable toggle; drag-to-reorder via framer-motion Reorder; 30-day click count column; link-status dot + "Check links now" button; category list editor that refuses to orphan tools. The Hypha card appears in the admin list as a locked row labeled "managed by the Hypha DHO URL setting" with a jump-link to that variable — visible, not editable, so nobody hunts for a phantom tool record.

## Dependencies

- Roles-as-data + shared/capabilities.ts (SHIPPED) — role-scoped visibility and the ctx shape canSeeTool reuses
- Game variables registry shared/gameVariables.ts + server/lib/variables.ts (SHIPPED) — module toggle, hypha_org_url, click_tracking
- Existing multer + sharp brand-image pipeline and UPLOADS_DIR volume (SHIPPED) — icon uploads
- MySQL + migration runner (SHIPPED, Phase 1a) — tool_clicks is DB-native; tools table added to schema.ts for the 1b cutover
- data/ seed discipline: server/seeds/tools-seed.json + ensureDataFiles() entry (rule, not code)
- addActivity() Village Pulse (SHIPPED) — creation events
- Phase 3 scheduler — v2 ONLY, for automated link checks; v1 deliberately avoids it (admin-triggered button)
- F13 health dashboard — downstream consumer of tool_clicks, not a dependency

## v1 (ship first, useful alone)

One session. shared/modules.ts (registry + ModuleDef + requireModule server helper + useModules hook + GET /api/modules) with tools as its only entry; module.tools.enabled + governance.hypha_org_url + tools.click_tracking variables; data/tools.json + seed + ensureDataFiles + toolsRepo; tools + tool_clicks tables added to schema.ts; GET /api/tools with visibility filtering and the virtual pinned Hypha card; click beacon endpoint writing tool_clicks to MySQL; ToolsHub.tsx grid page + ToolCard + HyphaGovernanceCard; Layout drawer entry + mobileNav FAB row filtered by useModules; Admin Modules tab + Tools tab with CRUD, audience picker, lucide-slug/upload icon, framer-motion drag-to-reorder, raw click counts, and the admin-triggered "Check links now" button with SSRF guard; CoCreatorsGuide.tsx refactored onto governance.hypha_org_url; addActivity on tool creation. Useful alone: the day it ships, a village has a real tools page and the '[YOUR-DHO-SLUG]' placeholder bug is dead.

## v2 (the rest of the design)

Roughly one more session, after Phase 3: scheduled dead-link checking at tools.link_check_days cadence with an admin notification when a link goes red; GET /api/admin/tools/analytics with per-window, per-audience click rollups feeding the F13 health dashboard ('the core team's most-used tool', 'tools nobody has opened in 90 days'); optional per-tool 'request access' mailto/URL affordance for invite-gated tools (still just links — no provisioning, no OAuth); category icons; click-row rollup/retention policy once volume warrants it. Explicitly still out of scope forever-ish: OAuth integrations, embedding third-party UIs, live status polling of external services — the hub links out, deliberately.

## Risks

- SSRF via the link checker: admin-entered URLs are fetched server-side. Mitigated (https-only, DNS-resolve then refuse private/loopback/link-local ranges, 5s timeout, admin-triggered only) but the guard must be written, not assumed — flagging because 'admin-only' is one shared password today.
- Icon upload must stay raster-only: piping SVG through to /api/uploads would create a stored-XSS vector; the sharp pipeline's mimetype whitelist already excludes SVG — keep it that way explicitly.
- Module framework scope creep is the real budget risk: the framework must stay ~100 lines (registry, variable toggles, one hook, one helper). If it grows plugin loading or dynamic imports in this session, the 1-session estimate is dead and the PoC has failed its own point.
- data/ volume shadowing: the tools seed only lands on fresh volumes (same caveat as the gated seed quests noted in the upgrade plan) — a production deployment starts with an empty registry and an admin adds tools by hand, which is fine but should be said out loud.
- tool_clicks stores userId: mild internal privacy surface; admin UI shows only aggregates, and tools.click_tracking gives villages a full opt-out; revisit retention in v2.
- Tabnabbing: every card CTA needs rel='noopener noreferrer'; trivial and easy to forget.
- In-memory rate limiting on the click beacon resets per redeploy and per process (standing hazard #5 in the plan) — acceptable for analytics, not to be leaned on for anything stronger.
- No legal exposure identified: the module holds no tokens, moves no value, and the Hypha card is display + deep-link only, so the Hypha boundary is honored by construction rather than by policy.

## Open questions

- Is the /tools page itself publicly routable when the module is on (cards filtered per viewer, which is the recommendation, since a tools page usually includes public-facing tools like a community chat), or gated behind login entirely?
- Confirm 'core team' as a seeded role rather than a visibility enum value — the task brief said audience: public/members/core-team/role-slugs[], and this design collapses core-team into roles to avoid a parallel permission concept.
- Should the CoCreatorsGuide Hypha refactor ride in this session (recommended, ~30 lines) or be split out so the module lands pure?
- Do the four Hypha deep-link suffixes (/agreements/create, /agreements/create/propose-contribution, /agreements/create/pay-for-expenses, /members) hold across Hypha DHO configurations, or do some villages need the sub-links to be editable data too? (Cheap escape hatch: an optional hyphaLinks override array in the variable's neighborhood — but only if a real second village needs it.)
- Does Tools deserve one of the FAB shortcut rows on mobile by default, or drawer-only? TAB_SLOTS is deliberately fixed at five and Tools should not displace one.
- Click retention: keep raw tool_clicks rows indefinitely or roll up to daily counts after ~180 days? No action needed until volume exists — decide in v2.
