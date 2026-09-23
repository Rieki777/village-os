/**
 * The weekly brief panel (§9.2 A4, L5b): /events?brief=<week> opens it, the
 * notification and the email both link there, and the opt-out lives inside
 * it, one honest switch writing notify.weeklyBrief through the profile
 * prefs route.
 *
 * The HTML comes from the server's own zero-token renderer, which escapes
 * every gathered string before it builds markup; this panel renders that
 * document and adds nothing to it.
 */
import { useCallback, useEffect, useState } from "react";
import { useModuleOn } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";
import { Mail, X } from "lucide-react";

interface BriefPayload {
  week: string;
  timezone: string;
  optedOut: boolean;
  subject: string;
  text: string;
  html: string;
}

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

function briefParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("brief");
  } catch {
    return null;
  }
}

export default function WeeklyBrief({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState<boolean>(() => briefParam() !== null);
  const [week] = useState<string | null>(() => briefParam());
  const [brief, setBrief] = useState<BriefPayload | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const q = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? `?week=${week}` : "";
    fetch(`/api/events/brief${q}`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: BriefPayload) => { setBrief(d); setProblem(null); })
      .catch((status) => setProblem(status === 401 ? "Sign in to read your brief" : "The brief could not be loaded"));
  }, [week]);

  // Events is optional; loading it when off is a 404. Only mounted inside the events page today, so this is quiet insurance for a future mount. See useModuleOn.
  const eventsOn = useModuleOn("events");
  useEffect(() => { if (open && eventsOn) load(); }, [open, eventsOn, load]);

  const close = () => {
    setOpen(false);
    // Leave the page where it is; only the query goes.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("brief");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch { /* the panel still closes */ }
  };

  const setOptOut = async (off: boolean) => {
    setSaving(true);
    try {
      const res = await fetch("/api/profile/prefs", {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ notify: { weeklyBrief: off ? "off" : "on" } }),
      });
      if (res.ok && brief) setBrief({ ...brief, optedOut: off });
    } catch { /* the switch stays where it was */ }
    setSaving(false);
  };

  if (!signedIn) return null;

  return (
    <>
      <div className="print-hide mt-4 border border-border rounded-xl bg-card px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <span className="flex items-center gap-2 text-sm text-foreground">
          <Mail className="h-4 w-4" aria-hidden="true" />
          The weekly brief: what the coming week holds, every week, in your inbox here and by email.
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-deep text-white"
        >
          Read this week's
        </button>
      </div>

      {open && (
        <div className="print-hide fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Weekly brief">
          <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-xl my-8">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
              <h2 className="font-display text-lg font-semibold text-foreground">{brief?.subject ?? "Your week"}</h2>
              <button type="button" onClick={close} aria-label="Close the brief" className="p-1.5 rounded-lg hover:bg-muted">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="px-5 py-4">
              {/* The loading line and the failure line swap inside one region
                  that is present from first paint, so the swap is announced.
                  The brief itself stays OUTSIDE it - a live region wrapped
                  round the whole brief would read the entire digest aloud
                  every time it arrived. */}
              <div role="status">
                {problem && <p className="text-sm text-red-700">{problem}</p>}
                {!problem && !brief && <p className="text-sm text-muted-foreground">Loading...</p>}
              </div>
              {brief && (
                <div className="text-sm text-foreground leading-relaxed [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_ul]:pl-4 [&_li]:my-0.5"
                  dangerouslySetInnerHTML={{ __html: brief.html }} />
              )}
            </div>
            {brief && (
              <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!brief.optedOut}
                    disabled={saving}
                    onChange={(e) => setOptOut(!e.target.checked)}
                  />
                  Send me this every week
                </label>
                <span className="text-[11px] text-muted-foreground">Week of {brief.week}, village time</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
