/**
 * LETTERS, in the Comms section of Admin (the comms build spec 5.12 and 6):
 * village news, written here and sent to the people who said yes to it.
 *
 * Write a letter (LetterComposer.tsx), choose who it is for, preview it as its
 * first reader will see it, send yourself a test, then send it now or
 * schedule it. History lists every letter with what became of it: sent,
 * delivered, bounced, complained and skipped, from the post office's own
 * record. A scheduled letter can be cancelled or moved from here.
 *
 * The routes are server/routes/commsLetters.ts. Light-only, like every admin
 * surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useState } from "react";
import type { LetterState } from "@shared/comms/letters";
import LetterComposer from "./LetterComposer";
import {
  cancelLetter,
  fetchLetters,
  localToIso,
  momentLabel,
  rescheduleLetter,
  type LettersAnswer,
  type LetterView,
} from "./lettersApi";

const STATE_LABEL: Record<LetterState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Going out",
  sent: "Sent",
  cancelled: "Cancelled",
};

const STATE_STYLE: Record<LetterState, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-50 text-blue-800",
  sending: "bg-amber-50 text-amber-900",
  sent: "bg-green-50 text-green-800",
  cancelled: "bg-gray-100 text-gray-500",
};

function Numbers({ l }: { l: LetterView }) {
  const n = l.numbers;
  const cells: Array<[string, number]> = [
    ["Sent", n.sent],
    ["Delivered", n.delivered],
    ["Bounced", n.bounced],
    ["Complained", n.complained],
    ["Skipped", n.skipped],
  ];
  if (n.waiting) cells.push(["Waiting", n.waiting]);
  if (n.failed) cells.push(["Failed", n.failed]);
  if (n.rehearsed) cells.push(["Rehearsed", n.rehearsed]);
  return (
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="Numbers">
      {cells.map(([label, value]) => (
        <div key={label} className="flex gap-1">
          <dt>{label}</dt>
          <dd className="font-semibold text-gray-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Scheduled({ password, l, onChanged }: { password: string; l: LetterView; onChanged: (note: string) => void }) {
  const [when, setWhen] = useState("");
  const [error, setError] = useState("");
  const cancel = async () => {
    if (!window.confirm("Cancel this letter? It will not go out, and you can change it and send it later.")) return;
    const answer = await cancelLetter(password, l.id);
    if (!answer.ok) return setError(answer.error);
    onChanged("Cancelled. Open it to change it or send it again.");
  };
  const move = async () => {
    const iso = localToIso(when);
    if (!iso) return setError("Pick a date and time.");
    const answer = await rescheduleLetter(password, l.id, iso);
    if (!answer.ok) return setError(answer.error);
    onChanged(`Moved to ${momentLabel(answer.body.scheduledFor)}.`);
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <label className="sr-only" htmlFor={`move-${l.id}`}>
        New time
      </label>
      <input
        id={`move-${l.id}`}
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
      />
      <button type="button" disabled={!when} onClick={move} className="text-gray-900 underline disabled:opacity-50">
        Reschedule
      </button>
      <button type="button" onClick={cancel} className="text-red-700 underline">
        Cancel
      </button>
      {error && <span className="text-red-700">{error}</span>}
    </div>
  );
}

export default function CommsLetters({ password }: { password: string }) {
  const [data, setData] = useState<LettersAnswer | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  /** The letter open in the composer: an id, "new", or null for none. */
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const answer = await fetchLetters(password);
    if (!answer.ok) return setError(answer.error);
    setError("");
    setData(answer.body);
  }, [password]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="py-12 text-center text-sm text-gray-400">Loading...</p>;

  const editing = open && open !== "new" ? data.letters.find((l) => l.id === open) ?? null : null;
  const done = async (line: string, keepOpen: boolean) => {
    setNote(line);
    if (!keepOpen) setOpen(null);
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Letters</h2>
          <p className="mt-1 text-sm text-gray-500">
            Village news, to the people who said yes to it. At most {data.limit.perDay} a day, ten minutes apart.{" "}
            {data.limit.today} went in the last 24 hours.
          </p>
        </div>
        {open === null && (
          <button type="button" onClick={() => setOpen("new")} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white">
            Write a letter
          </button>
        )}
      </div>
      {!data.ready && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This village cannot send email yet. Finish the setup in Comms Settings, then come back to send.
        </p>
      )}
      {note && <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">{note}</p>}

      {open !== null && (
        <section aria-label="Write">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{editing ? "Your letter" : "A new letter"}</h3>
            <button type="button" onClick={() => setOpen(null)} className="text-sm text-gray-700 underline">
              Close
            </button>
          </div>
          <LetterComposer key={open} password={password} letter={editing} choices={data.choices} onDone={done} />
        </section>
      )}

      <section aria-label="History">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">History</h3>
        {data.letters.length === 0 ? (
          <p className="text-sm text-gray-500">No letters yet.</p>
        ) : (
          <ul className="space-y-3">
            {data.letters.map((l) => (
              <li key={l.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-gray-900" title={l.subject}>
                    {l.subject}
                  </p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[l.state]}`}>{STATE_LABEL[l.state]}</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {l.audienceLabel}
                  {l.recipientCount ? `, ${l.recipientCount} in the last preview` : ""}
                  {l.sentAt ? `. Went ${momentLabel(l.sentAt)}` : ""}
                  {l.state === "scheduled" && l.scheduledFor ? `. Goes ${momentLabel(l.scheduledFor)}` : ""}
                </p>
                {(l.state === "sent" || l.state === "sending") && <Numbers l={l} />}
                {l.state === "scheduled" && <Scheduled password={password} l={l} onChanged={(line) => done(line, false)} />}
                {(l.state === "draft" || l.state === "cancelled") && open !== l.id && (
                  <button type="button" onClick={() => setOpen(l.id)} className="mt-2 text-sm text-gray-900 underline">
                    Open
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
