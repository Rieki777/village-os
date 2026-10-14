# Building a module

Provenance: platform

This is the guide for somebody writing a module for this platform, including somebody who wants to
charge other villages for one. It is written against the code as it actually is, so where the
machinery is incomplete it says so instead of describing the plan.

Read `docs/ARCHITECTURE.md` first. Read `CLAUDE.md` at the repository root for the gates. This file
is about the module framework and the module library specifically.

---

## 1. What a module is here

A module is a unit of capability in this platform: some tables, some routes, some screens, a few
tunable numbers, and an entry in `shared/modules.ts` that ties them together.

Three things about that are unusual and you should know them before you start.

**Every module is first-party code in this repository.** There is no plugin runtime. Nothing you
write runs inside a village's server as third-party code, because there is no mechanism for that and
there is not going to be one. A module you build is merged here, reviewed here, and shipped to every
village as part of the platform. That is a real constraint and it buys three things: the platform can
support itself, your service is never blamed for a defect in somebody else's, and the entire class of
supply-chain attack that has repeatedly hit plugin marketplaces does not exist here.

**Everything ships off.** An absent `module_settings` row means off. A village inherits every new module
as off, and enabling one is a deliberate admin act recorded in `module_events`. The four core modules
(quests, gratitude, progression, profiles) are the exception and cannot be disabled.

**The village owns the code.** A village runs the published image on its own infrastructure, and the
code is MIT: any village may fork this repository, change any file, including `shared/modules.ts`,
and deploy its fork. That fact is the single most important input to
how paid modules work here, and section 7 is entirely about it.

## 2. Where things go

Five configuration planes, and picking the wrong one is the most common mistake.

| Plane | What belongs there |
|---|---|
| `shared/gameVariables.ts` | Behaviour numbers: how much, how often, which mode. Namespaced `yourmodule.*` |
| Brand overlay | Identity: names, images, personas. Never platform code |
| `module_settings.config` | Structural config: category lists, link directories. Validated by your `validateConfig` |
| `app_config` documents | Keyed JSON that is neither behaviour nor structure |
| `server/lib/secrets.ts` | Integration credentials. Write-only, read back as source and last4, sealed at rest under `VILLAGE_SECRETS_KEY` (see `server/lib/sealedBox.ts`) |

If your module has a knob, it is almost certainly a game variable. Module lifecycle is deliberately
not one: it is deployment infrastructure and lives in `module_settings`.

## 3. The registry entry

One entry in `shared/modules.ts`. The required fields:

```
id            lowercase slug, stable forever, it keys module_settings
name          founder-facing catalog name, platform language, no village brand
description   founder-facing catalog copy, same rules
tier          included | connected | managed
dataClass     none | village-content | member-pii
requires      hard dependencies: block enabling while one is off
recommends    soft dependencies: the panel warns, never blocks
capabilities  keys added to the ONE gate in shared/capabilities.ts
variableKeys  the namespaced game variables your module owns
apiPrefixes   the route prefixes mounted behind requireModule(id)
guild         seed ids from shared/guilds.ts: everything a village plants first. [] if none
```

And the optional ones that matter:

```
core          the four that cannot be disabled. Not available to you
provides      the domain this listing claims
legalReview   show the caution card before enabling. Funds-bearing modules only
sellsToken    the ONE module allowed to sell this token for fiat. Boot-asserted
validateConfig / defaultConfig    structural config
openStateCheck                    refuse `off` while value is outstanding
builtBy       who wrote it. A CREDIT LINE, never a tier
pricing       what it costs. Section 7
withdrawn     set when it stops being offered. Section 8
vendor        the named counterparty. Required at connected and managed, refused at included
```

### The guild: what a village plants for you

Every module names its guild, the secrets, OAuth clients, DNS records and hosting variables the
setup game plants before the module works. The seeds and their consent text live in the closed
catalog in `shared/guilds.ts`, and intake refuses a module without a guild. The full guide is
`docs/modules/GUILD_MANIFEST.md`.

