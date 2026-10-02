/**
 * Organisational Memory's setup, on its own module card: the two addresses,
 * the connection as a founder reads it, and the one button that pulls.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────
 *
 * The module's readiness hint says to give it this village's own address at
 * the service, and links to `?setting=config` on this card. Nothing rendered
 * there: `ModuleSettingsSection` mounts a config editor only for hypha or for a
 * module in `CONFIG_PANELS`, and this module had none, so the link landed on
 * "has no settings of its own" and the address could be set by API alone. The
 * sync was the same, reachable by `POST /api/saberra/sync` and nothing else.
 *
 * ── ONE RULE FOR AN ADDRESS ──────────────────────────────────────────────
 *
 * The browser refuses a non-https address by running the listing's own
 * `validateConfig`, the function `PUT /api/admin/modules/:id/config` refuses a
 * save with. That validator asks `httpsAddress`, which is also what the sync
 * route checks before it sends the village's key anywhere. So there is one
 * rule in three places and no second copy of it here.
 *
 * ── THE KEY NEVER COMES HERE ─────────────────────────────────────────────
 *
 * The key is entered in Admin, Integrations, under `sera_api_secret`, and this
 * panel only links there. The status route answers a reading of the key and
 * never the key, and even the last four characters that reading carries are
 * left off this screen: "set" is what a founder needs to know here.
 *
 * Light-only, by the founder's ruling on the admin workspace: fixed light inks,
 * the same zone as every other panel in this directory
 * (scripts/check-tailwind-gray.mjs LIGHT_SURFACES).
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { MODULES_BY_ID } from "@shared/modules";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import { useModuleConfig } from "./ModuleConfigPanels";

const MODULE_ID = "saberra";

const inputCls =
  "border border-gray-200 rounded-lg px-2 py-1.5 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-teal-deep";
const saveCls =
  "min-h-[44px] px-4 text-sm rounded-lg bg-teal-deep text-white font-medium focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-teal-deep disabled:opacity-40";
const btnCls =
  "min-h-[44px] px-3 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-deep disabled:opacity-40 inline-flex items-center gap-2";

/** GET /api/saberra/status, as `server/routes/saberra.ts` sends it. */
interface Status {
  connection: {
    state: "ready" | "key-changed" | "cannot-store" | "not-connected";
    sentence: string;
    mayCall: boolean;
  };
  held: number;
  addressSet: boolean;
}

/** How a call failed, as `server/lib/saberraClient.ts` names it. */
type FailureWhy = "no-session" | "refused" | "unreadable" | "vendor-error";

const WHY_WORDS: Record<FailureWhy, string> = {
  "no-session": "no session was open",
  refused: "the call did not go through",
  unreadable: "the reply could not be read",
  "vendor-error": "the service said no",
};

/** POST /api/saberra/sync, the parts this panel shows. */
interface SyncResult {
  landed: number;
  refused?: { kind: string; reason?: string }[];
  facts: number;
  truncated?: string[];
  failures?: { kind: string; label?: string; why: string; detail: string }[];
  notOffered?: string[];
  addressesSeen?: { id: string; fields: string[] }[];
}

