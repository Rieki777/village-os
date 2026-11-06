/**
 * The Module Library (L1): the platform's own "what a village can be" page.
 *
 * Five shelves, a card per module with art, promise and state, and the last
 * card on the last shelf is the builders' invitation: build one, get paid in
 * $ReGen. Copy arrives rendered from the server (`/api/modules/catalog`), so
 * this page holds layout and no sentences that check-voice cannot see in
 * shared/.
 *
 * State keys are viewer-scoped by the server: signed-in members see "On in
 * this village", stewards also see "Preview" and "Not on yet", and an
 * anonymous reader sees neither, so what a village is trying out never leaks.
 *
 * ONE PAGE (Rye, 2026-10-09). The admin Module Library tab is retired into
 * this page and each module's own page. What moved here: the filters (state,
 * tier, domain, price, search) and the steward's state pills. Two things are
 * new: starter sets, and the founder's planning basket before launch. How
 * this reader sees the page is the catalog's `viewer`, decided by the server,
 * never `user.role`.
 */
import InfoTip from "@/components/InfoTip";
import Layout from "@/components/Layout";
import ModuleCard from "@/components/modules/ModuleCard";
import ModuleShelf from "@/components/modules/ModuleShelf";
import PoolStatement from "@/components/modules/PoolStatement";
import PlanBasketPanel from "@/components/modules/PlanBasketPanel";
import StarterSets from "@/components/modules/StarterSets";
import { useAdminModules, useCatalog, viewerOf } from "@/components/modules/catalog";
import { filterChoices, filterShelf, isFiltered, NO_FILTERS, type ShelfFilters } from "@/components/modules/shelfFilter";
import { TIER_PILL } from "@shared/moduleCatalog";
import type { ModuleTier } from "@shared/modules";
import { useCatalyst } from "@/lib/gameApi";
import { Hammer } from "lucide-react";
import { useMemo, useState } from "react";

