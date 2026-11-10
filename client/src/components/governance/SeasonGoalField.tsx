/**
 * WHICH OF THE SEASON'S GOALS THE WORK SERVES (the member door, Rye 10 Nov
 * 2026: the member door asks what the open form asks).
 *
 * The goals are the season's own (`/api/season`, the Season tab's list; done
 * ones drop off), so a member picks one the village set. A season with no
 * goals yet says so and never blocks applying (brief v3): the field answers
 * for the member with NO_SEASON_GOALS, which the publish leaves out.
 */
import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import type { FieldSpec } from "./wizardConfig";
import { NO_SEASON_GOALS } from "./roleApplicationType";

type Goal = { id: string; text: string };

export function openGoals(season: unknown): Goal[] {
  const goals = (season as { current?: { goals?: unknown } } | null)?.current?.goals;
  return (Array.isArray(goals) ? goals : [])
    .filter((g: any) => g && typeof g.text === "string" && g.text.trim() && !g.done)
    .map((g: any) => ({ id: String(g.id ?? g.text), text: String(g.text).trim() }));
}

export default function SeasonGoalField({
  field,
  value,
  onChange,
  problem,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
  problem?: string | null;
}) {
  const { t } = useLingui();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch("/api/season")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((s) => {
        if (alive) setGoals(openGoals(s));
      });
    return () => {
      alive = false;
    };
  }, []);
  const picked = String(value ?? "");

  // No goals yet: answer for the member, once, so the step never blocks.
  useEffect(() => {
    if (goals && goals.length === 0 && picked !== NO_SEASON_GOALS) onChange(NO_SEASON_GOALS);
  }, [goals, picked, onChange]);

  if (goals === null) return <p className="text-sm text-muted-foreground">{t`Loading the season's goals…`}</p>;
  if (goals.length === 0) {
    return (
      <p className="rounded-lg bg-muted p-3 text-sm text-foreground" data-no-season-goals="">
        {t`The village has not set its goals for this season yet. You can still apply: say in your aim what you would bring.`}
      </p>
    );
  }
  return (
    <fieldset className="grid gap-1" data-season-goal="">
      <legend className="mb-1 text-sm font-semibold text-foreground">{field.label}</legend>
      {goals.map((g) => (
        <label key={g.id} className="flex min-h-11 items-start gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="season-goal"
            className="mt-1 size-4 accent-primary"
            checked={picked === g.text}
            onChange={() => onChange(g.text)}
          />
          {g.text}
        </label>
      ))}
      {problem && (
        <p role="alert" className="mt-1 text-sm font-medium text-destructive">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
