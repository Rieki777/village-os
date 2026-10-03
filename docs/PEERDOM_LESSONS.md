# Peerdom: what a sociocratic org-mapping product teaches this platform

Date: 2026-08-02
Source: peerdom.com documentation (all 6 sections, 12 app pages, 5 guides, integrations, access rights,
pricing), plus a walk of the live public map for Sociocracy For All (peerdom.org/sofa: 41 sub-circles,
232 roles, 65 members) and the 48-organization public showcase.

This is a reference doc. Read it before designing anything that touches circles, roles, holders, or the
org chart. It records what Peerdom does, what transfers to a village-coordination platform, what does
not, and where our own model is already ahead.

---

## 1. What Peerdom is

An org-structure database with an interactive map on top, sold as SaaS to companies, NGOs, cooperatives
and municipalities practising sociocracy, Holacracy, or ordinary hierarchy. Roughly 48 organizations
publish their maps openly, covering 1,162 teams, 2,547 people and 5,450 roles.

The map gets the attention. The data model is the product. Everything else is an app that hangs off that
model, and most apps are sold separately at 1 CHF per user per month. That pricing structure is worth
noticing, because it forced them to make each app a clean, separable idea with its own value. We can
read their app list as a menu of well-factored coordination primitives.

**Why we looked:** game-amora needs an org chart that is real data. Peerdom has spent years on exactly
that problem for exactly the governance model Amora uses. They have solved several things we have not,
and they have skipped several things we care about.

---

## 2. The data model

Three objects and one assignment. That is the whole spine.

### Circle

Called a circle, group, team, domain, cell, bubble or pod depending on the org's custom vocabulary.

| Field | Notes |
|---|---|
| Name | required |
| Purpose | "a one-sentence explanation of why this circle exists" |
| Accountabilities | responsibilities held by the circle itself |
| Notes | context, links, documentation |
| Custom fields | org-defined, see §4 |

Circles nest without a practical depth limit. Their own guidance is to start with two or three levels
and add depth only when it earns itself. A circle contains roles, sub-circles, or both, at any depth.

Peerdom uses "circle" and "group" interchangeably. The creation flow says "New Group". The distinction
is vocabulary, with no functional difference.

### Role

Same field set as a circle: Name, Purpose, Accountabilities, Notes, custom fields. The single most
important line in their entire documentation:

> Roles define work, not people.

A role exists whether or not anyone holds it. It carries its own purpose and accountabilities. That is
what makes vacancy, handoff, history, and succession coherent as data.

### Holder assignment

A person holds a role. Multiple people can hold one role. Each holding carries a **focus** string that
scopes that person's slice: "EMEA region", "Enterprise accounts". Three people can hold Land Steward for
three different pieces of land without three duplicate roles.

This one field solves a problem our content cards handle by writing several names into a textarea.

### Badges

Governance meaning rides as flags on a generic structure. The map draws roles differently by badge:

| Badge | Meaning |
|---|---|
| Default | ordinary role |
| External | held by someone outside the organization |
| Leader / Representative | links a circle to its parent context |
| Electable | has a term, tracked by the Elections app |
| Colorful | custom color |
| Mirrored | synced copies of one role across several circles |
| Vacant / Understaffed | striped, derived from staffing |
| Hexagonal | alternative shape |

Sociocracy's double-link is two roles carrying the Representative badge. The **Leader** is selected by
the parent circle and carries context down. The **Delegate** is elected by the sub-circle and carries
its voice up. Their guidance: these should be different people, so the two information channels stay
independent.

The four process roles per circle are Leader and Delegate (both Representative), plus Facilitator and
Secretary (both Electable).

The structural lesson: the platform does not model "sociocracy". It models circles, roles, holders and
flags, and sociocracy is a configuration of those. A village running a different governance model gets
the same schema.

---

## 3. The apps, and the transferable idea in each

Twelve apps. Each one is a coordination primitive worth studying on its own.

### Journal (change history)

Every structural change logged with actor, type and timestamp. Color-coded: green for additions, orange
for changes, red for removals. Reversed changes render struck through so an undo is visible as an event.
Draft edits carry a draft marker.

Three views: whole organization, **per node** (open a role, read its entire history), and per person.
There is an undo button for the last action.

