# Maia's brain: two shelves, one village

Date: 2026-08-03
Status: specification, not yet built. Step 0 (retrieval) has shipped.
Revision 2, after an adversarial pass. Findings and their fixes are logged in
section 14 so a later session can see what was already considered.
Companion docs: `COORDINATION_SUBSTRATE.md` (the protocol argument this obeys),
`ARCHITECTURE.md` (the as-built system), `FORK_RUNBOOK.md` (provisioning),
`modules/*.md` (the module contracts, which become a shelf here).

This specifies what Maia knows, where it lives, how she writes, and what she is
never allowed to do. It is written so a session can build it without
re-deriving the argument.

---

## 0. The claim

Maia today is five hand-built prompts, each fed a different slice of state, over
roughly six of the platform's seventy-five tables. She cannot answer "what roles
do we need" because nothing in the database knows what the village is for, and
she cannot answer "should we turn on the library" because nothing reads the
module contracts that ship beside her.

The fix is two shelves and one write path:

- A **shared brain** that ReGen Civics controls, identical in every fork, pulled
  and versioned. Literature, module contracts, and patterns.
- A **village brain** that lives entirely inside one fork, never leaves it, and
  grows for as long as the village runs. What this village is for, and what it
  has said and decided since.
- One **draft-and-confirm** path so she can build the game with a founder
  instead of describing it, without ever writing to a domain table directly.

The authority rule from S70 generalizes and stays the spine: **what this village
said about itself outranks the literature.**

---

## 1. The two brains

### 1.1 The shared brain (ReGen controls, every fork inherits)

| Shelf | Source | Today |
|---|---|---|
| Literature corpus | `docs/knowledge/*.md` | 7 files, shipped, loaded at boot |
| Module contracts | 8 allowlisted files in `docs/modules/` | exist, shipped, **nothing reads them** |
| Platform notes | `module-framework.md`, `token-registry-ledger.md` | exist, shipped, unread |
| Patterns | `docs/patterns/*.md` | does not exist yet |

All shelves load through the same loader (`loadShelf()`), rank through the same
BM25 scorer, and carry the same authority: counsel, never evidence.

**Module contracts are the cheapest win in this document.** The files already
ship. Loading them is what turns "what does the exchange do, and should we turn
it on?" from a guess into an answer with a citation.

**The module shelf is an allowlist, never a directory glob.** `docs/modules/`
holds four files that are not module contracts, and two of them are
`CRITIQUE-architecture.md` and `CRITIQUE-economy.md`. A glob would let Maia
answer "should we turn on the exchange?" by quoting a critique of its design back
to a founder as though it described the product. Filenames also do not follow
module ids, which CLAUDE.md already warns about. So the shelf is a map:

```ts
const MODULE_DOCS: Record<string, string> = {
  map: "village-map.md",      exchange: "internal-exchange.md",
  feed: "gratitude-feed.md",  library: "material-library.md",
  health: "health-dashboard.md", tools: "tools-hub.md",
  badges: "badges.md",        stays: "stays.md",
};
```

When this was written, eight of the platform's then sixteen modules had a
contract. **Eight did not**: `quests`, `gratitude`, `progression`, `profiles`,
`forum`, `automation`, `network`, `commerce`. The platform has more modules
now, and the live map is `MODULE_DOCS` in `server/lib/knowledge.ts`; read it
rather than the snippet above. For a module with no contract she has the catalog
copy in `shared/modules.ts` (name, description, dependencies, capabilities,
variables) and nothing deeper, and she must say so rather than reason from the
modules that do have one. The catalog is always available for every module;
the contract is the deep layer for those that have one.
`crowdpool-dashboard.md` describes no shipped module and is excluded entirely.

**Patterns** are distilled operational counsel written by ReGen: "a village
under fifteen people that opens the exchange usually closes it within two
lunations." They are prose, hand-written, sourced. They are **not** telemetry and
they never contain another village's data.

**Retrieval is two stage: documents, then sections inside them.** Built and
verified in S72; the first draft of this spec said "index sections" and that was
measurably worse.

Corpus documents run 13 to 18 KB, roughly 3,500 to 4,500 tokens each, so
injecting two whole files costs about 9,000 tokens before the village's own
material is added. Sections fix that: splitting on `##` and `###` yields 42
literature sections (median 477 tokens, p90 1,590, max 2,282) and 125 module
sections. So the budget is stated in tokens, with the section count secondary:

- **2,500 tokens total** across the shared brain, authoritative
- at most **6 sections**, and at most **3 from any one document**
- **1,200 tokens per section**, truncated with a visible marker past that

But **ranking sections directly does not work.** Sections are small and
numerous, so one lucky term in a short section beats a document plainly about
the subject, and document-frequency statistics stop meaning anything. Measured:
`turn` appears in 2 sections and `exchange` in 27, so "should we turn on the
exchange?" answered from the health dashboard. So stage one ranks the 15
documents (big, topical, stable statistics), stage two ranks sections only
inside the two or three documents that won.

Three scorer properties are load-bearing, and each one was a real failure first:

1. **Identity beats mention.** A term in a document's key, title or heading adds
   three inverse-document-frequency units on top of BM25. BM25 saturates term
   frequency near 2.2x by design, so no number of body mentions can express
   "this document is named that", and `stays.md` (which discusses work-exchange
   quests) out-ranked `internal-exchange.md` for the word "exchange".
2. **Generic verbs must be stopwords.** Document frequency cannot tell a common
   verb from a technical term: `set` and `508c1a` each appear in exactly 5 of
   the 42 literature sections. Two attempts at a statistical rule failed before
   vocabulary fixed it. The stopword list now covers generic verbs and
   particles, and deliberately excludes domain words (`need`, `offer`, `hold`,
   `open`, `close`, `value`, `role`, `term`, `work`, `share`, `cycle`, `stage`).
3. **Plurals fold onto the collection's own vocabulary.** A question about
   "deposits" found nothing because `stays.md` writes "deposit". Variants are
   added only when some document already contains them, so generic stemming
   cannot mangle "process" into "proces". Stopwords never expand: `up` folding
   to `ups` (from "follow-ups") once let a question of pure function words pull
   in a section.

