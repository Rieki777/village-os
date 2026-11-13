# Fleet control plane

This directory is the whole control plane for pushing a release across every
village. It is three things and nothing more:

- `fleet.json.example` (or your real `fleet.json`, never committed with real
  secrets in it because it never holds any): the manifest. One entry per
  village, its ring, its health URL, its steward, and its deploy commands.
- `roll.mjs`: the script that walks the manifest in ring order and redeploys.
- This file.

It does not have a database, a UI, or per-village feature flags. If you find
yourself wanting to add any of those, stop and open a new tool instead; this
one stays small enough that one person can read all of it in one sitting.

## The one rule

**The roller halts the whole run at the first village that does not come
back healthy, and it never proceeds past that halt.** Everything else in
this file is in service of that one rule.

## Before you run a rollout

1. Copy `fleet.json.example` to `fleet.json` and fill in every village's
   real `healthUrl`, `steward`, and `deploy.stopCommand` /
   `deploy.startCommand`. Commands run through a shell with your own
   environment already in scope, so reference secrets as `$SOME_TOKEN`
   rather than writing them into the file.
2. Read the "Stop then start" section below before writing those commands.
   A command that does not block until the old process has genuinely
   exited defeats the whole point of this tool.
3. Know the image tag and the git SHA you are rolling. The release lane
   publishes `ghcr.io/regen-civics/village-os` at `:<semver>` plus the moving
   `:stable` and `:edge` tags; whichever tag you pass, pass the exact short
   git SHA (7 hex characters) that tag points at as `--sha`. The roller
   checks the SHA, not the tag name, because the tag can move.

## Running a rollout

Plan first. Plan makes zero changes; it only reads:

```
node ops/roll.mjs plan --tag 1.2.0 --sha a1b2c3d
```

This prints the ring order, which villages are pinned and will be skipped,
which are self-hosted and will only be notified, and a quick current-health
read on everyone else. Nothing is redeployed.

When the plan looks right, apply it:

```
node ops/roll.mjs apply --tag 1.2.0 --sha a1b2c3d
```

Apply walks the same order and, for each regen-hosted, unpinned village:
stops it, starts it on the new tag, and polls its `/health` until the
reported build matches the SHA you gave it, or gives up after a timeout
(default 5 minutes; override with `--timeout-ms`). The instant one village
fails that check, the run stops there. No later village, no later ring, is
touched.

To roll a single village on its own, for example right after clearing a
pin, add `--only <villageId>`.

## Checking one village by hand

`check` is the same health-wait loop `apply` uses, aimed at exactly one
URL, with no redeploy attached. Use it to verify a village before trusting
it in a ring, or to sanity check a health endpoint from your own machine:

```
node ops/roll.mjs check --url https://some-village.example/health --sha a1b2c3d
node ops/roll.mjs check --id founder-canary-a --sha a1b2c3d --manifest ops/fleet.json
```

It prints one line per attempt and ends in exactly one of two words:
`GREEN` (the SHA matched) or `RED` (it never did, with the specific reason
on the last attempt: unreachable, wrong status, wrong SHA, and so on). RED
is also what you get if the URL does not resolve at all, or if the village
answers but with a different SHA than the one you asked for. Neither of
those is ever reported as a pass. See "Proving the failure paths" below for
a runnable demonstration of both.

## Pinning and unpinning a village

A pin is a manual hold. Add one directly to `fleet.json`:

```json
"pin": {
  "version": "1.1.0",
  "reason": "why, in a sentence a steward would recognize",
  "pinnedAt": "2026-08-20T00:00:00Z",
  "expiresAt": "2026-09-10T00:00:00Z"
}
```

A pinned village is skipped by `plan` and `apply`, never touched, never
counted as a failure. The manifest's `maxPinDays` (30 by default) caps how
long a single pin can run: `roll.mjs` refuses to load a manifest where any
pin's window is longer than that, so nobody can quietly write "pin this for
six months" into the file. Re-pin every few weeks instead, each time with
its own fresh reason.

**Why the cap exists, and why it is not just a courtesy:** a village held
back for months accumulates every migration and behavior change that
shipped while it sat still. Clearing the pin then means it jumps straight
from a very old build to the current one in a single step that no canary
ever rehearsed at that distance. Keeping pins short keeps the jump small
enough that a canary a few rings ahead of it actually stood in for it.

To unpin, delete the `pin` field (or set it to `null`) and, before you fold
the village back into the next full-fleet `apply`, run it once by hand with
`--only` so you see it succeed on its own:

```
node ops/roll.mjs apply --tag 1.2.0 --sha a1b2c3d --only founder-wave1-a
```

If a pin's `expiresAt` passes and nobody has re-pinned or cleared it,
`roll.mjs` does not silently start rolling that village. It keeps skipping
it and prints a loud warning, every run, until a human looks at it. That is
deliberate: auto-unpinning on expiry is the same accumulated-jump risk the
cap exists to prevent, just moved to a different trigger.

## Self-hosted villages

