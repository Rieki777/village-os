/**
 * Subscribe from your own calendar (0085, §5 item 10): the public .ics feed
 * for anyone, and a private feed address for a signed-in member that adds
 * the layers they may see. The private address is minted here, shown once,
 * and revoked here; the server keeps only its hash.
 */
import { useCallback, useEffect, useState } from "react";
import { useModuleOn } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";
import { CalendarPlus, Copy, RefreshCw } from "lucide-react";
import CommunityCalendarCard from "./CommunityCalendarCard";
import WeeklyBrief from "./WeeklyBrief";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

interface FeedState {
  publicUrl: string;
  hasToken: boolean;
  createdAt: string | null;
}

export default function CalendarFeedCard({ signedIn }: { signedIn: boolean }) {
  const [state, setState] = useState<FeedState | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/events/feed", { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setState({ publicUrl: d.publicUrl, hasToken: Boolean(d.hasToken), createdAt: d.createdAt ?? null }))
      .catch(() => setState({ publicUrl: `${window.location.origin}/api/events/calendar.ics`, hasToken: false, createdAt: null }));
  }, []);

  // Events is optional; loading it when off is a 404. Only mounted inside the events page today, so this is quiet insurance for a future mount. See useModuleOn.
  const eventsOn = useModuleOn("events");
  useEffect(() => { if (open && eventsOn) load(); }, [open, eventsOn, load]);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setNote("Copied"); }
    catch { setNote("Select the address and copy it"); }
    setTimeout(() => setNote(null), 2000);
  };

  const mint = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/events/feed/token", { method: "POST", headers: headers() });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setNote(d?.error ?? "That did not work"); }
      else { setMinted(d.url); load(); }
    } catch { setNote("That did not work"); }
    setBusy(false);
  };

  // SWEEP. mint() directly above handles a refusal and this did not, so a
  // failed revoke said nothing at all. The member walks away believing the
  // private address is dead while it is still serving their calendar to
  // whoever holds the URL, which is the whole reason the button exists.
  const revoke = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/events/feed/token", { method: "DELETE", headers: headers() });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setNote(d?.error ?? "That did not work, and the old address still works"); }
      else { setMinted(null); load(); setNote("Your private address no longer works"); }
    } catch { setNote("That did not work, and the old address still works"); }
    setBusy(false);
  };

  return (
    <>
    {/* L5b rides under the feed card so the page mounts one component: the
        community card (post, meet, bring) and the weekly brief panel. */}
    <CommunityCalendarCard signedIn={signedIn} />
    <WeeklyBrief signedIn={signedIn} />
    <div className="print-hide mt-4 border border-border rounded-xl bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2 font-medium text-foreground">
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
          Subscribe from your own calendar
        </span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm space-y-4">
          <p className="text-muted-foreground">
            Google Calendar, Apple Calendar and Outlook all take a calendar by address. Add one of these and the
            village calendar stays a mirror in the app you already open, updated as things change.
          </p>
          <div>
            <p className="font-medium text-foreground mb-1">Public feed</p>
            <p className="text-xs text-muted-foreground mb-1.5">What a visitor sees: gatherings, festivals, the sky and the village's marks.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate text-xs bg-muted rounded px-2 py-1.5">{state?.publicUrl ?? "Loading..."}</code>
              <button type="button" onClick={() => state && copy(state.publicUrl)} className="p-1.5 rounded-lg border border-border hover:bg-muted" aria-label="Copy the public feed address">
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          {signedIn && (
            <div>
              <p className="font-medium text-foreground mb-1">Your private feed</p>
              <p className="text-xs text-muted-foreground mb-1.5">
                Adds what only you may see: your loans due, your circle's items, your answers. The address is a key.
                It is shown once; anyone holding it reads your feed, so revoke it if it leaks.
              </p>
              {minted && (
                <div className="flex items-center gap-2 mb-2">
                  <code className="flex-1 min-w-0 truncate text-xs bg-muted rounded px-2 py-1.5">{minted}</code>
                  <button type="button" onClick={() => copy(minted)} className="p-1.5 rounded-lg border border-border hover:bg-muted" aria-label="Copy your private feed address">
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={mint} disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-deep text-white disabled:opacity-50 inline-flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  {state?.hasToken ? "Make a new address" : "Make my address"}
                </button>
                {state?.hasToken && (
                  <button type="button" onClick={revoke} disabled={busy}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 disabled:opacity-50">
                    Revoke
                  </button>
                )}
                {state?.hasToken && !minted && (
                  <span className="text-xs text-muted-foreground">You have an address in use{state.createdAt ? ` since ${new Date(state.createdAt).toLocaleDateString()}` : ""}. Making a new one retires it.</span>
                )}
              </div>
            </div>
          )}
          {note && <p className="text-xs text-foreground">{note}</p>}
        </div>
      )}
    </div>
    </>
  );
}
