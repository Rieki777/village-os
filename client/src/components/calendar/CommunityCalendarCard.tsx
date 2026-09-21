/**
 * The community card (L5b): everything a signed-in member DOES with the
 * calendar beyond answering, in one collapsible card under the views.
 *
 *  - Post to my layer (C4): a gathering on your own calendar, live at once,
 *    or a request for the public calendar that the crew approves.
 *  - Meet-me windows (A5): say when you are findable; seven open at most.
 *  - Seats and slots: full gatherings you can queue for, and the dishes,
 *    rides and crews a gathering asks for, with sign-up where you are going.
 *
 * Capacity truth is the server's: every button here shows the server's
 * refusal rather than pre-judging it (the RSVP page's own rule).
 */
import { useCallback, useEffect, useState } from "react";
import { useModuleOn } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";
import { CalendarPlus, HandHelping, Hourglass } from "lucide-react";
import type { CalendarItem, EventSlot } from "@shared/gatherings";
import { actionError } from "@/lib/actionOutcome";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};
// The Authorization header is attached HERE, in this declaration, on purpose:
// the auth guard (scripts/check-auth-fetch.mjs) reads one helper deep, and a
// helper that hides the token behind a second helper reads as a stranger's
// call to every route that refuses strangers.
const jsonHeaders = (): Record<string, string> => {
  const t = authToken();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), "Content-Type": "application/json" };
};

interface MineRow {
  id: string;
  title: string;
  startsAt: string;
  status: string;
  layer: string;
  kind: string;
}

interface MeetMeRow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  place: string | null;
  layer: string;
}

const EMPTY_POST = { title: "", startsAt: "", endsAt: "", place: "", note: "", layer: "private" };
const EMPTY_WINDOW = { startsAt: "", endsAt: "", place: "", note: "", layer: "village" };

