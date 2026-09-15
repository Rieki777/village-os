/**
 * Step 2 of the Setup Wizard, and the read that decides whether it is done.
 *
 * The step's body is a summary and a button, the shape steps 4 to 7 already
 * use. The six screens live in `NeedsPanel.tsx`, on their own admin tab,
 * because `client/src/pages/Admin.tsx` is tracked by a ratchet that only turns
 * down and cannot take a component body.
 *
 * WHY THE COMPLETION IS A READ AND NEVER A TICK. Every other unmeasured step in
 * that wizard carries a checkbox, and a ticked box outlives whatever it was
 * ticked about: a live village showed six of six while holding nine empty
 * picture slots. The needs scope is readable, so this step reads it.
 */
import { useEffect, useMemo, useState } from "react";
import SetupSection from "./SetupSection";
import { API_BASE, authHeaders } from "./adminApi";
import {
  needsObservation,
  type NeedsScopeReading,
  type SetupObservations,
  type SetupRow,
  type SetupStepKey,
} from "./setupProgress";
import { stepSummaryLine, type ScopeSummary } from "./needsCopy";
import { HINT, PRIMARY } from "./NeedsPieces";

/* -------------------------------------------------------------------------- *
 * The reading the Setup Wizard's step needs, and the step itself.
 * -------------------------------------------------------------------------- */

/**
 * The needs scope, read once, as a Setup Wizard observation.
 *
 * WHY A HOOK AND NOT A PROP. Two callers need this reading and neither can
 * hand it to the other: the Admin shell decides whether the whole wizard is
 * finished (which is what moves "Make This Yours" out of the nav), and
 * `SetupWizard` renders the step. `client/src/pages/Admin.tsx` is under a
 * ratchet that only turns down, so threading one value between them through
 * props would cost more lines there than the whole mount does.
 *
 * `observations` is memoised on the reading, because the shell's effect
 * depends on its identity: a fresh object every render would refetch the brand
 * document forever.
 *
 * A REFUSED OR MISSING READ STAYS NULL, and `needsObservation(null)` is
 * `unknown`, never a quiet zero. A village whose scope could not be read and a
 * village that took on nothing are different facts.
 */
export function useNeedsSetupObservation(password: string | null): {
  observations: SetupObservations;
  summary: ScopeSummary | null;
} {
  const [summary, setSummary] = useState<ScopeSummary | null>(null);

  useEffect(() => {
    if (!password) return;
    let alive = true;
    fetch(`${API_BASE}/needs/scope`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && d.summary) setSummary(d.summary as ScopeSummary);
      })
      .catch(() => {
        /* Left null. The step reads `unknown`, which is what nobody-has-looked means. */
      });
    return () => {
      alive = false;
    };
  }, [password]);

  const reading: NeedsScopeReading | null = summary
    ? { answered: summary.answered, adopted: summary.adopted, customAdopted: summary.customAdopted }
    : null;
  const observations = useMemo(
    () => needsObservation(reading),
    // The three fields are the whole of the reading, so they are the whole of
    // the dependency. Depending on `reading` itself rebuilds it every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary?.answered, summary?.adopted, summary?.customAdopted],
  );

  return { observations, summary };
}

/**
 * Step 2 of the Setup Wizard: a summary and a button, the shape steps 4 to 6
 * already use. The six screens live in the panel below, on their own tab.
 */
export function NeedsSetupStep({
  rows,
  setup,
  onToggleStep,
  onOpenTab,
  summary,
}: {
  rows: readonly SetupRow[];
  setup: Record<string, unknown> | null | undefined;
  onToggleStep: (key: SetupStepKey) => void;
  onOpenTab: (tab: string) => void;
  summary: ScopeSummary | null;
}) {
  return (
    <SetupSection
      rows={rows}
      setup={setup}
      onToggleStep={onToggleStep}
      id="needs"
      n={2}
      title="What this village is for"
      subtitle="The needs this village is taking on, how far it means to get on each, and for how many."
    >
      {/* Its own ground, for the same reason the panel has one: the wizard
          around it is painted with frozen light grays, so a responsive token
          laid straight onto it is near-white text on light gray in dark mode. */}
      <div className="bg-background text-foreground rounded-lg p-4">
        <p className="text-sm text-foreground mb-3">
          A village is a business designed to meet the needs of the people in it. Setting this up front
          orients everything after it: meeting one need for a tenth of your members and meeting all ten
          for all of them are two different economic engines.
        </p>
        <p className={`${HINT} mb-4`}>{stepSummaryLine(summary)}</p>
        <button type="button" onClick={() => onOpenTab("needs-admin")} className={PRIMARY}>
          Open the six screens
        </button>
      </div>
    </SetupSection>
  );
}
