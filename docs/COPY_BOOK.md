# The Copy Book - v2, enchant-first, for the founder's pass

Second pass, branch `wt/r5-copy2`, 2026-08-22, under the R46 ruling: a
beautiful and enchanting way to explain FIRST, with a simple explanation in
tooltips throughout, up to three per card where three concepts genuinely live
on it. The register comes from the corpora the ruling named (joinseeds.earth,
the second brain, regencivics.earth); the exemplars and sentence shapes are in
`docs/COPY_STYLE_KEY.md`, and every restyled row cites its exemplar by number.

Three columns, as asked: **Old** is the copy before this round began (before
COPY-1 too, where COPY-1 changed it). **New** is what this branch ships.
**Yours** is empty, for your own words; whatever you write there wins.
Tooltip text is listed under each card's row. Living-map rows are marked
**applies after the landing train** and live in the guarded patch scripts
(`docs/prototypes/patch_copy_*.py`); the artifact itself stays untouched.

The tooltip layer is one shared component (`client/src/components/InfoTip.tsx`):
a real button, so it opens on tap, on hover, and on keyboard focus, closes on
Escape, and reads its plaque to screen readers. The plaque wears the map's
parchment look. Cards that are one whole link (quest cards, module cards)
stay one tap; their mechanics sit on the nearest header instead, because a
button inside a link is broken HTML and a trap for screen readers.

---

# PART 1 - THE SITE (client pages, applied on this branch)

## 1.1 Site shell: browser titles and auth controls

