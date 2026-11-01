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

---

## 1.3.0 (not yet tagged)

**Village OS moved to the ReGen Civics organisation, and two new modules
arrived.** The code is now at github.com/ReGen-Civics/village-os, and the
image is published as `ghcr.io/regen-civics/village-os`. Links to the old
repository address redirect. **1.2.0 and every older release stay at the old
image address, `ghcr.io/rieki777/village-os`**, unchanged and still pullable.

59 pull requests landed on `main` since 1.2.0, and together they make 12
database changes. This release was drafted as 1.2.1 and never published under
that number.

### What changed for your village

**Two new modules, both off until you turn them on**

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

**Every village's email**, whether or not Village Comms is on: each email is
recorded before it goes, carries a one-click stop and a preferences page, and
an address that bounces or complains stops being written to.

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

**The village's structure**

- A batch of structure changes, from a person or an outside service, is
  reviewed on the map, its duplicates settled, and accepted as one draft.
- Whoever holds the new decide power publishes that draft, or puts it to the
  village as a vote.
- People can be carried across to a new chart, and the empty old circles
  retired.

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
  with us" emails.

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
circles, and a polling schedule with a report of each run.

**Security and setup**

- The web server framework (express) moved to 5.3.0, which fixes a critical
  advisory in how it reads proxy addresses (GHSA-jqcg-44mw-7w3h).
- The public rules feed listed the blockchain RPC address together with its
  key. It now withholds the key.
- The page a member returns to after signing in passes one strict rule
  everywhere, so a crafted link cannot send them outside the village.
- A malformed `VILLAGE_SECRETS_KEY` is named, with what is wrong with it,
  before anything else.
- The setup prompt has your AI assistant find the latest release once and use
  that version for the guides, the download and the image.
- Dependency updates, including the test runner and the animation library,
  with no change a member sees.

### What you must do

- **Pull from the new address.** On one computer with `docker-compose.yml`,
  set `VILLAGE_OS_IMAGE` in `.env` to `ghcr.io/regen-civics/village-os:1.3.0`,
  then `docker compose pull && docker compose up -d`. On a hosting provider,
  change the image to `ghcr.io/regen-civics/village-os:1.3.0` and redeploy.
  Going back to 1.2.0 means naming the old address (`docs/UPGRADING.md`).
- **If your village set a blockchain RPC key,** rotate it. Earlier releases
  published it.
- **If your village runs the Journal and Saberra together,** tell members that
  a new entry is shared under a code-name unless they keep it private.
- **If you forked the repository,** point your `upstream` remote at
  `https://github.com/ReGen-Civics/village-os.git`. A fork that builds with its
  own Dockerfile or deploy script ships `server/assets/` beside `dist/`, as the
  stock `Dockerfile` does, or the stock character art falls back to sigils.
- Nothing else. The two new modules stay off until you turn them on, and
  Village Comms asks for its settings when you do. `RESEND_WEBHOOK_SECRET` is
  new and optional; Comms Settings can create the webhook and store it for you.

### Does it touch your data

**Yes. 12 database changes**, applied by the village itself as 1.3.0 starts,
before it answers anyone. Every one adds tables, columns or an enum value.
None rewrites a value you already have, so going back to 1.2.0 leaves them in
place and 1.2.0 ignores them.

| File in `drizzle/` | What it adds | Undone by going back? |
|---|---|---|
| `0238_a_circle_holds_a_live_session.sql` | Six tables for Live Sessions | No; 1.2.0 ignores them |
| `0243_a_draft_can_retire_a_circle.sql` | `rest_circle`, a new kind of structure change, in `org_draft_changes`.`op` | No; 1.2.0 never writes it |
| `0244_every_email_is_recorded_before_it_is_sent.sql` | Nine tables: every email sent, the address book and its permissions, the stop list, delivery reports, editable words and journeys | No; 1.2.0 ignores them |
| `0245_a_gathering_asks_when_and_remembers_who_came.sql` | Eight tables for gatherings: guest requests, attendance, recaps, feedback and time votes | No; 1.2.0 ignores them |
| `0246_a_path_remembers_who_walks_it.sql` | Three tables: who walks a path, and letters with their recipients | No; 1.2.0 ignores them |
| `0255_a_task_keeps_going_after_the_call.sql` | Three tables for the task board, filled from closed sessions (none, on a village coming from 1.2.0) | No; 1.2.0 ignores them |
| `0256_a_seat_offers_its_terms.sql` | Three empty columns on `org_roles` for the terms a seat offers | No; 1.2.0 ignores them |
| `0257_a_member_applies_for_seats_on_terms.sql` | A table of seat applications, and an empty column with an index on `org_role_assignments` | No; 1.2.0 ignores them |
| `0258_a_member_plans_their_season.sql` | A table of season plans | No; 1.2.0 ignores it |
| `0259_a_member_aligns_with_seat_terms.sql` | Four tables: the words members align with, who must align, each alignment, and its seal | No; 1.2.0 ignores them |
| `0260_aligned_terms_can_end.sql` | A table of how aligned terms end | No; 1.2.0 ignores it |
| `0261_a_journal_crosses_under_a_code_name.sql` | Two tables: members' code-names, and the outbox of what would cross to organisational memory | No; 1.2.0 ignores them |

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
