# Governance

<!-- written by a person: purpose -->
How a village decides: what a decision is, how a vote is counted, what each kind of decision asks of the village, what happens when one carries, and which of the rulings behind all of that are built today.

<!-- written by a person: scope -->
This describes a FRESH village: what a village standing up a new instance holds after the migrations run and the server starts for the first time. A village that has been running has its own history on top of it.

## How to read this file

<!-- written by a person: generated -->
This file is generated. `scripts/generate-governance-doc.mjs` reads the engine, the subject registry, the dials, the capability tables, the module definition, the clock and the route registrations, works out the facts, and writes the whole document. `scripts/check-governance-doc.mjs` regenerates it and fails the build when the committed text and the code have come apart.

It describes the code at commit `db6cc4f9b5a0c37958531edcef28bac95b56d2cc`.

<!-- written by a person: editing -->
Editing this file by hand does not hold. Change the code, then run:

```bash
node scripts/generate-governance-doc.mjs
```

<!-- written by a person: twoKinds -->
Two kinds of line live here, and the difference matters:

<!-- written by a person: readFromCode -->
**Read from the code.** Every table, every number, every key, every route, and the JSON block at the end. If one of these is wrong, the code is what is wrong.

<!-- written by a person: writtenByPerson -->
**Written by a person.** The explanations, and the rulings. They are stored inside the generator so this whole file stays generated, and each one is marked in the source of this file with a comment naming the entry it came from. The founder's own words are quoted verbatim and marked the same way.

<!-- written by a person: noTimestamp -->
There is no timestamp and no author line, on purpose. Both would change on every run and turn an honest diff into noise. The commit named above is the commit whose sources this describes, and git history is the record of when it changed.

## The constitution in one screen

<!-- written by a person: constitutionOpening -->
The long tables come after this. These are the rules that do not move, kept short on purpose so a village can read the whole of what binds it in one screen.

<!-- written by a person: ringZero -->
**Ring 0 is the constitution.** Some rules are published and tunable by nobody: the capability gate order, the append-only ledger, the fact that a ballot freezes its own terms when it opens. A dial's minimum and maximum are Ring 0 too, so a village moves a value inside its bounds and never moves the bounds. Ring 1 is the dials the village's catalysts hold. Ring 2 is the dials the whole village governs by proposal.

<!-- written by a person: ringZeroFreeze -->
The freeze is the one to read twice. Method, dials, electorate and weights are written into the ballot's own row inside the transaction that opens it, and every later evaluation reads that row. Changing a village setting can never rewrite a vote that is already running, and it can never rewrite one that has closed.

<!-- written by a person: birthingRule -->
**The Birthing.** A village's first vote is the one that starts its Game, and it asks for everybody. Token issuance is refused until it carries, so nothing a member holds exists before it. The floors below are code and not settings, and a village cannot lower them.

| The Birthing asks | Number | Where it lives |
| --- | --- | --- |
| Unity, the share of the weight that took a side and agreed | 100% | code, `shared/ballotSubjects.ts` |
| Quorum, the share of the frozen weight that answered | 100% | code, `shared/ballotSubjects.ts` |
| People on the roll before it may be asked | 3 | code, `shared/ballotSubjects.ts` |
| Every seat carrying weight above zero | required | code, `shared/ballotSubjects.ts` |
| Method | `custom` | code, `shared/ballotSubjects.ts` |

With every seat above zero, 100% of the weight is reached only when every seat has answered, so the weight rule proves the people rule. A Birthing carries when all of the people on the frozen roll have voted and all of the weight that took a side agrees.

<!-- written by a person: criticality -->
**Criticality, and the ceiling of 97.** Nothing is un-votable. The more critical a change is, the more of the village has to show up and agree before it lands, and the recommended ceiling is 97 percent of quorum and 97 percent of unity. Above that a village is warned in words: as the bar approaches 100, one player dying or drifting away can freeze a Game a large majority wants to continue. The Birthing stays at 100 and 100 because it is the one vote where everyone is present by definition.

<!-- written by a person: criticalityToday -->
Criticality tiers are built. Every setting carries a tier, the tier sets the quorum and the unity a change to it needs, and the tiers and the subject floors are themselves settings a village may raise and may never lower. What is still staged is the rule that a threshold changes at its own current bar.

<!-- written by a person: quorumIsWeight -->
**Quorum and unity are token weight.** They are computed over the weight token, or over heads when the village runs one person one vote, where every seat weighs one. There is no head-count quorum. The sentence after this one is read out of the arithmetic itself, so it cannot go on saying so after somebody changes the formula.

Read out of the arithmetic: `quorumPctOf` adds `yesW`, `noW`, `abstainW` and divides by the frozen weight of the whole roll. It reads no head count at all. Quorum is weight.

<!-- written by a person: concentrationConsequence -->
**One holder of 97 percent of the Voice carries a constitutional change alone.** That follows from pure weight, and it is stated here because the founder accepted it as the design: concentration is allowed and invisibility is not. Every ballot, every tier control and every sentence this platform generates about a vote shows the people count beside the weight, and every player's share of the whole is visible to every other player. Transparency is the protection.

<!-- written by a person: accountsNotPeople -->
**This platform counts accounts.** It has no way to know that two accounts are one person, so a rule asking for three different parties is satisfied by three accounts one person made. A village's own membership practice is the only thing that makes a head count mean people, and no number on this page can do that work for it.

<!-- written by a person: stewardlessHealthy -->
**A village with no steward is healthy.** It is the state the training wheels come off into, and nothing here renders an empty seat as a warning or a queue. A carried decision lands whether or not anybody holds the seat. An empty seat is a village nobody can stop, and a village that chose that is playing the Game as designed.

<!-- written by a person: englishOnly -->
Governance copy is English, and only English, in version 1.0. Nothing on these surfaces is translated, and a village whose members read another language is reading these words as they are. It is a limit of this version and it is written down so a fork can plan around it.

<!-- written by a person: publishModule -->
Read the module state first. While the governance module is off, every path under its prefixes answers 404 to everybody, signed in or not. The mechanics routes are never module-gated, so they answer under every lifecycle.

The governance module ships **off**. Its lifecycles are `off`, `preview`, `members`, `public`, an absent row means off, and its prefixes are `/api/governance`, `/api/admin/governance`. It turns on `ballot.vote`, `member.vouch` and carries 8 settings of its own.

## What a decision is

<!-- written by a person: decisionIs -->
A decision is a ballot: one question, one frozen electorate, one document, and one outcome recorded by a person. The document a ballot carries is the document that was checked when it opened, stored on the ballot's own row, so what was voted on is what was read.

A ballot is in one of these states: `open`, `passed`, `failed`, `no_quorum`, `withdrawn`.

<!-- written by a person: oneOpenBallot -->
One open ballot per subject, held on a unique index and never on an application check. Closing frees the subject the same second, so a vote that missed its participation can be asked again the same hour, and the ballot that missed stays closed with its own frozen roll.

<!-- written by a person: votesChangeable -->
A vote is one row per member per ballot, changeable until the ballot leaves the open state or the clock passes the closing instant. Changing a vote overwrites the row, so a member has one answer on the record at a time.

<!-- written by a person: closingIsHuman -->
Closing is a human act. When the voting window ends nothing executes: votes lock, the ballot waits, and a person closes it with a note that becomes the sentence the village keeps. One mechanism runs on a clock, and it is named in the cycle section below.

## How a vote is counted

<!-- written by a person: countingIntro -->
Everything the engine counts is weight. Quorum is checked first, for every method, so a decision too few people answered reads as no quorum and never as a rejection.

```
unity  = (yes + no > 0) ? yesWeight / (yesWeight + noWeight) : 0
quorum = totalWeight > 0 ? (yesWeight + noWeight + abstainWeight) / totalWeight : 0
passed = quorum >= quorumFrozen && unity >= unityFrozen
```

<!-- written by a person: abstainRule -->
An abstention counts toward quorum and takes no side on unity. It is the instrument for helping a decision reach the room while holding no position in it. One subject overrides that, and the subject table below says which: on the Birthing an abstention answers nothing at all, so it counts toward neither the quorum nor the unity and the vote closes for want of quorum, which can be asked again.

A vote is one of `yes`, `no`, `abstain`. An outcome is one of `passed`, `failed`, `no_quorum`.

| Method | What it asks | Unity it stamps at open |
| --- | --- | --- |
| `majority` | Unity strictly above 50. A tie fails. | 50 |
| `custom` | Unity at or above the number the ballot froze. | the village's own |
| `consensus` | No weight voted no, and some weight voted yes. | 100 |
| `consent` | No objection is standing. Unity is never read. | 0 |

<!-- written by a person: peopleAndWeight -->
Every sentence this platform generates about a vote states people AND weight together. One of three people voting, holding all of the frozen weight, is a true sentence about a vote; a bare participation percentage is not, whatever sits beside it.

<!-- written by a person: nonHumanSeats -->
**A seat held for a being other than a person votes.** Its representative is a member or an agent built to hold that point of view, and the seat is filled and emptied by a vote like any other. Whether its weight counts toward quorum is a village setting, off by default: when it is out, its weight leaves both halves of the fraction and its cast vote still counts toward unity; when it is in, weight that provably cannot vote leaves the denominator, so a representative who drifts away cannot freeze the village. The excluded weight is shown beside the people count, always.

`governance.nonhuman_in_quorum` ships `false` and `governance.absent_cycles` ships `3`, so on a fresh village a seat held for a being other than a person is outside the quorum arithmetic and its vote still counts toward unity.

<!-- written by a person: noFallback -->
**Nothing falls back.** A tier that misses quorum three cycles running does not pass. The second miss warns that the next one ends it and names the tier as the obstacle; the third closes the question in a named terminal state with one door, which is to withdraw and rewrite, carrying the backers. The stalemate warning computes the most quorum a village could reach against the weight that can actually vote, so it fires on arithmetic and never on a static number.

## The dials a village holds

<!-- written by a person: dialsIntro -->
The dials a village holds, with the ring that says who may move each one and the moment a passed change takes effect. `open` dials are the village's by proposal. `founder` dials are held by the village's catalysts and are refused to a proposal, and the platform ceiling runs one way: a catalyst can close an open dial to the community, and nothing can open a `founder` one to it. The stored role value for a catalyst is `founder`, which is the same word the ring is named after and the reason both read that way here.

| Key | What it decides | Ring | Default | Bounds | Applies |
| --- | --- | --- | --- | --- | --- |
| `governance.voice_weighting` | How sensing is weighted | `open` | `equal` | `equal`, `hypha-mirror` | when it is written |
| `governance.hypha_threshold` | The proposer bar: earned recognition to propose | `open` | `0` | 0 to 10000000 Gratitude | when it is written |
| `governance.sensing_days` | How long a topic stays open for sensing | `open` | `7` | 1 to 90 days | when it is written |
| `governance.proposals_per_member_per_cycle` | Mechanics proposals per member per cycle | `open` | `5` | 1 to 100 per cycle | when it is written |
| `governance.proposal_support_threshold` | Supporters before a proposal can go to the vote | `open` | `0` | 0 to 10000 supporters | when it is written |
| `governance.hub_url` | Governance hub URL | `founder` | `` | text | when it is written |
| `governance.auto_apply_enabled` | Apply verified proposals automatically | `founder` | `true` | boolean | when it is written |
| `governance.steward_subjects` | Which decisions a steward can stop | `open` | `all` | text | when it is written |
| `governance.steward_veto_tiers` | Which sizes of decision a steward can stop | `open` | `constitutional` | text | when it is written |
| `governance.payout_delay_over` | Payouts above this wait three days before they are sent | `open` | `1000` | integer | when it is written |
| `governance.steward_council` | A veto needs a majority of the stewards | `open` | `false` | boolean | when it is written |
| `governance.veto_hours` | How long a steward has to stop a change | `open` | `72` | 72 to 720 hours | when it is written |
| `governance.landing_expiry_cycles` | Cycles a passed decision waits before it is written off | `open` | `3` | 1 to 12 cycles | when it is written |
| `governance.change_cooldown_days` | Cooldown after a governed rule change | `open` | `0` | 0 to 365 days | when it is written |
| `governance.window_changeset` | When a change to the Game Mechanics can go to the vote | `open` | `always_open` | text | when it is written |
| `governance.window_mint_rule` | When a change to what the village mints can go to the vote | `open` | `always_open` | text | when it is written |
| `governance.window_governance_mode` | When a change to how votes are counted can go to the vote | `open` | `always_open` | text | when it is written |
| `governance.window_role_declare` | When declaring a role can go to the vote | `open` | `always_open` | text | when it is written |
| `governance.window_role_seat` | When seating a role can go to the vote | `open` | `always_open` | text | when it is written |
| `governance.window_role_unseat` | When taking a seat back can go to the vote | `open` | `always_open` | text | when it is written |
| `governance.window_power_transfer` | When moving a power to a role can go to the vote | `open` | `always_open` | text | when it is written |
| `governance.window_power_grant` | When granting a power can go to the vote | `open` | `always_open` | text | when it is written |
| `governance.window_power_return` | When handing a power back can go to the vote | `open` | `always_open` | text | when it is written |
| `governance.window_grace_days` | How long a proposal coming back may open outside its window | `open` | `7` | 0 to 90 days | when it is written |
| `governance.weight_mode` | How voting weight is assigned | `founder` | `equal` | `equal`, `token`, `custom` | when it is written |
| `governance.weight_token` | The weight token | `founder` | `gratitude` | text | when it is written |
| `governance.unity_pct` | Unity needed to pass | `open` | `80` | 50 to 100 % | when it is written |
| `governance.quorum_pct` | Quorum needed to count | `open` | `20` | 1 to 100 % | when it is written |
| `governance.vote_days` | How long a ballot stays open | `open` | `7` | 1 to 30 days | when it is written |
| `governance.consent_window_days` | How long a consent window stays open | `open` | `7` | 1 to 30 days | when it is written |
| `governance.default_method` | How village-wide ballots decide | `open` | `custom` | `custom`, `majority`, `consensus`, `consent`, `hypha` | when it is written |
| `governance.tier_routine_quorum_pct` | Routine changes: quorum floor | `open` | `0` | 0 to 100 % | when it is written |
| `governance.tier_routine_unity_pct` | Routine changes: unity floor | `open` | `0` | 0 to 100 % | when it is written |
| `governance.tier_structural_quorum_pct` | Structural changes: quorum floor | `open` | `50` | 50 to 100 % | when it is written |
| `governance.tier_structural_unity_pct` | Structural changes: unity floor | `open` | `80` | 80 to 100 % | when it is written |
| `governance.tier_constitutional_quorum_pct` | Constitutional changes: quorum floor | `open` | `97` | 97 to 100 % | when it is written |
| `governance.tier_constitutional_unity_pct` | Constitutional changes: unity floor | `open` | `97` | 97 to 100 % | when it is written |
| `governance.highest_tier` | The tier a veto override is passed at | `open` | `constitutional` | `routine`, `structural`, `constitutional` | when it is written |
| `governance.subject_mint_rule_quorum_pct` | Minting rule changes: quorum floor | `open` | `50` | 50 to 100 % | when it is written |
| `governance.subject_mint_rule_unity_pct` | Minting rule changes: unity floor | `open` | `0` | 0 to 100 % | when it is written |
| `governance.nonhuman_in_quorum` | Seats speaking for other beings count toward quorum | `open` | `false` | boolean | when it is written |
| `governance.absent_cycles` | Cycles of silence before a seat leaves the count | `open` | `3` | 1 to 24 cycles | when it is written |
| `membership.vouch_threshold` | Vouches to admit a member | `open` | `0` | 0 to 20 vouches | when it is written |

