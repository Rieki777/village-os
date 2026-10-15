# Cutting a release

For the platform team. `ops/RELEASES.md` is the reference for the image, the
channels and pinning, and it is not repeated here. `docs/UPGRADING.md` is what
a village reads. This file is the procedure for turning a commit on `main`
into a release those two documents can honestly describe.

---

## What a release promises

Three promises, and every step below exists to keep one of them.

1. **It starts.** The workflow builds the image, runs it against an empty
   database, and checks that it serves three real pages before it pushes
   anything to the registry.
2. **A village can read what changed,** in words that tell them what to do.
   That is `CHANGELOG.md`, and it is written by hand.
3. **A village can go back.** Starting the previous image over a database this
   release has already migrated must work. That is the expand/never-contract
   rule, and it is the promise most easily broken by accident.

Promise 1 is automatic. Promises 2 and 3 are the work.

---

## The changelog entry is part of the release

An entry that lists commit subjects is not an entry. Every entry answers the
same three questions, in this order, because that is the order a steward needs
them in:

- **What changed for your village.** What is different when they open it.
  Never a module name, never a file path, never a commit subject.
- **What you must do.** A setting to add, a value to check, a decision to make.
  Write "Nothing" when it is nothing. An empty heading reads as an oversight.
- **Does it touch your data.** Whether the release reshapes the database on the
  way up, and for each change **whether going back undoes it**. This is the one
  a steward reads twice, so give it a row per change.

The distinction that matters in the third heading is between a change that
**adds** and a change that **rewrites**. Adding a column is invisible to a
rollback. Rewriting existing values survives a rollback, and a steward who
expected the old version to restore the old values will be surprised at the
worst moment. Say which it is.

Write the entry under `## Unreleased` **as the work lands**, not on release
day. Reconstructing a hundred commits into village-readable prose after the
fact produces a summary of the git log, which is the thing this heading exists
to avoid.

---

## Version numbers

The number tracks `PLATFORM_VERSION` in `server/lib/identity.ts`, which is the
contract other villages and the hub read. Keep `package.json`, the git tag and
`PLATFORM_VERSION` on the same number so a village never gets two answers to
one question.

- **Patch** (1.1.0 to 1.1.1): fixes only. Nothing a peer village reads changes
  shape.
- **Minor** (1.1.0 to 1.2.0): anything added. New endpoints, new fields, new
  features. A peer written against the previous version keeps working.
- **Major**: anything a peer could break on. A field that changed meaning, a
  document that changed shape, an endpoint that went away.

A prerelease (`v1.2.0-rc1`) publishes its own version tag and does not move
`:stable`.

---

## The rollback check, and why it is not covered by CI

**Run this before you tag. It is the one step that is not automatic.**

```sh
# from a clean checkout with full history and tags
git fetch --tags --unshallow 2>/dev/null || git fetch --tags
node scripts/check-migration-compat.mjs --base v1.1.0   # the PREVIOUS release tag
```

It needs `TEST_DATABASE_URL` pointing at a MySQL it may create scratch schemas
on. Without one it exits 1 rather than skipping, which is correct.

### Why the run in CI does not answer this

`.github/workflows/ci.yml` runs the same guard on every push, and it compares
each commit against **the commit before it**. That is the right comparison for
catching a bad migration as it lands. It is not the comparison a release
needs, for a reason that is structural rather than accidental:

**GitHub runs a workflow once per push, not once per commit.** Push twenty
commits and CI runs on the twentieth. The other nineteen are never checked by
anything, and a migration that arrived in one of them was never compared
against anything at all.

Measured on 2026-09-02, over the span between `v1.1.0` and that day's `main`,
using the same query `release.yml` uses to check for a green run: most sampled
commits had no completed successful CI run, and every migration added in that
span landed in a commit that had none. Which migrations a given release
carries is in its `CHANGELOG.md` entry, under **Does it touch your data**.

So on that span the guard was never once asked whether a village on 1.1.0
could roll back from the next release. The rule is written down, the guard
that enforces it is real and good, and the span between two releases falls
through the gap between them.

Running it with `--base <previous release tag>` closes that gap. It asks a
question CI structurally cannot ask, over the span a village actually moves
across.

### Should `release.yml` refuse to publish when this fails

