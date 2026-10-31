# Accepted advisories

`pnpm audit --prod --audit-level high` is a **blocking** CI step. It was
advisory for a long time, behind a note saying "revisit before Block 6
(fiat)". Fiat shipped, three funds-bearing modules went live, and the note
stayed. It blocks now.

Blocking only works if the list of exceptions is short, reasoned, and dated.
Anything on this page is an advisory with **no upstream fix available** that
we have then checked for reachability in this codebase. An advisory with a fix
is never listed here; it is fixed.

The allowlist lives in `package.json` under `pnpm.auditConfig.ignoreGhsas`.
Adding an entry there without adding it here is not allowed. An unexplained
suppression is worse than no audit, because it looks like diligence.

## Currently accepted

**Nothing.** `pnpm.auditConfig.ignoreGhsas` is an empty array, and
`pnpm audit --prod` reports "No known vulnerabilities found" at every severity,
not only at `high`. The gate is green because the production dependency graph
is clean, which is the only reason a gate is allowed to be green.

The array is kept in `package.json` rather than deleted so that the next
addition to it is a one-line diff on an existing structure that a reviewer can
see, instead of a new key appearing in a manifest nobody reads closely.

## What the audit round of 2026-08-31 found

The production graph went from 40 advisories to 0, and the whole tree from 98
advisory records to 6. (pnpm's headline printed 99 and now prints 7; see
"Reading the two counts" below for why its total runs one ahead of the records
it emits.) Three findings are worth keeping, because each one is a way a number
can mislead rather than a package that needed bumping.

### Only five of the 98 could ever have been reached

A count that does not separate these three is anxiety rather than information,
so here is the split as measured on 2026-08-31, before any of the fixes:

| Bucket | Records | What it means |
|---|---|---|
| Reachable from production code | **5** | `express` and its `qs`, `path-to-regexp` and `body-parser`. Express answers every request a village makes. |
| In the production dependency graph, absent from the shipped bundle | **35** | `streamdown` (32) and `recharts` (3). BOTH ARE NOW REMOVED; see below. |
| Dev-only | **58** | Never installed on a village's server. |

Of the five genuinely reachable ones, exactly **one** was a high, and it was
GHSA-37ch-88jc-xwx2, which was on the ignore list behind a stale "no upstream
fix" note. The gate was green over the only production high that mattered.

The 35 in the middle bucket are the reason the raw number was frightening. Both
packages are tree-shaken out completely, and that is measured rather than
argued:

- **`streamdown`** is imported by no file at all. Removing it changed the built
  output by **zero bytes**: `scripts/check-dist-budget.mjs` reported 5660 KB
  block-charged before and 5660 KB after. It cost nothing at runtime and 32
  advisories on every audit.
- **`recharts`** was imported by exactly one file, the `ui/chart` primitive (the path
  is not spelled in full because the file no longer exists and the doc link guard
  resolves every repo path a document names),
  and nothing imports that file. Neither `recharts` nor its `lodash` appears in
  any chunk under `dist/public/assets`, against a control string from React that
  appears five times in the main chunk.

**`recharts` was removed on 2026-10-30**, with the `ui/chart` primitive that was
its only importer and 38 other shadcn files that nothing imported, after Rye asked for
anything unused to go. Those three advisories leave the manifest with it. The
paragraph above is kept because the MEASUREMENT still stands and is the reason
the removal was safe: one importer, itself imported by nothing, absent from
every chunk.

### Both accepted advisories had upstream fixes, and this page said they did not

Both entries removed on 2026-08-31 were dated 2026-07-28 and both said "no
upstream fix". Both were wrong by the time anyone read them again, and neither
became wrong quietly: a fix shipped and nothing re-checked the claim.

- **GHSA-37ch-88jc-xwx2, `path-to-regexp` ReDoS.** The old entry said the fix
  lives in Express 5 and is "a framework upgrade touching every route in
  `server/index.ts`, not a dependency bump". The fix was backported to the
  0.1.x line as **0.1.13**, and `express@4.22.2` asks for `~0.1.12`, which
  admits it. The real cost was a minor version inside Express 4.
- **GHSA-r5fr-rjxr-66jc, `lodash` code injection via `_.template`.** The old
  entry said "4.17.21 is the newest lodash there is". **4.18.0 and 4.18.1**
  both exist, the advisory declares `>=4.18.0` patched, and `recharts` asks for
  `^4.17.21`, which admits 4.18.1 with no override.

An acceptance is a claim about the world on the day it was written. It needs a
recheck date, and neither of these had one. Every entry added here from now on
carries the version that would close it, so a future reader can test the claim
with one `npm view` instead of trusting the prose.

### Two ignore entries were suppressing three advisories

`pnpm audit --prod --audit-level high` printed **"3 high (3 ignored)"** while
`ignoreGhsas` held exactly **two** GHSAs. The third was not a hidden mechanism.
`GHSA-r5fr-rjxr-66jc` is registered against two npm packages, `lodash` (through
`recharts`) and `lodash-es` (through `streamdown > mermaid`), so the registry
returns it as two advisory records with two different ids, 1115805 and 1115806.
pnpm counts records; `ignoreGhsas` matches GHSA ids. One line in the manifest
silenced two rows in the report.

