# The module store: developer monetization inside the settled rails

Lane M, phase 2. ADR-style. Written against `game-amora` at `d14b160`, after
`STORE_BEST_PRACTICES.md` in this directory.

**Status of each part.** Sections 1 to 5 are Accepted and built in this lane. Section 6 is Designed
and deliberately not built. Section 7 is Rye's, with a recommended default per row and nothing
guessed into code.

---

## 1. Context

Rye's mandate: a module store that is a high quality experience for villages and for the people
building modules, with a real economic incentive to build, meaning **a developer can charge other
forks for their module**, and all of it functional and beautiful.

The hard part is not the store. It is that the customer owns the code.

A village runs this platform on its own infrastructure, and the code is MIT: any village may fork the
repository and deploy its fork. It owns `shared/modules.ts`.
Any `if (paid)` a developer writes is one edit away from being deleted, by somebody who is legally
entitled to edit it and who has the file open anyway. So the usual answer, a feature flag checked at
runtime, is not a weak version of enforcement here. It is not enforcement at all.

WordPress spent a decade discovering the same thing with a customer base that could read every line,
and landed somewhere specific: **you do not sell the code, you sell the thing the customer cannot
copy.** For WordPress that is the update channel and the support desk. For this platform, the
mechanically equivalent object already exists and is already built.

## 2. The decision: the credential is the licence

**Accepted.** This is the invariant the mandate names and everything else here follows from it.

A fork can edit every file in the repository. It cannot mint a credential that a third party holds
the other end of. So a paid module's paid behaviour validates against a **licence credential the
fork holds in its secrets store**, issued by the developer, revocable by the developer.

The machinery for this landed with Lane C and needs no new mechanism:

| Need | What already exists |
|---|---|
| A slot the village holds and can see | `ModuleVendor.secretKeys` joins `SECRET_KEYS`, rendered in Admin → Integrations with source and last4 (`server/lib/secrets.ts`) |
| The village can revoke it unaided | The Clear button on that card. That visibility **is** the Connected tier |
| Absence detected | `vendorCredentialPresent` (`server/lib/modules.ts`) |
| Absence answered honestly | `requireVendor` → 503 `vendorLapseBody`, naming the vendor and their support address |
| Everything else keeps working | The 503 body's `stillWorks` field, and the fact that only the listing's own prefixes are gated |

So a paid third-party module is: **first-party code merged into the platform repository through the
eleven-stage listing process, where the developer is the vendor, at tier `connected`, whose paid
operations sit behind a licence key the fork buys from the developer and holds itself.**

Three consequences worth stating out loud.

**The module flag is never the entitlement.** Enabling a module makes no network call, reads no
secret and checks no licence. That is already true and stays true. A village can turn a paid module
on with no licence; what it gets is the honest 503 and the developer's address.

**Lapse behaviour is "stops being served", never "breaks".** This is the line every WordPress vendor
who crossed it regretted. Gravity Forms, WooCommerce and Freemius all keep running on expiry. WP
Rocket stops exactly the features it is still paying to run. The 503 path is on the correct side of
that line by construction: it refuses the call that needs the vendor and touches nothing else. A
listing may not disable a village surface, lock an admin screen, or alter village data on lapse.
`server/lib/feedback.ts`-style rules apply: this is structural, not a guideline.

**The developer's leverage is the same as their obligation.** They can revoke a key, which means they
can also be asked to answer for one. The support URL and support email are required at every tier and
validated, and a listing whose support address stops resolving is reviewable and withdrawable.

## 3. Price is listing data, never prose

**Accepted.** Built.

`shared/modules.ts` gains an optional `pricing` on `ModuleDef`:

```
amount       minor units, integer, 0 is a real answer said out loud
currency     ISO 4217, uppercase
period       month | year | once
billingUrl   where a village goes to buy it, https
licenceKey   which secrets slot holds the licence this price buys
```

Structured data rather than a sentence, for a mechanical reason and a policy reason. Mechanically,
`scripts/check-voice.mjs` parses `shared/` and reads string literals, so a price written as prose
would be catalog copy held to the house writing rules and would drift from the number. As policy, it
is the same rule the vendor record already follows: **the vendor supplies values, the platform writes
the sentences.** A developer never authors copy a village reads.