### Copy in this file is shipped copy

`name` and `description` are rendered to founders, so they are held to the house writing rules by
`scripts/check-voice.mjs`, which parses `shared/` and reads every string literal. No em-dashes or
en-dashes, no `not X but Y` framing, no AI filler vocabulary, no rhetorical-question openers.

Everything in the vendor record is a VALUE rather than a sentence, on purpose. You supply your legal
name, your URLs, your addresses and your price. The platform writes the sentences a village reads.
That is not a stylistic preference: it is what stops a vendor's marketing arriving in the platform's
own voice, and it is why `legalName` is a field and never part of `description`.

### The tier is where your credential lives

The tier answers the only two questions anybody asks at the moment they need an answer: **who do I
pay, and who do I call.**

| | Included | Connected | Managed |
|---|---|---|---|
| Billed by | n/a | **you, direct to the village** | the platform |
| Supported by | the platform | you for the service, the platform for the connector | the platform first, you behind a private escalation |
| Credential | none, or the village's own account | **a key the village holds and can see** | platform-held, env only, the village never sees it |

**Connected is the default for third parties, and it is the tier a paid module uses.** Managed is a
deliberate spend on the platform's side and is hard capped at two concurrent listings, in code, with
the reason written beside the number.

The credential PLANE is the mechanical definition of the tier, not a description of it.
`moduleListingProblems` in `shared/modules.ts` checks it, `assertModuleGraph` throws on it at boot,
and `shared/moduleListing.test.ts` fails CI on it. A listing whose credential sits in the wrong plane
is not mislabelled; it is a different tier wearing the wrong word.

## 4. The five driver methods

The contract requires `read`, `write`, `health`, `exportMember` and `forgetMember`. Here is the
honest state of that.

**`forgetMember` and `exportMember` are real and have an interface.** They live in
`server/lib/memberDrivers.ts`, you register them once at boot with `registerMemberDriver(moduleId,
driver)`, and the member's own routes call them: the local deletion sweep calls
`forgetMemberEverywhere`, and the profile export calls `exportMemberEverywhere`.

Three rules there, and none is optional:

1. **Silence is not confirmation.** Your driver returns `{ confirmed: true }` or it did not confirm.
   A throw, a timeout, a 500 and a 200 with an ambiguous body are all the same answer: not confirmed.
   An unconfirmed erasure is recorded as a FAILED call in `integration_health`, with a correlation id,
   because a driver that quietly returns "no" would otherwise look exactly like one that succeeded.
2. **A member is never told "deleted" when your store did not answer.** The local scrub still runs
   and still completes. What changes is what the member is told: the outcome names every store that
   has not confirmed, and the village keeps owing them that confirmation.
3. **A partial export says so, in the document.** A store that could not be read is named.

Contract stage 4 proves your `forgetMember` by deleting and then **reading back and getting nothing**.
Returning 200 is not proof.

**`read`, `write` and `health` have no interface anywhere yet.** They are in the contract and there is
no code to implement against. If your listing needs them, that interface is designed with you, and
`scripts/validate-module.mjs` prints this gap every run rather than quietly passing you.

## 5. Every outbound call goes through `callVendor`

`server/lib/integrations.ts` owns the seam. Not "should": the wrapper is where the correlation id is
minted, where the header carrying it is built, and where the outcome is recorded. A driver that skips
it produces no evidence at all.

```
await callVendor("yourmodule", "read", async (ctx) => {
  // ctx.correlationId, and ctx.headers to merge into the request
});
```

Contract clause 11 asks you to log that correlation id on your side. When your records and the
platform's disagree, it is how the same call is found in two systems in a minute instead of an
afternoon. The platform's log is evidence and not adjudication.

Nothing written to `integration_health` carries a payload or member content: status, a short detail
string, timestamps and a correlation id. A row you would be willing to show the vendor it describes.

### Declare what healthy looks like

