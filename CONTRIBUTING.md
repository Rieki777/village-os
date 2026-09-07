# Contributing to game-amora

This is a white-label village-coordination platform. One codebase runs every instance, and each
village gets its own database, domain and environment. `README.md` routes by why you are here;
`docs/ARCHITECTURE.md` is the system map.

## Canonical contributor guide

The unified contributor system for all three Rieki777 repositories lives in
[`Bioregional-Infinite-Game`](https://github.com/Rieki777/Bioregional-Infinite-Game). It covers
the shared flow for human and AI contributors: Git trailers for AI attribution, the Hypha
governance proposal draft that fires after a PR merges, and the OSS adoption strategy. This file
is the repo-specific overlay: it carries the gates, invariants, and conventions that are unique
to village-os. Read the canonical guide first when the question is about the contributor system
itself; read this file when the question is about this codebase.

Read this file before you open a pull request. The contribution model here is unusual on purpose,
and the parts that surprise people are in the first section.

## The thing to understand first

**Every module is first-party code in this repository. There is no plugin runtime, and there is not
going to be one.** A module you write is merged into this repository, reviewed here, and shipped to
every village as part of the platform. It is not loaded from anywhere else and it is not installed
into a running instance.

**Modules ship only by pull request to this repository.** No side-loading, no zip file, no private
registry, no "install this in your fork" instruction outside the normal upgrade path.

**Review at merge is the entire security boundary.** Your code runs inside every village's own
server process, with that server's database credentials and that server's network access, in
communities that never met you. There is no sandbox to fall back on. That is why clause 13 of
`docs/MODULE_LIBRARY_CONTRACT.md` makes a human security review required before merge rather than
optional after it, and why `.github/CODEOWNERS` routes the review to a person.

The automated gates are the mechanical half of that review and they are honest about their reach:
they check shape, documentation, and statically detectable code patterns. They cannot read intent.
A pull request that is green has passed the machine half and none of the human half.

## Getting a development environment

Do not follow instructions from this file. Follow `docs/modules/HOW_TO_START_A_SESSION.md`, which is
the ordered walkthrough from nothing to a working checkout: fork, clone, `upstream` remote, Node 22,
`corepack enable`, `pnpm install --frozen-lockfile`. It is kept current by the people who change the
code. Restating it here would create a second copy that goes stale.

Two things from it worth repeating because they cost people a session:

- **Use Node 22.** It is pinned in `.node-version` and CI runs it. A newer local runtime builds
  green and goes red in CI with no local signal at all. `CLAUDE.md` has the write-up.
- **A database is optional to start, but you have to say so.** Without `TEST_DATABASE_URL` a
  whole `pnpm test` now exits non-zero and names the 91 files it skipped, because a skipped
  third that exits 0 is indistinguishable from a pass. Run `ALLOW_NO_TEST_DB=1 pnpm test` for
  the smaller suite, and read the skip count as the result.
  `docs/FORK_RUNBOOK.md` covers provisioning a database when you want the rest.

If you are standing up a village rather than changing the platform, you want `docs/PROVISIONING.md`
instead, and `README.md` has the other doors.

## The gates

**They are enforced, not advisory.** `.github/workflows/ci.yml` runs the same list on every push to
every branch and on every pull request, and a red gate blocks the merge. Several of them exist
because a specific bug shipped and the gate is what stops it shipping twice.

**Get the list from the repository, never from a document:**

```
node scripts/module-facts.mjs
```

That prints the gate commands in the order CI runs them, read straight out of the workflow file, so
it is right on the day you run it. Prefer it to any list written down anywhere, including the one in
`CLAUDE.md`.

The shape of it: a typecheck (`pnpm check`), a typecheck of the test files, the migration guards,
about a dozen small guard scripts, a build, the test suite, and the bundle budgets. Run them cold.
`CLAUDE.md` explains what each guard is protecting.

Three notes that catch people:

- **Read the exit code, never the last line.** `scripts/check-brand-refs.mjs` prints a blank last
  line on failure, so `tail -1` reads as clean.
- **Build before you test.** `server/loop.e2e.test.ts` boots the built `dist/index.js`, so a stale
  build tests stale code. It is also order-dependent: run whole files, never `vitest -t`.
- **Read the bundle numbers off the push run, not the pull request run.** A `pull_request` run
  builds your branch already merged with main, so it carries other people's work. Both runs are
  worth having and they measure different trees.

## House writing rules

Language a member reads follows the house rules, and two scripts enforce them:

- `node scripts/check-voice.mjs` parses every file with the TypeScript compiler and reads only real
  copy: JSX text, string literals, template literals, and the string values in `server/seeds/**`.
  Comments, identifiers and class names are invisible to it. The rules are no em-dashes or
  en-dashes, no contrast framing, no AI filler vocabulary, no rhetorical-question openers used as
  filler, no passive inspiration.
- `node scripts/check-hyphen-dash.mjs` catches the workaround: deleting the dash and keeping the
  hyphen, which passes the voice guard because the character is legal and ships glued compounds
  onto public pages.

Hyphens are fine. A comma, a period, a colon, or a rewrite is the answer to a dash.

A genuine false positive takes an inline `voice-ok: <reason>` on the line. Waivers are counted and
printed so they stay honest, which means a reviewer will read yours.

Beyond the scripts: plain language, written for community members as well as developers. Say the
specific thing. The documents in `docs/` are the register to match.

## Migrations

Thirteen founder instances run one image and apply `drizzle/*.sql` at boot, fail-loud. There is no
separate migrate step and no approval. A bad migration is not a failed deploy, it is a village that
cannot start.

**Expand, never contract.** A migration may add. It may not take away. Rolling one release back over
an already-migrated database has to work. `node scripts/check-migration-compat.mjs` enforces this
and `CLAUDE.md` carries the table of what is safe in one release and what needs two.

**Numbering, in order:**

1. Claim the number in `SEASON2_FLEET_LEDGER.md` section 3 before you create the file.
2. Confirm with `node scripts/check-migration-numbers.mjs --next`.
3. Numbers only go forward. A gap is never filled, because some branch or some instance may still
   hold a file with that name.

**9000 and above is reserved for migrations a village writes for its own instance.** Upstream never
takes a number in that band. The runner sorts by filename, so `9001_` sorts after every upstream
number that will ever exist and a village's own migration always runs last. CI fails this repository
if any file here reaches 9000. A fork adding its own runs the same script with `--village`.

**A shipped migration file is never edited.** The applied ledger keys on the filename and stores no
checksum, so an instance that already ran the file will never run the new body while a fresh
instance gets it, and the two databases diverge with no error anywhere. Fix forward with a new file.

Keep `--` comments on their own lines and never end one with `;`. The runner splits statements on a
line-final semicolon and a comment ending in one once cut a statement in half.

## What makes a module proposal likely to be accepted

The contract is `docs/MODULE_LIBRARY_CONTRACT.md` and the reviewer's checklist is published at
`docs/modules/REVIEW_CHECKLIST.md`. Read the checklist before you write a line: most of its security
section is things you can simply avoid doing, and knowing that in advance is cheaper for everybody
than finding out at review.

What the accepted ones have in common:

- **One capability, in one sentence, without marketing words.** That sentence is stage 0 of the
  listing process and it gets reused in the catalog and in the review. If it needs two sentences it
  is probably two modules.
- **One domain, with the write surface enumerated table by table.** "It syncs" is not a write
  surface.
- **A data classification that is the widest thing the module holds**, and, where it holds member
  personal data, a working hard-delete that confirms by reading back and getting nothing.
- **Real captured payloads, one per operation.** Documentation is not evidence.
- **Graceful absence.** When your service is unavailable, the connector reports unavailable and the
  rest of the village keeps working. No village-facing surface may depend on a read from you to
  render.
- **No new dependencies**, or one dependency with a stated reason and what `npm view <pkg> type`
  returned. CI runs Node 22 and dev boxes often do not, so an ESM-only package needs a CI run before
  it is believed.
- **An honest checklist.** An unticked box with a sentence saying why costs you nothing. A ticked
  box that turns out to be untrue is the fastest way to lose a reviewer, and it is the one thing
  that sends a listing back to the start.

Anyone can build a module. A free module that touches no member personal data needs a name and a
contact address, and nothing else: no company, no jurisdiction, no terms URL. A module that charges
money, or whose data class is `member-pii`, needs a named human who signs. An individual is a valid
counterparty and a company is never required.

Start at `docs/modules/START_HERE.md`, which routes to everything else, and spend most of your time
in `docs/modules/BUILDING_A_MODULE.md`. Run `node scripts/validate-module.mjs <module-id>` and then
the same command with `--diff`. Read the validator's closing list of what it cannot check.

Open the pull request with the module template:

```
https://github.com/Rieki777/village-os/compare?template=module-listing.md
```

## Changes that are not modules

Most contributions are not modules. A bug fix, a copy correction, a doc that has gone stale, a test
for something that was only ever checked by hand: all of these are ordinary pull requests and none
of them need the module template.

The same gates apply, the same writing rules apply, and the same migration rules apply. Keep the
diff to one thing. A pull request that fixes a bug and also renames four files is two reviews
wearing one hat.

Commit messages follow `type(scope): subject` with a body explaining why. Match the log.

## Review capacity is finite, and here is what that means

One maintainer reads the human half of every review today. `.github/CODEOWNERS` says so in its own
comments, including why "require review from code owners" is deliberately off until a second name is
on that file.

The contract promises two things and they are different promises:

- **An automated first response within minutes.** Opening a pull request runs the listing lint, the
  facts check and the documentation link check, and posts a comment naming the first stage that is
  blocking. Most rejections are mechanical and you should not wait days to learn about a missing
  field.
- **Human judgement within ten working days.** A refusal names what would change the answer.

What that budget buys, and what it does not: a small, well-scoped, honestly-documented pull request
gets read properly. A large one, or one whose checklist is optimistic, waits behind the small ones
and may be refused on scope alone. If you are about to spend a month on something, open an issue
first and ask whether it will be reviewed. A clear no in week one is worth more than a polite queue.

## Reporting a security problem

Do not open a public issue. `SECURITY.md` has the private route.

Dependency advisories that have been assessed and accepted are listed in
`docs/SECURITY_ADVISORIES.md`, with the reachability argument for each. An unexplained suppression
is worse than no audit, so an entry in `package.json` under `pnpm.auditConfig.ignoreGhsas` without a
matching entry on that page is not allowed.

## Conduct

`CODE_OF_CONDUCT.md` applies to everything in this repository and to every space the project runs.

## Licence

This project is MIT, and the text is in `LICENSE`. By opening a pull request you agree that your
contribution is licensed the same way, to everybody, including every village that forks this code
and runs it on its own infrastructure. There is no contributor licence agreement to sign.
