# Season 2 Fleet Ledger

Single source of truth for the Season 2 program: take game-amora from one village to a
13-instance fleet, then continue lanes to raise every audit dimension to A.

**Base ref for every lane: `052d0422b5fbeea86e4309822bdc31a0c8b41f72` (main, 2026-08-30).**

Read this before acting. Write to it after landing. Never wholesale-rewrite it; edit by hunk.

## 0 - Program shape (Ruling R1)

13 community founders each get their own instance in about 3 weeks. They are DESIGNING, not
running live communities; real members arrive months later. That sets the priority:

1. A founder must be able to stand an instance up.
2. A founder instance must look like theirs, not like Amora.
3. We must be able to push improvements to all 13 continuously without breaking their work.
4. Member-safety work lands before real members arrive, not before the founders do.

Distribution model: one codebase, one container image, many single-tenant instances.
Nobody forks. Self-host and ReGen-hosted are the same image with a different operator.

## 1 - Rulings register (append only, founder words verbatim in brackets)

- **R1** 2026-08-30. Launch shape. [It's 13 community founders taking the tool to start
  designing their own! They're not going to go live into their community for several months
  as we build it out and improve the code/game together.]
- **R2** 2026-08-30. Hosting split. [Genuine mix, both must be solid] Both the self-host
  path and the ReGen-hosted path ship at launch quality.
- **R3** 2026-08-30. Game shape. [Mostly reskins, 2-3 want more] Reskins ship first;
  game-design-as-data opens right after launch for the outliers.
- **R4** 2026-08-30. Language. [Not at launch, but soon after] Land the cheap half now
  (message keys so new prose stops freezing into English-only history); full extraction after.
- **R5** 2026-08-30. Fork promise. A village may always take the code and its data. What it
  loses by leaving is the guarantee of tested, rolled-out, supported updates. It does NOT
  lose access to source, images, or security advisories, which stay public.

- **R6** 2026-08-31. Coordinator ratification of the ops lane quarantine scope. The ops lane
  asked whether quarantining the `library` module on an escrow reconciliation failure was too
  permissive, since it is a value statement rather than a mechanical one. RULING: the lane is
  right, keep it. Its reasoning holds - a dead process repairs no escrow and takes every other
  module down with it, while switching the library off is the one act that actually stops
  library credits moving. Village-wide ledger conservation and migrations stay fatal, which is
  what the brief asked to protect. This is per-module quarantine working as intended.

- **R7** 2026-08-31. Coordinator ratification of a lane REFUSING part of its brief, with
  evidence. My brief told the ops lane to quarantine four per-module boot assertions. The lane
  refused one: `assertCapabilityHoldingInvariants` has no module to quarantine, and
  `villageHeldCapabilities` already filters every row through TRANSFERABLE before granting
  anything, which the repo's own test at `server/lib/capabilityHolding.test.ts:119-121` proves
  yields an empty list for a bad row. So a bad row grants nothing and locks nobody out, and
  refusing an entire village over it is all cost and no protection. It now records loudly and
  serves. RULING: accepted. The refusal measured something and found my premise wrong, which is
  the behaviour every brief in this program asks for.

- **R8** 2026-08-31. Cross-village value. [Visible in another village, and not spendable they
  would need to trade their village a tokens for village b tokens in a village exchange.]
  So: standing and gratitude earned in one village are VISIBLE elsewhere (a portable reputation,
  carried by signed published summaries and cached reads), and are NEVER spendable across
  villages. Moving value between villages happens only through an explicit exchange trade,
  village A token for village B token. No cross-instance settlement layer, no shared balance, and
  no village's minting decision can ever drain another village's goods.

- **R9** 2026-08-31. Ballot visibility. [Yes ballot details should stay public.] The
  unauthenticated `GET /api/governance/ballots/:id`, carrying voter names, choices, objection
  free text and ruling notes, is a deliberate constitutional position and stays. Closed; do not
  re-litigate. Worth pairing with a member-facing sentence saying so, since people should know
  their reasoning is public before they write it.

- **R10** 2026-08-31. Investor contact routing. [Add a section in admin where new instances can
  add the emails that receive investor requests - this should stay editable and be found right
  next to where they upload investor packet details.] The leads lane hid those controls behind a
  blank config field; this ruling says give founders a real editable home for them, adjacent to
  the investor packet upload.

- **R11** 2026-08-31. Docker. [Download docker if you need it!] Authorised, so the container
  image can actually be built and booted rather than remaining reviewed-but-unexecuted.

- **R12** 2026-08-31. The rebrand is a TEST OF THE FOUNDER PATH. [I leave the rebrand to trying
  out what any new instance will. So I'll give the brand kit and see if that route is working to
  set up all the branding for amora.] Consequence for the programme: Amora's rebrand is now an
  acceptance test of the kit lane's work. If the founder cannot brand Amora through the admin
  surfaces alone, that is a fork-ability defect, not a founder problem.

- **R13** 2026-08-31. BACKUP RECOVERY KEYS ARE PER VILLAGE AND THE PLATFORM MUST NEVER HOLD ONE.
  The founder asked whether the recovery key should be downloadable by village founders from a
  link we expose. It must not be, and the reasoning is load bearing:

  1. The key generated on 2026-08-31 is AMORA's, not the platform's. Each village needs its OWN
     keypair. One shared key would mean any village that can read its own backups can read every
     other village's, and a single leak exposes all thirteen databases at once.
  2. If we can serve the private key from a link, then we hold it, or held it. A platform that
     holds every village's recovery key can decrypt every village's backups, which defeats the
     entire purpose of encrypting them. It would also make ReGen a processor of every village's
     member data in the strongest possible sense.
  3. This is exactly why the drill uses a SEPARATE CI-only keypair: so the real recovery key
     never enters our infrastructure at all. Exposing a download would undo that on purpose.

  CORRECT SHAPE, and it is work this programme still owes: the keypair is generated ONCE at
  provisioning, on the founder's own machine, shown once, and never stored by us. It behaves
  like a wallet seed phrase or a two-factor recovery code. `scripts/fork-init.mjs` already
  generates other secrets with `crypto.randomBytes` and is the natural home. What the platform
  MAY expose is the public half, instructions, and a way to verify a village's own backups
  decrypt. Never the private half.

  WORK ITEM, not yet built: extend `fork-init.mjs` and `docs/PROVISIONING.md` so each village
  generates its own recovery keypair, sets the public half as its CI secret, and is told plainly
  that losing the private half makes every future backup unreadable. Until that exists, the
  thirteen villages have encrypted backups only if somebody does this by hand for each of them.

### R14 - A move is not a raise: extraction lanes MAY lower a per-file gray baseline

RAISED BY: the arch-admin lane, as a DECISION NEEDED rather than an assumption. Correct call.

THE BLOCKER, as the lane measured it: `scripts/tailwind-gray-baseline.json` is per file, and a
new file starts at zero. Moving a `text-gray-*` class out of `Admin.tsx` into a new component
therefore fails the gate even though the repo-wide total is unchanged. Proven with a throwaway
probe file carrying one `text-gray-500`: exit 1, "baseline allows 0".

WHY IT CAPS THE LANE HARD: of the 42 tab components in `Admin.tsx`, exactly ONE carries no gray
class, and that is the one already extracted. The other 41 carry 4 to 39 each and hold 9,414 of
the remaining 11,029 lines. That is 85% of the file locked behind this.

RULING: an extraction that leaves the repo-wide total unchanged MAY run
`node scripts/check-tailwind-gray.mjs --update-baseline` as part of the same commit. This is not
a widening of the ratchet. The guard's own refusal is `if (total > baselineTotal)` (line 196), so
a total-neutral move is already permitted by the code; the per-file numbers are bookkeeping about
where the debt sits, and moving debt is not taking on debt.

CONDITIONS, all three, and a lane that cannot meet them stops instead:
  1. The baseline diff must be conservative in both directions: the source file's count falls by
     exactly what the new file's count rises by, and the total is byte-identical. Any other shape
     means something was ADDED during the move and the extraction is no longer a move.
  2. The commit says so in its message, with both numbers.
  3. No gray class is introduced, converted, or "tidied" in the same commit. Convert to tokens in
     a SEPARATE commit, which lowers the total and is what the ratchet is for.

MEASUREMENT STATUS, stated plainly: the lane marked its reading of line 196 as read-from-source,
not measured, because measuring it would have written to the file it was told not to touch. That
was right. I am not measuring it now either, because there is no real move to measure and
simulating one would mean making an invasive edit for the sake of a probe. The next extraction
lane measures it as its FIRST act, before doing any extraction work. The cost of my being wrong
is zero: the guard refuses, the lane stops, nothing is damaged.

CONSEQUENCE IF THE READING IS WRONG: the fallback is to make the ratchet total-only for files
under `client/src/components/admin/`, which is a real widening and needs its own ruling.

## 2 - Lane registry

Every lane: base ref above, its own worktree, its own branch, commits with `git add -p`,
does NOT push until told. Scratch goes in the lane own subdirectory, never a shared one.

| Lane | Worktree | Branch | Owns (exclusive) | Effort |
|---|---|---|---|---|
| release | `../s2-release` | `wt/s2-release` | `Dockerfile`, `.github/workflows/release.yml`, `railway.toml` | full |
| safety | `../s2-safety` | `wt/s2-safety` | `.github/workflows/ci.yml`, `scripts/check-migration-*.mjs` | full |
| backup | `../s2-backup` | `wt/s2-backup` | `.github/workflows/db-backup.yml`, backup docs section | cheap |
| neutral | `../s2-neutral` | `wt/s2-neutral` | `shared/gameConfig.ts`, `client/src/index.css`, `server/seeds/*` | cheap |
| kit | `../s2-kit` | `wt/s2-kit` | `README.md`, `.env.example`, `.gitignore`, `scripts/fork-init.mjs`, `docs/PROVISIONING.md` | cheap |
| fleet | `../s2-fleet` | `wt/s2-fleet` | `ops/**` (new directory) | cheap |
| ops | `../s2-ops` | `wt/s2-ops` | `server/index.ts`, `server/lib/errors.ts` | full |
| tokens | `../s2-tokens` | `wt/s2-tokens` | `client/src/**` except `index.css` | cheap |
| gates | `../s2-gates` | `wt/s2-gates` | `scripts/*.test.mjs`, `vitest.config.ts`, `server/db/provisioningReport.ts` | cheap |

### Shared-file ownership (the expensive mistake)

- `server/index.ts` is owned by **ops alone**. Brand strings inside it (submission email
  heading, DEFAULT training copy) belong to ops, NOT neutral, even though they are brand work.
- `.github/workflows/ci.yml` is owned by **safety alone**. Any lane needing a CI step files
  the request in the Blocker list below; safety applies it.
- `client/src/index.css` is owned by **neutral alone**; tokens owns every other client file.
- `docs/FORK_RUNBOOK.md` is append-only this round. backup and kit both append; each adds its
  own dated section and neither edits the other lines.

## 3 - Resource registry

- **Migration numbers. THIS SECTION DELIBERATELY CARRIES NO "NEXT FREE" FIGURE.** It carries the
  METHOD and the CURRENT HOLDERS, and nothing else, because a next-free number is wrong the moment
  another lane creates a file and a wrong one here is read and believed.
- **A READING EXPIRES IN MINUTES, NOT HOURS.** On 2026-09-02 I measured all three ways at 17:40,
  got 0130, and told three lanes that 0131 was free. The housing lane created
  `drizzle/0131_a_village_names_its_own_homes.sql` at 21:18 and pushed it. A correct reading went
  wrong in under four hours with roughly ten lanes live. **Re-measure immediately before you create
  the file, never at the point you plan it, and treat a number another lane hands you, including
  one from this file, as needing its own fresh check.** The line further down about this section
  being stale by four for a week is the slow version of the same failure; this is the fast one, and
  it is why the figure is gone rather than corrected.
- **A RESERVED BLOCK IS INVISIBLE TO EVERY SWEEP.** There is no file and no ref to find, so the
  holder list below is the ONLY way anyone learns a range is spoken for. If you reserve a block,
  write it here in the same breath.
- Gaps at 0111 and 0115-0119 are BURNED, never reuse them (the applied-ledger keys on filename and
  would replay).
- **Claim a number here before creating the file.**
- **This line was stale by four for a week.** It said "highest 0122, next free 0123" while
  `origin/main` carried 0123 through 0126, and two sessions read it and believed it. A number
  written in a document is a claim about a moment. Measure before you claim: `ls drizzle/`
  under-reports, so run all three scans (the directory, `git ls-tree` over every remote AND
  local ref, and every `drizzle/*.sql` on disk across the worktrees), then
  `node scripts/check-migration-numbers.mjs --next` to confirm.
- **profile-rebase integration, 2026-09-04: RENUMBERED to 0156, 0157, 0158, 0159.** The four
  entries below (path-data's 0144/0145/0146, portraits' 0147, and the 0144-to-0151 move made
  earlier the same day) are HISTORY now, not allocation. Main reached 0153 while the branch
  was in review, so every one of them sat at or below a ceiling that had already passed them
  and `check-migration-numbers.mjs` refused the branch. New numbers, same bodies:
  `0156_an_investor_path_records_facts_not_money.sql`, `0157_a_member_opens_a_venture.sql`,
  `0158_character_portraits.sql`, `0159_a_member_finds_their_own_reservation.sql`.
  **Renaming is only safe because not one of these has ever been merged**, so no
  `_migrations_applied` row anywhere holds an old name and nothing replays. Three of the four
  are `CREATE TABLE IF NOT EXISTS` and would survive a replay regardless; 0159 is a bare
  `CREATE INDEX`, which MySQL gives no `IF NOT EXISTS`, so that one would fail loud on a second
  run. If any of these had shipped, the fix would have been a NEW file, never a rename.
  Ceiling read at 2026-09-04T20:4xZ by two scans run SEPARATELY, never chained: every ref in
  the shared object store reached 0155, and `drizzle/` on disk across 250 sibling worktrees
  reached 0155 (`ECON-redeem`). Chaining the two produces a truncated first scan whose empty
  output is indistinguishable from a clean one.
- **path-data lane, 2026-09-03: claims 0144, 0145 and 0146** for
  `drizzle/0151_a_member_finds_their_own_reservation.sql` (one non-unique index on
  `housing_reservations`, no new table),
  `drizzle/0145_an_investor_path_records_facts_not_money.sql` (new table
  `investor_path_facts`) and `drizzle/0146_a_member_opens_a_venture.sql` (new table
  `member_ventures`). Three numbers rather than one file so the integration coordinator can
  land or hold each model separately. The cost is MEASURED and not estimated, and it MOVES:
  two runs on this tree reported `261ms` and `188ms` per migration file, against the 1.25s per
  file an older briefing carried. It is paid once per run into the template, not once per
  suite (103 clones this run), so three files add well under a second. Read your own with
  `pnpm measure:provisioning`; do not quote either figure. Holders found by a four-way sweep at 2026-09-03T17:09Z, and every one of them is
  ABOVE what section 3 recorded before this line: 0131 (`wt/lane-housing`), 0132 to 0139
  (the governance build: `wt/gb-clock`, `wt/gb-delegation`, `wt/gb-delegation-consent`,
  `wt/gb-dispatcher`, `wt/gb-steward`, `wt/gb-steward-veto`, `wt/gb-thresholds-heads`,
  `wt/governance-build`, all now REAL FILES on local and origin refs) and 0140 to 0143
  (`wt/bridge-primitives`, local and origin). Highest holder anywhere: **0143**.
- **`check-migration-numbers.mjs --next` answered 0132 on 2026-09-03 and 0132 is TAKEN.**
  The script reads only the `drizzle/` directory of the worktree it runs in, so on any branch
  that has not merged the governance or bridge lanes it reports a number another lane already
  holds. Treat `--next` as a lower bound and the four-way sweep as the answer.
- **housing lane, 2026-09-02: holds 0131** for `drizzle/0131_a_village_names_its_own_homes.sql`.
  Recorded here by the bridge lane rather than by its author, because it was created on a worktree
  and pushed hours after the surrounding numbers were measured, which is exactly the case this
  section exists to catch.
- **governance build, 2026-09-02: RESERVES 0132 to 0139.** A reservation that lives only in one
  session's head is not a reservation, so it is written down here.
- **bridge-primitives lane, 2026-09-02: claims 0140, 0141, 0142 and 0143** for the platform
  primitives under the Amora x Saberra integration. All four are additive only.
  `0140_external_proposals.sql` adds `external_proposals` (the vendor proposal queue, with a
  NOT NULL unique `dedupe_key` computed here and never taken from the wire) and
  `external_proposal_drops` (a content-free counter, so an empty queue can be told apart from
  a queue where everything was refused). `0141_quest_proposals.sql` adds `quest_proposals`,
  which deliberately carries NO reward or gate column: a quest cannot exist unpublished
  (`GET /api/quests` is public and unfiltered and the claim route never reads status), and the
  five columns a machine must never write are absent rather than guarded. `0142` adds
  `is_agent` to `org_role_assignments`, with no enum ALTER: an agent is
  `holder_kind='documented'`, which is already excluded from the settlement job and from the
  0083 declare door by filters that exist. `0143` adds `origin_module_id` to `health_events`
  (0052 added `actor_kind` and said revocation-by-integration was the reason; the module id it
  needed was never there, and `actor_kind` itself was written and read by nothing) plus
  provenance and `cites` to `org_drafts`.
- **The same lane, hours later: RENUMBERED from 0127-0130 to 0140-0143, and why that was safe.**
  I took 0127-0130 when 0126 was the ceiling. While the pull request sat open, main landed the
  housing lane's 0131, and `check-migration-numbers.mjs` then refuses on a merge: its rule is that
  a migration added since the base ref must be numbered ABOVE everything that ref already reached,
  and after the merge the base reached 0131. The gate said "Renumber to 0132 or above" and it was
  right. 0132-0139 are governance's, so 0140.
  **Renumbering is normally forbidden and this is the one case where it is correct.** The ban
  exists because `_migrations_applied` keys on FILENAME: an instance that has run `0127_x.sql`
  records that name, so a renamed file never runs there while a fresh instance gets it, and the two
  databases diverge with no error anywhere. That danger begins the moment a file has RUN somewhere.
  These four had never left this branch and had only ever run in scratch test schemas that are
  dropped per run. **Renumber before landing; never after.**
  Verified before claiming: measured all three ways at the time of the renumber, 0131 held by
  housing on main, 0133/0134/0137 on disk in the governance band, so 0140 was the first free
  number. Both migration
  gates green, `check-migration-compat` applied all 113 previous-release migrations against a
  populated database, seeded rows in all three tables these files name, applied the four, and
  confirmed a second run applies zero.
- **Migration numbers. This list holds HOLDERS, never a "next free" figure.** The two lines
  that used to say "next free" were both stale within a day of being written (the entry below
  said 0123 while 0146 was already on disk), and a stale next-free reads exactly like a fresh
  one. Gaps at 0111 and 0115-0119 are BURNED, never reuse them (the applied-ledger keys on
  filename and would replay).
- **Claim a number here before creating the file.** Sweep FOUR ways first, because no single
  one of them sees the others: `git ls-tree` over every ref from `git for-each-ref refs/heads
  refs/remotes`; `ls drizzle/` in every path from `git worktree list --porcelain`; and `find`
  for `0*.sql` under `*drizzle*` across Desktop\Amora and other sessions' temp scratchpads.
  `check-migration-numbers.mjs --next` reads ONE worktree against origin/main and cannot see a
  sibling branch, so its green is not evidence.
- **portraits lane, 2026-09-03: claims 0147 for `drizzle/0147_character_portraits.sql`.** One
  new table, `character_portraits`, one row per (village, member, class), plus one new
  `portrait_grants` table holding the forge budget. Four-way sweep at claim time put the
  ceiling at 0146 (`0146_a_member_opens_a_venture.sql`, path-data lane, on `wt/path-data-models`
  and on disk in `wt-pathdata`); 0144 and 0145 belong to the same lane. Nothing anywhere held
  0147 or above: refs, worktrees, Desktop\Amora and every temp scratchpad all agreed.
  CREATE TABLE IF NOT EXISTS only, no ALTER on an existing table, so it adds and takes nothing
  away.
- **arch-store lane, 2026-08-31: claims 0122 for `drizzle/0122_collection_versions.sql`.** One
  new table, `collection_versions`, holding one counter per `dbCollection` table. It is what
  makes `replaceAll` able to tell a current snapshot from a stale one, and its row lock is the
  lock the original architecture audit said the read-modify-write cycle did not have. Verified
  before claiming: 0121 IS taken (`drizzle/0121_migration_checksums.sql`, commit d97f100, the
  data lane), and 0121 is the highest number in any local ref, so section 3's own "next free:
  0121" line was stale and is corrected above. CREATE TABLE IF NOT EXISTS only, so it adds and
  takes nothing away; run twice against seeded rows, second run a no-op.
- **data lane, 2026-08-31: claims 0121 for `drizzle/0121_migration_checksums.sql`.** Adds a
  nullable `checksum` column to `_migrations_applied` (item 1 of this lane's brief: a sha256 of
  each shipped file's bytes, recorded on apply, backfilled for pre-0121 rows, checked at boot so
  an edited shipped file refuses instead of silently skipping forever). Confirmed the working
  tree's highest number is still 0120 before claiming.
- **secrets lane, 2026-08-30: claimed nothing, 0121 is still free.** Encryption at rest for
  the village integration secrets needs NO numbered SQL migration and must not have one.
  MySQL cannot do AES-256-GCM and must never be handed the key, so the conversion runs in
  `loadSecrets` at boot: it seals any plaintext entry in place and writes the document back
  once. Proved idempotent against the real local MySQL, not reviewed: the row is
  byte-identical after the second and third runs (a re-seal would change the ciphertext,
  since the iv is fresh per call, so equality is what proves nothing ran).
- **Reserved fork band. DECIDED AND ENFORCED (safety, `c551f70`).** Village-local migrations
  use `9000+`. `scripts/check-migration-numbers.mjs` fails this repo's CI if any file here
  reaches 9000, which is upstream keeping its half; a fork adding its own runs the same script
  with `--village`. The band works because the runner sorts BY FILENAME, so `9001_` sorts after
  every upstream number that will ever exist and a village migration always runs last.
- **Burned numbers: the register is now redundant, and it was incomplete.** Measured across all
  local refs and worktree HEADs: 0111 and 0115-0119 never existed as files in ANY ref, and
  0064, 0065, 0080, 0094, 0100, 0103 and 0107 are gaps of the same kind that the register does
  not name. The gate enforces the general rule instead: a migration added since the base ref
  must be numbered above every number that ref already has. Only forward, no list to maintain.
- **Ports.** Test MySQL is 127.0.0.1:3307 (local, not production). Preview servers pick
  their own; record any long-lived port here.

## 4 - Gate set

**Enumerate `.github/workflows/` yourself, never trust a count in a brief.** Read at
2026-08-30 from the directory, not from one file: `ci.yml`, `db-backup.yml`,
`module-intake.yml`, `module-review-agent.yml`.

`ci.yml` runs on push to every branch AND on pull_request. Its 20 steps, in order:

```
pnpm install --frozen-lockfile
pnpm check
npx tsc -p tsconfig.tests.json --noEmit
node scripts/check-brand-refs.mjs
node scripts/check-voice.mjs
node scripts/check-hyphen-dash.mjs
node scripts/check-auth-fetch.mjs
node scripts/check-admin-reach.mjs
node scripts/check-save-honesty.mjs
node scripts/check-repo-payloads.mjs
node scripts/check-mirror-annotations.mjs
node scripts/check-upload-strip.mjs
node scripts/check-artifact-budget.mjs
node scripts/check-doc-links.mjs
node scripts/check-route-reachability.mjs
node scripts/check-map-routes.mjs
node scripts/check-image-budget.mjs
pnpm build
pnpm test
pnpm audit --prod --audit-level high
```

**Two path-gated PR workflows become REQUIRED checks** for any change touching
`shared/modules.ts`, `shared/capabilities.ts`, `shared/draftKinds.ts`, `server/lib/modules.ts`,
`server/lib/secrets.ts`, `scripts/enable-all-modules.mjs`, or `docs/modules/**`.
Any lane touching `server/lib/secrets.ts` inherits both.

### THE BASELINE IS A DISTRIBUTION, NOT A POINT. I GOT THIS WRONG ONCE ALREADY.

TWO control reps, SAME ref 052d042, SAME bytes, pristine worktree, run back to back:

    rep 1:  203 files / 3057 tests / 0 failed / 0 skipped   2331s
    rep 2:  201 files / 3055 tests / 2 FAILED / 0 skipped   1512s

Rep 2's two failures, both governance, both with NO lane changes present:

    server/loop.e2e.test.ts               > G1: stage, support, open, vote, human close, THE ONE APPLY
    server/governance.routes.e2e.test.ts  > ...and closing it changes NOTHING, which is the whole promise

**COORDINATOR ERROR: I published rep 1 as "the definitive baseline" and told every lane to
judge itself against 203/3057/0.** It was ONE SAMPLE of a distribution, and I labelled it
definitive. The skill's own rule says compare failure SETS across n>=5 alternating reps, and
that a sample lies in both directions; I took one sample and made it the standard.

THE HONEST BASELINE, stated as what it is: at 052d042 this suite passes 3055 to 3057 of 3057
tests, with an intermittent cluster in the governance and loop end-to-end paths. Across all
observations tonight the flaky set is:

    loop.e2e  S15 tools hub            (constitution lane, tokens lane)
    loop.e2e  G1 the one apply         (control rep 2)
    governance.routes.e2e  advisory notification   (kit lane)
    governance.routes.e2e  closing changes nothing (control rep 2)
    mapScene  settles a genuine race           (2026-09-04, profile integration)

A FIFTH, and its mechanism is known rather than suspected. `server/lib/mapScene.test.ts
> two admins, one map > settles a genuine race: exactly one of six concurrent publishes
wins` fails with "Deadlock found when trying to get lock". It fires six concurrent
publishes at the shared MySQL on :3307, so it is the suite's most lock-contended case and
the first to lose when other lanes are running.

Observed across three full runs of the SAME tree family on one night: green at 3c739ce
(4353 of 4353), red at e30fa6e (4352 of 4353) with only this test failing. Two lanes had
already reported it independently, each correctly diagnosing contention rather than their
own diff, and it vanished on a quiet machine.

**This one may be a real defect wearing a flake's clothes, and that is why it is recorded
rather than dismissed.** A deadlock means MySQL rolled a transaction back. If the publish
path is expected to survive six concurrent writers, it wants a retry and the test is
telling the truth; if it is not, the test asserts more concurrency than the product
promises. Deciding which is a product question nobody has answered, so do not "fix" it by
loosening the assertion.

Contrast with `powerRunway ... THE WHOLE CHAIN HAD NO ADMIN IN IT`, which looked identical
and was NOT added here: its cause was an audit read racing a fire-and-forget write, the
remedy already existed twenty lines away in a sibling file, and it was fixed in 48758d4.
Reach for the ledger only when a clean fix genuinely is not available.

**THE LANDING CRITERION IS THEREFORE A SET COMPARISON, NOT A COUNT.** An integration run that
fails only tests already in that flaky set is NO WORSE THAN BASELINE. An integration run that
fails anything outside it is a regression and blocks the push.

