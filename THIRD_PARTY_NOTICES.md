<!-- describes: shared/governanceCanvasText.ts server/seeds/canvas-resources.json -->
# Third-party text in this repository

The MIT licence in `LICENSE` covers this platform's own code and words. It does not cover the
text listed here. That text belongs to its authors and is not ours to license, so nobody who
copies, forks or self-hosts this repository receives MIT rights over it.

## Governance Canvas

- **What:** the canvas's own questions and descriptions for its twelve blocks, its four
  foundations, its five-level scale, its four key moments and its Decision Matrix columns,
  quoted word for word.
- **Where:** `shared/governanceCanvasText.ts`. The tests that pin it word for word repeat it
  (`shared/governanceCanvasText.test.ts`, `client/src/lib/canvasWorkbook.test.ts`). The Canvas
  view on Journey to Launch and the printable workbook at /canvas/workbook render it.
- **Whose:** Governance Canvas by the Bioregional Weaving Labs Collective and Commonland
  (Tijn Tjoelker, Ernestien Idenburg, Noa Lodeizen, Zlatina Tsvetkova),
  https://tijntjoelker.substack.com/p/governance-canvas
- **On what terms:** quoted with that credit, which every surface showing the text shows
  beside it. The authors' own licence terms for the text are not yet recorded here. Until they
  are, a fork that keeps the text keeps the credit beside it, and a fork that will not keep the
  credit removes the quotations.

## Governance Canvas Database

- **What:** the name, type, authors, short description and address of each resource in the
  Governance Canvas Database, the public spreadsheet of governance resources kept beside the
  canvas, as a snapshot of those five columns and nothing else.
- **Where:** `server/seeds/canvas-resources.json`, which a village loads into its own
  `canvas_resources` table when it has never read the database itself, and which the nightly job
  `canvas-resources-sync` (`server/lib/canvasResourcesSync.ts`) replaces with a fresh read of the
  same five columns. The Learn frame of each canvas block renders it.
- **Whose:** Governance Canvas Database, Bioregional Weaving Labs Collective and Commonland,
  https://docs.google.com/spreadsheets/d/1rDA_fXJe-WziLzhqV2WLBBTdSgNyPa7AwK_ftuGDs24/ . Each
  resource's own words belong to the authors it names.
- **On what terms:** quoted with that credit and a link to the database, beside every list of
  resources. Its keepers' licence terms are not yet recorded here, on the same footing as the
  canvas text above.