**The idea:** the per-node journal. Before you change a role, you can read what has already been tried
with it. Governance history stops living in people's memory.

### Drafts (structural sandbox)

Reorganize in a sandbox that renders on a blueprint-pattern background so nobody confuses it with live.
Create a draft from scratch, from a copy of live, or by duplicating another draft. Several can coexist.
Share a draft with named people. Only Owners publish.

Publishing swaps the live map for the draft and demotes the old live map to an archived draft, so revert
costs nothing. There is no automatic merge: combining two drafts means moving nodes by hand.

**The idea:** a proposed reorganization is a previewable object with a publish transaction. This is the
missing piece that would make our governance feel sociocratic instead of merely described as sociocratic.

### Insights (organizational pattern overlays)

Three analyses that recolor the map, each with aggregate stats and a ranked list of affected nodes:

- **Role Hoarding**: concentration of roles and decision power. Light yellow means balanced, dark brown
  means concentrated. Their own recommendation is to start here, because it exposes where delegation is
  overdue.
- **Cell Scatter**: workload fragmentation. Light cyan means focused, dark green means scattered across
  many places.
- **Role Turnover**: how often a role has changed holders over three months. Blue is stable, red is
  churning.

The active insight is encoded in the URL, so an analysis is a shareable link.

**The idea:** power concentration and fragmentation are measurable from structure alone. No survey, no
self-report. For a young village with a founder holding everything, this is the single most useful
diagnostic in the product.

### Contribution (staffing as a derived number)

Each role carries a staffing **target**. Each holder records what percentage of their time goes to that
role. Peerdom sums the holders and compares against the target, then colors a progress bar: green when
contribution matches target, orange when understaffed, red when overstaffed. Displayable as percentages,
FTEs, or hours per week/month/year. Members edit their own; Editors and Owners edit anyone's.

**The idea:** vacancy is arithmetic, never a status column that drifts. Our village-map design already
reached this conclusion with `holders < seats`. Peerdom goes further by making the target a continuous
number, which catches the overloaded role as well as the empty one.

### Elections (terms, with no voting)

Mark a role Electable, then set an "Elected Until" date per holder. The app sorts every electable role
by urgency: red for expired, orange for expiring soon, green for upcoming. Owners get a weekly email
summarizing what needs re-election. A sidebar badge carries the count. The Journal records the history.

It deliberately runs no ballots. It is a calendar with governance semantics.

**The idea:** term expiry is the thing communities forget, and tracking it needs almost no code. Our
binding votes already happen on Hypha, which makes Peerdom's no-voting split exactly the right shape for
us: the term lives in the platform, the vote lives on chain.

### Feedback (role to role, private)

Feedback is exchanged between two roles. The giver writes from one of their roles, the receiver reads it
in the context of one of theirs. One entry per role pair; an update replaces the prior entry. Four
dashboard tabs: Received, Given, Requested by them, Requested by you. Requests notify by email.

Privacy is absolute. Only giver and receiver can see an entry. Organization Owners cannot read feedback
exchanged between other people.

**The idea:** anchoring critique to a role keeps it about responsibilities and expectations, and takes
it off the person. Also worth noting: they made owner-invisibility a hard product rule, which is the
kind of commitment that has to be in the schema and the access checks, never in a policy document.

### Goals (with confidence)

One active goal per node. Title plus a rich-text description. Subgoals measured three ways:
complete/incomplete, percentage, or progress toward a target number. The parent's progress is computed
from its subgoals.

Role holders vote **confidence**: high, medium, or low. That signal moves independently of the
percentage bar, which is how a goal that is 80% complete and quietly doomed becomes visible.

On the map, goal-bearing nodes get an arc ring: green for done, orange for remaining.

**The idea:** confidence voting. A number tells you where the work is. Confidence tells you whether the
people doing it believe the number.

### Projects (temporary work bound to roles)

Fields: name, mission, start and end dates, scope (org-wide or specific groups), one label, notes,
external links (Jira, GitLab, Confluence), and a Representative who holds accountability.

The important design choice: you select which **roles** a project needs, then assign holders to fill
them. When a person leaves, the project stays anchored to the role, and the handoff is legible.

