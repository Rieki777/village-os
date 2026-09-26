# The Season Two test village

A reusable village for regression walks: the BUILT server on a private scratch
schema, seeded through real routes the way a fork is, then walked by a browser
as three people at two widths. Every wave of the Governance Canvas build runs it,
and extends `surfaces.json` when it adds a surface.

It is not a vitest file and not part of CI. It needs a local MySQL or MariaDB, a
built tree and a browser, and CI has none of those in this shape.

## Run it

One command does all three steps and stops the server afterwards:

```bash
node scripts/qa/season-village/boot.mjs --fresh --run seed,check,walk
```

`check` is `walk.mjs --self-check`: it poisons one page with a defect of every
kind the walk looks for (a page error, a console error, a 3000px-wide element,
a brand term, a refused request, a spinner that never stops) plus text and a
path that cannot match and a surface that does not exist, and passes only when
each one is reported. Run it whenever the walk changes; a check nobody has seen
fail is a check nobody knows works.

Or step by step, with the server left running between them:

```bash
node scripts/qa/season-village/boot.mjs --fresh      # terminal 1: stays in the foreground
node scripts/qa/season-village/seed.mjs              # terminal 2
node scripts/qa/season-village/walk.mjs --self-check
node scripts/qa/season-village/walk.mjs
node scripts/qa/season-village/walk.mjs --only journey --roles member --viewports phone
node scripts/qa/season-village/seed.mjs --fresh      # asks the running boot for a new village, then seeds it
node scripts/qa/season-village/boot.mjs --stop
```

| variable | what it does | default |
|---|---|---|
| `TEST_DATABASE_URL` | the database server the scratch schema lives on (read from `.env` when not set) | none: refused |
| `QA_SCHEMA` | the scratch schema | `village_season_qa` |
| `QA_PORT` | the port the server listens on | `38471` |
| `QA_OUT_DIR` | state, tokens, logs, screenshots, reports | the OS temp dir; refused inside the repo |
| `QA_HEAVY_LOCK` | a directory used as a machine-wide lock around the build and the server's life | none |
| `QA_LOCK_OWNER` | the name written inside that lock | `season-village` |
| `QA_BOOT_DEADLINE_S` | how long a boot may take | `300` |
| `PLAYWRIGHT_PATH` | an installed `playwright` package directory (not a dependency of this repo) | `NODE_PATH`, then a plain import |
| `PLAYWRIGHT_CHROMIUM` | a chrome executable, when the one playwright expects is missing | the newest `ms-playwright/chromium-*` |
| `QA_BASE_URL` | walk or seed a server this harness did not boot | the one `boot.mjs` runs |
| `QA_ADMIN_PASSWORD` | the bootstrap password of such a server | the one `boot.mjs` generated |

On a machine shared by several lanes, set `QA_HEAVY_LOCK` to the lock every lane
uses, and `QA_OUT_DIR` to a directory of your own: the OS temp dir is shared, and
Windows Storage Sense empties it.

## The three scripts

**`boot.mjs`** builds only when `dist/` is not the code in the tree (the same
receipts `server/db/distFreshness.ts` reads for the e2e suites, checked again
after the build, because `pnpm build` has exited 0 on this machine with the
server half never built). It refuses a Railway host, a schema named `railway`,
the database `TEST_DATABASE_URL` itself names, and a schema of its own name that
it has no record of creating. It boots `dist/index.js` with the env block of
`server/loop.e2e.test.ts`: scheduler off, every outside service blank, a sealing
key set, and secrets generated per fresh village and kept in `QA_OUT_DIR`. Then
it proves the listener is its own: the port was free before the spawn, `/health`
answers with this dist's build SHA, and `netstat` names the child it spawned.

It stays in the foreground as a supervisor, holding the heavy lock for the whole
life of the server, because on Windows a detached child dies with the job that
started it. `--stop` and `seed.mjs --fresh` reach it through files in
`QA_OUT_DIR/state/control`.

**`seed.mjs`** builds a Season Two project around its first canvas reading, and
writes nothing except through HTTP routes:

- founder 1 by `POST /api/admin/bootstrap`, then `POST /api/auth/set-password`
  with the link it returns;
