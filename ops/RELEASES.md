# Releases, channels, and pinning a version

One release is one container image. It is built once, started and checked
before it is published, and then never changed. Two villages running the same
version are running the same software, byte for byte.

**Which version is current: the newest heading in `CHANGELOG.md`.** That file
is the record of what each release contains, written for stewards. This file
is about how to get a release and how to stay on one.

## The image

```
ghcr.io/rieki777/village-os
```

The package is **public by ruling**. A village that leaves the fleet keeps its
source, its images, and its security advisories, and loses only the guarantee
that someone else is watching. A private package plus per-village access
tokens would turn "you may leave" into "you may leave and be stranded", and
would add token rotation for thirteen villages with nothing gained.

The image bakes in no secrets. Every secret arrives as an environment
variable at run time, which is what makes publishing it safe.

The repository, `github.com/Rieki777/village-os`, is public too, under the
MIT licence. Nobody needs an account, an access token or access to the
repository to pull and run a release.

### History: the one human step, done once

A package created by CI inherits the visibility of the repository that
published it, and when 1.1.0 was first published the repository was private,
so that publish created a private package (measured 2026-08-31: HTTP 401 for
an anonymous pull). There is no API for changing that: `PATCH
user/packages/container/village-os` answers 404, and the packages REST API
offers list, get, delete and restore only. It was a web page, and only the
account holder could use it:

> `https://github.com/users/Rieki777/packages/container/village-os/settings`
> then Danger Zone, Change visibility, Public.

Every later release publishes into the package that already exists and keeps
its visibility. To check it from any machine, with no account and no Docker:

```
curl -s "https://ghcr.io/token?scope=repository:rieki777/village-os:pull&service=ghcr.io"
```

A JSON body carrying a `token` means the package is public and a stranger can
pull it. `{"errors":[{"code":"UNAUTHORIZED"...}]}` with HTTP 401 would mean it
had gone private again.

## The three channels

| Tag | What it points at | Who should use it |
|---|---|---|
| `:1.2.0` and every other `:<version>` | One exact release, forever | Every village. Pin one |
| `:stable` | The newest full release | Trying the current release without naming it. A village pins a version instead |
| `:edge` | The newest commit on `main` that passed the full test suite | The platform team. Never a village. |

A prerelease (`:1.2.0-rc1`) publishes its own version tag and does not move
`:stable`.

## Running a release, if you host your own village

You need Docker, and Node 22 for the one setup script. No account anywhere.

**On one machine, the shortest path is `docker-compose.yml`**, which runs the
app, MySQL 8.4 and a volume at `/app/data` together, pinned to `1.2.0`:

```
node scripts/fork-init.mjs --compose --village-name "Your Village" --admin-email you@example.org
docker compose up -d
```

`START_HERE.md`, part A, walks through it, including backups.

**With your own MySQL database**, write `.env` without `--compose`, set
`DATABASE_URL` in it to your database, and hand the whole file to the
container:

```
node scripts/fork-init.mjs --village-name "Your Village" --admin-email you@example.org
docker pull ghcr.io/rieki777/village-os:1.2.0

docker run -d --name village -p 3000:3000 \
  --env-file .env \
  -v village-data:/app/data \
  ghcr.io/rieki777/village-os:1.2.0
```

`DATABASE_URL` is the only variable the server refuses to start without. It
applies every pending migration itself on the way up, so an empty database is
a fine starting point and there is no migrate step. A usable village also
needs `AUTH_TOKEN_SECRET` (without it every restart logs everyone out),
`ADMIN_PASSWORD` (which `/claim` asks for) and `FRONTEND_URL`; `fork-init`
writes all of them, and every other secret, into `.env` without printing
them. `.env.example` explains every variable. The volume is where uploaded
files live, and without it they disappear with the container.

The first start is slow, because it runs every migration before it begins
serving. Measured against an empty database on a cold server: 228 seconds.
Give it fifteen minutes before deciding something is wrong, and read
`docker logs village` while you wait. Then open `<address>/claim` and claim
the village with the `ADMIN_PASSWORD` from `.env`.

On a hosting provider such as Railway, `docs/PROVISIONING.md` is the full
walkthrough, including the domain, email, and the parts only you can do.

## Asking a village what it is running

```
curl https://your-village.example/health
```

```json
{ "status": "ok", "build": "2026-07-28-wave1-6de6629", "database": { "ok": true } }
```

The last seven characters of `build` are the exact commit inside the release.
`ops/roll.mjs` compares that value and nothing else, because a tag can be
moved and a commit cannot.

## Pinning: how a village holds still

Pinning means staying on a version while other villages move on. There are
two ways, depending on who runs the village.

### A village ReGen Civics hosts

Add a `pin` block to that village's entry in `ops/fleet.json`:

```json
"pin": {
  "version": "1.1.0",
  "reason": "why, in a sentence the steward would recognise",
  "pinnedAt": "2026-08-31T00:00:00Z",
  "expiresAt": "2026-09-20T00:00:00Z"
}
```

A pinned village is skipped by every rollout, never touched, and never
counted as a failure. Pins have a maximum length (`maxPinDays`, 30 by
default) and `roll.mjs` refuses to load a manifest that breaks it. A village
held back for months collects every change that shipped while it sat still,
and clearing the pin then means one jump no canary ever rehearsed. Short pins
keep that jump small. `ops/README.md` has the unpinning procedure.

### A village that hosts itself

Name the version in your own deploy and leave it there:

```
ghcr.io/rieki777/village-os:1.2.0
```

That is the whole pin, and every village should have one. Nothing moves it
until you change that line (`VILLAGE_OS_IMAGE` in `.env` on the compose path).
`:stable` instead moves you whenever a new release is published, with no
backup taken and nothing read first, so a village pins a version.

Read `docs/UPGRADING.md` and `CHANGELOG.md` before you move, take a backup,
and move one version at a time where you can. `docs/SECURITY_ADVISORIES.md` is where anything urgent is posted, and it
stays readable to a village that has left the fleet.

## Cutting a release, for the platform team

1. Get the commit green. `.github/workflows/ci.yml` has to have passed on the
   exact commit you are about to tag. The release workflow asks GitHub
   whether it did and refuses to publish if it did not.
2. Add the entry to `CHANGELOG.md`, written for a steward.
3. Set `version` in `package.json` to the same number.
4. Tag and push:

   ```
   git tag -a v1.2.0 -m "village-os 1.2.0"
   git push origin v1.2.0
   ```

5. Watch `.github/workflows/release.yml`. It builds the image, starts it
   against an empty database, checks that `/health` reports the tagged
   commit, checks that three real pages answer 200, and only then pushes to
   the registry. A failure here is the system working.
6. Roll it out with `ops/roll.mjs`, `plan` first. `ops/README.md` has the
   procedure and what to do when a ring halts.

The version number tracks `PLATFORM_VERSION` in `server/lib/identity.ts`,
which is the contract other villages and the hub read. Bump the minor for an
additive change, the major for anything a peer could break on, and keep
`package.json` and the git tag on the same number so a village never gets two
answers to one question.
