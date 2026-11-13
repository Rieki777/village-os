# Changelog

What changed in each release of the village platform, in plain language for
the people who run villages.

Every release is one container image, built once and published under its own
version number. A published version never changes afterwards, so a village
that pins a version keeps running exactly the software that was tested for
it. `ops/RELEASES.md` explains the version channels, how to pin one, and how
to pull the image if you host your own village.

## How to read this file

**`docs/UPGRADING.md` is the procedure.** Read it before your first upgrade.
It covers the backup to take, what happens while a release installs, and how
to put the previous version back.

Read every entry between the version you are on and the version you are moving
to. Each one answers the same three questions:

- **What changed for your village.** In plain words.
- **What you must do.** Usually nothing. Anything listed here is done *before*
  you start the upgrade.
- **Does it touch your data.** Whether the release reshapes your database on
  the way up, and whether going back would undo it.

**Starting a new image changes your database**, every time, by itself, before
the village answers anyone. That is why **Does it touch your data** is on
every entry, including the ones that say no.

---

## Unreleased

Work on `main` that has not been published as an image yet. No village runs
it. It is written here as it lands, so the next release entry is a record
made at the time.

To word with Rye and the Legal session for the next release, left out of 1.3.0 on purpose: the invoice and pay half of the approvals module; what work states it pays, Earned Equity, cash owed, draft invoices and the cash-payouts page; and the flat role mint going blank (#776) with the seeded dues note being blanked. Everything else up to 1.3.0 is in its entry below.

---

## 1.3.0 (not yet tagged)

**Village OS moved to the ReGen Civics organisation, and nine new modules
arrived.** The code is now at github.com/ReGen-Civics/village-os, and the
image is published as `ghcr.io/regen-civics/village-os`. Links to the old
repository address redirect. **1.2.0 and every older release stay at the old
image address, `ghcr.io/rieki777/village-os`**, unchanged and still pullable.

**Village OS is now licensed AGPL-3.0-or-later.** It was MIT. The site footer
links to the source, which is what the licence asks of a village that runs the
code for others.

266 pull requests landed on `main` since 1.2.0, and together they make 94
database changes and add nine modules. 99 of those pull requests are landing
batches (their branch is named `wt/batch...`), and the smaller pull requests
each batch carries are not counted again. This release was drafted as 1.2.1
and never published under that number.

**How these numbers were counted**, from git and nothing else. Pull requests:
`git log --first-parent --merges cfaa41f..10328fc` (1.2.0 to the `main` this
release carries) has 220 `Merge pull request #N` subjects, and
`git log --first-parent --no-merges` over the same range has 46 squash commits
ending `(#N)`: 266 numbers, none twice. On this release branch,
`git log --merges --first-parent cfaa41f..HEAD` shows only nine of them (#413
to #440), because the other 257 arrive inside its merges of `main`. #750
was reverted and landed again as #759, and both count. Two more commits
reached `main` with no pull request: that revert, and a fix to the profile's
moon cycle. The documents bot's 21 `Regenerate the generated docs` commits are
not counted either. Migrations: `git diff --name-only --diff-filter=A v1.2.0
HEAD -- drizzle/` lists 94 files (167 at 1.2.0, 261 now), and
`--diff-filter=MDR` lists none, so no migration that shipped in 1.2.0 was
edited. Modules: `shared/modules.ts` adds `canvas`, `comms`,
`conflict-evolution`, `funding-rounds`, `gene-keys`, `moon-review`, `places`,
`session-card` and `sessions`. None of them is core, so all nine ship off.

### What changed for your village

**Nine new modules, all off until you turn them on**

- **Live Sessions.** A circle holds a working call together: an arrival round,
  an agenda the circle consents to, a page and a clock for each item, and every
  action held by a person or a seat. After the call each action carries on in
  a task board, with task emails. Arrival words are erased when the session
  closes.
- **Village Comms.** The village's email in one place: reminders for the
  gatherings people said yes to, a few emails along the path a person chose,
  guest RSVPs, a live vote on a session time, and letters to the people who
  agreed to get them. It needs a Resend account and a verified sending domain,
  and Admin, Comms, Settings walks through both.
- **Gene Keys.** Each member can find their Gene Keys lines and Human Design
  type, and their Sun, Moon and rising signs, from birth details read on their
  own device. No birth date, time or place is stored. The lines show as a seal
  on their portrait unless they hide them, and "Who complements me" shows a
  member only people who also said yes.
- **Session Card.** Anyone in a live session can pull a card at the start, as
  often as they like. It reads the day's sky and weaves in the Gene Keys of the
  people present who said yes. Each person's own line stays private until they
  share it, and the cards are deleted when the session closes.
- **End-of-Moon Review.** Once a moon, each member who holds a role gathers
  what they delivered, checks it against their role cards and the season
  goals, and sends a recap. Two different people approve, neither of them the
  member. The one interim exception, the Treasury power group approving its
  own, is marked on every such approval.
- **Funding Rounds.** The village chooses together which quests the season
  funds, within a pot. Members share rough ideas, shape them into quests, and
  tick the ones they would fund. The count shows what Voice chose and what one
  member, one vote chose, and a funded idea becomes a quest. A round runs four
  stages: seed, grow, choose and harvest. Any member can back a proposed quest
  with a pledge, shown with their name and open to withdraw until choosing
  closes.
- **Living Places.** Every place on the land as a living invitation: what it
  is, which stage it has reached from idea to built, which permits it waits
  on, the roles that care for it, and how to step forward as its steward. A
  place keeps the key the living map already uses for it.
- **Governance Canvas.** The village reads how it governs itself, block by
  block, on the twelve blocks of the canvas: a reading per block that is kept
  every time, a Baseline view, a Decision Matrix, anyone's suggestion for how a
  block is answered, and a notebook where a member keeps their own documents
  and may offer one to the village.
- **Conflict Evolution.** A conflict agreement the village writes and changes
  by vote: where a conflict goes, who takes it and who covers, how soon a
  member hears back, and a private ask to the ombuds.

**Every village's email**, whether or not Village Comms is on: each email is
recorded before it goes, carries a one-click stop and a preferences page, and
an address that bounces or complains stops being written to.

**Inside Live Sessions**

- A circle keeps a meeting rhythm, and Coming up on `/sessions` shows its next
  meeting. A circle can attach its own Google, Apple or Outlook calendar, and a
  member can follow circles on their own calendar.
- An agenda library holds what members bring for a circle's next session. A
  tension raised with a role, and a decision whose review date has come, each
  become an item there.
- In the room, everyone votes agenda items up or down until the facilitator
  sets the order. The facilitator can fill in for a member, who is told and
  can undo it. A proposal can be checked. Someone who sleeps on a proposal
  names a time to answer by, and a night left unanswered by then counts as no
  objection.
- Meeting templates, weekly priorities and wins that name the season goal they
  serve, and an advice process: before deciding something that touches others,
  a member asks the circle it touches.
- Enter the room from its card, discard an open session, and delete a closed
  record.

**Seats and seasons**

- A seat can say what it offers whoever holds it: how long it runs, its
  rhythm, what it records as pay, and its quests. Members can read it.
- A member can apply for one to five seats on terms, as one proposal. Whoever
  holds the seat power approves it, or the village votes. **Waiting on you**
  on the task board shows what needs an answer.
- **Your season:** each member says which seats they keep, hand back or apply
  for, and what they commit to.
- **Align:** a member aligns with a seat's terms in one click, the Aligned
  register shows what is in force, and aligned terms can change and end.
  Signing the Love Letter aligns a member with the words they read.

**Roles, circles and proposals**

- Each role has a card on its holder's profile: what it looks after, what to
  bring it, what it does not hold, how its work is done, and the sections of
  the CCOS Role Card. These words change by consent, through an org chart
  draft.
- Any member can raise a tension with a role. It reaches the role's holders,
  and only they and the member who raised it read it until a holder brings it
  to the circle.
- Each circle has a card at `/circles/<id>` with its charter, which changes by
  consent, and a governance layer that sets where it sits on the circles map.
- A member drafts their roles for next season. Every live holder of a role in
  the circles concerned is asked to consent or object within two business
  days. Somebody with no account can propose for a role through the village's
  public link or a link made for them, and no account is made for them until
  a proposal is adopted.

- **The role journey.** Only roles a steward has listed can be found, and a
  listed role carries its full card: the season goals it serves, its track,
  how it is selected, its languages, where it is worked and a booking link.
  One editor, Edit this role, changes the card. A visitor who is signed out can
  apply for an open role, and a member picks their roles in steps, with art,
  the five archetypes first. Each application is reviewed in order: the
  interviewing roles a role names are asked one after another, each scores,
  and a recusal is kept. The confidentiality agreement's PDF can be attached
  for signed-in members only. A member keeps a time zone, and a holder whose
  role runs by the moon files to carry on, which one person renews for the
  whole village.
- A new holder has an onboarding path in phases the village names, with a
  buddy and check-ins that only the holder, the buddy and the onboarding
  role read. Each role names the access it needs, raised as a task when the
  role starts and again when it ends.
- Role proposals: open ones can be for this moon, are hardened against floods,
  and give the applicant a status page, updates by email and on their profile,
  a reply promise and a kind no. A proposal asks for the first moon's goals as
  an interactive list.
- **Apply to the founding team** in six steps, with an About you step for
  references and background-check consent. Our review comes before the
  conversations: an invite, or a warm not-invited letter. A role that holds
  money or works near children can be always background-checked, and the
  check's wording says the village covers its cost. The founding offer shows
  the 60/40/0 rewards with their fine print, and how we see conflict.
- The eight terms come with our suggestion, with commitment in place of hours.
  The ops steward can offer terms back, with history, and the candidate
  answers on their status page. Sera drafts a first version of the aim, goals
  and story on request.
- Applicant emails and pages follow the applicant's language, and the joining
  pages are in Spanish. The first hour after yes is planned, and the joining
  form is six stones.
- **Agents can apply for and hold roles**, with a member who keeps each one
  and is shown beside it. The roles an agent may hold are set on the role.
  What a connected agent proposes waits for a person: a seating or a drafted
  letter lands in an approvals inbox.
- A role can be marked for the characters it suits, and the roles page shows
  founding roles first.
- **Commitment percent:** quests and roles size what they ask of a person as
  a number from 1 to 100, and a member records what they can give as a dated
  history that is never edited.

**Circles and the map**

- Circles show operating ones first, forming ones below, and one anchor marked
  everywhere. A draft can set a circle's standing and mark the anchor.
- Each circle has a hearth page: the roles round a fire, when we meet, what we
  tend, who holds what and what we decided. The living map draws hearths, the
  threads between them, and opt-in lights where people meet today.
- The map places seats by the village's own keys, not by circle name, serves
  its images as their own files and fetches construction sprites and
  satellite plates only when they are shown. The Enter the Land gate stands on
  the land, drawn as a plan.

**The village's structure**

- A batch of structure changes, from a person or an outside service, is
  reviewed on the map, its duplicates settled, and accepted as one draft.
- Whoever holds the new decide power publishes that draft, or puts it to the
  village as a vote.
- People can be carried across to a new chart, and the empty old circles
  retired.
- In Admin the org chart is nested (circles, roles, role) with one floating
  save bar. A change to an org draft waits for a publish.
- **Sera sync review:** one read-only list on `/review` shows where the outside
  service's chart and the village's differ. A person answers each difference:
  take the service's value into a draft, keep ours, edit it, or settle many
  together. A role the service archived is never made again, and a role a sync
  made matches itself.

**Deciding together**

- Holding an org seat grants the Power groups linked to it, for as long as the
  seat is held. Only the holders of `power.assign` hand out powers, and the
  members' powers page names every power and who holds it today. A power that
  matures waits a week before it crosses to the village, and any steward can
  stop it. An everyday power passes to the village as its stage floor, and
  nobody loses it. Five held-back keys move onto a role only at the village's
  highest tier.
- Operator powers reach the admin routes their power names. Every member can
  read the admin panel, and change nothing.
- **Change requests:** a member gathers several changes into one request,
  with a review round before the vote. Every setting shows its own history:
  who, when, why and the vote. The pages are `/changes` and `/changes/:id`.
  Suggest to edit sends a suggestion to the place a dial names.
- A ballot that too few answered is asked again once, at half its quorum,
  when the village turns on `governance.quorum_fallback`. A vote-weight cap,
  off by default, bounds one member's share of the vote.
- A village can change its name, its currency (at the highest tier), its
  badges and its minting rules by vote, and can vote one copy of its database
  to a named steward. A Hypha outcome that names no space waits for a person,
  and can always go to the village's vote after launch.
- The Governance page shows who holds the Voice as groups, and this season's
  votes. The launch's head count is a village dial, and the launch vote may
  carry the site address.
- Governance cannot be paused into a state nothing can undo. A launch never
  re-points a power the village already holds. A seat whose term ran out holds
  nothing on the pages members read.

**Members**

- **Waiting on you** also holds asks: one member can ask another to review,
  edit, approve or finish something.
- **Your list:** a member's own task list on their profile, which a steward
  turns on for each member, and which can bring in their tasks from the
  organisational memory library.
- **Companions:** every member gets a personal companion, and one for each
  role they hold (`companions.role_ids`, all roles by default). A companion
  brings questions, and drafts that wait for the member's yes. Before a
  member's words first go to a model on the platform's borrowed key, their
  companion names the provider and the operator and asks.

- **Profile Today** and the first 14 days: one next step everywhere, Your path
  on the profile, and the status page as a Seed of Life. Fireflies arrive
  where the bell's number was, and the Gathering fills a Seed of Life when a
  member says they will be there. The calendar shows the moon as a spiral of
  days, the moon garden shows the season, and the commons draws season goals
  as circles where moss spreads.
- **Gratitude threads:** a thanks is a thread between two people, newest first,
  with no count. An open work board shows goal threads.
- Two training pages, `/training/steward` and `/training/resident`, each with
  its own words in Admin. Steward the village is one flow built on eleven
  steps.
- **Proposed changes:** an agent can propose a change to any Admin setting.
  A person reads every proposal beside what is live, edits it in place, and
  accepts a selection, each through the setting's own route as that person.
- Companions follow the member's chosen guide, and Sera is on every guide
  surface, with a microphone and Talk it out on long text.

**Running the village**

- **The platform's timezone is UTC.** It was the first village's clock. A
  village that never chose or confirmed its timezone in Admin, Seasons moves
  to UTC with this release: season turns, role terms, the claims window, the
  calendar and the weekly brief follow. The Launch Plan's timezone row now has
  to be answered before a launch vote. A village that chose or confirmed its
  zone keeps it.
- Whoever holds the Founders Circle or steward power group can open the admin
  panel, for as long as the holding lasts. It gives admin access only: no
  decide power and no veto.
- Handing a power to the village, or a launch selection, waits for a second,
  different signer whenever two or more people may sign. The five riskiest
  powers ask each signer to confirm twice.
- After launch, saving a keystone secret in Admin, Integrations waits for a
  second person's co-sign, or for a cooling-off pause when nobody else can
  co-sign.
- **The setup game** at `/setup-game` plays the village's real setup, starting
  with email, for founders and admins.
- **Every village's pages are its own.** The journey pages, How We Govern, the
  path and stage words and Circles start neutral in a new village, and a new
  village starts with an empty Command Centre. An established village keeps
  the words it shows today.
- **Agents:** the Operations agent and the organisational memory's agent hold
  accounts of their own, which never hold a seat. A member can connect
  Claude's custom connectors to the village, through an OAuth 2.1 sign-in and
  a connector that runs every tool through the member's own access.
- **Village Tokens:** Admin, Tokens names each token and says what it means in
  the village's own words, and a badge's multiplier names the token it
  multiplies.
- **The connector:** its switch is first in Game Mechanics, and a panel walks
  a member through adding it to their Claude after they save a key. Behind one
  village switch, `agents.lead_approved_writes`, a person's approval lets an
  agent write role-card words, org drafts, seatings and a few wording
  switches. Every approval carries the person's note and is recorded in Admin
  and in Sera. Erasure, money, members, personal data and secrets are never
  open to an agent.
- Every page paints from the palette set in Admin, and the role card and the
  night sheet re-theme live.
- Four more keys have a slot under Admin, Integrations: the Hypha voice
  secret, Google sign-in's client pair, the channel crash alerts go to, and
  the satellite provider the village chooses.
- **A language selector** in the top banner and on every page without the site
  header. The catalogs are served by the village, and a ratchet counts any
  hardcoded English.
- An admin can export the whole village with the admin password. The launch
  vote document names the admin doors that close, and the launch row
  `site-address` waits for `FRONTEND_URL` (below).

**Quests, building and the investor path**

- A next-step box follows every claim, and both ways to claim pass one gate.
  A quest that asks something of the body says so: skill badges gate tools,
  heights and machines, and a member says their age band once. Minimum ages
  are an opt-in setting and off by default. Roles open to every character
  show again, and the Module Library has the builder's journey as a section.
- **The investor path** keeps what a village offers, who raised a hand, what a
  person said yes to, and when a home or a parcel changed hands, in words and
  dates and with no amounts, which stay in the ledger. Two badges, Homeowner
  and Neighbour, come with it.

**Value and work**

- **Invoice rails (#975, #991).** An invoice is followed from sending to
  approval to payment, and the Treasury card syncs read-only. The email that
  carried an invoice is recorded without its body or attachment.
- **The valuation engine.** It gives a suggested figure for a piece of work, and
  the figure a person sets is saved beside that suggestion. Each saved version
  of the village's model is kept.
- **The pricing desk.** A page at `/pricing` for whoever holds the pay-setting
  power. The server refuses everyone else.
- **Budgets.** The Treasurer uploads a cash budget in Admin. It is kept line by
  line, with each import, a note per period, the sources it comes from and an
  envelope per circle.
- **The price kept at claim (#1000).** A claim keeps the terms the quest had
  when it was taken.
- **Earned Equity's three rules switched on, amount blank (#892, #896, #992).**
  A running village has each of its three rules queued to go on from the next
  cycle with no amount written. A rule the village already switched on, or
  already has a change queued for, is left alone.

**Finding your way**

- The words on every page were rewritten so the village guides a member
  through it like a game, and **the Trail** shows a member their next step on
  every page.
- A **Start here** card on the profile shows the one next step to membership,
  a quest or a seat. **My tasks** is in the menus, a notice opens its task,
  and It's done works from the bell.
- **Role cards:** each seat has a card on `/roles`, `/circles`, the setup
  wizard and `/review`, and `/roles?seat=<id>` opens one seat's card.
- The menus are regrouped under Village and Decide, and the Module Library is
  on the bar.
- Joining: the Love Letter's thank-you says what happens next, a signed-in
  request to join names its account, and a yes to a request stops the "still
  with us" emails. The Love Letter is a member's door, and no one is a Member
  before it.
- The village pulse is in plain words, with no setting keys or stage lines in
  public.

**Look and feel**

- A design rule, with a gate, holds the joining flow to the profile's look.
  The pages where people decide sit in the night world, empty states give one
  door, the 404 is in the night world, tap targets are 44px, and nature art
  (fireflies, the Seed of Life, fern, moon) replaces white-framed characters.
- Pages download less: eight font families are served from one variable file
  each, and long text moved out of the lazy chunks.

**The Journal**, for villages that turned it on: an entry is shared with the
village's organisational memory, under code-names, unless its author keeps it
private. **Nothing leaves the village in this release.** The connection is not
built yet, so the village only records what would cross. An entry written
under 1.2.0 keeps its setting, and one its author marked `internal` or `clear`
then now counts as shared. The Journal has a door on the member's profile.

**The Living Map:** a second round of QA fixes (79 of the 80 confirmed
defects), the village's own circles and seats drawn live, crown bar chips the
founders choose, a blank slate for a village with no published map that its
founder's agent can draft from the masterplan, and a treasury chip for
members.

**Saberra villages** get a setup panel, Sync now, seats placed in their
circles, and a polling schedule with a report of each run. Stewards also get
the bridge board as quests on `/modules/saberra`, the outside service's
quests in the quest review queue, a sync health alert, a member's tasks
exported and removed there before that member's erasure, and matching of
members by a keyed hash, which is off by default. Members and stewards read
the service's name as Organisational Memory.

**Security and setup**

- Every page except the Living Map's own artifact sends a content security
  policy: only the village's own scripts run, with Cloudflare's Web Analytics
  beacon. `CSP_MODE` switches it to report-only.
- Sign-up sends a letter that proves the address. A Google sign-in onto an
  account whose password was never proved ends that password, signs its other
  devices out, and tells the member by letter.
- The web server framework (express) moved to 5.3.0, which fixes a critical
  advisory in how it reads proxy addresses (GHSA-jqcg-44mw-7w3h), and two high
  advisories in body-parser (GHSA-27r3-jxmh-p828) and multer
  (GHSA-q7qp-rjg7-q26m) are fixed.
- The public rules feed listed the blockchain RPC address together with its
  key. It now withholds the key. A dedicated Base endpoint is now a sealed
  secret in Admin, Integrations, and a failed chain read no longer writes the
  key into the log.
- The page a member returns to after signing in passes one strict rule
  everywhere, so a crafted link cannot send them outside the village.
- A link the village emails, its sitemap and its calendar address read the
  `Host` header only, never `X-Forwarded-Host`, which a caller writes.
- The tool checker closes IPv6 routes to private addresses. The public form
  doors decide an attachment by its bytes, and one address is heard three
  times a day. A cookie sent twice signs nobody in, and signing in is not
  being admitted: the named ballot roll is for voters. A seat's journal reads
  to members with no names in it.
- A ledger that does not add up at boot shows a page, not a 502. A call to
  the outside governance service has a deadline, and a reply has a size.
- A malformed `VILLAGE_SECRETS_KEY` is named, with what is wrong with it,
  before anything else.
- The setup prompt has your AI assistant find the latest release once and use
  that version for the guides, the download and the image.
- Dependency updates, including the test runner, the animation library and
  the PDF reader, with no change a member sees.

### What you must do

- **Pull from the new address.** On one computer with `docker-compose.yml`,
  set `VILLAGE_OS_IMAGE` in `.env` to `ghcr.io/regen-civics/village-os:1.3.0`,
  then `docker compose pull && docker compose up -d`. On a hosting provider,
  change the image to `ghcr.io/regen-civics/village-os:1.3.0` and redeploy.
  Going back to 1.2.0 means naming the old address (`docs/UPGRADING.md`).
- **Answer the timezone row.** Open the Launch Plan before upgrading. If its
  timezone row is not green, choose your zone (or press This is right) on the
  Seasons tab. Otherwise your village runs on UTC from 1.3.0.
- **If a proxy or CDN in front of your village adds a script to its pages,**
  set `CSP_MODE=report-only` before you upgrade. From 1.3.0 a page runs only
  the village's own scripts and Cloudflare's Web Analytics beacon, so any other
  added script stops running. `CSP_REPORT_URI` names an https address for the
  browsers' reports, if you want them.
- **If your village set a blockchain RPC key,** rotate it. Earlier releases
  published it.
- **Set `FRONTEND_URL`.** A village that has not set it cannot put its launch
  vote until it says where it lives, because the server no longer learns its
  address from the first request it hears. A village already launched is
  unaffected.
- **If you do not want connected agents to make approved writes,** set
  `agents.lead_approved_writes` to off in Game Mechanics, Connector. It is on
  from 1.3.0, and opens nothing by itself: a person's approval note is still
  needed for every write.
- **If your village runs the Journal and Saberra together,** tell members that
  a new entry is shared under a code-name unless they keep it private.
- **If you forked the repository,** the licence is now AGPL-3.0-or-later (it
  was MIT), so read `LICENSE` and `NOTICE`, and point your `upstream` remote at
  `https://github.com/ReGen-Civics/village-os.git`. A fork that builds with its
  own Dockerfile or deploy script ships `server/assets/` beside `dist/`, as the
  stock `Dockerfile` does, or the stock character art falls back to sigils.
- Nothing else. The nine new modules stay off until you turn them on, and
  Village Comms asks for its settings when you do. `RESEND_WEBHOOK_SECRET`,
  `PLATFORM_ASSISTANT_OPERATOR`, `BASE_RPC_URL` and `CSP_REPORT_URI` are new
  and optional. Comms Settings can create the webhook and store its secret for
  you, and the Base endpoint can be set in Admin, Integrations.

### Does it touch your data

**Yes. 94 database changes**, applied by the village itself as 1.3.0 starts,
before it answers anyone. Every one adds tables, columns, indexes, rows or
enum values. Three of them add rows to tables 1.2.0 already reads: 0266 (one
token and three system accounts), 0287 (one badge) and 0349 (two badges), and
those rows stay if you go back. None of the 94 rewrites a value you already
have, so going back to 1.2.0 leaves them in place and 1.2.0 ignores them.

**Live Sessions**

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0238_a_circle_holds_a_live_session.sql` | Six tables for Live Sessions | No; 1.2.0 ignores them |
| `0255_a_task_keeps_going_after_the_call.sql` | Three tables for the task board, filled from closed sessions (none, on a village coming from 1.2.0) | No; 1.2.0 ignores them |
| `0264_a_circle_keeps_an_agenda_library.sql` | Two tables: the agenda library, and each time a session took an item from it | No; 1.2.0 ignores them |
| `0271_a_circle_keeps_a_rhythm.sql` | A table of each circle's meeting rhythm | No; 1.2.0 ignores it |
| `0275_a_member_follows_circles_on_their_calendar.sql` | Two tables: the circles a member follows on their calendar, and the key to their calendar address, stored only as a hash | No; 1.2.0 ignores them |
| `0277_a_circle_attaches_its_own_calendar.sql` | A table saying which outside calendar belongs to which circle | No; 1.2.0 ignores it |
| `0279_an_agenda_item_remembers_where_it_came_from.sql` | A table saying which agenda item came from which tension | No; 1.2.0 ignores it |
| `0280_a_decision_names_when_it_is_reviewed.sql` | A table of review dates for decisions | No; 1.2.0 ignores it |
| `0281_a_night_has_an_answer_by_time.sql` | An empty column on `live_session_responses` for the time a member will answer by | No; 1.2.0 ignores it |
| `0284_a_member_asks_a_circle_for_advice.sql` | Two tables for the advice process: each request, and each person asked | No; 1.2.0 ignores them |
| `0288_a_facilitator_fills_in_for_a_member.sql` | A table of every time a facilitator filled in for a member | No; 1.2.0 ignores it |
| `0290_the_room_votes_its_agenda.sql` | A table of agenda votes | No; 1.2.0 ignores it |
| `0291_a_circle_keeps_its_meeting_templates.sql` | Four tables: meeting templates, which sessions used them, a meeting's priorities, and what was shared around a talking stick | No; 1.2.0 ignores them |
| `0292_a_priority_serves_the_season.sql` | Two empty columns naming the season goal a priority or a win serves | No; 1.2.0 ignores them |
| `0297_a_proposal_can_be_checked.sql` | A table of the latest check of each proposal, its words kept only as a hash | No; 1.2.0 ignores it |
| `0298_a_season_goal_keeps_its_name.sql` | Six columns, on tables this release made, that link priorities, wins and agenda items to a season goal by id and tell tensions apart. Its backfill runs at boot (below) | No; 1.2.0 ignores them |

**Village Comms**

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0244_every_email_is_recorded_before_it_is_sent.sql` | Nine tables: every email sent, the address book and its permissions, the stop list, delivery reports, editable words and journeys | No; 1.2.0 ignores them |
| `0245_a_gathering_asks_when_and_remembers_who_came.sql` | Eight tables for gatherings: guest requests, attendance, recaps, feedback and time votes | No; 1.2.0 ignores them |
| `0246_a_path_remembers_who_walks_it.sql` | Three tables: who walks a path, and letters with their recipients | No; 1.2.0 ignores them |
| `0371_an_address_remembers_its_language.sql` | An empty column on `comms_contacts` for the language a person used on the site when they gave their address | No; 1.2.0 ignores it |

**Seats, terms and seasons**

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0256_a_seat_offers_its_terms.sql` | Three empty columns on `org_roles` for the terms a seat offers | No; 1.2.0 ignores them |
| `0257_a_member_applies_for_seats_on_terms.sql` | A table of seat applications, and an empty column with an index on `org_role_assignments` | No; 1.2.0 ignores them |
| `0258_a_member_plans_their_season.sql` | A table of season plans | No; 1.2.0 ignores it |
| `0259_a_member_aligns_with_seat_terms.sql` | Four tables: the words members align with, who must align, each alignment, and its seal | No; 1.2.0 ignores them |
| `0260_aligned_terms_can_end.sql` | A table of how aligned terms end | No; 1.2.0 ignores it |
| `0267_a_player_card_carries_its_own_words.sql` | Three empty columns on `season_plans` (0258) for a member's own words, and a table of how each moon feels | No; 1.2.0 ignores them |

**Roles, circles and the structure**

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0243_a_draft_can_retire_a_circle.sql` | `rest_circle`, a new kind of structure change, in `org_draft_changes`.`op` | No; 1.2.0 never writes it |
| `0268_a_role_carries_its_handover_words.sql` | Three empty columns on `org_roles`: what to bring a role, what it does not hold, and its runbook | No; 1.2.0 ignores them |
| `0269_a_role_hears_a_tension.sql` | A table of tensions raised with a role | No; 1.2.0 ignores it |
| `0270_a_circle_keeps_its_charter.sql` | A table of circle charters, and `update_circle`, a new kind of structure change, in `org_draft_changes`.`op` | No; 1.2.0 ignores the table and never writes the value |
| `0273_a_member_drafts_their_roles_for_next_season.sql` | Two tables: members' drafts of next season's roles, and comments on them | No; 1.2.0 ignores them |
| `0274_a_role_card_speaks_ccos.sql` | Seven empty columns on `org_roles` for the CCOS Role Card sections | No; 1.2.0 ignores them |
| `0276_a_circle_consents_to_a_role_proposal.sql` | A table of the holders asked to consent to a role proposal, and an empty column for the decision in words | No; 1.2.0 ignores them |
| `0286_a_circle_has_a_governance_layer.sql` | An empty column on `circles` for its governance layer. The map stays as it is until somebody sets one | No; 1.2.0 ignores it |
| `0305_a_stranger_can_propose_for_a_role.sql` | Two tables: role proposals from people with no account, and the links made for them | No; 1.2.0 ignores them |
| `0322_a_seat_carries_power_groups.sql` | A table saying which Power group whoever holds an org seat holds. No row is seeded, so no one's powers change | No; 1.2.0 ignores it |
| `0337_sera_snapshots.sql` | A table keeping what the outside governance service holds, whole, after each read | No; 1.2.0 ignores it |
| `0361_a_sera_difference_is_answered.sql` | Two tables for answered differences from the outside service and its links, and two empty columns on `external_proposals` | No; 1.2.0 ignores them |
| `0362_a_role_can_be_listed_and_carry_its_card.sql` | Thirteen empty columns on `org_roles`: whether it is listed, and the parameters of its full card. An unset listing reads as listed | No; 1.2.0 ignores them |
| `0364_an_application_is_reviewed_in_order.sql` | Four tables: the steps of an application, its interviews, their scores and recusals | No; 1.2.0 ignores them |
| `0365_a_new_holder_has_a_path.sql` | Three tables: a new holder's onboarding path, its items and its check-ins | No; 1.2.0 ignores them |
| `0366_a_role_carries_on_by_the_moon_and_its_access_is_tracked.sql` | Two tables: a holder's carry-on for the next moon, and the access a role raises when it starts and ends. No credential is kept | No; 1.2.0 ignores them |
| `0367_a_member_keeps_a_time_zone.sql` | A table of each member's time zone | No; 1.2.0 ignores it |
| `0368_agent_proposals_wait_for_a_person.sql` | A table of what a connected agent proposes, which waits for a person | No; 1.2.0 ignores it |
| `0369_a_member_proposal_keeps_its_answers.sql` | An empty column on `seat_applications` for the answers the member door asks | No; 1.2.0 ignores it |
| `0370_a_role_can_be_always_background_checked.sql` | A column on `org_roles`, 0 by default, marking a role always background-checked | No; 1.2.0 ignores it |
| `0372_a_circle_can_be_the_anchor.sql` | A column on `circles`, 0 by default, marking the anchor | No; 1.2.0 ignores it |
| `0373_a_draft_can_set_a_circles_standing.sql` | `set_circle_standing`, a new kind of structure change, in `org_draft_changes`.`op`. Every old value stays | No; 1.2.0 never writes it |
| `0374_an_agent_can_hold_a_role.sql` | Two empty columns: who may hold a role (a person, an agent, or either) and the member who keeps a seated agent | No; 1.2.0 ignores them |

**Gene Keys and Session Card**

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0272_a_member_keeps_their_gene_keys.sql` | A table of each member's Gene Keys lines and Human Design type. No birth date, time or place | No; 1.2.0 ignores it |
| `0287_gene_keys_find_a_badge_and_a_match.sql` | Two switches on that table, both off until the member says yes, and one badge row, `lines-found`, in `badges`. A village that already has a badge with that id keeps its own | No; the badge row stays, and 1.2.0 does not know the metric it counts by |
| `0296_a_session_pulls_a_card.sql` | Two tables for session cards and each person's line on them, and a switch on `member_gene_keys` | No; 1.2.0 ignores them |
| `0308_a_card_asks_its_own_yes.sql` | A second switch on `member_gene_keys`, off for everybody, and an index on `session_cards` | No; 1.2.0 ignores them |
| `0309_a_member_keeps_their_signs.sql` | Three empty columns on `member_gene_keys` for the Sun, Moon and rising signs | No; 1.2.0 ignores them |

**Value and work**

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0265_work_carries_its_value.sql` | Three empty columns each on `quests` and `org_roles` | No; 1.2.0 ignores them |
| `0266_a_village_earns_equity_it_can_claim_on_hypha.sql` | One token row, `earned-equity`, in `tokens`, and three system accounts in `ledger_accounts` | No; the rows stay |
| `0278_a_badge_multiplies_named_tokens.sql` | An empty column on `badges` naming the token a multiplier applies to. The old `multiplier` column stays | No; 1.2.0 ignores it |
| `0283_a_token_says_what_it_means.sql` | An empty column on `tokens` for what a token means, in the village's own words | No; 1.2.0 ignores it |
| `0285_work_records_the_cash_it_owes.sql` | Two empty columns each on `quests` and `org_roles`, and a table, `cash_owed` | No; 1.2.0 ignores them |
| `0294_a_member_sees_what_landed_once.sql` | A table of the arrivals each member has already been shown | No; 1.2.0 ignores it |
| `0335_an_invoice_is_tracked_to_payment.sql` | Four tables for tracking an invoice from sending to payment and a read-only treasury sync. No email body or attachment is kept | No; 1.2.0 ignores them |
| `0336_a_valuation_is_kept_with_its_working.sql` | Two tables: each saved version of the village's valuation model, and each figure set beside the suggestion it came from | No; 1.2.0 ignores them |
| `0342_a_claim_keeps_the_price_it_was_taken_at.sql` | An empty column on `quest_claims` for the terms a claim was taken at. A claim taken before has none | No; 1.2.0 ignores it |
| `0360_budget_lines.sql` | Five tables: budget lines, each import of them, the sources that feed them, an envelope per circle, and a note per period | No; 1.2.0 ignores them |
| `0383_commitment_percent_as_data.sql` | A column on `quests` (empty), two on `org_roles` (one empty, one 0 by default), and a table of what a member says they can give, kept as a dated history | No; 1.2.0 ignores them |

**Members' own lists, asks and companions**

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0295_a_member_keeps_companions.sql` | Three tables: a member's companions, what each one brings, and each chat | No; 1.2.0 ignores them |
| `0299_a_member_can_ask_another.sql` | A table of one member's asks of another | No; 1.2.0 ignores it |
| `0310_a_member_keeps_their_own_list.sql` | Three tables for Your list: the tasks, their history, and each member's switch, which starts off | No; 1.2.0 ignores them |
| `0311_a_library_person_is_a_member.sql` | Two tables: which organisational memory person is which member, and tasks nobody owns yet | No; 1.2.0 ignores them |
| `0312_a_member_tells_the_library_why.sql` | Five tables for the feedback bridge to the knowledge library, and two columns on tables 0310 and 0311 made | No; 1.2.0 ignores them |
| `0314_a_member_tags_a_task_to_a_role.sql` | Two empty columns on `member_tasks` for a role and a season goal | No; 1.2.0 ignores them |
| `0316_a_task_says_who_asked.sql` | Three empty columns: who asked for a library task, and the role it sits with | No; 1.2.0 ignores them |
| `0320_a_member_is_matched_by_a_keyed_hash.sql` | A table of members the keyed-hash match could not link on its own. No email and no hash is stored | No; 1.2.0 ignores it |

**End-of-Moon Review**

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0313_a_member_reviews_their_moon.sql` | Five tables: `moon_recaps`, `moon_recap_items`, `moon_invoices`, `member_pay_routes` and `moon_review_events` | No; 1.2.0 ignores them |
| `0315_an_approval_can_be_the_members_own.sql` | A `self_approved` mark, 0 by default, on three of those tables | No; 1.2.0 ignores them |
| `0317_a_member_sets_the_next_moons_goals.sql` | A table of moon goals, and columns on recap items and recaps for how each piece of work ended and the score | No; 1.2.0 ignores them |
| `0318_a_moon_keeps_its_rhythm.sql` | Four columns on recap items and recaps, and a table of the reminders sent | No; 1.2.0 ignores them |

**The Journal, accounts, powers and erasure**

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0261_a_journal_crosses_under_a_code_name.sql` | Two tables: members' code-names, and the outbox of what would cross to organisational memory | No; 1.2.0 ignores them |
| `0282_an_erasure_remembers_who_it_is_for.sql` | An empty column on `member_erasures` that holds who an unfinished erasure is for, cleared when it finishes | No; 1.2.0 ignores it |
| `0304_a_member_proves_their_address.sql` | An empty column on `users`, `email_verified_at`. No backfill, so every existing account starts unproved | No; 1.2.0 ignores it |
| `0306_a_second_person_signs_a_keystone.sql` | A table of keystone secrets waiting for a second person | No; 1.2.0 ignores it |
| `0307_a_power_group_can_carry_admin_access.sql` | A switch on `roles`, `grants_admin`, turned on for `founders-circle` and `steward-circle` only | No; 1.2.0 never reads it, so admin access follows each account's own role again |
| `0321_agents_in_the_village.sql` | A column on `users` marking agent accounts, three tables for the connector sign-in and what an agent did, and `sera` added to `sera_person_links`.`how` | No; 1.2.0 ignores them |

**Deciding together**

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0330_a_member_gathers_changes.sql` | Three tables: change requests, the changes in each, and their notes | No; 1.2.0 ignores them |
| `0334_a_quiet_vote_is_asked_again.sql` | Two columns on `ballots`: the ballot a re-run follows, and a switch for the quorum fallback, off by default | No; 1.2.0 ignores them |
| `0379_proposed_changes.sql` | Two tables: a titled group of proposed changes, and each change with what was proposed, the person's edits and what was accepted | No; 1.2.0 ignores them |

**Funding Rounds, Living Places, the Canvas and the investor path**

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0338_the_village_chooses_which_quests_to_fund.sql` | Seven tables: pots, their receipts, rounds, ideas, marks, earmarks, and `interaction_events` | No; 1.2.0 ignores them |
| `0348_a_backer_pledges_to_a_quest.sql` | A table of pledges to a proposed quest | No; 1.2.0 ignores it |
| `0349_investor_path_invitations_and_milestones.sql` | Six tables for what a village offers, who raised a hand, what a person said yes to, and when a home or parcel changed hands, with no amount in any of them. Two badge rows, `homeowner` and `neighbour`, in `badges`. A village that already has a badge with either id keeps its own | No; the badge rows stay |
| `0354_every_place_is_a_living_invitation.sql` | Six tables: places, their zones, stage changes, permits, links and steward claims | No; 1.2.0 ignores them |
| `0356_a_quest_says_what_it_asks_of_the_body.sql` | Three tables: what a quest asks of the body, each member's age band, and the slots of a claim | No; 1.2.0 ignores them |
| `0357_a_village_reads_its_canvas.sql` | A table of every reading of a canvas block, never rewritten | No; 1.2.0 ignores it |
| `0358_a_canvas_answer_can_be_proposed.sql` | Two tables: suggestions for a block's answer, and the Decision Matrix rows | No; 1.2.0 ignores them |
| `0359_a_member_keeps_a_notebook.sql` | Three tables: a member's documents, the files kept whole, and the canvas resources picked | No; 1.2.0 ignores them |

**Once at boot, outside `drizzle/`.** The first time 1.3.0 starts, the server
also makes these changes in its own code, each one once. Some of them do
change what you have:

| Change | What it does | Undone by going back? |
|---|---|---|
| The Base RPC endpoint | With a usable `VILLAGE_SECRETS_KEY`, a dedicated endpoint stored in the `tokens.base_rpc_url` setting is sealed into Admin, Integrations, and the old setting is cleared. Amendment-ledger lines that recorded the key keep the address with the key removed. With no usable key nothing moves | **No.** 1.2.0 reads the cleared setting and uses the public Base node until the endpoint is typed in again |
| Finished erasures | Every member already erased is given the erasure steps added since their sweep ran: their agent token, open invite link, places at gatherings, a vouch for somebody still waiting, a group they owned, a voice handed to them, and an old tombstone's public handle | **No** |
| Power group keys | The seeded Treasury group gets `cash.pay`, `moon.approve_own`, `role.pay` and `pot.steward`, the founders' and stewards' groups get `moon.approve_alone`, and the Steward Circle gets `org.seat`, `org.decide` and `proposal.decide`. A village without those groups gets nothing. `power.assign` is given to no existing village | **No.** The keys stay on the groups |
| Redemption ceilings | A redemption ceiling stored as 0, which meant no ceiling, becomes blank, which is still no ceiling. From now on 0 means zero | **No.** 1.2.0 reads the blank as no ceiling |
| Gratitude's words | Two retired phrases the platform wrote itself ("Earn Gratitude for contributions", "Gratitude Economy") are swapped, character for character, for "See what each quest pays" and "Village Economy". A sentence a person wrote is never touched | **No** |
| An established village's words | A village that already holds page words of its own keeps the path and stage, How We Govern and Circles words it shows today, written into its stored content. A village that used the first Command Centre plan keeps that plan as its own | Harmless either way: these are the words and the plan it already shows |
| The address book and paths | Fills the new Comms tables from members' accounts, form submissions and housing requests, and records who is already on a path. Sends nothing and grants nothing | No; 1.2.0 ignores them |
| Season goal ids | Gives each link 0298 made by words the id those words derive, on tables this release made | No; 1.2.0 ignores them |
| Earned Equity's rules | Each of the three Earned Equity rules that is off and has no change queued is queued to go on from the next cycle, with its amount blank. A rule the village already switched on is left alone | **No.** The queued change stays |

**What the village keeps from now on:** every email it sends is recorded, with
its words, for 18 months by default (`comms.retention_months`). A password
link's words are never stored, and erasing a member clears theirs at once.

The release workflow runs `node scripts/check-migration-compat.mjs --base
v1.2.0` against a populated 1.2.0 database before the image is published.
Take the backup in `docs/UPGRADING.md` anyway.

### For operators

- **The image moved.** `release.yml` publishes to
  `ghcr.io/regen-civics/village-os` from 1.3.0 on, so it can only run from the
  transferred repository. The first publish creates the package under the
  organisation; check it is public with the `curl` in `ops/RELEASES.md`.
- **The pinned `VILLAGE_OS_RELEASE` changes with the version.** The
  regencivics.earth card moves `VILLAGE_OS_RELEASE` from `"1.2.0"` to
  `"1.3.0"` and `VILLAGE_OS_RELEASE_COMMIT` to the commit `v1.3.0` points at;
  the release job prints both (`docs/RELEASING.md`, step 8). For this release
  only, the card's `VILLAGE_OS_REPO_URL` and its setup prompt's raw address
  also change owner, from `Rieki777` to `ReGen-Civics`. Anyone else who pins
  `VILLAGE_OS_RELEASE` moves it the same way, because that number picks the
  starter kit, the guide and the prompt.
- `release.yml` refuses a tag whose `docker-compose.yml` starts a different
  image, because the starter kit carries that file.
  `scripts/setup-prompt-contract.test.mjs` holds the setup prompt's single
  `---` line, which the card's copy button depends on.
- The fleet ledger's home is `ReGen-Civics/village-os-ops`.
- A nightly rehearsal (`.github/workflows/rehearsal.yml`) has five people walk
  the joining path against a throwaway server. It holds no secrets and needs
  GitHub Actions enabled on the repository. `ci.yml` also gains a design-rule
  step and a larger total budget for the built files.
- **A migration statement waits at most `MIGRATION_LOCK_WAIT_SECONDS` (10)
  for its table** and is retried a bounded number of times in the same boot,
  then the boot fails naming the file and the statement, and the next boot
  resumes there (`server/db/migrate.ts`). A lock timeout in a deploy log means
  retry the deploy. Never edit the SQL.
- `scripts/check-migration-sql.mjs` refuses a SQL function no migration has
  run on production, after 0298's `SHA1()` passed every gate and failed a
  deploy. 0298 was shortened on `main` after that and its backfill moved to
  boot; an instance that ran its first six statements resumes it without
  replaying anything (`server/db/migrateShrink.test.ts`). A village on a
  tagged release never ran it.

---

## 1.2.0 (2026-10-03)

**The release that makes a village yours to run.** Village OS is now public,
free and open source, with a setup path anybody can follow on their own
computer or hosting provider, and a new village starts clean instead of
wearing the first village's story.

This is a large release: more than 230 changes on `main` and 60 database
changes since 1.1.0. Read `docs/UPGRADING.md` before you move, take the backup it describes,
and move from 1.1.0 straight to 1.2.0.

### What changed for your village

**Running it yourself**

- **The platform has a name: Village OS.** `/api/platform/info` reports it as
  `product`, and reports the true version, 1.2.0. (Its `platform` field keeps
  its old value on purpose: other villages and the hub match it exactly.)
- **One computer is enough.** `docker-compose.yml` runs the village and its
  MySQL database together, with a volume for uploads. `START_HERE.md` walks
  through it, and `node scripts/fork-init.mjs --compose` writes every setting
  and secret for you.
- **A starter kit on every release page**: the guide, the setup prompt for
  your own AI assistant, the compose file, the settings template and the setup
  script, packaged from the release itself.
- **An AI assistant has one rule.** `AGENTS.md` is its front door: it explains
  each step and runs a command only after you say yes, and secrets never pass
  through it. `fork-init` no longer prints your founder password; you read it
  from `.env` yourself.
- **Claim your village from a phone.** Open `/claim`, type the one-time
  password, set your own. No shell, no curl.
- **A second way to sign in,** with Google, and `FOUNDER_EMAILS` settles the
  founder role on sign-in.
- **Members arrive by invitation.** A member who may vouch makes a one-use
  link from their profile, valid for fourteen days. Anybody else can ask to
  join.

**A new village starts clean**

- **The first village's own story pages are off in every new village**: its
  four journey pages, master plan, team, housing, visit and membership forms,
  rights pages and build history. "/" shows a plain welcome page with your
  village's own name, and the menus, footer and sitemap carry no links to
  them. A village that already served them keeps them (see the data note).
- **Neutral legal and membership wording to start from,** with places for
  your village's name, legal entity, data controller and contact, in
  `server/seeds/templates/`. Nothing applies it for you.
- **Your currency is yours to set.** It no longer defaults to another
  village's, and the Launch Plan asks for it. It asks for your timezone too,
  which still starts on the first village's clock until you choose one.
- **A new village gets artwork made from its own name,** and names its own
  cast: the word for the people who run it (Catalyst by default), and its own
  archetypes.

**Deciding together**

- Proposals from inside and outside the village, delegation that a member
  accepts, terms on every seat, a steward's veto that carries a reason, and a
  village that can hold a power itself so that giving it back is a vote.
- A launch is a proposal that names its stewards, and a village says what it
  is for before it launches.

**Value and work**

- **Every village was losing the first payout of its life.** Fixed. It does
  not recover payouts already missed.
- **Seats pay Village Credits by default,** and Village Credits count in
  hundredths.
- A member can redeem what they hold, a circle can hold its own treasury with
  two caps, and a member is vouched into membership.
- **Two people editing the same list no longer erase each other.**

**Place and people**

- A village can say where its land is, and the Living Map draws its own
  ground. Land parcels, places, photographs.
- A member can open a venture, find their own reservation, say how they are,
  and carry a portrait. Training records what was completed, and a module can
  be marked mandatory.
- Erasure goes further and records how far it got, and a failed update shows a
  page that explains itself instead of a blank error.
- **A Journal module**, off until a village turns it on: a member answers good
  questions in their own words, morning and evening, with a weekly team pulse
  and a kind road for feedback that would otherwise go unsaid.

### What you must do

- **Read `docs/UPGRADING.md`, then take the backup it describes.** This
  release changes your database.
- **Set `FOUNDER_EMAILS`** if your village uses Google sign-in.
- **Check your village's currency and timezone** in the Launch Plan
  (`/journey-to-launch`) after upgrading. A village that never set its
  currency was reading another village's, and now reads blank until it
  chooses.

### Does it touch your data

**Yes. 60 database changes**, applied by the village itself as the new version
starts, before it answers anyone. Almost all of them add tables and columns.
A few correct values that were wrong, and those corrections stay if you go
back to 1.1.0:

| Change | What it does | Undone by going back? |
|---|---|---|
| Ownership token rename | Corrects the token's name and identifier | **No** |
| Seat payouts | Switches the Gratitude payout default off for seats | **No** |
| Brochure pages | Writes `brochure-pages: on` in a database that already has members, so an existing village keeps its story pages. A new, empty database gets nothing, which means off | Harmless either way |

Going back works. Before anything is published, the release workflow applies
every one of them to a populated 1.1.0 database and confirms that every table,
column, type and constraint 1.1.0 needs is still there
(`node scripts/check-migration-compat.mjs --base v1.1.0`). It passed on
2026-10-02, and the tag runs it again before the image is published. Take the
backup anyway.

### For operators

- **The repository is public**, and the internal coordination notes that
  were in it moved to a private operations repository.
  `scripts/check-public-tree.mjs` now fails CI on internal notes, Railway
  hosts and ids, key paths, private keys and home-folder paths.
- The release workflow checks that the tag, `package.json` and
  `PLATFORM_VERSION` agree before it builds, and publishes the GitHub release
  with the starter kit, built with `git archive` from the tag.
- `.github/workflows/selfhost-smoke.yml` walks the compose path from a clean
  checkout on every change to it: boot, migrations, `/claim`, a founder
  account, a restart, and a backup and restore with the exact commands in
  `START_HERE.md`. Run it by hand with a published image to prove a release
  pulls and boots.
- The encrypted database backup must run from a private repository. On a
  public one, anybody can download the artifacts and read the logs.

---

## 1.1.0 (2026-08-31)

The first release you can name and pin.

### What you must do

Nothing. This is the first packaged release. If you are standing a village up
for the first time, `docs/PROVISIONING.md` is the walkthrough.

### Does it touch your data

No. 1.1.0 is the starting point, so there is nothing to migrate from.

### What changed for your village

Before this, there was one way to run a village: deploy whatever was newest
in the source repository at that moment. Two villages deployed on different
days were running different software, and neither could say which. From here
on, each release is packaged once, proved to start before it is published,
and kept available under its own number for as long as anyone needs it.

- **A version number.** Your village runs 1.1.0. Its `/health` page reports
  the exact commit inside that release, so the version and the running
  software can always be checked against each other.
- **An image published for anyone to pull.**
  `ghcr.io/rieki777/village-os:1.1.0`. The package is open by ruling, so a
  village that hosts itself needs no account, no invitation to the source
  repository, and no access token to run it. `ops/RELEASES.md` has the one
  setting that has to be flipped by hand the first time, and the one command
  that tells you whether it has been.
- **A release that was started before it was published.** Every release is
  built, started against an empty database, and asked to serve three real
  pages of the village. A release that cannot do all three is never
  published, so a broken build stops at the workshop door instead of
  reaching thirteen villages.
- **A way to hold still.** A village can stay on the version it is on while
  the rest of the fleet moves. `ops/RELEASES.md` has the two ways to do
  that, one for ReGen-hosted villages and one for self-hosted ones.
- **A shutdown that finishes what it started.** The image runs the server
  under a small supervisor so that a restart asks the server to stop and
  waits for it, rather than cutting it off mid-request.

### What is inside 1.1.0

This is the first packaged release, so the image carries everything the
platform has grown so far. The number is 1.1.0 rather than 1.0.0 because the
platform has been announcing itself as 1.1.0 to other villages for a while
already, on three of its own endpoints. Starting the tags at 1.0.0 would have
meant two different answers to "which version is this", which is the exact
confusion version numbers exist to prevent.

The 1.1.0 contract, which is what other villages and the hub read, adds three
public documents to what 1.0.0 offered:

- `/.well-known/village.json`, the discovery document.
- `/api/public/org.json`, the org structure as data.
- `/org/**.md`, the same structure as readable pages.

Nothing that another village already read changed shape, so a peer written
against 1.0.0 keeps working.

### For operators

- `Dockerfile` at the repository root builds the image. It re-derives the
  server's real runtime dependency list from the built bundle on every build
  and fails if any of it is unresolvable, so the list cannot go stale.
- `.github/workflows/release.yml` publishes it. Pushing an annotated tag
  `v1.1.0` cuts release 1.1.0. The workflow refuses to publish any commit
  that has not already passed the full test suite.
- `railway.toml` now carries a health check, so a deployment that cannot
  serve `/health` is marked failed and the previous deployment keeps serving.
  The timeout is 900 seconds because a first boot applies every migration
  before it listens, which was measured at 228 seconds against a cold
  database.
- `ops/roll.mjs` rolls a release across the fleet in ring order and halts at
  the first village that does not come back healthy. `ops/README.md` has the
  full procedure.