export default function CommunityCalendarCard({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [post, setPost] = useState(EMPTY_POST);
  const [meetMe, setMeetMe] = useState(EMPTY_WINDOW);
  const [mine, setMine] = useState<MineRow[]>([]);
  const [windows, setWindows] = useState<MeetMeRow[]>([]);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [slotsFor, setSlotsFor] = useState<string | null>(null);
  const [slots, setSlots] = useState<Record<string, EventSlot[]>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const say = (text: string) => { setNote(text); setTimeout(() => setNote(null), 4000); };

  const load = useCallback(() => {
    fetch("/api/events/mine", { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setMine(d.events ?? []))
      .catch(() => setMine([]));
    fetch("/api/events/meet-me/mine", { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setWindows(d.windows ?? []))
      .catch(() => setWindows([]));
    fetch("/api/events", { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setItems((d.events ?? []).filter((i: CalendarItem) => (i.kind === "gathering" || i.kind === "festival") && i.status === "scheduled" && i.daysUntil >= 0)))
      .catch(() => setItems([]));
  }, []);

  // Events is optional; loading it when off is a 404. Only mounted inside the events page today, so this is quiet insurance for a future mount. See useModuleOn.
  const eventsOn = useModuleOn("events");
  useEffect(() => { if (open && signedIn && eventsOn) load(); }, [open, signedIn, eventsOn, load]);

  if (!signedIn) return null;

  const submitPost = async () => {
    setBusy("post");
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          title: post.title.trim(),
          startsAt: post.startsAt ? new Date(post.startsAt).toISOString() : "",
          endsAt: post.endsAt ? new Date(post.endsAt).toISOString() : null,
          locationText: post.place.trim() || null,
          description: post.note.trim() || null,
          layer: post.layer,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) say(d?.error ?? "That did not work");
      else {
        say(d.pendingApproval ? "Sent to the crew for the public calendar." : "On your calendar.");
        setPost(EMPTY_POST);
        load();
      }
    } catch { say("That did not work"); }
    setBusy(null);
  };

  const submitWindow = async () => {
    setBusy("meet-me");
    try {
      const res = await fetch("/api/events/meet-me", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          startsAt: meetMe.startsAt ? new Date(meetMe.startsAt).toISOString() : "",
          endsAt: meetMe.endsAt ? new Date(meetMe.endsAt).toISOString() : "",
          place: meetMe.place.trim() || null,
          note: meetMe.note.trim() || null,
          layer: meetMe.layer,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) say(d?.error ?? "That did not work");
      else { say("Your window is on the calendar."); setMeetMe(EMPTY_WINDOW); setWindows(d.windows ?? []); }
    } catch { say("That did not work"); }
    setBusy(null);
  };

  // SWEEP. A failed close left the window on screen and said nothing, which
  // reads as a button that does not work.
  const closeWindow = async (id: string) => {
    const res = await fetch(`/api/events/meet-me/${id}`, { method: "DELETE", headers: headers() }).catch(() => null);
    const wrong = actionError({ ok: !!res?.ok, error: null });
    if (wrong) { say(wrong); return; }
    say("Window closed.");
    setWindows((w) => w.filter((x) => x.id !== id));
  };

  const joinQueue = async (g: CalendarItem) => {
    setBusy(`wl:${g.id}:${g.occurrenceKey}`);
    try {
      const res = await fetch(`/api/events/${g.id}/waitlist`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ occurrenceKey: g.occurrenceKey || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) say(d?.error ?? "That did not work");
      // 0092: a queue place at a priced gathering costs what a seat costs, so
      // it says so. The alternative is a member finding the movement in their
      // ledger and having to work out what it was for.
      else if (d?.charged > 0) say(`You are number ${d.position} in line. ${d.charged} ${d.tokenName} held, returned if you leave or it comes off.`);
      else say(`You are number ${d.position} in line.`);
      load();
    } catch { say("That did not work"); }
    setBusy(null);
  };

  // SWEEP. The sibling of closeWindow and dropSlot, and the one the last pass
  // missed: it said "You left the line." on the way out of the function, so a
  // refused DELETE confirmed a departure that never happened and the member
  // learns they are still on the list by being called up.
  const leaveQueue = async (g: CalendarItem) => {
    const occ = g.occurrenceKey ? `?occurrence=${g.occurrenceKey}` : "";
    const res = await fetch(`/api/events/${g.id}/waitlist${occ}`, { method: "DELETE", headers: headers() }).catch(() => null);
    const wrong = actionError({ ok: !!res?.ok, error: null });
    const d = res?.ok ? await res.json().catch(() => ({})) : {};
    // 0092: naming the refund is the whole point of getting the refund right.
    const back = d?.refunded > 0 ? ` ${d.refunded} ${d.tokenName} back.` : "";
    say(wrong ?? `You left the line.${back}`);
    load();
  };

  const toggleSlots = async (g: CalendarItem) => {
    const key = `${g.id}:${g.occurrenceKey}`;
    if (slotsFor === key) { setSlotsFor(null); return; }
    setSlotsFor(key);
    const occ = g.occurrenceKey ? `?occurrence=${g.occurrenceKey}` : "";
    const res = await fetch(`/api/events/${g.id}/slots${occ}`, { headers: headers() });
    if (res.ok) {
      const d = await res.json();
      setSlots((s) => ({ ...s, [key]: d.slots ?? [] }));
    }
  };

  const takeSlot = async (g: CalendarItem, slot: EventSlot) => {
    setBusy(`slot:${slot.id}`);
    try {
      const res = await fetch(`/api/events/${g.id}/slots/${slot.id}/signup`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ occurrenceKey: g.occurrenceKey || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) say(d?.error ?? "That did not work");
      else say("It is yours.");
      setSlotsFor(null);
      await toggleSlots(g);
    } catch { say("That did not work"); }
    setBusy(null);
  };

  /*
   * SWEEP (the incomplete loop). "Given back." was printed unconditionally,
   * BEFORE anything checked the answer, so a refused DELETE confirmed a
   * release that never happened and the member walked away still holding the
   * slot. A false yes is worse than silence.
   */
  const dropSlot = async (g: CalendarItem, slot: EventSlot) => {
    const occ = g.occurrenceKey ? `?occurrence=${g.occurrenceKey}` : "";
    const res = await fetch(`/api/events/${g.id}/slots/${slot.id}/signup${occ}`, {
      method: "DELETE",
      headers: headers(),
    }).catch(() => null);
    const wrong = actionError({ ok: !!res?.ok, error: null });
    say(wrong ?? "Given back.");
    setSlotsFor(null);
    await toggleSlots(g);
  };

  const input = "w-full text-sm border border-border bg-background rounded-lg px-2.5 py-2";
  const label = "block text-xs font-medium text-muted-foreground mb-1";
  const pending = mine.filter((m) => m.status === "draft" && m.layer === "public");
  const full = items.filter((i) => i.spotsLeft === 0);
  const withNeeds = items.filter((i) => i.daysUntil <= 30);

  return (
    <div className="print-hide mt-4 border border-border rounded-xl bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2 font-medium text-foreground">
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
          Your calendar: post, meet, bring
        </span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 text-sm space-y-6">
          {note && <p className="text-xs text-foreground bg-muted rounded-lg px-3 py-2">{note}</p>}

          <div>
            <p className="font-medium text-foreground mb-1">Put something on the calendar</p>
            <p className="text-xs text-muted-foreground mb-2">
              Your own layer is yours alone and goes live at once. The public calendar is the village's face to
              the world, so a post there waits for the crew.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="cc-title">What</label>
                <input id="cc-title" value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} className={input} placeholder="Seed swap on the porch" />
              </div>
              <div>
                <label className={label} htmlFor="cc-place">Where</label>
                <input id="cc-place" value={post.place} onChange={(e) => setPost({ ...post, place: e.target.value })} className={input} placeholder="The commons" />
              </div>
              <div>
                <label className={label} htmlFor="cc-starts">Starts</label>
                <input id="cc-starts" type="datetime-local" value={post.startsAt} onChange={(e) => setPost({ ...post, startsAt: e.target.value })} className={input} />
              </div>
              <div>
                <label className={label} htmlFor="cc-ends">Ends (optional)</label>
                <input id="cc-ends" type="datetime-local" value={post.endsAt} onChange={(e) => setPost({ ...post, endsAt: e.target.value })} className={input} />
              </div>
              <div>
                <label className={label} htmlFor="cc-layer">Where it shows</label>
                <select id="cc-layer" value={post.layer} onChange={(e) => setPost({ ...post, layer: e.target.value })} className={`${input} bg-background`}>
                  <option value="private">My calendar only</option>
                  <option value="public">Ask for the public calendar</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor="cc-note">A line about it</label>
                <input id="cc-note" value={post.note} onChange={(e) => setPost({ ...post, note: e.target.value })} className={input} />
              </div>
            </div>
            <button type="button" onClick={submitPost} disabled={busy === "post" || !post.title.trim() || !post.startsAt}
              className="mt-3 px-4 py-2 bg-teal-deep text-white rounded-lg text-xs font-medium disabled:opacity-50">
              {busy === "post" ? "Saving..." : post.layer === "public" ? "Send to the crew" : "Put it on my calendar"}
            </button>
            {pending.length > 0 && (
              <ul className="mt-3 space-y-1">
                {pending.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Hourglass className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="text-foreground">{m.title}</span> is waiting for the crew.
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="font-medium text-foreground mb-1">Meet me</p>
            <p className="text-xs text-muted-foreground mb-2">
              A window that says when and where you are findable. The village calendar is readable by anyone
              past the gate, so put it there when you mean to be found; your own layer stays yours alone.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="mm-starts">From</label>
                <input id="mm-starts" type="datetime-local" value={meetMe.startsAt} onChange={(e) => setMeetMe({ ...meetMe, startsAt: e.target.value })} className={input} />
              </div>
              <div>
                <label className={label} htmlFor="mm-ends">Until</label>
                <input id="mm-ends" type="datetime-local" value={meetMe.endsAt} onChange={(e) => setMeetMe({ ...meetMe, endsAt: e.target.value })} className={input} />
              </div>
              <div>
                <label className={label} htmlFor="mm-place">Where</label>
                <input id="mm-place" value={meetMe.place} onChange={(e) => setMeetMe({ ...meetMe, place: e.target.value })} className={input} placeholder="By the greenhouse" />
              </div>
              <div>
                <label className={label} htmlFor="mm-layer">Who sees it</label>
                <select id="mm-layer" value={meetMe.layer} onChange={(e) => setMeetMe({ ...meetMe, layer: e.target.value })} className={`${input} bg-background`}>
                  <option value="village">The village</option>
                  <option value="private">Only me</option>
                </select>
              </div>
            </div>
            <button type="button" onClick={submitWindow} disabled={busy === "meet-me" || !meetMe.startsAt || !meetMe.endsAt}
              className="mt-3 px-4 py-2 bg-teal-deep text-white rounded-lg text-xs font-medium disabled:opacity-50">
              {busy === "meet-me" ? "Saving..." : "Open the window"}
            </button>
            {windows.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {windows.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-muted-foreground">
                      <span className="text-foreground">{new Date(w.startsAt).toLocaleString()}</span>
                      {w.place ? `, ${w.place}` : ""}{w.layer === "private" ? " (only you)" : ""}
                    </span>
                    <button type="button" onClick={() => closeWindow(w.id)}
                      className="px-2 py-1 border border-border rounded-lg hover:bg-muted shrink-0">Close it</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="font-medium text-foreground mb-1 flex items-center gap-1.5">
              <HandHelping className="h-4 w-4" aria-hidden="true" />
              Seats and slots
            </p>
            {full.length === 0 && withNeeds.length === 0 && (
              <p className="text-xs text-muted-foreground">Nothing needs a queue or a hand right now.</p>
            )}
            {full.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-muted-foreground mb-1">Full gatherings you can queue for. The line is age order; a freed seat goes to whoever has waited longest.</p>
                <ul className="space-y-1.5">
                  {full.map((g) => {
                    const key = `wl:${g.id}:${g.occurrenceKey}`;
                    return (
                      <li key={`${g.id}:${g.occurrenceKey}`} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">
                          <span className="text-foreground">{g.title}</span>
                          <span className="text-muted-foreground"> {new Date(g.startsAt).toLocaleDateString()}</span>
                          {typeof g.waitlistCount === "number" && g.waitlistCount > 0 && (
                            <span className="text-muted-foreground"> ({g.waitlistCount} waiting)</span>
                          )}
                          {(g.seatPrice ?? 0) > 0 && (
                            <span className="text-teal-deep"> {g.seatPrice} {g.seatTokenName ?? g.seatToken}</span>
                          )}
                        </span>
                        {g.myWaitlistPosition ? (
                          <span className="flex items-center gap-1.5 shrink-0">
                            <span className="text-muted-foreground">You are number {g.myWaitlistPosition}</span>
                            <button type="button" onClick={() => leaveQueue(g)} className="px-2 py-1 border border-border rounded-lg hover:bg-muted">Leave</button>
                          </span>
                        ) : g.myRsvp === "going" ? (
                          <span className="text-muted-foreground shrink-0">You have a seat</span>
                        ) : (
                          <button type="button" onClick={() => joinQueue(g)} disabled={busy === key}
                            className="px-2 py-1 bg-teal-deep text-white rounded-lg shrink-0 disabled:opacity-50">Join the line</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {withNeeds.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">What gatherings ask for: a dish, a ride, childcare, setup. Names show once you are going.</p>
                <ul className="space-y-1.5">
                  {withNeeds.map((g) => {
                    const key = `${g.id}:${g.occurrenceKey}`;
                    const list = slots[key] ?? [];
                    return (
                      <li key={key} className="text-xs">
                        <button type="button" onClick={() => toggleSlots(g)}
                          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 border border-border rounded-lg hover:bg-muted text-left">
                          <span className="min-w-0 truncate text-foreground">{g.title}</span>
                          <span className="text-muted-foreground shrink-0">{slotsFor === key ? "Hide" : "What it needs"}</span>
                        </button>
                        {slotsFor === key && (
                          <ul className="mt-1.5 ml-2 space-y-1">
                            {list.length === 0 && <li className="text-muted-foreground">This gathering asks for nothing extra.</li>}
                            {list.map((s) => (
                              <li key={s.id} className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate">
                                  <span className="text-foreground">{s.label}</span>
                                  <span className="text-muted-foreground"> ({s.kind}, {s.takenCount} of {s.needed})</span>
                                  {s.names && s.names.length > 0 && (
                                    <span className="text-muted-foreground"> {s.names.map((n) => n.name ?? "a member who has since left").join(", ")}</span>
                                  )}
                                </span>
                                {s.mine ? (
                                  <button type="button" onClick={() => dropSlot(g, s)}
                                    className="px-2 py-1 border border-border rounded-lg hover:bg-muted shrink-0">Give it back</button>
                                ) : s.takenCount >= s.needed ? (
                                  <span className="text-muted-foreground shrink-0">Covered</span>
                                ) : (
                                  <button type="button" onClick={() => takeSlot(g, s)} disabled={busy === `slot:${s.id}`}
                                    className="px-2 py-1 bg-teal-deep text-white rounded-lg shrink-0 disabled:opacity-50">Take it</button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
