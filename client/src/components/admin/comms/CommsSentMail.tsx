/**
 * SENT MAIL, in the Comms section of Admin (the comms build spec 5.1 and 6):
 * every email the village has written, what became of each, and the two things
 * a person running the village's email may do about one.
 *
 * Reads `GET /api/admin/comms/messages` (a filtered page) and
 * `GET /api/admin/comms/messages/:id` (one email, its words and its delivery
 * reports), and acts through `POST .../:id/retry` and `POST .../:id/cancel`.
 * server/routes/commsSent.ts says who may, and why a retry is sometimes
 * refused.
 *
 * THE WORDS RENDER IN A SANDBOX. An email's HTML is shown in an iframe with
 * `sandbox` set and nothing allowed, so nothing in it can run, submit, or reach
 * this page. The plain-text part is shown as text.
 *
 * NOT MODULE-GATED: essential mail and notices go out whatever the comms module
 * says, so the record of them has to be readable while it is off.
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { EmailKind, MessageStatus, SkipReason } from "@shared/comms/kinds";
import { EMAIL_KINDS, MESSAGE_STATUSES } from "@shared/comms/kinds";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";

interface MessageRow {
  id: string;
  createdAt: string;
  sentAt: string | null;
  toEmail: string;
  kind: EmailKind;
  origin: string;
  subject: string;
  status: MessageStatus;
  skipReason: SkipReason | null;
  attempts: number;
  lastError: string | null;
  rehearsalTo: string | null;
  hasBody: boolean;
}

interface ListAnswer {
  messages: MessageRow[];
  total: number;
  page: number;
  pageSize: number;
  origins: Array<{ origin: string; count: number }>;
}

interface Detail extends MessageRow {
  replyTo: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: Array<{ filename: string; contentType: string; bytes: number }>;
  templateKey: string | null;
  journeyKey: string | null;
  stepKey: string | null;
  provider: string | null;
  providerMessageId: string | null;
  sendAfter: string | null;
  nextAttemptAt: string | null;
  expiresAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  wordsNote: string | null;
}

interface DetailAnswer {
  message: Detail;
  reports: Array<{ id: string; type: string; receivedAt: string; processedAt: string | null; outcome: string | null }>;
  canRetry: boolean;
  canCancel: boolean;
}

interface Filters {
  status: string;
  kind: string;
  origin: string;
  q: string;
  from: string;
  to: string;
}

const NO_FILTERS: Filters = { status: "", kind: "", origin: "", q: "", from: "", to: "" };

/** What each status means to somebody reading the list. Keyed by the union, so a new status cannot render blank. */
const STATUS_LABEL: Record<MessageStatus, string> = {
  queued: "Waiting to go",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  skipped: "Not sent",
  expired: "Too late, not sent",
  rehearsed: "Sent to the rehearsal inbox",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<MessageStatus, string> = {
  queued: "border-gray-300 bg-gray-50 text-gray-700",
  sending: "border-gray-300 bg-gray-50 text-gray-700",
  sent: "border-sky-200 bg-sky-50 text-sky-800",
  delivered: "border-emerald-200 bg-emerald-50 text-emerald-800",
  bounced: "border-red-200 bg-red-50 text-red-700",
  complained: "border-red-200 bg-red-50 text-red-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  skipped: "border-amber-200 bg-amber-50 text-amber-800",
  expired: "border-amber-200 bg-amber-50 text-amber-800",
  rehearsed: "border-violet-200 bg-violet-50 text-violet-800",
  cancelled: "border-gray-300 bg-gray-50 text-gray-600",
};

const KIND_LABEL: Record<EmailKind, string> = {
  essential: "Essential",
  events: "Gatherings",
  paths: "Paths",
  letters: "Letters",
  notices: "Notices",
};

/** Why an email was not sent, finishing the sentence "Not sent, because". */
const SKIP_LABEL: Record<SkipReason, string> = {
  no_permission: "they have not said yes to this kind of email",
  suppressed: "the address is on the list that receives essential mail only",
  over_cap: "they had already had their automated emails for the day",
  paused: "all email was paused",
  module_off: "Village Comms is switched off",
  not_configured: "sending is not set up yet",
  bad_address: "the address cannot be written to",
  expired: "it was too late to be worth sending",
  duplicate: "the same email had already been written",
};

const at = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : "");

