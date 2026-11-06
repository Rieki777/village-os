/**
 * CHANGE REQUESTS: the list and one change request (Rye, 2026-11-06; spec
 * village-os-ops/internal/spec/change-requests/, US1, US3, R35 to R41).
 *
 *   /changes      the member's own change requests, and everyone's in review
 *   /changes/:id  one change request: its changes before and after, its review,
 *                 and what is still needed before it can go to the vote
 *
 * One lazy page for both routes, so the feature costs one chunk (VII.2).
 * Everything a member reads here comes from the server in plain words: the
 * checklist lines, the names ("Role (FirstName)", III.2), the refusals. The
 * page builds no name and no rule of its own.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, Check, Clock, GitPullRequest, MessageSquare } from "lucide-react";
import { headers, refusal, type ChangeRequestSummary } from "@/components/governance/changeRequestClient";
import { authToken } from "@/lib/gameApi";

type State = "gathering" | "in_review" | "voting" | "closed";

interface Change {
  position: number;
  key: string;
  kind: string;
  label: string;
  withheld: boolean;
  before: string | null;
  after: string | null;
  change: Record<string, unknown> | null;
}

interface Note {
  id: string;
  kind: "question" | "concern" | "objection" | "edit" | "consent" | "answer";
  revision: number;
  position: number | null;
  body: string;
  proposed: { op: string; position: number | null; change: Record<string, unknown> | null } | null;
  answers: string | null;
  outcome: "open" | "taken_in" | "turned_down" | "answered";
  by: string;
  yours: boolean;
  at: string;
}

interface ChangeRequest {
  id: string;
  title: string;
  why: string;
  state: State;
  revision: number;
  relation: string | null;
  relatesTo: string | null;
  yours: boolean;
  author: string;
  cap: number;
  changes: Change[];
  review: null | {
    endsAt: string;
    ready: boolean;
    checklist: { key: string; done: boolean; words: string }[];
    consents: number;
    notes: Note[];
  };
}

const STEP: Record<State, { n: number; words: string }> = {
  gathering: { n: 1, words: "Gathering" },
  in_review: { n: 2, words: "In review" },
  voting: { n: 3, words: "In the vote" },
  closed: { n: 4, words: "Decided" },
};

const NOTE_WORDS: Record<Note["kind"], string> = {
  question: "Question",
  concern: "Concern",
  objection: "Objection",
  edit: "Suggested edit",
  consent: "Can live with it",
  answer: "Answer",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const moment = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const shown = (v: string | null) => (v === null || v === "" ? "not set" : v);

const card = "rounded-xl border border-stone-200 bg-white p-4";
const primary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-50";
const quiet =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep";
const field = "mt-1 block w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900";

/** One message line that a screen reader hears: refusals as alerts, the rest as status. */
function Say({ text, alert }: { text: string | null; alert?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (text && alert) ref.current?.focus();
  }, [text, alert]);
  if (!text) return null;
  return (
    <p ref={ref} tabIndex={-1} role={alert ? "alert" : "status"} className={`mt-2 text-sm ${alert ? "text-red-800" : "text-teal-deep"}`}>
      {text}
    </p>
  );
}

/** Before and after, stacked, so long words fit at 390 px; named "<setting>, from X to Y" (R38). */
function BeforeAfter({ c }: { c: Change }) {
  if (c.withheld) return <p className="mt-1 text-sm text-stone-600">Kept private</p>;
  return (
    <div className="mt-1 text-sm" aria-label={`${c.label}, from ${shown(c.before)} to ${shown(c.after)}`} role="group">
      <p className="break-words text-stone-600">
        <span aria-hidden="true" className="mr-1 text-xs uppercase tracking-wide text-stone-500">Now</span>
        <del className="text-stone-600">{shown(c.before)}</del>
      </p>
      <p className="break-words font-semibold text-teal-deep">
        <span aria-hidden="true" className="mr-1 text-xs font-normal uppercase tracking-wide text-stone-500">After</span>
        <ins className="no-underline">{shown(c.after)}</ins>
      </p>
    </div>
  );
}

