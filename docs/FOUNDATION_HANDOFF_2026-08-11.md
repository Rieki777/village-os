# Foundation lane handoff

**Everything below is live on `main`.** This document is for whoever finishes the
rest. Read it before touching the economy, and read
`docs/FOUNDATION_STUDY_NOTES.md` if you want the reasoning behind the shape.

---

## 1 · The naming, settled

| what a member reads | slug | what it is |
|---|---|---|
| **Gratitude** | `gratitude` | The recognition system AND its token. Given, never paid, never spent. |
| Stay credits | `stay-credit` | Spendable on a real night. |
| Library credits | `library-credit` | Spendable, backed by shelves. |
| the voice token | `village-voice` | Earned from confirmed contribution only. Accrues here, settles on Hypha. |
| **Amora** | `amora` | EQUITY. Hypha-governed, on Base. This platform is forbidden from minting or moving it. |

**"Hearts" is retired.** It was an earlier working name for Gratitude. If you
find it in user-facing copy it is a leftover, not a second concept, and the fix
is to write Gratitude. The exported constant is still called `HEARTS` because
renaming a symbol touches every call site for no behavioural gain, and the
string it holds was always `"gratitude"`.

One exception that is NOT a leftover: the heart you tap on a feed post. That is
a different gesture with its own variable (`feed.max_hearts_per_recipient_per_cycle`)
and it keeps its name.

**Open question for Rye, not decided:** "Amora Credits" was mentioned as the
name you went with. It is not clear to me whether that names the stay/library
credits, or replaces the voice token's name, or is a new thing. Nothing has been
renamed on that basis. `tokens`.`name` is village data, so it is one admin edit
once you say which.

---

## 2 · What is built, live, and proven

**Migrations 0069-0072 and 0075.** Applied in real order against populated
tables, no seeded row lost. `0075` is the pending-change columns on `mint_rules`.

**The engine, `server/lib/economy.ts`.** One guarded write path. Every mint,
refund and claim ends in `postTransfer`, because `token_ledger` is already
double-entry with conservation re-proven at every boot and a second ledger would
sit outside that.

**Characters.** Five classes, thirty portraits, `/profile/characters`, the party,
the one-primary invariant as a single column.

**The profile.** `/profile` with the character as hero, `/profile/:handle` with a
privacy layer built by ADDING what flags permit rather than deleting.

**The Mint.** `/admin/mint`, the admin API, and two public feeds.

**Tests.** 34 in `server/economy.test.ts`, 10 in `characters.test.ts`, 11 in
`profile.test.ts`. Every case was a live exploit in review.

---

## 3 · What is NOT built, and exactly why

### 3a. The voice claim bridge — mostly built now

**This section is superseded by `docs/HYPHA_VOICE_CLAIM_HANDOFF.md`,** which is
current. Steps 1, 3 and 5 below are built and tested; the secret is set; the
three numbers are decided and live as dials in Admin → The Mint. What remains is
the DHO slug, and steps 2 and 4, which cannot be written until a real space
exists to send an intent to.

The original text is kept below because the reasoning in it still holds.

### 3a-old. The voice claim bridge — BLOCKED on a secret

`0072` ships the schema and the guards. Voice accrues correctly today. It cannot
leave, and the chip says "accruing" rather than offering a button that fails.

**Rye must produce three things.**

Generating the value on this machine, with the two wrong answers recorded so
nobody repeats them. `openssl` is not on PATH on Windows. `[Convert]::ToHexString`
needs PowerShell 7 and this is 5.1. And `Get-Random` is NOT cryptographically
secure, so it is the wrong tool for a secret even where it runs.

Either of these works here and both are cryptographically secure. Tested:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```powershell
$b = New-Object byte[] 32
([System.Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($b)
($b | ForEach-Object { '{0:x2}' -f $_ }) -join ''
```

Generate it in a terminal, paste it straight into Railway, and do not paste it
into a chat: anything that reaches a transcript is burned and has to be
regenerated.

1. That value as `HYPHA_VOICE_WEBHOOK_SECRET` on Railway. **It must not be
   `governance_hub_secret`.** That one verifies a callback that moves a
   *variable*; this one verifies a callback that confirms a member's claim on
   *value*. Anything able to sign the first would otherwise confirm the second.
2. The Hypha DHO slug, with confirmation Rye controls it. It goes in an
   **allowlist**, not a free-text field, because a space is a destination for
   value.
3. Three numbers: claim threshold (suggest **1.0**, about ten confirmed quests),
   Claims Week dates, and the voice token's real display name.

**Then build, in this order, each provable before the next:**

1. `requestVoiceClaim` — debit under lock, one open claim per member, refuse
   below threshold and outside Claims Week. Testable with no Hypha at all.
   `canSettleClaim` and `claimRefunds` already exist and are tested.
