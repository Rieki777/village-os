/**
 * EVERYTHING A STEWARD DOES WITH ONE MODULE, ON THAT MODULE'S PAGE.
 *
 * Rye, 2026-10-09: the public Module Library and the admin "Module Library"
 * tab become one page. This panel is what that tab held for each card, moved
 * out of client/src/pages/Admin.tsx (a file on a line ratchet that only turns
 * down) and onto `/modules/:id`:
 *
 *   - the four-way switch (off, preview, members, everyone), with the
 *     after-launch rule from shared/moduleSwitch.ts: a holder of
 *     `module.switch` widens, an admin who is not a holder may only narrow
 *   - what setup is still waiting for (`SetupNeeded`) and the Go-live card
 *   - every setting the module reads (`ModuleSettingsSection`, config editors
 *     included), opened by a `#setting-<key>` deep link
 *   - clearing the standing examples
 *   - the listing detail: vendor, terms, health, price, licence, contract doc
 *   - a plain-words health line for modules that talk to an outside service
 *   - the card image
 *
 * Who sees it is the catalog's `viewer` (decided by the server), and every
 * write goes to a route that checks again. Light-only by the founder's ruling
 * on the admin workspace, which is why it sits in client/src/components/admin
 * where the gray scale is allowed.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Activity } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { prepareImageForUpload } from "@/lib/imagePrep";
import { refusal } from "@/components/admin/adminApi";
import ModuleSettingsSection from "@/components/admin/ModuleSettingsSection";
import { useModuleDeepLink } from "@/components/admin/moduleDeepLink";
import { forgetExamplesCache, RETIRES_WITH } from "@/components/ExamplesBanner";
import { GoLiveCard } from "@/components/modules/GoLiveCard";
import SetupNeeded from "@/components/modules/SetupNeeded";
import ConsentCard from "@/components/modules/ConsentCard";
import { switchInOrder } from "@/components/modules/switchModules";
import { POOL_REASON_COPY, TIER_PILL } from "@shared/moduleCatalog";
import { healthLine } from "@shared/moduleHealthLine";
import {
  LIFECYCLE_ORDER,
  alsoNeedsLine,
  turnOnPlan,
  widens,
  type LibraryViewer,
  type PlanModule,
} from "@shared/moduleSwitch";
import type { ModuleLifecycle, ModuleTier } from "@shared/modules";

// Keyed by the union: the compiler owns the promise that every lifecycle has a
// sentence, so a fifth one is a build error, not a blank paragraph.
const LIFECYCLE_HINT: Record<ModuleLifecycle, string> = {
  off: "Nobody sees it. Its pages and menu items are gone.",
  preview: "Only the people who run this village see it.",
  members: "Signed-in members see it.",
  public: "Everyone sees it, visitors too.",
};
const LIFECYCLE_LABEL: Record<ModuleLifecycle, string> = {
  off: "Off",
  preview: "Preview",
  members: "Members",
  public: "Everyone",
};

const asLifecycle = (v: unknown): ModuleLifecycle =>
  v === "preview" || v === "members" || v === "public" ? v : "off";

export default function ModuleStewardPanel({
  m,
  all,
  extra,
  viewer,
  onChanged,
}: {
  /** This module's row from /api/admin/modules. */
  m: any;
  /** Every row from /api/admin/modules, for dependencies and names. */
  all: any[];
  extra: { orphans: string[]; hypha: any } | null;
  viewer: LibraryViewer;
  onChanged: () => void;
}) {
  const token = authToken() ?? "";
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ModuleLifecycle | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [clearAsk, setClearAsk] = useState(false);
  const { settingsOpen, setSettingsOpen, focusKey, setFocusKey, clearFocusKey } = useModuleDeepLink(true);

  const lifecycle = asLifecycle(m.lifecycle);
  const served = asLifecycle(m.served ?? m.lifecycle);
  const names: Record<string, string> = Object.fromEntries(all.map((x: any) => [x.id, x.name]));
  const planRows: PlanModule[] = all.map((x: any) => ({ ...x, lifecycle: x.lifecycle }));
  const lookup = Object.fromEntries(all.map((x: any) => [x.id, { name: x.name, lifecycle: x.lifecycle }]));

  /* One move on the switch. Widening takes whatever the module needs with it,
     dependencies first; a module that touches money asks for the card. */
  const move = async (to: ModuleLifecycle) => {
    setPending(null);
    const plan = widens(lifecycle, to) ? turnOnPlan([m.id], to, planRows) : [{ ...m, lifecycle } as PlanModule];
    setBusy(true);
    const out = await switchInOrder(plan, to);
    setBusy(false);
    if (out.refused) {
      toast.error(out.refused.id === m.id ? out.refused.message : `${out.refused.name}: ${out.refused.message}`);
    } else {
      toast.success(`${m.name} is now ${LIFECYCLE_LABEL[to].toLowerCase()}`);
    }
    onChanged();
  };

  const press = (to: ModuleLifecycle) => {
    if (to === lifecycle) return;
    if (m.legalReview && lifecycle === "off" && to !== "off") setPending(to);
    else void move(to);
  };

  const clearExamples = async () => {
    setClearAsk(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/modules/${m.id}/examples/clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(refusal(d, "Could not clear the examples"));
      else {
        toast.success(`${m.name}: ${d.removed} example row(s) cleared`);
        forgetExamplesCache(m.id, { confirmed: true });
      }
    } catch {
      toast.error("Could not clear the examples");
    }
    setBusy(false);
    onChanged();
  };

  const putImage = async (imageUrl: string | null) => {
    const res = await fetch(`/api/admin/modules/${m.id}/image`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(d?.message || d?.error || "The image was refused"));
  };

  const chooseImage = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const prepared = await prepareImageForUpload(file, { maxEdge: 2000, quality: 82 });
      const form = new FormData();
      form.append("file", prepared.file);
      const up = await fetch("/api/admin/brand/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const d = await up.json().catch(() => ({}));
      if (!up.ok || !d?.url) throw new Error(String(d?.error || "Upload failed"));
      await putImage(String(d.url));
      toast.success("Card image set");
      window.dispatchEvent(new Event("modules:changed"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The image did not upload");
    }
    setBusy(false);
  };

  const clearImage = async () => {
    setBusy(true);
    try {
      await putImage(null);
      toast.success("Back to the platform art");
      window.dispatchEvent(new Event("modules:changed"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That change did not go through");
    }
    setBusy(false);
  };

  if (m.core) return null;

  const twins = (RETIRES_WITH[m.id] ?? [])
    .map((id) => all.find((x: any) => x.id === id))
    .filter((x: any) => x?.showingExamples)
    .map((x: any) => String(x.name));
  const hasVillageImage = typeof m.config?.imageUrl === "string" && m.config.imageUrl.length > 0;
  const health = healthLine({
    vendorName: m.vendor?.legalName ?? null,
    credentialPresent: m.credentialPresent ?? null,
    health: m.health ?? [],
  });
  const offPlan = lifecycle === "off" ? turnOnPlan([m.id], "preview", planRows) : [];
  const needs = alsoNeedsLine(m, offPlan);

  return (
    <section aria-labelledby="steward-panel" className="mt-8 rounded-xl border border-gray-200 bg-white p-4 sm:p-5 text-gray-900">
      <h2 id="steward-panel" className="font-semibold">
        For the people who run this village
      </h2>

      {health && (
        <p
          className={`mt-2 flex items-start gap-2 text-sm ${health.tone === "bad" ? "text-red-700" : health.tone === "watch" ? "text-amber-800" : "text-emerald-800"}`}
        >
          <Activity className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {health.text}
        </p>
      )}

      {/* The switch. Two columns on a phone, one row from sm: up, every cell a
          44px target. A withdrawn module that is off can never come back, so
          its wider rungs are dead. After launch, a wider rung is the village's
          call unless this reader holds the power, so it is dead too and the
          proposal on this page is the way. */}
      <div className="mt-4">
        <p className="text-sm font-medium mb-1.5">Who can see it</p>
        <div role="group" aria-label="Who can see it" className="grid grid-cols-2 gap-px rounded-lg border border-gray-200 bg-gray-200 overflow-hidden sm:flex sm:w-fit">
          {LIFECYCLE_ORDER.map((lc) => {
            const wider = widens(lifecycle, lc);
            const barred =
              (!!m.withdrawn && lifecycle === "off" && lc !== "off") ||
              (wider && !viewer.canSwitch) ||
              (!wider && lc !== lifecycle && !viewer.canPause);
            return (
              <button
                key={lc}
                type="button"
                disabled={busy || barred}
                aria-pressed={lifecycle === lc}
                onClick={() => press(lc)}
                title={LIFECYCLE_HINT[lc]}
                className={`min-h-[44px] px-4 text-sm font-medium ${
                  lifecycle === lc ? "bg-teal-deep text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                } ${barred ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                {LIFECYCLE_LABEL[lc]}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-sm text-gray-600">{LIFECYCLE_HINT[lifecycle]}</p>
        {viewer.launched && !viewer.canSwitch && (
          <p className="mt-1 text-sm text-gray-600">
            Since the launch, widening this is the village's call. You can still pause it or turn it off, and the village is told.
          </p>
        )}
        {needs && viewer.canSwitch && <p className="mt-1 text-sm text-gray-700">{needs}. Turning it on turns those on first.</p>}
        {lifecycle === "off" && viewer.canSwitch && <p className="mt-1 text-sm text-gray-600">Turn it on in preview to look before anyone else does. You go live from here when it is ready.</p>}
      </div>

      {pending && (
        <div className="mt-3">
          <ConsentCard names={[m.name]} action="Turn on" busy={busy} onConfirm={() => move(pending)} onCancel={() => setPending(null)} />
        </div>
      )}

      {m.demotedBecause?.length > 0 && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Set to {LIFECYCLE_LABEL[lifecycle].toLowerCase()}, and resting as off until{" "}
          {m.demotedBecause.map((id: string) => names[id] ?? id).join(" and ")} {m.demotedBecause.length === 1 ? "is" : "are"} on again.
        </p>
      )}
      {(extra?.orphans ?? []).length > 0 && (
        <p className="mt-3 text-xs text-gray-600">
          Stored settings name module id(s) this platform does not know, and they are ignored: {extra!.orphans.join(", ")}.
        </p>
      )}

      <SetupNeeded
        moduleId={m.id}
        setup={m.setup ?? "none"}
        ready={m.ready}
        lifecycle={served}
        className="mt-3"
        onOpen={({ settingKey }) => {
          setSettingsOpen(true);
          setFocusKey(settingKey);
        }}
      />
      {lifecycle === "preview" && m.setup !== "none" && m.ready && !m.ready.ready && (
        <p className="text-sm text-gray-600 mt-2">Then the go-live choice appears here.</p>
      )}
      {lifecycle === "preview" && viewer.canSwitch && (
        <div className="mt-4">
          <GoLiveCard module={m} lookup={lookup} token={token} onChanged={onChanged} />
        </div>
      )}

      {m.showingExamples && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>
            Showing example content, so it is never empty when you first open it. Nobody here made it, and it clears
            itself the moment you publish something real.
          </p>
          {!clearAsk ? (
            <button type="button" onClick={() => setClearAsk(true)} disabled={busy} className="mt-2 min-h-[44px] px-3 rounded-md border border-amber-400 bg-white font-medium">
              Clear the examples now
            </button>
          ) : (
            <div className="mt-2 space-y-2">
              <p>
                {twins.length ? `This clears ${twins.join(" and ")} too, because they show the same rows. ` : ""}
                They are removed for good, and turning the module off and on does not bring them back.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={clearExamples} disabled={busy} className="min-h-[44px] px-3 rounded-md bg-amber-700 text-white font-medium">
                  Clear them
                </button>
                <button type="button" onClick={() => setClearAsk(false)} className="min-h-[44px] px-3 rounded-md border border-amber-400 bg-white font-medium">
                  Keep them
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {m.id === "hypha" && (
        <div className="mt-4 rounded-lg border border-teal-deep/30 bg-teal-deep/5 p-3 text-sm">
          <p className="font-medium">Your Hypha links</p>
          {extra?.hypha?.configured ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(extra.hypha.links ?? {}).map(([name, url]) => (
                <a key={name} href={String(url)} target="_blank" rel="noopener noreferrer" className="min-h-[44px] inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 text-teal-deep">
                  {name} ↗
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-gray-700">Not connected yet. Set the address under this module's settings (hypha.org_url), and every Hypha button appears.</p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-4">
        <button
          type="button"
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-expanded={settingsOpen}
          className="min-h-[44px] text-sm font-medium text-teal-deep underline"
        >
          {settingsOpen ? "Hide settings" : "Settings"}
        </button>
        <button
          type="button"
          onClick={() => setDetailOpen(!detailOpen)}
          aria-expanded={detailOpen}
          className="min-h-[44px] text-sm font-medium text-teal-deep underline"
        >
          {detailOpen ? "Hide details" : "Details"}
        </button>
      </div>

      {settingsOpen && (
        <div id="module-settings">
          <ModuleSettingsSection
            moduleId={m.id}
            moduleName={m.name}
            lifecycle={served}
            moduleNames={names}
            password={token}
            focusKey={focusKey}
            onFocused={clearFocusKey}
          />
        </div>
      )}

      {detailOpen && <ListingDetail m={m} names={names} />}

      <div className="mt-4 pt-4 border-t border-gray-100">
        <p className="text-sm font-medium mb-1">Card image</p>
        <p className="text-xs text-gray-600 mb-2">Your own picture for this module's card, or the platform art when unset.</p>
        {/* The catalog withholds a village's own art below the members rung,
            so custom art on a staged module never hints at what a village is
            trying out. A steward passes that check, so say so here. */}
        {hasVillageImage && (served === "off" || served === "preview") && (
          <p className="text-xs text-gray-600 mb-2">
            You are the only one seeing it. While this module is {served === "off" ? "off" : "in preview"}, members and
            visitors get the platform art. Yours appears for everyone once it is live for members.
            {served !== lifecycle && " That is what is being served right now, whatever this is set to, because the module is missing something it requires."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center min-h-[44px] px-4 rounded-lg border border-gray-200 text-sm font-medium cursor-pointer bg-white hover:bg-gray-50">
            {busy ? "Working…" : "Upload a picture"}
            <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => chooseImage(e.target.files?.[0])} />
          </label>
          {hasVillageImage && (
            <button type="button" disabled={busy} onClick={clearImage} className="min-h-[44px] px-3 text-sm font-medium text-gray-600 underline">
              Use the platform art
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** The listing detail the admin card's Details drawer held, unchanged in substance. */
function ListingDetail({ m, names }: { m: any; names: Record<string, string> }) {
  return (
    <div className="mt-4 pt-4 border-t border-gray-100 grid gap-3 text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-600">
        <span>id: <code className="text-gray-800">{m.id}</code></span>
        <span>data it holds: <span className="text-gray-800">{m.dataClass}</span></span>
        {m.tier !== "included" && <span>tier: <span className="text-gray-800">{TIER_PILL[m.tier as ModuleTier] ?? m.tier}</span></span>}
        {m.pool && POOL_REASON_COPY[m.pool.reason] && (
          <span>
            pool: <span className={m.pool.disposition === "paid" ? "text-emerald-700" : "text-gray-800"}>{POOL_REASON_COPY[m.pool.reason]}</span>
          </span>
        )}
        {m.provides && <span>domain: <span className="text-gray-800">{m.provides}</span></span>}
        <span>
          contract doc: <span className={m.hasContractDoc ? "text-gray-800" : "text-amber-700"}>{m.hasContractDoc ? "on the shelf" : "none yet"}</span>
        </span>
      </div>
      {m.builtBy && <p className="text-gray-600">Built by {m.builtBy}</p>}
      {m.requires?.length > 0 && <p className="text-gray-600">Needs: {m.requires.map((id: string) => names[id] ?? id).join(", ")}</p>}
      {m.listing && (
        <p className="text-gray-600">
          Turned on as "{TIER_PILL[m.listing.tier as ModuleTier] ?? m.listing.tier}" under library contract {m.listing.contractVersion}
          {m.listing.acceptedAt ? ` on ${new Date(m.listing.acceptedAt).toLocaleDateString()}` : ""}
        </p>
      )}
      {m.pricing && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
          <p className="font-medium text-emerald-900">{m.priceLine}</p>
          <p className="text-emerald-800 mt-1 leading-relaxed">
            {m.pricing.amount > 0
              ? "You buy this from the builder and they bill you directly. This platform takes no part in the payment."
              : "This listing adds no charge of its own."}
          </p>
          {m.pricing.billingUrl && (
            <a href={m.pricing.billingUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep underline">
              Pricing and billing ↗
            </a>
          )}
          {m.pricing.licenceKey && (
            <p className="text-emerald-800 mt-1">
              The licence lives in your own secrets store, under <code>{m.pricing.licenceKey}</code>. You can see its last four
              characters and clear it from Integrations.
            </p>
          )}
          {m.pricing.amount > 0 && m.credentialPresent === false && (
            <p className="text-amber-700 mt-1">No licence key yet. This module answers 503 and says who to reach, and the rest of the village keeps working.</p>
          )}
          {m.pricing.amount > 0 && m.credentialPresent === true && <p className="text-emerald-800 mt-1">Licence key is set.</p>}
        </div>
      )}
      {m.tier === "managed" && <p className="text-gray-600">Supported by whoever runs this deployment. One bill, one number to call.</p>}
      {m.vendor && (
        <div className="grid gap-1">
          <p className="font-medium text-gray-800">{m.vendor.legalName}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <a href={m.vendor.url} target="_blank" rel="noopener noreferrer" className="text-teal-deep underline">Product ↗</a>
            <a href={m.vendor.termsUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep underline">Terms ↗</a>
            <a href={m.vendor.statusUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep underline">Status ↗</a>
            <a href={m.vendor.supportUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep underline">Support ↗</a>
            <span className="text-gray-600">{m.vendor.supportEmail}</span>
          </div>
          <p className="text-gray-600">
            {m.vendor.liveness?.mode === "window"
              ? `A successful call is expected inside ${m.vendor.liveness.withinHours} hours. Longer silence reads as stale.`
              : "Called on demand, so silence here is normal and is declared as such."}
          </p>
        </div>
      )}
      {(m.vendor?.setupSteps ?? []).length > 0 && (
        <div>
          <p className="font-medium text-gray-800 mb-1">Setup you do inside their product</p>
          <ul className="list-disc pl-4 space-y-1 text-gray-600">
            {m.vendor.setupSteps.map((s: string, i: number) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      {(m.health ?? []).length > 0 && (
        <div>
          <p className="font-medium text-gray-800 mb-1">What its calls have actually done</p>
          {m.health.map((h: any) => (
            <p key={h.operation} className={h.reading?.verdict === "failing" || h.reading?.verdict === "stale" ? "text-red-600" : "text-gray-600"}>
              {h.operation}: {h.reading?.detail}
            </p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-600">
        {m.recommends?.length > 0 && <span>works better with: {m.recommends.map((id: string) => names[id] ?? id).join(", ")}</span>}
        {m.capabilities?.length > 0 && <span>adds permissions: {m.capabilities.join(", ")}</span>}
      </div>
    </div>
  );
}