Projects render as colored cards in drag-and-drop status groups, and on the map as grey arcs connecting
every role and circle involved. Completed projects archive.

**The idea:** temporary structure that borrows from permanent structure. A quest, a build week, a
harvest, a land purchase: all of these want a project shape that dissolves cleanly.

### Relationships (links outside the hierarchy)

Owner-defined link types between people, roles and circles. Their examples: Deputy (who covers an
absence), Prerequisite role (progression path), Team dependencies, Line manager, Mentor, Career
aspiration.

Each type is configured with a name, description, target type (peer, role, or group), a maximum number
of connections, and public or private visibility. Links are automatically bidirectional: create A to B
and B gains the reverse reference. Names translate into five languages.

**The idea:** the hierarchy is never the whole truth. A generic, owner-defined, bidirectional link type
absorbs everything the tree cannot hold, without adding tables.

### Network (organization to organization)

Connect two Peerdom organizations. Each side sees the other on its map as external nodes when the
Network layer is on. Three trust levels:

- **Basic**: anonymized structure. Circles and roles visible, people hidden.
- **Regular**: names and contact details visible.
- **High**: extended permissions including editing.

Either side can change its level or disconnect at any time. Owners only. Included with Peerdom+.

**The idea:** graded, revocable, bilateral visibility. Federation modelled as a per-pair trust dial is a
better fit for a movement of villages than an all-or-nothing directory.

### Directory, Missions, Pages

- **Directory**: searchable, filterable table or card view of every peer and every role. Filters on
  name, email, permission level and custom fields. CSV import on paid plans, SSO sync when configured.
- **Missions**: one personal statement per peer answering "why am I here, what do I want to contribute".
  Explicitly distinct from a role's purpose. Optional, no format, shown on the profile and in a grid.
- **Pages**: wiki-style docs built from text and image cards, each page linkable to circles, roles and
  people. Linked pages surface in the Inspector when you select the connected node. Public or private.

**The ideas:** Missions is the cheapest possible answer to "who are these people actually", and it does
not pretend to be a role. Pages is knowledge anchored to structure instead of knowledge in a separate
wiki that nobody updates.

---

## 4. Custom fields and custom vocabulary

**Custom fields** extend roles and circles beyond Purpose, Accountabilities and Notes. Three axes:

- Entry format: single entry, or list
- Text format: plain, or rich
- Data type: text, or **relationship** (linking peers, roles, or circles)

Fields are public or private, where private hides them from guests on a shared map. They appear in the
Inspector, on profiles, in Pages, and in exports. Names translate into five languages. Deletion is
permanent.

Their **Skills Inventory** guide is a good demonstration of the pattern: a List field for the skill
(Languages, say), a second List field for proficiency, then link the second as a "follow-up" to the
first. That yields structured pairs like "German, Professional". Follow-ups chain several levels deep.
Their honest admission: you cannot yet filter by skill value in the app, so discovery runs through the
Directory columns, CSV export, or the API.

**Custom vocabulary** renames six concepts: Peers, Circles, Roles, Representatives, Goals, Subgoals.
Each has a fixed option list (circle can be group, team, domain, cell, bubble, pod; representative can
be leader, link, coach, manager, spokesperson). The chosen terms apply everywhere including exports.
Map, Owner, Editor, Member, Guest, Draft and Journal cannot be renamed. Interface languages: English,
German, French, Dutch.

**The idea for a white-label platform:** their vocabulary layer is a closed enum, not free text. That
keeps translations and copy sane while still letting a village call its circles "councils" or "guilds".
We have a brand overlay already; this is the same instinct applied to structural nouns.

---

## 5. Map, layouts, and layers

Circle View is the primary visualization: nested circles containing roles containing avatars, with
everything visible at every zoom level and nothing collapsing or hiding. Five layouts:

1. Nest roles and groups (the common one)
2. Nest roles only (sub-groups sit beside)
3. Do not nest (flat, network-style)
4. Nest roles only, with connecting lines
5. Do not nest, with lines

Their sociocracy guide specifically recommends the flattened "cactus flower" or line layouts, because
those read as equality and interconnection instead of top-down hierarchy. The layout is a view setting
and never changes the underlying structure.

