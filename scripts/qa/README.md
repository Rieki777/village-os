# QA sweeps against a deployed site

Five scripts that drive a real browser. Four run against a real deployment;
`ground-bridge.mjs` runs against the map artifact on disk and needs no URL. They exist because a whole
class of defect is invisible to `pnpm test`: things that are only wrong at one viewport, in one
auth state, after the CSS has actually painted.

They are **not** part of CI. They need a live URL and a browser, and CI has neither.

```bash
pnpm add -D playwright && npx playwright install chromium webkit   # once, not a repo dep

QA_BASE_URL=https://your-deployment.example node scripts/qa/sweep.mjs
QA_BASE_URL=https://your-deployment.example node scripts/qa/contrast.mjs
QA_BASE_URL=... QA_TOKEN=<session token> node scripts/qa/sweep.mjs   # signed-in surfaces
node scripts/qa/selftint.mjs                                          # static, no browser
node scripts/qa/routes.mjs                                            # what will be swept
node scripts/qa/ground-bridge.mjs                                     # artifact on disk, no URL
```

`QA_BASE_URL` has **no default**. A sweep pointed at the wrong site still prints a clean
report, and you would believe it.

| script | what it finds | needs a browser |
|---|---|---|
| `sweep.mjs` | horizontal overflow, broken images, page errors, failing API calls | yes |
| `contrast.mjs` | WCAG contrast from rendered pixels | yes |
| `selftint.mjs` | an element that sets a tint and writes coloured text on itself | no |
| `routes.mjs` | the route list, derived from `client/src/App.tsx` | no |
| `ground-bridge.mjs` | the shell's ground push, and that a village never inherits the seed's coastline | yes |
| `season-village/` | a whole local village: boots the built server on a scratch schema, seeds it through real routes, walks every listed surface as three people at two widths. Its own [README](season-village/README.md) | yes |

---

## Read this before you trust any number these print

Every wrong answer this toolkit has ever given was **an unmeasurable thing reported as a
measured one.** Not one of them raised an error. They all printed a result.

> **A tool's blind spot does not announce itself as a blind spot. It announces itself as a
> result. Anything with a parse, resolve or skip step must report what it could not handle,
> because silence is indistinguishable from success and reads as it.**

That is why every script here prints a NOT MEASURABLE count even when it is zero. If you
change one, keep that line. Six versions of the contrast checker were needed to get here:

| # | The bug | What it reported | What was true |
|---|---|---|---|
| 1 | `oklch()` unparsed, silently skipped | 0 failures | an `h1` at 1.00:1 |
| 2 | `background-image` never read | white on a dark gradient = 1:1, eleven times | readable |
| 3 | alpha never composited | grey on a 5% tint = 1.12:1 | 4.54:1, passing |
| 4 | "gradient anywhere" bail-out, silent | 0 FAIL on a page with a real failure | 57 nodes skipped |
| 5 | leaf-only selection (`children.length === 0`) | every icon+label button unmeasured | — |
| 6 | mobile-only sweep | `hidden lg:flex` never rendered | a defect on every page |

**Still blind, and stated so it is not mistaken for a pass:** an absolutely positioned photo is
a *sibling*, not an ancestor. Text over a hero image reads as white-on-white. Those come back as
NOT MEASURABLE.

### The same shape, outside these scripts

- `vitest` exiting 0 with "1 failed" in the log
- `tsc | head` returning `head`'s exit status
- `pnpm install --frozen-lockfile` exiting 0 over a dangling symlink
- `grep` aborting at exit 134, and the empty result read as absence
- a green suite that **skipped every DB test** for a missing `.env` while still printing a pass
  count — read the skip count and the duration, never the badge
- a state diff that is blind to an element which *starts* in the state being diffed toward: an
  `autoFocus` input reported "no focus ring" because the before and after were both focused

---

## Two structural traps no sweep will catch for you

**A loader whose failure path returns its initial state cannot fail visibly.** `useState(null)`
means both "not fetched yet" and "the fetch failed", so the component holds one value for two
facts and renders the optimistic one forever. Found four times in four unrelated files in a
single day. The check costs nothing: **load the page with the request failing and wait twenty
seconds.**

**A guarantee covers the pairings it enumerates, never the pairings you compose.** The design
system measures its derived colour pairings by name and is correct about all of them; a pairing
assembled in JSX is not among them. Three separate systems reported clean on one 2.53:1 defect
and each was right about its own scope.

---

## Triaging what comes back

Sweeps over-report. That is the correct bias, but it means the numbers are raw:

1. **Read the element before trusting the measurement.** A measurement is evidence about what
   the tool could see, never about what is true.
2. **A fixed element that overflows is usually a symptom.** It is sized to the document, so it
   inherits whatever else is too wide. Chase the in-flow offender first.
3. **A raw tap-target or collision count is not a defect count.** This codebase attaches an
   `::after` expander to small controls, so a 20px checkbox is a 44px target. One sweep reported
   1953 under-sized controls; five were real. Another reported 45 text collisions; zero were.
4. **Check the viewport you did not run.** Mobile-only and desktop-only sweeps each miss a whole
   breakpoint's worth of components.

## If you add a script here

Keep the three properties that make these worth running: **no village's brand** (`scripts/**` is
inside the brand ratchet, and the auth key is read out of `client/src/lib/gameApi.ts` rather
than written down for exactly that reason), **no default URL**, and **a printed count of what
could not be measured.**
