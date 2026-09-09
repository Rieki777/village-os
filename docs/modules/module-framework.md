# Module design: module-framework

<!-- describes: shared/modules.ts server/lib/modules.ts shared/hypha.ts -->

Provenance: platform

> **Corrections, 2026-08-14.** This file is a DESIGN document from before the build, and three things
> in it are now wrong. It is not on Maia's shelf (`MODULE_DOCS` excludes it deliberately), so nothing
> quotes it to a founder, and it is kept as the record of the design.
>
> 1. **The `ModuleDef` quoted below is stale.** The live interface is `shared/modules.ts` and carries
>    `tier`, `dataClass`, `vendor?`, `provides?`, `sellsToken?` and `openStateCheck?` as well. Read the
>    file, never this quote.
> 2. **`client/src/modules/registry.tsx` does not exist and was never built.** The only file in
>    `client/src/modules/` is `ModuleProvider.tsx`. There is no client-side per-module manifest: nav,
>    routes and admin tabs are wired in `App.tsx` and `Admin.tsx` against the ids the server sends from
>    `/api/modules`, and the Admin Modules tab renders whatever the registry contains.
> 3. **The "Interim JSON" section is void.** `data/modules.json` and `data/module-events.json` never
>    became the authority and MySQL is the only one now (`module_settings`, `module_events`, migration
>    0015). `server/lib/modules.ts` is a boot-loaded cache over those tables, not an mtime-memoised
>    JSON reader.
>
> Produced by the 13-agent design workflow, 2026-07-26, from the 2020 village-demo deck (slides + speaker notes),
> the platform foundation plan's constraints, and the live codebase. Reconciled by MODULES_MASTER_PLAN.md —
> where this file and the master plan disagree, **the master plan wins** (it applies the two critique passes).

**The substrate every other module rides on: a platform-defined module registry with a per-deployment lifecycle (off → admin-preview → members-only → public), dependency-checked enable/disable, server gating middleware, client nav/route/admin-tab contribution only when enabled, delta-only storage so forks inherit new modules as OFF, and one global Hypha integration setting (org URL + named deep links) that every governance-touching module references instead of rebuilding governance.**

Estimated sessions: 6

## Design decisions, and why

- Lifecycle instead of a binary switch. The requirement was on/off, and the original concept assumed everything always-on for everyone. This design adds off -> preview -> members -> public, so a village can soft-launch the Material Library to admins, then to members, before the public sees it. The 2020 deck had no rollout concept at all.
- Existence-hiding 404 posture. A disabled or admin-preview module returns 404 to the public, so a fork's site never advertises features the village hasn't configured or bought. The deck's Nyani dashboard showed every tool to every visitor including half-built ones.
- Dependency graph with hard/soft edges. The deck's tools were siloed screens with implicit couplings (Library credits implied a ledger, Gratitude feed implied a fund). Here exchange hard-requires ledger, forum hard-requires notifications, map soft-recommends notifications - checked server-side at enable time and re-checked at boot with loud demotion, never silent breakage.
- Delta-only inheritance for forks. Absent row = platform default = OFF, copying the game_variables pattern. When the platform ships a new module, every existing fork sees it appear in their admin panel as OFF automatically - a product-line concept the 2020 single-village deck could not have had.
- The Hypha boundary made structural. Slides 16-27 rebuilt voting, referendums, and share purchase inside the village app. This design replaces all of that with one global integration object (hyphaOrgUrl + named deep links: governance, proposals, treasury, members) and a <HyphaLink> component that hides itself when unconfigured. No dead links, no second governance system, no securities exposure from an in-app share-purchase screen.
- One gate, one ledger, honored by construction. Module capabilities are keys in shared/capabilities.ts, module credits are rows in token_ledger - the deck's Library Credits and stay-payment screens each implied their own balance store. The framework gives modules no place to keep a private balance column.
- Rules changeable without a deploy (F8). Every module tunable registers as a bounded game variable that only surfaces in Admin when the module is on; structural config is a validated JSON document per module. The deck's parameters (library 120% credit price, 0.1-1% health tick) were speaker-notes constants.
- Instrumented from day one (F13). Every lifecycle and config change appends to module_events with actor and before/after, so 'who turned the exchange on and when' is answerable forever - the data is unrecoverable retroactively.
- Legal posture surfaced in the UI. Registry entries carry a legalReview flag; enabling stays/exchange/library shows the closed-loop-credits caution card before the toggle commits. The deck happily mixed equity, credits, and fiat in one exchange screen.
- Bundle hygiene. Client route components are lazy-loaded per module (v2), so a village running only the core loop ships ~zero bytes of Library/Exchange/Map code to visitors - the deck era assumed one monolith.