Also available: List View (flat, searchable) and Tree View.

**Layers** are toggleable transparent overlays: Peers (avatars on roles), Projects (badges plus grey
connecting arcs), Goals (color-coded progress arcs), Network (connected external organizations). Layer
state saves per organization. Guests cannot toggle layers.

Power-user details worth copying: Cmd/Ctrl+Z undoes most operations including deletes; Cmd/Ctrl while
dropping a node copies instead of moves; right-click gives a node context menu; the active insight and
selection live in the URL so any view is a shareable link; maps embed by iframe; sharing supports
anonymization so structure can be public while people stay private.

---

## 6. Access rights

Five levels, three of them billable:

| Level | Billable | Can do |
|---|---|---|
| **Owner** | yes | everything: settings, billing, permissions, integrations, publishing drafts, archiving or deleting the org. At least one must always exist. |
| **Editor** | yes | create and modify circles, roles, and app content. Can invite, but only up to Member. Cannot grant Editor or Owner. |
| **Member** | yes | view everything, use installed apps, edit own profile, contribute through goals, feedback and voting. No structural authority. |
| **Guest** | free | view-only map. No apps, no directory. |
| **No-access** | free | appears on the map for documentation only. Cannot log in. |

**The idea:** the **No-access** level. A person can exist in the structure as a documented fact with
zero platform relationship. Advisors, board members, historical holders, the neighbour who holds the
water rights. Our platform currently has no way to say "this seat is held by a real human who will
never log in", and that gap is exactly why holders became free-text strings.

The second idea: Guest is free and Member is billed. Visibility costs nothing; participation costs.
For a village, the equivalent principle is that structure should be readable by everyone the village
chooses, and the cost sits with the people acting.

---

## 7. The integration layer

This is the most interesting part of the product and the part most relevant to a movement of forks.

### MCP server

Endpoint `https://mcp.peerdom.org/mcp`, authenticated with `X-Api-Key` from Settings > My Data > API
Keys. One key grants full read **and write** access to one organization, revocable instantly.

Read tools list and inspect peers, roles and circles, surface vacancies, and report workload
distribution. Write tools create, update and remove peers, roles and groups, and assign holders.

Their own example questions:

- "Which roles in the Marketing circle are currently vacant?"
- "Who holds the Finance Lead role, and what's their contribution?"
- "Who is carrying the most roles right now, is anyone over-committed?"

Supported clients: Claude (desktop, web, Code), Cursor, VS Code/Copilot, ChatGPT developer mode, Gemini
CLI, and locally hosted models.

### OKF, the agent-readable export

Open Knowledge Format: "an open standard for describing knowledge, including organizational structure,
as a folder of linked Markdown files."

The bundle covers five entity types, Circles, Roles, Peers, Goals and Pages, as cross-linked Markdown
opening on an index of the whole organization. It honors custom vocabulary, so a map that renamed
circles to pods exports pods.

Public maps publish the bundle automatically at a stable URL that updates continuously. Private
organizations keep it behind auth, retrievable by Owners. The bundle respects map privacy exactly: only
public pages, only the people a public map already shows, no archived items.

Their framing: MCP is the live API conversation, OKF is the static self-contained artifact any agent can
read on its own.

### Everything else

SSO and user sync via Microsoft Entra ID, Google Workspace and Okta. Microsoft Teams messaging from the
map. Notion for linking documentation to structure. Zapier, Pipedream and n8n for automation. REST API
and webhooks on paid plans. No Slack, no HRIS.

**The idea:** a village that publishes its structure as linked Markdown at a stable URL becomes legible
to every agent and every peer village with zero integration work on either side. For a movement where
each village is a separate fork with its own database and domain, this is the cheapest possible
federation substrate. It is a static file, and static files scale to a civilization.

---

## 8. Business model, because it shaped the product

- **Free** up to 10 accounts, core mapping included, 15-day trial of every app.
- **Peerdom+** at 5 CHF per person per month billed yearly, minimum 10 people, including Network,
  Missions and Journal, unlimited roles and groups, unlimited guests.
