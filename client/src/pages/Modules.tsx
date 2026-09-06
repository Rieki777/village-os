/**
 * The Module Library (L1): the platform's own "what a village can be" page.
 *
 * Public and read-only. Five shelves, a card per module with art, promise and
 * state, and the last card on the last shelf is the builders' invitation:
 * build one, get paid in $ReGen. Copy arrives rendered from the server
 * (`/api/modules/catalog`), so this page holds layout and no sentences that
 * check-voice cannot see in shared/.
 *
 * State keys are viewer-scoped by the server: signed-in members see "On in
 * this village", admins also see "Preview", and an anonymous reader sees
 * neither, so what a village is trying out never leaks here.
 */
import InfoTip from "@/components/InfoTip";
import Layout from "@/components/Layout";
import ModuleCard, { type CatalogModule } from "@/components/modules/ModuleCard";
import ModuleShelf from "@/components/modules/ModuleShelf";
import PoolStatement from "@/components/modules/PoolStatement";
import { authToken, useCatalyst } from "@/lib/gameApi";
import { Hammer } from "lucide-react";
import { useEffect, useState } from "react";

interface CatalogPayload {
  groups: { id: string; label: string; gloss: string }[];
  builder: { guideUrl: string; poolUrl: string };
  modules: CatalogModule[];
}

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

export default function Modules() {
  const catalyst = useCatalyst();
  const [data, setData] = useState<CatalogPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const tk = authToken();
    fetch("/api/modules/catalog", { headers: tk ? { Authorization: `Bearer ${tk}` } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  return (
    <Layout>
      <div className="container max-w-5xl py-8 sm:py-12">
        <header className="mb-8">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-foreground">Module Library</h1>
          {/* The cards themselves are single links, so the pill mechanics
              live up here where a tooltip trigger is legal HTML. */}
          <p className="text-muted-foreground mt-2 max-w-2xl leading-relaxed">
            Everything this platform can be, one card at a time. A village{" "}
            <InfoTip tip={`Every module ships off. ${catalyst.aNameCap} turns one on for members or for everyone, and the four core modules are always there.`}>turns on</InfoTip>{" "}
            what it needs and leaves the rest on the shelf, and every card{" "}
            <InfoTip tip="On a card, connected means the module talks to an outside service, and managed means a vendor runs it for you. A card with neither pill runs entirely here.">wears its pills</InfoTip>{" "}
            so you can read it at a glance.
          </p>
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

        {data &&
          data.groups.map((g, gi) => {
            const shelf = data.modules.filter((m) => m.group === g.id);
            const last = gi === data.groups.length - 1;
            // A module with a group the shelves do not know still deserves a
            // card; it rides the last shelf instead of vanishing.
            const strays = last ? data.modules.filter((m) => !data.groups.some((x) => x.id === m.group)) : [];
            return (
              <ModuleShelf key={g.id} label={g.label} gloss={g.gloss}>
                {[...shelf, ...strays].map((m) => (
                  <ModuleCard key={m.id} module={m} />
                ))}
                {last && <BuilderCard guideUrl={data.builder.guideUrl} poolUrl={data.builder.poolUrl} />}
              </ModuleShelf>
            );
          })}
        {data && <PoolStatement />}
      </div>
    </Layout>
  );
}
