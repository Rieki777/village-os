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
a brand term, a refused API request, a spinner that never stops) plus text and a
path that cannot match and a surface that does not exist, and passes only when
each one is reported. It also makes one refused request that its surface lists
in `allowRequests`, which must come back as a warning and not a failure. Run it
whenever the walk changes; a check nobody has seen fail is a check nobody knows
works. `--fresh --run walk` without `seed` before it is refused: a fresh village
has nobody to sign in as.

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
| `QA_OUT_DIR` | state, tokens, logs, screenshots, reports | `season-village-qa-<worktree>-<hash>` under the OS temp dir, one per worktree; refused inside the repo |
| `QA_HEAVY_LOCK` | a directory used as a machine-wide lock around the build and the server's life | none |
| `QA_LOCK_OWNER` | the name written inside that lock | `season-village` |
| `QA_BOOT_DEADLINE_S` | how long a boot may take | `300` |
| `PLAYWRIGHT_PATH` | an installed `playwright` package directory (not a dependency of this repo) | `NODE_PATH`, then a plain import |
| `PLAYWRIGHT_CHROMIUM` | a chrome executable, when the one playwright expects is missing | the newest `ms-playwright/chromium-*` |
| `QA_BASE_URL` | walk or seed a server this harness did not boot | the one `boot.mjs` runs |
| `QA_ADMIN_PASSWORD` | the bootstrap password of such a server | the one `boot.mjs` generated |

On a machine shared by several lanes, set `QA_HEAVY_LOCK` to the lock every lane
uses. The default `QA_OUT_DIR` is already one per worktree, so a `--stop`,
`seed.mjs --fresh` or walk from another worktree cannot reach your village; set
it yourself only to keep the state somewhere Windows Storage Sense does not
empty. The state dir holds the record of which schema this harness created, so
a new state dir meets an existing `village_season_qa` as somebody else's and
refuses it until you pass `--takeover` once (or pick another `QA_SCHEMA`).

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
`QA_OUT_DIR/state/control`. A supervisor killed outright runs no exit handler,
so the lock it held is also recorded in `QA_OUT_DIR/state/lock.json`: the next
boot and `--stop` (with no `QA_HEAVY_LOCK` needed) free that lock when the
recorded pid is gone and the lock still names exactly that pid.

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
- the conflict door's promise on the same exit policy: a reply within 48 hours
  and a named contact outside the village, which `/exit-policy` prints and the
  launch checklist's `conflict-door` row reads;
- governance on for members; a governing purpose statement when
  `/api/admin/purpose` exists; canvas readings when `/api/canvas` exists (seven
  blocks read covering every level from 1 to 5, Purpose read twice, five empty),
  read back afterwards as a member; the season file when `/api/canvas/season`
  exists (the template the platform ships, `docs/seasons/season-two-2026.json`,
  loaded by the pen and read back as a member, who may not edit it); one open
  canvas suggestion when `/api/canvas/blocks/power` exists (a member the walk
  does not sign in as suggests words for the Power block, with a purpose line,
  through `POST /api/canvas/proposals`, and the walk's member reads it back
  holding no pen for it).

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
`summary.md` and `shots/` under `QA_OUT_DIR/runs/<stamp>/` and always prints how
many checks it could not measure. A request to `/api/*` that answers 4xx fails
the page (a refusal is how a page loses its data while its headings still
render), unless `surfaces.json` lists it in `allowRequests`. A 5xx always fails.

| exit | meaning |
|---|---|
| 0 | nothing failed and every check was measured |
| 1 | something failed |
| 3 | nothing failed, and some check was NOT measured: a role with nobody seeded to sign in as, or a `$placeholder` the seed did not provide. A walk of visitors only is not a green. `--allow-unmeasured` turns this into 0. |
| 2 | the walk could not run |

It also refuses a server whose `/health` build is not the one `boot.mjs`
started, as the seed does.

## Extending it

A new surface is a new entry in `surfaces.json`: an `id`, a `path`, `required`
(false until the surface is built, so a missing one is reported and does not
fail the walk), `text` it must show, `forbidden` text, per-role `expect`, and
`views` for buttons that swap what the page shows (a view takes its own
per-role `expect` too: the Canvas view requires "Record a reading" of the founder
who holds the pen and forbids it to a member). Text is matched without case,
with whitespace collapsed, and `$villageName`, `$restorativeStep`,
`$careRoleName`, `$careHolderName`, `$canvasReading`, `$seasonName`,
`$seasonWeekTitle`, `$conflictReplyTime`, `$outsideContactName`, `$canvasSuggestion`,
`$canvasSuggester` and `$viewerName` come from the seed. `$brandTerms` is the BANNED list in `scripts/check-brand-refs.mjs`,
matched as whole words everywhere, so a fresh village showing another village's
name fails. A new seed fact goes in `seed.mjs`'s `facts`.

Views on one surface run IN ORDER on the same page, which is never reloaded
between them, so a state two presses deep is reached by two views: journey's
`canvas-power-*` views press "Open this block: Power" and then each of the five
frames' buttons in turn, and each view checks the text its own press revealed.
Give every button such a chain presses a name no other button on the page has.

Require text that only the page's own body renders, from the data it loads
where there is any. The Layout header and footer carry the village's name on
every page, and the Canvas view prints its heading and the credit line whether
`/api/canvas` answered or not, so text like that passes on a page that lost
its content. The Canvas view therefore requires the newest reading the seed
wrote (`$canvasReading`) and "No reading yet" from an empty block, and the
season panel's name and last week (`$seasonName`, `$seasonWeekTitle`), which
render only from `/api/canvas/season`. The season's pen ("Load a different
season file", "Take the season off") is required of the founder and forbidden
to the member, like "Record a reading".

A refused request a page is SUPPOSED to make goes in `allowRequests` (top level,
on a surface, on a view, or under `expect.<role>`), as regular expressions over
`<status> <METHOD> <path>`, for example `"^401 GET /api/profile$"`.

## What it proves

- The built server boots on an empty schema with no outside service at all,
  and every migration applies.
- A fork's first hour works through the routes a founder uses: bootstrap,
  invitation, appointment, vouching, a care seat, the exit policy, the module
  switch, the purpose statement and the canvas.
- Each surface renders for each role at each width without a page error, a
  console error, a 5xx, a refused API request it was not expected to make, or a
  page wider than the screen, shows the text it must and none it must not.
- The canvas readings the founder wrote reach a member's screen, and the pen
  shows for the founder and not for the member.

## What it cannot see

- Anything a route does not return and a page does not render: emails (no
  provider is configured), scheduled jobs (the scheduler is off), anything after
  a ballot's window, which only the clock closes.
- A village older than one boot. It never meets data a previous release wrote,
  or a village that has been through its Birthing.
- Contrast, focus order, tap-target size and screen-reader names. `contrast.mjs`
  and `sweep.mjs` beside it cover some of that against a deployed site.
- Surfaces not listed in `surfaces.json`, and states more than one button
  press deep that no chain of views reaches.
- Text drawn in a canvas or an image, and text hidden by CSS: matching reads
  `innerText`, which leaves out whatever is not rendered.
- A defect that only a slower machine or network shows. Settling waits for the
  page to hold still; it does not throttle anything.
- WebKit. The walk drives chromium only.
- A full-page screenshot draws a fixed bar (the phone tab bar, a floating
  button) once, where the first screen had it, so it can sit over the middle of
  a tall page in the picture. That is the capture, not the page.
