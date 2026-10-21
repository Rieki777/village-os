# Seat settings and alignment: build spec

> **Status, 2026-10-20.** This is the build spec as written on 2026-10-09, kept for the reasoning behind each choice. What shipped differs in places: the migrations landed as 0256 to 0259 (not the placeholders below), PR1 to PR5 and the season plans landed together as one integration PR (#452), and the red-team fixes changed several details (see that PR). Where this file and the code disagree, the code is right.

Base: origin/main b17db45 (2026-10-09). Held lane: origin/wt/triggers-agreements 8962487, reaching main only through PR #389 (open, CONFLICTING, "HELD: lands once, at the end").
Winner taken as the base: **thin-layers** (settings model, member door, alignment store). Grafts from seat-terms-first and agreement-first are marked (G). Every defect a judge named is answered in section 8.
Rye's season agreement is read through Schedule C only. Schedule D is never opened, quoted or stored.

## 0. What ships, in one paragraph

A seat's terms live in a Settings drawer tucked under the live role card. A member picks each group from a library of presets and tweaks it. Any member can propose a new seat with terms, change a seat's terms on offer, or apply to hold one or more seats on terms. Adoption follows whoever holds the power: a live holder adopts, or the village votes. Aligning is one click from the member's own account. The holder's adopt click, or the landed ballot, is the village's countersign. Every member reads every seat's terms, money included. Visitors read none of it. Money is a record only: nothing in this feature pays, posts, promotes or releases value.

## 1. Fixed rules every PR obeys

1. **Nouns.** Code nouns: `seatSettings` (the terms object), `terms_offer` (what a seat offers), `seat_applications` (the member door), `alignment` (the act and the store). UI words: "Settings", "Align", "Aligned". The noun "agreement" stays the held lane's. "journal" and "terms" in the end-date sense (shared/seatTerms.ts, role_holder_terms, SeatInput.termEnds) are untouched. SPEC §6b's unbuilt `alignment` slot is renamed `serves` in PR0.
2. **Open book gate.** One gate: a new capability `terms.read`, unlocked at the member rung, non-transferable, added through the five-edit checklist. `map.viewPeople` is never used for terms (it opens at the guest rung). No bespoke rung check exists anywhere.
3. **Public surfaces carry no terms.** Ballot titles and `doc_markdown` are as public as the governance module (GET /api/governance/ballots and /ballots/:id at index.ts:23776 and :23816 check no sign-in). They carry seat names and aims only: no amounts, no currency, no candidate name, no free text, no hash.
4. **No public events.** This feature makes no `recordEvent` call. recordEvent's audience is only `public | admin` and defaults to public (events.ts:41, :59, :77). The alignment row is the record; parties hear through notifications, which carry a link and the seat name only.
5. **Money is record only.** Every money line in the UI carries "Recorded here. Paid outside the platform." An import-boundary test keeps every ledger, economy, settlement, `role.cycle` and Contributor-promotion module from importing `shared/seatSettings.ts`.
6. **No payment details.** `parseSeatSettings` refuses any free-text field holding a run of 8 or more digits, or an IBAN or routing-number shape (economics ruling 23).
7. **Canonical bytes.** `canonicalJson` moves from server/lib/villageExport.ts:394 to `shared/canonicalJson.ts`. villageExport re-exports it. `agentTokens.canonical` is never used here. A test pins the bytes of a fixture.
8. **Ratchets.** server/index.ts may only shrink. Every new route lives in server/routes/*. Closers for new ballot subjects are exported from the route module and spliced into SUBJECT_CLOSERS through that module's exempt import and register line. Each PR runs `node scripts/check-server-index-size.mjs` before push. wizardConfig.ts sits at 988 of 1000: new wizard types get their own files. Profile.tsx sits at 887: new profile sections get their own files.
9. **Migration numbers.** Each number is claimed at build time by the four-way check: (a) `git ls-tree origin/main drizzle/`, (b) an ls-tree scan over every remote ref, (c) `gh pr list --state open` diffs touching drizzle/, (d) ledger section 27 and memory reservations (0222-0223 canvas lane, 0226 documents-export, 0228-0231 comms). Today the next free number is 0232. The numbers below are placeholders in order.
10. **CI gates per PR.** Every PR runs the gates read from the PR workflows, including module-intake stage 6 (`node scripts/validate-module.mjs --diff=origin/main`), check-admin-reach, the route-limits gate and the ratchets. A push to main is not a green.

## 2. Phased PRs

Each PR is CI-green alone and ships something a member can use or nothing a member can see. Order is the landing order. PR3 and PR7 may build in parallel once PR2 lands.

### PR0. Rename SPEC §6b slot (docs only)
- Files: design/SPEC.md (§6b `alignment` slot becomes `serves`).
- Tests: none. Governance doc restamp last.

### PR1. Settings model, presets, drawer and editor (no migration)
- New `shared/canonicalJson.ts`; server/lib/villageExport.ts re-exports it.
- New `shared/seatSettings.ts`: types, `parseSeatSettings`, `settingsWords`, `settingsHash`.
- New `shared/seatPresets.ts`: brand-neutral platform presets, shapes with blank amounts (section 3.1).
- New `client/src/components/power/SeatTermsDrawer.tsx` (read mode) and `client/src/components/governance/SeatSettingsEditor.tsx` (edit mode).
- New `client/src/components/governance/roleApplicationType.ts`: role_application moves out of wizardConfig.ts (988 to about 880 lines). It drops `commitmentPct`, `deferredPct`, `tokenSlug`, `tokenPerCycle` and the false tips at :276 and :284. Its Terms step becomes one `seatSettings` field. cashNote's sentence moves into the pay group's help. The proposal_drafts wizard_type stays `role_application`, so stored drafts keep loading.
- role_application's publish stays a practice vote in TypeCards until PR4 lands its route: the type stays out of CONDUCTABLE_TYPES, and a test asserts the publish button is locked.
- New `client/src/components/governance/WizardSeatPreview.tsx`: for a `source: "seats"` pick it draws SeatTradingCard in proposal mode with the drawer open, fed by the live answers. ProposalWizard picks the preview by pick source: roles picks get WizardRolePreview, seat picks get WizardSeatPreview. One card shows, never two. The 22rem grid at ProposalWizard.tsx:325 widens for either.
- Tests (node): validator accepts every preset; refuses digit runs, IBAN shapes, unknown groups, "voice" and "commitment %"; whole numbers only; an absent group reads "not set", never 0; preset merge copies (mutating the result leaves SEAT_PRESETS unchanged); `settingsHash` pinned to fixture bytes; R55 scan (shared/roleSheet.test.ts:455) still green, plus a control proving the drawer view model is a separate module; brand scan finds no village, person or currency name in presets; import-boundary test. Tests (jsdom): drawer renders nothing without props, trigger has aria-expanded and aria-controls, editor reset restores the preset, wizard publish locked.

### PR2. The `terms.read` capability (no migration)
- Five edits: shared/capabilities.ts (union, label, STAGE_UNLOCKS at member, TRANSFERABLE false), server/lib/capabilityRegistry.ts, and the remaining checklist sites.
- Nothing reads it yet. Ships alone; module-intake stage 6 run budgeted here.
- Tests: capability registry test; the rung test (guest lacks it, member holds it).

### PR3. Terms on offer, village presets, drawer on the live card (migration A)
- Migration A: `org_roles` gains `terms_offer json NULL`, `terms_offer_at datetime NULL`, `terms_offer_by varchar(64) NULL`. Expand only.
- `listOrgRoles` selects it. server/lib/seatProjection.ts gains a `terms` tier flag set when the viewer holds `terms.read`; `termsOffer` is attached only at that tier.
- Offers are written through the existing org-draft path: `update_seat` and `create_seat` accept `terms_offer` on human-sourced drafts only (orgDrafts.ts SEAT_FIELDS at :1266-1270 gains it; vendor and Saberra drafts are refused the field). Today that path publishes through admin (`isAdmin`); PR7 moves it to the power. OrgChartTab (admin, light-only by ruling) gets the SeatSettingsEditor in its light look, so check-admin-reach has a browser caller.
- Village presets live in the app_config plane: document `seat-presets` holding `{id: 'custom:<slug>', group, label, values, version, retiredAt}` rows, retired and never deleted. Read through GET /api/seat-presets (members only, in new server/routes/seatPresets.ts). Founding write is admin through the existing config editor. Amora's first village presets are Rick's 2026-09-30 figures (fixed monthly stipend, stipend range, honorary, in-kind or deferred), entered as data. Rye's personal card is never copied into a preset.
- Drawer hosts pass `settings` only when the viewer holds `terms.read`: Roles.tsx:302-308, Circles.tsx:433-437, MapSeatCard.tsx:52. ProposedSeatPreview on /review passes it when the draft carries `terms_offer`, with changed rows lit (G).
- Empty state for members: "No terms on offer yet." plus "Propose terms", linking to /propose?type=role_application&seat=<id> (and, after PR7, to "Propose a change").
- Tests: key-set tests for /api/org and /api/map at public, guest and member tiers (no `termsOffer` below member) with a positive control; vendor draft carrying `terms_offer` is refused; presets route answers 401 to visitors and guests; jsdom: hosts render no drawer for a visitor.

### PR4. The member door: apply for seats on terms (migration B)
- Migration B: `seat_applications` table and `org_role_assignments.application_id` (section 3.3).
- New server/routes/seatApplications.ts: POST /api/governance/role-applications, GET list and GET one (both `terms.read`), POST :id/adopt, POST :id/withdraw. Rate limited like `hand-to-village`.
- New server/lib/seatApplicationCloser.ts on the agreementCloser shape, exported from the route module and spliced into SUBJECT_CLOSERS through the exempt register line. `role_application` joins CONDUCTABLE_TYPES (proposalDrafts.ts:77-86), ballotSubjects SUBJECT_NOUN ("Who holds a seat, and on what terms") and its game-change kind.
- Raise-hand becomes one door: SeatAction sends a viewer holding `terms.read` to /propose?type=role_application&seat=<id>, prefilled with the seat and any terms on offer. Viewers without it keep today's inbox hand (POST /api/map/roles/:id/raise-hand), which records interest. Existing inbox rows stay as they are.
- New page client/src/pages/SeatApplication.tsx at /seat-applications/:id, members only: the card stacked, drawer open, the application's words, and the holder's adopt card.
- Tests: create validates through parseSeatSettings; example seat, full seat and over-capacity refused; ballot path when the village or nobody holds `org.seat`; holder path when a live holder does; **sole holder who is the candidate falls through to a ballot**; **a holder who is the candidate is refused at :id/adopt**; **the closer re-reads the stored row and re-checks free places at landing, holding (status `held-full`) when full**; a candidate already seated in the seat gets terms linked to the existing seating; doc_markdown and title for a role_application ballot carry no amount, currency, candidate name, note or hash, with a control fixture that carries all of them; withdraw while voting withdraws the ballot.

### PR5. The alignment store and the Align button (migration C)
- Migration C: `alignment_texts`, `alignment_parties`, `alignments`, `alignment_seals` (section 3.4).
- New server/repos/alignments.ts (insert only) and server/lib/alignmentSubjects.ts with the `seat_terms` adapter. New server/lib/alignmentErasure.ts, the one mutation site.
- PR4's create route now writes, in one transaction: the application, alignment text v1 (body rendered from seat names and settings words, salted hash), its parties, and the candidate's alignment row. The wizard Review step shows that exact rendered text; the button reads "Propose and align". The candidate never clicks twice.
- Adoption inserts the `village` row: `method holder` from the adopt click, or `method ballot` from the closer, which first checks the text's hash equals `seat_applications.text_hash`.
- POST /api/profile/alignments `{textId, contentHash}` for any other required party; refuses a hash mismatch and non-parties.
- When every required party has aligned: seal through `signDocument` when `canSign()`, otherwise mark it unsealed and seal later when the key appears; notify each party once (`alignment:<textId>:<partyKey>:in-force`).
- Profile: new `client/src/components/profile/AlignedSection.tsx`, a record-band section `aligned` after `journey` (sheetSections.ts:101-103), heading "What you have aligned with". Own profile shows pending, in force and ended rows with a receipt download. Another member's profile, for a viewer holding `terms.read`, loads the same list from GET /api/alignments?party=<handle> (members only; the profile route's publicView spread stays untouched). Visitors get nothing.
- /api/profile/export gains the member's texts, their own alignment rows and receipts. Counterparties appear as display name and capacity only.
- Erasure step (section 5) ships here with the tables.
- Tests: zero UPDATE or DELETE sites in the repo except alignmentErasure.ts (grep test); in-force derivation table test; hash mismatch refused; non-party refused; receipt verifies against `verifyDocument`; retention sweep never touches the four tables (it reads only submissionsRepo, index.ts:4442); no `recordEvent` call in any file this feature adds; erasure fixture test (section 5); export key-set test.

### PR6. The register
- New page client/src/pages/Aligned.tsx at **/aligned**, menu label "Aligned", members only, sign-in card for visitors, following the Decisions page (grouped by year, paging, no counts). Kinds: "Seat terms", later "Membership letter", and after #389 the lane's "Village agreement".
- Search: a per-request BM25 index built from knowledge.ts helpers (tokenize, indexDoc, rank) over rows the viewer may read. Never added to shelves, second-brain or the concierge corpus.
- Each row links to its adopting ballot or names the holder who aligned for the village. Every version is listed.
- Tests: 401 for visitors and guests; absence test proving the concierge corpus holds no terms, with a positive control; search ranks a money term for a member.

### PR7. Propose a seat with terms (governance-owned; no migration expected)
- Rye's ask is settings "on the role proposal". This PR opens it to every member, built on org_drafts so no third proposal table appears.
- `org.decide` capability through the five edits (key named in the 2026-09-14 ruling; transferable; held by stewards by default per that ruling).
- New wizard type in client/src/components/governance/seatProposalType.ts: "Propose a seat" or "Change this seat". Steps: Kind, Subject (new seat, or pick a seat), In your words (SEAT_FIELDS), Terms (SeatSettingsEditor writing `terms_offer`), Review (ProposedSeatPreview with the drawer open and changed rows lit).
- Members create member-authored org drafts limited to `create_seat` and `update_seat` through new server/routes/memberOrgDrafts.ts. A change whose base offer moved since writing is marked stale and never applied (G).
- Adoption by `whoMayPutHandToVillage(isVillageHeld('org.decide'), liveHoldersOf('org.decide'))`: a holder publishes live (no window, no veto) or sends it to a ballot; no holder means a ballot. New `org_draft` closer applies through `orgDrafts.applyChange` (one writer, its transaction and revert path). The admin publish route checks `org.decide` from here on, which retires the admin-only door for offers.
- Coordinate through ledger section 27: the Saberra and governance lanes own org.decide.
- Tests: member draft refused ops other than create and update; holder live publish; ballot path; stale base; vendor drafts still refused `terms_offer`; ballot doc has no terms (control fixture).

### PR8. Amend and end (migration D)
- Migration D: `alignment_endings` (section 3.4).
- Amend: a role_application with `supersedesId`, proposed by a party, adopted by the same power. On adoption it writes version n+1. Version n stays in force until n+1 is, then gets a `superseded` ending.
- Notice: POST /api/profile/alignments/:textId/notice writes a `notice` row with `effective_at = now + noticeDays`. The giver may withdraw it before it takes effect (`notice_withdrawn` row). Notice never unseats anyone; the org.seat holder or a ballot unseats through the existing doors.
- Mutual end: both parties click "End by agreement".
- term_end: derived; a daily read writes the row on the day for the record.
- Renewal: the one-moon term warning (every-seat-has-a-term ruling 5) links to a prefilled renewal application.
- Tests: notice keeps the text in force until `effective_at`; withdrawn notice; supersede during a running notice; an ended seating ends seat terms through the derivation, whichever door ended it.

### PR9. Village presets by power, membership letter
- "Propose a preset" and "Retire a preset" through the wizard, adopted by `whoMayPutHandToVillage` on `org.decide`. Admin founding write is removed.
- `membership` adapter: new Love Letter signings write an alignment text keyed by commitment version and an alignment row. TheSigning (ProfileJourney.tsx:172-188) moves into AlignedSection and uses `commitmentName`. Legacy signers stay where they are in the journey section and are never listed as alignments, because their rows hold no text or hash.
- Tests: retired presets hidden from the picker and kept in the document; membership alignment row written on signing.

### PR10. Village agreements (after #389 lands)
- See section 6.

## 3. Data model and migrations

### 3.1 Pure model (PR1)

`SeatSettings` v1. Every group optional; absent means "not set". Groups follow Rye's season card rows:

| Group | Fields |
|---|---|
| term | `endsOn` (YYYY-MM-DD, or null for season end; resolved by `resolveSeatTerm`, keeping the 2038 cap and the steward season cap), `noticeDays`, `reviewOn`, `renewalOn` |
| clocks | `pay`: `calendar-month` or `moon`; `work`: `moon` or `week` |
| rhythm | up to 6 `{label, weekday 0-6, time HH:MM}`, `quietDays[]`, `tz` (defaults to season.timezone) |
| pay (record only) | `kind`: none, fixed, range, honorary, in-kind, deferred; `currency` (ISO 4217, unknown flagged never blocked); `amountMinor`, `minMinor`, `maxMinor` (integers); `per`: month or moon; `note` up to 300 |
| allowance (record only) | `kind`: none, flat, reimbursed; currency, `amountMinor`, `per`, `note` |
| bonus (record only) | `kind`: none or equity; `capWords`; `ratedBy`; `cadence`. In words by default (decision 1) |
| quests | `perMoonMin`, `perMoonMax` (1-12), `agreedHow`, `doneWhenRequired` always true |
| scoreboard | up to 8 `{measure, readFrom, target}` in words; measures the work, never ranks people (R55 scan extended to these fields) |
| ending | `noticeDays`, `payThroughNotice` |
| presets | provenance `{group, presetId, presetVersion}` |

`parseSeatSettings(raw)` returns `{ok, settings, problems[]}` and is shared by editor and server. `settingsWords(settings, ctx)` gives each group a headline and lines. `settingsHash` is sha256 over `canonicalJson(settings)`, used only server side.

Platform presets (`shared/seatPresets.ts`), brand-neutral, shapes with blank amounts:
- term: until-season-end, three-moons, one-moon-trial
- clocks: pay-month-work-moon, all-moon
- rhythm: weekly-sync-plus-core-call, fortnightly, async-first
- pay: unpaid, honorary, fixed-monthly-stipend, stipend-range, in-kind-or-deferred
- allowance: none, flat-monthly, reimbursed
- bonus: none, rated-equity-in-words
- quests: three-to-five-done-when-by-consent
- scoreboard: starter measures in words
- whole: one preset per common seat shape that fills every group at once (G)

Village presets (PR3) carry amounts as village data in app_config `seat-presets`.

### 3.2 Migration A (PR3): terms on offer

```sql
ALTER TABLE org_roles
  ADD terms_offer json NULL,
  ADD terms_offer_at datetime NULL,
  ADD terms_offer_by varchar(64) NULL;
```

Plane: seat-scoped data beside the seat it describes, read through the one seat projection. `compensation_reality` stays admin-only as a private note; the drawer never shows it, and OrgChartTab labels it "Admin note, never shown to members".

### 3.3 Migration B (PR4): seat applications

```sql
CREATE TABLE seat_applications (
  id varchar(40) PRIMARY KEY,            -- 'sa-' + 16 hex
  candidate_user_id varchar(64) NOT NULL,
  proposed_by varchar(64) NOT NULL,      -- equals candidate in v1
  seat_ids json NOT NULL,                -- 1..5 org_roles ids; one package, money recorded once
  note text NULL,                        -- at most 2000
  deliverables text NULL,
  settings_json json NOT NULL,           -- never updated
  settings_hash char(64) NOT NULL,
  text_id varchar(40) NULL,              -- set from PR5 onward
  text_hash char(64) NULL,
  term_ends_at datetime NOT NULL,
  term_season_id varchar(64) NULL,
  term_follows_season tinyint NOT NULL DEFAULT 0,
  supersedes_id varchar(40) NULL,
  status varchar(20) NOT NULL,           -- awaiting-holder | voting | adopted | not-adopted | withdrawn | held-full
  adopted_via varchar(8) NULL,           -- holder | ballot
  adopted_ref varchar(64) NULL,          -- ballot id or holder user id
  authority_ref varchar(64) NULL,        -- 'org.seat@<role id>'
  decided_at datetime NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY (candidate_user_id), KEY (status)
);
ALTER TABLE org_role_assignments ADD application_id varchar(40) NULL;
```

Only `status`, `adopted_*`, `authority_ref`, `decided_at` and (by erasure) `note`, `deliverables` are written after insert. Raw SQL, never `dbCollection` (replaceAll resets omitted columns). Ballot: `subject_type 'role_application'` (16 chars, fits varchar(24)), `subject_ref 'sa-…'`; the term is frozen through the existing `seat_term_*` columns (0199).

Rye's own card fits one application: his three seats in `seat_ids`, pay, allowance and bonus recorded once.

### 3.4 Migrations C (PR5) and D (PR8): the alignment store

```sql
CREATE TABLE alignment_texts (
  id varchar(40) PRIMARY KEY,            -- 'at-' + hex
  subject_type varchar(24) NOT NULL,     -- seat_terms | membership | agreement
  subject_ref varchar(64) NOT NULL,
  version int NOT NULL,
  title varchar(200) NOT NULL,
  body mediumtext NOT NULL,              -- the exact rendered words shown
  settings_json json NULL,
  salt char(64) NOT NULL,                -- 32 random bytes, never served publicly
  content_hash char(64) NOT NULL,
  supersedes_id varchar(40) NULL,
  effective_from date NULL, effective_to date NULL,
  created_by varchar(64) NOT NULL, created_at datetime NOT NULL,
  redacted_at datetime NULL,             -- written only by alignmentErasure.ts
  UNIQUE (subject_type, subject_ref, version)
);
CREATE TABLE alignment_parties (
  text_id varchar(40) NOT NULL, party_key varchar(80) NOT NULL,  -- 'user:<id>' | 'village'
  user_id varchar(64) NULL, capacity varchar(120) NOT NULL, required tinyint NOT NULL,
  UNIQUE (text_id, party_key)
);
CREATE TABLE alignments (
  id varchar(40) PRIMARY KEY, text_id varchar(40) NOT NULL, party_key varchar(80) NOT NULL,
  user_id varchar(64) NULL, content_hash char(64) NOT NULL,
  intent_text varchar(300) NOT NULL,     -- the sentence beside the button
  method varchar(8) NOT NULL,            -- click | holder | ballot
  authority_ref varchar(64) NULL,        -- ballot id, or capability@role
  at datetime(3) NOT NULL,               -- set by the server
  UNIQUE (text_id, party_key)
);
CREATE TABLE alignment_seals (
  text_id varchar(40) PRIMARY KEY, receipt_json mediumtext NOT NULL, at datetime NOT NULL
);
-- Migration D (PR8)
CREATE TABLE alignment_endings (
  id varchar(40) PRIMARY KEY, text_id varchar(40) NOT NULL,
  kind varchar(16) NOT NULL,             -- notice | notice_withdrawn | superseded | mutual | term_end | party_left
  refers_to varchar(40) NULL,            -- the notice a withdrawal cancels
  effective_at datetime NOT NULL, recorded_by varchar(64) NULL, at datetime NOT NULL,
  KEY (text_id)
);
```

`content_hash = sha256(canonicalJson({salt, subjectType, subjectRef, version, title, body, settings, parties}))`. The salt stops anyone brute-forcing low-entropy money terms from a hash. The hash appears only in receipts and member pages.

**In force** is derived, never stored. A text is in force when every required party has an alignment row whose hash matches, today falls inside the effective window, no non-withdrawn ending has `effective_at <= now`, and, for `seat_terms`, at least one seating carrying its application id is open. The last condition means a seating ended by any door (admin end, draft revert, claim flows) ends the terms without each door writing a row.

**Receipt** (`alignment_seals.receipt_json`): the output of `signDocument` over `{textId, version, contentHash, parties, alignments}`. It holds the hash and party list, never the body, so redacting a body never breaks a seal.

Seat-terms parties: `user:<candidate>` (capacity "individually") and `village` (capacity "for the village").

### 3.5 Where each value lives

| Value | Plane | Why |
|---|---|---|
| Platform presets | shared/ code | brand-neutral shapes every village starts from |
| Village presets | app_config `seat-presets` | village config, retired never deleted |
| Terms on offer | `org_roles` columns | seat-scoped, projected with the seat |
| Applications | `seat_applications` table | a record with a lifecycle |
| Alignments | insert-only tables | the durable record |

## 4. The UI

### 4.1 The drawer on the live card
`SeatTermsDrawer` is passed to SeatTradingCard's existing `settings` slot (SeatTradingCard.tsx:87-88), which renders it in the `sheet-night` tray under the foil (:217-221). SeatTradingCard is not edited. The card face stays untouched and R55 stays green.

- **Trigger:** one `min-h-12` button, aria-expanded, aria-controls, ChevronDown. "Settings" with the sub-line "Terms for whoever holds this seat".
- **Body, styled as a stat sheet:** one row per set group in season-card order, each a headline from `settingsWords` with a small icon. Quests per moon show as pips (filled to the minimum, outlined to the maximum). Scoreboard measures show as named rows with their target in words. Each row opens on tap to its lines, the preset name and a "customised" mark. Money rows carry "Recorded here. Paid outside the platform."
- **Footer, one quiet line:** "Adopted by vote, 9 Oct 2026" or "Adopted by <holder>, 9 Oct 2026", linking to the ballot or the application.
- **Alignment state:** once in force, an "Aligned" seal stamp sits in the tray beside party chips ("Rye, aligned", "The village, aligned"). While pending, the chips fill as parties align.
- **Visitors:** the prop is not passed, so nothing renders.

### 4.2 The editor
`SeatSettingsEditor`, wizard field kind `seatSettings`. Each group is a collapsed row with its preset name, "Change" (opens a sheet of self-previewing preset cards: platform first, village second, retired hidden), "customised" and "Reset to preset". A "whole" preset fills every group in one pick. Amounts show the village currency, flagged and never blocked.

### 4.3 Wizard
- role_application ("Apply for a seat"): Kind, Subject (1-5 seats), In your words, Terms (prefilled from the first seat's offer, else platform defaults), Review (the card with the drawer open, then the exact words being aligned to). Publish reads "Propose and align".
- "Propose a seat" (PR7): same steps; preview is ProposedSeatPreview with the drawer open.
- Preview: WizardSeatPreview for seat picks, WizardRolePreview for role picks, on the rail, inline and on review.

### 4.4 Align button
`client/src/components/alignment/AlignButton.tsx`: one button "Align", with the sentence "I align with these terms for <seat names>." Version and fingerprint live in the receipt only. After the click: "You aligned on 9 Oct 2026". A holder who adopts sees "Align for the village". A holder who is the candidate sees "Your own terms go to the village to adopt." Appears in the drawer (parties only), on /seat-applications/:id, on the Decision page for members, and in the pending profile row.

### 4.5 Profile and register
AlignedSection (section 2, PR5) and /aligned (PR6). The night look uses semantic utilities only.

### 4.6 Copy
"align" wording throughout, never "sign". No dashes. Voice gates apply.

## 5. Privacy and erasure

**Who sees what**
- Members holding `terms.read`: every seat's offer, every application's settings and words, every party, every alignment and its date, every version.
- Signed-in guests and visitors: none of it. The drawer is not mounted, `termsOffer` is absent from public and guest projection tiers, and every new GET answers 401.
- Ballots: title "Who holds <seat names>", doc listing seats and aims and "Members read the application on its page." No candidate name, no free text, no amount, no hash.
- Notifications and email: seat name and a link only.

**Never stored:** payment details, IP address, user agent, typed names.

**Saberra:** terms never cross the bridge. `terms_offer` is refused on vendor drafts and absent from vendor payloads.

**Exit:** never blocked by terms. Leaving inserts a `party_left` ending (PR8; before PR8 the ended seating ends the terms through the derivation). The exit flow tells the member which terms ended.

**Erasure** (alignmentErasure.ts, the one exempt mutation site; runs after the tombstone, as the journal step does at erasure.ts:556-565):
1. `seat_applications.note` and `deliverables` set to NULL.
2. Alignment and party rows keep `user_id`; the user row is tombstoned in place by erasure.ts:506-527, so the record de-attributes without remapping ids.
3. The person's display name and handle are scrubbed from free text in `alignment_texts.body` and `settings_json`, `org_roles.terms_offer` and the `seat-presets` document, replaced with "a former member". A text whose words changed gets `redacted_at`; its hash and seal stay, and the other party's receipt still verifies against their own copy.
4. Under decision 2 option C, bodies of ended texts naming the person are replaced with "Removed at the request of a party".
- Test: an erasure fixture asserts the name and handle appear nowhere in the five tables, the offer column or the presets document, and that the seal still verifies.

**Export:** /api/profile/export gains the member's texts, own alignment rows and receipts; counterparties as name and capacity only.

## 6. Landing beside held #389

- **No shared noun or store.** Seat terms never use ballot subject `agreement`, the `agr-` id space, or the `village-agreement:<id>` document. The lane's markAgreement rewrites its document from 11 fields, so nothing of ours could live there anyway.
- **No composed lane closer.** The lane's execute calls addActivity, which records a public event with the title. Our closers are separate subjects with no activity.
- **Members gate.** The lane uses `mayReadCanvas`. This feature uses `terms.read`. When #389 lands, the lane owner may switch canvas reads to the capability; nothing here depends on that.
- **Shared hunks.** PR4 and the lane both add to CONDUCTABLE_TYPES (proposalDrafts.ts) and SUBJECT_CLOSERS (index.ts:22010 onward). Our closer arrives through a route-module register line, so the index.ts hunk is one exempt line. The lane's wizardConfig.ts diff is +6/-1 and PR1's move of role_application is a separate hunk. Record both touch points and the index.ts ratchet reservation in ledger section 27 before PR4 lands; the lane rebases over ours with a dry-run merge.
- **Register URL.** The register is /aligned. The lane keeps /agreements for its own page.
- **PR10, after #389 lands:** an `agreement` adapter copies the lane's stored title and body into `alignment_texts` at adoption (the lane document keeps no history). The agreementCloser gains one line calling `recordVillageAlignment(subjectRef, ballotId)`, which inserts rows only and records no activity. Members may align individually as non-required parties ("I align with this"). The register lists them as "Village agreement". Amendments of a village agreement are the lane's to design, because its settle() marks the whole agreement not-adopted on any failed ballot for its ref.

## 7. Defaults decided here

- Open book means the member rung, through `terms.read`.
- v1 applications are self-application only.
- `org.decide` adopts seat and offer changes and starts with stewards, per the 2026-09-14 ruling.
- Terms come into force when unsealed, marked "unsealed", and are sealed when the key appears.
- Terms never cross to Saberra.
- The register is /aligned.
- Legacy Love Letter signers stay in the journey section and are not listed as alignments.
- Leaving never waits on terms.
- Ballot titles name seats, never the candidate.
- `compensation_reality` stays an admin note.

## 8. Judge defects and their answers

| Defect | Answer |
|---|---|
| Members could only apply, never propose a seat with terms | PR7 member "Propose a seat" door on org_drafts |
| Offers edited only by admins | Offers ride org drafts, adopted by org.decide from PR7 |
| Library empty until late | Amora village presets with Rick's figures in PR3 |
| Hash, version and capacity shown beside the button | Moved to the receipt; one plain sentence |
| Too heavy, too many tables | Four tables at PR5, endings at PR8, presets in app_config, no seat_proposals or seat_presets table |
| Eleven questions for Rye | Four (section 9); the rest are defaults in section 7 |
| Other members' profiles empty | Members-only list on any profile in PR5 |
| Rye's card cannot be entered | One application over three seats; seats created through org drafts (section 10) |
| Muddled wizard preview | One preview chosen by pick source |
| Raise-hand twin door | Raise-hand opens the wizard for members |
| Twin canonicaliser | canonicalJson moved to shared/ |
| Two members gates | `terms.read` only |
| Claiming /agreements | Register at /aligned |
| Config planes unmapped | Section 3.5 |
| Lane ordering unstated | Section 6 |
| Dead publish in PR1 | Practice-locked until PR4, with a test |
| Untested self-dealing and capacity checks | In PR4's test list |
| `audience: 'members'` does not exist | No recordEvent at all; pinned by test |
| Public hash brute-forceable | Salted hash, never public |
| Free text and names in the public ballot | Ballot carries seats and aims only |
| Candidate aligned to unseen words | Text rendered and shown at Review; the click binds to its hash |
| Insert-only contradicts erasure | One named mutation file, exempt from the grep test |
| Tombstone remap | Keep ids; the user row is tombstoned in place |
| Retention claim unpinned | Test in PR5 |
| Freeze missed seats already held | Applications link terms to an existing seating |
| Endings blocked by UNIQUE | Many ending rows; notice withdrawable; effective ending derived |
| Seat ended by doors outside seatHolder | In force requires an open linked seating |
| Search leaking into shared corpora | Per-request index plus absence test |
| Rye's pay republished as a preset | Personal cards never become presets |

## 9. Decisions only Rye can make

1. **The equity bonus: words or a number?**
   (a) Words only, such as "up to a set share, rated monthly by funders". (b) A capped number in the bonus group.
   Recommendation: (a). A number reopens the 0156 ruling against numeric capital columns.

2. **After terms end and a party erases their account, what stays?**
   (a) Keep the words with the person de-attributed. (b) Keep only the hash, dates and parties; delete the words.
   Recommendation: (a) until counsel confirms what UETA/ESIGN and Costa Rican retention need for a paid role; the village is a party and its only copy is the stored words.

3. **One click, or one click plus a re-confirm when the terms carry money?**
   (a) One click always. (b) One click, plus the existing identity re-confirm (password or passkey, no typed name) when the text has pay, allowance or bonus and the last confirm is older than 15 minutes.
   Recommendation: (b). A stolen session cannot then align someone to money terms, and the route already sits under /api/profile where the confirm cookie works.

4. **Do platform presets carry Rick's amounts for every village?**
   (a) Shapes only for every village; Rick's figures as Amora's own village presets. (b) Rick's figures as platform-wide examples.
   Recommendation: (a). Figures are one village's economics and would read as a norm elsewhere.

## 10. Rye's own card, end to end

1. Admin (today) or any member (after PR7) creates the Anchor Circle and Rye's three seats through an org draft, each with a term.
2. Rye is seated through the existing holders route.
3. Rye opens /propose, "Apply for a seat", picks his three seats, picks the "whole" Amora preset or sets each group, and records pay, allowance and bonus once.
4. Review shows the exact words. "Propose and align" records his alignment.
5. If a live org.seat holder other than Rye exists, they open /seat-applications/:id and click "Align for the village". If Rye is the only holder, or the village holds the power, the village votes and the landed ballot countersigns.
6. The terms come into force on his three seatings, sealed, and appear in his profile's "What you have aligned with" and on /aligned for every member.