`licenceKey` is the part that makes the invariant checkable rather than aspirational. It must name one
of that listing's own `vendor.secretKeys`, and it is **required whenever a connected listing charges
more than zero**. A listing that charges money and names no licence slot is refused at boot and in CI,
with the reason: the credential is the licence, so a price with no credential behind it is a price
with nothing behind it. Managed listings may not name one at all, because a managed credential is
platform-held and env-only (hub ADR-49) and is not the village's to hold.

Included listings may not carry pricing.

### `builtBy` is a credit line and never a tier

Also added, also optional, also on `ModuleDef` rather than on the vendor record, and that placement is
the whole point. Tier answers who bills and who supports. **Who built something is a different fact
and gets a different line**, available at every tier including `included`, where a vendor record is
refused outright. That is the only way to credit somebody who contributed a module for free, and it
is exactly the case a healthy ecosystem should make easy.

## 4. `withdrawn` is a state, not a deletion

**Accepted.** Built. Closes a row on CONTRACT_ENFORCEMENT_GAPS_2026-08-14.md, a lane working file never committed here.

The contract promises "the listing is marked withdrawn rather than deleted so nothing orphans". Before
this, the only way to stop offering a listing was to remove the registry entry, which turns every
village that enabled it into an orphan row — the exact thing the contract promises never happens.

`ModuleDef.withdrawn` carries `{ since, replacedBy? }` as data. The rules:

- **Blocks new enables.** `setModuleLifecycle` refuses `off → anything` with 409, in the same shape
  as the dependency and open-state refusals beside it.
- **Changes nothing serving.** A village already running it keeps running it, and may still move
  between preview, members and public, and may still turn it off. Only the transition *from* off is
  refused, so "withdrawn" means withdrawn from the catalog, never withdrawn from a village.
- **Never orphans.** The entry stays in `MODULES`, so `MODULES_BY_ID[id]` resolves and
  `loadModuleSettings` never pushes it onto `orphanIds`. This is the property the contract clause is
  about, and there is a test asserting it rather than a comment claiming it.
- **Banners the admin card**, so a village running a withdrawn listing is told, with the date.

Every serious marketplace draws this line in the same place. Atlassian: existing licences "survive
termination or expiration of this Agreement". Apple: a delisted app "remains fully functional".
WordPress: the repository stays readable and the listing page carries a dated closure notice.

## 5. A `member-pii` listing must register a member driver

**Accepted.** Built. Closes the sharpest row on the gaps list.

The gap, quoted: "nothing requires a `member-pii` listing to register a member driver at all — it
boots clean and deletion silently reaches nothing outside".

Three things become false the day an outside service holds member data with no driver behind it:
`anonymizeMember`'s exhaustive local sweep, `GET /api/profile/export`'s promise that everything means
everything, and "Leaving well is guaranteed" on a public constitution page. Nothing anywhere goes red.

The fix reuses `shared/launchRequirements.ts` rather than inventing a second registry, which buys four
behaviours that already work: `appliesWhenModule` so an off listing asks nothing, `effectiveLifecycle`
gating so a demoted module withdraws its own requirement, three consumers that render it without being
told, and a visible failure when a check is not wired. A listing at `connected` or `managed` whose
`dataClass` is `member-pii` generates a **blocking** requirement; the server-side check resolves
against `registeredMemberDrivers()`.

**Visible, not fatal, and deliberately so.** A blocking launch requirement gates "Mark launched" and
persists in the admin banner and on the journey page. It does not throw at boot, for a specific
reason: driver registration happens during boot wiring, so a boot-time assertion on it would depend on
load order, and a guard that reads a value before it is set is the failure mode this house has already
paid for more than once. The launch registry observes state at request time, which is when the answer
is true.

## 6. The v2 platform-billed rail: designed, not built

**Designed. Not built. Do not build it before section 7 row 2 has an answer.**

In v1 the developer bills the fork directly. Zero platform payment processing, zero merchant of
record exposure, zero payout machinery. That is the Connected posture applied to money, and it is what
MODULE_LIBRARY_TIERS_AND_PROCESS_2026-08-14.md (a lane working file never committed here) decision 10 already defaults to: "Connected: 0%, the
vendor bills and you owe only the connector."

If a platform-billed rail is ever wanted, this is the shape and these are the costs, from the Stripe
research in section 5 of the best-practices document.

