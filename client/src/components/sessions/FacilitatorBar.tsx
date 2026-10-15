/**
 * THE FACILITATOR'S BAR, seen by the facilitator only. Move the room to the
 * stage on screen (or on to the next), read the cues for this stage behind a
 * toggle, hand facilitation to someone else in the room, and name who takes
 * notes. Facilitator and note taker are best two different people.
 *
 * ONE FORWARD BUTTON. The bar has a single primary slot, and it always says
 * the next thing to do. Before the clock runs it reads "Begin the session".
 * Once the clock runs it reads "Next stage: ...". While the facilitator is
 * looking at another stage on their own screen, it reads "Move the room
 * here", so moving the room is always a look and then a tap, never one tap
 * on a rail. A move also starts a clock that is not yet running
 * (`applySessionAction`), so a facilitator who skips Begin still runs a timed
 * room.
 *
 * BEGIN SAYS IT WORKED. The clock line is not live, and the room's own live
 * region speaks only on a stage change, so a keyboard user who pressed Begin
 * heard nothing and could press Enter again to ask, which would land on the
 * Next stage button that took Begin's place and move the whole room. So each
 * button in the slot carries its own key (React replaces the node, never
 * relabels it), a polite status line says the session has begun, and focus
 * moves on purpose to the new Next stage button once it is there.
 *
 * The note taker picker stays usable while a save is out, so focus stays on
 * it: it shows the choice on its way until the room answers, and a choice
 * made while another save is still out is ignored.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { ROOM_COPY, SESSION_STAGES, STAGE_DEFS, type SessionStage, type SessionView } from "@shared/sessions";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, INPUT, LABEL } from "./roomUi";
import type { RoomActions } from "./useSessionRoom";

export default function FacilitatorBar({
  view,
  actions,
  shown,
  onMoved,
}: {
  view: SessionView;
  actions: RoomActions;
  shown: SessionStage;
  onMoved: () => void;
}) {
  const [panel, setPanel] = useState<"cues" | "hosts" | null>(null);
  const [busy, setBusy] = useState(false);
  const [handTo, setHandTo] = useState("");
  const [secretarySaving, setSecretarySaving] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const nextRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef(false);
  const room = view.state.stage;
  const started = view.state.startedAt != null;
  const next = SESSION_STAGES[SESSION_STAGES.indexOf(room) + 1] ?? null;
  const others = view.people.filter((p) => p.userId !== view.me.userId);

  // The start's answer and the view that shows the clock running can land in
  // either order, so focus waits for the Next stage button to exist. `said`
  // is a dependency so the effect also runs when the view came first.
  useEffect(() => {
    if (started && focusNext.current && nextRef.current) {
      focusNext.current = false;
      nextRef.current.focus();
    }
  }, [started, next, said]);

  const begun = () => {
    focusNext.current = true;
    setSaid(ROOM_COPY.sessionBegun);
  };

  const run = async (fn: () => Promise<{ ok: boolean }>, after?: () => void) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) after?.();
    } finally {
      setBusy(false);
    }
  };

  const nameSecretary = (value: string) => {
    if (busy || secretarySaving != null) return;
    setSecretarySaving(value);
    void run(() => actions.hosts({ secretaryUserId: value ? Number(value) : null })).finally(() => setSecretarySaving(null));
  };

  return (
    <section aria-label={ROOM_COPY.youFacilitate} className="rounded-2xl border border-teal-deep/30 bg-teal-deep/5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-semibold text-foreground">{ROOM_COPY.youFacilitate}</p>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {said}
        </p>
        {shown !== room ? (
          <button
            key="move"
            type="button"
            className={BTN_PRIMARY}
            disabled={busy}
            onClick={() => void run(() => actions.act({ type: "go", stage: shown }), onMoved)}
          >
            {ROOM_COPY.moveHere}
          </button>
        ) : !started ? (
          <button key="begin" type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void run(() => actions.act({ type: "start" }), begun)}>
            {ROOM_COPY.beginSession}
          </button>
        ) : (
          next && (
            <button
              key="next"
              ref={nextRef}
              type="button"
              className={BTN_PRIMARY}
              disabled={busy}
              onClick={() => void run(() => actions.act({ type: "go", stage: next }), onMoved)}
            >
              {ROOM_COPY.nextStage}: {STAGE_DEFS[next].short}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )
        )}
        <button type="button" className={BTN_QUIET} aria-expanded={panel === "cues"} onClick={() => setPanel((p) => (p === "cues" ? null : "cues"))}>
          {panel === "cues" ? ROOM_COPY.hideCues : ROOM_COPY.showCues}
        </button>
        <button type="button" className={BTN_QUIET} aria-expanded={panel === "hosts"} onClick={() => setPanel((p) => (p === "hosts" ? null : "hosts"))}>
          {ROOM_COPY.hostsTitle}
        </button>
      </div>

      {panel === "cues" && (
        <ul className="mt-3 space-y-1.5 border-t border-teal-deep/20 pt-3">
          {STAGE_DEFS[shown].cues.map((c) => (
            <li key={c} className="flex gap-2 text-sm text-foreground">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-deep" />
              {c}
            </li>
          ))}
        </ul>
      )}

      {panel === "hosts" && (
        <div className="mt-3 border-t border-teal-deep/20 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="host-facilitator" className={LABEL}>
                {ROOM_COPY.handTo}
              </label>
              <div className="mt-1 flex gap-2">
                <select id="host-facilitator" className={INPUT} value={handTo} onChange={(e) => setHandTo(e.target.value)} disabled={busy || !others.length}>
                  <option value="">{ROOM_COPY.nobodyYet}</option>
                  {others.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={BTN_SECONDARY}
                  disabled={busy || !handTo}
                  onClick={() => void run(() => actions.hosts({ facilitatorUserId: Number(handTo) }), () => setHandTo(""))}
                >
                  {ROOM_COPY.handOver}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="host-secretary" className={LABEL}>
                {ROOM_COPY.secretaryLabel}
              </label>
              <select
                id="host-secretary"
                className={`${INPUT} mt-1`}
                value={secretarySaving ?? view.secretaryUserId ?? ""}
                aria-busy={secretarySaving != null}
                onChange={(e) => nameSecretary(e.target.value)}
              >
                <option value="">{ROOM_COPY.nobodyYet}</option>
                {view.people.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
