/**
 * The setup walk (0083, §8 item 16): the founder's guided pass over the
 * chart. Every open or partial seat in order, then every circle without a
 * declared way of deciding, then the village shape, ending at "publish
 * structure to the network?".
 *
 * Each seat offers three honest moves: ASSIGN somebody (the existing admin
 * seating endpoint, so it stays a dated row with a term), SKIP, or leave it
 * as an OPEN CALL (recruiting on, so the map advertises it). The member
 * tray shows faces where the map knows them and initials where it does not;
 * /api/admin/players carries no avatars today, which is a known gap
 * reported to the coordinator rather than a new endpoint grown here.
 *
 * A card stack on a phone, a centred card on a desktop, one dialog either
 * way. Admin only by construction: every write it makes already refuses
 * non-admins server-side.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { GLOSS_MAX } from "@shared/power";
import SeatTermField from "./SeatTermField";
import type { PowerCircle, PowerData, PowerSeat } from "./types";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

interface TrayMember {
  id: string;
  name: string;
  avatar: string | null;
}

type WalkStep =
  | { kind: "seat"; seat: PowerSeat }
  | { kind: "circle"; circle: PowerCircle }
  | { kind: "shape" }
  | { kind: "publish" };

export function walkSteps(data: PowerData): WalkStep[] {
  const steps: WalkStep[] = [];
  for (const s of data.roles) {
    if (s.isExample) continue;
    if (s.state === "open" || s.state === "partial") steps.push({ kind: "seat", seat: s });
  }
  for (const c of data.circles) {
    if (c.isExample) continue;
    if (!c.decidesBy) steps.push({ kind: "circle", circle: c });
  }
  if (!data.power.shape) steps.push({ kind: "shape" });
  steps.push({ kind: "publish" });
  return steps;
}

export default function SetupWalk({
  data,
  onClose,
  onChanged,
}: {
  data: PowerData;
  onClose: () => void;
  /** Something was written: the page refetches the map. */
  onChanged: () => void;
}) {
  const steps = useMemo(() => walkSteps(data), [data]);
  const [at, setAt] = useState(0);
  const [tray, setTray] = useState<TrayMember[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // The tray: every member, with the face the map already knows if any.
  useEffect(() => {
    const avatarByUser = new Map<string, string>();
    for (const r of data.roles) {
      for (const h of r.holders) if (h.userId && h.avatar) avatarByUser.set(h.userId, h.avatar);
    }
    fetch("/api/admin/players", { headers: headers() })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: any[]) =>
        setTray(
          (list ?? []).map((u) => ({
            id: String(u.id),
            name: String(u.name ?? "Member"),
            avatar: avatarByUser.get(String(u.id)) ?? null,
          })),
        ),
      )
      .catch(() => {});
  }, [data]);

  const step = steps[Math.min(at, steps.length - 1)];
  const advance = () => {
    setStatus("");
    setAt((i) => Math.min(i + 1, steps.length - 1));
  };

  // `termEndsOn` empty sends no date, and the route ends the seat with the
  // season (0199). A refusal comes back as a sentence and lands in `status`.
  const assign = (seatId: string, userId: string, termEndsOn: string) => {
    setBusy(true);
    setStatus("");
    fetch(`/api/admin/org/roles/${seatId}/holders`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...(termEndsOn ? { termEndsOn } : {}) }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not seat them");
        onChanged();
        advance();
      })
      .catch((e) => setStatus(e.message))
      .finally(() => setBusy(false));
  };

  const openCall = (seatId: string) => {
    setBusy(true);
    setStatus("");
    fetch(`/api/admin/org/roles/${seatId}`, {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ recruiting: true }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not open the call");
        onChanged();
        advance();
      })
      .catch((e) => setStatus(e.message))
      .finally(() => setBusy(false));
  };

  const declareCircle = (circleId: string, method: string, gloss: string) => {
    setBusy(true);
    setStatus("");
    fetch(`/api/org/circles/${circleId}/decides`, {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ decidesBy: method, ...(gloss.trim() ? { decidesByGloss: gloss.trim() } : {}) }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not declare it");
        onChanged();
        advance();
      })
      .catch((e) => setStatus(e.message))
      .finally(() => setBusy(false));
  };

  const declareShape = (shape: string, gloss: string) => {
    setBusy(true);
    setStatus("");
    fetch("/api/org/village/power", {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        shape,
        ...(gloss.trim() ? { shapeGloss: gloss.trim() } : {}),
        decidesBy: data.power.decidesBy ?? "consent",
      }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not declare it");
        onChanged();
        advance();
      })
      .catch((e) => setStatus(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      data-power-setup-walk
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Set up the chart"
        tabIndex={-1}
        className="bg-card w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border border-border p-5 max-h-[85vh] overflow-y-auto focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground tabular-nums">
            {Math.min(at + 1, steps.length)} of {steps.length}
          </p>
          <button type="button" onClick={onClose} aria-label="Close the walk" className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {step.kind === "seat" && (
          <SeatStep seat={step.seat} data={data} tray={tray} busy={busy} onAssign={assign} onOpenCall={openCall} onSkip={advance} />
        )}
        {step.kind === "circle" && (
          <CircleStep circle={step.circle} data={data} busy={busy} onDeclare={declareCircle} onSkip={advance} />
        )}
        {step.kind === "shape" && <ShapeStep data={data} busy={busy} onDeclare={declareShape} onSkip={advance} />}
        {step.kind === "publish" && (
          <div>
            <h3 className="font-display text-lg font-bold text-foreground mb-2">Publish structure to the network?</h3>
            <p className="text-sm text-muted-foreground mb-3">
              The published chart carries circle names, seat names and counts, never people: it is nameless
              by construction. Visitors and peer villages read the same tier.
            </p>
            <div className="flex gap-2">
              <a href="/admin" className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium">
                Open the setting in Admin
              </a>
              <button type="button" onClick={onClose} className="text-sm text-muted-foreground px-2">
                Done for now
              </button>
            </div>
          </div>
        )}

        {/* `status` only ever holds a caught error message (every setStatus
            call site is a .catch), so role="alert", not role="status". */}
        {status && <p role="alert" className="text-xs text-red-600 mt-3">{status}</p>}
      </div>
    </div>
  );
}