**The shape.** Stripe Connect, destination charges, `application_fee_amount` rather than
`transfer_data[amount]` so the developer can see both the total and the platform's take. Written in
terms of the four liability axes rather than the deprecated Standard/Express/Custom names, which are
already legacy.

**The costs, which are the reason this is not v1.**

- Owning the developer relationship means `losses.payments = application`, which is **incompatible
  with giving developers the full Stripe Dashboard**. The liability model and the developer experience
  are one decision.
- It also means Stripe stops issuing 1099-Ks and **the platform becomes the filer**, at the
  **1099-NEC threshold of $600 per developer per year**, on a January calendar with a hard 31 January
  IRS deadline. Not the $20,000 figure people quote.
- Refunds and disputes on destination charges hit the **platform's** balance, and a transfer reversal
  only works while the developer still holds the balance. A developer who withdrew leaves the platform
  holding the loss.
- Sales tax and VAT: an MoR service (Paddle, FastSpring, Stripe Managed Payments) absorbs
  registration and remittance for roughly 3.5 to 5 points, but **none of them does multi-party split
  payout**. Connect would still be needed for the payout leg.

**And the thing to say to counsel before anything else.** Any CORE margin on a third-party module is
income from an activity that is not obviously substantially related to the exempt purpose, which
**re-raises the UBIT question already with counsel**. That question should be answered before a line
of billing code, not after a pilot. Section 7 row 2 is where it lives.

**One piece of evidence worth weighing against building it at all.** Chrome built a payments rail,
watched about 35% of paid extensions reach zero users, and then removed it, dumping the migration cost
on every developer who had built to it. Building a rail before there is a developer waiting to be paid
is the expensive half of a mistake that has already been made in public.

## 7. Decisions that are Rye's

Each row has a recommended default. **None of these is guessed into code.** Nothing in this lane's
build depends on any of them being answered, which is the point: the build is the part that is true
whatever Rye decides.

| # | Question | Recommended default | Why, and what it costs to change later |
|---|---|---|---|
| 1 | **Revenue share on third-party modules** | **0% in v1.** The developer bills the fork directly and CORE owns only the connector. | Matches the tiers doc's decision 10 and the Connected posture. Cheap to revisit: price is listing data and no money flows through CORE, so raising a share later is a contract change and a billing build, not a migration. Note the honest comparison is **Salesforce, not Shopify**: with entitlement living in a credential the village holds, a share is an honour system with an audit clause. Shopify's enforceable 15% rests on owning the billing rail and every store, and neither is available here. |
| 2 | **Does CORE ever process payments for third parties** | **No, pending counsel.** Design v2, build nothing. | This is the UBIT question, not a product question. It also carries the 1099 filing obligation at $600 per developer, loss liability, and dispute exposure. Answer with counsel before any build; a wrong answer here is expensive in a way the others are not. |
| 3 | **Listing fee, or none** | **None.** | The catalog is measured in tens. A fee filters out exactly the small contributor an ecosystem needs first, and buys nothing a review already provides. Revisit only if submissions ever exceed review capacity, which is the problem a fee actually solves. Compare Salesforce's $999 per submission attempt against Shopify's $19 once and Atlassian's zero. |
| 4 | **Review SLA on a listing submission** | **Ten working days to a first response**, with the response naming the stage that is blocking. | Atlassian publishes 10 to 15 business days; WordPress targets 14 days and has swung between 7 and 91 in three years. The number matters less than publishing one and having the rejection carry specifics: Apple's appeal reinstatement rate is about 2%, so **the first response has to do the work because an appeal will not.** |
| 5 | **Who may be a listing's vendor** | **A named legal entity with a jurisdiction and a named human.** | Contract clause 1 already requires the entity, the URLs and both support addresses, and those are validated. Jurisdiction and a named human are still not fields, which is the open half of that row on the gaps list. Both mobile stores require D-U-N-S for organisations and Google publishes the legal address and phone on the listing itself. |
| 6 | **Does a paid listing's price appear to members, or only to admins** | **Admins only.** | A price is operating detail, like the terms URL and the secret slot names, and `/api/modules` already draws exactly this line: a viewer gets the tier word, the data class, the domain and who answers, and nothing else. Federated documents carry nothing about vendors at all and must stay that way. |
| 7 | **What a withdrawal owes an existing village** | **Ninety days' notice, a data return, and the listing stays marked withdrawn forever.** | Already the contract's language. The code half is built; the notice period is a commitment, not a mechanism. Atlassian's comparable verified figure is a **45-day** transition with 60 days of revenue withheld, so ninety days is stricter than the strictest marketplace this lane verified. A relayed summary claims Atlassian publishes a 90-day minimum; that claim conflicts with the Partner Agreement text and is unresolved, see section 6b of STORE_BEST_PRACTICES. Do not quote 90 days as an industry norm to a vendor until somebody confirms it. |
| 8 | **Change of control on a listing** | **A reviewable event, announced to villages running it.** | This is the unpatched hole in the largest open-source marketplace in the world, exploited in 2017 and again in 2025 with an eight-month dormancy that would defeat any review window. Here it is structurally easier: a vendor change is a pull request against a registry entry, so it is reviewable by construction. Worth writing down before it is needed. |
| 9 | **Quality bar for a listing, and is it published** | **Published and numeric, over `integration_health`.** | Built for Shopify publishes p75 Web Vitals and is thriving; Atlassian's Cloud Fortified asks partners to "maintain SLOs" with no number and is being retired. The raw material is already recorded: outcomes, correlation ids, and five verdicts in which `never-confirmed` cannot collapse into healthy. Needs the liveness probe first, which is a separate landing. |
| 10 | **Does the platform reserve a power to take over a listing** | **Narrow and named, or not at all.** | WordPress's guideline 18 is one clause doing two jobs: it closed a backdoored plugin in a day, and it let one person seize a commercial vendor's distribution channel during a business dispute. If the power is wanted, name the trigger. A general reservation of discretion buys the second job along with the first. |

