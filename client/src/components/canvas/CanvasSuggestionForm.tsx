/**
 * THE SUGGESTION BOX on a canvas block's Say frame (plan 2.3; Wave 3b,
 * 2026-09-28): POST /api/canvas/proposals, for any member of the village.
 *
 * What a suggestion can aim at comes from the block itself: the words of each
 * brief section it draws on, the governing purpose statement on the Purpose
 * block, each wired setting door (a dial, the governance module, the exit
 * terms, the care door), and a row of the Decision Matrix on the Power block.
 * A setting the canvas cannot write yet (seat terms, the season's dates) is
 * not offered; the See frame links to where it is set.
 *
 * THE FORM CHECKS WITH THE ROUTE'S OWN VALIDATORS (`parseCanvasProposal` and
 * `servesPurposeProblem`, shared/canvasFrames.ts), so a refusal here reads
 * exactly like the server's, before anything is sent. A setting's value is
 * judged by the setting itself when the suggestion is adopted, which is where
 * the server judges it too; the box shows what the dial reads today and the
 * choices it takes, read from GET /api/game/mechanics, which every visitor may
 * read (the ruling of 2026-09-25: every dial is visible).
 *
 * NOTES ARE PUBLIC, and the box says so above its first field.
 */
import { useEffect, useMemo, useState } from "react";
import { authToken } from "@/lib/gameApi";
import {
  bodyLabel,
  dialFor,
  dialToday,
  EMPTY_FIELDS,
  KEEP,
  LIFECYCLE_WORDS,
  MODULE_LIFECYCLES,
  penKeyFor,
  refusalText,
  sectionTitlesOf,
  suggestionBody,
  suggestionOptions,
  type BlockFramesPayload,
  type DialFacts,
  type SuggestionFields,
} from "@/lib/canvasFramesCopy";
import { CANVAS_DOORS, parseCanvasProposal, servesPurposeProblem, servesPurposeScoped } from "@shared/canvasFrames";
import { ALIGNMENT_MIN_WORDS } from "@shared/governingPurpose";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const field = "mt-1 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900";
const area = `${field} min-h-[88px]`;
const labelText = "font-medium text-stone-900";
const hint = "block text-xs text-stone-600";