## Data model

### `module_settings` (MySQL/Drizzle; ships now, JSON authoritative until Phase 1b cutover)

| column | type | constraints / notes |
|---|---|---|
| module_id | varchar(64) | PK. Must exist in the `MODULES` registry (`shared/modules.ts`); writes for unknown ids rejected 400. |
| lifecycle | enum('off','preview','members','public') | NOT NULL, default 'off'. |
| config | json | Module-structural config (e.g. tools directory links, forum categories). Validated by the module's `validateConfig()` before write. |
| updated_by | varchar(64) | users.id of the admin who last changed it. |
| updated_at | timestamp | defaultNow, onUpdateNow. |

**Absent row = platform default = OFF.** Only touched modules get rows, mirroring `game_variables` delta-only storage, so forks inherit newly shipped modules automatically.

### `module_events` (append-only, F13 instrument-now)

| column | type | constraints / notes |
|---|---|---|
| id | varchar(64) | PK. |
| module_id | varchar(64) | NOT NULL. |
| kind | enum('lifecycle','config') | NOT NULL. |
| from_value | varchar(255) | e.g. 'off'. |
| to_value | varchar(255) | e.g. 'preview'. Config events store a short diff summary. |
| by_user_id | varchar(64) | actor. |
| at | timestamp | defaultNow. |

### Interim JSON (authoritative today, per repo rule)

- `data/modules.json` — `{ [moduleId]: { lifecycle, config, updatedBy, updatedAt } }`; seed `server/seeds/modules-seed.json` = `{}` + `ensureDataFiles()` entry.
- `data/module-events.json` — append-only array; seed `[]`.
- Reader `server/lib/modules.ts` mirrors `server/lib/variables.ts` (sync, mtime-memoised); the MySQL cutover swaps load/save functions only.

### Registry (code, not DB) — `shared/modules.ts`

**Stale. See correction 1 at the top of this file; read `shared/modules.ts` instead.**

```ts
interface ModuleDef {
  id: string;                    // 'forum', 'library', 'stays', 'exchange', 'map', 'tools', 'notifications', 'economics', 'automation'
  name: string; description: string;   // founder-facing copy, config-driven, no village specifics
  core?: boolean;                // quests/gratitude/stages/profiles: listed but not disableable in v1
  requires: string[];            // hard deps (block enable, block disabling the dependency)
  recommends: string[];          // soft deps (warn only)
  capabilities: Capability[];    // keys added to shared/capabilities.ts union
  variableKeys: string[];        // namespaced game variables ('library.*') shown in Admin only when on
  apiPrefixes: string[];         // ['/api/library'] — mounted behind requireModule()
  hyphaLinks?: HyphaLinkName[];  // named deep links its UI renders
  legalReview?: boolean;         // caution card before enabling (exchange, stays, library)
  hyphaOnly?: boolean;           // share-like features: module is a deep-link surface, never a mint path
  validateConfig?: (c: unknown) => string | null;
  defaultConfig?: object;
}
```

~~Client-side manifest lives separately in `client/src/modules/registry.tsx`~~ — **never built, see correction 2.** `client/src/modules/` holds `ModuleProvider.tsx` alone; nav, routes and admin tabs are wired directly against the module ids `/api/modules` sends.

## Endpoints

- `GET /api/modules — public, viewer-scoped manifest: modules visible to THIS viewer (public; members if signed in; preview if admin), each with id, lifecycle, nav entries, safe config subset; plus hypha: { configured, orgUrl, links: { governance, proposals, treasury, members } }. Client boots nav and routes from this one call.`
- `GET /api/admin/modules — full truth: every registry module incl. off/core, lifecycle, config, dependency status (satisfied / missing / demoted-at-boot), legalReview flags, orphan ids found in data that match no registry entry.`
- `PUT /api/admin/modules/:id/lifecycle — body { lifecycle }. 409 with { missing: [depIds] } when enabling with an off hard-dep (panel offers enable-both); 409 with { dependents: [ids] } when disabling a module something non-off requires; 400 for unknown module id or core module. Appends module_events row.`
- `PUT /api/admin/modules/:id/config — validated by the module's validateConfig(); 400 with the validator's message on failure. Appends module_events row.`
- `GET /api/admin/modules/:id/events — (v2) paged append-only history for the module.`
- `GET /api/admin/modules/:id/health — (v2) per-module counts and readiness (e.g. forum: categories seeded? notifications: VAPID keys set?).`

