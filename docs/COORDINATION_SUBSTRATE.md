# The Coordination Substrate: from one village to a civilization

Date: 2026-08-02
Companion docs: `PEERDOM_LESSONS.md` (what a mature org-mapping product teaches),
the 2026-08-02 role-model fix list (the first change this argues for, an internal note, in the maintainers' private operations repository since 2026-10-02),
`ARCHITECTURE.md` (the as-built system), `modules/village-map.md` (the map module contract).

This is the argument for what game-amora is for, what it has to become, and the order to build it in.
It is written to be disagreed with in specifics and followed in shape.

---

## 0. The claim

A civilization does not get structured on top of a platform. It gets structured on top of a protocol,
and a protocol only earns adoption if the thing publishing it was already worth running alone.

That gives two conditions, and both have to hold:

1. **One village genuinely runs on this.** Not demos on it. Runs on it, for years, with the founder on
   holiday, with the structure staying true because staying true is a side effect of things people
   cannot avoid doing.
2. **N villages compose without a center.** No shared database, no registry anyone must join, no
   village that is a runtime dependency of another, no currency whose failure propagates.

Almost every coordination project dies on condition one and then never gets to test condition two.
The ones that skip straight to condition two build a federation protocol for a network of one.

So the sequence is fixed: make Amora real, make Amora legible, then let legibility federate. Everything
below is ordered by that.

---

## 1. Where this actually stands

Being honest about the starting point changes what to build.

**Amora in August 2026 is not thirty people in a garden.** It is roughly ten distributed people
building a village nobody lives on yet, coordinating in WhatsApp, Google Sheets, and Zoom, across two
countries and two languages, with 24 role cards where most seats read Open, Forming, or Partially
Filled. Any design aimed at the garden phase will sit unvalidated for two years.

**What is already here, and is genuinely rare:**

- A conservation-checked double-entry ledger. `SUM(balance)` per token is zero, asserted at boot, not
  in a comment. Faucet negative balance is issuance-to-date for free. `token_balances` is a cache that
  recomputes and never increments. Most community-currency projects never build this.
- Settlement as a human act. `POST /api/admin/cycles/close` is the only path, and the scheduler's
  charter forbids a job from doing it. That single rule is the anti-gamification mechanism.
- One capability gate. `hasCapability()` with a fixed order of authority, published to members as law
  in `shared/constitution.ts`, evaluated only on the server, with the client rendering booleans it was
  handed. There is no second permission path to port or defend.
- A module lifecycle that is real: `off|preview|members|public`, absent row means off, hard-dependency
  demotion recomputed at boot, and an `openStateCheck` that refuses to disable a module while value is
  outstanding.
- Fork-per-village deployment. Each village owns its database and its domain. This is the property that
  makes everything downstream possible, and it was not free.
- The Hypha boundary, enforced in three places: deep-link-only URLs, one bridge module for
  action-bearing links, and a ledger that refuses to move a `governance:'hypha'` token and refuses to
  boot if one ever acquires a row.
- The concierge as a demand sensor. Unmatched queries are logged, so the questions nobody can answer
  become the evidence for which seat the village is missing. Peerdom's map displays supply only. This
  is the most original idea in the product and almost nobody has noticed it yet.

**What is missing is the governance object.** Everything that currently governs is one of three weak
forms:

- a permission bag (`roles.capabilities`: may this account press this button, anywhere, forever),
- a brochure (24 role cards with aim, domain, accountabilities, and holders as free-text name strings,
  in an editable JSON document that overwrites itself on save),
- a proclamation (`POST /api/forum/threads/:id/decide` lets any holder of `proposal.decide` write an
  outcome string and lock the thread: no proposal record, no affected set, no round, no objection, no
  domain check).

That third one is the precise shape of governance theater. The artifact of a decision with none of the
process that legitimates it. `server/lib/health.ts:governanceReads()` already half-knows, promising in
a comment that an objection rate trending to zero is a warning, for data that does not exist.

The fix is four tables, not a framework.

---

## 2. Layer one: the village that can govern itself

Five objects the schema does not have, in dependency order.

### 2.1 Assignments, so a holder is an account

Covered in full by the 2026-08-02 role-model fix list (an internal note, in the maintainers' private operations repository since 2026-10-02). Everything else here is blocked on it.
The short version: `org_roles` carries the work (aim, domain, accountabilities, circle, seats), and
`org_role_assignments` carries the seating (user id or a documented name, a focus string, a start, an
end, a reason). Seat state is derived from active assignments against seats, never hand-typed.

The focus string is the field that costs one column and solves the thing textareas were invented to
work around: three people hold Land Steward for three different pieces of land, and each one's slice is
readable.

### 2.2 Domains, so authority is scoped and revocable

```
domains(id, name, description, owner_kind enum('circle','role'), owner_id,
        parent_domain_id, delegated_by_circle_id, delegated_at, revoked_at,
        escalates_to_domain_id)
```

`capabilities[]` answers "may this person press this button". It never answers "what may this seat
decide alone". Those are different questions and only the second one is governance.

Migrate the free-text `domain` paragraph on each of the 24 cards into rows. One paragraph becomes three
to six domain rows. Revocation is a new row with `revoked_at` set on the old one, never an edit, so the
history survives.

Then `GET /api/authority/resolve?topic=irrigation` walks the tree and returns the holder, the escalation
path, and the circle that delegated the authority.

This is the primitive that lets a founder let go **incrementally**. A village can withdraw a domain from
a role without removing a person from a seat. Nothing else in the schema can express delegation at all,
which is why founder release currently has exactly one available move: all at once, or never.

### 2.3 Objections, so consent is a process and not a word

```
proposals(id, thread_id, domain_id, class, title, body, proposer_id, notice_ends_at, status)
consent_responses(proposal_id, user_id, position enum('consent','concern','objection','abstain'), ground, at)
objections(id, proposal_id, raised_by, ground, status enum('open','integrated','withdrawn','ruled_out_of_domain'),
           integration_ref, resolved_at)
```

Consent is defined by what happens to objections, not by what the decider writes at the end. Replace the
body of `/api/forum/threads/:id/decide` with a guard: no decision may be recorded while an objection on
that proposal is `open`. The forum thread stays the conversation. The proposal becomes the governed
object.

Recording the **ground** (why this harms the circle's aim) and an **integration reference** turns
disagreement into recorded learning. It also finally supplies the objection-rate data
`governanceReads()` already claims it can interpret.

**Decision classes** keep this from becoming ceremony:

| Class | Ceremony | Route |
|---|---|---|
| `operational` | one person decides inside a stated domain | logged to the events spine, challengeable for N days by anyone in the domain |
| `policy` | changes a rule, domain, role, or budget line | consent round in the owning circle |
| `constitutional` | changes how decisions are made, or moves treasury | the existing Hypha on-chain vote |

Villages die of too much ceremony as often as too little. Consent-for-everything is the fastest known
way to make a village decide in a side channel, which destroys the audit trail that was the point.

### 2.4 Terms, the highest-value single column here

`term_ends_at` on every assignment, plus a light selection record: `selections` and `nominations` with
written reasons, no ballot machinery. A scheduler sweep opens re-selection N days before expiry and
emits `role.term_expiring`. Past the date the map shows "expired, still acting".

**Never auto-revoke.** Real villages miss re-selections during harvest and construction, and a hard
cutoff means the water system has no steward on a Tuesday for reasons nobody chose. Show the lapse
loudly, flag it on the map, nag the circle, leave the keys.

Terms matter more than they look. Without them, correcting a bad fit requires a confrontation.
Communities avoid confrontation. Seats calcify. That is the actual mechanism by which founder
dependency forms. With terms, removal becomes non-renewal: scheduled, low-drama, face-saving.

Amora has three of these cases live right now. Ky is interim on Business Development. Lexi is a
candidate and not a holder for Chief of Staff. Land Steward is held off-land for this year. Nothing in
the system knows any of that.

### 2.5 Policies, sanctions, grievances, membership

Four more, each small:

- **`policies`** with `review_due_at`. Copy the pattern `mechanics_changes` already proved for game
  variables, extend it to land use, money, membership, guests, animals, conduct, construction. Review
  dates matter as much as the text: they are what stops a village accumulating dead rules nobody wants
  to be the one to repeal.
- **`sanctions`** with graduated kinds and automatic expiry, and one added check inside
  `hasCapability()`: an active sanction subtracts. Today the ladder is nothing, then involuntary exit.
  A binary sanction means small harms go unaddressed until they justify expulsion, and the expulsion
  then looks arbitrary. A two-week suspension of one capability with a written ground and an automatic
  lift is proportionate, appealable, and self-clearing.
- **`grievances`** with a router that computes access at raise time and **structurally excludes** the
  subject, the subject's circle chain, and anyone holding a founder-class role. If exclusion leaves
  fewer than three people, it routes to a named external ombuds configured per village. Content lives
  outside the row as a pointer, exactly as `exits.agreement_ref` already does. The universal failure of
  intentional communities is that the grievance goes to the founder and the grievance is about the
  founder. Only a router that can structurally exclude, and that can admit when a village is too small
  to adjudicate itself, addresses that.
- **`memberships`**, separated from the progression engine. Today `computeStage()` decides who counts
  as a member, and `mechanics_proposals` lets any member propose moving `progression.quests_for.member`.
  That is a live governance-capture surface: whoever tunes the game tunes the electorate. Governance
  rights read membership class. Game rights keep reading computed stage. Splitting them closes the
  path.

### 2.6 What the village owes a member, as schema

`GET /api/me/governance-record` returns every row where the member is the subject: role history with
terms and how each ended, domains held and revoked, proposals opened, objections raised and how they
resolved, sanctions with grounds and expiries, grievances they are party to, and their exit settlement
if one is open. Exportable as Markdown.

Paired with a public `GET /api/authority/who-decides?topic=` that needs no login.

Those two endpoints are the machine form of three rights: to know who decides what, to see your own
record, and to leave with a statement of what you are owed instead of a negotiation. They cost almost
nothing once the tables exist, and they are the difference between a community that can be trusted with
a decade of someone's life and one that asks to be.

### 2.7 The power map

Extend `governanceReads()` past decision-authorship concentration to: capabilities held by exactly one
member, share of assignments granted by one person, domains whose escalation chain terminates at one
member, decisions-per-domain concentration, roles with no named successor, and the objection rate with
its silence warning.

Publish per-metric, with honest nulls, **never as one composite score**. Villages optimize whatever
number is displayed, and a composite goes green while objections fall to zero and the founder decides
everything, which is the exact failure the existing code comment warns about.

Then the drill: a scheduled window where a founder's capabilities are voluntarily suspended using the
sanctions table, and the village counts what stalls. Every community says it is reducing founder
dependency. A drill produces evidence.

---

## 3. Layer two: the village that maintains itself

A perfect governance schema that nobody updates is a worse lie than no schema, because it has
timestamps.

The rule: **nobody is ever asked to update the structure.** It is repaired as a side effect of acts
people cannot avoid.

**The weekly ping.** One message per member per lunar week. Three lines: the seats you hold, up to three
open items attributed to those seats, and one link pair, "still mine" or "hand it back". A tap writes
`seat.confirmed` or `seat.released`. Nothing else in the message. No digest, no newsletter, no unread
badge. This is the entire maintenance mechanism, disguised as a four-second yes-or-no. Its response rate
is also the best available leading indicator of abandonment.

**Derived staleness.** Confirmed inside one lunation means held. One to three means quiet. Over three
means stale. No holder means open. The manual status dropdown survives only as an override with an
expiry that lapses back to derived. A hand-set status is a lie with a timestamp of whenever someone last
cared, and the 24 cards that were correct on 2026-08-01 will be wrong by October.

**The wedge is "who do I ask about ___".** One box, one answer, one message button through the existing
privacy-respecting relay, answerable **without an account** for the public-safe subset. This is the only
surface with real single-player value: useful to one person when nobody else is participating, useful to
a visitor with a pasted link, useful on a phone with one bar. Requiring login here loses the visitor,
the applicant, the contractor, and the investor, who are exactly the people whose questions reveal the
holes in the chart.

**Unmatched queries write the to-do list.** Render `conciergeLog(unmatchedOnly)` in Admin as a ranked
queue: "seven people asked who handles water this month, no seat matched." Two buttons: attach these
words to an existing role's domain, or create an open seat pre-titled from the query. This inverts who
does the thinking. Reality audits the chart, and the fix is one click.

**Must-use surfaces repair what they depend on.** Bookings and money are the only acts a village cannot
route around. When a stay is booked and the hosting seat is open or stale, the confirmation flow surfaces
an inline "no one currently holds Campground and Events, who is hosting this?" with a one-tap claim.
Block nothing. Attach five seconds of repair to something unavoidable.

**Calls become seat-tagged tasks.** Amora already holds these calls and already loses the outputs to a
Google Doc nobody reopens. Tag action items to a **seat**, never a person. Items whose seat is open route
to the circle lead with "claim this seat" instead of "assign to someone". That forces the question "who
owns this" once per call, which is the structure maintenance you would otherwise have to beg for.

**WhatsApp is transport, not competitor.** It is bilingual, instant, has everyone in it, and it will
still be there in three years. Give every entity a short stable URL and a share action. Ship a weekly
plain-text block under 900 characters that a human pastes into the group. Every link is a session that
starts already signed in. Hours spent building a competing chat are hours not spent being the thing that
gets linked into the one that exists.

**Ship most of the product turned off.** Forty-seven pages is forty-seven empty states for a ten-person
team, and empty states teach people the tool is dead. A fresh fork should boot with roles, circles, ask,
feed, forum, and stays. Everything else off. Move one village's brochure pages out of `client/src/pages`
into content-driven pages so the platform stops shipping Amora's marketing as code. And seriously
consider deleting the eight aspirational councils from the seed: every member who reads a council that
does not exist learns that this chart describes intentions, and once that belief lands, nobody bothers
correcting the parts that were supposed to be real.

---

## 4. Layer three: the village that publishes itself

The interop layer that survives is a folder of signed, cacheable documents at predictable URLs. Not an
API other villages call.

`server/lib/network.ts` already made the right bet once, with a comment naming "the same posture as
RSS", and then stopped one level too low: discovery is hardcoded to `/api/platform/info`, the handshake
refuses anything whose platform string is not `custom-game-foundation`, and the only published payload
is a blob of needs and offers. So only forks of this exact repo can ever federate.

### 4.1 The discovery root

`/.well-known/village.json`, unauthenticated, mounted before every module gate, `Cache-Control: public,
max-age=300`, CORS open.

```json
{
  "protocol": "village/1",
  "kind": "village",
  "instanceId": "...",
  "name": "...", "tagline": "...",
  "location": { "label": "...", "lat": 0, "lon": 0, "precision": "town" },
  "platform": { "name": "...", "version": "...", "build": "..." },
  "publicKey": { "alg": "ed25519", "kid": "...", "multibase": "..." },
  "supports": ["org/1", "events/1", "attest/1", "inbox/1"],
  "links": { "org": "...", "orgMarkdown": "...", "events": "...", "decisions": "...",
             "network": "...", "inbox": "...", "mcp": "...", "humanHome": "..." },
  "modules": [{ "id": "map", "lifecycle": "public" }],
  "chain": { "caip2": "eip155:8453", "dho": "...", "contracts": {} },
  "policy": { "acceptsPeers": true, "license": "..." }
}
```

Links are data, so a Peerdom organization, a bioregional council, or a hand-written static JSON file can
participate. That is the line between a product with a multi-tenant feature and a protocol. Keep
`/api/platform/info` answering forever as the v0 fallback.

**Consumers branch on `supports`, never on version ordering.** A fork that disabled a module is not
older, it is differently shaped, and semver cannot express that.

### 4.2 A signing key, minted at first boot

Same `INSERT IGNORE` pattern that already mints `instanceId` in `server/lib/identity.ts`, for an ed25519
keypair. Public key and kid go in the well-known doc. Every published document gets a detached signature
header and an in-body proof block, so a cached or relayed copy still verifies.

Roughly 120 lines, and it is the one thing that is genuinely painful to retrofit once other villages
already trust unsigned payloads. Without it, every downstream capability (attestations, the inbound
inbox, hub relay auth, cross-village role claims, mirrored documents) is authenticated only by TLS to
the origin, which evaporates the moment a document is cached or handed to an agent.

### 4.3 The org chart as linked Markdown plus a JSON twin

`GET /api/public/org.json`, and a Markdown mirror at `/org/index.md`, `/org/roles/<slug>.md`,
`/org/circles/<slug>.md`, `/org/people/<handle>.md`. YAML frontmatter with a stable id, type, slug,
`updatedAt`, and relative links to related nodes.

This is Peerdom's OKF idea, and it is the highest-value agent-readability move in the system **because
it needs no second village to pay off**. A founder points an agent at one URL and gets the entire
organization with zero integration. A funder reads it. A partner village reads it. It is also the thing
that makes vacancy and role concentration computable instead of eyeballed.

It also disciplines the schema: anything that cannot be exported as a sentence a member understands is
probably not modeled as governance yet.

### 4.4 A cursored, append-only public event feed

`GET /api/public/events.json?since=<cursor>&limit=100` over `health_events` filtered to
`audience='public'` and `is_example=0`. `recentEvents()` is already most of it. Stable opaque cursor,
`nextCursor` in the envelope, plus an Atom mirror at `/feed.xml`.

Enforce a namespaced kind taxonomy declared in `shared/` and validated at `recordEvent()` call sites.
Today `kind` is a free varchar with no registry, which means a new kind is invisible to the feed weave
that hardcodes five values.

Peers, the hub, a bioregional dashboard, and any agent all want the same primitive: what happened here,
since when. Serve it once and you never build another bespoke pull endpoint. It also turns peer sync
from "refetch everything from everyone forever" into a delta, which is the difference between five peers
and five hundred.

### 4.5 Identity travels as attestations the person carries

When someone holds a role or a membership, the village can issue a signed credential downloadable from
their own profile:

```json
{ "type": "RoleHolding", "issuer": "did:web:amora.example",
  "subject": "did:pkh:eip155:8453:0x...", "role": "https://amora.example/org/roles/water-steward",
  "since": "...", "until": "...", "proof": { "alg": "ed25519", "kid": "...", "sig": "..." } }
```

The subject comes free from the wallet challenge verification `drizzle/0025_wallet_verification_and_onchain_cache.sql` already ships, with a
`did:web` fallback for members with no wallet. A receiving village verifies against the issuer's
published key and decides for itself what that is worth. Add a public revocation list.

**This is the whole answer** to how identity, membership, reputation and roles travel when a person moves
or holds seats in two villages: without a shared user table, without cross-village login, and without any
village depending on another's uptime. The person is the transport.

### 4.6 One signed inbound door

`POST /api/public/inbox` with an intent envelope, authenticated by the sending village's signature
against its published key, rate-limited per instance, size-capped, with a server-side allowlist of types
exactly as `SHARED_ITEM_TYPES` already does: `contact.role`, `offer.response`, `visit.request`,
`peer.invite`, `resource.request`. Everything lands in an approval queue for the relevant seat holder.

This is how an agent or a village **does** something across villages instead of only reading. It keeps
the inbound attack surface to exactly one countable endpoint, it reuses the map module's contact relay
instead of exposing people, and it generalizes: co-hiring, resource pooling, guest referral and shared
events are each one allowlisted type plus a renderer.

### 4.7 MCP: read-rich, write-narrow

Mount `/mcp` in the same Express app. Read tools map one-to-one onto documents that are already public.
Write tools are exactly four, and every one lands in an existing human-approval queue: submit feedback,
propose a quest as a draft, post a need into the admin publish queue, open a forum thread. Auth is a
per-agent bearer token bound to a member id, revocable, scoped by the same `Capability` keys as the HTTP
routes.

An agent that can only read is a search engine. An agent that can write directly is a liability no
village accepts twice. Routing agent writes through the draft-and-approve shapes that already exist
means agent participation inherits every consent gate the humans built, and turning agents off is one
token revocation.

Then add `actor_kind enum('human','agent','system','peer')` to `health_events`. The first time an agent
does something a village dislikes, someone must be able to answer which integration did it and revoke
exactly that one. Cheap now, impossible to backfill later.

### 4.8 The hub is a crawler, never a server

The ReGen hub keeps a list of village base URLs, crawls each well-known doc and event feed on a schedule,
and publishes one aggregate document back. Villages optionally subscribe to that URL for peer discovery.

**A directory is not a dependency.** A village that never talks to the hub keeps working. A bioregion can
stand up a competing directory with the same crawler and nobody has to permit it. The moment
participation requires a hub account, the hub is the product and every fork is a tenant, which is the
failure mode this entire architecture exists to avoid.

### 4.9 The recursion

Add `kind: "village" | "bioregion" | "network" | "org"` to the well-known doc, and a `members` link that,
for a bioregion, lists member village URLs instead of people.

A bioregional body runs **the same fork** with the people-shaped modules off, subscribes to N village
event feeds, and republishes an aggregated feed and org chart of its own. No new entity type, no new code
path, no new tables.

Village to bioregion to movement to civilization composes only if the higher level is an instance of the
same thing. Recursion in the protocol means the aggregation layer is testable on day one with two forks
on a laptop, and a bioregion can itself be a member of a larger network without anyone writing a third
tier.

---

## 5. Layer four: the economics that let it compose

The valuable asset here is the ledger, and its limitation is that only people and system pools can hold
accounts.

**Open the account kinds.** Extend `ledger_accounts.kind` to `circle`, `role`, `land`, `peer`. Posting
rules do not change: still no overdraft outside faucets, still recompute-never-increment, still
conservation-checked. Every economic idea below then becomes an entry instead of a subsystem. Circle
budgets, role provisions, land cost centres and inter-village positions are all transfers between
accounts that already have idempotency and audit.

**Provision, not piecework.** `role_provisions` funds a seat per cycle from its circle's account, posted
at cycle close, in the same human-settled step. Vacant seats post nothing, so an unfilled role costs zero
and the unspent budget stays visible in the circle account.

This is the only accounting shape for care work that does not corrupt it. You pay for **holding a
domain** over a lunation, never for units of emotional labour delivered. Bounded work keeps its bounty at
consent, which quests already do. The two tracks never merge.

**Three columns that refuse to add up.** Per member per cycle: bounded work delivered, domains held, and
recognition breadth (distinct senders, never amount). No total, no sort-by-composite, no export that
concatenates them. Sensorica's contributory accounting broke on exactly this: one index makes people
optimize the cheapest measurable input, and the cheapest input is never the care.

**Bilateral mutual credit between villages, with a goods basket as the unit.** `peer_credit_lines` and
`peer_obligations`. Trade against a cached need or offer creates an obligation on both sides; settlement
posts one local transfer against the `peer:` account in each fork. Conservation stays local. The peer
account's balance **is** the bilateral position.

The unit of account is a small versioned basket defined in goods (an hour of general labour, a guest
night, a kilo of staple food). Each village posts its own token price against the basket. Villages trade
without agreeing on a currency, the unit is inflation-proof by construction, and there is no reserve, no
bridge token, and no clearinghouse. This is the Sardex and WIR shape, which is the only community-currency
architecture with a multi-decade survival record. Later, an advisory multilateral netting pass finds
cycles in the obligation graph and proposes a clearing set that each village confirms for itself.

**Land is tenure, never a token.** `land_parcels` and `tenure_records`, describable in-app, with no
transfer endpoint and no parcel token slug, boot-asserted the same way Hypha-governed tokens already are.
Land equity is precisely where extraction re-enters a regenerative project, and the only defence that
holds is structural: the platform can describe tenure and can never move it.

**Patient capital returns use-value.** `capital_notes` whose redemption schedule is denominated in basket
units or credits, redeemed from treasury on schedule. Because tokens are never sold for fiat, the note
structurally cannot round-trip into a financial return. This codebase is one of very few where
non-extractive is enforceable instead of aspirational, because the buy-only exchange means the exit door
does not exist.

**Capital routes on a signed health attestation.** `GET /api/network/health-attestation`: the last twelve
lunations of frozen `health_snapshots`, filtered to ratios and latencies only, signed, with a Markdown
mirror. Because snapshots are unique per cycle and metric, written once at close, and the attestation is
signed over frozen values, retroactive prettying is detectable.

A fund then publishes offers whose eligibility is a machine-readable predicate over metric keys
(settlement latency under five days for three lunations, role vacancy share under 0.3). Each village
evaluates the predicate against its **own** attestation and sees either "you qualify" or "here is the one
metric you do not meet, and its current value".

That converts fundraising from persuasion into maintenance of coordination health. The fund stops
selecting for pitch quality, which is a selection for founder charisma, which is the exact trait that
has historically pulled land projects toward extraction.

**Concentration reads stay inward.** Recognition and role-holding concentration go on the village's own
dashboard in plain language, and are hard-excluded from the published attestation by a `publishable:
false` flag in the metric registry. Visible inward, concentration prompts redistribution. Visible outward,
it becomes a score to manage, and villages start staging breadth.

---

## 6. The civilization claim, stated precisely

What actually composes, and what does not:

| Composes | Does not compose |
|---|---|
| Signed documents at stable URLs | APIs other villages must call |
| Attestations the person carries | A shared user table or cross-village login |
| Bilateral credit lines in a goods basket | A movement-wide currency |
| Local ratification of a delegate's written mandate | A federation that decides for its members |
| A crawler over voluntarily published URLs | A registry villages must join |
| The same fork running at a higher `kind` | A separately built aggregation tier |

Ostrom's principles, mapped to rows:

| Principle | The schema |
|---|---|
| Clearly defined boundaries | `memberships`, separated from the progression ladder |
| Rules matched to local conditions | `policies` with `review_due_at`, per village |
| Those affected participate in rule-making | `proposals` + `consent_responses` scoped by `domain_id` |
| Monitoring by accountable monitors | the events spine with `actor_kind`, plus role-tagged evidence |
| Graduated sanctions | `sanctions` with kinds, grounds, and automatic expiry |
| Accessible conflict resolution | `grievances` with a router that structurally excludes |
| Recognized right to organize | fork-per-village: each one owns its database and domain |
| Nested enterprises | the protocol recursion, village inside bioregion inside network |

Eight principles, eight tables or properties, none of them exotic. That mapping is the actual claim of
this document: a civilization-scale coordination substrate is not a new science. It is a small number of
well-chosen rows, published honestly, composed without a center.

---

## 7. What must never be built

Consolidated, because each one looks correct from inside its own lens.

**Governance**
- Full Holacracy. A village will not run it, and half-run Holacracy produces governance theater with
  better vocabulary plus a permanent class of people who "do not understand the process".
- Everyday decisions on chain. Latency, gas, and a wallet requirement on decisions that need a
  five-minute conversation, and the village is back in WhatsApp within a month.
- Token-weighted governance. Governance rights attach to membership class, never to balance. The
  buy-only exchange makes this worse, since fiat flows in.
- Auto-revoking authority at term expiry. Show the lapse, nag the circle, leave the keys.
- Gating the right to object behind a progression stage. Objection right follows domain membership.
- Anonymous grievances by default. In a forty-person village an anonymous complaint is unresolvable,
  unfalsifiable, and trivially weaponized.
- A single composite governance health score.
- Treating the org-chart content JSON as the org chart. It is a brochure that overwrites itself on save.

**Protocol**
- Cross-village single sign-on or a shared user table. It makes every fork a runtime dependency of every
  other fork.
- ActivityPub. Push-based, so every village needs inboxes, retries, dead-letter handling and blocklists
  staffed by an operator, with a social-post-shaped object model and imported moderation obligations.
- Putting the org chart, membership, or roles on chain. Chain earns exactly three things: mechanics vote
  outcomes, token supply, and the claim bridge.
- Real-time push between villages. Coordination between villages moves at the speed of consensus.
  Six-hourly pull with cursors is the correct sampling rate.
- CRDTs or shared mutable state. A contradiction between two villages is a disagreement between sovereign
  parties, which is a governance problem and not a merge algorithm.
- Requiring any additional daemon: an IPFS node, a relay, a key server, a queue. Each one is a village
  that silently drops off the network in month four.
- Free-string types on the wire. Every document and intent type is allowlisted server-side.
- Trusting `peer_shared_cache` as fact. It is untrusted display text authored by another deployment.
- Making the MCP server a second permission system.
- Building the protocol before village two exists. Every published document must have a same-village
  payoff on day one.

**Economics**
- A movement-wide currency. One village's governance failure or one whale's accumulation propagates into
  every other village.
- A single contribution score or impact index.
- Pricing care work per hour or per task.
- Publishing volume metrics in the attestation. Any metric a village controls and benefits from inflating
  will be inflated. Ratios, latencies and floors are far harder to fake, because faking them requires
  actually coordinating.
- Per-person public leaderboards of recognition or tokens earned.
- Tokenizing land or fractionalizing tenure.
- Auto-settling gratitude cycles with a cron.
- Giving the fund raw event streams or member-level data for diligence.
- Denominating patient-capital returns in fiat.
- An admin "recompute health snapshots" button. Snapshots are frozen because point-in-time facts are
  unrecoverable, and a backfill path against a funding criterion is a corruption vector with a friendly
  label.

**Adoption**
- Paying tokens for structure maintenance. It produces updates, and not true updates, and it poisons a
  ledger whose whole value is that its entries mean something.
- Trying to replace the WhatsApp group.
- An onboarding wizard that asks a village to configure before it has used anything.
- Role-to-role private feedback in a ten-person team. It will be used twice, by the person with the most
  authority, about the person she is currently frustrated with.
- Insights analytics over 24 roles and eight active people. That is astrology with a dashboard. Exactly
  one derived number is worth showing at this scale: how concentrated activity is in the top actor.
- Drafts and sandboxed reorganization at this size. Right for a 300-person company reorganizing
  quarterly. Amora restructures once a year in a conversation.
- Seeding aspirational structure.
- Push notifications before the loop exists.
- Confusing shipped with adopted. The audit docs verify that pages render and APIs return 24 cards. None
  of that is evidence anyone opened them twice.

---

## 8. Build order

Each phase ships useful alone, and no phase starts before the one before it has run in production for at
least a lunation.

**Phase 1: the model.** `org_roles` and `org_role_assignments`. Holders become accounts, or documented
names where there is no account. Seat state derived. The map cuts over. The five real circles get rows.
The 2026-08-02 role-model fix list (private operations repository) is this phase in full.

**Phase 2: the loop.** Seat claim on login. The weekly ping. Derived staleness. The unmatched-query gap
queue in Admin. Booking and payment flows repair the seats they depend on. Ship most modules off for a
fresh fork. This is the phase that decides whether any of the rest matters.

**Phase 3: legibility.** `/.well-known/village.json`, the ed25519 key, the org Markdown folder plus JSON
twin, the cursored event feed, `llms.txt` and JSON-LD. All five have a same-village payoff before any peer
exists: the org URL is what Amora pastes into investor updates and applications, and the last-verified
line derived from the newest `seat.confirmed` event makes staleness externally embarrassing, which is the
only force that reliably keeps documents fresh.

**Phase 4: governance objects.** Domains, then proposals and objections with the decision-class router,
then terms, then policies, sanctions, grievances, and the membership roll. Then the power map and the
governance record. Roughly in that order, because each one wants the previous one's rows.

**Phase 5: composition.** The inbound inbox. MCP with `actor_kind` provenance. Attestations. Peer sync
generalized to subscriptions over documents. The hub as a crawler. Ledger accounts for circles, roles and
peers. Bilateral credit and the basket unit. The signed health attestation and computable capital
eligibility. Bioregion as the same fork at a higher `kind`.

---

## 9. The gate that earns village number two

Four numbers, read over three consecutive lunations, with the founder not touching the data:

| Metric | Threshold |
|---|---|
| Seat freshness (share of seats confirmed within one lunation) | above 80% |
| Top-actor share of village events | below 50% |
| Weekly ping response rate | above 60% |
| Founder content edits | zero |

Unmatched concierge queries per lunation is the fifth number, tracked without a threshold, because its
useful reading is the trend and the content.

Until those hold, a second village is a second graveyard. The whole argument of this document is that the
protocol work in phases 3 and 5 is worth doing **because** it pays off inside one village first. If Amora's
chart only stays true because Rye edits it, the model is unproven regardless of how many features shipped.
