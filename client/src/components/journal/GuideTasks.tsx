/**
 * THE GUIDE HELPS WITH TASKS, in the journal (Rye, 2026-11-09: "Sera in the
 * journal feature of the site where sera can use it's memory and be updating
 * tasks, helping with tasks").
 *
 * The guide (the village guide or Sera, by the member's choice) reads the
 * member's open tasks and, from what they wrote, may suggest a small next step
 * or say an open task is finished. Nothing changes until the member taps:
 * "Add to my list" writes a task with source `journal` through the list's own
 * route, and "Mark done" goes through the list's own done route, so a task the
 * library sent is reported back to Sera exactly as a tap on the list would be.
 */
import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { addTask, markDone, readList } from "@/components/yourList/yourListApi";
import { BTN_SECONDARY, HINT } from "./ui";

type Row = { key: string; title: string; state: "idle" | "busy" | "done" | "failed"; why?: string };

export default function GuideTasks({
  suggested,
  done,
  guideName,
}: {
  suggested: string[];
  done: { id: string; title: string }[];
  guideName: string;
}) {
  const { t } = useLingui();
  const [adds, setAdds] = useState<Row[]>(() => suggested.map((title, i) => ({ key: `a${i}`, title, state: "idle" })));
  const [dones, setDones] = useState<(Row & { id: string })[]>(() => done.map((d) => ({ key: d.id, id: d.id, title: d.title, state: "idle" })));
  if (adds.length === 0 && dones.length === 0) return null;

  const add = async (row: Row) => {
    setAdds((all) => all.map((r) => (r.key === row.key ? { ...r, state: "busy" } : r)));
    const out = await addTask(row.title, "priority", { source: "journal" });
    setAdds((all) => all.map((r) => (r.key === row.key ? { ...r, state: out.ok ? "done" : "failed", why: out.ok ? undefined : out.error } : r)));
  };

  const finish = async (row: Row & { id: string }) => {
    setDones((all) => all.map((r) => (r.key === row.key ? { ...r, state: "busy" } : r)));
    const list = await readList();
    const task = list && list.on ? list.open.find((x) => x.id === row.id) : undefined;
    const out = task ? await markDone(task) : { ok: false as const, status: 404, error: t({ message: "That task is no longer open on your list.", context: "journal guide tasks" }) };
    setDones((all) => all.map((r) => (r.key === row.key ? { ...r, state: out.ok ? "done" : "failed", why: out.ok ? undefined : out.error } : r)));
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3" data-testid="guide-tasks">
      <p className="text-xs font-semibold text-foreground">
        {t({ message: `${guideName} noticed, for your list`, context: "journal guide tasks heading" })}
      </p>
      <ul className="mt-2 space-y-2">
        {adds.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 text-foreground">{r.title}</span>
            {r.state === "done" ? (
              <span className="inline-flex items-center gap-1 text-open"><Check className="h-4 w-4" aria-hidden="true" />{t({ message: "On your list", context: "journal guide tasks: added" })}</span>
            ) : (
              <button type="button" className={BTN_SECONDARY} disabled={r.state === "busy"} onClick={() => void add(r)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t({ message: "Add to my list", context: "journal guide tasks: adds a suggested task" })}
              </button>
            )}
            {r.state === "failed" && r.why && <p role="alert" className="w-full text-xs text-destructive">{r.why}</p>}
          </li>
        ))}
        {dones.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 text-foreground">
              {t({ message: `Sounds finished: ${r.title}`, context: "journal guide tasks: a task the guide thinks is done" })}
            </span>
            {r.state === "done" ? (
              <span className="inline-flex items-center gap-1 text-open"><Check className="h-4 w-4" aria-hidden="true" />{t({ message: "Marked done", context: "journal guide tasks: done" })}</span>
            ) : (
              <button type="button" className={BTN_SECONDARY} disabled={r.state === "busy"} onClick={() => void finish(r)}>
                <Check className="h-4 w-4" aria-hidden="true" />
                {t({ message: "Mark done", context: "journal guide tasks: marks a task done" })}
              </button>
            )}
            {r.state === "failed" && r.why && <p role="alert" className="w-full text-xs text-destructive">{r.why}</p>}
          </li>
        ))}
      </ul>
      <p className={`${HINT} mt-2`}>{t({ message: "Nothing changes until you tap.", context: "journal guide tasks hint" })}</p>
    </div>
  );
}
