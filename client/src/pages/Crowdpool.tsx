/**
 * The crowdpool list at /campaigns (lane CP): one card per linked campaign,
 * each wearing its own small gold ring. One village, several raisings. The
 * cards read from the game server's proxy cache; a campaign the hub has
 * stopped answering for shows its snapshot with the age named, and one that
 * has never synced says so plainly.
 */
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";
import { ExampleChip } from "@/components/ExamplesBanner";
import { Users } from "lucide-react";
import InfoTip from "@/components/InfoTip";
import { CrowdpoolStyles, MiniRing, PLEDGED_FLOOR_TIP, phaseLabel, pooledLine, timeAgo } from "@/components/crowdpool/PoolPieces";
import BreathingLoader from "@/components/natural/BreathingLoader";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

interface CampaignCard {
  key: string;
  slug?: string;
  title?: string;
  projectName?: string | null;
  status?: string;
  currency?: string;
  totalValue?: number;
  pledgedTotal?: number;
  percentPledged?: number;
  percentDelivered?: number;
  daysRemaining?: number | null;
  contributorsCount?: number;
  imageUrl?: string | null;
  /**
   * The hub's seeded-campaign flag. `/api/crowdpool/campaigns` has served it
   * since the module shipped and this card neither typed it nor showed it, so
   * a demo raising's ring and backer count read as this village's own.
   */
  isDemo?: boolean;
  reachable: boolean;
  stale?: boolean;
  lastSyncAt?: string | null;
}

export default function Crowdpool() {
  const modules = useModules();
  const crowdpool = useModule("crowdpool");
  const [cards, setCards] = useState<CampaignCard[] | null>(null);

  useEffect(() => {
    if (!crowdpool) return;
    let live = true;
    fetch("/api/crowdpool/campaigns", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setCards(d.campaigns ?? []); })
      .catch(() => {});
    return () => { live = false; };
  }, [crowdpool?.id]);

  if (modules.loaded && !crowdpool) return <ModuleGate moduleId="crowdpool" name="Crowdpool" />;

  return (
    <Layout>
      <CrowdpoolStyles />
      <section className="py-8 md:py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container max-w-3xl text-center">
          <h1 className="font-display text-4xl font-bold mb-3">Our raisings</h1>
          <p className="text-muted-foreground">
            What this village is gathering through the hub's{" "}
            <InfoTip tip="A crowdpool gathers pledges of money, goods, tools and hands for one build. Nothing moves through this page; every claim finishes on the hub's own page.">crowdpool</InfoTip>.
            Each ring fills as the pool does; open one to watch it become walls.
          </p>
        </div>
      </section>
      <section className="py-6 bg-background">
        <div className="container max-w-3xl space-y-4">
          {cards === null && (
            <div className="cp-board p-8 flex flex-col items-center gap-2">
              <BreathingLoader label="Reading the ledger" size={48} />
              <p className="cp-smallcaps text-sm">Reading the ledger</p>
            </div>
          )}
          {cards !== null && cards.length === 0 && (
            <div className="cp-board p-8 text-center">
              <p className="cp-smallcaps text-sm mb-2">No raisings yet</p>
              <p className="text-sm" style={{ color: "#e4d3ae" }}>
                When this village links a campaign, its ring appears here.
              </p>
            </div>
          )}
          {(cards ?? []).map((c) =>
            c.reachable ? (
              <Link
                key={c.key}
                href={`/campaign/${encodeURIComponent(c.slug ?? c.key)}`}
                className="cp-board block p-5 hover:opacity-95 transition-opacity"
              >
                <div className="flex items-center gap-5">
                  <MiniRing percent={c.percentPledged ?? 0} />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-xl font-bold" style={{ color: "#f3e6c8" }}>
                      {c.title}
                      {c.isDemo && <ExampleChip className="ml-2 align-middle" />}
                    </h2>
                    <p className="text-xs mt-0.5 cp-smallcaps">{phaseLabel(c.status ?? "active", c.percentPledged ?? 0)}</p>
                    <p className="text-sm mt-1.5" style={{ color: "#e4d3ae" }}>
                      {/* The floor qualifier lives in `pooledLine` so this card
                          and the campaign page cannot drift apart on it. */}
                      {pooledLine(c.pledgedTotal ?? 0, c.totalValue ?? 0, c.currency ?? "USD")} pooled
                      {typeof c.daysRemaining === "number" && c.daysRemaining > 0
                        ? `, ${c.daysRemaining} ${c.daysRemaining === 1 ? "day" : "days"} left`
                        : ""}
                    </p>
                    <p className="text-xs mt-1 inline-flex items-center gap-1.5" style={{ color: "#c9a25e" }}>
                      <Users className="w-3.5 h-3.5" />
                      {(c.contributorsCount ?? 0) === 1 ? "1 backer" : `${c.contributorsCount ?? 0} backers`}
                      {c.stale ? ` · numbers from ${timeAgo(c.lastSyncAt ?? null)}` : ""}
                    </p>
                  </div>
                </div>
              </Link>
            ) : (
              <div key={c.key} className="cp-board p-5">
                <p className="cp-smallcaps text-sm mb-1">{c.key}</p>
                <p className="text-sm" style={{ color: "#e4d3ae" }}>
                  The hub is out of reach and nothing has been kept for this one yet.
                </p>
              </div>
            ),
          )}
        </div>
      </section>
    </Layout>
  );
}
