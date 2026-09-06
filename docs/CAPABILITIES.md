# Capabilities

Every capability key the platform knows about, what each one lets a member do, and the order the one gate resolves them in. 31 keys, 7 steps.

There is ONE capability gate, `capabilityDecision()` in `shared/capabilities.ts`, and every permission answer in the product comes through it. The order it resolves in IS the policy: it decides whether a warning badge's deny survives an appointment, and whether an administrator still outranks a village on a power that village has taken over.

## How to read this file

This file is generated. `scripts/generate-capabilities-doc.mjs` reads `shared/capabilities.ts`, `shared/modules.ts` and `shared/gameConfig.ts`, derives the model, and writes the whole document. `scripts/check-capabilities-doc.mjs` regenerates it and fails the build when the committed text and the code have come apart.

Editing this file by hand does not hold. Change the code, then run:

```bash
node scripts/generate-capabilities-doc.mjs
```

Two kinds of line live here, and the difference matters:

- **Read from the code.** Every key, every label, every rung, every table, the order of the gate, the worked decisions, and the JSON block at the end. If one of these is wrong, the code is what is wrong.
- **Written by a person.** The one-sentence gloss on each step of the gate. It is stored inside the generator so this whole file stays generated, and a step with no gloss stops the build.

There is no timestamp and no author line, on purpose. Both would change on every run and turn an honest diff into noise. The git history is the record of when this changed.

## The order of authority

The gate takes a capability key and a member's context, and returns an answer with the step that decided it. The steps below are read out of `capabilityDecision()` in the order that function tests them. The FIRST step whose condition holds is the answer, and nothing below it is consulted.

In one line: `admin` then `admin-override` then `denied by warning badge` then `role` then `badge` then `stage` then `not granted`.

| Step | Decides | Answer | The condition, as the code writes it |
| --- | --- | --- | --- |
| 1 | `admin` | allowed | `ctx.isAdmin && !villageHolds` |
| 2 | `admin-override` | allowed | `ctx.isAdmin && villageHolds && ctx.adminOverride === true` |
| 3 | `denied by warning badge` | refused | `isDeniable(cap) && (ctx.badgeDenies ?? []).includes(cap)` |
| 4 | `role` | allowed | `ctx.roleCapabilities.includes(cap)` |
| 5 | `badge` | allowed | `(ctx.badgeCapabilities ?? []).includes(cap)` |
| 6 | `stage` | allowed | `unlockStage && unlockStage !== "none"` and `needed >= 0 && ctx.stageIndex >= needed` |
| 7 | `not granted` | refused | nothing above it decided |

**1. `admin`.** The deployment operator, on a key the village does NOT hold. It is the first thing the gate reads, so on those keys an admin passes whatever any badge, role or rung says.

Admin is scaffolding, and R54 is the ruling that says so: these villages are meant to be taken over by their electorate. This step is the operator acting on the parts they are still responsible for.

**2. `admin-override`.** The same operator on a key the village DOES hold, having said in the request that they mean to reach past the village. Everything below it is skipped.

The break-glass, for exactly one act. It never persists and it is never inferred. The gate reports `reachedPastVillage` so the caller cannot forget that it owes the village a record and a notification. It ships in the same commit as the ceiling above it, because a gate that can lock an operator out of a live village must never exist without its escape hatch.

**3. `denied by warning badge`.** An active warning badge naming this key. It sits ABOVE role, badge and stage, so an appointment does not override it. On a key the village holds it also reaches an admin who did not break the glass.

A warning a role trivially overrides is not a warning. The deny reaches only the keys `DENIABLE` marks as deniable, and it can never reach a voice: a badge naming one of those is ignored here, refused at save time, and cleared out of storage by migration.

**4. `role`.** An appointment. It beats badges and the ladder, and it loses to a deny on a deniable key.

The member holds a role whose `capabilities` list carries this key. A treasurer is a treasurer however many quests they have done, which is why this path exists beside the ladder.

