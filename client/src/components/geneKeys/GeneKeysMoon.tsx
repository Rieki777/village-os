/**
 * THIS MOON'S CONTEMPLATION, and the ladder it builds (moon.ts has the rules).
 *
 * Maia offers it once a moon: in the Journal's Today tab and on the member's
 * own Gene Keys card. It draws nothing while Gene Keys or the Journal is off,
 * or before the member has lines. Once this moon's is written it says so and
 * shows the ladder instead of asking again.
 */
import { useEffect, useState } from "react";
import { GENE_KEYS_SITE } from "@shared/geneKeys";
import type { JournalEntry } from "@shared/journal";
import { useModuleOn } from "@/modules/ModuleProvider";
import { listEntries } from "@/lib/journalApi";
import { newClientId, saveEntry } from "@/lib/journalOutbox";
import { useGuideName } from "@/hooks/useGuideName";
import { useMyGeneKeys } from "./useMyGeneKeys";
import {
  FREQUENCIES, FREQUENCY_PROMPT, contemplationEntry, ladderFrom, moonLabel, moonNow, promptFor, type Frequency, type Rung,
} from "./moon";
import { BTN_GOLD, BTN_LINK, EYEBROW, HINT, INPUT, NIGHT_CARD } from "./ui";

const ROW: Record<Frequency, number> = { siddhi: 0, gift: 1, shadow: 2 };

/** Three rungs, one column per moon, the member's mark on each. */
export function MoonLadder({ rungs }: { rungs: readonly Rung[] }) {
  if (!rungs.length) return null;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className={EYEBROW}>Your ladder this season</figcaption>
      <div className="flex gap-3">
        <div aria-hidden="true" className="flex flex-col justify-between py-0.5 text-xs text-muted-foreground">
          <span>Siddhi</span>
          <span>Gift</span>
          <span>Shadow</span>
        </div>
        <ol className="flex flex-1 items-stretch gap-1.5 overflow-x-auto">
          {rungs.map((r) => (
            <li key={r.cycle} className="flex min-w-7 flex-col items-center gap-1">
              <span className="sr-only">
                Moon of {moonLabel(r.cycle)}: {FREQUENCIES.find((f) => f.id === r.frequency)?.label}
              </span>
              <span aria-hidden="true" className="flex h-16 flex-col justify-between">
                {[0, 1, 2].map((row) => (
                  <span key={row} className={`block h-3 w-3 rounded-full ${row === ROW[r.frequency] ? "bg-notice" : "bg-muted-foreground/25"}`} />
                ))}
              </span>
              <span aria-hidden="true" className="text-[10px] leading-none text-muted-foreground">
                {moonLabel(r.cycle)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}

/**
 * `owner`: the signed-in member's id, which keys their Journal outbox (both hosts already hold it).
 * `bare`: drawn inside another card (the profile's), as a section under a rule rather than a card of its own.
 */
export default function GeneKeysMoon({ owner, bare = false, className = "" }: { owner: string | null | undefined; bare?: boolean; className?: string }) {
  const journalOn = useModuleOn("journal");
  const { on, mine } = useMyGeneKeys();
  // The village's own name for its guide (shared/guideName.ts), never a borrowed one.
  const guide = useGuideName();
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [text, setText] = useState("");
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const ready = on && journalOn && !!mine && !!owner;

  useEffect(() => {
    if (!ready) return;
    let live = true;
    listEntries({ practice: "free", limit: 50 })
      .then((e) => live && setEntries(e))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [ready]);

  if (!ready || !mine || entries === null) return null;
  const cycle = moonNow();
  const rungs = ladderFrom(entries);
  const done = rungs.find((r) => r.cycle === cycle);

  const save = async () => {
    if (!frequency || !text.trim() || !owner) return;
    setBusy(true);
    const entry = contemplationEntry(mine, { clientId: newClientId(), cycle, text, frequency });
    const result = await saveEntry(owner, entry);
    setBusy(false);
    if (result.outcome === "refused" || result.outcome === "failed") {
      setSaid(result.why ?? "It did not save. Your words are still here, so try again.");
      return;
    }
    // The page reads as written at once; the outbox carries it if the connection is slow.
    setEntries((e) => [
      { id: entry.clientId, ...entry, scores: null, localHour: entry.localHour ?? null, privacy: "private", meta: null, reflection: null, confirmed: false, createdAt: entry.writtenAt, updatedAt: entry.writtenAt },
      ...(e ?? []),
    ] as JournalEntry[]);
    setSaid("Kept in your Journal, private to you.");
  };

  return (
    <section aria-labelledby="gk-moon-h" className={`${bare ? "border-t border-border pt-4" : NIGHT_CARD} ${className}`}>
      <p className={EYEBROW}>From {guide.name} · this moon</p>
      <h2 id="gk-moon-h" className={`font-display text-card-foreground ${bare ? "text-xl" : "text-2xl"}`}>
        {done ? "This moon's contemplation is written" : "A contemplation for this moon"}
      </h2>
      {done ? (
        <p className="mt-1 text-sm text-foreground">
          You met your Life's Work key from its {FREQUENCIES.find((f) => f.id === done.frequency)?.label.toLowerCase()} this moon. The next one opens at the new moon.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm text-foreground">
            {promptFor(mine)}
            <textarea className={`${INPUT} min-h-24 py-2`} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm text-foreground">{FREQUENCY_PROMPT}</legend>
            <div className="flex flex-wrap gap-2">
              {FREQUENCIES.map((f) => (
                <label
                  key={f.id}
                  className={`inline-flex min-h-11 cursor-pointer flex-col justify-center rounded-xl border px-4 py-1 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-notice ${
                    frequency === f.id ? "border-notice bg-notice/15 text-notice" : "border-border text-foreground"
                  }`}
                >
                  <input type="radio" name="gk-frequency" className="sr-only" checked={frequency === f.id} onChange={() => setFrequency(f.id)} />
                  <span className="font-medium">{f.label}</span>
                  <span className="text-xs text-muted-foreground">{f.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_GOLD} disabled={busy || !frequency || !text.trim()} onClick={save}>
              {busy ? "Keeping it" : "Keep it in my Journal"}
            </button>
            <a className={BTN_LINK} href={GENE_KEYS_SITE} target="_blank" rel="noopener noreferrer">
              Read this key on genekeys.com
            </a>
          </div>
        </div>
      )}
      {said ? (
        <p role="status" className={`${HINT} mt-2`}>
          {said}
        </p>
      ) : null}
      <div className="mt-4">
        <MoonLadder rungs={rungs} />
      </div>
    </section>
  );
}