<!-- written by a person: dialsStorage -->
Only CHANGED values are stored. An absent row means the platform default in the table above, so a fresh village starts with every one of these and no rows at all.

11 settings across the whole registry wait for a cycle close instead of applying when they are written: `cycle.mode`, `economy.voice_claim_threshold`, `economy.claims_week_days`, `economy.claims_week_starts`, `gratitude.base_budget`, `gratitude.pool_per_cycle`, `gratitude.pool_token`, `gratitude.max_share_per_recipient`, `feed.heart_amount`, `feed.max_hearts_per_recipient_per_cycle`, `ledger.admin_mint_cycle_cap`. The per-stage sending multipliers carry the same timing through their own override, one for each rung of the ladder. None of the 43 settings above is one of them, so every governance dial takes effect the moment it is written.

## What each kind of decision asks

<!-- written by a person: subjectsIntro -->
What each kind of decision asks. A subject declares MINIMUMS and the village's own dials still decide: the ballot freezes whichever number is higher, so a village that asked for more keeps what it asked for. A subject absent from this table keeps the village's dials with no floor, which is the safe direction.

| Subject type | Least unity | Least quorum | People on the roll | Every seat weighs | Method | Executes at close |
| --- | --- | --- | --- | --- | --- | --- |
| `village_launch` | 100% | 100% | 3 | yes | `custom` | yes |
| `mint_rule` | 0% | 50% | 0 | no | the village's own | yes |
| `governance_mode` | 97% | 97% | 0 | no | `custom` | yes |

- `village_launch`: Starting the Game asks every member on the roll to vote yes. An abstention is not a yes, and a vote nobody cast is not a yes either.
- `mint_rule`: This one changes what the village mints, so it asks for more than half the village's voting weight to take part. How much of that has to agree is the village's own setting.
- `governance_mode`: This one changes how every vote in the village is counted, so it asks the constitutional bar: almost everybody present, and almost everybody in favour.

Every other subject type keeps the village's own dials: `80% unity` and `20% quorum` on a fresh village, with no floor of its own.

A member drafts through the wizard, which knows 8 types: `role_application`, `mechanics`, `agreement`, `badge_grant`, `quest_payout`, `power_transfer`, `power_grant`, `power_return`. 4 of them can be taken to a binding vote today (`mechanics`, `power_transfer`, `power_grant`, `power_return`); the other 4 open as practice votes (`role_application`, `agreement`, `badge_grant`, `quest_payout`).

<!-- written by a person: practiceVotes -->
The wizard offers types the executors have not reached. Those open as practice votes: the village holds a real decision, reads the real answer, and nothing moves. It is a ladder and never a scorecard.

The wizard's type list is held in two files, once on the server and once in the browser, and they agree today.

A change set carries at most 12 entries, all game dials or all minting rules and never both, because a ballot carries one threshold priced by its subject and a set that is two subjects has no honest price.

## What closing a decision does

<!-- written by a person: closingIntro -->
What closing a decision DOES, per subject type, and the one place that question is answered. A subject type that is not in this table conducts a real decision on the real engine, with the real frozen roll and the real weights, and executes nothing. Absence is the fail-safe direction, so a subject a later lane adds cannot execute something by accident.

| Subject type | What a passed vote changes | How it reaches its executor |
| --- | --- | --- |
| `mechanics` | Moves the village's own dials, through the one amendment ledger that records every move. | its own entry in the close dispatcher |
| `power_transfer` | Moves a power from the admin panel to a role the village names. | its own entry in the close dispatcher |
| `power_grant` | Gives a role a power it does not carry yet. | its own entry in the close dispatcher |
| `power_return` | Hands a power the village was holding back to the admin panel. | its own entry in the close dispatcher |
| `role_declare` | Writes a role into being: its name and what it is for. | its own entry in the close dispatcher |
| `role_seat` | Puts a named member into a seat. | its own entry in the close dispatcher |
| `role_unseat` | Takes a named member out of a seat. | its own entry in the close dispatcher |
| `village_launch` | Starts the Game. Token issuance turns on and does not turn off. | its own entry in the close dispatcher |
| `governance_mode` | Changes how one vote is weighed, and which token carries the weight when it is a token. | its own entry in the close dispatcher |
| `mint_rule` | Changes what the village mints and on what terms. It shares the dial executor and carries a higher quorum floor. | the same executor as `mechanics`, one executor and two subject types |

10 subject types execute something. Whether a member's vote BINDS is derived from this same table, so the word on the decision page and the behaviour at the close cannot come apart.

## Two kinds of decision, and when each one happens

<!-- written by a person: twoKindsOfDecision -->
Every decision a village makes is one of two things, and the difference decides WHEN it happens. A **token send** moves balances: a payout, a distribution, a founding allocation. A **Game change** moves the rules everybody plays by: a setting, a threshold, a role, a seat, a module, the brand, the vote mode, the structure. Anything the table below does not name is a Game change, and that is the safe direction. A token send filed as a Game change waits three days. A Game change filed as a token send skips the window that exists to hold it, and only one of those is reversible.

| Subject type | Kind |
| --- | --- |
| `token_send` | `token_send` |
| `quest_payout` | `token_send` |
| `founding_allocation` | `token_send` |

Every other subject type is a `game_change`, including every one in the closing table above that this table does not name.

| Change-set element | Kind |
| --- | --- |
| `dial` | `game_change` |
| `mint_rule` | `game_change` |
| `weight_allocation` | `game_change` |
| `mode_switch` | `game_change` |
| `module_lifecycle` | `game_change` |
| `brand_field` | `game_change` |
| `role` | `game_change` |
| `token_send` | `token_send` |

<!-- written by a person: weightAllocationIsAGameChange -->
The allocation of voting weight is a **Game change**, and it is named here because both descriptions can claim it. It writes the custom allocation table, which is a number and never a token: no ledger row, no balance, nothing minted. What it changes is what every future vote weighs, which is as constitutional as a decision gets, so it waits inside a window like any other change to the rules.

<!-- written by a person: timingChoice -->
Every proposal carries a timing choice, and the proposer makes it: execute at acceptance, or start with the new moon. A token send defaults to acceptance, because a payout for finished work has no reason to wait a moon. A Game change defaults to the new moon, in the founder's words, to carry a pattern of new activities starting then.

| Kind | Timing it defaults to | What that means |
| --- | --- | --- |
| `token_send` | `at_acceptance` | it happens when the ballot closes |
| `game_change` | `next_moon` | it happens at the next boundary of the active clock, and never before its window shuts |

A proposal carries one timing out of 2 (`at_acceptance`, `next_moon`), and the platform default is `next_moon`. A Game change chosen at acceptance still cannot land before its window closes, so it lands at the close of the window. Anything chosen for the new moon lands at the later of the next boundary and the close of the window.

<!-- written by a person: landingInstant -->
The landing instant is arithmetic over the ballot's own FROZEN closing instant, never over the moment a person pressed close. That matters: if the pass instant were a human press, the proposer would be choosing which three days the seat gets.

<!-- written by a person: bundleWaits -->
A bundle waits as a whole, under one landing instant and one window. A change set carrying any Game-change element is wholly a Game change, token sends included. Splitting it across two clocks would let the token half execute at the close and be beyond reach while a steward stopped the half that was meant to keep it honest.

<!-- written by a person: snapForward -->
A change set touching a setting the platform applies at a cycle close, a minting rule, or a per-stage multiplier snaps its landing forward to the next boundary on every path, acceptance timing included. A ceiling that moves under somebody already spending against it is a different village from the one they were playing in an hour ago.

<!-- written by a person: lateSettled -->
A row that reaches passed with its landing instant already gone is restamped to now plus the window, marked late-settled with the reason, and every steward is told. Without that, a scheduler outage or a late close would hand a steward a window that was over before they heard it had opened, and the record would report it as honoured.

## The veto window

<!-- written by a person: vetoWindowRule -->
**The window is at least 72 hours, and it stays open until the change lands.** The founder gave both halves of that sentence, and this is how they meet: the closing instant of the window IS the landing instant, and 72 hours is its floor. A vote that carries with a month left in the cycle gives its stewards the month. A vote that carries on the last day gives them three days, which run past the boundary. The window is capped at one cycle of the active clock, so a village cannot set a window longer than the rhythm it lands on.

The floor is 72 hours, held in code. The village's own number is `governance.veto_hours`, an `open`-ring setting defaulting to `72` hours. `governance.steward_subjects` says which kinds of decision the seat may stop and ships `all`. `governance.steward_council` ships `false`: while it is off, any one seated steward stops a change; while it is on, a majority of the seated stewards has to.

<!-- written by a person: vetoAct -->
A veto is a first-class act. It carries the name of the steward who cast it, a reason that cannot be blank, and a place in the record. The reason is plain text, length-capped, escaped everywhere it renders, public and permanent, and redactable: the words blank and the act, the author and the time stay. The proposal goes back to its proposer with its backers intact, and a proposal returned to open and passed again lands.

<!-- written by a person: vetoOnTheBallot -->
The veto lives on the BALLOT, and a proposal's display of it derives from that proposal's current ballot. Stamping it on the proposal row instead is how a village that answers its steward's objection and passes the same proposal again gets skipped by the landing gate forever.

<!-- written by a person: stewardNo -->
**A seated steward's no.** On a token-send ballot only, a seated steward voting no fails it at the close. Never on a ballot the steward is the subject of. It needs a reason under the veto's own rule, and the row closes as vetoed with the steward named, so the override and the dashboard's blocked-payouts row both reach it. The steward's own weight counts in the tally like anybody's. A token send has no window after it closes, so the block has to happen while the ballot is open.

<!-- written by a person: notVetoable -->
**What no steward may stop.** Three things. EVERY seating and unseating, of any role and not only one that carries the veto (Rye, 2026-09-04). Any edit to the settings that say what a steward may stop. And any decision whose SIZE the village has not put in the seat's reach, which by default is everything below constitutional. All three keep their timing and their window like any Game change and lose only the door, so the village still reads them coming. A seat that could veto its own removal is a seat nobody can remove. A change set mixing one of those elements with any other kind is refused when it is validated, naming both elements, so the carve-out cannot carry anything else through beside it.

Read from the code: `village_launch` execute the moment they carry, with no window at all. That list used to hold the two seat acts as well, and the gap between the ruling and the code was recorded here: 2026-09-03 asked that a seating keep its timing and its window and simply admit no veto, while the code took the window away too, which arrived at the same place by a shorter road. Rye closed the gap on 2026-09-04 in favour of the ruling, so a seating now waits its window, the village reads it coming, and no steward may stop it. The Birthing is on that list for a reason of its own: before it carries nobody holds a seat, so a window on it would be hours nobody could use, and it already asks every seat to vote and every seat to say yes.

<!-- written by a person: override -->
**The override.** A proposal that was stopped may be brought back. Passed again at the village's highest set tier, with the relation stated (`renews`, `overrides` or `replaces`) and the ballot actually PRICED at that tier, it lands whatever any steward says. The record links it to the decision that was stopped and the reason stays visible beside it. A renewal may not point at a decision that was stopped.

The tier the override has to reach is `governance.highest_tier`, an `open`-ring setting defaulting to `constitutional`. Changing it is priced at itself.

<!-- written by a person: notices -->
Stewards are told three times: when a decision carries, at the half-way point of the window, and two hours before it lands. Each notice is its own kind of notification, pinned to immediate in the mail cadence, because every governance message used to resolve to a daily digest and the last warning before a change landed arrived after it had landed. The off preference is refused while a member holds a seat that carries the veto, and a notice whose moment has passed is suppressed instead of being sent late.

## When a proposal may be opened

<!-- written by a person: windowsIntro -->
A village may say WHEN a kind of proposal can be opened. Per proposal kind it chooses always open, the last N days of every cycle of the active clock, the last N days of every season, or a window of its own. All of them ship always open, so a fresh village gates nothing.

| Setting | The kind it gates | Ships as |
| --- | --- | --- |
| `governance.window_changeset` | When a change to the Game Mechanics can go to the vote | `always_open` |
| `governance.window_mint_rule` | When a change to what the village mints can go to the vote | `always_open` |
| `governance.window_governance_mode` | When a change to how votes are counted can go to the vote | `always_open` |
| `governance.window_role_declare` | When declaring a role can go to the vote | `always_open` |
| `governance.window_role_seat` | When seating a role can go to the vote | `always_open` |
| `governance.window_role_unseat` | When taking a seat back can go to the vote | `always_open` |
| `governance.window_power_transfer` | When moving a power to a role can go to the vote | `always_open` |
| `governance.window_power_grant` | When granting a power can go to the vote | `always_open` |
| `governance.window_power_return` | When handing a power back can go to the vote | `always_open` |

`governance.window_grace_days` ships `7` days: how long anything coming back may open outside its window.

<!-- written by a person: windowsRule -->
The window gates the OPENING and nothing else. It is evaluated per element and the strictest one applies; a window shape no longer than the voting window is refused, and so is an opening whose vote would close after the window shuts. Anything coming back opens outside its window for a stated grace, because the village has already been asked once and a resubmission, an override and a renewal are all openings. The refusal names the element that narrowed the window and when it next opens.

## Delegation

<!-- written by a person: delegationRule -->
You hand your voice to somebody you choose. A delegated vote is a row for the DELEGATOR carrying the delegate's choice, stamped with whoever finally decided it, so the participation arithmetic stays honest and the frozen electorate keeps meaning what it says. Weight never moves. Chains are transitive and a cycle is refused the moment a delegation is given, never while a season's votes are being counted.

<!-- written by a person: delegationConsent -->
A delegation carries a choice only once the delegate has accepted it. Pointing it somewhere else clears the acceptance, so nobody inherits a live delegation they never agreed to. While choices are hidden the copied choice is hidden from the delegator too. Withdrawing a delegation or taking a vote back restores the not-cast state, which is a different thing from an abstention and decides quorum. On a subject asking 100 percent unity a delegated row never counts.