/** "1 fact", "3 facts". */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function SaberraConfigPanel({ password }: { password: string }) {
  const { config, lifecycle, loading, save } = useModuleConfig(MODULE_ID, password);
  /*
   * WHAT A FOUNDER TYPED, or null for "show what is stored".
   *
   * Derived, never copied in by an effect. An effect that copied the stored
   * config into the fields ran AFTER a keystroke whenever the config read
   * landed in the same flush, and wiped what had just been typed;
   * SaberraConfigPanel.test.tsx caught it by typing before the read landed.
   * With a draft that is null until somebody types, a late read can only
   * change what an untouched field shows.
   */
  const [apiDraft, setApiDraft] = useState<string | null>(null);
  const [dashDraft, setDashDraft] = useState<string | null>(null);
  const apiUrl = apiDraft ?? String(config?.apiUrl ?? "");
  const dashboardUrl = dashDraft ?? String(config?.dashboardUrl ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [status, setStatus] = useState<Status | null>(null);
  const [statusProblem, setStatusProblem] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [syncProblem, setSyncProblem] = useState<string | null>(null);

  const on = !loading && lifecycle !== "off";

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/saberra/status`, { headers: authHeaders(password) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(null);
        setStatusProblem(refusal(d, "The connection could not be read."));
        return;
      }
      // Believed only in its own shape. A body without a connection reading
      // is said to be unreadable, never rendered as a half-empty status.
      if (
        !d || typeof d !== "object" || !d.connection || typeof d.connection.state !== "string" ||
        typeof d.held !== "number"
      ) {
        setStatus(null);
        setStatusProblem("The connection reading came back in a shape this screen cannot read.");
        return;
      }
      setStatus(d as Status);
      setStatusProblem(null);
    } catch {
      setStatus(null);
      setStatusProblem("The connection could not be read, because the request did not reach the server.");
    }
  }, [password]);

  // The routes are behind the module's own gate, so they answer nothing while
  // it is off. Asking anyway would turn a correct 404 into a scary line.
  useEffect(() => {
    if (on) void loadStatus();
  }, [on, loadStatus]);

  const onSave = async () => {
    const next = { apiUrl: apiUrl.trim(), dashboardUrl: dashboardUrl.trim() };
    const refused = MODULES_BY_ID[MODULE_ID]?.validateConfig?.(next) ?? null;
    if (refused) {
      setProblem(refused);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      const ok = await save(next);
      if (ok) {
        // Back to showing what is stored, which `save` has just replaced.
        setApiDraft(null);
        setDashDraft(null);
        toast.success("Saved. The next sync calls this address");
        // The Go-live card and the module cards read readiness, and an address
        // is exactly what flips this module's. They listen for this event.
        window.dispatchEvent(new Event("module:saved"));
        if (on) void loadStatus();
      }
    } catch {
      setProblem("That did not reach the server, so nothing was saved.");
    } finally {
      setSaving(false);
    }
  };

  const onSync = async () => {
    setSyncing(true);
    setSyncProblem(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/saberra/sync`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: "{}",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncProblem(refusal(d, "The sync did not run."));
        return;
      }
      // A reply without its two counts is a reply this cannot report on, and
      // it says so. Printing "undefined suggestions" would be the quiet version.
      if (!d || typeof d.landed !== "number" || typeof d.facts !== "number") {
        setSyncProblem("The sync answered in a shape this screen cannot read, so what it did is unknown here.");
        void loadStatus();
        return;
      }
      setResult(d as SyncResult);
      void loadStatus();
    } catch {
      setSyncProblem("The sync did not reach the server, so nothing ran.");
    } finally {
      setSyncing(false);
    }
  };

  const keyState = status?.connection.state;

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-5">
      <div>
        <h3 className="font-semibold text-gray-900 mb-1">This village's address at the service</h3>
        <p className="text-xs text-gray-500 mb-3">
          The service gives each village its own address. The key that goes with it is entered
          in Integrations, never here.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-gray-600">
            Service address, which a sync calls
            <input
              value={apiUrl}
              onChange={(e) => setApiDraft(e.target.value)}
              placeholder="https://"
              inputMode="url"
              autoComplete="off"
              aria-describedby={problem ? "saberra-address-problem" : undefined}
              className={`${inputCls} w-full mt-1`}
            />
          </label>
          <label className="text-xs text-gray-600">
            Dashboard address, which the link out opens
            <input
              value={dashboardUrl}
              onChange={(e) => setDashDraft(e.target.value)}
              placeholder="https://"
              inputMode="url"
              autoComplete="off"
              aria-describedby={problem ? "saberra-address-problem" : undefined}
              className={`${inputCls} w-full mt-1`}
            />
          </label>
        </div>
        {problem && (
          <p
            id="saberra-address-problem"
            className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3"
            role="alert"
          >
            {problem}
          </p>
        )}
        <button type="button" className={`${saveCls} mt-3`} disabled={saving} onClick={onSave}>
          {saving ? "Saving…" : "Save addresses"}
        </button>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <h3 className="font-semibold text-gray-900 mb-1">The connection</h3>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : !on ? (
          <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-4">
            The module is off. The addresses you save now are kept. The connection can be checked
            and a sync run once the module is on, and preview is enough for that.
          </p>
        ) : (
          <>
            {statusProblem && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3" role="alert">
                {statusProblem}
              </p>
            )}
            {!status && !statusProblem && <p className="text-sm text-gray-500">Reading the connection…</p>}
            {status && (
              <ul className="text-sm text-gray-700 space-y-1 mb-3">
                <li>
                  <span className="font-medium text-gray-900">Key: </span>
                  {keyState === "ready" ? "set." : status.connection.sentence}
                  {keyState === "not-connected" && (
                    <>
                      {" "}
                      <a href="/admin?tab=integrations" className="text-teal-deep underline">
                        Add the key in Integrations
                      </a>
                    </>
                  )}
                  {keyState === "key-changed" && (
                    <>
                      {" "}
                      <a href="/admin?tab=integrations" className="text-teal-deep underline">
                        Replace the key in Integrations
                      </a>
                    </>
                  )}
                </li>
                <li>
                  <span className="font-medium text-gray-900">Address: </span>
                  {status.addressSet
                    ? "set. A sync calls the service address above."
                    : "no https service address is saved yet. Enter it above and save."}
                </li>
                <li>
                  <span className="font-medium text-gray-900">Held here: </span>
                  {status.held === 0
                    ? "nothing from the service yet."
                    : `${count(status.held, "fact")} from the service.`}
                </li>
              </ul>
            )}

            <button type="button" className={btnCls} disabled={syncing} onClick={onSync}>
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <p className="text-[11px] text-gray-500 mt-1">
              Reads what the service holds and puts its suggestions in the review queue. Nothing
              changes until somebody accepts one there.
            </p>

            {syncProblem && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3" role="alert">
                {syncProblem}
              </p>
            )}
            {result && <SyncAnswer result={result} />}
          </>
        )}
      </div>
    </div>
  );
}

