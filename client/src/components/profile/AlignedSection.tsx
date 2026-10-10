/**
 * THE `aligned` SECTION OF A PROFILE: "What you have aligned with" (seat settings PR5).
 *
 * A record-band section, after `journey` (sheetSections.ts). Its own file
 * because Profile.tsx sits under the monolith ratchet's eye.
 *
 * On your own profile: every text you are a party to, waiting ones first,
 * then in force, then ended. A waiting one carries its Align button; every one
 * carries its receipt.
 *
 * On another member's profile: the same list from
 * `GET /api/alignments?party=<handle>`, for a reader holding `terms.read`,
 * with no hash and no salt. Anybody else is answered 401 and this renders
 * nothing at all: an absent record says nothing, not "they have none".
 *
 * BACK FROM GOOGLE. A member with no password confirms with Google before
 * aligning with money terms, and Google returns them HERE
 * (`CONFIRM_HOME.align`). The confirmation panel mounts at the top, spends the
 * cookie, and the row's Align button then aligns in one click.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ScrollText } from "lucide-react";
import { ALIGN_WORDS, type AlignmentState } from "@shared/alignments";
import AlignmentCard from "@/components/alignment/AlignmentCard";
import { ReconfirmPanel } from "@/components/alignment/AlignButton";
import { fetchMyAlignments, fetchTheirAlignments, type ServedAlignment } from "@/components/alignment/alignmentsApi";

export const ALIGNED_SECTION_WORDS = {
  heading: ALIGN_WORDS.sectionHeading,
  theirs: ALIGN_WORDS.theirHeading,
  empty: "Nothing yet. When you apply for seats, the terms you align with are kept here.",
  readWords: "Read the application",
  confirmed: ALIGN_WORDS.reconfirmed,
} as const;

const ORDER: Record<AlignmentState, number> = { pending: 0, "in-force": 1, ended: 2 };

/** Waiting on you first, then the rest waiting, then in force, then ended; newest first inside each. */
export function sortForSheet(rows: readonly ServedAlignment[]): ServedAlignment[] {
  const onYou = (r: ServedAlignment) => (r.you?.mayAlign ? 0 : 1);
  return [...rows].sort((a, b) => onYou(a) - onYou(b) || ORDER[a.state] - ORDER[b.state] || String(b.createdAt).localeCompare(String(a.createdAt)));
}

function Rows({ rows, onChanged }: { rows: ServedAlignment[]; onChanged?: () => void }) {
  return (
    <ul className="mt-4 space-y-4">
      {sortForSheet(rows).map((r) => (
        <li key={r.textId ?? r.title}>
          <AlignmentCard alignment={r} headingLevel={3} showWords={false} onChanged={onChanged} />
          {r.href && (
            <Link
              href={r.href}
              className="mt-1 inline-flex min-h-11 items-center px-1 text-sm font-medium text-notice underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            >
              {ALIGNED_SECTION_WORDS.readWords}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

function Own() {
  const [rows, setRows] = useState<ServedAlignment[] | null>(null);
  const [backFromGoogle] = useState(() => {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search);
    return q.get("google_confirm") === "align" || (q.get("google_confirm") === "error" && q.get("for") === "align");
  });
  const [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async () => {
    const a = await fetchMyAlignments();
    if (a.ok) setRows(Array.isArray(a.data?.alignments) ? a.data.alignments : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!rows) return null;
  return (
    <section aria-labelledby="sheet-aligned-h" data-sheet-section="aligned" className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 id="sheet-aligned-h" className="flex items-center gap-2 font-display text-2xl font-bold text-card-foreground">
        <ScrollText className="size-5 text-notice" aria-hidden="true" />
        {ALIGNED_SECTION_WORDS.heading}
      </h2>
      {backFromGoogle && !confirmed && <ReconfirmPanel onConfirmed={() => setConfirmed(true)} />}
      {confirmed && (
        <p role="status" className="mt-2 text-sm text-foreground">
          {ALIGNED_SECTION_WORDS.confirmed}
        </p>
      )}
      {rows.length === 0 ? <p className="mt-2 text-muted-foreground">{ALIGNED_SECTION_WORDS.empty}</p> : <Rows rows={rows} onChanged={() => void load()} />}
    </section>
  );
}

function Theirs({ handle }: { handle: string }) {
  const [rows, setRows] = useState<ServedAlignment[] | null>(null);
  useEffect(() => {
    let alive = true;
    setRows(null);
    void fetchTheirAlignments(handle).then((a) => {
      // Only a member's answer draws. A 401 is nothing to say.
      if (alive && a.ok) setRows(Array.isArray(a.data?.alignments) ? a.data.alignments : []);
    });
    return () => {
      alive = false;
    };
  }, [handle]);
  if (!rows || rows.length === 0) return null;
  return (
    <section aria-labelledby="sheet-aligned-theirs-h" data-sheet-section="aligned">
      <h2 id="sheet-aligned-theirs-h" className="font-display text-2xl font-bold text-foreground">
        {ALIGNED_SECTION_WORDS.theirs}
      </h2>
      <Rows rows={rows} />
    </section>
  );
}

/** `handle` names another member; without it, the section is the reader's own. */
export default function AlignedSection({ handle }: { handle?: string | null }) {
  return handle ? <Theirs handle={handle} /> : <Own />;
}
