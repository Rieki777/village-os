# Modules

Everything a village can run: 23 modules, what each one is, what it needs, what it adds to the one capability gate, which dials it owns, and where its routes live.

This is the registry, read out loud. It describes the platform a fork inherits, and it says nothing about any one village: which modules are actually on is a village's own decision, held in its `module_settings` table.

## How to read this file

This file is generated. `scripts/generate-modules-doc.mjs` reads `shared/modules.ts` and the files listed at the end, works out the facts, and writes the whole document. `scripts/check-modules-doc.mjs` regenerates it and fails the build when the committed text and the code have come apart.

Editing this file by hand does not hold. Change the code, then run:

```bash
node scripts/generate-modules-doc.mjs
```

Every number, every list and every name below is read from the code. If one of them is wrong, the code is what is wrong. The only sentences a person wrote are the framing ones, and they are kept inside the generator so this whole file stays generated.

There is no timestamp and no author line, on purpose. Both would change on every run and turn an honest diff into noise. The git history is the record of when this changed.

## What a module can be

### Lifecycle

A village holds one of four postures per module, ranked off < preview < members < public. An absent `module_settings` row means `off`, so a fork inherits every new platform module switched off and turning one on is always a deliberate admin act.

| Stage | Rank | What it means |
| --- | --- | --- |
| `off` | 0 | routes 404, zero nav, zero admin tabs, variables hidden |
| `preview` | 1 | admins only, non-admins get the IDENTICAL 404 body, so the catalog of what a village is trying out never leaks |
| `members` | 2 | signed-in only (anon gets 401, so the client can prompt login) |
| `public` | 3 | everyone; per-route capability checks still apply on top |

The four core modules sit outside that. They are always public and the lifecycle route refuses to move them, which is why they are listed first below.

### Tier, which says who bills and who supports

| Tier | What it means |
| --- | --- |
| `included` | the platform bills (it is in the platform price) and supports it end to end. Credential is none, or the village's own upstream account where the village is the merchant of record. No pill in the catalog: included is the absence of a badge, the same way everything that is not core is silent today. |
| `connected` | the vendor bills the village directly and answers for the service; the platform answers for the connector. The credential is a secrets-store entry the village holds and can see as source and last4. That visibility IS the tier: the village has its own account and can revoke it unaided. |
| `managed` | the platform bills and takes the first call; the vendor sits behind a private escalation the village never sees. The credential is platform-held, env-only, and never returned to a village even masked, because it is not the village's to see. This is the PLATFORM_ASSISTANT_KEY posture generalised, and it is settled policy under hub ADR-49. |

Today the registry holds 23 at `included`. The tier is a label and never a gate: enabling a module makes no network call, reads no secret and checks no licence. Listings are accepted under contract version 1.2.

### The data a module holds

Read as the widest thing in the module's own tables: `none`, `village-content`, `member-pii`. A booking, an RSVP, a loan and a private message all identify a named person, which is why most of this platform carries `member-pii`. The gate hanging off it applies at every tier: nothing marked `member-pii` goes live behind a vendor driver without a signed processing agreement, a documented hard-delete endpoint, and a `forgetMember` driver wired into the deletion sweep that fails visibly when it cannot confirm.

| Data class | Modules |
| --- | --- |
| `none` | none |
| `village-content` | five: `resources`, `health`, `network`, `crowdpool`, `hypha` |
| `member-pii` | eighteen: `quests`, `gratitude`, `progression`, `profiles`, `map`, `forum`, `feed`, `messaging`, `stays`, `automation`, `library`, `badges`, `exchange`, `commerce`, `tools`, `events`, `introductions`, `governance` |

### What standing one up looks like

| Setup | What it means | Modules |
| --- | --- | --- |
| `none` | works the moment it is on. The Go-live card offers itself right after Turn on. | `quests`, `gratitude`, `progression`, `profiles`, `forum`, `feed`, `messaging`, `network`, `events`, `introductions`, `governance` |
| `optional` | better with content, honest without it. | `map`, `resources`, `automation`, `health`, `badges`, `crowdpool`, `tools` |
| `required` | needs real content before going live (a room and a price, a stocked treasury), and the Go-live card waits for readiness. | `stays`, `library`, `exchange`, `commerce`, `hypha` |

### The shelves

| Shelf | Id | What is on it | Modules |
| --- | --- | --- | --- |
| Coordinate | `coordinate` | Plan the work and the days: quests, the calendar, calls, tools. | 4 |
| Recognise | `recognise` | See people: gratitude, the path from guest to co-creator, badges. | 3 |
| Host and earn | `host-and-earn` | Value moving with care: stays, the shelves, the exchange, payments. | 4 |
| Know and decide | `know-and-decide` | How the village understands itself: conversations, decisions, power, health. | 6 |
| Connect | `connect` | People finding people: profiles, messages, the feed, other villages. | 6 |

## The whole library at a glance

