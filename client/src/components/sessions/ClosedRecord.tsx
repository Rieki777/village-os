/**
 * THE RECORD OF A CLOSED SESSION, as the people who were in it and the
 * village's admins read it: how the room arrived (numbers only, the words are
 * gone), the agenda with what each item came to, the decisions, the seeds,
 * the actions and who holds them, and what waits for next time. The
 * facilitator and the admins also find the unsigned feedback on the
 * facilitation here, when the server sends it to them.
 *
 * An admin also gets the SHAREABLE minutes, which name no person at all, with
 * a copy button and the reminder to read them through first. They are fetched
 * only when asked for.
 */
import { useState } from "react";
import { Copy } from "lucide-react";
import { AIM_DEFS, ENTRY_LABELS, ROOM_COPY, SESSIONS_API, SESSION_COPY, type SessionEntry, type SessionItem, type SessionView } from "@shared/sessions";
import { gameFetch } from "@/lib/gameApi";
import { BTN_SECONDARY, CARD, CHIP, H3, HINT, agendaOrder, consentOn, heldLine } from "./roomUi";
import { FacilitationReading } from "./StageClose";

function itemOutcome(item: SessionItem): string {
  if (item.status === "parked") return ROOM_COPY.parkedNext;
  if (item.status === "waiting") return ROOM_COPY.notReached;
  return ROOM_COPY.itemStatus[item.status];
}