function BuilderCard({ guideUrl, poolUrl }: { guideUrl: string; poolUrl: string }) {
  return (
    <div className="rounded-xl border border-dashed border-teal-deep/40 bg-teal-deep/5 p-4 flex flex-col min-w-0 break-words">
      <div className="flex items-center gap-2 mb-2">
        <Hammer className="w-5 h-5 text-teal-deep" aria-hidden="true" />
        <h3 className="font-semibold text-foreground">
          Build one, get paid in{" "}
          <InfoTip tip="$ReGen is the network's own token. The builders' pool pays module builders in it, each lunar cycle, sized by how many members open their module.">$ReGen</InfoTip>
        </h3>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Anyone can build a module for this platform. Every free module earns a share of the
        builders' pool each lunar cycle, sized by how many members open it. Nothing has been paid out
        yet.
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        <a
          href={guideUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-teal-deep underline min-h-[44px] inline-flex items-center"
        >
          Read the builder guide ↗
        </a>
        <a
          href={poolUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-teal-deep underline min-h-[44px] inline-flex items-center"
        >
          See the builders' pool ↗
        </a>
      </div>
    </div>
  );
}

/*
 * 16px text and a 44px target on a phone, so Safari does not zoom on focus and
 * a thumb does not miss; two filters per row within thumb reach.
 */
const SELECT =
  "text-base min-h-[44px] flex-1 min-w-[45%] sm:flex-none sm:min-w-0 sm:text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-teal-deep/40";

export function ShelfToolbar({
  f,
  set,
  choices,
  showState,
  count,
  total,
}: {
  f: ShelfFilters;
  set: (next: Partial<ShelfFilters>) => void;
  choices: ReturnType<typeof filterChoices>;
  showState: boolean;
  count: number;
  total: number;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={f.query}
        onChange={(e) => set({ query: e.target.value })}
        placeholder="Search the library"
        aria-label="Search the library"
        className="w-full sm:flex-1 sm:w-auto sm:min-w-[200px] px-3 py-2 text-base min-h-[44px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
      />
      {showState && (
        <select value={f.state} onChange={(e) => set({ state: e.target.value as ShelfFilters["state"] })} className={SELECT} aria-label="Show">
          <option value="all">Every module</option>
          <option value="on">On here</option>
          <option value="off">Not on yet</option>
        </select>
      )}
      {choices.tiers.length > 1 && (
        <select value={f.tier} onChange={(e) => set({ tier: e.target.value })} className={SELECT} aria-label="Filter by tier">
          <option value="all">Any tier</option>
          {choices.tiers.map((t) => (
            <option key={t} value={t}>{TIER_PILL[t as ModuleTier] ?? t}</option>
          ))}
        </select>
      )}
      {choices.domains.length > 1 && (
        <select value={f.domain} onChange={(e) => set({ domain: e.target.value })} className={SELECT} aria-label="Filter by domain">
          <option value="all">Any domain</option>
          {choices.domains.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      )}
      {choices.prices.length > 1 && (
        <select value={f.price} onChange={(e) => set({ price: e.target.value as ShelfFilters["price"] })} className={SELECT} aria-label="Filter by price">
          <option value="all">Any price</option>
          <option value="free">No extra charge</option>
          <option value="paid">Paid</option>
        </select>
      )}
      {isFiltered(f) && (
        <>
          <span className="text-sm text-muted-foreground">{count} of {total}</span>
          <button onClick={() => set(NO_FILTERS)} className="text-sm font-medium text-teal-deep underline min-h-[44px] px-2">
            Clear
          </button>
        </>
      )}
    </div>
  );
}

export default function Modules() {
  const catalyst = useCatalyst();
  const { data, failed } = useCatalog();
  const viewer = viewerOf(data);
  const steward = viewer.mode === "steward";
  const { all: adminRows } = useAdminModules(steward && !viewer.launched);
  const [f, setF] = useState<ShelfFilters>(NO_FILTERS);
  const set = (next: Partial<ShelfFilters>) => setF((cur) => ({ ...cur, ...next }));
  const modules = useMemo(() => data?.modules ?? [], [data]);
  const visible = useMemo(() => filterShelf(modules, f), [modules, f]);
  const choices = useMemo(() => filterChoices(modules), [modules]);
  // The basket reads prices from the steward's full rows, and the catalog's
  // own lifecycle stays the one it plans from.
  const basketRows = useMemo(
    () => modules.map((m) => ({ ...(adminRows?.find((a: any) => a.id === m.id) ?? {}), ...m })),
    [modules, adminRows],
  );

  return (
    <Layout>
      {/* Inherited by every heading, card and term below: a long word a village gives a shelf or a module wraps instead of widening the page. */}
      <div className="container max-w-5xl py-8 sm:py-12 [overflow-wrap:anywhere]">
        <header className="mb-6">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-foreground">Module Library</h1>
          {/* The cards themselves are single links, so the pill mechanics
              live up here where a tooltip trigger is legal HTML. */}
          <p className="text-muted-foreground mt-2 max-w-2xl leading-relaxed">
            Everything this platform can be, one card at a time. A village{" "}
            <InfoTip tip={`Every module ships off. ${catalyst.aNameCap} turns one on for members or for everyone, and the four core modules are always there.`}>turns on</InfoTip>{" "}
            what it needs and leaves the rest on the shelf, and every card{" "}
            <InfoTip tip={`On a card, "${TIER_PILL.connected}" means the module talks to a service that runs somewhere else, and "${TIER_PILL.managed}" means a vendor runs it for you. A card with neither pill runs entirely here.`}>wears its pills</InfoTip>{" "}
            so you can read it at a glance.
          </p>
          {steward && !viewer.launched && (
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
              Before launch you turn modules on yourself. Open a module to switch it, set it up, or add it to your plan.
            </p>
          )}
        </header>

        {/* Always-present polite region, same shape as Circles.tsx. */}
        <div role="status">
          {failed && (
            <p className="text-sm text-muted-foreground py-12 text-center">
              The library could not load just now. Try again in a moment.
            </p>
          )}
          {!data && !failed && <p className="text-sm text-muted-foreground py-12 text-center">Loading the shelves…</p>}
        </div>

        {data && (
          <>
            <PlanBasketPanel all={basketRows} viewer={viewer} />
            <StarterSets all={modules} viewer={viewer} />
            <ShelfToolbar
              f={f}
              set={set}
              choices={choices}
              showState={viewer.mode !== "visitor"}
              count={visible.length}
              total={modules.length}
            />
            {visible.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nothing in the library matches that. Clear the filters to see all {modules.length}.
              </p>
            )}
            {data.groups.map((g, gi) => {
              const shelf = visible.filter((m) => m.group === g.id);
              const last = gi === data.groups.length - 1;
              // A module with a group the shelves do not know still deserves a
              // card; it rides the last shelf instead of vanishing.
              const strays = last ? visible.filter((m) => !data.groups.some((x) => x.id === m.group)) : [];
              const builder = last && !isFiltered(f);
              if (shelf.length + strays.length === 0 && !builder) return null;
              return (
                <ModuleShelf key={g.id} label={g.label} gloss={g.gloss}>
                  {[...shelf, ...strays].map((m) => (
                    <ModuleCard key={m.id} module={m} steward={steward} />
                  ))}
                  {builder && <BuilderCard guideUrl={data.builder.guideUrl} poolUrl={data.builder.poolUrl} />}
                </ModuleShelf>
              );
            })}
            <PoolStatement />
          </>
        )}
      </div>
    </Layout>
  );
}