**5. `badge`.** A badge the member earned or was granted. It beats the ladder, and it loses to a role and to a deny.

The grant half of the badge system. It is how a founder hands out a power that nobody should reach by climbing, the Cartographer badge over the village map being the worked example.

**6. `stage`.** The ladder everyone climbs. It is the last thing consulted, so every path above it can open a door earlier.

The member's computed stage is at or past the rung `STAGE_UNLOCKS` names. A village moves any rung with the `progression.unlock.*` variables, and the value `none` closes the stage path for that key entirely, leaving roles and badges as the way in.

**7. `not granted`.** Nothing granted it. The gate refuses, and the refusal is the answer callers act on.

This is the honest default. A key absent from `STAGE_UNLOCKS`, held by no role and carried by no badge, lands here for everybody who is not an admin.

The consequence worth holding onto: a deny beats an appointment. A village that hands somebody a role and then has to ask them to stop for a while has a remedy short of unseating them, and a warning that the next role grant would quietly cancel would be no warning at all.

## The gate, run

These rows are not a description of the order. They are answers: the generator calls the real `capabilityDecision()` with each context below and records what came back. A change to the gate changes this table, and the guard then fails until the document is regenerated.

| The member, and what they hold | Key | Allowed | Decided at |
| --- | --- | --- | --- |
| A member standing at the `member` rung, holding no role and no badge | `forum.post` | yes | `stage` |
| The same member one rung lower | `forum.post` | no | `not granted` |
| A member below the rung, holding a role that carries the key | `forum.post` | yes | `role` |
| A member below the rung, carrying a badge that grants the key | `forum.post` | yes | `badge` |
| A member at the rung AND holding the role, with a warning badge that denies the key | `forum.post` | no | `denied by warning badge` |
| A member holding the role, with a warning badge that denies a key no badge may deny | `mechanics.propose` | yes | `role` |
| An admin, on a key the village does not hold | `quest.consent` | yes | `admin` |
| An admin on a key the village HOLDS, with a warning badge denying it and no break-glass | `quest.consent` | no | `denied by warning badge` |
| The same admin, having broken the glass in the request | `quest.consent` | yes | `admin-override` (owes the village a record) |

## Every capability key

31 keys. `ALL_CAPABILITIES` is a flat list, so they are grouped here by the prefix each key carries in its own name, in the order the list gives them: `quest`, `forum`, `proposal`, `map`, `feed`, `stay`, `exchange`, `health`, `message`, `mechanics`, `event`, `org`, `ballot`, `member`, `intake`, `library`, `story`, `dial`.

Three columns need a word before the tables:

- **A warning badge may deny it.** `DENIABLE` in `shared/capabilities.ts`. A `no` marks a VOICE: a member's own say in a decision the village makes, which nothing may take away.
- **The village may hold it.** `TRANSFERABLE`. A `yes` means this key can leave the admin panel: once the village records a holder, an admin stops passing the gate by being an admin and has to reach past the village in the open.
- **Stage that unlocks it.** `STAGE_UNLOCKS`, against the ladder in `shared/gameConfig.ts`. A key with no rung is an appointment, reached by a role or a badge and never by climbing.

### `quest`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `quest.consent` | Release value on someone else's quest | yes | yes | no rung | Quests |
| `quest.approve` | Put a proposed quest on the board and set what it pays | yes | yes | no rung | no module |

### `forum`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `forum.post` | Start a thread in the forum | yes | no | `member` (rung 5 of 12) | Forum & Decisions |
| `forum.moderate` | Act on the community's behalf in the forum | yes | yes | no rung | Forum & Decisions |

### `proposal`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `proposal.open` | Open a governance decision | yes | no | `co-creator` (rung 9 of 12) | Stages & Roles |
| `proposal.decide` | Record a decision's outcome | yes | yes | no rung | Stages & Roles |

