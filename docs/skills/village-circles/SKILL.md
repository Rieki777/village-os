---
name: village-circles
description: Everything the circles map (How Power Is Held, /map/circles) can show and every rule it keeps, so you can help the founder you serve organise their village's circles and roles from what they give you. You prepare the structure and the exact steps; the founder, or whoever holds the power, makes every change.
version: 1.0.0
metadata:
  platform: village-coordination
  auth: none for the reads below when the village shows its structure to visitors; the founder pastes anything else
  scopes: none (no agent scope writes circles or roles)
  related: village-map (the land map, drafted from a masterplan)
---

# Village circles

You are one founder's own agent. They give you what they know about their village: a list of teams, a charter, meeting notes, an org chart, a voice memo. You turn it into the structure this platform draws on the circles map, check it against the rules below, and hand it back as a plan they can enter or adopt. You change nothing yourself: no agent scope writes circles or roles, and that is deliberate.

The land map (where buildings and zones sit) is a different skill: `/api/agent/v1/skills/village-map/SKILL.md`.

## Lines that never move

1. **Call them roles.** The positions people hold in circles are roles. A role has holders and openings: "holds up to 3 people", "1 opening", "2 of 3 held". The verb is fine: seat someone, unseat. The village's own word for a place at a gathering is the only other use.
2. **Name the role, never the person.** In every word you draft (purposes, accountabilities, proposals, ballot text), write "the Operations role" or "the founder", never a holder's name. Roles change hands; the words must stay true.
3. **Invent nothing.** Every circle, role and responsibility comes from what the founder gave you. If something seems missing, ask; never add a circle because villages like this usually have one.
4. **Never name who holds a role in anything a machine sends.** Who sits in a role is a human act, done by a human in the platform. You may say a role is open and what it needs.
5. **Propose freely, adopt by power.** Anyone may propose a change. Adopting it follows whoever holds the power: the role holding `org.decide` publishes, or the village votes when nobody holds it. You never adopt.
6. **Every role has a term.** A seating always carries an end: a date, or the season. Never draft a seating without one.

## What the map draws

**The village** is the outer ring. Inside it sit **circles**, and circles can sit inside other circles (one parent each, never a loop). Each circle carries its own **roles**. A role with no circle is a village-wide role and rides the outer ring.

**Shape.** The village declares how power is held, and the picture morphs to match: `steward`, `pyramid`, `council`, `circle` (the default: peers in a ring, a lead who facilitates), `network`, `flat`, or `other` (with a one-line gloss). Only someone allowed to declare for the village changes it.

**The middle of each circle.** A circle with the governance layer `link` or `lead` holds the middle of the circle it sits inside. The rest ring it, ordered by layer (`operating`, then `advisory`, then `council`), then by the village's own order, clockwise from twelve. With no layer set anywhere in a pack, the biggest circle keeps the middle. Layers: `link` (the circle that links the others), `lead` (holds the middle), `operating` (does the work), `advisory` (counsels), `council`. Unset means operating.

**The forming band.** A circle with status `forming`, no roles and no circles inside it is drawn as an arc of a band just inside its container's edge, with its name along it: a horizon of what the village has named and not started. Give it a role, or start it (status `active`), and it moves into the ring as a circle. A forming circle that has roles stays a circle, drawn dashed and hatched.

**Roles from afar and up close.** Looking at the whole village, each circle's border is a meter of its roles: one segment per opening, held ones solid in the circle's colour, open ones thin amber, a holder whose term has ended dashed, roles still forming dotted. Step into a circle and each role becomes its own glyph with the holder's face or initials, the term arc, and a ring when the role speaks for its circle in the one above.

**The double link.** A role marked `representsCircle` speaks for its circle in the parent circle; the map joins it to the parent with a dashed line.

**Counts.** One line above the map says the whole village, for example "6 circles at work, 11 forming, 16 openings." The village's own circles and roles are counted; the practice examples only while it has nothing of its own.

**The circle wall.** Every circle as a card: its icon, purpose, a held/places meter, "1 of 4 held, 3 open", openings first. It is the List view on a wide screen and the page under the small map on a phone.

**Lenses.** How we decide (colours circles by how they decide), Links (relations between roles and circles), Resources (when that module is on), Vision (open drafts drawn as ghosts, each with objectives that say when it should be adopted). Filters: open roles, my roles, ending soon, one circle.

## What each thing holds, and the limits

**A circle**

