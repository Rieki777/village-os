# The guild manifest

Provenance: platform

Every module declares its **guild**: the full list of things a village has to plant before the
module works. Secrets, OAuth clients, DNS records, hosting variables. The setup game reads guilds to
build a founder's plan, so choosing modules tells the village exactly what to set up, in what order,
and nothing else.

You write a guild when you write a module. Intake refuses a module without one.

## Where it lives

- **The seeds** live in one closed catalog, `SEEDS` in `shared/guilds.ts`. A seed is one
  requirement.
- **Your module's guild** is the `guild` field on its entry in `shared/modules.ts`: a list of seed
  ids from that catalog. A module with nothing to plant writes `guild: []`, and absent is refused.
- **The platform's own layers** are `PLATFORM_GUILDS` in the same file: hosting (soil), email
  (water), sign-in (canopy), the AI guide (mycelium) and the governance crossings (vines). Every
  village plants those whatever it chooses, so do not repeat their seeds in your guild. If your
  module needs email, email is already there.

Seeds are shared. Stays, the exchange and commerce all name `stripe-secret-key` and
`stripe-webhook`, and the setup game plants each one once.

## Why the catalog is closed

The setup game lets a village's own AI agent pick the next seed and explain why. It never lets the
agent add a seed or write the words a founder consents to. Every consequence line, undo line, cost
and compost step a founder reads comes from `shared/guilds.ts`, which is reviewed at intake. Text the
agent read somewhere else (a document, an email, a knowledge base) can never reach a consent screen.

So the words you write here are the words a founder agrees to. Write them as if that were true,
because it is.

## A seed, field by field

