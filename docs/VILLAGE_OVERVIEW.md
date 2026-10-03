# The village, explained

Date: 2026-08-03
Audience: humans deciding whether to run one, and machines deciding how to talk to one.
Companion docs: `ARCHITECTURE.md` (as-built detail), `MAIA_BRAIN_SPEC.md` (the assistant),
`COORDINATION_SUBSTRATE.md` (where this is going), `FORK_RUNBOOK.md` (how to stand one up).

If you read one section, read section 1. If you are a machine, skip to section 6.

---

## 1. What this is, in one page

A **village** is one running instance of this platform: one Node process, one MySQL
database, one domain. A community runs the published image and owns it; it forks
the repo only if it means to change the code. There is
no central server every village depends on, no shared user table, and no account
anyone must create to participate in the network.

The instance is not a website with a database behind it. **The instance IS the
backend**: the coordination record for a real place. Who is here, what work needs
doing, who decided what, what was contributed, what that was worth, and what the
community said it is for.

Five things the village keeps, and everything else is arrangement:

| | |
|---|---|
| **People** | members, their stage, what they can do |
| **Structure** | circles (domains of work) and roles (seats inside them) |
| **Work** | quests: posted, claimed, done, consented to |
| **Recognition** | gratitude sent between people, settled per lunar cycle |
| **Value** | a double-entry ledger whose balances sum to zero, per token |

Around that sit the **modules**, four of which are core and always on
(quests, gratitude, progression, profiles). Every other one ships **off** and
a village turns on only what it will use: the map, a forum, messaging, events,
stays, a library, an exchange, governance and the rest. `MODULES.md` lists every
one.

And a guide, **Maia**, who reads the village and helps run it. She is section 5.

---

## 2. The loop the whole thing exists to run

Someone arrives. They find a path. They do something useful. A human consents to
it. Recognition follows the work. They do more.

Every design decision below serves that loop, so the loop is the thing to argue
with if you disagree with one of them.

Two properties of the loop are unusual and deliberate:

**Consent is a human act.** Quest credit lands only after the people involved
agree it should. No job, no scheduler, and no assistant can release value. The
gratitude cycle closes because a person closed it.

**Recognition is a signal, and value is separate.** Gratitude sent between members
does not move tokens. At each lunar cycle close, a pool is split in proportion to
the recognition received. The village sets the pool size; the community's
appreciation decides where it flows. That separation is what keeps appreciation
from becoming a price.

---

## 3. How a village is shaped

Five planes. Knowing which one a change belongs to is most of understanding the
system.

| Plane | Holds | Where |
|---|---|---|
| 1. **Behaviour** | how much, how often, which mode | `shared/gameVariables.ts`, DB stores only changed values |
| 2. **Identity** | names, images, personas, copy | the `brand` document, via the Setup Wizard |
| 3. **Modules** | which parts of the game exist, and their lifecycle | `module_settings` |
| 4. **Documents** | keyed JSON: launch state, email config, content | `app_config` |
| 5. **Secrets** | integration credentials | write-only, masked on read |

A **module lifecycle** is `off | preview | members | public`. Absent means off.
Dependencies are enforced, and a module cannot be switched off while value is
outstanding inside it: settle first.

**One capability gate** decides what anyone may do, and it is evaluated in a fixed
order: admin, then a warning badge's deny, then role, then badge grant, then
progression stage. A deny beats a role. Nothing is gated anywhere else, which is
why there is exactly one place to read when a permission surprises you.

---

## 4. What a village keeps, and what it never does

The rules below are enforced mechanically, asserted at boot, or both. They are the
reason a village's numbers mean something, and they do not bend for a feature.

- **Conservation.** For every token, balances across all accounts sum to zero. The
  server refuses to boot if that is ever false.
- **Fiat flows in only.** Tokens are never sold for money. The exchange is
  buy-only, so the extraction door does not exist to be walked through.
- **Caps fail closed.** Zero means zero, never unlimited.
- **Land is described, never tokenized.** The platform can record tenure and has
  no path to transfer it.
- **Settlement is human.** A scheduler may prepare, and only a person releases.
- **Nothing about a member leaves the village.** Not to peers, not to the platform
  team, not through the feedback relay, which sends content and never who wrote it.