7 routes serve it, and they are in the table of what a village publishes below. What a member sees of it is a surface, and the surface is not built yet.

## What happens when a decision lands

<!-- written by a person: landingLoop -->
One routine decides what is due. It runs as its own five-minute job and the human cycle close calls the same routine, so whichever arrives first applies the row and the other finds nothing left. Exactly one executor runs a due row, elected by a guarded claim on the table that holds the landing instant. Every element is validated again at landing: a seat for a member who has left the village is refused by name.

<!-- written by a person: landingCounts -->
Every report the landing job returns says which of two quiet states it is in. Nothing due and did not run look identical from outside and mean opposite things, so they are logged apart. A row whose window elapsed while the brake was off is marked stalled, its window reopened, and the stewards told.

<!-- written by a person: atomicity -->
**Atomicity comes from pre-validation, and this document says so because a member reading the word applied deserves the same sentence a contributor reads.** A change set is validated in full with nothing written, and one failure refuses the whole set naming the element by its place and its own words. Only then does it apply, irreversible writes last, one ledger row per element written, and every written-through cache reloaded from the database afterwards. There is no rollback, because a rollback through these writers would leave the process serving values the tables deny until somebody restarted it.

<!-- written by a person: noCloser -->
A binding ballot cannot be opened on a subject type that has no closer. Advisory is the exception, and it is an exception on purpose: a practice vote is a real decision that moves nothing. The refusal names the subject and points at the practice-vote door.

<!-- written by a person: digest -->
At every cycle boundary the landing job composes one digest for the cycle that ended, after asserting that every row due inside it is applied, stopped or stalled. One digest per cycle, whatever runs it, and it posts one item to the feed. No digest composed and digest empty are two different sentences in the log.

## Starting the Game: the Birthing

<!-- written by a person: launchIntro -->
A village is built before it is started. Its catalysts set the modules, the dials, the quests and the seasons, and then hand the one act that is not theirs to everybody: starting the Game. The founder ruled that this moment is called the Birthing, that the proposal reveals the Game, and that after it the catalysts become players like everyone else.

Until it carries, issuance is refused in these words: "This village has not started its Game yet, so no token can be issued. Issuance opens when the village's launch vote carries."

<!-- written by a person: launchStored -->
Starting is one row, written once. There is deliberately no function that un-starts a Game: members hold balances the moment issuance runs once, and a switch that could turn that off is a power over everybody's holdings that nobody voted to create.

The fact is one document in the village's own config, under the key `game-start`.

<!-- written by a person: launchEnds -->
What ends at the Birthing is every power the stored `founder` role carries beyond an administrator's. What deliberately does not end is the admin panel, because a village may choose never to seat a steward and must still work completely.

## Voting weight

<!-- written by a person: weightIntro -->
Three modes, one dial, and a rule that never moves: a change of mode changes only how votes are COUNTED. Nothing deletes or rewrites a balance, an allocation or its trail, so a village can move between modes in either direction and every holding survives the trip.

| Mode | What a member's vote weighs |
| --- | --- |
| `equal` | One. One person, one vote. |
| `token` | Their balance of the weight token at the moment the ballot opened, floored at zero. |
| `custom` | Their row in the allocation table. An absent row is zero, which fails closed. |

A fresh village runs `equal` mode with the weight token set to `gratitude`. Both dials are `founder` ring.

<!-- written by a person: weightToken -->
In token mode the weight token has to be one this platform itself governs. A token governed elsewhere is refused, and so is a token listed on the exchange: a token money can buy is not a token that weighs a vote.

<!-- written by a person: weightTrail -->
Custom allocations are append-only. Every change carries a required reason and lands in a trail every player can read, which is the whole of the protection the founder named: concentration is allowed and invisibility is not.

<!-- written by a person: twoVoices -->
A village shows ONE Voice. On this platform it is the village's own Voice token. A village graduates to Hypha when it completes a crowdpool and wants a secure vehicle with liquidity, which is a real organisation on Base; from then the token there is the vote, the village Game mirrors it, and every month or season the village goes to Hypha and votes to sync the two. A village using both tools shows both Voices, and the sync keeps them in balance.

<!-- written by a person: voiceIsBuyable -->
Voice can be bought. Money in mints Voice by default, through a minting rule like any other contribution, and a village or a single proposal may change that. The guard that used to refuse a purchasable token as the weight token is relaxed on purpose, and the protection is the one the founder has named every time: every ballot and the Birthing document show each holder's share.

## Who may do what

<!-- written by a person: whoIntro -->
Powers are keys, not job titles. A member holds one by climbing to the rung that grants it, by holding a role that carries it, or by a badge. Two of them can never be taken away by a badge, and that is a ruling: a voice in a decision the village makes is not something any other party gets to suspend.

| Power | What it lets a member do | Rung that grants it | A badge can take it away |
| --- | --- | --- | --- |
| `proposal.open` | Open a governance decision | `co-creator` | yes |
| `proposal.decide` | Record a decision's outcome | never by rung; a role or a badge grants it | yes |
| `mechanics.propose` | Propose a change to the game's rules | `member` | **no** |
| `org.declare` | Declare how the village holds power | never by rung; a role or a badge grants it | yes |
| `ballot.vote` | Cast a vote on a ballot | `member` | **no** |
| `member.vouch` | Vouch for an applicant | `contributor` | **no** |
| `org.seat` | Seat and unseat the holders of the village's seats | never by rung; a role or a badge grants it | yes |
| `dial.set` | Turn the village's own dials | never by rung; a role or a badge grants it | yes |

## The word steward means three things

<!-- written by a person: stewardThree -->
The word steward means three different things in this platform, and they are named apart here so nobody reads one of them as another.

<!-- written by a person: stewardQuest -->
**The steward who consents to work.** In quest copy, the person who confirms that a contribution actually happened and releases its value. This one is shipped and works today.

<!-- written by a person: stewardPersona -->
**The Village Steward persona.** One of the paths a new member can pick on the way in, part of the identity plane and carrying no power of its own.

<!-- written by a person: stewardApprover -->
**The steward the founder ruled for.** A seat, held by a village's catalysts at the Birthing and re-voted each term, whose holder can stop a decision the village has already carried, inside the window before it lands, and has to say why. It approves nothing: a carried decision lands whether or not anybody holds this seat.

## What a village publishes

<!-- written by a person: publishIntro -->
What a village publishes, read from the route registrations. The door on each route is classified from the code, and a route whose door this reader cannot classify says so instead of guessing.

| Method | Path | Who gets an answer | Power it asks for |
| --- | --- | --- | --- |
| GET | `/api/game/mechanics` | anyone, including a stranger | none |
| GET | `/api/game/mechanics/history` | anyone, including a stranger | none |
| GET | `/api/game/mechanics/proposals` | anyone, including a stranger | none |
| POST | `/api/game/mechanics/proposals` | signed in | none |
| GET | `/api/game/mechanics/proposals/:id/document` | anyone, including a stranger | none |
| GET | `/api/game/mechanics/proposals/:id/handoff` | anyone, including a stranger | none |
| POST | `/api/game/mechanics/proposals/:id/link-hypha` | administrator | none |
| POST | `/api/game/mechanics/proposals/:id/passed` | administrator | none |
| POST | `/api/game/mechanics/proposals/:id/sponsor` | signed in | none |
| POST | `/api/game/mechanics/proposals/:id/support` | signed in | none |
| POST | `/api/game/mechanics/proposals/:id/to-hypha` | administrator | none |
| POST | `/api/game/mechanics/proposals/:id/withdraw` | administrator | none |
| POST | `/api/game/mechanics/proposals/dry-run` | signed in | none |
| GET | `/api/game/mechanics/standing` | signed in | none |
| POST | `/api/governance/advisory` | signed in | none |
| GET | `/api/governance/ballots` | anyone, including a stranger | none |
| GET | `/api/governance/ballots/:id` | anyone, including a stranger | none |
| POST | `/api/governance/ballots/:id/close` | capability | `proposal.decide` |
| GET | `/api/governance/ballots/:id/landing` | anyone, including a stranger | none |
| POST | `/api/governance/ballots/:id/no-objection` | capability | `steward.veto` |
| POST | `/api/governance/ballots/:id/objections` | signed in | none |
| POST | `/api/governance/ballots/:id/objections/:objectionId/rule` | signed in | none |
| POST | `/api/governance/ballots/:id/veto` | capability | `steward.veto` |
| POST | `/api/governance/ballots/:id/vote` | signed in | none |
| POST | `/api/governance/ballots/:id/withdraw` | capability | `proposal.decide` |
| GET | `/api/governance/concentration` | signed in | none |
| DELETE | `/api/governance/delegation` | signed in | none |
| GET | `/api/governance/delegation` | signed in | none |
| PUT | `/api/governance/delegation` | signed in | none |
| POST | `/api/governance/delegation/accept` | signed in | none |
| POST | `/api/governance/delegation/decline` | signed in | none |
| POST | `/api/governance/delegation/uncast` | signed in | none |
| GET | `/api/governance/drafts` | signed in | none |
| POST | `/api/governance/drafts` | signed in | none |
| DELETE | `/api/governance/drafts/:id` | signed in | none |
| POST | `/api/governance/mechanics/:id/open-ballot` | signed in | none |
| POST | `/api/governance/mode-switches` | signed in | none |
| GET | `/api/governance/objections/answerable` | signed in | none |
| GET | `/api/governance/objections/lineage` | anyone, including a stranger | none |
| POST | `/api/governance/power-grants` | signed in | none |
| POST | `/api/governance/power-returns` | signed in | none |
| POST | `/api/governance/power-transfers` | signed in | none |
| POST | `/api/governance/role-declarations` | signed in | none |
| POST | `/api/governance/role-seats` | signed in | none |
| POST | `/api/governance/role-unseats` | signed in | none |
| GET | `/api/governance/standing` | signed in | none |
| GET | `/api/governance/stewardship` | signed in | none |
| POST | `/api/governance/vetoes/:id/redact` | administrator | none |
| GET | `/api/governance/weights` | signed in | none |
| GET | `/api/governance/wizard` | signed in | none |

50 routes: 36 under the governance prefix and 14 under the mechanics prefix. 9 of them answer a stranger, 4 ask for a named power, and 0 could not be classified from the code by this reader.

The routes that answer a stranger are the village's public record. At the module's `public` lifecycle they serve the ballot list, one decision in full and the objection lineage to anybody on the internet, which includes each voter's first name, their choice and their frozen weight. Ruling 22 changes that and is staged.

## The cycle

<!-- written by a person: cycleIntro -->
One clock. A cycle is a lunation, and the same rhythm carries the recognition economy, the pool and this document's talk of what lands when. The past is frozen: cycles below the boundary keep the instants the mean formula always gave them, so no settled cycle ever moves.

| Fact | Value |
| --- | --- |
| A cycle is | one lunation |
| Mean synodic month | 29.53058867 days |
| True instants from the checked-in table, from cycle | 330 |
| Cycle id | `lunar-NNNNNN`, zero padded to 6 digits, for example `lunar-000330` |

<!-- written by a person: cycleClose -->
A cycle turns on its own and the Game notices when an administrator closes it. So today, at the new moon means at the next close, which can lag by days and can settle several lunations at once. One exception runs on a timer: a minting rule stamped for a coming cycle is promoted by the hourly job at the true boundary. The founder's ruling is that the new moon itself becomes the rule and both callers reach one routine; that is staged.

## The bridge to the hub

<!-- written by a person: bridgeIntro -->
A village can carry its formal decisions to Hypha on Base instead of deciding them here, and it can report its outcomes to a governance hub. Both are optional and both ship dark.

<!-- written by a person: bridgeHonest -->
Stated honestly, because a bridge that half works is worse than one that is off: nothing leaves a village unless both the hub URL and a shared secret are configured; the round trip has never been proven end to end in both directions; and four displays about it are false today. A Hypha-decided ballot is counted by Hypha, so a village's own weight mode does not reach it.

The hub address is `governance.hub_url`, a `founder`-ring dial that ships blank, so a fresh village has no hub and sends nowhere. Nothing is sent until a shared secret is configured beside it.

## What is broken today

<!-- written by a person: brokenIntro -->
What is broken today, by name. A document that only described the parts that work would be the same kind of check this repository has spent weeks removing: green about the wrong thing.

- **Nothing seats a catalyst as a steward.** The seat, the power, the record, the settings, the window and the landing loop that reads them are all built. The closer that runs when the Birthing carries writes the launch facts and nothing else: no role, no seat, no grant. So a fresh village has a veto window that nobody can use until a steward is seated, which today is an act somebody performs by hand.
- **A close and its executor are not one transaction.** The ballot is closed by one guarded update and the executor runs after it. An executor that throws leaves a ballot closed and passed with nothing applied, and only the mechanics subject has a second door to apply by hand.
- **4 reads under the governance prefix answer a stranger**, and at the module's `public` lifecycle that means the whole voter roll with names, choices and weights is served to the internet.
- **A weight in token mode is displayed in ledger units.** A holding a member reads as 0.1 weighs 100 in the tally, and the hand-mint form takes raw units with no hint, so typing 1 for a 3-decimal token mints a thousandth.
- **Two tokens are called Voice**, the platform's own and the mirror of what lives on Base, and only the first can weigh a vote. The default weight token is neither of them.
- **A stored reason on a no vote is shown to nobody.** The widget invites a member to say why and the reader that serves votes drops it.
- **The module lifecycle is edited by hand**, so a village turns its own governance on through the admin panel and never through a vote.
- **Four displays about the hub bridge are false.** The sync flag is never set true so the card always says pending, the space check idles on every delivery, an outcome's source is hardcoded, and the card credits a hub with issuing a secret it does not issue.
- **Two schema comments have drifted.** The engine's own migration lists five subject types in the column comment where the dispatcher now executes 10, and a later migration's header names the number of the one before it. Neither is edited, because a shipped migration file is never edited; both are stated here instead.

## What is staged

<!-- written by a person: stagedIntro -->
What is staged: ruled by the founder, described here, and absent from the code. Nothing in this list exists. Each one carries a guard in the generator, so the day somebody builds it the guard goes red and this section has to be updated before the build passes.

- **Catalysts inherit the steward seat at the Birthing, and the seat is re-voted every season** (ruling 2)
- **Giving up the steward power is reversible, and only the village can fill the seat again** (ruling 3)
- **One to three catalysts start a village, and Voice is the only token they may issue before the Game starts** (ruling 10)
- **The Game Mechanics section is public, always, and after the Birthing every control becomes a proposal** (ruling 12)
- **Clans, and Voice for other beings (the 144 gate was withdrawn a day later)** (ruling 18)
- **Who voted is visible, how they voted is hidden, and names appear after half** (ruling 22)
- **Voice for other beings, from the first day, with a representative** (ruling 25)
- **Voice is buyable, and it decays one percent a cycle** (ruling 32)
- **Stalemate protection, with a guard against the losing side asking again** (ruling 33)

