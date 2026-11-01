# One-click deploy: the Railway template (spike, 2026-11-01)

**Verdict: it works, with one founder input and one value to read.** Everything else a new village
types by hand today is generated or referenced by Railway at deploy. Five things can only be proved
by one live deploy (below), so the template is not published until that deploy passes.

This is a spike: a written answer and the exact template sheet. Nothing here touches a Railway
account. Creating the template, the proving deploy and publishing it are Rye's, because every
Railway action reaches production and needs his yes.

## What a founder does today, and with the template

Today (docs/PROVISIONING.md, steps 2 and 3): create a Railway project, add MySQL, add the app from
the published image, attach a volume, install Node, run `scripts/fork-init.mjs` on their own
computer, then copy about a dozen generated values into Railway's Variables tab by hand.

With the template (`FOUNDER_STEPS` in `shared/railwayTemplate.ts`):

1. Sign in to Railway and press Deploy on the template.
2. Type your own email address into the one box the deploy form asks for.
3. When it is live, open the village service's Variables tab and copy `ADMIN_PASSWORD` once.
4. Open your village's address, go to `/claim`, and claim it with that password and your email.
5. Then play the setup game: it plants everything else.

## The template sheet

Built in Railway's dashboard (Workspace settings, Templates, New Template). A template is never a
file in a repository, so the sheet below is what gets typed into the composer. It is held in code
(`shared/railwayTemplate.ts`) and tested against `.env.example`, the soil guild and what fork-init
generates, so it cannot quietly forget a variable.

**Services**

| Service | Source | Notes |
|---|---|---|
| `MySQL` | Railway's own MySQL database service | The app references its connection string. |
| `village` | Docker image `ghcr.io/rieki777/village-os:1.2.0`, a pinned release, never `:edge` | Public networking on. Volume mounted at `/app/data` for member uploads. |

**Variables on the `village` service**

| Variable | How | Value in the composer |
|---|---|---|
| `DATABASE_URL` | referenced | `${{MySQL.MYSQL_URL}}` |
| `FRONTEND_URL` | referenced | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `AUTH_TOKEN_SECRET` | generated | `${{secret(64, "0123456789abcdef")}}` |
| `MEMBER_SECRETS_KEY` | generated | `${{secret(64, "0123456789abcdef")}}` |
| `VILLAGE_SECRETS_KEY` | generated | `${{secret(64, "0123456789abcdef")}}` |
| `BACKUP_EXPORT_TOKEN` | generated | `${{secret(64, "0123456789abcdef")}}` |
| `ADMIN_PASSWORD` | generated | `${{secret(24)}}` |
| `TRUSTED_PROXY_HOPS` | fixed | `1` |
| `BREAK_GLASS_ADMIN_EMAIL` | founder | asked on the deploy form |
| `PORT` | Railway | set by Railway, no entry |

The three sealing and signing keys use 64 lowercase hex characters, the exact shape
`server/lib/sealedBox.ts` accepts and the recipe `scripts/fork-init.mjs` already uses.

## What Railway's docs confirm (read 2026-11-01)

- **Generated values.** `secret(length?, alphabet?)` "Generates a random secret (32 chars by
  default)", run once when the template deploys. Source: docs.railway.com/templates/create,
  "Template variable functions".
- **References.** `${{NAMESPACE.VAR}}`, where the namespace is another service's name. Source:
  docs.railway.com/reference/variables, "Template syntax".
- **The public domain.** `RAILWAY_PUBLIC_DOMAIN` is a Railway-provided variable, "the public service
  or customer domain". Source: docs.railway.com/reference/variables.
- **Volumes and images.** A service can come from a GitHub repository or a Docker image, and a volume
  is attached with a mount path. Source: docs.railway.com/templates/create, "Configuring services".

## What only a live deploy can prove

1. The MySQL service's connection variable is named `MYSQL_URL`, so `DATABASE_URL` resolves.
2. `RAILWAY_PUBLIC_DOMAIN` is set when the village service first boots, so `FRONTEND_URL` is not
   `https://` with nothing after it.
3. The `ADMIN_PASSWORD` the Variables tab shows is the value the container received. A community
   thread reports a `secret()` value that changed each time it was revealed in the dashboard.
4. `secret(64, "0123456789abcdef")` yields 64 lowercase hex characters, which `sealedBox` accepts.
5. The volume at `/app/data` survives a redeploy, and the boot migrations apply on the first start.

If item 3 fails, the fix is a server change: print a one-time claim link to the deploy log on the
first boot of an unclaimed village, so the founder never reads a password at all. That is a
follow-up, not part of this spike.

## For Rye: building and proving the template

1. In Railway, open Workspace settings, then Templates, then New Template.
2. Add a MySQL database service and name it `MySQL`.
3. Add a service from the Docker image `ghcr.io/rieki777/village-os:1.2.0`, name it `village`,
   turn on public networking, and attach a volume at `/app/data`.
4. On `village`, add every variable in the table above with the value shown. Mark
   `BREAK_GLASS_ADMIN_EMAIL` as required, with the description "Your own email address".
5. Deploy the template once into a throwaway project and check the five items above.
6. Only then publish it, and put its Deploy button in `START_HERE.md` and `docs/PROVISIONING.md`.