Tokenizing also emits a **compacted form** for punctuation-joined words, because
`508(c)(1)(A)` and `508c1a` are one term to a reader. It pays off on ordinary
words too: `co-op` now matches `coop`.

**Versioning.** Today a corpus improvement requires every fork to redeploy. The
shared brain becomes a signed, versioned pack a fork pulls on demand:
`GET /api/admin/brain/shared/check` reports the available version;
`POST /api/admin/brain/shared/update` fetches, verifies the signature, and
replaces the shelf. Files on disk stay the fallback so a fork that never pulls
still has a shelf. Deferred to phase 10; nothing else depends on it.

### 1.2 The village brain (fork-local, never leaves)

Two shelves inside one village, and neither is ever published, relayed,
federated, or crawled.

**The brief.** What this village is for. Seeded from the intake at provisioning,
completed by Maia in Session 0, kept current by conversation. One row per
section:

| Section | Default audience | Holds | Feeds |
|---|---|---|---|
| `aims` | member | what this project is trying to achieve | role and circle proposals, gap reads |
| `vision` | member | the long picture, the origin story | copy, quests, framing |
| `values` | member | what they will and will not trade away | tone, and the restraint rules |
| `language` | member | primary languages, the words they use | every string in the game |
| `land` | admin | acreage, water, structures, built vs planned | map, library, stays, quests |
| `people` | admin | named core members and what each carries | seat sizing, assignment proposals |
| `work` | admin | what has to happen weekly, seasonally, yearly | **the direct input for roles** |
| `decisions` | admin | which decisions exist, who holds each today | circles, domains, forum categories |
| `economy` | admin | currency, dues, rewards, kinds of exchange | tokens, cycle budget, exchange, commerce |
| `membership` | admin | how someone becomes a member, classes, cost | stages, progression, capability grants |
| `rhythm` | admin | meeting cadence, seasons, when work peaks | cycle length, scheduler, quest timing |
| `legal` | admin | entity today, jurisdiction, who holds title | legal counsel, the 508 warnings, commerce |
| `constraints` | admin | red lines, past failures, what she must never propose | **her safety rail** |
| `tools` | admin | what they use today and will keep | tools hub, integrations, what not to replace |

Audience is a column, not a convention. `people` names members and `legal` names
title holders; neither may render to a member because a markdown endpoint was
easier to write without a filter.

**The record.** What has happened since. Derived by a job from tables that
already exist, so most of it costs no new writing:

- human-edited call syntheses (`call_syntheses`, already the S70 second brain)
- forum decisions with recorded outcomes
- closed gratitude cycles and what settled
- mechanics proposals and their outcomes
- unmatched concierge queries, grouped by lunation (the demand sensor)
- module lifecycle changes and why
- accepted and rejected assistant drafts, with the rejection reasons

Record entries are derived, never authored, with one exception: a call synthesis
is authored and human-edited today and stays that way.

**Derived record entries are not trusted text.** Forum decisions and concierge
queries are member-written, so an attacker-influenced string reaches a village
shelf. Derived entries are fenced in the prompt like any untrusted content
(section 8.1) and can never reach `status='confirmed'` without a human act.

### 1.3 Authority order

Every prompt that consults more than one shelf states this order, and Maia cites
which one each recommendation came from:

1. **Live state.** What is actually true right now (section 4).
2. **Confirmed brief sections.** What the village said it is.
3. **The record.** What the village has said and decided since.
4. **The shared brain.** Literature, module contracts, patterns. Counsel only.

Proposed (unconfirmed) brief sections rank **below the record**. They are her own
drafts, and a draft of hers must never outrank a human's word.

**Live state outranks the brief on facts, and the brief outranks live state on
intent.** The brief says what the village is trying to be; the tables say what it
currently is. A brief that says "three circles" against seven live circles is not
an error to resolve silently.

**Drift is a feature.** When a confirmed brief section contradicts live state,
she says so: "your brief describes three circles and the game has seven; is the
brief stale, or did the structure grow past the plan?" That question is the main
mechanism that keeps the brain true, and it costs nothing to implement because
both sides are already in her context.

---

## 2. Storage: MySQL is authority, markdown is the interface

The village brain is rows. The markdown is rendered from those rows on read.
Two reasons the file is not the source of truth: MySQL is the only authority in
this system (`ARCHITECTURE.md` section 2), and a single file that gets rewritten
is the brochure-that-overwrites-itself failure the never-build list already names
for the org-chart JSON.

### 2.1 Schema (`drizzle/0052_village_brain.sql`)

Two tables, because the two shelves have opposite cardinality. The brief holds
exactly one live row per section. The record holds many rows per section, one per
call or decision or lunation. A single table cannot carry both constraints, and
trying makes the unique key either wrong or absent.

```sql
CREATE TABLE IF NOT EXISTS `village_brief` (
  `id` varchar(64) NOT NULL,
  `section` varchar(64) NOT NULL,
  `title` varchar(200) NOT NULL,
  `body` mediumtext NOT NULL,
  `audience` enum('admin','member') NOT NULL DEFAULT 'admin',
  `source` enum('intake','session0','conversation','admin') NOT NULL,
  `status` enum('proposed','confirmed') NOT NULL DEFAULT 'proposed',
  `confirmed_by` varchar(64) NULL,
  `confirmed_at` timestamp NULL,
  `is_example` tinyint(1) NOT NULL DEFAULT 0,
  `revision` int NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `brief_section_uq` (`section`),
  KEY `brief_status_idx` (`status`, `audience`)
);

CREATE TABLE IF NOT EXISTS `village_brief_revisions` (
  `id` varchar(64) NOT NULL,
  `brief_id` varchar(64) NOT NULL,
  `revision` int NOT NULL,
  `body` mediumtext NOT NULL,
  `source` varchar(32) NOT NULL,
  `replaced_by` varchar(64) NULL,
  `replaced_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `brief_rev_uq` (`brief_id`, `revision`),
  KEY `brief_rev_idx` (`brief_id`, `replaced_at`)
);

