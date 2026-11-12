/**
 * THE FOUNDER'S GOAL THREAD CONTROL, on the quest's own page (decision 5).
 *
 * Which season goal this quest grows, and where the work happens. Admin
 * only, beside the needs picker for the same reason that one lives here:
 * Admin's quest editor is at its line ratchet. It saves through
 * `PUT /api/admin/quests/:id/thread`, which checks the goal against this
 * season. Display only: no claim reads a thread.
 */
import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { gameFetch } from "@/lib/gameApi";
import { BTN_SECONDARY, FIELD, HINT, LABEL } from "@/components/journey/look";
import { QUEST_PLACES, type QuestPlace } from "@shared/questThreads";
import { usePlaceWords } from "./placeWords";

export interface QuestThreadPickerProps {
  questId: string;
  goals: readonly { id: string; text: string }[];
  goalId: string | null;
  place: QuestPlace | null;
  onSaved: (thread: { goalId: string | null; place: QuestPlace | null }) => void;
}

export default function QuestThreadPicker({ questId, goals, goalId, place, onSaved }: QuestThreadPickerProps) {
  const { t } = useLingui();
  const placeWords = usePlaceWords();
  const [goal, setGoal] = useState(goalId ?? "");
  const [where, setWhere] = useState<QuestPlace | "">(place ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [problem, setProblem] = useState("");

  const save = async () => {
    setState("saving");
    setProblem("");
    try {
      const res = await gameFetch(`/api/admin/quests/${encodeURIComponent(questId)}/thread`, {
        method: "PUT",
        body: JSON.stringify({ goalId: goal || null, place: where || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("failed");
        setProblem(typeof body?.error === "string" ? body.error : t({ message: "That did not save. Try again.", context: "quest goal thread editor" }));
        return;
      }
      setState("saved");
      onSaved({ goalId: body.goalId ?? null, place: body.place ?? null });
    } catch {
      setState("failed");
      setProblem(t({ message: "That did not save. Try again.", context: "quest goal thread editor" }));
    }
  };

  return (
    <div className="rounded-xl border border-border bg-muted p-4" data-thread-picker>
      <p className={LABEL}>{t({ message: "The goal this quest grows", context: "quest goal thread editor" })}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={HINT}>{t({ message: "Season goal", context: "quest goal thread editor: field" })}</span>
          <select className={`${FIELD} mt-1 min-h-11`} value={goal} onChange={(e) => { setGoal(e.target.value); setState("idle"); }}>
            <option value="">{t({ message: "No goal yet", context: "quest goal thread editor: empty choice" })}</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>{g.text}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={HINT}>{t({ message: "Where it happens", context: "quest goal thread editor: field" })}</span>
          <select className={`${FIELD} mt-1 min-h-11`} value={where} onChange={(e) => { setWhere(e.target.value as QuestPlace | ""); setState("idle"); }}>
            <option value="">{t({ message: "Not said yet", context: "quest goal thread editor: empty choice" })}</option>
            {QUEST_PLACES.map((p) => (
              <option key={p} value={p}>{placeWords[p]}</option>
            ))}
          </select>
        </label>
      </div>
      {!goals.length && (
        <p className={`${HINT} mt-2`}>{t({ message: "This season has no goals yet. Add them in Admin, Season.", context: "quest goal thread editor" })}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={BTN_SECONDARY} onClick={save} disabled={state === "saving"}>
          {state === "saving"
            ? t({ message: "Saving", context: "quest goal thread editor: button while saving" })
            : t({ message: "Save the thread", context: "quest goal thread editor: button" })}
        </button>
        <span role="status" className={HINT}>
          {state === "saved" ? t({ message: "Saved.", context: "quest goal thread editor" }) : ""}
        </span>
      </div>
      {state === "failed" && problem && (
        <p role="alert" className="mt-2 text-sm text-destructive">{problem}</p>
      )}
    </div>
  );
}