/** What one sync came back with, every refusal on its own line. */
function SyncAnswer({ result }: { result: SyncResult }) {
  const failures = result.failures ?? [];
  const refused = result.refused ?? [];
  const truncated = result.truncated ?? [];
  const notOffered = result.notOffered ?? [];
  const addresses = result.addressesSeen ?? [];
  const nothing = result.landed === 0 && result.facts === 0 && failures.length === 0;

  return (
    <div className="mt-3 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-700 space-y-2" role="status">
      <p>
        {count(result.landed, "suggestion")} reached the review queue.{" "}
        <a href="/review" className="text-teal-deep underline">Open the review queue</a>
      </p>
      <p>This sync stored {count(result.facts, "fact")} from the service.</p>
      {nothing && <p>The service answered with nothing to suggest.</p>}

      {failures.length > 0 && (
        <ul className="text-red-700 space-y-1">
          {failures.map((f) => (
            <li key={`${f.kind}-${f.detail}`}>
              {f.label ?? f.kind}: {WHY_WORDS[f.why as FailureWhy] ?? "it failed"} ({f.detail})
            </li>
          ))}
        </ul>
      )}
      {refused.length > 0 && (
        <ul className="text-amber-800 space-y-1">
          {refused.map((r, i) => (
            <li key={`${r.kind}-${i}`}>
              {r.kind}: the review queue refused it{r.reason ? ` (${r.reason})` : ""}
            </li>
          ))}
        </ul>
      )}
      {truncated.length > 0 && (
        <ul className="text-amber-800 space-y-1">
          {truncated.map((k) => (
            <li key={k}>{k}: cut short. The service holds more than one sync reads.</li>
          ))}
        </ul>
      )}
      {notOffered.length > 0 && (
        <ul className="text-gray-600 space-y-1">
          {notOffered.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      {addresses.length > 0 && (
        <p className="text-amber-800">
          {count(addresses.length, "record")} carried an email address, and those fields were
          dropped before anything was stored.
        </p>
      )}
    </div>
  );
}
