# Tokens

Every token a village issues, what each one means, who may issue it, who may move it, and what happens to it when a moon closes.

This describes a FRESH village: what a founder standing up a new instance holds after the migrations run and the server starts for the first time. A village that has been running has its own history on top.

## How to read this file

This file is generated. `scripts/generate-token-doc.mjs` reads the migrations and the server source, works out the facts, and writes the whole document. `scripts/check-token-doc.mjs` regenerates it and fails the build when the committed text and the code have come apart.

Editing this file by hand does not hold. Change the code, then run:

```bash
node scripts/generate-token-doc.mjs
```

Two kinds of line live here, and the difference matters:

- **Read from the code.** Every table, every number, every slug, every account name, and the JSON block at the end. If one of these is wrong, the code is what is wrong.
- **Written by a person.** The one-sentence description of each token, and the rulings section. They are stored inside the generator so this whole file stays generated, and they are marked where they appear.

There is no timestamp and no author line, on purpose. Both would change on every run and turn an honest diff into noise. The git history is the record of when this changed.

## The tokens a fresh village holds

| Token | Slug | Kind | Governed by | Decimals | Members may send it | Arrives from |
| --- | --- | --- | --- | --- | --- | --- |
| Gratitude | `gratitude` | recognition | this village | 0 | no | `drizzle/0006_token_registry.sql` |
| Village Credits | `credits` | credit | this village | 0 | yes | `drizzle/0007_village_credits_token.sql` |
| Library Credits | `library-credit` | credit | this village | 0 | no | `server/lib/library.ts` at boot |
| Stay Credits | `stay-credit` | credit | this village | 0 | no | `server/lib/stays.ts` at boot |
| Village Voice | `village-voice` | voice | this village | 3 | no | `server/lib/economy.ts` at boot |
| Village Equity | `equity` | equity | Hypha, on Base | 0 | no | `drizzle/0124_the_equity_token_names_no_village.sql` |
| Voice | `voice` | voice | Hypha, on Base | 0 | no | `drizzle/0006_token_registry.sql` |

7 tokens. The order is the order a village acquires them: the ones a migration seeds, then the ones the server registers the first time it starts, then the mirrors of what lives on Base.

## Every token in full

### Gratitude

Recognition. One member thanks another for something that actually happened, and this token is the record of it. It is a signal, never a price.

| Fact | Value |
| --- | --- |
| Slug | `gratitude` |
| Kind | recognition |
| Who governs it | this village, which mints it and moves it |
| Decimals | 0 |
| Arrives from | `drizzle/0006_token_registry.sql`, when the database is migrated |
| Issued out of | `sys:gratitude-pool` |
| A mint rule can pay it | yes |
| Members may send it | no, because recognition is never handed between members |
| Can carry a price | no, a price is posted in credit tokens |

**Who can issue it, and how.** Every unit comes out of `sys:gratitude-pool`, and that account's negative balance is this token's issued supply. A mint rule can pay it, and a fresh village is seeded with no rule that does. One rule ships switched OFF and pays nobody until the village turns it on: 20 on `role.cycle` to the holder. It is seeded off rather than left out because no route creates a mint rule, so a village that wanted it back would have no way to add it. No token at all can be issued before the village's launch vote carries. The gate sits on the ledger account's `faucet` column, so it covers every faucet including one added later (`server/lib/gameStart.ts`).

**What happens at cycle close.** The balance itself is untouched. What a member received during the moon decides their share of the pool, and then the balance stays where it is. Ruling 1 below would expire an unspent balance here, and it is not built.

### Village Credits

The village's own money. It is what the cycle pool shares out when a moon closes, and what a member spends on a night, a seat or a shelf.

| Fact | Value |
| --- | --- |
| Slug | `credits` |
| Kind | credit |
| Who governs it | this village, which mints it and moves it |
| Decimals | 0 |
| Arrives from | `drizzle/0007_village_credits_token.sql`, when the database is migrated |
| Issued out of | `sys:cycle-pool` |
| A mint rule can pay it | yes |
| Members may send it | yes |
| Can carry a price | yes, and spending it lands in `sys:treasury` |

