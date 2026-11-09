/**
 * What a reader of the outside service's differences does on /review: tick,
 * take, keep, edit and undo, and the strip that says what happened (spec R13
 * to R16, R30, R31).
 *
 * Every act sends the difference's key and both hashes as the person saw them
 * (R14), and the page reads again after each one, so a refusal's new
 * difference is the one on screen. The outcome stays in ONE `role="status"`
 * strip with its Undo until the next act: no toasts (R30).
 */
import { useCallback, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { bulkPlan } from "@shared/seraSettle";
import type { ListedDifference } from "@/lib/seraReview";
import { answerDifferences, errorWords, itemOf, undoAnswers, type AnswerAct } from "@/lib/seraAnswer";

export interface Strip {
  words: string;
  /** What Undo takes back, or null when there is nothing to undo. */
  undo: string[] | null;
  /** Each thing a bulk act did not take, and why, in words (R31). */
  leftOut: string[];
}

export interface Editing {
  key: string;
  from: "sera" | "ours";
  value: string;
}

export interface Sheet {
  kind: "take" | "keep";
  keys: string[];
}

type Done = { key: string; with?: string[]; setAside?: boolean };
type Refused = { key: string; why: string; words: string };

/** A difference a person may write their own words for: a role's name or its words. */
export const editable = (d: ListedDifference): boolean => (d.kind === "textField" && d.field === "aim") || (d.kind === "rename" && d.subject.kind === "role");

export function useSeraActs(differences: readonly ListedDifference[], reload: () => Promise<void>) {
  const { t } = useLingui();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [strip, setStrip] = useState<Strip | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  /** The key last acted on, so the list can move focus to the row after it (R32). */
  const [acted, setActed] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(differences.map((d) => [d.key, d])), [differences]);

  const whyWords = useCallback(
    (why: string): string =>
      why === "checkFirst"
        ? t({ message: "Check first", context: "sera answers" })
        : why === "pay"
          ? t({ message: "pay is set by a person", context: "sera answers" })
          : why === "withCircle"
            ? t({ message: "it comes with its circle", context: "sera answers" })
            : t({ message: "it cannot be taken from this list", context: "sera answers" }),
    [t],
  );
  const named = useCallback((key: string, why: string) => `${byKey.get(key)?.subject.name ?? key} (${whyWords(why)})`, [byKey, whyWords]);

  const run = useCallback(
    async (act: AnswerAct, ds: ListedDifference[], value?: string, extraLeftOut: string[] = []) => {
      if (ds.length === 0) return;
      setBusy(true);
      setActed(ds[0].key);
      const r = await answerDifferences(act, ds.map((d) => itemOf(d, value)));
      const done = (Array.isArray(r.body?.done) ? r.body?.done : []) as Done[];
      const refused = (Array.isArray(r.body?.refused) ? r.body?.refused : []) as Refused[];
      await reload();
      setBusy(false);
      setEditing(null);
      setTicked(new Set());
      if (!r.ok) {
        setStrip({ words: errorWords(r) ?? t({ message: "The answer was not written.", context: "sera answers" }), undo: null, leftOut: [] });
        return;
      }
      const n = done.length;
      const undo = done.flatMap((d) => [d.key]);
      const leftOut = [...refused.map((x) => named(x.key, x.why)), ...extraLeftOut];
      let words: string;
      if (act === "keep") {
        const aside = done.filter((d) => d.setAside).length;
        words =
          aside > 0 && aside === n
            ? t({ message: "Set aside. The people who decide these still see it.", context: "sera answers" })
            : n === 1
              ? t({ message: "Kept ours. It stays out of the list until it changes again.", context: "sera answers" })
              : t({ message: `Kept ours for ${n}. They stay out of the list until they change again.`, context: "sera answers" });
      } else {
        words =
          n === 0
            ? t({ message: "Nothing was taken.", context: "sera answers" })
            : n === 1
              ? t({ message: "Added to the draft. It goes live when the draft is published.", context: "sera answers" })
              : t({ message: `Added ${n} to the draft. They go live when the draft is published.`, context: "sera answers" });
      }
      setStrip({ words, undo: n > 0 ? undo : null, leftOut });
    },
    [reload, t, named],
  );

  const undo = useCallback(
    async (keys: string[]) => {
      setBusy(true);
      const r = await undoAnswers(keys);
      await reload();
      setBusy(false);
      const n = Array.isArray(r.body?.undone) ? (r.body?.undone as unknown[]).length : 0;
      setStrip({
        words: r.ok
          ? n === 1
            ? t({ message: "Undone. It waits in the list again.", context: "sera answers" })
            : t({ message: `Undone. ${n} wait in the list again.`, context: "sera answers" })
          : (errorWords(r) ?? t({ message: "Nothing was undone.", context: "sera answers" })),
        undo: null,
        leftOut: [],
      });
    },
    [reload, t],
  );

  const tick = useCallback((key: string, on?: boolean) => {
    setTicked((s) => {
      const next = new Set(s);
      if (on ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  /** The ticked rows, in the list's order. */
  const tickedRows = useMemo(() => differences.filter((d) => ticked.has(d.key)), [differences, ticked]);
  /** What a bulk take of the ticked rows takes, leaves out, and carries away with a circle (R2, R30, R31). */
  const plan = useMemo(() => bulkPlan(tickedRows, differences), [tickedRows, differences]);

  return {
    ticked,
    tickedRows,
    plan,
    strip,
    busy,
    editing,
    sheet,
    acted,
    setActed,
    tick,
    tickAll: (keys: string[]) => setTicked(new Set(keys)),
    /** Put an outcome from elsewhere on the list (the draft card) in the same strip. */
    say: (words: string) => setStrip({ words, undo: null, leftOut: [] }),
    untickAll: () => setTicked(new Set()),
    take: (d: ListedDifference) => run("take", [d]),
    keep: (d: ListedDifference) => run("keep", [d]),
    edit: (d: ListedDifference, value: string) => run("edit", [d], value),
    startEdit: (d: ListedDifference, from: "sera" | "ours") =>
      setEditing({ key: d.key, from, value: (from === "sera" ? d.sera : (d.oursAsStored ?? d.ours)) ?? "" }),
    setValue: (value: string) => setEditing((e) => (e ? { ...e, value } : e)),
    stopEdit: () => setEditing(null),
    openSheet: (kind: Sheet["kind"]) => setSheet({ kind, keys: tickedRows.map((d) => d.key) }),
    closeSheet: () => setSheet(null),
    /** The sheet's confirm: a bulk take of what may be taken together, or a bulk keep. */
    confirmSheet: async () => {
      const s = sheet;
      setSheet(null);
      if (!s) return;
      if (s.kind === "keep") return run("keep", tickedRows);
      const out = plan.leftOut.map((l) => named(l.d.key, l.why));
      return run("take", plan.take, undefined, out);
    },
    undo,
  };
}

export type SeraActs = ReturnType<typeof useSeraActs>;
