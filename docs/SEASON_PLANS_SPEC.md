# Season plans ("Your season"): design, 2026-10-09

> **Status, 2026-10-20.** This is the build spec as written on 2026-10-09, kept for the reasoning behind each choice. What shipped differs in places: the migrations landed as 0256 to 0259 (not the placeholders below), PR1 to PR5 and the season plans landed together as one integration PR (#452), and the red-team fixes changed several details (see that PR). Where this file and the code disagree, the code is right.

Base: wt/seat-settings 0c11162. Builds on SPEC.md PR2-PR8. Adds no ballot subject, no closer, no second application store.

## Summary
Each season every member gets **Your season** (`/season-plans/mine`): their held seats with Carry on / Hand it back / Not sure; "Apply for a seat" (PR4 wizard, 1-5 seats); and their personal part (aim <=600 chars, optional served season goal copied from `season.goals`, quests per moon min/max 1-12, up to 3 measures in words; reuses parseSeatSettings `quests` + `scoreboard` groups). "File my season" stamps it; edits insert version n+1. Every seat choice needing the village's word is an ordinary PR4 `seat_applications` row through PR4's route and closer. Personal part is filed, not voted (decision 1). Village page `/season-plans` (terms.read; 401 otherwise): header with season, window, "7 of 9 have filed"; one card per present member sorted by name; seat chips, application status chips linking /seat-applications/:id, aim, this moon's consented-quest pips, measures. NO terms/money keys on the roster. Filter "Waiting on the village". "Not filed yet" list by name (decision 2). Profile sheet section `season` in band `now` (own; other members with terms.read).

Code noun `seasonPlan` (NOT "roll": already means ballot electorate and `season_roll_log`).

## Window
`planWindowFor(season, previousSeason, clock)` in shared/seasonPlans.ts. Opens at `termWarningOpensAt(seasonStartInstant)` (one moon before start; same instant as the term warning, server/lib/stewardship.ts:2052). Closes first moon boundary a whole cycle after start. Override `planWindow: {opensOn, closesOn}` on the season document (add to `normalizeSeasonConfig` fixed field list, server/lib/seasonCalendar.ts:258-273; admin Season tab). Amora first run: Season of Foundations (Jun 21 2026 - Mar 21 2027) override opensOn 2026-10-10, closesOn 2026-11-09. Late filing always accepted; window only drives reminders/banner. No next season: refuse to file.

## Notifications (seat names + link only; no recordEvent)
- `season_plan_open` to every present member, first sweep after open; key `season-plan-open:<season>:<user>` hashed to 191 like `seasonReminderKey`.
- `season_plan_reminder` to unfiled: halfway, then 3 days before close; catch-up sends latest mark only; key `season-plan-due:<season>:<mark>:<user>`.
- existing `term_expiring`: link -> `/season-plans/mine?renew=<orgRoleId>`; suppressed when an adopted renewal exists (stewardship.ts:2230-2270, :2247, :2268, comment :2224).
- existing `season_ending`: link -> `/season-plans/mine` (seasonReminders.ts:68-71, header :54-58).
- Copy: "Plan your season: {Season}. Choose your seats and what you will do. Open until {date}." / "Your season is not filed yet. {n} days left." SeasonBanner shows "Plan your season" in window (via `planWindow` on /api/season).

## Seats starting at the turn
`isLapsed` (orgChart.ts:341-384) treats a seating with another season_id as lapsed, so next-season adoptions must not seat early. PR4 gets `seat_applications.starts_at datetime NULL` + `startsNoEarlierThan` input; closer records adopted and leaves seating to hourly job `season-plan-turn` (registered from route module, precedent routes/failedActions.ts:40,77): seats via PR4's exported `seatFromApplication`, renewals rewrite season_id/term_ends_at/application_id on the existing seating, re-checks free places (held-full + notice). Gap: up to 1h lapsed after the turn; Season tab save runs sweep.

## Seat that does not exist yet
Not in the same proposal in v1 (creating = org.decide/PR7; holding = org.seat/PR4). Status 2026-10-21: `org.decide` and the `org_draft` vote are live (#495, server only); the member "Propose a seat" door is not built yet, so the Plan page does not offer it. Plan page offers "Propose a seat" once that door exists. Optional RC3 after PR7: `awaits_draft_id`, status `awaiting-seat`, `releaseAwaiting(draftId)` from the org_draft closer.

## Data (migration E, number by four-way check)
```sql
CREATE TABLE season_plans (
  id varchar(40) PRIMARY KEY, user_id varchar(64) NOT NULL, season_id varchar(64) NOT NULL,
  version int NOT NULL, aim varchar(600) NULL, serves_goal varchar(200) NULL,
  commitments_json json NULL, handing_back json NULL, filed_at datetime NULL,
  superseded_at datetime NULL, created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, season_id, version), KEY (season_id)
);
```
Plus `seat_applications.starts_at` folded into PR4 migration B. Raw SQL, insert versions; only filed_at, superseded_at and erasure update. Applications of a plan: `seat_applications WHERE candidate_user_id=? AND term_season_id=?` (no plan_id).

## Files
New: shared/seasonPlans.ts; server/repos/seasonPlans.ts; server/routes/seasonPlans.ts (GET /api/season-plans?season= [terms.read], GET/PUT /api/season-plans/mine, POST /mine/file, two jobs; rate limited like hand-to-village); client/src/pages/SeasonPlans.tsx, MySeason.tsx; client/src/components/profile/SeasonPlanSection.tsx.
Touched: server/index.ts exempt import+register beside registerSeasonRoutes (:19499); routes/seasons.ts:67-75 add planWindow; seasonCalendar.ts normaliser; stewardship.ts links + suppression; seasonReminders.ts links; shared/notificationKinds.ts (~:216-227); shared/modules.ts:1186-1209 add `/api/season-plans` to governance apiPrefixes; roleApplicationType.ts:56-63 seasonId + ?seat&renew&season; SeasonBanner.tsx:44-74; sheetSections.ts:89 `{id:"season",band:"now"}`; Profile.tsx (887 lines, measure ratchet) + PublicProfile.tsx; App.tsx:82,411-417 routes; erasure.ts:556-565 null aim/goal/commitments; profile export; regenerate docs/GOVERNANCE.md.

## Tests
seasonPlans unit (window on lunar + calendar clocks, override, no season, parsePlan refusals incl. digit/IBAN/ranking/quest bounds/unknown goal); seasonCalendar planWindow survives normalise (control); routes (401 + member control; roster key-set no money with control fixture; order by name; versions; filing; join by term_season_id; questsThisMoon counts consented in-window only with controls); jobs (open once, reminders skip filed, catch-up latest only, turn never early / seats after / renews / held-full); runTermWatch suppression + link; grep no recordEvent; erasure fixture; jsdom visitor nothing, banner window, check-voice.

## Landing order
PR2 -> PR3 -> PR4 (+ multi-seat pick, starts_at, "Put it to the village", export seatFromApplication) -> RC1 (table, routes, pages, profile card, notices, window, banner, links) -> PR5 (retrofit: pre-PR5 applications align from stored settings_json) -> RC2 (turn job, term-watch suppression) -> PR6 -> PR7 -> (RC3) -> PR8. Rye can apply once PR4 + RC1 land.

## Decisions (Rye)
1. Personal commitments filed, not adopted. Rec: filed.
2. "Not filed yet" by name. Rec: yes.
3. How Rye's seats exist: admin publishes org draft now (structure only; occupancy+terms go to the village via his application) vs wait PR7. Rec: admin now. NOTE 2026-10-09: Saberra's first sync (Rick's Team Structure V5) may already carry these seats; check the review queue first.
