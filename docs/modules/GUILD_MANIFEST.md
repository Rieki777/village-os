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
- **The platform's own layers** (hosting, email, sign-in, the AI guide) are `PLATFORM_GUILDS` in the
  same file. Every village plants those whatever it chooses, so do not repeat their seeds in your
  guild. If your module needs email, email is already there.

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
| `kind` | `oauth` (one consent on the provider's page), `master-root` (one scoped token the agent works inside), `hand-carried` (no OAuth: the founder copies a value into the paste field), `dns-record`, or `hosting-var`. Prefer them in that order. |
| `title` | What the seed packet says at the top. Short. |
| `provider` | Who the founder deals with and the **exact page** they act on, never a bare product name. `url: null` only where the page differs per village, and then the seed is `unverified`. |
| `scopes` | The permissions requested, minimal. Ask for the narrowest scope the code actually needs. Empty where the provider offers none. |
| `handles` | Where the value lands: a `village-secret` slot, an `env` variable, a `dns` record, a `module-config` key, or `cellar-pending` for a credential that has no home yet. Never the value itself. |
| `need` | `required`, `recommended` or `optional`, while the guild is planted. |
| `risk` | `keystone` for anything touching production, money, or sending as the village. Keystone plantings need a second founder's co-sign. Everything else is `ordinary`. |
| `consequence` | One plain sentence: what changes in the world once this is planted. |
| `undo` | One plain sentence: how to take it back, and what breaks if they do. |
| `cost` | What it costs, including saying when nobody knows the figure. |
| `dependsOn` | Seeds that must be planted first. This orders the plan. No circles. |
| `launchRequirement` | The row on the Journey to Launch page this seed satisfies, if there is one. |
| `liveCheck` | The bee. See below. |
| `nursery` | The test-mode variant, as `{ how }`, or `null` when the provider has none. Say null out loud: absent is refused. |
| `compost` | The steps to revoke and delete it. Never empty. |
| `rotation` | `{ every: "year" }`, or `{ never: "why" }` when changing it breaks something (a sealing key, a DNS record). |
| `holder` | `any-founder`, or `account-owner` with the account named. |
| `certainty` | `verified` if you read every claim in the code or the provider's docs. Otherwise `unverified`, with `open` listing exactly what is not confirmed. |
| `source` | Where you read the claims. |

## The live check

A plant only shows green when a real check passed. Pick the strongest one you can:

- `launch-check`: a resolver in `server/lib/launch.ts`, named by a `checkKey` from
  `shared/launchRequirements.ts`. A `manual:` key means a person confirms it.
- `probe`: a named check the setup game runs. Say exactly what it calls and what answer counts as
  alive.
- `driver-health`: your module's `health` driver method. That interface does not exist yet, so intake
  reports it as not yet callable.

Then set `strength` honestly. `present` means a value is set and says nothing about whether it works.
`confirmed` means a person said so. `alive` means a real call to the real service succeeded. Most
checks in the platform today are `present`, and the setup game shows that difference to founders.

## What intake checks

`node scripts/validate-module.mjs <your-module-id>` runs `guildProblems` from `shared/guilds.ts`. It
fails your module when:

- it has no `guild`, or names a seed the catalog does not hold;
- any seed in its guild has no consequence line, undo line, cost, live check or compost step;
- a live check names a launch check that does not exist;
- a provider page is missing and the seed still claims to be verified;
- an unverified seed does not say what is open;
- a secret slot in your `vendor.secretKeys` is planted by no seed in your guild.

`shared/guilds.test.ts` holds the catalog to the rest of the platform in both directions: every
secrets-store slot in `server/lib/secrets.ts` and every variable on the Go live table in
`client/src/components/admin/goLivePlan.ts` must be planted by some seed, and every variable a seed
names must be documented in `.env.example`.

Intake checks the shape. A reviewer reads the words against the code, because only a person can tell
whether a consequence line is true.

## The pilot

Resend is the worked example: `resend-account`, `resend-sending-domain`, `resend-api-key` and
`email-from` in the `email` platform guild. The key asks for Resend's `sending_access` permission
restricted to the village's own domain, grows in the nursery by sending only to Resend's test
recipient, and proves itself alive with a real send. Copy its shape.