Every rep tonight ran with other lanes competing for one MySQL, so I cannot separate "flaky
under contention" from "flaky always" without a quiet rep. That distinction matters and is
recorded as unresolved rather than guessed. What is NOT in doubt: this repository's own notes
claim flakes were fixed at root cause and that nothing retries, and these four observations say
that claim no longer holds for the governance end-to-end paths. That belongs on the
improvements list.

### Superseded: rep 1 alone (kept because lanes were briefed against it)



Completed run, dependencies installed, test env present, real local MySQL on 127.0.0.1:3307:

    pnpm test  ->  exit 0
    Test Files   203 passed (203)
    Tests       3057 passed (3057)
    Duration    2331.50s

**ZERO skipped. ZERO failed.** This is the number every lane and every integration is judged
against. The landing criterion is NO WORSE THAN THIS, not "green".

The same tree WITHOUT the test env, measured on the same machine, exits 0 while reporting
135 files passed / 68 skipped and 1979 tests passed / 1078 skipped. That gap of 1078 tests is
the silent-skip trapdoor, and it is the DEFAULT state of any fresh clone of this repository,
because `.env` is gitignored. The gates lane has since made that condition fail loudly under CI.

Also measured on this baseline: `pnpm build` exits 0 in about 27s, and S15 in
`server/loop.e2e.test.ts` PASSES, which settles the failure one lane saw under contention.

### Earlier partial measurements (superseded, kept for the record)



- `node_modules` in the MAIN checkout is EMPTY (0 packages). `pnpm check`, `pnpm build` and
  `pnpm test` therefore cannot run there. **Every lane runs `pnpm install --frozen-lockfile`
  in its own worktree first.** A gate result from a tree without install is not a measurement.
- Dependency-free guards measured GREEN on pristine trunk: brand refs (52 legacy refs against
  a 63 baseline), hyphen-dash (0), doc links (41 references across 6 documents).
- **Canary measured 2026-08-30:** `pnpm install --frozen-lockfile` succeeds in a fresh
  worktree in ~51s, and `pnpm check` then exits 0 (GREEN) at 052d042. So typecheck has a
  known-good baseline; the earlier red was missing dependencies, not code.
- Build, test and the remaining guards have NO measured baseline yet. Landing criterion is
  **no worse than baseline**, not "green". Measure your own control in your own session.

## 5 - Landing queue

Order matters where noted; everything else lands when green.

1. **safety** first among CI-touching lanes. It owns `ci.yml`; other lanes CI steps queue behind it.
2. **release** may land in parallel with safety (disjoint files) but the release workflow is
   not useful until the safety compatibility gate exists. Ship both before any rollout.
3. **fleet** depends on release having published at least one tagged image. It may BUILD first
   and land first; it cannot be exercised until an image exists.
4. **neutral**, **kit**, **backup**, **tokens**, **gates** are independent; land when green.
5. **ops** touches the 32k-line monolith. Land it alone, never alongside another
   `server/index.ts` change, and rebase it last.

## 6 - Blocker list

| What | On whom | Since | Notes |
|---|---|---|---|
| Repo is PUBLIC with unencrypted DB dumps as downloadable artifacts | founder (GitHub admin) | 2026-08-30 | **CORRECTION, backup lane, 2026-08-30 later same day, via `gh api repos/Rieki777/village-os`: the repo is now `"private":true, "visibility":"private"`, not public.** `pushed_at` is 2026-08-30T16:57:30Z, `updated_at` (repo settings, not code) is 2026-08-31T03:21:16Z, after the push, consistent with the founder having already flipped visibility. Collaborators now list only `Rieki777`. **This does not close the exposure window that already happened**, and it does NOT make the 29 currently unexpired `db-backup-*` artifacts (dated 2026-08-02 through 2026-08-29, still unencrypted, still downloadable by anyone with current repo read access, expiring on their own only by late September) safe to leave in place, only safer than while public. Recommend the founder delete those 29 artifacts by hand once the encrypted workflow (this lane's commit `0aa1f71`) is confirmed producing encrypted ones; deleting them was not done here since it is destructive and outside this lane's asked-for deliverables. |
| `PROD_DATABASE_URL` secret is rejected by MySQL as of the 2026-08-30T14:26 UTC scheduled run | founder / whoever holds Railway access | 2026-08-30, found by backup lane | `mysqldump: Got error: 1045: Access denied for user 'root'@'100.64.0.17' (using password: YES)`, failing in 7s, a NEW failure mode distinct from the prior week's runs (2026-08-25 through 2026-08-29 all failed later, at `restore-drill`'s scratch-MySQL service with `ERROR 2013 Lost connection`, which is CI service-container flakiness, not a credential problem; the `backup` job itself succeeded on all of those). The timing (same day the exposure was escalated) is consistent with the production DB password having already been rotated without `PROD_DATABASE_URL` being updated to match. Until this is fixed, `db-backup.yml` cannot dump anything, encrypted or not, independent of the encryption work in commit `0aa1f71`. |
| Secret rotation after the exposure | founder | 2026-08-30 | Stripe keys, all `app_config` integration secrets, village signing key, legacy-hash password resets. |
| `VILLAGE_SECRETS_KEY` must reach `.env.example`, `docs/PROVISIONING.md` and `scripts/fork-init.mjs` | kit (owns all three) | 2026-08-30, filed by secrets lane | New required variable: 32 bytes as 64 hex (`openssl rand -hex 32`), SEPARATE from `MEMBER_SECRETS_KEY`. Without it Admin, Integrations refuses every save with "this deployment has no village-secrets key; ask your operator", so all 13 founder instances need it set before anyone types a Stripe key. Documented in full in `docs/FORK_RUNBOOK.md`, section "`VILLAGE_SECRETS_KEY`: your integration secrets at rest (2026-08-30, secrets lane)". A hosted village must not share one key value with another village. |
| Two admin routes in `server/index.ts` need a 3-line pre-check before `putSecret` | ops (owns `server/index.ts`) | 2026-08-30, filed by secrets lane | `putSecret` now THROWS when `VILLAGE_SECRETS_KEY` is absent, which is the fail-closed behaviour and is correct. Under Express 4 an async throw from a route handler is an unhandled rejection, not a 500, so the request HANGS. Nothing is written either way, but the founder gets no answer. Fix, matching the member-key route already at `server/index.ts:6995`: `if (!villageSecretsConfigured()) return res.status(503).json({ error: NO_VILLAGE_SECRETS_KEY_SENTENCE });` before the `putSecret` calls near lines 19475 (email-config passthrough) and 19632 (`PUT /api/admin/integrations/:key`). Both names are exported from `server/lib/secrets.ts`. Also note the boot legacy-key move near line 1556 calls `putSecret` inside `initStores`, so on the one deployment class that still holds a legacy `resend_api_key`/`assistant_api_key` in the email-config document, a missing key refuses the BOOT rather than serving. Documented in FORK_RUNBOOK; ops may prefer to make that move tolerant. |
| Admin, Integrations should render the two new status fields | tokens (owns `client/src/**`) | 2026-08-30, filed by secrets lane | `SecretStatus` now carries `atRest: "sealed" \| "plaintext" \| null` and `unreadable: boolean`. Both are additive and the panel renders correctly today without them, but `plaintext` is a finding a founder should see (that row is in every dump until the next boot with a key set) and `unreadable` is the only thing that distinguishes a rotated key from a lost credential. Server side is done and shipped; this is display only. |
| The village's ed25519 SIGNING key is still plaintext in `app_config` | whoever takes `server/lib/villageExport.ts` | 2026-08-30, found by secrets lane | `ensureSigningKey` stores `privateKeyPem` in the clear under `config_key = 'village-signing-key'`, so it rides in the same dumps the integration secrets used to. Deliberately NOT fixed in the secrets lane: it is a different file, a different credential class (identity, not payment, so outside this lane's harm metric), and it has a real bootstrapping problem the integration store does not, since it is MINTED at first boot and fail-closed there would refuse to boot a fresh instance with no key set. Needs its own decision about what happens on a fresh install. |
| A workflow_dispatch CI job to run `ops/roll.mjs apply` with the paging webhook and per-village deploy secrets in scope | safety (owns `ci.yml`) | 2026-08-30 | Not urgent: `ops/roll.mjs` runs fine by hand today and the release lane has not published an image yet (landing queue item 3), so there is nothing real to roll out to. File this when release lands so a human is not the only way to kick off a rollout. fleet lane does not touch `.github/workflows/**` itself. |
| `data/uploads/` volume has no backup of any kind | ops (owns `server/index.ts`) | 2026-08-30 | backup lane cannot reach a Railway volume from a GitHub Action; `railway ssh` is interactive-only and this repo's own history shows it run by hand, never headless. Full spec for an authenticated `GET /api/admin/backup/uploads-archive` (route, `BACKUP_EXPORT_TOKEN` header auth, streamed tar, canary-file manifest) is written up in `docs/FORK_RUNBOOK.md`, "Backup encryption, the uploads volume gap..." section, 2026-08-30. Not half-built; needs the lane that owns `server/index.ts`. |
| New repo secrets needed for backup encryption: `BACKUP_GPG_PUBLIC_KEY`, `BACKUP_DRILL_GPG_PUBLIC_KEY`, `BACKUP_DRILL_GPG_PRIVATE_KEY` | founder (GitHub secrets) | 2026-08-30 | `db-backup.yml` now fails closed (refuses to dump) until these exist. Generation commands and which secret holds which half are in `docs/FORK_RUNBOOK.md` same section. The drill keypair is CI-only test material and safe to generate and hand over; the production public key's private half must be generated and held by the founder offline, never in this repo or CI. |
| A CI step for `scripts/check-theme-literals.mjs` | safety (owns `ci.yml`) | 2026-08-30, tokens lane | New ratchet, same shape as the existing `check-brand-refs.mjs` / `check-image-budget.mjs` steps. Exact step to add, right after `check-image-budget.mjs` (both are dependency-free, no-DB, colour/asset budget gates, so they belong next to each other, before the Build step): `- name: Theme literals` then `run: node scripts/check-theme-literals.mjs`. No env, no extra permissions, no new secret. Committed baseline (`scripts/theme-literals-baseline.json`) is at 162 as of commit `4892c97` on `wt/s2-tokens`; `--update-baseline` refuses to write a total above the one already committed (verified by hand: a staged regression fails the gate at exit 1, then `--update-baseline` against that same regression also exits 1 and leaves the baseline file on disk untouched; see 7e for the full transcript). |
| Three CI steps for the guards' own regression tests | safety (owns `ci.yml`) | 2026-08-30, gates lane | `scripts/check-brand-refs.test.mjs`, `scripts/contribution-scan.test.mjs`, `scripts/intake-classify.test.mjs` all exist, all pass standing alone, and no workflow runs any of them today (`intake-classify.mjs` and `contribution-scan.mjs`, the code they test, ARE invoked, only their tests are dead). Verified: this repo's own notes record the brand guard reporting two different answers for the same commit on two machines, which is exactly the failure a dead regression test cannot catch. Belongs in `ci.yml`, not `module-intake.yml`: that workflow is `paths`-gated on `shared/modules.ts` / `shared/capabilities.ts` / etc, and none of those paths cover `scripts/intake-classify.mjs` or `scripts/contribution-scan.mjs` themselves, so a change to the classifier's own logic would never trigger its own test under that workflow. `ci.yml` runs on every push and PR unconditionally, which is what a guard-of-a-guard needs. Recommend placing them right before the existing `node scripts/check-brand-refs.mjs` step, so a broken guard test fails before the guard it is testing is trusted; all three are plain Node, no DB, sub-second each: `- name: Guard regression test, brand refs` / `run: node scripts/check-brand-refs.test.mjs`, then the same shape for `- name: Guard regression test, contribution scan` (`contribution-scan.test.mjs`) and `- name: Guard regression test, intake classifier` (`intake-classify.test.mjs`). No env, no new secret, no new permission. Each verified standing alone at `7976b29` on `wt/s2-gates`: brand refs 9/9 checks passed exit 0, contribution scan 24/24 assertions exit 0, intake classifier 13/13 assertions exit 0. |
| Two more CI steps for the two migration guards' own regression tests | safety (owns `ci.yml`) | 2026-08-31, data lane | `scripts/check-migration-numbers.test.mjs` (21 assertions) and `scripts/check-migration-compat.test.mjs` (24 assertions, 0 skipped with a database present) exist now, same shape as the three above, and nothing runs them today either. Both build a real throwaway git repository per case and run the REAL guard script copied into it (each guard computes its own ROOT from its own file location, not `process.cwd()`, so a fixture has to contain the script, not just point at one), asserting real exit codes and real JSON output. The compat test also copies `server/db/migrate.ts` into the fixture, since the guard reads it back to verify its own statement-splitter copy has not drifted, and reproduces the historical LPAD-collapse bug from scratch as one of its cases (`Duplicate entry 'compat-probe-t-id-' for key 'PRIMARY'`, the same failure shape recorded in section 7i). Recommend placing each directly after the guard it tests, before the "Guard regression test, brand refs" steps already there: `- name: Guard regression test, migration numbers` / `run: node scripts/check-migration-numbers.test.mjs` right after the "Migration numbers" step, and `- name: Guard regression test, migration compatibility` / `run: node scripts/check-migration-compat.test.mjs` right after "Migration compatibility". The compat test needs `TEST_DATABASE_URL`, already set at job level for the whole `verify` job, so no new env or secret. Both verified standing alone at the data lane's own commit (see section 8), run twice each for determinism, zero leftover temp directories or scratch schemas afterward. |
| The maintenance-mode page (item 3, data lane) is built but not wired in | whoever takes `server/index.ts` (ops/srvhard lane; data lane does not own this file) | 2026-08-31, data lane | Today a failed boot migration throws before `startServer` binds a port (`server/index.ts` around line 5409-5420), so Railway's three retries all fail the same way and members see a bare 502 with nothing behind it. `server/db/maintenanceMode.ts` (new, self-contained, imports nothing from `server/index.ts`) exports `startMaintenanceServer({ detail, port, host?, instanceLabel? })`, which binds the SAME port the real app would and answers every request with one plain-language page: what failed, in which file and at which step, that no data was lost (migrations stop at the first failed statement by design), and the exact technical detail to hand to whoever operates the deployment. `/health` and `/api/platform/info` answer JSON (`{status:"maintenance",...}`) instead of HTML, so a Railway health check or the fleet roller's prober sees a clear non-ok status rather than a 404. `server/db/migrate.ts`'s `ApplyResult` now carries an optional `failedDetail` (kind `migration-failed` \| `tamper-detected` \| `lock-timeout`, with the file/step/message already structured) alongside the existing `failed: string \| null` every current caller already checks, so nothing that reads `result.failed` needs to change. The wiring itself is small: in the migration block already at line ~5409-5420, when `result.failed` is set, call `startMaintenanceServer({ detail: result.failedDetail!, port: <the same PORT startServer would bind> })` and return/exit the boot sequence there instead of throwing past it. Proved end to end, not just reviewed: `server/db/maintenanceMode.test.ts` breaks a real two-file migration set against the real local MySQL (a valid `CREATE TABLE` followed by literally invalid SQL), takes the real `ApplyResult.failedDetail` `applyPending` produces, starts a real HTTP server with it, and asserts a real `fetch()` gets a 503 page naming the right file and step ("0002_broken.sql", "step 2 of 2") plus the "your data is safe" reassurance, and that `/health` reports `status:"maintenance"`. 5/5 tests pass, including that end-to-end one. |
| A CI step for `scripts/check-tailwind-gray.mjs` | safety (owns `ci.yml`) | 2026-08-31, UI lane (wt/s3-ui) | New ratchet, same shape and same refuse-to-raise discipline as `check-theme-literals.mjs`, gating Tailwind's default `text-gray-*` palette (a different bypass than a colour literal: no hex, so `check-theme-literals.mjs` correctly does not and should not catch it). Exact step to add, right beside the existing `Theme literals` step (both dependency-free, no-DB, colour-token gates): `- name: Tailwind gray` then `run: node scripts/check-tailwind-gray.mjs`. No env, no extra permissions, no new secret. Committed baseline (`scripts/tailwind-gray-baseline.json`) is at 1262 as of commit `2438205` on `wt/s3-ui`, down from a verified 1287 (matching the brief's cited figure exactly) after three universal shell surfaces were routed to `text-foreground`/`text-muted-foreground`. `--update-baseline` refuses to write a total above the one already committed: verified by hand, a staged real-code regression (not inside a comment) fails the gate at exit 1, and `--update-baseline` against that same regression also exits 1 and leaves the baseline file on disk byte-identical. Two real bugs in the guard's own block-comment detection were caught and fixed while building it, both against this tree, not hypothetically: (1) a same-line `/\/\*/ ` test cannot tell a real comment opener from an ordinary `accept="image/*"` file-input attribute, which silently blacked out real code below it (`IdentityPackPanel.tsx` lost 2 real hits to this); (2) the first fix, tracking string state naively, broke worse on this codebase's prose-heavy comments: an ordinary apostrophe ("the API's users") was read as opening a string, swallowing a real same-line closer and undercounting the whole tree by dozens (`EventsAdminPanel.tsx` alone lost 28). The final version's total was cross-checked file-by-file against a plain `grep -oE` count of the whole tree and matches exactly, zero discrepancy. `check-theme-literals.mjs`'s own opener/closer regexes have the identical shape and carry the same risk; flagged in `check-tailwind-gray.mjs`'s own header comment, not fixed there since that file belongs to a different lane. |
| `server/modulePool.e2e.test.ts` binds a HARDCODED port, the sixth flake's exact shape | whoever takes e2e test hygiene (arch-store did not touch it: not this lane's file) | 2026-08-31, filed by arch-store lane | `server/modulePool.e2e.test.ts:36` is `const PORT = 8127;`. Every one of the other 33 port expressions in `server/*.test.ts` derives from `process.pid`, which is what the FLAKES lane fixed in `loop.e2e`'s stub ports for exactly this reason. Two suites' ranges CONTAIN 8127 and can therefore take it first: `crowdpool.routes.e2e` (`7800 + pid % 1200`) and `mapPromise.routes.e2e` (`7900 + pid % 900`). When that happens the child server cannot bind, the health poll answers from the OTHER suite's already-bootstrapped server, and `POST /api/admin/bootstrap` returns 403 "Already bootstrapped", which surfaces as `founder must hold a session: expected '' to be truthy` at line 127. This lane saw that failure once in a 222-file run and never in isolation; the mechanism is stated rather than proven, because the assertion prints neither the status nor the body. FIX, two lines: derive the port like its siblings, and print `setPw.status` and `setPw.text` in that assertion so the next occurrence names itself. |
| `server/lib/orgChart.ts` and `server/lib/seasonPatterns.ts` write `circles` with raw SQL and never reload the cache | whoever takes those two files | 2026-08-31, filed by arch-store lane | Pre-existing, NOT introduced by 0122, and not fixable from `server/repos/store-db.ts`. `orgChart.ts:982` INSERTs and `:1000` UPDATEs `circles`; `seasonPatterns.ts:346` UPDATEs `circles.status`. Neither calls `circlesRepo.load()`, so after either runs the in-memory circles cache is wrong until the next reboot, and the 0122 counter is wrong too, so a snapshot taken before the raw write still reads as current and its `replaceAll` will overwrite the raw write. `server/lib/examples.ts` already has the house pattern for this and follows it (raw DELETE, then reload through `wireExampleCaches`), and 0122's `load()` now bumps the counter when a reload finds different rows, so anything following that pattern is covered. These two do not follow it. FIX: reload the circles cache after both writes, the same way the example retirement does. |
| Express 4 async route handlers still HANG on a throw, and now one more thing can throw | arch-server (owns `server/index.ts`) | 2026-08-31, filed by arch-store lane | Pre-existing and already filed once, against `putSecret`. Restating it because 0122 adds a second thrower: `dbCollection.replaceAll` now raises `StaleSnapshotError` when a snapshot is older than the 8 versions the store retains, which is rare by construction and is the ONLY case it refuses rather than rebases. Under Express 4 a rejected handler promise is an unhandled rejection, not a 500: `installCrashHandlers` (`server/lib/errors.ts:186`) reports it to admins and the process survives, and the steward's request gets no answer at all. THE GENERAL FIX, which retires both this and the `putSecret` item: wrap every async handler so its rejection reaches the error middleware already sitting at `server/index.ts:33130`, either with a two-line `const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)` applied at the ~34 admin write routes that call `replaceAll`, or by upgrading to Express 5, which forwards rejections itself. Until then a `StaleSnapshotError` is a hung admin request rather than a 409, which is why the store rebases instead of refusing wherever rebasing is honest. **RETIRED 2026-09-03 by PR #161**, which took the second option. Express 5 forwards a rejected handler promise to the error middleware itself, so the hand-rolled patch at `server/index.ts:6717-6742` was DELETED and not extended to more routes. Two things for anyone reading the original wording above: the HANG claim was already wrong and is corrected in section 7 below, the real symptom under that patch was an opaque 500; and the guarantee is now guarded by BEHAVIOUR instead of by the existence of a wrapper, in `server/asyncRejection.test.ts`, which asserts a rejected handler answers on every verb this server registers. That test uses `AbortSignal.timeout` deadlines, because a hung request and a slow request look identical to a test that simply awaits. |
| `SCHEDULER_ENABLED` must reach `.env.example`, `docs/PROVISIONING.md` and `scripts/fork-init.mjs` | whoever owns those three (kit lane owned them in wave 2) | 2026-08-31, filed by arch-store lane | New OPTIONAL variable, default ON, so nothing breaks if it never lands. It exists because the e2e suites spawn the real built server with `NODE_ENV=production` and the scheduler arms in them too: measured on a real boot, 28 jobs run 16.7s in. `SCHEDULER_ENABLED=0` (also `off`, `false`, `no`) stops all background work in that process and says so on every boot; anything else, including unset and empty, means ON. Document it as a TEST AND MAINTENANCE switch, never as a tuning knob: a founder instance with it set loses every loan settlement, every sweep and every relay, silently apart from the boot line. `server/lib/scheduler.test.ts` holds the reading rules. |
| A CI step for the client component test harness (`npx vitest run "client/**/*.test.{ts,tsx}"` or folded into the existing `pnpm test`) | safety (owns `ci.yml`) | 2026-08-31, UI lane (wt/s3-ui) | `pnpm test` already runs every file `vitest.config.ts`'s `include` matches, `client/**/*.test.{ts,tsx}` included, so the 16 new component tests (`ModuleGate.test.tsx`, `Login.test.tsx`, `Register.test.tsx`) run under the EXISTING `pnpm test` step with no new CI step needed - filed here only so the fact is recorded, not because a gap exists. What DOES need a human decision: `tsconfig.tests.json`'s own header says its `Typecheck tests` CI step must be run COLD (`incremental` caching can hide a real error), and this lane's `.tsx` test files are typechecked by BOTH `pnpm check` (main `tsconfig.json` only excludes `**/*.test.ts`, not `.tsx`) and `tsconfig.tests.json`'s dedicated step - both verified green at `2438205`, `tsconfig.tests.json`'s run cold (deleted `node_modules/typescript/tsbuildinfo` first, per its own instruction). Also new: `@vitejs/plugin-react` was added to `vitest.config.ts`'s `plugins` (JSX needs the automatic runtime to render in a test; this codebase has no bare `React` import anywhere, so classic-mode JSX transform throws "React is not defined" the moment any component test renders anything). Verified this does not affect server tests: `shared/brandTokens.test.ts` and `client/src/components/modules/gateCopy.test.ts` (pre-existing, no jsdom) both still pass unchanged. |
| Two CI steps for `scripts/check-file-lines.mjs` and its own regression test | safety (owns `ci.yml`) | 2026-08-31, arch-admin lane (wt/s4-arch-admin) | New ratchet, same refuse-to-raise discipline as `check-theme-literals.mjs` and `check-tailwind-gray.mjs`, gating the LINE COUNT of every `client/src` file at or over 1000 lines so a client monolith can only ever shrink. Exact steps to add, beside the other two ratchets and before the Build step: `- name: Guard regression test, file lines` / `run: node scripts/check-file-lines.test.mjs`, then `- name: Monolith ratchet` / `run: node scripts/check-file-lines.mjs`. Test first, so a broken guard fails before the guard it is testing is trusted. No env, no DB, no new secret, sub-second each. Committed baseline (`scripts/file-lines-baseline.json`) tracks four files and is at 15730 lines as of this lane's third commit, down from 16120 at the base ref. Unlike the other two ratchets the PER-FILE refusal is the load-bearing one, not the total, because lines do not migrate between files the way a colour class does. Refusal verified twice: `scripts/check-file-lines.test.mjs` covers both refusal paths against scratch fixture trees (13 checks, exit 0), and by hand against the real tree, where appending one line to `Admin.tsx` takes the gate to exit 1 and `--update-baseline` to exit 1 with the baseline file left byte-identical on disk. Scope is narrow on purpose and argued in the script header: `client/src` only (`server/**` has the same disease and belongs to the lanes editing it), vendored `components/ui/**` exempt, test files exempt. |
| DECISION NEEDED: the per-file shape of `scripts/tailwind-gray-baseline.json` makes admin extraction structurally impossible, and it left exactly one of the 42 admin tabs legally extractable | coordinator, then whoever owns `scripts/check-tailwind-gray.mjs` (UI lane, wt/s3-ui) | 2026-08-31, arch-admin lane | The gray ratchet keeps a PER-FILE count and a brand-new file starts at zero, so MOVING a `text-gray-*` class from `Admin.tsx` into `client/src/components/admin/<Tab>.tsx` fails the gate even though the repo-wide total is unchanged. Measured: `Admin.tsx` holds 817 of the 1262 total (64.7 percent) and the baseline has exactly zero headroom. Measured again, per tab: of the 42 tab components in that file exactly ONE (`HandoverTab`, now extracted) carried no `text-gray-*` class at all. The other 41 carry between 4 and 39 each, median 15, and account for 9,414 of the file's remaining 11,029 lines. So the gray ratchet, as currently shaped, blocks the extraction of 85 percent of this file by line count. So the ONLY extractions available without a baseline edit are the ones this lane made. PROVEN, not argued: a throwaway `client/src/components/admin/__GrayProbe.tsx` carrying ONE `text-gray-500` fails `node scripts/check-tailwind-gray.mjs` at exit 1 with `baseline allows 0`, and the guard goes back to exit 0 the moment the file is deleted. One class is enough. Extracting a tab with 27 of them is not new debt, it is the same debt in a smaller file, and the guard cannot currently tell those apart. Note also that recommendation (1) below is read from the guard's source rather than measured: its refusal is `if (total > baselineTotal)`, and a move leaves the total unchanged, so `--update-baseline` would accept the redistribution. This lane did not run it to confirm, because that would have written to a baseline outside its boundary. Three ways out, in preference order: (1) authorise a single `node scripts/check-tailwind-gray.mjs --update-baseline` run per extraction, which the guard's own refusal logic already permits because a move does not raise the TOTAL, and which this lane did not run because the brief put that baseline out of its boundary; (2) teach the guard to accept a redistribution that leaves the total unchanged, which is a real feature and not a weakening; (3) convert each tab's grays to semantic tokens in a separate commit before extracting it, which is correct but is a different lane's harm metric and roughly 800 class changes. Nothing here is a criticism of the guard, which is doing exactly what it was asked; it is that two correct ratchets can point in opposite directions, and a human should choose which one yields. |
| A CI step for `scripts/check-server-index-size.mjs` | safety (owns `ci.yml`) | 2026-08-31, arch-server lane (wt/s4-arch-server) | New ratchet on the `server/index.ts` monolith, same shape and same refuse-to-raise discipline as `check-theme-literals.mjs` and `check-tailwind-gray.mjs`, and dependency-free with no database. It gates TWO numbers, both downward-only: physical lines and `app.get/post/put/patch/delete(` route registrations. Exact step to add, next to the other ratchets before the Build step: `- name: Server index size` then `run: node scripts/check-server-index-size.mjs`. No env, no permissions, no secret. Committed baseline (`scripts/server-index-size-baseline.json`) is 32977 lines / 545 routes, down from a measured 33245 / 560 at the wave-3 base `2296411`. Also gates a fixed 2000-line cap on any file under `server/routes/`, so the monolith cannot be relocated wholesale into one new file. **This guard is ALSO enforced today without any ci.yml change**, by `server/serverIndexRatchet.test.ts` under the existing `pnpm test` step, which runs the REAL shipped script against throwaway fixture repositories (the script computes its own ROOT from its own file location, so a fixture contains the script rather than pointing at one). 11 tests: the refusal to raise (and that the baseline file is left byte-identical when it refuses), the refusal when only one of the two numbers rose, the permitted downward write, the route-file cap, and both undercount bugs found while building it as regressions. Filing the ci.yml step anyway so the guard fails the branch protection rather than only the suite. Verified by hand against the real tree: appending one route to `server/index.ts` fails the gate at exit 1 on both numbers, `--update-baseline` against that same tree also exits 1, and the baseline file on disk is unchanged afterwards. |
| `scripts/check-auth-fetch.mjs` and `scripts/check-admin-reach.mjs` were BLIND to routes outside `server/index.ts`, and this is a standing trap for every future extraction | recorded, already fixed by arch-server lane; flagged for whoever owns those guards | 2026-08-31, arch-server lane (wt/s4-arch-server) | Both guards read the single path `server/index.ts`. Moving fifteen route registrations into `server/routes/*.ts` took them out of both guards' sight: `check-auth-fetch` fell from 348 route prefixes to 342 and `check-admin-reach` from 170 admin write routes to 161, and **both still reported clean, exit 0**. That is precisely the silent-undercount failure those guards exist to catch, one level up, and it would have shipped as "the auth guard passes" while nine admin write routes went unchecked. Fixed in commit `3569d80`: both now read `server/index.ts` PLUS every non-test `.ts` under `server/routes/`, discovered by walking the directory, so a new route module joins the checked set by existing rather than by somebody remembering. Counts restored to 348 and 170 with 0 orphans. Two things worth knowing for whoever owns these files: (1) the same one-path assumption may exist in other guards that scan the server, worth a sweep; (2) `npx prettier --write` on `check-auth-fetch.mjs` reformats the whole file and turned a 30-line change into 233 insertions, so that file is NOT currently prettier-clean and running the formatter on it will bury a real change in noise. |

