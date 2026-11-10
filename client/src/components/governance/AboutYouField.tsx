/**
 * THE MEMBER DOOR'S "ABOUT YOU" STEP (joining lane PR 2): where you are based,
 * your languages, your story with us, up to three references, and the
 * background-check consent. The same pieces as the open form's section
 * (components/openProposal/AboutYou.tsx), so both doors ask the same things.
 *
 * What the member's profile already holds is not asked again: their time zone
 * lives on the profile (TimeZoneField), and the earliest start is the terms
 * step's "First day". Links and files stay on the open form.
 *
 * Whether a role picked is always background-checked comes from the org chart
 * the wizard already holds (`alwaysChecked` on the role).
 */
import { useEffect, useState } from "react";
import type { FieldSpec } from "./wizardConfig";
import { AboutYouFacts, ReferencesBlock, aboutYouOf, aboutYouProblem } from "@/components/openProposal/AboutYou";
import { loadOrg } from "./pickSources";
import { pickedSeats } from "./SeatPicksField";

/** Whether any role picked is always background-checked, from the org chart's roles. */
export function alwaysCheckedIn(roles: ReadonlyArray<Record<string, any>> | null | undefined, ids: readonly string[]): boolean {
  return ids.some((id) => (roles ?? []).find((r) => String(r?.id) === id)?.alwaysChecked === true);
}

/** The org chart's roles as last read, so the step's verdict (which is synchronous) can ask the same question the field does. The route judges it again. */
let known: Array<Record<string, any>> | null = null;

/** The step's verdict. */
export const aboutYouStepProblem = (v: unknown, a: Record<string, unknown>): string | null => aboutYouProblem(v, alwaysCheckedIn(known, pickedSeats(a.seatIds ?? a.seatId)));

export function useAlwaysChecked(ids: readonly string[]): boolean {
  const [org, setOrg] = useState<Array<Record<string, any>> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadOrg().then((o) => {
      known = Array.isArray(o?.roles) ? o.roles : [];
      if (alive) setOrg(known);
    });
    return () => {
      alive = false;
    };
  }, []);
  return alwaysCheckedIn(org, ids);
}

const FIELD = "w-full min-h-[44px] rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep aria-[invalid=true]:border-coral";

export default function AboutYouField({
  field,
  value,
  onChange,
  answers,
  problem,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
  answers: Record<string, unknown>;
  problem?: string | null;
}) {
  const v = aboutYouOf(value);
  const always = useAlwaysChecked(pickedSeats(answers.seatIds ?? answers.seatId));
  return (
    <div className="grid gap-5" data-about-field="">
      {field.help && <p className="text-sm text-stone-600">{field.help}</p>}
      <AboutYouFacts value={v} onChange={onChange} fieldClass={FIELD} idPrefix="door-about" />
      <ReferencesBlock value={v} onChange={onChange} alwaysChecked={always} fieldClass={FIELD} idPrefix="door-about" invalid={!!problem} />
      {problem && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

/** The review step's reading of the answers: what will be sent, in a few lines. */
export function aboutYouReview(v: unknown): string {
  const a = aboutYouOf(v);
  const given = a.references.filter((r) => r.name.trim() || r.contact.trim()).length;
  return [
    a.based.trim() && `Based in: ${a.based.trim()}`,
    a.languages.trim() && `Languages: ${a.languages.trim()}`,
    a.story.trim() && `Story with us: ${a.story.trim()}`,
    given ? `References: ${given}` : "References: none, so a background check",
    a.consent && "Background check: agreed",
  ]
    .filter(Boolean)
    .join("\n");
}