**Who can issue it, and how.** Every unit comes out of `sys:cycle-pool`, and that account's negative balance is this token's issued supply. A mint rule can pay it, and a fresh village is seeded to pay 25 on `quest.completed` to the claimant, up to 250 a moon; 25 on `role.cycle` to the holder, up to 250 a moon. It is the default answer to the `gratitude.pool_token` dial, so a closing moon releases it out of `sys:cycle-pool`, which is an administrator's deliberate act rather than a scheduled job. No token at all can be issued before the village's launch vote carries. The gate sits on the ledger account's `faucet` column, so it covers every faucet including one added later (`server/lib/gameStart.ts`).

**What happens at cycle close.** A closing moon shares out as many of this token as the `gratitude.pool_per_cycle` dial says (default 1000, and 0 turns the pool off), split between members in proportion to the recognition each received that moon. Shares round down, and the remainder stays in the pool. Settlement pays everyone holding a seat 25 of it. A re-run pays nothing twice: each mint is keyed on the moon, the seat and the holder.

### Library Credits

A deposit against the village's shelves, issued by the library module against what it lends.

| Fact | Value |
| --- | --- |
| Slug | `library-credit` |
| Kind | credit |
| Who governs it | this village, which mints it and moves it |
| Decimals | 0 |
| Arrives from | `server/lib/library.ts`, at the first server start (`ensureLibraryToken()`) |
| Issued out of | `sys:library-mint` |
| A mint rule can pay it | yes |
| Members may send it | no, because it buys one named thing from the village and cannot be passed on |
| Can carry a price | yes, and spending it lands in `sys:treasury` |

**Who can issue it, and how.** Every unit comes out of `sys:library-mint`, and that account's negative balance is this token's issued supply. A mint rule can pay it, and a fresh village is seeded with no rule that does. No token at all can be issued before the village's launch vote carries. The gate sits on the ledger account's `faucet` column, so it covers every faucet including one added later (`server/lib/gameStart.ts`).

**What happens at cycle close.** Nothing. Balances carry across the moon unchanged.

### Stay Credits

A claim on a night in one of the village's rooms, issued by the stays module against its own beds.

| Fact | Value |
| --- | --- |
| Slug | `stay-credit` |
| Kind | credit |
| Who governs it | this village, which mints it and moves it |
| Decimals | 0 |
| Arrives from | `server/lib/stays.ts`, at the first server start (`ensureStayToken()`) |
| Issued out of | `sys:mint` |
| A mint rule can pay it | yes |
| Members may send it | no, because it buys one named thing from the village and cannot be passed on |
| Can carry a price | yes, and spending it lands in `sys:mint` |

**Who can issue it, and how.** Every unit comes out of `sys:mint`, and that account's negative balance is this token's issued supply. A mint rule can pay it, and a fresh village is seeded with no rule that does. No token at all can be issued before the village's launch vote carries. The gate sits on the ledger account's `faucet` column, so it covers every faucet including one added later (`server/lib/gameStart.ts`).

**What happens at cycle close.** Nothing. Balances carry across the moon unchanged.

### Village Voice

Earned say. It accrues here as work is confirmed and seats are held, and a member claims it across to Base once they hold enough.

| Fact | Value |
| --- | --- |
| Slug | `village-voice` |
| Kind | voice |
| Who governs it | this village, which mints it and moves it |
| Decimals | 3 |
| Arrives from | `server/lib/economy.ts`, at the first server start (`ensureVoiceToken()`) |
| Issued out of | `sys:voice-mint` |
| A mint rule can pay it | yes |
| Members may send it | no, because voice is never handed between members |
| Can carry a price | no, a price is posted in credit tokens |
| Name | `Village Voice` unless the seed is given another. The slug stays `village-voice` either way |

**Who can issue it, and how.** Every unit comes out of `sys:voice-mint`, and that account's negative balance is this token's issued supply. A mint rule can pay it, and a fresh village is seeded to pay 10 on `quest.completed` to the claimant, up to 100 a moon; 50 on `role.cycle` to the holder, up to 200 a moon. No token at all can be issued before the village's launch vote carries. The gate sits on the ledger account's `faucet` column, so it covers every faucet including one added later (`server/lib/gameStart.ts`).