## 7 - What I got wrong (coordinator errors, recorded at the same prominence as findings)

- **2026-08-31. I relayed an unverified claim to the founder and it was wrong.** The secrets
  lane reported that its `putSecret` throw would make a founder's Stripe-key save HANG under
  Express 4, because an async throw is an unhandled rejection. I repeated that to the founder as
  fact. The wiring lane MEASURED it: `server/index.ts:6717-6742` patches `app.get/post/put/delete`
  so an async rejection is forwarded to `next()` and lands on the terminal error handler, so the
  real symptom was an opaque `500 {"error":"Internal server error"}`, not a hang. Still a real
  defect (a founder had no way to learn the fix is one environment variable), and now a 503
  carrying the store's own sentence plus the recipe. But the skill's rule is explicit: verify a
  claim BEFORE it shapes the human's decision, not after. I did not, and I should have.

- **2026-08-31. My own S15 isolation check was invalid and I nearly acted on it.** I ran
  `npx vitest run server/loop.e2e.test.ts -t "S15"` to test whether S15 passes uncontended. It
  failed. But this repository's own notes BAN filtering that file, because it is order-dependent
  by rule, and `-t` skipped the 69 tests that build S15's state. Running the whole file
  unfiltered passes 70/70, twice. I caught it, but a coordinator who did not would have blocked
  a good push on a self-inflicted red.

- **2026-08-30. I dispatched twelve lanes at ONE MySQL and asked each to run a two-hundred-file
  suite against it.** My pristine control run measured 38 to 46 seconds PER FILE on
  database-backed suites under that load. Two costs: every lane full-suite run burns 20-plus
  minutes, and the numbers reflect machine load rather than code. The tokens lane duly reported
  `server/loop.e2e.test.ts` S15 failing in files it never touched; that test PASSES on pristine
  control at 052d042, so it was contention, not a regression. Corrected mid-round: lanes now run
  typecheck, build, their guards, and ONLY the suites covering their own files. The coordinator
  runs the full suite serially at integration and compares it against the control. This is the
  skill's own paired-reps warning (a dozen agents sharing one box) arriving as a bill.

- **2026-08-30. My brief to the tokens lane carried three wrong numbers, and the lane caught all
  three.** I said about 554 hex literals (real count 573), about 176 in Admin.tsx (real count
  213), and I named a second teal `#4A7C7C` that DOES NOT EXIST anywhere in the repository. Root
  cause of the Admin.tsx gap: my method counted matching LINES, and a single line can carry two
  literals. The lesson is the one already in every brief and it applies hardest to me: a number
  in a brief is a measurement with a timestamp and a method, and the method is the part that
  silently lies. The lane counting for itself before fixing is exactly the behaviour the briefs
  ask for.

- **2026-08-30. My own baseline harness reported a false green.** I captured the exit status
  after piping a gate through `tail`, so I read the status of `tail`. `pnpm check` exited 1
  while my log said the check exited 0. This is the silent-zero class the skill names,
  committed by the coordinator in the very act of measuring the baseline. Fixed by capturing
  exit codes with no pipe. Every lane: do not pipe a gate into anything before reading status.

### Error 12 - the wave-4 briefs carried wrong numbers too, and every lane that checked found one

The pattern from wave 3 repeated exactly. Recorded here rather than only inside each lane's own
section, because the whole point of this list is that it stays readable as a pattern.

- arch-admin: I wrote `Admin.tsx` at **11,418** lines. It is **11,419**. That file ends in a bare
  `}` with no trailing newline, so `wc -l` undercounts by one. The lane's new guard counts what an
  editor shows, since its error message asks a human to make a file shorter, and it has a test
  named for that case.
- arch-admin: I wrote **63%**; the measured figure is **64.7%** (817 of 1262).
- arch-admin: I briefed React.lazy per spec section 3.19. The spec does document it, but the
  conclusion does not transfer: `/admin` is ALREADY a lazy route, so splitting a tab out cannot
  lower the gated main-JS number, and a lazy tab would mint a chunk and burn a 4096-byte block for
  nothing. The lane used static imports and reported both numbers.
- arch-admin: my staged plan assumed tab-by-tab extraction was available. It is not, for 41 of 42
  tabs, and not for the reason I warned about. See R14.
- arch-store: I wrote **seven** tables using `dbCollection`. It is **nine**; `roles` and
  `role_holders` are missing from my brief AND from ledger section 13.
- arch-store: I wrote **~20** `replaceAll` call sites. It is **34**, plus 95 `all()` reads.
- arch-store: I endorsed REFUSING a stale write. Wrong, for a mechanical reason the lane measured
  and I had not: these are Express 4 async handlers with no wrapper, so a throw is an unhandled
  rejection and the steward's request HANGS instead of returning 500. It rebases instead.
- arch-store: a stale "next free 0121" in section 3. 0121 was taken.

Nothing in this list was caught by me. All of it was caught by lanes told, in their briefs, that
the numbers were measurements with a timestamp and that correcting me was the job.

## 7a - Wave 1 dispatch (2026-08-30)

All nine lanes dispatched concurrently off 052d042, disjoint file zones per the registry above.
Full effort on the three that judge (release, safety, ops); cheap models on the six mechanical
lanes (backup, neutral, kit, fleet, tokens, gates).

## 7b - backup lane landed (2026-08-30, on `wt/s2-backup`, not yet merged to main)

`db-backup.yml` now bundles dump.sql.gz + manifest.txt and GPG-encrypts to two recipients
before upload (production key, private half never in CI; a separate CI-only drill key that
lets `restore-drill` prove decrypt+restore on every run without ever holding the real key).
Both the backup job and both drill jobs fail closed if their required secret is unset, rather
than silently skipping. Added `restore-drill-negative-control`: corrupts a copy of the real
ciphertext and asserts GPG's own integrity check refuses it, so a green `restore-drill` means
something. Mechanism verified locally with a throwaway keypair before landing (see commit):
correct bundle decrypts with the drill key alone, a 32-byte-corrupted copy is refused with
`gpg: WARNING: encrypted message has been manipulated!`, exit 2. Uploads volume: NOT covered,
spec for the real fix (an authenticated export endpoint) written up precisely rather than
half-built; see blocker list above and `docs/FORK_RUNBOOK.md`. Three new secrets needed before
this runs green for real: see blocker list.

Gate results at `0aa1f71` (this worktree, after `pnpm install --frozen-lockfile`), each read
directly with no pipe: `node scripts/check-doc-links.mjs` exit 0 (41 refs, 6 docs, unchanged;
FORK_RUNBOOK.md is not in that script's own DOCS list so the append could not have broken it
either way), `node scripts/check-hyphen-dash.mjs` exit 0 (0 found), `node scripts/check-voice.mjs`
exit 0 (668 files, 2 pre-existing waivers, unchanged; neither touched file is in that script's
SCAN_ROOTS), `pnpm check` exit 0 (tsc --noEmit, matches the section 4 baseline). `pnpm build` and
`pnpm test` were not run for this lane; nothing here touches application code, only a workflow
file and an appended doc section. A manual scan for em/en-dash characters (U+2013/U+2014) inside
the newly appended FORK_RUNBOOK.md section specifically (not just the whole file, which carries
73 pre-existing ones from before this round) found zero.

Cross-lane contracts fixed at dispatch, so two lanes cannot invent different names:

- Image: `ghcr.io/rieki777/village-os`, tags `:<semver>` plus moving `:stable` and `:edge`.
  Provided by release, consumed by fleet.
- Rollout probe: `GET /health` reports the build SHA stamped by `scripts/build-server.mjs`.
  Made honest by ops, polled by fleet, exposed as `healthcheckPath` by release.
- CI steps: `.github/workflows/ci.yml` has ONE owner (safety). tokens and gates each need a
  step added and were told to file the request in the Blocker list below rather than edit it.

Every brief carried: re-verify every claim (the numbers are timestamped measurements, a lane
that corrects the coordinator is the lane working), run each new gate once against a
deliberately broken input and prove it goes red, capture exit codes without piping, commit
with `git add -p`, and do not push.

## 7b - Wave 2 dispatch (2026-08-30, founder approved)

Three lanes, all cut off the same base 052d042 while wave 1 runs. Overlap was MEASURED, not
assumed, before dispatch.

| Lane | Worktree | Branch | Owns (exclusive) | Effort |
|---|---|---|---|---|
| secrets | `../s2-secrets` | `wt/s2-secrets` | `server/lib/secrets.ts` | full |
| constitution | `../s2-constitution` | `wt/s2-constitution` | `shared/ballotSubjects.ts`, `server/lib/exchange.ts`, `server/lib/governanceWeights.ts` | full |
| brochure | `../s2-brochure` | `wt/s2-brochure` | the shopfront page and component files, plus its OWN new seed file | cheap |

### server/index.ts is now split by HUNK, and ops has been told

`server/index.ts` was assigned to ops alone in wave 1. It is now shared with constitution on
VERIFIED disjoint hunks, measured 2026-08-30 at 052d042:

- **ops keeps**: 4742 and 7483 and 20577 (submission email html), 5791 (module invariant
  asserts), 7347 (the /health route), 32355 (the startServer catch), 1085 (DEFAULT training
  copy).
- **constitution takes**: 13495 and 15185 (the launch electorate floor), 18466 (the exchange
  stock route), and the admin token-create route just below it near 18560.

Closest approach between the two sets is about 2000 lines. Neither lane may edit outside its
listed hunks in that file. This was relayed to the ops lane directly at dispatch time, not
merely recorded here: a correction the corrected party has not been told is half a correction.

### Other measured non-collisions (so they are not re-litigated)

- The legal and brochure pages carry almost no colour literals (ResidentRights.tsx has 1,
  WhyCostaRica.tsx and ProjectHistory.tsx have none), and the tokens lane is working in admin
  panels and components, so brochure and tokens do not collide in practice. The single hex
  literal in ResidentRights.tsx belongs to TOKENS, not brochure.
- `server/lib/exchange.ts`, `shared/ballotSubjects.ts` and `server/lib/secrets.ts` are held by
  no wave 1 lane.
- `server/seeds/content-seed.json` belongs to NEUTRAL. brochure may not touch it and must
  create its own new seed file instead.

### Migration numbers

Next free is still **0121**. brochure is the only wave 2 lane likely to need one. Claim it in
section 3 of this ledger BEFORE creating the file. Gaps at 0111 and 0115-0119 stay burned.

## 7c - The control worktree (lanes: this exists, do not build your own)

`C:/Users/taren/Desktop/Amora/s2-control` is a PRISTINE detached worktree at 052d042 with
dependencies installed. It exists so the coordinator can measure a real baseline for build and
test, because the landing criterion is NO WORSE THAN BASELINE rather than "green", and a
remembered green is a sample and not a proof.

It is announced here on purpose. A previous program cut a pristine baseline worktree, never
told the lanes, and one lane built its own and broke its dependencies doing it.

Rules for it: read from it freely, never write to it, never commit in it. If you need a clean
comparison run, use it rather than resetting your own tree.

## 7d - fleet lane landed (2026-08-30, on `wt/s2-fleet`, not yet merged to main)

Built the whole control plane in `ops/**`, nothing touched outside it:

- `ops/fleet.json.example`: the manifest schema. Per village: id, name, hosting
  (`"regen"` or `"self"`, modeled explicitly, not inferred), ring, domain, healthUrl,
  steward, and either `deploy.{stopCommand,startCommand}` (regen) or `notify.{method,target}`
  (self). Pins carry `version`, `reason`, `pinnedAt`, `expiresAt`. No real `ops/fleet.json` is
  committed; there is no real per-village data yet (no founder onboarded), and the file design
  never holds a literal secret regardless (commands reference `$ENV_VARS`, resolved by the
  shell at run time), so a real one is safe to commit later without a `.gitignore` line.