| Field | What it is | Limit or rule |
|---|---|---|
| name | What the map, /circles and /roles print | Required, at most 120 characters. Long words shrink the circle's label, so prefer plain names |
| purpose | What the circle is for | Written when the circle is made; after that it changes only by consent, proposed on the circle's card |
| status | `active`, `forming` or `dormant` | Forming with no roles rides the band |
| sits inside | Its parent circle, or the top of the village | No loops, not inside itself, not inside a practice example |
| layer | `link`, `lead`, `operating`, `advisory`, `council`, or none | Decides the middle and the ring order |
| order | Its place among its siblings | Whole number; sets the clockwise order |
| icon | A lucide icon name, for example `Sprout`, `Crown`, `Handshake`, `BookOpen`, `Heart`, `Hammer`, `TreePine` | Unknown names draw a plain dot |
| colour | A tone word such as `sage`, `amber`, `coral`, `rose`, `stone`, `teal`, `sky`, `emerald` | Unknown values get a steady colour of their own |
| decides by | `consent`, `consensus`, `majority`, `lead_decides`, `elders_decide`, `founder_decides`, `do_ocracy`, `delegated`, `hypha`, `other` (with a gloss) | Falls back to the village's own way |
| decides by, per domain | A different way for `money`, `people`, `space_land` or `rules` | Optional |
| aliases | Other names it answers to, for search | Each resolves to one circle only |

**A role**

| Field | What it is |
|---|---|
| name | The role's title, the words every page and proposal prints |
| circle | The circle it belongs to, or none for a village-wide role |
| holds up to | How many people may hold it at once (its places) |
| domain | What it decides on |
| accountabilities | What it is answerable for: 3 to 6 short lines |
| why it matters | The one line that says why the village has this role |
| how chosen | `appointed_by_lead`, `elected_by_circle`, `rotates`, `volunteers`, `founder_appoints`, `other` |
| term | When the current holding ends: a date or the season |
| speaks for its circle | `representsCircle`: the double link into the parent |
| criticality, recruiting | `high` or `normal`; whether the village is actively looking |
| handover words | bring me, not mine, runbook |
| charter words | exists while, authorities, responsibilities, signs it is stretched, what flows back, when to step back, time commitment |

A role's state is derived, never typed: open (nobody holds it), partly held, held, forming (declared), or ready to be re-chosen (its term reached its date; the holder is still holding it).

**Relations** link roles and circles with village-editable types: deputy, successor, mentor, prerequisite, works with, escalation.

## How a change gets made

| Change | Who | Where |
|---|---|---|
| Make a circle, rename it, change status, sits inside, governance layer | An admin | Admin, Org Chart |
| Arrange circles: nest one inside another, and (once released) reorder and set the middle | Whoever may publish an org draft: a holder of `org.decide` (stewards by default, or any role the village gives it to), or an admin until the village's launch vote | The circles map, Arrange circles |
| Change a circle's purpose or other card words | Anyone holding a role in that circle, or an admin, proposes; adopted like any draft | The circle's card, `/circles/<id>` |
| Propose new roles or changes to roles | Members, from their player card; the circle consents within two business days | Player card, role proposals |
| Seat someone in a role | The holder of `org.seat`, after the circle consents; always with a term | Admin, Org Chart, or the role's card |
| Put a whole reorganisation to the village | Any member when the village holds the power or nobody does; only the holder when a role holds it | The draft's decide page |
| Declare the village's shape and default way of deciding | Whoever may declare for the village | The map's side panel, Shape |

A reorganisation is an **org draft**: a list of changes, previewed in words against the village as the draft leaves it, then published by power or put to a vote. A refused change says why in a sentence. A published draft can be reverted by an admin while what it changed is still what it left.

## What you can read

- `GET /api/map` and `GET /api/org`, with no token, when the village shows its structure to visitors (the dial "Show the map's structure to visitors"). Holders' names appear only to members allowed to see people, so a visitor read has none. Your agent token is refused outside `/api/agent/v1/`, so do not send it here.
- Otherwise, ask the founder to paste or export what you need.

`/api/map` gives you `circles` (with `status`, `parentCircleId`, `order`, `icon`, `color`, `layer`, `decidesBy`), `roles` (with `seats`, `holderCount`, `vacant`, `state`, `representsCircle`, `termEnds`), `relations`, `power` (shape, way of deciding, and the glossary of every vocabulary above) and `season`.

## Organising a village from what the founder gives you

1. **Read everything first.** List each group of people, each recurring responsibility and each decision that gets made, with the words the founder used.
2. **Find the circles.** A circle is a group that decides something together and has work of its own. Name it in the founder's words. Mark the ones that exist on paper only as `forming`.
3. **Find the roles.** For each circle: the roles, what each is accountable for (3 to 6 lines), its domain, how many people it holds, how it is chosen, and its term. Leave holders out.
4. **Place them.** Which circle sits inside which. Which circle links the others (`link`) or holds the whole (`lead`), and the order the rest should meet a reader in. Which role speaks for each circle in its parent.
5. **Say how each decides,** and any domain that decides differently.
6. **Check it** against the lines above and the limits: no loops, names under 120 characters, 3 to 6 accountabilities, a term on every seating, no person named, nothing invented.
7. **Hand it back** as three parts:
   - **The picture in words**: the middle, the ring in order, what rides the forming band, and the counts line it will show.
   - **The steps**: each change, who may make it and where (table above), in an order that never passes through a loop (move a circle out before moving its old parent in).
   - **What you guessed or could not tell**, so the founder decides it.

Ask before you assume. If two readings are possible, offer both and say which you would pick and why.
