# Start here: run your own village on Village OS

Village OS is free and open source software for running a village: a land
project, a co-op, a community of any size. Members take on quests, thank each
other, decide things together, and can see who holds which power. You host it
yourself, choose your settings and modules, and you may change any part of the
code.

**What it costs.** The software is free (MIT licence). You pay your own
hosting provider, if you use one. Setting it up needs a computer.

**What you need.**

- A computer with Windows, macOS or Linux, where you can install programs.
- About an hour for the first run, most of it waiting for downloads.
- For a village other people use: a domain name, and an account with an email
  sender (Resend) so the village can send password resets and notices.
- The software speaks English today.

**Doing this with an AI assistant?** Give it
[`docs/FOUNDER_SETUP_PROMPT.md`](docs/FOUNDER_SETUP_PROMPT.md). It will explain
each step and run a command only after you say yes. The assistant's own rules
are in [`AGENTS.md`](AGENTS.md).

There are two ways to run it. Part A puts everything on one computer with
Docker: your laptop to try it, or a small server you rent. Part B uses a
hosting provider such as Railway. Both run the same software.

---

## Part A: one computer, with Docker

### 1. Install two things

- **Docker.** Docker Desktop on Windows or macOS
  (<https://www.docker.com/products/docker-desktop/>), Docker Engine on Linux.
  Start it, then check in a terminal: `docker version` prints a client and a
  server.
- **Node.js 22 or newer** (<https://nodejs.org>). It runs one setup script.
  Check: `node -v`.

### 2. Get the files

Either download `village-os-starter-<version>.zip` from the latest release at
<https://github.com/Rieki777/village-os/releases> and unzip it, or clone the
whole repository if you mean to change the code:

```
git clone https://github.com/Rieki777/village-os.git
```

Open a terminal in that folder. Never start from a copy of somebody else's
village folder: it holds their secrets and their members' data.

### 3. Write your settings

```
node scripts/fork-init.mjs --compose --village-name "Your Village" --admin-email you@example.org
```

This writes a file called `.env` with every secret generated for you, and
lists what it could not fill in (email, mostly). It does not show you the
founder password on screen. Open `.env` in a text editor when you need it and
find the line `ADMIN_PASSWORD=`. Keep `.env` private: anybody holding it holds
your village.

### 4. Start the village

```
docker compose up -d
docker compose logs -f app
```

The first start downloads the software and builds the database, and takes a
few minutes. Wait for a line saying the server is listening, then press
Ctrl+C to stop watching (the village keeps running). Check it at
<http://localhost:3000/health>: it should say `"status":"ok"`.

### 5. Claim it

Open <http://localhost:3000/claim>. Enter your email, your name, and the
`ADMIN_PASSWORD` from `.env`. The page gives you a link to set your own
password; open it and choose one. You are now the village's founder, and the
shared password stops working for everybody but you.

### 6. Make it yours

Sign in and open **Admin, Make This Yours**: the name, the line under it,
where you are, your pictures, your colours, your modules. Then open the
**Launch Plan** (`/journey-to-launch`). It lists what is still missing,
including two things that ship blank on purpose: the currency your prices are
in, and the timezone your days start in.

A new village starts with a plain welcome page and none of the first
village's own story pages. Neutral starting text for your legal and membership
wording, with places for your name, legal entity, data controller and contact,
is in `server/seeds/templates/` in the full repository.

### 7. Put it on the internet (a rented server)

Skip this on a laptop. On a server you rent, point your domain at it, then put
a web server with HTTPS in front of the village. Caddy is the shortest:

```
caddy reverse-proxy --from village.example.org --to localhost:3000
```

Set `FRONTEND_URL=https://village.example.org` in `.env`, then run
`docker compose up -d` again so the village reads it.

### 8. Email

Create an account at <https://resend.com>, verify your domain there (it shows
you the DNS records to add), then set `RESEND_API_KEY` and
`EMAIL_FROM=Your Village <hello@your-domain>` in `.env` and run
`docker compose up -d`. Resend answers "success" for a domain you have not
verified and delivers nothing, so wait until Resend marks the domain verified.

### 9. Invite people

Members join by invitation. Open your profile and make an invitation link for
each person: one use each, valid for fourteen days. Somebody without a link
can ask to join at `/request-membership`, and the request lands in your Admin.

---

## Part B: a hosting provider (Railway)

1. Create a project with three things: a MySQL service, a service that runs
   the image `ghcr.io/rieki777/village-os:1.2.0`, and a volume on that service
   mounted at `/app/data`.
2. On your own computer, get the files (step 2 above) and run
   `node scripts/fork-init.mjs --village-name "Your Village" --admin-email you@example.org --domain village.example.org`.
3. Copy each value from `.env` into the service's Variables, by hand. Set
   `DATABASE_URL` to the MySQL service's own connection string.
4. Deploy. The first boot builds the database; give it up to fifteen minutes
   before you worry. Then continue from step 5 above, at your own address.

[`docs/PROVISIONING.md`](docs/PROVISIONING.md) walks the hosted path in
detail, including custom domains, payments and the health check.

---

## Backups

**Until a copy of your village exists somewhere other than the computer it
runs on, one broken disk ends it.** A backup is two things: the database, and
the folder of uploaded photographs and documents.

On one computer with Docker, from the village's folder (in a Bash shell: on
Windows, Git Bash or WSL):

```
mkdir -p backups
docker compose exec -T db sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --no-tablespaces village' | gzip > backups/village-$(date +%F).sql.gz
docker run --rm -v village-os_village-data:/data:ro -v "$PWD/backups":/backup alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Copy the `backups` folder somewhere else: another disk, another machine, a
storage service. Do it on a schedule (cron, Task Scheduler), and keep more
than one day.

To restore into a fresh install, start only the database, load both files,
then start the village:

```
docker compose up -d db
gunzip -c backups/village-DATE.sql.gz | docker compose exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" village'
docker compose create app
docker run --rm -v village-os_village-data:/data -v "$PWD/backups":/backup alpine tar xzf /backup/uploads-DATE.tar.gz -C /data
docker compose up -d
```

These exact commands are run, and the restored village signed into, on every
change to the self-host path (`.github/workflows/selfhost-smoke.yml`).

On a hosting provider, use its own database backups and volume snapshots, and
download a copy now and then. `docs/RUNBOOK.md` covers an encrypted nightly
backup with a restore drill, run from a **private** GitHub repository. Never
run it from a public one: anybody can download a public repository's workflow
artifacts and read its logs.

## Upgrading

A new version is a new image tag. Read [`docs/UPGRADING.md`](docs/UPGRADING.md)
first, take a backup, then change `VILLAGE_OS_IMAGE` in `.env` (or the image
on your hosting provider) to the new version and run
`docker compose pull && docker compose up -d`. The village applies its own
database changes as it starts.

## Modules, and changing the code

Every village ships with the same modules, and you choose which are on
([`docs/MODULES.md`](docs/MODULES.md) lists them). To add
something new, either offer it to the shared Module Library by pull request,
where it is reviewed and can reach every village
([`docs/modules/START_HERE.md`](docs/modules/START_HERE.md)), or keep it in a
private fork of your own. A private fork is yours to change; the further it
drifts, the harder each upgrade is to merge.

## Help

- Questions and bugs: <https://github.com/Rieki777/village-os/issues>. Say
  what you did and what you saw, never a password or a key.
- About the project: <https://regencivics.earth/village-os>.
- A security problem: [`SECURITY.md`](SECURITY.md), privately, never in a
  public issue.
