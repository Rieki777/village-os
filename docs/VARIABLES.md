# Game variables

Every dial a village can turn: what it does, what it is set to before anybody touches it, how far it may move, and who is allowed to move it.

This is the BEHAVIOUR plane, which is how much, how often and which mode. A village's identity (its names, its images, its stage ladder) lives in `shared/gameConfig.ts` and is a different question. The rules no village may change at all are constitutional, live in code, and are published in `shared/constitution.ts`.

The database stores CHANGED values only. A dial nobody has touched reads the platform default, so the defaults printed here are the game a fresh village is playing on day one.

## How to read this file

This file is generated. `scripts/generate-variables-doc.mjs` reads `shared/gameVariables.ts`, works out the facts, and writes the whole document. `scripts/check-variables-doc.mjs` regenerates it and fails the build when the committed text and the code have come apart.

Editing this file by hand does not hold. Change the code, then run:

```bash
node scripts/generate-variables-doc.mjs
```

Every word below this section comes out of the registry. The labels and the descriptions are the ones a founder reads in Admin, so a sentence that reads badly here reads badly there too, and both are fixed in the same place.

There is no timestamp and no author line, on purpose. Both would change on every run and turn an honest diff into noise. The git history is the record of when this changed.

## Who may change what

Every dial carries a RING, which is the platform's ceiling on who may move it. There are 2 of them, and today 146 open and 33 founder:

- **open**, the whole village. Community-governable. These are the dials the village decides together, through the proposal loop. A founder can close one of these to their community; the platform ceiling says it may be open.
- **founder**, the founder or an admin. Founder-held. Legal posture, infrastructure, privacy windows and abuse guards. They stay visible to everybody and they are never proposable. Nothing can open one of these to the village.

The BOUNDS are constitutional in every case. Governance moves a value between the min and the max printed below; nothing here moves the min or the max. That is what keeps a vote from turning a dial into a different mechanism.

Each dial also says WHEN a change lands. 156 of them as soon as it is saved, and 23 of them at the next cycle close.

- **instant**, as soon as it is saved. The new value is live immediately.
- **cycle-close**, at the next cycle close. Changing one of these mid-cycle would move the basis a settlement is already being measured against, so the new value waits for the cycle to close. That gap is deliberate: it gives the village the window between a decision passing and the decision biting.

## At a glance

179 dials in 30 categories. 104 carry a minimum and a maximum. By type: 82 integer, 13 decimal, 10 percentage, 21 boolean, 22 choice, 31 text.

| Category | Dials | the whole village | the founder or an admin |
| --- | --- | --- | --- |
| Membership | 2 | 2 | 0 |
| Gratitude | 9 | 9 | 0 |
| Ledger | 2 | 2 | 0 |
| The Mint | 4 | 3 | 1 |
| Progression | 27 | 27 | 0 |
| Quests | 5 | 5 | 0 |
| Governance | 43 | 39 | 4 |
| Tokens | 4 | 1 | 3 |
| Hypha | 8 | 0 | 8 |
| Tools | 2 | 2 | 0 |
| Accounts & sessions | 2 | 0 | 2 |
| Abuse guards | 5 | 0 | 5 |
| Data lifecycle | 3 | 0 | 3 |
| Automation | 1 | 0 | 1 |
| Village map | 12 | 9 | 3 |
| The village's people | 1 | 0 | 1 |
| Events | 3 | 3 | 0 |
| Forum | 1 | 1 | 0 |
| Messages | 2 | 2 | 0 |
| Feed | 3 | 3 | 0 |
| Stays | 10 | 10 | 0 |
| Exchange | 5 | 5 | 0 |
| Library | 9 | 9 | 0 |
| Payments | 4 | 4 | 0 |
| Village | 2 | 1 | 1 |
| Health | 1 | 1 | 0 |
| Badges | 1 | 1 | 0 |
| Platform | 1 | 0 | 1 |
| Calendar | 3 | 3 | 0 |
| Introductions | 4 | 4 | 0 |

## Every dial by name

The whole registry in one table, for finding a dial. Each one is written out in full below.

