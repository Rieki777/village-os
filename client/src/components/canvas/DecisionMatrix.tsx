/**
 * THE DECISION MATRIX, THE PLATFORM'S HALF, inside the Power block
 * (plan 2.3 and 7 item 3; 2026-09-27).
 *
 * The canvas's Decision Matrix has five columns, and for the decisions this
 * platform runs, every answer is a rule the platform already enforces. So
 * the server writes this half from those rules (shared/decisionMatrix.ts,
 * GET /api/canvas/decision-matrix) and this component only shows it. It is
 * read-only: the village's own columns come in a later wave, and nothing here
 * pretends to take an edit.
 *
 * ── HOW IT FITS A PHONE ────────────────────────────────────────────────────
 *
 * One markup, two layouts, switched by the width of the matrix's OWN box (a
 * container query), never the window's. Under 640px each row is a small card
 * with every column named above its answer; at 640px and wider the same rows
 * line up under one header as a table. The box is what matters because the
 * Power card sits in a two-column grid on a laptop, where it is narrower than
 * a phone held sideways. The names are a `dl` in both layouts, so a screen
 * reader hears each column's name beside its answer whichever one is drawn;
 * the header row is drawn for sighted readers and hidden from the others.
 *
 * ── WHAT IT MUST NEVER SHOW ────────────────────────────────────────────────
 *
 * The same rules as the rest of the canvas (client/src/lib/canvasCopy.test.ts
 * reads this file): no percent sign, no count of anything, nothing combined
 * across rows. The server's rows carry a vote's quorum and unity as plain
 * numbers with a note saying what they count out of, and never a share of
 * powers handed over.
 *
 * The data is fetched when somebody opens the matrix, so a member reading
 * the other eleven blocks costs the server nothing.
 */
import { useCallback, useState, type ReactNode } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { CANVAS_CREDIT, CANVAS_DECISION_MATRIX_COLUMNS } from "@shared/governanceCanvasText";
import type { DecisionMatrix as Matrix, DecisionMatrixRow } from "@shared/decisionMatrix";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const [SUBJECT, APPROVAL, CONSULTATION, INFORMATION, METHOD] = CANVAS_DECISION_MATRIX_COLUMNS;

/** The five columns side by side, once the box is wide enough. */
const ROW_GRID = "grid gap-2 @min-[40rem]:grid-cols-5 @min-[40rem]:gap-4";

/** Why the read failed, in words, and whether asking again could help. */
function readFailure(status: number | null, error: unknown): { message: string; retry: boolean } {
  if (status === 401 || error === "auth_required") return { message: "Sign in to read the matrix.", retry: false };
  if (status === 403 && typeof error === "string" && error) return { message: error, retry: false };
  if (status === 503 && typeof error === "string" && error) return { message: error, retry: true };
  return { message: "The matrix could not be read just now.", retry: true };
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      {/* Named above the answer in the stacked layout; the header row names it in the table. */}
      <dt className="text-xs font-medium text-stone-500 @min-[40rem]:sr-only">{label}</dt>
      <dd className="m-0 text-stone-800">{children}</dd>
    </div>
  );
}

function Lines({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return <p className="text-stone-600">Nobody, on purpose.</p>;
  return (
    <ul className="space-y-1">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function MatrixRow({ row }: { row: DecisionMatrixRow }) {
  return (
    <dl className={`${ROW_GRID} border-t border-stone-100 py-3`} data-testid={`matrix-row-${row.key}`}>
      <Cell label={SUBJECT}>
        <p className="font-medium text-stone-900">{row.decision}</p>
        {row.detail && <p className="mt-1 text-xs text-stone-600">{row.detail}</p>}
        {row.riskTags.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1">
            {row.riskTags.map((tag) => (
              <span key={tag} className="rounded-full border border-stone-300 px-2 py-0.5 text-xs text-stone-700">
                Risk: {tag}
              </span>
            ))}
          </p>
        )}
      </Cell>
      <Cell label={APPROVAL}>
        <p>{row.approval.text}</p>
      </Cell>
      <Cell label={CONSULTATION}>
        <Lines lines={row.consultation} />
      </Cell>
      <Cell label={INFORMATION}>
        <Lines lines={row.information} />
      </Cell>
      <Cell label={METHOD}>
        <Lines lines={row.method.lines} />
      </Cell>
    </dl>
  );
}

export default function DecisionMatrix() {
  const [open, setOpen] = useState(false);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [failed, setFailed] = useState<{ message: string; retry: boolean } | null>(null);

  const load = useCallback(() => {
    setFailed(null);
    fetch("/api/canvas/decision-matrix", { headers: headers() })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return setFailed(readFailure(r.status, d?.error));
        setMatrix(d as Matrix);
      })
      .catch(() => setFailed(readFailure(null, null)));
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !matrix) load();
  };

  return (
    <div className="mt-4 border-t border-stone-100 pt-3 text-sm" data-testid="decision-matrix">
      <p className="text-xs font-medium text-stone-600">The Decision Matrix</p>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="decision-matrix-body"
        className="mt-1 text-sm font-medium rounded-lg px-3 py-1.5 text-teal-deep border border-teal-deep bg-white hover:bg-stone-50"
      >
        {open ? "Hide who decides what" : "Show who decides what"}
      </button>

      {open && (
        <section id="decision-matrix-body" aria-label="The Decision Matrix" className="@container mt-3 space-y-5">
          <p className="text-stone-700">
            For each kind of decision the canvas asks who approves it, who is asked first, who is told, and how it is
            made. For the decisions this platform runs, the answers are rules it already enforces, so it fills this
            half in itself.
          </p>

          {failed ? (
            <div role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3 space-y-2">
              <p>{failed.message}</p>
              {failed.retry && (
                <button
                  type="button"
                  onClick={load}
                  className="text-sm font-medium rounded-lg px-3 py-1.5 text-teal-deep border border-teal-deep bg-white hover:bg-stone-50"
                >
                  Try again
                </button>
              )}
            </div>
          ) : !matrix ? (
            <p className="text-sm text-stone-600 py-4 text-center">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              Reading the matrix
            </p>
          ) : (
            <>
              {matrix.groups.map((group) => (
                <div key={group.id} data-testid={`matrix-group-${group.id}`}>
                  <h4 className="font-semibold text-stone-900">{group.title}</h4>
                  <p className="text-xs text-stone-600 mt-0.5">{group.intro}</p>
                  <div
                    aria-hidden="true"
                    className={`hidden @min-[40rem]:grid ${ROW_GRID} mt-2 text-xs font-semibold uppercase tracking-wide text-stone-500`}
                  >
                    {CANVAS_DECISION_MATRIX_COLUMNS.map((column) => (
                      <span key={column}>{column}</span>
                    ))}
                  </div>
                  <ul className="mt-1">
                    {group.rows.map((row) => (
                      <li key={row.key}>
                        <MatrixRow row={row} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <ul className="space-y-1 text-xs text-stone-700 list-disc pl-5" data-testid="decision-matrix-notes">
                {matrix.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </>
          )}

          <p className="text-xs text-stone-600" data-testid="decision-matrix-credit">
            {/* Inline, like the baseline's credit, so the full stop stays on its line on a phone. */}
            The five columns are the Decision Matrix of the{" "}
            <a href={CANVAS_CREDIT.url} target="_blank" rel="noreferrer" className="font-medium text-stone-800 hover:underline">
              {CANVAS_CREDIT.text}
              <ExternalLink className="inline w-3 h-3 ml-0.5 align-[-1px]" aria-hidden="true" />
            </a>
            . The answers in this half are the platform's.
          </p>
        </section>
      )}
    </div>
  );
}
