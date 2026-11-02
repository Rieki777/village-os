/**
 * WAITING ON YOU: the first group on the task board, for decisions that wait
 * on a power the member holds (shared/waitingOnYou.ts holds the contract).
 *
 *   applications  a seat application a live `org.seat` holder may adopt.
 *                 The row names the seats, their circle, the applicant's first
 *                 name and the day, and opens the application, where "Align
 *                 for the village" and "Put it to the village" live. No money:
 *                 the terms stay in the drawer on that page.
 *   drafts        an open org draft a proposal made, for someone who may
 *                 publish it. Opens the structure page of its batch.
 *   toAccept      a done task a live `org.seat` holder may accept as
 *                 accomplished, never their own work. The task is not on the
 *                 reader's board, so the row carries "Accept as accomplished"
 *                 itself, with an optional note, and leaves once accepted. A
 *                 server from before this group sends none (`readWaiting`).
 *   raisedWithYou a tension raised with a role the reader holds, under its own
 *                 heading, "Raised with your roles". The row carries the words
 *                 and the holder's answers (roleTension/TensionRespondRow.tsx)
 *                 and never names who raised it. Taking it keeps the row,
 *                 answering it or bringing it to the circle removes it. A
 *                 server from before this group sends none (`readWaiting`).
 *   toConsent     a role proposal the reader's circle is asked about, under
 *                 its own heading, "Asked to consent" (role proposals PR D).
 *                 The row names the roles, the circle, the day the circle's
 *                 2 business days close, and the proposer the way an
 *                 application row does (first name only), and opens the
 *                 application, where Consent and Object live. Answered, the
 *                 row is gone on the next read.
 *   openProposals a role proposal from somebody with no account yet (open
 *                 proposals part B): an `adopt` row in the main list for a
 *                 holder of the power that seats people, a `consent` row under
 *                 "Asked to consent" for a holder its circle asks. Each opens
 *                 the proposal's own page, `/open-proposals/:id`.
 *
 * NO COUNTS on the heading, as the rest of the board. The group draws nothing
 * at all when nothing waits, and nothing when the read is closed to the
 * reader (a guest, or the governance module off): the board around it carries
 * on as it was. A read that FAILED says so with a retry, because a silent gap
 * here would read as "nothing waits on you" and that is a claim.
 *
 * The server decides every row. This draws what it sent, in its order.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { gameFetch } from "@/lib/gameApi";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, HINT, INPUT, LABEL, LABEL_CAPS } from "@/components/sessions/roomUi";
import { TASK_NOTE_MAX, taskAcceptUrl } from "@shared/sessionTasks";
import { readWaiting, WAITING_COPY, WAITING_URL, type WaitingAcceptance, type WaitingOpenProposal, type WaitingPayload } from "@shared/waitingOnYou";
import { TENSION_COPY, type TensionAction } from "@shared/roleTensions";
import TensionRespondRow from "@/components/roleTension/TensionRespondRow";

const ROW =
  "group block rounded-2xl border border-border bg-muted px-4 py-3.5 text-foreground hover:border-notice/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
/** Block text with the arrow inline, so on a phone the arrow wraps with the last word and never floats away. */
const ROW_ACTION = "mt-2 block text-sm font-semibold text-foreground underline decoration-notice/60 underline-offset-4";
const ROW_ARROW = "ml-1.5 inline-block h-4 w-4 align-[-3px] transition-transform group-hover:translate-x-0.5";

/** Closed to this reader: not a failure, and nothing to draw. */
const CLOSED = new Set([401, 403, 404]);

/** The server's own sentence when it sent one, or the plain fallback. */
const refusalOf = (body: unknown): string => {
  const said = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error.trim() : "";
  return said && /\s/.test(said) ? said : WAITING_COPY.acceptFailed;
};