## Surfaces

**Admin:** new `ModulesTab` in `client/src/pages/Admin.tsx` (registered in the existing activeTab pattern, placed beside Setup). Card grid, one card per registry module; core modules render greyed with a Core badge. Top of tab: the **Hypha Integration card** (org URL + resolved link preview). Red banner across the tab when boot reconciliation demoted anything.

**Client plumbing:** `client/src/modules/ModuleProvider.tsx` (fetches `/api/modules` once, long staleTime; exposes `useModules()`, `useModule(id)`, `useHyphaLink(name)`), `client/src/modules/ModuleGate.tsx` (`<ModuleGate module="library" fallback={<NotFound/>}>`), `client/src/modules/registry.tsx` (per-module client manifests). `App.tsx` maps module routes from the manifest filtered by the enabled list — a route whose module is off renders the existing 404 page; v2 makes these `React.lazy` chunks.

**Nav:** module nav entries go to the Layout hamburger drawer (grouped section per module) and optionally `FAB_ACTIONS` in `client/src/config/mobileNav.ts`; the five `TAB_SLOTS` stay fixed and are only changed by deployment config, never auto-appended — modules never fight over the thumb bar. Preview-lifecycle entries render with a small "Preview" pill, admin-only.

**Shared component:** `client/src/components/HyphaLink.tsx` — consistent outbound button ("Decisions happen on Hypha ↗"), renders nothing when `hypha.org_url` is blank so a dead link is impossible. All governance CTAs in every module use it.

**Mobile:** drawer sections collapse; module count doesn't grow the tab bar; FAB actions from modules capped (drawer holds the rest).

## Mechanics

**Lifecycle state machine:** `off → preview → members → public` (rank-ordered; any direct transition allowed via PUT, subject to dependency rules). Semantics: `off` = routes 404, zero nav, zero admin tabs, variables hidden; `preview` = admins only (non-admins get the same 404 as off — existence hidden); `members` = any signed-in user (anonymous gets 401 so the client can prompt login); `public` = everyone, normal capability gating applies on top.

**Server gating (ONE GATE preserved):** `requireModule(id)` Express middleware factory in `server/lib/modules.ts`, mounted per-router as `index.ts` splits: `app.use('/api/library', requireModule('library'), libraryRouter)`.
```
lc = effectiveLifecycle(id)
lc === 'off'                      -> 404 { error:'module_disabled', module:id }
lc === 'preview' && !req.isAdmin  -> 404 (same body; don't leak the catalog)
lc === 'members' && !req.userId   -> 401 { error:'auth_required', module:id }
else next()   // per-route hasCapability() checks unchanged
```
Capability checks stay in `shared/capabilities.ts`; modules only ADD keys to the union (e.g. `library.steward`). Module-off means routes are gone, so no capability changes are needed for gating.

**Dependency rules:** hard `requires`: a module cannot leave `off` while any hard dep is `off` (409 + missing list, panel offers "enable both"); a dep cannot be set `off` while a non-off module requires it (409 + dependents list). Panel additionally WARNS (never blocks) when a dep's lifecycle rank is below the dependent's (e.g. public forum over members-only notifications) and on unmet `recommends`. 

