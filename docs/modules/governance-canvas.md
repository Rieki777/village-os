# Module design: governance canvas

Provenance: platform

> Registry id `canvas`. Routes in `server/routes/canvas.ts` (the readings), `canvasSeason.ts`,
> `canvasFrames.ts` (the five frames, suggestions and adoption, the Decision Matrix's human rows),
> `decisionMatrix.ts`, `canvasPublic.ts` (one public line per block) and `canvasRevisit.ts` (the
> canvas moon), every one under `/api/canvas` and behind `requireModule("canvas")`, mounted in
> `server/routes/canvasModuleGates.ts`. The API is written down in `docs/canvas-api.md`. Tables:
> `canvas_readings` (0253), `canvas_proposals` and `decision_matrix_rows` (0254).

**The village reads how it governs itself on the twelve blocks of the Governance Canvas, from
purpose to impact: a reading per block with a level and one sentence, the season map, five frames
to walk each block in (Sense, See, Learn, Say, Adopt), a Decision Matrix, one public line per block,
a printable workbook and a companion that answers from the village's own record.**

## Credit

The canvas is the **Governance Canvas by the Bioregional Weaving Labs Collective and Commonland
(Tijn Tjoelker, Ernestien Idenburg, Noa Lodeizen, Zlatina Tsvetkova)**, published at
<https://tijntjoelker.substack.com/p/governance-canvas>. The twelve blocks, their questions and
their descriptions are theirs, kept verbatim in `shared/governanceCanvasText.ts`, and that file's
text is not covered by this repository's licence. Every surface that shows the canvas's words
carries the credit (`CANVAS_CREDIT`). The platform's own prompts, the readings, the frames and the
software around them are this platform's.

## Status

Ships OFF, like every non-core module (Rye's module ruling, 2026-10-01). A founder turns it on in
Modules. Nothing turns it on by itself: loading a season file does not, and neither does any job.
Nothing to set up once it is on: the first reading is the first content, and "not decided yet,
because..." is a reading.

It does not need Conflict Evolution, and Conflict Evolution does not need it. With both on, block 8
(Conflict) carries the conflict agreement's editor under Say. With Conflict Evolution off, the Say
frame of block 8 shows the exit policy's restorative steps instead, which every village has.

## While it is off

- Every path under `/api/canvas` answers `404 { "error": "module_disabled", "module": "canvas" }`.
- The Journey to Launch page has no Canvas tab. An admin reads one line in its place, pointing to
  Modules. A member sees the test run alone, as before the canvas existed.
- `/canvas/workbook` shows the module-off card.
- `/governance` (How we work together) shows no public lines, no Decision Matrix and no workbook
  card. Its honest copy stays: the hero says only what the page holds, and the conflict section
  prints the exit policy's restorative steps.
- The `canvas-on-record` launch row does not appear and does not block.
- The four key moments send no `canvas_revisit` notice, and no weekly brief or moon digest names a
  canvas moon.
- The companion is handed none of `canvas.answers`, `canvas.library` and `matrix.rows`, and a
  question that names the canvas is answered as an ordinary question.

Readings, suggestions and matrix rows stay in their tables while it is off and come back intact.
There is no `openStateCheck`: nothing here is value anybody is owed.

## The lifecycle, door by door

| Lifecycle | An admin | An admitted member | A signed-in account not yet admitted | A visitor |
| --- | --- | --- | --- | --- |
| off | 404 | 404 | 404 | 404 |
| preview | every door | 404 | 404 | 404 |
| members | every door | every door | 403 `CANVAS_MEMBERS_ONLY` (the public lines are readable) | 401 |
| public | every door | every door | as above | `GET /api/canvas/public` and the public matrix only |

Past the gate each route keeps its own rule: the canvas, its readings and the matrix rows are for
the village's admitted members and its admins (`mayReadCanvas`), and the public lines are the one
door written for anybody.

## The launch row

`canvas-on-record` (blocking) applies only while this module is on. It asks that each of the twelve
blocks carries at least one reading before the village is asked to start its Game (Rye, 2026-09-24,
Option B). It never scores the readings and never counts them against twelve on the page.

## Numbers

The canvas's 1 to 5 radar is allowed on the canvas baseline only (Rye, 2026-09-24). No surface
shows an averaged or composite number, a percentage or an N-of-M about the canvas (R55).

## Not built yet

Canvas Resources sync and its link check are not built: `relevantCanvasResources`
(`server/lib/companionCanvas.ts`) returns nothing. When they land they register as scheduler jobs
that return early while this module is off.