Every listing declares a `liveness`, either `{ mode: "window", withinHours: N }` or
`{ mode: "on-demand" }`. Absence of a failure is not evidence of health. A module that is off, a
driver that never fires and a job that quietly stopped all produce no failure record at all, and that
blind spot is where slow rot lives. `healthReading` returns five verdicts and
`never-confirmed` can never collapse into `working`.

## 6. The evidence rule

**Nothing a vendor sends moves value, grants a stage, decides a permission, or is written as fact.**

This is structural. The permission gate reads platform state only. Token movement is double-entry and
human-consented, so a record you push can suggest and only a person can credit. And anything you push
that a member will read carries a verbatim quote, a source anchor and a timestamp, or it is dropped on
arrival.

That is the same bar the platform's own AI already meets at the database level: no quote and no
timestamp means no row. Your output is not going to be shown to a community at a lower bar than the
platform holds its own.

Also structural, and worth reading twice: **no vendor is a source of truth.** Each domain has a
platform-owned table holding the join key, the consent record and the deletion state. Your service is
a driver behind it. At most one driver per domain runs at a time. And nothing you write reaches the
four core modules.

## 7. Pricing, licensing, and the thing that actually works

You can charge other forks for your module. Here is the mechanism, and here is why it is this one.

### Why a code gate does not work

A village owns `shared/modules.ts`. Any `if (licensed)` you write is one edit away from being deleted
by somebody legally entitled to edit it, who has the file open anyway. So a feature flag is not a weak
form of enforcement here. It is not enforcement.

WordPress spent a decade discovering the same thing with a customer base that could read every line,
and landed somewhere specific: you do not sell the code, you sell the thing the customer cannot copy.

### What does work: the credential is the licence

The only plane a fork cannot forge is a credential you hold the other end of.

So: your paid operations sit behind a **licence key the village buys from you and holds in its own
secrets store**. You declare the slot in `vendor.secretKeys`; it joins `SECRET_KEYS` automatically and
appears in Admin → Integrations, where an admin sets it and reads back its source and last four
characters, and can clear it without asking anybody. That visibility is the Connected tier.

When the key is absent, `requireVendor` answers **503** on your module's prefixes with a body naming
you and your support address, and everything else in the village keeps working. You revoke the key,
the paid behaviour stops, and nothing else does.

### Declaring the price

```
pricing: {
  amount: 4900,                              // minor units, integer
  currency: "USD",                           // ISO 4217, uppercase
  period: "month",                           // month | year | once
  billingUrl: "https://yourproduct.example/pricing",
  licenceKey: "yourproduct_licence_key",     // one of your own vendor.secretKeys
}
```

Structured data, never prose. `licenceKey` is **required once `amount` is above zero** at connected,
and is refused at managed, where the credential is platform-held and env-only. A listing that charges
money and names no licence slot is refused at boot and in CI, with the reason: a price with no
credential behind it is a price a fork can delete.

**In v1 you bill the village directly.** The platform processes no payments and takes no cut of a
Connected listing. `billingUrl` is where a village goes to buy from you. Whether the platform ever
bills on your behalf is an open decision recorded in
`docs/integration-program-research/STORE_DESIGN.md`, and nothing has been built for it.

### If you do not charge: the builders' pool

Charging is one of two ways to be paid here, and the other one is the default.

Every free third-party module is in a recurring $ReGen distribution to whoever built it, sized by
how many members open it. It pays for adoption instead of for negotiation, and it is why a
module with no price is still a module somebody is paid for.

The measure is REACH, and it saturates. One member opening your module during a lunar cycle counts
once for that cycle, whether they open it once or two hundred times and whether or not they write
anything. Each village contributes the share of its active members who opened you, so three members
of four counts far more than three of four hundred, and each village can contribute at most one. A
module earns by being opened by more people, and never by asking more of the same ones.

**Declaring a price takes you out of the pool**, and that is arithmetic instead of a penalty. A paid
module is already paid by the villages running it, so drawing from a common pool as well would have
every village funding a product only some of them use. A listing picks one. A withdrawn listing
leaves the pool because it is no longer being offered.