**Yes, and it now does.** The `rollback` job runs the guard against the
previous release tag and the `image` job will not start without it.

This is deliberately not a second copy of CI's verdict. `release.yml` carries
no copy of the test suite, on purpose, and its own header explains why: a
copied gate drifts, goes green on a suite that quietly lost a step, and nobody
finds out until it has shipped to thirteen instances. The rollback job does
not re-ask CI's question. It asks the one question that only exists at a
release boundary, against a base ref that only exists at a release boundary,
and there is nowhere else it could be asked.

Two consequences to expect, both intended:

- **The first release after this lands may fail this job,** because of the
  unverified migrations above. That is the check finding real work, not the
  check being wrong. Run the command by hand, read what it reports, and fix
  forward.
- **A genuine one-way change still needs a waiver.** The guard honours an
  inline `-- compat-ok: <reason>` in the migration file. `0125` already carries
  one. A waived migration still has to be written up under **Does it touch your
  data** with "going back does not undo this", because the waiver silences the
  guard and not the consequence.

---

## The procedure

1. **Get the commit green.** CI has to have passed on the exact commit you are
   about to tag. The workflow asks GitHub whether it did and refuses to publish
   if it did not.
2. **Run the rollback check by hand** against the previous release tag, as
   above. Doing it here rather than discovering it in the workflow saves a
   round trip.
3. **Finish the changelog entry.** Move `## Unreleased` to `## <version>
   (<date>)`, add a fresh empty `## Unreleased` above it, and confirm all three
   headings are answered. Read the entry as though you run a village and have
   not read the code.
4. **Set the version** in `package.json`, `PLATFORM_VERSION` in
   `server/lib/identity.ts`, and the default image in `docker-compose.yml`
   (`ghcr.io/regen-civics/village-os:<version>`) to the same number, and the
   image named in `START_HERE.md` part B. The workflow refuses a tag that the
   first three disagree with, because the starter kit carries the compose file
   and a kit that starts an older image is a release that lies.
5. **Tag and push.**

   ```sh
   git tag -a v1.2.0 -m "village-os 1.2.0"
   git push origin v1.2.0
   ```

6. **Watch `.github/workflows/release.yml`.** It verifies the commit is green,
   runs the rollback check, builds, starts the image against an empty database,
   confirms `/health` reports the tagged commit, confirms three real pages
   answer 200, and only then pushes to the registry. A failure at any of those
   is the system working.
7. **Roll it out** with `ops/roll.mjs`, `plan` first. `ops/README.md` has the
   procedure and what to do when a ring halts.
8. **Tell the regencivics.earth card.** The "Run it yourself" card on
   regencivics.earth/village-os links this release's starter kit and guide,
   and its "Copy the setup guide" button reads `docs/FOUNDER_SETUP_PROMPT.md`
   at a pinned commit. Both are two constants in the hub repository,
   Rieki777/ReGenCivics.Earth (its villageOsOffer module): give whoever holds
   that card the new version
   and the commit the tag points at (`git rev-parse v<version>^{}`). The
   release job prints both in its summary. The card copies the text below the
   prompt's single `---` line, so the prompt keeps exactly one;
   `scripts/setup-prompt-contract.test.mjs` holds that.
9. **Tell the villages.** Nothing notifies them. There is no email, no banner
   and no update check, so a release nobody announces reaches only the villages
   the platform team hosts. Self-hosted villages find out by running the
   command in `docs/UPGRADING.md` Step 2, whenever they think to. Anything
   urgent goes in `docs/SECURITY_ADVISORIES.md`.

---

## What is still missing

Written down so it is not rediscovered.

- **Villages are not notified.** Step 9 is a person remembering. A village that
  has left the fleet has no channel at all beyond polling the registry by hand.
  The cheapest fix is a published document naming the current version that a
  village can poll, or the village checking the registry itself and showing its
  steward a notice.
- **Tags are immutable by convention only.** Deleting and re-pushing a git tag
  would overwrite the image at that version, and nothing prevents it. GHCR does
  not enforce tag immutability. Treat a published version as final by hand.
- **Commits reach `main` without CI.** See the measurement above. The release
  gate checks the tagged commit and the release span, so the release path is
  covered. The commits in between are not.
