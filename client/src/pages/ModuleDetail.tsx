/**
 * One module's page in the library (L1), and since 2026-10-09 the ONLY page
 * for that module: the admin Module Library tab is retired into it (Rye: the
 * public library and the admin tab become one page).
 *
 * Everyone reads the same top half: hero art, the promise, what it does, who
 * it is for, what you will set up, what data it holds, who answers, and, in
 * plain words, why a module is no longer offered or is resting.
 *
 * Below that, what the reader can DO depends on the catalog's `viewer`, which
 * the server decides (server/routes/moduleLibrary.ts); this page never reads
 * `user.role`:
 *
 *   visitor   nothing to press
 *   member    its history here, its settings with "Suggest a change", and,
 *             after launch, "Propose to turn on" (a binding village vote), or
 *             the proposal already running for it
 *   steward   all of that, plus `ModuleStewardPanel`: the four-way switch,
 *             setup, Go live, every dial, examples, vendor and health, the
 *             card image; and before launch "Add to my plan"
 *
 * Old admin deep links (`/admin?tab=modules&module=X&setting=Y`) arrive here as
 * `/modules/X#setting-Y`, and the panel opens that dial.
 */
import Layout from "@/components/Layout";
import NotFound from "@/pages/NotFound";
import ModuleArt from "@/components/modules/ModuleArt";
import ModuleHistoryStrip from "@/components/modules/ModuleHistoryStrip";
import SuggestDial from "@/components/modules/SuggestDial";
import TurnOnAction from "@/components/modules/TurnOnAction";
import ModuleStewardPanel from "@/components/admin/ModuleStewardPanel";
import { useAdminModules, useCatalog, useModuleHistory, viewerOf } from "@/components/modules/catalog";
import { runningLine, switchDoor } from "@/components/modules/switchDoor";
import { proposalHref } from "@/components/modules/switchModules";
import { toggleInBasket, useBasket } from "@/components/modules/planBasket";
import { useCatalyst } from "@/lib/gameApi";
import { POOL_REASON_COPY } from "@shared/moduleCatalog";
import type { ModuleDataClass } from "@shared/modules";
import { ArrowLeft, Vote } from "lucide-react";
import { Link, useRoute } from "wouter";

// Keyed by the union the registry declares, so a new data class cannot ship
// without the plain-words line this page prints under it.
const DATA_CLASS_PLAIN: Record<ModuleDataClass, string> = {
  none: "No personal data",
  "village-content": "Village content, nothing personal",
  "member-pii": "Personal member data, protected",
};

const CARD = "mt-8 rounded-xl border border-teal-deep/30 bg-teal-deep/5 p-4 sm:p-5";