/** One proposal from somebody with no account yet, opening its own page. Names the proposer by first name only. */
function OpenProposalRow({ row }: { row: WaitingOpenProposal }) {
  const where =
    row.ask === "consent"
      ? [WAITING_COPY.consentIn(row.circles[0] ?? ""), WAITING_COPY.consentCloses(row.closesOn ?? "")].filter(Boolean).join(" · ")
      : [WAITING_COPY.openFrom, WAITING_COPY.inCircles(row.circles)].filter(Boolean).join(" · ");
  return (
    <Link href={`/open-proposals/${encodeURIComponent(row.id)}`} className={ROW} data-open-proposal-row={row.ask}>
      <p className="font-semibold leading-snug">{WAITING_COPY.openLine(row.proposer, row.roles)}</p>
      <p className={`${HINT} mt-0.5`}>{where}</p>
      <span className={ROW_ACTION}>
        {row.ask === "consent" ? WAITING_COPY.consentAction : WAITING_COPY.openAction}
        <ArrowRight className={ROW_ARROW} aria-hidden="true" />
      </span>
    </Link>
  );
}

/** One done task to accept: its words, where it sits, and the control, opened in place with an optional note. */
export function AcceptRow({ task, onAccepted }: { task: WaitingAcceptance; onAccepted: (entryId: number) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = useId();
  const textId = `${ids}-text`;
  const noteId = `${ids}-note`;
  const where = [WAITING_COPY.acceptWhere(task.role, task.circle), WAITING_COPY.doneOn(task.doneOn)].filter(Boolean).join(" · ");

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const trimmed = note.trim();
      const res = await gameFetch(taskAcceptUrl(task.entryId), { method: "POST", body: JSON.stringify(trimmed ? { note: trimmed } : {}) });
      const reply = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(WAITING_COPY.accepted);
        onAccepted(task.entryId);
      } else setError(refusalOf(reply));
    } catch {
      setError(WAITING_COPY.acceptFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-muted px-4 py-3.5 text-foreground" data-to-accept={task.entryId}>
      <p id={textId} className="font-semibold leading-snug">
        {WAITING_COPY.acceptLine(task.text)}
      </p>
      {where && <p className={`${HINT} mt-0.5`}>{where}</p>}
      {!open ? (
        <button type="button" className={`${BTN_SECONDARY} mt-3`} aria-describedby={textId} onClick={() => setOpen(true)}>
          {WAITING_COPY.acceptAction}
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor={noteId} className={LABEL}>
              {WAITING_COPY.acceptNote}
            </label>
            <input
              id={noteId}
              type="text"
              value={note}
              maxLength={TASK_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              className={`${INPUT} mt-1`}
              autoFocus
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy} aria-describedby={textId} onClick={() => void accept()}>
              {WAITING_COPY.acceptConfirm}
            </button>
            <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setOpen(false)}>
              {WAITING_COPY.acceptCancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** `onShown` hears whether the group draws anything: rows, or the failed line. */
export default function WaitingOnYou({ onShown }: { onShown?: (shown: boolean) => void }) {
  const [data, setData] = useState<WaitingPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  const told = useRef(onShown);
  told.current = onShown;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await gameFetch(WAITING_URL, { cache: "no-store" });
      if (!live.current) return;
      if (CLOSED.has(res.status)) return setData({ applications: [], drafts: [], toAccept: [], raisedWithYou: [], toConsent: [], openProposals: [] });
      const next = res.ok ? readWaiting(await res.json().catch(() => null)) : null;
      if (!live.current) return;
      if (next) setData(next);
      else setFailed(true);
    } catch {
      if (live.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toAccept = data?.toAccept ?? [];
  const raised = data?.raisedWithYou ?? [];
  const toConsent = data?.toConsent ?? [];
  const openToDecide = (data?.openProposals ?? []).filter((o) => o.ask === "adopt");
  const openToConsent = (data?.openProposals ?? []).filter((o) => o.ask === "consent");
  const has =
    !!data &&
    (data.applications.length > 0 || data.drafts.length > 0 || toAccept.length > 0 || raised.length > 0 || toConsent.length > 0 || openToDecide.length > 0 || openToConsent.length > 0);
  const accepted = (entryId: number) =>
    setData((d) => (d ? { ...d, toAccept: (d.toAccept ?? []).filter((t) => t.entryId !== entryId) } : d));
  const responded = (id: string, action: TensionAction) =>
    setData((d) => {
      if (!d) return d;
      const list = d.raisedWithYou ?? [];
      const next = action === "take" ? list.map((t) => (t.id === id ? { ...t, status: "taken" as const, overdue: false } : t)) : list.filter((t) => t.id !== id);
      return { ...d, raisedWithYou: next };
    });
  // Told only once the read has answered, so the board never draws "nothing in
  // your hands" in the one render before a waiting row arrives.
  const settled = data !== null || failed;
  useEffect(() => {
    if (settled) told.current?.(has || failed);
  }, [settled, has, failed]);

  if (failed) {
    return (
      <div className="flex flex-wrap items-center gap-3" role="alert" data-waiting-failed>
        <p className="text-sm text-foreground">{WAITING_COPY.loadFailed}</p>
        <button type="button" className={BTN_SECONDARY} onClick={() => void load()}>
          {WAITING_COPY.retry}
        </button>
      </div>
    );
  }
  if (!data || !has) return null;

  return (
    <section aria-labelledby="task-board-waiting" className="space-y-3" data-waiting-on-you>
      <h3 id="task-board-waiting" className={LABEL_CAPS}>
        {WAITING_COPY.heading}
      </h3>
      <ul className="space-y-3">
        {data.applications.map((a) => {
          const where = [WAITING_COPY.inCircles(a.circles), WAITING_COPY.appliedOn(a.appliedOn)].filter(Boolean).join(" · ");
          return (
            <li key={`a-${a.id}`}>
              <Link href={a.href} className={ROW}>
                <p className="font-semibold leading-snug">{WAITING_COPY.applicationLine(a.applicant, a.seats)}</p>
                <p className={`${HINT} mt-0.5`}>{where}</p>
                <span className={ROW_ACTION}>
                  {WAITING_COPY.applicationAction}
                  <ArrowRight className={ROW_ARROW} aria-hidden="true" />
                </span>
              </Link>
            </li>
          );
        })}
        {data.drafts.map((d) => (
          <li key={`d-${d.id}`}>
            <Link href={d.href} className={ROW}>
              <p className="font-semibold leading-snug">{WAITING_COPY.draftLine(d.title)}</p>
              <p className={`${HINT} mt-0.5`}>{WAITING_COPY.draftAdds(d.circles, d.seats)}</p>
              <span className={ROW_ACTION}>
                {WAITING_COPY.draftAction}
                <ArrowRight className={ROW_ARROW} aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
        {toAccept.map((t) => (
          <li key={`t-${t.entryId}`}>
            <AcceptRow task={t} onAccepted={accepted} />
          </li>
        ))}
        {openToDecide.map((o) => (
          <li key={`o-${o.id}`}>
            <OpenProposalRow row={o} />
          </li>
        ))}
      </ul>
      {(toConsent.length > 0 || openToConsent.length > 0) && (
        <div className="space-y-3 pt-2" data-to-consent-group="">
          <h4 id="task-board-consent" className={LABEL_CAPS}>
            {WAITING_COPY.consentHeading}
          </h4>
          <ul className="space-y-3" aria-labelledby="task-board-consent">
            {toConsent.map((c) => {
              const where = [WAITING_COPY.consentIn(c.circle), WAITING_COPY.consentCloses(c.closesOn)].filter(Boolean).join(" · ");
              return (
                <li key={`c-${c.proposalId}`} data-to-consent={c.applicationId}>
                  <Link href={c.href} className={ROW}>
                    <p className="font-semibold leading-snug">{WAITING_COPY.consentLine(c.applicant, c.roles)}</p>
                    <p className={`${HINT} mt-0.5`}>{where}</p>
                    <span className={ROW_ACTION}>
                      {WAITING_COPY.consentAction}
                      <ArrowRight className={ROW_ARROW} aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              );
            })}
            {openToConsent.map((o) => (
              <li key={`oc-${o.id}`} data-to-consent={o.id}>
                <OpenProposalRow row={o} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {raised.length > 0 && (
        <div className="space-y-3 pt-2" data-raised>
          <h4 id="task-board-raised" className={LABEL_CAPS}>
            {TENSION_COPY.groupHeading}
          </h4>
          <ul className="space-y-3" aria-labelledby="task-board-raised">
            {raised.map((t) => (
              <li key={`r-${t.id}`}>
                <TensionRespondRow tension={t} onResponded={responded} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
