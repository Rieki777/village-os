/**
 * CHANGE REQUESTS: the list and one change request (Rye, 2026-11-06; spec
 * village-os-ops/internal/spec/change-requests/, US1, US3, R35 to R41).
 *
 *   /changes      the member's own change requests, and everyone's in review
 *   /changes/:id  one change request: its changes before and after, its review,
 *                 and what is still needed before it can go to the vote
 *
 * One lazy page for both routes, so the feature costs one chunk (VII.2).
 * Everything a member reads here that the SERVER decides comes from the server
 * in plain words: the checklist lines, the names ("Role (FirstName)", III.2),
 * the refusals. The page's own words go through Lingui (spec i18n US6.1), with
 * a context on every short one so a translator can tell them apart.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
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

type I18n = ReturnType<typeof useLingui>["i18n"];

const STEP_NUMBER: Record<State, number> = { gathering: 1, in_review: 2, voting: 3, closed: 4 };

// Words chosen outside a component are `msg` descriptors, rendered with
// i18n._ where they are shown, so the macro compiles them (spec i18n US6.1).
const STEP_WORDS: Record<State, MessageDescriptor> = {
  gathering: msg({ message: "Gathering", context: "change request step" }),
  in_review: msg({ message: "In review", context: "change request step" }),
  voting: msg({ message: "In the vote", context: "change request step" }),
  closed: msg({ message: "Decided", context: "change request step" }),
};

const NOTE_WORDS: Record<Note["kind"], MessageDescriptor> = {
  question: msg({ message: "Question", context: "change request note kind" }),
  concern: msg({ message: "Concern", context: "change request note kind" }),
  objection: msg({ message: "Objection", context: "change request note kind" }),
  edit: msg({ message: "Suggested edit", context: "change request note kind" }),
  consent: msg({ message: "Can live with it", context: "change request note kind" }),
  answer: msg({ message: "Answer", context: "change request note kind" }),
};

const OUTCOME_WORDS: Partial<Record<Note["outcome"], MessageDescriptor>> = {
  taken_in: msg({ message: "Taken in", context: "change request note outcome" }),
  turned_down: msg({ message: "Turned down", context: "change request note outcome" }),
  answered: msg({ message: "Answered", context: "change request note outcome" }),
};

const CHECKLIST_LABEL: Record<string, MessageDescriptor> = {
  changes: msg({ message: "Changes", context: "change request checklist" }),
  review_time: msg({ message: "Time to review", context: "change request checklist" }),
  objections: msg({ message: "Objections answered", context: "change request checklist" }),
};

const stepWords = (i18n: I18n, state: State) => i18n._(STEP_WORDS[state]);
const noteWords = (i18n: I18n, kind: Note["kind"]) => i18n._(NOTE_WORDS[kind]);
const outcomeWords = (i18n: I18n, outcome: Note["outcome"]) => (OUTCOME_WORDS[outcome] ? i18n._(OUTCOME_WORDS[outcome]!) : "");
const checklistLabel = (i18n: I18n, key: string) => i18n._(CHECKLIST_LABEL[key] ?? CHECKLIST_LABEL.objections);

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const moment = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const card = "rounded-xl border border-stone-200 bg-white p-4";
const primary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-50";
const quiet =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep";
const field = "mt-1 block w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900";
const link = "min-h-[44px] text-sm font-medium text-teal-deep underline";

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
  const { t } = useLingui();
  const shown = (v: string | null) => (v === null || v === "" ? t({ message: "not set", context: "a setting with no value" }) : v);
  if (c.withheld)
    return (
      <p className="mt-1 text-sm text-stone-600">
        <Trans context="a setting whose value is hidden">Kept private</Trans>
      </p>
    );
  const before = shown(c.before);
  const after = shown(c.after);
  const label = c.label;
  return (
    <div className="mt-1 text-sm" aria-label={t({ message: `${label}, from ${before} to ${after}`, context: "screen reader name of one change" })} role="group">
      <p className="break-words text-stone-600">
        <span aria-hidden="true" className="mr-1 text-xs uppercase tracking-wide text-stone-500">
          <Trans context="the value of a setting today">Now</Trans>
        </span>
        <del className="text-stone-600">{before}</del>
      </p>
      <p className="break-words font-semibold text-teal-deep">
        <span aria-hidden="true" className="mr-1 text-xs font-normal uppercase tracking-wide text-stone-500">
          <Trans context="the value of a setting once changed">After</Trans>
        </span>
        <ins className="no-underline">{after}</ins>
      </p>
    </div>
  );
}

function SignInLine() {
  return (
    <p className="text-stone-700">
      <Trans>Sign in to see what your village is weighing.</Trans>
    </p>
  );
}

function ListPage() {
  const { t, i18n } = useLingui();
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
    if (!res) return setError(t`That did not go through. Try again in a moment.`);
    if (!res.ok) return setError(await refusal(res, t`That change request could not be started.`));
    const { id } = await res.json();
    window.location.assign(`/changes/${id}`);
  };

  if (!signedIn) return <SignInLine />;

  const row = (c: ChangeRequestSummary) => {
    const step = stepWords(i18n, c.state);
    const author = c.author;
    const who = c.yours ? t({ message: "Yours", context: "a change request you started" }) : t({ message: `Started by ${author}`, context: "who started a change request" });
    const when = day(c.updatedAt);
    return (
      <li key={c.id}>
        <Link
          href={`/changes/${c.id}`}
          className="flex min-h-[44px] flex-col gap-0.5 rounded-lg px-3 py-2 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          <span className="font-medium text-stone-900">{c.title}</span>
          <span className="text-xs text-stone-600">
            {step} · <Plural value={c.changes} one="# change" other="# changes" /> · {who} · {when}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <section className={card} aria-labelledby="cr-mine">
        <h2 id="cr-mine" className="font-display text-xl font-bold text-teal-deep">
          <Trans context="heading on the change requests page">Your change requests</Trans>
        </h2>
        {failed ? (
          <p className="mt-2 text-sm text-stone-700" role="alert">
            <Trans>That did not load.</Trans>{" "}
            <button type="button" onClick={load} className="min-h-[44px] font-semibold text-teal-deep underline">
              <Trans context="retry a failed read">Try again</Trans>
            </button>
          </p>
        ) : mine === null ? (
          <p className="mt-2 text-sm text-stone-500" role="status">
            <Trans context="a page loading">Loading…</Trans>
          </p>
        ) : mine.length === 0 ? (
          <p className="mt-2 text-sm text-stone-700">
            <Trans>You have none yet. Gather several changes here and the village votes on them together.</Trans>
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-stone-100">{mine.map(row)}</ul>
        )}
      </section>

      <section className={card} aria-labelledby="cr-start">
        <h2 id="cr-start" className="font-display text-xl font-bold text-teal-deep">
          <Trans context="heading on the change requests page">Start a change request</Trans>
        </h2>
        <p className="mt-1 text-sm text-stone-700">
          <Trans>Give it a name and say why. Then add the changes, from here or from any setting with a Suggest button.</Trans>
        </p>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <label className="block text-sm font-medium text-stone-900">
            <Trans context="the name of a change request">Name</Trans>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} />
          </label>
          <label className="block text-sm font-medium text-stone-900">
            <Trans context="the reason for a change request">Why</Trans>
            <textarea value={why} onChange={(e) => setWhy(e.target.value)} maxLength={4000} rows={3} className={`${field} py-2`} />
          </label>
          <button type="submit" className={primary} disabled={busy || !title.trim() || !why.trim()}>
            {busy ? t({ message: "Starting…", context: "starting a change request" }) : t({ message: "Start it", context: "start a change request" })}
          </button>
          <Say text={error} alert />
        </form>
      </section>

      <section className={card} aria-labelledby="cr-open">
        <h2 id="cr-open" className="font-display text-xl font-bold text-teal-deep">
          <Trans context="heading on the change requests page">In review across the village</Trans>
        </h2>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-stone-700">
            <Trans>Nothing is being weighed right now.</Trans>
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-stone-100">{open.map(row)}</ul>
        )}
      </section>
    </div>
  );
}

type Act = (path: string, method: string, body?: unknown) => Promise<boolean>;

function ChangeRow({ c, cr, act }: { c: Change; cr: ChangeRequest; act: Act }) {
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(c.after ?? "");
  const canEdit = cr.yours && (cr.state === "gathering" || cr.state === "in_review") && !c.withheld && c.change;
  return (
    <li className="py-3">
      <p className="font-medium text-stone-900">{c.label}</p>
      <BeforeAfter c={c} />
      {canEdit && !editing && (
        <div className="mt-1 flex flex-wrap gap-x-4">
          <button type="button" className={link} onClick={() => setEditing(true)}>
            <Trans context="edit one change">Edit</Trans>
          </button>
          <button type="button" className={link} onClick={() => void act(`/changes/${c.position}?revision=${cr.revision}`, "DELETE")}>
            <Trans context="remove one change">Remove</Trans>
          </button>
          {cr.state === "gathering" && cr.changes.length > 1 && (
            <button type="button" className={link} onClick={() => void act(`/changes/${c.position}/split`, "POST", { revision: cr.revision })}>
              <Trans>Move to its own change request</Trans>
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
            <Trans context="the new value of a setting">New value</Trans>
            <input value={to} onChange={(e) => setTo(e.target.value)} className={field} />
          </label>
          <button type="submit" className={primary}>
            <Trans context="save a change">Save</Trans>
          </button>
          <button type="button" className={quiet} onClick={() => setEditing(false)}>
            <Trans context="close a form without saving">Not now</Trans>
          </button>
        </form>
      )}
    </li>
  );
}

function NoteItem({ n, cr, notes, act }: { n: Note; cr: ChangeRequest; notes: Note[]; act: Act }) {
  const { t, i18n } = useLingui();
  const [answering, setAnswering] = useState(false);
  const [text, setText] = useState("");
  const replies = notes.filter((r) => r.kind === "answer" && r.answers === n.id);
  const waiting = n.outcome === "open" && cr.state === "in_review" && cr.yours;
  const about = n.position !== null ? cr.changes[n.position]?.label : null;
  const outcome = outcomeWords(i18n, n.outcome);
  const when = day(n.at);
  const proposedTo = String((n.proposed?.change as any)?.to ?? "");
  return (
    <li className="py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">
        {noteWords(i18n, n.kind)}
        {about ? ` · ${about}` : ""}
        {outcome ? ` · ${outcome}` : ""}
      </p>
      <p className="text-sm text-stone-600">
        {n.by} · {when}
      </p>
      {n.kind === "edit" && n.proposed && (
        <p className="mt-1 text-sm text-stone-800">
          {n.proposed.op === "remove" ? (
            <Trans>Take this change out.</Trans>
          ) : n.proposed.op === "add" ? (
            <Trans context="a suggested edit that adds a change">Add: {proposedTo}</Trans>
          ) : (
            <Trans context="a suggested edit that changes a value">Change it to: {proposedTo}</Trans>
          )}
        </p>
      )}
      {n.body && <p className="mt-1 whitespace-pre-line break-words text-stone-900">{n.body}</p>}
      {replies.map((r) => {
        const by = r.by;
        return (
          <div key={r.id} className="mt-2 border-l-2 border-teal-deep/40 pl-3">
            <p className="text-sm text-stone-600">
              <Trans context="who answered a note">{by} answered</Trans>
            </p>
            <p className="whitespace-pre-line break-words text-stone-900">{r.body}</p>
          </div>
        );
      })}
      {waiting && n.kind === "edit" && !answering && (
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="button" className={primary} onClick={() => void act(`/suggestions/${n.id}/take-in`, "POST", { revision: cr.revision })}>
            <Trans context="accept a suggested edit">Take it in</Trans>
          </button>
          <button type="button" className={quiet} onClick={() => setAnswering(true)}>
            <Trans context="decline a suggested edit">Turn it down</Trans>
          </button>
        </div>
      )}
      {waiting && n.kind !== "edit" && n.kind !== "consent" && !answering && (
        <button type="button" className={`mt-1 ${link}`} onClick={() => setAnswering(true)}>
          <Trans context="answer a note in a review">Answer</Trans>
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
            {n.kind === "edit" ? t`Why not, in one line` : t({ message: "Your answer", context: "label of an answer box" })}
            {n.kind === "edit" ? (
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={280} className={field} />
            ) : (
              <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} className={`${field} py-2`} />
            )}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={!text.trim()}>
              <Trans context="send a note">Send</Trans>
            </button>
            <button type="button" className={quiet} onClick={() => setAnswering(false)}>
              <Trans context="close a form without saving">Not now</Trans>
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

type PostKind = "question" | "concern" | "objection" | "consent" | "edit";

function ReviewForm({ cr, act }: { cr: ChangeRequest; act: Act }) {
  const { t } = useLingui();
  const [kind, setKind] = useState<PostKind | null>(null);
  const [body, setBody] = useState("");
  const [position, setPosition] = useState<string>("");
  const [to, setTo] = useState("");
  const helpId = useId();

  const posts: { kind: PostKind; words: string; help: string }[] = [
    { kind: "question", words: t({ message: "Ask a question", context: "review response" }), help: t`Something you want to understand before you decide.` },
    { kind: "concern", words: t({ message: "Share a concern", context: "review response" }), help: t`A worry you cannot point to yet.` },
    { kind: "objection", words: t({ message: "Object", context: "review response" }), help: t`What harm could this do to the village, or what would it stop us doing?` },
    { kind: "edit", words: t({ message: "Suggest an edit", context: "review response" }), help: t`A different value for one of the changes. The author may take it in.` },
    { kind: "consent", words: t({ message: "I can live with this", context: "review response" }), help: t`Counts for this version. An edit asks again.` },
  ];
  const chosen = posts.find((p) => p.kind === kind);

  const send = async () => {
    let ok = false;
    if (kind === "edit") {
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
      <p className="text-sm text-stone-700">
        <Trans>Everyone in the village can read what you write here.</Trans>
      </p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t`Respond to this change request`}>
        {posts.map((p) => (
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
          <p id={helpId} className="text-sm text-stone-700">
            {chosen.help}
          </p>
          <label className="block text-sm font-medium text-stone-900">
            <Trans context="pick which change a note is about">Which change?</Trans>
            <select value={position} onChange={(e) => setPosition(e.target.value)} className={field} required={kind === "edit"}>
              {kind !== "edit" && <option value="">{t({ message: "The whole request", context: "a note about every change" })}</option>}
              {kind === "edit" && <option value="">{t({ message: "Choose a change", context: "pick a change to edit" })}</option>}
              {cr.changes.map((c) => (
                <option key={c.position} value={String(c.position)}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {kind === "edit" && (
            <label className="block text-sm font-medium text-stone-900">
              <Trans context="the value a member suggests">Your value</Trans>
              <input value={to} onChange={(e) => setTo(e.target.value)} className={field} />
            </label>
          )}
          <label className="block text-sm font-medium text-stone-900">
            {kind === "objection"
              ? t({ message: "The harm you see", context: "label of an objection box" })
              : kind === "edit"
                ? t({ message: "Why (optional)", context: "label of a suggested edit's reason" })
                : t({ message: "Your words", context: "label of a note box" })}
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={3} className={`${field} py-2`} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={kind === "edit" ? position === "" || !to.trim() : !body.trim()}>
              <Trans context="send a note">Send</Trans>
            </button>
            <button type="button" className={quiet} onClick={() => setKind(null)}>
              <Trans context="close a form without saving">Not now</Trans>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function DetailPage({ id }: { id: string }) {
  const { t, i18n } = useLingui();
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
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await refusal(r, "")))))
      .then((b: ChangeRequest) => setCr(b))
      .catch((e) => setFailed(String(e?.message || "")));
  }, [id]);
  useEffect(() => {
    if (authToken()) load();
  }, [load]);

  /** One call to this change request; the answer replaces what the page shows. */
  const act: Act = async (path, method, body) => {
    setError(null);
    setStatus(null);
    const res = await fetch(`/api/change-requests/${encodeURIComponent(id)}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    if (!res) {
      setError(t`That did not go through. Try again in a moment.`);
      return false;
    }
    if (!res.ok) {
      setError(await refusal(res, t({ message: "That was refused.", context: "a request the server refused" })));
      if (res.status === 409) load();
      return false;
    }
    const next = await res.json();
    if (next?.from && next?.id && path.endsWith("/split")) {
      setStatus(t`Moved into a change request of its own.`);
      load();
      return true;
    }
    if (next?.deleted) {
      window.location.assign("/changes");
      return true;
    }
    setCr(next as ChangeRequest);
    setStatus(t({ message: "Saved.", context: "a change was saved" }));
    return true;
  };

  if (!authToken()) return <SignInLine />;
  if (failed !== null)
    return (
      <p className="text-stone-700" role="alert">
        {failed || t`That did not load.`}{" "}
        <button type="button" onClick={load} className="min-h-[44px] font-semibold text-teal-deep underline">
          <Trans context="retry a failed read">Try again</Trans>
        </button>
      </p>
    );
  if (!cr)
    return (
      <p className="text-stone-500" role="status">
        <Trans context="a page loading">Loading…</Trans>
      </p>
    );

  const n = STEP_NUMBER[cr.state];
  const words = stepWords(i18n, cr.state);
  const ends = cr.review ? day(cr.review.endsAt) : "";
  const author = cr.author;
  const notes = cr.review?.notes ?? [];
  const top = notes.filter((x) => x.kind !== "answer");
  const count = cr.changes.length;
  const cap = cr.cap;

  return (
    <div className="space-y-4">
      <header>
        <p className="text-sm font-medium text-stone-700">
          {cr.state === "in_review" && cr.review ? (
            <Trans>
              Step {n} of 4: {words}. Review ends {ends}
            </Trans>
          ) : (
            <Trans context="which step a change request is on">
              Step {n} of 4: {words}
            </Trans>
          )}
        </p>
        <h1 className="mt-1 break-words font-display text-2xl font-bold text-teal-deep sm:text-3xl">{cr.title}</h1>
        <p className="mt-1 text-sm text-stone-600">{cr.yours ? <Trans context="the reader started this change request">You started this</Trans> : <Trans context="who started a change request">Started by {author}</Trans>}</p>
      </header>

      <section className={card} aria-labelledby="cr-why">
        <h2 id="cr-why" className="font-semibold text-stone-900">
          <Trans context="the reason for a change request">Why</Trans>
        </h2>
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
              <Trans context="the name of a change request">Name</Trans>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} />
            </label>
            <label className="block text-sm font-medium text-stone-900">
              <Trans context="the reason for a change request">Why</Trans>
              <textarea value={why} onChange={(e) => setWhy(e.target.value)} maxLength={4000} rows={4} className={`${field} py-2`} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={primary}>
                <Trans context="save a change">Save</Trans>
              </button>
              <button type="button" className={quiet} onClick={() => setEditingWords(false)}>
                <Trans context="close a form without saving">Not now</Trans>
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="mt-1 whitespace-pre-line break-words text-stone-900">{cr.why}</p>
            {cr.yours && (cr.state === "gathering" || cr.state === "in_review") && (
              <button
                type="button"
                className={`mt-1 ${link}`}
                onClick={() => {
                  setTitle(cr.title);
                  setWhy(cr.why);
                  setEditingWords(true);
                }}
              >
                <Trans>Edit the name or the why</Trans>
              </button>
            )}
          </>
        )}
      </section>

      <section className={card} aria-labelledby="cr-changes">
        <h2 id="cr-changes" className="font-semibold text-stone-900">
          <Trans context="heading of the list of changes">The changes</Trans>{" "}
          <span className="font-normal text-stone-600">
            <Trans>
              ({count} of at most {cap})
            </Trans>
          </span>
        </h2>
        {count === 0 ? (
          <p className="mt-1 text-sm text-stone-700">
            <Trans>
              No changes yet. Open any setting with a Suggest button, such as those in{" "}
              <Link href="/game-mechanics" className="font-medium text-teal-deep underline">
                Game Mechanics
              </Link>
              , and add it here.
            </Trans>
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {cr.changes.map((c) => (
              <ChangeRow key={`${c.position}:${c.key}`} c={c} cr={cr} act={act} />
            ))}
          </ul>
        )}
        {cr.yours && cr.state === "in_review" && (
          <p className="mt-2 text-sm text-stone-700">
            <Trans>Editing a change starts the review again.</Trans>
          </p>
        )}
      </section>

      {cr.yours && cr.state === "gathering" && (
        <section className={card} aria-labelledby="cr-next">
          <h2 id="cr-next" className="font-semibold text-stone-900">
            <Trans>Ready for the village to review?</Trans>
          </h2>
          <p className="mt-1 text-sm text-stone-700">
            <Trans>
              The village can ask, raise concerns and objections, and suggest edits. The people whose roles look after these settings are asked to look.
            </Trans>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={count === 0} onClick={() => void act("/open-review", "POST", { revision: cr.revision })}>
              <Trans context="open a change request for review">Open for review</Trans>
            </button>
            <button
              type="button"
              className={quiet}
              onClick={() => {
                if (window.confirm(t`Delete this change request? This cannot be undone.`)) void act(`?revision=${cr.revision}`, "DELETE");
              }}
            >
              <Trans context="delete a change request">Delete</Trans>
            </button>
          </div>
        </section>
      )}

      {cr.review && (
        <section className={card} aria-labelledby="cr-ready">
          <h2 id="cr-ready" className="font-semibold text-stone-900">
            <Trans context="heading of the checklist">Before the vote</Trans>
          </h2>
          <ul className="mt-2 space-y-1">
            {cr.review.checklist.map((l) => {
              const until = moment(cr.review!.endsAt);
              return (
                <li key={l.key} className="flex items-start gap-2 text-sm">
                  {l.done ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                  ) : (
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                  )}
                  <span>
                    <span className="font-medium text-stone-900">{checklistLabel(i18n, l.key)}:</span>{" "}
                    <span className="text-stone-700">{l.key === "review_time" && !l.done ? t({ message: `Waits until ${until}`, context: "when the review time ends" }) : l.words}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-sm text-stone-700">
            <Plural value={cr.review.consents} one="# person can live with this version." other="# people can live with this version." />
          </p>
        </section>
      )}

      {cr.review && (
        <section className={card} aria-labelledby="cr-review">
          <h2 id="cr-review" className="flex items-center gap-2 font-semibold text-stone-900">
            <MessageSquare className="h-4 w-4 text-stone-500" aria-hidden="true" />{" "}
            <Trans context="heading of the review feed">The review</Trans>
          </h2>
          {top.length === 0 ? (
            <p className="mt-1 text-sm text-stone-700">
              <Trans>Nobody has written yet.</Trans>
            </p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {top.map((x) => (
                <NoteItem key={x.id} n={x} cr={cr} notes={notes} act={act} />
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
  return (
    <main className="min-h-screen bg-stone-50 px-4 pb-28 pt-6 sm:px-6">
      <div className="mx-auto max-w-3xl">
        {id ? (
          <Link href="/changes" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-teal-deep hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> <Trans context="link back to the list">All change requests</Trans>
          </Link>
        ) : (
          <div className="mb-4">
            <h1 className="flex items-center gap-2 font-display text-3xl font-bold text-teal-deep">
              <GitPullRequest className="h-7 w-7" aria-hidden="true" /> <Trans context="page heading">Change requests</Trans>
            </h1>
            <p className="mt-1 text-stone-700">
              <Trans>Gather connected changes to the village's settings, say why once, let the village review them, and send them to one vote.</Trans>
            </p>
          </div>
        )}
        {id ? <DetailPage id={id} /> : <ListPage />}
      </div>
    </main>
  );
}