## The founder's rulings

<!-- written by a person: rulingsIntro -->
The founder's own words, verbatim, with the date he said them and whether the code does it yet. Where the code can answer, the status is computed and says so. Where it cannot, the status is a person's reading and says that too. Nothing marked staged exists today, and no reader should plan as though it does.

<!-- written by a person: rulingsQuoteNote -->
The quotes are reproduced exactly, including the spelling and the punctuation, because a ruling paraphrased is a ruling somebody can argue about later. They are the one text in this file the house writing rules do not touch.

### 1. A steward approves a passed proposal before it takes effect, and auto-execute is the maturity path

**Half built.** Status computed from the code. Said 2026-08-31 and 2026-09-02.

<!-- the founder's own words -->
> having it default that the steward (by default the founder(s) are granted a steward role after Game launch) needs to approve a proposal to change the game before it actually goes through is a great addition, but also there's another stage of maturity where the founder gives up this power and then auto-execute takes over. Stewards have the power to approve anything in the Game that needs approval - they're the 'training wheels' for the Game until it matures enough that they can give more and more power to the Game to auto-execute decisions.

<!-- written by a person: ruling-1 -->
The seat exists, and the approval gate this ruling describes is WITHDRAWN by the founder's 2026-09-03 words. A `steward.veto` capability gates a veto route, an early no-objection route and a redaction route; one row per steward per ballot records who acted, on what, and why; and one setting says which kinds of decision the seat may stop. Nothing waits: a Game change lands at the later of the next new moon and the close of its window, on its own, whether or not anybody holds the seat, and a token send executes when its ballot closes unless a steward voted no while it was open. What is still missing is the landing instant itself, which the close dispatcher owns. The other hold that exists is `governance.auto_apply_enabled`, a founder-ring dial defaulting to `true`, which covers the mechanics closer alone and hands a held proposal to an administrator to apply by hand.

### 2. Catalysts inherit the steward seat at the Birthing, and the seat is re-voted every season

**Staged.** Not built. Status computed from the code. Said 2026-08-31.

<!-- the founder's own words -->
> I want to override the optionally vote in that role to where the founders automatically inherit it, but just like every role resets every season - this role too needs to be voted back in to be maintained.

<!-- written by a person: ruling-2 -->
The closer that runs when the Birthing carries writes the launch facts and nothing else: no role, no seat, no grant. Catalysts inherit nothing at the Birthing today.

### 3. Giving up the steward power is reversible, and only the village can fill the seat again

**Staged.** Not built. Status stated by a person; the code cannot answer this one. Said 2026-08-31.

<!-- the founder's own words -->
> Yes giving up the power is reversible but the village would need to vote in another steward.

<!-- written by a person: ruling-3 -->
There is no seat to step back from. The design this ruling settles is worth keeping in view while it is built: it makes relinquishment automatic, so a catalyst never has to decide they are ready to give up power. They have to be re-granted it.

### 4. The veto is the point of the role, and it carries a reason

**Built.** Status computed from the code. Said 2026-08-31.

<!-- the founder's own words -->
> Yes stewards have the ability to veto through non approval. This is primarily to protect against harm they see that the village wasn't able to (which is why they voted them to be stewards to begin with).

<!-- the founder's own words -->
> Yes a steward veto absolutely should carry a reason

<!-- written by a person: ruling-4 -->
A veto is a first-class act now. The veto route stores who acted, which ballot, and the reason, and it refuses an empty or whitespace-only reason at the door, so a decision the village carried can never die silently. The reason is plain text capped at 2000 characters, rendered escaped, and redactable: the words can be blanked later while the act, its author and its time stay on the record. An early no-objection may be recorded and it changes no timing. What the record still waits on is the surface that shows it to the proposer.

### 5. Terms end when they end

**Half built.** Status stated by a person; the code cannot answer this one. Said 2026-08-31.

<!-- the founder's own words -->
> No terms should definitely end when they end not with a polite warning! If they're not voted back in then they expire when they expire!

<!-- written by a person: ruling-5 -->
Terms and powers live on two planes that share only a word, and the ruling now holds on the plane that matters. A permission role carries a term and a season beside the holder, and the capability lookup drops a holding whose term has passed, so the powers end on the day the term does with no warning and no grace. A term left empty never lapses, which is what let the column land on villages that had never heard of a term. The record of who held the seat outlives the mandate on purpose: history is kept and the powers are taken. Org-chart seats are the other plane and are unchanged, so a season turn there still reopens a seat without touching anybody's powers. What remains is the vote that puts a holder back in, and a vacancy loud enough to see on every screen that depends on it.

### 6. Governance week is a default pattern and never a permission check

**Built**, and the second half of the ruling is withdrawn. Status computed from the code. Said 2026-08-31.

<!-- the founder's own words -->
> As a default pattern the week before a season ends is the 'governance week' where all the players who want a role in the next season put up proposals for their roles - they play out for the season.

<!-- the founder's own words -->
> Players can make proposal at anytime and it's a cultural pattern when and how people will actually show up to vote. So that's for every village to decide but as a default pattern we offer the above.

<!-- written by a person: ruling-6 -->
The founder reopened this on 2026-09-03: a village MAY block proposals outside defined governance windows. So the sentence above about a permission check is withdrawn, and the rest of the ruling stands. Ten Governance settings hold one window shape each, one per proposal kind and one for a change set, and every one of them ships always open, so a village that wants the pattern without the gate has it. A shape is always_open, the last N days of every cycle under the active clock (the moon by default), the last N days of every season, or a range of days the village names. The window gates the OPENING alone: a ballot already running is never closed by a window shutting, and a proposal coming back after a veto or an objection opens outside its window for governance.window_grace_days. The refusal names which element of the proposal narrowed the window and when that window next opens.

### 7. Delegation copies the choice, chains are transitive, and concentration is visible

**Built.** Status computed from the code. Said 2026-08-31.

