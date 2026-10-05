/**
 * THE PREVIEW on the Words screen: the email exactly as the server renders it
 * for sending (server/lib/comms/render.ts), never a second rendering made in
 * the browser. The preview route and "Send me a test" share one render, so
 * this frame shows what arrives.
 *
 * The HTML sits in a sandboxed frame with no permissions at all: no scripts,
 * no forms, no reaching out of the frame. An email has no business running
 * anything, and the frame makes that true here too. Phone and desktop are the
 * same document at two widths, which is what an inbox does with it.
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useState } from "react";
import type { WordsPreview as Preview } from "./wordsApi";

const WIDTHS = { phone: 375, desktop: 640 } as const;
type Width = keyof typeof WIDTHS;

/** One line per thing the editor should know about the preview. */
function notes(preview: Preview): Array<{ tone: "warn" | "info"; text: string }> {
  const out: Array<{ tone: "warn" | "info"; text: string }> = [];
  for (const key of preview.unknown) out.push({ tone: "warn", text: `{{${key}}} is not a field, so it shows nothing.` });
  for (const problem of preview.problems) {
    if (!/is not a field/.test(problem)) out.push({ tone: "warn", text: problem });
  }
  for (const key of preview.missing) {
    out.push({ tone: "warn", text: `{{${key}}} had no value in this preview, so its fallback is showing.` });
  }
  if (preview.omitted.length) {
    out.push({
      tone: "info",
      text: `Left out when we don't know them: ${preview.omitted.map((k) => `{{${k}}}`).join(", ")}.`,
    });
  }
  return out;
}

export default function WordsPreview({ preview, loading, error }: { preview: Preview | null; loading: boolean; error: string }) {
  const [width, setWidth] = useState<Width>("phone");
  const [showText, setShowText] = useState(false);

  return (
    <section aria-label="Preview" className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Preview</p>
          {preview && (
            <>
              <p className="truncate text-sm font-semibold text-gray-900" title={preview.subject}>{preview.subject}</p>
              <p className="truncate text-xs text-gray-500" title={preview.preheader}>{preview.preheader}</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Preview width">
          {(Object.keys(WIDTHS) as Width[]).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => {
                setWidth(w);
                setShowText(false);
              }}
              aria-pressed={!showText && width === w}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                !showText && width === w ? "bg-gray-900 text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {w === "phone" ? "Phone" : "Desktop"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowText(true)}
            aria-pressed={showText}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              showText ? "bg-gray-900 text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Plain text
          </button>
        </div>
      </div>

      {error && <p className="px-4 py-3 text-sm text-red-700">{error}</p>}
      {!preview && !error && <p className="px-4 py-8 text-center text-sm text-gray-400">{loading ? "Making the preview..." : ""}</p>}

      {preview && (
        <div className="p-3">
          {notes(preview).length > 0 && (
            <ul className="mb-3 space-y-1">
              {notes(preview).map((n, i) => (
                <li
                  key={i}
                  className={`rounded-md px-3 py-2 text-xs ${n.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-gray-50 text-gray-600"}`}
                >
                  {n.text}
                </li>
              ))}
            </ul>
          )}
          {showText ? (
            <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs leading-relaxed text-gray-800">
              {preview.text}
            </pre>
          ) : (
            <div className="overflow-x-auto">
              <iframe
                title={`The email at ${width} width`}
                sandbox=""
                srcDoc={preview.html}
                style={{ width: WIDTHS[width], height: 640 }}
                className={`mx-auto block max-w-full rounded-lg border border-gray-200 bg-white ${loading ? "opacity-60" : ""}`}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
