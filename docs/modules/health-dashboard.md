# Module design: Village Health Dashboard

<!-- describes: shared/healthMetrics.ts server/lib/events.ts server/lib/health.ts shared/gameConfig.ts -->

Provenance: platform

> Produced by the 13-agent design workflow, 2026-07-26, from the 2020 village-demo deck (slides + speaker notes),
> the platform foundation plan's constraints, and the live codebase. Reconciled by MODULES_MASTER_PLAN.md —
> where this file and the master plan disagree, **the master plan wins** (it applies the two critique passes).

**A deterministic, cycle-aligned instrument panel for village health: an always-on structured event stream feeding lunar-cycle snapshots across participation, recognition breadth, contribution, role coverage, internal economy, and steward-recorded regenerative metrics — rendered with recharts sparklines, tiered public/member/admin, with season goals as the steering overlay.**

Estimated sessions: 8

## Design decisions, and why

- The original concept was an image-only mock with zero defined metrics; this design specifies a concrete registry of ~24 deterministic metrics across 6 categories, each with a documented formula and data provenance, so every number on the dashboard is auditable back to an event or ledger row.
- Breadth over volume: the headline social-health signal is DISTINCT sender-recipient gratitude pairs per cycle (plus breadth ratio = pairs/sends), not raw token counts. Ten thanks from one friend is a friendship; ten from ten people is community health. The 2020 deck's heart-clicking feed measured volume, which is trivially gameable.
- Cycle-aligned time base: metrics snapshot at lunar cycle close — the rhythm the village already lives by (shared/lunar.ts, cycle 328 live) — instead of arbitrary date-range dashboards. Snapshots are pure recomputable functions, so history can be rebuilt from events at any time.
- Instrument-now/dashboard-later split honoring F13: the event spine is always-on platform infrastructure (the data is unrecoverable retroactively), while the dashboard PAGE is a toggleable module. The 2020 deck assumed on-chain data would simply exist; this design makes the recording explicit and immediate.
- Privacy tiers designed in from the start: aggregates public-eligible, individual balances never shown, no leaderboards ever (F3), plus small-cohort suppression (rates hidden below a configurable N so a 4-person village's percentages cannot deanonymize members). The 2020 mock had no privacy model.
- Regenerative metrics as honest steward observations, not vaporware sensors: trees planted, water stored, soil built, a regeneration index score: all admin/steward-entered records with observedOn dates, optional photos, an append-only correction chain (supersedes), and a visible 'steward-recorded' provenance label — no pretense of automated measurement.
- Governance health, not just economic health: consent rate, proposal throughput (keys reserved for Phase 4), % roles filled, and vacant role-days measure whether coordination is working — the F13 research says these decline before departures do. The 2020 dashboard concept was economy-only.
- White-label by construction: the regenerative metric registry is config (a desert fork tracks liters harvested, a forest fork tracks trees) and no metric label or category is hardcoded to one village, per the config-driven mandate.
- No scheduler required for v1: snapshots piggyback the existing idempotent admin-triggered cycle close, with lazy compute-on-read backfill (idempotent upsert on (cycleNumber, metricKey)) — sidestepping the platform's missing-cron problem instead of blocking on Phase 3.
- One-ledger discipline: economy metrics read token_ledger directly and events NEVER duplicate value movement, so the dashboard is structurally incapable of disagreeing with the ledger.
- Season goals become the steering overlay: the just-shipped season goals render beside the metrics that evidence them, turning the dashboard from a vanity screen into the instrument the village steers a season with (v2 binds goals to metric targets with progress bars).
- Hypha boundary kept clean: equity and Voice never appear on the health dashboard — they belong to the economics section which reads Base and deep-links to Hypha. Health measures only what the platform itself governs.

## Data model

## health_events — the append-only spine (always on, superset of addActivity)

Today `addActivity()` (server/index.ts:588) stores only `{id, type, text, at}` capped at 500 rows — a display feed, not data. New `recordEvent()` writes the structured row below and, when `publicText` is passed, ALSO calls `addActivity()` so Village Pulse is unchanged. All 11 existing addActivity call sites (join, stage, quest, gratitude, role, season, proposal, settings) convert to recordEvent.

| column | type | notes |
|---|---|---|
| id | varchar(64) PK | `hev-{ts}-{rand}` |
| type | varchar(64) NOT NULL | dot-namespaced: `member.joined`, `stage.advanced`, `quest.claimed`, `quest.submitted`, `quest.consented`, `quest.declined`, `gratitude.sent`, `role.granted`, `role.revoked`, `season.turned`, `cycle.closed`, `variable.changed`, `proposal.opened`, `proposal.decided` (reserved), `library.checkout`/`library.return`, `stay.night` (reserved for those modules) |
| actor_id | varchar(64) NULL | user FK; NULL for system events |
| entity_type | varchar(32) NULL | `quest`, `claim`, `user`, `role`, `cycle`, `season`, `agreement`... |
| entity_id | varchar(64) NULL | |
| value | int NULL | e.g. gratitude amount, consent amount. NEVER a balance — value movement's source of truth stays token_ledger |
| meta | json NULL | e.g. `{toId}` on gratitude.sent for pair counting |
| cycle_id | varchar(16) NOT NULL | stamped at write via existing `currentCycleId()` |
| at | timestamp NOT NULL default now | |

Indexes: (type, at), (actor_id, at), (cycle_id). Pre-cutover storage: `data/health-events.jsonl` via `fs.appendFileSync` (one JSON object per line — appends don't rewrite the array, corrupt lines skip loudly). Seeded empty in `server/seeds/` + `ensureDataFiles()`. The Drizzle table ships now; the cutover imports the JSONL verbatim.

## health_snapshots — one row per (cycle, metric), computed at close

| column | type | notes |
|---|---|---|
| id | varchar(64) PK | |
| cycle_id | varchar(16) NOT NULL | `lunar-000328` |
| cycle_number | int NOT NULL | |
| metric_key | varchar(100) NOT NULL | validated against shared/healthMetrics.ts — unknown key THROWS (fail-loud, same posture as gameVariables) |
| value | decimal(20,6) NOT NULL | counts and ratios both |
| meta | json NULL | numerator/denominator, per-system-account breakdown |
| computed_at | timestamp NOT NULL | |

UNIQUE (cycle_number, metric_key) → recompute is an idempotent upsert; concurrent lazy backfills are harmless because the computation is deterministic.

## regen_entries — steward-recorded regenerative observations (append-only)

| column | type | notes |
|---|---|---|
| id | varchar(64) PK | |
| metric_key | varchar(100) NOT NULL | validated against the regen registry in health-config; unknown key rejected |
| value | decimal(20,6) NOT NULL | |
| unit | varchar(32) | denormalized from registry at write |
| note | text | |
| photo_url | varchar(1000) | |
| recorded_by | varchar(64) NOT NULL | user FK — real attribution |
| observed_on | varchar(10) NOT NULL | ISO date the work happened (not the entry date) |
| cycle_id | varchar(16) NOT NULL | derived from observed_on |
| supersedes | varchar(64) NULL | correction chain — entries are never edited or deleted; a correction points at the row it replaces and snapshots ignore superseded rows |
| created_at | timestamp NOT NULL | |

## health-config — config document (data/health-config.json → appConfig key `health-config`)

`{ regenMetrics: [{ key, label, unit, kind: "sum"|"latest", description, icon }], seasonGoalBindings?: [{goalText, metricKey, target}] (v2) }`. Example seed: `regen.trees_planted` (sum, trees), `regen.water_stored` (sum, liters), `regen.soil_built` (sum, m³), `regen.ari_score` (latest, 0–100). Forks replace the list without touching platform files.

## shared/healthMetrics.ts — the metric registry (code, platform-level)

Each metric: `{ key, label, category: participation|recognition|contribution|coverage|economy|regenerative, kind: flow|level|ratio, source: events|ledger|roles|manual, sensitivity: public|member|admin, description }`. Unknown key throws everywhere it is read.

## Endpoints

- `GET /api/health/summary — headline metrics for the latest closed cycle + deltas vs previous; response filtered by viewer tier (public gets sensitivity:public with small-N suppression applied; members get member tier; admin gets all). Triggers lazy snapshot backfill for ended-but-unsnapshotted cycles (bounded by health.snapshot_backfill_max).`
- `GET /api/health/metrics/:key?cycles=12 — time series of one metric's snapshots for sparklines; 404s unknown keys (fail-loud), 403s keys above the viewer's tier.`
- `GET /api/health/cycles/:cycleId — the full snapshot row set for one cycle (member+).`
- `GET /api/health/season — current SeasonEntry (name, theme, focus, goals[]) plus, in v2, bound metric progress per goal.`
- `GET /api/health/regen?metric=&limit= — regenerative entry log, newest first, superseded rows flagged (member+; the aggregates appear in snapshots).`
- `POST /api/health/regen — record an observation {metricKey, value, note?, photoUrl?, observedOn}; requires capability health.record via shared/capabilities.ts (admin passes automatically).`
- `POST /api/health/regen/:id/supersede — file a correction entry pointing at a prior one; same capability; original row untouched.`
- `POST /api/admin/health/backfill — recompute snapshots for the last N closed cycles; idempotent by the unique key; admin only.`
- `PUT /api/admin/health/config — edit the regen metric registry document; admin only.`
- `(hook, not a new endpoint) POST /api/admin/cycles/close — extended: after settling distributions it calls computeCycleSnapshots(cycleId) and emits a cycle.closed event. Stays idempotent.`

## Surfaces

**Page:** `client/src/pages/VillageHealth.tsx` at route `/health`, registered only when the module is on. Nav entry "Village Health" in the drawer + `client/src/config/mobileNav.ts` (config-driven, added only when enabled). Public variant renders if `health.public_view = aggregates`: category cards, trends, season goals — no names, no individual anything, rates suppressed under min cohort size. Member variant adds cycle drill-down, coverage detail, treasury/pool series (once ledger system accounts exist), and the regenerative entry log with photos. Admin sees admin-tier metrics inline.

**Components:** `client/src/components/health/MetricCard.tsx` (headline value, delta arrow vs previous cycle, recharts `<LineChart>` sparkline of last N cycles — recharts ^2.15.2 already installed); `CategorySection.tsx` (six categories, collapsible); `SeasonGoalsPanel.tsx` (goals checklist from /api/health/season; v2 adds progress bars from bindings); `RegenerativeSection.tsx` (per-metric cards labeled "steward-recorded", entry log strip with photos); `CycleDetail.tsx` (one lunation's full snapshot table, member+).

**Admin:** `HealthAdminTab` in `client/src/pages/Admin.tsx` following the existing `{password}` tab pattern (like `VisitAdminTab`): quick-entry form for regenerative observations (metric picker from registry, value, date, note, photo URL), entries list with supersede action, backfill button, registry editor. Tunables live in the existing Game Mechanics variables page automatically since they are game variables.

**Mobile:** cards stack single-column; sparklines fixed 48px height with no axes (full chart on tap); the page is read-mostly so it works well as the thing a founder checks from a phone.

## Mechanics

**Event spine (always on, not toggleable).** `recordEvent(pool, {kind, text, actorUserId?, entityType?, entityId?, value?, meta?, audience?})` in `server/lib/events.ts` appends the structured row to `health_events`. (This file was named `healthEvents.ts` in the design; as built it is `events.ts`.) This is deliberately OUTSIDE the module toggle: F13's justification is that the data is unrecoverable retroactively, and the write cost is one appended line. The dashboard (page, nav, admin tab, endpoints) is the toggleable module.

**Snapshot computation.** Designed as a pure `computeCycleSnapshots(cycleId, {...}) → rows[]` in `server/lib/health-snapshots.ts`. **Not built that way.** As shipped it is `snapshotCycle(pool, cycle, eligibleSenders)` in `server/lib/health.ts:48`, which queries and writes directly rather than taking a fixture bag, and it takes no roles or roleHolders at all. Snapshots are frozen at cycle close and never recomputed. Do not plan against the design signature.

**Formulas:**
- `participation.active_members` = |distinct actor_id in cycle events| (acting, not lurking — logins don't count, deeds do)
- `participation.new_members` = count(member.joined); `participation.retention_rate` = |active(c) ∩ active(c−1)| / |active(c−1)|; `participation.lapsed_members` = members active within the retention window who went silent this cycle
- `recognition.sends` = count(gratitude.sent); `recognition.distinct_pairs` = |distinct (actor_id, meta.toId)| — the headline; `recognition.distinct_senders`, `recognition.distinct_recipients`; `recognition.breadth_ratio` = pairs/sends
- `contribution.quests_claimed/submitted/consented` = event counts; `contribution.consent_rate` = consented/submitted; `contribution.proposals_opened/decided` reserved at 0 until the Phase 4 decision primitive emits events
- `coverage.roles_filled_pct` = roles with ≥1 holder / total roles at cycle end; `coverage.vacant_role_days` = Σ per role of days-in-cycle with zero holders, reconstructed from role.granted/role.revoked events, clamped to "since instrumentation began" and labeled so
- `economy.gratitude_flow` = Σ positive gratitude token_ledger amounts in cycle (from the ledger, never from events); `economy.velocity` = flow / mean(opening, closing total outstanding balance); `economy.treasury_balance` = system-account (treasury, pools) ledger balances at close, per-account breakdown in meta — ships only once ledger system accounts exist, never fabricated; `economy.library_utilization_pct` and `economy.stay_occupancy_pct` = reserved keys computed from library.checkout/return and stay.night events when those modules ship (occupancy denominator = health.stay_capacity_nights until a real booking module owns it; metric hidden when 0)
- `regen.*` = per registry kind: `sum` metrics total non-superseded entries with observed_on in the cycle; `latest` metrics (an index score, say) take the newest non-superseded entry at or before cycle end

**Scheduling without a scheduler:** snapshots run (1) inside the existing idempotent `POST /api/admin/cycles/close`, and (2) lazily on dashboard read — any ended cycle missing snapshots within the backfill window gets computed and upserted. Deterministic + unique(cycle_number, metric_key) makes both paths race-safe. When the Phase 3 scheduler lands, the same function moves onto a cron with zero redesign.

**State machine:** none needed beyond cycle status (open → closed, already shipped). Regen entries are append-only with a supersedes pointer instead of edit/delete.

**Privacy tiering:** every metric declares sensitivity in the registry; the summary endpoint filters server-side. Rates and percentages at public tier are suppressed (rendered as "—") when the denominator < health.min_cohort_size. Individual balances, per-person totals, and leaderboards are structurally absent — the snapshot table only ever holds aggregates, so a leak of the dashboard data leaks nothing personal.

## Game variables

- health.dashboard_enabled: false (boolean) — module master switch; OFF by default per platform rule. Instrumentation records regardless (documented in the variable description so admins aren't surprised).
- health.public_view: off (choice: off | aggregates) — whether logged-out visitors can see the public-tier dashboard at /health.
- health.min_cohort_size: 5 (1–100, members) — minimum denominator before rate/percentage metrics render at public tier; prevents deanonymization in small villages.
- health.retention_window_cycles: 3 (1–12, cycles) — lunations of inactivity before a member counts as lapsed.
- health.snapshot_backfill_max: 12 (1–48, cycles) — how many ended cycles the lazy backfill will compute on read; bounds worst-case request cost.
- health.sparkline_cycles: 6 (3–24, cycles) — trend window rendered on metric cards.
- health.stay_capacity_nights: 0 (0–10000, nights per cycle) — occupancy denominator until a booking module owns it; 0 hides the occupancy metric entirely rather than showing a fake 100%.

## Admin controls

Admin > Village Health tab (contributed only when the module is on): (1) regenerative quick-entry form — metric picker driven by the health-config registry, value + unit, observed-on date, note, optional photo URL; entries attributed to the logged-in admin/steward; (2) entry log with supersede-correction flow (nothing is ever edited or deleted); (3) regen metric registry editor (add/rename metrics, set kind sum/latest, unit, icon) — pure config, forks customize here; (4) "Recompute snapshots" backfill button with per-cycle results; (5) all seven health.* tunables appear automatically in the existing Game Mechanics variables page with bounds and plain-language descriptions. Capability extension: add "health.record" to the Capability union in shared/capabilities.ts, granted only via roles (e.g. a Land Steward role), never by stage by default — stewards can log trees without full admin. Guards: regen POST validates metricKey against the registry and rejects unknowns; snapshot endpoints throw on unknown metric keys; sensitivity filtering is server-side only (never trust the client to hide admin-tier series).

## Dependencies

- shared/lunar.ts + idempotent cycle close at POST /api/admin/cycles/close (SHIPPED — the snapshot trigger)
- Roles-as-data + shared/capabilities.ts (SHIPPED — coverage metrics and the health.record capability)
- Seasons with goals in gameConfig/season.json (SHIPPED — the goals panel)
- recharts ^2.15.2 (already in package.json — sparklines/trends)
- token_ledger (foundation step 2 — economy.velocity/flow/treasury read it; until it ships, flow metrics fall back to gratitude_log sums and treasury metrics stay hidden)
- addActivity()/Village Pulse (SHIPPED — recordEvent wraps it, does not replace it)
- server/seeds/ + ensureDataFiles() convention for the four new data files pre-cutover
- Notification spine + scheduler (Phase 3 — v2 threshold alerts and cron-driven snapshots only)
- Forum + decision primitive (Phase 4 — proposal.* metrics are reserved keys until its events exist)
- Library / stay modules (future — their utilization metrics are reserved keys until those modules emit events)

## v1 (ship first, useful alone)

Ship the spine and a useful member dashboard in 4 sessions. Session 1: shared/healthMetrics.ts registry + recordEvent() + convert all 11 addActivity call sites (join, stage advance, quest claim/submit/consent, gratitude send with toId in meta, role grant, season turn, variable change) + data/health-events.jsonl with seed + ensureDataFiles entry + Drizzle tables in schema.ts + unit tests. From this moment the village is recording history — everything else can wait. Session 2: pure computeCycleSnapshots() with fixture tests covering participation, recognition (distinct pairs), contribution, coverage; hook into cycles/close; lazy backfill on read; GET /api/health/summary + /metrics/:key. Session 3: regen_entries + health-config seed (the deployment's own regenerative metrics) + POST/GET /api/health/regen + supersede + HealthAdminTab entry form + health.record capability. Session 4: VillageHealth.tsx page (member tier only in v1), MetricCard with recharts sparklines, six category sections, SeasonGoalsPanel reading the shipped season goals, nav entries behind health.dashboard_enabled. v1 deliberately excludes: public variant, treasury series, occupancy/library metrics, goal-metric bindings. It is useful alone: a founder closes a cycle and sees participation, recognition breadth, contribution, coverage, and the regenerative story of that lunation.

## v2 (the rest of the design)

The rest of the design plus what 2020 couldn't specify, ~4 more sessions once upstream pieces land. Public aggregate variant with small-N suppression (health.public_view) — the marketing surface a land project shows the world. Treasury/pool balance time series once ledger system accounts exist (member tier, per-account breakdown). Library utilization % and stay occupancy % wired to those modules' events when they ship (reserved keys mean zero schema change). Goal-metric bindings: extend health-config with {goalText → metricKey, target} so season goals render progress bars ("Plant 500 trees: 312/500") — the dashboard becomes the season's steering instrument. Cycle report: a shareable per-lunation summary (the thing founders carry to Hypha alongside the distributions report). Threshold alerts through the Phase 3 notification spine (retention drop, coverage drop, zero-objection streaks). F13's 'later' analytics once the decision primitive ships: authorship concentration, silent-consent rate, objection-rate-trending-to-zero, per-person engagement decline as a departure early-warning (admin tier only — it names individuals). Move snapshot computation onto the Phase 3 scheduler cron.

## Risks

- Goodhart/gaming: publishing any metric invites optimizing it. Mitigated by choosing breadth (distinct pairs) over volume, no leaderboards ever (F3), aggregates only, and no metric that pays — the dashboard reads the economy, it never moves it.
- Small-N deanonymization: in a 6-person village 'retention 83%' names the person who left. min_cohort_size suppression at public tier; member tier is accepted as in-community knowledge.
- Pre-cutover JSONL: readJson's corrupt-file-reads-as-empty hazard is avoided by line-by-line parse that skips bad lines and logs loudly, but a truncated final line during a crash is still possible; the cutover import validates line counts. Keep the events file OUT of the 500-cap trimming applied to activity.json.
- Vacant role-days before instrumentation start are unreconstructable — the metric must render 'since instrumented' or it silently lies about history. Same for every metric's first partial cycle.
- Treasury metrics before ledger system accounts exist would be fabricated; the design gates them on the ledger shipping rather than approximating. Reviewers must not 'helpfully' fill them from JSON balances.
- Self-reported regen numbers presented as measured data is a credibility risk for a product sold to investors — every regenerative card carries a 'steward-recorded' provenance label, entries carry recorder attribution and a correction chain, and an index card links its methodology once the village has defined one.
- Scheduler absence: if no admin closes cycles and nobody visits the dashboard, snapshots lag (events do not — they are stamped at write). Acceptable for v1; resolved by Phase 3 cron.
- Double-write drift risk during the DB cutover window: recordEvent must have exactly one storage backend at a time (JSONL pre-cutover, table post-cutover), never both, or event counts fork.
- Legal posture: clean — the module is read-only over platform-governed data, moves no tokens, and never displays Hypha-governed equity/Voice (those stay in the economics section, deep-linked to Hypha). No new legal review triggered. Flag only: if a future fork puts the public dashboard in fundraising materials, aggregate treasury figures could be construed as performance marketing — keep fiat-equivalent framing out of platform copy.

## Open questions

- Composite index scores: the dashboard treats any regeneration index a village tracks as an opaque steward-entered 'latest' value 0–100, and checks nothing about how it was derived. Who is authorized to enter one, and on what cadence, is a village decision the registry does not enforce.
- Definition of 'active member': v1 counts only recorded deeds (any health event with an actorId), not logins or page views. Is lurking-but-present worth counting for a village, and if so should a lightweight session-seen event be added (privacy tradeoff)?
- Is the public aggregate variant worth having before a village is bigger, given small-N realities, or is member-only the right posture until roughly 20 active members?
- Should season goals gain numeric metric bindings in the SeasonEntry shape itself (shared/gameConfig.ts change, affects every fork) or stay in health-config as an overlay (my recommendation: overlay first, promote later if it proves out)?
- Stay occupancy denominator: who maintains health.stay_capacity_nights until a real booking module exists, and should the visit program's request data seed a proto-occupancy metric meanwhile?
- Cutover timing: if Phase 1b repository cutover lands before this module's session 1, health_events should be born DB-native and skip the JSONL era entirely — decide at build start, not mid-build.