### `map`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `map.viewPeople` | See who holds seats on the village map | yes | no | `guest` (rung 2 of 12) | How Power Is Held |
| `map.contact` | Reach a role holder through the contact relay | yes | no | `member` (rung 5 of 12) | How Power Is Held |
| `map.edit` | Draft changes to the land in build mode | yes | no | no rung | no module |
| `map.publish` | Publish a draft onto the live map | yes | yes | no rung | no module |
| `map.photograph` | Add a photograph to a place on the map | yes | no | `member` (rung 5 of 12) | How Power Is Held |
| `map.curatePhotos` | Take a photograph down and choose a place's lead shot | yes | yes | no rung | How Power Is Held |

### `feed`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `feed.announce` | Post announcements to the village feed | yes | yes | no rung | Village Feed |

### `stay`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `stay.member_rate` | Book a stay at the member price | yes | no | `member` (rung 5 of 12) | Stays |

### `exchange`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `exchange.buy` | Buy listed tokens | yes | no | `member` (rung 5 of 12) | Exchange |
| `exchange.swap` | Swap one village token for another | yes | no | `member` (rung 5 of 12) | Exchange |
| `exchange.manage` | List tokens, post prices, and stock the treasury | yes | yes | no rung | Exchange |

### `health`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `health.record` | Log the land's own measurements | yes | yes | no rung | Village Health |

### `message`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `message.send` | Start a conversation and post to one | yes | no | `member` (rung 5 of 12) | Messages |

### `mechanics`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `mechanics.propose` | Propose a change to the game's rules | no | no | `member` (rung 5 of 12) | no module |

### `event`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `event.rsvp` | Say you are coming to a gathering | yes | no | `guest` (rung 2 of 12) | Village Calendar |
| `event.manage` | Put a gathering on the village calendar | yes | yes | no rung | Village Calendar |

### `org`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `org.declare` | Declare how the village holds power | yes | yes | no rung | no module |
| `org.seat` | Seat and unseat the holders of the village's seats | yes | yes | no rung | no module |
| `org.seatAgent` | Seat and unseat the software agents that hold seats | yes | yes | no rung | no module |

### `ballot`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `ballot.vote` | Cast a vote on a ballot | no | no | `member` (rung 5 of 12) | Governance |

### `member`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `member.vouch` | Vouch for an applicant | no | no | `contributor` (rung 6 of 12) | Governance |

### `intake`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `intake.moderate` | Work the village's queues and act on what gets reported | yes | yes | no rung | no module |

### `library`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `library.keep` | Keep the shared library and its loans | yes | yes | no rung | no module |

### `story`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `story.tell` | Say what the village is, in public, in its own words | yes | yes | no rung | no module |

### `dial`

| Key | What it lets a member do | A warning badge may deny it | The village may hold it | Stage that unlocks it | Declared by |
| --- | --- | --- | --- | --- | --- |
| `dial.set` | Turn the village's own dials | yes | yes | no rung | no module |

## The voices

3 of the 31 keys may never be taken away by a warning badge: `mechanics.propose`, `ballot.vote` and `member.vouch`. Each is a member's own say in a decision the village makes. The gate ignores a deny naming one of them, the badge validator refuses to save one, and a migration cleared the ones already stored. Three locks on the same door, because a hand-written UPDATE is invisible to code review by definition and a stored row outlives the admin who wrote it.

The rule underneath: waning is not removal. A rule under which unused voice decays over time is legitimate. An act by which one party strips another's earned voice is not, at any tier, held by anybody.

## The keys a village can take off the admin panel

17 of the 31 keys are marked transferable: `quest.consent`, `forum.moderate`, `proposal.decide`, `map.publish`, `map.curatePhotos`, `feed.announce`, `exchange.manage`, `health.record`, `event.manage`, `org.declare`, `org.seat`, `org.seatAgent`, `intake.moderate`, `library.keep`, `story.tell`, `dial.set` and `quest.approve`.

