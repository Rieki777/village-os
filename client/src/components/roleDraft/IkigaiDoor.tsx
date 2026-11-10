/**
 * THE R-IKIGAI DOOR on the role draft board (role journey, lane L3).
 *
 * Four short questions in the village's words. The answers are kept in this
 * browser by the parent (DiscoverStep) and go nowhere on their own. Two things
 * can move them, and both are the person's press or tick:
 *   - the tick copies them into "Why you" on the open form, as ordinary words;
 *   - "Ask the guide" sends the four answers and the open roles' names to the
 *     guide for this one press. It is labelled as AI, signed-in members only,
 *     and nothing it says is saved or shown to anyone deciding.
 */
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { DISCOVER_WORDS, IKIGAI_IDS, IKIGAI_LABELS, clipAnswer, hasIkigai, type GuideSuggestionOut, type IkigaiId, type IkigaiState } from "@shared/roleDiscover";
import type { DraftRole } from "@shared/roleDraft";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/journey/look";


export const GUIDE_URL = "/api/governance/role-discover/guide";

const FIELD = "w-full rounded-lg border border-border bg-background p-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring";

export default function IkigaiDoor({
  asks,
  state,
  onChange,
  roles,
  onDraft,
  saveBlocked,
}: {
  asks: Record<IkigaiId, string>;
  state: IkigaiState;
  onChange: (next: IkigaiState) => void;
  roles: readonly DraftRole[];
  onDraft: (roleId: string) => void;
  saveBlocked: boolean;
}) {
  const me = useOptionalAuth()?.user ?? null;
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [out, setOut] = useState<{ guide: string; suggestions: GuideSuggestionOut[] } | null>(null);

  // Called only from the button below. Nothing else in this file sends the answers anywhere.
  const ask = async () => {
    setBusy(true);
    setNote(null);
    try {
      const token = authToken();
      const res = await fetch(GUIDE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ answers: state.answers, roles: roles.map((r) => ({ id: r.id, name: r.name, aim: r.aim ?? "" })) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setOut(null);
        setNote(typeof body?.error === "string" && body.error.includes(" ") ? body.error : "The guide can't answer right now. Everything here works without it.");
        return;
      }
      setOut({ guide: String(body?.guide?.name ?? ""), suggestions: (Array.isArray(body?.suggestions) ? (body.suggestions as GuideSuggestionOut[]) : []).filter((s) => roles.some((r) => r.id === s?.roleId)) });
    } catch {
      setNote("The guide can't answer right now. Everything here works without it.");
    } finally {
      setBusy(false);
    }
  };
  const nameOf = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  return (
    <section aria-labelledby="draft-ikigai" className="rounded-2xl border border-border bg-card p-4 text-card-foreground">
      <h2 id="draft-ikigai" className="font-display text-2xl font-bold">{DISCOVER_WORDS.ikigaiDoor}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{DISCOVER_WORDS.kept}</p>
      <div className="mt-3 space-y-3">
        {IKIGAI_IDS.map((id) => (
          <div key={id}>
            <label htmlFor={`ikigai-${id}`} className="block text-sm font-semibold">
              {IKIGAI_LABELS[id]}
              <span className="block font-normal text-muted-foreground">{asks[id]}</span>
            </label>
            <textarea
              id={`ikigai-${id}`}
              rows={2}
              value={state.answers[id]}
              onChange={(e) => onChange({ ...state, answers: { ...state.answers, [id]: clipAnswer(e.target.value) } })}
              className={`mt-1 ${FIELD}`}
            />
          </div>
        ))}
      </div>
      {saveBlocked && <p className="mt-2 text-xs text-muted-foreground">{t`This browser blocks saving, so your answers last for this visit only.`}</p>}
      <label className="mt-3 flex min-h-11 items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.carry}
          disabled={!hasIkigai(state)}
          onChange={(e) => onChange({ ...state, carry: e.target.checked })}
          className="mt-0.5 size-5 shrink-0 accent-notice"
        />
        <span>{DISCOVER_WORDS.carry}</span>
      </label>

      <div className="mt-3 border-t border-border pt-3">
        {me ? (
          <>
            <button
              type="button"
              disabled={busy || !hasIkigai(state) || roles.length === 0}
              onClick={ask}
              className={`${BTN_SECONDARY} disabled:border-dashed`}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              {DISCOVER_WORDS.askGuide}
            </button>
            <p className="mt-1 text-xs text-muted-foreground">{DISCOVER_WORDS.guideNote}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{DISCOVER_WORDS.signInToAsk}</p>
        )}
        {busy && <p role="status" className="mt-2 text-sm text-muted-foreground">{t({ message: "Asking the guide…", context: "role draft discover" })}</p>}
        {note && <p role="alert" className="mt-2 text-sm">{note}</p>}
        {out && (
          <div className="mt-2" aria-live="polite">
            <p className="text-xs font-bold uppercase tracking-wide text-notice">{DISCOVER_WORDS.aiLabel}{out.guide ? ` from ${out.guide}` : ""}</p>
            {out.suggestions.length === 0 ? (
              <p className="mt-1 text-sm">{t`The guide had no role to suggest from these answers.`}</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {out.suggestions.map((s) => (
                  <li key={s.roleId} className="text-sm">
                    <strong>{nameOf(s.roleId)}</strong>: {s.why}{" "}
                    <button type="button" onClick={() => onDraft(s.roleId)} className={`mt-1 ${BTN_PRIMARY}`}>
                      {t({ message: "Select this role", context: "role draft discover" })}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
