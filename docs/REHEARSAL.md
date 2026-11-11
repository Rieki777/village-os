# The nightly rehearsal

Every night, five made-up people walk the whole joining path on a freshly built server with an
empty scratch database. Each walks once on a phone (390px) and once on a desktop (1280px). The run
keeps a screenshot of every page they reach, captures every email the village sends them, and
compares tonight's screenshots with the last complete run's.

It answers one question each morning: **could a person get all the way through on main last night,
and how did it look and feel on each screen?**

Code: `scripts/rehearsal/`. Workflow: `.github/workflows/rehearsal.yml`. (This is unrelated to the
comms module's "rehearsal inbox", which is a mode for real email.)

## The five people

| id | who | what they do |
|---|---|---|
| `neighbour` | A Spanish-speaking neighbour, sent a link on a messaging app (`es-CR`) | Reads /roles, picks the Land Steward, fills the open proposal form, sends it, opens the confirm link from her email, reads her status page. |
| `professional` | A professional from the newsletter (`en-GB`) | Arrives on /steward, finds a role, opens the Finance Steward's full card, proposes with two terms to talk about, confirms, reads the status page. |
| `member` | An existing member | Opens the member's door (/role-proposals/new), answers each step, adds a seasonal goal when asked, submits for next season and confirms. |
| `steward` | The steward who decides | Opens the professional's proposal, offers different terms (allowance and bonus), saves the revision, then adopts. Checks the applicant was emailed both times. |
| `holder` | The professional again, adopted | Opens the invitation, makes an account, aligns with confidentiality and the terms, checks with the server that nothing still waits before the role starts, reads the profile. |

They run in that order at 390, then again at 1280, because each depends on the one before (the
steward decides the professional's proposal, and the holder is that person adopted). Each width
uses its own people and its own email addresses, and the roles proposed for have two seats so both
adoptions land in an open seat.

The village is invented: "Example Village", four roles, three circles, one season, a
confidentiality agreement, and the two "before your role starts" dials turned on. It is built
through the founder's own routes in `scripts/rehearsal/seed.mjs`. Nothing in it names a real
village or person, and every address is on `example.test`.

## It never touches production

- The base URL must be `localhost`, `127.0.0.1` or `::1`, or the run refuses to start.
- The database must be a schema on a loopback MySQL whose name starts with `village_rehearsal`.
  The run drops and recreates it, so any other name is refused.
- Mail goes to the repository's fake Resend (`server/testkit/fakeResend.ts`). The AI endpoint is
  a stub that answers every call with the same canned draft.
- Every browser request that leaves loopback is aborted and listed in the run's `walks.json`.

`node --test scripts/rehearsal/rehearsal.test.mjs` holds the two refusals and the screenshot diff
to their word.

## Run it locally

You need the built server, the docker MySQL on 3306, and a folder holding Playwright and axe-core.
They are tools of the rehearsal alone, so they stay out of `package.json`:

```
mkdir -p ../rehearsal-deps && cd ../rehearsal-deps
echo '{"name":"rehearsal-deps","private":true}' > package.json
npm install playwright@1.63.0 axe-core@4.10.2
npx playwright install chromium
cd -

pnpm build
REHEARSAL_DEPS=../rehearsal-deps node --import tsx scripts/rehearsal/run.mjs
```

It takes about five minutes. Useful options:

- `--width 390` or `--width 1280`: walk one width only.
- `--only neighbour,professional`: walk only these people (the steward needs the professional,
  and the holder needs both).
- `--keep`: leave the server and its seeded village up afterwards, to look around. The founder's
  token is written to the seed file in the run folder.
- `--baseline <dir>`: compare with these screenshots. By default a run compares with the latest
  complete run in `.rehearsal/runs/`.
- `--save-baseline <dir>`: copy this run's screenshots there, only when every act passed.

| variable | default | what it is |
|---|---|---|
| `REHEARSAL_DEPS` | none (tries a plain import) | the folder with `node_modules/playwright` and `node_modules/axe-core` |
| `REHEARSAL_DB_SERVER` | `mysql://root:ci-test@127.0.0.1:3306` | the MySQL server, without a schema |
| `REHEARSAL_SCHEMA` | `village_rehearsal` | the scratch schema, dropped and recreated each run |
| `REHEARSAL_PORT` | `5871` | the server's port |
| `REHEARSAL_BASE_URL` | `http://localhost:<port>` | the address the browsers use; must be loopback |

Two lanes rehearsing on one machine each need their own `REHEARSAL_PORT` and `REHEARSAL_SCHEMA`.

## Read a run

Each run is a folder under `.rehearsal/runs/<time>/` (in CI, the `rehearsal-<run id>` artifact):

- `summary.md`: start here. In CI it is also the run's summary page.
- `shots/`: one full-page screenshot per page reached, named `<person>-<phone|desktop>-<page>.png`.
  A failed act leaves a `FAILED-<act>` shot of where the person was stopped.
- `diff/`: for each screenshot that changed, the new page faded with the changed pixels in red.
- `emails.json`: every email sent, whole. `walks.json`: every act, page and check in detail.
  `summary.json`: the summary as data. `ai-calls.json`, `server.log`.

**What fails a run** is an act that did not complete: someone could not get through. The summary
names the person, the width and the act, and the exit code is 1 (2 when the rehearsal itself could
not start). A walk stops at its first failed act, because the rest depend on it.

**Everything else is reported and fails nothing, at first:**

- Console errors and failed requests, per person and width. Some are expected today (the password
  re-check before aligning answers 403 first, by design); read `walks.json` for which.
- Sideways scroll on any page.
- Axe violations: contrast, names, labels, landmarks and heading order.
- **Phone findings at 390:** sideways scroll, tap targets under 44px (each reported once per walk,
  so the footer is not counted on every page; inline links in running text are exempt), and a next
  act outside thumb reach: not kept on screen and not in the lower part of the first screen.
- **Desktop findings at 1280:** a journey page whose content spans under 600px with nothing beside
  it, which is a phone column stretched onto a desktop.
- Visual change: a screenshot whose pixels moved by more than 24 of 255 in any channel on more than
  0.5% of the page, or whose size changed. New and gone screenshots are listed too. Dates and ids
  move from night to night, so a small change on a page that shows them is expected; a large one
  is worth a look.

## When a page changes on purpose

The walks follow the pages as they are, with their labels and selectors. A pull request that
changes a page on purpose may stop a walk the next night. Update the act in
`scripts/rehearsal/personas.mjs` in the same pull request, and run the rehearsal locally for that
person before you push. The next complete run becomes the new baseline by itself.

## In CI

`.github/workflows/rehearsal.yml` runs at 04:41 UTC every day and on demand (Actions, rehearsal,
Run workflow). It never runs on a pull request. It boots the same MySQL as `ci.yml`, builds, installs
Playwright and axe-core outside the repository at exact versions, restores the last complete run's
screenshots from the actions cache, rehearses, saves tonight's screenshots for tomorrow only when
every act passed, and uploads the run folder as an artifact kept for 14 days. A first run, or a run
after the cache expired, compares with nothing and says so.
