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
 *
 * NO COUNTS on the heading, as the rest of the board. The group draws nothing
 * at all when nothing waits, and nothing when the read is closed to the
 * reader (a guest, or the governance module off): the board around it carries
 * on as it was. A read that FAILED says so with a retry, because a silent gap
 * here would read as "nothing waits on you" and that is a claim.
 *
 * The server decides every row. This draws what it sent, in its order.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { gameFetch } from "@/lib/gameApi";
import { BTN_SECONDARY, HINT, LABEL_CAPS } from "@/components/sessions/roomUi";
import { readWaiting, WAITING_COPY, WAITING_URL, type WaitingPayload } from "@shared/waitingOnYou";

const ROW =
  "group block rounded-2xl border border-border bg-muted px-4 py-3.5 text-foreground hover:border-notice/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
/** Block text with the arrow inline, so on a phone the arrow wraps with the last word and never floats away. */
const ROW_ACTION = "mt-2 block text-sm font-semibold text-foreground underline decoration-notice/60 underline-offset-4";
const ROW_ARROW = "ml-1.5 inline-block h-4 w-4 align-[-3px] transition-transform group-hover:translate-x-0.5";

/** Closed to this reader: not a failure, and nothing to draw. */
const CLOSED = new Set([401, 403, 404]);

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
      if (CLOSED.has(res.status)) return setData({ applications: [], drafts: [] });
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

  const has = !!data && (data.applications.length > 0 || data.drafts.length > 0);
  useEffect(() => {
    told.current?.(has || failed);
  }, [has, failed]);

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
      </ul>
    </section>
  );
}
