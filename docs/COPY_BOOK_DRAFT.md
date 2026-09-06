# The Copy Book - draft for the founder's pass

First pass applied on branch `wt/r5-copy`, 2026-08-22, from
COPY_CENSUS_2026-08-21.md (416 rows, a working file never committed here) under the R45 style ruling: explain
plainly first, in short declarative sentences a first-time visitor trusts; the
enchantment lives in the map's existing metaphors, never in vagueness.

This is the whole public copy of the site, surface by surface in visitor
order, old beside new. Rows marked **kept** are unchanged and printed so the
proofread covers everything. Living-map rows marked **patch NN** are written
into guarded patch scripts (`docs/prototypes/patch_copy_*.py`) and are NOT
applied: the map artifact is frozen under the landing train, and the scripts
apply after it lands.

**Names settled in this pass**
| Thing | One name | Short form |
|---|---|---|
| The token room (`/tokens`, `/wallet`) | The Exchange | - |
| The events page (`/events`) | Village Calendar | Events (menus, map dock) |
| Governance seats, in public copy | Roles | - |
| The recognition token | Gratitude (from config) | the ♥ glyph |
| The amber provenance chip | suggested | - |

---

# PART 1 - THE SITE (client pages, applied)

## 1.1 Site shell: browser titles and auth controls

| Where | Old | New |
|---|---|---|
| Title `/map/circles` | Circles and seats | **Circles and roles** |
| Title `/events` | What is on | **Village Calendar** |
| Title `/tokens` and `/wallet` | Tokens | **The Exchange** |
| All other page titles (Journey to launch, What we have built, Feedback, Village network, Contribute, Seasonal festivals, Investor/Steward/Resident/Prosperity journey, Love letter, Circles, Quests, Propose a quest, Roles, Forum, Messages, Introductions, Village feed, Village map, Meet your village, Stays, Material library, Badges & skills, Village health, My profile, Sign in, Choose a password, Set a new password, Game Mechanics, Leaving well, Tools, Module Library, Village settings) | - | kept |
| Nav label (Village group) | Circles & Seats | **Circles & Roles** |
| Nav label (Village group) | Tokens | **The Exchange** |
| Nav label (Community group) | What's On | **Events** (short form of Village Calendar) |
| All other nav labels (Living Map, Feed, Forum, Messages, Introductions, Circles, Roles, Gratitude, Seasonal Festivals, Share Feedback, Stay, Library, Tools, Health, Housing, Village Network, Contribute, the Join/Guides/About groups, account menu My Profile / Wallet / Badges / Village Settings) | - | kept. "Wallet" in the account menu stays: it is one member's own balances on their profile, a different thing from the Exchange, and the code comments hold that line. |
| Header auth | Sign In · Sign Out Everywhere · Sign In / Register | kept |
| Footer blurb | (config-driven `footerBlurb`) | kept |

## 1.2 Home page (/)

| Where | Old | New |
|---|---|---|
| Hero badge | Come co-create paradise | kept |
| Hero h1 | Co-Become the Most Beautiful Village | kept - this is the configured project tagline (`gameConfig.project.tagline`), an identity choice, not platform copy. Flagged for the founder: the census calls the invented verb a decode cost (worst offender 10). Changing it is one config field. |
| Hero sub | A regenerative village in Costa Rica where all beings belong and thrive. Find your path to participation. | kept |
| Hero CTAs | Find Your Path · Read the Co-Creators Guide | kept |
| Stages h2/sub | From First Visit to Home · Each stage is a chance to get to know each other... | kept |
| Stage steps | Align "Discover our values" · Experience "Visit & participate" · Co-Create "Join our circles" · Integrate "Become a member" · Home "Make it home" | kept |
| Path badge/h2/sub | What brought you here? · Choose Your Path · Four unique journeys... | kept |
| Card: Investor | Investor · Capital Contributor - Plant capital in a project built to last... | kept |
| Card: Steward | Village Steward · Co-Creator - Coordinate and execute for the success of the whole village... | kept |
| Card: Resident | Resident · Co-Creator - Make Amora your home... | kept (the doubled "Co-Creator" subtitle is a NAME flag left for the founder: both Steward and Resident carry it, and only he can rule which one keeps it) |
| Card: Prosperity | Prosperity Creator · Business Builder - Launch or grow your business inside the village... | kept |
| Card CTA | Begin your journey | kept |
| Personas h2/sub | Who Comes to Amora? · Amora attracts people who are done half-living... | kept |
| Persona: Digital Nomad Couple | "We want roots without walls." + body | kept |
| Persona: Worldschooling Family | "Our kids deserve a village." + body | kept |
| Persona: Retiree & Snowbird | "Finally, a second chapter worth living." + body | kept |
| Persona: Longevity Seeker body | ...and purpose as medicine-building a life designed to thrive. | ...and purpose as medicine**: building** a life designed to thrive. |
| Persona: Remote Exec & Founder body | ...their next chapter to matter-contributing capital, skills, or leadership... | ...their next chapter to matter**: contributing** capital, skills, or leadership... |
| Persona: Costa Rican & LatAm Professional | "I want to build something here." + body | kept |
| Persona CTA | See yourself here? There's a path with your name on it. · Find your path | kept |
| CTA h2/sub | Ready to Begin Your Journey? · Join our next community call... | kept |
| CTA buttons | Join Community Call · View All Events | kept ("View All Events" links to the configured `eventsUrl`, offsite; Events is the sanctioned short form) |