- **Pro** at enterprise pricing with all twelve apps, priority support, training.
- Individual apps at about 1 CHF per user per month on top of Peerdom+.
- Discounts: 15% for nonprofits and education (`NGO`), **10% for making your map public** (`PUBLIC10`),
  volume pricing over 100 people, purchasing-power parity on request, 16% for yearly billing. They
  stack.

Two things to take from this. First, per-app pricing forced clean module boundaries, which is the same
discipline our module framework already enforces for a different reason. Second, **they pay
organizations to be transparent**. A discount for publishing your map is a good mechanism for a movement
that wants its villages legible to each other.

---

## 9. Where our platform is already ahead

Peerdom has no answer for any of this, and we should not lose it while borrowing their structure:

- **A double-entry ledger** with a boot-enforced invariant that SUM(balance) per token is zero, plus the
  economy rules around it (fiat in only, recognition tokens never purchasable, faucet-issued tokens
  never swappable, caps failing closed).
- **Quests and gratitude cycles**, with settlement as a deliberate human act that no scheduled job may
  perform.
- **The capability gate**: one resolution order for every permission decision in the product.
- **Module lifecycle** as a first-class concept: off, preview, members, public, with dependency
  demotion at boot and an open-state check that refuses to disable a module while value is outstanding.
- **The contact relay**: a privacy-respecting introduction with caps, opt-out, idempotency and an abuse
  log, which is a better answer than Peerdom's "here is the email address".
- **The concierge as a demand sensor**: logging unmatched queries so the questions nobody can answer
  become the signal for which role the village is missing. Peerdom's map displays supply only. This is
  genuinely novel and should be protected as a differentiator.
- **The Hypha boundary**: binding votes on chain, the platform reading and deep-linking, never writing.
- **Fork-and-own deployment**: each village holds its own database and domain. Peerdom is one tenant
  database with public read.

---

## 10. What to take, in order