## 8. What this lane built, and what it did not

**Built.** Catalog browse and filter on the admin modules surface; a listing detail view; pricing and
`builtBy` in the registry, the payloads and three surfaces; the `withdrawn` state with its refusal,
its banner and its orphan guarantee; the `member-pii` member-driver launch requirement with its
server-side check; `docs/modules/BUILDING_A_MODULE.md`; `scripts/validate-module.mjs`.

**Built mobile first**, on Rye's input that most of this audience is on mobile Safari. Two iOS
behaviours set every number in the catalog controls. A form control under 16px makes Safari zoom the
page on focus, which on a filter row means the catalog jumps sideways the moment somebody taps it, so
the base font size is 16px and desktop shrinks to the existing 12px at the `sm:` breakpoint. A touch
target under 44px is a target people miss, so the search field, every filter, the Details toggle, the
Clear control and the lifecycle stepper all carry a 44px minimum height on a phone and drop it on a
pointer device. Affordances are underlined at rest rather than on hover, because a phone has no
hover. Filters are half width on a phone so two sit per row within thumb reach. No fixed or bottom
elements were added, so no safe-area inset applies, and no viewport-height unit is used. **None of
this was verified in a real browser by this lane**, and the mobile QA lane should treat it as
unproven.

**Not built, deliberately.**

- **Any payment integration.** Section 6. No Stripe account, no keys, no external signup. Price is
  data and the licence credential is the mechanism.
- **Migration 0081.** Nothing in this design needs persistent state the registry and `module_settings`
  cannot carry. `withdrawn`, `pricing` and `builtBy` are compile-time registry data; the member-driver
  check reads an in-memory registration; the listing stamp already lives in `module_settings.config`.
  A migration number is a scarce, collision-prone resource held across roughly eight worktrees, and
  claiming one for nothing is a cost with no return.
- **A ratings or reviews system.** Every install-count and rating signal in the VS Code marketplace has
  been publicly defeated with a dated incident, and all of them need a large anonymous buyer
  population to mean anything. With villages numbered in tens, a rating average is noise and a review
  form is a surface to game before it is a signal.
- **A public store page.** The catalog is the admin surface. Publishing which commercial services a
  village buys would break the rule that nothing about a village's vendors is published, and the
  federated documents are proven byte-identical precisely so that stays true.
- **Runtime feature-gating on licence state.** Section 2. It does not survive a fork, and every
  ecosystem that tried it deeper than the download point paid for it.
- **The liveness probe, the call log, and latency on `integration_health`.** All named on the gaps
  list, all correctly out of this lane's scope, and row 9 above depends on the first of them.
