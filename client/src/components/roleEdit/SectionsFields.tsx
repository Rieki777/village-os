/**
 * THE FOUNDING SECTIONS IN THE ROLE EDITOR (phase A, lane A3): Ideal
 * background, Qualities we're looking for, the Digital Companion and its animal, the
 * paid-role line, and How rewards work as shares of the whole. Every field the
 * full card draws (client/src/components/roleCard/FullRoleCard.tsx) is written
 * here, so the full card shows exactly what the editor holds.
 *
 * Fills the form only. The editor's one SAVE sends the whole set, the server
 * reads it with `readSections` (shared/roleCardSections.ts) and refuses an
 * amount or a range in words.
 */
import { Plus, Trash2 } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { CEILING_PERIODS, EMPTY_SECTIONS, SECTION_LIMITS, SECTION_WORDS, type RoleCardSections } from "@shared/roleCardSections";
import { INPUT, LEDE, PANEL, SECONDARY } from "@/components/roleProposal/parts";

export interface SectionsForm {
  idealBackground: string;
  qualities: string;
  aiSupport: string;
  aiCompanion: string;
  paid: boolean;
  payShape: Array<{ label: string; pct: string }>;
  payNote: string;
  ceilingAmount: string;
  ceilingCurrency: string;
  ceilingPer: string;
  paySplitNote: string;
}

export function sectionsFormOf(s: RoleCardSections | undefined | null): SectionsForm {
  const v = s ?? EMPTY_SECTIONS;
  return {
    idealBackground: v.idealBackground.join("\n"),
    qualities: v.qualities.join("\n"),
    aiSupport: v.aiSupport,
    aiCompanion: v.aiCompanion,
    paid: v.paid,
    payShape: v.payShape.map((x) => ({ label: x.label, pct: String(x.pct) })),
    payNote: v.payNote,
    ceilingAmount: v.payCeiling ? String(v.payCeiling.amount) : "",
    ceilingCurrency: v.payCeiling?.currency ?? "USD",
    ceilingPer: v.payCeiling?.per ?? "month",
    paySplitNote: v.paySplitNote,
  };
}

const lines = (t: string): string[] => t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

/** The save body's sections. Percent stays as typed, so the server's sentence names a bad one. */
export function sectionsOf(f: SectionsForm): Record<string, unknown> {
  return {
    idealBackground: lines(f.idealBackground),
    qualities: lines(f.qualities),
    aiSupport: f.aiSupport.trim(),
    aiCompanion: f.aiCompanion.trim(),
    paid: f.paid,
    payShape: f.payShape.filter((x) => x.label.trim() || x.pct.trim()).map((x) => ({ label: x.label.trim(), pct: x.pct.trim() })),
    payNote: f.payNote.trim(),
    // Blank leaves the card with no ceiling, and only the split line shows.
    payCeiling: f.ceilingAmount.trim() ? { amount: f.ceilingAmount.trim().replace(/[,\s]/g, ""), currency: f.ceilingCurrency.trim().toUpperCase(), per: f.ceilingPer } : null,
    paySplitNote: f.paySplitNote.trim(),
  };
}

const AREA = `${INPUT} min-h-[96px] resize-y`;