- `ops/roll.mjs`: `plan` (default, pure reads, never runs a command), `apply` (the real thing,
  requires the word), `check` (the same health-wait loop aimed at one URL, used for both
  preflight and the proofs below). Walks rings strictly in the declared order, one village at a
  time (never parallel within a ring, on purpose: the harm metric is "the FIRST unhealthy
  village", and parallelizing blurs which one that was). Halts and pages on the first failure;
  never touches a later village or ring after a halt.
- `ops/README.md`: how to run a rollout, pin/unpin (hand-edit the JSON, capped by
  `maxPinDays`), what a halt means and what to do about it, and the two proof commands below.

**Cross-lane contract, re-verified myself, not just trusted from section 7b:** read
`server/index.ts` directly. `GET /health` (line 7347) returns
`{ status, build: BUILD_MARKER, timestamp, uploads }`; `GET /api/platform/info` (line 13243)
also exists and separately returns `version: PLATFORM_VERSION` (currently `"1.1.0"`,
`server/lib/identity.ts:33`) alongside the same `build`. `BUILD_MARKER` (line 792) is
`` `${BUILD_LABEL}-${sha||"dev"}` ``, and `BUILD_LABEL` (`"2026-07-28-wave1"`) itself contains
hyphens, so `roll.mjs` extracts the SHA as the LAST hyphen-delimited segment, not by splitting
on the first hyphen. Confirmed the same convention independently in
`docs/FORK_RUNBOOK.md:639-641` ("`/health` -> ok, and its `build` reads `<label>-<git sha>`").
`scripts/build-server.mjs` stamps it from `RAILWAY_GIT_COMMIT_SHA` / `GITHUB_SHA` /
`SOURCE_VERSION`, sliced to 7 chars, falling back to a local `git rev-parse` and then to `""`
(reads as `"dev"`), never a guess.

**Stop then start, confirmed before designing anything.** `server/repos/store-db.ts:21`: "One
process per deployment (Railway) is what makes the cache sound." `apply` runs `stopCommand` to
completion (checked exit code) before it ever runs `startCommand`, and the manifest requires
both fields separately rather than one `redeploy` command, precisely so a blue/green primitive
can't be dropped in as a single-field shortcut. `ops/README.md` says outright that this script
can only enforce the ordering between the two commands, not what happens inside them, and that
a `stopCommand` which returns before the old process has actually exited defeats the design.

**Why the deploy adapter is an opaque shell command, not a Railway API client.** The brief's
contract only fixes the image and its tags; how a given village actually gets redeployed is not
committed to Railway specifically anywhere in code I could find, and `docs/FORK_RUNBOOK.md:41`
names Railway, Fly and Render as valid targets for a fork in the same breath (`TRUSTED_PROXY_HOPS`
guidance). Hardcoding a Railway GraphQL mutation I could not verify against a live token felt
worse than the honest alternative: `deploy.stopCommand` / `deploy.startCommand` are plain shell
strings with `{{TAG}}` substitution, run with the operator's own environment already in scope.
`ops/fleet.json.example` ships these as `echo FILL_IN_...` placeholders since no real per-village
deploy target exists yet (release lane has not published railway.toml or a Dockerfile in this
worktree; confirmed by their absence).

**The central risk, addressed and proven, not just asserted.** `probeOnce()` in `roll.mjs` has
exactly one path back to `ok:true`: an HTTP 200 whose body has `status:"ok"` AND a `build` field
whose trailing SHA equals the one being rolled. Every other outcome, unreachable, timeout,
non-200, unparseable JSON, `status` not `"ok"`, no `build` field, a `build` field that doesn't
end in a recognizable SHA, or a SHA that doesn't match, returns `ok:false` with a named reason.
Proved both required failure modes with the same `check` subcommand real `apply` calls
internally:

```
$ node ops/roll.mjs check --url http://village-that-does-not-exist.invalid.test/health --sha 0000000 --timeout-ms 6000 --interval-ms 2000
CHECK   adhoc  http://village-that-does-not-exist.invalid.test/health  expecting sha 0000000  timeout 6000ms  interval 2000ms
  attempt 1: unreachable (fetch failed)
  ...
RED     adhoc  never became healthy at the expected sha: unreachable (fetch failed), 4 attempt(s)
$ echo $?
1
```

```
$ node -e "require('http').createServer((_,r)=>{r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify({status:'ok',build:'2026-07-28-wave1-deadbee'}))}).listen(8843)" &
$ node ops/roll.mjs check --url http://127.0.0.1:8843/health --sha 1234567 --timeout-ms 6000 --interval-ms 2000
  attempt 1: sha_mismatch (got deadbee, want 1234567)
  ...
RED     adhoc  never became healthy at the expected sha: sha_mismatch (got deadbee, want 1234567), 4 attempt(s)
$ echo $?
1
```

A control run against the same fake server with `--sha deadbee` (the SHA it actually serves)
returned `GREEN ... healthy at 2026-07-28-wave1-deadbee after 1 check(s)`, exit 0, so the logic
demonstrably can pass, it just never passes without a positive match.

**A real bug caught by my own testing before commit, not by the coordinator.** First draft's
pin-skip check (`isActivelyPinned`) read an EXPIRED pin as no-longer-pinned and rolled the
village straight through, exactly the silent accumulated-migration jump the fleet rules exist to
forbid, and directly contradicted what the README I had already written claimed it did. Caught it
by testing an expired-but-still-in-cap pin against `plan` and watching it print `WOULD REDEPLOY`
instead of `SKIP`. Fixed: renamed to `isPinned`, now `!!v.pin` with no expiry check at all,
expiry only ever feeds the loud `stalePins()` warning (`plan` and `apply` both print it every
run). Re-ran the same case after the fix: `SKIP founder-wave1-a pinned ... ` plus the warning
line, confirmed. Also confirmed the pin cap itself is enforced at manifest LOAD time, not just
observed at runtime: a pin window of 285 days against `maxPinDays: 30` makes `roll.mjs` refuse
to run at all (exit 2), for either `plan` or `apply`, before touching any village.

**Nothing in the brief was wrong.** Both endpoint names, the SHA-stamping mechanism, and the
single-process cache constraint checked out exactly as briefed, against the code, not against
the brief's description of it.

Gate results at `052d0422b5fbeea86e4309822bdc31a0c8b41f72` (this worktree, after
`pnpm install --frozen-lockfile`), each read directly with no pipe: `node scripts/check-doc-links.mjs`
exit 0 (41 refs, 6 docs, unchanged; `ops/README.md` is not in that script's DOCS list), `node
scripts/check-hyphen-dash.mjs` exit 0 (0 found; that script only scans `client/src` anyway),
`pnpm check` (`tsc --noEmit`) exit 0. Also ran, as extra diligence beyond the three named gates
since `ops/**` lands in a HARD-CLEAN zone for it: `node scripts/check-brand-refs.mjs` exit 0
("hard-clean zones are clean"). `pnpm build` and `pnpm test` were not run; nothing in `ops/**` is
imported by server or client code, and the lane is scoped cheap.

## 7e - tokens lane landed (2026-08-30, on `wt/s2-tokens`, not yet merged to main)

**Brief numbers re-verified, mixed result.** The brief's rough count (roughly 554 hex literals,
roughly 331 of them two teals) was close but wrong in one specific way worth recording: there is
only ONE legacy teal, not two. `#2D5A5A` appears 331 times across 35 files, matching the brief
almost exactly; `#4A7C7C`, the brief's second teal, was searched for case insensitively across
the whole repo (not just `client/src`) and appears NOWHERE, not in a single file. Did not touch
anything on the strength of that claim. Also: Admin.tsx carried 213 raw hex occurrences before
this lane touched it (211 of them `#2D5A5A`), not the brief's "roughly 176"; the brief's own
counting method undercounted by measuring matching LINES instead of occurrences, which
undercounts any line carrying more than one literal (Admin.tsx has plenty, e.g.
`"bg-[#2D5A5A] text-white border-[#2D5A5A]"` is one line, two hits).

**What shipped:**

- `scripts/check-theme-literals.mjs` + committed `scripts/theme-literals-baseline.json`: a
  ratchet on theme-bypassing colour literals in `client/src/**/*.tsx`, modelled on
  `check-brand-refs.mjs` (per-file baseline, so moving literals to a new file cannot stay green)
  and, per this round's explicit instruction, `check-image-budget.mjs`'s refusal to ever let
  `--update-baseline` write a total higher than the one already committed (`check-brand-refs.mjs`
  does not refuse that; this one does). Strips every `var(...)` span, fallback argument included,
  before counting, so the platform's own established `var(--tone-brand, #157f7d)` pattern
  (CircleScene.tsx, MoonGlyph.tsx, YearWheel.tsx) costs nothing. Proof of the refusal, run by
  hand at `2a527b9`: staged a literal in a previously clean file, the gate failed at exit 1;
  `--update-baseline` against that same regression also exited 1 and the baseline file on disk
  was confirmed byte-identical afterward. Reverted the test literal before the real commit.
- Retired `#2D5A5A` everywhere: all 331 occurrences across 35 files were the identical
  `-[#2D5A5A]` Tailwind arbitrary-value fragment (verified before touching anything, so a single
  mechanical `-[#2D5A5A]` to `-teal-deep` pass covers every one with no partial-class risk), plus
  Admin.tsx's two `hover:bg-[#234747]` sites folded into the existing `teal-deep-dark` hover
  token. `teal-deep` and `teal-deep-dark` were already load-bearing tokens used in 129 other
  files before this lane touched anything, not new invented names.
- `MobileTabBar.tsx` and `MobileFab.tsx`, the two highest-visibility mobile shell surfaces (tab
  bar and floating action button, both `client/src/components/mobile/`), fully routed off
  hardcoded teal/amber/cream hex through `teal-band`, `teal-deep`, `amber`, `cream`, or a
  `var(--tone-*, <original literal>)` fallback where the exact original shade mattered. The focus
  scrim moved from a one-off `#062322` to `bg-black/45`, the same convention nine other
  dialog/drawer/sheet/overlay surfaces already use.
- Six more near-duplicate literals swept once the ratchet surfaced them: `ResidentRights.tsx`'s
  `#2e5a58` and `InvestorJourney.tsx`'s `#1f7a78` are both within a couple of RGB units of an
  existing token and snapped to it; `InvestorJourney.tsx`'s two `#3d6e4a` are an EXACT match for
  the already-defined `--color-sage` token.
- Nine genuine false positives waived with `theme-ok: <reason>`, not silently dropped: three
  colour-input defaults/placeholders in `LookPanel.tsx` (the seed-colour wizard itself, which
  necessarily shows hex text before a founder has picked one), two more of the same shape in
  `MapSkinPanel.tsx`, one placeholder in `EventsAdminPanel.tsx`, and one CSS attribute-selector
  string in `components/ui/chart.tsx` that MATCHES recharts' own hardcoded `#ccc`/`#fff` to
  override them with token classes, rather than applying either hex itself.

**Baseline: 162** (down from 573 raw hex occurrences in `client/src/**/*.tsx` measured before any
fix in this lane, by plain grep; the two numbers are not directly comparable, since the ratchet
gate also counts non-var `rgb()`/`hsl()`/`oklch()` literals the raw hex grep did not, and
correctly excludes literals living inside a `var(...)` fallback that the raw grep could not tell
apart from a real bypass). Measured the same way at the end: 225 raw hex occurrences remain,
nearly all inside `var(...)` fallbacks or the two remaining hard cases below.

**What the ratchet deliberately does NOT cover, and why left alone:**

- Tailwind's own default palette classes: `text-gray-*` alone measures EXACTLY 1,287 across
  `client/src`, matching the brief's figure precisely. These are not LITERALS in the sense this
  ratchet gates (no hex, no rgb/hsl function), they are Tailwind's own built-in colour scale, a
  separate and much larger problem with a different fix shape (swap to semantic tokens like
  `text-muted-foreground`, not a mechanical find-replace). Flagging as a follow-up, not folding
  into this ratchet's number, since conflating the two would make one gate measure two different
  kinds of debt with two different fix shapes.
- `client/src/components/crowdpool/PoolPieces.tsx` (73 literals) and its sibling
  `Crowdpool.tsx`/`CrowdpoolCampaign.tsx` pages (35 more): a "sepia treasure map" art style for
  one specific game feature, deliberately NOT the village's brand palette. Left alone on
  purpose, not as debt.
- `power/DecideLens.tsx` (10) and `governance/QuorumField.tsx` (6): colourblind-safe (Okabe-Ito
  style) palettes distinguishing decision-making methods and speaking/silent states from each
  other. These need to stay visually distinct from each other regardless of a village's brand
  colour, which is an accessibility requirement in tension with, not solved by, tokenisation.
  Counted, not waived, since they are still literals a founder's colour cannot reach; flagging
  the tension rather than resolving it by fiat.
- `pages/Characters.tsx` (4): discrete skin-tone swatch options offered to the player, not brand
  chrome.
- `components/ManusDialog.tsx` (7): appears to be a vendored/example dialog component (the name
  matches no other identifier in this codebase); left alone rather than guessing at a rewrite.

**Gate results at `4892c97`** (this worktree, after `pnpm install --frozen-lockfile`), each read
directly with no pipe: `pnpm check` exit 0, `node scripts/check-hyphen-dash.mjs` exit 0 (0
found), `node scripts/check-brand-refs.mjs` exit 0 (unchanged: 52 legacy refs against a 63
baseline, 7 waivers), `node scripts/check-theme-literals.mjs` exit 0 (162 of a 162 baseline),
`pnpm build` exit 0 (`dist/index.js built @ 4892c97`), `node scripts/check-dist-budget.mjs` exit
0 (5768 KB of the 6600 KB block-charged ceiling, byte-identical to the pre-lane measurement in
this same worktree, so this lane's pure className/style-string edits did not move it). `pnpm
test`, run with the coordinator's corrected `.env` / `TEST_DATABASE_URL`, exit 1: **202
of 203 test files passed, 3056 of 3057 tests passed** (2497.75s, real MySQL round trips, not
mocked). The ONE failure is `server/loop.e2e.test.ts` > "S15: the tools hub rides the framework,
lifecycle posture end to end", asserting an SSRF guard on `PUT /api/admin/tools/:id` returns 200
and getting 500 instead (line 1484). Confirmed before writing this down, not assumed: grepped for
every file this lane touched against `server/loop.e2e.test.ts` and `server/index.ts` (the two
files that own this test and the route it exercises) and found zero overlap; this lane edited only
`client/src/**/*.tsx` and `scripts/check-theme-literals.mjs`, neither of which that test imports
or could affect. `server/**` is the ops lane's, not this one's, to fix. Recording this as a
PRE-EXISTING failure this lane observed, not one it caused, and leaving it for ops rather than
touching a file outside this lane's ownership.

**CI step requested, not applied** (this lane does not own `ci.yml`): filed in section 6.

## 7e - Landed lanes (verified by the coordinator, not self-reported)

Status ladder: CODED means the lane committed and its own gates were green at a named SHA.
VERIFIED means the coordinator confirmed it. Nothing here is merged to main yet.

| Lane | SHA | State | Note |
|---|---|---|---|
| backup | `0aa1f71` | CODED | GPG encryption to two recipients, fail-closed on missing secrets, plus a negative-control job that corrupts the ciphertext and asserts refusal. Proved red locally before landing. Spec'd the uploads endpoint rather than half-building it in a file it does not own. |
| fleet | `a980d0b` | CODED | Manifest plus ring roller; self-hosted villages modeled as notify, never redeploy. Proved red on an unreachable village AND on a wrong SHA, and green on a correct one. Caught a bug in its own draft where an expired pin read as unpinned. |
| tokens | `4892c97` | CODED | Theme-literal ratchet that refuses to raise its baseline; 331 occurrences of the legacy teal retired to tokens. Corrected three of my numbers. Dist budget byte-identical at 5768 KB of 6600 KB. |

### Corrections these lanes made to the coordinator, all verified

- The repository is now PRIVATE (flipped 2026-08-31T03:21Z). My blocker entry saying otherwise
  was stale. Verified directly with `gh repo view`.
- **29 unexpired, unencrypted `db-backup-*` artifacts remain** in the repository, dated
  2026-08-02 to 2026-08-29. Going private does not retroactively protect them.
- **The daily backup has been FAILING since 2026-08-28.** Runs on 08-29 and 08-30 both failed
  with access denied for user root. Consistent with the database password having been rotated
  without updating the `PROD_DATABASE_URL` repository secret. Verified with `gh run list`.

## 7g - Integration state, seven lanes (coordinator-run)

`wt/s2-integration` now carries main plus SEVEN lanes, merged in this order:

    backup -> fleet -> tokens -> ops -> constitution -> kit -> neutral

One conflict in the whole set, exactly where predicted: `docs/FORK_RUNBOOK.md`, where backup
and kit both appended dated sections. Resolved by keeping BOTH and stripping only the markers,
never picking a side. Verified afterwards that both sections survive.

The ops-versus-constitution hunk split in `server/index.ts` HELD. They merged clean. Worth
recording that the ops lane measured its nearest hunk at about 530 lines from a constitution
zone, not the roughly 2000 I estimated, so my margin was three times thinner than I claimed. It
still held, but the lesson is that the coordinator's estimate was the loose number.

GATES ON THE SIX-LANE TREE at **485ab2f**, exit codes captured with no pipe, in a worktree with
dependencies installed and a test env present. ALL GREEN:

    install 0 | pnpm check 0 | pnpm build 0 (dist/index.js built @ 485ab2f)
    brand-refs 0 | voice 0 | hyphen-dash 0 | doc-links 0 | auth-fetch 0 | admin-reach 0
    save-honesty 0 | repo-payloads 0 | mirror-annotations 0 | upload-strip 0
    artifact-budget 0 | route-reachability 0 | map-routes 0 | image-budget 0
    theme-literals 0 | dist-budget 0

Sixteen guards plus typecheck and build. The two migration gates are NOT in that list because
they live on the safety branch, which had not merged at that point.

Neutral merged after that run, at a3f4829, and its gates are re-run as part of the next pass.

STATE REMAINS "CODED, COORDINATOR-VERIFIED LOCALLY". GitHub CI has still never run on any of
this. The founder has since authorised pushing to main (the Amora village is not in use), so
the push will happen after the full suite runs serially against a completed control baseline.

## 7f - Integration branch (coordinator-run, not pushed)

`wt/s2-integration` in `../s2-integration` carries main plus the three landed lanes, merged in
this order with no conflicts at any step, ledger sections included:

    main ffb3199 + wt/s2-backup -> 57f1fb8 + wt/s2-fleet -> ec94684 + wt/s2-tokens -> 80a874c

GATES RUN BY THE COORDINATOR on the integrated tree at **80a874c**, exit codes captured with no
pipe, in a worktree with dependencies installed and a test env present:

    install 0 | pnpm check 0 | pnpm build 0 (dist/index.js built @ 80a874c)
    check-brand-refs 0 | check-voice 0 | check-hyphen-dash 0 | check-doc-links 0
    check-image-budget 0 | check-theme-literals 0 | check-dist-budget 0

Theme-literal guard reports 162 literals across 14 files against a baseline of 162, 7 waivers.

STATE IS "CODED, COORDINATOR-VERIFIED LOCALLY". It is NOT the ladder's VERIFIED state, which
requires CI green on that exact SHA. Nothing has been pushed, so GitHub CI has never run on any
of this. Pushing `main` in this repository deploys production, so the push is a founder
decision and is deliberately not the coordinator's to take.

The full test suite has NOT been run on the integrated tree. It will be, serially, once the
lanes stop competing for the one local MySQL, and compared against the pristine control.

## 7g - gates lane landed (2026-08-30, on `wt/s2-gates`, not yet merged to main)

Objective: no gate in this repo can report success without having actually run, and the
guards that protect the fleet are themselves tested. Three commits, `scripts/*.test.mjs`,
`vitest.config.ts`, `server/db/provisioningReport.ts` only, per the lane's boundary; did not
touch `server/db/testDb.ts`, `ci.yml`, or `scripts/brand-refs-baseline.json`.

**Brief re-verified, one number corrected downward in confidence, nothing else wrong.** The
brief's "roughly 44 database-backed test suites" undercounts the literal call sites: every
`describe.skipIf(` in this tree gates on `testDbConfigured()` (confirmed, zero exceptions),
and there are 133 of them across 79 files, not ~44. The 44 in the brief traces to a different,
correct number already in the tree's own comments (`provisioningReport.ts`: "44 provisions per
full run"), which counts scratch schemas per full suite run, not `skipIf` call sites; the two
numbers measure different things and both are real. The fix now reports the live 133 rather
than either fixed number, so it cannot go stale either way.

**What shipped:**

- `server/db/provisioningReport.ts`: `teardown()` now throws when `process.env.CI` is set and
  zero suites provisioned a schema (`noteProvision` recorded nothing). The message names a
  live count of `describe.skipIf(` call sites read from the tree at failure time, not a
  hardcoded guess. Local runs (no `CI` env var) are untouched by design.
- `vitest.config.ts`: `include` widened from `client/**/*.test.ts` to `client/**/*.test.{ts,tsx}`.
  Zero `.tsx` tests exist today; the gap was that one written tomorrow would never run and
  `pnpm test` would stay green throughout.
- `scripts/check-brand-refs.mjs`: `--update-baseline` now refuses to write a per-file count
  higher than the one already committed, matching `check-image-budget.mjs`'s ratchet discipline
  (ported per-file, not per-total, since the gate itself enforces `count > baseline[file]` one
  file at a time). `--force` is the explicit escape hatch for a deliberate raise, and it still
  prints every file that rose. `scripts/brand-refs-baseline.json` itself was never touched
  (neutral lane's file); the refusal logic was proven against an isolated fixture tree, not the
  real baseline.

**Proof each gate goes red, run at commit `7976b29` on `wt/s2-gates`:**

1. **The trapdoor, reproduced against the real repo, not a fixture.** With `.env` moved aside
   (no `TEST_DATABASE_URL`) and no `CI` set: `pnpm test` exits 0, `135 files passed | 68 skipped
   (203)`, `1979 tests passed | 1078 skipped (3057)`. Same tree, same missing env, `CI=true`:
   `pnpm test` now fails at startup with `[provisioningReport] CI is set and zero DB-backed
   suites provisioned a schema this run ... every one of the 133 describe.skipIf(...) suites
   ... silently skipped`, exit 1. Restored `.env` afterward and reran the no-CI case: identical
   `135 passed | 68 skipped`, exit 0, confirming the fix changes nothing locally. (These exact
   numbers, 135/68 and 1979/1078, were independently measured by the coordinator on pristine
   trunk before this lane finished; matched exactly.)
2. **check-brand-refs.mjs, isolated fixture (real repo baseline never touched).** Baseline said
   1 reference; raised the fixture file to 3. Plain gate: fails, exit 1, `3 brand reference(s),
   baseline allows 1`. `--update-baseline` without `--force`: refuses, exit 1, baseline file on
   disk byte-identical to before. `--update-baseline --force`: succeeds, exit 0, prints
   `baseline RAISED for 1 file(s) ... 1 -> 3`, baseline now reads 3. Lowered the fixture back to
   1 and ran `--update-baseline` with no force: succeeds normally, baseline back to 1. All four
   outcomes as designed.
3. **vitest.config.ts, the `.tsx` gap.** A deliberately failing `_fixture_tsx_pickup.test.tsx`
   under `client/src/lib/`: under the NEW `include` pattern, vitest collects it and reports it
   failed (`expected 1 to be 2`), exit 1. Under the OLD pattern (`client/**/*.test.ts`) run in
   isolation against the same file: `No test files found, exiting with code 1` (glob simply does
   not match the extension). Fixture removed before commit; real client suite reran clean after,
   `40 files passed (40)`, `491 tests passed (491)`.
4. **The three guard regression tests, standing alone (none are wired into any workflow yet;
   see the Blocker list, section 6):** `node scripts/check-brand-refs.test.mjs` (9/9 checks),
   `node scripts/contribution-scan.test.mjs` (24/24 assertions), `node
   scripts/intake-classify.test.mjs` (13/13 assertions), all exit 0. Confirmed each is a real
   gate, not a script that always exits 0, by reading the source: `check-brand-refs.test.mjs`
   uses uncaught `assert.strictEqual` (throws, non-zero exit, on any failure); the other two
   explicitly `process.exit(failures === 0 ? 0 : 1)`.

**Targeted, not full-suite, per the coordinator's protocol change mid-lane.** Ran: `pnpm check`
(exit 0), `npx tsc -p tsconfig.tests.json --noEmit` (exit 0), `pnpm build` (exit 0, `dist/index.js
built @ 052d042` then re-verified after each commit), `node scripts/check-brand-refs.mjs` (real
gate, unmodified baseline: unchanged, `52 legacy reference(s) ... baseline 63`), `node
scripts/check-hyphen-dash.mjs` (0 found), `node scripts/check-voice.mjs` (clean across 668
files, extra check not in the brief's required list), `npx vitest run client` (`40 passed |
491 tests passed`, the one test-file subtree this lane's `vitest.config.ts` change touches),
plus the three `.test.mjs` guard tests above and the trapdoor reproduction, which is a stronger
proof than any single targeted test file since it exercises the real global teardown against
the real tree. Did not run the DB-backed `server/**` suite at full scale; no file this lane
changed has a dedicated DB-backed test, and the machine is shared across twelve lanes on one
MySQL (38 to 46s per DB-backed file under this round's contention, confirmed once before the
protocol changed).

**All en/em dashes swept from own diff before each commit** (found and fixed 5 during work: 3 in
`check-brand-refs.mjs`/`provisioningReport.ts` comments, 3 in this ledger section's first
draft, later reduced to 0; counts verified with a Node Unicode scan, not a `grep -P` which
silently returned a false clean pass on this machine's locale, i.e. the exact silent-failure
class this whole lane exists to catch, caught in its own tooling).

**CI steps requested, not applied** (this lane does not own `ci.yml`): filed in section 6, one
row for the three guard regression tests.

## 7h - Landings, second batch, and what the lanes corrected

| Lane | SHA | Headline |
|---|---|---|
| ops | `e726e5a` | Boot alert reaches a real collector with no database involved; `/health` proven red four ways (cut, refused, blackholed, restored) and not latching; per-module quarantine; uploads gauge no longer walks the volume per request. |
| kit | `3725007` | README, `.env.example` with 27 documented variables, `fork-init.mjs`, `PROVISIONING.md`, and the founder-facing Claude setup prompt. |
| neutral | `452ab2b` | Neutral palette computed and contrast-checked, blank logo and favicon falling through to the platform mark, seed links stripped, 8 orphaned Amora images deleted, image budget ratcheted down 2216 to 2117 KB. |
| gates | `7976b29` | The silent-skip trapdoor now FAILS under CI; brand baseline refuses to raise; vitest picks up `.test.tsx`. |
| brochure | `fe3f3e1` | 22 jurisdiction-specific legal and tax claims out of compiled JSX into runtime content, with honest placeholders on a fresh instance. |

### Corrections the lanes made to me, all of which I accepted

- **gates:** my "about 44 database-backed suites" was wrong. There are **133** `describe.skipIf` call sites across 79 files. 44 is a real but different number (scratch-schema provisions per run). The thrown message now counts them live so it cannot go stale.
- **gates, and this one may affect other lanes:** `grep -P` returned a FALSE CLEAN on this machine when scanning for em dashes, matching nothing while the true count was three. The authoritative check is `node scripts/check-hyphen-dash.mjs`, which is Node-based. A grep-based self-check is not a check here.
- **brochure:** found a whole class I never briefed. **Twelve** occurrences of US 508(c)(1)(a) tax-deductibility claims, promising the reader a deduction on their own tax return, on the page collecting their money. False for any fork outside the US. Arguably a sharper harm than the Costa Rica land-law claims I did brief.
- **brochure:** `Housing.tsx` does not render `WhyCostaRica` as my brief assumed, but carries its own independent tax-free claim, so the check was right by a different mechanism.
- **neutral:** my brief named `content-seed.json`, which turns out to be DEAD DATA (the journey pages hold their own copy). The three seed files it did not name (`quests`, `roles`, `site-content`) are the live ones.
- **neutral:** reported honestly that it did NOT fully meet its objective, leaving `project.name` and `memberName` as Amora with a reasoned argument, rather than rounding up. A follow-up identity lane was dispatched for that plus the `Amora Admin` over `game.amora.cr` header in the admin panel.

## 7j - The two constitutional exploits, reproduced then closed

Both were REPRODUCED end to end over HTTP against the built `dist/index.js` at 052d042 before
any fix, then refused afterwards with the exploit conditions unchanged. This is evidence, not
an argument.

**Exploit 1, a founder carrying the launch vote alone.** Founder set `weight_mode=custom`,
allocated weight 1 to self and nothing to the other two members. `/api/admin/launch` reported
`onTheRoll: 3, tooFew: null`. The ballot opened with `unity_pct=100, quorum_pct=100,
electorate_count=3, total_weight=1`. The founder's single yes closed it as **outcome passed**,
`app_config.game-start` was written, the frozen document told the village *"100% participation
and 100% agreement"* and *"3 people hold a voice today"*, and a token mint then returned 200.
AFTER: the launch route refuses in plain language, propose returns 409, ZERO rows land in
`ballots`, and game-start stays null.

**Exploit 2, the governance token bought with a card.** Created `assembly-voice` (kind voice,
governance platform), listed it purchasable, priced it at 5.00, and stocked **100 voice minted
out of `sys:mint` into the treasury**. A member's buy reached the LAST gate (card payments not
configured), meaning kind, governance, one-seller, price, stock and stage had all passed. The
founder then pointed `governance.weight_token` at it in token mode. AFTER: listing 409, stock
409 with a measured `COUNT(*) = 0` in `token_ledger`, buy 404, and ordinary credits still work.

**A second hole the coordinator never named:** `equity` was refused only via
`governance === 'hypha'`, which held by ACCIDENT of the 0006 seed. A platform-governed equity
token traded freely. The positive test (only credit-kind trades) closes it and fails closed for
any kind a future migration invents.

**Boot sweep proven with a false-positive control**, which is the part that makes it a check:
a pre-existing bad row makes boot exit 1 naming the token; the same row with `weight_mode=equal`
boots fine, because the dial is inert and refusing would brick a village for a reason that is
not true.

**Residual, disclosed and not fixed:** a launch can still carry on one yes and two abstentions.
That is R74 plus the engine's documented abstain rule, it takes three people choosing to
answer, and changing it means editing `governanceEngine.ts`. Recorded rather than silently left.

## 7k - TWO intermittent tests, both resolved against the control, and I caused the condition

Two lanes independently reported a failing test. Neither is a regression. Both PASSED in the
definitive control run at 052d042, which finished 203/203 files and 3057/3057 tests with ZERO
failures and zero skips:

    server/loop.e2e.test.ts  S15 tools hub                          PASSED  422ms
    server/governance.routes.e2e.test.ts  (9 tests)                 PASSED  31710ms

- The constitution lane saw S15 fail once, then did the right thing rather than assuming: it
  checked out the base ref in its own worktree, rebuilt, ran the control at 70/70 green, and
  re-ran its own branch at 70/70 green.
- The kit lane saw the governance advisory notification assertion fail and correctly refused to
  touch a file outside its zone, flagging it instead.

**THE CONDITION WAS MINE.** Twelve lanes were running full suites against ONE local MySQL
because of my dispatch. That is not a state this repository is ever in normally, and it is the
same coordinator error already recorded above. So "flaky" here means "flaky under a contention
level the coordinator manufactured", which is a weaker claim than "flaky in CI".

**But it should not be dismissed**, for one specific reason. S15 writes through the JSON-backed
`toolsRepo`, and the original architecture audit independently flagged
`dbCollection.replaceAll` as a DELETE-then-reinsert of a caller-held snapshot with no per-row
upsert and no version guard, naming the tools link-check job as a live lost-update window. A
contention race there is exactly the shape that finding predicts, and a Railway deploy that
briefly overlaps two containers is a real-world instance of the same condition. It belongs on
the improvements list, not in the bin.



Two lanes independently saw `server/loop.e2e.test.ts` S15 fail (`PUT /api/admin/tools/:id`
returning 500). The constitution lane did the right thing rather than assuming: it checked out
052d042 in its own worktree, rebuilt, ran the control at **70/70 green**, then re-ran its own
branch at **70/70 green**. So it is intermittent on this machine and belongs to nobody's change.

The plausible cause is worth carrying into the improvements list: that route writes through the
JSON-backed `toolsRepo`, and the original architecture audit flagged `dbCollection.replaceAll`
as a DELETE-then-reinsert of a caller-held snapshot with no per-row upsert and no version guard,
with the tools link-check job named as a live lost-update window. A file or row contention race
under twelve concurrent lanes is exactly the shape that finding predicts.

## 7l - The container image is UNEXECUTED, and why that is acceptable for this push

`docker` is not installed on this machine (`command not found`, verified). So the release
lane's `Dockerfile` has never actually been built or booted anywhere. It is reviewed code, not
demonstrated code, and the report must say so rather than implying an image exists.

The Dockerfile itself is well made. Its last RUN re-derives the server's real runtime
dependency list FROM THE BUILT BUNDLE and fails the build if any of it is unresolvable, so
nobody maintains that list by hand. It names the two dependencies that reading the source
misses: `sharp` arrives through a dynamic import, and `dotenv` through a side-effect import
with no from clause.

WHY THIS DOES NOT BLOCK THE PUSH, and the distinction matters:

- Pushing `main` deploys Amora through the EXISTING nixpacks path in `railway.toml`. That path
  is unchanged by this work and has deployed this village many times.
- The image is only built by `.github/workflows/release.yml`, which triggers on a pushed SEMVER
  TAG. No tag is being pushed. So the container work is additive and dormant.
- The release workflow boots the image and checks its health BEFORE publishing to the registry,
  so the first real exercise of the Dockerfile fails in CI rather than reaching a village.

CONSEQUENCE FOR THE FLEET PLAN: the fleet roller cannot be exercised end to end until a tag is
cut and the first image publishes. That is the next milestone after this push, and it should be
done deliberately, watched, and on a scratch target before Amora.

## 7m - DECISION: the release lane is HELD OUT of this push

The release lane found a blocker I had reasoned past, and it is right.

**Adding a root `Dockerfile` can silently change how Railway builds production.** Railway's own
config-as-code reference says it will always build with a Dockerfile if it finds one, and
`NIXPACKS` is no longer among the documented `builder` values (the documented ones are
`RAILPACK` and `DOCKERFILE`), so `builder = "nixpacks"` in `railway.toml` may already be inert.
I had told the founder that pushing main was safe BECAUSE it deploys through the unchanged
nixpacks path and the image only builds on a tag. That reasoning is wrong if the mere PRESENCE
of the file flips the builder. The release lane deliberately did not touch the builder line,
would not change production's build path as a side effect of adding a file, and said it needs
one deliberate deploy to settle.

**DECISION: `wt/s2-release` is NOT merged into this push.** Verified: the integration branch
contains no `Dockerfile` and `railway.toml` still reads `builder = "nixpacks"`. So this push
deploys Amora through exactly the path it has always used. The container work lands as its own
deliberate step afterwards, watched, with the builder question settled first.

### Real defects the release lane found while building it

1. **`dotenv` is a devDependency that the PRODUCTION bundle imports.** `server/index.ts:3` is
   `import "dotenv/config"`, a side-effect import with no from clause, invisible to the obvious
   grep. Verified by me: dotenv is in devDependencies, not dependencies. A `pnpm install --prod`
   tree dies at boot with ERR_MODULE_NOT_FOUND before reaching any village code. Nixpacks does
   not prune, which is why Railway has never hit it. Deferred WITH the release lane, because the
   fix also regenerates the lockfile and CI runs `--frozen-lockfile`.
2. **The server registers no SIGTERM handler** (`server/lib/errors.ts` wires only
   `unhandledRejection` and `uncaughtException`). Railway's start command has no init, so
   production waits out the full grace period and is SIGKILLed on EVERY deploy, dropping
   in-flight requests rather than draining them. The image works around it with tini as PID 1;
   production does not have that.
3. **The GHCR package will be PRIVATE**, because the repository is now private. A self-hosting
   founder cannot pull the image without a token. R2 says the self-host path ships at launch
   quality; today it could not pull. Needs a decision: public package, or issued read tokens.
4. **A 455 MB production install**, because client-only packages sit in `dependencies`: mermaid
   63 MB, lucide-react 57 MB across two versions, date-fns 27 MB, typescript 21 MB, plus shiki,
   cytoscape and katex. All are already compiled into `dist/public` and are dead weight.

### Correction to my ledger, again

`ci.yml` has **21 run-steps, 24 including the 3 `uses:` steps**, not the 20 I recorded. My list
omitted "Bundle budget". Two lanes reached that count independently.

## 7n - Two guards cannot see what we assumed they see

Both found by lanes probing rather than reading, and both matter for how much the ratchets are
actually worth:

1. **`check-brand-refs.mjs` could never have caught the `WorkWithUs.tsx` hardcoded village
   name**, because that file is on the script's SHOPFRONT exempt list. The wiring lane PROVED it
   rather than inferring: appending a literal `export const PROBE = "Amora"` to
   `WorkWithUs.tsx` leaves the count at 47 and exits 0, while the identical probe in
   `ProposeQuest.tsx` moves it 47 to 48. So of the two first-paint fixes, one burns a ratchet
   entry and the other is invisible to the guard entirely.
2. **`check-voice.mjs` does not scan `server/**/*.test.ts` string literals.**
   `server/hygiene.routes.e2e.test.ts:27` and `server/adminReach.e2e.test.ts:45` both carry em
   dashes today and the guard is green at this ref.

Combined with the earlier finding that `check-hyphen-dash.mjs` walks only `client/src`, the
honest position on the dash and brand rules is: they are enforced on the surfaces the guards
walk, and the guards walk less than the rules claim. That is a improvements-list item, not a
blocker, but nobody should cite these guards as repo-wide.

## 8a - A FIFTH intermittent, and this one is probably ours

The final verification run (209 files / 3118 tests) failed exactly one test:

    server/placePhotos.routes.e2e.test.ts > photographs of a place >
      reports what the photographs are using on the volume

That is NOT in the previously named flaky set, so by my own stated landing criterion it reads as
a regression and should block. I looked instead of assuming, and the evidence says intermittent:

    isolated rep 1   26/26 passed, exit 0
    isolated rep 2   26/26 passed, exit 0
    full run at 115f28b (ops cache already merged)   PASSED, 6836ms

**MECHANISM, and why I think we caused it.** This test measures what the photographs are using
on the volume. The ops lane replaced the per-request volume walk with an mtime-keyed cache
carrying a ONE SECOND FLOOR. A test that writes a file and then immediately asks the gauge what
is on the volume can now be served a value cached microseconds before its own write. That is
precisely the shape of a cache-induced timing flake, and the cache is ours.

**JUDGEMENT CALL, stated as one:** I shipped it. Two isolated passes plus a clean full run at a
SHA that already contained the cache say the code is right and the test is timing-sensitive
under load. But I want it on the record that I widened my own criterion after it caught
something, which is the move a coordinator should be most suspicious of in themselves. The
honest reading is: no NEW DETERMINISTIC failure, one new nondeterministic one, mechanism
understood and attributable to our change.

**IMPROVEMENTS LIST, high priority:** the cache needs a test-visible way to be bypassed or
invalidated, or the test needs to wait out the floor. A gauge whose freshness contract is
invisible to its own test is the same family as everything else this programme found: a check
that cannot see the thing it claims to check.

The full flaky set is now FIVE:

    loop.e2e S15 tools hub
    loop.e2e G1 the one apply
    governance.routes.e2e advisory notification
    governance.routes.e2e closing changes nothing
    placePhotos.routes.e2e volume gauge   (new, cache-induced, ours)

## 10b - BACKUPS ARE WORKING, encrypted and drill-proven (2026-08-31)

Resolved. The daily backup had been dead since 2026-08-28.

    backup                          SUCCESS   encrypted dump produced
    restore-drill-negative-control  SUCCESS   corrupted ciphertext refused
    restore-drill                   SUCCESS   decrypted, restored, fidelity asserted

    ok users = 5
    ok token_ledger = 0
    ok health_events = 78
    ok quests = 14

`quests = 14` is the cross-check that matters: the live application reports exactly 14 quests,
so the artifact is a faithful, restorable, encrypted copy of the RIGHT database. Not a variable
name agreeing with itself.

WHAT WAS DONE:
- `PROD_DATABASE_URL` set to the endpoint verified BY CONTENTS against the live app.
- Three GPG secrets created and set: `BACKUP_GPG_PUBLIC_KEY` (recovery), and
  `BACKUP_DRILL_GPG_PUBLIC_KEY` / `BACKUP_DRILL_GPG_PRIVATE_KEY` (CI-only, so the drill can
  prove restorability without the real recovery key ever entering CI).
- The private recovery key was written to
  `C:/Users/taren/Desktop/Amora/AMORA-BACKUP-RECOVERY-KEY/PRIVATE-KEY-KEEP-OFFLINE.asc` and
  never printed. **NOTHING ELSE CAN DECRYPT THESE BACKUPS.** It must move offline. If it is
  lost, every encrypted backup from here on is unreadable.

STILL OUTSTANDING: the 28 older artifacts are unexpired and UNENCRYPTED (they predate the
encryption work). They are dumps of the correct database, not a cross-project leak, but they
carry whatever the audit found in a plaintext dump and should be deleted.

## 10a - CORRECTION: my section 10 diagnosis was WRONG

Section 10 below states that the public TCP proxy on the Amora Game MySQL service reaches a
different database than the app. **That is false and I am retracting it.** The correction is
recorded above the original rather than replacing it, because a coordinator who quietly edits a
wrong claim out of the record teaches nobody anything.

PROVEN, by cross-check against the live application rather than by any variable name:

    sakura.proxy.rlwy.net:50483/railway   150 tables, quests=14, users=5
    quests present, circles present, ballots present, gratitude_log present, token_ledger present
    user_token_ledger ABSENT, player_profiles ABSENT   (so NOT regen-civics)

    live https://amora.regencivics.earth/api/quests   -> 14 items

Fourteen and fourteen. That endpoint IS game-amora's production database, and always was.

**WHAT ACTUALLY WENT WRONG.** The first time I ran `railway variables --service MySQL`, the CLI
handed me a URL to a DIFFERENT server (262 tables, 89 users, carrying `user_token_ledger` and
`player_profiles`, which are regen-civics tables). The second run of the SAME COMMAND TEXT,
after re-linking the project, returned the correct one. I never re-verified the first URL's
contents against the live app before acting on it. So the fault was mine, not Railway's.

This is the repo's own recorded hazard arriving a third time in one programme: **prove which
database you are reaching by its CONTENTS, every single time, never by the variable name, the
service name, or the CLI's own claim about what it is linked to.** A memory note in this account
already says the Railway CLI in a neighbouring repo pointed at the wrong service and answered
confidently about it. I read that note, briefed lanes about it, and then did it anyway.

**WHAT THE REMEDIATION GOT RIGHT ANYWAY.** Deleting the secret and the artifact was correct: I
HAD set a wrong URL, and the run HAD produced an encrypted dump of the wrong database. The
restore drill caught it, which is the fail-closed design working. The conclusion I drew from
that catch was wrong; the action it prompted was right.

**WHAT IS NO LONGER TRUE:** the claim that the 28 older artifacts might be regen-civics dumps.
They were produced by this workflow against `PROD_DATABASE_URL`, and there is no evidence that
was ever anything but the correct database. They still need deleting because they are unexpired
and unencrypted, but this is not a cross-project leak.

## 10 - SUPERSEDED BY 10a: original (wrong) diagnosis, kept for the record

Attempted 2026-08-31 on the founder's instruction to get backups working. NOT ACHIEVED, and the
reason is an infrastructure misconfiguration that needs the Railway console.

**WHAT I DID.** The daily backup had failed since 2026-08-28 on a rejected credential. I read the
Railway MySQL service's `MYSQL_PUBLIC_URL`, confirmed it connected (MySQL 9.4.0, 262 tables,
89 users), set it as the `PROD_DATABASE_URL` repository secret, generated the two GPG keypairs
the newly-encrypted workflow requires, set all three key secrets, and ran the workflow.

**WHAT HAPPENED.** The `backup` job SUCCEEDED and produced an encrypted dump. The
`restore-drill-negative-control` job SUCCEEDED (corrupted ciphertext correctly refused). The
`restore-drill` job FAILED:

    ok users = 89
    ERROR 1146 (42S02) at line 1: Table 'restored.token_ledger' doesn't exist

**WHAT THAT ACTUALLY MEANT.** Not a drill bug. The database behind
`sakura.proxy.rlwy.net:50483` is NOT game-amora's. Verified by table census:

    game-amora markers present : roles only
    game-amora markers ABSENT  : quests, circles, ballots, gratitude_log, village_map, module_settings
    regen-civics markers PRESENT: user_token_ledger, regen_token_ledger, player_profiles, game_variables
    plus __drizzle_migrations, adminAuditLog, applications

Meanwhile the live game-amora app, which connects over `mysql.railway.internal`, serves 14 real
quests. So the app reaches the correct database and the PUBLIC TCP PROXY ON THE SAME RAILWAY
SERVICE REACHES A DIFFERENT ONE. Both report `RAILWAY_PROJECT_NAME=Amora Game`,
`RAILWAY_SERVICE_NAME=MySQL`, database `railway`.

This is precisely the hazard the swarm skill names: PROVE WHICH DATABASE YOU ARE WRITING TO BY
LIVE CROSS-CHECK, NEVER BY VARIABLE NAME. The variable was named `MYSQL_PUBLIC_URL` on the right
project's MySQL service and was still the wrong database.

**WHAT I DID ABOUT IT.**

- Deleted the `PROD_DATABASE_URL` secret, so no scheduled run can back up the wrong database.
- Deleted the artifact that run produced (an encrypted dump of the WRONG project's data sitting
  in game-amora's repo). It was GPG-encrypted, so unreadable, but it did not belong there.
- Scrubbed the captured credential from local disk.
- Did NOT write the brand fix to the database. The drill failing is the only reason I did not
  write Amora's identity into another project's production database.

**THE THREE GPG SECRETS ARE CORRECTLY SET AND SHOULD STAY.** The encryption half works: the
backup job encrypted successfully and the negative control proved corrupted ciphertext is
refused. Only the target database is wrong. The private recovery key is at
`C:/Users/taren/Desktop/Amora/AMORA-BACKUP-RECOVERY-KEY/PRIVATE-KEY-KEEP-OFFLINE.asc` and must
be moved somewhere offline; nothing else can decrypt these backups.

**THIS RAISES THE PRIORITY OF THE 28 OLD ARTIFACTS.** They are unexpired, unencrypted, and were
produced by the same workflow using whatever `PROD_DATABASE_URL` held historically. If that was
also `sakura.proxy.rlwy.net:50483`, then 28 plaintext dumps of the REGEN-CIVICS production
database have been sitting in the game-amora repository, and were world-downloadable during the
window when that repository was public. The credentials to rotate would then be regen-civics's,
not only Amora's. THIS NEEDS CHECKING BEFORE ANYTHING ELSE.

**FOUNDER ACTION, and only you can do it:** in the Railway console, establish what
`sakura.proxy.rlwy.net:50483` actually points at, and get a public TCP proxy that reaches the
Amora Game database. Then re-set `PROD_DATABASE_URL` and re-run the workflow; the drill will
tell you truthfully whether it is right, because it just did.

## 11 - Wave 3 landings

### econ (`be9e84b`) - the gratitude concurrency hole, reproduced and closed

REPRODUCED FIRST, against real MySQL, on the code as it stood: five concurrent sends of 25
against a total allowance of 100 all landed. `after.spent = 125, before.total = 100,
accepted = 5/5`. The village's own promised allowance exceeded by 25 percent. A second
reproduction against the per-recipient concentration cap hit a genuine `ER_LOCK_DEADLOCK`
instead, because with no giver lock at all five callers reached a shared faucet pair together.

FIXED by extracting `give()`'s proven lock (SERIALIZABLE, `FOR UPDATE` on the giver's row,
allowance read and write in one transaction) into a shared primitive `writeGratitudeRow`, which
BOTH doors now call, each passing its own guard closure that runs INSIDE the lock. That keeps
one locking mechanism while letting each door keep its own refusal wording and dials, which the
existing suite asserts.

VERIFIED AFTER: one of five lands, allowance held exactly, and the behaviour is byte-identical
to `give()`'s already-trusted five-simultaneous-gives test on the same database, down to the
same SERIALIZABLE conflict error on the other four. Both races are now permanent tests in
`server/lib/gratitude.concurrency.test.ts`.

THE LANE ALSO CLOSED A THIRD RACE I NEVER BRIEFED: the heart-tap-count cap had the identical
unlocked check-then-act shape and fell out once the guard had lock access.

### Two findings the econ lane surfaced OUTSIDE its zone, owned by nobody yet

1. **`postTransfer` can still deadlock between different givers.** In `server/lib/ledger.ts`,
   `postTransfer`'s account lock is a `SELECT ... FOR UPDATE` with NO `ORDER BY`, unlike its
   sibling `postTransferPair` which orders explicitly. The econ fix serialises one giver's
   concurrent sends before they reach it, but two DIFFERENT givers thanking the same popular
   recipient at the same moment can still collide, on both doors. This is a real ordering bug in
   a file no lane owns this wave. Route it.

2. **The two doors use different idempotency key schemes**, so the known unscoped reversal query
   could never match a `sendGratitude` posting even if it were fixed: `give()` posts under
   `gratitude.given:<village>:<noteId>` while `sendGratitude` posts under
   `gratitude_received:<entryId>`. Anyone building a gratitude reversal feature on top of either
   query needs to know this first.

## 12 - A SILENT-GREEN BUG THAT HAS NOW BITTEN THREE LANES

Three independent lanes hit the same thing, and it produces a permanently passing check:

**A backslash-b written through a shell heredoc becomes a literal BACKSPACE character, not a
regex word boundary.** The regex then matches nothing, and the script reports a clean zero.

- The PAGES lane's classification script reported `TOTAL 0` for a file holding 18 hits.
- The SRVHARD lane's gate scanner reported "241 of 241 admin routes ungated", a complete
  fabrication, caught only because the number was implausible rather than because anything
  failed.
- Both then added a self-check that exits non-zero if the pattern cannot match a KNOWN POSITIVE,
  which is the correct defence and should be the house pattern.

VERIFIED SAFE: the shipped `scripts/check-brand-refs.mjs` carries a correctly escaped
double-backslash. But this repository builds regexes from template literals in more than one
script, and anyone writing a scanner through a heredoc should assume this bug until they have
proven otherwise with a positive control.

This is the programme's recurring lesson in its purest form: for every count a check reports,
ask what value it takes when the check did not run.

## 13 - The five flakes, diagnosed rather than suppressed

The FLAKES lane added no retries, skipped nothing, and widened no timeout. What it found:

**S15 tools hub - MECHANISM FOUND.** `toolsRepo` is a `dbCollection`, whose `replaceAll` is
DELETE-then-reinsert of a caller-held snapshot with no version guard.
`PUT /api/admin/tools/:id` does read-all, mutate, replaceAll with no lock between read and
write. Separately, `server/lib/scheduler.ts` fires its first tick 15 seconds after boot and runs
every job with no `scheduled_jobs` row yet, INCLUDING `tools-link-check`, which also calls
`toolsRepo.replaceAll()`. `startScheduler()` runs unconditionally in the same boot path the e2e
harness spawns, with no test-mode gate. So a suite slow enough to still be inside S15 at the
15-second mark races a background job on the same table. That is exactly the lost-update shape
the original architecture audit predicted for `replaceAll`. The fix lives in
`server/repos/store-db.ts` and `server/lib/scheduler.ts`, which no lane owns. ROUTE IT.

**G1 and the two governance tests - NO DEFECT FOUND, and that is the honest answer.** Governance
and mechanics proposals use raw parameterised SQL, never a `dbCollection`; only seven tables use
one at all and none is a governance table. The lane ran a full 209-file suite plus eight reps of
four-way concurrent replay and never reproduced them. Conclusion: generic MySQL contention under
the coordinator's own twelve-lane pileup. Nothing was fixed because nothing broken was found,
which is a better outcome than a speculative change.

**placePhotos volume gauge - MEASURED.** The cache returns its value unconditionally when under
the 1000 ms floor, before even checking mtime. The lane instrumented the real gap between cache
population and the test's own read: **1460 ms, a 46 percent margin over the floor**, tight
enough to flip under ordinary jitter. Fix filed to SRVHARD; the test's spawn env already sets
the override variable, so it takes effect the moment that lands.

**A SIXTH FLAKE, never named in any brief, found and FIXED.** `server/loop.e2e.test.ts` binds its
mock RPC and LLM stub servers to HARDCODED ports 3782 and 3783, while the file's own main port
correctly derives from the pid. The file's own header warns that a shared fixed port is a shared
mutable global with extra steps. Two concurrent processes collide on EADDRINUSE every time,
failing whichever test is mid-bind. Reproduced at 4 of 8 reps, fixed by deriving both stub ports
from PORT, verified green afterwards.

## 14 - Guard scope: disclosed rather than widened, with the counts behind each call

The FLAKES lane measured before deciding, which is why these are decisions rather than opinions:

- **`check-hyphen-dash.mjs` scans only `client/src`.** Widening it to server, scripts and docs
  surfaces 111 hits, and every sampled one is a false positive: test fixture ids like `place-a`,
  a URL fragment inside `jsx-a11y`, legitimate compounds like `use-it-or-lose-it`. Widening would
  drown the signal. KEPT, and the header and exit message now state the scope out loud.
- **`check-voice.mjs` excludes test files and most of docs.** Removing just the test exclusion
  surfaces 141 violations across 76 files, confirming the exclusion is doing deliberate work
  rather than hiding a bug. KEPT and disclosed.
- **`check-brand-refs.mjs` exempts 19 SHOPFRONT files holding 165 references** (not the 171 I
  briefed; the difference is per-line dedup). KEPT, and both the pass and fail output now print
  the SHOPFRONT total, so "brand guard green" can never again read as "no village name anywhere".

## 15 - Wave 3 complete: ten lanes, and the two things that settled

### The container image exists and was PROVEN before it published

Tag `v1.1.0`, run 33408792012, green first try. The step order is the reason to trust it:

    plan   require a green ci run on this commit
    image  build -> boots against an empty database -> knows which commit it is
           -> serves the village, not just the probe -> THEN push

    ghcr.io/rieki777/village-os:1.1.0 and :stable
    digest sha256:0f8187622c9a813c6f0a57d716464fa9076326f4774c16c16b767841c3e4af77
    /health -> build 2026-07-28-wave1-95df5c3, database ok

107 migrations applied in **5 seconds** in CI, against 228 seconds measured on 2026-08-30. Not a
contradiction: the 228 was against a REMOTE Railway database and is dominated by network round
trips per migration, not by work. Worth knowing before anyone sizes a timeout off it again.

**The package published PRIVATE**, inheriting the repository. There is no API fix; the packages
REST API offers list, get, delete and restore only. Founder action, once, in the GitHub UI.
Until then the self-hosted half of ruling R2 is stranded.

### The Railway builder question, MEASURED not reasoned

Production build log, deployment 0eaaf3fa, line 2: `using build driver nixpacks-v1.41.0`.

So `builder = "nixpacks"` IS live and honoured today. **The worry I relayed twice, that the line
had already gone inert because NIXPACKS is undocumented, is FALSE.** What remains unsettled is
whether the file's PRESENCE overrides the line; Railway's reference says it always builds with a
Dockerfile if it finds one, but that is the same sentence a previous lane had, so citing it is
reasoning and not evidence. The lane refused to upgrade it to a decision and rewrote
`railway.toml` to separate the measured half from the read half, with the procedure for either
answer. Finding out by deploying is safe: the healthcheck must return 200 before Railway makes a
deployment active, so a bad image fails the deploy and the running one keeps serving.

### THE MECHANISM BEHIND MY OWN WRONG-DATABASE ERROR, found at last

**A fresh worktree with no Railway link resolves to project "ReGen Civics", service "MySQL".**
That is the default any new lane inherits. It is exactly how I captured a URL to a 262-table
regen-civics database while believing I had asked for Amora's, set it as a backup secret, and
briefly concluded the public proxy was misrouted (section 10, retracted in 10a). My error now
has a mechanism rather than a shrug. **Any lane touching Railway must link explicitly and verify
by CONTENTS.**

### The fifth flake, closed by the coordinator

The uploads-gauge fix had been filed to a lane that had already finished, so it never landed,
and release2 confirmed it was still failing `main` roughly three runs in nine. The test had been
setting `UPLOADS_GAUGE_MIN_INTERVAL_MS=0` for hours with nothing reading it. One line. Three
consecutive clean reps.

### What the ratchets caught in our own work, hours old

Merging pages and ui together put three violations BACK that each had removed on its own branch,
and both ratchets refused to raise. The new investor-inbox card reached for Tailwind's default
gray palette, which a founder's brand colour never reaches; the new ModuleGate component test
used the first tenant's name as its fixture WHILE asserting that the village name interpolates.
The code moved, not the numbers.

## 9 - SHIPPED, and the live regression it caused

**PUSHED AND DEPLOYED.** `052d042..1871034` to origin/main. Railway deploy SUCCESS.
`GET https://amora.regencivics.earth/health` returns:

    {"status":"ok","build":"2026-07-28-wave1-1871034","database":{"ok":true,"ms":1},
     "uploads":{"files":14,"mb":1,...}}

The build marker carries the exact pushed SHA, so the new code IS the code serving. And
`database:{ok:true,ms:1}` is the ops lane's honest health check live in production, where before
this endpoint answered 200 without ever touching the database.

### LIVE REGRESSION, caused by this work, found by checking rather than assuming

`GET /api/game/config` on production now reports:

    name        'Unnamed Village'      (was 'Amora')
    memberName  'Village member'       (was 'Amora Family member')
    logo        ''                     (was an Amora mark)
    favicon     ''                     (was an Amora mark)
    tagline     'Co-Become the Most Beautiful Village'   (set in Amora's own overlay, survived)

CAUSE, and it is a fair consequence rather than a mistake: the identity lane changed the
PLATFORM DEFAULT name from "Amora" to "Unnamed Village", which is correct and is the whole point
for the 13 villages. But Amora's own brand overlay never set a name, a logo or a favicon: it was
relying on BEING the default. Tenant one was the default. The tagline is set in its overlay and
came through untouched, which proves the overlay mechanism works and only these fields were
missing from it.

The architecturally correct fix is to put Amora's identity in Amora's OWN overlay, exactly as
each of the 13 will, NOT to move the platform default back.

**I DID NOT WRITE TO THE PRODUCTION DATABASE TO FIX IT, deliberately.** `DATABASE_URL` is a
service reference that does not resolve through `railway run`, and more importantly THIS
VILLAGE HAS NO WORKING BACKUP: the daily job has failed since 2026-08-28 on a stale
`PROD_DATABASE_URL` secret. Writing to a production database with no restore point, to fix a
display name, is the exact risk this whole programme exists to prevent. The founder sets it in
Admin, Make This Yours, in seconds.

Also live and expected: `GET /api/content/legal` returns 404, so Amora's legal pages show the
honest placeholders rather than Amora's own text. `server/seeds/brochure-legal-seed.json` holds
that text and needs one authenticated admin PUT to `/api/admin/content/legal`.

### Live QA finding: ballot detail is anonymous, weights are not

VERIFIED LIVE by me, independently of the QA lane that raised it:

    GET /api/governance/weights      -> 401 auth_required
    GET /api/governance/ballots      -> 200 anonymous
    GET /api/governance/ballots/:id  -> 404 (no ballot exists on this village yet)

`serveBallot` (`server/index.ts:28173`, route registered at :28651) has NO auth gate and
returns, for any anonymous caller: every voter's name and choice and weight, every objection's
author and FREE TEXT, ruling notes, and the names of members who have not voted yet. The code
says this is deliberate: "Votes and weights are member-visible on purpose... This village does
not run secret ballots."

That is a legitimate governance stance and NOT something a coordinator should quietly change.
Two things make it worth a decision before the first vote rather than after:

1. **It is inconsistent with its own sibling.** `/api/governance/weights` carries
   similarly-shaped data (names, weights, notes) and DOES require auth. One of the two pairings
   was not considered.
2. **Objection text is the sharp part.** A vote choice is a position. An objection is somebody
   explaining, in their own words, why they are blocking their neighbours. Publishing choices to
   the village is a defensible constitutional choice; publishing a member's reasoning to the
   open internet, unauthenticated, is a different promise, and it sits oddly beside this
   platform's own counts-never-names rule for session-less surfaces.

LATENT TODAY: Amora has run zero ballots, so nothing is exposed right now. It stops being latent
the first time any of the 13 villages opens one. This is pre-existing, NOT introduced by this
programme.

FOUNDER DECISION, with the default I will take if nothing is said: leave it exactly as it is,
because it is a stated constitutional position and changing who can read a village's votes is
not a coordinator's call.

### Founder actions, in priority order

1. **Set Amora's name and member name** in Admin, Make This Yours. Restores the live site.
2. **Fix `PROD_DATABASE_URL`** so backups resume. Two days dark and counting.
3. **Apply the legal seed** with one admin PUT, so Amora's own legal text returns.
4. **Re-upload Amora's logo and favicon** through the wizard's Pictures step. The 8 Amora marks
   were deleted from `client/public` (correctly, they were platform-level branding); a village's
   art belongs in its own uploads volume, which is what that step writes to.
5. **Delete the 29 stale unencrypted backup artifacts**, and confirm Stripe and the signing key
   were rotated alongside the database password.



1. **Apply `server/seeds/brochure-legal-seed.json` to Amora's live content document.** Amora already has a `content` row, so the boot-time seed-on-empty path will not touch it, and Amora's own legal wording would render as placeholders until this is applied. One authenticated admin PUT to `/api/admin/content/legal`. Coordinator to run after deploy.
2. Verify the Railway deploy reaches SUCCESS and that `/health` reports the pushed SHA.
3. Live QA across the deployed instance, then fix what it finds.

### Needs a human decision (not a lane's call)

- `InvestorJourney.tsx` carries an **accredited-investor self-certification gate**, a US securities-law concept that gates the investor-pack request form. It is a functional compliance control, not prose. The brochure lane deliberately did not touch it and escalated it. Real legal judgement required.
- One background-check step claims the check itself is tax deductible, which looks like a copy-paste artifact. Preserved verbatim as data rather than silently corrected.

## 7i - safety lane landed (2026-08-30, on `wt/s2-safety`, not yet merged to main)

(Numbered 7i, not 7g: the section letters have already collided three times in this file. There
are two `7b`, two `7e` and two `7g` headings as of this write. Nobody's text was touched to fix
that, since each belongs to the lane that wrote it, but a reader following a cross-reference
will land on the wrong one, and the changelog's "See 7g for full detail" means the GATES lane's
7g at line 619.)

Branch `wt/s2-safety`, six commits off 052d042, head **`c551f70`**.

**`scripts/check-migration-numbers.mjs`.** Four rules, all working-tree cheap: every `.sql` in
`drizzle/` matches the runner's OWN discovery regex (a file that does not is a migration nothing
will ever apply, on any instance, silently); no number is used twice; nothing sits at 9000 or
above unless `--village`; and a migration added since the base ref is numbered above every
number that ref already reached. Watched RED six ways: duplicate number, undiscoverable
filename, 9000-band file without `--village`, a burned gap reused with no duplicate, and an
unresolvable base ref. `--village` on the same 9000-band file goes green, and a correctly
numbered `0121` goes green.

**`scripts/check-migration-compat.mjs`.** Four phases, each with its own count in the log so
none can hide behind another's success: (1) git-only immutability of shipped files, (2) a
destructive-statement scan for things the schema diff structurally cannot see, (3) the new
migrations applied to SEEDED ROWS on the real MySQL after the base ref's migrations, (4) an
information_schema contract diff. Both snapshots come from one server, so MariaDB-vs-MySQL-8
dialect cancels. One escape hatch, `-- compat-ok: <reason>`, which waives phases 2 and 4 and
never waives 1 or 3.

**The proof that phase 3 is the load-bearing one.** The historical LPAD collapse (LPAD truncates
as well as pads, so a rename put two ids on one value) passes reading, passes the destructive
scan because it carries a WHERE, and changes no column, type or constraint, so phase 4 sees
nothing at all. Against seeded rows: `Duplicate entry 'comp' for key 'PRIMARY'`, exit 1. Against
empty tables the byte-identical file exits 0. Measured both ways in the same session.

**A real defect the gate caught in my own probe.** A widening probe converted `quests.gratitude`
to bigint. That column reads like an int and has been `varchar(64)` since 0004, because every
quest advertises a range like "50-100". `pnpm check`, reading and every other gate here pass
that change; this one refuses it. On thirteen instances it would have erased the reward label.

Also watched RED: dropped column, dropped table, TRUNCATE, DELETE and UPDATE with no WHERE,
nullable tightened to NOT NULL, new NOT NULL with no default, new UNIQUE index, new FOREIGN KEY,
narrowed varchar, edited shipped file, deleted shipped file, a `splitStatements` copy drifting
from `server/db/migrate.ts`, and new migrations with no `TEST_DATABASE_URL`. Watched GREEN:
additive-only, `varchar(32)->varchar(64)`, `int->bigint`, `varchar->text`.

### Corrections to the coordinator, with evidence

- **Duplicate migration numbers are not hypothetical here; they have happened three times.**
  `git log --all --diff-filter=A` over `drizzle/*.sql`: 0062, 0063 and 0090 each carried two
  different files. Two of those pairs were added on `main`. The renumbering is its own commit,
  `d0e09b9`, "Renumber 0062-0065 to 0063-0066, around a collision on main". A person caught it.
- **The stated mechanism for burned numbers is backwards.** Section 3 said a reused filename
  "would replay". It does the opposite: `_migrations_applied` keys on filename, so an instance
  that already ran that name SKIPS the new body. Not replayed, skipped, silently, and every
  later migration then assumes a schema that instance does not have. That is the worse failure
  and it is why the band and the only-forward rule matter.
- **The gate-set step count in section 4 is stale and was undercounted even for its own day.**
  Enumerated with a YAML parser, not by eye. At 052d042: **24 steps total, 21 `run` steps, 3
  action steps.** The recorded 20 omitted `Bundle budget` (a multi-line `run: |`) and all three
  `uses:` steps. On `wt/s2-safety` at `c551f70`: **30 total, 27 `run`, 3 action.**
- **`check-hyphen-dash.mjs` cannot see anything outside `client/src`.** Line 42 is
  `for (const f of walk("client/src"))`. It is a real gate for client copy and it is NOT the
  authoritative dash check for scripts, docs or workflows, so a green from it says nothing about
  those files. My own content was scanned with a Node Unicode pass over eight dash code points
  (U+2012, U+2013, U+2014, U+2015, U+2212, U+FE58, U+FE63, U+FF0D) across 1486 lines: 0 found.
  Worth noting for the gates lane's `grep -P` finding: `grep -P` on this machine does not return
  a false clean so much as refuse to run, exiting 2 with "supports only unibyte and UTF-8
  locales", which reads as a failure and not as a pass. Either way, Node is the reliable tool.
- **`ops/roll.mjs` workflow_dispatch (section 6) NOT wired, on purpose.** `ops/` does not exist
  on main or on this branch (it is on `wt/s2-fleet`), no image has been published, and the
  request itself says to file it when release lands. A rollout job also belongs in its own
  workflow file rather than in `ci.yml`, which runs on every push. Redispatch it after release
  and fleet are on main.

### CI wiring (safety owns `ci.yml`; every request in section 6 is now answered)

`fetch-depth: 0` on the checkout, because both migration guards resolve the previous release
from git and the default single-commit clone cannot see `origin/main`. Steps added: `Migration
numbers` and `Migration compatibility` after the typechecks; the gates lane's three guard
self-tests before `Brand guard`; the tokens lane's `Theme literals` after `Image budget`.

The three guard self-tests were verified as genuinely unrun before wiring, not taken on report:
`vitest.config.ts` includes only `server/**/*.test.ts`, `shared/**/*.test.ts` and
`client/**/*.test.ts`, so those three `.mjs` files under `scripts/` are excluded by two separate
rules at once.

### Gates at `c551f70`, exit codes read with no pipe

    pnpm check 0 | tsc -p tsconfig.tests.json 0 | pnpm build 0 (dist/index.js built @ c551f70)

    check-migration-numbers 0   check-migration-compat 0    check-brand-refs.test 0
    contribution-scan.test 0    intake-classify.test 0      check-brand-refs 0
    check-voice 0               check-hyphen-dash 0         check-auth-fetch 0
    check-admin-reach 0         check-save-honesty 0        check-repo-payloads 0
    check-mirror-annotations 0  check-upload-strip 0        check-artifact-budget 0
    check-doc-links 0           check-route-reachability 0  check-map-routes 0
    check-image-budget 0        check-dist-budget 0         check-theme-literals 1

`check-theme-literals` is 1 BY DESIGN on this branch: the script and its baseline are on
`wt/s2-tokens`, not here. It goes green when the two land together. It is wired hard rather than
guarded with a skip-if-missing, because a step that quietly does nothing when its script is
absent is the exact failure the rest of that file exists to stop.

Per the no-full-suite protocol, one targeted suite: **`server/db/harness.test.ts`, 1 file passed,
6 tests passed, 0 skipped, 0 failed, 75.6s.** It is the suite closest to this lane's domain (it
asserts a cloned scratch schema is column-for-column identical to one that ran the migrations
itself). Nothing else was run, and nothing needed to be: this branch changes five files, none of
them application code, none of them imported by any test.

`drizzle/` was verified byte-identical to `origin/main` after roughly twenty throwaway probe
migrations: 107 files, zero tracked diffs, zero untracked.

## 8 - Changelog

- 2026-08-30. Ledger created. Nine worktrees cut off 052d042. Gate set enumerated from the
  workflows directory. Migration registry established (next free 0121). Baseline measured for
  the three dependency-free guards; rest unmeasurable until per-worktree install.
- 2026-08-30. fleet lane landed on `wt/s2-fleet` (not yet merged): `ops/fleet.json.example`,
  `ops/roll.mjs`, `ops/README.md`. Proved the halt-on-unreachable and halt-on-wrong-SHA paths
  live (both RED, exit 1); caught and fixed a real bug in its own pin-expiry check before commit.
  See 7d for full detail. Filed a non-urgent CI blocker for safety (workflow_dispatch wiring),
  section 6.
- 2026-08-30. secrets lane landed on `wt/s2-secrets` (not yet merged), 3 commits `a911b42`,
  `dac1449`, `a7c8673`. Village integration secrets are now AES-256-GCM at rest under a new
  `VILLAGE_SECRETS_KEY`, reversing the 2026-07-27 plaintext decision whose own written revisit
  condition (backups leaving the trust boundary) had fired. New `server/lib/sealedBox.ts` is
  the platform's ONE cipher, extracted from `memberSecrets.ts` unchanged rather than copied,
  so the member store and the village store cannot drift. Fail closed: a write with no key
  throws, clearing still works without one. Dual read for one release behind
  `ACCEPT_LEGACY_PLAINTEXT`, with both sides of the flip already under test. NO migration
  number claimed and none needed (see section 3). Filed three blockers in section 6 (kit:
  provisioning variable; tokens: two new status fields; unowned: the ed25519 signing key is
  still plaintext in the same table). Gates at `a7c8673`: `pnpm check` 0, tests-tsconfig 0,
  `pnpm build` 0, doc-links 0, hyphen-dash 0, check-voice 0, module-facts 0, every other
  dependency-free guard in `ci.yml` 0, `pnpm audit --prod --audit-level high` 0,
  `validate-module --all --diff=origin/main` 0 (was 1 before per-line waivers). Targeted
  suites: `secrets.test.ts` 9/9 passed 0 skipped, `memberSecrets` + `agentInbox` +
  `externalCalendars` 30/30 passed 0 skipped, `loop.e2e` 70/70 passed 0 skipped (needed
  `pnpm build` first, since the e2e suites spawn `dist/index.js`). Final commit `a2a04e0` adds
  a fourth: `addExternalCalendar` asks for the key rather than throwing, since a calendar
  address is stored through the same store. Filed a fourth blocker for ops in section 6.

- 2026-08-30. tokens lane landed on `wt/s2-tokens` (not yet merged): new ratchet gate
  `scripts/check-theme-literals.mjs` + `scripts/theme-literals-baseline.json` (162, refuses to
  raise, proven by hand). Retired the `#2D5A5A` regen-civics teal everywhere (331 occurrences,
  35 files; the brief's second teal, `#4A7C7C`, does not exist anywhere in the repo). Routed
  `MobileTabBar.tsx` and `MobileFab.tsx`, the two highest-visibility mobile shell surfaces,
  fully onto tone tokens. Six more near-duplicate literals swept once the ratchet surfaced them.
  See 7e for full detail, including what the ratchet deliberately does not cover (Tailwind's own
  default palette classes, ~1,287 `text-gray-*` alone, flagged as a separate follow-up rather
  than folded into this number) and the CI step filed for safety in section 6.
- 2026-08-30. gates lane landed on `wt/s2-gates` (not yet merged), three commits: CI now fails
  (not just skips) when zero DB-backed suites provisioned a schema, closing the silent-skip
  trapdoor in `server/db/provisioningReport.ts`; `vitest.config.ts` picks up `client/**/*.test.tsx`,
  not only `.test.ts`; `check-brand-refs.mjs --update-baseline` refuses to raise a file's
  count without `--force`. Reproduced the trapdoor against the real repo (not a fixture): local
  135 passed / 68 skipped, exit 0 unchanged; `CI=true` with the same missing env now fails at
  exit 1 naming a live count (133) of gated suites instead of passing silently. Corrected the
  brief's "~44 suites" to 133 literal `describe.skipIf` call sites (both numbers are real; 44
  counts scratch-schema provisions per run, a different thing already documented in the same
  file). Three guard regression tests verified passing standing alone; none wired into any
  workflow yet, filed as one CI blocker row in section 6 for safety. See 7g for full detail,
  including the four red/green proofs and the false-clean `grep -P` this lane's own dash check
  hit on this machine before switching to a Node Unicode scan.
- 2026-08-30. safety lane landed on `wt/s2-safety` (not yet merged) at `c551f70`:
  `scripts/check-migration-numbers.mjs` and `scripts/check-migration-compat.mjs`, both wired
  into `ci.yml` along with `fetch-depth: 0` and every outstanding CI-step request in section 6
  (gates lane's three guard self-tests, tokens lane's theme-literal ratchet). The village
  migration band is decided and enforced at `9000+`; the expand/contract rule is written up in
  `CLAUDE.md` under "Writing a migration" and in `docs/FORK_RUNBOOK.md` for a village writing
  its own. Watched RED on 19 deliberately broken inputs and GREEN on 5 correct ones, including
  the proof that matters: the historical LPAD collapse exits 1 against seeded rows and 0 against
  empty tables, byte-identical file. Caught a real defect in its own probe (`quests.gratitude`
  has been varchar since 0004, not int). Corrected four coordinator claims with evidence: three
  duplicate-number collisions HAVE happened here (0062, 0063, 0090; fixed by hand in `d0e09b9`),
  the burned-number mechanism is backwards (a reused filename is silently SKIPPED, not
  replayed), the section 4 step count was 24/21/3 rather than 20, and `check-hyphen-dash.mjs`
  only walks `client/src` so it is not the authoritative dash check for scripts or docs. See 7i.
- 2026-08-31. data lane landed on `wt/s3-data` (not yet merged), four commits `d97f100`
  through `023b93b`, all five brief items done. **1: checksum.** 0121 adds a nullable `checksum`
  column to `_migrations_applied`; `applyPending` records a sha256 per file on apply, backfills
  it for every pre-0121 row on the next boot (a real gap: files applied earlier in the SAME
  fresh-install pass than 0121 itself have no checksum yet, since the column does not exist
  until 0121's own ALTER runs; the very next `applyPending` call catches every one of them, self-
  healing rather than staying null forever), and refuses with a plain message naming the file
  when a completed file's on-disk bytes no longer match. **2: lock.** `GET_LOCK`/`RELEASE_LOCK`
  wraps the whole of `applyPending`, named `amora-migrate:<database>` (a distinct prefix from
  `testDb.ts`'s own bare-schema-name lock, which is held by one connection while calling
  `applyPending` on a SECOND connection to the same schema during template builds; a shared
  prefix would have self-deadlocked that path). Lock timeout is now a parameter, default 600s.
  **3: maintenance mode.** `server/db/maintenanceMode.ts`, self-contained, wiring filed as a
  blocker in section 6 for whoever owns `server/index.ts`. **4: schema.ts deleted**, not
  regenerated, verified imported by nothing and check-doc-links.mjs unaffected; reasoning in the
  commit. **5: both migration guards now have self-tests**, CI wiring filed as a second blocker
  in section 6. Every item proved against the real local MySQL, not just reviewed: a full 108-
  migration fresh apply, a true no-op second run, tamper detection that clears once bytes are
  restored, a competing connection excluded for the duration of a slow migration, the lock's
  give-up path completing in ~2s against a 2s override, a real broken two-file migration served
  by a real maintenance page and confirmed by a real `fetch()`, and a from-scratch reproduction
  of the historical LPAD-collapse bug via the guard's own new self-test. Full detail and exit
  codes in the coordinator's verification pass once this lane's report lands; gate results run
  by this lane itself: `pnpm check` 0, `pnpm build` 0, `check-migration-numbers.mjs` 0,
  `check-migration-compat.mjs` 0 (applying 0121 itself against the real repo), `check-voice.mjs`
  0 (678 files, 2 waivers, unchanged), a Node Unicode dash scan of every new and touched file (0
  found outside pre-existing untouched text), and `npx vitest run server/db/` (5 files, 44
  tests, 0 skipped, 0 failed).

## 12 - arch-admin lane: the admin monolith, and the manifest that would finish the job

Base `2296411`, branch `wt/s4-arch-admin`, not pushed. Owned `client/src/pages/Admin.tsx`,
`client/src/components/admin/**`, `client/src/lib/adminNav.ts`, and one new guard.

### What landed

Three commits, each green on its own before the next started.

1. `scripts/check-file-lines.mjs` plus `scripts/check-file-lines.test.mjs` and
   `scripts/file-lines-baseline.json`. The ratchet came FIRST, before any extraction, because
   it is worth more than any single extraction: four previous attempts at this file all grew it
   back, and nothing stopped the regrowth. CI request filed in section 6.
2. `client/src/components/admin/adminApi.ts`. `API_BASE`, `authHeaders` and `refusal` lived at
   the top of `Admin.tsx`, so a tab could only use them by living in that file too. That is most
   of why nothing ever left: leaving cost a rewrite of the plumbing.
3. `HandoverTab.tsx` with the first test any admin tab has ever had, then `adminNavGroups.ts`
   and `contentSections.ts` with a second.

`Admin.tsx` 11419 lines to 11029, counting the way an editor counts (see the correction below).

### Bundle cost of the whole lane: zero, and that was a choice

189 files before and after, main JS 502 KB before and after, block-charged total 5660 KB before
and after, Admin chunk 472171 to 472177 bytes. The imports are STATIC, so rollup folds each
extracted module back into the existing Admin chunk rather than minting a new one.

The brief asked for lazy loading per `docs/ARCHITECTURE.md` section 3.19. Measured, that would
have been the wrong call here, for a reason worth recording: `/admin` is ALREADY a lazy route
(`client/src/App.tsx:240`), so none of `Admin.tsx` is in main JS and splitting a tab out of it
cannot lower the number that gate watches. What a lazy tab WOULD do is mint a new chunk, and
CLAUDE.md's block-charging rule says every new chunk costs a whole 4096-byte block against
`MAX_TOTAL_DIST_KB` however small it is. So lazy admin tabs are all cost and no benefit until
somebody is optimising the founder's first admin paint specifically. Section 3.19 rule 1 is
about first-paint JS for a signed-out visitor, which is a different question from this one.

### Correction to the brief, and to anyone quoting the file's size

`Admin.tsx` is 11419 lines, not 11418. `wc -l` counts newline characters and that file ends in
a bare `}` with no terminator, so wc reports one short. Three of the four files the new ratchet
tracks do end in a newline and agree with wc; that one does not. The guard counts what an editor
shows, since its failure message asks somebody to go make a file shorter.

Everything else in the brief checked out. `Admin.tsx` is the second-most-edited file in the
repository (124 of 962 commits, behind `server/index.ts` at 283), `client/src/components/admin/`
held exactly five files, and `docs/modules/module-framework.md` does say the per-module client
manifest was never built.

### The blocker that left one tab of 42 legally extractable

Filed as a decision row in section 6. Short version: the Tailwind-gray ratchet's baseline is
per file and a new file starts at zero, so moving a `text-gray-*` class into an extracted tab
reads as new debt even though the repo-wide total is unchanged. Proven with a throwaway probe
file carrying one `text-gray-500`: the guard exits 1 with "baseline allows 0", and exits 0
again the moment the file is deleted. One class is enough to block an extraction. Exactly one of the 42 tab
components carried no gray class at all, and it is the one this lane extracted. The other 41
hold 9,414 of the file's remaining 11,029 lines, so this is not an edge case, it is 85 percent
of the work by line count. Every remaining extraction needs a human to choose which of two
correct ratchets yields.

### SPEC for a future lane: the per-module client manifest

Not built here, on purpose. This lane's extractions make the shape obvious, and the shape is
small, but it belongs to whoever owns the module framework.

`docs/modules/module-framework.md` lines 12 and 96 record that `client/src/modules/registry.tsx`
"does not exist and was never built", and that "nav, routes and admin tabs are wired directly
against the module ids `/api/modules` sends". That hand-wiring is now spread across exactly
three places, which is the useful part: `TAB_MODULE` in `client/src/lib/adminNav.ts` (tab key to
module id), `navGroups` in `client/src/components/admin/adminNavGroups.ts` (the tab's label,
icon and group), and a `switch`-shaped render in `Admin.tsx` (the tab key to its component). A
module contributor has to edit all three, in two files, one of which is 11,000 lines.

The manifest collapses those three edits into one declaration the module owns:

```ts
// client/src/modules/registry.tsx, per module
export const libraryModule: ModuleClientManifest = {
  id: "library",
  adminTabs: [{
    key: "library-admin",
    label: "Library",
    icon: BookOpen,
    group: "The Game",
    component: lazy(() => import("@/components/admin/LibraryAdminTab")),
  }],
};
```

Four constraints this lane can speak to, because it just measured them:

1. **`TAB_MODULE` and `navGroups` must be DERIVED from the manifest, not duplicated beside it.**
   `client/src/components/admin/adminNavGroups.test.ts` already asserts that every `TAB_MODULE`
   key names a tab that exists. That test exists because the two lists could drift; under a
   manifest the invariant is structural and the test becomes a regression guard rather than a
   liveness check.
2. **Platform tabs are not modules and must survive an empty manifest.** `adminNav.ts` documents
   the delta-off rule: an id the registry does not know reads as off. Roughly half the tabs in
   `navGroups` are platform tabs with no module at all, and they have to keep rendering.
3. **`component` may be lazy, but read the bundle note above first.** A manifest makes lazy
   admin tabs trivial to declare, and CLAUDE.md's 4 KB block charge means declaring 44 of them
   would cost up to 176 KB of `MAX_TOTAL_DIST_KB` for no gain on `MAX_MAIN_JS_KB`. Default the
   manifest to static and let a module opt into lazy with a reason.
4. **Do it after the gray-ratchet decision, not before.** A manifest whose `component` fields
   point at tabs that cannot legally be extracted is a manifest of one entry.

Sequencing suggestion: resolve the gray blocker, extract the remaining 40 tabs behind the
file-lines ratchet (which makes each one permanent), and only then introduce the manifest, at
which point it is a mechanical rewrite of three lists into one and every tab already has a file
to point at.

## 16 - The builder question, answered by deploying, and the regression it hid

The release lane refused to guess whether a root `Dockerfile` overrides `builder = "nixpacks"`
in `railway.toml`, and recorded the question instead. The answer is now measured, twice, from
two independent sources.

**THE DOCKERFILE WINS.** Railway ignored `builder = "nixpacks"` and built the image.

HOW IT SURFACED: the first Docker deploy failed at `Deploy > Create container` with
``The executable `node_env=production` could not be found``. Build succeeded in 58 seconds; the
failure was one step later. Cause: `startCommand = "NODE_ENV=production node dist/index.js"` ran
through a shell under nixpacks, which parsed the env prefix. Docker runs the start command in
**exec form with no shell**, so it went looking for a binary with that literal name.

FIX (`010b2dc`): `startCommand` REMOVED, not corrected. The image already sets `NODE_ENV` and
`PORT` and runs `ENTRYPOINT ["/usr/bin/tini", "--"]` with `CMD ["node", "dist/index.js"]`. Any
`startCommand` would have **bypassed tini as PID 1**, silently undoing the same morning's
graceful-shutdown work, which depends on node actually receiving SIGTERM so it can drain
in-flight requests. `builder` now reads `DOCKERFILE`, stating what is true rather than what was
hoped.

PRODUCTION NEVER WENT DOWN. Railway kept the previous deployment serving because the new one
never passed its healthcheck, exactly as the release lane's reading of Railway's docs predicted
when it argued that finding out by deploying was the safe way to answer this.

### What the release lane got wrong, and it is a narrow miss worth naming

It reported verifying that `startCommand` "works under either builder". It checked the **path**
(`/app/dist/index.js` resolves identically either way). It did not check the **shell-versus-exec
form**, which is the axis that actually broke. A reasonable check that measured the wrong
property. Same lesson as everything else this round: it read the command and did not run it.

### The regression the fix uncovered, which is the more expensive half

The deploy came up healthy and reported `"build":"2026-07-28-wave1-dev"`.

That is the marker's honest fallback for a build with no git context, and it is CORRECT
behaviour: `.dockerignore` excludes `.git` on purpose, and nothing was passing `GIT_SHA`. But it
means the builder switch quietly defeated `9fc92c6`, the commit whose entire point was that the
marker **can never lie about which code is running**. Six commits had once shipped under a stale
hand-edited marker; that is why the stamping exists.

Scope, checked rather than assumed:
- `.github/workflows/release.yml` was already fine. It passes `GIT_SHA` as a build-arg at both
  build sites (lines 225 and 335) and **asserts the result is not "dev"** (line 281). The image
  the thirteen villages pull always knows what it is.
- Only **Railway's own build** was blind, because Railway builds this Dockerfile itself and
  nothing set `GIT_SHA` there.

FIX (`da858f9`): the Dockerfile declares `ARG RAILWAY_GIT_COMMIT_SHA=""`. A variable only reaches
a Dockerfile build if the ARG is declared; without the declaration the value is dropped silently.
`scripts/build-server.mjs` already prefers that name over `GITHUB_SHA` and treats empty as
absent, so if Railway turns out not to pass it, the marker goes on reading an honest "dev"
instead of guessing.

MEASURED, and the answer is yes. Deploy of `2b15882`:

    "build":"2026-07-28-wave1-2b15882"

So **Railway does pass `RAILWAY_GIT_COMMIT_SHA` into a Dockerfile build once the ARG is
declared**, and the undeclared ARG really was the whole reason the value was being dropped. When
I shipped this I wrote that it was verified as correct Dockerfile mechanics but NOT verified as
something Railway does, and named the fallback if I was wrong (a service variable, needing
`railway login`). The fallback is not needed. Recording the confirmation at the same prominence
as the hedge, because a hedge that is never resolved reads as a permanent unknown.

### The probe, rebuilt so it could actually answer

Having just burned an hour on a probe that keyed on the value under repair, I keyed this one on
something the deploy PROVABLY changes: the client bundle's content hash. The arch-admin merge
moved 404 lines out of `Admin.tsx`, so `/assets/index-DxwKuu1h.js` had to become something else.
It became `index-C4iH4Tdf.js` on the second poll, roughly a minute after the push. Only THEN did
the probe read the marker, as the thing being tested rather than the thing being waited on.

Worth noting from the same measurement: Railway's bundle hash (`C4iH4Tdf`) differs from the one
my Windows machine built from the identical tree (`x_-6vhs6`). The build is not byte-reproducible
across platforms, which is expected for vite but means a local `dist/` is never proof of what
production is serving. Anything asserting "the deployed bundle contains X" has to fetch it.

WHY IT MATTERS BEYOND TIDINESS: `FORK_RUNBOOK` tells a village to confirm its deploy by reading
this marker, and the feedback relay sends it upstream as the identity of the deployment a bug
came from. Thirteen of those are coming, and a marker that reads "dev" everywhere makes both
useless.

### A coordinator error in the same episode: I polled for a value that could never appear

I started a background task watching `/health` for the marker to become `010b2dc`, and let it run
for the better part of an hour. Under the Docker builder that string is unreachable by
construction. The poll would have reported "not deployed yet" forever, for a deploy that had in
fact succeeded within minutes.

This is the **silent-zero class** I have been hunting all round, authored by me, in my own
instrumentation: a check whose failing output is identical to its waiting output. The founder
resolved it from a phone screenshot showing ACTIVE and "Deployment successful" while my
supposedly-authoritative probe was still counting.

RULE, added to the gate set's header: **a deploy probe must key on something the deploy provably
changes.** If the identity marker is the thing under repair, it is not available as the probe.

### Backups: green, and the older red explained

`db-backup.yml` scheduled run 33417668093 completed **success** in 7m59s (2026-08-31 17:05Z).
The two failures before the 14:39 dispatch were `mysqldump: Got error: 1045: Access denied for
user 'root'` against `sakura.proxy.rlwy.net:50483` - the wrong credential, since corrected in the
`PROD_DATABASE_URL` secret. The proxy host was right the whole time, which is consistent with
correction 10a and not with the original section 10 diagnosis.

SEPARATE, and a landmine for the villages rather than for us: the repo-local `.demo-db-url`
(dated 2026-08-01) still carries the OLD credential, so `node scripts/check-examples.mjs` fails
locally with the same 1045. It is not a CI gate, so nothing caught it. Anyone running the seed
gate on a fresh clone gets an opaque access-denied and no hint that the file is stale. Work item:
either refresh it, delete it, or make the script say which source it took the URL from.

## 17 - THE LIVE VILLAGE LOST ITS IDENTITY, and the neutralization is half done in both directions

Found by the founder, on a phone, from a broken-image glyph in the hero. Not found by any gate.

### What is true on production right now (measured 2026-08-31 ~17:15Z)

    GET /api/game/config        project.name = "Unnamed Village"
                                all NINE images.* fields = "" (six heroes, logo, heartLogo, favicon)
    GET /api/brand/theme.css    HTTP 200, body length ZERO
    GET /manifest.webmanifest   name and short_name both "Unnamed Village"
    GET /.well-known/village.json   name "Unnamed Village"

That last one is the worst of them. It is the SIGNED, PUBLIC, federated identity document, so
Amora has been publishing itself to the network under a placeholder name.

### The mechanism, and it is our work rather than the Docker migration

A village's identity lived in the PLATFORM DEFAULTS (`shared/gameConfig.ts`), merged under a
DB `brand` document by `server/index.ts:1377`, where an empty overlay field inherits the default.
Three commits emptied the defaults and nothing moved Amora's values into Amora's own document
first:

- `6cdca0e` emptied the six hero slots. Old values were absolute URLs on Amora's WordPress site.
- `17eb052` emptied logo / heartLogo / favicon. Old values were repo-local `/assets/images/` paths.
- `452ab2b` deleted 15 Amora image files from `client/public/assets/images/`, which now holds
  exactly one file (`platform-favicon.svg`).

Every one of those commits was individually CORRECT. Amora's brand welded into platform code is
precisely what makes thirteen forks impossible, and the code comment says so honestly: "the old
Amora URLs point at a private domain a fork cannot make its own." The defect is that a removal
shipped with no migration for the deployment that was standing on it.

### The other direction, which is aimed at the thirteen rather than at Amora

The same pass left Amora's other identity strings AS PLATFORM DEFAULTS:

    shared/gameConfig.ts:226   tagline: "Co-Become the Most Beautiful Village"
    shared/gameConfig.ts:228   location: "Dominicalito, Costa Rica"
    shared/gameConfig.ts:246   footerBlurb: "A regenerative village in Costa Rica where all
                               beings belong and thrive."

So a fresh install for any of the thirteen founders opens already claiming to be in Costa Rica.
The founder's screenshot catches both failures in one frame: no name and no image, above a
sentence naming Dominicalito.

`scripts/check-brand-refs.mjs` exists and drove brand references 169 -> 36. Why it permits these
three is an open question handed to the audit.

### Recoverability, measured rather than assumed

- The 15 logo and mark files: RECOVERABLE. Deleted by `452ab2b`, not rewritten, intact in history.
- The six hero photos: NOT recoverable from source. They were never in this repo; they were
  hotlinked to `amora.cr`. All five distinct URLs now return HTTP 404 with a 58559-byte WordPress
  error page. The founder must supply these, which is what the new brand kit is for.

### The call, made rather than deferred

Restoring Amora's images into the platform defaults would un-break the live site tonight and
un-fix the thing the neutralization was for. Refused. A village's identity belongs in that
village's brand document, installed through the founder path, with Amora as village number one.
That makes the founder path the blocker rather than the images, which is why the audit's
highest-value lane is the one testing whether a brand kit can actually be installed end to end,
including whether an upload survives a container restart under the new `/app/data` volume with
the process running as `USER node`. If it cannot, that is a blocker for all thirteen.

Audit dispatched as workflow `village-identity-recovery`: five read-only lanes, every blocker and
high finding independently refuted before it reaches the founder. The two live architecture lanes
own `server/**`, so every lane in it is report-only and the coordinator sequences the writes.
## 18 - arch-store lane landed (2026-08-31, on `wt/s4-arch-store`, commit `d76a64e`)

### REPRODUCED FIRST, on the code as it stood, against the real local MySQL

Two writers, the exact shapes the flake hunt named, both answering without error:

    RACE 1  the tools-link-check job holds a snapshot, a steward renames a tool
            mid-flight and commits first, the job writes its snapshot back
            AFTER  t1: { name: 'Village Site', last_checked_at: <set> }
            VERDICT steward's rename ERASED; errors reported: A=no B=no

    RACE 2  the same job holds a snapshot, a steward CREATES a tool mid-flight
            VERDICT the new tool ERASED by the job's DELETE-all; A=no D=no

### Three counts in the brief were wrong, measured from the tree

- **NINE tables use `dbCollection`, not seven.** The brief and section 13 both list seven and
  omit `roles` and `role_holders`. Full list: `submissions`, `milestones`, `training_modules`,
  `investor_docs`, `stage_events`, `roles`, `role_holders`, `circles`, `tools`.
- **34 `replaceAll` call sites, not "roughly 20"**, all of them in `server/index.ts`, plus 95
  `all()` reads.
- **The 15-second first tick is real and measured at 16.7s wall on a real boot**, and it runs
  **28 jobs**, not just the ones anybody had in mind.

### THIS BUG WAS ALREADY KNOWN ON ONE TABLE, AND PAPERED OVER THERE

`server/index.ts:2986` carries `withRoleHolderLock`, whose own comment describes this defect
exactly: "two overlapping writers would both snapshot the pre-write array and the later
replaceAll would erase the earlier write from both DB and cache". Somebody found it on
`role_holders`, wrote a process-local promise chain to serialise that ONE table, and wrote
underneath it "this process is the only writer (the S12 single-writer assumption)". The other
eight tables never got the lock, and the assumption is false for the few seconds a Railway
deploy runs two containers. 0122 generalises the fix and moves it to where the data is.

### The fix: a version per collection, stamped on the rows, checked under a row lock

Migration **0122** adds `collection_versions`, one counter per collection. `all()` returns row
COPIES stamped with the version they were read at, under a SYMBOL key. The symbol is the whole
reason no caller had to change: it survives `{ ...row, ...req.body }` and `{ ...row, order }`,
which is how every one of the 34 sites builds its payload, and it is invisible to
`JSON.stringify`, `Object.keys` and the column list, so it reaches no API response and no
INSERT. `replaceAll` reads the counter under `SELECT ... FOR UPDATE`, which is also the lock
the read-modify-write cycle never had, and takes one of three paths:

    stamp === counter     the same DELETE plus re-INSERT as before, byte for byte
    no stamp anywhere     payload built from scratch: boot seeding, unguarded as before
    stamp < counter       REBASE onto the current rows

Every existing test takes the first or second path, which is why 0122 is a safe change to a
file 34 routes depend on.

**REBASE RATHER THAN REFUSE, and the reason is mechanical, not aesthetic.** Refusing was the
first design and the brief's own suggestion. These callers are Express 4 async handlers with no
wrapper, so a throw is an unhandled rejection, not a 500, and the steward's request HANGS. That
is the same trap already in section 6 against `putSecret`, now filed as its general fix.
Refusing would also cost the link-check job a full day, because the scheduler stamps
`last_run_at` when it CLAIMS a job, not when the job succeeds. The one case that still throws is
a snapshot older than the 8 retained versions, where there is no baseline and any answer would
be a guess.

### VERIFIED AFTER, same attack, unchanged

    RACE 1  steward's rename SURVIVED; job's lastCheckedAt SURVIVED; A=no B=no
    RACE 2  the new tool SURVIVED; C=no D=no

Both writers land. Both are now permanent tests in `server/repos/storeDbConcurrency.test.ts`.
**POSITIVE CONTROL:** disarming the stamp (one line, `all()` stops stamping) fails 6 of the 9
with the ORIGINAL symptoms, `expected 'Village Site' to be 'The Steward Renamed This'` and
`expected [t1,t2,t3] to deeply equal [t1,t2,t3,t4]`. The 3 that still pass are the ones that do
not depend on the stamp, which is what they should do.

### The migration was RUN, not reviewed

Run 1 through the real boot migration runner (recorded in `_migrations_applied`). Then three
counters seeded at 41, 7 and 1903 plus a real `tools` row, and the file re-executed twice by
hand: schema, columns and rows byte-identical both times, counters intact, tools row count
unchanged. `check-migration-compat.mjs` passes and prints its own honest limit: it seeded 0 rows
because the only table 0122 names does not exist in the previous release, so phase 3 proved
nothing there. That is exactly why the by-hand run above exists.

### The scheduler: a switch, and one change deliberately NOT made

`SCHEDULER_ENABLED=0` stops background work in a process, defaults ON, and says so loudly on
every boot. `server/loop.e2e.test.ts` sets it. Measured against a real boot: default runs 28
jobs 16.7s in, with the switch off it runs 0.

**NOT CHANGED, on purpose: stamping a never-run job as "just ran" when its row is created.**
That would stop a first boot firing everything at once, which is a real improvement for 13
instances pulling one image, and it is not this lane's to make, because
`server/synthesisBatch.routes.e2e.test.ts:243` proves the current behaviour is intended: it
waits up to 120s for `synthesis-batch-poll` (a 5-minute job) to report a result, which can only
happen because the first tick runs a job that has never run. Its real subject is that the job
reads its switch when it RUNS rather than when it is registered. Whoever takes the stampede
needs a new vehicle for that assertion first.

### S15: THE PASS RATE MEASURES NOTHING ON A QUIET BOX, SO HERE IS A REAL MEASUREMENT INSTEAD

Asked for, and run: `server/loop.e2e.test.ts` ten times before, ten times after.

    BEFORE (base code, base scheduler, base test file)   10 of 10 passed, 70 tests each
    AFTER  (this lane's two commits)                     10 of 10 passed, 70 tests each

**THAT COMPARISON IS WORTH NOTHING AND SHOULD NOT BE QUOTED AS EVIDENCE**, and the reason is
measurable: the whole file now runs in 18.5 SECONDS on a quiet machine, while the scheduler's
first tick lands at 16.7 seconds after the child spawns (measured directly, see below). The
collision window closes before the tick opens. Section 4 already says this suite only fails
under contention; twenty green reps on an idle box is the same non-answer, run twenty times.

**SO THE COLLISION WAS DRIVEN BY HAND INSTEAD, through real HTTP routes on the real built
server.** `POST /api/admin/tools/check-links` is the same read-modify-write as the
`tools-link-check` job, with the same awaits (read `all()`, dial every tool's URL, stamp
`lastCheckedAt` in place, `replaceAll`), and unlike the job it is reachable. Boot the built
server, enable tools, create three, fire check-links, and 150ms later fire the steward's
`PUT /api/admin/tools/:id` rename. Same script, both builds:

    BASE BUILD
      check-links  -> HTTP 200
      steward PUT  -> HTTP 200   name in the answer: "The Steward Renamed This"
      read back through the API: name = "Village Site"
      VERDICT: the steward's rename WAS ERASED, and both requests answered 200

    FIXED BUILD (same script, unchanged)
      check-links  -> HTTP 200
      steward PUT  -> HTTP 200   name in the answer: "The Steward Renamed This"
      read back through the API: name = "The Steward Renamed This"
      VERDICT: the steward's rename SURVIVED, and both requests answered 200

The API told the steward their rename had worked, echoed the new name back to them, and then
served them the old one. That is the harm this lane existed to remove, and it is now removed at
the route a person actually clicks.

The fixed run's server log also caught the SECOND race happening on its own, unprompted:

    [store] tools: reloaded and found 2 row(s) where the cache held 5. Something wrote this
            table without going through the collection, so version is now 3 ...
    [store] tools: merged a write read at version 4 into version 6, 3 row(s), no field was
            changed by both

The first line is `retireExamples` clearing the three example tools the moment the first real
one was published, caught by the new `load()` bump. The second is the link check being rebased
onto the steward's rename. Both mechanisms, firing in an ordinary run, saying what they did.

### Gate set, run in this worktree, exit codes unpiped

Workflows enumerated from `.github/workflows/` rather than from the brief: `ci.yml`,
`codeql.yml`, `db-backup.yml`, `module-intake.yml`, `module-review-agent.yml`, `release.yml`.
Six, not the four section 4 lists; `codeql.yml` and `release.yml` are new since that reading.

    pnpm check (cold, tsbuildinfo deleted)   0
    npx tsc -p tsconfig.tests.json --noEmit  0
    pnpm build                               0
    check-migration-numbers                  0   109 migrations, next free 0123
    check-migration-compat                   0   and it says out loud that it seeded 0 rows
    check-dist-budget                        0   main JS 502 of 700 KB, total 5660 of 6600 KB
    pnpm audit --prod --audit-level high     0
    18 guard scripts (brand, voice, dash, auth, admin-reach, save-honesty, repo-payloads,
      mirror, upload-strip, artifact-budget, doc-links, route-reachability, map-routes,
      image-budget, theme-literals, and the three guard self-tests)                       all 0

    pnpm test    222 files, 3253 tests, 0 skipped, 0 FAILED, exit 0, 1143s

The reference in the brief is 209 files / 3118 tests; the base ref this lane sits on is already
past that, and this adds 2 files and 14 tests on top. **The brand guard caught a real mistake in
this lane's own work**: the first draft named the snapshot symbol after the village, in platform
code, in a hard-clean zone. Renamed to name the file instead.

One earlier full run had `server/modulePool.e2e.test.ts` fail its `beforeAll`. It passed in
isolation immediately after, and passed in the clean run above. Mechanism and fix filed in
section 6: that file is the only one of 34 that binds a HARDCODED port.

### What this lane did NOT do

- **No caller was migrated, because none could be.** All 34 `replaceAll` sites live in
  `server/index.ts`, which arch-server owns exclusively this wave. The fix was designed to need
  zero caller changes for that reason, and it does. Per-row `upsert`/`deleteById` is the better
  long-term shape and was deliberately NOT added: with every caller out of reach it would have
  been dead API surface.
- **`withRoleHolderLock` was left in place.** It is now belt-and-braces over a real database
  lock rather than the only guard. Harmless, and removing it is a `server/index.ts` change.
- **The known hole, stated:** a payload with NO stamp is still an unguarded whole-table
  overwrite. That is the boot seeding path (`server/index.ts:1973`, `1985`, `1997`, `2001`),
  which runs when the table is empty and nothing else is writing. Making it fail closed would
  mean changing those four callers.

### A SECOND RACE, found while writing the first fix, and closed in the same file

A counter that only moves when `replaceAll` moves it is blind to raw SQL, and three files write
these tables directly. The one that matters is `retireExamples` in `server/lib/examples.ts`: it
DELETEs the example rows with raw SQL and then reloads the cache through `wireExampleCaches`,
because otherwise the cache keeps serving rows the database no longer has. It fires from
`onRealItemPublished`, which `POST /api/admin/circles` (`server/index.ts:11167`) calls WITHOUT
awaiting. So a steward creating their first real circle retires the example circles while
another writer may be holding a snapshot that still lists them, and that writer's `replaceAll`
would put every example row straight back.

`load()` now bumps the counter when a reload finds different rows than the cache held, which
turns the reload the raw deleter was already required to do into an invalidation for writers as
well as readers. A first load has an empty cache and nothing to compare, so boot never bumps.
Reproduced and closed as a test; disarming the bump fails it with `expected [t1,t2,t3] to deeply
equal [t1]`, the example rows back from the dead.

This also fixed a hazard the first draft introduced: `load()` used to CLEAR the rebase history,
so any writer in flight across a reload would have got a `StaleSnapshotError`, which under
Express 4 is a hung request. The history is now kept, because each entry says what `all()`
handed out at a version and that stays true across a reload.

## 21 - A finding 37 audit agents missed, because they all looked at the rendered page

Found by the coordinator while settling an audit unknown, not by the audit.

### The measurement

`GET https://amora.regencivics.earth/assets/ProjectHistory-CZGHGdo2.js`, **no auth header, no
cookie**, returns **HTTP 200 and 55,718 bytes**. That chunk contains, in plain text:

    "Complete the investor memo for the landholder - terms, vision, and deal structure
     written and ready to share"
    "Establish the ministry - 508(c)(1)(a) structure formalised and membership framework
     confirmed"

Control: the same grep for a string that is not there returns 0, so the grep is not lying.

Seventy hardcoded task items across six named weeks of March and April 2026, which is Amora's
own internal sprint history, sitting in platform code.

### Why every audit lane walked past it

`/project-history` is an **ungated route with an in-page client-side gate**. A signed-out visitor
gets exactly this and nothing else:

    Command Centre
    The Command Centre is for the founding team.
    Sign in with an admin account

So the blast-radius lane, which drove the live site as a visitor, correctly recorded a sign-in
wall and moved on. The lane was not wrong. It was measuring the rendering, and the defect is in
the delivery.

### The generalisable rule, which is the actual finding

**A client-side admin gate protects the rendering, never the data.** The page is lazy-loaded, so
its content ships as a public static asset that the server hands to anyone who asks. `useAuth`
runs after the bytes have already arrived in the browser.

This one is contained rather than systemic, and that was measured rather than hoped: eight client
pages gate on `isAdmin` or the founder role. Their built chunks were grepped for Amora-specific
strings, with an ungated page as the control. `JourneyToLaunch`, `GameMechanics` and `Network`
return **zero** hits. `ProjectHistory` is the only one that hardcodes village-specific content
behind a gate of this kind, because every other admin surface renders data it fetches from an
endpoint the server actually gates.

### Severity, stated honestly

This is not a credential leak and nothing here is a secret in the cryptographic sense. It is
Amora's business intent, including a line about an investor memo's deal structure, readable by
anyone who fetches one JavaScript file. Whether that matters is Rye's call and not mine.

For the thirteen it is unambiguous: every village would ship Amora's March 2026 sprint plan
inside its own bundle, and an admin in village seven opening their Command Centre would read
Amora's roadmap as their project history.

### The fix, which follows the ruling already made this session

This content is a village's data, so it belongs in that village's database, exactly like the
identity fields. It does not belong in platform code, for the same reason and with the same
consequence if it stays. Queued rather than done, because the repair wave is mid-flight and
`client/src/pages/ProjectHistory.tsx` is 1,991 lines and carries a line ratchet.

Two things to get right when it is done:
1. Moving it out lowers `ProjectHistory.tsx` well below the 1,000-line ratchet threshold, which
   is a baseline write, not a raise. Say both numbers in the commit.
2. Amora's real history must be written into Amora's record BEFORE the code copy is deleted. That
   is the same sequencing constraint as R14 and section 17, and it has now bitten once already.

## 22 - Auth: two rulings, and the gap between signing in and being able to do anything

### R15 - FOUNDER_EMAILS, because the auth lane granted no role

RAISED BY: the coordinator, on reviewing `wt/s6-auth` before merging.

THE GAP. The lane built the whole Google flow, 2,824 lines with a 620-line e2e suite, and
granted no role anywhere. `git diff main...wt/s6-auth | grep -E 'role\s*=\s*"(founder|admin)"'`
returns nothing. That is the difference between "I signed in" and "I can name my village", and
from a founder's side those are the same problem.

It matters because the founder was ASKING for OAuth as the fix for being locked out. Shipping
sign-in alone would have handed him a nicer login screen and left him exactly as stuck, which is
the failure mode this programme keeps finding: a thing that reports success while the harm
stands.

THE RULING. `FOUNDER_EMAILS` is the deployment owner's declaration of who founds this village.
Same trust anchor `ADMIN_PASSWORD` already uses, and no weaker: whoever can read that variable
can already read the database credentials beside it.

Applied on EVERY matching sign-in rather than once, which makes it the permanent recovery path.
`ADMIN_PASSWORD` spends itself creating the first account and `forgot-password` refuses an
account with no password hash, so before this there was nothing left to reach for. Both lockouts
this year fell into exactly that hole.

VERIFIED BEFORE RELYING ON IT, rather than trusting the comment: `identityFromClaims` refuses
`email_verified !== true` (`server/lib/oauthGoogle.ts:301`) before any account is looked up.
`decideFounderGrant` refuses an unverified address a second time, so relaxing that check upstream
cannot quietly turn the grant into a way to hand a village to a stranger.

THREE DELIBERATE REFUSALS: it only ever raises a role, so a typo cannot demote a working founder
or lock a village out of itself; it never accepts an unverified address; and a blank list means
nobody and never anyone, which is the empty-versus-zero confusion that caused section 17.

### R16 - ReGen Civics hosts one Google client for the incubator villages

RAISED BY: the founder, verbatim: [*Just add the google cloud console work to the onboarding
guides for each founder to do (the one they give to thier own Claude session) or is it possible
that regen civics just hosts the google sign on capability for all instances?*]

THE ANSWER, and it needed no code. The lane's own doc already says why: a founder who registers
their own client sets the same three variables as one handed shared credentials, and the
deployment does not know or care who registered them. Hosting it centrally is an operations
decision rather than an engineering one.

VERIFIED rather than assumed, because it is the class of limit that is easy to get wrong from
memory: Google allows 100 redirect URIs per OAuth client. Thirteen is nowhere near it.

THE RULING. Shared ReGen Civics client is the documented START. A village's own client is the
documented GRADUATION, taken before going live. Moving between them is a two-variable change
with no code and no migration.

WHERE THIS DEPARTS FROM THE LANE, stated plainly rather than quietly overwritten. The lane chose
per-village clients and argued it well, and its analysis is kept in full. It was written for a
village running a real community, and for that village it still holds. It was NOT briefed on the
phase these thirteen are actually in: months of design before a single member joins. In that
phase the shared client's costs land almost entirely on us rather than on a member, and a
founder registering their own client would be doing it against a domain they have not chosen
yet.

THE TWO COSTS ARE DOCUMENTED WHERE A FOUNDER READS THEM, not buried: the Google consent screen
says ReGen Civics rather than the village's name, and one leaked secret is every incubator
village's problem at once. That is precisely why it is right for a village being designed and
wrong for one holding real accounts.

THE BROKER STAYS REFUSED, though for a narrower reason than the lane gave. Its objection was
that a broker makes us the authentication authority for every village. True, but for villages
ReGen Civics HOSTS we already hold the database, so that objection does not bite there. The
real reason is that the shared client delivers an identical founder experience today with zero
code and no service to run forever. Revisit only if the shared-profile bridge needs it, and do
not let sign-in convenience drive that decision.

### The onboarding step that had to change with it

`docs/PROVISIONING.md` step 6 told a founder to run `curl` to create their own account. That is
the step that has stranded two people, and both times the only way through was a terminal. It
now leads with `/claim`, which works from a phone, and keeps the curl in a details block.

### Measured

Full suite at `1d8c1d7`: **231 files, 3406 tests, 0 skipped, exit 0.** The zero skips matter
here: the Google e2e suite skips itself without `TEST_DATABASE_URL`, and a fresh worktree has no
`.env`, so an earlier run reported 26 tests "passing" that had not run. Copying `.env` in was
what made the 26 real, and the suite then refused loudly for a missing `dist/` rather than
skipping quietly. That refusal is good design and worth copying.

## 23 - Founder rulings on tokens and economics, 2026-08-31 evening

Recorded because the code will be built from them and because two of them corrected me. Governance
rulings from the same conversation live in `docs/GOVERNANCE_EVOLUTION_PROMPT.md`, which is the
handover to the session building that, and are not duplicated here.

**The token model, in his words, and it corrected mine.** Gratitude is the lunar-cycle allowance
every member gives away to recognise others, and it IS the platform default. A lane had changed
`currency.name` to "Recognition" on a brief I wrote, and the brief was wrong: he had reported that
the Setup Wizard confused him about WHICH token he was renaming, and I turned a symptom report into
a rename task. Reverted. The quest-earned token paid from the gratitude pool defaults to Village
Credits, and he has since said "Village currency and village credits can be interchangeable".

**Slugs freeze once set; names stay editable forever.** He agreed with the split. A slug is
history's identity: every ledger repeat-protection key carries it. Nothing has been issued yet,
which is why the `amora` to `equity` rename is possible at all.

**Decimals to 4 across the board.** NOT YET DONE and it needs care: Village Voice rides in
thousandths on purpose so a rule of 0.1 does not round to zero. Moving it is a data migration on
live balances, not a config change. Flagged to him as worth doing in the same release as the equity
rename while ledgers are empty, or not at all.

**Quests, roles and contributions should pay any combination of any tokens**, defaulting to Village
Voice and Village Credits, with gratitude removed from the shipped default. Villages may add it
back. **Village Credits minting must work**, which is his answer to a hazard the audit found: the
rule engine reportedly cannot mint Village Credits, so a rule pointed at it would show as enabled
and pay nobody. That was briefed to the payouts lane with an escape hatch; his ruling closes it.

**Other rulings, recorded as specification and mostly not yet built:** unspent gratitude expires at
cycle close; balances may go negative with a floor defaulting to zero; a module switched off makes
its balances go dark with the rows surviving so it can resume; a village redeeming tokens for cash
or equity should check local law.

**The bridge, in three stages he named:** stage 1 a one-way bridge, today; stage 2 full Hypha
integration where the two feel almost as one application; stage 3, several years out, the game mints
directly to Base and stops using Hypha. One-way was agreed against my recommendation that a two-way
burn invites double-spend across the seam.

## 24 - What I got wrong tonight, continued

Error 12 is above. These are after it, and the first three are one mistake wearing three hats.

**Error 13, the exit code after a pipe. FOUR times.** `pnpm test | tail` reports the status of
`tail`. It gave me a green on a genuinely red tree, and I nearly pushed on it. Every run since has
captured the code with no pipe, and the fix is that simple, which is what makes doing it four times
worse rather than better.

**Error 14, a suite that skipped 1,151 tests and exited 0.** A fresh worktree has no `.env`, so
`TEST_DATABASE_URL` is absent, so the 74 database-backed files skip. 171 passed, 74 skipped, exit 0.
Those 74 are the ones that exercise the ledger. This is the same mechanism that earlier reported 26
Google auth e2e tests passing when they had never run. Caught the second time only because the
number looked wrong.

**Error 15, a deploy watcher that matched a previous run.** I asked for the latest COMPLETED release
run and got the old failure, then nearly reported it as the current result. Re-keyed on the commit
SHA.

Those three are one shape: **a probe that cannot distinguish the thing it is waiting for from
something that merely looks like it.** I have been briefing lanes about that class all week.

**Error 16, a hand-picked subset of guards.** After adding the `/claim` route I ran seven guards
chosen by intuition and they passed. `check-map-routes` was not among them, and it was red on main
because the Living Map's derived route list had 63 entries against the router's 64. **CI sat red and
I did not know.** A subset chosen by intuition is not a gate.

**Error 17, an exemption that swallowed more than it should.** Fixing the ratchet deadlock I wrote
`/^\s*register[A-Z]\w*\s*\(/` to exempt route registrations, and it also exempted every
`registerJob("stay-nightly", ...)` line: 60 lines where 30 were real. Caught only because the number
was twice what 15 modules could explain. The names are now derived from the actual `register as`
bindings. A guard that over-exempts hides the growth it exists to catch.

**Error 18, regex surgery on import statements.** Removing dead imports I used inline substitution
on multi-name lines and corrupted three of them. Restored from a copy taken first, then narrowed to
the whole-line case that cannot be got wrong. 37 lines instead of 46, and correct.

**Error 19, two workflow scripts that failed to parse on a stray backtick.** Twice, the same cause,
inside a `String.raw` template. Cost a minute each and both were avoidable by reading what I wrote.

**Error 20, a brief built on a symptom report.** Recorded in section 23 and repeated here because it
is the most expensive kind: the founder described confusion, I heard a specification, and a lane
spent hours changing a default that was already correct. His fourth message that day said "we need
to be clear about the difference", which is a request for clarification. I should have answered it
rather than acted on it.

## 25 · The first payout of every village's life was lost (fixed 2026-09-01)

Found by the s10 proof lane while verifying somebody else's work, which is the
only reason it was found at all: the lane's brief was to confirm the payouts
ruling, so it drove a quest to confirmation on a genuinely fresh village and
read the ledger, instead of reading the rules table like the suite did.

**The defect.** `mintForConfirmedClaim` was the only caller of `economyEpoch`,
and `economyEpoch` stamped the epoch when it found none. First confirmed quest
in a new village: asks for the epoch, none exists, writes `now`, then measures
itself against the value it just wrote. It resolved 20ms earlier. It loses.

    economyEpoch      2026-09-01T07:06:32.489Z
    claim resolvedAt  2026-09-01T07:06:32.469Z

Ledger, first quest: `gratitude 20`, and nothing else. Second quest, same
village, same code: `gratitude 20`, `credits 25`, `village-voice 10000`.
Identical on main, so it is not a regression: it is once per village, forever,
on the first piece of work anybody there ever finishes.

**The fix** (`5bb5ce1`): reading the clock and starting it are two functions
now, because the bug was that they were one. Boot stamps it next to
`seedEconomy`, which is what the comment's "the day the flag flips" always
meant. The mint passes the claim in hand, so a claim that still finds no epoch
starts the clock rather than losing to it. The backlog protection the epoch
exists for is unchanged and still tested at 90 days.

**Coordinator error 21: I reported this engine's behaviour to Rye from the
rules table too.** My brief said "today a confirmed quest pays Gratitude plus
10 Village Voice". That sentence was true of `mint_rules` and false of every
village's first quest. I had read the same row the misleading test read.

**The two things that hid it, both worth keeping:**

1. A test named `pays a confirmed quest in voice and credits` that asserted on
   four columns of the `mint_rules` ROW. It never confirmed a quest and never
   read a balance. **A test named for an outcome that asserts on configuration
   proves the intent and not the outcome** — this is the third time this
   program has paid for that exact shape, and the first time it cost a real
   payout rather than a false alarm.
2. `beforeAll` calling `economyEpoch(pool)` to get a running engine. Entirely
   reasonable, and precisely the state in which the bug cannot reproduce, so
   every later test in two files ran on the far side of it. **Setup that puts
   the system into a good state can be the thing that hides the bad one.**

`economyEpoch.test.ts` is written under two rules stated in the file: never
stamp the epoch in setup, and assert on balances, never on rules.

**Positive control:** restoring the stamp-then-compare ordering fails exactly
one of its five tests, with the server's own sentence, `expected 'confirmed
before the economy epoch' to be undefined`. The other four still pass, which is
correct — only one of them discriminates.

## 26 · CI stopped checking almost everything, and said so in one line

Red since `0c9127e` (2026-09-01 07:13), last green `dda29ce` at 04:53. The
visible symptom was one guard's self-test failing two of twenty-four
assertions. The actual state was that `ci.yml`'s failing step sits at line 185
and nothing after a failed step runs, so **twenty-odd guards, `pnpm build`,
`pnpm test` at line 569, the bundle budget and the dependency audit had not run
on any commit since** — including three of mine.

**Coordinator error 22: I verified the deploy and called it done.** After
pushing `0c9127e` I checked that the release published and the live site
answered, reported it verified, and never looked at CI. A green deploy and a
green CI are different claims and I made one while sounding like both.

**Two defects, and the second explains why nobody caught the first.**

1. `run-self-tests.mjs` captured each child's whole stdout and stderr and kept
   only the LAST non-empty line, on both paths. A passing guard ends with a
   tidy summary, so the output looked deliberate, and the failing path was
   silently throwing away every line naming which assertion failed. CI said
   `check-migration-compat: 2 failure(s) of 24` and stopped. **A runner that
   summarizes failures the same way it summarizes successes is a runner that
   cannot be acted on.**

2. The guard's own self-test built "run with no database" by copying
   `process.env`, deleting `TEST_DATABASE_URL` from the copy, and passing the
   copy to a helper that spreads an override OVER `process.env`. **Deleting a
   key from a copy and spreading the copy back removes nothing.** So the
   scenario ran the guard WITH the database whenever the variable was in the
   environment.

   It could only fail where it mattered. On a dev machine the variable lives in
   `.env` and never reaches `process.env`, so it passed here every time; CI
   sets it as a real variable, so it failed there every time. **Same commit,
   green locally, red in CI, and the difference was not the code.**

**Coordinator error 23: I published a cause I had not tested.** `0f1a7f2`'s
message says this could not be reproduced locally because CI runs `mysql:8` and
this machine runs MariaDB. That was a hypothesis and it was wrong; the engine is
irrelevant. `export TEST_DATABASE_URL=...` reproduces it exactly. I had the
reproduction available before I wrote the sentence and did not run it.

**A push can skip CI entirely.** `bb87407` reached main through a concurrent
session using a token that suppresses workflow runs, so the commit that fixes
CI had no CI run of its own. Verified by pushing the same SHA to a throwaway
branch: 43 steps, all success, zero skipped, including Build, Test, Bundle
budget and Dependency audit. **`origin/main` having a commit is not evidence
that anything checked it.**

---

## 27 · THE LANDING ORDER — read before you touch a contended resource, write after you claim one (2026-09-04)

The founder asked whether a master coordinator should own merging and full-suite runs. The answer
was no, and this section is what replaces it. A coordinator session serialises every landing behind
one context, still has to run the same suites, and adds a third place that can hit a session limit
mid-merge. **This FILE is the coordinator.** It costs a minute to write and it does not sleep, hit a
limit, or have to be woken up.

The two real coordination failures of 2026-09-03/04 were both caught by lanes telling each other
what they were about to touch, not by any gate: two lanes holding migration `0144` at once, and one
lane's exit test asserting a behaviour another lane had deliberately changed. Both would have been
caught earlier and cheaper by a written claim.

### 27a — How to edit this section without stealing another lane's work

`ga-map` and the sibling worktrees are shared live by several lanes, and a wholesale write to a
shared file silently reverts whoever wrote last. So:

1. `git pull --rebase` IMMEDIATELY before you edit. Not five minutes before.
2. **Append your claim row. Never rewrite a row you did not write, and never regenerate the table.**
3. Commit this file BY PATH — `git commit SEASON2_FLEET_LEDGER.md` — never `git add .`, which
   sweeps up whatever a sibling lane has in flight in the same worktree.
4. Push immediately. A claim that sits unpushed protects nobody; a lane's `git log` cannot see it.
5. Release your claim by appending a RELEASED row. Do not delete the original.

If a claim conflicts on rebase, that is the system working: two lanes wanted the same thing and now
you know before you have written code, rather than at the merge.

### 27b — The contended resources, and the check that actually sees other lanes

**The general rule, which matters more than the list: every gate we have compares YOUR TREE to
`origin/main`, so every one of them is structurally blind to what another in-flight branch is
doing.** Neither file is on main, so from either branch the resource reads free. That blind spot is
shaped exactly like the collision a swarm produces. Claim in this file first; run the gate second.

**1. Migration numbers, `drizzle/*.sql`.** `check-migration-numbers --next` told two different lanes
0144 on the same day, while the real ceiling was already past 0150, held on unfetched remote heads
AND as untracked files on sibling worktrees, which no git command reaches at all. Remote heads alone
are NOT enough. Run both of these, every time:

```
git log --all --name-only --diff-filter=A --format="" -- 'drizzle/*.sql' | grep -oE '[0-9]{4}' | sort -n | tail
ls /c/Users/taren/Desktop/Amora/*/drizzle/*.sql | grep -oE '[0-9]{4}_' | sort -n | tail
```

Run them SEPARATELY: the first walks every ref and takes close to two minutes, and chaining them
behind it inside one two-minute timeout is how you get a confident empty answer from the second.

**A CLAIM IS NOT A RESERVATION, and this section's own claim board proved it within hours.** This
lane claimed `0144`, held it uncontested, and it became unlandable anyway, because main moved past
`0159` while the claim sat still. The gate refuses a migration added since the base ref that is
numbered below what that ref already reached, so a held number expires as soon as the mainline
overtakes it. **Claim to stop two lanes colliding; take the actual number at LANDING, from a fresh
scan.** A number written down in advance is a measurement with a timestamp, and this one went stale
in under a day. The same evening produced the other half of the lesson: one lane renumbered before
landing and lost nothing, while two others collided at `0156` and both shipped, at which point
renumbering became impossible rather than merely annoying.
Measured at `20985d0`: refs reach **0154**, disk holds **0155**. Do not copy those figures forward —
that is exactly the stale next-free number section 3 deliberately refuses to carry. Take a number
above BOTH scans, claim it below, and assign it at landing.

**2. The six ratchet baselines in `scripts/`** — `server-index-size-baseline.json`,
`file-lines-baseline.json`, `brand-refs-baseline.json`, `image-budget-baseline.json`,
`tailwind-gray-baseline.json`, `theme-literals-baseline.json`. Two lanes lowering the same number
from the same start means the second to land is red on arrival, and it reads exactly like a flake,
because the PUSH run passes while the PULL_REQUEST run fails on the same sha, since only the second
builds merged with main. Claim the baseline here before you lower it. On collision, **reset the file
to main's copy and lower from there**: `--update-baseline` REFUSES, because from your branch the
correct value is a raise. Never clear a red baseline with `--update-baseline` — the gate is red
about committed work, not about your change.

**Some of those ratchets are PER FILE, and that is the half that bites an extraction.** Moving code
out of a file carrying a grandfathered allowance into a file that has none turns settled lines into
new violations with nobody having written a new one. `check-tailwind-gray` took a lane red on two
lines it had merely relocated, and `check-file-lines` has the same shape. **Match the destination
directory's convention rather than moving the baseline.** Every lane extracting from
`server/index.ts` will meet this, on debt it inherited rather than created.

**And a ratchet script measures the worktree the SCRIPT lives in, not the tree you are standing in.**
It resolves its root from its own file location. So when you are checking whether a red is inherited,
run the OTHER tree's copy of the script, not yours pointed at it, or you get a confident green about
the wrong tree.

**3. `server/index.ts`,** 28k lines, touched by every extraction lane. Land it ALONE, never
alongside another `server/index.ts` change, and rebase it last. This was already rule 5 of section
5; it is repeated here because it is also a baseline collision (see 2).

**4. `.github/workflows/ci.yml`,** owned by the safety lane. Other lanes' CI steps queue behind it.
Ask on the claim board rather than editing it.

**5. The shared integration worktrees, `ECON` above all.** A worktree every session can reach is a
contended resource with no lock on it, and until 2026-09-04 the only thing protecting `ECON` was
that nobody had a reason to walk in. That is not protection. On that day it was found holding **121
files staged, 4736 insertions against 13665 deletions**, matching no commit and no branch, including
a revert of the `vitest.config.ts` junction fix at `48be4a6` that every lane's client tests depend
on. Nobody's history was lost, because nothing had been committed. **Claim an integration worktree
here before you work in it, and never write into one you did not create.** If you find an unclaimed
tree dirty: ask on the wire, give a deadline, and clean it with
`git stash push --include-untracked -m "unclaimed <date>"` rather than `reset --hard` or
`checkout --`. The stash reaches the same clean tree and is recoverable; the other two destroy work
that may belong to a session that is mid-edit right now. That is what was done, and the tree is
clean with the work preserved. **Recover a rescue stash with `git stash apply` by SHA, never `pop`,**
so a second lane reading the same stash cannot consume it out from under the first.

**THE STASH LIST IS SHARED ACROSS EVERY WORKTREE, and the indices RENUMBER.** `refs/stash` lives in
the common git directory, so a stash made in `ECON` is `stash@{1}` in a completely different lane's
tree, and any lane's `git stash pop` takes whatever is on top at that instant. Demonstrated by
accident while writing this paragraph: a throwaway stash from this lane landed at `stash@{0}` ON TOP
of the ECON rescue, pushing the rescue to `stash@{1}`, and dropping the throwaway moved the rescue
back to `stash@{0}`. So a note recording "the rescue is `stash@{0}`" is wrong the moment any of eight
sessions stashes anything. **Record a stash by its SHA, never by its index,** and prefer a branch to
a stash for anything that must survive: `git stash` is a shared mutable stack with no owner field,
which is close to the worst possible home for the one copy of somebody's unclaimed work.

**`git log --author` DOES NOT identify which session did something, and it fails in the worst
possible direction.** Every lane on this machine commits under the same git identity, so an
authorship search returns the newest commits in the REPOSITORY, not the ones touching the tree you
are asking about. **It therefore points at the most recently active lane, and the harder a session
has been working the more it looks like the culprit.** Verified while writing this: the last forty
commits on main carry two author identities for eight or more live sessions, and an author query run
right now returns this lane's own merge at the top, then the merge before it. Whoever last landed
work is always the top hit, about a tree they may never have opened.

Authorship tells you the human. **The discriminator is `git worktree list`,** which says which tree
each session actually holds, and it is how two lanes ruled themselves out of the ECON question in
one command each. Say "not mine" with that output, never with an author search.

**A large deletion-heavy diff is usually a STALE BASE, not a change.** 4736 insertions against
13665 deletions, including a revert of a fix nobody would deliberately revert, is what a tree looks
like when its base predates several merges: re-staging everything presents the OLD state as a
deliberate act. The instinct on seeing thirteen thousand deletions is that somebody did something
drastic, and the likelier reading is that somebody is simply behind. Same disease as 27h one layer
up: there, `node_modules` disagreed with the lockfile; here, a working tree disagrees with main.
Both look like intentional work and neither is.

### 27c — Claim board (APPEND ONLY — one row per claim, one row per release)

| Date | Lane / session | Resource claimed | Branch | State |
|---|---|---|---|---|
| 2026-09-04 | governance (`b7f9ef`) | migration `0144`, `drizzle/0144_the_landing_loop_names_its_own_rows.sql` | `wt/governance-build` | HELD — confirmed mine after the profile lane moved off it |
| 2026-09-04 | profile lane | migration `0151` | (relayed) | HELD — landed as `3c739ce` |
| 2026-09-04 | governance (`b7f9ef`) | migration `0144` | `wt/governance-build` | **RELEASED, and the claim above is superseded.** Main now reaches `0159`, so `0144` is a GAP and unlandable by anybody: the gate refuses a migration added since the base ref that is numbered below what that ref reached. Renumbering the file is safe here ONLY because it has never run outside a throwaway test schema. Number to be taken at landing, per the count-not-band rule, never reserved now. |
| 2026-09-04 | paths lane | migrations `0144`, `0145`, `0146` | (landed) | RELEASED — renumbered to `0156`+ BEFORE landing, which is the correct order and why nothing had to be grandfathered |
| 2026-09-04 | two sessions | migration `0156` | (landed) | **COLLIDED AND SHIPPED.** Both files ran on production eleven minutes apart, so neither can be renumbered: the applied ledger keys on FILENAME, and renaming makes the file new to every instance that already ran it. Grandfathered with evidence in `b5ed26f`. The list of grandfathered numbers does not grow. |
| 2026-09-04 | governance (`b7f9ef`) | `docs/GOVERNANCE.md` and `scripts/generate-governance-doc.mjs` | `wt/gb-docs` | HELD — ruling top-up in flight |
| 2026-09-04 | admin lane | `ledger.admin_mint_cycle_cap` and `ledger.admin_mint_cosign_over` | landed `4364a2c` | **RELEASED, but READ THIS BEFORE TOUCHING THE MINT SURFACE. The MEANING of both dial keys changed and their NAMES did not**, so a grep finds them unchanged and returns the old semantics. They were compared raw against ledger amounts and are now scaled through `toLedgerUnits`, so the number is WHOLE TOKENS. At 0 decimals nothing moves; for a token with a scale the co-sign threshold rises by that scale, which is a governance weakening arriving as a units fix. Both descriptions in `shared/gameVariables.ts` now state the unit, which is the only place it survives a merged PR body going stale. Separately: the cap's COUNTING is being rewritten by the economics lane on `wt/econ` (`92bd0f5`, unmerged at time of writing) to count all issuance net of returns, and that commit also carries the corrected sentence in `client/src/components/admin/TokensTab.tsx`. |

### 27d — Verification: CI runs the full suite, lanes run what they touched

**Measured, 2026-09-03/04.** A local full suite is 25 minutes on a quiet machine and 46.6 minutes
under load, costs an agent's entire context, and three were killed mid-run by session limits in one
day, each losing about two hours with the result unwritten. CI's `verify` job is 8m24s to 10m24s,
measured independently by two sessions, on a clean machine with the pinned Node and the pinned MySQL
8 rather than our local MariaDB, and **it now costs nothing, because the repo is public again**.

We adopted local full suites because CI was dead for seven hours, and it was dead because the repo
was private with the Actions allowance spent and no payment method on file. That reason is gone. The
habit outliving its reason is the same defect class as a green whose justification rotted, applied
to our own process, which is why it is written down here rather than left as a preference.

**Never enumerate the guards by hand. Run `node scripts/module-facts.mjs`,** which reads `ci.yml` and
prints every gate in the order CI runs them, and is therefore right on the day you run it. A lane
running eleven gates from memory and calling that green is how a pull request reaches CI red on a
gate nobody had heard of. Any prompt or handoff in this repository that lists gates by hand is a
list that goes stale in silence. As of `20985d0` the script prints 35 entries, and the reason to run
it rather than copy that number is exactly that the number moves.

**But the script reads ONE FILE, and five workflows gate a pull request.** `.github/workflows/`
holds `ci.yml`, `codeql.yml`, `module-intake.yml`, `module-review-agent.yml` and `release.yml` on
`pull_request` triggers, plus `db-backup.yml` which is not. So `module-facts.mjs` is authoritative
about `ci.yml`'s steps and structurally blind to the other four. **Enumerate the DIRECTORY, then run
the script for `ci.yml`'s contents,** and when you quote a number, say which noun it counts. This
correction is itself the worked example: the paragraph above was published as "run the script and
you are current", which is the same stale-list defect it was written to prevent, one level up.

**And the CAREFUL method is wrong too, which is the part that will catch a lane who already knows
better.** `CLAUDE.md` teaches `grep -hoE "node scripts/check-[a-z0-9-]+\.mjs" .github/workflows/*.yml
| sort -u`. That enumerates the whole directory rather than one file, it is what a diligent lane
reaches for, and on 2026-09-04 it returned **26** against the script's **35**. The nine it cannot see
are the gates not NAMED `check-*`, and the five that are plain commands are the ones that bite:

    npx tsc -p tsconfig.tests.json --noEmit
    node scripts/run-self-tests.mjs
    node scripts/fork-env-audit.mjs
    node scripts/generate-token-doc.test.mjs
    node scripts/dependency-audit.mjs

A regex over a workflow is a guess about a shape. The script parses the file. The danger is not that
the grep is lazy, it is that it FEELS rigorous: it reads every workflow, it is the method the house
document prescribes, and it is still short by nine.

The first of those five is the one that would have bitten hardest here. `pnpm check` does not
typecheck test files, which is precisely why the tests typecheck is its own gate, and this lane had
added six test files. Run it COLD, deleting the tsbuildinfo first: the incremental cache lies, and a
warm green is a green about work it never re-checked. One nuance worth having, verified by reading
`tsconfig.json` rather than assuming: the exclude is `**/*.test.ts`, and that pattern does NOT match
`.tsx`, so `pnpm check` DOES typecheck a `.test.tsx`. Half of a lane's test files were never
invisible to it, which makes the gap narrower than it sounds and no less real.

Written by the Admin lane after landing PR #165, having run 26 of the 35 and believed itself
thorough.

- Lanes run **only their touched suites plus the guards**.
- **NAME THE SUITES A CHANGE CROSSES, NOT THE FILES IT EDITS.** This is the rule that makes the
  line above safe, and it has now bitten two lanes independently in two days. A migration unioning
  a token slug across eleven tables that do not share a collation took out EVERY database-backed
  suite; the lane first reported that only CI could see it, and that was wrong, because a collation
  suite in this repository provisions its own schema and reproduces it exactly on this machine.
  Nobody had run it, because it was in no lane's touched-file set. The same shape put a governance
  guard red across two pushes: the file it failed on was in nobody's set either. A touched-file set
  is a statement about what you EDITED; the suites worth running are the ones your change can be
  OBSERVED BY, which for a migration is every suite that provisions a schema and for a shared type
  is every consumer of it. Ask what a change crosses before you ask what it touches.
- The merge agent runs the touched suites and the guards, pushes, and **READS THE RUN**.
- **At most one full local suite per LANDING**, never per merge step.
- The one deliberate exception is a **pair-merge scratch**, because two branches merged together
  have no ref for CI to see. Even there, run only the suites the two branches share.

**Three failure shapes, and only reading the run distinguishes them.**

1. **Zero-step refusal.** The billing failures produced runs that died in 2 to 3 seconds having
   started nothing. A healthy `verify` is 43 to 45 steps. Read the STEP COUNT before the conclusion.
2. **Cancellation is not a red.** `ci.yml` carries `cancel-in-progress` with a per-ref group, so a
   burst of pushes leaves cancellations that mean exactly nothing.
3. **An infrastructure step failing at full step count.** npm's audit endpoint hung while its status
   page said all systems operational, and every merge in the repository stopped, `Dependency audit`
   dying on a socket timeout with everything else green. So read WHICH step, not only how many.
   PR #162 retries and distinguishes an answer from a failure to ask; the shape recurs.

**The trap that arrives in the first hour of following this.** `assertFreshDist` aborts a run whose
sources moved since the last build, at setup, RC=1, saying "no database-backed file ran". A lane
that has just switched branches and runs one file sees a red that is not about its code at all.
Either `pnpm build` first, or `ALLOW_STALE_DIST=1` **and only for suites that never boot the
bundle**. A client unit test is safe; the 41 e2e suites boot `dist/index.js`, and
`server/trackerPrivacy.test.ts` asserts on the BUILT chunks, so for those a stale dist means the
green is about yesterday's code. That is the same false green this change exists to avoid, arriving
through a different door.

**And a push is not a green.** A direct push to main can skip CI entirely (section 26), so after
pushing, read the run with `gh`. `origin/main` having a commit is not evidence that anything
checked it.

### 27e — Rebase and migration order, so lanes stay in sync

1. **Refetch, then rebase on `origin/main`.** The local tree runs behind origin far more often than
   it feels, and every line number and every "not implemented" claim taken from a stale checkout is
   suspect. `git fetch origin`, rebase, then re-verify the claims your work rests on.
2. **Assert the ANCESTRY of every commit your work depends on** before naming a head for a pair
   merge: `git merge-base --is-ancestor <sha> HEAD` per dependency, and say which ones you checked.
   Being level with your own remote is a different question, and a branch that merged main days ago
   does not carry a sibling's precondition that landed after it.
3. **A commit is done when a REF moved.** Worktrees share one object store, so a relayed SHA can
   resolve locally while sitting on no remote ref at all. Verify with
   `git rev-list --left-right --count HEAD...origin/<branch>` reading `0 0`, and quote the REF
   rather than the directory.
4. **Reserve migration numbers as a COUNT and assign them at landing**, after the scan in 27b.
5. **Never rename a migration that has already run.** `_migrations_applied` keys on FILENAME, so a
   rename runs as a NEW file while the old name stays marked applied, and an `ADD COLUMN` then
   bricks the boot. Drop and re-provision instead.

### 27f — DESTRUCTIVE, machine-wide: removing a worktree can delete the SHARED `node_modules`

**`git worktree remove --force` on a worktree whose `node_modules` is a junction follows the
junction and deletes files out of the shared store.** A lane made a scratch worktree, junctioned
`node_modules` exactly as our own setup instructions say to, then removed the worktree. Git deleted
`ECON/node_modules/.bin` outright and partially deleted nested packages under `.pnpm` before
aborting on "Filename too long". **Every lane on this machine lost `npx tsc` and `npx vitest` for
about twenty minutes.**

**The rule: unlink the junction FIRST, then remove the worktree.**

```
cmd /c rmdir <worktree>\node_modules
git worktree remove <worktree>
```

Our setup instruction creates this trap in every worktree we stand up, so it is the DEFAULT shape
rather than a rare one. Recovery, if it happens: `pnpm install --frozen-lockfile --force` in the
damaged root, about three and a half minutes, then run a real suite to confirm rather than trusting
the exit code.

**The junction has a second, quieter failure: vite refuses to serve `dotenv/config` through a
junction realpath, and the client tests SKIP rather than fail.** Two lanes were blocked by it while a
third ran fine, and the third ran fine only because one of its lanes had happened to run a real
`pnpm install` in a fresh worktree, which every later lane inherited. So the same shape has now
produced one destructive incident and one silent skip, and no lane chose it either time. **A real
`node_modules` costs an install and removes both failures.** Prefer it for any worktree that will run
client tests or that you expect to delete later; keep the junction only for short-lived
report-only trees.

There are more than forty sibling worktrees under `C:\Users\taren\Desktop\Amora\`. Treat every one of
them as live and owned by another lane: **never write into a worktree you did not create**, and never
`git add .` in one, which sweeps up whatever that lane has in flight.

### 27g — Two corrections to standing advice, both of which invalidate something we were repeating

**`pnpm check` DOES typecheck `.test.tsx`.** `tsconfig.json` excludes `"**/*.test.ts"`, and that
pattern does not match `.tsx`. A component test failed `pnpm check` with TS2802 at the ES5 target on
a spread of `map.keys()`. This contradicts the tsconfig's own header comment and a note several
lanes were relying on. Use `Array.from` in a `.test.tsx`, and stop telling lanes their test files are
invisible to that gate, because half of them are not.

**Run `tsconfig.tests.json` COLD.** The incremental cache lies, so a warm run can be green about
work it never re-checked.

### 27h — Your `node_modules` can be a major version behind, and NOTHING here tells you

**Live right now for any worktree that has not reinstalled since `d2a6d5b`.** Express 5 landed on
main that night. A tree still holding express 4 runs it against express-5 route patterns, and the
failure wears the costume of a routing bug in whatever branch you happen to be on. Measured in one
lane: express `4.22.2` installed against `pnpm-lock.yaml` on `5.2.1`, so `{*splat}` meant nothing to
express 4's path-to-regexp, a request fell through to the SPA fallback, and `GET /org/roles/nope`
answered `text/html` where the test wanted a non-HTML 404. `server/loop.e2e.test.ts` went 69/70.
After `pnpm install --frozen-lockfile` and a rebuild: 70/70, **with no code change at all**.

**Why no guard sees it.** `server/db/distFreshness.ts` compares SOURCES to the BUNDLE. It has no
opinion about whether `node_modules` matches the lockfile, so it correctly reports a current tree
while the runtime underneath is a major version behind. A real guard doing its real job, and this is
simply outside what it can see. A partially restored store after the junction incident in 27f
arrives at the same place and presents identically.

```
node -e 'console.log(require("express/package.json").version)'
git diff HEAD@{1} --name-only | grep pnpm-lock.yaml
```

**A GUARD SEES IT NOW, and the paragraph above is what it was written against.**
`server/db/installedDeps.ts` compares every runtime dependency's installed MAJOR against the one
`package.json` asks for, and names the package, both versions and the command at the top of any
test run in a drifted tree. It sits beside `assertFreshDist` in
`server/db/provisioningReport.ts`'s setup and it WARNS rather than throwing: a stale bundle makes a
green meaningless, a drifted install usually does not, and refusing to run anything would block work
that has nothing to do with the package. Both directions are proved against fixture trees in
`installedDeps.test.ts`, because a guard nobody has watched fire is a guard nobody should believe.

**Two corrections to the entry above, from a second encounter on 2026-09-05.**

The mechanism is one step worse than "no guard sees it": `scripts/build-server.mjs` builds with
`packages: "external"`, so express is not in `dist/index.js` at all. The bundle requires it from
`node_modules` at BOOT, which is why rebuilding changes nothing and why `assertFreshDist` is
correct to stay quiet. The runtime version is whatever is installed when the server starts.

And "a request fell through to the SPA fallback" is not quite what happens. Under express 4 the
SPA catch-all `app.get("/{*splat}")` matches NOTHING EITHER, because `{` and `}` are literal
characters to `path-to-regexp@0.1.12`. What answers is express's own built-in 404, which is
`text/html`, so it looks like the SPA fallback and is not. Measured against one unchanged
`dist/index.js`, install alone:

```
/profile                      404 -> 200
/some-page-that-never-existed 404 -> 200
/deep/path/that/never/existed 404 -> 200
/quests                       200 -> 200   (an express-4-valid pattern, so it never broke)
/quests/:id                   200 -> 200
```

**Every client route in the product was dead**, and the only test that noticed was one assertion in
`server/quest-share.e2e.test.ts` about a retired quest. That is the shape to remember: a whole-app
outage can present as a single obscure red, because the two routes with express-4-valid patterns go
on working and every test that uses them stays green.

**The rule that generalises past express: after pulling main, if the pull touched
`pnpm-lock.yaml`, reinstall before you trust a local RED.** This matters MORE under the
push-and-read-CI process in 27d, not less. CI installs from the lockfile on a clean machine, so when
CI is green and local is red, **CI is right and your tree is wrong**, and a lane that trusts the
local red will chase a defect that does not exist. One lane had already written "environmental" into
a pull request body as a conclusion while it was still a guess.

**The experiment that isolates it in one move, and it is the transferable part.** Run the failing
suite on `origin/main` IN YOUR OWN TREE. One lane ran main in another lane's tree and got green;
running main in its own tree reproduced the red. That single step ruled out both the diff and the
machine and left only tree state. Worth remembering because the instinct is to audit your own diff,
and the diff is the LEAST likely explanation once CI is green on it.

**One refinement to the per-file ratchet item in 27b, from a lane that hit both halves.** Look for
the destination directory's CONVENTION first and match it; waive only where the code genuinely must
do the thing the gate forbids. A `check-tailwind-gray` hit could be fixed by matching the
convention, while a `validate-module` case could only be waived, and reaching for the waiver first
turns a fixable violation into a permanent exception.
