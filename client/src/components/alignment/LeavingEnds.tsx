/**
 * WHICH TERMS LEAVING ENDS (seat settings PR8, spec section 5).
 *
 * Leaving the village is never blocked by aligned terms. It ends them: the
 * erasure sweep records a `party_left` ending on every text the member is a
 * party to that has not ended (server/lib/alignmentEndings.ts). The exit flow
 * tells the member which ones, before they confirm and again after, from the
 * member's own list (`GET /api/profile/alignments`). A member with none sees
 * nothing here.
 */
import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { ENDINGS_WORDS } from "@shared/alignments";
import { fetchMyAlignments } from "./alignmentsApi";

/** The titles of the member's terms that have not ended, once read; null until then or when the read fails. */
export function useTermsLeavingEnds(enabled: boolean): string[] | null {
  const [titles, setTitles] = useState<string[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fetchMyAlignments().then((a) => {
      if (!alive || !a.ok) return;
      const rows = Array.isArray(a.data?.alignments) ? a.data.alignments : [];
      setTitles(rows.filter((r) => r.state !== "ended").map((r) => r.title));
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return titles;
}

/** The sentence after leaving: which terms ended. Empty when none did. */
export function leftEndedWords(titles: readonly string[] | null): string {
  return titles && titles.length > 0 ? `${ENDINGS_WORDS.leftEnded} ${titles.join("; ")}.` : "";
}

/** The list before leaving, or nothing when the member holds no terms. */
export default function LeavingEnds({ titles }: { titles: readonly string[] | null }) {
  if (!titles || titles.length === 0) return null;
  return (
    <div data-leaving-ends="" className="mt-3 rounded-lg border border-border bg-background/60 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <ScrollText className="size-3.5 text-notice" aria-hidden="true" />
        {ENDINGS_WORDS.leavingEnds}
      </p>
      <ul className="mt-1 list-disc pl-5 text-xs text-foreground">
        {titles.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">{ENDINGS_WORDS.leavingNeverWaits}</p>
    </div>
  );
}