**Boot reconciliation (fail loud, don't brick):** at startup, `assertModuleGraph()` computes `effectiveLifecycle`: a module whose hard dep is off (hand-edited volume file) is served as `off`, with a fatal-level server log line and a red banner + reason in the admin panel. Unknown module ids in `data/modules.json` are never served and are listed as orphans in `GET /api/admin/modules`. Nothing is silently ignored; nothing bricks the site.

**Hypha resolution (`shared/hypha.ts`):** fixed name set `['governance','proposals','treasury','members']` with conventional suffixes. `resolveHyphaLinks(vars)`: if `hypha.org_url` is blank → null → every HyphaLink hides. Otherwise each named link = its override variable if non-blank, else `orgUrl` + default suffix. `hyphaLink(name)` throws on an unknown name (fail-loud, matching the variables reader). The platform NEVER posts to Hypha — read-and-display + deep-link only; any module marked `hyphaOnly` renders links and balances, never a mint/move path.

**Config split:** tunables (rates, caps, ticks) = bounded game variables namespaced per module, declared with `module` tag in `shared/gameVariables.ts`, admin-edited on the Game Mechanics page which hides off-module groups; structural config (category lists, link directories) = the `config` JSON on module_settings, validated per module. Both editable without deploy (F8).

**Fork seeding:** `modules-seed.json` = `{}` — everything OFF, every default inherited. Enabling is always a deliberate per-deployment admin act, which is the requirement.

## Game variables

- hypha.org_url: "" (https URL, ≤255) — The village's Hypha DHO base URL (e.g. https://app.hypha.earth/your-dho). Blank = every Hypha button in every module hides. Validated https like tokens.base_rpc_url.
- hypha.link_governance: "" (https URL or blank) — Override for the governance deep link; blank derives orgUrl + conventional suffix.
- hypha.link_proposals: "" (https URL or blank) — Override for the proposals deep link; blank derives from org_url.
- hypha.link_treasury: "" (https URL or blank) — Override for the treasury deep link; blank derives from org_url.
- hypha.link_members: "" (https URL or blank) — Override for the members deep link; blank derives from org_url.
- (pattern, per module) <moduleId>.*: each module registers its tunables as bounded variables tagged with its id — e.g. library.credit_price_pct: 120 (100–300), library.health_tick_pct: 0.5 (0.1–5). The Game Mechanics admin page only shows a module's group while the module is non-off. Module LIFECYCLE itself is deliberately NOT a game variable: it is deployment infrastructure, not an economy rule, and lives in module_settings.

## Admin controls

A new **Modules** tab in Admin, the control panel for all of this. Layout: (1) **Hypha Integration card** pinned on top — org URL field, live preview of the four resolved deep links, an "open ↗" test button per link, and the note "all governance, voting, and equity live on Hypha; modules link out, never rebuild". (2) **Module card grid** — every registry module: name, founder-facing description, lifecycle pill, a four-step lifecycle stepper (Off / Preview / Members / Public), dependency chips with green/grey status dots, "what it adds" summary (N nav entries, N admin tabs, N game variables), and a Configure button that jumps to the module's own contributed admin tab once non-off. Core modules (quests, gratitude, stages, profiles) render greyed with a Core badge and no stepper in v1. (3) **Guardrails in the flow:** enabling with a missing hard dep opens a dialog listing the deps with "Enable both" / cancel; disabling a depended-on module is blocked with the dependents named; modules flagged legalReview show the closed-loop-credits caution card ("non-withdrawable, non-refundable-to-fiat credits — read the legal posture note") requiring an explicit confirm; a red banner surfaces boot-time demotions ("forum is configured ON but notifications is OFF — it is not being served") and orphan ids from hand-edited data files. (4) **Audit:** every change appends to module_events; v2 adds the per-module history viewer and health checks. All copy comes from the registry definitions — no village-specific text in the panel (decision 2).

## Dependencies

- shared/capabilities.ts — module capability keys extend its union; the framework never adds a second permission mechanism (ONE GATE)
- shared/gameVariables.ts + server/lib/variables.ts — module tunables and the five hypha.* variables register here; the fail-loud reader is reused unchanged
- Roles-as-data + admin auth (shipped) — lifecycle 'preview' keys off req.isAdmin; role editor shows module capability keys grouped by module
- ensureDataFiles() + server/seeds/ pattern — modules-seed.json and module-events seed follow the gitignored-volume rule exactly
- Phase 1b repository cutover — module_settings/module_events tables ship in server/db/schema.ts now; JSON stays authoritative until the modules domain cuts over (reader swaps load/save only, like variables.ts)
- server/index.ts split (Phase 1c) — per-module Express routers are the natural split unit; requireModule() mounts at each router
- Downstream consumers: notifications (Phase 3), forum + decision primitive (Phase 4), economics, command centre, and every deck module (library, stays, exchange, map, tools, impact) ride this substrate
- No scheduler needed — the framework is entirely request-driven, so it does not wait on the Phase 3 cron gap

## v1 (ship first, useful alone)

Ship the substrate plus one proving consumer, useful alone. Session 1: `shared/modules.ts` (ModuleDef + registry with core entries and the first real ids), `server/lib/modules.ts` (mtime-memoised reader, effectiveLifecycle, requireModule middleware, assertModuleGraph boot check), `data/modules.json` + `data/module-events.json` seeds and ensureDataFiles entries, module_settings/module_events added to `server/db/schema.ts`, endpoints GET /api/modules, GET /api/admin/modules, PUT lifecycle, PUT config, and vitest coverage: dependency block both directions, 404/401 posture per lifecycle, delta-inheritance (absent row = off), boot demotion, unknown-id rejection. Session 2: Admin ModulesTab (card grid, stepper, dep dialogs, legal caution, orphan/demotion banner), the five hypha.* game variables + `shared/hypha.ts` + `HyphaLink` component, ModuleProvider/ModuleGate, drawer + FAB nav contribution wiring. Session 3: the **tools** module (deck slide 30, "one place to find all the tools your village uses") as the reference implementation — config-only links directory, no new tables, its own admin config editor, nav entry, and a public page — proving registry → enable → nav → route → config end-to-end; plus a README section documenting how the forum/library/stays teams plug in. Acceptance: with modules.json = {} the site is byte-identical to today; enabling tools at preview shows it to admins only; at public it appears in nav and serves; disabling returns it to 404; a hand-forged dependency violation demotes loudly at boot.

## v2 (the rest of the design)

The full slide-vision substrate: lazy-loaded per-module client chunks in App.tsx (off modules cost ~0 bundle bytes); admin-tab and profile-widget injection points from the client registry; per-module health endpoint (GET /api/admin/modules/:id/health) with readiness checks the card grid surfaces; module_events history viewer in the panel; soft-dependency nudges ("map works better with notifications on"); lifecycle-rank warnings resolved into a guided fix flow; a catalog view showing registry modules that exist on the platform but are unreleased for this deployment ("coming soon" cards, off by default via a variable); per-deployment nav ordering/renaming overlay (brand.json pattern) for module nav entries; role-based preview cohorts (capability `module.preview` grant so a beta group beyond admins can test); and a CI lint enforcing the master-plan rule that platform files never reference village-specific module config — the enforcement code the upgrade plan notes is currently missing.

## Risks

- Retrofit risk: gating the existing 80 live routes would be a regression minefield — mitigated by declaring the current loop (quests, gratitude, stages, profiles) core/always-on in v1; only NEW surfaces ride the framework, so day-one prod behavior is unchanged by construction.
- JSON→MySQL drift at cutover: modules state double-written or forked — mitigated by a single reader/writer module (server/lib/modules.ts) shaped exactly like variables.ts, so cutover swaps two functions and nothing else.
- 404 existence-hiding can confuse debugging ('the endpoint vanished') — mitigated by the structured { error:'module_disabled' } body, the admin endpoint always telling the truth, and a server log line on every demotion.
- Dependency deadlock UX: an admin who can't disable notifications because forum depends on it may hand-edit the volume file — the boot reconciliation covers that path loudly, but the panel must make cascade order obvious or admins will fight it.
- Nav overflow: eight enabled modules could swamp the drawer and FAB — drawer sections per module and a FAB cap are in v1; the five-slot tab bar is deliberately not auto-appended.
- Legal: the framework itself is neutral, but it makes enabling exchange/stays/library one click — the legalReview caution card is a speed bump, not counsel; the closed-loop credit modules (and anything hyphaOnly like impact funds or share purchase) still need real legal review before any village enables them with real members. Flagging explicitly per the brief.
- Preview leakage: preview modules must not leak via /api/modules to non-admins, activity feed entries, or notification fan-out — module authors need a stated rule (no addActivity/notify calls unless lifecycle ≥ members) enforced in review until a lint exists.

## Open questions

- Should the core loop ever become disableable (a 'brochure-mode' fork with no game)? If yes, what is the minimum viable core — auth + profiles only? v1 says no; the registry shape supports changing the answer later.
- Preview lifecycle: admins only, or a role-grantable beta cohort (capability module.preview) from day one? v1 ships admin-only; the ONE GATE mechanism makes the upgrade trivial for a village that wants beta groups sooner.
- Hypha named links: is the fixed four (governance, proposals, treasury, members) enough, or do villages need admin-definable named links (e.g. a specific standing proposal)? Fixed set is safer for fail-loud lookups.
- Should GET /api/modules expose members-only module ids (id + name only) to signed-out viewers so the login page can advertise what's inside, or is full existence-hiding the right default for every lifecycle below the viewer's?
- Where does per-deployment nav ordering live — brand.json overlay (Setup Wizard pattern) or module config? Deferred to v2 but the answer decides whether the Setup Wizard grows a Nav step.
- Does the forum (Phase 4) ship AS a module from birth, or land core and get wrapped later? Recommendation: from birth — it is the first big consumer and validates the framework under real load, but that couples Phase 4's schedule to this design being merged first.
