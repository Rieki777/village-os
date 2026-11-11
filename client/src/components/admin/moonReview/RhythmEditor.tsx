/**
 * THE MOON RHYTHM, edited by a `cash.pay` holder (decision 22, addendum v5
 * B1): one moon's walkthrough or circle day moved, the hour reminders go out,
 * and the village's own End of Moon guide. Empty by default; with no guide
 * set, no guide link shows anywhere. The server validates with `parseRhythm`
 * and records every change.
 *
 * Light-only, like the rest of this folder.
 */
import { useEffect, useState } from "react";
import { ADMIN_WORDS } from "@shared/moonRecap";
import type { RhythmDoc } from "@shared/moonRhythm";
import SaveBar from "@/components/SaveBar";
import { docChangeCount } from "@/lib/unsavedChanges";
import { buttonClass, inputClass, labelClass, primaryClass, useSettingsDocument } from "./useSettingsDocument";

const W = ADMIN_WORDS.rhythm;

interface Draft {
  sendHour: string;
  guideUrl: string;
  overrides: Array<{ cycleId: string; walkthrough: string; circle: string }>;
}

const toDraft = (r: RhythmDoc): Draft => ({
  sendHour: String(r.sendHour),
  guideUrl: r.guideUrl,
  overrides: Object.entries(r.cycles).map(([cycleId, o]) => ({ cycleId, walkthrough: o.walkthrough ?? "", circle: o.circle ?? "" })),
});

export const fromDraft = (d: Draft): RhythmDoc => ({
  sendHour: Number(d.sendHour),
  guideUrl: d.guideUrl.trim(),
  cycles: Object.fromEntries(
    d.overrides
      .filter((o) => o.cycleId.trim())
      .map((o) => [o.cycleId.trim(), { ...(o.walkthrough ? { walkthrough: o.walkthrough } : {}), ...(o.circle ? { circle: o.circle } : {}) }]),
  ),
});

export default function RhythmEditor({ password }: { password: string }) {
  const { state, save, saving, message } = useSettingsDocument<RhythmDoc>("rhythm", password);
  const [d, setD] = useState<Draft | null>(null);

  useEffect(() => {
    if (state.kind === "ready") setD(toDraft(state.doc));
  }, [state]);

  if (state.kind === "loading" || state.kind === "off") return null;
  if (state.kind === "refused") return <p role="alert" className="text-sm text-foreground">{state.text}</p>;
  if (!d) return null;

  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const setOverride = (i: number, patch: Partial<Draft["overrides"][number]>) =>
    set({ overrides: d.overrides.map((o, k) => (k === i ? { ...o, ...patch } : o)) });

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-xl border border-border bg-white p-4 sm:grid-cols-2">
        <label className={labelClass}>{W.sendHour}<input type="number" min={0} max={23} className={inputClass} value={d.sendHour} onChange={(e) => set({ sendHour: e.target.value })} /></label>
        <label className={labelClass}>{W.guideUrl}<input type="url" className={inputClass} value={d.guideUrl} onChange={(e) => set({ guideUrl: e.target.value })} /></label>
        {!d.guideUrl.trim() && <p className="text-sm text-muted-foreground sm:col-span-2">{W.guideEmpty}</p>}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-white p-4">
        <p className={labelClass}>{W.overrides}</p>
        <p className="text-sm text-muted-foreground">{W.overridesHint}</p>
        {d.overrides.map((o, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <label className={labelClass}>{W.cycleId}<input className={inputClass} value={o.cycleId} onChange={(e) => setOverride(i, { cycleId: e.target.value })} /></label>
            <label className={labelClass}>{W.walkthrough}<input type="date" className={inputClass} value={o.walkthrough} onChange={(e) => setOverride(i, { walkthrough: e.target.value })} /></label>
            <label className={labelClass}>{W.circle}<input type="date" className={inputClass} value={o.circle} onChange={(e) => setOverride(i, { circle: e.target.value })} /></label>
            <button type="button" className={`${buttonClass} self-end`} onClick={() => set({ overrides: d.overrides.filter((_, k) => k !== i) })}>{W.remove}</button>
          </div>
        ))}
        <button type="button" className={buttonClass} onClick={() => set({ overrides: [...d.overrides, { cycleId: "", walkthrough: "", circle: "" }] })}>{W.addOverride}</button>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {message && <p role={message.ok ? "status" : "alert"} className="text-sm text-foreground">{message.text}</p>}
      </div>
      <SaveBar count={docChangeCount(state.kind === "ready" ? JSON.stringify(toDraft(state.doc)) : null, JSON.stringify(d))} onSave={() => save(fromDraft(d))} onDiscard={() => setD(toDraft((state as { doc: RhythmDoc }).doc))} what="the moon rhythm" />
    </div>
  );
}
