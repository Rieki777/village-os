/**
 * /canvas/workbook: THE PRINTABLE GOVERNANCE CANVAS WORKBOOK (2026-09-25).
 *
 * Readable without signing in while the Governance Canvas is public, and by
 * the village's members while it is open to members (the gate below). It asks
 * nothing of the reader and reads nothing about the village except its name (from the
 * public config every page already loads). The sheet itself is
 * components/canvas/CanvasWorkbookSheet.tsx; this page adds the controls,
 * the paper size and the print stylesheet.
 *
 * ── PRINT, ON A4 AND ON US LETTER ──────────────────────────────────────────
 *
 * The stylesheet is a <style> element rendered WITH the page, so it exists
 * only while the workbook is mounted. A stylesheet imported from a lazy chunk
 * would stay in the document after the reader moved on, and would then strip
 * the site header off every page they printed for the rest of the visit.
 *
 * `@page { size }` follows the paper the reader picks. Browsers hand it to
 * the print dialog as the default sheet, and the layout is set to fit the
 * smaller of the two in each direction (A4 is narrower, Letter is shorter),
 * so either paper prints one block to a page with nothing cut off. The
 * default comes from the reader's locale, so a reader in the United States
 * starts on Letter and most of the world on A4.
 *
 * Borders, never backgrounds, carry the ruled lines and the level rings:
 * browsers drop background colours when printing unless the reader asks for
 * them, and a writing line that vanishes on paper is no writing line.
 *
 * ── SAVE AS MARKDOWN ───────────────────────────────────────────────────────
 *
 * Built in the browser by client/src/lib/canvasWorkbook.ts and handed to the
 * reader as a download. Nothing leaves the device.
 */
import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { moduleIsOn, useModules } from "@/modules/ModuleProvider";
import { CanvasWorkbookSheet } from "@/components/canvas/CanvasWorkbookSheet";
import { useVillageName } from "@/hooks/useVillageName";
import {
  PAPER_LABELS,
  PAPER_SIZES,
  defaultPaper,
  workbookFilename,
  workbookMarkdown,
  type WorkbookPaper,
} from "@/lib/canvasWorkbook";

const PAPERS: readonly WorkbookPaper[] = ["a4", "letter"];

/**
 * The print sheet. Everything the Layout draws around <main> goes (header,
 * footer, the phone tab bar and its button), the toolbar goes, the cards lose
 * their chrome, and every block starts a page of its own.
 */
function printCss(paper: WorkbookPaper): string {
  return `
@page { size: ${PAPER_SIZES[paper]}; margin: 14mm 14mm 16mm; }
@media print {
  :has(> #main) > :not(#main), nav, footer, [data-mobile-fab], .print-hide { display: none !important; }
  html, body, #main { background: white !important; }
  .canvas-workbook { background: white !important; padding: 0 !important; margin: 0 !important; }
  .canvas-workbook > div { max-width: none !important; padding: 0 !important; }
  .canvas-workbook-sheet { font-size: 10.5pt; color: black; }
  .canvas-workbook-sheet .wb-card { border: none !important; border-radius: 0 !important; padding: 0 !important; box-shadow: none !important; }
  .canvas-workbook-sheet .wb-keep { break-inside: avoid; }
  .canvas-workbook-sheet .wb-break { break-before: page; }
  .canvas-workbook-sheet a { color: black !important; text-decoration: none !important; }
  .canvas-workbook-sheet table { min-width: 0 !important; }
  .canvas-workbook-sheet .overflow-x-auto { overflow: visible !important; }
}
`;
}

/** Hands the reader a file, built here, without a round trip to anywhere. */
function saveFile(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * BEHIND THE GOVERNANCE CANVAS MODULE (Rye's module ruling, 2026-10-01). The
 * workbook is part of the canvas, so it opens only where the module is on for
 * this reader, and otherwise shows the platform's one module-off card (or its
 * sign-in card, where the canvas is open to members). While the catalogue is
 * still arriving the page holds a quiet line instead of guessing.
 */
export default function CanvasWorkbook() {
  const modules = useModules();
  if (!modules.loaded) {
    return (
      <Layout>
        <p role="status" className="py-24 text-center text-sm text-stone-600">
          <Trans context="loading the canvas workbook page">Opening the workbook</Trans>
        </p>
      </Layout>
    );
  }
  if (!moduleIsOn(modules, "canvas")) return <ModuleGate moduleId="canvas" name="Governance Canvas" />;
  return <Workbook />;
}

function Workbook() {
  const villageName = useVillageName("Your village");
  const [paper, setPaper] = useState<WorkbookPaper>(() =>
    defaultPaper(typeof navigator === "undefined" ? undefined : navigator.language),
  );

  return (
    <Layout>
      <style data-testid="workbook-print-css">{printCss(paper)}</style>
      <div className="canvas-workbook bg-stone-100 py-8 sm:py-10">
        <div className="container max-w-3xl mx-auto px-4 space-y-6">
          <div className="print-hide bg-white border border-stone-200 rounded-xl p-4 sm:p-5 space-y-3" data-testid="workbook-toolbar">
            <p className="text-sm text-stone-700">
              <Trans>
                Print this workbook to fill in by hand, or save it as a Markdown file to fill in on a screen. Both happen
                in your browser, and nothing is sent anywhere.
              </Trans>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-deep px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep-dark"
              >
                <Printer className="w-4 h-4" /> <Trans context="a button that prints the workbook">Print</Trans>
              </button>
              <button
                type="button"
                onClick={() => saveFile(workbookFilename(villageName), workbookMarkdown(villageName))}
                className="inline-flex items-center gap-2 rounded-lg border border-teal-deep px-4 py-2 text-sm font-semibold text-teal-deep hover:bg-stone-50"
              >
                <Download className="w-4 h-4" /> <Trans context="a button that downloads the workbook as a file">Save as Markdown</Trans>
              </button>
              <fieldset className="flex items-center gap-3 text-sm text-stone-800">
                <legend className="sr-only">
                  <Trans context="the workbook's paper size choices">Paper size</Trans>
                </legend>
                <span aria-hidden="true" className="font-medium">
                  <Trans context="the label beside the paper size choices">Paper</Trans>
                </span>
                {PAPERS.map((p) => (
                  <label key={p} className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="workbook-paper"
                      value={p}
                      checked={paper === p}
                      onChange={() => setPaper(p)}
                      className="accent-teal-deep"
                    />
                    {PAPER_LABELS[p]}
                  </label>
                ))}
              </fieldset>
            </div>
          </div>

          <CanvasWorkbookSheet villageName={villageName} />
        </div>
      </div>
    </Layout>
  );
}