1. **Split the two meanings of "role".** Today `roles` is a permission-group carrier (rows like
   `founders-circle`, `steward-circle`, `treasury`, holding a `capabilities[]` array and a `min_stage`),
   and migration `0018_village_map.sql` bolted `circle_id` and `seats` onto that same table. The human
   org chart lives separately as content-JSON cards. These are two different objects wearing one name.
   Everything below depends on separating them. See the 2026-08-02 role-model fix list (an internal note, in the maintainers' private operations repository since 2026-10-02).

2. **A holder is a `user_id` plus a focus string.** Free-text holder names cannot route a notification,
   derive vacancy, carry a term, or accumulate history. Add a real assignment table, and add a
   Peerdom-style "documented, cannot log in" holder so external and historical seats stay representable.

3. **Vacancy and staffing derived from a target.** Keep `holders < seats` for the binary case and add
   the continuous version so an overloaded role is as visible as an empty one.

4. **A per-node change journal.** Structural changes appended with actor and timestamp, readable per
   circle, per role and per person. Deterministic, cheap, and it is what makes a village's governance
   auditable without putting it on a chain.

5. **`elected_until` on a holding, with an urgency-sorted view and a weekly digest.** No ballot UI. The
   binding vote already lives on Hypha.

6. **Role Hoarding as a health metric.** The events spine and the health dashboard already exist. Founder
   concentration is the failure mode that kills young villages, and it is computable from structure.

7. **An OKF-style export.** `/.well-known/` or `/api/village.okf` publishing circles, roles, holders and
   open seats as linked Markdown at a stable URL, honoring the existing public / member / contact
   visibility tiers. One endpoint, and every fork becomes readable by every agent and every peer village.

8. **Drafts for structural change.** A proposed reorganization becomes a previewable draft linked to its
   forum proposal, publishing atomically on consent, with the prior structure archived for revert.

9. **Confidence voting on goals and quests.** One enum column, and a quiet failure becomes visible before
   the deadline.

10. **Owner-defined relationship types.** Deputy, mentor, successor, prerequisite. One generic
    bidirectional table absorbs the half-dozen link kinds a village will ask for over the next two years.

### Where this stands

Five of the ten are built, as of 2026-08-03. What each turned into, and the thing about it that
was not obvious from the Peerdom version:

| | Built as | The part that surprised |
|---|---|---|
| 1 | `org_roles` + `org_role_assignments` (0049) | The permission plane keeps the name `roles` and is untouched. Nothing in the org plane reaches the capability gate. |
| 2 | `holder_kind` member/documented, `holder_key NOT NULL` | MySQL exempts NULLs from unique indexes, so a nullable `user_id` in the key would have admitted unlimited duplicate seatings. |
| 3 | `seatState`, derived on every read | Needed a fifth state, `expired`: a seat whose holders all lapsed is not `filled`, and calling it `open` would erase people still doing the work. |
| 4 | `describeOrgChange` + `health_events` index (0051) | It is a read over the existing spine, not a table. The index was the whole migration. |
| 5 | Overdue list in the Org Chart tab + the `term-watch` job | The model was already there and nothing rendered it, so a term that ran out was recorded and never seen. One notification per assignment per event: `dedupe_key` is globally unique, so a week bucket would re-fire forever. |
| 6 | `structuralLoad` on `/api/health/summary` | Seats-held is not the metric. `soleHeld` is, and the page's own "no leaderboards" promise forced the shape public and the names behind `map.viewPeople`. |
| 7 | `/.well-known/village.json`, `/api/public/org.json`, `/org/**.md`, ed25519-signed | Peerdom publishes OKF as an integration feature. Here the hard part was privacy, not format: the export has no session, so it can carry no names at all, and the gate had to be the village's EXISTING answer about public structure rather than a new switch. |

| 8 | `org_drafts` + `org_draft_changes` (0056), all-or-nothing on one transaction | Scope had to SHRINK to be honest. `circles` is a dbCollection whose `replaceAll` owns its own transaction and cannot be rolled back once it returns, so a draft covers seats, their circle assignment and their holders, and NOT creating or deleting circles. |
| 9 | `quest_claims.confidence` (0055) | The column was the easy part. The rule that matters is that only the HOLDER can set it and nothing is computed from it: a confidence rating that feeds a reward is one people learn to inflate. |
| 10 | `org_relation_types` + `org_relations` (0054) | Endpoints are nodes, never people. That one decision is what makes the links publishable by construction instead of by filtering, and filtering is how leaks happen. |

**All ten are built.** The federation handshake that the export unblocked is built too: `discoverPeer`
accepts any document answering `protocol: "village/*"`, so a Peerdom organisation or a hand-written
static file can peer without sharing a line of code with this repo.

The most useful thing to come out of doing all ten is that they compound. Terms say when a mandate
runs out; role hoarding says which seats one person carries alone; relations say who is named to carry
them. Any one of those is a report. Together they are the sentence a village actually needs: *this
seat, that person, no cover, and their term ended in March.*

---

## 11. What to skip, and why

- **Role-to-role private feedback.** Gratitude already carries the appreciation channel and it is
  public by design. A second private channel splits the social function and creates a surface nobody can
  moderate. If critique needs a home, it belongs in the forum's decision primitive as an objection.
- **The Network app's org-to-org model as designed.** Village federation should ride the published OKF
  bundle plus the existing hub relay, which costs the village operator nothing. A bilateral accept flow
  is operator burden that a movement of small villages will not carry. Keep the graded trust levels as
  an idea and apply them to what the bundle exposes.
- **Twelve separate paid apps.** The per-app boundary is good engineering discipline. The per-app
  billing is a SaaS mechanic that does not fit a platform villages fork and own.
- **Tree and pyramid views.** A village does not need a pyramid rendering of itself, and the deterministic
  radial map plus the mobile accordion already cover the two real cases.

---

## 12. Sources

- `peerdom.com/doc/guides/sociocracy`, `/user-guide`, `/skills-inventory`, `/tips-and-tricks`
- `peerdom.com/doc/map/`: circles-and-groups, roles, circle-view, layers, relationships, custom-fields,
  custom-terms, navigating, list-view, tree-view, drag-and-drop, sharing
- `peerdom.com/doc/apps/`: journal, drafts, insights, contribution, elections, feedback, goals, projects,
  directory, missions, network, pages
- `peerdom.com/doc/integrations/`: overview, mcp, okf
- `peerdom.com/doc/admin/access-rights`, `peerdom.com/pricing`, `peerdom.com/showcase`
- Live map walked: `peerdom.org/sofa` (Sociocracy For All)