A key is only marked transferable once every route that REFUSES on it asks the gate in a shape that can carry the break-glass and write the public record. A ceiling an operator cannot climb over is not a ceiling, it is an outage. The keys left out are of two kinds: personal acts, where there is nobody for the key to move to, and keys nothing refuses on yet, where a promise that an admin must reach past the village in the open would have nothing under it.

## Which module declares which key

A module's `capabilities` array in `shared/modules.ts` is what that module ADDS to the one gate. It is never a second permission mechanism: the keys land in the same gate as everything else.

| Module | Id | Keys it declares |
| --- | --- | --- |
| Quests | `quests` | `quest.consent` |
| Stages & Roles | `progression` | `proposal.open`, `proposal.decide` |
| How Power Is Held | `map` | `map.viewPeople`, `map.contact`, `map.photograph`, `map.curatePhotos` |
| Forum & Decisions | `forum` | `forum.post`, `forum.moderate` |
| Village Feed | `feed` | `feed.announce` |
| Messages | `messaging` | `message.send` |
| Stays | `stays` | `stay.member_rate` |
| Village Health | `health` | `health.record` |
| Exchange | `exchange` | `exchange.buy`, `exchange.swap`, `exchange.manage` |
| Village Calendar | `events` | `event.rsvp`, `event.manage` |
| Governance | `governance` | `ballot.vote`, `member.vouch` |

11 keys are declared by no module: `map.edit`, `map.publish`, `mechanics.propose`, `org.declare`, `org.seat`, `org.seatAgent`, `intake.moderate`, `library.keep`, `story.tell`, `dial.set` and `quest.approve`. That is a fact about the registry and never a sign the key is dead. A key reaches the gate from any route that asks for it, and the admin surfaces the handover keys cover sit outside every module.

## Machine-readable

The same facts, in a shape a script can read. Regenerated with the rest of the file, so it cannot drift from the prose above it.