| Module | Id | Shelf | Core | Tier | Data | Setup | Contract doc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Quests | `quests` | Coordinate | yes | included | member-pii | none | [quests.md](modules/quests.md) |
| Gratitude | `gratitude` | Recognise | yes | included | member-pii | none | [gratitude.md](modules/gratitude.md) |
| Stages & Roles | `progression` | Recognise | yes | included | member-pii | none | [progression.md](modules/progression.md) |
| Profiles | `profiles` | Connect | yes | included | member-pii | none | [profiles.md](modules/profiles.md) |
| How Power Is Held | `map` | Know and decide | no | included | member-pii | optional | [village-map.md](modules/village-map.md) |
| How Resources Flow | `resources` | Know and decide | no | included | village-content | optional | [how-resources-flow.md](modules/how-resources-flow.md) |
| Forum & Decisions | `forum` | Know and decide | no | included | member-pii | none | none yet |
| Village Feed | `feed` | Connect | no | included | member-pii | none | [gratitude-feed.md](modules/gratitude-feed.md) |
| Messages | `messaging` | Connect | no | included | member-pii | none | [messaging.md](modules/messaging.md) |
| Stays | `stays` | Host and earn | no | included | member-pii | required | [stays.md](modules/stays.md) |
| Call Automation | `automation` | Coordinate | no | included | member-pii | optional | none yet |
| Village Health | `health` | Know and decide | no | included | village-content | optional | [health-dashboard.md](modules/health-dashboard.md) |
| Material Library | `library` | Host and earn | no | included | member-pii | required | [material-library.md](modules/material-library.md) |
| Badges & Skills | `badges` | Recognise | no | included | member-pii | optional | [badges.md](modules/badges.md) |
| Exchange | `exchange` | Host and earn | no | included | member-pii | required | [internal-exchange.md](modules/internal-exchange.md) |
| Payments & Donations | `commerce` | Host and earn | no | included | member-pii | required | none yet |
| Village Network | `network` | Connect | no | included | village-content | none | none yet |
| Crowdpool | `crowdpool` | Connect | no | included | village-content | optional | [crowdpool.md](modules/crowdpool.md) |
| Tools Hub | `tools` | Coordinate | no | included | member-pii | optional | [tools-hub.md](modules/tools-hub.md) |
| Village Calendar | `events` | Coordinate | no | included | member-pii | none | [events.md](modules/events.md) |
| Introductions | `introductions` | Connect | no | included | member-pii | none | none yet |
| Governance | `governance` | Know and decide | no | included | member-pii | none | none yet |
| Hypha Bridge | `hypha` | Know and decide | no | included | village-content | required | [hypha.md](modules/hypha.md) |

That is 23 modules, four of them core. Seventeen carry a contract doc under `docs/modules/` and six do not yet; `node scripts/check-module-docs.mjs` holds that second number to a ratchet that only ever falls. Filenames there do not follow module ids, so the mapping is real data and lives in `MODULE_DOCS` in `server/lib/knowledge.ts`, which is where this table reads it.

## The four core modules

A village cannot switch these off. They are always public, they ship with the platform, and the game the platform is born playing is made of them. Everything after this section is a choice.

### Quests

The contribution board: post work, claim it, submit it, consent to release recognition.

| Fact | Value |
| --- | --- |
| Id | `quests` |
| Shelf | Coordinate (`coordinate`) |
| A village can switch it off | no. It is core, so it is always public and the lifecycle route refuses to move it |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `none`, works the moment it is on. The Go-live card offers itself right after Turn on. |
| Requires | nothing |
| Recommends | nothing |
| Capabilities it adds | `quest.consent` |
| Variable keys it owns | `quest.consent_cap_mode`, `quest.consent_cap_multiplier`, `quest.require_submission_before_consent` |
| API prefixes | `/api/quests`, `/api/game/quests` |
| Contract doc | [quests.md](modules/quests.md) |

### Gratitude

Recognition sends, lunar cycles, and the value pool distributed at each close.

| Fact | Value |
| --- | --- |
| Id | `gratitude` |
| Shelf | Recognise (`recognise`) |
| A village can switch it off | no. It is core, so it is always public and the lifecycle route refuses to move it |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `none`, works the moment it is on. The Go-live card offers itself right after Turn on. |
| Requires | nothing |
| Recommends | nothing |
| Capabilities it adds | none |
| Variable keys it owns | `gratitude.base_budget`, `gratitude.require_message`, `gratitude.max_share_per_recipient`, `gratitude.pool_per_cycle`, `gratitude.pool_token` |
| API prefixes | `/api/game/gratitude`, `/api/game/cycle`, `/api/admin/cycles` |
| Contract doc | [gratitude.md](modules/gratitude.md) |

### Stages & Roles

The path from guest to co-creator: stages, capabilities, and appointed roles.

| Fact | Value |
| --- | --- |
| Id | `progression` |
| Shelf | Recognise (`recognise`) |
| A village can switch it off | no. It is core, so it is always public and the lifecycle route refuses to move it |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `none`, works the moment it is on. The Go-live card offers itself right after Turn on. |
| Requires | nothing |
| Recommends | nothing |
| Capabilities it adds | `proposal.open`, `proposal.decide` |
| Variable keys it owns | none |
| API prefixes | `/api/game/progression`, `/api/roles` |
| Contract doc | [progression.md](modules/progression.md) |

### Profiles

Member identity: handles, journeys, balances, and each member's own ledger.

| Fact | Value |
| --- | --- |
| Id | `profiles` |
| Shelf | Connect (`connect`) |
| A village can switch it off | no. It is core, so it is always public and the lifecycle route refuses to move it |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `none`, works the moment it is on. The Go-live card offers itself right after Turn on. |
| Requires | nothing |
| Recommends | nothing |
| Capabilities it adds | none |
| Variable keys it owns | none |
| API prefixes | `/api/profile` |
| Contract doc | [profiles.md](modules/profiles.md) |

## Coordinate

Plan the work and the days: quests, the calendar, calls, tools.

`quests` also sits on this shelf and is described above with the core modules.

### Call Automation

The weekly call becomes assigned work, not content distribution: recordings in, transcripts kept, an AI synthesis whose every task suggestion carries a verbatim quote and timestamp (or is dropped), published to the forum by a human, with suggestions routed to the roles they name. Nothing publishes or applies itself.