| Where | Old | New | Yours |
|---|---|---|---|
| Title `/map/circles` | Circles and seats | Circles and roles (COPY-1) | |
| Title `/events` | What is on | Village Calendar (COPY-1) | |
| Title `/tokens` and `/wallet` | Tokens | The Exchange (COPY-1) | |
| All other page titles | - | kept | |
| Nav label (Village group) | Circles & Seats | Circles & Roles (COPY-1) | |
| Nav label (Village group) | Tokens | The Exchange (COPY-1) | |
| Nav label (Community group) | What's On | Events (COPY-1) | |
| All other nav labels, header auth, footer blurb | - | kept ("Wallet" in the account menu stays: one member's own balances, a different thing from the Exchange) | |

## 1.2 Home page (/)

Unchanged this round; every row of the COPY-1 book stands (hero, stages,
path cards, personas, CTAs, all kept, with the founder flags recorded there:
the configured tagline, the doubled "Co-Creator" subtitle).

| Where | Old | New | Yours |
|---|---|---|---|
| Persona: Longevity Seeker body | ...purpose as medicine-building a life... | ...purpose as medicine: building a life... (COPY-1) | |
| Persona: Remote Exec body | ...to matter-contributing capital... | ...to matter: contributing capital... (COPY-1) | |
| Everything else on the page | - | kept | |

## 1.3 Home-embedded bands

| Where | Old | New | Yours |
|---|---|---|---|
| MapPeek | ...a funded build, a claimed quest, a filled seat. Open the map and walk it. | ...a funded build, a claimed quest, a filled role. Open the map and walk it. (COPY-1) | |
| BuildProgress · VillagePulse · SeasonBanner | - | kept | |

## 1.4 Quests page (/quests)

| Where | Old | New | Yours |
|---|---|---|---|
| H1 | Community Quests | kept | |
| Hero sub | Quests are how you contribute to the village and earn {Gratitude}, our way of acknowledging every contribution. Every quest builds relationships, regenerates the land, and grows the community's collective score. | **Real work, on real land, beside people becoming your people. Every quest you finish grows the village a little, and the village says thank you in {Gratitude}.** (exemplars 3, 10) | |

Tooltips on the hero card:
- on **{Gratitude}**: "{Gratitude} is thanks for work, never pay. A finished
  quest carries its thank-you, released when the circle consents the work is
  done."

| Where | Old | New | Yours |
|---|---|---|---|
| Stats line | N active quests · up to N {Gratitude} available | kept, plus a tooltip | |

- tooltip on the stats line: "Every open quest names its own thank-you; this
  number is all of them added together."

| Where | Old | New | Yours |
|---|---|---|---|
| Ring 1 Start here | Open to everyone with a profile... | kept | |
| Ring 2 The village | The everyday work the village runs on... | kept | |
| Ring 3 Further in | These open as you walk the Path of Growth or step into a role. Each one says what opens it. | kept, plus a tooltip | |

- tooltip on Further in: "The Path of Growth is the membership ladder on your
  profile. Walking it, or holding a role, opens these quests."

| Where | Old | New | Yours |
|---|---|---|---|
| Your-journey head / status lines / suggestion sub | Pick up where you left off / In progress: submit your work when it's done / Submitted, awaiting circle consent / A gentle way in. See the first step. | kept (the status lines sit inside a link card, so their consent teach lives in the hero tooltip) | |
| Filters, show more, empty states, life signs | - | kept | |

## 1.5 Roles page (/roles)

| Where | Old | New | Yours |
|---|---|---|---|
| H1 | Roles and Circles | kept | |
| Hero sub | We organize through sociocratic circles. Each role has an aim, a domain, and a set of accountabilities. Roles sit in the circle, not on the person. | **The village organizes itself the way a forest does: circles of care, each holding its own ground, and every role is a way to hold some of it with your own hands, by consent.** (exemplars 4, 5) | |

Tooltips on the hero card (three concepts, three tooltips):
- on **circles**: "Circles are sociocratic working groups with real authority
  over their own domain. Decisions inside a circle pass by consent."
- on **role**: "A role is a named responsibility inside a circle, with an
  aim, a domain, and accountabilities. The role belongs to the circle, and a
  person steps into it."
- on **consent**: "A decision moves forward when nobody holds a reasoned
  objection. Consent is quieter than consensus and faster than voting."

| Where | Old | New | Yours |
|---|---|---|---|
| Status badges | Open Seat · Filled · Forming · Partially Filled | Open Role (COPY-1) · rest kept | |
| Explainer cards (Circles / Roles / Consent) | - | kept | |
| Role card headings | Held By · Aim · Domain · Key Accountabilities · Why This Role Matters | kept, with tooltips on three of them | |

Tooltips on every role card's open view (three concepts, three tooltips):
- on **Aim**: "The aim is what this role works toward: the outcome it exists
  to keep alive."
- on **Domain**: "The domain is what this role decides on without asking.
  Inside it the role holder has real authority; outside it they bring
  proposals."
- on **Key Accountabilities**: "Accountabilities are the ongoing activities
  the circle can count on this role to keep doing."

| Where | Old | New | Yours |
|---|---|---|---|
| Loading / failed / How Roles Evolve / CTA | - | kept | |
| Unplaced group | Unplaced seats | Unplaced roles (COPY-1) | |

## 1.6 Circles page (/circles)

| Where | Old | New | Yours |
|---|---|---|---|
| H1 | Our Sociocratic Circles | kept | |
| Hero sub | The team organizes in circles, each with a clear domain, real authority within it, and a double link back to the General Coordinating Circle. Circles collaborate, and we win together. | **Circles are how the village thinks: each one tends its own domain the way a tree tends its own ground, and double links weave them into one canopy.** (exemplars 4, 6) | |

Tooltips on the hero card:
- on **domain**: "A domain is the ground a circle decides on without asking
  anyone above it. Real authority lives inside it."
- on **double links**: "Two people belong to both a circle and the circle
  above it, one chosen by each. News travels both ways, so no circle drifts
  alone."

| Where | Old | New | Yours |
|---|---|---|---|
| CTA | View Roles & Open Seats | View Open Roles (COPY-1) | |
| Card members line | {names} or "N seats, none held yet" | {names}, else "N roles, M seats held", else "N roles, none held yet" (COPY-1, corrected R57) | |
| Everything else on the page | - | kept | |

## 1.7 Village Calendar (/events)

| Where | Old | New | Yours |
|---|---|---|---|
| H1 | What is on | Village Calendar (COPY-1) | |
| Hero sub | The village's calendar: twelve months and the moons of the year, side by side, and everything dated in one place. | **The village keeps two clocks: the twelve months everyone shares, and the moons the land turns by. Everything dated lives here, side by side.** (exemplar 4's shape) | |