function SeatStep({
  seat,
  data,
  tray,
  busy,
  onAssign,
  onOpenCall,
  onSkip,
}: {
  seat: PowerSeat;
  data: PowerData;
  tray: TrayMember[];
  busy: boolean;
  onAssign: (seatId: string, userId: string, termEndsOn: string) => void;
  onOpenCall: (seatId: string) => void;
  onSkip: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [termEndsOn, setTermEndsOn] = useState("");
  // A date picked for one seat never carries onto the next seat in the walk.
  useEffect(() => setTermEndsOn(""), [seat.id]);
  const circle = data.circles.find((c) => c.id === seat.circleId);
  return (
    <div>
      <h3 className="font-display text-lg font-bold text-foreground">
        {seat.name}
        <span className="ml-2 text-xs font-normal text-amber-700">
          {seat.state === "partial" ? `${seat.holderCount} of ${seat.seats} held` : "nobody holds this yet"}
        </span>
      </h3>
      {circle && <p className="text-xs text-teal-deep mb-1">{circle.name}</p>}
      {seat.description && <p className="text-sm text-muted-foreground mb-3">{seat.description}</p>}

      {picking ? (
        <div>
          <div className="mb-3">
            <SeatTermField value={termEndsOn} onChange={setTermEndsOn} />
          </div>
          <p className="text-xs font-semibold text-foreground mb-1.5">Who takes it up?</p>
          <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto" data-power-member-tray>
            {tray.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={busy}
                onClick={() => onAssign(seat.id, m.id, termEndsOn)}
                className="flex items-center gap-1.5 text-xs bg-muted text-foreground pl-1 pr-2 py-1 rounded-full hover:bg-muted/70 disabled:opacity-40"
              >
                {m.avatar ? (
                  <img src={m.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <span className="w-5 h-5 rounded-full bg-teal-deep/15 text-teal-deep text-[10px] flex items-center justify-center font-semibold">
                    {m.name.slice(0, 1)}
                  </span>
                )}
                {m.name}
              </button>
            ))}
            {!tray.length && <p className="text-xs text-muted-foreground">No members to seat yet.</p>}
          </div>
          <button type="button" onClick={() => setPicking(false)} className="text-xs text-muted-foreground mt-2">
            Back
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => setPicking(true)} className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
            Assign somebody
          </button>
          <button type="button" disabled={busy} onClick={() => onOpenCall(seat.id)} className="text-sm bg-amber/90 text-teal-deep rounded-lg px-4 py-2 font-semibold disabled:opacity-40">
            Leave it as an open call
          </button>
          <button type="button" onClick={onSkip} className="text-sm text-muted-foreground px-2 inline-flex items-center gap-1">
            Skip <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

function CircleStep({
  circle,
  data,
  busy,
  onDeclare,
  onSkip,
}: {
  circle: PowerCircle;
  data: PowerData;
  busy: boolean;
  onDeclare: (circleId: string, method: string, gloss: string) => void;
  onSkip: () => void;
}) {
  const [method, setMethod] = useState<string>("");
  const [gloss, setGloss] = useState("");
  return (
    <div>
      <h3 className="font-display text-lg font-bold text-foreground mb-1">How does {circle.name} decide?</h3>
      {circle.purpose && <p className="text-xs text-muted-foreground mb-2">{circle.purpose}</p>}
      <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Pick a way of deciding">
        {data.power.glossary.decidesBy.map((d) => (
          <button
            key={d.id}
            type="button"
            aria-pressed={method === d.id}
            title={d.gloss}
            onClick={() => setMethod(d.id)}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              method === d.id ? "bg-teal-deep text-white border-teal-deep" : "bg-background text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      {method && (
        <p className="text-[11px] text-muted-foreground mb-2">
          {data.power.glossary.decidesBy.find((d) => d.id === method)?.gloss}
        </p>
      )}
      {method === "other" && (
        <input
          value={gloss}
          onChange={(e) => setGloss(e.target.value.slice(0, GLOSS_MAX))}
          aria-label="Say your way of deciding in one line"
          placeholder="Say it in one line"
          className="w-full text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background mb-2"
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !method || (method === "other" && !gloss.trim())}
          onClick={() => onDeclare(circle.id, method, gloss)}
          className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
        >
          Declare it
        </button>
        <button type="button" onClick={onSkip} className="text-sm text-muted-foreground px-2 inline-flex items-center gap-1">
          Skip <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ShapeStep({
  data,
  busy,
  onDeclare,
  onSkip,
}: {
  data: PowerData;
  busy: boolean;
  onDeclare: (shape: string, gloss: string) => void;
  onSkip: () => void;
}) {
  const [shape, setShape] = useState<string>("");
  const [gloss, setGloss] = useState("");
  return (
    <div>
      <h3 className="font-display text-lg font-bold text-foreground mb-1">What shape is this village?</h3>
      <p className="text-xs text-muted-foreground mb-2">The picture morphs to match, and the legend places you on the strip from one person holding it to everyone holding it.</p>
      <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Pick a shape">
        {data.power.glossary.shapes.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={shape === s.id}
            title={s.gloss}
            onClick={() => setShape(s.id)}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              shape === s.id ? "bg-teal-deep text-white border-teal-deep" : "bg-background text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {shape && <p className="text-[11px] text-muted-foreground mb-2">{data.power.glossary.shapes.find((s) => s.id === shape)?.gloss}</p>}
      {shape === "other" && (
        <input
          value={gloss}
          onChange={(e) => setGloss(e.target.value.slice(0, GLOSS_MAX))}
          aria-label="Say your shape in one line"
          placeholder="Say it in one line"
          className="w-full text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background mb-2"
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !shape || (shape === "other" && !gloss.trim())}
          onClick={() => onDeclare(shape, gloss)}
          className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
        >
          Declare it
        </button>
        <button type="button" onClick={onSkip} className="text-sm text-muted-foreground px-2 inline-flex items-center gap-1">
          Skip <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