function EntryLines({ view, list }: { view: SessionView; list: SessionEntry[] }) {
  const decisions = list.filter((e) => e.kind === "decision");
  const seeds = list.filter((e) => e.kind === "seed");
  const acts = list.filter((e) => e.kind === "action" && e.status !== "parked");
  if (!decisions.length && !seeds.length && !acts.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {decisions.map((d) => {
        const { tally } = consentOn(view, `decision:${d.id}`);
        const answered = tally.consent + tally.concern + tally.object;
        return (
          <li key={d.id} className={`rounded-lg px-3 py-2 text-sm ${d.status === "done" ? "bg-sage-light/70" : "bg-muted/60"}`}>
            <span className="font-semibold text-foreground">{d.status === "done" ? ROOM_COPY.decide : ROOM_COPY.proposalOpen}:</span>{" "}
            <span className="whitespace-pre-line text-foreground">{d.text}</span>
            {answered > 0 && <span className="block text-xs text-muted-foreground">{ROOM_COPY.talliedLine(tally)}</span>}
          </li>
        );
      })}
      {seeds.map((s) => (
        <li key={s.id} className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <span className="font-semibold text-foreground">{ROOM_COPY.seed}:</span> <span className="font-display text-foreground">{s.text}</span>
        </li>
      ))}
      {acts.map((a) => (
        <li key={a.id} className="rounded-lg border border-border px-3 py-2 text-sm">
          <span className="text-foreground">{a.text}</span>
          <span className="block text-muted-foreground">
            {heldLine(a)}
            {a.dueOn ? ` · ${ROOM_COPY.dueLabel} ${a.dueOn}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ShareableMinutes({ view }: { view: SessionView }) {
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    setState("loading");
    try {
      const res = await gameFetch(`${SESSIONS_API}/${view.id}/minutes.md?for=shareable`, { headers: { Accept: "text/markdown" } });
      if (!res.ok) {
        setState("failed");
        return;
      }
      setText(await res.text());
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(ROOM_COPY.copied);
    } catch {
      setCopied(ROOM_COPY.copyFailed);
    }
  };

  return (
    <section className={CARD} aria-labelledby="record-shareable">
      <h3 id="record-shareable" className={H3}>
        {SESSION_COPY.shareableTitle}
      </h3>
      <p className={`${HINT} mt-1`}>{SESSION_COPY.shareableLede}</p>
      {text == null ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={BTN_SECONDARY} disabled={state === "loading"} onClick={() => void load()}>
            {state === "loading" ? ROOM_COPY.minutesLoading : ROOM_COPY.showMinutes}
          </button>
          {state === "failed" && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {ROOM_COPY.minutesFailed}
            </p>
          )}
        </div>
      ) : (
        <>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/60 p-4 text-sm text-foreground">{text}</pre>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_SECONDARY} onClick={() => void copy()}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              {SESSION_COPY.copyMinutes}
            </button>
            {copied && (
              <p role="status" className="text-sm text-muted-foreground">
                {copied}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default function ClosedRecord({ view }: { view: SessionView }) {
  const items = agendaOrder(view.items);
  const loose = view.entries.filter((e) => e.itemId == null || !view.items.some((i) => i.id === e.itemId));
  const backlog = view.entries.filter((e) => e.kind === "tension" || e.status === "parked");
  const waitingItems = items.filter((i) => i.status === "parked" || i.status === "waiting");

  return (
    <div className="space-y-5">
      <p role="status" className="rounded-xl bg-sage-light px-4 py-3 text-sm font-medium text-foreground">
        {SESSION_COPY.closeDone}
      </p>

      <section className={CARD} aria-labelledby="record-arrival">
        <h3 id="record-arrival" className={H3}>
          {ROOM_COPY.arrivalHeading}
        </h3>
        {view.arrival && view.arrival.count > 0 ? (
          <div className="mt-3 flex flex-wrap items-end gap-6">
            <p>
              <span className="font-display text-4xl font-bold tabular-nums text-foreground">{view.arrival.median}</span>
              <span className="text-muted-foreground"> / 11</span>
            </p>
            <p className={HINT}>{ROOM_COPY.arrivalNumbers(view.arrival)}</p>
          </div>
        ) : (
          <p className={`${HINT} mt-2`}>{ROOM_COPY.noArrival}</p>
        )}
      </section>

      <section className={CARD} aria-labelledby="record-agenda">
        <h3 id="record-agenda" className={H3}>
          {ROOM_COPY.agendaHeading}
        </h3>
        {items.length ? (
          <ol className="mt-3 space-y-4">
            {items.map((item) => (
              <li key={item.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                <p className="font-semibold text-foreground">{item.title}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className={CHIP}>{AIM_DEFS[item.aim].label}</span>
                  <span>
                    {item.usedSeconds
                      ? ROOM_COPY.usedOf(Math.round(item.usedSeconds / 60), item.minutes)
                      : `${item.minutes} ${ROOM_COPY.minutesShort}`}
                  </span>
                  <span>· {itemOutcome(item)}</span>
                </p>
                <EntryLines view={view} list={view.entries.filter((e) => e.itemId === item.id)} />
              </li>
            ))}
          </ol>
        ) : (
          <p className={`${HINT} mt-2`}>{ROOM_COPY.nothingYet}</p>
        )}
      </section>

      {loose.some((e) => e.kind !== "tension") && (
        <section className={CARD} aria-labelledby="record-loose">
          <h3 id="record-loose" className={H3}>
            {ROOM_COPY.outsideAgenda}
          </h3>
          <EntryLines view={view} list={loose.filter((e) => e.kind !== "tension")} />
        </section>
      )}

      {(backlog.length > 0 || waitingItems.length > 0) && (
        <section className={CARD} aria-labelledby="record-backlog">
          <h3 id="record-backlog" className={H3}>
            {ROOM_COPY.backlogHeading}
          </h3>
          <ul className="mt-3 space-y-1.5">
            {waitingItems.map((i) => (
              <li key={`i${i.id}`} className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">
                <span className={CHIP}>{AIM_DEFS[i.aim].label}</span> {i.title}
              </li>
            ))}
            {backlog.map((e) => (
              <li key={e.id} className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">
                <span className={CHIP}>{ENTRY_LABELS[e.kind]}</span> {e.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <FacilitationReading view={view} />

      {view.me.admin && <ShareableMinutes view={view} />}
    </div>
  );
}