---

## 5. Maia: the guide

Maia reads two brains and writes nothing directly.

**The shared brain** ships with the platform and is identical in every village:
distilled practitioner literature (sociocracy, governance, conflict, membership,
legal structures) plus the contracts for the modules that have one. It is counsel.

**The village brain** lives inside one village and never leaves it. Two shelves:

- **The brief**: what this village is for. Its aims, its land, its people, the
  work that has to happen, how decisions get made, its red lines. Seeded from the
  application, completed in conversation, confirmed section by section.
- **The record**: what has happened since. Call syntheses, decisions, closed
  cycles, and the questions members asked that nothing could answer.

**One rule orders them**: what this village said about itself outranks the
literature, and what is live in the database outranks both on questions of fact.
She cites which one each recommendation came from.

She reads live state through **named readers**, never SQL. Each reader declares
the module it needs, the capability it needs, and its audience, and it is checked
against the same gate the HTTP routes use. A reader the asker cannot use is never
described to her, so she cannot offer it and then fail.

She writes **drafts**. A proposed role or circle lands in a queue with its
reasoning and the brief section it cites. A human edits and accepts, and accepting
runs the same code the admin form runs. If a proposed role asks for a power no
existing role has, that escalation is confirmed one item at a time in plain
language ("this role could hide forum posts"), and anything left unticked is
stripped from what gets created.

She is bounded on purpose: she recommends turning a module on and never turns one
on; she proposes the fewest seats that cover the stated aims and says so when a
village is being asked to hold more structure than it has people for.

---

## 6. Integrating with a village

This section is for another system or model that wants to read or act on a
village. **Everything here is HTTP and JSON over the village's own domain.** There
is no SDK and no central API.

### 6.1 Public, no authentication

These answer to anyone. They are how a village is discovered and understood from
outside.

| Endpoint | Gives you |
|---|---|
| `GET /.well-known/village.json` | **Start here.** The discovery root: `protocol`, `instanceId`, name, tagline, location, platform version and build, the village's **public signing key**, which document types it `supports`, `links` to everything else, and every module with its lifecycle |
| `GET /api/public/org.json` | The org chart: circles and seats, **signed**, with an `updatedAt` |
| `GET /org/index.md` | The same org chart as linked Markdown with YAML frontmatter, for a human or a model that would rather read than parse |
| `GET /api/game/mechanics` | The village's rules as data: every behaviour variable with its bounds, default, current value, who may change it, and when a change takes effect. Plus the constitution and which modules are running |
| `GET /api/platform/info` | The v0 handshake. Kept answering forever; prefer the well-known document |
| `GET /api/network/published` | Needs and offers this village has chosen to publish |
| `GET /health` | Liveness, the running build marker, and the verdict. `200` with `status: "ok"` means the village answered a `SELECT 1` through its live pool; `503` with `status: "degraded"` and a `database.error` in plain words means it did not, and the village is up but cannot serve members. `uploads` is a volume gauge and never part of the verdict |

**Branch on `supports`, never on version ordering.** A village that disabled a
module is differently shaped, not older, and semver cannot say that.

**Verify signatures, do not trust the transport.** Published documents carry a
detached `proof` (`alg`, `kid`, `signedAt`, `signature`) and the matching public
key is in the well-known document, as both base64url and PEM. That matters
because a cached or relayed copy has no TLS connection to vouch for it: the
signature is what survives being handed around.

`GET /api/game/mechanics` remains the most useful single call for deciding what
kind of village this is, in numbers, without asking anyone.

### 6.2 Authenticated, as a member

Everything else requires a session belonging to a member, and every route is
evaluated against the one capability gate. **An integration has exactly the reach
of the member it acts for**, which is the property that makes it safe to grant.

The most useful for a model:

| Endpoint | Gives you |
|---|---|
| `GET /api/village/brain` | The village's own understanding, **as markdown**, audience-filtered, with an ETag. Add `?section=index` for the map of what is known and what is still blank, or `?section=<id>` for one part |

That endpoint exists because a markdown document is the most portable thing a
model can be handed. Each section carries frontmatter saying how far to trust it:

