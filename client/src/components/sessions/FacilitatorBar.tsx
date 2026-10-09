/**
 * THE FACILITATOR'S BAR, seen by the facilitator only. Move the room to the
 * stage on screen (or on to the next), read the cues for this stage behind a
 * toggle, hand facilitation to someone else in the room, and name who takes
 * notes. Facilitator and note taker are best two different people.
 */
import { useState } from "react";
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
  const room = view.state.stage;
  const next = SESSION_STAGES[SESSION_STAGES.indexOf(room) + 1] ?? null;
  const others = view.people.filter((p) => p.userId !== view.me.userId);

  const run = async (fn: () => Promise<{ ok: boolean }>, after?: () => void) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) after?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={ROOM_COPY.youFacilitate} className="rounded-2xl border border-teal-deep/30 bg-teal-deep/5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-semibold text-foreground">{ROOM_COPY.youFacilitate}</p>
        {shown !== room ? (
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy}
            onClick={() => void run(() => actions.act({ type: "go", stage: shown }), onMoved)}
          >
            {ROOM_COPY.moveHere}
          </button>
        ) : (
          next && (
            <button
              type="button"
              className={BTN_SECONDARY}
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
                value={view.secretaryUserId ?? ""}
                disabled={busy}
                onChange={(e) => void run(() => actions.hosts({ secretaryUserId: e.target.value ? Number(e.target.value) : null }))}
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