| Dial | Key | Category | Type | Default | Who may change it |
| --- | --- | --- | --- | --- | --- |
| Vouches that admit a member | `membership.vouches_required` | Membership | integer | `3` | the whole village |
| The seat that greets a new arrival | `arrival.greeter_role` | Membership | text | blank | the whole village |
| Base sending allowance per cycle | `gratitude.base_budget` | Gratitude | integer | `105` | the whole village |
| Value pool distributed at each cycle close | `gratitude.pool_per_cycle` | Gratitude | integer | `1000` | the whole village |
| Which token the pool pays | `gratitude.pool_token` | Gratitude | text | `credits` | the whole village |
| Full sends per cycle | `gratitude.full_sends_per_cycle` | Gratitude | integer | `7` | the whole village |
| Require a message with every acknowledgment | `gratitude.require_message` | Gratitude | boolean | `true` | the whole village |
| The rhythm the village keeps time by | `cycle.mode` | Gratitude | choice | `lunar` | the whole village |
| Gratitude each heart sends | `feed.heart_amount` | Gratitude | integer | `1` | the whole village |
| Hearts one member can tap for another per cycle | `feed.max_hearts_per_recipient_per_cycle` | Gratitude | integer | `5` | the whole village |
| Recognition for an accepted Work With Us proposal | `gratitude.proposal_accept_award` | Gratitude | integer | `100` | the whole village |
| Admin mint cap per cycle | `ledger.admin_mint_cycle_cap` | Ledger | integer | `10000` | the whole village |
| Second steward needed above | `ledger.admin_mint_cosign_over` | Ledger | integer | `100` | the whole village |
| Voice needed before a member can claim | `economy.voice_claim_threshold` | The Mint | integer | `100` | the whole village |
| How many days Claims Week stays open | `economy.claims_week_days` | The Mint | integer | `7` | the whole village |
| When each Claims Week begins | `economy.claims_week_starts` | The Mint | text | `03-21,06-21,09-23,12-21` | the whole village |
| Your Hypha space | `economy.hypha_space` | The Mint | text | blank | the founder or an admin |
| How often every seat reopens | `org.reassignment_cadence` | Progression | choice | `season_turn` | the whole village |
| Sending-budget multiplier: Visitor | `progression.multiplier.visitor` | Progression | decimal | `0` | the whole village |
| Sending-budget multiplier: Guest | `progression.multiplier.guest` | Progression | decimal | `1` | the whole village |
| Sending-budget multiplier: Immersant | `progression.multiplier.immersant` | Progression | decimal | `1` | the whole village |
| Sending-budget multiplier: Participant | `progression.multiplier.participant` | Progression | decimal | `1` | the whole village |
| Sending-budget multiplier: Member | `progression.multiplier.member` | Progression | decimal | `2` | the whole village |
| Sending-budget multiplier: Contributor | `progression.multiplier.contributor` | Progression | decimal | `2` | the whole village |
| Sending-budget multiplier: Quest Seeker | `progression.multiplier.quest-seeker` | Progression | decimal | `2` | the whole village |
| Sending-budget multiplier: Initiate | `progression.multiplier.initiate` | Progression | decimal | `2` | the whole village |
| Sending-budget multiplier: Co-Creator | `progression.multiplier.co-creator` | Progression | decimal | `3` | the whole village |
| Sending-budget multiplier: Role Holder | `progression.multiplier.role-holder` | Progression | decimal | `3` | the whole village |
| Sending-budget multiplier: Guide | `progression.multiplier.guide` | Progression | decimal | `4` | the whole village |
| Sending-budget multiplier: Sage | `progression.multiplier.sage` | Progression | decimal | `5` | the whole village |
| Consented quests to reach Quest Seeker | `progression.quests_for.quest-seeker` | Progression | integer | `3` | the whole village |
| Stage that unlocks: forum.post | `progression.unlock.forum.post` | Progression | choice | `member` | the whole village |
| Stage that unlocks: proposal.open | `progression.unlock.proposal.open` | Progression | choice | `co-creator` | the whole village |
| Stage that unlocks: map.viewPeople | `progression.unlock.map.viewPeople` | Progression | choice | `guest` | the whole village |
| Stage that unlocks: map.contact | `progression.unlock.map.contact` | Progression | choice | `member` | the whole village |
| Stage that unlocks: stay.member_rate | `progression.unlock.stay.member_rate` | Progression | choice | `member` | the whole village |
| Stage that unlocks: message.send | `progression.unlock.message.send` | Progression | choice | `member` | the whole village |
| Stage that unlocks: exchange.buy | `progression.unlock.exchange.buy` | Progression | choice | `member` | the whole village |
| Stage that unlocks: exchange.swap | `progression.unlock.exchange.swap` | Progression | choice | `member` | the whole village |
| Stage that unlocks: mechanics.propose | `progression.unlock.mechanics.propose` | Progression | choice | `member` | the whole village |
| Stage that unlocks: event.rsvp | `progression.unlock.event.rsvp` | Progression | choice | `guest` | the whole village |
| Stage that unlocks: ballot.vote | `progression.unlock.ballot.vote` | Progression | choice | `member` | the whole village |
| Stage that unlocks: member.vouch | `progression.unlock.member.vouch` | Progression | choice | `contributor` | the whole village |
| Stage that unlocks: map.photograph | `progression.unlock.map.photograph` | Progression | choice | `member` | the whole village |
| How much can be released at consent | `quest.consent_cap_mode` | Quests | choice | `posted` | the whole village |
| Bonus ceiling multiplier | `quest.consent_cap_multiplier` | Quests | decimal | `2` | the whole village |
| Require submitted work before consent | `quest.require_submission_before_consent` | Quests | boolean | `true` | the whole village |
| Allow consenting at zero | `quest.allow_zero_consent` | Quests | boolean | `false` | the whole village |
| Founder may self-consent below this many members | `quest.self_consent_until_members` | Quests | integer | `6` | the whole village |
| How sensing is weighted | `governance.voice_weighting` | Governance | choice | `equal` | the whole village |
| The proposer bar: earned recognition to propose | `governance.hypha_threshold` | Governance | integer | `0` | the whole village |
| How long a topic stays open for sensing | `governance.sensing_days` | Governance | integer | `7` | the whole village |
| Mechanics proposals per member per cycle | `governance.proposals_per_member_per_cycle` | Governance | integer | `5` | the whole village |
| Supporters before a proposal can go to the vote | `governance.proposal_support_threshold` | Governance | integer | `0` | the whole village |
| Governance hub URL | `governance.hub_url` | Governance | text | blank | the founder or an admin |
| Apply verified proposals automatically | `governance.auto_apply_enabled` | Governance | boolean | `true` | the founder or an admin |
| Which decisions a steward can stop | `governance.steward_subjects` | Governance | text | `all` | the whole village |
| Which sizes of decision a steward can stop | `governance.steward_veto_tiers` | Governance | text | `constitutional` | the whole village |
| Payouts above this wait three days before they are sent | `governance.payout_delay_over` | Governance | integer | `1000` | the whole village |
| A veto needs a majority of the stewards | `governance.steward_council` | Governance | boolean | `false` | the whole village |
| How long a steward has to stop a change | `governance.veto_hours` | Governance | integer | `72` | the whole village |
| Cycles a passed decision waits before it is written off | `governance.landing_expiry_cycles` | Governance | integer | `3` | the whole village |
| Cooldown after a governed rule change | `governance.change_cooldown_days` | Governance | integer | `0` | the whole village |
| When a change to the Game Mechanics can go to the vote | `governance.window_changeset` | Governance | text | `always_open` | the whole village |
| When a change to what the village mints can go to the vote | `governance.window_mint_rule` | Governance | text | `always_open` | the whole village |
| When a change to how votes are counted can go to the vote | `governance.window_governance_mode` | Governance | text | `always_open` | the whole village |
| When declaring a role can go to the vote | `governance.window_role_declare` | Governance | text | `always_open` | the whole village |
| When seating a role can go to the vote | `governance.window_role_seat` | Governance | text | `always_open` | the whole village |
| When taking a seat back can go to the vote | `governance.window_role_unseat` | Governance | text | `always_open` | the whole village |
| When moving a power to a role can go to the vote | `governance.window_power_transfer` | Governance | text | `always_open` | the whole village |
| When granting a power can go to the vote | `governance.window_power_grant` | Governance | text | `always_open` | the whole village |
| When handing a power back can go to the vote | `governance.window_power_return` | Governance | text | `always_open` | the whole village |
| How long a proposal coming back may open outside its window | `governance.window_grace_days` | Governance | integer | `7` | the whole village |
| How voting weight is assigned | `governance.weight_mode` | Governance | choice | `equal` | the founder or an admin |
| The weight token | `governance.weight_token` | Governance | text | `gratitude` | the founder or an admin |
| Unity needed to pass | `governance.unity_pct` | Governance | percentage | `80` | the whole village |
| Quorum needed to count | `governance.quorum_pct` | Governance | percentage | `20` | the whole village |
| How long a ballot stays open | `governance.vote_days` | Governance | integer | `7` | the whole village |
| How long a consent window stays open | `governance.consent_window_days` | Governance | integer | `7` | the whole village |
| How village-wide ballots decide | `governance.default_method` | Governance | choice | `custom` | the whole village |
| Routine changes: quorum floor | `governance.tier_routine_quorum_pct` | Governance | percentage | `0` | the whole village |
| Routine changes: unity floor | `governance.tier_routine_unity_pct` | Governance | percentage | `0` | the whole village |
| Structural changes: quorum floor | `governance.tier_structural_quorum_pct` | Governance | percentage | `50` | the whole village |
| Structural changes: unity floor | `governance.tier_structural_unity_pct` | Governance | percentage | `80` | the whole village |
| Constitutional changes: quorum floor | `governance.tier_constitutional_quorum_pct` | Governance | percentage | `97` | the whole village |
| Constitutional changes: unity floor | `governance.tier_constitutional_unity_pct` | Governance | percentage | `97` | the whole village |
| The tier a veto override is passed at | `governance.highest_tier` | Governance | choice | `constitutional` | the whole village |
| Minting rule changes: quorum floor | `governance.subject_mint_rule_quorum_pct` | Governance | percentage | `50` | the whole village |
| Minting rule changes: unity floor | `governance.subject_mint_rule_unity_pct` | Governance | percentage | `0` | the whole village |
| Seats speaking for other beings count toward quorum | `governance.nonhuman_in_quorum` | Governance | boolean | `false` | the whole village |
| Cycles of silence before a seat leaves the count | `governance.absent_cycles` | Governance | integer | `3` | the whole village |
| Vouches to admit a member | `membership.vouch_threshold` | Governance | integer | `0` | the whole village |
| Equity token contract address on Base | `tokens.equity_address` | Tokens | text | blank | the founder or an admin |
| Governance token contract address on Base | `tokens.voice_address` | Tokens | text | blank | the founder or an admin |
| Show the economics section | `tokens.show_economics_section` | Tokens | boolean | `false` | the whole village |
| Base RPC endpoint | `tokens.base_rpc_url` | Tokens | text | `https://mainnet.base.org` | the founder or an admin |
| Your Hypha DHO address | `hypha.org_url` | Hypha | text | blank | the founder or an admin |
| Hypha space id (on-chain) | `hypha.space_id` | Hypha | text | blank | the founder or an admin |
| DAO treasury address on Base | `hypha.treasury_address` | Hypha | text | blank | the founder or an admin |
| Founder Base account address | `hypha.founder_base_address` | Hypha | text | blank | the founder or an admin |
| Override: governance link | `hypha.link_governance` | Hypha | text | blank | the founder or an admin |
| Override: proposals link | `hypha.link_proposals` | Hypha | text | blank | the founder or an admin |
| Override: treasury link | `hypha.link_treasury` | Hypha | text | blank | the founder or an admin |
| Override: members link | `hypha.link_members` | Hypha | text | blank | the founder or an admin |
| Count tool opens | `tools.click_tracking` | Tools | boolean | `true` | the whole village |
| Days between automatic link checks | `tools.link_check_days` | Tools | integer | `0` | the whole village |
| Signed-in session length | `auth.session_days` | Accounts & sessions | integer | `30` | the founder or an admin |
| Most emails one member receives per day | `notify.daily_email_cap` | Accounts & sessions | integer | `20` | the founder or an admin |
| Registrations per IP per hour | `abuse.register_per_ip_hourly` | Abuse guards | integer | `30` | the founder or an admin |
| Failed logins per IP per 15 minutes | `abuse.login_ip_per_quarter_hour` | Abuse guards | integer | `30` | the founder or an admin |
| Failed logins per account per 15 minutes | `abuse.login_account_per_quarter_hour` | Abuse guards | integer | `10` | the founder or an admin |
| Password-reset requests per IP per hour | `abuse.password_reset_per_ip_hourly` | Abuse guards | integer | `10` | the founder or an admin |
| Investor-packet requests per IP per hour | `abuse.investor_docs_per_ip_hourly` | Abuse guards | integer | `3` | the founder or an admin |
| Keep handled form submissions for | `retention.submissions_days` | Data lifecycle | integer | `365` | the founder or an admin |
| Keep read notifications for | `retention.notifications_days` | Data lifecycle | integer | `90` | the founder or an admin |
| Leave an unreferenced upload alone for | `uploads.orphan_grace_days` | Data lifecycle | integer | `30` | the founder or an admin |
| Draft call syntheses in the background at half price | `assistant.synthesis_batch` | Automation | boolean | `false` | the founder or an admin |
| Show the map's structure to visitors | `map.public_structure` | Village map | boolean | `true` | the whole village |
| Show the coordination concierge | `map.concierge_enabled` | Village map | boolean | `true` | the whole village |
| Contact requests a member may send per day | `map.contact_daily_cap` | Village map | integer | `5` | the whole village |
| Contact requests one person receives per day | `map.contact_recipient_daily_cap` | Village map | integer | `3` | the whole village |
| Show open quests on the map | `map.show_quests` | Village map | boolean | `true` | the whole village |
| Highlight vacant seats | `map.vacant_highlight` | Village map | boolean | `true` | the whole village |
| Keep contact message bodies for | `map.contact_retention_days` | Village map | integer | `180` | the founder or an admin |
| Largest photograph a member may upload | `map.photo_max_mb` | Village map | integer | `8` | the founder or an admin |
| Photographs one place may hold | `map.photos_per_place` | Village map | integer | `60` | the whole village |
| Photographs one member may add per day | `map.photos_per_member_daily` | Village map | integer | `12` | the whole village |
| Reports that hide a photograph on their own | `map.photo_report_hide_threshold` | Village map | integer | `3` | the whole village |
| Keep the record of a removed photograph for | `map.photo_tombstone_days` | Village map | integer | `180` | the founder or an admin |
| Show who holds each seat to visitors | `org.public_people` | The village's people | boolean | `true` | the founder or an admin |
| Let members RSVP | `events.rsvp_enabled` | Events | boolean | `true` | the whole village |
| Show gatherings this far ahead | `events.upcoming_days` | Events | integer | `90` | the whole village |
| Keep finished gatherings listed for | `events.past_visible_days` | Events | integer | `30` | the whole village |
| Soft reports that auto-hide a post | `forum.report_hide_threshold` | Forum | integer | `3` | the whole village |
| Messages one member may send per minute | `messaging.sends_per_minute` | Messages | integer | `20` | the whole village |
| Largest group conversation | `messaging.max_members` | Messages | integer | `50` | the whole village |
| Which forum category the feed shows | `feed.category_slug` | Feed | text | `village-life` | the whole village |
| Weave the village's own milestones into the feed | `feed.show_system_events` | Feed | boolean | `true` | the whole village |
| How much of a long post the feed shows | `feed.max_post_length` | Feed | integer | `600` | the whole village |
| Guests can request stays | `stay.guest_booking_enabled` | Stays | boolean | `true` | the whole village |
| New stays autopay by default | `stay.autopay_default` | Stays | boolean | `true` | the whole village |
| Hour nightly credits post (UTC) | `stay.autopay_post_hour` | Stays | integer | `10` | the whole village |
| Low-balance warning threshold | `stay.low_balance_warn_nights` | Stays | integer | `2` | the whole village |
| Grace nights below zero | `stay.grace_nights` | Stays | integer | `2` | the whole village |
| Most nights purchasable at once | `stay.max_purchase_nights` | Stays | integer | `60` | the whole village |
| Credit expiry (0 = never) | `stay.credit_expiry_days` | Stays | integer | `0` | the whole village |
| Members can gift credits to each other | `stay.credits_transferable` | Stays | boolean | `false` | the whole village |
| Work-exchange quest tag | `stay.work_exchange_tag` | Stays | text | `work-exchange` | the whole village |
| Stay requests per member per day | `stay.request_daily_cap` | Stays | integer | `5` | the whole village |
| Largest single price change | `exchange.price_change_max_pct` | Exchange | integer | `20` | the whole village |
| The village's share of each swap | `exchange.swap_spread_bps` | Exchange | integer | `0` | the whole village |
| Abandoned card checkouts are released after | `exchange.order_expiry_hours` | Exchange | integer | `48` | the whole village |
| Card-bought tokens settle before they can be swapped | `exchange.swap_fiat_hold_days` | Exchange | integer | `45` | the whole village |
| Most a member can receive in one swap | `exchange.swap_max_receive_per_order` | Exchange | integer | `500` | the whole village |
| Intake award, % of appraisal | `library.intake_award_pct` | Library | integer | `75` | the whole village |
| Intake credits per member per cycle | `library.intake_member_cycle_cap` | Library | integer | `500` | the whole village |
| Dual sign-off above (appraisal) | `library.intake_dual_signoff_over` | Library | integer | `200` | the whole village |
| Borrowing escrow, % of value | `library.escrow_pct` | Library | integer | `25` | the whole village |
| Usage fee per loan, % of value | `library.usage_fee_pct` | Library | integer | `5` | the whole village |
| Loan length | `library.loan_days_default` | Library | integer | `14` | the whole village |
| Dispute deadline | `library.dispute_deadline_days` | Library | integer | `14` | the whole village |
| Intake stall alarm | `library.intake_stall_days` | Library | integer | `7` | the whole village |
| Library reservations per member per day | `library.reserve_daily_cap` | Library | integer | `10` | the whole village |
| Largest single purchase (USD) | `payments.purchase_limit_per_order_usd` | Payments | integer | `1000` | the whole village |
| 30-day purchase limit per member (USD) | `payments.purchase_limit_30d_usd` | Payments | integer | `3000` | the whole village |
| Annual purchase limit per member (USD) | `payments.purchase_limit_annual_usd` | Payments | integer | `10000` | the whole village |
| Largest checkout donation | `payments.donation_max_usd` | Payments | integer | `50000` | the whole village |
| Village Pulse length | `village.pulse_max_entries` | Village | integer | `30` | the whole village |
| The date this village counts Moon 1 from | `village.first_moon_at` | Village | text | blank | the founder or an admin |
| Alert when a metric moves this much | `health.alert_change_pct` | Health | integer | `40` | the whole village |
| Featured badges per member | `badges.max_featured` | Badges | integer | `3` | the whole village |
| Share bug reports and ideas with the platform team | `platform.feedback_relay` | Platform | boolean | `true` | the founder or an admin |
| The solar event that opens the village year | `calendar.year_anchor` | Calendar | choice | `december_solstice` | the whole village |
| Hemisphere | `calendar.hemisphere` | Calendar | choice | `north` | the whole village |
| Mark the cross-quarter days | `calendar.cross_quarters` | Calendar | boolean | `false` | the whole village |
| Introductions one person receives per day | `introductions.recipient_daily_cap` | Introductions | integer | `3` | the whole village |
| Match score floor | `introductions.match_floor` | Introductions | integer | `3` | the whole village |
| Days an introduction stays open | `introductions.opportunity_days` | Introductions | integer | `10` | the whole village |
| Keep match reasoning for | `introductions.retention_days` | Introductions | integer | `90` | the whole village |

