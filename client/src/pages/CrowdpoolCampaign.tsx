/**
 * The crowdpool bridge page at /campaign/:slug (lane CP, R44/R45): the hub's
 * campaign data, told in the living map's language. The gold ring is the
 * pledged pool, the quieter green arc inside it is what has been delivered,
 * the star-lantern burns brighter as the close comes near, needs sit on a
 * parchment shelf with the capital as a tint, and the Pool Ledger narrates
 * arrivals. Every claim links OUT to the hub's own campaign page; nothing on
 * this page moves money or records a pledge.
 *
 * Data comes from the game server's proxy (/api/crowdpool/campaign), which
 * caches with a 90s TTL and serves its last snapshot with `stale: true` when
 * the hub stops answering. The page refetches every minute; new ledger
 * events (diffed by id) play a ripple on the ring and an arrival line.
 */
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { useEffect, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";
import { useTokenName } from "@/hooks/useTokenNames";
import { ExampleChip } from "@/components/ExamplesBanner";
import { ArrowLeft, ExternalLink, HandHeart, Package, Sparkles, Users } from "lucide-react";
import InfoTip from "@/components/InfoTip";
import {
  CrowdpoolStyles, GoldRing, GrowthStrip, KIND_LABELS, PLEDGED_FLOOR_PARAGRAPH, RING_TIP,
  SlotMeter, StarLantern,
  capitalTint, isOverDelivered, kindGlyph, money, phaseLabel, pooledLine, timeAgo,
} from "@/components/crowdpool/PoolPieces";
import BreathingLoader from "@/components/natural/BreathingLoader";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

interface Need {
  id: string; name: string; kind: string; capitalType: string; description: string | null;
  estimatedValue: number; quantityWanted: number; quantityClaimed: number; quantityDelivered: number;
  needDeadline: string | null; priorityPinned: boolean; groupClaimable: boolean;
}
interface PoolEvent { id: string; type: string; who: string; item: string | null; at: string | null }
/** Just enough of a sibling card to name it and link to it. */
interface SiblingCard { key: string; slug?: string; title?: string; reachable: boolean; isDemo?: boolean }
interface Partner {
  partner: string; label: string; url: string; raised: number;
  contributorCount: number; percent: number; cachedAt: string | null;
}
interface Campaign {
  id: number; slug: string; title: string; projectName: string | null; location: string | null;
  description: string | null; status: string; currency: string;
  totalValue: number; pledgedTotal: number; financialTarget: number;
  percentPledged: number; percentDelivered: number;
  startedAt: string | null; endsAt: string | null; daysRemaining: number | null;
  contributorsCount: number; imageUrl: string | null; hubUrl: string; isDemo: boolean;
  needs: Need[]; partners: Partner[]; events: PoolEvent[];
}

/** One arrival, in the register Maia uses on the map. */
function narrate(e: PoolEvent, tokenName: string): string {
  if (e.type === "delivered") {
    return e.item ? `${e.item} arrived; the walls grew.` : "Something promised arrived; the walls grew.";
  }
  if (e.type === "thanked") return `${tokenName} went back down the thread to ${e.who}.`;
  if (e.item) return `${e.who} spoke for ${e.item}.`;
  return `${e.who} laid a promise on the ring.`;
}

export default function CrowdpoolCampaign() {
  const tokenName = useTokenName("Recognition");
  const modules = useModules();
  const crowdpool = useModule("crowdpool");
  const [, params] = useRoute("/campaign/:slug");
  const slug = params?.slug ?? "";

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stale, setStale] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [missing, setMissing] = useState(false);
  const [ripple, setRipple] = useState(0);
  const [arrivals, setArrivals] = useState<Set<string>>(new Set());
  const knownEvents = useRef<Set<string> | null>(null);
  /**
   * The village's other raisings.
   *
   * This page and /campaigns pointed only at each other, so the pair was a
   * closed loop with one door in. These links are the sibling half of the fix:
   * from any raising you can reach the rest of them, the way a module detail
   * page reaches the other modules. Fetched once, not on the minute timer, and
   * a failure leaves the row unrendered.
   */
  const [siblings, setSiblings] = useState<SiblingCard[]>([]);

  const load = () => {
    fetch(`/api/crowdpool/campaign?slug=${encodeURIComponent(slug)}`, { headers: headers() })
      .then(async (r) => {
        if (r.status === 404) { setMissing(true); return null; }
        if (!r.ok) { setUnreachable(true); return null; }
        return r.json();
      })
      .then((d) => {
        if (!d?.campaign) return;
        setUnreachable(false);
        setCampaign(d.campaign);
        setStale(Boolean(d.stale));
        setLastSyncAt(d.lastSyncAt ?? null);
        const ids = new Set<string>((d.campaign.events ?? []).map((e: PoolEvent) => e.id));
        if (knownEvents.current) {
          const fresh = (d.campaign.events ?? []).filter((e: PoolEvent) => !knownEvents.current!.has(e.id));
          if (fresh.length) {
            setArrivals(new Set(fresh.map((e: PoolEvent) => e.id)));
            setRipple((n) => n + 1);
          }
        }
        knownEvents.current = ids;
      })
      .catch(() => setUnreachable(true));
  };

  useEffect(() => {
    if (!crowdpool || !slug) return;
    knownEvents.current = null;
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [crowdpool?.id, slug]);

  useEffect(() => {
    if (!crowdpool) return;
    let live = true;
    fetch("/api/crowdpool/campaigns", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setSiblings((d.campaigns ?? []) as SiblingCard[]); })
      .catch(() => {});
    return () => { live = false; };
  }, [crowdpool?.id]);

  const others = siblings.filter((s) => s.reachable && (s.slug ?? s.key) !== slug);

  if (modules.loaded && !crowdpool) return <ModuleGate moduleId="crowdpool" name="Crowdpool" />;
  if (missing) {
    return (
      <Layout>
        <div className="container py-16 text-center">
          <h1 className="font-display text-3xl font-bold mb-3">Crowdpool</h1>
          <p className="text-muted-foreground mb-6">No campaign is linked under that name.</p>
          <Link href="/campaigns" className="underline">See the linked campaigns</Link>
        </div>
      </Layout>
    );
  }

  const c = campaign;
  const openNeeds = (c?.needs ?? []).filter((n) => n.quantityDelivered < n.quantityWanted);
  const metNeeds = (c?.needs ?? []).filter((n) => n.quantityDelivered >= n.quantityWanted);
  /**
   * WHERE AN IMPOSSIBLE NEED WAS GOING BEFORE ANYBODY LOOKED.
   *
   * Measured on 2026-09-04: a need arriving with one wanted and two delivered
   * (the hub's non-idempotent fulfil) never reached the meter at all. It failed
   * the `openNeeds` test, so its card left the shelf, and it passed the
   * `metNeeds` test, so it became one silent tick in "1 need already fully
   * delivered". The double count was invisible on this page and the shelf
   * showed one card fewer with nothing to say why. It stays classed as met,
   * because delivered at or above wanted IS met, and it is now NAMED.
   */
  const overDelivered = (c?.needs ?? []).filter(isOverDelivered);

  return (
    <Layout>
      <CrowdpoolStyles />
      <section className="py-6 md:py-10 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container max-w-5xl">
          <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
            <ArrowLeft className="w-4 h-4" /> All raisings
          </Link>

          {!c && !unreachable && (
            <div className="cp-board p-8 flex flex-col items-center gap-2">
              <BreathingLoader label="Reading the ledger" size={48} />
              <p className="cp-smallcaps text-sm">Reading the ledger</p>
            </div>
          )}

          {!c && unreachable && (
            <div className="cp-board p-8 text-center">
              <p className="cp-smallcaps text-sm mb-2">The ledger sleeps</p>
              <p className="text-sm" style={{ color: "#e4d3ae" }}>
                The hub is out of reach and nothing has been kept to show yet. Come back in a little while.
              </p>
            </div>
          )}

          {c && (
            <div className="cp-board">
              {/* ── The header board: name, ring, lantern ── */}
              <div className="p-6 md:p-8">
                {stale && (
                  <div className="cp-stale mb-5" role="status">
                    The ledger sleeps. The hub last answered {timeAgo(lastSyncAt)}; these numbers are kept from then.
                  </div>
                )}
                {/*
                  * THE DEMO MARKER.
                  *
                  * The hub flags a seeded campaign with isDemo, this page has
                  * carried that field on its Campaign type since it shipped, and
                  * nothing ever rendered it: a demo raising showed a full gold
                  * ring, a pledged total and a backer count on a real village's
                  * page with nothing to say it was sample data. The platform
                  * already owns the answer to this, so the marker is the same
                  * amber aside and the same ExampleChip every other surface uses
                  * (client/src/components/ExamplesBanner.tsx).
                  *
                  * The sentence is written here rather than taken from
                  * ExamplesBanner's `row` mode because that copy names a
                  * retirement trigger the standing-examples system owns, and
                  * this campaign belongs to the hub: no village publishing
                  * anything clears it. Unlinking it does.
                  */}
                {c.isDemo && (
                  <aside
                    aria-labelledby="demo-raising"
                    className="mb-5 rounded-lg border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
                  >
                    <p id="demo-raising" className="font-medium">This is the hub's demonstration raising.</p>
                    <p className="mt-1 leading-relaxed">
                      Nobody in this village made it. The ring, the backers and the ledger below are
                      the hub's sample data, and nothing you do to it takes effect. A steward clears
                      it by unlinking the campaign in Village Settings.
                    </p>
                  </aside>
                )}
                <div className="grid md:grid-cols-[1fr_auto] gap-6 items-center">
                  <div>
                    <div className="cp-smallcaps text-xs mb-1">A raising on the hub</div>
                    <h1 className="font-display text-3xl md:text-4xl font-bold" style={{ color: "#f3e6c8" }}>
                      {c.title}
                      {c.isDemo && <ExampleChip className="ml-2 align-middle" />}
                    </h1>
                    {(c.projectName || c.location) && (
                      <p className="text-sm mt-1" style={{ color: "#c9a25e" }}>
                        {[c.projectName, c.location].filter(Boolean).join(", ")}
                      </p>
                    )}
                    {c.description && (
                      <p className="text-sm mt-3 leading-relaxed max-w-xl" style={{ color: "#e4d3ae" }}>{c.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-sm" style={{ color: "#e4d3ae" }}>
                      <span className="inline-flex items-center gap-1.5">
                        <HandHeart className="w-4 h-4" style={{ color: "#c9a25e" }} />
                        {pooledLine(c.pledgedTotal, c.totalValue, c.currency)}{" "}
                        <InfoTip tip={RING_TIP}>pooled</InfoTip>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="w-4 h-4" style={{ color: "#c9a25e" }} />
                        {c.contributorsCount === 1 ? "1 backer so far" : `${c.contributorsCount} backers so far`}
                      </span>
                    </div>
                    <div className="mt-5">
                      <StarLantern daysRemaining={c.daysRemaining} endsAt={c.endsAt} />
                    </div>
                  </div>
                  <div>
                    <GoldRing
                      percentPledged={c.percentPledged}
                      percentDelivered={c.percentDelivered}
                      label={phaseLabel(c.status, c.percentPledged)}
                      ripple={ripple}
                    />
                  </div>
                </div>
              </div>

              {/* ── What this pool is, plainly ── */}
              <div className="px-6 md:px-8 pb-6">
                <div className="cp-plaque p-4 text-sm leading-relaxed">
                  <span className="cp-smallcaps-ink text-xs block mb-1">What this pool is</span>
                  This is our village's raising on the hub, where a build gathers what it needs: goods, tools,
                  hands, know-how and funds. No money moves through this page. Crypto pledges are tracked on the
                  hub, and gifts or loans of ordinary money go through the partner funders below. Claim a need
                  here and you finish the claim on the hub's own page.
                  {PLEDGED_FLOOR_PARAGRAPH ? ` ${PLEDGED_FLOOR_PARAGRAPH}` : ""}
                </div>
              </div>

              {/* ── The growth strip ── */}
              <div className="px-6 md:px-8 pb-6">
                <h2 className="cp-smallcaps text-sm mb-3">From blueprint to walls</h2>
                <GrowthStrip percentDelivered={c.percentDelivered} percentPledged={c.percentPledged} />
              </div>
            </div>
          )}
        </div>
      </section>

      {c && (
        <section className="py-8 bg-background">
          <div className="container max-w-5xl space-y-8">
            {/* ── The needs shelf ── */}
            <div>
              <h2 className="font-display text-2xl font-bold mb-1">The needs shelf</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Each open need is a quest waiting to be written. The solid bar is what arrived; the faint bar is
                what someone has spoken for.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                {openNeeds.map((n) => {
                  const tint = capitalTint(n.capitalType);
                  const Glyph = kindGlyph(n.kind);
                  return (
                    <div key={n.id} className="cp-plaque cp-need" style={{ borderLeftColor: tint }}>
                      {n.priorityPinned && <span className="cp-pin">first needed</span>}
                      <div className="flex items-start gap-3">
                        <span
                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
                          style={{ background: `${tint}22`, color: tint }}
                        >
                          <Glyph className="w-5 h-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-sm leading-snug" style={{ color: "#241a10" }}>{n.name}</h3>
                          <p className="text-[11px] mt-0.5" style={{ color: tint }}>
                            {KIND_LABELS[n.kind] ?? n.kind},{" "}
                            <InfoTip tip="The village counts more kinds of wealth than money: material, living, social, intellectual and more. Every need names the capital it calls for.">{n.capitalType} capital</InfoTip>
                            {n.groupClaimable ? ", many hands welcome" : ""}
                          </p>
                          {n.description && (
                            <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "#4a3a26" }}>{n.description}</p>
                          )}
                          <div className="mt-2.5">
                            <SlotMeter wanted={n.quantityWanted} claimed={n.quantityClaimed} delivered={n.quantityDelivered} tint={tint} />
                          </div>
                          {n.needDeadline && (
                            <p className="text-[11px] mt-1.5" style={{ color: "#8a6a33" }}>
                              Needed by {new Date(n.needDeadline).toLocaleDateString()}
                            </p>
                          )}
                          <a
                            href={c.hubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold rounded-lg px-3 py-1.5"
                            style={{ background: "#241a10", color: "#ecd08a" }}
                          >
                            Claim this on the hub <ExternalLink className="w-3 h-3" />
                          </a>
                          <p className="text-[10.5px] mt-1" style={{ color: "#8a6a33" }}>
                            You finish the claim on the hub's page.
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {openNeeds.length === 0 && (
                  <div className="cp-plaque p-5 text-sm md:col-span-2" style={{ color: "#4a3a26" }}>
                    Every need on the shelf has been met. The pool did its work.
                  </div>
                )}
              </div>
              {metNeeds.length > 0 && (
                <p className="text-xs text-muted-foreground mt-3 inline-flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  {metNeeds.length === 1 ? "1 need already fully delivered" : `${metNeeds.length} needs already fully delivered`}
                </p>
              )}
              {overDelivered.length > 0 && (
                <p className="text-xs mt-2 text-amber-800 dark:text-amber-200" role="status">
                  {overDelivered.length === 1
                    ? `More arrived than were wanted on 1 of them: ${overDelivered[0].name}.`
                    : `More arrived than were wanted on ${overDelivered.length} of them: ${overDelivered.map((n) => n.name).join(", ")}.`}
                  {" "}The hub counts a delivery twice when two stewards confirm it at once, and it is fixing
                  that. Nothing here changes what the hub recorded.
                </p>
              )}
            </div>

            {/* ── Partner funders ── */}
            {c.partners.length > 0 && (
              <div>
                <h2 className="font-display text-2xl font-bold mb-1">Partner funders</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Ordinary money travels through partners, never through this page. Their own tallies, as the hub
                  last cached them.
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  {c.partners.map((p) => (
                    <div key={p.partner} className="cp-plaque p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold text-sm" style={{ color: "#241a10" }}>
                          {p.label}
                          <InfoTip tip="Ordinary money travels through this partner, never through this page. The tally is the hub's cache of the partner's own numbers." label={`How ${p.label} fits in`} />
                        </h3>
                        <span className="text-xs font-bold" style={{ color: "#8a6a33" }}>{p.percent}%</span>
                      </div>
                      <div className="cp-slots-track mt-2">
                        <div className="cp-slots-delivered" style={{ width: `${p.percent}%`, background: "#a8862c" }} />
                      </div>
                      <p className="text-xs mt-2" style={{ color: "#4a3a26" }}>
                        {money(p.raised, c.currency)} raised with {p.contributorCount === 1 ? "1 contributor" : `${p.contributorCount} contributors`}
                      </p>
                      {p.cachedAt && (
                        <p className="text-[10.5px] mt-0.5" style={{ color: "#8a6a33" }}>
                          Their numbers, kept {timeAgo(p.cachedAt)}
                        </p>
                      )}
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold underline"
                        style={{ color: "#241a10" }}
                      >
                        Open {p.label} <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── The Pool Ledger ── */}
            <div>
              <h2 className="font-display text-2xl font-bold mb-1">The Pool Ledger</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Arrivals, as the hub's public feed tells them. Counts and names only; amounts stay in the pool.
              </p>
              <div className="cp-board p-5">
                {c.events.length === 0 && (
                  <p className="text-sm inline-flex items-center gap-2" style={{ color: "#e4d3ae" }}>
                    <Sparkles className="w-4 h-4" style={{ color: "#c9a25e" }} />
                    The ledger waits for its first arrival.
                  </p>
                )}
                <ul className="space-y-2.5">
                  {c.events.map((e) => (
                    <li
                      key={e.id}
                      className={`cp-ledger-line rounded-md px-2 py-1 text-sm flex items-baseline gap-3 ${arrivals.has(e.id) ? "arrival" : ""}`}
                      style={{ color: "#f3e6c8" }}
                    >
                      <span className="cp-smallcaps text-[11px] shrink-0 w-20">{e.type}</span>
                      <span className="flex-1">{narrate(e, tokenName)}</span>
                      {e.at && <span className="text-[11px] shrink-0" style={{ color: "#c9a25e" }}>{timeAgo(e.at)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* ── The village's other raisings ── */}
            {others.length > 0 && (
              <div>
                <h2 className="font-display text-2xl font-bold mb-1">The village's other raisings</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Every pool this village has linked. Each one keeps its own ring.
                </p>
                <ul className="flex flex-wrap gap-2">
                  {others.map((s) => (
                    <li key={s.key}>
                      <Link
                        href={`/campaign/${encodeURIComponent(s.slug ?? s.key)}`}
                        className="inline-flex items-center gap-2 min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium"
                        style={{ background: "#241a10", color: "#ecd08a", border: "1px solid #c9a25e" }}
                      >
                        {s.title ?? s.key}
                        {s.isDemo && <ExampleChip />}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── The one door out ── */}
            <div className="text-center pb-4">
              <a
                href={c.hubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 font-semibold text-sm"
                style={{ background: "#241a10", color: "#ecd08a", border: "1px solid #c9a25e" }}
              >
                Open this raising on the hub <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </section>
      )}
    </Layout>
  );
}