## 1.3 Home-embedded bands

| Where | Old | New |
|---|---|---|
| BuildProgress | Build Progress · What's Built. What's Coming. · Real-time milestones from the team... · Completed / In Progress · Completed {date} | kept |
| VillagePulse | Village Pulse · The village is alive | kept |
| MapPeek | Every building traces to something true: a funded build, a claimed quest, a filled seat. Open the map and walk it. | ...a funded build, a claimed quest, a filled **role**. Open the map and walk it. |
| MapPeek aria | Open the Living Map | kept |
| SeasonBanner | (dynamic: season name + focus + countdown) | kept |

## 1.4 Quests page (/quests)

| Where | Old | New |
|---|---|---|
| H1 | Community Quests | kept |
| Hero sub | ...Every quest builds relationships, regenerates the land, and grows the community's collective score. | ...Every quest builds relationships, regenerates the land, and **grows the village**. (the "collective score" was named nowhere else on the site) |
| Stats line | N active quests · up to N {Gratitude} available | kept |
| Ring 1 | Start here - Open to everyone with a profile... | kept |
| Ring 2 | The village - The everyday work the village runs on... | kept |
| Ring 3 | Further in - These open as you walk the Path of Growth... | kept (VOCAB flag "Path of Growth" noted for a later pass; renaming it is a progression-naming decision) |
| Your-journey head | Pick up where you left off / A good first quest | kept |
| Status lines | In progress: submit your work when it's done / Submitted, awaiting circle consent | kept (JARGON flag "circle consent" noted; the Roles page explains consent and a cross-link belongs to a structural pass, not a copy swap) |
| Suggestion sub | A gentle way in. See the first step. | kept |
| Filters | Circle: · Level: · All / Beginner / Intermediate / Advanced · N quests shown | kept |
| Show more / empty states / life signs | Show all N / The quest board couldn't be loaded just now... / There are no quests on the board yet. / No quests match those filters... / Recently completed | kept |

## 1.5 Roles page (/roles)