| Field | What to write |
| --- | --- |
| `id` | Lowercase words joined by hyphens. Unique across the catalog. |
| `kind` | `oauth` (one consent on the provider's page), `master-root` (one scoped token the platform works inside), `hand-carried` (no OAuth: the founder copies a value into the paste field), `minted` (the platform creates it from a setup seed; the founder never sees it), `dns-record`, or `hosting-var`. Prefer them in that order. |
| `title` | What the seed packet says at the top. Short. |
| `provider` | Who the founder deals with and the **exact page** they act on, never a bare product name. `url: null` only where the page differs per village, and then the seed is `unverified`. |
| `scopes` | The permissions requested, minimal. Ask for the narrowest scope the code actually needs. Empty where the provider offers none. |
| `handles` | Where the value lands: a `village-secret` slot, an `env` variable, a `dns` record, a `module-config` key, or `slot-to-build` for a slot whose flow is not built yet. Never the value itself. |
| `need` | `required`, `recommended` or `optional`, while the guild is planted. |
| `onlyWhen` | Optional. A game variable that must hold a value before this seed is planted, and why. A village that never set it has nothing to plant here. |
| `risk` | `keystone` for anything touching production, money, or sending as the village. Everything else is `ordinary`. See the planting rule below. |
| `lifespan` | `lasting`; `until-launch` (composted at launch, planted again on demand); or `setup` (exists only to plant `consumedBy`, and the platform composts it by itself). |
| `bootstrap` | Set only on the few seeds that must exist before the setup game can run, because the game runs inside the deployed app. These are planted by hand, never through a root. |
| `plantedThrough` | `railway-root` or `dns-root` when the platform can plant it through a root the village holds. |
| `byHand` | How to plant it with no root at all. Required on anything that lands in the hosting environment or in DNS. Planting by hand is first class and never a failure. |
| `consequence` | One plain sentence: what changes in the world once this is planted. |
| `undo` | One plain sentence: how to take it back, and what breaks if they do. |
| `cost` | What it costs, including saying when nobody knows the figure. |
| `dependsOn` | Seeds that must be planted first. This orders the plan. No circles. |
| `launchRequirement` | The row on the Journey to Launch page this seed satisfies, if there is one. |
| `liveCheck` | The bee. See below. |
| `nursery` | The test-mode variant, as `{ how }`, or `null` when the provider has none. Say null out loud: absent is refused. |
| `compost` | The steps to revoke and delete it. Never empty. On a setup seed, the steps the platform runs itself. |
| `rotation` | `{ every: "year" }`, or `{ never: "why" }` when changing it breaks something (a sealing key, a DNS record). |
| `holder` | `any-founder`, or `account-owner` with the account named. |
| `certainty` | `verified` if you read every claim in the code or the provider's docs. Otherwise `unverified`, with `open` listing exactly what is not confirmed. |
| `source` | Where you read the claims. |

## The planting rule for keystone seeds

A keystone seed always gets a **read-pause**: the planter reads the seed packet before the provider's
page opens. What else it asks depends on launch.

- **Before launch, any one founder plants it.** Every other founder gets a receipt. There is no
  co-sign and no cooling-off, because a founder setting up a village has to be able to finish alone.
- **After launch, it needs a second person's co-sign**, one tap on their own device. A village with
  nobody to co-sign gets a cooling-off pause and a receipt email instead.

`keystoneRule(risk, phase)` in `shared/guilds.ts` is the one place this is decided. The phase comes
from `plantingPhase` in `server/lib/gameStart.ts`, which reads `founderPowerStands`, the same fact
that already ends the founder's own powers at launch. It deliberately does not read the launch
document's `launchedAt`: a village that was live before the launch vote existed has no `launchedAt`
at all, and it must still ask for a co-sign on a production key.

Nothing enforces this rule yet, because no screen plants a seed packet yet. The Integrations screen
saves keys directly and predates the setup game; it is not gated by this rule.

## Green means alive

A plant is healthy only after a live check of strength `alive` has passed. A value being present is
never health, and neither is a person saying so. Pick the strongest check you can:

- `probe`: a named check. Say exactly what it calls and what answer counts as alive, and set
  `builtAt` to the code that runs it once it exists.
- `launch-check`: a resolver in `server/lib/launch.ts`, named by a `checkKey` from
  `shared/launchRequirements.ts`. A `manual:` key means a person confirms it. The platform's own key
  rows read evidence (`server/lib/launchProofs.ts`, since 2026-10-31): Stripe answering a checkout,
  a signed webhook event verifying, the guide answering, a session verifying, a sealed value
  opening. A new launch check reads what the platform records when the thing really happens, and
  never a value being set.
- `driver-health`: your module's `health` driver method. That interface does not exist yet, so intake
  reports it as not yet callable.

Then set `strength` honestly: `present`, `confirmed` or `alive`. A seed whose strongest check is
`present` or `confirmed` can never turn green, and intake prints every such seed on every run, so
the gap stays in view until somebody builds it a live check.

## Master roots and the one root cellar

A **master root** is one narrowly scoped token the founder grants once, so the platform can do the
rest through the provider's API. There are two: `railway-root` (one Railway project and environment)
and `dns-root` (one DNS zone). Both live in the village's one secrets store, in the slots
`railway_project_token` and `dns_zone_token`: sealed at rest, written only by an admin or founder
through Integrations, audit-logged, never returned to any screen or agent, and with no environment
fallback. Both scopes are marked unverified until checked against each provider's own docs.

The Railway root stays for upkeep and is keystone after launch. The DNS root is composted at launch
by default and planted again when a record has to change. Neither is required: every seed planted
through a root also says how to plant it by hand, and a village with no domain yet keeps its hosting
address and comes back to DNS later.

## The setup key pattern

When a provider can mint a narrow key from a broad one, ask the founder for the broad one once and
never keep it. The seed the founder plants is a `setup` seed; the key the village keeps is `minted`.
The setup seed names the minted seed in `consumedBy`, the minted seed depends on it, and the setup
seed's compost steps are the ones the platform runs to delete it.

Resend is the worked example, and every step names the endpoint it uses:

1. The founder pastes one temporary `full_access` key (`resend-setup-key`).
2. The platform adds the domain: `POST /domains`, which answers with a domain id and its records.
3. It plants the records through the DNS root, or shows one copy card per record to plant by hand
   (`resend-sending-domain`).
4. It asks Resend to verify: `POST /domains/{id}/verify`, then reads `GET /domains/{id}` until it
   says verified.
5. It mints a key with `POST /api-keys`, `permission: sending_access` and `domain_id` set to that
   domain (`resend-api-key`), and stores it.
6. It deletes the setup key with `DELETE /api-keys/{id}`.

That flow is modelled in the catalog and not built yet, and the setup seed says what is still open:
how the platform learns the setup key's own id (the key list never shows a token), and whether a key
may delete itself.

## The bootstrap wall, and the template that would remove it

*A design note. Nothing here is built, and nothing about Railway's template features has been
checked against Railway's docs.*

The setup game runs inside the deployed app, so a founder meets it only after the app is running.
Today that means creating the Railway project by hand, adding MySQL and a volume, running
`scripts/fork-init.mjs` and pasting the four `bootstrap` seeds into Railway (`DATABASE_URL`,
`AUTH_TOKEN_SECRET`, `ADMIN_PASSWORD`, `VILLAGE_SECRETS_KEY`), all before the game can help. That is
the wall.

A one-click Railway template would remove it. The template would create the app service from the
published image, a MySQL service, and a volume at `/app/data`. It would wire `DATABASE_URL` as a
reference to the MySQL service, and generate the secrets `fork-init` generates today:
`AUTH_TOKEN_SECRET`, `ADMIN_PASSWORD`, `VILLAGE_SECRETS_KEY` (64 hex characters),
`MEMBER_SECRETS_KEY` and `BACKUP_EXPORT_TOKEN`, with `TRUSTED_PROXY_HOPS` set to 1. The founder's first
act becomes a Railway sign-in and one Deploy. They then read `ADMIN_PASSWORD` once from the service's
variables to claim the village at `/claim`, and the setup game takes over from the Railway root on.

To confirm before building it: whether a Railway template can generate a random value of a given
length and alphabet per deploy, whether it can reference another service's connection string, and
whether a template can pin the image to a release.

## What intake checks

`node scripts/validate-module.mjs <your-module-id>` runs `guildProblems` from `shared/guilds.ts`. It
fails your module when:

- it has no `guild`, or names a seed the catalog does not hold;
- any seed in its guild has no consequence line, undo line, cost, live check or compost step;
- a live check names a launch check that does not exist;
- a provider page is missing and the seed still claims to be verified;
- an unverified seed does not say what is open;
- a seed lands in the hosting environment or DNS and does not say how to plant it by hand;
- a setup seed plants nothing, or a minted seed has no setup seed to mint it from;
- a bootstrap seed is planted through a root, or depends on a seed that is not bootstrap;
- a secret slot in your `vendor.secretKeys` is planted by no seed in your guild.

It also prints, without failing, every seed that can never turn green and every seed whose slot is
still to build.

`shared/guilds.test.ts` holds the catalog to the rest of the platform in both directions: every
secrets-store slot in `server/lib/secrets.ts` and every variable on the Go live table in
`client/src/components/admin/goLivePlan.ts` must be planted by some seed, and every variable a seed
names must be documented in `.env.example`.

Intake checks the shape. A reviewer reads the words against the code, because only a person can tell
whether a consequence line is true.

## The pilot

Resend is the worked example: `resend-account`, `resend-setup-key`, `resend-sending-domain`,
`resend-api-key` and `email-from` in the `email` platform guild. The key the village keeps can only
send, and only from the village's own domain. It grows in the nursery by sending only to Resend's
test recipient. Its live check is the post office's own test email: Send me a test, in Comms Settings,
posts a `comms.test` email to the signed-in admin through the one mail door and onto the ledger, and
the key is alive once the latest one is reported delivered. That is item 13 of the comms setup
checklist (`testEmailDelivered`, `server/lib/comms/setup.ts`), and the launch row `resend-key` reads the
same answer (`server/lib/comms/keyHealth.ts`), so nothing keeps a second opinion. A variant for checks
that revisit with nobody present, sent to Resend's test address, is a follow-up. The domain's own
check is built too: Comms Settings asks Resend for the domain's status when the key may, and asks a
founder when it may not (`comms:domain`). Copy its shape.