<!-- the founder's own words -->
> One more requirement we need to build in is to delegate your vote to another member (where it just copies whatever they do as long as they have your delegation and you can remove and change a vote on an open proposal at anytime. So full rights to the individual but for those who don't want to vote can give their voice to someone they trust.

<!-- the founder's own words -->
> I want transitive to start - that's okay but as you say concentration must be visible so we'll just show what's going on

<!-- the founder's own words -->
> A delegate would puncture because you always see on a proposal a vote you made. So since your vote was cast following another's you were able to see what that other member did because you can see what you did.

<!-- written by a person: ruling-7 -->
A delegated vote is a row for the DELEGATOR carrying the delegate's choice, stamped with the member who finally decided it, so participation arithmetic stays honest and the frozen electorate keeps meaning what it says. Weight never moves. The choice alone is copied and the words beside a no are never attributed to somebody who did not write them. Chains resolve to the member at the end, a cycle is refused at the moment a delegation is given and never at tally time, and a member who votes for themselves takes their row back whatever their delegate does. A delegate who stays silent leaves the delegator uncast, counted as not voted and never as an abstention. Concentration is served to every player: how many votes each member effectively decides, what share of the village that is, and the direct count beside it. What is missing is the surface, so today all of it answers through the API alone.

### 8. Transparency is the protection, so concentration is allowed and invisibility is not

**Half built.** Status computed from the code. Said 2026-08-31.

<!-- the founder's own words -->
> The first exploit isn't a concern because proposals should also say how many people voted on it! We can have a settings where it would be public who's voting or secret (defaulted to secret).

<!-- the founder's own words -->
> Founders can self-grant themselves voice. Their ability to do this is fine, our protection is in the transparency of it, showing what % of total voice every player is holding.

<!-- written by a person: ruling-8 -->
Built: a catalyst may allocate weight to themselves, every allocation lands in an append-only trail with a required reason, and the hand-mint route refuses a self-grant at any amount. Staged: the share of total voice each player holds is shown nowhere, and the vote sentence that states people and weight together is generated in some places and not in others. The identity half of this ruling was answered again in 2026-09-02's question 12 and is carried there.

### 9. One source of truth for governance, human readable and machine readable

**Built.** Status stated by a person; the code cannot answer this one. Said 2026-09-02.

<!-- the founder's own words -->
> Your task is going to be setting up the sole source of truth for governance and our game creating a document that is based off of truth that's human readable and beautiful, and also machine readable that sits in our repo so that everyone including bots can understand how the governance system works.

<!-- the founder's own words -->
> This isn't a full story and for you to fill out the whole story and create version 1.0 of this document for us to go back-and-forth on to ensure that we have the right vision.

<!-- written by a person: ruling-9 -->
This file, generated from the code, with a machine-readable block at the end, a guard that fails the build when it and the code come apart, a self-test on the generator, and a database test that proves the numbers against the real engine. It is version 1.0 and it is written to be argued with.

### 10. One to three catalysts start a village, and Voice is the only token they may issue before the Game starts

**Staged, and the code currently says the opposite.** Status computed from the code. Said 2026-09-02.

<!-- the founder's own words -->
> Every village starts off with 1 to 3 founders putting the initial conditions in place and the only tokens they can issue at this point is Voice tokens.

<!-- the founder's own words -->
> Love them all

<!-- written by a person: ruling-10 -->
Nothing is issuable before the Birthing, Voice included: every faucet posting is refused with the sentence "This village has not started its Game yet, so no token can be issued. Issuance opens when the village's launch vote carries." Nothing enforces a count of one to three catalysts either. The only pre-Birthing weight a catalyst can hand out is the custom allocation table, which is a number and never a token, and which the founder's ruling renames the founding allocation. His second quote here is his answer to the question of which token is Voice: the platform's own Voice is THE Voice, and the Base mirror is Voice claimed across.

### 11. The Birthing: at least three parties, 100 percent quorum, 100 percent unity, and the proposal reveals the Game

**Half built.** Status stated by a person; the code cannot answer this one. Said 2026-09-02.

<!-- the founder's own words -->
> then at some point when the game is mature enough and the founders deem it ready that they're ready to start the game then it starts with an initial proposal that needs a minimum of three votes three different parties voting and it has to get 100% quorum and 100% unity so every player of the game needs to show up to the start the game proposal. This proposal will also show the current distribution of Voice as that's the only token that had been issued at that time and give a brief overview of how the game is structured and the conditions that the game is at.

<!-- the founder's own words -->
> No we need 100% saying yes as a collective 'Birthing' moment where you reveal the game, it's at LEAST 3 but could be many more people who then activate a new game before they all switch to being 'players' instead of just the catalysts (we say Catalyst instead of founder for those who play the game this way.

<!-- written by a person: ruling-11 -->
Built: the floors are code at 100 unity, 100 quorum and 3 on the roll, with every seat required to carry weight above zero, which is what makes 100 percent of weight also mean 100 percent of people. Built since 2026-09-02: an abstention on the Birthing answers nothing, counting toward neither the quorum nor the unity, and the subject asks for a yes from every seat on the roll by head as well as by weight. One yes and two abstentions now closes for want of quorum, which can be asked again the same hour on a fresh roll. Staged: the proposal shows the head count, the dials and an abstention sentence, and carries no Voice distribution, no overview of the structure and no statement of the conditions.

### 12. The Game Mechanics section is public, always, and after the Birthing every control becomes a proposal

**Staged.** Not built. Status stated by a person; the code cannot answer this one. Said 2026-09-02.

<!-- the founder's own words -->
> after this point all members can see the admin section and all of the controls for the entire game so the admin panel that's available just for founders at the beginning becomes available for everyone to see and they can go through and just like a founder can make all these edits but the edits as they're making them just become a change log that will then turn into a proposal and if the proposal passes then changes the game at the start of the next lunar cycle

<!-- the founder's own words -->
> yes, no PII exposed, but all the admin sections I'm able to see now as I'm making the Game. So truly there's no reason to ever hide these behind admin. Instead name them the 'Game Mechanics' section that's always public.

<!-- written by a person: ruling-12 -->
The admin panel stays administrator-only today, before and after the Birthing, and no administrator read consults launch state. Two of its write routes have a proposal path. The ruling asks for the game tabs renamed the Game Mechanics section and public always, with every write still gated, every control rendering as propose this change once the Game has started, and the edits collecting into one change log that becomes one proposal. Personal data and operator matters stay where they are.

### 13. Lunar by default, and the cycle is a setting

**Built.** Status computed from the code. Said 2026-09-02.

<!-- the founder's own words -->
> so that we're following lunar cycle periods for every lunar cycle. A new game structure can take place this lunar cycle is also a setting that it could be changed to any calendar cycle or any other cycle but we default to lunar cycles where a new cycle start and end at the new moon just like with the gratitude cycle

<!-- the founder's own words -->
> Yes the cycle structure can be changed.

<!-- written by a person: ruling-13 -->
`cycle.mode` chooses the rhythm, lunar by default, and every consumer reads one seam (`shared/cycleClock.ts`). The lunar implementation is the arithmetic that was always here, unchanged: the checked-in table of true new moons from cycle 330 on, the mean 29.53058867-day formula before it, and the past frozen. The calendar implementation takes an id prefix of its own (`month-2026-09`) so the retired `YYYY-MM` ids stay refused at settlement instead of being quietly re-read. A closed cycle keeps the id and the bounds it closed under, and the settlement row records which clock it was played on. The change is constitutional and lands only at an instant that ends a cycle under the clock the village is leaving, with every finished cycle settled first. A boot assertion refuses to serve a build where a rhythm setting is shown and nothing reads it, which is the defect the retired dial shipped with.

### 14. The vote mode switches both ways, holdings survive, and the village votes the switch

**Built.** Status computed from the code. Said 2026-09-02.

<!-- the founder's own words -->
> within governance, we have some elements where you can have one person one vote or one token one vote where members can hold multiple voice tokens, and their vote is stronger. This should be able to go back-and-forth where you can change from one person one vote to one token one vote and vice versa and when we're making these changes, it doesn't delete the voice token holdings so if you have voice tokens, and you switch over to one person, one vote and just changes the overall governance that way, and then allows the community to go back to one token one vote and maintain the current token holdings

<!-- the founder's own words -->
> yes

<!-- written by a person: ruling-14 -->
Built: `governance.weight_mode` carries 3 choices, nothing refuses a change in either direction, and switching reads or ignores holdings and deletes none of them. The village's own vote on it landed on 2026-09-03 as the `governance_mode` subject type, with an executor that writes the dial through the one amendment ledger and a landing instant a steward can stop it inside. Once the Game has started the admin route refuses the flip and names the vote, so the switch is the village's act and no longer an administrator's.

### 15. A proposal carries more than one element, priced at its hardest part, and applies all or nothing

**Half built.** Status stated by a person; the code cannot answer this one. Said 2026-09-02.

<!-- the founder's own words -->
> for example, on that proposal, the proposal could also contain a clause where they're distributing a bunch of new Voice tokens out to different members if maybe there is unfair voice token holding that elicited their desire to go back to one person one vote but realize they actually just needed a fair distribution so that's why proposals need to contain more than one element because they might be connected.

<!-- the founder's own words -->
> explain

<!-- written by a person: ruling-15 -->
Built: a change set carries up to 12 entries and passes or fails as one. Staged: the set must be all dials or all minting rules and never both, community-governable keys only, and a Voice distribution is not a change set entry at all. So the founder's own example, switch the mode and distribute Voice, is refused twice today and half of it cannot be balloted. His answers to the two questions inside this one: a bundle takes the HIGHEST floor among its elements, so nobody can smuggle a big change under a small one; and when one element fails at apply time nothing applies, and the proposal names the element that blocked it.

### 16. Vote it down, say what to fix, withdraw, edit, resubmit

**Half built.** Status computed from the code. Said 2026-09-02.

<!-- the founder's own words -->
> During the proposal process proposal comes up and people can vote it down and put their objections and what they would like fixed then a proposer can withdraw and edit their proposal and make those suggested changes and put it back up for vote to try to reach the required quorum and unity required.

<!-- written by a person: ruling-16 -->
Built: withdrawal exists at both layers, a no vote may carry a free-text reason on every method, and a consent objection carries text and a ruling and links to the ballot it led to. Staged: objections with text exist under the consent method only, and the default method is not consent, so under the shipped defaults a member cannot record what they would like fixed. A stored reason on a no vote is shown to nobody. There is no edit route on a proposal and no pointer from a resubmission back to what it replaces.

### 17. A village with no steward and self-executing agreements is healthy

**Built.** Status computed from the code. Said 2026-09-02.

<!-- the founder's own words -->
> Sure and it's perfectly fine to have no stewards and for the game to have self/executing agreements - Stewards are like the 'training wheels' to the game to help them start - not a desirable endstate. Except one where we're all stewards in our own way.

<!-- written by a person: ruling-17 -->
An empty steward seat is never a warning, and nothing queues behind it. A village with nobody on the seat is a village nobody can veto: its carried decisions land at their landing instant exactly as they would with the seat filled. The vacancy read says that in one sentence and never as a fault report.

### 18. Clans, and Voice for other beings (the 144 gate was withdrawn a day later)

**Staged.** Not built. Status computed from the code. Said 2026-09-02.

<!-- the founder's own words -->
> part of step 2 is to encourage to name non-human governance roles in your Game (other beings who live on the land) to be part of governance. - For example giving voice to nature (a mountain your project is on a river it borders, the trees and fauna and flora that shares that piece of earth with us) - this creates another idea where a governance function of 'clans' (which groups can name whatever they like and change this name in admin) but groups within the village that anchor on living beings. The water group would tend to the waters the earth group to the land the air group to the air, etc the wolf group would tend to restoring this apex predator - which requires restoring the whole pyramid underneath the beaver clan, etc. etc all clans are namable in admin as well. But these other actors can be given voice - though this is considered a mature feature to build into the Game once you hit 144+ people.

<!-- written by a person: ruling-18 -->
Clans are a governance object nothing in the code knows about yet: groups within a village, each anchored on a living being or an element, each tending what it is named for, every name editable in the Game Mechanics section. The founding step should invite the catalysts to name governance roles for beings other than people: a mountain, a river, the trees, the fauna and flora that share the land. The 144-player gate in this answer was WITHDRAWN on 2026-09-03, one day later: such a seat may be declared from a village's first day, and 144 is guidance on the screen. Ruling 25 carries his words for that.

### 19. A passed change lands at the new moon itself

**Half built, and half withdrawn on 2026-09-03.** Status stated by a person; the code cannot answer this one. Said 2026-09-02.

<!-- the founder's own words -->
> I don't understand this fully.

<!-- written by a person: ruling-19 -->
Built: 11 dials wait for the next cycle close instead of applying at the close of the vote, a minting rule stamped for a coming cycle is promoted on its own by the hourly job at the true boundary, one routine applies everything due, and both its own job and the human close call it, so whichever runs first applies and the other finds nothing left. Withdrawn by his 2026-09-03 words: the part of this answer that stamped a proposal with a CYCLE NUMBER and showed a member "lands at cycle 331". A landing is a timestamp taken from the active clock, and the page reads the instant with the countdown beside it.

### 20. A late approval rolls to the following new moon

**Withdrawn on 2026-09-03.** Status stated by a person; the code cannot answer this one. Said 2026-09-02.

<!-- the founder's own words -->
> explain?

<!-- written by a person: ruling-20 -->
The case this answered: a proposal passes on the 20th of the moon, the steward is away, and the approval lands after the new moon has come and gone. The situation cannot arise now, because no decision waits for a steward to act. A Game change lands at the later of the next boundary and the close of its window, and a steward who is away simply does not stop it. The answer is kept here for the reasoning it carries and because a reader who learned it needs to see it struck.

### 21. Nothing is un-votable, criticality raises the bar, and 97 is the recommended ceiling

**Built.** Status computed from the code. Said 2026-09-02.

<!-- the founder's own words -->
> Everything can be! But the more critical it is, the higher percentage of quorum you need (hard to get quorum) such that changing the most critical things would require a max high of 97% quorum where only 3% of the whole network would be able to not be informed and have 97% approval (max heights - we don't recommend more than those though they can exceed them (if they do we warn them) because the closer you get to 100% the chances of you getting a stalemate increase where the Game breaks even though a massive majority want to continue they can't because someone died suddenly or stopped playing the Game, etc.

<!-- written by a person: ruling-21 -->
Every setting carries a criticality tier now, defaulting to routine, and the tier sets both the quorum and the unity a change to it needs: routine asks nothing beyond the village's own dials, structural asks 80 unity and 50 quorum, and constitutional asks 97 and 97, which is the founder's own number. The tiers are themselves eight settings, and the 3 subject floors that used to live only in code are settings too. All ten are raise-only: the shipped number is a floor and a village may go above it and never below, because a village that can lower the bar for changing the bar has no bar. Any dial typed above 97 shows the stalemate warning in words while it is being typed, and the Birthing is the one subject exempt from it because it stays at 100 and 100 by rule. Still open: the founder's 2026-09-02 ruling that a threshold changes at its own current bar, which is a later lane.

### 22. Who voted is visible, how they voted is hidden, and names appear after half

**Staged, and the code currently says the opposite.** Status computed from the code. Said 2026-09-02.

<!-- the founder's own words -->
> How about the name who participates is visible but by default we hide how they voted (and we only expose faces once 50% of the required vote count happens (so you can't really tell who voted what) but we don't say what they voted by default - but in settings this can be changed to public voting.

<!-- written by a person: ruling-22 -->
Votes are named on purpose today: the decision page says this village does not run secret ballots, and the roll serves each voter's name, choice and frozen weight. No secrecy setting exists. The ruling supersedes the earlier one that closed this question in the other direction. Counts and shares of weight stay visible under every setting, so the people-and-weight sentence is unaffected.

### 23. How this document gets built and proven

**Half built.** Status stated by a person; the code cannot answer this one. Said 2026-09-02.

<!-- the founder's own words -->
> your role now is to respond to my ideas for improvement with a final execution plan. Then you're going to oversee Agents who are running on Opus or lower for what you need and only you are the Fable model as the swarm coordinator to oversee building this whole plan. You'll only complete once you've done a QA test as a fake account going through all governance actions and interacting with the site. You'll continue with QA passes building in a better Game and experience as they 'Play the Game'.

<!-- written by a person: ruling-23 -->
The document, its guard, its self-test and its database test are here. The walk this ruling asks for, a fresh account driven through every governance action on a running site, is what the rest of the work is measured by, and it has not been done yet.

### 24. Two Voices, one shown at a time, and the graduation to Hypha

**Half built.** Status computed from the code. Said 2026-09-02.

<!-- the founder's own words -->
> Yes village-voice is the Voice

<!-- the founder's own words -->
> Village Voice is the voice unless they're running on Hypha then it changes, but only show one at the beginning, either they're using the platform or Hypha to vote. What we have is a sort of 'graduation' to Hypha when you complete a crowdpool and you want to accept all those contributions and have a secure vehicle with easy liquidity (an actual DAO on Base using Coinbase's liquidity) then you're using those actual tokens and mirroring your village game with Hypha updates (like every month or season) you would actually go to Hypha and vote to sync up the Games there. Then you would show both types of Voice if they're using both Tools but they should be in balance with every sync.

<!-- written by a person: ruling-24 -->
The two tokens exist and the platform's own Voice is the one a fresh village weighs a vote with. The hub address ships blank, so a fresh village sends nowhere, and nothing leaves without a shared secret beside it. What is not built is the graduation itself: the moment a completed crowdpool moves the vote to Base, the mirroring, and the monthly or seasonal sync that keeps the two in balance. Until that exists a village shows one Voice, which is the shape this ruling asks for at the beginning anyway.

### 25. Voice for other beings, from the first day, with a representative

**Staged.** Not built. Status computed from the code. Said 2026-09-02 and 2026-09-03.

<!-- the founder's own words -->
> You expose catalysts at the beginning (even with 3 people) the concept of giving voice to nature and inviting them to consider it by either a human or AI agent taking the perspective - or even talking directly if they have the human ability to the nature beings)

<!-- the founder's own words -->
> 2. yes voice for other beings at day 1

<!-- written by a person: ruling-25 -->
This replaces the 144-player unlock of the earlier answer, which becomes guidance on the screen. A village may declare a governance role for a being other than a person from its first day, with a representative who holds that point of view: a member, an agent built for it, or somebody who speaks with that being directly. Nothing in the code declares one yet.

### 26. Every setting shows its cost, and a threshold moves at its own bar

**Half built.** Status computed from the code. Said 2026-09-02.

<!-- the founder's own words -->
> Yes every setting says what it costs and these are all editable from the start by catalysts to set the initial amounts. but they also can be changed by reaching the same amount they are set at can change their threshold again.

<!-- the founder's own words -->
> Q9 yes the highest floor among them which discourages people to adjust those settings knowing the storytelling required for higher changes.

<!-- written by a person: ruling-26 -->
Built: every setting carries a tier, the tier prices a change to it, a bundle takes the highest floor among its elements, and the tiers are settings a catalyst edits before the Birthing. Still staged: the rule that moving a threshold costs that threshold's own CURRENT bar in both directions, so a dial at 97 and 97 needs 97 and 97 to move either way.

### 27. The steward holds a veto window, and nothing waits for a steward

**Built.** Status computed from the code. Said 2026-09-03.

<!-- the founder's own words -->
> Yes whenever a decision is approved it passes and executes (if it's sending tokens) if it's changing the Game then it starts at the next new moon or automatically if a steward doesn't block it, a steward is given 3 days minimum (so if the vote only gets enough quorum and total votes by the very last day of the lunar cycle then a steward will get 3 days to veto, if it's past longer than 3 days out of the end of the cycle then a steward has until the cycle ends to veto otherwise it goes into effect.

<!-- written by a person: ruling-27 -->
This is the ruling the whole model turns on, and it withdraws the approval gate of the two rounds before it. A token send executes at the close of its ballot. A Game change never executes at the close: it is stamped with a landing instant and lands there by itself unless a seated steward stops it inside the window. There is no approval, no hold, and no queue when the seat is empty. The window is at least 72 hours and stays open until the change lands, and `governance.veto_hours` carries the village's own number with that floor. `governance.steward_subjects` says which kinds of decision the seat may stop.

### 28. A steward's no fails a token payment, and a veto can be overridden

**Built.** Status computed from the code. Said 2026-09-03.

<!-- the founder's own words -->
> However if a steward votes down on a token payment proposal than it fails automatically.

<!-- the founder's own words -->
> Yes stewards can also block payouts, and yes to the veto override

<!-- written by a person: ruling-28 -->
A seated steward voting no on a token-send ballot fails it at the close, with the steward named and the reason on the record, and the row closes as vetoed so the override and the dashboard both reach it. Two narrowings are the build's own reading and are recorded as such: it applies to token sends and never to every ballot, and a steward cannot fail a ballot they are the subject of. Because a token send has no window after it closes, the block happens while the ballot is open.

### 29. The override tier, the governance windows, the notices and the countdown

**Built.** Status computed from the code. Said 2026-09-03.

<!-- the founder's own words -->
> We can have a veto override if it goes up to the highest tier they have set as a village (this is also a setting that can change at the highest tier set)

<!-- the founder's own words -->
> Yes stewards are sent emails and given notifications in the app. But we can also block all proposals from not happening within defined governance windows. Some can be 'always open' but some can have set windows (like the last week of every month or last 2 weeks of every season or whatever) but those two are the default choices we offer to guide.

<!-- the founder's own words -->
> Steward accountability on dashboard is excellent!

<!-- the founder's own words -->
> 72 hours from close and a countdown on it.

<!-- written by a person: ruling-29 -->
The override lands at `governance.highest_tier`, which is itself priced at the highest tier. The windows are 9 settings, one per proposal kind, and each holds one shape: always open, the last N days of every cycle of the active clock, the last N days of every season, or a shape the village writes. All of them ship always open. This supersedes the 2026-08-31 line that proposals are never gated by the calendar: a village may gate them now, and always open stays a choice. The countdown reads one instant through one helper, so no surface can show a deadline the engine does not enforce.

### 30. Lunar months, quorum by weight, the bundle waits, and timing per proposal

**Built.** Status computed from the code. Said 2026-09-03.

<!-- the founder's own words -->
> governance 'Months' are lunar months starting and ending with the moon as the default

<!-- the founder's own words -->
> Quorum SHOULD be pure token weight (not counting people, unless it's 1-person-1-vote but we STILL SHOW PEOPLE counts, even though the quorum is calculated by village-voice token weight)

<!-- the founder's own words -->
> 1. who bundle waits! (along with this proposals can each carry - execute at accept or start with the new moon and to default to starting with the new moon to carry a pattern of new activities starting then).

<!-- the founder's own words -->
> 2. no any single steward has the ability to veto though we could add a 'Steward Council' option that makes it a majority of them

<!-- the founder's own words -->
> 3. No if there is 3 cycles without quorum it just doesn't pass.

<!-- the founder's own words -->
> make sure you add the context and links to those context documents (on governance I gave you at the first) to the governance docs that humans and bots will read to get an understanding of this game.

<!-- written by a person: ruling-30 -->
A governance month is a lunar month. Quorum and unity read weight and nothing else, which the arithmetic itself confirms: `quorumPctOf` adds yesW, noW, abstainW and divides by the frozen total weight, and it reads no head count at all. The head-count quorum an earlier plan carried is withdrawn, and so is the automatic drop to a lower tier after three cycles without quorum. People counts are shown beside the weight everywhere. A bundle waits as a whole under one landing instant. Any single steward may stop a change, and `governance.steward_council` makes it a majority of the seated stewards. The three sources this document descends from are named in Where this comes from, with a copy of each under `docs/sources/`.

### 31. A non-human seat votes, and whether its weight counts toward quorum is a setting

**Half built.** Status computed from the code. Said 2026-09-03.

<!-- the founder's own words -->
> 1. default 2. default 3. default 4. default 5. a non-human seat should be voting! Either it is held by an actual human or a bot that is meant to vote to represent that PoV. However, it can also be excluded from quorum (make this a setting too whether to include or exclude from quorum with the default excluded) 6. default 7. default 8. default

<!-- written by a person: ruling-31 -->
`governance.nonhuman_in_quorum` decides whether such a seat's weight counts toward quorum and ships `false`, and `governance.absent_cycles` says how many cycles a seat may go unvoted before weight that cannot vote leaves the denominator. The arithmetic is built and the seat is not: nothing declares a being other than a person yet, and a representative who is an agent needs an account a ballot can point at. The eight defaults this answer accepted are the veto window, a steward's no on payments only, payouts at acceptance and Game changes at the moon, no trial of a pricing dial, a window that gates the opening only, members-only names and amounts, and erasure winning over the freeze.

### 32. Voice is buyable, and it decays one percent a cycle

**Staged.** Not built. Status stated by a person; the code cannot answer this one. Said 2026-09-03.

<!-- the founder's own words -->
> Yes, Voice is buyable and decays 1% per cycle by default.

<!-- the founder's own words -->
> Yes an investment of money is a contribution and does (by default) issue voice. though this can be changed of course by each village and each proposal being 100% editable.

<!-- the founder's own words -->
> Yes decay is uniform.

<!-- written by a person: ruling-32 -->
This deliberately relaxes a guard the platform shipped: a token money can buy was refused as the weight token, and the refusal becomes a warning on the control. Money in mints Voice by default through a minting rule like any other contribution, a village or a single proposal may change that, and every ballot and the Birthing document show each holder's share, which is the protection. Decay is uniform across bought and earned Voice, posted to a sink at the cycle close, and never a rewrite of a balance, so the weights a ballot freezes read the balance the ledger holds at that instant with no change to the engine. None of it is in the code today.

### 33. Stalemate protection, with a guard against the losing side asking again

**Staged.** Not built. Status stated by a person; the code cannot answer this one. Said 2026-09-02.

<!-- the founder's own words -->
> I think so on the stalemate protections but we have to do this in a way where they can't be abused by people who don't like the outcome of a vote.

<!-- the founder's own words -->
> Yes absolutely first governance as quests that describes how this is how we empower ourselves, evolve the game, make sure we're always making it better, more fun, more empowering, more capable, as we co-create new realities and civilizations together and take this task seriously.

<!-- written by a person: ruling-33 -->
A ballot may be re-run with a fresh roll only when a frozen seat has provably left the village, recorded in the ledger and never self-declared, and only while the ballot is still open and can no longer reach its quorum. A closed ballot is never re-run, so nobody who dislikes an outcome gets a second vote out of this. The re-run links to the ballot it replaces so the record says why. The same door opens for a bloc of weight that cannot vote, which is arithmetic telling the truth and not the tier fallback that was withdrawn. The second quote is the framing the first governance quests carry.

## What was withdrawn

<!-- written by a person: withdrawnIntro -->
What this document used to say, and no longer does. Each line was true of an earlier ruling and was withdrawn by a later one, with the date. It is kept because a reader who learned the old rule needs to see it struck, and because a fork reading an older copy of this file should be able to tell which sentences went.

- ~~A steward approves a passed proposal before it takes effect.~~
  Withdrawn 2026-09-03 by 19C. The steward holds a window and never a gate. A carried decision lands on its own, and the seat's one power is to stop it before it does.
- ~~A passed proposal QUEUES while the steward seat is empty, and executes when a steward is next voted in.~~
  Withdrawn 2026-09-03 by 19C. Nothing queues. A village with no steward is a village nobody can stop, and that is the healthy end state.
- ~~A member sees "lands at cycle 331" on the proposal from the moment it passes.~~
  Withdrawn 2026-09-03 by 19C and 20.11. A landing is a timestamp taken from the active clock. The page shows the instant with the countdown beside it, and no cycle number appears on the vote path.
- ~~Voice for other beings, and clans, unlock at 144 players.~~
  Withdrawn 2026-09-03 by 19B and 19C. A village may declare a seat for a being other than a person on its first day. The 144 line is guidance on the screen.
- ~~Some settings can never be changed by a vote.~~
  Withdrawn 2026-09-02 by 19 Q11. Nothing is un-votable. Criticality raises the bar instead, and the recommended ceiling is 97 percent of quorum and 97 percent of unity.
- ~~Proposals are never gated by the calendar, and a governance window must not become a permission check.~~
  Withdrawn 2026-09-03 by 19E. A village may block a kind of proposal from being OPENED outside a window it sets. Always open stays a choice and ships as the default.
- ~~A ballot's full detail, with each voter's name, their choice and their frozen weight, is public.~~
  Withdrawn 2026-09-02 by 19 Q12. Who has voted is visible once half the required votes are in; how they voted is hidden unless a village turns public voting on. Counts and shares of weight stay visible under every setting.
- ~~A tier percentage counts weight AND heads, so a quorum needs a minimum number of people as well as a share of the weight.~~
  Withdrawn 2026-09-03 by 19F. Quorum and unity are pure token weight. People counts are shown beside the weight everywhere, and the concentration that allows is stated in this document as the founder's own decision.
- ~~A tier that misses quorum three cycles running drops automatically to the tier below it.~~
  Withdrawn 2026-09-03 by 19F. It simply does not pass. The second miss warns that the next ends it; the third closes the question with one door, which is to withdraw and rewrite.
- ~~A vetoed proposal is overridden by passing again at the NEXT criticality tier above the one it carried at.~~
  Withdrawn 2026-09-03 by 19E. It is overridden by passing again at the village's highest set tier, which is itself a setting priced at that tier.
- ~~A steward's approval executes the proposal at once.~~
  Withdrawn 2026-09-03 by 19C. There is no approval to execute at. His words that night stay in the record as ruling 27's history.
- ~~A late approval rolls the proposal to the following new moon.~~
  Withdrawn 2026-09-03 by 19C. The situation cannot arise, because nothing waits for a steward.

## Where this comes from

<!-- written by a person: lineageIntro -->
The engine's dials descend from three sources the founder gave, and they are named here so a person or a bot reading this document can go to the root of it.

- [So you want to make a DHO?](https://docs.google.com/presentation/d/1hjjo_p5VqaOkaUml9nR3s8ZGUt1AzCidCSw6VngJ3dc/edit?usp=drivesdk)
  <!-- written by a person: lineageDeck -->
  The slide deck "So you want to make a DHO?" (Hypha and SEEDS): the three dials of voice variance, quorum and unity, with the named corners those dials describe.
  A copy a fork can open: `docs/sources/hypha-dho-deck.md`.
- [How to do a DHO/DAO](https://youtu.be/_TpyEO6NRnY)
  <!-- written by a person: lineageTalk -->
  The talk "How to do a DHO/DAO", a guide for groups building new-paradigm organisations, from SEEDS: Regenerative Renaissance.
  A copy a fork can open: `docs/sources/how-to-do-a-dho-talk-summary.md`.
- [Hypha Handbook V0.3](https://docs.google.com/document/d/1hFJPe1N0yyntJ9g-iQFvhtf9j2pDsxmmG-ufxqnAt5g/edit?usp=drivesdk)
  <!-- written by a person: lineageHandbook -->
  The Hypha Handbook V0.3. In the founder's words, out of date and written for a different kind of organisation than a village, and still the root of the self-organising and regenerative principles this Game runs on.
  A copy a fork can open: `docs/sources/hypha-handbook-v0.3-summary.md`.

<!-- written by a person: lineageCopies -->
Three links are three closed doors for a fork whose members cannot open them. So the text of each source is checked in under `docs/sources/`, attributed, with the founder's permission recorded. The copies are for reading and the originals stay the source.

<!-- written by a person: lineageRecord -->
`docs/GOVERNANCE_EVOLUTION_PROMPT.md` is the record of the rulings themselves: every question put to the founder, his answer in his own words, the date, and what each answer changed. When this document and that one disagree about a rule, that one is the evidence and this one is the defect.

## Machine-readable

<!-- written by a person: machineIntro -->
The same facts, for anything that would sooner parse than read. Regenerated with the rest of the file, so it cannot drift from the prose above it.

```json
{
  "commit": "db6cc4f9b5a0c37958531edcef28bac95b56d2cc",
  "module": {
    "id": "governance",
    "shipsAs": "off",
    "lifecycles": [
      "off",
      "preview",
      "members",
      "public"
    ],
    "apiPrefixes": [
      "/api/governance",
      "/api/admin/governance"
    ],
    "capabilities": [
      "ballot.vote",
      "member.vouch"
    ],
    "variableKeys": [
      "governance.weight_mode",
      "governance.weight_token",
      "governance.unity_pct",
      "governance.quorum_pct",
      "governance.vote_days",
      "governance.consent_window_days",
      "governance.default_method",
      "membership.vouch_threshold"
    ]
  },
  "engine": {
    "methods": [
      "majority",
      "custom",
      "consensus",
      "consent"
    ],
    "voteChoices": [
      "yes",
      "no",
      "abstain"
    ],
    "outcomes": [
      "passed",
      "failed",
      "no_quorum"
    ],
    "ballotStatuses": [
      "open",
      "passed",
      "failed",
      "no_quorum",
      "withdrawn"
    ],
    "unityStampedByMethod": {
      "majority": 50,
      "consensus": 100,
      "consent": 0,
      "custom": null
    },
    "abstainCountsTowardQuorumByDefault": true,
    "abstainCountsTowardUnityByDefault": false
  },
  "subjects": [
    {
      "subjectType": "village_launch",
      "minUnityPct": 100,
      "minQuorumPct": 100,
      "minElectorate": 3,
      "everySeatWeighs": true,
      "method": "custom",
      "criticality": null,
      "abstainPolicy": "no_answer",
      "minYesHeads": "all",
      "executesAtClose": true,
      "why": "Starting the Game asks every member on the roll to vote yes. An abstention is not a yes, and a vote nobody cast is not a yes either."
    },
    {
      "subjectType": "mint_rule",
      "minUnityPct": 0,
      "minQuorumPct": 50,
      "minElectorate": 0,
      "everySeatWeighs": false,
      "method": null,
      "criticality": null,
      "abstainPolicy": null,
      "minYesHeads": null,
      "executesAtClose": true,
      "why": "This one changes what the village mints, so it asks for more than half the village's voting weight to take part. How much of that has to agree is the village's own setting."
    },
    {
      "subjectType": "governance_mode",
      "minUnityPct": 97,
      "minQuorumPct": 97,
      "minElectorate": 0,
      "everySeatWeighs": false,
      "method": "custom",
      "criticality": "constitutional",
      "abstainPolicy": null,
      "minYesHeads": null,
      "executesAtClose": true,
      "why": "This one changes how every vote in the village is counted, so it asks the constitutional bar: almost everybody present, and almost everybody in favour."
    }
  ],
  "executingSubjectTypes": [
    "mechanics",
    "power_transfer",
    "power_grant",
    "power_return",
    "role_declare",
    "role_seat",
    "role_unseat",
    "village_launch",
    "governance_mode",
    "mint_rule"
  ],
  "dials": [
    {
      "key": "governance.voice_weighting",
      "label": "How sensing is weighted",
      "ring": "open",
      "type": "choice",
      "default": "equal",
      "min": null,
      "max": null,
      "choices": [
        "equal",
        "hypha-mirror"
      ],
      "applyTiming": "instant"
    },
    {
      "key": "governance.hypha_threshold",
      "label": "The proposer bar: earned recognition to propose",
      "ring": "open",
      "type": "integer",
      "default": "0",
      "min": 0,
      "max": 10000000,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.sensing_days",
      "label": "How long a topic stays open for sensing",
      "ring": "open",
      "type": "integer",
      "default": "7",
      "min": 1,
      "max": 90,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.proposals_per_member_per_cycle",
      "label": "Mechanics proposals per member per cycle",
      "ring": "open",
      "type": "integer",
      "default": "5",
      "min": 1,
      "max": 100,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.proposal_support_threshold",
      "label": "Supporters before a proposal can go to the vote",
      "ring": "open",
      "type": "integer",
      "default": "0",
      "min": 0,
      "max": 10000,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.hub_url",
      "label": "Governance hub URL",
      "ring": "founder",
      "type": "text",
      "default": "",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.auto_apply_enabled",
      "label": "Apply verified proposals automatically",
      "ring": "founder",
      "type": "boolean",
      "default": "true",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.steward_subjects",
      "label": "Which decisions a steward can stop",
      "ring": "open",
      "type": "text",
      "default": "all",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.steward_veto_tiers",
      "label": "Which sizes of decision a steward can stop",
      "ring": "open",
      "type": "text",
      "default": "constitutional",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.payout_delay_over",
      "label": "Payouts above this wait three days before they are sent",
      "ring": "open",
      "type": "integer",
      "default": "1000",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.steward_council",
      "label": "A veto needs a majority of the stewards",
      "ring": "open",
      "type": "boolean",
      "default": "false",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.veto_hours",
      "label": "How long a steward has to stop a change",
      "ring": "open",
      "type": "integer",
      "default": "72",
      "min": 72,
      "max": 720,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.landing_expiry_cycles",
      "label": "Cycles a passed decision waits before it is written off",
      "ring": "open",
      "type": "integer",
      "default": "3",
      "min": 1,
      "max": 12,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.change_cooldown_days",
      "label": "Cooldown after a governed rule change",
      "ring": "open",
      "type": "integer",
      "default": "0",
      "min": 0,
      "max": 365,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.window_changeset",
      "label": "When a change to the Game Mechanics can go to the vote",
      "ring": "open",
      "type": "text",
      "default": "always_open",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.window_mint_rule",
      "label": "When a change to what the village mints can go to the vote",
      "ring": "open",
      "type": "text",
      "default": "always_open",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.window_governance_mode",
      "label": "When a change to how votes are counted can go to the vote",
      "ring": "open",
      "type": "text",
      "default": "always_open",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.window_role_declare",
      "label": "When declaring a role can go to the vote",
      "ring": "open",
      "type": "text",
      "default": "always_open",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.window_role_seat",
      "label": "When seating a role can go to the vote",
      "ring": "open",
      "type": "text",
      "default": "always_open",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.window_role_unseat",
      "label": "When taking a seat back can go to the vote",
      "ring": "open",
      "type": "text",
      "default": "always_open",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.window_power_transfer",
      "label": "When moving a power to a role can go to the vote",
      "ring": "open",
      "type": "text",
      "default": "always_open",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.window_power_grant",
      "label": "When granting a power can go to the vote",
      "ring": "open",
      "type": "text",
      "default": "always_open",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.window_power_return",
      "label": "When handing a power back can go to the vote",
      "ring": "open",
      "type": "text",
      "default": "always_open",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.window_grace_days",
      "label": "How long a proposal coming back may open outside its window",
      "ring": "open",
      "type": "integer",
      "default": "7",
      "min": 0,
      "max": 90,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.weight_mode",
      "label": "How voting weight is assigned",
      "ring": "founder",
      "type": "choice",
      "default": "equal",
      "min": null,
      "max": null,
      "choices": [
        "equal",
        "token",
        "custom"
      ],
      "applyTiming": "instant"
    },
    {
      "key": "governance.weight_token",
      "label": "The weight token",
      "ring": "founder",
      "type": "text",
      "default": "gratitude",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.unity_pct",
      "label": "Unity needed to pass",
      "ring": "open",
      "type": "percentage",
      "default": "80",
      "min": 50,
      "max": 100,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.quorum_pct",
      "label": "Quorum needed to count",
      "ring": "open",
      "type": "percentage",
      "default": "20",
      "min": 1,
      "max": 100,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.vote_days",
      "label": "How long a ballot stays open",
      "ring": "open",
      "type": "integer",
      "default": "7",
      "min": 1,
      "max": 30,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.consent_window_days",
      "label": "How long a consent window stays open",
      "ring": "open",
      "type": "integer",
      "default": "7",
      "min": 1,
      "max": 30,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.default_method",
      "label": "How village-wide ballots decide",
      "ring": "open",
      "type": "choice",
      "default": "custom",
      "min": null,
      "max": null,
      "choices": [
        "custom",
        "majority",
        "consensus",
        "consent",
        "hypha"
      ],
      "applyTiming": "instant"
    },
    {
      "key": "governance.tier_routine_quorum_pct",
      "label": "Routine changes: quorum floor",
      "ring": "open",
      "type": "percentage",
      "default": "0",
      "min": 0,
      "max": 100,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.tier_routine_unity_pct",
      "label": "Routine changes: unity floor",
      "ring": "open",
      "type": "percentage",
      "default": "0",
      "min": 0,
      "max": 100,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.tier_structural_quorum_pct",
      "label": "Structural changes: quorum floor",
      "ring": "open",
      "type": "percentage",
      "default": "50",
      "min": 50,
      "max": 100,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.tier_structural_unity_pct",
      "label": "Structural changes: unity floor",
      "ring": "open",
      "type": "percentage",
      "default": "80",
      "min": 80,
      "max": 100,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.tier_constitutional_quorum_pct",
      "label": "Constitutional changes: quorum floor",
      "ring": "open",
      "type": "percentage",
      "default": "97",
      "min": 97,
      "max": 100,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.tier_constitutional_unity_pct",
      "label": "Constitutional changes: unity floor",
      "ring": "open",
      "type": "percentage",
      "default": "97",
      "min": 97,
      "max": 100,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.highest_tier",
      "label": "The tier a veto override is passed at",
      "ring": "open",
      "type": "choice",
      "default": "constitutional",
      "min": null,
      "max": null,
      "choices": [
        "routine",
        "structural",
        "constitutional"
      ],
      "applyTiming": "instant"
    },
    {
      "key": "governance.subject_mint_rule_quorum_pct",
      "label": "Minting rule changes: quorum floor",
      "ring": "open",
      "type": "percentage",
      "default": "50",
      "min": 50,
      "max": 100,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.subject_mint_rule_unity_pct",
      "label": "Minting rule changes: unity floor",
      "ring": "open",
      "type": "percentage",
      "default": "0",
      "min": 0,
      "max": 100,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.nonhuman_in_quorum",
      "label": "Seats speaking for other beings count toward quorum",
      "ring": "open",
      "type": "boolean",
      "default": "false",
      "min": null,
      "max": null,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "governance.absent_cycles",
      "label": "Cycles of silence before a seat leaves the count",
      "ring": "open",
      "type": "integer",
      "default": "3",
      "min": 1,
      "max": 24,
      "choices": null,
      "applyTiming": "instant"
    },
    {
      "key": "membership.vouch_threshold",
      "label": "Vouches to admit a member",
      "ring": "open",
      "type": "integer",
      "default": "0",
      "min": 0,
      "max": 20,
      "choices": null,
      "applyTiming": "instant"
    }
  ],
  "cycleApplyKeys": [
    "cycle.mode",
    "economy.voice_claim_threshold",
    "economy.claims_week_days",
    "economy.claims_week_starts",
    "gratitude.base_budget",
    "gratitude.pool_per_cycle",
    "gratitude.pool_token",
    "gratitude.max_share_per_recipient",
    "feed.heart_amount",
    "feed.max_hearts_per_recipient_per_cycle",
    "ledger.admin_mint_cycle_cap"
  ],
  "weightModes": [
    "equal",
    "token",
    "custom"
  ],
  "changeSetMaxEntries": 12,
  "wizard": {
    "types": [
      "role_application",
      "mechanics",
      "agreement",
      "badge_grant",
      "quest_payout",
      "power_transfer",
      "power_grant",
      "power_return"
    ],
    "conductable": [
      "mechanics",
      "power_transfer",
      "power_grant",
      "power_return"
    ],
    "advisory": [
      "role_application",
      "agreement",
      "badge_grant",
      "quest_payout"
    ],
    "clientAgrees": true
  },
  "capabilities": [
    {
      "key": "proposal.open",
      "label": "Open a governance decision",
      "unlocksAtStage": "co-creator",
      "deniableByBadge": true
    },
    {
      "key": "proposal.decide",
      "label": "Record a decision's outcome",
      "unlocksAtStage": null,
      "deniableByBadge": true
    },
    {
      "key": "mechanics.propose",
      "label": "Propose a change to the game's rules",
      "unlocksAtStage": "member",
      "deniableByBadge": false
    },
    {
      "key": "org.declare",
      "label": "Declare how the village holds power",
      "unlocksAtStage": null,
      "deniableByBadge": true
    },
    {
      "key": "ballot.vote",
      "label": "Cast a vote on a ballot",
      "unlocksAtStage": "member",
      "deniableByBadge": false
    },
    {
      "key": "member.vouch",
      "label": "Vouch for an applicant",
      "unlocksAtStage": "contributor",
      "deniableByBadge": false
    },
    {
      "key": "org.seat",
      "label": "Seat and unseat the holders of the village's seats",
      "unlocksAtStage": null,
      "deniableByBadge": true
    },
    {
      "key": "dial.set",
      "label": "Turn the village's own dials",
      "unlocksAtStage": null,
      "deniableByBadge": true
    }
  ],
  "routes": [
    {
      "method": "GET",
      "path": "/api/game/mechanics",
      "door": "anyone, including a stranger",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "GET",
      "path": "/api/game/mechanics/history",
      "door": "anyone, including a stranger",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "GET",
      "path": "/api/game/mechanics/proposals",
      "door": "anyone, including a stranger",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/game/mechanics/proposals",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "GET",
      "path": "/api/game/mechanics/proposals/:id/document",
      "door": "anyone, including a stranger",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "GET",
      "path": "/api/game/mechanics/proposals/:id/handoff",
      "door": "anyone, including a stranger",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/game/mechanics/proposals/:id/link-hypha",
      "door": "administrator",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/game/mechanics/proposals/:id/passed",
      "door": "administrator",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/game/mechanics/proposals/:id/sponsor",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/game/mechanics/proposals/:id/support",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/game/mechanics/proposals/:id/to-hypha",
      "door": "administrator",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/game/mechanics/proposals/:id/withdraw",
      "door": "administrator",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/game/mechanics/proposals/dry-run",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/governanceLanding.ts"
    },
    {
      "method": "GET",
      "path": "/api/game/mechanics/standing",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/advisory",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/ballots",
      "door": "anyone, including a stranger",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/ballots/:id",
      "door": "anyone, including a stranger",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/ballots/:id/close",
      "door": "capability",
      "capability": "proposal.decide",
      "file": "server/index.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/ballots/:id/landing",
      "door": "anyone, including a stranger",
      "capability": null,
      "file": "server/routes/governanceLanding.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/ballots/:id/no-objection",
      "door": "capability",
      "capability": "steward.veto",
      "file": "server/routes/governanceVetoes.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/ballots/:id/objections",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/ballots/:id/objections/:objectionId/rule",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/ballots/:id/veto",
      "door": "capability",
      "capability": "steward.veto",
      "file": "server/routes/governanceVetoes.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/ballots/:id/vote",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/ballots/:id/withdraw",
      "door": "capability",
      "capability": "proposal.decide",
      "file": "server/index.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/concentration",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/delegation.ts"
    },
    {
      "method": "DELETE",
      "path": "/api/governance/delegation",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/delegation.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/delegation",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/delegation.ts"
    },
    {
      "method": "PUT",
      "path": "/api/governance/delegation",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/delegation.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/delegation/accept",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/delegation.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/delegation/decline",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/delegation.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/delegation/uncast",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/delegation.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/drafts",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/governanceWizard.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/drafts",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/governanceWizard.ts"
    },
    {
      "method": "DELETE",
      "path": "/api/governance/drafts/:id",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/governanceWizard.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/mechanics/:id/open-ballot",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/mode-switches",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/governanceMode.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/objections/answerable",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/objections/lineage",
      "door": "anyone, including a stranger",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/power-grants",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/power-returns",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/power-transfers",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/role-declarations",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/role-seats",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/role-unseats",
      "door": "signed in",
      "capability": null,
      "file": "server/index.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/standing",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/governanceWizard.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/stewardship",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/governanceVetoes.ts"
    },
    {
      "method": "POST",
      "path": "/api/governance/vetoes/:id/redact",
      "door": "administrator",
      "capability": null,
      "file": "server/routes/governanceVetoes.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/weights",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/governanceWeights.ts"
    },
    {
      "method": "GET",
      "path": "/api/governance/wizard",
      "door": "signed in",
      "capability": null,
      "file": "server/routes/governanceWizard.ts"
    }
  ],
  "cycle": {
    "kind": "lunar",
    "synodicMonthDays": 29.53058867,
    "trueClockFromCycle": 330,
    "idFormat": "lunar-NNNNNN"
  },
  "launch": {
    "configKey": "game-start",
    "issuanceRefusedUntilStarted": true
  },
  "kinds": {
    "values": [
      "token_send",
      "game_change"
    ],
    "timings": [
      "at_acceptance",
      "next_moon"
    ],
    "defaultTiming": "next_moon",
    "defaultTimingByKind": {
      "token_send": "at_acceptance",
      "game_change": "next_moon"
    },
    "bySubjectType": {
      "token_send": "token_send",
      "quest_payout": "token_send",
      "founding_allocation": "token_send"
    },
    "byChangeSetItem": {
      "dial": "game_change",
      "mint_rule": "game_change",
      "weight_allocation": "game_change",
      "mode_switch": "game_change",
      "module_lifecycle": "game_change",
      "brand_field": "game_change",
      "role": "game_change",
      "token_send": "token_send"
    },
    "absentMeans": "game_change",
    "executesAtPassWithNoWindow": [
      "village_launch"
    ],
    "vetoHoursFloor": 72
  },
  "quorum": {
    "countsWeightFields": [
      "yesW",
      "noW",
      "abstainW"
    ],
    "countsHeadFields": [],
    "dividesByTotalWeight": true,
    "weightOnly": true
  },
  "windows": [
    {
      "key": "governance.window_changeset",
      "label": "When a change to the Game Mechanics can go to the vote",
      "default": "always_open"
    },
    {
      "key": "governance.window_mint_rule",
      "label": "When a change to what the village mints can go to the vote",
      "default": "always_open"
    },
    {
      "key": "governance.window_governance_mode",
      "label": "When a change to how votes are counted can go to the vote",
      "default": "always_open"
    },
    {
      "key": "governance.window_role_declare",
      "label": "When declaring a role can go to the vote",
      "default": "always_open"
    },
    {
      "key": "governance.window_role_seat",
      "label": "When seating a role can go to the vote",
      "default": "always_open"
    },
    {
      "key": "governance.window_role_unseat",
      "label": "When taking a seat back can go to the vote",
      "default": "always_open"
    },
    {
      "key": "governance.window_power_transfer",
      "label": "When moving a power to a role can go to the vote",
      "default": "always_open"
    },
    {
      "key": "governance.window_power_grant",
      "label": "When granting a power can go to the vote",
      "default": "always_open"
    },
    {
      "key": "governance.window_power_return",
      "label": "When handing a power back can go to the vote",
      "default": "always_open"
    }
  ],
  "schema": [
    {
      "name": "ballots.lands_at",
      "what": "the instant a carried decision lands"
    },
    {
      "name": "ballots.veto_closes_at",
      "what": "the instant the window shuts"
    },
    {
      "name": "ballots.timing",
      "what": "the proposer's choice of when it happens"
    },
    {
      "name": "ballots.vetoed_at",
      "what": "the act of stopping it, on the ballot the veto answers"
    },
    {
      "name": "ballots.vetoed_by",
      "what": "who stopped it"
    },
    {
      "name": "ballots.late_settled_at",
      "what": "a window already over when the row reached passed"
    },
    {
      "name": "the landing statuses",
      "what": "applying and stalled beside applied and vetoed"
    },
    {
      "name": "the vetoed outcome",
      "what": "a vetoed decision is not a failed one"
    },
    {
      "name": "mechanics_proposals.lands_at",
      "what": "the same instant on the proposal a village reads"
    },
    {
      "name": "mechanics_proposals.supersedes_relation",
      "what": "renews, overrides or replaces, stated rather than guessed"
    },
    {
      "name": "governance_element_ledger",
      "what": "one row per element written, keyed on the ballot and the element's place in it"
    },
    {
      "name": "governance_executor_pending",
      "what": "the failure a resumed attempt exists to record"
    },
    {
      "name": "delegations.accepted_at",
      "what": "a delegation carries a choice only once the delegate accepts it"
    },
    {
      "name": "role_holder_terms",
      "what": "a term survives an unrelated appointment"
    }
  ],
  "withdrawn": [
    {
      "what": "A steward approves a passed proposal before it takes effect.",
      "withdrawnOn": "2026-09-03",
      "withdrawnBy": "19C",
      "now": "The steward holds a window and never a gate. A carried decision lands on its own, and the seat's one power is to stop it before it does."
    },
    {
      "what": "A passed proposal QUEUES while the steward seat is empty, and executes when a steward is next voted in.",
      "withdrawnOn": "2026-09-03",
      "withdrawnBy": "19C",
      "now": "Nothing queues. A village with no steward is a village nobody can stop, and that is the healthy end state."
    },
    {
      "what": "A member sees \"lands at cycle 331\" on the proposal from the moment it passes.",
      "withdrawnOn": "2026-09-03",
      "withdrawnBy": "19C and 20.11",
      "now": "A landing is a timestamp taken from the active clock. The page shows the instant with the countdown beside it, and no cycle number appears on the vote path."
    },
    {
      "what": "Voice for other beings, and clans, unlock at 144 players.",
      "withdrawnOn": "2026-09-03",
      "withdrawnBy": "19B and 19C",
      "now": "A village may declare a seat for a being other than a person on its first day. The 144 line is guidance on the screen."
    },
    {
      "what": "Some settings can never be changed by a vote.",
      "withdrawnOn": "2026-09-02",
      "withdrawnBy": "19 Q11",
      "now": "Nothing is un-votable. Criticality raises the bar instead, and the recommended ceiling is 97 percent of quorum and 97 percent of unity."
    },
    {
      "what": "Proposals are never gated by the calendar, and a governance window must not become a permission check.",
      "withdrawnOn": "2026-09-03",
      "withdrawnBy": "19E",
      "now": "A village may block a kind of proposal from being OPENED outside a window it sets. Always open stays a choice and ships as the default."
    },
    {
      "what": "A ballot's full detail, with each voter's name, their choice and their frozen weight, is public.",
      "withdrawnOn": "2026-09-02",
      "withdrawnBy": "19 Q12",
      "now": "Who has voted is visible once half the required votes are in; how they voted is hidden unless a village turns public voting on. Counts and shares of weight stay visible under every setting."
    },
    {
      "what": "A tier percentage counts weight AND heads, so a quorum needs a minimum number of people as well as a share of the weight.",
      "withdrawnOn": "2026-09-03",
      "withdrawnBy": "19F",
      "now": "Quorum and unity are pure token weight. People counts are shown beside the weight everywhere, and the concentration that allows is stated in this document as the founder's own decision."
    },
    {
      "what": "A tier that misses quorum three cycles running drops automatically to the tier below it.",
      "withdrawnOn": "2026-09-03",
      "withdrawnBy": "19F",
      "now": "It simply does not pass. The second miss warns that the next ends it; the third closes the question with one door, which is to withdraw and rewrite."
    },
    {
      "what": "A vetoed proposal is overridden by passing again at the NEXT criticality tier above the one it carried at.",
      "withdrawnOn": "2026-09-03",
      "withdrawnBy": "19E",
      "now": "It is overridden by passing again at the village's highest set tier, which is itself a setting priced at that tier."
    },
    {
      "what": "A steward's approval executes the proposal at once.",
      "withdrawnOn": "2026-09-03",
      "withdrawnBy": "19C",
      "now": "There is no approval to execute at. His words that night stay in the record as ruling 27's history."
    },
    {
      "what": "A late approval rolls the proposal to the following new moon.",
      "withdrawnOn": "2026-09-03",
      "withdrawnBy": "19C",
      "now": "The situation cannot arise, because nothing waits for a steward."
    }
  ],
  "sources": [
    {
      "title": "So you want to make a DHO?",
      "url": "https://docs.google.com/presentation/d/1hjjo_p5VqaOkaUml9nR3s8ZGUt1AzCidCSw6VngJ3dc/edit?usp=drivesdk",
      "localCopy": "docs/sources/hypha-dho-deck.md"
    },
    {
      "title": "How to do a DHO/DAO",
      "url": "https://youtu.be/_TpyEO6NRnY",
      "localCopy": "docs/sources/how-to-do-a-dho-talk-summary.md"
    },
    {
      "title": "Hypha Handbook V0.3",
      "url": "https://docs.google.com/document/d/1hFJPe1N0yyntJ9g-iQFvhtf9j2pDsxmmG-ufxqnAt5g/edit?usp=drivesdk",
      "localCopy": "docs/sources/hypha-handbook-v0.3-summary.md"
    }
  ],
  "rulings": [
    {
      "id": 1,
      "title": "A steward approves a passed proposal before it takes effect, and auto-execute is the maturity path",
      "dates": [
        "2026-08-31",
        "2026-09-02"
      ],
      "status": "Half built.",
      "statusBasis": "computed"
    },
    {
      "id": 2,
      "title": "Catalysts inherit the steward seat at the Birthing, and the seat is re-voted every season",
      "dates": [
        "2026-08-31"
      ],
      "status": "Staged. Not built.",
      "statusBasis": "computed"
    },
    {
      "id": 3,
      "title": "Giving up the steward power is reversible, and only the village can fill the seat again",
      "dates": [
        "2026-08-31"
      ],
      "status": "Staged. Not built.",
      "statusBasis": "stated"
    },
    {
      "id": 4,
      "title": "The veto is the point of the role, and it carries a reason",
      "dates": [
        "2026-08-31"
      ],
      "status": "Built.",
      "statusBasis": "computed"
    },
    {
      "id": 5,
      "title": "Terms end when they end",
      "dates": [
        "2026-08-31"
      ],
      "status": "Half built.",
      "statusBasis": "stated"
    },
    {
      "id": 6,
      "title": "Governance week is a default pattern and never a permission check",
      "dates": [
        "2026-08-31"
      ],
      "status": "Built, and the second half of the ruling is withdrawn.",
      "statusBasis": "computed"
    },
    {
      "id": 7,
      "title": "Delegation copies the choice, chains are transitive, and concentration is visible",
      "dates": [
        "2026-08-31"
      ],
      "status": "Built.",
      "statusBasis": "computed"
    },
    {
      "id": 8,
      "title": "Transparency is the protection, so concentration is allowed and invisibility is not",
      "dates": [
        "2026-08-31"
      ],
      "status": "Half built.",
      "statusBasis": "computed"
    },
    {
      "id": 9,
      "title": "One source of truth for governance, human readable and machine readable",
      "dates": [
        "2026-09-02"
      ],
      "status": "Built.",
      "statusBasis": "stated"
    },
    {
      "id": 10,
      "title": "One to three catalysts start a village, and Voice is the only token they may issue before the Game starts",
      "dates": [
        "2026-09-02"
      ],
      "status": "Staged, and the code currently says the opposite.",
      "statusBasis": "computed"
    },
    {
      "id": 11,
      "title": "The Birthing: at least three parties, 100 percent quorum, 100 percent unity, and the proposal reveals the Game",
      "dates": [
        "2026-09-02"
      ],
      "status": "Half built.",
      "statusBasis": "stated"
    },
    {
      "id": 12,
      "title": "The Game Mechanics section is public, always, and after the Birthing every control becomes a proposal",
      "dates": [
        "2026-09-02"
      ],
      "status": "Staged. Not built.",
      "statusBasis": "stated"
    },
    {
      "id": 13,
      "title": "Lunar by default, and the cycle is a setting",
      "dates": [
        "2026-09-02"
      ],
      "status": "Built.",
      "statusBasis": "computed"
    },
    {
      "id": 14,
      "title": "The vote mode switches both ways, holdings survive, and the village votes the switch",
      "dates": [
        "2026-09-02"
      ],
      "status": "Built.",
      "statusBasis": "computed"
    },
    {
      "id": 15,
      "title": "A proposal carries more than one element, priced at its hardest part, and applies all or nothing",
      "dates": [
        "2026-09-02"
      ],
      "status": "Half built.",
      "statusBasis": "stated"
    },
    {
      "id": 16,
      "title": "Vote it down, say what to fix, withdraw, edit, resubmit",
      "dates": [
        "2026-09-02"
      ],
      "status": "Half built.",
      "statusBasis": "computed"
    },
    {
      "id": 17,
      "title": "A village with no steward and self-executing agreements is healthy",
      "dates": [
        "2026-09-02"
      ],
      "status": "Built.",
      "statusBasis": "computed"
    },
    {
      "id": 18,
      "title": "Clans, and Voice for other beings (the 144 gate was withdrawn a day later)",
      "dates": [
        "2026-09-02"
      ],
      "status": "Staged. Not built.",
      "statusBasis": "computed"
    },
    {
      "id": 19,
      "title": "A passed change lands at the new moon itself",
      "dates": [
        "2026-09-02"
      ],
      "status": "Half built, and half withdrawn on 2026-09-03.",
      "statusBasis": "stated"
    },
    {
      "id": 20,
      "title": "A late approval rolls to the following new moon",
      "dates": [
        "2026-09-02"
      ],
      "status": "Withdrawn on 2026-09-03.",
      "statusBasis": "stated"
    },
    {
      "id": 21,
      "title": "Nothing is un-votable, criticality raises the bar, and 97 is the recommended ceiling",
      "dates": [
        "2026-09-02"
      ],
      "status": "Built.",
      "statusBasis": "computed"
    },
    {
      "id": 22,
      "title": "Who voted is visible, how they voted is hidden, and names appear after half",
      "dates": [
        "2026-09-02"
      ],
      "status": "Staged, and the code currently says the opposite.",
      "statusBasis": "computed"
    },
    {
      "id": 23,
      "title": "How this document gets built and proven",
      "dates": [
        "2026-09-02"
      ],
      "status": "Half built.",
      "statusBasis": "stated"
    },
    {
      "id": 24,
      "title": "Two Voices, one shown at a time, and the graduation to Hypha",
      "dates": [
        "2026-09-02"
      ],
      "status": "Half built.",
      "statusBasis": "computed"
    },
    {
      "id": 25,
      "title": "Voice for other beings, from the first day, with a representative",
      "dates": [
        "2026-09-02",
        "2026-09-03"
      ],
      "status": "Staged. Not built.",
      "statusBasis": "computed"
    },
    {
      "id": 26,
      "title": "Every setting shows its cost, and a threshold moves at its own bar",
      "dates": [
        "2026-09-02"
      ],
      "status": "Half built.",
      "statusBasis": "computed"
    },
    {
      "id": 27,
      "title": "The steward holds a veto window, and nothing waits for a steward",
      "dates": [
        "2026-09-03"
      ],
      "status": "Built.",
      "statusBasis": "computed"
    },
    {
      "id": 28,
      "title": "A steward's no fails a token payment, and a veto can be overridden",
      "dates": [
        "2026-09-03"
      ],
      "status": "Built.",
      "statusBasis": "computed"
    },
    {
      "id": 29,
      "title": "The override tier, the governance windows, the notices and the countdown",
      "dates": [
        "2026-09-03"
      ],
      "status": "Built.",
      "statusBasis": "computed"
    },
    {
      "id": 30,
      "title": "Lunar months, quorum by weight, the bundle waits, and timing per proposal",
      "dates": [
        "2026-09-03"
      ],
      "status": "Built.",
      "statusBasis": "computed"
    },
    {
      "id": 31,
      "title": "A non-human seat votes, and whether its weight counts toward quorum is a setting",
      "dates": [
        "2026-09-03"
      ],
      "status": "Half built.",
      "statusBasis": "computed"
    },
    {
      "id": 32,
      "title": "Voice is buyable, and it decays one percent a cycle",
      "dates": [
        "2026-09-03"
      ],
      "status": "Staged. Not built.",
      "statusBasis": "stated"
    },
    {
      "id": 33,
      "title": "Stalemate protection, with a guard against the losing side asking again",
      "dates": [
        "2026-09-02"
      ],
      "status": "Staged. Not built.",
      "statusBasis": "stated"
    }
  ]
}
```

## The tables this rests on

<!-- written by a person: schemaIntro -->
The tables and columns the rules above rest on. The generator checks every one against the migrations and refuses to render this document when one is missing, so a paragraph here cannot outlive the column it describes. No migration number appears: numbers are claimed across worktrees and renumbered when a build lands.

| Table or column | What it holds |
| --- | --- |
| `ballots.lands_at` | the instant a carried decision lands |
| `ballots.veto_closes_at` | the instant the window shuts |
| `ballots.timing` | the proposer's choice of when it happens |
| `ballots.vetoed_at` | the act of stopping it, on the ballot the veto answers |
| `ballots.vetoed_by` | who stopped it |
| `ballots.late_settled_at` | a window already over when the row reached passed |
| the landing statuses | applying and stalled beside applied and vetoed |
| the vetoed outcome | a vetoed decision is not a failed one |
| `mechanics_proposals.lands_at` | the same instant on the proposal a village reads |
| `mechanics_proposals.supersedes_relation` | renews, overrides or replaces, stated rather than guessed |
| `governance_element_ledger` | one row per element written, keyed on the ballot and the element's place in it |
| `governance_executor_pending` | the failure a resumed attempt exists to record |
| `delegations.accepted_at` | a delegation carries a choice only once the delegate accepts it |
| `role_holder_terms` | a term survives an unrelated appointment |

Checked against the 129 migration files in `drizzle/`.

## What this file is made from

<!-- written by a person: madeFromIntro -->
The generator reads these and fails loudly if any of them moves:

- `shared/governanceEngine.ts`
- `shared/ballotSubjects.ts`
- `shared/governanceKinds.ts`
- `shared/cycleClock.ts`
- `shared/gameVariables.ts`
- `shared/capabilities.ts`
- `shared/modules.ts`
- `shared/lunar.ts`
- `server/index.ts`
- `server/lib/ballots.ts`
- `server/lib/applyDue.ts`
- `server/lib/changeset.ts`
- `server/lib/stewardship.ts`
- `server/lib/delegation.ts`
- `server/lib/governanceWeights.ts`
- `server/lib/gameStart.ts`
- `server/lib/mechanics.ts`
- `server/lib/proposalDrafts.ts`
- `server/lib/gratitude-cycles.ts`
- `server/lib/governanceWindows.ts`
- `server/routes/governanceWizard.ts`
- `server/routes`
- `drizzle`
- `client/src/components/governance/wizardConfig.ts`

<!-- written by a person: madeFromReaders -->
Every reader is anchored on an exported symbol or a syntactic shape, never on a line number. The file holding the close dispatcher lost about 2,500 lines to route extractions in the hours while this document was being specified, and a reader anchored on a line would have gone quietly wrong.

<!-- written by a person: madeFromCommit -->
The commit named at the top is the last commit that changed any source in this list. A commit that changes a source and regenerates this file at the same time writes the previous commit's id, because the new one does not exist yet; regenerating once more after it lands settles it.

<!-- written by a person: madeFromTest -->
`server/db/governanceDoc.test.ts` calls the real engine against a real database and asserts that the numbers this document states are the numbers those functions produce. The generator being wrong is a red test and not a quiet paragraph.
