/**
 * One of the outside service's differences as a row on /review: a card on the
 * phone, a compact row beside the detail pane from 1280 px, and the pane
 * itself (the approved "Waiting for you" and "1280 px" boards).
 *
 * Each row carries its tick, its sentence, where it came from, its flags in
 * words (never a colour alone, R39), and what it offers (SeraActs.tsx). The
 * new roles the service puts in a new circle are drawn under that circle, and
 * go with it (R31): they carry no tick and no button of their own. Every row
 * is marked `data-sera-row` for the keyboard (SeraKeys.tsx).
 */
import { Trans } from "@lingui/react/macro";
import type { Door } from "@shared/seraDecides";
import { CompareBlocks } from "@/components/review/SeraCompare";
import { ConflictSubtitle, DecisionNote, EditPanel, RowActions, RowTick, SetAsideChip } from "@/components/review/SeraActs";
import type { SeraActs } from "@/components/review/useSeraActs";
import { comparable, type ListedDifference } from "@/lib/seraReview";
import { card, chip, inlineLink } from "@/components/review/seraStyles";

export interface Ctx {
  agent: string;
  /** Who holds the power to set pay, from the count, or null when it could not be said. */
  pay: Door | null;
  acts: SeraActs;
  onCompare: (d: ListedDifference) => void;
}

/** Flags in words, then the conflict, each its own chip and never a colour alone (R39). */
export function Chips({ d, small, inline }: { d: ListedDifference; small?: boolean; inline?: boolean }) {
  const Tag = inline ? "span" : "p";
  const size = small ? "px-2 py-0.5 text-xs" : "px-2 py-1 text-[13px]";
  if (d.words.flags.length === 0 && d.state !== "conflict") return null;
  return (
    <>
      {d.words.flags.map((f, i) => (
        <Tag key={i} className={`${chip} ${size}`}>{f}</Tag>
      ))}
      {d.state === "conflict" && <Tag className={`${chip} ${size}`}><Trans context="sera changes">Conflict</Trans></Tag>}
    </>
  );
}

/** "Edited in Sera 29 Oct · Open in Sera", the link built by the server from the configured address (R10). */
export function Source({ d }: { d: ListedDifference }) {
  return (
    <>
      {d.words.source}
      {d.words.open && (
        <>
          {" · "}
          <a href={d.words.open} target="_blank" rel="noopener noreferrer" className={inlineLink}>
            {d.words.openWords}
          </a>
        </>
      )}
    </>
  );
}

/** What comes with a new circle: its roles, one sentence for each count. */
function NestedWords({ n }: { n: number }) {
  return n === 1 ? (
    <Trans>Its role comes with it, and leaving the circle out leaves it out too.</Trans>
  ) : (
    <Trans>Its {n} roles come with it, and leaving the circle out leaves them out too.</Trans>
  );
}

/** One row on the phone: tick, sentence, where it came from, its flags, and what it offers. */
export function RowCard({ ctx, d, nested }: { ctx: Ctx; d: ListedDifference; nested: ListedDifference[] }) {
  return (
    <article data-sera-row={d.key} tabIndex={-1} className={`${card} pt-3 pr-3 pb-3 pl-1 flex gap-1 focus-visible:outline-2 focus-visible:outline-teal-deep`}>
      {d.kind === "pay" ? <span className="min-w-[44px] shrink-0" /> : <RowTick d={d} acts={ctx.acts} />}
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        <p className="text-[15px] leading-snug font-medium text-foreground [overflow-wrap:anywhere]">{d.words.sentence}</p>
        <p className="text-[13px] text-muted-foreground">
          <Source d={d} />
        </p>
        <Chips d={d} />
        <SetAsideChip d={d} />
        <DecisionNote d={d} />
        <RowActions d={d} acts={ctx.acts} agent={ctx.agent} pay={ctx.pay} layout="card" onCompare={ctx.onCompare} />
        <EditPanel d={d} acts={ctx.acts} agent={ctx.agent} />
        {nested.length > 0 && (
          <div className="mt-2 pl-3 border-l-2 border-border flex flex-col gap-3">
            <p className="text-[13px] text-muted-foreground"><NestedWords n={nested.length} /></p>
            {nested.map((n) => (
              <div key={n.key} className="flex flex-col gap-1">
                <p className="text-sm leading-snug font-medium text-foreground">{n.words.sentence}</p>
                <p className="text-[13px] text-muted-foreground">
                  <Source d={n} />
                </p>
                <Chips d={n} small />
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

/** One row at 1280 px: its tick, then the sentence and its chips, and pressing it shows it in the pane. */
export function CompactRow({ ctx, d, selected, onSelect, inset }: { ctx: Ctx; d: ListedDifference; selected: boolean; onSelect: () => void; inset?: boolean }) {
  return (
    <article
      data-sera-row={d.key}
      tabIndex={-1}
      onFocus={(e) => e.target === e.currentTarget && onSelect()}
      className={`bg-card rounded-[10px] flex ${selected ? "border-2 border-teal-deep" : "border border-border"}${inset ? " ml-6" : ""} focus-visible:outline-2 focus-visible:outline-teal-deep`}
    >
      {inset || d.kind === "pay" ? <span className="w-8 shrink-0" /> : <RowTick d={d} acts={ctx.acts} compact />}
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-controls="sera-pane"
        onClick={onSelect}
        className={`flex-1 min-w-0 text-left min-h-[44px] flex flex-col gap-1 rounded-[10px] ${selected ? "p-[11px] pl-2.5" : "p-3 pl-2.5"}`}
      >
        <span className={`text-sm leading-normal text-foreground [overflow-wrap:anywhere]${selected ? " font-semibold" : ""}`}>{d.words.sentence}</span>
        <Chips d={d} small inline />
      </button>
    </article>
  );
}

/** The detail pane at 1280 px, sticky beside the list, with its action bar along the bottom. */
export function Pane({ ctx, d }: { ctx: Ctx; d: ListedDifference | null }) {
  if (!d) return null;
  const nested = d.kind === "roleAdd" && d.subject.ourId === null && (d.subject.circleId ?? "").startsWith("sera:");
  return (
    <section
      id="sera-pane"
      aria-labelledby="sera-pane-h"
      className={`${card} flex-1 min-w-0 p-5 flex flex-col gap-3.5 sticky top-24 self-start max-h-[calc(100vh-7rem)] overflow-y-auto`}
    >
      <h3 id="sera-pane-h" className="text-lg leading-snug font-bold text-foreground [overflow-wrap:anywhere]">
        {d.words.sentence.replace(/\.$/, "")}
      </h3>
      <ConflictSubtitle d={d} />
      <p className="text-sm text-muted-foreground">
        <Source d={d} />
      </p>
      {(d.words.flags.length > 0 || d.state === "conflict" || d.setAside) && (
        <div className="flex flex-col gap-1.5">
          <Chips d={d} />
          <SetAsideChip d={d} />
        </div>
      )}
      <DecisionNote d={d} />
      {comparable(d) && <CompareBlocks key={d.key} d={d} agent={ctx.agent} layout="columns" />}
      <EditPanel d={d} acts={ctx.acts} agent={ctx.agent} />
      <div className="mt-2">
        {nested ? (
          <p className="text-[13px] text-muted-foreground"><Trans>This role comes with its new circle. Add the circle, and it comes with it.</Trans></p>
        ) : (
          <RowActions d={d} acts={ctx.acts} agent={ctx.agent} pay={ctx.pay} layout="pane" />
        )}
      </div>
    </section>
  );
}
