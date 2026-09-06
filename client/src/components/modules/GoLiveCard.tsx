/**
 * The Go-live moment, as a card instead of a silent flip (L1, proposal §1
 * item 3). A module in preview whose setup is done gets one small question:
 * who should see this? Members only, Everyone, or Not yet. The preselected
 * default follows the module's data class (member-pii leans Members,
 * village-content leans Everyone), Everyone greys out while a hard dependency
 * serves narrower than public, and standing examples are named before they
 * would go public.
 *
 * `AdminGoLive` is the Admin mount: it owns the one `/api/admin/modules` read
 * (once per token at rest), re-reads on `visibilitychange`, on a
 * `module:saved` or `modules:changed` window event, and every 20 seconds
 * while a preview module's tab is open, so the first save is detected by
 * readiness flipping and no tab's save handler is edited. It also hands the
 * lifecycle map up to Admin() for the nav filter, so the rail and the card
 * ride one fetch.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ModuleLifecycle } from "@shared/modules";
import { useCatalyst } from "@/lib/gameApi";

interface AdminModule {
  id: string;
  name: string;
  core: boolean;
  lifecycle: string;
  dataClass: string;
  setup: "none" | "optional" | "required";
  ready: { ready: boolean; hint: string } | null;
  maxLifecycle: string;
  requires: string[];
  showingExamples: boolean;
}

/**
 * HOW FAR OPEN EACH LIFECYCLE IS.
 *
 * The authority is `ModuleLifecycle` in `shared/modules.ts`, and typing this
 * map against that union rather than `string` is the whole fix: both live in
 * this one TypeScript program, so a fifth lifecycle added there turns this
 * declaration red at `pnpm check` and no test is needed to catch it.
 *
 * The reads below still take a fallback, because `m.maxLifecycle` and the
 * lookup's `lifecycle` arrive over HTTP as strings and are typed by
 * assertion. Unranked used to mean `undefined`, and `undefined >= 3` and
 * `undefined < 3` are BOTH false: an unrecognised ceiling silently withheld
 * the Everyone button, and an unrecognised dependency silently vanished from
 * the list of what is holding this module back. Ranking the unknown at the
 * bottom keeps the first behaviour (which fails closed, and is right) and
 * fixes the second, so a dependency is named instead of disappearing.
 */
const RANK: Record<ModuleLifecycle, number> = { off: 0, preview: 1, members: 2, public: 3 };

/** Where a lifecycle sits, with anything unrecognised held at the bottom. */
const rank = (lifecycle: string): number => RANK[lifecycle as ModuleLifecycle] ?? RANK.off;

export const GO_LIVE_RANK = RANK;

