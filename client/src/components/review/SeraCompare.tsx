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
 * What a person can do from here, take, keep or edit, is handed in by the
 * caller (components/review/SeraActs.tsx), under the two versions.
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
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
              <span className="sr-only"><Trans context="sera compare">removed:</Trans>{" "}</span>
              <del className="text-destructive line-through">{p.text}</del>
            </>
          ) : p.side === "sera" ? (
            <>
              <span className="sr-only"><Trans context="sera compare">added:</Trans>{" "}</span>
              <ins className="text-open underline decoration-2 underline-offset-2">{p.text}</ins>
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
  const { t } = useLingui();
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
  // `owner` is the service's name already in the possessive, "Sera's".
  const owner = possessive(agent);
  const theirsTitle = t({ message: `${owner} version`, context: "sera compare" });
  const hereText = stored ? stored : <span className="text-muted-foreground"><Trans context="sera compare">Nothing here yet.</Trans></span>;
  const legend = (
    <p className="text-[13px] leading-snug text-muted-foreground">
      <Trans>Struck words are only here. Underlined words are only in {theirsTitle}.</Trans>
    </p>
  );
  const toggle = overflows && (
    <button
      type="button"
      aria-expanded={full}
      onClick={() => setFull((f) => !f)}
      className="self-start min-h-[44px] text-sm font-semibold text-notice underline hover:text-foreground"
    >
      {full ? t({ message: "Show less", context: "sera compare" }) : t({ message: "Read both in full", context: "sera compare" })}
    </button>
  );

  if (layout === "columns") {
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5 min-w-0">
            <h4 className="text-sm font-bold text-foreground"><Trans context="sera compare">Here now</Trans></h4>
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
        <h3 id={`${id}-here`} className="text-[15px] font-bold text-foreground"><Trans context="sera compare">Here now</Trans></h3>
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
  subtitle,
}: {
  d: ListedDifference;
  agent: string;
  backWords: string;
  onBack: () => void;
  source: ReactNode;
  chips: ReactNode;
  action: ReactNode;
  /** A conflict's "Someone here rewrote it on 1 Nov. Choose one, or write your own." */
  subtitle?: ReactNode;
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
        className="self-start inline-flex items-center min-h-[44px] text-sm text-notice underline hover:text-foreground"
      >
        {backWords}
      </button>
      <h2 ref={heading} tabIndex={-1} className="text-xl leading-snug font-bold text-foreground focus:outline-none [overflow-wrap:anywhere]">
        {d.words.sentence}
      </h2>
      {subtitle}
      <p className="text-sm leading-normal text-muted-foreground">{source}</p>
      {chips}
      <CompareBlocks d={d} agent={agent} layout="stacked" />
      {action}
    </div>
  );
}
