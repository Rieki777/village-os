/**
 * What /review carries of the outside service's differences (spec R28, R29,
 * R37, R38): the two reads and what waits on this reader, the summary line and
 * the section at the top, the member's page, and the service's old deliveries
 * folded once the list holds them.
 *
 * Moved out of SeraDifferences.tsx unchanged, so the list itself has room to
 * act (the file-lines ratchet). The old deliveries now also retire on the
 * server after a landing (server/lib/saberraRetire.ts); a delivery that has
 * not retired yet still folds here.
 */
import { Link } from "wouter";
import { Trans } from "@lingui/react/macro";
import { STRUCTURE_KINDS } from "@shared/structurePlan";
import SeraDifferences, { SeraSummaryLine, seraWaiting, useSeraDifferences } from "@/components/review/SeraDifferences";
import { SERA_MODULE } from "@/lib/seraReview";
import { card, secondary } from "@/components/review/seraStyles";

/** When an old arrival came and how much it held, one sentence for each count. */
function ArrivedWords({ at, count }: { at: string; count: number }) {
  return count === 1 ? <Trans>Arrived {at}, with 1 proposal.</Trans> : <Trans>Arrived {at}, with {count} proposals.</Trans>;
}

/**
 * The service's old batch cards, once the list above holds the same records:
 * folded, with no accept, so nothing is offered twice. Retiring them is a
 * later release (spec R28); until then each opens in the structure review.
 */
export function SeraEarlierArrivals({
  agent,
  batches,
  when,
  chartKinds,
}: {
  agent: string;
  batches: ReadonlyArray<{ batchId: string; receivedAt: string | null; items: ReadonlyArray<{ kind: string }> }>;
  when: (iso: string | null) => string;
  chartKinds: readonly string[];
}) {
  if (batches.length === 0) return null;
  return (
    <details className={`${card} p-5`}>
      <summary className="min-h-[44px] flex items-center font-semibold text-foreground cursor-pointer">
        <Trans context="sera changes">Earlier {agent} arrivals, now listed above</Trans>
      </summary>
      <p className="text-sm text-muted-foreground mt-2">
        <Trans>What each of these holds is in the list above, so none of it is offered here a second time.</Trans>
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {batches.map((b) => (
          <li key={b.batchId} className="text-sm text-foreground flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>
              <ArrivedWords at={when(b.receivedAt)} count={b.items.length} />
            </span>
            {b.items.some((i) => chartKinds.includes(i.kind)) && (
              <Link href={`/review/structure/${encodeURIComponent(b.batchId)}`} className={secondary}>
                <Trans context="sera changes">Review it as one structure change</Trans>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── What /review carries of all this ────────────────────────────────────────

/** The kinds that change the chart, as the structure review reads them. */
const CHART_KINDS: readonly string[] = STRUCTURE_KINDS;

/** The two reads, what waits on this reader, and which of the queue's batches fold away, for /review. */
export function useSeraOnReview() {
  const { read, load } = useSeraDifferences();
  // An old arrival folds away unoffered only when EVERY item in it changes the chart and the newest read
  // holds it whole (review S1): a note keeps its Accept, Reject and text box, and an arrival landed after
  // a failed snapshot stays offered. Spec R28 retires them later.
  const held = read.phase === "listed" && read.list.lastReadAt !== null ? new Set(read.list.heldBatches ?? []) : new Set<string>();
  return {
    read,
    load,
    waits: seraWaiting(read),
    folds: (b: { batchId: string; moduleId: string | null; items: ReadonlyArray<{ kind: string }> }) =>
      b.moduleId === SERA_MODULE && held.has(b.batchId) && b.items.length > 0 && b.items.every((i) => CHART_KINDS.includes(i.kind)),
  };
}
export type SeraOnReview = ReturnType<typeof useSeraOnReview>;

type QueueBatch = { batchId: string; moduleId: string | null; receivedAt: string | null; items: ReadonlyArray<{ kind: string }> };

/** The top of /review: the summary line with its jump links, then the section (R37). */
export function SeraTop({
  sera,
  queue,
  witness,
  onReload,
}: {
  sera: SeraOnReview;
  /** The page's whole read, so a sync's moved batches show at once. */
  onReload?: () => Promise<void>;
  queue: { batches?: QueueBatch[]; openDrafts?: unknown[] } | null;
  witness: number;
}) {
  return (
    <>
      <SeraSummaryLine read={sera.read} witness={witness} />
      <SeraDifferences read={sera.read} draftOpen={(queue?.openDrafts ?? []).length > 0} onRetry={sera.load} onReload={onReload} />
    </>
  );
}

/** The page a member the queue refuses is shown: how many changes wait and who decides them (R38). */
export function SeraMemberPage({ sera }: { sera: SeraOnReview }) {
  return (
    <>
      <h1 className="text-2xl font-bold text-foreground"><Trans context="review page">Review</Trans></h1>
      <SeraDifferences read={sera.read} draftOpen={false} onRetry={sera.load} />
    </>
  );
}

/** The service's old batches, folded once the list holds them. */
export function SeraFold({ sera, batches, when }: { sera: SeraOnReview; batches: QueueBatch[]; when: (iso: string | null) => string }) {
  if (sera.read.phase !== "listed") return null;
  return <SeraEarlierArrivals agent={sera.read.list.agent} batches={batches.filter(sera.folds)} when={when} chartKinds={CHART_KINDS} />;
}
