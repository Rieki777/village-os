/**
 * One module on the library shelf (L1). Art, name, one-line promise, and the
 * few pills that change what a reader can do: tier (included is silent, as
 * everywhere), the pool badge in POOL_REASON_COPY's wording, a price where
 * one exists, "Always on" for core, "On in this village" for signed-in
 * viewers, "Preview" for admins only, and a withdrawn line that never hides.
 */
import { Link } from "wouter";
import { POOL_REASON_COPY, TIER_PILL } from "@shared/moduleCatalog";
import type { ModuleDataClass } from "@shared/modules";
import ModuleArt from "./ModuleArt";

export interface CatalogModule {
  id: string;
  name: string;
  description: string;
  core: boolean;
  tier: string;
  dataClass: ModuleDataClass;
  group: string | null;
  setup: string;
  requires: string[];
  recommends: string[];
  legalReview: boolean;
  withdrawn: { since: string; replacedBy?: string } | null;
  priceLine: string | null;
  pool: { eligible: boolean; reason: string; disposition: "paid" | "recycled" | "none" } | null;
  support: {
    party: "platform" | "vendor";
    vendorName: string | null;
    supportUrl: string | null;
    supportEmail: string | null;
  } | null;
  card: {
    promise: string;
    benefits: string[];
    forWhom: string;
    setupSummary: string;
    dataSummary: string;
    hue: number;
    emblem: string;
  } | null;
  imageUrl: string | null;
  on?: boolean;
  lifecycle?: string;
}

const PILL = "text-[10px] px-1.5 py-0.5 rounded-full border";

export default function ModuleCard({ module: m }: { module: CatalogModule }) {
  /*
   * The pill answers one question a browser has: does running this send $ReGen
   * to somebody outside the platform. So it shows for a share that is PAID and
   * not merely eligible.
   *
   * R59 made every platform module eligible, and the old `eligible` test would
   * now put an identical teal badge on all twenty-three cards saying the same
   * thing about the same author. The recycling still has to be visible, and it
   * is: the detail page renders every reason, and the pool statement on this
   * page shows the returning share as an amount. A shelf is for telling cards
   * apart, and a label every card carries tells nobody anything.
   */
  const poolLine = m.pool?.disposition === "paid" ? POOL_REASON_COPY[m.pool.reason] : null;
  return (
    <Link
      href={`/modules/${m.id}`}
      className="group block rounded-xl border border-border bg-card overflow-hidden min-w-0 break-words hover:shadow-md transition-shadow focus-visible:ring-2 focus-visible:ring-teal-deep/50"
    >
      <div className="aspect-[8/5] w-full overflow-hidden bg-muted">
        <ModuleArt
          id={m.id}
          hue={m.card?.hue ?? 200}
          emblem={m.card?.emblem ?? "Circle"}
          imageUrl={m.imageUrl}
          className="w-full h-full"
        />
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-foreground leading-snug">{m.name}</h3>
        {m.card && <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{m.card.promise}</p>}
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5 min-h-[1rem]">
          {m.core && (
            <span className={`${PILL} bg-muted text-muted-foreground border-transparent uppercase tracking-wide`}>
              Always on
            </span>
          )}
          {!m.core && m.on && (
            <span className={`${PILL} bg-emerald-50 text-emerald-700 border-emerald-200`}>On in this village</span>
          )}
          {m.lifecycle === "preview" && (
            <span className={`${PILL} bg-amber-50 text-amber-700 border-amber-200`}>Preview</span>
          )}
          {m.tier === "connected" && <span className={`${PILL} bg-sky-50 text-sky-700 border-sky-200`}>{TIER_PILL.connected}</span>}
          {m.tier === "managed" && <span className={`${PILL} bg-violet-50 text-violet-700 border-violet-200`}>{TIER_PILL.managed}</span>}
          {m.priceLine && m.priceLine !== "Free" && (
            <span className={`${PILL} bg-emerald-50 text-emerald-700 border-emerald-200`}>{m.priceLine}</span>
          )}
          {poolLine && <span className={`${PILL} bg-teal-deep/5 text-teal-deep border-teal-deep/20`}>{poolLine}</span>}
        </div>
        {m.withdrawn && (
          <p className="text-xs text-orange-700 mt-2">No longer offered since {m.withdrawn.since}.</p>
        )}
      </div>
    </Link>
  );
}
