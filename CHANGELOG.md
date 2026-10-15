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

## 1.2.1 (2026-10-09)

**Village OS moved to the ReGen Civics organisation.** The code is now at
github.com/ReGen-Civics/village-os, and the image is published as
`ghcr.io/regen-civics/village-os`. Links to the old address redirect.

### What changed for your village

- **A new image address.** From this release, pull
  `ghcr.io/regen-civics/village-os:1.2.1`. Releases 1.2.0 and older stay where
  they were, at `ghcr.io/rieki777/village-os`, unchanged and still pullable.
- **The setup prompt follows one release.** The prompt you give your AI
  assistant now has it find the latest release once and use that version for
  the guides, the download and the image, so nothing mixes two releases.
- **The words on every page were rewritten** so the village guides a member
  through it like a game, and **the Trail** shows a member their next step on
  every page.
- **Role cards.** Each seat has a card on `/roles`, `/circles`, the setup
  wizard and `/review`, and a link (`/roles?seat=<id>`) opens one seat's card.
- **The Living Map:**
  - a second round of fixes from a full QA sweep, 79 of the 80 confirmed defects
  - the land draws the village's own circles and seats, live
  - founders choose the crown bar's chips and what each one counts, in Village settings
  - a village with no published map shows a blank slate, and its founder's
    agent can draft one from the village's masterplan for the founder to publish
  - members see a treasury chip
- **Clearer setup errors.** A malformed `VILLAGE_SECRETS_KEY` is now named, with what is wrong
  with it, before anything else.
- **The web server framework (express) moved to 5.3.0**, which fixes a critical advisory in
  how it reads proxy addresses (GHSA-jqcg-44mw-7w3h).
- **Two security fixes in the village itself:**
  - The public rules feed listed the blockchain RPC address together with its key. It now
    withholds the key. If your village set one, rotate it.
  - The page a member returns to after signing in now passes one strict rule
    everywhere, so a crafted link cannot send them outside the village.
- **Saberra villages** get a setup panel, a Sync now button and the service's
  own names for its kinds.
- **Dependency updates,** including the test runner, with no change a member
  sees.

### What you must do

- **On one computer with `docker-compose.yml`:** set `VILLAGE_OS_IMAGE` in
  `.env` to `ghcr.io/regen-civics/village-os:1.2.1`, then
  `docker compose pull && docker compose up -d` (`docs/UPGRADING.md`).
- **On a hosting provider:** change the image to
  `ghcr.io/regen-civics/village-os:1.2.1` and redeploy.
- **If you forked the repository:** point your `upstream` remote at
  `https://github.com/ReGen-Civics/village-os.git`. The old address redirects,
  but it is better not to depend on that.

### Does it touch your data

No. There is no database change between 1.2.0 and 1.2.1.

### For operators

- `release.yml` refuses a tag whose `docker-compose.yml` starts a different
  image, because the starter kit carries that file, and prints the two values
  the regencivics.earth card pins (`docs/RELEASING.md`, step 8).
- `scripts/setup-prompt-contract.test.mjs` holds the setup prompt's single
  `---` line, which that card's copy button depends on.

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