**What happens at cycle close.** Settlement pays everyone holding a seat 50 of it. A re-run pays nothing twice: each mint is keyed on the moon, the seat and the holder.

**Claiming it across to Base.** A member's chip turns claimable once they hold `economy.voice_claim_threshold` of it (default 100). The claim holds the amount aside, becomes a real proposal in the village's Hypha space, and settles on Base when that proposal carries, moving to `sys:voice-settled`. A claim that is canceled, rejected or left to go stale returns the voice to the member instead, through the reversal of the very posting that took it. Claims open in a window once a season, `economy.claims_week_days` days long (default 7), so a whole season of contribution formalises in one governance pass rather than as a trickle of separate proposals.

### Village Equity

The village's equity, issued and governed on Base under Hypha. This platform shows a member what they hold and never moves it.

| Fact | Value |
| --- | --- |
| Slug | `equity` |
| Kind | equity |
| Who governs it | Hypha, on Base. Read here, never written |
| Decimals | 0 |
| Arrives from | `drizzle/0124_the_equity_token_names_no_village.sql`, when the database is migrated |
| Issued out of | nothing here issues it |
| A mint rule can pay it | no, it is a Base mirror |
| Members may send it | no, because it is governed on Base |
| Can carry a price | no, a price is posted in credit tokens |

**Who can issue it, and how.** Nobody, here. It is issued on Base under Hypha, and this platform holds a read-only mirror of what a member's wallet says. The ledger refuses any posting of it, so a bug cannot make this database a second source of truth for the cap table.

**What happens at cycle close.** Nothing. Balances carry across the moon unchanged.

### Voice

Voice that has already been claimed across to Base. This platform shows a member what they hold there and never moves it.

| Fact | Value |
| --- | --- |
| Slug | `voice` |
| Kind | voice |
| Who governs it | Hypha, on Base. Read here, never written |
| Decimals | 0 |
| Arrives from | `drizzle/0006_token_registry.sql`, when the database is migrated |
| Issued out of | nothing here issues it |
| A mint rule can pay it | no, it is a Base mirror |
| Members may send it | no, because it is governed on Base |
| Can carry a price | no, a price is posted in credit tokens |

**Who can issue it, and how.** Nobody, here. It is issued on Base under Hypha, and this platform holds a read-only mirror of what a member's wallet says. The ledger refuses any posting of it, so a bug cannot make this database a second source of truth for the cap table.

**What happens at cycle close.** Nothing. Balances carry across the moon unchanged.

## The slug never changes

A token has two names. The **slug** is its identity and the **name** is the village's word for it. A village renames the name whenever it likes, in Admin then Tokens. The slug is fixed the moment the token exists.

One exception to the renaming, and it runs the other way: a Base mirror cannot be renamed here at all. Its name is a fact about Base, and the rename route refuses it in those words. Two tokens may not share a display name either, in either direction, because a balance in a name two things answer to is a balance nobody can read.

The slug is fixed because history is written in it:

- `slug` is the primary key of the `tokens` table, so moving it is not a rename, it is a different row.
- Every ledger row carries the slug in `token_type`, and every repeat-protection key carries the slug too. Change the slug and the keys that stop a payment happening twice stop matching the payments they were protecting.
- Balances are held per account per slug. A moved slug is a balance nobody can find.

A rename touches one column that only humans read. A re-slug moves the key every ledger row was written against. The create route already refuses a slug that exists, with the words "Token history must never be silently re-denominated".

## Who may move what

A member may send a token to another member only when all of these hold. The list is read from `server/lib/spending.ts`:

- the village governs it, so a Base mirror is out
- its kind is `credit`
- it is not a module voucher (`stay-credit`, `library-credit`), which buys one named thing from the village
- the village has `transferable` switched on for it
- it is in circulation and is not a standing example

Recognition is held out of that list deliberately and permanently. A record of what happened between two people stops being a record the moment it can be handed to a third.

A price is posted in credit tokens and in nothing else, which is the same separation stated from the other end. Where a spent token lands:

| Token | Lands in | Why |
| --- | --- | --- |
| `credits` | `sys:treasury` | the village now holds that value and can spend it |
| `library-credit` | `sys:treasury` | the village now holds that value and can spend it |
| `stay-credit` | `sys:mint` | spending it genuinely retires it, so it returns to the faucet that issued it |

Three other things move a token, and none of them is one member handing it to another:

- **Spending.** A member pays a village surface and the amount lands in the account above.
- **Claiming across to Base.** An open claim holds the amount in `sys:voice-bridge`, which is not a faucet: it can only ever hold what a member put in it, which is what makes a cancelled claim provably refundable.
- **Leaving.** A departing member's balances settle to `sys:exit-settlement`.

One more way value enters, outside the rule engine: an administrator can stock the treasury by hand out of `sys:mint`, capped at `ledger.admin_mint_cycle_cap` per token per moon (default `10000`, and 0 switches hand-minting off). The exchange's own rules decide which tokens that route will accept.

## Balances, and how far down they go

The ledger is double-entry. Every movement is a transfer from one account to another, and for every token the balances of all accounts add up to zero. Faucet accounts are allowed to run negative, and a faucet's negative balance is that token's issued supply. That is what makes issuance a number anyone can check rather than a claim anyone has to trust.

An ordinary account cannot go below zero. Three sources are excepted today, in `ALLOW_NEGATIVE_SOURCES`: `stay_night`, `payment_reversal` and `reversal`. Each is an honest state rather than a convenience: a stay burnt inside its grace window, the reversal leg after a refund and a correction clawing back value the member had already spent.

There is no setting for how far a balance may go below zero. Ruling 2 below describes the one the founder asked for, and the generator stops the build if a dial that looks like one ever appears, so this sentence cannot go stale quietly.

## The registry table

The `tokens` table carries 13 columns. The running registry loads 8 of them: `slug`, `name`, `kind`, `governance`, `transferable`, `decimals`, `active`, `is_example`.

The rest are not loaded into the registry: `sort_order`, `created_at`, `glyph`, `spendable`, `external_ref`. A column on that list can still be used directly in SQL (`sort_order` orders several listings). One that nothing reads anywhere is dead weight, and this is the list to look in for it.

## The founder's rulings

Written by a person, from the founder's own words, and recorded here so the specification and the code sit in one place. Each one says plainly whether it is built. Nothing marked staged exists in the code today, and no reader should plan as though it does.

### 1. Unspent gratitude expires at cycle close

**Staged.** Not built.

Today a closing moon reads how much recognition each member received during it, uses that to split the value pool, and leaves every recognition balance exactly where it was. Nothing expires and nothing is swept.

### 2. Balances may go negative, with a floor that defaults to zero

**Staged.** Not built.

The ruling: a balance can go negative, and how far is a setting in the economic game mechanics section, defaulting to zero so that by default it cannot. Today the floor is zero for every ordinary account, enforced inside the transfer transaction, with the two exceptions listed above. There is no dial.

### 3. A module switched off puts its balances in the dark, and the rows survive

**Half built.**

Built: nothing deletes a token row or a ledger row. A token's `active` flag is a member-visibility switch and nothing more, so turning it off hides the token and leaves every balance and every history row intact, ready to come back. The stays module registers its token at every boot whether the module is on or off, precisely so a reward can post and wait.

Staged: switching a module off, once the game has started and members hold its token, being a decision the players vote on rather than a switch an administrator flips.

### 4. Voting weight switches back and forth, and holdings survive it

**Built.**

Today `governance.weight_mode` is a founder-ring dial with 3 choices (`equal`, `token`, `custom`), defaulting to `equal`. `governance.weight_token` decides which token weighs a vote when the mode is token, defaulting to `gratitude`. Nothing refuses a change in either direction, and switching reads or ignores holdings without deleting one: balances are ledger rows and a custom allocation is its own table, so a village can move from one person one vote to token weight and back and every holding survives the trip. Every ballot freezes the weights when it opens, so a change mid-vote cannot move a result either.