export function GoLiveCard({
  module: m, lookup, token, onChanged,
}: {
  module: AdminModule;
  /** id -> {name, lifecycle} for the whole catalog: names the dependency that holds Everyone back. */
  lookup: Record<string, { name: string; lifecycle: string }>;
  token: string;
  onChanged?: () => void;
}) {
  // Above the three early returns below, as a hook has to be.
  const catalyst = useCatalyst();
  const [busy, setBusy] = useState(false);
  const [notYet, setNotYet] = useState(
    () => sessionStorage.getItem(`golive.notyet.${m.id}`) === "1",
  );

  if (m.core || m.lifecycle !== "preview") return null;
  const setupDone = m.setup === "none" || m.ready?.ready === true;
  if (!setupDone || notYet) return null;

  const everyoneAllowed = rank(m.maxLifecycle) >= RANK.public;
  const narrowDeps = m.requires
    .filter((dep) => rank(lookup[dep]?.lifecycle ?? "off") < RANK.public)
    .map((dep) => lookup[dep]?.name ?? dep);
  const preferMembers = m.dataClass === "member-pii";

  const choose = async (lifecycle: "members" | "public") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/modules/${m.id}/lifecycle`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycle }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(String(d?.message || d?.error || "That change was refused"));
      } else {
        toast.success(
          lifecycle === "members" ? `${m.name} is live for members` : `${m.name} is live for everyone`,
        );
        window.dispatchEvent(new Event("modules:changed"));
        onChanged?.();
      }
    } catch {
      toast.error("That change did not go through");
    }
    setBusy(false);
  };

  const primary =
    "min-h-[44px] px-4 rounded-lg bg-teal-deep text-white text-sm font-semibold disabled:opacity-40";
  const secondary =
    "min-h-[44px] px-4 rounded-lg border border-teal-deep/40 text-teal-deep text-sm font-semibold bg-white disabled:opacity-40";

  return (
    <div className="mb-5 rounded-xl border border-teal-deep/30 bg-teal-deep/5 p-4 sm:p-5">
      <p className="font-semibold text-gray-900">{m.name} is set up. Go live?</p>
      <p className="text-sm text-gray-600 mt-1">
        Right now only {catalyst.plural} can see it. Choose who it opens to.
      </p>
      {m.showingExamples && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 inline-block">
          Examples are showing here. Replace or remove them before going live, or they go live too.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          disabled={busy}
          onClick={() => choose("members")}
          className={preferMembers ? primary : secondary}
        >
          Members only
        </button>
        <button
          disabled={busy || !everyoneAllowed}
          onClick={() => choose("public")}
          title={everyoneAllowed ? undefined : `${narrowDeps.join(" and ")} would need to reach everyone first`}
          className={`${preferMembers ? secondary : primary} ${everyoneAllowed ? "" : "cursor-not-allowed"}`}
        >
          Everyone
        </button>
        <button
          disabled={busy}
          onClick={() => {
            sessionStorage.setItem(`golive.notyet.${m.id}`, "1");
            setNotYet(true);
          }}
          className="min-h-[44px] px-3 text-sm font-medium text-gray-500 underline"
        >
          Not yet
        </button>
      </div>
      {!everyoneAllowed && narrowDeps.length > 0 && (
        <p className="text-xs text-gray-600 mt-2">
          Everyone is out of reach for now: {narrowDeps.join(" and ")} opens narrower than that.
          Widen {narrowDeps.length === 1 ? "it" : "them"} first.
        </p>
      )}
    </div>
  );
}

export function AdminGoLive({
  token, moduleId, onLifecycles,
}: {
  token: string;
  /** TAB_MODULE[activeTab]: the module whose tab is open, or null on platform tabs. */
  moduleId: string | null;
  /** Feeds the nav filter: id -> configured lifecycle, one fetch for both. */
  onLifecycles?: (lifecycles: Record<string, string>) => void;
}) {
  const [modules, setModules] = useState<AdminModule[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/modules", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const d = await res.json();
      const list: AdminModule[] = Array.isArray(d?.modules) ? d.modules : [];
      setModules(list);
      onLifecycles?.(Object.fromEntries(list.map((x) => [x.id, x.lifecycle])));
    } catch {
      /* keep whatever we had; the nav filters nothing while unloaded */
    }
    // onLifecycles is a setState setter in practice; token is the real key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Once per token at rest…
  useEffect(() => {
    load();
  }, [load]);

  // …plus the three moments the world may have moved.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    const onEvent = () => load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("module:saved", onEvent);
    window.addEventListener("modules:changed", onEvent);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("module:saved", onEvent);
      window.removeEventListener("modules:changed", onEvent);
    };
  }, [load]);

  const mod = useMemo(
    () => (moduleId ? modules?.find((x) => x.id === moduleId) ?? null : null),
    [modules, moduleId],
  );

  // The readiness poll: only while a preview module's tab is open, so the
  // first save flips the card on within twenty seconds of happening.
  useEffect(() => {
    if (!mod || mod.lifecycle !== "preview") return;
    const t = window.setInterval(load, 20_000);
    return () => window.clearInterval(t);
  }, [mod?.id, mod?.lifecycle, load]);

  if (!mod) return null;
  const lookup = Object.fromEntries(
    (modules ?? []).map((x) => [x.id, { name: x.name, lifecycle: x.lifecycle }]),
  );
  // Keyed by the module, so Not-yet state and the rest reset per tab while
  // the fetcher above mounts exactly once.
  return <GoLiveCard key={mod.id} module={mod} lookup={lookup} token={token} onChanged={load} />;
}