function StatusBadge({ status }: { status: MessageStatus }) {
  // self-start: on a phone the row is a column, and a column stretches its
  // children, which turned the badge into a bar the width of the screen.
  return (
    <span
      className={`inline-block self-start rounded-full border px-2 py-0.5 text-xs font-medium sm:self-center ${STATUS_TONE[status] ?? STATUS_TONE.queued}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function query(filters: Filters, page: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v.trim()) p.set(k, v.trim());
  if (page > 0) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default function CommsSentMail({ password }: { password: string }) {
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [list, setList] = useState<ListAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailAnswer | null>(null);
  const [detailProblem, setDetailProblem] = useState("");
  const [acting, setActing] = useState(false);
  const detailRef = useRef<HTMLElement | null>(null);

  // The email opens below a list of fifty, which on a phone is out of sight,
  // so choosing one brings it into view: once it has LOADED, because before
  // that the section is one short line at the foot of the page and there is no
  // room below it to scroll its top into view. Optional, because not every
  // browser (or test DOM) has scrollIntoView.
  const shownId = detail?.message.id ?? null;
  useEffect(() => {
    if (shownId) detailRef.current?.scrollIntoView?.({ block: "start" });
  }, [shownId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/comms/messages${query(filters, page)}`, { headers: authHeaders(password) });
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        setList(body as ListAnswer);
        setProblem("");
      } else {
        setList(null);
        setProblem(refusal(body, "The record of sent mail could not be read."));
      }
    } catch {
      setList(null);
      setProblem("The record of sent mail could not be read. Check your connection, then reload.");
    }
    setLoading(false);
  }, [filters, page, password]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(
    async (id: string) => {
      setOpenId(id);
      setDetail(null);
      setDetailProblem("");
      try {
        const res = await fetch(`${API_BASE}/admin/comms/messages/${encodeURIComponent(id)}`, { headers: authHeaders(password) });
        const body = await res.json().catch(() => null);
        if (res.ok && body) setDetail(body as DetailAnswer);
        else setDetailProblem(refusal(body, "This email could not be read."));
      } catch {
        setDetailProblem("This email could not be read. Check your connection, then try again.");
      }
    },
    [password],
  );

  const act = async (id: string, action: "retry" | "cancel") => {
    setActing(true);
    try {
      const res = await fetch(`${API_BASE}/admin/comms/messages/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: "{}",
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(String(body?.message ?? (action === "retry" ? "It is back in the queue." : "It will not be sent.")));
        await Promise.all([load(), open(id)]);
      } else {
        toast.error(refusal(body, action === "retry" ? "It could not be tried again." : "It could not be cancelled."));
      }
    } catch {
      toast.error("That did not reach the server. Check your connection, then try again.");
    }
    setActing(false);
  };

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setFilters({ ...draft });
  };

  const clear = () => {
    setDraft(NO_FILTERS);
    setPage(0);
    setFilters(NO_FILTERS);
  };

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;
  const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900";
  const label = "mb-1 block text-xs font-medium text-gray-700";
  const button =
    "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold text-gray-900">Sent mail</h2>
            <p className="mt-2 text-sm text-gray-600">
              Every email the village writes is recorded here before it goes: password links, form replies, notices,
              reminders and letters. Each one says what became of it. An email and its words are kept for as long as
              the village's email record setting says, and the words of essential mail are never kept.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className={button}>
            {loading ? "Reading" : "Reload"}
          </button>
        </div>

        <form onSubmit={apply} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="sent-status" className={label}>What became of it</label>
            <select id="sent-status" className={field} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">Any</option>
              {MESSAGE_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sent-kind" className={label}>Kind of email</label>
            <select id="sent-kind" className={field} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              <option value="">Any</option>
              {EMAIL_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sent-origin" className={label}>What wrote it</label>
            <select id="sent-origin" className={field} value={draft.origin} onChange={(e) => setDraft({ ...draft, origin: e.target.value })}>
              <option value="">Anything</option>
              {(list?.origins ?? []).map((o) => (
                <option key={o.origin} value={o.origin}>{`${o.origin} (${o.count})`}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sent-q" className={label}>Address contains</label>
            <input id="sent-q" type="search" className={field} value={draft.q} placeholder="name@example.org" onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
          </div>
          <div>
            <label htmlFor="sent-from" className={label}>Written on or after</label>
            <input id="sent-from" type="date" className={field} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </div>
          <div>
            <label htmlFor="sent-to" className={label}>Written on or before</label>
            <input id="sent-to" type="date" className={field} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
            <button type="submit" className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
              Show
            </button>
            <button type="button" onClick={clear} className={button}>
              Clear
            </button>
          </div>
        </form>
      </div>

      {problem && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {problem}
        </p>
      )}

      {list && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 text-sm text-gray-600">
            <span>{list.total === 1 ? "1 email" : `${list.total} emails`}</span>
            {pages > 1 && (
              <span className="flex items-center gap-2">
                <button type="button" className={button} disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>
                  Newer
                </button>
                <span>{`Page ${page + 1} of ${pages}`}</span>
                <button type="button" className={button} disabled={page + 1 >= pages || loading} onClick={() => setPage(page + 1)}>
                  Older
                </button>
              </span>
            )}
          </div>
          {list.messages.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">No email matches these filters.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {list.messages.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => void open(m.id)}
                    aria-expanded={openId === m.id}
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-4 ${openId === m.id ? "bg-gray-50" : ""}`}
                  >
                    <span className="w-40 shrink-0 text-xs text-gray-500">{at(m.createdAt)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{m.subject}</span>
                      <span className="block truncate text-xs text-gray-600">{`${m.toEmail} · ${KIND_LABEL[m.kind] ?? m.kind} · ${m.origin}`}</span>
                    </span>
                    <StatusBadge status={m.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {openId && (
        <section ref={detailRef} aria-label="The email" className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="text-lg font-semibold text-gray-900">{detail?.message.subject ?? "Reading this email"}</h3>
            <button type="button" className={button} onClick={() => { setOpenId(null); setDetail(null); }}>
              Close
            </button>
          </div>
          {detailProblem && (
            <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {detailProblem}
            </p>
          )}
          {detail && <EmailDetail answer={detail} acting={acting} onAct={(action) => void act(detail.message.id, action)} />}
        </section>
      )}
    </div>
  );
}

function EmailDetail({ answer, acting, onAct }: { answer: DetailAnswer; acting: boolean; onAct: (action: "retry" | "cancel") => void }) {
  const m = answer.message;
  const facts: Array<[string, string]> = [
    ["To", m.toEmail],
    ["What became of it", STATUS_LABEL[m.status] ?? m.status],
    ["Kind", KIND_LABEL[m.kind] ?? m.kind],
    ["What wrote it", m.origin],
    ["Written", at(m.createdAt)],
  ];
  if (m.sentAt) facts.push(["Handed to the provider", at(m.sentAt)]);
  if (m.deliveredAt) facts.push(["Delivered", at(m.deliveredAt)]);
  if (m.bouncedAt) facts.push(["Bounced", at(m.bouncedAt)]);
  if (m.complainedAt) facts.push(["Marked as spam", at(m.complainedAt)]);
  if (m.status === "skipped" && m.skipReason) facts.push(["Not sent, because", SKIP_LABEL[m.skipReason] ?? m.skipReason]);
  if (m.rehearsalTo) facts.push(["Sent instead to", m.rehearsalTo]);
  if (m.replyTo) facts.push(["Replies go to", m.replyTo]);
  if (m.status === "queued" && m.sendAfter) facts.push(["Goes no earlier than", at(m.sendAfter)]);
  if (m.status === "queued" && m.nextAttemptAt) facts.push(["Next try", at(m.nextAttemptAt)]);
  if (m.expiresAt) facts.push(["Worth sending until", at(m.expiresAt)]);
  if (m.attempts) facts.push(["Tries", String(m.attempts)]);
  if (m.lastError) facts.push(["What the provider said", m.lastError]);
  const button =
    "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";

  return (
    <div className="mt-4 space-y-5">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium text-gray-600">{k}</dt>
            <dd className="break-words text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>

      {(answer.canRetry || answer.canCancel) && (
        <div className="flex flex-wrap gap-2">
          {answer.canRetry && (
            <button type="button" className={button} disabled={acting} onClick={() => onAct("retry")}>
              Try again
            </button>
          )}
          {answer.canCancel && (
            <button type="button" className={button} disabled={acting} onClick={() => onAct("cancel")}>
              Cancel this email
            </button>
          )}
        </div>
      )}

      {answer.reports.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900">What the provider reported</h4>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {answer.reports.map((r) => (
              <li key={r.id}>{`${at(r.receivedAt)}: ${r.type.replace(/^email\./, "").replace(/_/g, " ")}${r.outcome ? ` (${r.outcome.replace(/_/g, " ")})` : ""}`}</li>
            ))}
          </ul>
        </div>
      )}

      {m.attachments.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Attached</h4>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {m.attachments.map((a, i) => (
              <li key={`${a.filename}-${i}`}>{`${a.filename} (${a.contentType}, ${Math.max(1, Math.round(a.bytes / 1024))} KB)`}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-900">The words</h4>
        {m.wordsNote ? (
          <p className="mt-2 text-sm text-gray-600">{m.wordsNote}</p>
        ) : (
          <div className="mt-2 space-y-3">
            {m.bodyHtml && (
              <iframe
                title={`The email: ${m.subject}`}
                sandbox=""
                srcDoc={m.bodyHtml}
                className="h-96 w-full rounded-lg border border-gray-200 bg-white"
              />
            )}
            {m.bodyText && (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                {m.bodyText}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