The platform's own modules and the four core modules ARE in the pool, and they are paid to nobody.
That is R59: they earn a share on the same measure as everybody else, and the share returns to the
pool to be given out again next cycle. It is there so the measurement stays honest. A pool that
excluded the platform's own work would split a fixed sum among whoever remained, which quietly pays
third-party builders for the platform's usage as well as their own. What it means for you is that
your share is a share of everything the pool measures, and what the platform earns never leaves the
pool. The village's own pool statement shows the returning amount as a number.

To be paid, your registry entry carries two fields together:

- `builtByAccount`, the handle you hold on an account system.
- `builtByNamespace`, the host of that system, for example the site you signed up on.

You link your own Base address inside your own profile on that system, and whoever settles a cycle
reads the address there. The pool pays an account and never a raw address written into a registry
file, because a payout identity in a code file is one nobody can rotate or recover, and a pull
request against it looks like a typo fix.

**One field without the other is refused**, at boot and in the lint. A handle alone only resolves
while everybody shares one account system, and that stopped being safe to assume the moment a second
organisation ran this code: `alice` on one system is a different person from `alice` on another.

Your credit travels with your module. It sits in the registry entry, every fork inherits it by
pulling, and every village republishes it in the cycle report it serves at
`/api/platform/module-usage`. There is no central list of builders to get onto, which is what lets a
village nobody has heard of run your module and have that count.

Clause 14 of `docs/MODULE_LIBRARY_CONTRACT.md` is the binding text, and
`shared/moduleProvenance.ts` is the authority on what a report carries. The listing lint prints your
module's pool status and the reason behind it, refuses a listing that charges while claiming the
pool, and refuses a payout identity that is missing half of itself or is an address. Run
`node scripts/validate-module.mjs <your-module-id>` and it tells you where you stand.

**Nothing has been paid out yet, and you should know that before you write anything.** The
measurement runs, the reports are served and signed, and a village's own statement closes to the
unit. There is no wallet in this repository and no automated transfer: the last step is a person
reading a statement and sending $ReGen by hand. The appendix to the contract tracks that line by
line.

### What you may not do on lapse

This is a hard rule, not a guideline, and it is the one every open-source plugin ecosystem has
litigated in public.

- **You may stop serving your own paid operations.** That is what the 503 path is.
- **You may not disable a village surface, lock an admin screen, or alter village data.** A village
  that stops paying still runs its village. Every vendor who crossed that line paid for it, and the
  worst case in the research reached into the customer's database and was treated as malware
  regardless of intent.
- **You may not degrade anything you are not still paying to run.**

A listing that breaks a village on lapse is withdrawn.

## 8. Withdrawal

When a listing stops being offered, it is marked `withdrawn`, never deleted.

```
withdrawn: { since: "2026-08-15", replacedBy: "successor-module-id" }
```

Deleting the registry entry instead would turn every village that enabled it into an orphan
`module_settings` row, which is the exact thing the contract promises never happens.

What `withdrawn` does:

- **Blocks a new enable**, with a 409 in the same shape as the dependency refusals beside it.
- **Changes nothing that is already serving.** A village running it keeps running it, can still move
  between preview, members and public, and can still switch it off. Only the transition out of `off`
  is refused. Withdrawn means withdrawn from the catalog, never withdrawn from a village.
- **Banners the admin card**, with the date.
- **Never orphans.** The entry stays in the registry, so it always resolves.

The commitments around it are ninety days' notice and a data return, in both directions.

## 9. The gates

Everything below must be green, cold, before anything is done. CI runs them in this order.

```
pnpm check                          # tsc --noEmit
npx tsc -p tsconfig.tests.json      # tests typecheck separately, run it COLD
node scripts/check-brand-refs.mjs   # the brand ratchet. Read $?, not the last line
node scripts/check-voice.mjs        # house writing rules on shipped copy
node scripts/check-auth-fetch.mjs   # a client call to a guarded route carries a token
node scripts/check-artifact-budget.mjs
pnpm build
pnpm test
pnpm audit --prod --audit-level high
```