The village's own vote on it landed. `governance_mode` is a subject type with an executor of its own, priced at the constitutional tier, so the switch is a decision the village makes and no longer an administrator's act. The ordinary dial path still refuses the key, so the change cannot arrive by a side door, and the dial stays in the founder ring for the catalysts who set the initial conditions before the Game starts. What a passed vote then does, and when it lands, is in `docs/GOVERNANCE.md`.

### 5. Voice a founder issues before launch is still a ledger entry, and shows in history as a proposal

**Staged, and the code currently says the opposite.**

Every issuance is a ledger row today, keyed and sourced, and the ledger is append-only, so the first half is how the ledger already works. The second half is not: issuance is refused outright before the village's launch vote carries. A founder cannot issue voice before launch at all, so there is no pre-launch entry to show. Building this ruling means deciding what a pre-launch issuance is, and the honest reading of the founder's words is a proposal that every player can see, resolved by the launch vote.

### 6. Any player reaches the admin pages once the game starts, and changes need a vote

**Staged.** Not built, and out of scope for this work.

It is a rebuild of how governance reaches every administrative surface, not a token change. It is recorded here because it decides who may rename a token and who may switch a module off, and both of those are questions this document answers today with "an administrator".

### 7. Quests, roles and contributions can pay any combination of tokens

**Partly built.**

The ruling in full: a quest, a role or a contribution of any kind should be able to pay any combination of any tokens, with the village's voice and the village's credits as the defaults, and paying in recognition should stop being a default and become something a village adds if it wants it.

Built: the shape. A mint rule names one token, one trigger and one amount, and several rules can share a trigger, so a payout is already a combination rather than a single token. Each rule pays under its own key, so one of them failing cannot pay another twice.

What a fresh village is actually seeded to pay today, read from `server/lib/economySeed.ts`:

| Trigger | Token | Amount | Ceiling a moon | Paid to | On today |
| --- | --- | --- | --- | --- | --- |
| `quest.completed` | `village-voice` | 10 | 100 | claimant | yes |
| `quest.completed` | `credits` | 25 | 250 | claimant | yes |
| `role.cycle` | `village-voice` | 50 | 200 | holder | yes |
| `role.cycle` | `credits` | 25 | 250 | holder | yes |
| `role.cycle` | `gratitude` | 20 | 100 | holder | no, seeded off |

A confirmed quest also mints recognition from the consent route itself, with its own range and cap, which is not a mint rule and does not appear in that table. A contribution pays nothing at all: `POST /api/profile/contribution` is a journal entry, and it is one deliberately, after a version of it that added a caller-supplied amount straight onto a member's balance was removed.

Staged: the freedom. The rule engine can pay `gratitude`, `credits`, `library-credit`, `stay-credit`, `village-voice`. A village also has no route that creates a mint rule, so today it can edit the amounts on the rules it was seeded with and cannot add a token to a payout.

### 8. Redeeming tokens for money or equity

A village that decides to let members redeem a token for cash or for equity should check what its own country's law asks of it first.

## The bridge to Base, in three stages

The founder's staging, recorded as specification. Stage 1 is where the build stands.

| Stage | What it is | Status |
| --- | --- | --- |
| 1 | A one-way bridge. Voice accrues in this village and a member claims it across to Base when they hold enough. Equity and claimed voice are read back as mirrors. | Built in outline |
| 2 | Full Hypha integration. | Staged |
| 3 | The game mints directly to Base and Hypha drops out. Several years out. | Staged |

The rule that survives all three stages: this platform never becomes a second source of truth for anything Base governs. A Hypha-governed token is refused by the ledger, at the same place every other posting is checked.

## Machine-readable

The same facts, for anything that would rather parse than read. Regenerated with the rest of the file, so it cannot drift from the prose above it.