## Membership

2 dials. 2 for the whole village.

### Vouches that admit a member

How many people have to say they know somebody before that person becomes a member. Three by default, and the number is tied to how a village starts: a village launches when a founder brings two more and all three carry the launch, which leaves exactly the three vouchers the fourth member needs. The person who invited them counts as the first. A vouch cannot be taken back, so this bar is only ever crossed forwards. Lower it and the membrane is thinner; raise it and a young village may not be able to admit anybody at all, which is what the steward override exists for.

| Fact | Value |
| --- | --- |
| Key | `membership.vouches_required` |
| Type | integer, a whole number |
| Default | `3` |
| Range | 1 to 20 |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### The seat that greets a new arrival

The role whose holders are told the moment somebody joins. Greeting belongs to a seat, so the village re-seats it each season and the message follows with nobody editing a setting. Leave it empty and the founders hear it, which is also what happens when the seat is named and nobody is sitting in it: a village that has not built its org chart yet, and one whose greeter stepped down last week, both still find out that a person arrived. Paste the role id from the org chart.

| Fact | Value |
| --- | --- |
| Key | `arrival.greeter_role` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Gratitude

9 dials. 9 for the whole village.

### Base sending allowance per cycle

THE allowance behind every way of giving in this village: written acknowledgments on the Gratitude page, and taps of appreciation on the feed. A member's own figure is this number times their stage multiplier under Progression, so the stock ladder runs from 105 a cycle at Guest to 525 at Sage. Set it to 0 and nobody gives anything at any stage. Raise it and every stage rises with it, and so does the amount any one person may receive, because that ceiling is this figure divided by 'Full sends per cycle'. The default is 105 because it divides evenly by the default of 7 full sends, which is what makes a full send a whole 15 Gratitude at Guest and 75 at Sage. A figure that does not divide evenly still works: the ceiling rounds down and the remainder is given as a smaller gift. Unused allowance does not roll over. Giving mints fresh Gratitude for the person being thanked and takes nothing from the giver's own balance, so this allowance is what bounds it. Works with: 'Full sends per cycle', 'Gratitude each heart sends', 'Hearts one member can tap for another per cycle', and 'Sending-budget multiplier' under Progression.

| Fact | Value |
| --- | --- |
| Key | `gratitude.base_budget` |
| Type | integer, a whole number |
| Default | `105` |
| Range | 0 to 100000 |
| Counted in | Gratitude |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Value pool distributed at each cycle close

How many tokens the village shares out when a lunar cycle closes. The pool is split among everyone in proportion to the recognition they received that cycle, so you decide how much there is and the community's appreciation decides where it goes. Set it to 0 to turn distribution off and let gratitude stay a signal on its own.

| Fact | Value |
| --- | --- |
| Key | `gratitude.pool_per_cycle` |
| Type | integer, a whole number |
| Default | `1000` |
| Range | 0 to 1000000 |
| Counted in | tokens |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Which token the pool pays

The token the cycle pool pays out, for example your village's credits. The list holds the tokens this village issues itself, and it leaves out the recognition token on purpose: recognition is the signal, this is the value, and keeping them apart is what stops appreciation from becoming a price. Rename your tokens in the token registry and they change here too.

| Fact | Value |
| --- | --- |
| Key | `gratitude.pool_token` |
| Type | text, free text |
| Default | `credits` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Full sends per cycle

How many people it takes to give a whole allowance away, and so how many full-strength gifts a member has each cycle. At the default of 7 the most any one person can receive is a seventh of the giver's allowance, across as many sends as they like, so thanking seven people spends everything. Set it to 1 and one person can receive somebody's whole allowance. Set it to 100 and it takes a hundred people to spend one. Sending to more people than this is allowed and always was: the ceiling bounds the AMOUNT one person may receive and never the number of sends, so a wider circle simply means smaller gifts. It counts written acknowledgments and feed hearts TOGETHER, so neither channel can carry what the other refuses. The ceiling is the base sending allowance times the giver's stage multiplier, divided by this number, so at the stock ladder 7 means 15 Gratitude to one person at Guest and 75 at Sage. It never falls below 1 Gratitude, so a small allowance and a large count cannot combine into a village where nobody can give anything at all. This is also the dial that bounds concentrated VOICE while Gratitude is the weight token under Governance: it decides how much of one member's standing may come from a single relationship. Works with: 'Base sending allowance per cycle', 'Gratitude each heart sends', 'Hearts one member can tap for another per cycle', and 'Sending-budget multiplier' under Progression.

| Fact | Value |
| --- | --- |
| Key | `gratitude.full_sends_per_cycle` |
| Type | integer, a whole number |
| Default | `7` |
| Range | 1 to 1000 |
| Counted in | full sends |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Require a message with every acknowledgment

When on, Gratitude cannot be sent silently. The message is what makes recognition mean something to the person receiving it.

| Fact | Value |
| --- | --- |
| Key | `gratitude.require_message` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### The rhythm the village keeps time by

Whether a cycle is a moon or a calendar month. The moon is the default and is what every village has run on: budgets refill, caps reset and the settlement lands at the new moon, so the village keeps its own rhythm instead of the one on an office wall. Calendar months suit a village whose money and reporting already run that way. The switch is a constitutional change and lands only where a cycle ends, with every finished cycle settled first, so no cycle is ever cut in half or settled against a clock it was not played on. Every cycle already closed keeps the name and the dates it closed under, whichever rhythm the village moves to.

| Fact | Value |
| --- | --- |
| Key | `cycle.mode` |
| Type | choice, one of a fixed list |
| Default | `lunar` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

What it may be set to:

- `lunar` The moon. New moon to new moon, about 29.5 days. Boundaries come from a checked-in table of true new moons.
- `calendar` The calendar month. First of the month to first of the month, UTC. Cycles carry ids like month-2026-09.

### Gratitude each heart sends

What one tap of appreciation on the feed is worth. A heart is a real send: it comes out of the tapper's own cycle allowance the same way a written acknowledgment does, so a larger heart empties an allowance faster and reaches the per-person share sooner. It will not go above 5, which keeps a tap a small and frequent gesture. Raising it makes every heart heavier and changes nothing about how many a member can leave. Works with: 'Base sending allowance per cycle', 'Share of an allowance any one person can receive', 'Hearts one member can tap for another per cycle', and 'Sending-budget multiplier' under Progression.

| Fact | Value |
| --- | --- |
| Key | `feed.heart_amount` |
| Type | integer, a whole number |
| Default | `1` |
| Range | 1 to 5 |
| Counted in | Gratitude |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Hearts one member can tap for another per cycle

How many separate taps of appreciation one member can leave for another in a cycle. THE ONLY LIMIT IN THE VILLAGE THAT COUNTS TAPS: every other limit on giving counts Gratitude. Each tap spends the tapper's own cycle allowance, so the real ceiling is whichever runs out first, this count or the share of the allowance any one person can receive. At the stock dials a member can leave 5 hearts worth 1 each, well inside a share of 25. Set it to 1 to make a heart a once-per-cycle gesture; set it high and the share becomes the only thing holding the channel. Works with: 'Base sending allowance per cycle', 'Share of an allowance any one person can receive', 'Gratitude each heart sends', and 'Sending-budget multiplier' under Progression.

| Fact | Value |
| --- | --- |
| Key | `feed.max_hearts_per_recipient_per_cycle` |
| Type | integer, a whole number |
| Default | `5` |
| Range | 1 to 20 |
| Counted in | hearts |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Recognition for an accepted Work With Us proposal

How much recognition is minted for a member whose Work With Us proposal is accepted. This used to live inside the Work With Us content settings with no bounds; it is issuance, so it belongs here with the other Gratitude dials.

| Fact | Value |
| --- | --- |
| Key | `gratitude.proposal_accept_award` |
| Type | integer, a whole number |
| Default | `100` |
| Range | 0 to 100000 |
| Counted in | Gratitude |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Ledger

2 dials. 2 for the whole village.

### Admin mint cap per cycle