CREATE TABLE IF NOT EXISTS `village_record` (
  `id` varchar(64) NOT NULL,
  `section` varchar(64) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `title` varchar(200) NOT NULL,
  `body` mediumtext NOT NULL,
  `period` varchar(32) NULL,
  `occurred_at` timestamp NULL,
  `source` enum('call','decision','cycle','mechanics','concierge','module','draft') NOT NULL,
  `source_ref` varchar(64) NULL,
  `status` enum('proposed','confirmed') NOT NULL DEFAULT 'proposed',
  `is_example` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `record_slug_uq` (`slug`),
  KEY `record_rank_idx` (`section`, `occurred_at`),
  KEY `record_dedupe_idx` (`source`, `source_ref`)
);
```

Notes that are load-bearing:

- `UNIQUE KEY (section)` on the brief sits on one NOT NULL column. **Not** a
  `superseded_at IS NULL` scheme: MySQL unique indexes exempt NULLs, so that
  admits infinite live rows per section, which is the house trap that has already
  cost this repo a session.
- `revision` increments on every overwrite and the prior body appends to
  `village_brief_revisions` in the same transaction. It also serves as the cache
  key (section 2.2), because MySQL `timestamp` has second granularity and two
  writes in one second would otherwise share an ETag.
- `slug` is generated server-side from `[a-z0-9-]` only, never from user text.
  It is the export filename, and a filename built from typed input is a path
  traversal waiting for someone to notice.
- `(source, source_ref)` lets the derivation job be idempotent. Re-running it
  must not duplicate a decision.

The same migration adds provenance to events, which the substrate doc has been
asking for and which cannot be backfilled:

```sql
ALTER TABLE `health_events`
  ADD COLUMN `actor_kind` enum('human','agent','system','peer') NOT NULL DEFAULT 'human',
  ALGORITHM=INSTANT;
```

`ALGORITHM=INSTANT` is not decoration. Migrations run at boot and fail loud, so a
copying ALTER on the event spine holds a village offline for as long as it takes.
If the server's MySQL refuses INSTANT, the migration must fail rather than
silently fall back to a copy.

Migration-file discipline, restated because it has bitten twice: `--` comments go
on their own lines and never end with `;`, and a shipped migration file is never
edited. Fix forward with a new file.

### 2.2 `is_example`, precisely

The repo ships standing examples so a fresh admin screen is not blank, and the
brain needs the same. The rule is narrower than elsewhere:

**Example brain rows render in the admin editor and appear in NO prompt and NO
markdown render, ever.** Not fenced, not labelled, absent. A fixture cited under
"what this village said about itself" is the exact failure the S70 comment
already guards against for `call_syntheses`, and the brain is the shelf where it
would do the most damage.

### 2.3 The markdown render

Rendered from rows on read, filtered by the viewer's audience, with an ETag over
`SUM(revision)` plus row count so repeat reads are free and two writes in one
second cannot collide. No file on the `data/` volume: a mirror on disk is a
second copy that drifts, and the handoff export builds the folder on demand.

```
GET /api/village/brain.md            everything the viewer may see, one document
GET /api/village/brain/index.md      the map, and what is still blank
GET /api/village/brain/<section>.md  one section
GET /api/village/brain/export.zip    the folder, for handoff (admin only)
```

Each section renders with frontmatter, so any LLM reading it knows how much to
trust it without being told:

```markdown
---
section: work
status: confirmed
source: session0
confirmed_by: rye
updated_at: 2026-08-14T09:22:00Z
---
# What has to happen here

