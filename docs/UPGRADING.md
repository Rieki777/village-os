# Upgrading your village

For the person who runs a village and does not write software. It covers how
to find out an upgrade exists, what to save before you take it, what happens
while it installs, and how to put the old version back if it goes wrong.

`CHANGELOG.md` says what is in each release. `ops/RELEASES.md` says how the
version numbers and channels work. This file is the procedure.

---

## The one thing to understand before you start

**Starting a new image changes your database.**

The village keeps its information in a database, and each release sometimes
needs that database shaped a little differently: a new column to hold
something the release added. The village makes those changes itself, on the
way up, before it starts answering anyone. There is no separate step, no
button, and nothing asks you to approve it. The moment the new version starts,
your database is on the new shape.

Two things follow, and they are the reason this document exists.

1. **Take a backup first.** Every time. Even for a release the changelog calls
   small.
2. **If the shape change cannot finish, the village does not start.** It stops
   at the first statement that failed and it stops completely, rather than
   running half-changed and quietly corrupting things. You get a plain page
   explaining that, which is covered under [If it does not come
   back](#if-it-does-not-come-back).

Putting the previous version back is supported and is covered under [Going
back](#going-back). Read that section before you need it, because it has one
real limit.

---

## Step 1. Find out what you are running

Ask your own village. This works from any machine and needs no account:

```
curl https://your-village.example/health
```

```json
{ "status": "ok", "build": "2026-07-28-wave1-6de6629", "database": { "ok": true } }
```

The last seven characters of `build` are the exact version of the software
that is running right now. Write it down. You will want it if you have to go
back.

## Step 2. Find out what has been published

Nothing tells you when a release comes out. There is no email, no banner in
the village, and no notification. You have to look. **Put a reminder in your
calendar to run this once a month**, and read `docs/SECURITY_ADVISORIES.md`
whenever you are told something urgent has been posted.

This lists every version ever published. It needs no account, no login, and no
Docker:

```sh
TOKEN=$(curl -s "https://ghcr.io/token?scope=repository:regen-civics/village-os:pull&service=ghcr.io" \
  | sed -E 's/.*"token":"([^"]+)".*/\1/')

curl -s "https://ghcr.io/v2/regen-civics/village-os/tags/list" -H "Authorization: Bearer $TOKEN" \
  | tr ',' '\n' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -V
```

Run on 2026-09-02 that printed one line, `1.1.0`, which was the only release
published at that point. The last line is the newest release. If it is higher
than the version you are running, there is an upgrade waiting.

## Step 3. Read what changed

Open `CHANGELOG.md` and read every entry between your version and the one you
are moving to. Each entry carries three lines written for you:

- **What changed for your village.** In plain words.
- **What you must do.** Usually nothing. Sometimes a setting you have to add.
- **Does it touch your data.** Whether the release changes the shape of your
  database on the way up.

If **What you must do** says anything at all, do that thing before you start
the upgrade, not after.

## Step 4. Take the backup

Two things need saving, and they live in different places. On one computer
with `docker-compose.yml`, the two commands under "Backups" in `START_HERE.md`
save both, and that section has the restore. On a hosting provider, use its
own database backups and volume snapshots. Otherwise:

**The database.** Everything members wrote: people, roles, messages, quests,
balances, votes.

```sh
mysqldump --single-transaction --routines --triggers \
  -h your-database-host -u your-user -p your-database-name \
  > village-backup-$(date +%Y%m%d-%H%M).sql
```

`--single-transaction` lets it run while the village is still up, without
locking anyone out.

**The uploaded files.** Photographs and documents members added. These are not
in the database. They are in the folder you mounted at `/app/data` when you
started the container:

```sh
docker run --rm -v village-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/village-uploads-$(date +%Y%m%d-%H%M).tar.gz -C /data .
```

Check that both files exist and are not empty before you go on. A backup you
have not looked at is not a backup.

> Villages that ReGen Civics hosts are backed up automatically every day, and
> the backup is restored into a scratch database on every run to prove it
> works. You still want your own copy before an upgrade you chose to take.

## Step 5. Start the new version

Name the exact version number. Do not use `:stable` for the upgrade itself,
because `:stable` moves and you want to know precisely what you installed.
Never use `:edge`: it is the untested tip of `main`.

**The image moved with 1.2.1.** From 1.2.1 it is `ghcr.io/regen-civics/village-os`.
1.2.0 and older stay where they were, at `ghcr.io/rieki777/village-os`, and keep
working, so going back to one of them names that older address.

**On one computer with `docker-compose.yml`** (`START_HERE.md`, part A),
change `VILLAGE_OS_IMAGE` in `.env` to the new version, for example
`ghcr.io/regen-civics/village-os:1.2.1`, then:

```sh
docker compose pull
docker compose up -d
```

Every setting stays in `.env`, so there is nothing to carry over. Never add
`-v` to `docker compose down`: it deletes the database and every upload.

**On a hosting provider**, change the image tag on the app service to the new
version and redeploy. Its variables stay where they are.

**With `docker run`**, keep the village's settings in an env file and hand it
over again:

```sh
docker pull ghcr.io/regen-civics/village-os:1.2.1

docker stop village
docker rm village

docker run -d --name village -p 3000:3000 \
  --env-file .env \
  -v village-data:/app/data \
  ghcr.io/regen-civics/village-os:1.2.1
```

**Carry over EVERY environment variable your village already had.** Only
`DATABASE_URL` is needed for the server to start, so a village started with
too few starts cleanly and answers `/health` with `ok`, and then:

- without the same `AUTH_TOKEN_SECRET`, every member is signed out,
- without `VILLAGE_SECRETS_KEY`, every integration secret your village sealed
  can no longer be decrypted,
- without `ADMIN_PASSWORD` and `BREAK_GLASS_ADMIN_EMAIL`, a founder who is
  locked out has no way back in,
- without `FRONTEND_URL`, `EMAIL_FROM`, `RESEND_API_KEY` and the rest, links
  and email go quiet.

None of that reports an error naming the cause. If your container was started
with `-e` flags instead of an env file, copy its full environment before you
destroy it:

```sh
docker inspect village --format '{{range .Config.Env}}{{println .}}{{end}}' > village-env.txt
```

Then pass that file back to `docker run` with `--env-file village-env.txt`.
`.env.example` explains what each variable is for.

`docker stop` asks the village to finish what it is doing and waits for it, so
requests already in flight complete rather than being cut off.

Villages that ReGen Civics hosts are moved by the platform team with
`ops/roll.mjs`, which rolls one ring at a time and halts at the first village
that does not come back healthy. You do not run the commands above.

## Step 6. Watch it come up

```sh
docker logs -f village
```

(With `docker-compose.yml`: `docker compose logs -f app`.)

It applies the database changes before it starts answering anyone, so there is
a gap where the village is not reachable. For an upgrade this is usually
seconds to a couple of minutes, because it only applies the changes that are
new since your version. A first install onto an empty database is much slower:
that was measured at 228 seconds.

When it is up:

```
curl https://your-village.example/health
```

`"status": "ok"` and a `build` value ending in the new version means the
upgrade landed. Open the village in a browser and click into two or three
pages before you call it done.

---

## If it does not come back

The village shows a plain page saying an update could not finish, with the
technical detail on it. That page is the software working correctly. It means
the shape change stopped at the first statement that failed and **nothing
after that point ran**.

1. Copy the whole of `docker logs village`. Send it to whoever supports your
   village. It names the exact file and statement that failed.
2. Decide whether to wait for a fix or to go back. If the village needs to be
   up now, go back.

---

## Going back

Put the previous version back by starting the previous image. That is the
whole operation. With `docker-compose.yml`, set `VILLAGE_OS_IMAGE` in `.env`
back to the version you were running before and run `docker compose up -d`.
On a hosting provider, set the image tag back. With `docker run`:

```sh
docker stop village && docker rm village

docker run -d --name village -p 3000:3000 \
  --env-file .env \
  -v village-data:/app/data \
  ghcr.io/rieki777/village-os:1.1.0
```

**Carry over every environment variable here too**, exactly as in step 5. Going
back with too few loses the same settings as going forward with too few, and
it loses them at the worst moment, when you are already recovering from
something. Use the same env file you started the upgrade with.

**You do not restore the database to go back.** The old version is built to
keep working over the newer database shape.

### Why that works

Releases are only allowed to **add** to the database. A release may add a
table or add a column. A release may not delete a column, delete a table,
narrow a column so it holds less, or make an optional field required. When
something genuinely has to be removed, it takes two releases: the first stops
using it and leaves it in place, and the second, once the first is proven,
removes it.

That rule is checked automatically before a change is allowed in, by
`scripts/check-migration-compat.mjs`. Its purpose is exactly this moment. The
previous version can still read and write a database that a newer release has
added to, so going back is a restart rather than a recovery.

### The limit, stated plainly

**Going back returns the software. It does not return the data.**

Anything members wrote while the new version was running stays written. If the
new version recorded something in a new column, the old version does not know
that column exists and will ignore it. The information is still there, and the
old version cannot show it to you.

A small number of releases change existing information rather than only adding
to it, for example correcting a setting that was wrong. Going back does not
undo that correction. Any release that does this says so in `CHANGELOG.md`
under **Does it touch your data**, and that is the sentence to read twice
before upgrading.

If you need the data exactly as it was, restore the backup you took in Step 4.
That loses everything members did after the backup, so it is the last resort
and not the normal way back.

### Say something

Tell whoever supports the village that you rolled back, which version you
returned to, and what you saw. A rollback nobody hears about is a bug that
stays shipped.

---

## Skipping versions

Move one release at a time where you can, and check the village is healthy
between each. Going straight from an old version to a much newer one applies
every accumulated change in one go, which is a jump nobody has rehearsed.

If you have been holding still for a long time, read every changelog entry in
between first, and take the backup with particular care.

---

## Quick reference

| Question | Answer |
|---|---|
| What am I running? | `curl https://your-village.example/health` |
| What is published? | The command in Step 2 |
| What changed? | `CHANGELOG.md` |
| Does upgrading change my database? | Yes. Every time. It happens on start, by itself. |
| Do I need a backup? | Yes. Every time. Step 4. |
| How long is the village down? | Seconds to a couple of minutes for an upgrade. |
| It will not start. | You get a maintenance page. Keep the logs, then go back. |
| How do I go back? | Start the previous image. No database restore. |
| Will going back lose data? | No. Data written by the newer version stays, and the older version cannot display it. |
| Where do urgent notices go? | `docs/SECURITY_ADVISORIES.md` |