export function CanvasSuggestionForm({ payload, onSent }: { payload: BlockFramesPayload; onSent: () => void }) {
  const options = useMemo(() => suggestionOptions(payload), [payload]);
  const titles = useMemo(() => sectionTitlesOf(payload.answer.sections), [payload]);
  const [key, setKey] = useState(options[0]?.key ?? "");
  const [f, setF] = useState<SuggestionFields>(EMPTY_FIELDS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dials, setDials] = useState<DialFacts[] | null>(null);
  const [roles, setRoles] = useState<Array<{ id: string; name: string }> | null>(null);

  const option = options.find((o) => o.key === key) ?? options[0];
  const door = option?.door ? CANVAS_DOORS[option.door] : null;

  // The dial's current value and its choices, read once, when a dial is chosen.
  useEffect(() => {
    if (door?.kind !== "dial" || dials) return;
    let live = true;
    fetch("/api/game/mechanics", { headers: headers() })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (live) setDials(r.ok && Array.isArray(d?.variables) ? (d.variables as DialFacts[]) : []);
      })
      .catch(() => live && setDials([]));
    return () => {
      live = false;
    };
  }, [door?.kind, dials]);

  // The roles a care door can name, read once, when the care door is chosen.
  useEffect(() => {
    if (door?.id !== "exit:restorative" || roles) return;
    let live = true;
    fetch("/api/roles", { headers: headers() })
      .then(async (r) => {
        const d = await r.json().catch(() => []);
        if (live) setRoles(r.ok && Array.isArray(d) ? d.map((x: any) => ({ id: String(x.id), name: String(x.name ?? x.id) })) : []);
      })
      .catch(() => live && setRoles([]));
    return () => {
      live = false;
    };
  }, [door?.id, roles]);

  if (!option) return null;

  const scoped = servesPurposeScoped(payload.block.id, option.target);
  const pen = payload.pens[penKeyFor(option)];
  const dial = door?.kind === "dial" && option.door && dials ? dialFor(option.door, dials) : null;
  const set = (patch: Partial<SuggestionFields>) => {
    setF({ ...f, ...patch });
    setError(null);
  };

  const submit = async () => {
    const body = suggestionBody(payload.block.id, option, f, scoped);
    const parsed = parseCanvasProposal(body);
    if (!parsed.ok) return setError(parsed.error);
    const line = servesPurposeProblem(scoped, f.servesPurpose, payload.servesPurpose.requiredToday);
    if (line) return setError(line);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/canvas/proposals", { method: "POST", headers: headers(), body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(refusalText(d, "That suggestion was not kept."));
        return;
      }
      setF(EMPTY_FIELDS);
      onSent();
    } catch {
      setError("That suggestion did not reach the server, so nothing was kept.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label={`Suggest a change to ${payload.block.name}`}
      className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h4 className="font-semibold text-stone-900">Suggest a change</h4>
      <p className="text-xs text-stone-700" data-testid="canvas-notes-public">
        {payload.notesArePublic} Your first name and today's date go with it.
      </p>

      {options.length > 1 ? (
        <fieldset>
          <legend className={labelText}>What would it change?</legend>
          <div className="mt-2 space-y-1">
            {options.map((o) => (
              <label key={o.key} className="flex items-start gap-2 min-h-[32px] text-stone-800 cursor-pointer">
                <input
                  type="radio"
                  name={`canvas-suggest-${payload.block.id}`}
                  value={o.key}
                  checked={o.key === option.key}
                  onChange={() => {
                    setKey(o.key);
                    setF({ ...EMPTY_FIELDS, body: f.body, servesPurpose: f.servesPurpose });
                    setError(null);
                  }}
                  className="mt-1"
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-stone-800">
          <span className={labelText}>It would change:</span> {option.label}
        </p>
      )}
      {pen && <p className="text-xs text-stone-600">Who decides: {pen.sentence}</p>}

      {door?.kind === "dial" && (
        <label className="block">
          <span className={labelText}>What it should be</span>
          {dial && <span className={hint}>{dialToday(dial)}</span>}
          {dial?.choices ? (
            <select value={f.value} onChange={(e) => set({ value: e.target.value })} className={field}>
              <option value="">Choose one</option>
              {dial.choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={dial?.type === "integer" ? "number" : "text"}
              inputMode={dial?.type === "integer" ? "numeric" : undefined}
              min={dial?.min ?? undefined}
              max={dial?.max ?? undefined}
              value={f.value}
              onChange={(e) => set({ value: e.target.value })}
              className={field}
            />
          )}
        </label>
      )}

      {door?.kind === "module" && (
        <label className="block">
          <span className={labelText}>How widely it should be switched on</span>
          <select value={f.value} onChange={(e) => set({ value: e.target.value })} className={field}>
            <option value="">Choose one</option>
            {MODULE_LIFECYCLES.map((l) => (
              <option key={l} value={l}>
                {LIFECYCLE_WORDS[l].charAt(0).toUpperCase() + LIFECYCLE_WORDS[l].slice(1)}
              </option>
            ))}
          </select>
        </label>
      )}

      {door?.id === "exit:terms" && (
        <div className="space-y-3">
          <p className={hint}>Fill in only what you would change. Anything left empty stays as it is.</p>
          <label className="block">
            <span className={labelText}>Notice before leaving, in days</span>
            <input type="number" inputMode="numeric" min={0} value={f.noticePeriodDays} onChange={(e) => set({ noticePeriodDays: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className={labelText}>How a departing member's contribution is valued</span>
            <textarea value={f.valuationMethod} onChange={(e) => set({ valuationMethod: e.target.value })} className={area} />
          </label>
          <label className="block">
            <span className={labelText}>The steps of leaving, one per line</span>
            <textarea value={f.unwindSteps} onChange={(e) => set({ unwindSteps: e.target.value })} className={area} />
          </label>
          <label className="block">
            <span className={labelText}>What happens when somebody is asked to leave</span>
            <textarea value={f.involuntaryProcess} onChange={(e) => set({ involuntaryProcess: e.target.value })} className={area} />
          </label>
        </div>
      )}

      {door?.id === "exit:restorative" && (
        <div className="space-y-3">
          <p className={hint}>Fill in only what you would change. Anything left empty stays as it is.</p>
          <label className="block">
            <span className={labelText}>The restorative steps, one per line</span>
            <textarea value={f.steps} onChange={(e) => set({ steps: e.target.value })} className={area} />
          </label>
          <RolePicker label="The care role, which hears a conflict first" value={f.intakeContactRole} roles={roles} onChange={(v) => set({ intakeContactRole: v })} />
          <RolePicker label="The cover role, for when the care role is part of it" value={f.coverRole} roles={roles} onChange={(v) => set({ coverRole: v })} />
          <label className="block">
            <span className={labelText}>The promised reply time, in hours</span>
            <input type="number" inputMode="numeric" min={1} value={f.replyHours} onChange={(e) => set({ replyHours: e.target.value })} className={field} />
          </label>
        </div>
      )}

      {option.target === "matrix" && (
        <div className="space-y-3">
          <p className={hint}>Each column needs an answer. "Nobody yet" is an answer.</p>
          <MatrixField label="The kind of decision" value={f.subject} onChange={(v) => set({ subject: v })} />
          <MatrixField label="Who approves it" value={f.approval} onChange={(v) => set({ approval: v })} />
          <MatrixField label="Who is asked first" value={f.consultation} onChange={(v) => set({ consultation: v })} />
          <MatrixField label="Who is told" value={f.information} onChange={(v) => set({ information: v })} />
          <MatrixField label="How it is decided (optional)" value={f.method} onChange={(v) => set({ method: v })} />
          <MatrixField label="Risk tags, separated by commas (optional)" value={f.riskTags} onChange={(v) => set({ riskTags: v })} />
        </div>
      )}

      <label className="block">
        <span className={labelText}>{bodyLabel(option, titles)}</span>
        <textarea value={f.body} onChange={(e) => set({ body: e.target.value })} className={area} rows={option.target === "purpose" ? 8 : 4} />
      </label>

      {scoped && (
        <label className="block">
          <span className={labelText}>How it serves the governing purpose</span>
          <span className={hint}>
            {payload.servesPurpose.requiredToday
              ? `Needed here: this changes how the village works. One line of at least ${ALIGNMENT_MIN_WORDS} words, which everyone reads beside the suggestion.`
              : "Welcome, and not needed until the village writes its governing purpose statement."}
          </span>
          <textarea value={f.servesPurpose} onChange={(e) => set({ servesPurpose: e.target.value })} className={area} rows={2} />
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? "Sending" : "Send this suggestion"}
      </button>
    </form>
  );
}

function RolePicker({
  label,
  value,
  roles,
  onChange,
}: {
  label: string;
  value: string;
  roles: Array<{ id: string; name: string }> | null;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className={labelText}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={field} disabled={!roles}>
        <option value={KEEP}>Leave it as it is</option>
        <option value="">No role</option>
        {(roles ?? []).map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function MatrixField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className={labelText}>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={field} />
    </label>
  );
}