```json
{
  "tokens": [
    {
      "slug": "gratitude",
      "name": "Gratitude",
      "kind": "recognition",
      "governance": "platform",
      "decimals": 0,
      "transferable": false,
      "active": true,
      "sendableBetweenMembers": false,
      "sendBlockedBy": "recognition is never handed between members",
      "faucet": "sys:gratitude-pool",
      "ruleEngineCanPay": true,
      "spendSink": null,
      "arrivesFrom": "migration",
      "arrivesIn": "drizzle/0006_token_registry.sql",
      "isCyclePoolDefault": false,
      "isVoteWeightDefault": true,
      "seededRules": [
        {
          "trigger": "role.cycle",
          "amount": 20,
          "ceiling": 100,
          "recipient": "holder",
          "enabled": false
        }
      ],
      "description": "Recognition. One member thanks another for something that actually happened, and this token is the record of it. It is a signal, never a price."
    },
    {
      "slug": "credits",
      "name": "Village Credits",
      "kind": "credit",
      "governance": "platform",
      "decimals": 0,
      "transferable": true,
      "active": true,
      "sendableBetweenMembers": true,
      "sendBlockedBy": null,
      "faucet": "sys:cycle-pool",
      "ruleEngineCanPay": true,
      "spendSink": "sys:treasury",
      "arrivesFrom": "migration",
      "arrivesIn": "drizzle/0007_village_credits_token.sql",
      "isCyclePoolDefault": true,
      "isVoteWeightDefault": false,
      "seededRules": [
        {
          "trigger": "quest.completed",
          "amount": 25,
          "ceiling": 250,
          "recipient": "claimant",
          "enabled": true
        },
        {
          "trigger": "role.cycle",
          "amount": 25,
          "ceiling": 250,
          "recipient": "holder",
          "enabled": true
        }
      ],
      "description": "The village's own money. It is what the cycle pool shares out when a moon closes, and what a member spends on a night, a seat or a shelf."
    },
    {
      "slug": "library-credit",
      "name": "Library Credits",
      "kind": "credit",
      "governance": "platform",
      "decimals": 0,
      "transferable": false,
      "active": true,
      "sendableBetweenMembers": false,
      "sendBlockedBy": "it buys one named thing from the village and cannot be passed on",
      "faucet": "sys:library-mint",
      "ruleEngineCanPay": true,
      "spendSink": "sys:treasury",
      "arrivesFrom": "boot",
      "arrivesIn": "server/lib/library.ts",
      "isCyclePoolDefault": false,
      "isVoteWeightDefault": false,
      "seededRules": [],
      "description": "A deposit against the village's shelves, issued by the library module against what it lends."
    },
    {
      "slug": "stay-credit",
      "name": "Stay Credits",
      "kind": "credit",
      "governance": "platform",
      "decimals": 0,
      "transferable": false,
      "active": true,
      "sendableBetweenMembers": false,
      "sendBlockedBy": "it buys one named thing from the village and cannot be passed on",
      "faucet": "sys:mint",
      "ruleEngineCanPay": true,
      "spendSink": "sys:mint",
      "arrivesFrom": "boot",
      "arrivesIn": "server/lib/stays.ts",
      "isCyclePoolDefault": false,
      "isVoteWeightDefault": false,
      "seededRules": [],
      "description": "A claim on a night in one of the village's rooms, issued by the stays module against its own beds."
    },
    {
      "slug": "village-voice",
      "name": "Village Voice",
      "kind": "voice",
      "governance": "platform",
      "decimals": 3,
      "transferable": false,
      "active": true,
      "sendableBetweenMembers": false,
      "sendBlockedBy": "voice is never handed between members",
      "faucet": "sys:voice-mint",
      "ruleEngineCanPay": true,
      "spendSink": null,
      "arrivesFrom": "boot",
      "arrivesIn": "server/lib/economy.ts",
      "isCyclePoolDefault": false,
      "isVoteWeightDefault": false,
      "seededRules": [
        {
          "trigger": "quest.completed",
          "amount": 10,
          "ceiling": 100,
          "recipient": "claimant",
          "enabled": true
        },
        {
          "trigger": "role.cycle",
          "amount": 50,
          "ceiling": 200,
          "recipient": "holder",
          "enabled": true
        }
      ],
      "description": "Earned say. It accrues here as work is confirmed and seats are held, and a member claims it across to Base once they hold enough."
    },
    {
      "slug": "equity",
      "name": "Village Equity",
      "kind": "equity",
      "governance": "hypha",
      "decimals": 0,
      "transferable": false,
      "active": true,
      "sendableBetweenMembers": false,
      "sendBlockedBy": "it is governed on Base",
      "faucet": null,
      "ruleEngineCanPay": false,
      "spendSink": null,
      "arrivesFrom": "migration",
      "arrivesIn": "drizzle/0124_the_equity_token_names_no_village.sql",
      "isCyclePoolDefault": false,
      "isVoteWeightDefault": false,
      "seededRules": [],
      "description": "The village's equity, issued and governed on Base under Hypha. This platform shows a member what they hold and never moves it."
    },
    {
      "slug": "voice",
      "name": "Voice",
      "kind": "voice",
      "governance": "hypha",
      "decimals": 0,
      "transferable": false,
      "active": true,
      "sendableBetweenMembers": false,
      "sendBlockedBy": "it is governed on Base",
      "faucet": null,
      "ruleEngineCanPay": false,
      "spendSink": null,
      "arrivesFrom": "migration",
      "arrivesIn": "drizzle/0006_token_registry.sql",
      "isCyclePoolDefault": false,
      "isVoteWeightDefault": false,
      "seededRules": [],
      "description": "Voice that has already been claimed across to Base. This platform shows a member what they hold there and never moves it."
    }
  ],
  "sendableKinds": [
    "credit"
  ],
  "moduleVouchers": [
    "stay-credit",
    "library-credit"
  ],
  "allowNegativeSources": [
    "stay_night",
    "payment_reversal",
    "reversal"
  ],
  "dials": {
    "gratitude.pool_token": {
      "label": "Which token the pool pays",
      "default": "credits"
    },
    "gratitude.pool_per_cycle": {
      "label": "Value pool distributed at each cycle close",
      "default": "1000"
    },
    "governance.weight_mode": {
      "label": "How voting weight is assigned",
      "default": "equal"
    },
    "governance.weight_token": {
      "label": "The weight token",
      "default": "gratitude"
    },
    "ledger.admin_mint_cycle_cap": {
      "label": "Admin mint cap per cycle",
      "default": "10000"
    },
    "economy.voice_claim_threshold": {
      "label": "Voice needed before a member can claim",
      "default": "100"
    },
    "economy.claims_week_days": {
      "label": "How many days Claims Week stays open",
      "default": "7"
    }
  },
  "registryColumns": {
    "loaded": [
      "slug",
      "name",
      "kind",
      "governance",
      "transferable",
      "decimals",
      "active",
      "is_example"
    ],
    "notLoaded": [
      "sort_order",
      "created_at",
      "glyph",
      "spendable",
      "external_ref"
    ]
  }
}
```