| Where | Old | New |
|---|---|---|
| H1 | Roles and Circles | kept |
| Hero sub | We organize through sociocratic circles. Each role has an aim, a domain, and a set of accountabilities. Roles sit in the circle, not on the person. | kept (JARGON flag noted; the page's own explainer cards do the teaching two scrolls down) |
| Status badge | Open Seat | **Open Role** |
| Status badges | Filled · Forming · Partially Filled | kept |
| Explainer cards | Circles "Working groups with real authority..." · Roles "Specific responsibilities inside a circle..." · Consent "Decisions move forward when no one has a reasoned objection..." | kept |
| Card headings | Held By · Aim · Domain · Key Accountabilities · Why This Role Matters | kept |
| Loading/failed | Loading roles… / The roles list is catching its breath. Please refresh in a moment. | kept |
| How Roles Evolve | A "tension" in sociocracy language is any felt gap... | kept |
| CTA | Explore Our Circles | kept |
| Unplaced group | Unplaced seats | **Unplaced roles** |
| Claim card intro (comment-adjacent copy) | ...the seat the village wrote down under your name is right below. | kept - it is a code comment, invisible to visitors |

## 1.6 Circles page (/circles)

| Where | Old | New |
|---|---|---|
| H1 | Our Sociocratic Circles | kept |
| Hero sub | The team organizes in circles, each with a clear domain, real authority within it, and a double link back to the General Coordinating Circle. Circles collaborate, and we win together. | kept (JARGON "double link" is explained lower on the same page) |
| CTA | View Roles & Open Seats | **View Open Roles** |
| Loading/failed | Loading circles… / The circles are catching their breath. Please refresh in a moment. | kept |
| Section heads | The Circles Today... · As the Village Matures... | kept |
| Card members line | {names} or "N seats, none held yet" | {names} or "N **roles**, none held yet" |
| Card footer | How it works: Each circle has autonomy within its domain and budget... | kept |
| How Circles Work Together | Each circle has a domain, a budget, and the authority... / consent-based decision-making... / double-linked... | kept |
| CTA 2 | Learn About Roles & Leadership | kept (NAME flag: three labels lead to /roles across the site; collapsing them is a nav decision for the founder) |

## 1.7 Village Calendar (/events)

| Where | Old | New |
|---|---|---|
| H1 | What is on | **Village Calendar** |
| Hero sub | The village's calendar: twelve months and the moons of the year, side by side, and everything dated in one place. | kept |
| Moon line | Today is day N of M in Moon K, {name} (example name) | kept |
| Module gate name | Village Calendar | kept (now matches the h1; the catalog test already asserts this name) |
| RSVP buttons | I'm coming · Maybe · Can't make it | kept |
| Status chips | Cancelled · Postponed · example · Full | kept |
| Link labels | Join online · Open | kept |
| Error | That did not work | kept |
| Wheel tip | Tap a month on the outer ring or a moon on the inner ring to open it. | kept |
| Wheel turning labels | Equal / Longest / Shortest | **Equinox / Solstice** (ruled; plain, no seasonal qualifiers, true in both hemispheres; also on the profile's CycleClock) |
| Empty states | Nothing on this day. / Nothing is on the calendar yet. / Loading... | kept |

## 1.8 Gratitude Wall (/gratitude)

| Where | Old | New |
|---|---|---|
| H1 | The {Gratitude} Wall | kept |
| Hero sub | Appreciation, spoken out loud. Every month each member has a budget of gratitude to acknowledge the people building this village. | kept - but the NAME flag stands: "Every month" beside a budget that refills "when the lunar cycle turns" (:154) is a real contradiction. Which cadence is true depends on the village's `gratitude.monthlyBudget` cycle config, so the founder should rule the wording; suggested: "Each cycle, every member has a budget of gratitude..." |
| Form head | Send gratitude · N / M left this cycle | kept |
| Budget states | Your sending budget unlocks as you progress / We couldn't load your budget, reload to see it | kept |
| Placeholders | Member's email · What are you thanking them for? | "Member's email" is now "Their @handle". The field was `type="email" required` and no surface in this build ever shows a member's address, so it asked for a fact the sender could not get. Handles are already public (`ProfileHero`, `/profile/:handle`), the server resolves one to an id, and a typed address still works for anyone who knows one. |
| Success | Your appreciation is on the wall. | kept |
| Spent state | You've given your whole budget this cycle. It refills when the lunar cycle turns. | kept |
| Signed-out | Sign in to send gratitude to a fellow member. | kept |
| Empty wall | The wall is waiting for its first appreciation. | kept |

## 1.9 Material Library (/library)

| Where | Old | New |
|---|---|---|
| H1 | Material Library | kept |
| Hero sub | Shared tools and goods, borrowed on library credits. Donate what you no longer need and earn the credits to borrow what you do. | kept |
| Status labels | available · out on loan · retired | kept |
| Balance line | Your credits: N · (N no-show(s) on record) | kept |
| Loan actions | Cancel · I returned it | kept |
| Reserve notice | Reserved. N credit(s) moved to escrow until settle. | Reserved. N credit(s) **set aside while you borrow.** |
| Cancel notice | Cancelled. N credit(s) released back to you. | kept |
| Item meta | value N · deposit N · from {stage} | kept ("from Explorer" still assumes stage knowledge; a fix needs a stage-explainer surface, not a word swap - left for the founder) |
| Borrow tip | Locks N credit(s) in escrow | **Sets aside N credit(s) while you borrow** |
| Borrow tip (refused) | Not open to you yet | kept |
| Empty shelf | The shelves are waiting for their first donation. | kept |
| Signed-out | Sign in to borrow. Donations are recorded with a steward. | kept |

## 1.10 The Exchange (/tokens · /wallet)

| Where | Old | New |
|---|---|---|
| H1 | Tokens | **The Exchange** |
| Hero sub | What you hold, and the village exchange. Recognition is earned, never bought. Only the village's own credit tokens are ever listed here. Your own balances also sit on your profile. | **Every token the village uses, in one room. Gratitude is thanks for work, never pay. Stay credits are nights earned through work exchange. Library credits are the deposit that waits while you borrow. Money can buy the credit tokens; Gratitude is only ever earned. Your own balances also sit on your profile.** |
| Purchase notices | Payment received. Your tokens arrive as soon as Stripe confirms (usually seconds). / Checkout cancelled. Nothing was charged. | kept |
| Balances card | Your balances · Loading your balances… · Couldn't load your balances. Retry · Nothing yet. Contribution is where value starts. | kept |
| Buy card head | The exchange | **Buy tokens** (the page owns the name The Exchange now; a card inside it could not carry the same name) |
| Buy card states | Couldn't load the exchange just now. | Couldn't load the **listings** just now. |
| Buy card states | Nothing is listed for purchase right now. · price coming soon · out of stock · N in stock · Buy | kept |
| Refusal captions | Card payments aren't connected yet / Buying opens at the member stage | kept ("member stage" is the progression ladder's own name; the ladder explains itself on the profile) |
| Signed-out | Sign in to buy. | kept |
| Swap card | Not everything trades - {token}: {server reason}. | kept |
| Halted | Swapping is paused for {slugs}: {reason}. | kept |
| Receipts | Receipts · #N: quantities · statuses | kept |
| Hypha card | Hypha holdings - Governance and equity tokens live on your Hypha DHO. This platform shows the door, never moves what's behind it. · Open the Hypha treasury | kept (JARGON "Hypha DHO" noted; the wording tracks the R45 governance ask, which is still open, so it would be wrong to rewrite it ahead of that ruling) |
| Profile wallet card link | Village exchange | **The Exchange** |
| Profile wallet card head | Wallet | kept (one member's own balances, deliberately not the room) |
| Module gate name | Exchange | **The Exchange** |

## 1.11 Sign in (/login) and the gates

| Where | Old | New |
|---|---|---|
| H1 / sub | Welcome Back · Sign in to your Amora village journey | kept (shopfront zone; a fork replaces the brand here wholesale) |
| Fields / buttons | Email · Password · Sign In / Signing in... · Forgot your password? · Don't have an account? · Create Account | kept |
| Members gate card | {Module name} - This part of the village opens when you sign in. · Sign in | **{Module name} · one line saying what is behind the gate, in the words of that module (`client/src/components/modules/gateCopy.ts`) · This part of the village opens when you sign in. · Sign in + Create an account · a closing line naming what is still open to this reader, read off the module manifest.** The old sentence and the Sign in door are unchanged; what is added is the module's own line above them and the still-open line below. A signed-in reader never sees this card: it hands them to the module-off card, whose sentence is the ruled one. |
| **Module-off card (new, R43 Q8)** | (was: the 404 page) | **{Project} hasn't enabled this module. Reach out to the admin team, or make a proposal to initiate it in your village.** + "Back to the village" home button. Project name reads from config; fallback "This village", never a hardcoded brand. Wired in ModuleGate, which every module page routes through. |

## 1.12 404 page

| Where | Old | New |
|---|---|---|
| H1/h2 | 404 · Page Not Found | 404 (small eyebrow) · **Off the trail** |
| Body | Sorry, the page you are looking for doesn't exist. It may have been moved or deleted. | **There is no page at this address. It may have moved, or it may never have existed. The land is still here, and the way home is short.** |
| Button | Go Home (blue, template-stock) | **Back to the village** (village palette, compass mark; soft-404 semantics unchanged) |

## 1.13 Power map (/map/circles)

| Where | Old | New |
|---|---|---|
| Route title | Circles and seats | **Circles and roles** |
| Filter chips | Open seats · My seats · Expiring soon | **Open roles · My roles** · Expiring soon (kept) |
| Breadcrumb bits | open seats · my seats | **open roles · my roles** |
| Card count line | N of M seat(s) held | **N of M held** ("N of M roles held" would miscount: one role, three seats; SetupWalk and search already say "N of M held") |
| Card lines | Speaks for {circle} on how it decides. · Next holder: ... · Decisions here pass by ... | kept |
| Card aria | Show every seat {name} holds | Show every **role** {name} holds |
| Card placeholder | Why this seat calls to you (optional) | Why this **role** calls to you (optional) |
| Card button | This seat is open, raise your hand | This **role** is open, raise your hand |
| Map aria (focus) | Now inside {circle}, N seat(s), N open | Now inside {circle}, N **role(s)**, N open |
| Map aria (node) | {name}, a seat in {circle}, ... / {name}, a village-wide seat, ... | {name}, a **role** in {circle}, ... / a village-wide **role** |
| Search aria | Find a seat, a circle, or a person | Find a **role**, a circle, or a person |
| Vision ghost tip | {label}: a seat this vision would create | {label}: a **role** this vision would create |

## 1.14 Other public role surfaces

| Where | Old | New |
|---|---|---|
| Claim card | A seat is recorded under your name / Some seats are recorded under your name | A **role** is recorded... / Some **roles** are recorded... |
| Claim card body | ...Confirming one links it to you, and the seat keeps everything it already knew. | ...and the **role** keeps everything it already knew. |
| Claim card error | That seat could not be confirmed | That **role** could not be confirmed |
| Community calendar | Seats and slots · Full gatherings you can queue for. The line is age order; a freed seat goes to whoever has waited longest. · You have a seat | kept - these are seats at a gathering (capacity), not governance; the ruling covers governance seats |
| Calendar term marker | Seat | **Role** (the seat-term marker labels a governance role's term) |
| First-walk quest | Find a seat nobody holds · ...an empty seat is an invitation. | Find a **role** nobody holds · ...an **open role** is an invitation. |
| Characters empty state | No seats carry this tag yet. Every seat is still open to you. | No **roles** carry this tag yet. Every **role** is still open to you. |
| Introductions | Drawn from your skills, seats, badges and finished quests. | Drawn from your skills, **roles**, badges and finished quests. |
| LivingMap fallback | The village's circles and seats are on the org view | The village's circles and **roles** are on the org view |
| Agent panel scope | read circles, seats and the people you may already see | read circles, **roles** and the people you may already see |
| Contribute label | Waitlist seat | kept - a place in the waitlist, not governance |
| Admin, Mint, SetupWalk, EventsAdminPanel and other admin rooms | (seat vocabulary throughout) | kept, except the weekly-brief description ("open seats" -> **open roles**) which describes a renamed email heading; the ruling covers public copy and the admin rooms are the founder's own |

## 1.15 Command centre exports (Hearts leftovers)

| Where | Old | New |
|---|---|---|
| Copy-for-Hypha line | {name}: N received (N hearts + N acknowledgments) from N member(s) | (N **gratitude** + N acknowledgments) |
| Report note | Hearts and written acknowledgments are never blended into one number. | **Gratitude** and written acknowledgments are never blended into one number. |
| Table headers | Hearts / Acks | **Gratitude** / Acks |

## 1.16 Standing-examples banners

| Where | Old | New |
|---|---|---|
| Single | This is a standing example. Nobody here made it... Publishing your first real {noun} clears them for good. | kept - the census marks the machinery SEED-owned (ExamplesBanner logic); copy only, and this copy is already right |
| Plural | These are standing examples. Nobody here made them... | kept |
| Refusal chip | (server-worded message rendered verbatim) | kept |

---

# PART 2 - THE LIVING MAP (artifact; every change is a patch script, applies after the landing train)

Patch scripts, in apply order, all guarded (exact-count anchors, refuse on
drift, idempotent, zero bytes on rerun), none run against the artifact:

1. `docs/prototypes/patch_copy_01_hearts_to_gratitude.py`
2. `docs/prototypes/patch_copy_02_seats_to_roles.py`
3. `docs/prototypes/patch_copy_03_exchange_room.py`
4. `docs/prototypes/patch_copy_10_guess_to_suggested.py`

## 2.1 Intro card

| Where | Old | New |
|---|---|---|
| Intro h1 / sub | Amora · a living village · osa, costa rica | kept |
| Intro line | generated from AMORA MASTER PLAN V7 | kept - the census flags the internal doc name (worst offender 6), but a rename ("drawn from the masterplan") needs the founder's word on what the public name of that document is. Deliberately not changed. |
| Intro line / Enter | 9°13′55″N · 83°50′04″W... · Enter the Land | kept |

## 2.2 Maia's welcome

| Where | Old | New |
|---|---|---|
| Welcome line | Welcome to the living map of Amora. Everything you see traces to something true: a funded build, a claimed quest, a filled seat. Hover anything; click any building to open its door. Want the short walk? | ...a funded build, a claimed quest, a filled **role**... - patch 02. (The SEED tension - "traces to something true" over sample data - is the example-retirement program's, not a copy swap.) |
| Follow-up / tour opener / signed-out tap | Whenever you're ready: take the tour... · Come, the short walk... · That one is kept against your name... | kept |

## 2.3 Crown vitals bar and moon

| Where | Old | New |
|---|---|---|
| Vitals: People / Food / Water / Canopy | People · Food · Water · Canopy (+ sample numbers) | kept (SEED numbers are the seed program's) |
| Vital: Hearts | Hearts · 132 · gratitude this cycle | **Gratitude · 132 · sent this cycle** - patch 01 (the sub changed with it so the chip does not stutter "Gratitude - gratitude") |
| Vitals name map | ...hearts:'Hearts'... | ...hearts:'**Gratitude**'... - patch 01 (the drop-down titles render from this map) |
| Hearts drop-down | 132 ♥ · gratitude this cycle / reads the Gratitude ledger / ♥ Send gratitude ↗ | kept - renders from the renamed map; the ♥ glyph is the Gratitude mark platform-wide |
| Moon chip / drop-down | waxing gibbous · cycle closes in 6 days / the lunar cycle closes the books... | kept (JARGON flag noted for a later pass) |
| Vital tooltip / canopy fallback | "{how} · {src}" / no forest drawn yet... | kept (VOCAB flags noted) |

## 2.4 Top chrome

| Where | Old | New |
|---|---|---|
| Layer buttons | Now / Vision / Org / Flows | kept (the Org/Circles NAME flag is a lens-naming decision, not a string swap) |
| Theme panel / describe / dials / map selector / Get Involved / Loom button | Map themes · your land, your language / Weave it / ... / ⧉ The Loom | kept |
| Dock tip: wallet | The Exchange. One ledger, every token; Hearts are thanks, never a wage. · /wallet | **The Exchange. Every token in one room; Gratitude is thanks, never pay. · /wallet** - patch 03 |
| Dock tip: stay | Stays. Book a room; work-exchange quests extend your stay. | kept |
| Dock tip: housing | Housing. Lots in the hamlets, the waitlist, the land-share path. | kept (JARGON noted) |
| Dock tip: library | Material Library. Borrow with a deposit, wear quoted up front. · /library | **Material Library. Borrow with a deposit; wear has a price, told to you first. · /library** - patch 03 |
| Dock tips: journeys / events / admin | Journeys... / Events. The lanterns burn brighter... / Make this map yours... | kept ("Events" is the sanctioned short form) |
| Mobile bar / minimap / attention button / exit toast | map · ask maia · help · more / Amora ·... / ⚑ What needs hands / ⏏ On the site... | kept |

## 2.5 Circles lens header

| Where | Old | New |
|---|---|---|
| Header | ◎ The Circles | kept |
| Sub | ...open seats pulse as open calls | ...open **roles** pulse as open calls - patch 02 |
| Lens toasts | ◎ The Circles. The same village as an organism... / 🏞 The Living Map. The land itself. | kept |

## 2.6 Hover card and place panel

| Where | Old | New |
|---|---|---|
| Hover circle line / state labels | "{Circle} circle" / Blueprint · Gathering the pool / ... | kept (VOCAB flags noted) |
| Hover counts | ⚑ N quest(s) · ⛨ N seat(s) open | ⚑ N quest(s) · ⛨ N **role(s)** open - patch 02 |
| Hover hint / panel head sub | click to open the door / "{Circle} circle · {state} · pool NN%" | kept |
| Panel tabs | Overview · Quests here · Seats here · Enter → | Overview · Quests here · **Roles here** · Enter → - patch 02 |
| Role-line fallback / provenance line / lots line | A new organ, still finding its function... / {District} · {phase} · AMORA MASTER PLAN V7 / ⌂ N of M lots spoken for... | kept (provenance-line doc name: same deliberate keep as 2.1) |
| Counts line | ⚑ N quests · ⛨ N open seats · 💬 N conversation(s) | ⚑ N quests · ⛨ N open **roles** · 💬 ... - patch 02 |
| Threads head / vitals head / vitals empty / metabolism / import chips / flows lines / blueprint note / footer | what people are saying here / vitals at this address · sample data / ... / last verified 2 days ago · Amora stewards | kept (the fake-freshness footer is a SEED row for the example-retirement program) |
| Quests tab empty | No open quests here right now. The greenhouse and the food forest are calling, though. | kept (SEED: named buildings; retiring it is the seed program's call) |
| Seat row button / raise-hand toast | Raise a hand / Intro drafted. The {circle} circle will hear from you. (Prototype; the real form lives at /roles.) | kept (the "Prototype" aside is a VOCAB row noted for the founder) |
| Seats tab empty | All seats filled here. Beautiful problem. | All **roles** filled here. Beautiful problem. - patch 02 |
| Doors tab / claim strings / first step | No doors here yet... / Claim this quest / ✔ Yours · tap to release / ... | kept |

## 2.7 Place cards - the 22 building blurbs

All 22 blurbs (The Gate, Welcome Lodge, Market Pavilion, Pond Hamlet, The
Ponds, Greenhouse & Gardens, Community Center, Kitchen & Hearth, Library &
Workshop, Council Fire, Food Forest, Water Tank, Springs Two/Three/Four, A
Possible Spring, Ridge Hamlets North/South, The Sanctuary, Guest Lodge,
Healing Garden, Pacific Trailhead) - **kept**. They are the map's voice at its
best and the census flags on them (SCENE seed, "crowdpool", "lunation") are
seed-program and vocabulary-program work, ruled separately.

## 2.8 Origin stories and role-in-the-organism lines

Kept in full (SEED flags stand for the seed program: fictional histories need
either truth or an example label, which is machinery, not copy).

## 2.9 Seed quests and seats

Kept in full - 14 quests, 8 role listings; the strings carry no "seat" or
"Hearts" to rename, the ♥ denominations are the Gratitude mark, and their
unlabeled-example problem is the ExamplesBanner standard's to solve.

## 2.10 Site-imported quests and roles

Kept in full; the `_why` hover already says "a suggestion, unapproved", which
patch 10 now matches everywhere else.

## 2.11 Journeys

Kept in full ("Steward (Co-Creator)" double name is the same founder decision
flagged on the Home cards; Loom mentions read consistently after patch 10).

## 2.12 Sample forum threads

Kept in full (SEED; unlabeled fictional authors are the seed program's row).

## 2.13 Pulse ticker

Kept in full - ♥ amounts are Gratitude-denominated (patch 01 docstring
records the glyph decision); fictional arrivals are SEED rows.

## 2.14 Events and the promise lines

Kept in full (sample events are SEED; the RSVP/claim promises and refusal
lines already speak plainly).

## 2.15 Module doors

| Where | Old | New |
|---|---|---|
| The Exchange blurb | One ledger, every token. Hearts are gratitude, never a wage. Stay credits and library credits are useful, never votes. | **Every token the village uses, in one room. Gratitude is thanks for work, never pay. Stay credits are nights earned through work exchange. Library credits are the deposit that waits while you borrow. None of them are votes.** - patch 03 |
| Exchange table: Gratitude row | ♥ Gratitude · 132 ♥ · recognition, the thank-you economy | ♥ Gratitude · 132 ♥ · **thanks for work, never pay** - patch 03 |
| Exchange table: Stay credits row | 🛏 Stay credits · 4 nights · work-exchange quests extend your stay | kept (already plain) |
| Exchange table: Library credits row | 🧰 Library credits · 850 · escrowed while you borrow | ...· **set aside while you borrow** - patch 03 |
| Exchange table footer | sample balances. The live ledger at /wallet keeps the truth | kept (the /wallet page now answers to The Exchange, closing the NAME loop) |
| Stays blurb / future-door / sample rooms | Book a room and pay in stay credits or money. Two posted prices, no exchange rate... | kept ("Two posted prices, no exchange rate" is the no-conversion doctrine compressed; a fuller teach belongs with the Stays surface, noted for the founder) |
| Housing blurb / footer | Reserve a home in a neighbourhood... / Example numbers. The founder has not set this hamlet yet. | kept |
| Material Library blurb | The lending commons. Add your tools to earn credits, borrow with a deposit, wear quoted up front. Every item carries its own story. | **The lending commons. Add your tools to earn credits; borrow with a deposit. Wear has a price, and you see it before you borrow. Every item carries its own story.** - patch 03 |
| Library sample rows | Borrow quote · Makita driver · ≈ 1.4% wear, quoted before you borrow · sample shelf... | kept (already plain where it counts) |
| Forum / Quests door | The village conversation... / Find somewhere to help. Hearts for the work, claimed with consent. | Forum kept; Quests: **Gratitude for the work, claimed with consent.** - patch 01 |
| Journeys / Health / Events / Settings doors | Walk a path... / The numbers behind the map... / Feasts, build days, ceremonies... / Village Settings · Make This Yours... | kept (VOCAB flags - "the Loom", "crown banner", "Two doors, one room" - noted) |

## 2.16 Maia - scripted tour

| Where | Old | New |
|---|---|---|
| Tour 1-3, 5-7 | Welcome to Amora: 123 hectares... / The Welcome Lodge... / The Ponds... / The Village Heart... / Up the ridge... / South, where the land still dreams... | kept (Master Plan V7 naming: same deliberate keep as 2.1; crowdpool VOCAB noted) |
| Tour 4 | The Greenhouse, engine room of food sovereignty. Two seats are open and three quests are waiting; the seedling census is a beautiful first one. | Two **roles** are open... - patch 02 |
| Tour 8 | ...Claim a quest, raise a hand for a seat, come to the feast tonight. Where shall we start? | ...raise a hand for a **role**, come to the feast tonight... - patch 02 |

## 2.17 Maia - concierge answers

| Where | Old | New |
|---|---|---|
| Identity / chips / placeholder | Maia · village guide / Take the tour · Where can I help? · What's alive? / Ask Maia... | kept |
| help / today / night / quest answers | Here's what needs hands... / Today so far: Sol finished... / Night on the land... / The Greenhouse holds the friendliest first quests... | kept (the invented news is a SEED row) |
| seat/role/job answer | Get Involved lists every open seat and quest in one place, the map's honest sibling. | ...every open **role** and quest in one place... - patch 02 |
| module match / gratitude answer | That lives behind the {module} door. / Gratitude flows at /gratitude, where 132 ♥ moved this cycle. It isn't money you spend; it's recognition you give. | kept (the line already names Gratitude; 132 is a SEED number) |
| quest match / walk-to | That sounds like {quest}... / Walking you to the {place} now. | kept |
| seat match | The {seat} seat is open, and it sits at the {place}. Raise a hand from its card. | The {name} **role** is open, and it sits at the {place}... - patch 02 |
| no match / structure summary | Nothing on the land matches that yet... / {Name}: ... Right now: N quests · N open seats... | summary: N open **roles** - patch 02; rest kept |
| icon-style lines | Painted sprites: the village in oils... | kept (VOCAB noted) |

## 2.18 The Welcome Walk

| Where | Old | New |
|---|---|---|
| w1 | Every story here walked in through this gate. Today that's you... | kept |
| w2 | First meals, first questions. And our first rule: Hearts are gratitude. We thank each other. We never pay each other to care. | ...And our first rule: **Gratitude is thanks.** We thank each other. We never pay each other to care. - patch 01 |
| w3 | Rain, caught and kept... | kept |
| w4 | Quests live where the work lives... and it will thank you in Hearts. | ...and it will thank you in **Gratitude**. - patch 01 |
| w5 / w6 | No bosses here. We are circles... / This hamlet is being pooled into existence... | kept |
| w7 | ...traces to something true: a funded build, a claimed quest, a filled seat. Delete the map and no truth dies. | ...a filled **role**... - patch 02 |
| w8 | The whole point of this map is to get you off it and into the real one. Pick a door. | kept |

## 2.19 Lens narrations and theme toasts

Kept in full (Org-lens naming, "dashed falls", "questable", "Vector floor"
are VOCAB rows for a vocabulary ruling, recorded, not swapped blind).

## 2.20 Get Involved wall and attention banner

| Where | Old | New |
|---|---|---|
| Wall header / stranded / unowned rows | Get Involved · find somewhere to help / stranded outside the line / no circle holds this place yet | kept (the stranded rows are founder-instruction VOCAB, noted) |
| Wall section head | open seats | **open roles** - patch 02 |
| Wall button tooltip | Every open seat and quest in one list. Find somewhere to help. | Every open **role** and quest in one list... - patch 02 |
| Quest row fallback | Quest Board · not yet placed | kept |
| Attention: seat | ⛨ Seat open: {name} - {circle} circle needs a steady hand. | ⛨ **Role open:** {name}... - patch 02 |
| Attention: quest / empty / room-for-work | ⚑ {quest} - {reward} · Real hands, real soil. / Nothing needs hands right now. A beautiful problem. / ⚑ {place} has room for work... | kept |

## 2.21 The Loom

| Where | Old | New |
|---|---|---|
| Header / save bar | ⧉ The Loom · every thread between work and place... / Save rewires · Discard... | kept (Loom vocabulary is a ruled-metaphor row, noted) |
| Filter chips | ⚑ quests · ⛨ roles · 💬 threads · journeys | kept (already says roles) |
| Provenance chips | creator · guesses (title "a guess with a label. Always yours to move.") · pool | creator · **suggested** (title "**suggested from the words. Always yours to move.**") · pool - patch 10 |
| Engine button | ⚙ the sorting engine | kept |
| Engine explainer step 4 | a match on the words (amber: a guess, always yours to move) | (amber: **suggested**, always yours to move) - patch 10; ladder steps 1-3, 5 kept |
| Engine step detail | "{words}" speaks {place} (score N). A guess, yours to move | ...**Suggested, yours to move** - patch 10 |
| Loom open toast | The Loom. Gold is your word, amber is a guess, gray waits at the Board. | ...amber is **suggested**, gray waits at the Board. - patch 10 |
| Row chips | ◉ {place} · a guess / creator · guess · pool | ◉ {place} · **suggested** / creator · **suggested** · pool - patch 10 |
| Row resolved name | {place} (guess) | {place} (**suggested**) - patch 10 |
| Staged toasts | Staged → {place}. Save makes it your word. / ⧉ N rewires saved... | kept |
| Resolver panel | Where does this quest live? · Same words in, same home out. No AI, no dice. Every guess wears a label, and your correction is what sticks. | ...Every **suggestion** wears a label, and your correction is what sticks. - patch 10 |
| Quest created toast | ⚑ Created at {place}. A guess for now; move it any time in the inspect card | ...**Suggested for now;** move it any time... - patch 10 |
| Quest address line | ⚑ This quest lives at {place} · a guess | ...· **suggested** - patch 10 |

## 2.22 Make this map yours (skin panel)

Kept in full - the skin panel is the founder's styling room reachable from
the public dock, its copy is already plain, and the "step 6" footer VOCAB is
noted for the founder.

## 2.23 Session bars

Kept in full (restore/draft/publish bars are founder-facing chrome).

## 2.24 Build mode

Kept in full, on purpose: build mode is the founder's hand, census 1.24 lists
it as founder-facing, and the seats->Roles ruling covers public copy. Its
seat toasts (⛨ {name} now lives at {place}) still say seat and may follow in
a build-mode pass if the founder wants one vocabulary everywhere.

---

# PART 3 - EMAILS (server, applied)

| Where | Old | New |
|---|---|---|
| Proposal intake (admin) | [Amora] New {type} submission from {name} | **[{project name from config}]** New {type} submission from {name} |
| Proposal receipt | We've received your proposal | kept |
| Password set / founder bootstrap / reset | Set your password / You are the founder admin. Set your password / Set a new password | kept |
| Connect request | [{project}] {First} wants to connect about {role} | kept (already config-driven) |
| Investor packet | Your Amora Investor Packet | **Your {project name} Investor Packet** |
| Investor intake (admin) | [Amora] New investor doc request from {name} | **[{project name}]** New investor doc request from {name} |
| Investor packet BODY | "...investing in Amora... The Amora Team" | kept - bodies were outside this group's scope; flagged for a follow-up (server/index.ts:16211-16217) |
| Reservation intake / receipt | [{project}] Home reservation request... / We have your reservation request | kept |
| Weekly brief heading | Open seats | **Open roles** (the body under it already said "N roles need someone") |
| Weekly brief gathering line | {title}, {when} (N seats open) | kept - seats at a supper are capacity, not governance |
| Assistant seats answer | No roles are defined in this village yet, so no seats are waiting. | ...so **none** are waiting. |
| Weekly brief everything else | Staying now... / This week: N gatherings... | kept |

---

# DELIBERATELY NOT CHANGED - the reasons in one place

1. **Seed/sample content everywhere (74 SEED rows)** - the census's biggest
   flag class is not a wording problem: fictional pulses, invented news,
   sample vitals and fake freshness need the ExamplesBanner labeling standard
   or real data, which is machinery the brief put out of scope ("copy only,
   never logic").
2. **"AMORA MASTER PLAN V7" on visitor surfaces** - the public name of that
   document is the founder's to give; a guessy rename would trade one
   unexplained name for another.
3. **Vocabulary-program rows (52 VOCAB)** - "the Loom", "Org lens",
   "crowdpool", "build mode", "the sorting engine", "Quest Board", "crown
   banner", "Vector floor", sprite-pipeline words: each is a naming decision,
   not a plain-English swap; this pass fixed the one ruled chip (guess ->
   suggested) and recorded the rest.
4. **Gathering-capacity "seats"** - CommunityCalendarCard, the weekly brief's
   "(2 seats open)", Contribute's "Waitlist seat": a seat at a table is not a
   governance seat, and renaming them to "role" would be wrong.
5. **Admin and build-mode rooms** - Admin.tsx, Mint.tsx, SetupWalk, the map's
   build bar: the ruling covers public copy; these are the founder's own
   rooms.
6. **Home hero "Co-Become the Most Beautiful Village"** - it is the project's
   configured tagline (identity plane), so changing it is a founder decision,
   one config field away.
7. **Sociocracy explainers (Roles/Circles heroes)** - flagged JARGON, but
   both pages teach the terms in their own explainer cards; cutting the
   vocabulary would cut the teaching.
8. **"Hypha DHO" card on The Exchange** - the R45 governance thread (how much
   Hypha stays in v1) is still open; rewording ahead of that ruling would
   guess at the answer.
9. **Investor email bodies** - group 7 was scoped to the three subjects; the
   bodies carry six more Amora literals, one follow-up commit's worth.
10. **GratitudeWall "Every month" vs the lunar cycle** - a real
    contradiction, but which cadence is true is per-village config; the
    founder should rule the wording (suggested fix in section 1.8).