| Fact | Value |
| --- | --- |
| Id | `automation` |
| Shelf | Coordinate (`coordinate`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `optional`, better with content, honest without it. |
| Requires | nothing |
| Recommends | `forum` |
| Capabilities it adds | none |
| Variable keys it owns | none |
| API prefixes | `/api/recordings` |
| Contract doc | none yet |
| Config it seeds | `youtubeChannelId`, `maxReadyQueue`, `forumCategory` |

### Tools Hub

An audience-aware registry of the village's tools: one place to find the chat, the documents, the governance space, with a pinned card that deep-links to your Hypha DHO.

| Fact | Value |
| --- | --- |
| Id | `tools` |
| Shelf | Coordinate (`coordinate`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `optional`, better with content, honest without it. |
| Requires | nothing |
| Recommends | nothing |
| Capabilities it adds | none |
| Variable keys it owns | `tools.click_tracking`, `tools.link_check_days` |
| API prefixes | `/api/tools` |
| Contract doc | [tools-hub.md](modules/tools-hub.md) |
| Config it seeds | `categories` |
| Hypha links | `governance`, `proposals`, `treasury`, `members` |

### Village Calendar

The village's calendar: gatherings with a time, a place, a capacity and an RSVP. Other surfaces read it, so the map can light the building something is happening in.

| Fact | Value |
| --- | --- |
| Id | `events` |
| Shelf | Coordinate (`coordinate`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `none`, works the moment it is on. The Go-live card offers itself right after Turn on. |
| Requires | nothing |
| Recommends | `map` |
| Capabilities it adds | `event.rsvp`, `event.manage` |
| Variable keys it owns | `events.rsvp_enabled`, `events.upcoming_days`, `events.past_visible_days`, `calendar.year_anchor`, `calendar.hemisphere`, `calendar.cross_quarters` |
| API prefixes | `/api/events`, `/api/admin/events` |
| Contract doc | [events.md](modules/events.md) |

## Recognise

See people: gratitude, the path from guest to co-creator, badges.

`gratitude`, `progression` also sit on this shelf and are described above with the core modules.

### Badges & Skills

Recognition of who people are and what they can do: self-declared skills, badges earned from settled contribution, granted honors, and warning badges that suspend specific capabilities until resolved. Earned badges never ride applause metrics into permissions.

| Fact | Value |
| --- | --- |
| Id | `badges` |
| Shelf | Recognise (`recognise`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `optional`, better with content, honest without it. |
| Requires | nothing |
| Recommends | `quests` |
| Capabilities it adds | none |
| Variable keys it owns | none |
| API prefixes | `/api/badges` |
| Contract doc | [badges.md](modules/badges.md) |

## Host and earn

Value moving with care: stays, the shelves, the exchange, payments.

### Stays

Accommodation on stay credits: rooms post credit (and optional USD) prices per audience, credits are bought or earned through work-exchange quests, and one credit hosts one night. Funds-bearing: read the legal card before enabling.

| Fact | Value |
| --- | --- |
| Id | `stays` |
| Shelf | Host and earn (`host-and-earn`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `required`, needs real content before going live (a room and a price, a stocked treasury), and the Go-live card waits for readiness. |
| Requires | nothing |
| Recommends | `quests` |
| Capabilities it adds | `stay.member_rate` |
| Variable keys it owns | `stay.guest_booking_enabled`, `stay.autopay_default`, `stay.autopay_post_hour`, `stay.low_balance_warn_nights`, `stay.grace_nights`, `stay.max_purchase_nights`, `stay.credit_expiry_days`, `stay.credits_transferable`, `stay.work_exchange_tag`, `payments.purchase_limit_per_order_usd`, `payments.purchase_limit_30d_usd`, `payments.purchase_limit_annual_usd` |
| API prefixes | `/api/stays` |
| Contract doc | [stays.md](modules/stays.md) |
| Legal caution card | yes. Enabling shows it first, and preconditions can refuse outright |
| Sells | `stay-credit`, and it is the only module allowed to sell that slug |

### Material Library

The village's shared tools and goods: donate an item and earn library credits (appraised, capped, dual-signed above a threshold), then borrow against an escrowed deposit. Credits are backed by the shelves; they never swap, and selling them for fiat is a separate caution-card opt-in (L9).

| Fact | Value |
| --- | --- |
| Id | `library` |
| Shelf | Host and earn (`host-and-earn`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `required`, needs real content before going live (a room and a price, a stocked treasury), and the Go-live card waits for readiness. |
| Requires | nothing |
| Recommends | nothing |
| Capabilities it adds | none |
| Variable keys it owns | `library.intake_award_pct`, `library.intake_member_cycle_cap`, `library.intake_dual_signoff_over`, `library.escrow_pct`, `library.usage_fee_pct`, `library.loan_days_default`, `library.dispute_deadline_days`, `library.intake_stall_days` |
| API prefixes | `/api/library` |
| Contract doc | [material-library.md](modules/material-library.md) |
| Config it seeds | `creditSaleEnabled` |

### Exchange

Buy the village's own platform tokens for fiat, out of a stocked treasury, buy-only in v1. Recognition and Hypha-governed tokens can never be listed; a token another module sells can't be listed twice. Funds-bearing: read the legal card before enabling.

| Fact | Value |
| --- | --- |
| Id | `exchange` |
| Shelf | Host and earn (`host-and-earn`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `required`, needs real content before going live (a room and a price, a stocked treasury), and the Go-live card waits for readiness. |
| Requires | nothing |
| Recommends | nothing |
| Capabilities it adds | `exchange.buy`, `exchange.swap`, `exchange.manage` |
| Variable keys it owns | `exchange.price_change_max_pct`, `exchange.swap_spread_bps`, `exchange.swap_fiat_hold_days`, `exchange.swap_max_receive_per_order`, `payments.purchase_limit_per_order_usd`, `payments.purchase_limit_30d_usd`, `payments.purchase_limit_annual_usd` |
| API prefixes | `/api/exchange` |
| Contract doc | [internal-exchange.md](modules/internal-exchange.md) |
| Config it seeds | `tradingEnabled` |
| Legal caution card | yes. Enabling shows it first, and preconditions can refuse outright |

### Payments & Donations

Every payment your project issues or receives, as products you define: application fees, donations, deposits and down payments, waitlist seats, recurring memberships, and token packs granted from treasury stock. Rides the same verified Stripe spine as stays and the exchange; Zeffy and manual payment paths for fee-free giving. Money flows IN only, always.

| Fact | Value |
| --- | --- |
| Id | `commerce` |
| Shelf | Host and earn (`host-and-earn`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `required`, needs real content before going live (a room and a price, a stocked treasury), and the Go-live card waits for readiness. |
| Requires | nothing |
| Recommends | nothing |
| Capabilities it adds | none |
| Variable keys it owns | none |
| API prefixes | `/api/products` |
| Contract doc | none yet |
| Legal caution card | yes. Enabling shows it first, and preconditions can refuse outright |

## Know and decide

How the village understands itself: conversations, decisions, power, health.

### How Power Is Held

The living org chart: circles, the roles that orbit them, who holds each seat, which seats are open calls, plus a concierge that routes 'I want to help with X' to the right person.

| Fact | Value |
| --- | --- |
| Id | `map` |
| Shelf | Know and decide (`know-and-decide`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `optional`, better with content, honest without it. |
| Requires | nothing |
| Recommends | nothing |
| Capabilities it adds | `map.viewPeople`, `map.contact`, `map.photograph`, `map.curatePhotos` |
| Variable keys it owns | `map.public_structure`, `map.concierge_enabled`, `map.contact_daily_cap`, `map.contact_recipient_daily_cap`, `map.show_quests`, `map.vacant_highlight`, `map.contact_retention_days`, `map.photo_max_mb`, `map.photos_per_place`, `map.photos_per_member_daily`, `map.photo_report_hide_threshold`, `map.photo_tombstone_days` |
| API prefixes | `/api/map`, `/api/circles`, `/api/places`, `/api/admin/places` |
| Contract doc | [village-map.md](modules/village-map.md) |
| Switching it off is blocked by | `resources`, which requires it while non-off |

### How Resources Flow

A declared map of how money and resources are governed: who may spend what, with whose approval, paid from where, and where the money comes from; it describes the flow and moves nothing.

| Fact | Value |
| --- | --- |
| Id | `resources` |
| Shelf | Know and decide (`know-and-decide`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `village-content` |
| Standing it up | `optional`, better with content, honest without it. |
| Requires | `map` |
| Recommends | `forum` |
| Capabilities it adds | none |
| Variable keys it owns | none |
| API prefixes | `/api/resources` |
| Contract doc | [how-resources-flow.md](modules/how-resources-flow.md) |
| Config it seeds | `requestCategory`, `measuredVisibleTo`, `labels` |

### Forum & Decisions

Village conversations: threads by circle-of-life category, @mentions, thread follows, community moderation, and the decision primitive, where proposals are opened and outcomes recorded.

| Fact | Value |
| --- | --- |
| Id | `forum` |
| Shelf | Know and decide (`know-and-decide`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `none`, works the moment it is on. The Go-live card offers itself right after Turn on. |
| Requires | nothing |
| Recommends | `map` |
| Capabilities it adds | `forum.post`, `forum.moderate` |
| Variable keys it owns | `forum.report_hide_threshold` |
| API prefixes | `/api/forum` |
| Contract doc | none yet |
| Switching it off is blocked by | `feed`, which requires it while non-off |
| Config it seeds | `categories` |

### Village Health

The village's vital signs: per-lunation snapshots frozen at each cycle close, the land's own regeneration ledger (trees, water, hectares: absolute counts, never leaderboards), and season goals. Snapshot COLLECTION runs from the day this ships; turn the dashboard on once a few lunations of history exist.

| Fact | Value |
| --- | --- |
| Id | `health` |
| Shelf | Know and decide (`know-and-decide`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `village-content` |
| Standing it up | `optional`, better with content, honest without it. |
| Requires | nothing |
| Recommends | `gratitude`, `quests` |
| Capabilities it adds | `health.record` |
| Variable keys it owns | `health.alert_change_pct` |
| API prefixes | `/api/health` |
| Contract doc | [health-dashboard.md](modules/health-dashboard.md) |

### Governance

The village decides on-site: staged proposals go to weighted ballots with frozen electorates, votes stay changeable until a human closes with a stated outcome, and passed mechanics changes apply through the one amendment ledger. Off keeps the shipped Hypha loop exactly as it is.

| Fact | Value |
| --- | --- |
| Id | `governance` |
| Shelf | Know and decide (`know-and-decide`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `none`, works the moment it is on. The Go-live card offers itself right after Turn on. |
| Requires | nothing |
| Recommends | `forum` |
| Capabilities it adds | `ballot.vote`, `member.vouch` |
| Variable keys it owns | `governance.weight_mode`, `governance.weight_token`, `governance.unity_pct`, `governance.quorum_pct`, `governance.vote_days`, `governance.consent_window_days`, `governance.default_method`, `membership.vouch_threshold` |
| API prefixes | `/api/governance`, `/api/admin/governance` |
| Contract doc | none yet |

### Hypha Bridge

Your DAO on Hypha, read from Base and shown here: the contracts this village actually holds, total supply and treasury balance as the chain reports them, and governance outcomes that find their way back to the proposal they came from. Read only, always. Needs a Base endpoint somebody pays for, and it says which of the two listener paths this village is on.

| Fact | Value |
| --- | --- |
| Id | `hypha` |
| Shelf | Know and decide (`know-and-decide`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `village-content` |
| Standing it up | `required`, needs real content before going live (a room and a price, a stocked treasury), and the Go-live card waits for readiness. |
| Requires | nothing |
| Recommends | `governance`, `tools` |
| Capabilities it adds | none |
| Variable keys it owns | `hypha.treasury_address` |
| API prefixes | `/api/hypha`, `/api/admin/hypha` |
| Contract doc | [hypha.md](modules/hypha.md) |
| Display only | yes. Deep links to Base, and never a mint path |
| Hypha links | `governance`, `proposals`, `treasury`, `members` |

## Connect

People finding people: profiles, messages, the feed, other villages.

`profiles` also sits on this shelf and is described above with the core modules.

### Village Feed

The everyday stream: microposts, events and announcements from one forum category, woven with the village's own milestones, where a tap of appreciation is a real gift from your cycle budget.

| Fact | Value |
| --- | --- |
| Id | `feed` |
| Shelf | Connect (`connect`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `none`, works the moment it is on. The Go-live card offers itself right after Turn on. |
| Requires | `forum` |
| Recommends | nothing |
| Capabilities it adds | `feed.announce` |
| Variable keys it owns | `feed.category_slug`, `feed.heart_amount`, `feed.max_hearts_per_recipient_per_cycle` |
| API prefixes | `/api/feed` |
| Contract doc | [gratitude-feed.md](modules/gratitude-feed.md) |

### Messages

Private conversations between members: one to one, or a named group carrying its own membership and read state. A direct message is the two-party case of the same thread, so every conversation in the village has one home, one report path, and one place to moderate.

| Fact | Value |
| --- | --- |
| Id | `messaging` |
| Shelf | Connect (`connect`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `none`, works the moment it is on. The Go-live card offers itself right after Turn on. |
| Requires | nothing |
| Recommends | nothing |
| Capabilities it adds | `message.send` |
| Variable keys it owns | `messaging.sends_per_minute`, `messaging.max_members` |
| API prefixes | `/api/messages`, `/api/admin/messages` |
| Contract doc | [messaging.md](modules/messaging.md) |
| Switching it off is blocked by | `introductions`, which requires it while non-off |

### Village Network

Federation with other villages running this platform: publish your needs and offers to the network, and read what peer villages share. Foundations for co-hiring, shared events and resource pooling. You choose exactly which villages to listen to; publishing an item is an explicit act, and nothing about individual members is ever shared.

| Fact | Value |
| --- | --- |
| Id | `network` |
| Shelf | Connect (`connect`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `village-content` |
| Standing it up | `none`, works the moment it is on. The Go-live card offers itself right after Turn on. |
| Requires | nothing |
| Recommends | nothing |
| Capabilities it adds | none |
| Variable keys it owns | none |
| API prefixes | `/api/network` |
| Contract doc | none yet |

### Crowdpool

The village's hub crowdpool, told in the living map's own language: a gold funding ring, a star lantern counting toward build day, a needs shelf with claim links to the hub, partner funders, and a ledger of arrivals. The game server reads the hub's public data and shows aggregates; every pledge happens on the hub itself.

| Fact | Value |
| --- | --- |
| Id | `crowdpool` |
| Shelf | Connect (`connect`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `village-content` |
| Standing it up | `optional`, better with content, honest without it. |
| Requires | nothing |
| Recommends | `map` |
| Capabilities it adds | none |
| Variable keys it owns | none |
| API prefixes | `/api/crowdpool` |
| Contract doc | [crowdpool.md](modules/crowdpool.md) |
| Config it seeds | `villageCampaigns` |

### Introductions

Members say in plain words what they seek, confirm offers the village already knows about them, and receive a few good introductions a week. A match is a proposal with its reasoning attached; both people say yes separately before one conversation opens.

| Fact | Value |
| --- | --- |
| Id | `introductions` |
| Shelf | Connect (`connect`) |
| A village can switch it off | yes, and it ships off. An admin moves it to `preview`, `members`, `public` |
| Tier | `included` |
| Data it holds | `member-pii` |
| Standing it up | `none`, works the moment it is on. The Go-live card offers itself right after Turn on. |
| Requires | `messaging` |
| Recommends | `badges`, `map` |
| Capabilities it adds | none |
| Variable keys it owns | `introductions.recipient_daily_cap`, `introductions.match_floor`, `introductions.opportunity_days`, `introductions.retention_days` |
| API prefixes | `/api/intents` |
| Contract doc | none yet |

## What depends on what

A hard dependency blocks both directions: a module cannot be enabled while something it requires is off, and something it requires cannot be switched off while it is on. A missing dependency demotes a module to `off` at boot. A soft dependency warns in the admin panel and blocks nothing.

| Module | Requires |
| --- | --- |
| `resources` | `map` |
| `feed` | `forum` |
| `introductions` | `messaging` |

Read the other way: `map` cannot be switched off while `resources` is on, `forum` cannot be switched off while `feed` is on, `messaging` cannot be switched off while `introductions` is on.

| Module | Recommends |
| --- | --- |
| `resources` | `forum` |
| `forum` | `map` |
| `stays` | `quests` |
| `automation` | `forum` |
| `health` | `gratitude`, `quests` |
| `badges` | `quests` |
| `crowdpool` | `map` |
| `events` | `map` |
| `introductions` | `badges`, `map` |
| `governance` | `forum` |
| `hypha` | `governance`, `tools` |

## The dials a module owns

Game variables are namespaced, and Admin hides a namespace while its module is off. Between them the 23 modules own 75 keys. A key here is a DEFAULT: the database stores changed values only, and a village that has never touched a dial inherits the platform's answer.

Three keys are claimed by more than one module, so switching one module off leaves the dial owned by the other:

| Key | Claimed by |
| --- | --- |
| `payments.purchase_limit_30d_usd` | `stays`, `exchange` |
| `payments.purchase_limit_annual_usd` | `stays`, `exchange` |
| `payments.purchase_limit_per_order_usd` | `stays`, `exchange` |

## Capabilities

A module ADDS capability keys to the one gate in `shared/capabilities.ts`, which holds 31 keys in total. It never becomes a second permission mechanism. The order of the one gate is admin, then badge denies, then role, then badge grants, then stage: a badge deny beats role and stage, and only admin outranks it. Eleven modules add keys:

| Module | Capabilities |
| --- | --- |
| `quests` | `quest.consent` |
| `progression` | `proposal.open`, `proposal.decide` |
| `map` | `map.viewPeople`, `map.contact`, `map.photograph`, `map.curatePhotos` |
| `forum` | `forum.post`, `forum.moderate` |
| `feed` | `feed.announce` |
| `messaging` | `message.send` |
| `stays` | `stay.member_rate` |
| `health` | `health.record` |
| `exchange` | `exchange.buy`, `exchange.swap`, `exchange.manage` |
| `events` | `event.rsvp`, `event.manage` |
| `governance` | `ballot.vote`, `member.vouch` |

## Machine-readable

The same facts, for anything that would rather parse than read. Regenerated with the rest of the file, so it cannot drift from the prose above it.

```json
{
  "moduleCount": 23,
  "coreCount": 4,
  "lifecycle": {
    "off": 0,
    "preview": 1,
    "members": 2,
    "public": 3
  },
  "contractVersion": "1.2",
  "modules": [
    {
      "id": "quests",
      "name": "Quests",
      "description": "The contribution board: post work, claim it, submit it, consent to release recognition.",
      "core": true,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "coordinate",
      "setup": "none",
      "requires": [],
      "recommends": [],
      "capabilities": [
        "quest.consent"
      ],
      "variableKeys": [
        "quest.consent_cap_mode",
        "quest.consent_cap_multiplier",
        "quest.require_submission_before_consent"
      ],
      "apiPrefixes": [
        "/api/quests",
        "/api/game/quests"
      ],
      "contractDoc": "docs/modules/quests.md"
    },
    {
      "id": "gratitude",
      "name": "Gratitude",
      "description": "Recognition sends, lunar cycles, and the value pool distributed at each close.",
      "core": true,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "recognise",
      "setup": "none",
      "requires": [],
      "recommends": [],
      "capabilities": [],
      "variableKeys": [
        "gratitude.base_budget",
        "gratitude.require_message",
        "gratitude.max_share_per_recipient",
        "gratitude.pool_per_cycle",
        "gratitude.pool_token"
      ],
      "apiPrefixes": [
        "/api/game/gratitude",
        "/api/game/cycle",
        "/api/admin/cycles"
      ],
      "contractDoc": "docs/modules/gratitude.md"
    },
    {
      "id": "progression",
      "name": "Stages & Roles",
      "description": "The path from guest to co-creator: stages, capabilities, and appointed roles.",
      "core": true,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "recognise",
      "setup": "none",
      "requires": [],
      "recommends": [],
      "capabilities": [
        "proposal.open",
        "proposal.decide"
      ],
      "variableKeys": [],
      "apiPrefixes": [
        "/api/game/progression",
        "/api/roles"
      ],
      "contractDoc": "docs/modules/progression.md"
    },
    {
      "id": "profiles",
      "name": "Profiles",
      "description": "Member identity: handles, journeys, balances, and each member's own ledger.",
      "core": true,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "connect",
      "setup": "none",
      "requires": [],
      "recommends": [],
      "capabilities": [],
      "variableKeys": [],
      "apiPrefixes": [
        "/api/profile"
      ],
      "contractDoc": "docs/modules/profiles.md"
    },
    {
      "id": "map",
      "name": "How Power Is Held",
      "description": "The living org chart: circles, the roles that orbit them, who holds each seat, which seats are open calls, plus a concierge that routes 'I want to help with X' to the right person.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "know-and-decide",
      "setup": "optional",
      "requires": [],
      "recommends": [],
      "capabilities": [
        "map.viewPeople",
        "map.contact",
        "map.photograph",
        "map.curatePhotos"
      ],
      "variableKeys": [
        "map.public_structure",
        "map.concierge_enabled",
        "map.contact_daily_cap",
        "map.contact_recipient_daily_cap",
        "map.show_quests",
        "map.vacant_highlight",
        "map.contact_retention_days",
        "map.photo_max_mb",
        "map.photos_per_place",
        "map.photos_per_member_daily",
        "map.photo_report_hide_threshold",
        "map.photo_tombstone_days"
      ],
      "apiPrefixes": [
        "/api/map",
        "/api/circles",
        "/api/places",
        "/api/admin/places"
      ],
      "contractDoc": "docs/modules/village-map.md"
    },
    {
      "id": "resources",
      "name": "How Resources Flow",
      "description": "A declared map of how money and resources are governed: who may spend what, with whose approval, paid from where, and where the money comes from; it describes the flow and moves nothing.",
      "core": false,
      "tier": "included",
      "dataClass": "village-content",
      "group": "know-and-decide",
      "setup": "optional",
      "requires": [
        "map"
      ],
      "recommends": [
        "forum"
      ],
      "capabilities": [],
      "variableKeys": [],
      "apiPrefixes": [
        "/api/resources"
      ],
      "contractDoc": "docs/modules/how-resources-flow.md"
    },
    {
      "id": "forum",
      "name": "Forum & Decisions",
      "description": "Village conversations: threads by circle-of-life category, @mentions, thread follows, community moderation, and the decision primitive, where proposals are opened and outcomes recorded.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "know-and-decide",
      "setup": "none",
      "requires": [],
      "recommends": [
        "map"
      ],
      "capabilities": [
        "forum.post",
        "forum.moderate"
      ],
      "variableKeys": [
        "forum.report_hide_threshold"
      ],
      "apiPrefixes": [
        "/api/forum"
      ],
      "contractDoc": null
    },
    {
      "id": "feed",
      "name": "Village Feed",
      "description": "The everyday stream: microposts, events and announcements from one forum category, woven with the village's own milestones, where a tap of appreciation is a real gift from your cycle budget.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "connect",
      "setup": "none",
      "requires": [
        "forum"
      ],
      "recommends": [],
      "capabilities": [
        "feed.announce"
      ],
      "variableKeys": [
        "feed.category_slug",
        "feed.heart_amount",
        "feed.max_hearts_per_recipient_per_cycle"
      ],
      "apiPrefixes": [
        "/api/feed"
      ],
      "contractDoc": "docs/modules/gratitude-feed.md"
    },
    {
      "id": "messaging",
      "name": "Messages",
      "description": "Private conversations between members: one to one, or a named group carrying its own membership and read state. A direct message is the two-party case of the same thread, so every conversation in the village has one home, one report path, and one place to moderate.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "connect",
      "setup": "none",
      "requires": [],
      "recommends": [],
      "capabilities": [
        "message.send"
      ],
      "variableKeys": [
        "messaging.sends_per_minute",
        "messaging.max_members"
      ],
      "apiPrefixes": [
        "/api/messages",
        "/api/admin/messages"
      ],
      "contractDoc": "docs/modules/messaging.md"
    },
    {
      "id": "stays",
      "name": "Stays",
      "description": "Accommodation on stay credits: rooms post credit (and optional USD) prices per audience, credits are bought or earned through work-exchange quests, and one credit hosts one night. Funds-bearing: read the legal card before enabling.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "host-and-earn",
      "setup": "required",
      "requires": [],
      "recommends": [
        "quests"
      ],
      "capabilities": [
        "stay.member_rate"
      ],
      "variableKeys": [
        "stay.guest_booking_enabled",
        "stay.autopay_default",
        "stay.autopay_post_hour",
        "stay.low_balance_warn_nights",
        "stay.grace_nights",
        "stay.max_purchase_nights",
        "stay.credit_expiry_days",
        "stay.credits_transferable",
        "stay.work_exchange_tag",
        "payments.purchase_limit_per_order_usd",
        "payments.purchase_limit_30d_usd",
        "payments.purchase_limit_annual_usd"
      ],
      "apiPrefixes": [
        "/api/stays"
      ],
      "contractDoc": "docs/modules/stays.md"
    },
    {
      "id": "automation",
      "name": "Call Automation",
      "description": "The weekly call becomes assigned work, not content distribution: recordings in, transcripts kept, an AI synthesis whose every task suggestion carries a verbatim quote and timestamp (or is dropped), published to the forum by a human, with suggestions routed to the roles they name. Nothing publishes or applies itself.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "coordinate",
      "setup": "optional",
      "requires": [],
      "recommends": [
        "forum"
      ],
      "capabilities": [],
      "variableKeys": [],
      "apiPrefixes": [
        "/api/recordings"
      ],
      "contractDoc": null
    },
    {
      "id": "health",
      "name": "Village Health",
      "description": "The village's vital signs: per-lunation snapshots frozen at each cycle close, the land's own regeneration ledger (trees, water, hectares: absolute counts, never leaderboards), and season goals. Snapshot COLLECTION runs from the day this ships; turn the dashboard on once a few lunations of history exist.",
      "core": false,
      "tier": "included",
      "dataClass": "village-content",
      "group": "know-and-decide",
      "setup": "optional",
      "requires": [],
      "recommends": [
        "gratitude",
        "quests"
      ],
      "capabilities": [
        "health.record"
      ],
      "variableKeys": [
        "health.alert_change_pct"
      ],
      "apiPrefixes": [
        "/api/health"
      ],
      "contractDoc": "docs/modules/health-dashboard.md"
    },
    {
      "id": "library",
      "name": "Material Library",
      "description": "The village's shared tools and goods: donate an item and earn library credits (appraised, capped, dual-signed above a threshold), then borrow against an escrowed deposit. Credits are backed by the shelves; they never swap, and selling them for fiat is a separate caution-card opt-in (L9).",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "host-and-earn",
      "setup": "required",
      "requires": [],
      "recommends": [],
      "capabilities": [],
      "variableKeys": [
        "library.intake_award_pct",
        "library.intake_member_cycle_cap",
        "library.intake_dual_signoff_over",
        "library.escrow_pct",
        "library.usage_fee_pct",
        "library.loan_days_default",
        "library.dispute_deadline_days",
        "library.intake_stall_days"
      ],
      "apiPrefixes": [
        "/api/library"
      ],
      "contractDoc": "docs/modules/material-library.md"
    },
    {
      "id": "badges",
      "name": "Badges & Skills",
      "description": "Recognition of who people are and what they can do: self-declared skills, badges earned from settled contribution, granted honors, and warning badges that suspend specific capabilities until resolved. Earned badges never ride applause metrics into permissions.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "recognise",
      "setup": "optional",
      "requires": [],
      "recommends": [
        "quests"
      ],
      "capabilities": [],
      "variableKeys": [],
      "apiPrefixes": [
        "/api/badges"
      ],
      "contractDoc": "docs/modules/badges.md"
    },
    {
      "id": "exchange",
      "name": "Exchange",
      "description": "Buy the village's own platform tokens for fiat, out of a stocked treasury, buy-only in v1. Recognition and Hypha-governed tokens can never be listed; a token another module sells can't be listed twice. Funds-bearing: read the legal card before enabling.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "host-and-earn",
      "setup": "required",
      "requires": [],
      "recommends": [],
      "capabilities": [
        "exchange.buy",
        "exchange.swap",
        "exchange.manage"
      ],
      "variableKeys": [
        "exchange.price_change_max_pct",
        "exchange.swap_spread_bps",
        "exchange.swap_fiat_hold_days",
        "exchange.swap_max_receive_per_order",
        "payments.purchase_limit_per_order_usd",
        "payments.purchase_limit_30d_usd",
        "payments.purchase_limit_annual_usd"
      ],
      "apiPrefixes": [
        "/api/exchange"
      ],
      "contractDoc": "docs/modules/internal-exchange.md"
    },
    {
      "id": "commerce",
      "name": "Payments & Donations",
      "description": "Every payment your project issues or receives, as products you define: application fees, donations, deposits and down payments, waitlist seats, recurring memberships, and token packs granted from treasury stock. Rides the same verified Stripe spine as stays and the exchange; Zeffy and manual payment paths for fee-free giving. Money flows IN only, always.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "host-and-earn",
      "setup": "required",
      "requires": [],
      "recommends": [],
      "capabilities": [],
      "variableKeys": [],
      "apiPrefixes": [
        "/api/products"
      ],
      "contractDoc": null
    },
    {
      "id": "network",
      "name": "Village Network",
      "description": "Federation with other villages running this platform: publish your needs and offers to the network, and read what peer villages share. Foundations for co-hiring, shared events and resource pooling. You choose exactly which villages to listen to; publishing an item is an explicit act, and nothing about individual members is ever shared.",
      "core": false,
      "tier": "included",
      "dataClass": "village-content",
      "group": "connect",
      "setup": "none",
      "requires": [],
      "recommends": [],
      "capabilities": [],
      "variableKeys": [],
      "apiPrefixes": [
        "/api/network"
      ],
      "contractDoc": null
    },
    {
      "id": "crowdpool",
      "name": "Crowdpool",
      "description": "The village's hub crowdpool, told in the living map's own language: a gold funding ring, a star lantern counting toward build day, a needs shelf with claim links to the hub, partner funders, and a ledger of arrivals. The game server reads the hub's public data and shows aggregates; every pledge happens on the hub itself.",
      "core": false,
      "tier": "included",
      "dataClass": "village-content",
      "group": "connect",
      "setup": "optional",
      "requires": [],
      "recommends": [
        "map"
      ],
      "capabilities": [],
      "variableKeys": [],
      "apiPrefixes": [
        "/api/crowdpool"
      ],
      "contractDoc": "docs/modules/crowdpool.md"
    },
    {
      "id": "tools",
      "name": "Tools Hub",
      "description": "An audience-aware registry of the village's tools: one place to find the chat, the documents, the governance space, with a pinned card that deep-links to your Hypha DHO.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "coordinate",
      "setup": "optional",
      "requires": [],
      "recommends": [],
      "capabilities": [],
      "variableKeys": [
        "tools.click_tracking",
        "tools.link_check_days"
      ],
      "apiPrefixes": [
        "/api/tools"
      ],
      "contractDoc": "docs/modules/tools-hub.md"
    },
    {
      "id": "events",
      "name": "Village Calendar",
      "description": "The village's calendar: gatherings with a time, a place, a capacity and an RSVP. Other surfaces read it, so the map can light the building something is happening in.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "coordinate",
      "setup": "none",
      "requires": [],
      "recommends": [
        "map"
      ],
      "capabilities": [
        "event.rsvp",
        "event.manage"
      ],
      "variableKeys": [
        "events.rsvp_enabled",
        "events.upcoming_days",
        "events.past_visible_days",
        "calendar.year_anchor",
        "calendar.hemisphere",
        "calendar.cross_quarters"
      ],
      "apiPrefixes": [
        "/api/events",
        "/api/admin/events"
      ],
      "contractDoc": "docs/modules/events.md"
    },
    {
      "id": "introductions",
      "name": "Introductions",
      "description": "Members say in plain words what they seek, confirm offers the village already knows about them, and receive a few good introductions a week. A match is a proposal with its reasoning attached; both people say yes separately before one conversation opens.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "connect",
      "setup": "none",
      "requires": [
        "messaging"
      ],
      "recommends": [
        "badges",
        "map"
      ],
      "capabilities": [],
      "variableKeys": [
        "introductions.recipient_daily_cap",
        "introductions.match_floor",
        "introductions.opportunity_days",
        "introductions.retention_days"
      ],
      "apiPrefixes": [
        "/api/intents"
      ],
      "contractDoc": null
    },
    {
      "id": "governance",
      "name": "Governance",
      "description": "The village decides on-site: staged proposals go to weighted ballots with frozen electorates, votes stay changeable until a human closes with a stated outcome, and passed mechanics changes apply through the one amendment ledger. Off keeps the shipped Hypha loop exactly as it is.",
      "core": false,
      "tier": "included",
      "dataClass": "member-pii",
      "group": "know-and-decide",
      "setup": "none",
      "requires": [],
      "recommends": [
        "forum"
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
      ],
      "apiPrefixes": [
        "/api/governance",
        "/api/admin/governance"
      ],
      "contractDoc": null
    },
    {
      "id": "hypha",
      "name": "Hypha Bridge",
      "description": "Your DAO on Hypha, read from Base and shown here: the contracts this village actually holds, total supply and treasury balance as the chain reports them, and governance outcomes that find their way back to the proposal they came from. Read only, always. Needs a Base endpoint somebody pays for, and it says which of the two listener paths this village is on.",
      "core": false,
      "tier": "included",
      "dataClass": "village-content",
      "group": "know-and-decide",
      "setup": "required",
      "requires": [],
      "recommends": [
        "governance",
        "tools"
      ],
      "capabilities": [],
      "variableKeys": [
        "hypha.treasury_address"
      ],
      "apiPrefixes": [
        "/api/hypha",
        "/api/admin/hypha"
      ],
      "contractDoc": "docs/modules/hypha.md"
    }
  ]
}
```

## What this file is made from

The generator reads these and fails loudly if any of them moves:

- `shared/modules.ts`
- `shared/moduleCatalog.ts`
- `shared/capabilities.ts`
- `server/lib/modules.ts`
- `server/lib/knowledge.ts`
- `docs/modules`

The registry itself is transpiled and imported, so the values here are the values the server and the client load. The vocabularies are parsed out of their type declarations with the TypeScript compiler, because types erase during transpilation, and the plain-words gloss for each value is lifted from the comment that declares it. A value with no gloss stops the build.

Three `ModuleDef` fields are left out of this document on purpose, and the reason travels with the decision:

- `readiness`: a function the SERVER attaches at boot (`server/lib/modules.ts`), so the shared registry this generator imports carries none at all. It answers about one village's own rows.
- `validateConfig`: a function that judges a config a village typed. What it accepts belongs in the module's own contract doc beside the config itself.
- `openStateCheck`: a function the SERVER attaches at boot (`server/index.ts`), so the shared registry this generator imports carries none at all. It counts live value in one village at the moment it runs.

A field that is neither rendered nor on that list stops the build. A registry field reaches every village, so this document either states it or says out loud why it does not.

`node scripts/module-facts.mjs` prints the same registry as a terminal report along with the CI gates, and `node scripts/validate-module.mjs <id>` lints one listing before a pull request.
