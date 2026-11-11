/**
 * One gathering's email settings (the comms build spec 5.7): when its
 * reminders go, whether guests may say yes, and who hosts it.
 *
 * Mounted twice: in the Calendar panel of Admin, where the admin's own token is
 * handed in and the panel already knows the reader runs events, and on each
 * gathering of the calendar page, where it asks once per page whether the
 * signed-in member may manage gatherings and draws nothing for anybody who
 * may not. Closed until opened, so a calendar of thirty gatherings costs one
 * request, not thirty.
 *
 * The rules live in shared/comms/gatheringSettings.ts and the server checks
 * every one again; this file only draws them.
 */
import { useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import SaveBar, { type SaveResult } from "@/components/SaveBar";
import { changedKeys } from "@/lib/unsavedChanges";
import {
  REMINDER_CHOICES,
  reminderLabel,
  sortedReminders,
  type GatheringEmailSettingsView,
  type GuestSetting,
  type ReminderSetting,
} from "@shared/comms/gatheringSettings";

/** The token to send: the admin's when the panel hands one in, else the signed-in member's. */
const authHeaders = (token?: string): Record<string, string> => {
  const t = token ?? authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/** One question per page load, shared by every gathering on it. */
let accessAsked: Promise<boolean> | null = null;
function mayManage(): Promise<boolean> {
  if (!authToken()) return Promise.resolve(false);
  accessAsked ??= fetch("/api/events/comms-access", { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : { manage: false }))
    .then((d) => d?.manage === true)
    .catch(() => false);
  return accessAsked;
}

type Mode = ReminderSetting["mode"];

export default function GatheringEmailSettings({ eventId, token, manages }: { eventId: string; token?: string; manages?: boolean }) {
  const [allowed, setAllowed] = useState<boolean>(manages === true);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<GatheringEmailSettingsView | null>(null);
  const [mode, setMode] = useState<Mode>("default");
  const [minutes, setMinutes] = useState<number[]>([]);
  const [guests, setGuests] = useState<GuestSetting>("default");
  const [host, setHost] = useState<string>("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (manages !== undefined) return;
    let live = true;
    void mayManage().then((m) => { if (live) setAllowed(m); });
    return () => { live = false; };
  }, [manages]);

  const take = (v: GatheringEmailSettingsView) => {
    setView(v);
    setMode(v.reminders.mode);
    setMinutes(v.reminders.mode === "custom" ? v.reminders.minutes : v.effective.reminderMinutes);
    setGuests(v.guests);
    setHost(v.hostUserId ?? "");
  };

  useEffect(() => {
    if (!open || view) return;
    let live = true;
    fetch(`/api/events/${encodeURIComponent(eventId)}/comms`, { headers: authHeaders(token) })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!live) return;
        if (r.ok && d?.settings) take(d.settings);
        else setNote({ ok: false, text: d?.error ?? "These settings didn't load. Close and open them to try again." });
      })
      .catch(() => { if (live) setNote({ ok: false, text: "These settings didn't load. Close and open them to try again." }); });
    return () => { live = false; };
  }, [open, view, eventId, token]);

  if (!allowed) return null;

  const toggleMinute = (m: number) =>
    setMinutes((list) => (list.includes(m) ? list.filter((x) => x !== m) : sortedReminders([...list, m])));

  /** What the server holds now, in the same shape as the form, so the bar counts by value. */
  const held = view
    ? {
        mode: view.reminders.mode,
        minutes: view.reminders.mode === "custom" ? view.reminders.minutes : view.effective.reminderMinutes,
        guests: view.guests,
        host: view.hostUserId ?? "",
      }
    : null;
  const formNow = { mode, minutes: mode === "custom" ? minutes : held?.minutes ?? [], guests, host };
  const changed = held ? changedKeys<Record<string, unknown>>(held, formNow).length : 0;

  const save = async (): Promise<SaveResult> => {
    setNote(null);
    if (mode === "custom" && minutes.length === 0) return { ok: false, reason: "Pick at least one reminder time, or choose another option." };
    const reminders: ReminderSetting = mode === "custom" ? { mode, minutes } : { mode };
    try {
      const r = await fetch(`/api/events/${encodeURIComponent(eventId)}/comms`, {
        method: "PUT",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ reminders, guests, hostUserId: host || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.settings) {
        take(d.settings);
        return { ok: true };
      }
      return { ok: false, reason: d?.error ?? "That didn't save. Try again." };
    } catch {
      return { ok: false, reason: "That didn't save. Try again." };
    }
  };

  const villageTimes = view?.village.reminderMinutes.length ? view.village.reminderMinutes.map(reminderLabel).join(", ") : "none";
  // A time saved before (or from the village dial) stays on the list even when the picker would not offer it.
  const choices = sortedReminders([...REMINDER_CHOICES, ...minutes]);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-card text-foreground hover:bg-muted"
      >
        {open ? "Hide email settings" : "Email settings"}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-border bg-card p-3 space-y-4 text-sm text-foreground">
          {!view && !note && <p className="text-muted-foreground">Loading...</p>}
          {view && (
            <>
              <fieldset>
                <legend className="font-medium">Reminders</legend>
                <div className="mt-1 space-y-1">
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`rem-${eventId}`} checked={mode === "default"} onChange={() => setMode("default")} />
                    <span>Village times: {villageTimes}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`rem-${eventId}`} checked={mode === "custom"} onChange={() => setMode("custom")} />
                    <span>Own times</span>
                  </label>
                  {mode === "custom" && (
                    <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">
                      {choices.map((m) => (
                        <label key={m} className="flex items-center gap-1.5">
                          <input type="checkbox" checked={minutes.includes(m)} onChange={() => toggleMinute(m)} />
                          <span>{reminderLabel(m)}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`rem-${eventId}`} checked={mode === "off"} onChange={() => setMode("off")} />
                    <span>No reminders</span>
                  </label>
                </div>
              </fieldset>
              <div>
                <label className="block font-medium" htmlFor={`guests-${eventId}`}>Guests without an account</label>
                <select
                  id={`guests-${eventId}`}
                  value={guests}
                  onChange={(e) => setGuests(e.target.value as GuestSetting)}
                  className="mt-1 rounded-lg border border-border bg-background px-2 py-1.5"
                >
                  <option value="default">Village setting ({view.village.guests ? "on" : "off"})</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
                <p className="mt-0.5 text-xs text-muted-foreground">Guests can say yes to a free public gathering and confirm by email.</p>
              </div>
              <div>
                <label className="block font-medium" htmlFor={`host-${eventId}`}>Host</label>
                <select
                  id={`host-${eventId}`}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="mt-1 rounded-lg border border-border bg-background px-2 py-1.5"
                >
                  <option value="">Whoever made it</option>
                  {view.hostChoices.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <p className="mt-0.5 text-xs text-muted-foreground">The host is asked for the recap after it ends.</p>
              </div>
              <SaveBar count={changed} onSave={save} onDiscard={() => view && take(view)} what="the gathering email settings" />
            </>
          )}
          {note && (
            <p role={note.ok ? "status" : "alert"} className={note.ok ? "text-teal-deep" : "text-red-700"}>{note.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
