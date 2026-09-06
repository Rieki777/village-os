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

Work that is on `main` and has **not been published as an image**. No village
is running this. It is written down here as it lands so that the next release
entry is a record rather than a reconstruction.

At the last count there were 174 commits and five database changes waiting
here since 1.1.0. That is a large jump for one release, and it is the reason
`docs/UPGRADING.md` tells you to move one release at a time.

### What changed for your village

- **The first payout of a village's life is no longer lost.** Every village
  stood up so far lost its first payout to a bug in the economy loop. Fixed.
  It does not recover payouts already missed.
- **Seats stop paying Gratitude by default.** Holding a seat now pays Village
  Credits. Gratitude remains available and stops being the automatic choice.
  A confirmed quest's Gratitude is unaffected.
- **The ownership token stops carrying another village's name.** Every village
  booted with the founding village's word on the token that represents
  ownership of its land, in both the name members read and the internal
  identifier. Both are corrected, and the identifier is frozen from here on.
- **Two people editing the same list no longer erase each other.** A whole-list
  save could silently discard another person's change made seconds earlier,
  with both saves reporting success. Nine lists were affected, including tools,
  submissions and milestones.
- **A village can say where it is,** and gets a picture of its own ground under
  the Living Map instead of somebody else's valley.
- **A second way to sign in,** with a Google button, and a founder can claim
  their village from a phone without a shell.
- **A failed update now shows a page that explains itself** instead of a blank
  error, and says that no data was lost.
- **A new village gets artwork made from its own name.**
- **Your village decides what it calls the people who run it.** The default is
  Catalyst, and Admin, Make This Yours takes your own word for it: founder,
  steward, elder, whatever the village says. Every sentence a member reads that
  names one of those people follows. It is a name and nothing else: nobody
  gains or loses any permission, and the admin panel keeps its own name,
  because a place is not a person.
- **One moon number, everywhere.** Dating something now takes one number,
  "Moon 47", counted from your village's own first moon and never reset.
  Screens used to show the moon's place in the lunar year instead, a number
  that went back to 1 every year, so two moons a year apart carried the same
  one. The calendar, the year wheel, the week and month grids and the
  subscribable calendar feed all say the same number now. A village that has
  not set its first moon reads the moon's name and its dates and no number,
  which is the honest answer rather than "Moon 0".

### What you must do

- **Set `FOUNDER_EMAILS`** if you have not. Signing in and holding the founder
  role are settled together now, and this variable is what settles it.
- **Read the data note below before upgrading.** Two of the five changes alter
  information you already have.

### Does it touch your data

**Yes. Five changes, and two of them are one-way.**

| Change | What it does | Undone by going back? |
|---|---|---|
| Migration ledger checksum | Adds a column recording what was in each applied change | Yes, harmless either way |
| Collection versions | Adds a counter per list so a save can tell it is stale | Yes, harmless either way |
| Village land | Adds one row holding where the village is | Yes, harmless either way |
| Ownership token rename | **Changes existing rows.** Corrects the token name and identifier | **No** |
| Seat payouts | **Changes existing rows.** Switches a seat payout setting off | **No** |

Both one-way changes are corrections to values that were wrong. Going back to
1.1.0 leaves the corrected values in place, which is the intended outcome.
Take the backup in `docs/UPGRADING.md` Step 4 anyway.

> **Not yet verified.** These five changes reached `main` in commits that no
> completed test run covers, so the automatic check that proves a release can
> be rolled back has not run on any of them. `docs/RELEASING.md` describes the
> run that has to happen before this becomes a release.

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
