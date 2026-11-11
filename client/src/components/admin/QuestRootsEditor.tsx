/**
 * THE ROOTS A QUEST GROWS FROM, set by the hands that edit the quest (the five
 * archetypes as roots, 11 Nov 2026). The founder's door to
 * `PUT /api/admin/quests/:id/roots`, with its own Save so a roots change never
 * rides an unrelated edit, the way the safety editor beside it works.
 *
 * One to three of the village's roots, with the coverage check to tag from the
 * kind of work (`RootPicker`). A seeded guess shows as a suggestion until
 * somebody saves it.
 */
import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import RootPicker from "@/components/roots/RootPicker";
import { API_BASE, authHeaders } from "./adminApi";

export default function QuestRootsEditor({
  questId,
  roots,
  suggested,
  password,
  onSaved,
}: {
  questId: string;
  roots: string[];
  suggested: boolean;
  password: string;
  onSaved?: (roots: string[]) => void;
}) {
  const { t } = useLingui();
  const [value, setValue] = useState<string[]>(roots);
  const [start, setStart] = useState<string[]>(roots);
  const [wasGuess, setWasGuess] = useState(suggested);
  const [saving, setSaving] = useState(false);
  const dirty = [...value].sort().join(",") !== [...start].sort().join(",");

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/quests/${encodeURIComponent(questId)}/roots`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ roots: value }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || t({ message: "The roots did not save. Try again.", context: "admin quest roots" }));
      const saved: string[] = Array.isArray(body?.roots) ? body.roots : value;
      setStart(saved);
      setValue(saved);
      setWasGuess(false);
      onSaved?.(saved);
      toast.success(t({ message: "Roots saved", context: "admin quest roots" }));
    } catch (e: any) {
      toast.error(e?.message || t({ message: "The roots did not save. Try again.", context: "admin quest roots" }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 text-foreground">
      <RootPicker value={value} onChange={setValue} suggested={wasGuess} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || (!dirty && !wasGuess)}
          className="min-h-11 rounded-lg bg-teal-deep px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {wasGuess && !dirty
            ? t({ message: "Confirm these roots", context: "admin quest roots" })
            : t({ message: "Save roots", context: "admin quest roots" })}
        </button>
        {!dirty && !wasGuess ? (
          <span className="text-xs text-muted-foreground">{t({ message: "Nothing to save. Change a box first.", context: "admin quest roots" })}</span>
        ) : null}
      </div>
    </div>
  );
}
