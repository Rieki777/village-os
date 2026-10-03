# Start here: building a module

Provenance: platform

**Paste this whole file into your coding session as its first message.** It is written to be read by
an assistant as much as by you. If you want the human setup steps first, read
`docs/modules/HOW_TO_START_A_SESSION.md` and come back.

This file routes. It does not explain. Every fact worth knowing lives in a file that is kept current
by the people who change the code, and restating any of it here would create a second copy that goes
stale. Where you see a path, open it.

## What this platform is, in five lines

It is a white-label village-coordination system, Village OS. A village runs the published image on its
own infrastructure and owns the code (MIT) and the data; it forks the repository only to change the
code. Modules are units of capability: some tables, some routes, some screens, a few tunable numbers,
and one entry in a registry that ties them together. Four core modules are
always on, and every other one ships off until a village turns on what it wants (`docs/MODULES.md` lists them all). There is no
plugin runtime, so a module you write is merged upstream and shipped to every village as part of the
platform.

## Run this first

```
node scripts/module-facts.mjs
```

It prints the current truth: the registry's field list, the tier and data class and lifecycle
vocabularies, the capability count, the gate commands in the order CI runs them, the budgets, the
contract version, and the commit it read them at. Nothing in it is hardcoded, so it is right on the day
you run it. **Do not take a field list from any document, including this one. Take it from that
command.**

## Read these, in this order

1. `CLAUDE.md` at the repository root. The invariants, the gates, and the house traps. Read the
   "Non-negotiable invariants" and "House traps" sections properly; each trap cost somebody a session.
2. `docs/ARCHITECTURE.md`. The system map.
3. `docs/modules/BUILDING_A_MODULE.md`. The real guide, and the one you will spend the most time in.
   It covers the registry entry field by field, the five configuration planes, the driver methods,
   pricing and licensing, withdrawal, and the gates.
4. `docs/modules/module-framework.md`. How enablement, dependencies and lifecycle actually work.
5. `docs/MODULE_LIBRARY_CONTRACT.md`. What you are agreeing to. Read its appendix, which says clause by
   clause what is enforced by machinery and what rests on a human.
6. `scripts/validate-module.mjs`. Read it, then run it. It loads the real registry and calls the same
   function the server asserts with at boot, so it is not a second opinion about what a valid listing
   is. It also prints everything it cannot check, which is the honest half.
7. One worked example: **`shared/modules.ts`, the `events` entry, with `docs/modules/events.md`
   beside it.** Pick this one because it is the smallest complete non-core module in the registry: it
   has capabilities, namespaced game variables, API prefixes, a soft dependency, and a contract
   document, and it carries no vendor, no pricing and no funds. It shows the whole shape of a module
   with none of the special cases layered on top. Its `recommends` comment also explains why a
   dependency is soft instead of hard, which is the judgement call you will face first.

## The invariants you must not break

These are stated in `CLAUDE.md` and enforced in code. They are cited here so you know they exist, and
you read them there so you read the current version.

- **One capability gate.** `shared/capabilities.ts` is the only place a permission is decided. Never
  gate anywhere else.
- **Every non-core module ships off.** An absent settings row means off. The four core modules cannot
  be disabled.
- **All value movement is double-entry and human-consented.** No raw ledger writes, ever.
- **No village's brand in platform code.** A guard enforces this and its counts may only decrease.
- **Shipped copy follows the house writing rules.** A guard parses your string literals.
- **Five configuration planes**, and picking the wrong one is the most common mistake. If your module
  has a knob, it is almost certainly a game variable.

## How you get paid, and how a price changes that

Every **free** third-party module is in a recurring $ReGen distribution to its builder, sized by **how
many members open it**. That is the primary way a builder is paid here, and it pays for adoption
instead of for negotiation. One member opening your module during a lunar cycle counts once for that
cycle, so writing in it earns nothing and asking the same member again earns nothing.

**Declaring a price takes you out of the pool.** A paid module is already paid by the villages running
it, and drawing from a common pool as well would have every village funding a product only some of them
use. The listing lint checks this, so you find out when you run the lint.

To receive a share, your registry entry carries `builtByAccount`, the handle you hold, and
`builtByNamespace`, the host of the system that holds it. One without the other is refused. You link
your Base address in your own profile there. The pool pays an account and never a raw address written
into a registry file, because a payout identity in a code file is one nobody can rotate or recover.

**Nothing has been paid out yet.** The counting runs and every village publishes a signed report of
it; there is no wallet in this repository and the sending is still done by a person.

Clause 14 of `docs/MODULE_LIBRARY_CONTRACT.md` is the binding text, and
`shared/moduleProvenance.ts` is the authority on what a report carries.

## How a module ships

**By pull request to the upstream repository, and by no other route.** No side-loading, no zip, no
private registry. A module that reaches a village without passing review has bypassed every promise the
contract makes.

What happens when you open one:

- **Within minutes**, an automated check runs the listing lint, the facts command and the documentation
  link check, and comments naming the first stage that is blocking. Most rejections are mechanical and
  you should not wait days to hear about a missing field.
- **Within ten working days**, a human answers the parts that need judgement, with specifics.
- **A human security review is required, always.** Your module runs inside every fork's own server
  process with that server's database credentials and network access. There is no sandbox, so the
  review at merge time is the entire boundary. Read `docs/modules/REVIEW_CHECKLIST.md` before you
  write a line; it is what you will be reviewed against, and most of its security section is things
  you can simply avoid doing.

Anyone can build a module. A free module that touches no member personal data needs a name and a
contact address, and nothing else. A module that charges money, or whose data class is `member-pii`,
needs a named human who signs; an individual is a valid counterparty and a company is never required.

## What gets a listing withdrawn

The full list is in the contract. The ones that catch people:

- Breaking a village when a licence lapses. You may stop serving your own paid feature. You may not
  disable a village surface, lock an admin screen, or alter village data.
- A `member-pii` listing that cannot confirm a deletion.
- Writing to a core module, or to another domain's platform-owned table.
- Sending anything that gets written as fact.
- A contact address that stops resolving.

## What "done" looks like

Every gate green, cold, in the order `node scripts/module-facts.mjs` prints them. Then
`node scripts/validate-module.mjs <your-module-id>` clean. Then a pull request using the module listing
template, with the checklist filled in honestly. An unchecked box with a sentence saying why is a fine
answer. A checked box that is not true is the one thing that will lose you the reviewer.