```markdown
---
section: work
status: confirmed
source: session0
confirmed_by: rye
updated_at: 2026-08-14T09:22:00Z
---
# What has to happen here

Water lines get walked every Monday...
```

`status: proposed` means a human has not confirmed it yet. Treat a proposed
section as a draft and say so when you use it.

### 6.3 The shape to follow if you build on this

Three rules the platform holds itself to, and which any integration should inherit:

1. **Read through named views, never raw SQL.** Every consent rule in this system
   lives in the application layer: module state, capabilities, warning-badge
   denies, and the line that keeps example fixtures out of anything that reads as
   fact. A query that goes around them is correct SQL and a wrong answer.
2. **Write through a draft.** Propose, let a human accept, and let the accept run
   the same code a person clicking the form would have run. An agent that writes
   directly is a liability a community accepts once.
3. **Say which actor you are.** Events carry `actor_kind` of `human`, `agent`,
   `system` or `peer`. The first time a village dislikes something an integration
   did, someone has to be able to name which one and revoke exactly that one.

### 6.4 Village to village

Villages federate by **pull, never push**. Each publishes a plain JSON document;
each chooses which peers to read; a scheduled sync caches what it finds. No
central registry, no login between villages, no village that is a runtime
dependency of another. A peer's identity is learned at handshake and re-verified
every sync, because domains change hands and uuids do not.

Cached peer content is **untrusted display text authored by another deployment**.
It is never a fact about your village.

### 6.5 What a village will not do for you

- Hand over member data. There is no endpoint for a roster, and seeing who holds
  which seat is its own capability.
- Accept a write without a human in the loop.
- Let an integration hold a permission the member it acts for does not have.
- Join a registry, or depend on one to keep working.

---

## 7. Running your own

The short version; `START_HERE.md` at the repository root is the guide and
`FORK_RUNBOOK.md` the long reference.

Run the published image, pinned to a release (`ghcr.io/rieki777/village-os:1.2.0`),
on one machine with `docker-compose.yml` or on a hosting provider such as
Railway, with `DATABASE_URL` set. Nobody needs access to the repository for
that; a village forks it only to change the code. Migrations run at boot and fail
loudly if anything is wrong, so a village never serves over a broken schema. The
four core modules are on; everything else is off until you turn it on. Brand and
copy come from the Setup Wizard, so no code change is needed to make it yours.

You own the code, the data and the keys. AI features cost nothing until you add
your own Anthropic key; a deployment may be lent a platform key while it is being
built, and moving to your own is a launch item precisely because a borrowed key
can be rotated by someone else.

---

## 8. Glossary

| Term | Means |
|---|---|
| **Village** | one deployment: one process, one database, one community |
| **Circle** | a domain of work |
| **Role** | a seat inside a circle, held by a member, carrying capabilities |
| **Quest** | a unit of work, claimed and consented to |
| **Gratitude** | recognition sent between members; a signal, not a payment |
| **Cycle** | a lunar period; value settles when one closes |
| **Capability** | a permission key, granted by role, badge or stage |
| **Module** | an optional part of the game, with a lifecycle |
| **The brief** | what this village says it is for |
| **The record** | what has happened here since |
| **Draft** | something the assistant proposes and a human accepts |
| **Peer** | another village this one has chosen to read |

---

## 9. Status, honestly

**Built and running.** Everything in sections 1 through 6.2: the modules, the
ledger, the capability gate, the brain and its markdown endpoint, the reader
registry, the draft queue, and the assistant. Plus the first layer of the
protocol: `/.well-known/village.json` as a discovery root, an ed25519 key minted
at first boot, and a signed org chart published as both JSON and Markdown.

**Designed and not yet built.** An MCP mount over the same reader registry,
per-agent tokens, a cursored public event feed, portable role attestations, and
the single signed inbound door. `COORDINATION_SUBSTRATE.md` argues for those and
the order to build them in.

**What that means for you today.** Discovery and the org chart are real and
verifiable without an account. Everything else about a village still needs a
member's session over plain HTTP. Nothing yet lets an outside system WRITE to a
village except through a human, and that is deliberate: the write path is being
built draft-first on purpose, not deferred by accident.

This section dates faster than the rest of the document. The well-known
document's `supports` array is the machine-readable version of it, and it cannot
go stale, so trust that over this paragraph.