The most any admins can mint by hand, in total, per token, per cycle (S9's mint endpoint enforces it as an aggregate, not per call). COUNTED IN WHOLE TOKENS, so 100 means a hundred of the token and not a hundred of whatever the ledger stores underneath. A cap on manual issuance is what makes 'the numbers mean something' a property of the system instead of a promise from whoever holds admin. 0 disables manual minting entirely.

| Fact | Value |
| --- | --- |
| Key | `ledger.admin_mint_cycle_cap` |
| Type | integer, a whole number |
| Default | `10000` |
| Range | 0 to 10000000 |
| Counted in | tokens |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Second steward needed above

A hand-mint larger than this waits for a SECOND steward to agree before any tokens move. COUNTED IN WHOLE TOKENS, so 100 means a hundred of the token. Set it against what a large grant looks like in your village, and know that it is the only place a second pair of eyes is required. The record keeps who asked, who agreed, when, and the exact amount and token, so nobody can change what was signed for afterwards. 0 turns the second signature off. Minting to your own account is refused at any amount and this dial does not reach that rule.

| Fact | Value |
| --- | --- |
| Key | `ledger.admin_mint_cosign_over` |
| Type | integer, a whole number |
| Default | `100` |
| Range | 0 to 10000000 |
| Counted in | tokens |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## The Mint

4 dials. 3 for the whole village, 1 for the founder or an admin.

### Voice needed before a member can claim

How much voice someone gathers before their chip turns claimable. What this really sets is how much attention your governance spends: every claim becomes a real proposal in your Hypha space, so a low number fills that space with small ones and a high number leaves people waiting a year for a loop that never visibly closes. At the seeded rates, 100 is ten confirmed quests, or two seasons holding a seat, or a mix of both. A good way to pick it: decide how many claim proposals your circle can genuinely consider in one Claims Week, then set this so about that many members qualify.

| Fact | Value |
| --- | --- |
| Key | `economy.voice_claim_threshold` |
| Type | integer, a whole number |
| Default | `100` |
| Range | 1 to 100000 |
| Counted in | voice |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### How many days Claims Week stays open

Claims open for one window each season, so a whole season of contribution formalises in one governance pass instead of a drip of separate proposals. Outside the window a member's chip reads how much they have gathered and when it next opens. Worth lining the window up so it CLOSES just before your governance actually meets: if it shuts six weeks before anyone votes, claims simply sit and wait.

| Fact | Value |
| --- | --- |
| Key | `economy.claims_week_days` |
| Type | integer, a whole number |
| Default | `7` |
| Range | 1 to 90 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### When each Claims Week begins

Four dates a year, one per season, as MM-DD separated by commas. The default follows the solstices and equinoxes, which is the sun's rhythm and a different clock from the cycle the settlement keeps: a season turn and a cycle boundary fall on different days, and the window opens at midnight in the village timezone. Leave it blank to keep claims open all year, which suits a village that would rather not batch.

| Fact | Value |
| --- | --- |
| Key | `economy.claims_week_starts` |
| Type | text, free text |
| Default | `03-21,06-21,09-23,12-21` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Your Hypha space

The DHO slug that voice claims are raised into, from app.hypha.earth. Until this is set, voice gathers correctly and cannot be claimed, and members are told exactly that. Nobody is shown a button that would fail. Set it ONLY to a space your village controls: a claim is a proposal to move real value, and an intent aimed somewhere else is value leaving through a door you did not open.

| Fact | Value |
| --- | --- |
| Key | `economy.hypha_space` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Progression

27 dials. 27 for the whole village.

### How often every seat reopens

A season can end with every seat vacated and offered again. Reopening on a rhythm is how a village keeps seats from calcifying, because correcting a bad fit stops needing a confrontation and becomes a date everyone already knew about. A seat can opt out on its own card, and a term can always end sooner.

| Fact | Value |
| --- | --- |
| Key | `org.reassignment_cadence` |
| Type | choice, one of a fixed list |
| Default | `season_turn` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `season_turn` Every season turn. Recommended while a village is young: three months is short enough to learn fast and change what is not working.
- `pattern_change` When the season's shape changes. A founding season can run across several turns without reopening every seat each time.
- `annual` Once a year. One reopening a year, whatever the seasons did.
- `never` Never. Seats end only on their own term date, or when somebody steps down.

### Sending-budget multiplier: Visitor

Multiplies the base Gratitude sending allowance for members at the Visitor stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.visitor` |
| Type | decimal, a number, fractions allowed |
| Default | `0` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Sending-budget multiplier: Guest

Multiplies the base Gratitude sending allowance for members at the Guest stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.guest` |
| Type | decimal, a number, fractions allowed |
| Default | `1` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Sending-budget multiplier: Immersant

Multiplies the base Gratitude sending allowance for members at the Immersant stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.immersant` |
| Type | decimal, a number, fractions allowed |
| Default | `1` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Sending-budget multiplier: Participant

Multiplies the base Gratitude sending allowance for members at the Participant stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.participant` |
| Type | decimal, a number, fractions allowed |
| Default | `1` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Sending-budget multiplier: Member

Multiplies the base Gratitude sending allowance for members at the Member stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.member` |
| Type | decimal, a number, fractions allowed |
| Default | `2` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Sending-budget multiplier: Contributor

Multiplies the base Gratitude sending allowance for members at the Contributor stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.contributor` |
| Type | decimal, a number, fractions allowed |
| Default | `2` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Sending-budget multiplier: Quest Seeker

Multiplies the base Gratitude sending allowance for members at the Quest Seeker stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.quest-seeker` |
| Type | decimal, a number, fractions allowed |
| Default | `2` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Sending-budget multiplier: Initiate

Multiplies the base Gratitude sending allowance for members at the Initiate stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.initiate` |
| Type | decimal, a number, fractions allowed |
| Default | `2` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Sending-budget multiplier: Co-Creator

Multiplies the base Gratitude sending allowance for members at the Co-Creator stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.co-creator` |
| Type | decimal, a number, fractions allowed |
| Default | `3` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Sending-budget multiplier: Role Holder

Multiplies the base Gratitude sending allowance for members at the Role Holder stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.role-holder` |
| Type | decimal, a number, fractions allowed |
| Default | `3` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Sending-budget multiplier: Guide

Multiplies the base Gratitude sending allowance for members at the Guide stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.guide` |
| Type | decimal, a number, fractions allowed |
| Default | `4` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Sending-budget multiplier: Sage

Multiplies the base Gratitude sending allowance for members at the Sage stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.

| Fact | Value |
| --- | --- |
| Key | `progression.multiplier.sage` |
| Type | decimal, a number, fractions allowed |
| Default | `5` |
| Range | 0 to 100 |
| Counted in | x base budget |
| Who may change it | the whole village |
| A change takes effect | at the next cycle close |
| What it costs to change | a routine vote |

### Consented quests to reach Quest Seeker

How many consented quests advance a member to the Quest Seeker stage. Raising it never demotes anyone retroactively on its own: stages are recomputed from live counts.

| Fact | Value |
| --- | --- |
| Key | `progression.quests_for.quest-seeker` |
| Type | integer, a whole number |
| Default | `3` |
| Range | 1 to 1000 |
| Counted in | consented quests |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Stage that unlocks: forum.post

Which rung of the ladder grants "forum.post" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.forum.post` |
| Type | choice, one of a fixed list |
| Default | `member` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: proposal.open

Which rung of the ladder grants "proposal.open" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.proposal.open` |
| Type | choice, one of a fixed list |
| Default | `co-creator` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: map.viewPeople

Which rung of the ladder grants "map.viewPeople" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.map.viewPeople` |
| Type | choice, one of a fixed list |
| Default | `guest` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: map.contact

Which rung of the ladder grants "map.contact" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.map.contact` |
| Type | choice, one of a fixed list |
| Default | `member` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: stay.member_rate

Which rung of the ladder grants "stay.member_rate" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.stay.member_rate` |
| Type | choice, one of a fixed list |
| Default | `member` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: message.send

Which rung of the ladder grants "message.send" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.message.send` |
| Type | choice, one of a fixed list |
| Default | `member` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: exchange.buy

Which rung of the ladder grants "exchange.buy" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.exchange.buy` |
| Type | choice, one of a fixed list |
| Default | `member` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: exchange.swap

Which rung of the ladder grants "exchange.swap" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.exchange.swap` |
| Type | choice, one of a fixed list |
| Default | `member` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: mechanics.propose

Which rung of the ladder grants "mechanics.propose" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.mechanics.propose` |
| Type | choice, one of a fixed list |
| Default | `member` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: event.rsvp

Which rung of the ladder grants "event.rsvp" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.event.rsvp` |
| Type | choice, one of a fixed list |
| Default | `guest` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: ballot.vote

Which rung of the ladder grants "ballot.vote" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.ballot.vote` |
| Type | choice, one of a fixed list |
| Default | `member` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: member.vouch

Which rung of the ladder grants "member.vouch" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.member.vouch` |
| Type | choice, one of a fixed list |
| Default | `contributor` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

### Stage that unlocks: map.photograph

Which rung of the ladder grants "map.photograph" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.

| Fact | Value |
| --- | --- |
| Key | `progression.unlock.map.photograph` |
| Type | choice, one of a fixed list |
| Default | `member` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `visitor` Visitor.
- `guest` Guest.
- `immersant` Immersant.
- `participant` Participant.
- `member` Member.
- `contributor` Contributor.
- `quest-seeker` Quest Seeker.
- `initiate` Initiate.
- `co-creator` Co-Creator.
- `role-holder` Role Holder.
- `guide` Guide.
- `sage` Sage.
- `none` Never by stage (role or badge only).

## Quests

5 dials. 5 for the whole village.

### How much can be released at consent

Controls what an admin may award when consenting to finished work. Capping it at the posted amount keeps the quest board honest: what a quest advertises is what it pays.

| Fact | Value |
| --- | --- |
| Key | `quest.consent_cap_mode` |
| Type | choice, one of a fixed list |
| Default | `posted` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `posted` Exactly the posted amount. Safest. The board is the contract.
- `capped` Up to a multiple of the posted amount. Allows a bonus for exceptional work, within a ceiling.
- `unlimited` Any amount. No ceiling. Only sensible with a very small, very trusted admin group.

### Bonus ceiling multiplier

When the cap mode is 'up to a multiple', this is the most that can be awarded as a multiple of the posted amount. 2 means a quest posted at 100 can pay at most 200.

| Fact | Value |
| --- | --- |
| Key | `quest.consent_cap_multiplier` |
| Type | decimal, a number, fractions allowed |
| Default | `2` |
| Range | 1 to 100 |
| Counted in | x posted |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Require submitted work before consent

When on, value can only be released for work that was actually filed. Turning this off lets an admin credit a quest nobody submitted, which breaks the promise that credit follows shown work.

| Fact | Value |
| --- | --- |
| Key | `quest.require_submission_before_consent` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Allow consenting at zero

When on, a claim can be consented with an amount of 0, meaning 'acknowledged, no recognition'. The claim completes and any stay-credit reward still releases, but no recognition moves. When off, consent must release at least 1.

| Fact | Value |
| --- | --- |
| Key | `quest.allow_zero_consent` |
| Type | boolean, on or off |
| Default | `false` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Founder may self-consent below this many members

Consent normally needs a second person to witness the work: nobody may consent to their own claim. A founder building alone has nobody to ask, so while the village has FEWER than this many members, an admin or founder may consent to their own claims. Once the village reaches this size, the witness rule applies to everyone, admins included. 0 means self-consent is never allowed, even for a founder alone.

| Fact | Value |
| --- | --- |
| Key | `quest.self_consent_until_members` |
| Type | integer, a whole number |
| Default | `6` |
| Range | 0 to 1000 |
| Counted in | members |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Governance

43 dials. 39 for the whole village, 4 for the founder or an admin.

### How sensing is weighted

Sensing gathers support before a ballot opens. Choose whether it gives everyone an equal voice, or mirrors Voice holdings so you can see how a weighted vote would land. Where the binding vote itself happens, here or on your DAO, is decided by the governance module and its own weight setting.

| Fact | Value |
| --- | --- |
| Key | `governance.voice_weighting` |
| Type | choice, one of a fixed list |
| Default | `equal` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `equal` One person, one voice. Everyone's sensing counts the same, regardless of what they hold. Simplest and most equal.
- `hypha-mirror` Mirror Hypha Voice holdings. Sensing is weighted by each member's Voice token balance, so the informal step previews how a formal Hypha decision would land.

### The proposer bar: earned recognition to propose

Earned recognition a member needs before they can OPEN mechanics proposals and sponsor others' drafts (below it, they can still draft; a qualified member's sponsorship opens a draft). The base posture is 0: any member may propose. Raise it to ask for earned standing first. Admins and founders always qualify.

| Fact | Value |
| --- | --- |
| Key | `governance.hypha_threshold` |
| Type | integer, a whole number |
| Default | `0` |
| Range | 0 to 10000000 |
| Counted in | Gratitude |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### How long a topic stays open for sensing

Days a proposal collects perspectives before it can move to a decision. Long enough that quiet people get heard, short enough that momentum survives.

| Fact | Value |
| --- | --- |
| Key | `governance.sensing_days` |
| Type | integer, a whole number |
| Default | `7` |
| Range | 1 to 90 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Mechanics proposals per member per cycle

How many game-rule change proposals one member may open per cycle. A ceiling on flooding, not on participation: supporting and sponsoring other proposals is never limited.

| Fact | Value |
| --- | --- |
| Key | `governance.proposals_per_member_per_cycle` |
| Type | integer, a whole number |
| Default | `5` |
| Range | 1 to 100 |
| Counted in | per cycle |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Supporters before a proposal can go to the vote

How many members must support a mechanics proposal in-game before it can be taken to the binding vote. The sensing step: proposals gather perspectives here first, and only what the village actually wants reaches a ballot. Where that ballot happens is set by how village-wide ballots decide, on this village's own dials or in your Hypha space. 0 turns the gate off, and any open proposal can go straight to the vote.

| Fact | Value |
| --- | --- |
| Key | `governance.proposal_support_threshold` |
| Type | integer, a whole number |
| Default | `0` |
| Range | 0 to 10000 |
| Counted in | supporters |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Governance hub URL

Base URL of the hub that listens to the chain for this village. When a proposal's Hypha URL is pasted in, the platform registers the on-chain proposal id with this hub (signed with the shared governance secret) so the verified outcome can find its way home. Empty means this village has no hub: nothing is registered and nothing is sent anywhere. Fill it in only if you run a hub or have been given one to point at.

| Fact | Value |
| --- | --- |
| Key | `governance.hub_url` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Apply verified proposals automatically

When on, a proposal verified as passed on-chain applies itself: instantly for instant dials, at the next cycle close when the set touches any cycle-timed dial (the whole set waits together; a set applies atomically or not at all). Turning this OFF is the founder's emergency brake: verified proposals hold, stewards are notified, and applying becomes a human act until it is turned back on. Founder-held on purpose.

| Fact | Value |
| --- | --- |
| Key | `governance.auto_apply_enabled` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### Which decisions a steward can stop

A steward can stop a decision the village has already carried, inside the window before it lands, and has to say why. This names which kinds of decision are inside that reach. Leave it as all while the village is young; name a shorter list, or none, as it learns to trust its own agreements. A village with no steward and self-executing agreements is a healthy village, not a broken one. Advisory votes are never in reach, because they change nothing. Neither is the ballot that seats or unseats a steward, so the seat can never stop its own removal.

| Fact | Value |
| --- | --- |
| Key | `governance.steward_subjects` |
| Type | text, free text |
| Default | `all` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Which sizes of decision a steward can stop

Every decision carries a size: routine, structural, or constitutional. This names the sizes a steward may stop inside the window before a decision lands, and a veto needs the decision to be in reach on both this list and the one above. The default is constitutional on its own, so the seat can pause the changes that reshape the village and leaves the smaller ones alone. Write them separated by commas, or write all. Leave it empty and no steward can stop anything, which is a healthy village and not a broken one. Changing this is priced at the top tier and no steward can stop the change, because a seat that could veto an edit to its own limits would have none.

| Fact | Value |
| --- | --- |
| Key | `governance.steward_veto_tiers` |
| Type | text, free text |
| Default | `constitutional` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Payouts above this wait three days before they are sent

A payout the village votes through is sent the moment it passes. Above this amount it waits the steward window first, so somebody can catch a send that would empty a purse or reward the wrong work. The amount is counted in whole tokens of whatever token is being sent, so a village holding several tokens with very different sizes should set this against the one it actually pays people in. Zero makes every payout wait.

| Fact | Value |
| --- | --- |
| Key | `governance.payout_delay_over` |
| Type | integer, a whole number |
| Default | `1000` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### A veto needs a majority of the stewards

Off by default, and off means any one seated steward can stop a decision on their own. Turn it on and a village with several stewards runs them as a council: stopping a decision then takes a majority of the seated seats, so one seat alone cannot hold the village up. Changing this is priced at the top tier, and no steward can stop the change, because a seat that could veto an edit to its own limits would have none.

| Fact | Value |
| --- | --- |
| Key | `governance.steward_council` |
| Type | boolean, on or off |
| Default | `false` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### How long a steward has to stop a change

A change to the Game that the village has passed does not take effect straight away. It is stamped with a landing instant and a steward may stop it until then, with a reason that goes on the record. This is the least notice a steward gets, counted from the moment the vote closes. 72 hours is the floor and cannot be lowered; a village may give its stewards longer. A decision that sends tokens is not held by this: a steward stops one of those by voting no while the ballot is still open.

| Fact | Value |
| --- | --- |
| Key | `governance.veto_hours` |
| Type | integer, a whole number |
| Default | `72` |
| Range | 72 to 720 |
| Counted in | hours |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Cycles a passed decision waits before it is written off

A decision the village passed is stamped with the instant it takes effect. If it is still sitting there this many cycles after that instant, it is closed and the village is told. The door back is to withdraw and rewrite it, which keeps everybody who backed it. Set it higher for a village that turns the automatic landing off for long stretches.

| Fact | Value |
| --- | --- |
| Key | `governance.landing_expiry_cycles` |
| Type | integer, a whole number |
| Default | `3` |
| Range | 1 to 12 |
| Counted in | cycles |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### Cooldown after a governed rule change

After a dial is changed by a passed proposal, this many days must pass before a new proposal may move that same dial again. Prevents rule-thrash and vote fatigue. 0 turns the cooldown off.

| Fact | Value |
| --- | --- |
| Key | `governance.change_cooldown_days` |
| Type | integer, a whole number |
| Default | `0` |
| Range | 0 to 365 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### When a change to the Game Mechanics can go to the vote

always_open lets anyone take a change set to the vote on any day. last_days_of_cycle:7 opens it in the last seven days before the moon turns, so the village reads its changes together. last_days_of_season:14 opens it in the last two weeks of the season that is running. custom:1-7 names your own days of the cycle, counted from the moon. A window decides when a vote may OPEN: a vote already running is never closed by a window shutting, and a proposal coming back after a veto or an objection opens outside its window for the grace named below.

| Fact | Value |
| --- | --- |
| Key | `governance.window_changeset` |
| Type | text, free text |
| Default | `always_open` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### When a change to what the village mints can go to the vote

The window a minting change opens in, in the same words as the change set window above. This one is separate because a village that wants its minting read together can hold minting to a window while everything else stays open. A change set carrying a minting element is held to the stricter of the two.

| Fact | Value |
| --- | --- |
| Key | `governance.window_mint_rule` |
| Type | text, free text |
| Default | `always_open` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### When a change to how votes are counted can go to the vote

The window a vote-mode switch opens in, in the same words as the change set window above. A change set carrying a mode switch is held to this window as well as its own, so the biggest change in a bundle cannot ride into an open week under a small one.

| Fact | Value |
| --- | --- |
| Key | `governance.window_governance_mode` |
| Type | text, free text |
| Default | `always_open` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### When declaring a role can go to the vote

The window a proposal that declares a new role opens in, in the same words as the change set window above.

| Fact | Value |
| --- | --- |
| Key | `governance.window_role_declare` |
| Type | text, free text |
| Default | `always_open` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### When seating a role can go to the vote

The window a proposal that asks somebody to sit in a role opens in, in the same words as the change set window above. Hold this one open while a village is young: a seat nobody can be asked to fill is a seat that stays empty until the calendar allows it.

| Fact | Value |
| --- | --- |
| Key | `governance.window_role_seat` |
| Type | text, free text |
| Default | `always_open` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### When taking a seat back can go to the vote

The window a proposal that takes a seat back opens in, in the same words as the change set window above. A village that windows this one is choosing to wait before it can remove somebody, so leave it always open unless you have a reason you can say out loud.

| Fact | Value |
| --- | --- |
| Key | `governance.window_role_unseat` |
| Type | text, free text |
| Default | `always_open` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### When moving a power to a role can go to the vote

The window a proposal that moves a power from the admin panel to a role opens in, in the same words as the change set window above.

| Fact | Value |
| --- | --- |
| Key | `governance.window_power_transfer` |
| Type | text, free text |
| Default | `always_open` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### When granting a power can go to the vote

The window a proposal that grants a power to a role opens in, in the same words as the change set window above.

| Fact | Value |
| --- | --- |
| Key | `governance.window_power_grant` |
| Type | text, free text |
| Default | `always_open` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### When handing a power back can go to the vote

The window a proposal that hands a power back to the admin panel opens in, in the same words as the change set window above.

| Fact | Value |
| --- | --- |
| Key | `governance.window_power_return` |
| Type | text, free text |
| Default | `always_open` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### How long a proposal coming back may open outside its window

A resubmission after objections, a veto override and a renewal of a trial are all proposals coming back, and the village has already been asked once. Each of them may open outside its kind's window for this many days after the decision it comes back from closed. Set this to 0 and a single steward's veto becomes unanswerable until the next window opens.

| Fact | Value |
| --- | --- |
| Key | `governance.window_grace_days` |
| Type | integer, a whole number |
| Default | `7` |
| Range | 0 to 90 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### How voting weight is assigned

What one member's vote weighs on an on-site ballot. Equal gives every eligible member the same single vote. Token weighs votes by each member's balance of the weight token at the moment a ballot opens. Custom weighs votes by the allocation table you keep under Voting weights, where a member with no allocation weighs zero. Whatever you choose, each ballot freezes the weights when it opens, and every allocation change is on a permanent record any member can read.

| Fact | Value |
| --- | --- |
| Key | `governance.weight_mode` |
| Type | choice, one of a fixed list |
| Default | `equal` |
| Range | one of the choices below |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

What it may be set to:

- `equal` One person, one vote. Every eligible member weighs the same.
- `token` Token balance. Weight is each member's balance of the weight token when the ballot opens.
- `custom` Custom allocation. Weight comes from the allocation table. No allocation means no weight.

### The weight token

Which token weighs votes when the weight mode is token. Only tokens this platform itself governs can be chosen: a token governed on Hypha is a display-only mirror here, and a ballot may never make this platform a second source of truth for it. The default is the recognition token, which nobody can buy, so weight in the default posture is earned appreciation.

| Fact | Value |
| --- | --- |
| Key | `governance.weight_token` |
| Type | text, free text |
| Default | `gratitude` |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Unity needed to pass

Of the votes cast for or against, the share that must be in favor for a ballot run on the village's own dials to pass. Abstentions help a ballot reach quorum and take no side here. 100 asks for consensus in effect; the Hypha surface this inherits from runs at 80.

| Fact | Value |
| --- | --- |
| Key | `governance.unity_pct` |
| Type | percentage, a percentage |
| Default | `80` |
| Range | 50 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### Quorum needed to count

The share of the electorate's total voting weight that must show up, counting abstentions, before a ballot's outcome counts at all. Below this the ballot closes as no quorum, whatever the votes said. Each ballot freezes this number when it opens.

| Fact | Value |
| --- | --- |
| Key | `governance.quorum_pct` |
| Type | percentage, a percentage |
| Default | `20` |
| Range | 1 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

### How long a ballot stays open

Days between a ballot opening and its votes locking. Votes can be changed freely until then. The clock closes the ballot when the window ends and the village's own engine reads the result, so nobody chooses the moment. A change to the Game then waits again, for the window a steward can stop it in.

| Fact | Value |
| --- | --- |
| Key | `governance.vote_days` |
| Type | integer, a whole number |
| Default | `7` |
| Range | 1 to 30 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### How long a consent window stays open

Days an objection window runs on a consent ballot. A consent decision passes when the window has ended, participation met quorum, and no objection still stands open. Objections are ruled by a facilitator, and every ruling is attributed and explained on the record.

| Fact | Value |
| --- | --- |
| Key | `governance.consent_window_days` |
| Type | integer, a whole number |
| Default | `7` |
| Range | 1 to 30 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### How village-wide ballots decide

The method a village-wide ballot uses when nothing more specific applies. Your own dials use the unity and quorum settings above. Majority means more than half of the votes cast carries it. Consensus means everyone who takes a side agrees. Consent means a decision passes when nobody sustains a reasoned objection. Hypha keeps the shipped loop: proposals go to your Hypha space for the binding vote.

| Fact | Value |
| --- | --- |
| Key | `governance.default_method` |
| Type | choice, one of a fixed list |
| Default | `custom` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

What it may be set to:

- `custom` This village's own dials. Uses the unity and quorum settings above.
- `majority` Majority. More than half of the votes cast carries it.
- `consensus` Consensus. Everyone who takes a side agrees.
- `consent` Consent. Passes when no reasoned objection stands.
- `hypha` Decide on Hypha. The shipped loop: the binding vote happens in your Hypha space.

### Routine changes: quorum floor

The least share of the village's voting weight that must turn up before an ordinary change to the Game can be decided. Ordinary means a number the village tunes while it plays. 0 leaves it entirely to your own quorum setting above, which is the shipped posture. Raise it to ask for more attention on every change, however small.

| Fact | Value |
| --- | --- |
| Key | `governance.tier_routine_quorum_pct` |
| Type | percentage, a percentage |
| Default | `0` |
| Range | 0 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Routine changes: unity floor

The least share of the votes cast for or against that must be in favour before an ordinary change to the Game carries. 0 leaves it entirely to your own unity setting above, which is the shipped posture.

| Fact | Value |
| --- | --- |
| Key | `governance.tier_routine_unity_pct` |
| Type | percentage, a percentage |
| Default | `0` |
| Range | 0 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Structural changes: quorum floor

The least share of the village's voting weight that must turn up before a structural change can be decided. Structural means it changes how the village decides or who belongs to it: the unity and quorum settings themselves, how ballots decide, who may be admitted, what the village mints, and turning a part of the Game on or off. The shipped 50 is this platform's starting number and your village may raise it. It cannot go below the platform floor.

| Fact | Value |
| --- | --- |
| Key | `governance.tier_structural_quorum_pct` |
| Type | percentage, a percentage |
| Default | `50` |
| Range | 50 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Structural changes: unity floor

The least share of the votes cast for or against that must be in favour before a structural change carries. The shipped 80 is the number this platform inherited from Hypha, and it is a starting point your village may raise. It cannot go below the platform floor.

| Fact | Value |
| --- | --- |
| Key | `governance.tier_structural_unity_pct` |
| Type | percentage, a percentage |
| Default | `80` |
| Range | 80 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Constitutional changes: quorum floor

The least share of the village's voting weight that must turn up before a constitutional change can be decided. Constitutional means it changes the rules for changing the rules: how voting weight is assigned, which token carries weight, and these bars themselves. The shipped number is 97, which leaves room for 3 in 100 to be unreachable on the day. Going higher is allowed and the Game will warn you why it is risky.

| Fact | Value |
| --- | --- |
| Key | `governance.tier_constitutional_quorum_pct` |
| Type | percentage, a percentage |
| Default | `97` |
| Range | 97 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Constitutional changes: unity floor

The least share of the votes cast for or against that must be in favour before a constitutional change carries. The shipped number is 97. Going higher is allowed and the Game will warn you why it is risky.

| Fact | Value |
| --- | --- |
| Key | `governance.tier_constitutional_unity_pct` |
| Type | percentage, a percentage |
| Default | `97` |
| Range | 97 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### The tier a veto override is passed at

A steward can veto a change the village passed. The village can bring the same proposal back and pass it again at this tier, and then it lands whatever any steward says. This names which tier that is: the highest one your village works at. Moving this setting costs whatever the tier it currently names costs, so lowering it is as hard as the bar you are lowering.

| Fact | Value |
| --- | --- |
| Key | `governance.highest_tier` |
| Type | choice, one of a fixed list |
| Default | `constitutional` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

What it may be set to:

- `routine` Routine. Your own unity and quorum settings decide an override.
- `structural` Structural. An override asks the structural bar: how the village decides.
- `constitutional` Constitutional. An override asks the highest bar this platform ships.

### Minting rule changes: quorum floor

The least share of the village's voting weight that must turn up before a change to what the village mints can be decided. This one sits on top of the structural tier, so raising it asks for more attention on minting alone without moving every other structural change with it. Cannot be set below the platform floor.

| Fact | Value |
| --- | --- |
| Key | `governance.subject_mint_rule_quorum_pct` |
| Type | percentage, a percentage |
| Default | `50` |
| Range | 50 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Minting rule changes: unity floor

The least share of the votes cast for or against that must be in favour before a change to what the village mints carries. 0 leaves it to the structural tier and your own unity setting.

| Fact | Value |
| --- | --- |
| Key | `governance.subject_mint_rule_unity_pct` |
| Type | percentage, a percentage |
| Default | `0` |
| Range | 0 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Seats speaking for other beings count toward quorum

Your village can seat a voice for a being that is not a person: a mountain, a river, the trees, the wolves. A member or a bot holds that seat and casts its vote. This says whether the weight on such a seat is part of the count that decides whether enough of the village turned up. Off, which is how it ships, leaves that weight out of the count on both sides of the sum, and a vote cast from the seat still counts toward agreement. On counts it like any member's, and weight that provably cannot answer drops out of the count instead.

| Fact | Value |
| --- | --- |
| Key | `governance.nonhuman_in_quorum` |
| Type | boolean, on or off |
| Default | `false` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Cycles of silence before a seat leaves the count

When seats speaking for other beings do count toward quorum, this is how many cycles of casting nothing it takes before such a seat's weight drops out of the count. A seat nobody holds drops out straight away. The weight is always shown beside the people count, so the village can see how much of its Voice is silent. Nothing here changes a threshold: it changes what the threshold is measured against.

| Fact | Value |
| --- | --- |
| Key | `governance.absent_cycles` |
| Type | integer, a whole number |
| Default | `3` |
| Range | 1 to 24 |
| Counted in | cycles |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a constitutional vote, at the highest bar the village has set |

### Vouches to admit a member

How many standing members must vouch for an applicant before membership completes on its own. 0 keeps vouching off and admission stays whatever your current process is. Vouching comes from contributors and up, a member may never vouch for themself, and every vouch is on the record.

| Fact | Value |
| --- | --- |
| Key | `membership.vouch_threshold` |
| Type | integer, a whole number |
| Default | `0` |
| Range | 0 to 20 |
| Counted in | vouches |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a structural vote, at a higher bar |

## Tokens

4 dials. 1 for the whole village, 3 for the founder or an admin.

### Equity token contract address on Base

The ERC-20 address for the project's equity token. The platform only ever READS this balance to display it: minting, pricing and governance all happen on Hypha. Leave blank until the token is deployed and nothing is shown.

| Fact | Value |
| --- | --- |
| Key | `tokens.equity_address` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Governance token contract address on Base

The ERC-20 address for the governance-weight token. Read-only here, exactly like the equity token.

| Fact | Value |
| --- | --- |
| Key | `tokens.voice_address` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Show the economics section

Displays token balances and Gratitude flows on member profiles. Turn off while the tokens are still being designed so members are not shown empty charts.

| Fact | Value |
| --- | --- |
| Key | `tokens.show_economics_section` |
| Type | boolean, on or off |
| Default | `false` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Base RPC endpoint

Where balances are read from. A public endpoint is fine to start; a dedicated one is more reliable under load. If this fails, the platform shows nothing, never a wrong number.

| Fact | Value |
| --- | --- |
| Key | `tokens.base_rpc_url` |
| Type | text, free text |
| Default | `https://mainnet.base.org` |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Hypha

8 dials. 8 for the founder or an admin.

### Your Hypha DHO address

The one place this platform sends people for governance, proposals, treasury and membership on Hypha. Every module derives its deep links from this single value; leaving it blank hides every Hypha button, so nobody meets a dead link.

| Fact | Value |
| --- | --- |
| Key | `hypha.org_url` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Hypha space id (on-chain)

The numeric id of your DAO's space on Hypha's Base contracts. Every on-chain proposal your DAO creates is stamped with it. Found in your Hypha space's URL or from any of its proposals on Basescan. Fill this in and the governance webhook checks it: a delivery that names a different space is refused, even when its signature is good, because one hub watches Base for many villages off one listener and a routing mistake there arrives correctly signed. A delivery that names no space at all is still accepted and an operator is told, so an idle check is never read as a passing one. Blank checks nothing.

| Fact | Value |
| --- | --- |
| Key | `hypha.space_id` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### DAO treasury address on Base

The 0x address holding your DAO's treasury on Base. The Hypha Bridge module reads what this address holds of each confirmed token and shows it as a fact about the village. Leave it blank and only total supply is shown. Reading it never moves anything: the platform displays what Base says and links you out to Hypha to act.

| Fact | Value |
| --- | --- |
| Key | `hypha.treasury_address` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Founder Base account address

The 0x address that created your DAO and issued its first tokens on Base. The Hypha Bridge panel reads it to list every token this account holds, so you can confirm which contract is which: issue yourself even a tiny amount of each token on Hypha first, because an issuance is what puts the contract on chain.

| Fact | Value |
| --- | --- |
| Key | `hypha.founder_base_address` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Override: governance link

Only if your DHO's governance page is not at the org root. Blank derives from the DHO address.

| Fact | Value |
| --- | --- |
| Key | `hypha.link_governance` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Override: proposals link

Only if your DHO's proposals page is not at /agreements. Blank derives from the DHO address.

| Fact | Value |
| --- | --- |
| Key | `hypha.link_proposals` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Override: treasury link

Only if your DHO's treasury page is not at /treasury. Blank derives from the DHO address.

| Fact | Value |
| --- | --- |
| Key | `hypha.link_treasury` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Override: members link

Only if your DHO's members page is not at /members. Blank derives from the DHO address.

| Fact | Value |
| --- | --- |
| Key | `hypha.link_members` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Tools

2 dials. 2 for the whole village.

### Count tool opens

When on, opening a tool records an anonymous-friendly click row (member id attached only for signed-in members) so admins can see which tools the village actually uses. Turning it off records nothing, a village-level privacy choice.

| Fact | Value |
| --- | --- |
| Key | `tools.click_tracking` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Days between automatic link checks

0 means manual-only: admins run 'Check links now' from the Tools tab. A cadence takes effect once the platform scheduler ships (v3 S16); setting it earlier is harmless and remembered.

| Fact | Value |
| --- | --- |
| Key | `tools.link_check_days` |
| Type | integer, a whole number |
| Default | `0` |
| Range | 0 to 90 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Accounts & sessions

2 dials. 2 for the founder or an admin.

### Signed-in session length

How long a sign-in lasts before the member has to sign in again. Applies to sessions started AFTER a change: existing sessions keep the length they were minted with. Shorter is safer on shared devices; longer is kinder on personal phones.

| Fact | Value |
| --- | --- |
| Key | `auth.session_days` |
| Type | integer, a whole number |
| Default | `30` |
| Range | 1 to 365 |
| Counted in | days |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Most emails one member receives per day

Over this many notification emails in a rolling 24 hours, further ones stay in-app only (the notification itself is never lost; only the email is skipped). A ceiling on noisy days, not a quota: raise it for a large, busy village.

| Fact | Value |
| --- | --- |
| Key | `notify.daily_email_cap` |
| Type | integer, a whole number |
| Default | `20` |
| Range | 1 to 200 |
| Counted in | per day |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Abuse guards

5 dials. 5 for the founder or an admin.

### Registrations per IP per hour

How many account registrations one IP address may attempt per hour. Also bounds how fast an outsider can probe which email addresses belong to members. An onboarding gathering behind one shared connection counts as one IP, so keep this comfortably above the size of a signup circle.

| Fact | Value |
| --- | --- |
| Key | `abuse.register_per_ip_hourly` |
| Type | integer, a whole number |
| Default | `30` |
| Range | 1 to 1000 |
| Counted in | per hour |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Failed logins per IP per 15 minutes

How many FAILED sign-in attempts one IP address may make per 15 minutes. Successful sign-ins never count. The per-account limit below is the real brute-force bound; this one only caps bulk abuse from a single address, so it can stay loose.

| Fact | Value |
| --- | --- |
| Key | `abuse.login_ip_per_quarter_hour` |
| Type | integer, a whole number |
| Default | `30` |
| Range | 1 to 1000 |
| Counted in | per 15 min |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Failed logins per account per 15 minutes

How many FAILED sign-in attempts any one account may receive per 15 minutes, from all addresses combined: the bound an attacker with many IPs cannot dodge. Successful sign-ins never count. Anyone who knows an address can briefly lock that account out by failing on purpose, so do not set this too low.

| Fact | Value |
| --- | --- |
| Key | `abuse.login_account_per_quarter_hour` |
| Type | integer, a whole number |
| Default | `10` |
| Range | 1 to 100 |
| Counted in | per 15 min |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Password-reset requests per IP per hour

How many 'forgot password' requests one IP address may make per hour. Each one can send an email, so this bounds using the village as a mail cannon. A separate per-address limit always applies as well, so one member cannot be mail-bombed from many addresses.

| Fact | Value |
| --- | --- |
| Key | `abuse.password_reset_per_ip_hourly` |
| Type | integer, a whole number |
| Default | `10` |
| Range | 1 to 200 |
| Counted in | per hour |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Investor-packet requests per IP per hour

How many investor document requests one IP address may make per hour. Each request stores a lead and emails the packet to the address given, so unthrottled it doubles as a spam cannon. Several genuine investors behind one corporate network share a bucket, so keep this above 1.

| Fact | Value |
| --- | --- |
| Key | `abuse.investor_docs_per_ip_hourly` |
| Type | integer, a whole number |
| Default | `3` |
| Range | 1 to 100 |
| Counted in | per hour |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Data lifecycle

3 dials. 3 for the founder or an admin.

### Keep handled form submissions for

Form submissions carry personal details (names, emails, phone numbers). Once a submission has been handled (any status other than new), it is deleted this many days after it arrived. Unhandled submissions are never swept: an unread message is a commitment, not clutter. 0 keeps everything forever.

| Fact | Value |
| --- | --- |
| Key | `retention.submissions_days` |
| Type | integer, a whole number |
| Default | `365` |
| Range | 0 to 3650 |
| Counted in | days |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Keep read notifications for

Read notifications older than this are deleted by the daily sweep. Unread ones stay: they have not done their job yet. 0 keeps everything forever.

| Fact | Value |
| --- | --- |
| Key | `retention.notifications_days` |
| Type | integer, a whole number |
| Default | `90` |
| Range | 0 to 3650 |
| Counted in | days |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Leave an unreferenced upload alone for

The uploads volume holds files from five doors: proposal attachments, brand images, village fonts, investor documents and members' photographs. Admin > Uploaded Files lists the ones no row in the database points at, and this is how long a file is left alone before it can appear on that list. The window protects a picture you have just replaced: swapping an image mints a new address by design, so the old file goes unreferenced the moment the new one lands while every browser and every email already sent still points at it. Nothing is ever removed without somebody pressing the button.

| Fact | Value |
| --- | --- |
| Key | `uploads.orphan_grace_days` |
| Type | integer, a whole number |
| Default | `30` |
| Range | 1 to 3650 |
| Counted in | days |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Automation

1 dial. 1 for the founder or an admin.

### Draft call syntheses in the background at half price

Recordings that have a transcript and no synthesis are sent to the model in one batch instead of one call at a time. Every token in a batch costs half. Results usually arrive within an hour and can take up to a day, so this suits the recordings nobody is waiting on. The Synthesize button in Admin is unaffected: it still answers straight away at full price, because a person is watching it. Off keeps every synthesis something a person asks for.

| Fact | Value |
| --- | --- |
| Key | `assistant.synthesis_batch` |
| Type | boolean, on or off |
| Default | `false` |
| Range | on or off |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Village map

12 dials. 9 for the whole village, 3 for the founder or an admin.

### Show the map's structure to visitors

When the map module is public, anonymous visitors see circles, role titles and seat counts, never names or faces. Off hides the map from visitors entirely, even at public lifecycle.

| Fact | Value |
| --- | --- |
| Key | `map.public_structure` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Show the coordination concierge

The 'what do you want to do?' bar that routes a member to the right circle, role or quest. Deterministic matching always runs first; the assistant is only consulted for ambiguous asks, and only when an API key is configured.

| Fact | Value |
| --- | --- |
| Key | `map.concierge_enabled` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Contact requests a member may send per day

The relay's outbound brake. 0 disables the contact relay entirely.

| Fact | Value |
| --- | --- |
| Key | `map.contact_daily_cap` |
| Type | integer, a whole number |
| Default | `5` |
| Range | 0 to 50 |
| Counted in | messages |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Contact requests one person receives per day

Protects busy role holders. Once someone's day is full, would-be senders are pointed at the circle's open quests instead.

| Fact | Value |
| --- | --- |
| Key | `map.contact_recipient_daily_cap` |
| Type | integer, a whole number |
| Default | `3` |
| Range | 1 to 20 |
| Counted in | messages |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Show open quests on the map

Open quests orbit their circle as small satellites, capped for legibility.

| Fact | Value |
| --- | --- |
| Key | `map.show_quests` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Highlight vacant seats

Vacant roles pulse gently as an open call. Off renders them as plain grey rings.

| Fact | Value |
| --- | --- |
| Key | `map.vacant_highlight` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Keep contact message bodies for

Relay message bodies are personal correspondence: the daily sweep clears bodies older than this while keeping the contact event itself (who reached whom, when). 0 keeps bodies forever.

| Fact | Value |
| --- | --- |
| Key | `map.contact_retention_days` |
| Type | integer, a whole number |
| Default | `180` |
| Range | 0 to 3650 |
| Counted in | days |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Largest photograph a member may upload

Measured on the file that arrives. The browser shrinks a picture to WebP before it is sent, so a phone photo usually lands far under this; the ceiling is what stops an untouched original from spending the whole volume. At 1 the pipeline still accepts a prepared phone photo. At 25 one picture can cost 25 MB of the uploads volume, and /health reports what the photographs are using.

| Fact | Value |
| --- | --- |
| Key | `map.photo_max_mb` |
| Type | integer, a whole number |
| Default | `8` |
| Range | 1 to 25 |
| Counted in | MB |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Photographs one place may hold

Counts the pictures currently on a place, so a takedown frees a slot. 0 means no place accepts a photograph and the upload control is gone from every gallery. At 500 one place can hold five hundred pictures and its gallery pages through them.

| Fact | Value |
| --- | --- |
| Key | `map.photos_per_place` |
| Type | integer, a whole number |
| Default | `60` |
| Range | 0 to 500 |
| Counted in | photos |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Photographs one member may add per day

Counted across every place over the last 24 hours. 0 closes contribution for everyone, whatever their stage or role. At 200 one member can add two hundred pictures in a day.

| Fact | Value |
| --- | --- |
| Key | `map.photos_per_member_daily` |
| Type | integer, a whole number |
| Default | `12` |
| Range | 0 to 200 |
| Counted in | photos |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Reports that hide a photograph on their own

Distinct members flagging one picture. Once this many have, it leaves the gallery and waits for a curator, who can put it back. 0 means the village's reports never hide anything by themselves and a curator acts on every one. A person asking for a photograph OF THEMSELVES to come down is a different act and never waits for this number: one is always enough.

| Fact | Value |
| --- | --- |
| Key | `map.photo_report_hide_threshold` |
| Type | integer, a whole number |
| Default | `3` |
| Range | 0 to 50 |
| Counted in | reports |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Keep the record of a removed photograph for

A photograph taken down loses its file immediately. What stays is the record of the takedown, so a curator can still see what they decided and which report it answered. The daily sweep forgets that record after this many days. 0 keeps it forever.

| Fact | Value |
| --- | --- |
| Key | `map.photo_tombstone_days` |
| Type | integer, a whole number |
| Default | `180` |
| Range | 0 to 3650 |
| Counted in | days |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## The village's people

1 dial. 1 for the founder or an admin.

### Show who holds each seat to visitors

On, anyone can read the first names of the people holding each seat on the Team, Roles and Circles pages. Off keeps those names for signed-in members whose role or badge grants map.viewPeople, and a visitor still sees every circle, every seat, and how many of them are filled. This is the secret society setting. It moves names only: the shape of the village stays public at both settings.

| Fact | Value |
| --- | --- |
| Key | `org.public_people` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Events

3 dials. 3 for the whole village.

### Let members RSVP

Members can say they are coming, and a gathering with a capacity counts them against it. Off leaves the calendar readable and takes no answers, which suits a village that handles attendance elsewhere.

| Fact | Value |
| --- | --- |
| Key | `events.rsvp_enabled` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Show gatherings this far ahead

How far into the future the calendar looks. Anything starting beyond this is stored and stays hidden until it comes into range.

| Fact | Value |
| --- | --- |
| Key | `events.upcoming_days` |
| Type | integer, a whole number |
| Default | `90` |
| Range | 1 to 730 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Keep finished gatherings listed for

A gathering that has ended stays on the calendar this long. Dropping one the moment it starts tells somebody standing at the door that nothing is happening.

| Fact | Value |
| --- | --- |
| Key | `events.past_visible_days` |
| Type | integer, a whole number |
| Default | `30` |
| Range | 0 to 365 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Forum

1 dial. 1 for the whole village.

### Soft reports that auto-hide a post

When this many DIFFERENT members soft-report the same thread or reply, it hides automatically pending moderation, so the community can act before a moderator wakes up. Hard reports always go straight to the queue without hiding.

| Fact | Value |
| --- | --- |
| Key | `forum.report_hide_threshold` |
| Type | integer, a whole number |
| Default | `3` |
| Range | 2 to 10 |
| Counted in | reports |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Messages

2 dials. 2 for the whole village.

### Messages one member may send per minute

The send limit, counted per member across every conversation they are in. High enough that a fast typer in a live conversation never feels it, low enough that a stolen token cannot spray the village. Members who hit it are told to slow down and can send again the next minute.

| Fact | Value |
| --- | --- |
| Key | `messaging.sends_per_minute` |
| Type | integer, a whole number |
| Default | `20` |
| Range | 1 to 120 |
| Counted in | messages |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Largest group conversation

How many people one group thread may hold, the creator included. Every message notifies everyone in the thread who has not muted it, so this number is also the size of the loudest single send anyone can make.

| Fact | Value |
| --- | --- |
| Key | `messaging.max_members` |
| Type | integer, a whole number |
| Default | `50` |
| Range | 2 to 500 |
| Counted in | people |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Feed

3 dials. 3 for the whole village.

### Which forum category the feed shows

The feed is a LENS over one forum category plus the village's system events. It is not a second content store. Point it at the category where everyday village life gets posted.

| Fact | Value |
| --- | --- |
| Key | `feed.category_slug` |
| Type | text, free text |
| Default | `village-life` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Weave the village's own milestones into the feed

On, the feed mixes what the village DID (quests consented, seasons turning, people arriving) in among what people wrote. Off, it is only posts. A young village usually wants this on, because a feed with three posts and no events reads as abandoned.

| Fact | Value |
| --- | --- |
| Key | `feed.show_system_events` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### How much of a long post the feed shows

Posts longer than this are cut off in the feed with the rest behind the post itself. Nothing is deleted; this only decides how much of a long piece takes over the page.

| Fact | Value |
| --- | --- |
| Key | `feed.max_post_length` |
| Type | integer, a whole number |
| Default | `600` |
| Range | 120 to 4000 |
| Counted in | characters |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Stays

10 dials. 10 for the whole village.

### Guests can request stays

When off, only members can request a stay; visitors see the catalog but must join (or write in) first.

| Fact | Value |
| --- | --- |
| Key | `stay.guest_booking_enabled` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### New stays autopay by default

Whether a newly activated stay burns one credit per night automatically. A guest can have autopay turned off per-stay by an admin (e.g. billing disputes).

| Fact | Value |
| --- | --- |
| Key | `stay.autopay_default` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Hour nightly credits post (UTC)

The scheduler posts each active stay's nightly credit once per day at (or after) this hour, UTC. Catch-up is automatic and idempotent if the server slept through a night.

| Fact | Value |
| --- | --- |
| Key | `stay.autopay_post_hour` |
| Type | integer, a whole number |
| Default | `10` |
| Range | 0 to 23 |
| Counted in | h UTC |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Low-balance warning threshold

Notify a guest when their remaining credits cover this many nights or fewer at their current rate.

| Fact | Value |
| --- | --- |
| Key | `stay.low_balance_warn_nights` |
| Type | integer, a whole number |
| Default | `2` |
| Range | 0 to 30 |
| Counted in | nights |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Grace nights below zero

How many nights a stay may keep posting after the balance hits zero before autopay refuses and admins are alerted. The debt is real and visible: a negative balance, not a hidden tab.

| Fact | Value |
| --- | --- |
| Key | `stay.grace_nights` |
| Type | integer, a whole number |
| Default | `2` |
| Range | 0 to 14 |
| Counted in | nights |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Most nights purchasable at once

Ceiling on a single credit purchase, counted in nights at the room's posted rate.

| Fact | Value |
| --- | --- |
| Key | `stay.max_purchase_nights` |
| Type | integer, a whole number |
| Default | `60` |
| Range | 1 to 365 |
| Counted in | nights |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Credit expiry (0 = never)

Days until unspent stay credits expire. 0 means they never expire. Expiry is a policy contract shipped ahead of enforcement: v1 does not yet sweep expired credits.

| Fact | Value |
| --- | --- |
| Key | `stay.credit_expiry_days` |
| Type | integer, a whole number |
| Default | `0` |
| Range | 0 to 3650 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Members can gift credits to each other

Off by default: credits are personal. Turning this on lets a member transfer credits to another member (a future surface; the token stays non-transferable until then).

| Fact | Value |
| --- | --- |
| Key | `stay.credits_transferable` |
| Type | boolean, on or off |
| Default | `false` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Work-exchange quest tag

Quests carrying this tag appear on the Stay page as ways to EARN credits. The reward itself lives on each quest (stay-credit reward field).

| Fact | Value |
| --- | --- |
| Key | `stay.work_exchange_tag` |
| Type | text, free text |
| Default | `work-exchange` |
| Range | no bounds are set |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Stay requests per member per day

How many stay requests one member may open in 24 hours. A cap on requests, not on stays: stewards still decide every activation.

| Fact | Value |
| --- | --- |
| Key | `stay.request_daily_cap` |
| Type | integer, a whole number |
| Default | `5` |
| Range | 1 to 100 |
| Counted in | per day |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Exchange

5 dials. 5 for the whole village.

### Largest single price change

How far one posted price may move from the previous one, in percent. Big moves happen in bounded steps, each with its own note, so the price history stays a story, not a cliff. 0 removes the bound.

| Fact | Value |
| --- | --- |
| Key | `exchange.price_change_max_pct` |
| Type | integer, a whole number |
| Default | `20` |
| Range | 0 to 1000 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### The village's share of each swap

In basis points, so half a percent is expressible (50 = 0.50%). This is a POLICY dial, not the safety mechanism: a swap can never profit the member even at 0, because the amount they hand over always rounds up. At 0 the confirm card reads 'the village keeps nothing on this swap'.

| Fact | Value |
| --- | --- |
| Key | `exchange.swap_spread_bps` |
| Type | integer, a whole number |
| Default | `0` |
| Range | 0 to 2000 |
| Counted in | bps |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Abandoned card checkouts are released after

A card purchase reserves an order the moment checkout opens, before the member has paid. If they close the tab, that order stays pending forever, and a pending order blocks BOTH turning the exchange off and letting that member leave the village. This is how long to wait before releasing one. Keep it comfortably above 24 hours: a Stripe checkout session stays payable that long, and releasing an order someone is still paying for would strand their money. 0 disables the release.

| Fact | Value |
| --- | --- |
| Key | `exchange.order_expiry_hours` |
| Type | integer, a whole number |
| Default | `48` |
| Range | 0 to 720 |
| Counted in | hours |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Card-bought tokens settle before they can be swapped

Tokens bought with a card are frozen from swapping for this many days, long enough that a chargeback still finds them in the wallet instead of already converted. 0 disables the hold.

| Fact | Value |
| --- | --- |
| Key | `exchange.swap_fiat_hold_days` |
| Type | integer, a whole number |
| Default | `45` |
| Range | 0 to 180 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Most a member can receive in one swap

A ceiling on any single swap, whatever the caps allow across the cycle.

| Fact | Value |
| --- | --- |
| Key | `exchange.swap_max_receive_per_order` |
| Type | integer, a whole number |
| Default | `500` |
| Range | 1 to 1000000 |
| Counted in | tokens |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Library

9 dials. 9 for the whole village.

### Intake award, % of appraisal

What a donor earns, as a share of the item's appraised replacement value. Never above 100: the mint's front door pays at most what the shelf gained.

| Fact | Value |
| --- | --- |
| Key | `library.intake_award_pct` |
| Type | integer, a whole number |
| Default | `75` |
| Range | 0 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Intake credits per member per cycle

The most one member can earn from donations in one lunation. Intake is a mint; this is its per-person throttle. 0 disables the cap.

| Fact | Value |
| --- | --- |
| Key | `library.intake_member_cycle_cap` |
| Type | integer, a whole number |
| Default | `500` |
| Range | 0 to 100000 |
| Counted in | credits |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Dual sign-off above (appraisal)

An item appraised above this needs a SECOND steward's approval before any credits mint. 0 turns the second signature off.

| Fact | Value |
| --- | --- |
| Key | `library.intake_dual_signoff_over` |
| Type | integer, a whole number |
| Default | `200` |
| Range | 0 to 100000 |
| Counted in | credits |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Borrowing escrow, % of value

The deposit locked while an item is out, as a share of its appraised value. Returned at settle, minus wear and damage.

| Fact | Value |
| --- | --- |
| Key | `library.escrow_pct` |
| Type | integer, a whole number |
| Default | `25` |
| Range | 0 to 200 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Usage fee per loan, % of value

The default wear fee a normal return pays into the library pool, and what a dispute resolves to after its deadline (computed wear, zero damage).

| Fact | Value |
| --- | --- |
| Key | `library.usage_fee_pct` |
| Type | integer, a whole number |
| Default | `5` |
| Range | 0 to 100 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Loan length

Days from pickup to due date.

| Fact | Value |
| --- | --- |
| Key | `library.loan_days_default` |
| Type | integer, a whole number |
| Default | `14` |
| Range | 1 to 365 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Dispute deadline

How long a disputed return may sit before stewards settle it with the default outcome (computed wear, zero damage). A policy contract surfaced in the admin panel; v1 does not auto-settle.

| Fact | Value |
| --- | --- |
| Key | `library.dispute_deadline_days` |
| Type | integer, a whole number |
| Default | `14` |
| Range | 1 to 90 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Intake stall alarm

An item awaiting its second sign-off longer than this many days appears in the stewards' daily digest: the donor already handed it over and is owed credits.

| Fact | Value |
| --- | --- |
| Key | `library.intake_stall_days` |
| Type | integer, a whole number |
| Default | `7` |
| Range | 1 to 60 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Library reservations per member per day

How many items one member may reserve in 24 hours. Bounds how fast one person can lock shelf items and escrow credits.

| Fact | Value |
| --- | --- |
| Key | `library.reserve_daily_cap` |
| Type | integer, a whole number |
| Default | `10` |
| Range | 1 to 100 |
| Counted in | per day |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Payments

4 dials. 4 for the whole village.

### Largest single purchase (USD)

Per-order ceiling across ALL fiat modules: stays, exchange, and anything after them. 0 disables the check.

| Fact | Value |
| --- | --- |
| Key | `payments.purchase_limit_per_order_usd` |
| Type | integer, a whole number |
| Default | `1000` |
| Range | 0 to 100000 |
| Counted in | USD |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### 30-day purchase limit per member (USD)

Rolling 30-day ceiling on one member's total fiat purchases, summed across every module. 0 disables the check.

| Fact | Value |
| --- | --- |
| Key | `payments.purchase_limit_30d_usd` |
| Type | integer, a whole number |
| Default | `3000` |
| Range | 0 to 1000000 |
| Counted in | USD |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Annual purchase limit per member (USD)

Rolling 365-day ceiling on one member's total fiat purchases, summed across every module. 0 disables the check.

| Fact | Value |
| --- | --- |
| Key | `payments.purchase_limit_annual_usd` |
| Type | integer, a whole number |
| Default | `10000` |
| Range | 0 to 10000000 |
| Counted in | USD |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Largest checkout donation

The ceiling on a single choose-your-amount donation checkout. Anything above it gets a personal conversation instead of a card form.

| Fact | Value |
| --- | --- |
| Key | `payments.donation_max_usd` |
| Type | integer, a whole number |
| Default | `50000` |
| Range | 1 to 1000000 |
| Counted in | USD |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Village

2 dials. 1 for the whole village, 1 for the founder or an admin.

### Village Pulse length

How many recent happenings the public activity feed shows. Nothing is deleted; this is how far back the page reaches, not how much the village keeps.

| Fact | Value |
| --- | --- |
| Key | `village.pulse_max_entries` |
| Type | integer, a whole number |
| Default | `30` |
| Range | 10 to 200 |
| Counted in | entries |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### The date this village counts Moon 1 from

Leave blank and Moon 1 is the moon your village launched under, which is what almost every village wants. Set a date here to count from a different moon: the moon containing the date you give becomes Moon 1, and every moon after it counts on from there. A date in the future is allowed, and until it arrives your moons are shown with their dates and no number. Moon numbers are a label the platform works out each time it draws a screen, so moving this date renames what people see and changes nothing that has been recorded, settled or paid.

| Fact | Value |
| --- | --- |
| Key | `village.first_moon_at` |
| Type | text, free text |
| Default | blank |
| Range | no bounds are set |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Health

1 dial. 1 for the whole village.

### Alert when a metric moves this much

After a lunation closes, any tracked metric that moved more than this against the previous lunation is flagged to the stewards, in either direction, without judging which is good. 0 turns alerts off.

| Fact | Value |
| --- | --- |
| Key | `health.alert_change_pct` |
| Type | integer, a whole number |
| Default | `40` |
| Range | 0 to 500 |
| Counted in | % |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Badges

1 dial. 1 for the whole village.

### Featured badges per member

How many badges a member may pin to their byline (forum posts, map chips). 0 turns featured chips off everywhere.

| Fact | Value |
| --- | --- |
| Key | `badges.max_featured` |
| Type | integer, a whole number |
| Default | `3` |
| Range | 0 to 10 |
| Counted in | badges |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Platform

1 dial. 1 for the founder or an admin.

### Share bug reports and ideas with the platform team

A copy of each bug report and idea submitted here reaches the platform team who maintain this software, so fixes and features can ship to every village. Content only, never who said it. Turn it off to keep feedback entirely local. Your admins see all of it in Admin → Feedback either way, and the submission form discloses which is happening. Sharing also needs a hub address in the FEEDBACK_HUB_URL setting on the server. Without one this dial changes nothing, feedback stays local, and the form says so.

| Fact | Value |
| --- | --- |
| Key | `platform.feedback_relay` |
| Type | boolean, on or off |
| Default | `true` |
| Range | on or off |
| Who may change it | the founder or an admin |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Calendar

3 dials. 3 for the whole village.

### The solar event that opens the village year

The year's first moon begins at the first new moon after this event. Twelve or thirteen moons follow, as the sky gives them, until the first new moon after the next one. Villages in the south often choose the June solstice.

| Fact | Value |
| --- | --- |
| Key | `calendar.year_anchor` |
| Type | choice, one of a fixed list |
| Default | `december_solstice` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `december_solstice` December solstice.
- `march_equinox` March equinox.
- `june_solstice` June solstice.
- `september_equinox` September equinox.

### Hemisphere

Which way the seasons turn. Sets which solstice is the longest day and which the shortest, and rotates the example moon names by six months for a village south of the equator.

| Fact | Value |
| --- | --- |
| Key | `calendar.hemisphere` |
| Type | choice, one of a fixed list |
| Default | `north` |
| Range | one of the choices below |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

What it may be set to:

- `north` Northern.
- `south` Southern.

### Mark the cross-quarter days

Also put the four midpoints between the solstices and equinoxes on the calendar. Off by default; the quarter days themselves are always shown.

| Fact | Value |
| --- | --- |
| Key | `calendar.cross_quarters` |
| Type | boolean, on or off |
| Default | `false` |
| Range | on or off |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## Introductions

4 dials. 4 for the whole village.

### Introductions one person receives per day

Protects busy people, the map relay's per-recipient brake extended to introductions: the relay's received count and the day's surfaced introductions share one day. A match over the cap is held for the sweep, never dropped.

| Fact | Value |
| --- | --- |
| Key | `introductions.recipient_daily_cap` |
| Type | integer, a whole number |
| Default | `3` |
| Range | 1 to 20 |
| Counted in | introductions |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Match score floor

Nothing scoring under this is ever shown. Few good introductions beat many okay ones; raise it when matches feel thin, lower it for a small village where any bridge helps.

| Fact | Value |
| --- | --- |
| Key | `introductions.match_floor` |
| Type | integer, a whole number |
| Default | `3` |
| Range | 1 to 20 |
| Counted in | points |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Days an introduction stays open

How long both people have to say yes. One gentle reminder after three days; past the window the proposal expires and both intents return to the pool.

| Fact | Value |
| --- | --- |
| Key | `introductions.opportunity_days` |
| Type | integer, a whole number |
| Default | `10` |
| Range | 3 to 60 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

### Keep match reasoning for

The sweep blanks an introduction's reasoning sentences, and the words of expired intents, once they are older than this. The record that an introduction happened stays. 0 keeps everything forever.

| Fact | Value |
| --- | --- |
| Key | `introductions.retention_days` |
| Type | integer, a whole number |
| Default | `90` |
| Range | 0 to 3650 |
| Counted in | days |
| Who may change it | the whole village |
| A change takes effect | as soon as it is saved |
| What it costs to change | a routine vote |

## What this file is made from

The generator reads these and fails loudly if any of them moves:

- `shared/ballotSubjects.ts`
- `shared/capabilities.ts`
- `shared/gameConfig.ts`
- `shared/gameVariables.ts`
- `shared/governanceEngine.ts`
- `shared/villageMoon.ts`

The registry is transpiled and IMPORTED to read it, which is what makes the generated dials visible. The multiplier, quest-threshold and unlock dials under Progression are built at module load from the village's own stage ladder, so a reader of the array literal alone would print a document that looked complete and was missing a fifth of the registry.

The generator refuses to guess. A dial with no description, a choice with no choices, a type or a ring the document has no words for, a new field on `VariableDef`, a default the registry's own validator rejects, or a new import into the registry: each one stops the build and names itself. A shorter document that still renders is the failure this whole mechanism exists to prevent.