Self-hosted villages (`"hosting": "self"`) live in the manifest next to
regen-hosted ones, with the same health URL and steward fields, but this
tool never redeploys them. `plan` and `apply` both print a `NOTIFY` line for
each one instead: currently that means logging it, or, if
`notify.method` is `"webhook"`, posting `{ event: "fleet_release", tag }` to
`notify.target`. A self-hosted village's health never gates the ring; we do
not own its deploy, so we cannot hold anyone else's rollout on it. It moves
when it changes its own pinned tag (for example from `:1.2.0` to the next
release), never by following `:stable`; `ops/RELEASES.md` and
`docs/UPGRADING.md` say how.

## Stop then start, never blue or green

`server/repos/store-db.ts` documents why: its in-memory caches are only
correct because exactly one process writes to a village's database at a
time. A rolling or blue/green deploy, where the old and new process both
run for even a short overlap, breaks that guarantee and can corrupt the
cache. So `apply` always runs `deploy.stopCommand` to completion (and
checks its exit code) before it runs `deploy.startCommand`, and only then
starts polling health.

This tool can enforce the ordering between the two commands. It cannot
enforce what happens inside them. Whatever `stopCommand` you write on a
given platform, it must not return until the previous process has actually
exited, not merely until a stop request was accepted. If your platform's
own "redeploy" primitive does not draw that line for you, do not put it in
`stopCommand`; script the two halves separately.

## When a ring halts

The output tells you which village, its domain, the specific reason
(`stop_command_failed`, `start_command_failed`, or, from the health wait,
one of `unreachable`, `request_timeout`, `http_status`, `bad_json`,
`unhealthy_status`, `missing_build`, `unparseable_build`, or
`sha_mismatch`), and the steward's contact. If `fleet.json` sets
`paging.webhookUrl` (or the `ROLL_PAGE_WEBHOOK` environment variable is
set), the same information is posted there so a human gets paged instead of
only a terminal getting the news.

What to do:

1. Do not re-run `apply` against the rest of the fleet. The halted village
   is still on its old build and every village after it in the order was
   never touched; both are fine where they are.
2. Look at the halted village directly: its logs, its `/health` by hand,
   whatever the reason points at.
3. If the release itself is bad, fix it and start a new rollout from the
   top once a corrected tag exists. The villages before the halt already
   moved to the bad tag; plan to roll them again too.
4. If the village's own deploy target is broken in a way unrelated to the
   release, fix that, then re-run `apply --only <thatVillage>` to bring it
   current before letting it back into a normal ring rollout.

## Proving the failure paths

Two claims this tool has to make good on: a village whose URL does not
resolve reads as a failure, and a village that comes back with the wrong
SHA reads as a failure, never a pass.

Unreachable URL:

```
node ops/roll.mjs check --url http://village-that-does-not-exist.invalid.test/health --sha 0000000 --timeout-ms 6000 --interval-ms 2000
```

Wrong SHA: run a one-line local server that answers `/health` honestly but
with a SHA that is not the one you are asking for, then point `check` at
it:

```
node -e "require('http').createServer((_, r) => { r.writeHead(200, {'content-type':'application/json'}); r.end(JSON.stringify({status:'ok', build:'2026-07-28-wave1-deadbee'})) }).listen(8842)" &
node ops/roll.mjs check --url http://127.0.0.1:8842/health --sha 1234567 --timeout-ms 6000 --interval-ms 2000
```

Both print RED and exit non-zero. Full transcripts of both runs are in the
lane's report to the fleet ledger.

## Rehearsing a halt against fake villages

`check` proves one URL reads correctly. The claim that actually matters is
bigger: that a ring HALTS and that no later village is touched. Rehearse it
with three local servers standing in for three villages, which takes a minute
and needs no real infrastructure.

Write a manifest whose villages point at `http://127.0.0.1:8851`, `:8852` and
`:8853` in three different rings, and whose `stopCommand` and `startCommand`
append a word to a marker file instead of deploying anything. Serve `:8851`
and `:8853` a healthy `/health` carrying the SHA you will pass, and serve
`:8852` either `{"status":"degraded"}` or a healthy body with a different
SHA. Then run `apply`.

What proves the rule is the marker files afterwards, rather than the output:
the first ring's marker exists, the failing village's marker exists, and the
marker for every village after the halt is ABSENT. Run 2026-08-31 against
both failure shapes, the halted village reported `unhealthy_status` and
`sha_mismatch` respectively, `apply` exited 1, and the later ring and the
pinned village were never written to.

Keep the drill manifest outside the repository. `ops/fleet.json` is the real
one and a stray fake village in it is a rollout that skips a real village.

## Node version

Run this tool on the version in `.node-version` (22). On node 25 on Windows,
`plan` and `apply` used to abort at exit with a libuv assertion after their
work was already done and correct, returning 127 instead of their real exit
code. `roll.mjs` no longer calls `process.exit()`, which avoids it, and the
comment above `main()` records the measurement. Anything that reads this
tool's exit code should still be run on a supported node.