function ListPage() {
  const [mine, setMine] = useState<ChangeRequestSummary[] | null>(null);
  const [open, setOpen] = useState<ChangeRequestSummary[]>([]);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = !!authToken();

  const load = useCallback(() => {
    setFailed(false);
    fetch("/api/change-requests", { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        setMine(Array.isArray(b.mine) ? b.mine : []);
        setOpen(Array.isArray(b.open) ? b.open : []);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);

  const start = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/change-requests", { method: "POST", headers: headers(), body: JSON.stringify({ title, why }) }).catch(() => null);
    setBusy(false);
    if (!res) return setError("That did not go through. Try again in a moment.");
    if (!res.ok) return setError(await refusal(res, "That change request could not be started."));
    const { id } = await res.json();
    window.location.assign(`/changes/${id}`);
  };

  if (!signedIn) {
    return <p className="text-stone-700">Sign in to see what your village is weighing.</p>;
  }

  const row = (c: ChangeRequestSummary) => (
    <li key={c.id}>
      <Link
        href={`/changes/${c.id}`}
        className="flex min-h-[44px] flex-col gap-0.5 rounded-lg px-3 py-2 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
      >
        <span className="font-medium text-stone-900">{c.title}</span>
        <span className="text-xs text-stone-600">
          {STEP[c.state].words} · {c.changes} change{c.changes === 1 ? "" : "s"} · {c.yours ? "Yours" : `Started by ${c.author}`} · {day(c.updatedAt)}
        </span>
      </Link>
    </li>
  );

  return (
    <div className="space-y-6">
      <section className={card} aria-labelledby="cr-mine">
        <h2 id="cr-mine" className="font-display text-xl font-bold text-teal-deep">Your change requests</h2>
        {failed ? (
          <p className="mt-2 text-sm text-stone-700" role="alert">
            That did not load.{" "}
            <button type="button" onClick={load} className="min-h-[44px] font-semibold text-teal-deep underline">Try again</button>
          </p>
        ) : mine === null ? (
          <p className="mt-2 text-sm text-stone-500" role="status">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="mt-2 text-sm text-stone-700">You have none yet. Gather several changes here and the village votes on them together.</p>
        ) : (
          <ul className="mt-2 divide-y divide-stone-100">{mine.map(row)}</ul>
        )}
      </section>

      <section className={card} aria-labelledby="cr-start">
        <h2 id="cr-start" className="font-display text-xl font-bold text-teal-deep">Start a change request</h2>
        <p className="mt-1 text-sm text-stone-700">Give it a name and say why. Then add the changes, from here or from any setting with a Suggest button.</p>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <label className="block text-sm font-medium text-stone-900">
            Name
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} />
          </label>
          <label className="block text-sm font-medium text-stone-900">
            Why
            <textarea value={why} onChange={(e) => setWhy(e.target.value)} maxLength={4000} rows={3} className={`${field} py-2`} />
          </label>
          <button type="submit" className={primary} disabled={busy || !title.trim() || !why.trim()}>
            {busy ? "Starting…" : "Start it"}
          </button>
          <Say text={error} alert />
        </form>
      </section>

      <section className={card} aria-labelledby="cr-open">
        <h2 id="cr-open" className="font-display text-xl font-bold text-teal-deep">In review across the village</h2>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-stone-700">Nothing is being weighed right now.</p>
        ) : (
          <ul className="mt-2 divide-y divide-stone-100">{open.map(row)}</ul>
        )}
      </section>
    </div>
  );
}

