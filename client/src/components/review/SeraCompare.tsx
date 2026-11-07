/**
 * One difference's two versions, ours and the outside service's, for /review
 * (spec R33, the approved "A conflict, stacked" and "1280 px" boards).
 *
 * Under 1280 px the two are STACKED, "Here now" then the service's version,
 * and the service's version carries ONE merged diff: words only here are
 * struck, words only there are underlined, and a sentence under it says so,
 * so the difference is never told by colour alone. Both are clamped to four
 * lines until "Read both in full". From 1280 px they sit in true columns in the
 * detail pane.
 *
 * Read-only in this release: taking, keeping and editing arrive with the
 * actions, so the only way on from here is the link the caller hands in.
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { mergedDiff, possessive, type ListedDifference } from "@/lib/seraReview";

/** Above this many characters a block is taken to run past four lines where nothing can be measured. */
const CLAMP_CHARS = 200;

export function DiffText({ here, sera }: { here: string; sera: string }) {
  const parts = mergedDiff(here, sera);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " "}
          {p.side === "here" ? (
            <>
              <span className="sr-only">removed: </span>
              <del className="text-coral line-through">{p.text}</del>
            </>
          ) : p.side === "sera" ? (
            <>
              <span className="sr-only">added: </span>
              <ins className="text-sage underline decoration-2 underline-offset-2">{p.text}</ins>
            </>
          ) : (
            p.text
          )}
        </span>
      ))}
    </>
  );
}

interface Props {
  d: ListedDifference;
  agent: string;
  /** Stacked under 1280 px, side by side from it. */
  layout: "stacked" | "columns";
}

export function CompareBlocks({ d, agent, layout }: Props) {
  // The diff compares the compared form (the engine's, a name swapped out the same on both sides), so a
  // swapped name is never struck (review K5); Here now shows our words as stored.
  const ours = d.ours ?? "";
  const stored = d.oursAsStored ?? ours;
  const theirs = d.sera ?? "";
  const [full, setFull] = useState(false);
  const id = useId();
  const hereRef = useRef<HTMLParagraphElement>(null);
  const seraRef = useRef<HTMLParagraphElement>(null);
  // Where layout is measured, the blocks say whether they run past four lines.
  // Where it is not (a test's DOM), the length stands in for it.
  const [overflows, setOverflows] = useState(() => ours.length > CLAMP_CHARS || theirs.length > CLAMP_CHARS);
  useLayoutEffect(() => {
    if (full) return;
    const els = [hereRef.current, seraRef.current].filter((e): e is HTMLParagraphElement => e !== null);
    if (els.some((e) => e.clientHeight > 0)) setOverflows(els.some((e) => e.scrollHeight > e.clientHeight + 1));
  }, [ours, theirs, full, layout]);

  const clamp = full ? "" : " line-clamp-4";
  const theirsTitle = `${possessive(agent)} version`;
  const hereText = stored ? stored : <span className="text-muted-foreground">Nothing here yet.</span>;
  const legend = (
    <p className="text-[13px] leading-snug text-muted-foreground">
      Struck words are only here. Underlined words are only in {theirsTitle}.
    </p>
  );
  const toggle = overflows && (
    <button
      type="button"
      aria-expanded={full}
      onClick={() => setFull((f) => !f)}
      className="self-start min-h-[44px] text-sm font-semibold text-teal-deep underline hover:text-teal-deep-dark"
    >
      {full ? "Show less" : "Read both in full"}
    </button>
  );

  if (layout === "columns") {
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5 min-w-0">
            <h4 className="text-sm font-bold text-foreground">Here now</h4>
            <p ref={hereRef} className={`text-[15px] leading-relaxed text-foreground [overflow-wrap:anywhere]${clamp}`}>{hereText}</p>
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <h4 className="text-sm font-bold text-foreground">{theirsTitle}</h4>
            <p ref={seraRef} className={`text-[15px] leading-relaxed text-foreground [overflow-wrap:anywhere]${clamp}`}>
              <DiffText here={ours} sera={theirs} />
            </p>
          </div>
        </div>
        {legend}
        {toggle}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby={`${id}-here`} className="bg-card border border-border rounded-xl p-3.5 flex flex-col gap-2">
        <h3 id={`${id}-here`} className="text-[15px] font-bold text-foreground">Here now</h3>
        <p ref={hereRef} className={`text-[15px] leading-normal text-foreground [overflow-wrap:anywhere]${clamp}`}>{hereText}</p>
      </section>
      <section aria-labelledby={`${id}-sera`} className="bg-card border border-border rounded-xl p-3.5 flex flex-col gap-2">
        <h3 id={`${id}-sera`} className="text-[15px] font-bold text-foreground">{theirsTitle}</h3>
        <p ref={seraRef} className={`text-[15px] leading-normal text-foreground [overflow-wrap:anywhere]${clamp}`}>
          <DiffText here={ours} sera={theirs} />
        </p>
        {legend}
        {toggle}
      </section>
    </div>
  );
}

/** The phone's compare view: back to the list, the sentence, both versions stacked, and the way on. */
export default function SeraCompare({
  d,
  agent,
  backWords,
  onBack,
  source,
  chips,
  action,
}: {
  d: ListedDifference;
  agent: string;
  backWords: string;
  onBack: () => void;
  source: ReactNode;
  chips: ReactNode;
  action: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    heading.current?.focus();
  }, [d.key]);
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start inline-flex items-center min-h-[44px] text-sm text-teal-deep underline hover:text-teal-deep-dark"
      >
        {backWords}
      </button>
      <h2 ref={heading} tabIndex={-1} className="text-xl leading-snug font-bold text-foreground focus:outline-none [overflow-wrap:anywhere]">
        {d.words.sentence}
      </h2>
      <p className="text-sm leading-normal text-muted-foreground">{source}</p>
      {chips}
      <CompareBlocks d={d} agent={agent} layout="stacked" />
      {action}
    </div>
  );
}
