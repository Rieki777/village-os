/**
 * "TAKE THE CANVAS WITH YOU" (plan 5.6): build the pack, then save its four
 * Markdown files, one by one or as one combined file. The browser saves them
 * to this device; this server sends them nowhere.
 *
 * Every export writes an audit row with the pack's content hash, which is how
 * the line above the button can say whether anything changed since the last
 * one. There is no zip: no small archiver ships in this bundle, and a notebook
 * takes Markdown files as they are.
 */
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import {
  NOTEBOOK_WORDS,
  call,
  combinedName,
  combinedPack,
  exportStatusLine,
  saveText,
  type ExportStatus,
  type PackFile,
} from "@/lib/notebookCopy";
import { Trans, useLingui } from "@lingui/react/macro";

const quiet = "text-sm font-medium rounded-lg px-3 py-1.5 text-teal-deep border border-teal-deep hover:bg-stone-50 disabled:opacity-40";
const solid = "text-sm font-medium rounded-lg px-3 py-1.5 text-white bg-teal-deep hover:bg-teal-deep-dark disabled:opacity-40";

export function NotebookExport() {
  const { t } = useLingui();
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const [pack, setPack] = useState<{ files: PackFile[]; exportedAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call<ExportStatus>("GET", "/api/canvas/exports/latest").then((got) => {
      if (got.ok) setStatus(got.data);
    });
  }, []);

  const build = async () => {
    setError(null);
    setBusy(true);
    const got = await call<{ files: PackFile[]; exportedAt: string }>("POST", "/api/canvas/exports", {});
    setBusy(false);
    if (!got.ok) return setError(got.error);
    setPack(got.data);
    setStatus({ lastExportAt: got.data.exportedAt, changedSince: false });
  };

  return (
    <section data-testid="notebook-export" className="bg-white border border-stone-200 rounded-xl p-5 space-y-3">
      <h2 className="font-display text-xl font-semibold text-stone-900 flex items-center gap-2">
        <Download className="w-5 h-5 text-teal-deep" aria-hidden="true" /> {NOTEBOOK_WORDS.exportHeading}
      </h2>
      <p className="text-sm text-stone-700">{NOTEBOOK_WORDS.exportIntro}</p>
      <p className="text-sm text-stone-900 border-l-2 border-amber pl-3">{NOTEBOOK_WORDS.geminiWarning}</p>
      <p className="text-sm font-medium text-stone-900" data-testid="notebook-export-status">
        {exportStatusLine(status)}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={solid} disabled={busy} onClick={() => void build()}>
          {busy ? t({ message: "Building the pack", context: "canvas export button, busy" }) : pack ? t({ message: "Build it again", context: "canvas export button" }) : t({ message: "Build the pack", context: "canvas export button" })}
        </button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
      {pack && (
        <div className="space-y-2" data-testid="notebook-export-files">
          <p className="text-sm text-stone-700"><Trans>Built. Save the files to this device:</Trans></p>
          <ul className="flex flex-wrap gap-2">
            {pack.files.map((f) => (
              <li key={f.name}>
                <button type="button" className={quiet} onClick={() => saveText(f.name, f.content)}>
                  <Trans context="save one exported file">Save {f.name}</Trans>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={quiet} onClick={() => saveText(combinedName(pack.exportedAt), combinedPack(pack.files))}>
            <Trans>Save all four as one file</Trans>
          </button>
        </div>
      )}
    </section>
  );
}
