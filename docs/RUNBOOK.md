# The runbook

For the person holding a village when it breaks, at the hour it breaks.

You do not need to be a programmer to use this. Every command here is one you
can copy. Where a step needs someone with database or Railway access, it says
so in the step, rather than leaving you to discover it halfway through.

Read the first section now, while nothing is wrong. It takes four minutes and
it is the part that saves the other forty.

---

## Contents

1. [The first three minutes](#the-first-three-minutes)
2. [Reading /health](#reading-health)
3. [What the symptom means](#what-the-symptom-means)
4. [Rolling back to the last version that worked](#rolling-back-to-the-last-version-that-worked)
5. [Restoring the database from a backup](#restoring-the-database-from-a-backup)
6. [Restoring the uploads volume](#restoring-the-uploads-volume)
7. [The backup is red](#the-backup-is-red)
8. [Turning on the uploads backup](#turning-on-the-uploads-backup)
9. [The two minute check, once a week](#the-two-minute-check-once-a-week)
10. [Who to call, and what to write down](#who-to-call-and-what-to-write-down)
11. [What this runbook has actually been tested against](#what-this-runbook-has-actually-been-tested-against)

---

## The first three minutes

Run these three, in order, before changing anything. They tell you which of
the four possible situations you are in, and every later section of this
document assumes you have their answers.

Replace `your-village.example` with your village's address.

**1. Is it up, and does it think it is well?**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://your-village.example/health
curl -s https://your-village.example/health
```

**2. What is the last thing that deployed?**

Railway, your project, the app service, the Deployments tab. Note the time of
the newest one and whether it says SUCCESS or CRASHED. If a deploy landed in
the hour before things broke, that deploy is your first suspect and section 4
is your next stop.

**3. Are the backups current?**

```bash
gh run list --workflow=db-backup.yml --limit 5
```

You want a recent `success`. If the newest runs say `failure`, read section 7
before you touch anything else, because it changes what you are allowed to
risk. A repair you can undo is a different decision from a repair you cannot.

**Write down the time and what you saw, right now**, before you start fixing.
Two hours in, nobody remembers whether the 502 came before or after the
restart, and that ordering is usually the whole answer.

---

## Reading /health

`/health` is the one honest answer the village gives about itself. It asks the
database a question it cannot bluff, and its HTTP status code is the answer a
machine reads.

A well village:

```json
{
  "status": "ok",
  "build": "2026-07-28-wave1-a1b2c3d",
  "timestamp": "2026-09-02T02:14:07.221Z",
  "database": { "ok": true, "ms": 11 },
  "uploads": { "files": 412, "mb": 730, "photoFiles": 118, "photoMb": 402 }
}
```

| Field | What it tells you |
|---|---|
| HTTP status | `200` the database answered. `503` it did not, or the village is in maintenance mode. Anything else, or no answer at all, means you are not reaching the app. |
| `status` | `ok`, `degraded` (the database did not answer), or `maintenance` (an update stopped partway through; see section 3). |
| `build` | Which version is actually running. The last seven characters are the git commit. This is how you tell whether a deploy you ordered actually took. |
| `database.ok` | `false` carries an `error` string naming the reason, for example `ECONNREFUSED` or a timeout. It never carries the connection string. |
| `uploads` | Files and megabytes on the volume, and how much of it is member photographs. **A missing `uploads` field means the volume is not mounted.** That is not counted as unhealthy, and it does mean uploaded images will 404 until it is back. |

Two things `/health` does not tell you. It does not know whether members can
log in, and it does not know whether the volume holds the right files, only
how many there are. For the first, try logging in. For the second, section 6.

---

## What the symptom means

### Nothing loads. No answer at all, or a Railway error page.

The app is not running or not reachable.

1. Railway, the app service, Deployments. If the newest one says CRASHED or
   FAILED, open its log and read the last twenty lines. The reason is almost
   always in them.
2. If the newest deploy is recent and the previous one was fine, **roll back
   first and diagnose afterwards** (section 4). Members waiting is a cost you
   are paying every minute; understanding is not urgent at 2am.
3. If nothing deployed recently, the database is the next suspect. Railway,
   the MySQL service, check it is running. `/health` returning 503 with a
   `database.error` confirms it.

### A page that says an update stopped partway through.

This is maintenance mode, and it is the village telling you the truth on
purpose. `/health` answers `503` with `"status": "maintenance"`.

Updates to the database run one change at a time, in order, and stop the
moment one fails. Nothing after the failed step ran. **Your data is safe** and
this is not a moment for a restore. The page names the file and the step
number that failed. Send that page, or a photograph of it, to whoever operates
your deployment. If the version before this update was working, rolling back
to it (section 4) restores service while the failed update is looked at.

### It loads, and everything a member does errors.

`/health` says `ok`, so the database is answering, and something above it is
wrong.

1. Check the `build` field. If it is not the version you expect, a deploy is
   mid-flight or a rollback did not take.
2. If a deploy landed in the last hour, roll back (section 4).
3. If not, Railway's app service log for the last ten minutes. Errors there
   name the surface that is failing.

### Photographs and uploaded images are missing, everything else works.

The volume is not mounted, or its contents are gone. `/health` with no
`uploads` field at all means not mounted: Railway, the app service, Settings,
Volumes, confirm the volume is attached at `/app/data`, then redeploy.

If the volume is mounted and the files are gone, section 6.

### The site is fine and you are here because of an alarm issue.

Section 7.

---

## Rolling back to the last version that worked

Rolling back is the cheapest move available and it is reversible. Reach for it
before anything clever.

**The fast way, one village, no tooling.** Railway, the app service,
Deployments, find the last deployment that says SUCCESS and that you believe
was well, and use its Redeploy action. Then confirm it actually took:

```bash
curl -s https://your-village.example/health
```

The `build` field's last seven characters must be the commit you meant to go
back to. A rollback you did not verify is a rollback you did not do.

**The fleet way, when more than one village is affected.** `ops/roll.mjs`
walks villages in ring order and halts the whole run at the first one that
does not come back healthy. Read `ops/README.md` first, then:

```bash
node ops/roll.mjs plan  --tag 1.1.0 --sha a1b2c3d
node ops/roll.mjs apply --tag 1.1.0 --sha a1b2c3d
```

`plan` changes nothing and only reads. `--sha` is the seven-character commit
the tag points at, and the roller checks the commit rather than the tag name,
because a tag can move.

To check one village on its own without redeploying anything:

```bash
node ops/roll.mjs check --url https://your-village.example/health --sha a1b2c3d
```

It ends in `GREEN` or `RED`, and `RED` names the reason.

**Which version to roll back to:** the heading above the current one in
`CHANGELOG.md`. `ops/RELEASES.md` explains the version tags and the three
channels.

**One thing a rollback cannot undo.** If the bad release included a database
migration that ran, going back to the old code leaves that change in place.
Migrations are written so the previous release can still run against them, and
that is a design rule rather than a guarantee about every possible case. If a
rollback leaves the old version failing at boot, stop and get someone with
database access before going further.

---

## Restoring the database from a backup

Do this when data is genuinely lost or corrupted. Do not do it because the site
is down; the site being down is almost never a data problem, and a restore
throws away everything members have done since the backup was taken.

**Before you start, know what you are giving up.** Backups run daily at 09:17
UTC. Restoring yesterday's backup discards every message, ballot, quest
completion and payment recorded since then. Say that sentence out loud before
step 1.

### 1. Find a backup you trust

```bash
gh run list --workflow=db-backup.yml --limit 10
```

Take the newest run that says `success`. A `success` here means more than a
file was produced: on every run the workflow restores its own dump into a
throwaway database and checks that every table restored exactly the rows the
dump carries, plus a timestamp that has to round-trip character for character,
and a separate job proves that check is able to fail by feeding it a
deliberately corrupted copy. A green run is a
backup that has been restored once already.

Note the run's id from that listing.

### 2. Download it

```bash
gh run download <run-id> -n db-backup-<run-id>
```

You get one file, `bundle.tar.gz.gpg`. It is encrypted and nothing on GitHub
can read it.

### 3. Decrypt it

This needs the private half of the backup key, the one generated offline and
held by the founder. It is not in this repository and it is not in GitHub. If
you cannot find it, stop here: there is no other way in, and that is the point
of it.

```bash
gpg --output bundle.tar.gz --decrypt bundle.tar.gz.gpg
tar xzf bundle.tar.gz          # gives dump.sql.gz and manifest.txt
cat manifest.txt               # live counts read just AFTER the dump, plus a probe
```

Read `manifest.txt` now. It is four row counts and one timestamp probe.

The probe is exact and you should check it. The four counts are not: they were
read from live production a few minutes after the dump finished, so a busy
village will have moved on by then and they are expected to sit a little above
what the dump holds. Treat them as a sense of scale, not as a target. What you
verify the restore against is the dump itself, in step 4.

### 4. Restore into a scratch database first

Not into the live one. Make an empty database, restore into that, and look at
it. Railway can create a second MySQL service in a few clicks, and you throw it
away afterwards.

```bash
gunzip -c dump.sql.gz | mysql --host=<scratch-host> --port=<scratch-port> \
  --protocol=TCP --user=<user> --password=<pass> <scratch-db>
```

Then check the restore against the dump. Not against `manifest.txt`, and not
against production: the dump is the thing you are restoring, so it is the only
comparison that can be exact.

```bash
zcat dump.sql.gz | grep -c '^INSERT INTO `users` '        # what the dump holds
mysql --host=<scratch-host> --port=<scratch-port> --protocol=TCP \
  --user=<user> --password=<pass> -N -B <scratch-db> \
  -e 'SELECT COUNT(*) FROM users;'                        # what came back
```

Those two must match exactly, for any table you care to check. If they do not,
this backup is not usable and you go back to step 1 with an older run.

Also check the probe line in `manifest.txt` against the scratch database:

```bash
mysql --host=<scratch-host> --port=<scratch-port> --protocol=TCP \
  --user=<user> --password=<pass> -N -B <scratch-db> \
  -e "SELECT CONCAT(id, '|', DATE_FORMAT(joined_at, '%Y-%m-%dT%H:%i:%s')) FROM users ORDER BY id LIMIT 1"
```

That one must match character for character. A difference of a whole number of
hours means the restore landed in a different time zone, which corrupts every
timestamp in the database while every row count still looks perfect.

### 5. Point the village at it, or restore over the live database

Two ways, and the first is safer.

**Safer:** change the app service's `DATABASE_URL` to the scratch database you
just verified, and redeploy. The village comes up on the restored data and the
old database is still sitting there untouched if you need anything out of it.

**Direct:** restore the dump over the live database with the same `gunzip |
mysql` command aimed at the live connection string. This overwrites. Take a
fresh dump of the live database first, even a broken one, because it is the
only copy of everything since the last backup.

### 6. Afterwards

Boot applies any pending migrations and the server checks the economy's own
invariants before it serves a request, so a restored database that is missing a
migration announces itself rather than serving quietly over a wrong schema.
Confirm with `/health` and by logging in.

Then write down what you restored, from which run, and what window of activity
was lost. Members will ask.

---

## Restoring the uploads volume

Uploads are member photographs, brand images and documents. They live on the
Railway volume mounted at `/app/data`, and the database holds only their names.

**Check first whether you have a backup at all.** Uploads backups began on
2026-09-02 and require two secrets to be set (section 8). If they were never
set, there is no archive and no restore, and section 8 is the only thing to do
here.

```bash
gh run list --workflow=db-backup.yml --limit 10
gh run download <run-id> -n uploads-backup-<run-id>
gpg --output uploads-bundle.tar.gz --decrypt uploads-bundle.tar.gz.gpg
tar xzf uploads-bundle.tar.gz        # gives uploads.tar and uploads-headers.txt
mkdir unpacked && tar xf uploads.tar -C unpacked
cat unpacked/MANIFEST.txt            # file count, bytes, and a canary hash
cat unpacked/EXPORT-STATUS.txt       # complete=yes is the line that matters
```

`complete=yes` is the proof the export reached the end. A tar that died partway
still unpacks without an obvious error, so that line is the difference between
a copy and most of a copy.

To put the files back: copy everything in `unpacked/` except `MANIFEST.txt` and
`EXPORT-STATUS.txt` into `/app/data/uploads/` on the volume. That needs a shell
on the running service (`railway ssh`), so it needs someone with Railway
access. Restoring the database and the volume from the same day keeps names and
files together.

---

## The backup is red

When a backup run fails, a GitHub issue titled **"Backups are failing"** opens
in this repository. It comments on every later failure and closes itself the
first time a run is fully green, so an open one always means a live problem.

The issue names which part failed. Here is what each part means and how urgent
it is.

| What failed | What it means | Urgency |
|---|---|---|
| **Database dump and encrypt** | No new backup was taken today. Yesterday's is still good, and it ages one day. | Fix this week. Two days in a row is a fix-today. |
| **Database restore drill** | A backup was taken and it does not restore faithfully. Treat today's as unusable and check whether older ones were green. | Fix today. |
| **Restore drill negative control** | The check that proves the drill can fail did not pass, so a green drill cannot be trusted either. | Fix today. Nothing else here means anything until it passes. |
| **Uploads export** | Photographs and documents were not backed up by this run. If it has never been green, they have never been backed up. See section 8. | Depends. Never green is section 8. Newly red is fix this week. |
| **Uploads restore drill** | An uploads archive was taken and it is not a faithful copy. | Fix today. |

Then open the run's log and read the failing step. The messages are written to
name the cause. The ones seen so far, and what each one is:

- **`Access denied for user 'root'@...` in the dump step.** The database
  password changed and `PROD_DATABASE_URL` did not. Nobody can fix this from
  the code: it needs the current Railway MySQL public-proxy connection string
  pasted into the repository's `PROD_DATABASE_URL` secret. Railway, the MySQL
  service, Variables or Connect, copy the public URL. GitHub, the repository,
  Settings, Secrets and variables, Actions, `PROD_DATABASE_URL`, Update. Then
  re-run the workflow and confirm it goes green. Seen once, 2026-08-30.

- **`Table 'restored.<name>' doesn't exist` in the fidelity step.** The drill
  checks four tables by name and one of them was renamed. Real, and it is a
  code change rather than an operations one. Seen once, 2026-08-31.

- **`Missing repository secret(s): BACKUP_EXPORT_ORIGIN BACKUP_EXPORT_TOKEN`.**
  The uploads backup has never been switched on. Section 8.

- **`Lost connection to MySQL server at 'reading initial communication
  packet'`.** This was the drill's own throwaway database failing to start, and
  it said nothing about the backup. It accounted for four red runs between
  2026-08-25 and 2026-09-02 and was fixed on 2026-09-02. If you see it again,
  re-run the workflow once, and if it repeats, it is the workflow's mysql
  service block rather than your backup.

**Re-running a failed run** is safe. It takes a fresh backup and drills it.

```bash
gh workflow run db-backup.yml --ref main
gh run list --workflow=db-backup.yml --limit 3
```

---

## Turning on the uploads backup

Do this once. Until it is done, member photographs have no copy anywhere, and
the daily backup run stays red and says so.

You need Railway access and GitHub repository settings access.

1. **Make a token.** Any random 64 hex characters.

   Mac, Linux, or Windows **Git Bash**, which ships `openssl` at
   `/mingw64/bin/openssl`:

   ```bash
   openssl rand -hex 32
   ```

   Windows **PowerShell** has no `openssl`, so use this instead:

   ```powershell
   $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider; $b = New-Object byte[] 32; $rng.GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
   ```

   Do NOT reach for the shorter `[RandomNumberGenerator]::Fill($b)` you will
   find in most examples. It does not exist in Windows PowerShell 5.1, and it
   does not fail loudly: the byte array stays as it was created, all zeros, and
   you get sixty-four `0` characters that look exactly like a token. Measured on
   this machine while writing this section. `RNGCryptoServiceProvider` above is
   the version that works there.

   Whichever you use, check what you got before pasting it: sixty-four
   characters, hex only, and obviously not all the same character.

   Keep the output somewhere you can paste it twice.

2. **Give it to the village.** Railway, your project, the app service,
   Variables, New Variable. Name `BACKUP_EXPORT_TOKEN`, value the string from
   step 1. Deploy the service so it picks it up.

3. **Give the same value to GitHub.** The repository, Settings, Secrets and
   variables, Actions, New repository secret. Name `BACKUP_EXPORT_TOKEN`, same
   value. It has to be the same string; the village compares them.

4. **Tell GitHub where the village is.** Another new repository secret, named
   `BACKUP_EXPORT_ORIGIN`, value your village's base address with no trailing
   slash, for example `https://amora.example.org`.

5. **Run it and watch it pass.**

   ```bash
   gh workflow run db-backup.yml --ref main
   gh run list --workflow=db-backup.yml --limit 3
   ```

   The `uploads-restore-drill` job prints the file count and byte total it
   checked. A village with no uploads yet reports zero files and passes; that
   is a young village rather than a broken export.

If step 5 fails with a 401, the two values in steps 2 and 3 are not identical.
If it fails with a 503, step 2 did not take, usually because the service was
not redeployed after the variable was added.

---

## The two minute check, once a week

Backups fail quietly by nature. The alarm issue in section 7 catches a run that
fails; this catches a schedule that stopped running at all, which produces no
failure and therefore no alarm.

```bash
gh run list --workflow=db-backup.yml --limit 7
curl -s https://your-village.example/health
```

Three things to look for:

1. **A run for each of the last seven days.** GitHub switches off scheduled
   workflows in a repository that has seen no activity for sixty days. A gap in
   the dates is that, and pushing any commit turns it back on.
2. **The recent ones say `success`.** One red among six greens is worth a
   re-run. Two in a row is section 7.
3. **`/health` returns 200 and the `uploads` numbers look like your village.**
   A count that dropped sharply is worth asking about while you still have
   thirty days of archives.

Once a quarter, do the thing this is all for: take the newest backup, restore
it into a scratch database, and log in against it. Sections 5.1 to 5.4, then
throw the scratch database away. The workflow proves the bytes restore. Only
you can prove the village comes back.

---

## Who to call, and what to write down

**Fill these in now, before you need them.** A runbook with a blank phone
number is a runbook that fails at the moment it is read.

| Role | Who | How to reach them | Awake when |
|---|---|---|---|
| Village steward | | | |
| Platform team | | | |
| Whoever holds the backup private key | | | |
| Railway account holder | | | |

Every village's steward and contact also belongs in your own fleet manifest,
one entry per village. `ops/fleet.json.example` shows the shape, and
`ops/README.md` says where to put your real copy.

**What to write down, during and not after:**

- The time you first saw the problem, and how you saw it.
- What `/health` said, pasted whole.
- The `build` value, so anybody can tell which version was running.
- Every change you made, in order, including the ones that did nothing.
- What you restored, from which run, and what window of member activity was
  lost.

Keep it with the village's own records. The next person who asks whether this
has happened before should not have to reconstruct the answer from memory.

---

## What this runbook has actually been tested against

A procedure nobody has walked is a draft. This section says which parts have
been exercised and which have not, so you know when you are on rehearsed ground
and when you are the first person here.

**Measured, 2026-09-02:**

- Backup run history read from the live repository. Six of the fifteen runs
  between 2026-08-21 and 2026-09-02 were red, and the failures fall into the
  four causes listed in section 7.
- The database restore drill runs on every backup and restores the dump into a
  throwaway MySQL, so the path in section 5.4 is exercised daily by machine.
  Its negative control proves the check can go red.
- The uploads drill in section 6 was run against archives built by the server's
  own export writer. It passed a faithful archive and a village with no uploads
  at all, and refused a truncated stream, a same-length byte flip in a file, a
  manifest admitting an excluded file, a status reporting a degraded file,
  headers disagreeing with the manifest inside the bundle, and an archive
  missing one file.

**Not yet walked by a person, and therefore the parts to be slowest and most
careful in:**

- Section 5.5, pointing a live village at a restored database. The steps are
  right and no one has done them under pressure.
- Section 6's copy back onto the Railway volume. `railway ssh` has been used by
  hand for a volume pull once; putting files back has not been rehearsed.
- Section 4's fleet rollback across more than one village. `ops/roll.mjs` has
  been rehearsed against local servers standing in for villages, and not
  against real ones.

If you walk one of these for real, add what actually happened underneath it.