function Field({ label, changed, children }: { label: string; changed: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-3 ${changed ? "border-dash-gold bg-dash-gold/10" : "border-border"}`} data-changed={changed ? "true" : "false"}>
      <p className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        <span>{label}</span>
        {changed && (
          <span className="rounded bg-dash-gold px-1.5 text-xs font-semibold text-dash-gold-ink">
            <Trans context="role editor, a field that differs from the role as it stands">Changed</Trans>
          </span>
        )}
      </p>
      {children}
    </div>
  );
}

export default function SectionsFields({ value, start, onChange }: { value: SectionsForm; start: SectionsForm; onChange: (v: SectionsForm) => void }) {
  const { t } = useLingui();
  const set = <K extends keyof SectionsForm>(k: K, v: SectionsForm[K]) => onChange({ ...value, [k]: v });
  const same = (k: keyof SectionsForm) => JSON.stringify(value[k]) === JSON.stringify(start[k]);
  const total = value.payShape.reduce((n, x) => n + (Number(x.pct) || 0), 0);

  return (
    <section className={`${PANEL} space-y-3`} aria-labelledby="re-sections" data-editor-sections="">
      <h3 id="re-sections" className="font-display text-lg">{SECTION_WORDS.editorHeading}</h3>
      <p className={LEDE}>{SECTION_WORDS.editorLede}</p>

      <Field label={SECTION_WORDS.paid} changed={!same("paid")}>
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="checkbox" className="size-5 accent-dash-gold" checked={value.paid} onChange={(e) => set("paid", e.target.checked)} />
          <span>{SECTION_WORDS.paidToggle}</span>
        </label>
      </Field>

      <Field label={SECTION_WORDS.idealBackground} changed={!same("idealBackground")}>
        <textarea className={AREA} value={value.idealBackground} onChange={(e) => set("idealBackground", e.target.value)} aria-label={SECTION_WORDS.idealBackground} />
        <p className="mt-1 text-xs text-muted-foreground">
          <Trans context="role editor, ideal background hint">One line each, written openly: ideally, or experience we'd love to see. Up to {SECTION_LIMITS.lines} lines.</Trans>
        </p>
      </Field>

      <Field label={SECTION_WORDS.qualities} changed={!same("qualities")}>
        <textarea className={AREA} value={value.qualities} onChange={(e) => set("qualities", e.target.value)} aria-label={SECTION_WORDS.qualities} />
        <p className="mt-1 text-xs text-muted-foreground">
          <Trans context="role editor, qualities hint">One quality per line. Up to {SECTION_LIMITS.lines} lines.</Trans>
        </p>
      </Field>

      <Field label={SECTION_WORDS.aiSupport} changed={!same("aiSupport") || !same("aiCompanion")}>
        <input
          className={INPUT}
          value={value.aiCompanion}
          maxLength={SECTION_LIMITS.companionChars}
          onChange={(e) => set("aiCompanion", e.target.value)}
          aria-label={t({ message: "The companion's animal", context: "role editor" })}
          placeholder={t({ message: "The companion's animal", context: "role editor" })}
        />
        <textarea
          className={`${AREA} mt-2`}
          value={value.aiSupport}
          maxLength={SECTION_LIMITS.aiSupportChars}
          onChange={(e) => set("aiSupport", e.target.value)}
          aria-label={t({ message: "What the Digital Companion does for this role", context: "role editor" })}
        />
      </Field>

      <Field label={SECTION_WORDS.ceilingLabel} changed={!same("ceilingAmount") || !same("ceilingCurrency") || !same("ceilingPer")}>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className={INPUT} inputMode="numeric" value={value.ceilingAmount} onChange={(e) => set("ceilingAmount", e.target.value)} aria-label={t({ message: "Ceiling amount", context: "role editor" })} placeholder={t({ message: "Empty: no ceiling line", context: "role editor" })} />
          <input className={INPUT} maxLength={3} value={value.ceilingCurrency} onChange={(e) => set("ceilingCurrency", e.target.value.toUpperCase())} aria-label={t({ message: "Currency", context: "role editor" })} />
          <select className={INPUT} value={value.ceilingPer} onChange={(e) => set("ceilingPer", e.target.value)} aria-label={t({ message: "Per", context: "role editor" })}>
            {CEILING_PERIODS.map((p) => (
              <option key={p} value={p}>{p === "month" ? t({ message: "a month", context: "role editor" }) : p === "moon" ? t({ message: "a moon", context: "role editor" }) : t({ message: "a year", context: "role editor" })}</option>
            ))}
          </select>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          <Trans context="role editor, ceiling hint">The card reads: Total compensation up to this figure. Ranges and minimums stay off the card.</Trans>
        </p>
      </Field>

      <Field label={SECTION_WORDS.payShape} changed={!same("payShape") || !same("payNote") || !same("paySplitNote")}>
        <ol className="space-y-2">
          {value.payShape.map((x, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <input
                className={`${INPUT} flex-1`}
                value={x.label}
                aria-label={SECTION_WORDS.shareLabel}
                onChange={(e) => set("payShape", value.payShape.map((y, n) => (n === i ? { ...y, label: e.target.value } : y)))}
              />
              <input
                className={`${INPUT} w-24`}
                inputMode="numeric"
                value={x.pct}
                aria-label={SECTION_WORDS.sharePct}
                onChange={(e) => set("payShape", value.payShape.map((y, n) => (n === i ? { ...y, pct: e.target.value } : y)))}
              />
              <span aria-hidden="true">%</span>
              <button type="button" className={SECONDARY} aria-label={t({ message: "Remove", context: "role editor" })} onClick={() => set("payShape", value.payShape.filter((_, n) => n !== i))}>
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className={`${SECONDARY} mt-2`}
          disabled={value.payShape.length >= SECTION_LIMITS.shares}
          onClick={() => set("payShape", [...value.payShape, { label: "", pct: "" }])}
        >
          <Plus className="size-4" /> {SECTION_WORDS.addShare}
        </button>
        <p className="mt-1 text-xs text-muted-foreground" role="status">
          <Trans context="role editor, pay shape total">The shares add up to {total}%.</Trans>
        </p>
        <label className="mt-3 block text-sm font-semibold text-foreground">
          {SECTION_WORDS.splitNoteLabel}
          <input className={`${INPUT} mt-1 font-normal`} value={value.paySplitNote} maxLength={SECTION_LIMITS.payNoteChars} onChange={(e) => set("paySplitNote", e.target.value)} />
        </label>
        <label className="mt-3 block text-sm font-semibold text-foreground">
          {SECTION_WORDS.payNoteLabel}
          <textarea className={`${AREA} mt-1 font-normal`} value={value.payNote} maxLength={SECTION_LIMITS.payNoteChars} onChange={(e) => set("payNote", e.target.value)} />
        </label>
      </Field>
    </section>
  );
}
