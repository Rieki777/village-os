/**
 * WHAT A PHYSICAL QUEST ASKS OF THE BODY, on the quest page (build days S5).
 *
 * The safety note, the minimum age and the badges the quest needs, read from
 * `GET /api/game/quests/:id/safety`, shown before anyone claims. A signed-in
 * member who has not said their age band can say it here, once: a band, never
 * a birth date (spec R10). Nothing shows for a quest that asks nothing.
 *
 * The safety note is the quest's own words and is never machine-translated
 * (spec R21, i18n R22): it shows as written.
 */
import { useEffect, useState } from "react";
import { HardHat } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { gameFetch } from "@/lib/gameApi";
import type { AgeBand } from "@shared/ageBands";

interface Safety {
  physical: boolean;
  minAge: number | null;
  requiredBadges: Array<{ id: string; name: string }>;
  safetyNote: string | null;
}

export default function QuestSafety({ questId, signedIn }: { questId: string; signedIn: boolean }) {
  const { t } = useLingui();
  const [safety, setSafety] = useState<Safety | null>(null);
  const [band, setBand] = useState<AgeBand | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let gone = false;
    gameFetch(`/api/game/quests/${encodeURIComponent(questId)}/safety`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !gone && setSafety(d))
      .catch(() => !gone && setSafety(null));
    return () => {
      gone = true;
    };
  }, [questId]);

  useEffect(() => {
    if (!signedIn || safety?.minAge == null) return;
    let gone = false;
    gameFetch("/api/me/age-band")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !gone && setBand(d?.band ?? null))
      .catch(() => !gone && setBand(undefined));
    return () => {
      gone = true;
    };
  }, [signedIn, safety?.minAge]);

  if (!safety || (!safety.physical && safety.minAge == null && !safety.requiredBadges.length && !safety.safetyNote)) return null;

  const say = async (b: AgeBand) => {
    setSaving(true);
    setError("");
    try {
      const r = await gameFetch("/api/me/age-band", { method: "POST", body: JSON.stringify({ band: b }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setBand(b);
      else setError(d.error ?? t({ message: "That did not save. Try again.", context: "quest safety, age band" }));
    } catch {
      setError(t({ message: "That did not save. Try again.", context: "quest safety, age band" }));
    }
    setSaving(false);
  };

  const minAge = safety.minAge;
  const badges = safety.requiredBadges.map((b) => b.name).join(", ");

  return (
    <section aria-labelledby="quest-safety-heading" className="rounded-2xl border border-amber/40 bg-amber/10 p-5">
      <h2 id="quest-safety-heading" className="flex items-center gap-2 font-semibold text-foreground">
        <HardHat className="h-5 w-5 text-amber-700" aria-hidden="true" />
        <Trans context="quest safety heading">Before you come to the site</Trans>
      </h2>
      <ul className="mt-2 space-y-1.5 text-sm text-foreground">
        {minAge != null ? (
          <li>
            <Trans context="quest safety, minimum age">Everyone on this quest is at least {minAge}.</Trans>
          </li>
        ) : null}
        {badges ? (
          <li>
            <Trans context="quest safety, badges needed">You need: {badges}</Trans>
          </li>
        ) : null}
        {safety.safetyNote ? <li className="whitespace-pre-line">{safety.safetyNote}</li> : null}
      </ul>

      {signedIn && minAge != null && band === null ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-foreground">
            <Trans context="quest safety, ask for the age band">Say your age band once. The village keeps the band, never your birth date.</Trans>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={saving} onClick={() => say("under16")} className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm">
              <Trans context="age band option">Under 16</Trans>
            </button>
            <button type="button" disabled={saving} onClick={() => say("16to17")} className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm">
              <Trans context="age band option">16 or 17</Trans>
            </button>
            <button type="button" disabled={saving} onClick={() => say("18plus")} className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm">
              <Trans context="age band option">18 or older</Trans>
            </button>
          </div>
          {error ? (
            <p role="alert" className="mt-1.5 text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
