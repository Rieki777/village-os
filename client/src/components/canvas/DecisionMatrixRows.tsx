/**
 * THE DECISION MATRIX, THE VILLAGE'S HALF, on the Power block's Say frame
 * (plan 2.3 "Text-bearing objects" and "Three pens"; Wave 3b, 2026-09-28).
 *
 * The platform writes one half of the matrix from the rules it enforces
 * (DecisionMatrix, just above this on the page). This is the other half: the
 * rows the village writes for the decisions the platform does not run, such
 * as spending under a threshold or who speaks to the press.
 *
 * WHO WRITES A ROW is the consequence pen, which the server answers on
 * GET /api/canvas/decision-matrix/rows as `pen`:
 *
 *   before the Birthing   the founders (administrators) add, change and remove
 *                         rows here, straight away
 *   after it              a vote of the whole village at the structural tier,
 *                         which is not built yet; every write answers 409, so
 *                         nothing here is offered, and the sentence says so
 *
 * Anybody else reads the rows and suggests one with the suggestion box below
 * (a "row of the Decision Matrix"), which the pen adopts or declines.
 *
 * Risk tags are information and never change who decides or how; the server's
 * sentence saying so is printed with the rows. No count of rows is shown.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { readingDate } from "@/lib/canvasCopy";
import { readFailure, refusalText, type MatrixRowView, type MatrixRowsPayload } from "@/lib/canvasFramesCopy";
import { parseMatrixRow } from "@shared/canvasFrames";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const field = "mt-1 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900";
const quiet = "min-h-[44px] rounded-lg border border-stone-300 px-3 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60";

type RowDraft = { subject: string; approval: string; consultation: string; information: string; method: string; riskTags: string };
const BLANK: RowDraft = { subject: "", approval: "", consultation: "", information: "", method: "", riskTags: "" };
const draftOf = (r: MatrixRowView): RowDraft => ({
  subject: r.subject,
  approval: r.approval,
  consultation: r.consultation,
  information: r.information,
  method: r.method,
  riskTags: r.riskTags.join(", "),
});
const COLUMNS: Array<[keyof RowDraft, string]> = [
  ["subject", "The kind of decision"],
  ["approval", "Who approves it"],
  ["consultation", "Who is asked first"],
  ["information", "Who is told"],
  ["method", "How it is decided (optional)"],
  ["riskTags", "Risk tags, separated by commas (optional)"],
];

export function DecisionMatrixRows({ notesArePublic }: { notesArePublic: string }) {
  const [data, setData] = useState<MatrixRowsPayload | null>(null);
  const [failed, setFailed] = useState<{ message: string; retry: boolean } | null>(null);
  /** The row being written: "new", a row id, or null. */
  const [editing, setEditing] = useState<"new" | number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(null);
    fetch("/api/canvas/decision-matrix/rows", { headers: headers() })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return setFailed(readFailure(r.status, d?.error, "the village's rows"));
        setData(d as MatrixRowsPayload);
      })
      .catch(() => setFailed(readFailure(null, null, "the village's rows")));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const writes = !!data && data.pen.how === "act" && data.pen.youMayAdopt;

  const remove = async (row: MatrixRowView) => {
    if (!window.confirm(`Remove the row "${row.subject}" from the Decision Matrix? Everyone in the village stops seeing it.`)) return;
    setNotice(null);
    try {
      const r = await fetch(`/api/canvas/decision-matrix/rows/${row.id}`, { method: "DELETE", headers: headers() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setNotice(refusalText(d, "That row was not removed."));
      setNotice(`The row "${row.subject}" is removed.`);
      load();
    } catch {
      setNotice("That did not reach the server, so the row is still there.");
    }
  };

  return (
    <div className="rounded-lg border border-stone-200 p-3 space-y-3" data-testid="matrix-human-rows">
      <h4 className="font-semibold text-stone-900">The village's own rows</h4>
      <p className="text-stone-700">
        For the decisions the platform does not run, the village writes who approves, who is asked first, who is told
        and how it is decided.
      </p>

      {failed ? (
        <div role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 space-y-2">
          <p>{failed.message}</p>
          {failed.retry && (
            <button type="button" onClick={load} className={quiet}>
              Try again
            </button>
          )}
        </div>
      ) : !data ? (
        <p className="text-stone-600">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Reading the village's rows
        </p>
      ) : (
        <>
          {data.rows.length > 0 ? (
            <ul className="space-y-2">
              {data.rows.map((row) => (
                <li key={row.id} className="rounded-lg bg-stone-50 p-3" data-testid={`matrix-human-row-${row.id}`}>
                  {editing === row.id ? (
                    <RowForm
                      start={draftOf(row)}
                      rowId={row.id}
                      notesArePublic={notesArePublic}
                      onDone={(message) => {
                        setEditing(null);
                        if (message) {
                          setNotice(message);
                          load();
                        }
                      }}
                    />
                  ) : (
                    <>
                      <p className="font-medium text-stone-900">{row.subject}</p>
                      <dl className="mt-1 grid gap-1 text-stone-800">
                        <div>
                          <dt className="inline text-stone-600">Who approves it: </dt>
                          <dd className="inline">{row.approval}</dd>
                        </div>
                        <div>
                          <dt className="inline text-stone-600">Who is asked first: </dt>
                          <dd className="inline">{row.consultation}</dd>
                        </div>
                        <div>
                          <dt className="inline text-stone-600">Who is told: </dt>
                          <dd className="inline">{row.information}</dd>
                        </div>
                        {row.method && (
                          <div>
                            <dt className="inline text-stone-600">How it is decided: </dt>
                            <dd className="inline">{row.method}</dd>
                          </div>
                        )}
                      </dl>
                      {row.riskTags.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {row.riskTags.map((tag) => (
                            <span key={tag} className="rounded-full border border-stone-300 px-2 py-0.5 text-xs text-stone-700">
                              Risk: {tag}
                            </span>
                          ))}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-stone-600">
                        Last written by {row.updatedBy.name || "a founder"} on {readingDate(row.updatedAt)}
                      </p>
                      {writes && editing === null && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" onClick={() => setEditing(row.id)} className={quiet}>
                            Change this row
                          </button>
                          <button type="button" onClick={() => void remove(row)} className={quiet}>
                            Remove this row
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-stone-700">The village has not written any rows of its own yet.</p>
          )}

          <p className="text-xs text-stone-600">{data.riskTagsAreInformation}</p>

          {notice && (
            <p role="status" className="text-sm text-stone-900">
              {notice}
            </p>
          )}

          {writes ? (
            editing === "new" ? (
              <RowForm
                start={BLANK}
                notesArePublic={notesArePublic}
                onDone={(message) => {
                  setEditing(null);
                  if (message) {
                    setNotice(message);
                    load();
                  }
                }}
              />
            ) : (
              editing === null && (
                <button type="button" onClick={() => setEditing("new")} className={quiet}>
                  Add a row
                </button>
              )
            )
          ) : (
            <p className="text-stone-700" data-testid="matrix-human-rows-pen">
              {data.pen.how === "ballot"
                ? "The Game has started, so these rows change by a vote of the whole village, which is not built yet. You can still suggest a row below, and it waits for that vote."
                : `${data.pen.sentence} To add or change a row, suggest it below.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** One row, written by the pen. Checked with the route's own validator before it is sent. */
function RowForm({
  start,
  rowId,
  notesArePublic,
  onDone,
}: {
  start: RowDraft;
  rowId?: number;
  notesArePublic: string;
  /** Called with the sentence to show once saved, or with nothing when cancelled. */
  onDone: (message?: string) => void;
}) {
  const [d, setD] = useState<RowDraft>(start);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const body = { ...d, riskTags: d.riskTags.split(",").map((t) => t.trim()) };
    const parsed = parseMatrixRow(body);
    if (!parsed.ok) return setError(parsed.error);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(rowId ? `/api/canvas/decision-matrix/rows/${rowId}` : "/api/canvas/decision-matrix/rows", {
        method: rowId ? "PUT" : "POST",
        headers: headers(),
        body: JSON.stringify(parsed.row),
      });
      const answer = await r.json().catch(() => ({}));
      if (!r.ok) return setError(refusalText(answer, "That row was not saved."));
      onDone(rowId ? "The row is changed." : "The row is added to the Decision Matrix.");
    } catch {
      setError("That did not reach the server, so the row was not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label={rowId ? "Change this row" : "Add a row"}
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-xs text-stone-700">{notesArePublic} "Nobody yet" is an answer.</p>
      {COLUMNS.map(([key, label]) => (
        <label key={key} className="block text-sm">
          <span className="font-medium text-stone-900">{label}</span>
          <input type="text" value={d[key]} onChange={(e) => setD({ ...d, [key]: e.target.value })} className={field} />
        </label>
      ))}
      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? "Saving" : rowId ? "Save this row" : "Add this row"}
        </button>
        <button type="button" disabled={busy} onClick={() => onDone()} className={quiet}>
          Cancel
        </button>
      </div>
    </form>
  );
}