That is worth writing down because the arithmetic is the only warning you get.
If the entries and the ignored count ever differ again, look for a second
package carrying the same GHSA. The way to see it is to empty the array and
re-run.

### A version bump in the manifest can be inert in the lockfile

Raising `express` to `^4.22.2` and running `pnpm install` left
`path-to-regexp` at 0.1.12 and `lodash` at 4.17.21, and the advisory count did
not move. The existing lockfile entries still satisfied the new ranges, and
pnpm has no reason to move a resolution that satisfies. `pnpm update <pkg>` is
what moves a transitive dependency inside a range that already admits the fix.

Check the resolved version in `pnpm-lock.yaml`, never the range in
`package.json`. The range is a permission; the lockfile is the shipped fact.

## What the blocking gate actually covers

`pnpm audit --prod` walks the `dependencies` graph. That is the right graph only
while everything that runs in production is declared there. On 2026-08-31 one
package was not.

`server/index.ts` line 3 is `import "dotenv/config"`, that import survives into
`dist/index.js`, and `dotenv` sat in `devDependencies`, so the blocking gate
never walked it. The Dockerfile already carried a whole stage to copy the
package into the runtime image by hand, added on 2026-08-30 after a `--prod`
image died at boot with `ERR_MODULE_NOT_FOUND`. Its comment says the honest fix
is one word in `package.json` and that the lane which found it did not own that
file. This lane owns it, so `dotenv` is a production dependency now.

It carries no advisory, so no count moved. What moved is the graph the gate
looks at: 312 production packages to 313. A package that runs in production and
is invisible to the production audit is a gate reporting on a tree the product
does not have.

Checked for the same shape elsewhere, with controls: no other devDependency is
imported by anything under `client/src`, `server` or `shared`. `tailwindcss` and
`tw-animate-css` appear in `client/src/index.css` as `@import` directives, and
neither string survives into the 223 KB built stylesheet, so both are correctly
dev-only.

The Dockerfile's `extra-deps` stage and the `COPY` that reads it are now
redundant, as that stage's own comment predicted. Deleting them belongs to
whoever owns the Dockerfile.

## Dev-only advisories: none remain (measured 2026-10-20)

None of the six dev-only advisories this section listed on 2026-08-31 is
reported any more: `vitest` is at 5.0.5 and `@vitejs/plugin-react` at 5.2.0.
On 2026-10-20, at `a5905b4`, the full tree held
two moderates, both dev-only and both with no fix on a line this repository
can take:

| Severity | Package | Advisory | Arrived through | Latest upstream |
|---|---|---|---|---|
| moderate | `esbuild@0.18.20` | GHSA-67mh-4wv8-2f99 | `drizzle-kit@0.31.11 > @esbuild-kit/esm-loader > @esbuild-kit/core-utils` | drizzle-kit 0.31.11 still depends on it; `@esbuild-kit/core-utils` is deprecated and pins `esbuild ~0.18.20` |
| moderate | `postcss-selector-parser@6.0.10` | GHSA-rj75-hqrm-r3gf | `@tailwindcss/typography@0.5.20` | 0.5.20 is the latest and pins 6.0.10 exactly; the fix is 7.1.6, a major |

**Both packages were removed, because neither was used.** `drizzle-kit` had no
config file, no script and no workflow step (migrations are hand-written SQL;
`scripts/run-migration.ts` says why `drizzle-kit push` is not used).
`@tailwindcss/typography` is a plugin Tailwind v4 loads only through an
`@plugin` directive, no stylesheet had one, and the built CSS held zero
`--tw-prose-*` properties. The build after removal was byte-identical to the
build before it for every shipped file, which is the measurement that says
they were dead.

After removal: `pnpm audit` reports 0 at every severity over 539 packages
(was 602), and `pnpm audit --prod` is unchanged at 0 over 309.

Two more cases of the rule the next section ends on: **the cheapest security
fix is a dependency you were not using.** Before accepting an advisory, or overriding a
transitive across a major, check whether the package is load-bearing at all.

The `--prod` gate cannot see a dev-only advisory by design, and a dev
toolchain is still code that runs on every contributor's machine and in CI.
Read the full-tree count too.

## Removed rather than accepted

`streamdown` was the third and largest one, removed on 2026-08-31. It was a
production dependency at `^1.4.0`, it arrived in the initial commit, and **no
file has ever imported it**: grepping `client/src`, `server`, `shared` and
`scripts` for both `from "streamdown"` and `require("streamdown")` returns
nothing, against a control grep for `from "react"` that returns 201 hits in
`client/src` alone. The whole repository mentioned it three times: the
manifest, the lockfile, and this page.