Tooltips on the hero card:
- on **moons**: "The moons are the lunar months the land turns by. The wheel
  and the grid show them beside the civil calendar, and the village's cycles
  close when the moon does."

| Where | Old | New | Yours |
|---|---|---|---|
| Moon chip | Today is day N of M in Moon K, {name} | kept | |
| RSVP buttons | I'm coming · Maybe · Can't make it | kept, plus one tooltip on the row | |

- tooltip on the RSVP row: "A full gathering only blocks a new I'm coming.
  Maybe and can't make it always go through, and a freed place goes to
  whoever has waited longest."

| Where | Old | New | Yours |
|---|---|---|---|
| Status chips / link labels / error / wheel tip / empty states | - | kept | |
| Wheel turning labels | Equal / Longest / Shortest | Equinox / Solstice (COPY-1, also on the profile's CycleClock) | |

## 1.8 Gratitude Wall (/gratitude)

| Where | Old | New | Yours |
|---|---|---|---|
| H1 | The {Gratitude} Wall | kept | |
| Hero sub | Appreciation, spoken out loud. Every month each member has a budget of gratitude to acknowledge the people building this village. | **Appreciation, spoken out loud. Naming what is good is how the village grows more of it, and every thanks on this wall becomes {gratitude} in the hands of the member it names.** (exemplars 2, 3, 12) | |

Tooltips on the hero card:
- on **{gratitude}**: "Each cycle every member receives a budget of
  {gratitude} to send. Sending is thanks for real contributions, never pay,
  and the wall keeps every word."

This rewrite also settles founder flag 10 from the first book: the cadence
("Every month" against the lunar refill) leaves the surface line entirely,
and the tooltip says "each cycle", true under any village's config.

| Where | Old | New | Yours |
|---|---|---|---|
| Form head | Send gratitude · N / M left this cycle | kept, plus a tooltip on the budget count | |

- tooltip on the budget count: "Your sending budget refills when the cycle
  turns. Sending moves it from your budget to their wall; it never costs you
  anything you earned."

| Where | Old | New | Yours |
|---|---|---|---|
| Budget states / placeholders / success / spent / signed-out / empty wall | - | kept | |

## 1.9 Material Library (/library)

| Where | Old | New | Yours |
|---|---|---|---|
| H1 | Material Library | kept | |
| Hero sub | Shared tools and goods, borrowed on library credits. Donate what you no longer need and earn the credits to borrow what you do. | **One shelf, many hands. What you no longer need becomes what a neighbor was missing, and the shelf remembers every gift in library credits.** (exemplars 6, 7) | |

Tooltips on the hero card:
- on **library credits**: "Library credits are earned by donating items and
  set aside as a deposit while you borrow. The deposit comes back at return,
  minus wear."

| Where | Old | New | Yours |
|---|---|---|---|
| Item meta | value N · deposit N · from {stage} | kept, with tooltips on the two coded words | |

- tooltip on **deposit**: "The deposit is set aside from your credits while
  the item is out and returns when it does, minus any wear."
- tooltip on **from {stage}**: "This item opens at the {stage} stage of the
  membership path. The ladder lives on your profile."

| Where | Old | New | Yours |
|---|---|---|---|
| Loan line | {item} · {status} · due {date} · N in escrow | {item} · {status} · due {date} · N **set aside** (the last "escrow" on a member surface, joining COPY-1's ruled vocabulary) | |
| Server borrow refusal | You need N library credit(s) in escrow to borrow this. Earn them by contributing items or work | You need N library credit(s) **set aside** to borrow this. ... (same rule, server side) | |
| Reserve notice | Locks N credit(s) in escrow (pre-round) | Reserved. N credit(s) set aside while you borrow. (COPY-1) | |
| Status labels / balance line / loan actions / empty shelf / signed-out | - | kept | |

## 1.10 The Exchange (/tokens · /wallet)

| Where | Old | New | Yours |
|---|---|---|---|
| H1 | Tokens | The Exchange (COPY-1) | |
| Hero sub | What you hold, and the village exchange. Recognition is earned, never bought. Only the village's own credit tokens are ever listed here. Your own balances also sit on your profile. | **One room, one ledger: every token the village lives by leaves its thread here, the way roots share water under a forest floor. Gratitude, stay credits and library credits each carry their own story. Your own balances also sit on your profile.** (exemplars 4, 2) | |

Tooltips on the hero card (three tokens, three tooltips):
- on **Gratitude**: "Gratitude is thanks for work, never pay. Earned when
  someone appreciates a real contribution; it cannot be bought."
- on **stay credits**: "Stay credits are nights at the village, earned
  through work exchange and spent when you book a stay."
- on **library credits**: "Library credits pay the Material Library's
  deposit: set aside while you borrow, back when the tool comes home."

| Where | Old | New | Yours |
|---|---|---|---|
| Balances card | Your balances · {balance rows by slug} | kept, plus a tooltip on every token row | |

- tooltip per balance row, by token family: the Gratitude, stay-credit and
  library-credit families each get their one-sentence mechanics (the three
  sentences above), and any other token says: "A village token. Every
  movement it makes is written on the shared ledger."

| Where | Old | New | Yours |
|---|---|---|---|
| Buy card head | The exchange (pre-round) | Buy tokens (COPY-1), plus a tooltip | |

- tooltip on Buy tokens: "Money flows in and never back out: the village
  sells its own credit tokens and never buys them back. Gratitude is never
  for sale."

| Where | Old | New | Yours |
|---|---|---|---|
| Buy card states / refusal captions / signed-out / swap card / halted / receipts | - | kept (COPY-1's "Couldn't load the listings just now." stands) | |
| Hypha card | Hypha holdings - Governance and equity tokens live on your Hypha DHO. This platform shows the door, never moves what's behind it. | kept (the R45 governance thread is still open), plus a tooltip | |

- tooltip on Hypha holdings: "Hypha is the outside network where governance
  and equity tokens live. This page is a door to it; nothing here moves
  those holdings."

| Where | Old | New | Yours |
|---|---|---|---|
| Profile wallet card link / head / module gate name | Village exchange / Wallet / Exchange | The Exchange / Wallet kept / The Exchange (COPY-1) | |

## 1.11 Our raisings (/campaigns) - folded in from the crowdpool lane

| Where | Old | New | Yours |
|---|---|---|---|
| H1 | Our raisings | kept | |
| Hero sub | What this village is gathering through the hub's crowdpool. Each ring fills as the pool does; open one to watch it become walls. | kept (it was born in the map's register), plus a tooltip | |

- tooltip on **crowdpool**: "A crowdpool gathers pledges of money, goods,
  tools and hands for one build. Nothing moves through this page; every
  claim finishes on the hub's own page."

| Where | Old | New | Yours |
|---|---|---|---|
| Loading / empty / unreachable cards | Reading the ledger / No raisings yet... / The hub is out of reach... | kept | |
| Campaign card lines | {money} of {money} pooled · N backers · numbers from {age} | kept (the card is one link; its ring teach lives on the campaign page) | |

## 1.12 A raising (/campaign/:slug) - folded in from the crowdpool lane

| Where | Old | New | Yours |
|---|---|---|---|
| Header board | A raising on the hub · {title} · {money} of {money} pooled · N backers so far | kept, plus a tooltip on **pooled** | |

- tooltip on **pooled**: "The gold ring is everything pledged so far; the
  quieter green arc inside it is what has actually arrived."

| Where | Old | New | Yours |
|---|---|---|---|
| What this pool is plaque | This is our village's raising on the hub... Claim a need here and you finish the claim on the hub's own page. | kept (it is the plain layer already) | |
| Growth strip head | From blueprint to walls | kept | |
| Needs shelf head / sub | The needs shelf · Each open need is a quest waiting to be written... | kept | |
| Need tile capital line | {kind}, {capital} capital, many hands welcome | kept, plus a tooltip on **{capital} capital** | |

- tooltip on every need tile's capital line: "The village counts more kinds
  of wealth than money: material, living, social, intellectual and more.
  Every need names the capital it calls for."

| Where | Old | New | Yours |
|---|---|---|---|
| Partner funders head / sub | Partner funders · Ordinary money travels through partners, never through this page... | kept | |
| Partner card | {label} · N% · {money} raised with N contributors · Their numbers, kept {age} | kept, plus a tooltip on the partner's name | |

- tooltip on every partner card: "Ordinary money travels through this
  partner, never through this page. The tally is the hub's cache of the
  partner's own numbers."

| Where | Old | New | Yours |
|---|---|---|---|
| Pool Ledger head / sub / empty / lines | The Pool Ledger · Arrivals, as the hub's public feed tells them... · The ledger waits for its first arrival. · {narrated arrivals} | kept | |
| Stale chip / sleeping states | The ledger sleeps. The hub last answered {age}... | kept | |
| The one door out | Open this raising on the hub | kept | |

## 1.13 Module Library (/modules)

| Where | Old | New | Yours |
|---|---|---|---|
| H1 | Module Library | kept | |
| Header sub | Everything this platform can be, one card at a time. A village turns on what it needs and leaves the rest on the shelf. | **Everything this platform can be, one card at a time. A village turns on what it needs and leaves the rest on the shelf, and every card wears its pills so you can read it at a glance.** | |

Tooltips on the header (the cards are single links, so the mechanics live
here):
- on **turns on**: "Every module ships off. An admin turns one on for
  members or for everyone, and the four core modules are always there."
- on **wears its pills**: "On a card, 'Outside service' means the module talks
  to a service that runs somewhere else, and 'managed' means a vendor runs it
  for you. A card with neither pill runs entirely here."

| Where | Old | New | Yours |
|---|---|---|---|
| Builder card | Build one, get paid in $ReGen · Anyone can build a module... | kept, plus a tooltip on **$ReGen** | |

- tooltip on **$ReGen**: "$ReGen is the network's own token. The builders'
  pool pays module builders in it, each lunar cycle, sized by how many
  villages run their module."

## 1.14 Sign in, gates, 404

| Where | Old | New | Yours |
|---|---|---|---|
| Sign-in page / fields / members gate | - | kept (COPY-1 rows stand) | |
| Module-off card | (was: the 404 page) | {Project} hasn't enabled this module... (COPY-1) | |
| 404 | Sorry, the page you are looking for doesn't exist... | Off the trail · There is no page at this address... The land is still here, and the way home is short. · Back to the village (COPY-1) | |

## 1.15 Power map (/map/circles)

All COPY-1 seats-to-roles rows stand (filter chips, breadcrumbs, card lines,
arias, search, vision ghosts). Two residues the COPY-1 verifier found are
closed on this branch:

| Where | Old | New | Yours |
|---|---|---|---|
| Example-set noun (renders in the standing-examples banner) | { id: "progression", noun: "seat" } | noun: **"role"** | |
| Mobile role sheet | aria-label="Seat" | aria-label=**"Role"** | |

## 1.16 Other public role surfaces, command centre exports, banners

Every COPY-1 row stands unchanged (claim card, community calendar's
gathering seats kept as seats, first-walk quest, characters empty state,
introductions, LivingMap fallback, agent panel, Hearts-to-Gratitude export
lines, standing-example banners).

---

# PART 2 - THE LIVING MAP (applies after the landing train)

Every row here lives in a guarded patch script and is NOT applied; the map
artifact stays frozen under the landing train. Scripts, in apply order:

1. `docs/prototypes/patch_copy_01_hearts_to_gratitude.py`
2. `docs/prototypes/patch_copy_02_seats_to_roles.py`
3. `docs/prototypes/patch_copy_03_exchange_room.py`
4. `docs/prototypes/patch_copy_10_guess_to_suggested.py`

Patches 01, 02 and 10 are vocabulary renames (Hearts to Gratitude, seats to
roles, guess to suggested); their strings carry no register to restyle and
they stand as COPY-1 wrote them. Patch 03 carries the two door blurbs, and
those are revised on this branch to enchant-first. The map has no InfoTip
layer, so a door blurb leads with the image and keeps the plain mechanics
after it, and the dock tips and table cells (the map's own tooltip layer)
stay plain, which is exactly where R46 puts the mechanics.

## 2.1 The Exchange door - applies after the landing train

| Where | Old | New | Yours |
|---|---|---|---|
| Door blurb | One ledger, every token. Hearts are gratitude, never a wage. Stay credits and library credits are useful, never votes. | **One room, one ledger: every token the village lives by leaves its thread here. Gratitude is thanks for work, never pay. Stay credits are nights earned through work exchange. Library credits are the deposit that waits while you borrow. None of them are votes.** (exemplar 4; now matches the site page's hero) | |
| Gratitude table row | recognition, the thank-you economy | thanks for work, never pay (COPY-1) | |
| Library credits row | escrowed while you borrow | set aside while you borrow (COPY-1) | |
| Wallet dock tip | The Exchange. One ledger, every token; Hearts are thanks, never a wage. · /wallet | The Exchange. Every token in one room; Gratitude is thanks, never pay. · /wallet (COPY-1; a dock tip is the map's tooltip layer, so it stays plain) | |

## 2.2 The Material Library door - applies after the landing train

| Where | Old | New | Yours |
|---|---|---|---|
| Door blurb | The lending commons. Add your tools to earn credits, borrow with a deposit, wear quoted up front. Every item carries its own story. | **One shelf, many hands: what you no longer need becomes what a neighbor was missing. Add your tools to earn credits; borrow with a deposit. Wear has a price, and you see it before you borrow. Every item carries its own story.** (exemplars 6, 7; now matches the site page's hero) | |
| Library dock tip | Material Library. Borrow with a deposit, wear quoted up front. · /library | Material Library. Borrow with a deposit; wear has a price, told to you first. · /library (COPY-1; plain on purpose) | |

## 2.3 Everything else on the map - applies after the landing train

All other COPY-1 map rows stand exactly as the first book recorded them:
Maia's welcome and tour (seats to roles), the crown vitals (Hearts chip to
Gratitude), the Welcome Walk's first rule ("Gratitude is thanks."), the hover
cards and place panel counts, the Get Involved wall, the Loom's
guess-to-suggested chips, and every deliberate keep (the 22 place blurbs,
origin stories, seed quests, journeys, pulse ticker, lens narrations, build
mode). The first book's PART 2 is the full row-by-row record; this branch
changes none of those strings beyond the two blurbs above.

---

# PART 3 - EMAILS (server, applied by COPY-1, unchanged this round)

| Where | Old | New | Yours |
|---|---|---|---|
| Proposal intake subject | [Amora] New {type} submission... | [{project name from config}] ... (COPY-1) | |
| Investor packet subject | Your Amora Investor Packet | Your {project name} Investor Packet (COPY-1) | |
| Investor intake subject | [Amora] New investor doc request... | [{project name}] ... (COPY-1) | |
| Weekly brief heading | Open seats | Open roles (COPY-1) | |
| Assistant seats answer | ...so no seats are waiting. | ...so none are waiting. (COPY-1) | |
| Everything else (receipts, password mails, connect, reservations, brief body) | - | kept | |

---

# DELIBERATELY NOT CHANGED - the reasons in one place

1. **Seed and sample content (74 SEED rows)** - machinery for the
   example-retirement program, out of copy scope, as in the first book.
2. **"AMORA MASTER PLAN V7" on visitor surfaces** - the public name of that
   document is yours to give.
3. **Vocabulary-program rows (52 VOCAB)** - the Loom, Org lens, crowdpool as
   a proper noun, build mode, the sorting engine and the rest are naming
   decisions, recorded and left.
4. **Gathering-capacity "seats"** - a seat at a table is not a governance
   seat; kept as seats everywhere they mean capacity.
5. **Admin and build-mode rooms** - your own rooms; the ruling covers public
   copy.
6. **Home hero tagline** - identity plane, one config field, yours.
7. **Sociocracy explainer cards on Roles and Circles** - kept teaching in
   place; the new hero tooltips carry the first-touch version of the same
   mechanics.
8. **"Hypha DHO" card wording** - the R45 governance thread is still open;
   the new tooltip explains without rewording the card.
9. **Investor email bodies** - still carry Amora literals
   (`server/index.ts`, six lines); one follow-up commit's worth, flagged in
   the first book.
10. **Quest cards and module cards hold no tooltip triggers** - each card is
    one link on purpose; a button inside a link is invalid HTML. Their
    mechanics sit on the nearest header, hero or detail page instead.
11. **The map artifact** - untouched, as briefed; every map change rides the
    four patch scripts and applies after the landing train.