Water lines get walked every Monday...
```

`index.md` is the always-in-context document, capped at 400 tokens. It lists
every **brief** section with its status, including the blank ones, and rolls the
record up to a count per section plus the three most recent titles. Listing every
record entry would blow the cap within a year of ordinary use.

**The blanks are load-bearing**: an index that says `membership: not yet written`
is what lets Maia raise it unprompted six weeks later.

### 2.4 Access for other LLMs

A revocable, read-only **brain token**, issued in Admin, bound to a member id,
listed with last-used. It reads the same endpoints and grants **no capability of
its own**: the request is evaluated against that member's real capabilities
through `hasCapability`, exactly as an HTTP session would be. A token that
carried its own scope key would be a second permission system, which is on the
never-build list, so it carries none.

This is the same mechanism `COORDINATION_SUBSTRATE.md` section 4.7 specifies for
MCP. Build it once and the MCP mount inherits it.

---

## 3. The intake, and what it must now capture

The apply form at `regencivics.earth/custom-games/apply` has 12 sections and 15
required answers, and Sylva walks the same fields conversationally. It captures
identity and intent well: vision, origin story, values, personas, decision style,
money flow, recognition, the pain, ranked priorities, currency, dues, team
capacity, brand, timeline, hosting, providers, needs and offers.

It does not capture the operational substrate that role, circle and quest
proposals are made of. Nine gaps, mapped to the brief sections they fill:

| Gap | Brief section | Without it |
|---|---|---|
| The work of the place | `work` | Roles are generic templates. The largest gap |
| Named people and current load | `people` | Seats cannot be sized or assigned |
| Land and asset inventory | `land` | Map, library, stays and quests seed from nothing |
| Which decisions exist, who holds each | `decisions` | Circles are generic |
| Rhythm and seasonality | `rhythm` | Cycle length and quest timing are guesses |
| Membership reality and classes | `membership` | Governance rights attach to class in this model |
| Guests and outside traffic | `land`, `membership` | Stays cannot be justified or refused |
| Legal entity today | `legal` | The 508 warnings arrive after the mistake |
| Red lines and past failures | `constraints` | She has no safety rail |

Plus two small ones: **primary language** (the form never asks, and Amora is
bilingual across two countries) and **tools they will keep** (so she knows what
she sits beside, and does not try to replace the WhatsApp group).

### 3.1 What goes on the form, and what waits

The form's job is to qualify and to produce the Blueprint. Adding nine sections
costs conversion and most of this is not qualification material. Split by job:

**Add to the apply form (five fields).** Each one changes the Blueprint:

1. **The work.** Required, textarea. Section 5.
   > *What has to happen on your land, week to week and season to season?*
   > *A rough list is fine: the watering, the animals, the bookkeeping, the guest*
   > *who arrives on Tuesday. This is what your roles get built from.*
2. **Your core people.** Required, repeatable name plus one line. Section 9,
   beside the existing team-size question.
   > *Name the people already carrying this, and what each one carries. Three*
   > *names is a real answer. We size the game to the people you have, never to*
   > *the org chart you wish you had.*
3. **Legal entity today.** Required, short text plus jurisdiction. Section 3.
   > *What exists on paper right now, and where? Who holds the land title?*
   > *"Nothing yet" is a fine answer.*
4. **Primary language.** Required, select plus other. Section 2.
   > *What language does your community actually coordinate in? If more than one,*
   > *which comes first?*
5. **Red lines.** Optional, textarea. Section 5.
   > *What must this never become? Anything that has already failed here, or*
   > *anything you have watched fail elsewhere and refuse to repeat.*

**Everything else is Session 0.**

### 3.2 The seed handoff

Intake answers are captured at ReGen and transit ReGen once, at provisioning. The
provisioning step writes them into `village_brief` as `source='intake'`,
`status='proposed'`. From that write forward the brain is the village's, and
ReGen keeps no live copy and has no read path into it.

Founders confirm each seeded section in Session 0. An unconfirmed section is
still usable and still ranks, one rung below the record, and Maia says out loud
that she is working from the application rather than from anything they have told
her since.

### 3.3 Session 0, scoped

`COORDINATION_SUBSTRATE.md` puts "an onboarding wizard that asks a village to
configure before it has used anything" on the never-build list, and a fourteen
section interview is close enough to that to need an explicit boundary.

**Session 0 asks about the world, never about the software.** Their land, their
people, their week, their red lines. No module choices, no variable values, no
lifecycle decisions. Those come later, after they have used the thing, and they
arrive as her suggestions rather than as questions they must answer to proceed.

**The minimum viable brain is three sections**: `work`, `people`, `constraints`.
Those three unblock role and circle drafting, seat sizing, and her safety rail.
Session 0 targets those and stops. Everything else fills opportunistically over
weeks, prompted by the blanks in `index.md` when a conversation touches them.

A founder must be able to leave Session 0 at any point with a usable game. It is
a conversation she resumes, never a gate they have to clear.

---

## 4. The reader registry: live state, gated once

Maia never writes SQL and is never handed a schema. She calls named readers.

The reason is not tidiness. Every consent gate in this system lives in Express,
not in MySQL: `requireModule()`, `hasCapability()`, badge denies, `is_example`,
and the rule that `feedback_items.submitted_by` never leaves the village. A model
that composes SQL has admin over all of it by construction.

### 4.1 The contract (`server/lib/villageReaders.ts`)

```ts
export interface VillageReader {
  key: string;                    // "seats.vacant"
  describe: string;               // one line, shown to the model as a tool
  module?: string;                // must be non-off (reuses requireModule logic)
  requiresVar?: string;           // a game variable that must also be on
  capability?: Capability;        // reuses shared/capabilities.ts, the ONE gate
  audience: "public" | "member" | "admin";
  maxTokens: number;              // hard cap on the serialized result
  read(ctx: ReaderCtx): Promise<unknown>;
}
```

The catalog handed to the model is filtered by the viewer's real capabilities,
computed by `capabilityCtx` plus `hasCapability`, the same call the routes make. A
reader the viewer cannot use is not described to her, so she cannot offer it and
then fail. `requiresVar` exists because module state is not always the whole gate:
the concierge is off unless `map.concierge_enabled` is true, whatever the map
module's lifecycle says.

### 4.2 The initial set

| Key | Module | Also requires | Audience |
|---|---|---|---|
| `village.identity` | core | | public |
| `modules.state` | core | | admin |
| `roles.all` | progression | | member |
| `seats.vacant` | map | | member |
| `circles.all` | map | | member |
| `members.summary` | core | | admin |
| `quests.library` | quests | | member |
| `cycle.current` | gratitude | | member |
| `ledger.supply` | core | | admin |
| `badges.all` | badges | | member |
| `concierge.gaps` | map | `map.concierge_enabled` | admin |
| `governance.recent` | forum | | member |
| `launch.status` | core | | admin |
| `variables.changed` | core | | admin |
| `brain.index` | core | | admin |

`members.summary` returns counts and the stage distribution, never a roster.
Naming members is `map.viewPeople`, which has its own gate, and a reader must not
be a way around it.

Fifteen readers is the whole initial set on purpose. The substrate doc is blunt
that analytics over 24 roles and eight people is "astrology with a dashboard";
these exist to ground her answers, not to become a reporting surface.

### 4.3 One registry, two consumers

The same registry backs the `/mcp` mount in `COORDINATION_SUBSTRATE.md` 4.7.
Build it once. "Read-rich, write-narrow" then holds in one file, and "making the
MCP server a second permission system" stays on the never-build list by
construction instead of by discipline.

---

## 5. The write path: drafts, never domain tables

### 5.1 Schema (`drizzle/0053_assistant_drafts.sql`)

```sql
CREATE TABLE IF NOT EXISTS `assistant_drafts` (
  `id` varchar(64) NOT NULL,
  `batch_id` varchar(64) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `payload` json NOT NULL,
  `rationale` text NOT NULL,
  `cites` json NULL,
  `status` enum('proposed','accepted','rejected','superseded') NOT NULL DEFAULT 'proposed',
  `proposed_by` varchar(64) NOT NULL,
  `proposed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `capability_ceiling` json NOT NULL,
  `escalations` json NULL,
  `decided_by` varchar(64) NULL,
  `decided_at` timestamp NULL,
  `decided_note` text NULL,
  `created_ref` varchar(64) NULL,
  PRIMARY KEY (`id`),
  KEY `drafts_queue_idx` (`status`, `kind`, `proposed_at`),
  KEY `drafts_batch_idx` (`batch_id`)
);
```

### 5.2 The kinds, in build order

| Phase | Kinds |
|---|---|
| 1 | `role`, `circle` |
| 2 | `brief_section`, `quest`, `badge` |
| 3 | `variable`, `module_lifecycle`, `tool`, `forum_category`, `library_category` |

`brief_section` is how Session 0 and every later conversation writes into the
brain. One review queue for structure and for understanding, which means one
habit for the founder instead of two.

It is also the correction affordance. When Maia cites a brief section and the
founder says it is out of date, that reply becomes a `brief_section` draft in the
same turn. Correcting her must be as cheap as contradicting her, or the brain
goes stale exactly where it is most confidently wrong.

### 5.3 Validation, in three layers

1. **Kind allowlist**, server-side, in `shared/draftKinds.ts`. A free-string kind
   is refused. The wire carries no open vocabulary here, same rule as
   `SHARED_ITEM_TYPES`.
2. **Payload schema per kind**, validated at draft time and again at accept. The
   model's output is untrusted input.
3. **The capability ceiling and the escalation list.**

A `role` payload's `capabilities` array must be a subset of `ALL_CAPABILITIES`,
and a subset of what the proposing member holds. That much is straightforward.

The part that took a second pass: **the ceiling is vacuous against an admin.**
`hasCapability` short-circuits to `true` for `isAdmin`, and the draft queue is
admin-gated, so "subset of what the accepter holds" permits everything for every
accepter who can reach the queue. The rule as first written protected nothing.

What actually protects the village is making escalation visible and per-item:

- At draft time the server computes `escalations`: every capability in the
  payload that **no existing role already grants**.
- The review UI renders each escalation as its own checkbox with its own plain
  sentence ("this role could hide forum posts", "this role could post token
  prices and stock the treasury"). One Accept button for a role that quietly
  carries `exchange.manage` is how this goes wrong.
- Accepting with any escalation unchecked strips that capability from the created
  role. It never fails silently and never grants what was not ticked.
- The accept event records the escalations that were granted, with
  `actor_kind='agent'` on the proposal and the human on the accept.

`roles.capabilities` is a JSON column and roles are the platform's appointment
mechanism. Without per-capability confirmation, "Maia, write me a role for the
water steward" is a plausible path to `forum.moderate`, `exchange.manage` and
`proposal.decide`.

### 5.4 Accept runs the existing path

Accepting a draft calls the same creation function the admin form calls. No
second write path, no bypassed invariant, no re-implemented validation. The draft
row records `created_ref` so a bad accept is traceable to its proposal.

`module_lifecycle` drafts carry two extra rules:

- A draft may propose at most `preview` for any module with `legalReview: true`
  (`stays`, `exchange`, `commerce`). The caution card, its version stamp and
  `acceptedBy` stay a human act, server-stamped, and Maia has no path to them.
- Accept routes through the existing lifecycle setter, so hard dependencies, boot
  demotion and `openStateCheck` all still refuse what they already refuse.

### 5.5 Restraint, enforced and not merely requested

`COORDINATION_SUBSTRATE.md` puts "seeding aspirational structure" on the
never-build list, and is specific about Amora's own 24 role cards with mostly
empty seats. A conversational role generator is a machine for producing exactly
that, faster.

Three rules:

1. Maia is given the member count and the named people from `people`, in every
   drafting prompt.
2. A single batch may contain at most `max(3, N)` `role` drafts, where **N is the
   number of accounts holding a stage at or past `member`, excluding examples**.
   Past that the endpoint refuses and tells her to prioritize. An admin can raise
   it for one batch, explicitly, and the override is recorded on the batch.
3. She is instructed to propose the fewest seats that cover the stated aims, to
   name which aim each seat serves, and to say plainly when a village is being
   asked to hold more structure than it has people for.

Rule 2 needs Rye's sign-off on the formula. It is a product judgment about how
much structure a village should be offered at once, and the right number may be
lower than the member count rather than equal to it.

---

## 6. Her modes

One engine (`server/lib/assistant.ts`), one mode table. Today's five call sites
each re-implement the key check, the rate limit, the daily cap, message
validation, JSON parsing and error handling, and they have already drifted.

| Mode | Audience | Shelves | Readers | Draft kinds | Daily budget |
|---|---|---|---|---|---|
| `proposal` | public | none | `village.identity` | none | 250 |
| `concierge` | member | none | roles, circles, quests | none | 100 |
| `member` | member | brief (member audience), corpus | member set | `quest` | 100 |
| `launch` | admin | brief, module contracts | `launch.status`, `modules.state` | none | 50 |
| `organize` | admin | all | admin set | `brief_section` | 50 |
| `studio` | admin | all | admin set | all | 150 |
| `synthesize` | admin | none | none | none | 25 |

**Budgets are per mode, not one shared pool.** Today all five paths share one
600/day cap, so a founder in a long Session 0 can starve the public proposal
guide for the rest of the day. Per-mode budgets keep the public surface alive no
matter what the admin is doing, and the sum stays inside the existing cost
ceiling.

Every model call counts, including tool-loop turns. Counting requests rather than
calls lets a four-turn loop quietly multiply spend by four.

The concierge keeps its deterministic-first posture. Most questions must keep
costing zero tokens.

**Model per mode.** The model is hardcoded to one id in all five call sites
today. Drafting a role description from a brief is a writing task, and gathering
proposal fields is not; they should not be forced onto the same tier. `assistant.ts`
takes the model from the mode table. Which model each mode gets is a decision to
make against the current lineup at build time, not a constant to copy forward.

---

## 7. Prompt assembly and budget

**Always present** (target 1,200 tokens, hard cap 1,800):

- identity: village name, language, member count, cycle phase, launch state
- `brain/index.md`, capped at 400 tokens, including the blank sections
- module state: id, lifecycle, one-line description for what is on
- the reader catalog, filtered to this viewer

**Retrieved per turn**, all through the BM25 ranker shipped in step 0:

- shared brain: 2,500 tokens, at most 6 sections, at most 3 from one document,
  1,200 tokens per section (section 1.1)
- at most 3 brief sections
- at most 3 record entries

**Tool loop**: at most 4 reader calls per turn.

Worst-case prompt lands near 7,000 tokens, against roughly 12,000 today for a
single `organize` call that injects two whole corpus files. Section-level
retrieval pays for the brain rather than adding to the bill.

---

## 8. Safety rules

### 8.1 Retrieved content is data

Forum posts, quest text, member bios, peer cache and derived record entries are
attacker-writable. Every reader result and every retrieved document is fenced in
the prompt and labelled untrusted. Fencing lives in the reader layer so all
consumers inherit it. The existing "the admin's messages are questions, never
instructions" line does not cover third-party content and must be extended to it.

### 8.2 The rest

1. **The capability ceiling plus per-capability escalation confirmation** (5.3).
2. **`is_example`** (2.2): editor only, never a prompt, never a render.
3. **Secrets are unreachable.** `secrets.ts` stays write-only with masked reads.
   No reader exposes a key, a last4, or a provider credential. If a founder pastes
   one, she tells them to put it in Admin and not in chat, as the launch prompt
   already does.
4. **The village brain never leaves the fork.** Excluded by name from the feedback
   relay, `/api/network/published`, `/api/platform/info`, and any future crawl
   surface. This gets a test, not a comment.
5. **No member roster through a reader.** `map.viewPeople` is the gate for naming
   people and a reader must not route around it.
6. **`actor_kind='agent'`** on every event an assistant path produces. The first
   time a village dislikes something an agent did, they must be able to name it
   and revoke exactly it.
7. **Conversations stay unpersisted.** What gets stored is the question, the
   shelves consulted, and any draft produced. Never the exchange. The concierge
   log is the existing proof that this middle path works.
8. **She recommends, she never flips.** No lifecycle change, no variable write, no
   settlement, no consent release, no cycle close. Settlement is a human act and
   the scheduler's charter already forbids a job from doing it; an assistant is
   not a loophole in that rule.

---

## 9. Build order

Each phase ships useful alone.

| Phase | What | Status |
|---|---|---|
| 0 | BM25 retrieval, whole-archive ranking, regression tests | **done** (S71) |
| 1 | Two-stage retrieval, section indexing, module contracts as a shelf | **done** (S72), 50 tests |
| 2 | `village_brief` + revisions + `village_record` + `actor_kind`, markdown render, `index.md` | **done** (S74), 18 tests. Routes: read, write, confirm, and `GET /api/village/brain` as markdown |
| 4 | Reader registry, gating, fencing, token caps | **done** (S73), 18 tests, wired at boot through the same `effectiveLifecycle`/`boolVar` the routes use |
| 6 | Drafts: `role` and `circle`, escalation, restraint cap | **done** (S75), 23 tests. Queue, accept with per-capability escalation, reject with a reason |
| 7 | Studio mode: brief plus live state plus drafting, with the restraint bias | **done** (S77). `brief_section` drafts still open, so conversation cannot yet write the brief |
| 11 | The borrowed platform key | **done** (S76). Env-only, its own allowance, and a launch item that flags a handoff on a borrowed key |
| 5 | `assistant.ts`: one engine, mode table, per-mode budgets, borrowed key | **done** (S76), 39 tests. 4 of 5 call sites migrated; `synthesize` left alone on purpose (its queue backpressure and error sentences are load-bearing and it runs once per recording). Tool loop still open |
| 3 | Intake: five new fields, and the provisioning seed writer | open, needs Rye (different codebase) |
| 12 | **Admin screens** for the brain editor and the draft queue | **open, and it is the gap that matters.** Every route exists and is tested; no screen calls them. The escalation checkboxes are the safety design of the whole write path and they are server-side only until this ships |
| 7 | Session 0 studio mode, scoped to the minimum viable brain | open, depends on 3 and 6 |
| 8 | Record derivation job. Concierge gaps and decisions into the brain | open, depends on 2 |
| 9 | `org_role` first, then `quest`, `badge`, `variable`, `module_lifecycle` | open, depends on 6. **`org_role` is now the important one**, see 14.0.2 |
| 10 | Shared-brain versioning and pull. Brain token. Patterns shelf | open, depends on 1 |
| 11 | The borrowed platform key (12.1) | open |

The three libraries landed before their routes on purpose: each one carries the
rule it protects, and a rule with a test is worth more than a route without one.
Wiring is mechanical and reviewable; the gates are not.

Phase 2 is the keystone. Phases 1 and 4 are independent of it and can run in
parallel.

---

## 10. Acceptance

Beyond the five gates, each phase carries a test that fails loudly if the rule it
protects is removed.

| Rule | Test |
|---|---|
| Escalated capabilities need per-item confirmation | accept a role draft carrying `exchange.manage` with that box unchecked; assert the created role does not hold it |
| A draft never writes a domain table | assert `roles` count is unchanged while a draft sits proposed |
| The brain never leaves the fork | assert no brief or record field appears in the relay payload, `/api/network/published`, or `/api/platform/info` |
| A legalReview module cannot pass `preview` by draft | propose `public` for `exchange`; expect refusal |
| One live row per brief section | insert twice for `aims`; expect the unique key to refuse |
| The record admits many rows per section | insert three `call` entries; expect all three to live |
| Derivation is idempotent | run the job twice over one decision; expect one row |
| A reader respects module state and its variable | `concierge.gaps` with `map.concierge_enabled` false is absent from the catalog and refuses when called |
| Audience filtering holds | render `brain.md` as a member; assert `people` and `legal` are absent |
| Fresh fork behaves | empty brain: `index.md` lists every section blank, and she opens Session 0 rather than inventing |
| The batch cap holds | request 12 roles for a 4-member village; expect refusal with a prioritization prompt |
| `is_example` discipline | seed an example brief row; assert it never appears in a prompt or a render |
| Per-mode budgets isolate | exhaust the `studio` budget; assert `proposal` still answers |
| Prompt budget holds | assemble a worst-case `studio` prompt; assert it lands under 8,000 tokens |

### 10.1 Adoption signals, tracked without thresholds

The substrate doc warns against confusing shipped with adopted. Four numbers,
read per lunation, with no target attached:

- drafts accepted over drafts proposed
- brief sections confirmed by someone other than the founder
- brief sections still blank after four lunations
- Session 0 conversations resumed at least once

A high accept rate is not automatically good. It may mean she is useful, and it
may mean nobody is reading before clicking. The rejection reasons are where the
truth is.

---

## 11. Handoff breakdown

| Item | Who | Why |
|---|---|---|
| Migrations 0052, 0053 | Claude Code | new files, never edits a shipped one. Renumbered from 0049/0050 once main claimed 0049 through 0051; they had only ever run against scratch schemas |
| `villageBrain.ts`, `villageReaders.ts`, `assistant.ts`, `drafts.ts` | Claude Code | |
| `loadShelf()` generalization and section indexing | Claude Code | |
| Markdown render, endpoints, export | Claude Code | |
| Admin UI: brain editor, draft queue with escalation checkboxes, brain tokens | Claude Code | |
| Tests for every rule in section 10 | Claude Code | |
| Record derivation job | Claude Code | |
| **Intake form changes on regencivics.earth** | **Rye** | different codebase, not this repo |
| **The provisioning seed step** | **Rye** | runs at fork creation, outside this repo |
| **Writing `docs/patterns/*.md`** | **Rye** | editorial judgment, not code |
| **Module contracts for the eight modules that have none** | **Rye** | editorial; Claude Code can draft, Rye owns what ships |
| **The ReGen signing key for shared-brain packs** | **Rye** | key custody |
| **The four decisions in section 12** | **Rye** | product judgment |
| Railway deploy and env vars | Rye | per FORK_RUNBOOK |

---

## 12. Open decisions for Rye

1. ~~The API key on a fresh fork.~~ **Decided (Rye, 2026-08-03): a borrowed
   platform key, opt-in per deployment.** See 12.1.
2. **The restraint formula** (5.5 rule 2).
3. **Which model each mode gets** (section 6), decided against the current lineup
   at build time.
4. **Whether `values` and `aims` render to members.** Specced as member-visible.
   Some villages will want their aims public on the site; others will not.

### 12.1 The borrowed platform key

Every assistant path returns 503 without `assistant_api_key`, and the sales page
promises AI features cost nothing until the founder adds their own. Session 0 is
the demonstration of this whole feature and cannot sit behind a key a founder may
not have on day one.

**Resolution.** A deployment may fall back to a ReGen-provisioned key, and the
fallback is off unless someone with Railway access turns it on. Amora has it for
testing and demos. A future fork gets it only when Rye enables it, which is the
case when they are paying for the service tier.

Six rules, all load-bearing:

1. **The founder's own key always wins.** `assistant_api_key` from `secrets.ts`
   is checked first. The moment a founder adds theirs, borrowing stops, with no
   admin action and no restart.
2. **The fallback is an env var, never an admin toggle.** `PLATFORM_ASSISTANT_KEY`
   is set at provisioning. A fork's admin cannot enable borrowing from inside the
   product, because a screen that lets a deployment start spending someone else's
   money is a screen that eventually does.
3. **Borrowed usage has its own allowance**, `PLATFORM_ASSISTANT_DAILY_CAP`,
   defaulting to a fraction of the owned-key budget and counted separately from
   the per-mode budgets in section 6. A demo fork must not be able to spend a
   production village's headroom.
4. **The state is visible.** Admin shows "running on the ReGen platform key,
   N of M calls used today" whenever borrowing is active. When the allowance
   runs out, features 503, and a founder who does not know why will file a bug.
5. **The key never appears anywhere.** It is read from `process.env` at call time
   and never written to `app_config`, never returned by `secrets.ts` (not even
   masked, since it is not the village's secret to see), and never present in
   `/health`, `/api/platform/info`, or the launch checklist payload.
6. **Borrowing blocks handoff.** A launch requirement (`checkKey:
   "assistant:own-key"`) reads `recommended` while borrowing and **blocking**
   once the fork is marked for handoff. A village handed the keys while still
   running on ReGen's credentials loses Maia the day that key rotates, and the
   ownership promise on the sales page says otherwise.

Rule 6 needs a home: `shared/launchRequirements.ts` carries launch items as data,
and this is one more `checkKey` with a check in `server/lib/launch.ts`.

---

## 13. What this deliberately does not build

- **Cross-village reads.** No fork reads another's brain, ever. The shared brain
  flows one way, from ReGen, as prose.
- **Text-to-SQL or a schema dump.** Section 4.
- **A vector store.** Deterministic ranking, no new daemon, and the never-build
  list already refuses additional daemons.
- **Auto-apply.** Nothing Maia produces takes effect without a human accept.
- **A second permission system.** One gate, `shared/capabilities.ts`, including
  for brain tokens.
- **Conversation persistence.** Questions and consultations, never exchanges.
- **Telemetry to the hub.** No structural pattern extraction, no metrics upward.
  The feedback relay stays exactly what it is.
- **Seeded aspirational structure.** Section 5.5.
- **A configuration wizard.** Session 0 asks about the world, never the software
  (3.3).

---

## 14. What review and implementation found

Logged so a later session does not re-derive any of it.

### 14.0 Building phase 1 disproved part of the spec

The adversarial pass below is reasoning. This section is measurement, from
actually building it.

- **"Index sections" was wrong on its own.** Section-level ranking broke five
  queries that document-level ranking had answered correctly. Two stage fixed
  it, and the spec above now says so. A design that reads as an obvious
  simplification is worth benchmarking before it is written down as settled.
- **Two statistical rules failed before vocabulary worked.** An absolute rarity
  threshold and then a question-relative one both looked principled and both
  mis-ranked, because `set` and `508c1a` have identical document frequency in
  this corpus. The stopword list is load-bearing and there is no clever
  substitute for it.
- **BM25 cannot express "named that".** Term-frequency saturation is a feature,
  and it means a title match needs its own additive bonus.
- **The measured module shelf is 125 sections, not 231.** The earlier figure
  counted the CRITIQUE files and the unshipped-module doc, which the allowlist
  excludes. Section 1.1 carries the corrected number.

### 14.0.2 "Role" means two things now, and the studio proposes the wrong one

Main's `0049_org_roles.sql` landed while this was being built. It adds `org_roles`
and `org_role_assignments` (the org chart: seats with an aim, a domain,
accountabilities, and a holder who is an ACCOUNT) and states plainly that it
"leaves `roles` completely alone. Nothing here touches the capability gate."

So the platform now has:

- **`roles`** — a permission-group carrier. Its `capabilities` JSON is the only
  per-village source feeding the one gate. Seeded bundles like `founders-circle`.
- **`org_roles`** — the org chart a member actually reads.

The `role` draft kind writes to `roles`, which is correct for what it does and is
almost certainly NOT what a founder means. When someone asks Maia "what roles do
we need?", they mean **seats**: water steward, kitchen lead, the person who meets
guests. They do not mean a permission bundle.

Nothing is broken and nothing is unsafe: a `role` draft still carries capabilities
and still passes through per-capability escalation, which is exactly the right
ceremony for handing out permissions. The gap is that the studio currently answers
a seat question with a permission-group answer.

**What this changes.** An `org_role` draft kind comes before every other kind in
phase 9, and it is the one the studio should reach for by default. A seat carries
no capabilities, so it needs no escalation list, which makes it both the more
useful and the safer thing to propose. The `role` kind then becomes what it should
always have been: the rarer, heavier act of granting power, gated by the
checkboxes.

The `circles` ALTER in the same migration adds `grown_from_org_role_id`, nullable,
which the circle accept path correctly leaves unset.

### 14.0.1 Fixes that were themselves wrong

- **`ALGORITHM=INSTANT` is reversed.** The adversarial pass was right that a
  copying ALTER at boot behind a fail-loud runner is a risk, and the fix traded
  it for a worse one: no MySQL version is pinned anywhere in this repo, INSTANT
  needs 8.0.12 or later, and a fork on 5.7 would have become unbootable. The
  migration ships portable, with the tradeoff written into its comment.
  `health_events` holds thousands of rows at most in every current deployment.
- **The reader registry got `is_example` wrong on the first pass**, filtering
  `circles` and missing `roles`, `quests`, `badges` and `users`, all of which
  have carried the column since migration 0046. This is the exact failure
  section 8.2 names, made by the person who wrote section 8.2. The suite now
  scans the source and asserts every reader query touching an example-bearing
  table filters it.
- **That scan passed vacuously.** Its table-detection matched nothing, so it
  checked zero statements and reported success. It now asserts it checked at
  least five. A guard that quietly stops guarding is worse than no guard,
  because it also stops anyone from looking.
- **Three schema assumptions were wrong.** `quests` has `gratitude`, not
  `reward`; `stage_events` records transitions and has no current-stage column,
  so `members.summary` returns member and role-holder counts instead of a
  fabricated stage distribution. Read the migrations, never the module docs, for
  column names.

### 14.1 Adversarial pass, revision 1 to 2

What the review found before any code was written.

**Serious**

1. *One table could not hold both shelves.* `UNIQUE (shelf, section)` is correct
   for the brief and wrong for the record, which holds many entries per section.
   Split into `village_brief` and `village_record` (2.1).
2. *The capability ceiling was vacuous.* `hasCapability` returns true for every
   capability when `isAdmin`, and the draft queue is admin-gated, so "subset of
   what the accepter holds" constrained nothing. Replaced with a computed
   escalation list and per-capability confirmation (5.3).
3. *Loading `docs/modules/` as a glob would have shipped critiques as product
   guidance.* The directory holds `CRITIQUE-architecture.md`,
   `CRITIQUE-economy.md`, two framework notes and one doc for an unshipped
   module. Replaced with an explicit id-to-filename allowlist, and the eight
   modules that have no contract are named so she says so instead of reasoning
   from a neighbour (1.1).

**Material**

4. Whole-file corpus injection costs roughly 9,000 tokens per call before the
   village's own material. Moved to section-level indexing (1.1, 7). The first
   budget ("6 sections, 2,500 tokens") was self-contradictory once measured: six
   median corpus sections are about 5,100 tokens. Token cap made authoritative,
   with a per-section cap so one 2,282-token section cannot eat the whole budget.
5. The brain token invented a `brain.read` scope, which is a second permission
   system. Bound to a member and evaluated through the one gate (2.4).
6. No per-section audience, so a member-facing render would have leaked `people`
   and `legal`. Added an `audience` column (1.2, 2.1).
7. Derived record entries carry member-written text into a village shelf. Fenced,
   and never auto-confirmed (1.2, 8.1).
8. `is_example` on the brain had no defined meaning. Defined narrowly: editor
   only, never a prompt or a render (2.2).
9. One shared 600/day cap lets a founder starve the public proposal guide.
   Per-mode budgets (6).
10. Session 0 as fourteen sections is close to the "onboarding wizard" on the
    never-build list. Scoped to three sections and to the world rather than the
    software (3.3).
11. Nothing defined what happens when brief and live state disagree. Live state
    wins on facts, brief wins on intent, and the disagreement is surfaced as
    drift (1.3).
12. No affordance for correcting her mid-conversation. A contradiction becomes a
    `brief_section` draft in the same turn (5.2).
13. `ALTER TABLE health_events` runs at boot behind a fail-loud runner. Pinned to
    `ALGORITHM=INSTANT` (2.1).

**Minor**

14. ETag over `MAX(updated_at)` collides at MySQL's one-second granularity.
    Switched to a revision counter (2.1, 2.3).
15. Export filenames built from section text are a path-traversal surface.
    Server-generated slugs only (2.1).
16. Derivation had no idempotency key. Added `(source, source_ref)` (2.1).
17. `members.summary` and `stages.distribution` overlapped. Merged (4.2).
18. `concierge.gaps` needs `map.concierge_enabled`, not just the map module.
    Added `requiresVar` (4.1).
19. "Active member count" was undefined in the restraint cap. Defined (5.5).
20. The record would flood `index.md` within a year. Rolled up to counts plus
    three recent titles (2.3).
21. No adoption signal, only correctness tests. Added four, without thresholds
    (10.1).