function ChangeRow({ c, cr, act }: { c: Change; cr: ChangeRequest; act: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(c.after ?? "");
  const canEdit = cr.yours && (cr.state === "gathering" || cr.state === "in_review") && !c.withheld && c.change;
  return (
    <li className="py-3">
      <p className="font-medium text-stone-900">{c.label}</p>
      <BeforeAfter c={c} />
      {canEdit && !editing && (
        <div className="mt-1 flex flex-wrap gap-x-4">
          <button type="button" className="min-h-[44px] text-sm font-medium text-teal-deep underline" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className="min-h-[44px] text-sm font-medium text-teal-deep underline"
            onClick={() => void act(`/changes/${c.position}?revision=${cr.revision}`, "DELETE")}
          >
            Remove
          </button>
          {cr.state === "gathering" && cr.changes.length > 1 && (
            <button
              type="button"
              className="min-h-[44px] text-sm font-medium text-teal-deep underline"
              onClick={() => void act(`/changes/${c.position}/split`, "POST", { revision: cr.revision })}
            >
              Move to its own change request
            </button>
          )}
        </div>
      )}
      {editing && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(`/changes/${c.position}`, "PUT", { change: { ...c.change, to }, revision: cr.revision })) setEditing(false);
          }}
        >
          <label className="block grow text-sm font-medium text-stone-900">
            New value
            <input value={to} onChange={(e) => setTo(e.target.value)} className={field} />
          </label>
          <button type="submit" className={primary}>Save</button>
          <button type="button" className={quiet} onClick={() => setEditing(false)}>Not now</button>
        </form>
      )}
    </li>
  );
}

function NoteItem({ n, cr, notes, act }: { n: Note; cr: ChangeRequest; notes: Note[]; act: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [answering, setAnswering] = useState(false);
  const [text, setText] = useState("");
  const replies = notes.filter((r) => r.kind === "answer" && r.answers === n.id);
  const waiting = n.outcome === "open" && cr.state === "in_review" && cr.yours;
  const about = n.position !== null ? cr.changes[n.position]?.label : null;
  return (
    <li className="py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">
        {NOTE_WORDS[n.kind]}
        {about ? ` · ${about}` : ""}
        {n.outcome === "taken_in" ? " · Taken in" : n.outcome === "turned_down" ? " · Turned down" : n.outcome === "answered" ? " · Answered" : ""}
      </p>
      <p className="text-sm text-stone-600">
        {n.by} · {day(n.at)}
      </p>
      {n.kind === "edit" && n.proposed && (
        <p className="mt-1 text-sm text-stone-800">
          {n.proposed.op === "remove"
            ? "Take this change out."
            : `${n.proposed.op === "add" ? "Add" : "Change it to"}: ${shown(String((n.proposed.change as any)?.to ?? ""))}`}
        </p>
      )}
      {n.body && <p className="mt-1 whitespace-pre-line break-words text-stone-900">{n.body}</p>}
      {replies.map((r) => (
        <div key={r.id} className="mt-2 border-l-2 border-teal-deep/40 pl-3">
          <p className="text-sm text-stone-600">{r.by} answered</p>
          <p className="whitespace-pre-line break-words text-stone-900">{r.body}</p>
        </div>
      ))}
      {waiting && n.kind === "edit" && !answering && (
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="button" className={primary} onClick={() => void act(`/suggestions/${n.id}/take-in`, "POST", { revision: cr.revision })}>
            Take it in
          </button>
          <button type="button" className={quiet} onClick={() => setAnswering(true)}>Turn it down</button>
        </div>
      )}
      {waiting && n.kind !== "edit" && n.kind !== "consent" && !answering && (
        <button type="button" className="mt-1 min-h-[44px] text-sm font-medium text-teal-deep underline" onClick={() => setAnswering(true)}>
          Answer
        </button>
      )}
      {answering && (
        <form
          className="mt-2 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok =
              n.kind === "edit"
                ? await act(`/suggestions/${n.id}/turn-down`, "POST", { reason: text, revision: cr.revision })
                : await act(`/notes/${n.id}/answer`, "POST", { body: text, revision: cr.revision });
            if (ok) setAnswering(false);
          }}
        >
          <label className="block text-sm font-medium text-stone-900">
            {n.kind === "edit" ? "Why not, in one line" : "Your answer"}
            {n.kind === "edit" ? (
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={280} className={field} />
            ) : (
              <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} className={`${field} py-2`} />
            )}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={!text.trim()}>Send</button>
            <button type="button" className={quiet} onClick={() => setAnswering(false)}>Not now</button>
          </div>
        </form>
      )}
    </li>
  );
}