```json
{
  "counts": {
    "keys": 31,
    "steps": 7,
    "voices": 3,
    "villageHoldable": 17,
    "climbable": 13,
    "undeclared": 11
  },
  "resolutionOrder": [
    {
      "step": 1,
      "source": "admin",
      "allowed": true,
      "conditions": [
        "ctx.isAdmin && !villageHolds"
      ]
    },
    {
      "step": 2,
      "source": "admin-override",
      "allowed": true,
      "conditions": [
        "ctx.isAdmin && villageHolds && ctx.adminOverride === true"
      ]
    },
    {
      "step": 3,
      "source": "denied by warning badge",
      "allowed": false,
      "conditions": [
        "isDeniable(cap) && (ctx.badgeDenies ?? []).includes(cap)"
      ]
    },
    {
      "step": 4,
      "source": "role",
      "allowed": true,
      "conditions": [
        "ctx.roleCapabilities.includes(cap)"
      ]
    },
    {
      "step": 5,
      "source": "badge",
      "allowed": true,
      "conditions": [
        "(ctx.badgeCapabilities ?? []).includes(cap)"
      ]
    },
    {
      "step": 6,
      "source": "stage",
      "allowed": true,
      "conditions": [
        "unlockStage && unlockStage !== \"none\"",
        "needed >= 0 && ctx.stageIndex >= needed"
      ]
    },
    {
      "step": 7,
      "source": "not granted",
      "allowed": false,
      "conditions": []
    }
  ],
  "capabilities": [
    {
      "key": "quest.consent",
      "label": "Release value on someone else's quest",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": [
        "quests"
      ]
    },
    {
      "key": "forum.post",
      "label": "Start a thread in the forum",
      "deniable": true,
      "transferable": false,
      "stageUnlock": "member",
      "stageRung": 5,
      "modules": [
        "forum"
      ]
    },
    {
      "key": "forum.moderate",
      "label": "Act on the community's behalf in the forum",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": [
        "forum"
      ]
    },
    {
      "key": "proposal.open",
      "label": "Open a governance decision",
      "deniable": true,
      "transferable": false,
      "stageUnlock": "co-creator",
      "stageRung": 9,
      "modules": [
        "progression"
      ]
    },
    {
      "key": "proposal.decide",
      "label": "Record a decision's outcome",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": [
        "progression"
      ]
    },
    {
      "key": "map.viewPeople",
      "label": "See who holds seats on the village map",
      "deniable": true,
      "transferable": false,
      "stageUnlock": "guest",
      "stageRung": 2,
      "modules": [
        "map"
      ]
    },
    {
      "key": "map.contact",
      "label": "Reach a role holder through the contact relay",
      "deniable": true,
      "transferable": false,
      "stageUnlock": "member",
      "stageRung": 5,
      "modules": [
        "map"
      ]
    },
    {
      "key": "map.edit",
      "label": "Draft changes to the land in build mode",
      "deniable": true,
      "transferable": false,
      "stageUnlock": null,
      "stageRung": null,
      "modules": []
    },
    {
      "key": "map.publish",
      "label": "Publish a draft onto the live map",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": []
    },
    {
      "key": "map.photograph",
      "label": "Add a photograph to a place on the map",
      "deniable": true,
      "transferable": false,
      "stageUnlock": "member",
      "stageRung": 5,
      "modules": [
        "map"
      ]
    },
    {
      "key": "map.curatePhotos",
      "label": "Take a photograph down and choose a place's lead shot",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": [
        "map"
      ]
    },
    {
      "key": "feed.announce",
      "label": "Post announcements to the village feed",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": [
        "feed"
      ]
    },
    {
      "key": "stay.member_rate",
      "label": "Book a stay at the member price",
      "deniable": true,
      "transferable": false,
      "stageUnlock": "member",
      "stageRung": 5,
      "modules": [
        "stays"
      ]
    },
    {
      "key": "exchange.buy",
      "label": "Buy listed tokens",
      "deniable": true,
      "transferable": false,
      "stageUnlock": "member",
      "stageRung": 5,
      "modules": [
        "exchange"
      ]
    },
    {
      "key": "exchange.swap",
      "label": "Swap one village token for another",
      "deniable": true,
      "transferable": false,
      "stageUnlock": "member",
      "stageRung": 5,
      "modules": [
        "exchange"
      ]
    },
    {
      "key": "exchange.manage",
      "label": "List tokens, post prices, and stock the treasury",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": [
        "exchange"
      ]
    },
    {
      "key": "health.record",
      "label": "Log the land's own measurements",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": [
        "health"
      ]
    },
    {
      "key": "message.send",
      "label": "Start a conversation and post to one",
      "deniable": true,
      "transferable": false,
      "stageUnlock": "member",
      "stageRung": 5,
      "modules": [
        "messaging"
      ]
    },
    {
      "key": "mechanics.propose",
      "label": "Propose a change to the game's rules",
      "deniable": false,
      "transferable": false,
      "stageUnlock": "member",
      "stageRung": 5,
      "modules": []
    },
    {
      "key": "event.rsvp",
      "label": "Say you are coming to a gathering",
      "deniable": true,
      "transferable": false,
      "stageUnlock": "guest",
      "stageRung": 2,
      "modules": [
        "events"
      ]
    },
    {
      "key": "event.manage",
      "label": "Put a gathering on the village calendar",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": [
        "events"
      ]
    },
    {
      "key": "org.declare",
      "label": "Declare how the village holds power",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": []
    },
    {
      "key": "ballot.vote",
      "label": "Cast a vote on a ballot",
      "deniable": false,
      "transferable": false,
      "stageUnlock": "member",
      "stageRung": 5,
      "modules": [
        "governance"
      ]
    },
    {
      "key": "member.vouch",
      "label": "Vouch for an applicant",
      "deniable": false,
      "transferable": false,
      "stageUnlock": "contributor",
      "stageRung": 6,
      "modules": [
        "governance"
      ]
    },
    {
      "key": "org.seat",
      "label": "Seat and unseat the holders of the village's seats",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": []
    },
    {
      "key": "org.seatAgent",
      "label": "Seat and unseat the software agents that hold seats",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": []
    },
    {
      "key": "intake.moderate",
      "label": "Work the village's queues and act on what gets reported",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": []
    },
    {
      "key": "library.keep",
      "label": "Keep the shared library and its loans",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": []
    },
    {
      "key": "story.tell",
      "label": "Say what the village is, in public, in its own words",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": []
    },
    {
      "key": "dial.set",
      "label": "Turn the village's own dials",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": []
    },
    {
      "key": "quest.approve",
      "label": "Put a proposed quest on the board and set what it pays",
      "deniable": true,
      "transferable": true,
      "stageUnlock": null,
      "stageRung": null,
      "modules": []
    }
  ],
  "workedDecisions": [
    {
      "who": "A member standing at the `member` rung, holding no role and no badge",
      "key": "forum.post",
      "allowed": true,
      "source": "stage",
      "reachedPastVillage": false
    },
    {
      "who": "The same member one rung lower",
      "key": "forum.post",
      "allowed": false,
      "source": "not granted",
      "reachedPastVillage": false
    },
    {
      "who": "A member below the rung, holding a role that carries the key",
      "key": "forum.post",
      "allowed": true,
      "source": "role",
      "reachedPastVillage": false
    },
    {
      "who": "A member below the rung, carrying a badge that grants the key",
      "key": "forum.post",
      "allowed": true,
      "source": "badge",
      "reachedPastVillage": false
    },
    {
      "who": "A member at the rung AND holding the role, with a warning badge that denies the key",
      "key": "forum.post",
      "allowed": false,
      "source": "denied by warning badge",
      "reachedPastVillage": false
    },
    {
      "who": "A member holding the role, with a warning badge that denies a key no badge may deny",
      "key": "mechanics.propose",
      "allowed": true,
      "source": "role",
      "reachedPastVillage": false
    },
    {
      "who": "An admin, on a key the village does not hold",
      "key": "quest.consent",
      "allowed": true,
      "source": "admin",
      "reachedPastVillage": false
    },
    {
      "who": "An admin on a key the village HOLDS, with a warning badge denying it and no break-glass",
      "key": "quest.consent",
      "allowed": false,
      "source": "denied by warning badge",
      "reachedPastVillage": false
    },
    {
      "who": "The same admin, having broken the glass in the request",
      "key": "quest.consent",
      "allowed": true,
      "source": "admin-override",
      "reachedPastVillage": true
    }
  ],
  "stageLadder": [
    "visitor",
    "guest",
    "immersant",
    "participant",
    "member",
    "contributor",
    "quest-seeker",
    "initiate",
    "co-creator",
    "role-holder",
    "guide",
    "sage"
  ]
}
```

## What this file is made from

The generator reads these and fails loudly if any of them moves:

- `shared/capabilities.ts`
- `shared/modules.ts`
- `shared/gameConfig.ts`

The keys, the labels and the three maps are read by transpiling `shared/capabilities.ts` and importing it, so they are the values the running product holds. The order of authority is parsed out of `capabilityDecision()` statement by statement: a shape the reader does not recognise stops the build, because a step skipped in silence would be a step missing from a document whose subject is which step wins.

Four disagreements fail the build on their own, and each one has shipped somewhere as a quiet bug: a key in the `Capability` union with no entry in `ALL_CAPABILITIES` (ungrantable by badges while every surface offers it), a key with no line in `DENIABLE` or `TRANSFERABLE`, a step the gate returns that `CapabilitySource` does not declare, and a rung naming a stage the ladder does not have.

`shared/capabilities.test.ts` holds the same agreements as running assertions, so the compiler, the suite and this document all read the one model.