It carried **32 of the 40 production advisories**, through five packages it
pulled and nothing else did: `dompurify` (18), `mermaid` (9), `lodash-es` (3,
including one of the two suppressed highs), `mdast-util-to-hast` (1) and
`uuid` (1). Removing one line took production from 40 advisories to 8 and cut
2107 lines out of the lockfile.

`pnpm` was removed the same day, from `devDependencies`. It was declared twice
with two different versions: `^10.15.1` as a devDependency and `10.4.1` in
`packageManager`. Only the second one does anything, because
`.github/workflows/ci.yml` uses `pnpm/action-setup@v4` with no `version:`
input, which reads `packageManager`. All **23** advisories filed against the
`pnpm` package reached this tree through the devDependency and through no other
path: 11 high and 12 moderate, gone with one line.

`add@^2.0.6` went with it. It is the residue of `pnpm add add`, mentioned once
in the whole repository, in the manifest itself.

`axios` was the first one. It was a direct dependency carrying **thirteen**
high-severity advisories: proxy credential leaks, prototype pollution, ReDoS,
a full man-in-the-middle. It was imported by nothing: not one file in
`server/`, `client/src`, `shared/` or `scripts/` referenced it. Removing it
took the repository from 66 advisories to 34, and from 16 highs to 3.

`nanoid` was the second one, removed on 2026-08-08 in `b65857a`. It carried
GHSA-28wg-ghj8-5hjv (high: a non-secure generator can loop indefinitely), it
was the only unignored high left, and it was what turned this blocking CI step
red. It was a direct production dependency at `^5.1.5` and **no file imported
it**: the whole codebase mentioned it twice, both times in `package.json`
itself. Every id here is generated by hand instead, in the
`prefix-<epoch>-<random>` shape that `recordEvent`, `insertNotification` and
the messaging repo all use.

A bump to the patched 5.1.16 was available and would also have cleared the
gate. Removal is better for the same reason it was better for axios: a package
nothing calls cannot be made safe once, only repeatedly, and this one would
have come back with its next advisory. Two lanes reached that conclusion
independently within three days, which is the sign of a class worth checking
rather than a one-off.

The `tailwindcss>nanoid: 3.3.7` override came out on 2026-08-11, in its own
commit as this page asked. It bound to nothing. `tailwindcss@4.1.14` has no
dependencies at all in the lockfile, so the `tailwindcss>nanoid` selector had
no edge to match from the moment tailwindcss went to v4. Removing it changed no
resolution at all: the entire lockfile diff was the two override lines, and
`nanoid` still arrives exactly where it did, at `postcss@8.5.6 > nanoid@3.3.11`.

It was worth removing because the version it named was the worse one. `3.3.7`
sits below the patched floor of two high advisories that a full `pnpm audit`
still reported: GHSA-28wg-ghj8-5hjv (patched >= 3.3.16) and GHSA-2v37-7h3g-55p8
(patched >= 3.3.17). A dead selector stays harmless only while it stays dead,
and this one pointed at a version carrying both, so a future tailwindcss
release that took a `nanoid` dependency would have activated it straight into
a vulnerability.

**That entry called its own ending correctly.** It predicted that "postcss asks
for `nanoid: ^3.3.11`, a range that already admits the patched 3.3.18, so the
next refresh of that pin closes both on its own". The 2026-08-31 refresh moved
postcss to 8.5.26 and `nanoid` resolved to **3.3.18**. Both advisories are
gone, no override was ever needed, and the prediction is the reason nobody
spent a commit on one.

Worth remembering as a class: **the cheapest security fix is a dependency you
were not using.** Four of them have now been found in this manifest (axios,
nanoid, streamdown, and the pnpm devDependency), and between them they account
for most of the advisory count this repository has ever carried. Before
accepting an advisory, check whether the package is load-bearing at all.

## Reading the two counts

GitHub and `pnpm audit` report different-looking numbers for the same tree, and
on 2026-08-31 the difference was measured rather than assumed. Before that
day's work: GitHub reported 99 alerts (3 critical, 32 high, 56 moderate, 8 low)
and pnpm reported 99 (2 critical, 32 high, 57 moderate, 8 low).

They were looking at **the same 94 distinct (advisory, package) pairs**, with
nothing in either list that the other missed. Set-differencing the GitHub
Dependabot alerts API against `pnpm audit --json` returned empty in both
directions. The severity split differs only because the two tools count
duplicates differently: GitHub opens one alert per resolved vulnerable version,
so five advisories that hit two different resolved versions of `vite` and
`vitest` at once (5.4.x through vitest, and 7.x directly) each opened two
alerts. One of those pairs is the vitest critical, which is why GitHub says
three criticals and pnpm says two.

pnpm's own headline is also one ahead of the records it emits: with the ignore
list empty it printed 99 while `advisories` held 98 objects. That single-record
gap is a pnpm counting artifact and is not a suppressed finding.

The practical rule: **the two tools do not disagree about content.** If they
ever appear to, diff the GHSA sets before theorising about databases. The
number that decides anything is `pnpm audit --prod`, because that is the graph
a village actually runs.
