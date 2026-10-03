# The Module Library Contract

**Version 1.2. 2026-08-29.** Supersedes version 1.1 of 2026-08-15.

This is the standard a module meets to be listed in the module library. It is written to be read by
somebody outside this repository, and to be sent to a builder unchanged.

Every listing is stamped with the contract version it was accepted under, so a later version is a
re-acceptance and never a silent rewrite. Nothing in 1.2 applies retroactively to a listing accepted
under 1.1 or 1.0.

**What changed in 1.2 is clause 14, and it is the clause about your money.** Read
[What changed, version by version](#what-changed-version-by-version) before you read anything else if
you already hold a listing.

**Read the appendix before you read anything else.** It says, clause by clause, which parts of this
document are machinery that already runs, which are being built, and which are policy a human
enforces. A contract that does not say which of its promises are automated is asking to be believed
on all of them equally, and that is not the deal here.

---

## What the library is

The platform is a white-label village-coordination system, Village OS, published under the MIT
licence. Villages run its published image on their own infrastructure and own the code and the data;
a village forks the repository only if it means to change the code. Modules are units of capability.
`docs/MODULES.md` lists every one. The four core modules
(quests, gratitude, progression, profiles) are always on and cannot be disabled. Every other module
ships off, and a village turns on what it wants.

The library is the catalog of modules a village can enable, including ones you write.

**Every module is first-party code in the platform repository.** There is no plugin runtime, and there
is not going to be one. A module you build is merged into the upstream repository, reviewed there, and
shipped to every village as part of the platform.

**Modules ship only by pull request to the upstream repository.** There is no other distribution
channel: no side-loading, no zip file, no private registry, no "install this in your fork" instruction
outside the normal upgrade path. This is not a preference about convenience. It is the only way the
review below means anything, because a module that reaches a village without passing review has
bypassed every promise in this document.

## Who may build a module

**Anyone.** You do not need a company, a jurisdiction, or a lawyer to write a module and have it
listed. This is the change that matters most in 1.1, and clause 1 is where it is written down.

## The three tiers

A listing sits in one tier. The tier answers the only two questions a village asks: who do I pay, and
who do I call.

| | **Included** | **Connected** | **Managed** |
|---|---|---|---|
| Built by | us | you | you |
| Billed by | n/a | **you, direct to the village** | **us** |
| Supported by | us | you for the service, us for the connector | us first line, you behind a private escalation |
| Credential | none, or the village's own upstream account | **a key the village holds and can see** | **platform-held, the village never sees it** |
| The village has an account with you | n/a | **yes** | **no** |

**Connected is the default for third parties.** Managed is a deliberate spend on our side and is hard
capped at two concurrent listings.

The credential placement is the mechanical definition of the tier, never a description of it. In
Included and Connected the key lives in the village's own secrets store, where an admin sees its source
and last four characters and can rotate it without asking us. In Managed the key is held by the
platform in environment configuration and is never returned to a village, not even masked, because it
is not theirs to see.

## What every listing must provide

These apply at every tier. None of them softens because you bill the village directly.

**1. A counterparty, sized to what the listing does.** Version 1.0 required a legal entity for
everything. That was wrong: it filtered out exactly the individual contributor a library needs first,
for modules that carry no money and no personal data. So this clause is now tiered.

- **A free module that touches no member personal data: a name and a contact address.** That is the
  whole requirement. No legal entity, no jurisdiction, no terms URL. You are credited as the builder,
  the village can reach you, and that is proportionate to what you are asking a village to run.
- **A listing that charges money, or whose `dataClass` is `member-pii`: a named human who signs.**
  A processing agreement cannot be signed by nobody, and a price cannot be owed to nobody. **An
  individual is a valid counterparty.** A named person signing personally is sufficient, and a company
  is welcome and never required. What is required is that somebody real accepts the terms, is named on
  the listing, and can be reached.

We do not list an anonymous paid module and we do not list an anonymous handler of personal data. If we
promise a village that somebody answers, there has to be somebody to name.

**2. Five driver methods, all of them, where your module reaches an outside service.** `read`, `write`,
`health`, `exportMember`, `forgetMember`. The last two are not optional and are not a roadmap item. A
service that cannot delete one person's data on request, and confirm it, is not listable. A module that
reaches no outside service owes nothing here.

**3. An evidence rule on anything a member reads.** Any record you push that will be shown to a member
carries a verbatim quote, a source anchor and a timestamp. Anything without one is dropped on arrival
and the drop is counted and shown to the village's admins. This is the bar our own assistant already
meets at the database level: no quote and no timestamp means no row. We are not going to show your
output to a community at a lower bar than we hold our own.

**4. Graceful absence.** When your service is unavailable, the connector reports unavailable and
everything else in the village keeps working. No village-facing surface may depend on a read from you
to render.

**5. A data classification and, where it applies, a data agreement.** Each listing declares whether it
touches nothing, village content, or member personal data. Where it touches member personal data we
require a signed processing agreement naming your sub-processors, a documented retention period, a
documented hard-delete endpoint, and a deletion turnaround we can state to a member. Per clause 1, the
person signing that agreement may be an individual.

**6. Idempotency on anything you push.** If you deliver events, they carry a stable identifier derived
from your own record, never a timestamp, and redelivery of the same fact is a no-op on our side.

**7. Version your interface and tell us before you change it.** Sixty days' notice on any breaking
change to an endpoint, a payload shape or an authentication method.

**8. Setup a founder can complete alone.** A village admin enables the module, follows the card, and it
works. If any step requires a human logging into your product to paste something back, tell us at
proving time, because it becomes a permanent per-village cost and it changes the commercial terms.

**9. A support address that is answered, and kept current.** For a paid or `member-pii` listing, a
support URL and a support email, both required and both stored as fields we render. For a free module,
the contact address from clause 1 is enough. A listing whose contact stops resolving is reviewed and
can be withdrawn.

**10. Accept our evidence packet.** When our diagnosis attributes a fault to your service, the village
reaches you with a machine-generated packet: the instance identifier, the module, the operation, the
observed HTTP outcomes and latencies, and the timestamps. It carries no member names and no member
content. It is a record of what we observed rather than a conclusion about your system.

**11. Echo our correlation id.** Every request we make carries a correlation identifier in a header.
Log it on your side. Our log is evidence and not adjudication: where our records and yours disagree,
both parties compare correlation ids before either escalates.

**12. Tell us what healthy looks like.** Each listing declares a liveness expectation, either a window
inside which a successful call is normally expected, or an explicit statement that the integration is
on-demand only and silence is normal. Without this, an integration that quietly stopped working reads
to us as an integration nobody happened to use, and neither of us finds out until a member does.

**13. Your code passes the platform's gates and a human security review, before it is merged.** New in
1.1, and it is the clause that makes the rest of this document safe to offer.

A contributed module is not a plugin in a sandbox. It is code that runs inside every village's own server
process, with that server's database credentials and that server's network access, in villages that
never met you. There is no runtime boundary to fall back on, so the review at merge time is the entire
boundary.

Therefore: **no code enters the registry that has not passed the platform's automated gates AND a human
security review.** Security review is part of intake and is not a thing that happens later if somebody
has time. A pull request that is green on every gate has passed the automated half and none of the
human half. The reviewer's checklist is published at `docs/modules/REVIEW_CHECKLIST.md` so you can read
what you will be reviewed against before you write a line.

The automated half is deliberately narrow and honest about it: it checks the listing's shape, the
documentation it must carry, and a set of statically detectable code patterns. It cannot read intent.

**14. The builders' pool, and what a price costs you.** New in 1.1, and rewritten in 1.2.

Every **free** third-party module is included in a recurring $ReGen distribution to its builder,
sized by **how many members open it**. This is the primary way a builder is paid here, and it is
deliberately not a per-village invoice: it pays for adoption instead of for negotiation.

**Your share depends on how many members open your module, and never on how many villages installed
it.** Version 1.1 said the same thing and the machinery behind the money did something else: it split
by how many villages listed a module, which is a yes-or-no per village. Under that count a module
twelve villages enabled and nobody opened out-earned a module one village lives inside. Version 1.2
says what will actually happen, and the code was changed to match rather than the sentence softened
to fit. If you built for the old count, this changes what you earn.

The measure is **reach, and it saturates**: one member opening a module during a lunar cycle counts
once for that cycle however often they return and however much they write. A village contributes the
share of its active members who opened the module, capped at one, so a large village cannot outvote a
small one and a module cannot earn by being noisy or by nagging. Writing in a module earns nothing.
Asking the same member again earns nothing. The one thing that moves your number is more different
people opening it.

**The platform's own modules and the four core modules are IN the pool, on the same measure as you,
and are paid to nobody** (R59, and R64 in 1.2). They earn a share the same way and that share returns
to the pool for the next cycle. Excluding them would split a fixed sum among whoever remained, which
pays third-party builders for the platform's usage as well as their own; including them and recycling
keeps the measurement honest without the platform paying itself. A village's pool statement shows the
returning amount as a number, and every report a village publishes marks which shares recycle.

That footing runs both ways and is meant to. The founder's words: "One day a new organisation could
spin up and have created more modules in the Games than groups are using than us and get more of the
revenue." You out-earning the platform is a success condition of this design.

**A module that charges is out of the pool by construction.** This is not a penalty. A paid module is
already being paid by the villages that run it, and paying it a second time out of a common pool would
have every village funding a product only some of them use. Declaring a price and drawing from the pool
are two ways of being paid for the same work, and a listing picks one.

The rule is mechanical: **a listing that declares `pricing` is not pool-eligible.** The listing lint
checks it, so you find out when you run the lint and never after a distribution.

**Your payout identity is a handle plus the account system that asserts it, and never an address.**
New in 1.2. Your registry entry carries `builtByAccount`, the handle you hold, and `builtByNamespace`,
the host of the system that holds it. One without the other is refused by the listing lint and at
boot. You link your own Base address inside your own profile on that system, and whoever settles a
cycle reads the address there at the moment they write the statement.

Two reasons, and the second is new. An address written into a registry file is asserted by whoever
edits the file, in a public repository, for a payment somebody else receives, and nobody can rotate
it, recover it or prove it belongs to them. And a bare handle only resolves while everybody shares one
account system, which stopped being safe to assume the moment a second organisation ran this code:
`alice` on one system is a different person from `alice` on another, so the handle now carries the
name of the system that asserts it.

**How usage reaches whoever is counting.** Every village serves its own cycle report at
`/api/platform/module-usage`, announces it from its village discovery document at /.well-known/village.json as `module-usage/1`,
and signs it with the key that document publishes. The report carries, per cycle and per module:
members reached, active members, the reach fraction, your credit line, your handle, your namespace,
whether the platform built it, whether the module may draw from the pool at all, where the share
goes, and the time the cycle was sealed. The shape, and the checks a counter runs on a report before
settling anything against it, are `shared/moduleProvenance.ts`, which is the authority over this
paragraph.

Two properties of that report are worth knowing before you rely on it.

**A report carries every module it measured, including the ones that earn nothing.** A priced
listing and a withdrawn one both appear with their real usage on them, and both are marked as out of
the pool. A counter that ignored that mark would put them in the split and take a share off you for
a module the villages running it already pay for. The mark is a field and not an omission, because a
fork counting itself needs the whole picture whether or not anybody is settling from it.

**Being named in a report does not get you paid, and it is not meant to.** A village saying "the
platform built this" costs whoever says it a payment, so it is believed. A village saying "pay this
outside person" is a name and never a payment instruction: whoever settles the cycle holds that
share until a human confirms the listing is yours. The village's job is to make the claim legible.
The gate on money is somewhere else on purpose, because the alternative is a payment that anybody
running a fork could redirect by editing a file.

Three consequences worth stating for a builder outside this repository:

- **Nothing central holds the list of who built what.** Your credit travels inside the module, in its
  registry entry, and every village republishes it. A counter that has never heard of a deployment
  learns the credits from that deployment's own report.
- **A village names no counter.** Anybody may read a village's report, and a village that reports to
  nobody still keeps its own honest numbers. That is what lets a fork with no relationship to this
  platform run the same machinery and be counted by whoever it chooses.
- **After a cycle closes, nobody can say which member opened which module.** The per-member records
  are deleted at the seal and only counts survive. That is a privacy guarantee rather than a storage
  decision, and it is why every number you are paid on is a count of people and never a list of them.

**What is NOT built, said plainly, because the rest of this clause reads like a live payment rail and
it is not one yet.** As of version 1.2 the measurement runs, the report is served and signed,
eligibility and the payout identity are checked, and a village's own statement closes to the unit.
Beyond that: **nothing has ever been paid out.** There is no wallet in this codebase, no automated
transfer, and the last step is a person reading a statement and sending $ReGen by hand. No module in
the registry names a builder today, so nothing is owed to anybody today. The appendix tracks this
line by line and moves when the code moves.

**15. Change of control is a reviewable event.** If the person or organisation behind a listing
changes, that is a pull request against the registry entry, reviewed like any other, and announced to
every village running the module.

This is the failure mode that has hit the largest open-source module ecosystems repeatedly: a
maintainer hands a popular package to somebody unknown, and the handover is invisible to everybody
downstream until something goes wrong months later. Here the handover is a diff by construction. Making
it announced as well as reviewable is the small extra step that lets a village decide for itself.

## Money

Three things, stated plainly so nobody has to infer them.

- **Revenue share on a third-party module is zero.** You bill the village directly and keep all of it.
- **We process no third-party payments.** There is no billing rail here to take a cut with, and there
  is not going to be one in this version. Your `billingUrl` is where a village goes to buy from you.
- **There is no listing fee.** Submitting a module costs nothing.

## Review, and how fast

**An automated first response within minutes.** Opening a pull request runs the listing lint, the facts
check and the documentation link check, and posts one comment naming the first stage that is blocking.
Most rejections are mechanical, and a builder should not wait days to find out about a missing field.

**Human judgement within ten working days.** The stages that need a person, including the security
review in clause 13, are answered inside ten working days with specifics. A refusal names what would
change the answer.

The first response has to do the real work, because an appeal is a poor substitute for a clear
rejection.

## How a listing happens

Eleven stages. The gates that stop most conversations are the first three.

0. **Intake.** One sentence naming the capability, without marketing words, and the domain it claims.
1. **Diligence.** The counterparty required by clause 1, sized to what the listing does.
2. **Domain assignment.** Which domain, who holds it today, and the enumerated write surface.
3. **Data and legal.** Classification, agreement, deletion endpoint, export answer.
4. **Technical proving.** A sandbox tenant and one real captured payload per operation. Documentation
   is not evidence. All five driver methods demonstrated live, including a deletion verified by reading
   back and getting nothing.
5. **Tier and commercials.** Tier, credential plane, response commitments, withdrawal terms, and
   whether the listing declares a price or takes the pool.
6. **Build and security review.** Clause 13. The gates are the automated half; a human reads the diff.
7. **Pilot in one named village**, with the export and deletion drill run rather than planned.
8. **List.** The bar is that a second person can enable it in a fresh fork using only the shipped
   interface and the runbook.
9. **Operate.** Health probes, a call log, and a periodic review that you still exist, terms have not
   changed, the agreement is current and the tier is still honest.
10. **Withdraw**, when it ends, by the terms below.

## What the platform guarantees you

- **We own triage in all three tiers.** When something breaks we tell the village whose problem it is
  before anyone raises their voice.
- **We attribute conservatively, and we absorb the ambiguous ones.** Where the recorded evidence does
  not clearly discriminate, the village is routed to us rather than to you.
- **We aggregate.** One outage affecting several villages is one notification, never one ticket per
  village.
- **We do not compete with a listing we solicited.** If we decide to build in your domain we tell you
  before we start.
- **Your name appears where you earned it.** Connected listings carry your name and your support link
  in the catalog and on the setup card, and the builder credit appears at every tier including on
  modules the platform bills for.
- **Withdrawal is orderly in both directions.** Ninety days' notice, a data return, and the listing is
  marked withdrawn rather than deleted so nothing orphans.

## What a price may show, and to whom

**A listing's price is shown to members inside the app.** Version 1.0 kept it to admins. A village
running on money its members contribute should not hide from those members what it spends, and a price
is a small, factual, non-identifying number.

This changes nothing about federation. **Federated documents carry nothing about a village's vendors:
no names, no prices, no counts.** The price is visible inside the village that pays it and travels
nowhere.

## What the platform will never do

These are structural and are not negotiable per listing.

- **No vendor is a source of truth.** Each domain has a platform-owned table holding the join key, the
  consent record and the deletion state. Your service is a driver behind it. At most one driver per
  domain runs at a time.
- **Nothing you hold ever decides what a member may do.** The permission gate reads platform state
  only.
- **Nothing you send ever moves value.** Token movement is double-entry and human-consented. A record
  you push can suggest; only a person can credit.
- **Nothing you send is ever written as fact.**
- **Nothing about a village's vendors is published** outside that village.
- **We do not write to a core module on your behalf.** Quests, gratitude, progression and profiles are
  the platform's own loop.

## Withdrawal, and what is automatic

When a listing stops being offered it is marked withdrawn, never deleted. Deleting the entry would
leave every village that enabled it holding a settings row pointing at nothing.

**Automatic, by machinery:** the block on new enables, the banner on the admin card with its date, the
notice countdown, and the guarantee that nothing already serving changes. A village running a withdrawn
module keeps running it, can still move it between preview, members and public, and can still switch it
off. Only the transition out of off is refused.

**Manual, by commitment:** the ninety days' notice itself, and the data return. The data return is
performed with the same `exportMember` driver clause 2 requires, which is why that clause is an entry
gate and not a nice-to-have. Where a builder has disappeared, the export cannot be run and the notice
to villages says so plainly.

## What the platform reserves, narrowly

The power to take over or remove a listing exists, and it is limited to three named triggers. A general
reservation of discretion is not claimed, because the same clause that lets a marketplace shut down a
backdoored module in a day is the clause that lets it seize a working builder's distribution during a
commercial dispute.

The three triggers, and nothing else:

1. **Confirmed malicious code.** Not suspected. Confirmed.
2. **An unpatched critical vulnerability past its disclosure deadline.**
3. **A builder unreachable for ninety days while a live security issue is open.**

Outside these three, a listing is withdrawn by its builder or by the orderly process above.

## What gets a listing withdrawn

- A contact address that stops resolving.
- Breaking a village when a licence lapses. You may stop serving your own paid operations. You may not
  disable a village surface, lock an admin screen, or alter village data.
- A `member-pii` listing that cannot confirm a deletion.
- Writing to a core module, or to another domain's platform-owned table.
- Anything sent as fact.
- A tier that stopped being honest, for example a credential that quietly moved plane.
- A review that finds the builder no longer exists, or terms that changed without the notice clause 7
  asks for.

---

## What changed, version by version

Kept here so a builder can see what moved without diffing a repository, and so a re-acceptance is a
decision somebody makes rather than a version number they notice later. A new version is offered to
existing listings as a re-acceptance and does not apply retroactively.

### 1.2, 2026-08-29

**One clause changed, and it is clause 14, the one about your money.**

- **A share is sized by how many members open your module.** It was already written that way in 1.1
  and the machinery split by how many villages listed a module, which is a yes-or-no per village.
  The machinery now reads the same reach the clause describes. **If you built for the village count,
  this changes what you earn**: a module a dozen villages enabled and nobody opened earns close to
  nothing, and a module one village lives inside earns what that village's own members say it is
  worth.
- **The platform's own modules compete on the same measure.** They already did in 1.1. What is new
  is that their share is now marked as recycling in what every village publishes, so you can see it
  going back into the pool rather than take our word for it.
- **A payout identity is a handle plus the account system that asserts it.** `builtByNamespace` is
  new and required alongside `builtByAccount`. A listing carrying one without the other is refused.
  If you hold a listing with a handle and no namespace, add the host of the system that holds your
  account. Nothing else about the payout identity changed, and it is still never an address.
- **Usage is published per village and readable by anybody**, signed, at a link every village
  announces in its discovery document. No central list holds who built what any more, because your
  credit travels inside the module and every village republishes it.
- **The appendix now says out loud that nothing has ever been paid out.** That was true under 1.1 and
  1.0 as well. It is stated in the clause itself now instead of only in the table.

### 1.1, 2026-08-15

- **Anyone may build a module.** Version 1.0 required a legal entity for every listing, which filtered
  out the individual contributor a library needs first. Clause 1 became tiered: a free module touching
  no member personal data needs a name and a contact address.
- **Clause 13, gates plus a human security review before merge.** The clause that makes the rest of
  the document safe to offer, because contributed code runs inside every village's own server process.
- **Clause 14, the builders' pool**, and the rule that a listing declaring a price is out of it.
- **A price is shown to members**, where 1.0 kept it to admins.
- **The appendix.** Version 1.0 was held back from publication because it described unbuilt
  machinery. The remedy was to say which clauses are machinery and which are policy, on the page.

### 1.0, 2026-08-14

The first version. Never published, for the reason the appendix records.

---

## Appendix: the status of each clause

Version 1.0 was held back from publication on the reasoning that clauses describing unbuilt machinery
should not be offered to a vendor as though they were live. That reasoning was right about the problem
and wrong about the remedy: the fix for a promise that is not yet machinery is to say so on the page,
not to withhold the page.

**Clause 14 is split into four rows in 1.2 because one row could not tell the truth about it.** Three
of the four are machinery today and the fourth is the one a builder cares about most, so collapsing
them into a single "Built, partly" invited exactly the wrong reading.

So this is the honest state of every clause, at the commit this document is read at. Run
`node scripts/module-facts.mjs` for the numbers that go stale.

**Built** means machinery refuses the bad case today. **Building** means it is queued and named.
**Policy** means a human enforces it and no code will.

| Clause | Status | What that means concretely |
|---|---|---|
| 1 · Counterparty, tiered | **Built**, partly | Legal name, product/terms/status URLs and both support addresses are validated for listings that declare a vendor. The free-builder tier is new in 1.1 and its lighter requirement is **policy**: a reviewer checks a name and a contact. |
| 2 · Five driver methods | **Built**, partly | `exportMember` and `forgetMember` have a real interface and a registry, and a `member-pii` listing without a registered driver fails the lint. `read`, `write` and `health` have **no interface anywhere yet**; if your listing needs them, that interface is designed with you. |
| 3 · Evidence rule | **Policy** | Enforced at the database level for the platform's own assistant. There is no generic inbound path yet, so for a listing this is read by a reviewer. |
| 4 · Graceful absence | **Built**, partly | A missing credential takes your routes to a 503 that names you, and everything else keeps working. A present credential in front of a dead service passes untouched: there is no circuit breaker. |
| 5 · Data agreement | **Policy** | `dataClass` is a validated field. The agreement, the sub-processor list, the retention period and the hard-delete endpoint are **not fields and not checked**. Stage 3 is entirely a human gate. |
| 6 · Idempotency | **Policy** | No webhook receiver is built, so nothing measures this. |
| 7 · Sixty days' notice | **Policy** | No interface-version field and no notice record. Not mechanically enforceable, and said out loud rather than implied. |
| 8 · Founder-alone setup | **Policy** | Setup steps render and are counted, and managed listings are refused any. Whether a founder can actually finish alone is stage 8's human bar. |
| 9 · Contact kept current | **Built**, partly | Both addresses are required and shape-validated. **Nothing checks that they resolve.** |
| 10 · Evidence packet | **Building** | Not built. The call record it needs does not yet carry latency. |
| 11 · Correlation id | **Built** on our side | Every outbound call through the vendor wrapper mints and sends one. That you log it is **policy**. |
| 12 · Liveness | **Built**, partly | Declared, validated, and five verdicts exist in which "never confirmed" cannot collapse into "working". **The probe itself does not exist**, so a declared window is currently a promise nothing measures. |
| 13 · Gates plus human security review | **Built** | The gates run on every pull request and block. The intake workflow posts the first blocking stage within minutes. The human review is the published checklist, and it is a required approval rather than a suggestion. |
| 14 · Builders' pool, measured | **Built** | The meter runs on every module route, the unit saturates at one member per module per lunar cycle, admin routes and refused requests are excluded, and a village's contribution to any module is capped at one. `/api/modules/pool` splits a pool on that reach and closes to the unit. |
| 14 · Builders' pool, reported | **Built** | Every village serves a signed per-cycle report at `/api/platform/module-usage`, announced in the village discovery document at /.well-known/village.json as `module-usage/1`, carrying each module's credit line, payout handle, namespace, whether the platform built it and where its share goes. `shared/moduleProvenance.ts` holds the shape and the checks a counter runs before settling. Nothing central holds a builder list any more. |
| 14 · Builders' pool, eligibility and identity | **Built** | Eligibility is derived from the registry with five stated reasons, the listing lint prints each module's status and refuses a listing that charges while claiming the pool, and the payout identity is refused unless it is a handle plus the account system that asserts it. An address in that field is refused by name. |
| 14 · Builders' pool, paying anybody | **NOT BUILT** | **Nothing has ever been paid out and no code here can move a token.** There is no wallet in this repository. Somebody reads a statement and sends $ReGen by hand. Three things stand between a green report and a paid builder, and only the first two are ours to close: a settlement that sums every village's report and reads a linked Base address off the named account system; a funded pool with an amount somebody set; and a transfer. No module in the registry names a builder today, so nothing is owed today. |
| 15 · Change of control | **Built** by construction | A builder change is a diff against the registry entry, so it is reviewable inherently. The announcement to running villages is **policy**. |
| Money terms | **Built** by absence | Zero revenue share, no listing fee and no payment processing are true because no billing rail exists. There is nothing to enforce. |
| Review SLA | **Built**, partly | The automated first response is a workflow and runs in minutes. The ten working days for human judgement is a commitment. |
| Withdrawal | **Built**, partly | The withdrawn state, the refusal of new enables, the banner and the orphan guarantee are machinery. The notice period and the data return are commitments. |
| Takeover triggers | **Policy** | Three named triggers, exercised by a human, recorded as a pull request like anything else. |

*Contract version 1.2. Listings are accepted against a version. A new version is offered to existing
listings as a re-acceptance and does not apply retroactively.*