## What this file is made from

The generator reads these and fails loudly if any of them moves:

- `drizzle`
- `server/lib/economy.ts`
- `server/lib/economySeed.ts`
- `server/lib/ledger.ts`
- `server/lib/spending.ts`
- `server/lib/stays.ts`
- `server/lib/library.ts`
- `server/lib/gameStart.ts`
- `server/lib/exit.ts`
- `server/lib/voiceClaim.ts`
- `shared/gameVariables.ts`

It also walks every `.ts` file under `server/` looking for a token registered at first start. Each one has to sit inside a function named `ensure…Token`, and a call anywhere else stops the build asking which kind it is. That is what stops a new module registering a token the document never mentions.

The seeded rows are produced by applying every token statement in `drizzle/` in migration order, rather than by reading the INSERTs alone. Two later migrations sweep the `transferable` column, and reading only the INSERTs would report recognition as sendable, which it has not been since `0092_token_sinks.sql`. The migrations that write the registry today: `drizzle/0006_token_registry.sql`, `drizzle/0007_village_credits_token.sql`, `drizzle/0047_example_market.sql`, `drizzle/0071_economy_core.sql`, `drizzle/0092_token_sinks.sql`, `drizzle/0124_the_equity_token_names_no_village.sql (read through a token-doc directive)`.

`server/db/tokenDoc.test.ts` runs every migration against a real MySQL and asserts the rows this generator computed are the rows the database actually holds, and that the faucet, sink and sending answers here match what the server's own functions return. The generator being wrong is a red test, not a quiet paragraph.