Plus the bundle budgets CI enforces and no local command reproduces: **main JS 700 KB, total
`dist/public` 6000 KB.**

Four things that will bite you:

- **No new dependencies.** Assume the answer is no, and if it is genuinely yes, check `npm view <pkg>
  type` alongside `engines`: CI runs Node 22 and dev boxes here do not, so an ESM-only package builds
  green locally and goes red in CI with no local signal.
- **The brand ratchet has zero headroom** and its counts may only ever decrease. New code is born
  clean. Read the exit code; a failing run's last line is blank.
- **`pnpm check` does not typecheck tests.** `tsconfig.tests.json` does, and its incremental cache
  lies, so run it cold.
- **`server/loop.e2e.test.ts` boots the BUILT `dist/index.js`** and is order-dependent. Build first,
  and never filter it with `vitest -t`.

### Run the listing lint

```
node scripts/validate-module.mjs <your-module-id>
```

It loads the real registry rather than a regex's guess at it, checks the shape, the vendor record, the
pricing and licence slot, the member driver where `dataClass` is `member-pii`, the contract doc and its
provenance marker, and the launch requirement. Then it **prints everything it cannot check**, because a
check that silently skips converts unchecked into passed.

## 10. How a listing happens

Eleven stages. The gates that stop most conversations are the first three.

| # | Stage | What it takes |
|---|---|---|
| 0 | Intake | One sentence naming the capability, without marketing words, and the domain it claims |
| 1 | Diligence | A legal entity, a jurisdiction, a named human with an email, an exact product URL, a terms URL, a status page. **No name, no listing** |
| 2 | Domain assignment | Which domain, who holds it today, and the enumerated write surface |
| 3 | Data and legal | Classification, processing agreement, hard-delete endpoint, export answer |
| 4 | Technical proving | A sandbox tenant and one real captured payload per operation. **Documentation is not evidence.** All five driver methods demonstrated live, including a deletion verified by reading back and getting nothing |
| 5 | Tier and commercials | Tier, credential plane, margin, response commitments, withdrawal terms |
| 6 | Build | The platform's |
| 7 | Pilot | One named village, with the export and deletion drill run rather than planned |
| 8 | List | The bar is that a second person can enable it in a fresh fork using only the shipped interface and the runbook |
| 9 | Operate | Health probes, a call log, and a quarterly review that you still exist, terms have not changed, the agreement is current, and the tier is still honest |
| 10 | Withdraw | By the terms in section 8 |

The full text is `docs/MODULE_LIBRARY_CONTRACT.md`, and it is written to be read by somebody outside
this repository.

## 11. What gets a listing withdrawn

- **A support address that stops resolving.** Both are required, both are validated at boot, and a
  listing nobody can reach is a listing that cannot be supported.
- **Breaking a village on lapse.** Section 7.
- **A member-pii listing that cannot confirm a deletion.** The launch requirement fails visibly and
  the village is told. Persisting there is not a bug, it is a breach.
- **Writing to a core module**, or to another domain's platform-owned table.
- **Anything sent as fact.** The evidence rule is structural.
- **A tier that stopped being honest**, for example a credential that quietly moved plane.
- **A quarterly review that finds you no longer exist**, or terms that changed without the sixty
  days' notice clause 7 asks for.

## 12. What the platform owes you

- **Triage in all three tiers.** When something breaks, the village is told whose problem it is before
  anybody raises their voice.
- **Conservative attribution.** Where the recorded evidence does not clearly discriminate, the village
  is routed to the platform rather than to you. You get fewer tickets than a naive rule would send,
  and the ones you get carry evidence.
- **Aggregation.** One outage affecting several villages is one notification, not one ticket per
  village.
- **No competing with a listing that was solicited.** If the platform decides to build in your domain
  you are told before it starts.
- **Your name where you earned it.** Connected listings carry your name and your support link in the
  catalog and on the setup card, and `builtBy` credits whoever wrote it at any tier.
- **Orderly withdrawal in both directions.**
