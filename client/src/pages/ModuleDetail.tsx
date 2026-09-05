/**
 * One module's page in the library (L1): hero art, the promise, what it does,
 * who it is for, what you will set up, what data it holds, who answers, and
 * for admins the one button that starts the flow: Turn on (off to preview),
 * then the Go-live card the moment setup is done.
 *
 * Anonymous readers see no buttons at all. Admin state rides
 * `/api/admin/modules` with the same bearer token AdminGate uses, so what an
 * admin sees here and in the Admin panel can never disagree.
 *
 * A SIGNED-IN MEMBER now gets one thing: a way to ask the village for a module
 * it does not run (`ModuleAskDoor`). It opens an advisory vote and it cannot
 * turn a module on, which the card says in as many words. Read
 * `components/modules/askDoor.ts` before touching that copy.
 */
import Layout from "@/components/Layout";
import NotFound from "@/pages/NotFound";
import { GoLiveCard } from "@/components/modules/GoLiveCard";
import ModuleArt from "@/components/modules/ModuleArt";
import ModuleAskDoor from "@/components/modules/ModuleAskDoor";
import { type CatalogModule } from "@/components/modules/ModuleCard";
import { useAuth } from "@/contexts/AuthContext";
import { authToken, useCatalyst } from "@/lib/gameApi";
import { prepareImageForUpload } from "@/lib/imagePrep";
import { POOL_REASON_COPY } from "@shared/moduleCatalog";
import type { ModuleDataClass } from "@shared/modules";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { toast } from "sonner";

// Keyed by the union the registry declares, so a new data class cannot ship
// without the plain-words line this page prints under it.
const DATA_CLASS_PLAIN: Record<ModuleDataClass, string> = {
  none: "No personal data",
  "village-content": "Village content, nothing personal",
  "member-pii": "Personal member data, protected",
};

/* A function of the village's word for whoever runs it, because the preview
   line names those people. Everything else here is unchanged. */
const lifecycleLine = (catalyst: string): Record<string, string> => ({
  preview: `In preview: only ${catalyst} can see it.`,
  members: "Live for signed-in members.",
  public: "Live for everyone.",
});

/** The admin's slice of /api/admin/modules this page acts on. */
interface AdminModule {
  id: string;
  name: string;
  core: boolean;
  lifecycle: string;
  /**
   * What is actually being SERVED, which differs from `lifecycle` when a
   * module is demoted for a missing dependency. The catalog withholds a
   * village's own card image on this value, so anything explaining that
   * has to read it and not the configured one.
   */
  served: string;
  legalReview: boolean;
  dataClass: ModuleDataClass;
  setup: "none" | "optional" | "required";
  ready: { ready: boolean; hint: string } | null;
  maxLifecycle: string;
  requires: string[];
  showingExamples: boolean;
  examplesAvailable: boolean;
  config: any;
}