- the village's name through `PUT /api/admin/brand`;
- a control that a register with no invitation is refused, because invite-only
  is ON by default on a real fork (the test harness turns it off in every
  scratch schema, so no e2e suite sees this);
- founders 2 and 3 and four members, each registered with an invitation
  founder 1 made, founders 2 and 3 then appointed through
  `PUT /api/admin/users/:id/role`;
- admission by vouching: the invitation's arrival vouch plus founders 2 and 3
  make the three a member needs, and the founders admit each other with a
  steward's super vouch;
- a care holder: a member seated in the seeded Trained Practitioners role with a
  term to 2027-03-20, named as the exit policy's restorative intake role, with
  the restorative steps in the village's own words (the other terms stay in the
  platform's words, so the page shows its draft state). A seeded role, because
  a fork with no AI key makes a new capability role only through a
  `role_declare` ballot, and a ballot passes when its window ends and not before;
- governance on for members; a governing purpose statement when
  `/api/admin/purpose` exists; canvas readings when `/api/canvas` exists (seven
  blocks read covering every level from 1 to 5, Purpose read twice, five empty),
  read back afterwards as a member.

Tokens and the generated passwords go to `QA_OUT_DIR/state/tokens.json` with the
facts the walk checks for. Run twice on the same village (a plain restart keeps
it), the second run verifies the sessions and changes nothing. `--fresh` rebuilds the village from nothing, so the
same command always gives the same village.

**`walk.mjs`** visits every surface in `surfaces.json` at desktop (1360x900) and
phone (390x844, touch, with no device emulation, which reports `innerWidth` at a
multiple of the viewport on this chromium) as a visitor, a member and the
founder who holds the canvas pen. For each page, and for each view a button
reveals, it records the HTTP status, console and page errors, failed requests,
horizontal overflow with its widest in-flow culprit, required and forbidden
text, whether the surface exists, and a full-page screenshot. It measures a page
once two reads 350ms apart agree with nothing in flight and no spinner showing,
at rest first and only then after pressing anything. It writes `report.json`,
`summary.md` and `shots/` under `QA_OUT_DIR/runs/<stamp>/`, exits 1 when anything
failed, and always prints how many checks it could not measure.

## Extending it

A new surface is a new entry in `surfaces.json`: an `id`, a `path`, `required`
(false until the surface is built, so a missing one is reported and does not
fail the walk), `text` it must show, `forbidden` text, per-role `expect`, and
`views` for buttons that swap what the page shows. Text is matched without case,
with whitespace collapsed, and `$villageName`, `$restorativeStep`,
`$careRoleName`, `$careHolderName` and `$viewerName` come from the seed.
`$brandTerms` is the BANNED list in `scripts/check-brand-refs.mjs`, matched as
whole words everywhere, so a fresh village showing another village's name fails.
A new seed fact goes in `seed.mjs`'s `facts`.

## What it proves

- The built server boots on an empty schema with no outside service at all,
  and every migration applies.
- A fork's first hour works through the routes a founder uses: bootstrap,
  invitation, appointment, vouching, a care seat, the exit policy, the module
  switch, the purpose statement and the canvas.
- Each surface renders for each role at each width without a page error, a
  console error, a 5xx, or a page wider than the screen, shows the text it must
  and none it must not.

## What it cannot see

- Anything a route does not return and a page does not render: emails (no
  provider is configured), scheduled jobs (the scheduler is off), anything after
  a ballot's window, which only the clock closes.
- A village older than one boot. It never meets data a previous release wrote,
  or a village that has been through its Birthing.
- Contrast, focus order, tap-target size and screen-reader names. `contrast.mjs`
  and `sweep.mjs` beside it cover some of that against a deployed site.
- Surfaces not listed in `surfaces.json`, and states that need more than one
  button press to reach.
- Text drawn in a canvas or an image, and text hidden by CSS: matching reads
  `innerText`, which leaves out whatever is not rendered.
- A defect that only a slower machine or network shows. Settling waits for the
  page to hold still; it does not throttle anything.
- WebKit. The walk drives chromium only.
- A full-page screenshot draws a fixed bar (the phone tab bar, a floating
  button) once, where the first screen had it, so it can sit over the middle of
  a tall page in the picture. That is the capture, not the page.
