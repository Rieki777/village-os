/**
 * THE MEMBER DOOR'S GOALS STEP (joining lane PR 1): the wizard field that draws
 * the goals list (GoalsList) for the roles picked on the first step.
 *
 * It reads the picked roles' own goals from the org chart, so each goal can
 * name the role goal it moves, and the season's open goals, so a goal can name
 * the one it serves. A draft saved before goals existed carries its words as
 * one block of `deliverables`; the first time the field opens it turns that
 * block into one goal, so nothing a member wrote is lost.
 */
import { useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { BLANK_GOAL, legacyGoals, type ProposalGoal } from "@shared/proposalGoals";
import type { FieldSpec } from "./wizardConfig";
import GoalsList, { type GoalRole } from "./GoalsList";
import { loadOrg } from "./pickSources";
import { pickedSeats } from "./SeatPicksField";
import { openGoals } from "./SeasonGoalField";

export default function GoalsField({
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
  const { t } = useLingui();
  const ids = pickedSeats(answers.seatIds ?? answers.seatId);
  const key = ids.join(",");
  const [org, setOrg] = useState<Array<Record<string, any>> | null>(null);
  const [season, setSeason] = useState<Array<{ id: string; text: string }> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadOrg().then((o) => {
      if (alive) setOrg(Array.isArray(o?.roles) ? o.roles : []);
    });
    void fetch("/api/season")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((s) => {
        if (alive) setSeason(openGoals(s));
      });
    return () => {
      alive = false;
    };
  }, []);

  const roles: GoalRole[] = useMemo(
    () =>
      ids.map((id) => {
        const r = (org ?? []).find((x) => String(x.id) === id);
        const goals = Array.isArray(r?.accountabilities) ? r.accountabilities.map((a: unknown) => String(a ?? "").trim()).filter(Boolean) : [];
        return { id, name: String(r?.name ?? id), goals };
      }),
    [org, key], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const goals = Array.isArray(value) ? (value as ProposalGoal[]) : null;
  // First open: a draft's old block of words becomes one goal, otherwise one empty goal to write in.
  useEffect(() => {
    if (goals) return;
    const old = legacyGoals(answers.deliverables).map((g) => ({ ...g, roleId: ids[0] ?? "" }));
    onChange(old.length ? old : [{ ...BLANK_GOAL, roleId: ids[0] ?? "" }]);
  }, [goals]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <fieldset className="grid gap-2" data-goals-field="">
      <legend className="mb-1 text-sm font-semibold text-foreground">{field.label}</legend>
      {field.help && <p className="text-sm text-muted-foreground">{field.help}</p>}
      {org === null ? (
        <p className="text-sm text-muted-foreground">{t`Loading your roles' goals…`}</p>
      ) : (
        <GoalsList
          idPrefix="door-goals"
          goals={goals ?? []}
          onChange={onChange}
          roles={roles.length ? roles : [{ id: "", name: t({ message: "this role", context: "proposal goals list" }), goals: [] }]}
          seasonGoals={(season ?? []).map((g) => ({ value: g.text, label: g.text }))}
          problem={problem}
        />
      )}
    </fieldset>
  );
}