const POSTS: { kind: "question" | "concern" | "objection" | "consent" | "edit"; words: string; help: string }[] = [
  { kind: "question", words: "Ask a question", help: "Something you want to understand before you decide." },
  { kind: "concern", words: "Share a concern", help: "A worry you cannot point to yet." },
  { kind: "objection", words: "Object", help: "What harm could this do to the village, or what would it stop us doing?" },
  { kind: "edit", words: "Suggest an edit", help: "A different value for one of the changes. The author may take it in." },
  { kind: "consent", words: "I can live with this", help: "Counts for this version. An edit asks again." },
];

function ReviewForm({ cr, act }: { cr: ChangeRequest; act: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [kind, setKind] = useState<(typeof POSTS)[number]["kind"] | null>(null);
  const [body, setBody] = useState("");
  const [position, setPosition] = useState<string>("");
  const [to, setTo] = useState("");
  const helpId = useId();
  const chosen = POSTS.find((p) => p.kind === kind);

  const send = async () => {
    let ok = false;
    if (kind === "consent") ok = await act("/notes", "POST", { kind: "consent" });
    else if (kind === "edit") {
      const at = Number(position);
      const base = cr.changes[at]?.change;
      ok = await act("/suggestions", "POST", { op: "replace", position: at, change: { ...base, to }, body });
    } else ok = await act("/notes", "POST", { kind, body, position: position === "" ? null : Number(position) });
    if (ok) {
      setKind(null);
      setBody("");
      setTo("");
      setPosition("");
    }
  };

  return (
    <div className="mt-3">
      <p className="text-sm text-stone-700">Everyone in the village can read what you write here.</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Respond to this change request">
        {POSTS.map((p) => (
          <button
            key={p.kind}
            type="button"
            aria-pressed={kind === p.kind}
            onClick={() => (p.kind === "consent" ? void act("/notes", "POST", { kind: "consent" }) : setKind(p.kind))}
            className={kind === p.kind ? primary : quiet}
          >
            {p.words}
          </button>
        ))}
      </div>
      {chosen && kind !== "consent" && (
        <form
          className="mt-3 space-y-3"
          aria-describedby={helpId}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <p id={helpId} className="text-sm text-stone-700">{chosen.help}</p>
          <label className="block text-sm font-medium text-stone-900">
            Which change?
            <select value={position} onChange={(e) => setPosition(e.target.value)} className={field} required={kind === "edit"}>
              {kind !== "edit" && <option value="">The whole request</option>}
              {kind === "edit" && <option value="">Choose a change</option>}
              {cr.changes.map((c) => (
                <option key={c.position} value={String(c.position)}>{c.label}</option>
              ))}
            </select>
          </label>
          {kind === "edit" && (
            <label className="block text-sm font-medium text-stone-900">
              Your value
              <input value={to} onChange={(e) => setTo(e.target.value)} className={field} />
            </label>
          )}
          <label className="block text-sm font-medium text-stone-900">
            {kind === "objection" ? "The harm you see" : kind === "edit" ? "Why (optional)" : "Your words"}
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={3} className={`${field} py-2`} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={kind === "edit" ? position === "" || !to.trim() : !body.trim()}>
              Send
            </button>
            <button type="button" className={quiet} onClick={() => setKind(null)}>Not now</button>
          </div>
        </form>
      )}
    </div>
  );
}

function DetailPage({ id }: { id: string }) {
  const [cr, setCr] = useState<ChangeRequest | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editingWords, setEditingWords] = useState(false);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");

  const load = useCallback(() => {
    setFailed(null);
    fetch(`/api/change-requests/${encodeURIComponent(id)}`, { headers: headers() })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await refusal(r, "That did not load.")))))
      .then((b: ChangeRequest) => setCr(b))
      .catch((e) => setFailed(String(e?.message || "That did not load.")));
  }, [id]);
  useEffect(() => {
    if (authToken()) load();
  }, [load]);

  /** One call to this change request; the answer replaces what the page shows. */
  const act = async (path: string, method: string, body?: unknown): Promise<boolean> => {
    setError(null);
    setStatus(null);
    const res = await fetch(`/api/change-requests/${encodeURIComponent(id)}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    if (!res) {
      setError("That did not go through. Try again in a moment.");
      return false;
    }
    if (!res.ok) {
      setError(await refusal(res, "That was refused."));
      if (res.status === 409) load();
      return false;
    }
    const next = await res.json();
    if (next?.from && next?.id && path.endsWith("/split")) {
      setStatus("Moved into a change request of its own.");
      load();
      return true;
    }
    if (next?.deleted) {
      window.location.assign("/changes");
      return true;
    }
    setCr(next as ChangeRequest);
    setStatus("Saved.");
    return true;
  };

  if (!authToken()) return <p className="text-stone-700">Sign in to see what your village is weighing.</p>;
  if (failed)
    return (
      <p className="text-stone-700" role="alert">
        {failed}{" "}
        <button type="button" onClick={load} className="min-h-[44px] font-semibold text-teal-deep underline">Try again</button>
      </p>
    );
  if (!cr) return <p className="text-stone-500" role="status">Loading…</p>;

  const step = STEP[cr.state];
  const notes = cr.review?.notes ?? [];
  const top = notes.filter((n) => n.kind !== "answer");

  return (
    <div className="space-y-4">
      <header>
        <p className="text-sm font-medium text-stone-700" aria-label={`Step ${step.n} of 4: ${step.words}`}>
          Step {step.n} of 4: {step.words}
          {cr.state === "in_review" && cr.review ? `. Review ends ${day(cr.review.endsAt)}` : ""}
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold text-teal-deep sm:text-3xl break-words">{cr.title}</h1>
        <p className="mt-1 text-sm text-stone-600">{cr.yours ? "You started this" : `Started by ${cr.author}`}</p>
      </header>

      <section className={card} aria-labelledby="cr-why">
        <h2 id="cr-why" className="font-semibold text-stone-900">Why</h2>
        {editingWords ? (
          <form
            className="mt-2 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act("", "PATCH", { title, why, revision: cr.revision })) {
                setEditingWords(false);
                load();
              }
            }}
          >
            <label className="block text-sm font-medium text-stone-900">
              Name
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} />
            </label>
            <label className="block text-sm font-medium text-stone-900">
              Why
              <textarea value={why} onChange={(e) => setWhy(e.target.value)} maxLength={4000} rows={4} className={`${field} py-2`} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={primary}>Save</button>
              <button type="button" className={quiet} onClick={() => setEditingWords(false)}>Not now</button>
            </div>
          </form>
        ) : (
          <>
            <p className="mt-1 whitespace-pre-line break-words text-stone-900">{cr.why}</p>
            {cr.yours && (cr.state === "gathering" || cr.state === "in_review") && (
              <button
                type="button"
                className="mt-1 min-h-[44px] text-sm font-medium text-teal-deep underline"
                onClick={() => {
                  setTitle(cr.title);
                  setWhy(cr.why);
                  setEditingWords(true);
                }}
              >
                Edit the name or the why
              </button>
            )}
          </>
        )}
      </section>

      <section className={card} aria-labelledby="cr-changes">
        <h2 id="cr-changes" className="font-semibold text-stone-900">
          The changes <span className="font-normal text-stone-600">({cr.changes.length} of at most {cr.cap})</span>
        </h2>
        {cr.changes.length === 0 ? (
          <p className="mt-1 text-sm text-stone-700">
            No changes yet. Open any setting with a Suggest button, such as those in{" "}
            <Link href="/game-mechanics" className="font-medium text-teal-deep underline">Game Mechanics</Link>, and add it here.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {cr.changes.map((c) => (
              <ChangeRow key={`${c.position}:${c.key}`} c={c} cr={cr} act={act} />
            ))}
          </ul>
        )}
        {cr.yours && cr.state === "in_review" && <p className="mt-2 text-sm text-stone-700">Editing a change starts the review again.</p>}
      </section>

      {cr.yours && cr.state === "gathering" && (
        <section className={card} aria-labelledby="cr-next">
          <h2 id="cr-next" className="font-semibold text-stone-900">Ready for the village to review?</h2>
          <p className="mt-1 text-sm text-stone-700">
            The village can ask, raise concerns and objections, and suggest edits. The people whose roles look after these settings are asked to look.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={cr.changes.length === 0} onClick={() => void act("/open-review", "POST", { revision: cr.revision })}>
              Open for review
            </button>
            <button
              type="button"
              className={quiet}
              onClick={() => {
                if (window.confirm("Delete this change request? This cannot be undone.")) void act(`?revision=${cr.revision}`, "DELETE");
              }}
            >
              Delete
            </button>
          </div>
        </section>
      )}

      {cr.review && (
        <section className={card} aria-labelledby="cr-ready">
          <h2 id="cr-ready" className="font-semibold text-stone-900">Before the vote</h2>
          <ul className="mt-2 space-y-1">
            {cr.review.checklist.map((l) => (
              <li key={l.key} className="flex items-start gap-2 text-sm">
                {l.done ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                ) : (
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                )}
                <span>
                  <span className="font-medium text-stone-900">
                    {l.key === "changes" ? "Changes" : l.key === "review_time" ? "Time to review" : "Objections answered"}:
                  </span>{" "}
                  <span className="text-stone-700">{l.key === "review_time" && !l.done ? `Waits until ${moment(cr.review!.endsAt)}` : l.words}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-stone-700">
            {cr.review.consents} {cr.review.consents === 1 ? "person can" : "people can"} live with this version.
          </p>
        </section>
      )}

      {cr.review && (
        <section className={card} aria-labelledby="cr-review">
          <h2 id="cr-review" className="flex items-center gap-2 font-semibold text-stone-900">
            <MessageSquare className="h-4 w-4 text-stone-500" aria-hidden="true" /> The review
          </h2>
          {top.length === 0 ? (
            <p className="mt-1 text-sm text-stone-700">Nobody has written yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {top.map((n) => (
                <NoteItem key={n.id} n={n} cr={cr} notes={notes} act={act} />
              ))}
            </ul>
          )}
          {cr.state === "in_review" && <ReviewForm cr={cr} act={act} />}
        </section>
      )}

      <Say text={error} alert />
      <Say text={status} />
    </div>
  );
}

export default function ChangeRequests() {
  const [, params] = useRoute("/changes/:id");
  const id = params?.id ?? null;
  useEffect(() => {
    document.title = id ? "Change request" : "Change requests";
  }, [id]);
  return (
    <main className="min-h-screen bg-stone-50 px-4 pb-28 pt-6 sm:px-6">
      <div className="mx-auto max-w-3xl">
        {id ? (
          <Link href="/changes" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-teal-deep hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All change requests
          </Link>
        ) : (
          <div className="mb-4">
            <h1 className="flex items-center gap-2 font-display text-3xl font-bold text-teal-deep">
              <GitPullRequest className="h-7 w-7" aria-hidden="true" /> Change requests
            </h1>
            <p className="mt-1 text-stone-700">
              Gather connected changes to the village's settings, say why once, let the village review them, and send them to one vote.
            </p>
          </div>
        )}
        {id ? <DetailPage id={id} /> : <ListPage />}
      </div>
    </main>
  );
}
