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
 *   after it              a vote of the whole village at the structural tier:
 *                         a suggested row's author files it as a proposal
 *                         (canvas follow-up G.1); every write here answers 409
 *                         naming that vote, so nothing here is offered
 *
 * Anybody else reads the rows and suggests one with the suggestion box below
 * (a "row of the Decision Matrix"), which the pen adopts or declines.
 *
 * Risk tags are information and never change who decides or how; the server's
 * sentence saying so is printed with the rows. No count of rows is shown.
 */
import { useCallback, useEffect, useState } from "react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { authToken } from "@/lib/gameApi";
import { readingDate } from "@/lib/canvasCopy";
import { readFailure, refusalText, type MatrixRowView, type MatrixRowsPayload } from "@/lib/canvasFramesCopy";
import { parseMatrixRow } from "@shared/canvasFrames";
import BreathingLoader from "@/components/natural/BreathingLoader";

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
// Module-scope words are `msg` descriptors, rendered with i18n._ in the form (spec i18n US6.1).
const COLUMNS: Array<[keyof RowDraft, MessageDescriptor]> = [
  ["subject", msg`The kind of decision`],
  ["approval", msg({ message: "Who approves it", context: "Decision Matrix column" })],
  ["consultation", msg`Who is asked first`],
  ["information", msg({ message: "Who is told", context: "Decision Matrix column" })],
  ["method", msg`How it is decided (optional)`],
  ["riskTags", msg`Risk tags, separated by commas (optional)`],
];

export function DecisionMatrixRows({
  notesArePublic,
  reloadOn,
}: {
  notesArePublic: string;
  /** The rows are read again whenever this changes (the Say frame passes the block it read). */
  reloadOn?: unknown;
}) {
  const { t } = useLingui();
  const aFounder = t({ message: "a founder", context: "who last wrote a matrix row, when the name is missing" });
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
  }, [load, reloadOn]);

  const writes = !!data && data.pen.how === "act" && data.pen.youMayAdopt;

  const remove = async (row: MatrixRowView) => {
    const subject = row.subject;
    if (!window.confirm(t`Remove the row "${subject}" from the Decision Matrix? Everyone in the village stops seeing it.`)) return;
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
      <h4 className="font-semibold text-stone-900">
        <Trans>The village's own rows</Trans>
      </h4>
      <p className="text-stone-700">
        <Trans>
          For the decisions the platform does not run, the village writes who approves, who is asked first, who is told
          and how it is decided.
        </Trans>
      </p>

      {failed ? (
        <div role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 space-y-2">
          <p>{failed.message}</p>
          {failed.retry && (
            <button type="button" onClick={load} className={quiet}>
              <Trans context="retry a failed read">Try again</Trans>
            </button>
          )}
        </div>
      ) : !data ? (
        <p className="text-stone-600">
          <BreathingLoader decorative size={16} className="mr-2 align-middle" />
          <Trans>Reading the village's rows</Trans>
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
                          <dt className="inline text-stone-600">
                            <Trans context="Decision Matrix column, before its answer">Who approves it:</Trans>{" "}
                          </dt>
                          <dd className="inline">{row.approval}</dd>
                        </div>
                        <div>
                          <dt className="inline text-stone-600">
                            <Trans>Who is asked first:</Trans>{" "}
                          </dt>
                          <dd className="inline">{row.consultation}</dd>
                        </div>
                        <div>
                          <dt className="inline text-stone-600">
                            <Trans context="Decision Matrix column, before its answer">Who is told:</Trans>{" "}
                          </dt>
                          <dd className="inline">{row.information}</dd>
                        </div>
                        {row.method && (
                          <div>
                            <dt className="inline text-stone-600">
                              <Trans>How it is decided:</Trans>{" "}
                            </dt>
                            <dd className="inline">{row.method}</dd>
                          </div>
                        )}
                      </dl>
                      {row.riskTags.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {row.riskTags.map((tag) => (
                            <span key={tag} className="rounded-full border border-stone-300 px-2 py-0.5 text-xs text-stone-700">
                              <Trans context="a risk tag on a decision">Risk: {tag}</Trans>
                            </span>
                          ))}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-stone-600">
                        <Trans>
                          Last written by {row.updatedBy.name || aFounder} on {readingDate(row.updatedAt)}
                        </Trans>
                      </p>
                      {writes && editing === null && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" onClick={() => setEditing(row.id)} className={quiet}>
                            <Trans context="a button that edits a matrix row">Change this row</Trans>
                          </button>
                          <button type="button" onClick={() => void remove(row)} className={quiet}>
                            <Trans context="a button that deletes a matrix row">Remove this row</Trans>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-stone-700">
              <Trans>The village has not written any rows of its own yet.</Trans>
            </p>
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
                  <Trans context="a button that opens a new matrix row">Add a row</Trans>
                </button>
              )
            )
          ) : (
            <p className="text-stone-700" data-testid="matrix-human-rows-pen">
              {data.pen.how === "ballot" ? (
                <Trans>
                  The Game has started, so these rows change by a vote of the whole village at the structural tier. Suggest a row below, and the member who suggested it files it as a proposal the village decides.
                </Trans>
              ) : // A suggestion only ever adds a row (the box cannot name one to overwrite),
                  // so the line promises what the box can carry (audit of Wave 3b, 2026-09-28).
                  `${data.pen.sentence} To suggest a new row, use the box below. To change a row, suggest it as it should read and say which row it replaces.`}
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
  const { t, i18n } = useLingui();
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
      aria-label={rowId ? t({ message: "Change this row", context: "a button that edits a matrix row" }) : t({ message: "Add a row", context: "a button that opens a new matrix row" })}
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-xs text-stone-700">
        <Trans>{notesArePublic} "Nobody yet" is an answer.</Trans>
      </p>
      {COLUMNS.map(([key, label]) => (
        <label key={key} className="block text-sm">
          <span className="font-medium text-stone-900">{i18n._(label)}</span>
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
          <Trans context="close a form without saving">Cancel</Trans>
        </button>
      </div>
    </form>
  );
}
