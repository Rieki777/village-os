# The canvas frames API (server half, Wave 3a)

What the five-frame canvas page reads and writes. Written for the lane that builds the UI against
it; `server/routes/canvasFrames.ts` is the implementation and changes with this file. Plan: section
2.3 of the Governance Canvas weave plan of 2026-09-24, which lives outside this repository in the
coordinator's governance sources ("Five frames", "Make it real", "Text-bearing objects", "Three
pens").

Every route here is core (no module switch stands in front of it) and is for the village's admitted
members and its admins. A visitor with no session gets `401 { "error": "auth_required" }`. A
signed-in account the village has not admitted gets `403 { "error": CANVAS_MEMBERS_ONLY }`, the
sentence `server/routes/canvas.ts` exports. Every refusal below carries `error` as a sentence a
member can read, unless it says otherwise.

The existing canvas routes are unchanged and still serve the Sense frame's history:
`GET /api/canvas` (every block's readings) and `POST /api/canvas/readings` (record a reading),
both in `server/routes/canvas.ts`. The generated half of the Decision Matrix is still
`GET /api/canvas/decision-matrix` (`server/routes/decisionMatrix.ts`).

## The vocabulary

Shared with the client in `shared/canvasFrames.ts` and `shared/powerHands.ts`. Import from there;
do not restate these lists.

| Name | Values |
| --- | --- |
| `CanvasBlockId` | the twelve ids in `CANVAS_BLOCK_IDS` (`shared/governanceCanvas.ts`) |
| `ProposalTarget` | `words` (a brief section), `purpose` (the governing purpose statement), `setting` (a setting behind a door), `matrix` (a human row of the Decision Matrix) |
| `ProposalSource` | `member`, `derived` (drafted from the live system), `import` |
| `ProposalStatus` | `open`, `adopted`, `declined`. A suggestion moves once and is never reopened |
| `CanvasDoorId` | `dial:membership.vouches_required` and `exit:terms` (Team), `dial:governance.default_method` and `module:governance` (Power), `exit:restorative` (Conflict), `dial:ledger.admin_mint_cycle_cap` (Resourcing) |
| `CanvasPen` | `purpose`, `prose`, `consequence`, `dial`, `module`, `admin` |

What each target can carry, and where:

| Target | Blocks | Required fields | `change` |
| --- | --- | --- | --- |
| `words` | any block with brief sections | `sectionId`, one of the block's `briefSections` | none |
| `purpose` | `purpose` only | `body` is the statement itself, held to `purposeStatementProblem` | none |
| `setting` | the door's block only | `door` | a dial door: `{ "value": string }`; `module:governance`: `{ "to": <lifecycle> }`, one of `off`, `preview`, `members`, `public`; `exit:terms`: any of `noticePeriodDays` (whole days), `valuationMethod`, `unwindSteps` (string[]), `involuntaryProcess`; `exit:restorative`: any of `steps` (string[]), `intakeContactRole` (a role id, or `""`), `coverRole`, `replyHours` (whole hours, or `null`). At least one field |
| `matrix` | `power` only | `change` | `{ rowId?, subject, approval, consultation, information, method?, riskTags?: string[] }` |

The settings plan 2.3 maps to Roles (seat terms) and Meetings (the season's dates) have no door yet. A suggestion cannot carry a value for
them; the block's `doors` list names each with `wired: false`, a link to its own control and a
sentence saying why.

### The purpose line (`servesPurpose`)

Exists only on suggestions to the Power, Conflict, Roles and Resourcing blocks and on `matrix`
suggestions (`servesPurposeScoped`). On every other suggestion the field does not exist: sending a
non-empty one is refused (400), and the response carries no `servesPurpose` key at all.

Where it exists, it is REQUIRED once the village has written its governing purpose statement, with
the ballot's own floor and ceiling (at least 12 words, at most 2000 characters). Before a statement
is written it is welcome and not demanded, the same rule the ballots apply
(`purposeAlignmentRefusal`). The block's `servesPurpose.requiredToday` says which is true now.

## The pens: who adopts

One predicate, `whoAdoptsCanvasAnswer(pen, { birthed, handoverComplete })` in
`shared/powerHands.ts`, built on `whoMayPutHandToVillage`. "The Birthing" is the Game starting
(`readGameStart().started`); "the handover" is every transferable power moved out of the founding
seat (`villageHandoverState().complete`).

| Pen | Covers | Before the Birthing | After the Birthing |
| --- | --- | --- | --- |
| `prose` | `words` in any section but the four below | `story.tell`, asked of the one gate | the same |
| `admin` | `words` in `people`, `legal`, `land`, `constraints` | administrators | administrators |
| `purpose` | `purpose` | the founders (the same `isAdmin` test `PUT /api/admin/purpose` applies), until the handover | the same until the handover; after it, a vote through `POST /api/governance/purpose-changes` |
| `dial` | the three dial doors | `dial.set`, asked of the gate inside the dial write | the member who wrote the suggestion files it as a mechanics proposal in their own name; the village votes |
| `module` | `module:governance` | administrators (the lifecycle route's own guard) | a mechanics proposal for a module a vote can move; the governance module is never moved by a change set (`NEVER_BY_CHANGESET`), so it stays with administrators |
| `consequence` | `exit:terms`, `exit:restorative`, `matrix`, and the matrix rows below | administrators; for `exit:restorative`, only while no conflict agreement is stored (once one is, adopting answers 409 `restorative_in_agreement` with `CARE_DOOR_IN_AGREEMENT`, and the agreement is changed on /governance) | a vote of the whole village at the structural tier. For `exit:terms` and the matrix it is **not built yet**: adopting answers 409 `CONSEQUENCE_VOTE_NOT_BUILT` and the suggestion stays open. For `exit:restorative` the vote is the conflict agreement's own (`POST /api/governance/conflict-agreement-changes`), which carries the whole agreement, so adopting answers 409 `CARE_DOOR_IS_THE_AGREEMENT_VOTE` and the suggestion cannot go to it as it stands |

Each proposal and each block carries a `PenView` so the page can name the pen and offer a button
only where it will work:

```json
{
  "pen": "prose",
  "how": "act",            // "act": the pen writes now. "ballot": adopting files the village's decision
  "who": "the-gate",       // "the-gate" | "admins" | "founders" | "any-member" | "live-holders"
  "sentence": "Whoever holds the village's story adopts these words.",
  "ballotBuilt": true,     // false only for the consequence pen after the Birthing
  "youMayAdopt": false     // this viewer, asked without side effects; the write still asks the real guard
}
```

Where adopting files a mechanics proposal (the `dial` pen, and a `module` pen a vote can move, after
the Birthing), a suggestion's `pen.youMayAdopt` is true for its author only: the proposal carries
the filer's name, standing and per-cycle count. On a block's own `pens`, the same key says whether
this person may file suggestions of their own.

## GET /api/canvas/blocks/:id

One block, everything its five frames need. `404` for an id that is not a canvas block.

```json
{
  "block": {
    "id": "team", "number": 2, "name": "Team",
    "question": "...", "prompts": ["..."],            // our own words
    "foundations": ["culture", "personal-leadership"],
    "briefSections": ["membership", "people"],
    "seasonWeeks": [3, 6, 11],
    "elsewhere": { "note": "...", "href": "...", "label": "..." },   // only on a block with no section (Conflict)
    "canvasText": { "question": "...", "description": "..." },      // the canvas's own words
    "credit": { "text": "...", "url": "..." }                        // show wherever a block renders
  },
  "answer": {                                          // SAY
    "sections": [
      { "id": "membership", "title": "...", "readable": true, "status": "confirmed",
        "body": "...", "audience": "member", "updatedAt": "ISO", "revision": 3 },
      { "id": "people", "title": "...", "readable": false, "status": "admin-only" }
    ],
    "purposeStatement": { "statement": "...", "writtenAt": "ISO" }   // Purpose block only; null when none is written
  },
  "reading": {                                         // SENSE: this block's newest reading, or null
    "id": 7, "level": 3, "word": "Emerging", "sentence": "...",
    "moment": "baseline", "momentLabel": "Baseline",
    "recordedBy": { "id": "u1", "name": "Ash" }, "recordedAt": "ISO"
  },
  "observed": [                                        // SEE: plain facts, each with its control
    { "id": "vouches", "text": "A newcomer becomes a member after 2 vouches.", "href": "/game-mechanics", "label": "How members are admitted" }
  ],
  "proposals": [ /* ProposalView, open ones, newest first */ ],
  "decided": [ /* DecidedView, decided ones, newest decision first, at most 25 */ ],
  "doors": [
    { "id": "dial:membership.vouches_required", "label": "...", "href": "/game-mechanics", "kind": "dial", "wired": true,
      "dial": { "key": "membership.vouches_required", "label": "...", "type": "integer", "unit": "vouches",
                "min": 0, "max": 20, "choices": null, "value": "2" } },   // dial doors only
    { "label": "The term on each seat", "href": "/roles", "why": "...", "wired": false }
  ],
  "pens": { "words": PenView, "adminWords": PenView, "purpose": PenView, "dial": PenView, "module": PenView, "consequence": PenView },
  "birthed": false,
  "careDoorInAgreement": false,        // Conflict only: before the Birthing, a stored agreement holds the care door
  "servesPurpose": { "scoped": false, "matrixScoped": false, "requiredToday": true },
  "notesArePublic": "Everyone in the village can read what you write here."
}
```

- `answer.sections`: an admin reads every row. A member reads rows whose audience is `member`, and
  NEVER `people`, `legal`, `land` or `constraints`, which come back `readable: false` with no body.
  `status` is `confirmed` (adopted), `proposed` (a draft the guide or intake wrote), `blank`
  (nothing written), `not-shared` (written, and not opened to members; no body) or `admin-only`.
- `observed` never carries a score, a percentage or an "N of M". A fact the viewer may not read is
  absent. A read that failed says `"This could not be read just now."` with its link. The facts per
  block are listed in the header of `server/lib/canvasObserved.ts`.
- `pens` carries only the keys that apply to the block.
- `doors[].dial` is the dial a dial door names, from the registry, with its value today, WHATEVER
  the owning module's lifecycle (the ruling of 2026-09-25: every dial is visible). The suggestion
  box reads it from here and never from `GET /api/game/mechanics`, which hides a module's dials
  below members.
- `decided` lists the block's decided suggestions under the same reading rule as `proposals`: who
  decided each, when, how, and the note. A decision note is public (Rye, 2026-09-23), and this is
  where it is read back.
- `notesArePublic` is shown above the suggestion box before anybody types (Rye's ruling that notes
  are public, 2026-09-23). On a suggestion to one of the four administrators' sections the page
  says who reads it instead: the administrators and its author.

## POST /api/canvas/proposals

Any admitted member or admin. Nothing is gated on a power: suggesting is free (Rye, 2026-09-24 and
2026-09-25).

Request:

```json
{
  "blockId": "power",
  "target": "setting",                 // default "words"
  "sectionId": "decisions",            // words only
  "door": "dial:governance.default_method",   // setting only
  "change": { "value": "consent" },    // setting and matrix only
  "body": "Decide by consent. It suits how we already talk.",   // 2 to 40000 characters
  "servesPurpose": "...",              // only where scoped, see above
  "source": "member"                   // "derived" and "import" are an administrator's to set
}
```

Responses:

- `201 { "proposal": ProposalView }`
- `400` the shape, the section, the door, the value's form, the purpose line, or a purpose statement
  too short to ever be adopted, each with its sentence. A dial value the dial itself never takes is
  refused here in the dial's own terms (a choice dial names its choices by label). A matrix
  suggestion that names a `rowId` is refused: a suggestion only ever adds a row.
- `403` a non-administrator marking a suggestion `derived` or `import`
- `429` twenty suggestions already open from this member (`OPEN_PROPOSALS_PER_MEMBER`)

```json
// ProposalView
{
  "id": 12, "blockId": "power", "target": "setting",
  "sectionId": null, "door": "dial:governance.default_method", "change": { "value": "consent" },
  "body": "...",
  "servesPurpose": "...",              // present only where scoped; null when none was given
  "source": "member",
  "proposedBy": { "id": "u1", "name": "Ash" },   // first name, as every public line
  "createdAt": "ISO",
  "status": "open",
  "decidedBy": "u2", "decidedByName": "Moss", "decisionNote": "...", "decidedAt": "ISO", "outcome": { },   // once decided only
  "cannotAdopt": "...",                // present when adopting is certain to be refused today, as the sentence why
  "pen": PenView,
  "youProposedIt": true
}

// DecidedView
{
  "id": 9, "blockId": "power", "target": "words", "sectionId": "decisions", "door": null, "change": null,
  "body": "...", "servesPurpose": "...", "source": "member",
  "proposedBy": { "id": "u1", "name": "Ash" }, "createdAt": "ISO",
  "status": "declined",
  "withdrawn": false,                  // declined by its own author
  "filed": false,                      // adopted by filing a mechanics proposal
  "decidedBy": { "id": "u2", "name": "Moss" }, "decidedAt": "ISO",
  "decisionNote": "...",               // null when none was written
  "youProposedIt": false
}
```

A suggestion to one of the four administrators' sections is listed, open or decided, only to
administrators and to the member who wrote it.

`cannotAdopt` is set today on one case: a care-door suggestion before the Birthing while a conflict
agreement is stored, which `saveExitPolicy` refuses. The page offers no Adopt there; the pen can
still decline it.

## POST /api/canvas/proposals/:id/adopt

Body: `{ "note"?: string }` (at most 2000 characters, recorded as the decision note).

What adopting does, by pen and moment:

| Pen | Writes, through | Outcome |
| --- | --- | --- |
| `prose`, `admin` | `briefWrite`, confirmed by the adopter; the section's audience is left where it was | `{ "wrote": "brief-section", "section", "revision" }` |
| `purpose`, before the handover | `founderPenRefusal`, then `writeGoverningPurpose` | `{ "wrote": "purpose-statement", "writtenAt" }` |
| `dial`, before the Birthing | `writeDial` (the body of `PUT /api/admin/variables/:key`) | `{ "wrote": "dial", "key", "value", "previous" }` |
| `dial`, after the Birthing | `openMechanicsProposal` (the body of `POST /api/game/mechanics/proposals`), filed by the suggestion's author and nobody else | `{ "filed": "mechanics-proposal", "id", "status" }`; `status` is `open`, or `draft` when the author is below the proposer bar, and `message` then says it waits for a sponsor |
| `module` (administrators) | `setModuleLifecycle`, the write behind `PUT /api/admin/modules/:id/lifecycle`, with its shared-password posture; no example content is seeded | `{ "wrote": "module-lifecycle", "module", "lifecycle" }` |
| `consequence`, before the Birthing | `saveExitPolicy` (the body of `PUT /api/admin/exit-policy`) with the suggestion's fields laid over the policy, or `writeDecisionMatrixRow` (always a new row) | `{ "wrote": "exit-policy", "door", "fields" }` or `{ "wrote": "matrix-row", "rowId" }` |

Responses:

- `200 { "proposal": ProposalView, "outcome": {...}, "message": "Adopted. ..." }`. A module's
  lifecycle is said in words ("on for members"), never its code. The member who made the
  suggestion is told (a `governance` notice, dedupe key `canvas-proposal:<id>:adopted`), unless
  they adopted it themselves.
- `403 { "error": PEN_REFUSALS[pen] }` the person does not hold the pen. On the `prose` pen the
  refusal comes from the gate itself, so an admin on a key the village holds meets the gate's `409`
  override answer instead.
- The setting's own refusal, passed through as it came: for example `400 { "error": "Must be one of: ..." }`
  from the dial write, `400 { "error": "unknown_role", "message": "..." }` from the exit-policy
  save, `429` from the mechanics proposal's per-cycle ceiling. **The suggestion stays open** and
  nothing is recorded as adopted.
- `403 { "error": FILED_BY_PROPOSER }` anybody but the author pressing Adopt on a suggestion that
  files a mechanics proposal. The suggestion stays open.
- `409 { "error": CONSEQUENCE_VOTE_NOT_BUILT }` the consequence pen after the Birthing, for the exit
  terms and the matrix
- `409 { "error": CARE_DOOR_IS_THE_AGREEMENT_VOTE }` the care door (`exit:restorative`) after the
  Birthing: its vote is the conflict agreement's own, opened from /governance
- `409 { "error": "restorative_in_agreement", "message": CARE_DOOR_IN_AGREEMENT }` the care door
  before the Birthing, once a conflict agreement is stored: the agreement holds those fields
- `409 { "error": "...", "door": "/api/governance/purpose-changes" }` the purpose statement after the
  handover: the change vote has its own route (a `proposal.open` holder opens it, with a purpose line)
- `409` already adopted or declined, or somebody deciding it at this moment (`BEING_DECIDED`)
- `404` no suggestion by that number

## POST /api/canvas/proposals/:id/decline

Body: `{ "note"?: string }`.

- The member who wrote the suggestion may withdraw it at any time, with or without a note. It is
  recorded as `declined` with `outcome: { "withdrawn": true }`.
- Anybody else needs the suggestion's pen (the same pen as adopting) and a note of at least two
  characters (`400` without one). The note is public, like the suggestion: it is listed with it
  under `decided`, and the member who made it is told (a `governance` notice, dedupe key
  `canvas-proposal:<id>:declined`; the note travels in it except on the four administrators'
  sections).
- Where the pen is a vote (`how: "ballot"`), nobody declines alone: `409`, and only the proposer can
  withdraw.
- `200 { "proposal": ProposalView }`; `403`, `404` and `409` as for adopt.

## The Decision Matrix's human rows

The human columns only; the platform half is generated on every read by
`GET /api/canvas/decision-matrix`. Risk tags are information and never change who decides or how.

```json
// MatrixRowView
{
  "id": 3, "subject": "Spending under a hundred",
  "approval": "The treasurer", "consultation": "Nobody", "information": "The circle",
  "method": "Advice", "riskTags": ["money"],
  "updatedBy": { "id": "u2", "name": "Moss" }, "updatedAt": "ISO"
}
```

| Route | Who | Body | Answers |
| --- | --- | --- | --- |
| `GET /api/canvas/decision-matrix/rows` | members and admins | none | `200 { "rows": MatrixRowView[], "pen": PenView, "riskTagsAreInformation": "..." }` |
| `POST /api/canvas/decision-matrix/rows` | the consequence pen | `{ subject, approval, consultation, information, method?, riskTags? }` | `201 { "row" }`, `400` (each column is required; "Nobody yet" is an answer), `403`, `409` after the Birthing |
| `PUT /api/canvas/decision-matrix/rows/:id` | the consequence pen | the same | `200 { "row" }`, `404` no such row |
| `DELETE /api/canvas/decision-matrix/rows/:id` | the consequence pen | none | `200 { "removed": id }`, `404` |

After the Birthing every write answers `409` and says to suggest the row on the Power block (a
`matrix` suggestion), which waits for the structural vote.

## Limits the UI should know

- Twenty open suggestions per member across the whole canvas.
- A suggestion body is 2 to 40000 characters; a matrix cell up to 2000; a subject up to 200; up to
  12 risk tags of up to 40 characters each, no commas.
- The one notification is to a suggestion's author when somebody else adopts or declines it. Nothing
  here writes to the public pulse, except adopting a purpose statement, which writes the same pulse
  line `PUT /api/admin/purpose` writes. Every adopt, decline, withdraw and matrix write leaves an
  admin audit event.

## The Learn frame's resources (Wave 4)

`server/routes/canvasResources.ts`, over the `canvas_resources` table (migration 0224). The rows
come from the Governance Canvas Database, a public spreadsheet kept by the Bioregional Weaving Labs
Collective and Commonland: its five public columns only, read nightly by the job
`canvas-resources-sync` while the dial `canvas.resources_sync` is on (the default), or the snapshot
in `server/seeds/canvas-resources.json` when the village has never read it. The shapes are
`CanvasResourcesPayload` and `CanvasResourceView` in `shared/canvasResources.ts`; import them.

### GET /api/canvas/resources?block=<id>&surface=learn|safety

Same door as `GET /api/canvas`. `block` is required (`400` otherwise); `surface` defaults to
`learn`. The answer lists the resources that show under the block in this village, the village's
own placings first, then the platform's map, then keyword suggestions, each group by name. A
withdrawn row (gone upstream) is never listed. `surface=safety` leaves out every Nonviolent
Communication row (`safetyExcluded`, `shared/canvasResourceTags.ts`).

- `resources[].placing` is `{ by: "village" | "platform" | "suggested", keyword }`; `keyword` is
  the row's own keyword that suggested the block, for a suggestion only.
- `resources[].url` is null and `linkPending` true when the database gives a filename or nothing.
- `resources[].link` is `unchecked`, `ok`, `broken` or `refused`, from the nightly link check.
- `credit` is the text and the spreadsheet's address; show both beside the list.
- `source` is `{ kind: "database" | "snapshot", asOf, syncOn }`: when the shelf was last read, or
  when the shipped snapshot was taken.
- `suggestUrl` is the database's own suggestion form once the village sets `canvas.suggest_url`,
  otherwise null. The member sends that form; the village sends nothing.
- `mayPlace` is whether this viewer holds the canvas pen (`story.tell`).

### PUT /api/canvas/resources/:key/blocks

The canvas pen, through the one gate. Body `{ "blocks": CanvasBlockId[] }` places the resource
under exactly those blocks in this village (an empty list shows it nowhere); `{ "blocks": null }`
hands it back to the platform's placing. `400` for anything else, `404` for an unknown key, `403`
with `RESOURCE_PEN_REFUSAL` for a member without the pen. Answers `{ key, blocks, by }`.

There is no route that runs the read on demand. A failed or refused read fails the job, which
reaches the admins through the failures report (`GET /api/admin/failures`) and the error notice,
and the next night is the retry.