function AdminPanel({ id }: { id: string }) {
  const catalyst = useCatalyst();
  const token = authToken() ?? "";
  const [all, setAll] = useState<AdminModule[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [withExamples, setWithExamples] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/modules", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const d = await res.json();
      setAll(Array.isArray(d?.modules) ? d.modules : []);
    } catch {
      /* the panel simply stays quiet on a failed read */
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const m = all?.find((x) => x.id === id) ?? null;
  if (!m || m.core) return null;

  const turnOn = async () => {
    if (m.legalReview && m.lifecycle === "off") {
      const sure = window.confirm(
        `${m.name} touches funds. Before enabling: credits are non-withdrawable and non-refundable to fiat; ` +
          "tested backups, per-admin identities, and legal review are preconditions. Continue?",
      );
      if (!sure) return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/modules/${m.id}/lifecycle`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          lifecycle: "preview",
          ...(m.examplesAvailable && !withExamples ? { examples: false } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(String(d?.message || d?.error || "That change was refused"));
      else {
        toast.success(`${m.name} is on, in preview`);
        window.dispatchEvent(new Event("modules:changed"));
      }
      load();
    } catch {
      toast.error("That change did not go through");
    }
    setBusy(false);
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
      load();
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
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That change did not go through");
    }
    setBusy(false);
  };

  const lookup = Object.fromEntries((all ?? []).map((x) => [x.id, { name: x.name, lifecycle: x.lifecycle }]));
  const hasVillageImage = typeof m.config?.imageUrl === "string" && m.config.imageUrl.length > 0;

  return (
    <div className="mt-8 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="font-semibold text-foreground mb-1">For this village's founders</h2>
      {m.lifecycle === "off" ? (
        <>
          <p className="text-sm text-muted-foreground">
            Off right now. Turning it on opens a preview only {catalyst.plural} can see; you go live from
            there when it is ready.
          </p>
          {m.examplesAvailable && (
            <label className="flex items-center gap-2 mt-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={withExamples}
                onChange={(e) => setWithExamples(e.target.checked)}
                className="w-4 h-4 accent-teal-deep"
              />
              Start with example content
            </label>
          )}
          <button
            disabled={busy}
            onClick={turnOn}
            className="mt-3 min-h-[44px] px-5 rounded-lg bg-teal-deep text-white font-semibold text-sm disabled:opacity-40"
          >
            Turn on
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{lifecycleLine(catalyst.plural)[m.lifecycle] ?? m.lifecycle}</p>
          {m.lifecycle === "preview" && m.setup !== "none" && m.ready && !m.ready.ready && (
            <p className="text-sm text-amber-700 mt-2">{m.ready.hint}. Then the go-live choice appears here.</p>
          )}
          <div className="mt-4">
            <GoLiveCard module={m as any} lookup={lookup} token={token} onChanged={load} />
          </div>
        </>
      )}

      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-sm font-medium text-foreground mb-1">Card image</p>
        <p className="text-xs text-muted-foreground mb-2">
          Your own picture for this module's card, or the platform art when unset.
        </p>
        {/*
          * The catalog withholds a village's own art below the `members` rung
          * (server/index.ts, GET /api/modules/catalog): custom art on a staged
          * module would whisper what a village is trying out, which is the
          * quiet that preview exists to keep. An admin passes that check, so
          * the hero above shows the upload back to the one person it is
          * hidden from, and the rule lived only in a server comment and an
          * e2e assertion. Say it on the surface that sets the picture.
          */}
        {hasVillageImage && !m.core && (m.served === "off" || m.served === "preview") && (
          <p className="text-xs text-muted-foreground mb-2">
            You are the only one seeing it. While this module is {m.served === "off" ? "off" : "in preview"},
            members and visitors get the platform art, so your own picture never hints at what the village is
            trying out. Yours appears for everyone once the module is live for members.
            {m.served !== m.lifecycle && " That is what is being served right now, whatever this is configured as, because the module is missing something it requires."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center min-h-[44px] px-4 rounded-lg border border-border text-sm font-medium cursor-pointer bg-background hover:bg-muted">
            {busy ? "Working…" : "Upload a picture"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => chooseImage(e.target.files?.[0])}
            />
          </label>
          {hasVillageImage && (
            <button
              disabled={busy}
              onClick={clearImage}
              className="min-h-[44px] px-3 text-sm font-medium text-muted-foreground underline"
            >
              Use the platform art
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ModuleDetail() {
  const [, params] = useRoute("/modules/:id");
  const id = params?.id ?? "";
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "founder";

  const [modules, setModules] = useState<CatalogModule[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const tk = authToken();
    fetch("/api/modules/catalog", { headers: tk ? { Authorization: `Bearer ${tk}` } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setModules(Array.isArray(d?.modules) ? d.modules : []))
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <Layout>
        <p className="container py-16 text-sm text-muted-foreground text-center">
          The library could not load just now. Try again in a moment.
        </p>
      </Layout>
    );
  }
  if (!modules) {
    return (
      <Layout>
        <p className="container py-16 text-sm text-muted-foreground text-center">Loading…</p>
      </Layout>
    );
  }

  const m = modules.find((x) => x.id === id);
  if (!m) return <NotFound />;
  const names = Object.fromEntries(modules.map((x) => [x.id, x.name]));
  const poolLine = m.pool ? POOL_REASON_COPY[m.pool.reason] : null;

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
        </div>
        {m.card && <p className="text-lg text-muted-foreground mt-2 leading-relaxed">{m.card.promise}</p>}

        {m.withdrawn && (
          <p className="mt-4 text-sm text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            No longer offered since {m.withdrawn.since}.
            {m.withdrawn.replacedBy ? ` ${names[m.withdrawn.replacedBy] ?? m.withdrawn.replacedBy} replaces it.` : ""}
            {" "}A village already running it keeps running it.
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
            member should have read what the thing does before they ask the
            whole village for it. It draws nothing at all when there is nothing
            to ask for. */}
        <ModuleAskDoor module={m} />

        {isAdmin && <AdminPanel id={m.id} />}
      </div>
    </Layout>
  );
}
