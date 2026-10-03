/**
 * HISTORY: every entry, newest first, grouped by the reader's own day.
 * Entries still waiting on this device sit among the rest with a badge, so a
 * page written offline is never missing from the member's own view of it.
 * Export downloads the whole journal, or only the debriefs, as markdown.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { JournalEntry, JournalPractice } from "@shared/journal";
import { downloadExport, listEntries, problemText } from "@/lib/journalApi";
import BreathingLoader from "@/components/natural/BreathingLoader";
import EntryCard, { type HistoryItem } from "./EntryCard";
import { usePendingEntries } from "./hooks";
import { BTN_SECONDARY, HINT, dayKey, dayLabel } from "./ui";

const PAGE = 30;

export default function HistoryTab({ owner, refreshKey = 0 }: { owner: string; refreshKey?: number }) {
  const pending = usePendingEntries(owner);
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"all" | JournalPractice | null>(null);
  /**
   * Which read of the first page is current. A refresh (a finished sync, or
   * the parent's key) replaces the list with page 1, so anything still in
   * flight from before it describes a list that no longer exists: an older
   * first page must not overwrite a newer one, and an older page fetched
   * from page 2's cursor must not be appended to a fresh page 1, which left
   * page 2's entries silently missing between them.
   */
  const gen = useRef(0);

  const load = useCallback(async () => {
    const mine = ++gen.current;
    setProblem(null);
    try {
      const page = await listEntries({ limit: PAGE });
      if (mine !== gen.current) return;
      // Applying a fresh first page retires any "Show older" read already in
      // flight: its page was cut from the list this one replaces, and
      // appending it would leave a silent gap.
      gen.current += 1;
      setEntries(page);
      setMore(page.length >= PAGE);
    } catch (err) {
      if (mine !== gen.current) return;
      setEntries((was) => was ?? []);
      setProblem(problemText(err, "Your journal could not be read just now. Anything saved on this device is still shown."));
    }
  }, []);

  // A finished sync changes what the server holds, so the list re-reads then too.
  const pendingCount = pending.length;
  useEffect(() => {
    void load();
  }, [load, refreshKey, pendingCount]);

  // Nothing that lands after the tab has gone may write to it.
  useEffect(
    () => () => {
      gen.current += 1;
    },
    [],
  );

  const loadOlder = async () => {
    const oldest = entries?.[entries.length - 1];
    if (!oldest) return;
    const at = gen.current;
    setLoadingMore(true);
    try {
      // The cursor carries the id too, so two entries written in the same
      // instant on a page boundary are both read.
      const page = await listEntries({ limit: PAGE, before: `${oldest.writtenAt}|${oldest.id}` });
      if (at !== gen.current) return;
      setEntries((was) => {
        const seen = new Set((was ?? []).map((e) => e.id));
        return [...(was ?? []), ...page.filter((e) => !seen.has(e.id))];
      });
      setMore(page.length >= PAGE);
    } catch (err) {
      if (at !== gen.current) return;
      setProblem(problemText(err, "Older entries could not be read just now."));
    } finally {
      setLoadingMore(false);
    }
  };

  const exportAs = async (practice?: JournalPractice) => {
    setExporting(practice ?? "all");
    setProblem(null);
    try {
      await downloadExport(practice);
    } catch (err) {
      setProblem(problemText(err, "The export could not be made just now."));
    } finally {
      setExporting(null);
    }
  };

  const groups = useMemo(() => {
    const synced = new Set((entries ?? []).map((e) => e.clientId));
    const items: HistoryItem[] = [
      ...pending
        .filter((p) => !synced.has(p.entry.clientId))
        .map((p): HistoryItem => ({ kind: "pending", entry: p.entry, lastError: p.lastError })),
      ...(entries ?? []).map((e): HistoryItem => ({ kind: "synced", entry: e })),
    ];
    items.sort((a, b) => (a.entry.writtenAt < b.entry.writtenAt ? 1 : a.entry.writtenAt > b.entry.writtenAt ? -1 : 0));
    const out: { key: string; label: string; items: HistoryItem[] }[] = [];
    for (const it of items) {
      const key = dayKey(it.entry.writtenAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(it);
      else out.push({ key, label: dayLabel(it.entry.writtenAt), items: [it] });
    }
    return out;
  }, [entries, pending]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_SECONDARY} onClick={() => void exportAs()} disabled={exporting !== null}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {exporting === "all" ? "Preparing..." : "Export as Markdown"}
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={() => void exportAs("debrief")} disabled={exporting !== null}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {exporting === "debrief" ? "Preparing..." : "Debriefs only"}
        </button>
      </div>

      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}

      {entries === null && pending.length === 0 ? (
        <div className="flex justify-center py-10">
          <BreathingLoader label="Reading your journal" />
        </div>
      ) : groups.length === 0 ? (
        <p className={HINT}>Nothing here yet. What you save from Today appears here, newest first.</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h2>
            <ul className="space-y-3">
              {g.items.map((it) => (
                <EntryCard
                  key={`${it.kind}-${it.entry.clientId}`}
                  item={it}
                  onChanged={(next) => setEntries((was) => (was ?? []).map((e) => (e.id === next.id ? next : e)))}
                  onDeleted={(id) => setEntries((was) => (was ?? []).filter((e) => e.id !== id))}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {more && (
        <button type="button" className={BTN_SECONDARY} onClick={() => void loadOlder()} disabled={loadingMore}>
          {loadingMore ? "Reading..." : "Show older entries"}
        </button>
      )}
    </div>
  );
}