2. The bridge raises exactly ONE intent per claim, idempotent on `intent_key`,
   so a retried dispatch reuses the existing proposal.
3. The HMAC receiver: signature over the **raw** body, mounted before
   `express.json()` the way the Stripe webhook is; fail closed on a missing
   secret; replays no-op; **village, token and amount read from the stored claim
   row and never from the payload.**
4. The poller, so a dropped webhook cannot strand somebody's voice.
5. A boot assertion that refuses to start if the secret is empty or equals a
   known platform constant.

### 3b. Smaller, unblocked

- **Inventory on the profile.** `GET /api/me/profile` does not carry borrowed
  items, booked stays or reserved lots. Deliberately absent rather than an empty
  box, which tells a member they have nothing rather than that nobody asked.
- **The Moon Ledger recap card.** Needs settlement history, which exists after
  the first real close.
- **Co-signed manual grants.** Specified in the build doc, not built. Grants over
  100 or any self-grant need a second steward.
- **The Mint's token-type editor.** The rules table is built; adding or renaming
  a token from the panel is not.

---

## 4 · The one open product decision

**Two paths write `gratitude_log` with different caps, and both are live.**

| route | allowance | per-recipient cap counts |
|---|---|---|
| `/api/game/gratitude/send` | 100, scaled by stage | SENDS, default 1 |
| `/api/gratitude` | 30 flat | GRATITUDE, default 10 |

They sum into the same table, so the new route already counts what the old one
spent, which makes it the stricter of the two and the safe direction for an
overlap. It is still an overlap, and a member will meet two different refusal
messages for what looks like the same action. **Retiring one is Rye's call.**

---

## 5 · Traps this lane hit, so you do not

**A tool's blind spot announces itself as a RESULT, not as a blind spot.** Seven
instances in one session, every one silent rather than an error:

- `vitest` exited 0 with `1 failed` in the log
- `npx tsc … | head` returned *head's* status, so a red read as green
- `pnpm audit … | tail` likewise
- `pnpm install --frozen-lockfile` exited 0 over a **dangling symlink** in
  `.pnpm`; the suite died forty minutes later. `pnpm install --force` repairs it
- a contrast checker parsed only `rgb()`, so `oklch()` returned null and was
  skipped, reporting **0 failures on a page whose heading was at 1.00:1**
- the same checker could not see `background-image`, so readable white-on-gradient
  read as failing
- and could not flatten alpha, so text on `bg-teal-deep/5` read as text on opaque
  teal

**Run bare, read `$?` immediately, and read the log. Where they disagree, the log
wins.**

**Migration numbers are held three ways and each is invisible to the other two.**
Remote refs (a fetch sees these), local refs on other worktrees (only
`git for-each-ref refs/heads`), and untracked files on disk (only `ls`). I
renumbered twice. Sweep all three:

```bash
git fetch origin
for r in $(git for-each-ref --format='%(refname)' refs/heads/ refs/remotes/origin/); do
  git ls-tree --name-only "$r" drizzle/ 2>/dev/null | grep -oE '00[0-9]{2}' | tr '\n' ' '
done
ls <workspace>/*/drizzle/*.sql
```

**An amend or rebase moves the SHA**, so a build marker stamped before it
describes a commit that no longer exists. Rebuild and read the marker back out of
`dist/index.js`.

**`TaskStop` kills the wrapper, not the suite.** Find survivors by command line
and kill them, or the next lane's "hang" is three suites sharing one MySQL.

**A stale comment is not neutral.** `--color-gold` claimed "6.2:1 vs white" and
measures 4.55. I trusted it, moved two headings to gold, and shipped a regression
from the 4.30 they had. The token comments now carry measured numbers for both
surfaces. **Compute the ratio from the hex rather than reading a comment.**

**Text on the page background is measured against `#f2f2f2`, never white**, and a
tint set on an element is the backdrop for the text on that element.

---

## 6 · How to verify anything here

```bash
pnpm install --frozen-lockfile
pnpm check
node scripts/check-brand-refs.mjs
node scripts/check-voice.mjs
node scripts/check-auth-fetch.mjs
node scripts/check-artifact-budget.mjs
pnpm build
pnpm test
pnpm audit --prod --audit-level high
```

Ten gates. `pnpm build` before any e2e suite, every time: they boot the built
`dist/index.js`.

For a migration touching populated tables:

```bash
node scripts/verify-migration-on-data.mjs <first-new-prefix>
```

**Nothing in this lane was browser-verified by its author.** Every claim is
static gates, tests, and the QA lane's measurements. `/admin/mint` in particular
has never been rendered by anyone.
