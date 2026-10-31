/**
 * "SERVES": the season priority a weekly priority or a win serves (0292),
 * named by the goal's id since 0298 so a reworded goal keeps its links.
 *
 * Shared by the room's template panel (priorities, the wins section) and the
 * agenda item's own wins (EntryStream). `useSeasonGoals` reads the running
 * season's goals from `GET /api/season`, the banner's own public read, once
 * per page.
 */
import { useEffect, useState } from "react";
import { SEASON_COPY, type SeasonGoalRef } from "@shared/sessionTemplates";
import { gameFetch } from "@/lib/gameApi";
import { CHIP, INPUT } from "./roomUi";

/** "Serves": one of the season's priorities, or none. Draws nothing when the season names none. */
export function ServesPicker({
  goals,
  value,
  onChange,
  disabled,
  label,
}: {
  goals: readonly SeasonGoalRef[];
  /** The goal id it serves now, or null. */
  value: string | null;
  onChange(goalId: string | null): void;
  disabled?: boolean;
  /** What it serves for, read by a screen reader ("Serves", for a win's words). */
  label?: string;
}) {
  if (!goals.length) return null;
  // A link to a goal the season no longer holds still shows, as its own choice, until it is changed.
  const known = value == null || goals.some((g) => g.id === value);
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm text-foreground">
      <span className="shrink-0 text-muted-foreground">{SEASON_COPY.serves}</span>
      <select
        className={`${INPUT} w-auto max-w-[16rem] truncate`}
        aria-label={label}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{SEASON_COPY.servesNone}</option>
        {!known && <option value={value ?? ""}>{SEASON_COPY.goneGoal}</option>}
        {goals.map((g) => (
          <option key={g.id} value={g.id}>
            {g.text}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The season priority a row serves, as a chip. */
export const ServesChip = ({ goal }: { goal: string | null }) =>
  goal ? (
    <span className={CHIP}>
      {SEASON_COPY.serves}: {goal}
    </span>
  ) : null;

/** The running season's goals, with their ids, read once from the banner's own door. Empty when none. */
export function useSeasonGoals(enabled = true): SeasonGoalRef[] {
  const [goals, setGoals] = useState<SeasonGoalRef[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      try {
        const res = await gameFetch("/api/season");
        if (!res.ok) return;
        const body = (await res.json()) as { current?: { goals?: unknown } | null };
        const list = Array.isArray(body?.current?.goals) ? (body.current!.goals as any[]) : [];
        const clean = list
          .filter((g) => g && typeof g.id === "string" && typeof g.text === "string" && g.text.trim())
          .map((g) => ({ id: String(g.id), text: String(g.text).trim() }));
        if (live) setGoals(clean);
      } catch {
        // Offline: a win can still be shared, and named later.
      }
    })();
    return () => {
      live = false;
    };
  }, [enabled]);
  return goals;
}