export default function ModuleDetail() {
  const [, params] = useRoute("/modules/:id");
  const id = params?.id ?? "";
  const catalyst = useCatalyst();
  const { data, failed } = useCatalog();
  const viewer = data ? viewerOf(data) : null;
  const steward = viewer?.mode === "steward";
  const { all: adminRows, extra, reload: reloadAdmin } = useAdminModules(!!steward);
  const { history } = useModuleHistory(id, !!viewer && viewer.mode !== "visitor");
  const basket = useBasket();

  if (failed) {
    return (
      <Layout>
        <p className="container py-16 text-sm text-muted-foreground text-center">
          The library could not load just now. Try again in a moment.
        </p>
      </Layout>
    );
  }
  if (!data || !viewer) {
    return (
      <Layout>
        <p className="container py-16 text-sm text-muted-foreground text-center">Loading…</p>
      </Layout>
    );
  }

  const modules = data.modules;
  const m = modules.find((x) => x.id === id);
  if (!m) return <NotFound />;
  const names = Object.fromEntries(modules.map((x) => [x.id, x.name]));
  const poolLine = m.pool ? POOL_REASON_COPY[m.pool.reason] : null;
  const adminRow = adminRows?.find((x: any) => x.id === m.id) ?? null;
  const door = switchDoor({
    module: m,
    viewer,
    openProposal: history === null ? null : history.openProposal ?? undefined,
  });
  const inPlan = basket.includes(m.id);
  const planning = viewer.canSwitch && !viewer.launched && !m.core && !m.on && (m.lifecycle ?? "off") === "off";

  return (
    <Layout>
      <div className="container max-w-3xl py-8 sm:py-12">
        <Link
          href="/modules"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-deep underline min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Module Library
        </Link>

        <div className="mt-4 rounded-2xl overflow-hidden aspect-[8/5] sm:aspect-[2/1] bg-muted">
          <ModuleArt
            id={m.id}
            hue={m.card?.hue ?? 200}
            emblem={m.card?.emblem ?? "Circle"}
            imageUrl={m.imageUrl}
            className="w-full h-full"
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-3xl font-bold text-foreground">{m.name}</h1>
          {m.core && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
              Always on
            </span>
          )}
          {!m.core && m.on && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              On in this village
            </span>
          )}
          {m.lifecycle === "preview" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              Preview
            </span>
          )}
          {steward && !m.core && (m.lifecycle ?? "off") === "off" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
              Not on yet
            </span>
          )}
        </div>
        {m.card && <p className="text-lg text-muted-foreground mt-2 leading-relaxed">{m.card.promise}</p>}

        {/* Withdrawn and resting modules explain themselves to everyone who
            can see the state, in plain words, not only in an admin banner. */}
        {m.withdrawn && (
          <p className="mt-4 text-sm text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            No longer offered since {m.withdrawn.since}.
            {m.withdrawn.replacedBy ? ` ${names[m.withdrawn.replacedBy] ?? m.withdrawn.replacedBy} replaces it.` : ""}
            {" "}A village already running it keeps running it.
          </p>
        )}
        {m.demotedBecause && m.demotedBecause.length > 0 && (
          <p className="mt-4 text-sm text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            Resting for now. It needs {m.demotedBecause.join(" and ")}, which {m.demotedBecause.length === 1 ? "is" : "are"} off
            here, and it comes back the moment {m.demotedBecause.length === 1 ? "that is" : "those are"} on again.
          </p>
        )}

        {m.card && (
          <section className="mt-8">
            <h2 className="font-semibold text-foreground mb-2">What it does</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground leading-relaxed">
              {m.card.benefits.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          {m.card && (
            <div className="rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground mb-1">Who it is for</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{m.card.forWhom}</p>
            </div>
          )}
          {m.card && (
            <div className="rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground mb-1">What you will set up</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{m.card.setupSummary}</p>
            </div>
          )}
          {m.card && (
            <div className="rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground mb-1">What data it holds</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{m.card.dataSummary}</p>
              <p className="text-xs text-muted-foreground mt-1.5">{DATA_CLASS_PLAIN[m.dataClass] ?? m.dataClass}</p>
            </div>
          )}
          <div className="rounded-xl border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-1">Support</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {m.support?.party === "vendor" && m.support.vendorName
                ? `${m.support.vendorName} answers for this one, and your village holds the account.`
                : "Whoever runs this deployment answers for it."}
            </p>
            {poolLine && <p className="text-xs text-teal-deep mt-1.5">{poolLine}</p>}
            {m.priceLine && <p className="text-xs text-muted-foreground mt-1.5">{m.priceLine}</p>}
          </div>
        </section>

        {/* Its guild: the keys and accounts that have to be in place before
            it runs, in the seed catalog's own words. Every reader sees it,
            because a founder choosing modules and a member proposing one both
            need to know what comes with it. */}
        {m.needs && m.needs.length > 0 && (
          <section className="mt-6" aria-labelledby="module-needs">
            <h2 id="module-needs" className="font-semibold text-foreground mb-2">What it needs</h2>
            <ul className="space-y-3">
              {m.needs.map((n) => (
                <li key={n.id} className="rounded-xl border border-border p-4 text-sm">
                  <p className="font-medium text-foreground">
                    {n.title}
                    <span className="font-normal text-muted-foreground"> · {n.provider}</span>
                    {n.keystone && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber/20 text-foreground align-middle">
                        Keystone: a second founder agrees
                      </span>
                    )}
                    {!n.required && <span className="ml-2 text-xs text-muted-foreground">Optional</span>}
                  </p>
                  <p className="text-muted-foreground mt-1 leading-relaxed">{n.consequence}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {n.cost} {n.rotation}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">To undo: {n.undo}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {m.requires.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            Needs {m.requires.map((dep) => names[dep] ?? dep).join(" and ")} to run.
          </p>
        )}

        {m.recommends.length > 0 && (
          <section className="mt-6">
            <h2 className="font-semibold text-foreground mb-2">Works well with</h2>
            <div className="flex flex-wrap gap-2">
              {m.recommends.map((dep) => (
                <Link
                  key={dep}
                  href={`/modules/${dep}`}
                  className="text-sm px-3 py-1.5 min-h-[36px] inline-flex items-center rounded-full border border-border text-foreground hover:bg-muted"
                >
                  {names[dep] ?? dep}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* The door sits after everything that describes the module, because a
            reader should know what the thing does before asking the village
            for it. It draws nothing when there is nothing to offer. */}
        {door.kind === "founders-choose" && (
          <p className="mt-8 text-sm text-muted-foreground">
            Before launch, {catalyst.plural} choose which modules this village starts with.
          </p>
        )}
        {door.kind === "running" && (
          <section id="propose" className={CARD}>
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <Vote className="w-5 h-5 text-teal-deep" aria-hidden="true" />
              {runningLine(door.proposal)}
            </h2>
            <Link
              href={door.proposal.ballotId ? `/decisions/${door.proposal.ballotId}` : proposalHref(door.proposal.id)}
              className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white"
            >
              {door.proposal.ballotId ? "Go to the vote" : "Go to the proposal"}
            </Link>
          </section>
        )}
        {door.kind === "turn-on" && (
          <section id="propose" className={CARD}>
            <h2 className="font-semibold text-foreground mb-2">
              {viewer.canSwitch ? `Turn on ${m.name}` : `Want ${m.name} here?`}
            </h2>
            <TurnOnAction
              ids={[m.id]}
              all={modules}
              viewer={viewer}
              examplesAvailable={!!adminRow?.examplesAvailable}
            />
            {planning && (
              <button
                type="button"
                onClick={() => toggleInBasket(m.id)}
                aria-pressed={inPlan}
                className="mt-3 min-h-[44px] px-4 rounded-lg border border-border bg-background text-sm font-medium"
              >
                {inPlan ? "In your plan. Take it out" : "Add to my plan"}
              </button>
            )}
          </section>
        )}

        {history && <ModuleHistoryStrip events={history.events} />}

        {viewer.mode !== "visitor" && !steward && (m.dialKeys ?? []).length > 0 && <SuggestDial dialKeys={m.dialKeys ?? []} />}

        {steward && adminRow && (
          <ModuleStewardPanel m={adminRow} all={adminRows ?? []} extra={extra} viewer={viewer} onChanged={reloadAdmin} />
        )}
      </div>
    </Layout>
  );
}
