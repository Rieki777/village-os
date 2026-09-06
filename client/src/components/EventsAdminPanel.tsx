import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ATTENDANCE_MODES, CALENDAR_LAYERS, EVENT_STATUSES, type CalendarItem, type Recurrence } from "@shared/gatherings";

/**
 * Admin, The Game, Calendar: the village calendar's own surface (0059,
 * grown in 0085).
 *
 * The module shipped API-only, which by this repo's own standard is half
 * built: a founder needed curl to put a harvest festival on the calendar.
 * This is the surface that makes it a feature. Since 0085 it also names the
 * thirteen moons and attaches external calendars by address.
 *
 * Self-contained like MapSkinPanel and LookPanel, for the same reason:
 * Admin.tsx is a large file other workstreams edit, so the mount is one line.
 *
 * Admin tabs in this app are NOT filtered by module lifecycle (the nav is a
 * flat list; the API 404s instead). So the off state is handled here, in
 * words, rather than by hiding the tab and leaving a founder wondering where
 * the calendar went.
 */

const EMPTY = {
  title: "",
  description: "",
  startsAt: "",
  endsAt: "",
  locationText: "",
  structureKeys: "",
  capacity: "",
  status: "draft",
  attendanceMode: "offline",
  onlineUrl: "",
  kind: "gathering",
  layer: "village",
  allDay: false,
  repeat: "none",
  link: "",
  // 0092: what a place costs. Blank or zero is free, which is every gathering
  // until a host decides otherwise.
  seatPrice: "",
  seatToken: "",
};
type Form = typeof EMPTY;

/** The rhythms a founder can pick from a list; anything finer is the API's. */
const REPEATS: Array<{ value: string; label: string }> = [
  { value: "none", label: "Does not repeat" },
  { value: "weekly", label: "Every week, on the start's weekday" },
  { value: "monthly", label: "Every month, on the start's day" },
  { value: "lunar:new_moon", label: "Every new moon" },
  { value: "lunar:full_moon", label: "Every full moon" },
  { value: "lunar:cycle_close", label: "Every cycle close" },
  { value: "solar:either", label: "Every solstice and equinox" },
];

function repeatToRecurrence(repeat: string, startsAtLocal: string): Recurrence | null {
  if (repeat === "none" || !repeat) return null;
  const start = new Date(startsAtLocal);
  if (repeat === "weekly") return { freq: "weekly", byWeekday: [Number.isNaN(start.getTime()) ? 1 : start.getDay()] };
  if (repeat === "monthly") return { freq: "monthly", byMonthDay: Number.isNaN(start.getTime()) ? 1 : start.getDate() };
  const [freq, on] = repeat.split(":");
  if (freq === "lunar" && (on === "new_moon" || on === "full_moon" || on === "cycle_close")) return { freq: "lunar", on };
  if (freq === "solar" && (on === "solstice" || on === "equinox" || on === "either")) return { freq: "solar", on };
  return null;
}

function recurrenceToRepeat(r: Recurrence | null | undefined): string {
  if (!r) return "none";
  if (r.freq === "weekly") return "weekly";
  if (r.freq === "monthly") return "monthly";
  return `${r.freq}:${r.on}`;
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in LOCAL time, not an ISO Z. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface MonthName { index: number; name: string; isExample: boolean }
interface ExternalCalendar {
  id: string; name: string; layer: string; colour: string | null; urlHost: string; urlLast4: string;
  lastPolledAt: string | null; lastStatus: string; lastError: string | null; importedCount: number;
}

/** 0088: a slot as the admin surface reads it, names always included. */
interface AdminSlot {
  id: string; kind: string; label: string; needed: number; note: string | null;
  takenCount: number; names?: Array<{ userId: string; name: string | null; note: string | null }>;
}

const SLOT_KIND_CHOICES = ["dish", "ride", "childcare", "setup", "other"] as const;
const WEEKDAY_CHOICES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EMPTY_SLOT = { kind: "dish", label: "", needed: "1", note: "" };

export default function EventsAdminPanel({ password }: { password: string }) {
  const [events, setEvents] = useState<CalendarItem[] | null>(null);
  const [timezone, setTimezone] = useState<string>("");
  const [moduleOff, setModuleOff] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openRsvps, setOpenRsvps] = useState<string | null>(null);
  const [rsvps, setRsvps] = useState<Record<string, any[]>>({});
  const [monthNames, setMonthNames] = useState<MonthName[] | null>(null);
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});
  const [calendars, setCalendars] = useState<ExternalCalendar[] | null>(null);
  const [calForm, setCalForm] = useState({ name: "", url: "", layer: "village", colour: "" });
  const [calBusy, setCalBusy] = useState<string | null>(null);
  // 0088: slots per gathering, and the weekly brief's settings.
  const [openSlots, setOpenSlots] = useState<string | null>(null);
  const [slots, setSlots] = useState<Record<string, AdminSlot[]>>({});
  const [slotForm, setSlotForm] = useState(EMPTY_SLOT);
  const [brief, setBrief] = useState<{ enabled: boolean; day: number; hour: number } | null>(null);
  const [briefPreview, setBriefPreview] = useState<{ subject: string; html: string } | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);

  /** 0092: which tokens a seat fee may be posted in, from the server's own firewall. */
  const [payableTokens, setPayableTokens] = useState<Array<{ slug: string; name: string }>>([]);

  const auth = { Authorization: `Bearer ${password}` };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/events", { headers: auth });
      // 404 is the module gate, not a missing route. Say which.
      if (res.status === 404) { setModuleOff(true); setEvents([]); return; }
      if (!res.ok) throw new Error();
      const data = await res.json();
      setModuleOff(false);
      setEvents(data.events ?? []);
      setTimezone(data.timezone ?? "");
      setPayableTokens(Array.isArray(data.payableTokens) ? data.payableTokens : []);
    } catch { toast.error("Could not load the calendar"); setEvents([]); }
  }, [password]);

  const loadNames = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/events/month-names", { headers: auth });
      if (!res.ok) return;
      const d = await res.json();
      setMonthNames(d.monthNames ?? []);
    } catch { /* the section stays hidden */ }
  }, [password]);

  const loadCalendars = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/events/calendars", { headers: auth });
      if (!res.ok) return;
      const d = await res.json();
      setCalendars(d.calendars ?? []);
    } catch { /* the section stays hidden */ }
  }, [password]);

  const loadBrief = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/events/brief", { headers: auth });
      if (!res.ok) return;
      const d = await res.json();
      setBrief(d.config ?? { enabled: true, day: 0, hour: 18 });
    } catch { /* the card stays hidden */ }
  }, [password]);

  useEffect(() => { load(); loadNames(); loadCalendars(); loadBrief(); }, [load, loadNames, loadCalendars, loadBrief]);

  // ── 0088: slots the crew declares ──────────────────────────────────────────

  const loadSlots = async (eventId: string) => {
    const res = await fetch(`/api/admin/events/${eventId}/slots`, { headers: auth });
    if (res.ok) { const d = await res.json(); setSlots((s) => ({ ...s, [eventId]: d.slots ?? [] })); }
  };

  const toggleSlots = async (g: CalendarItem) => {
    if (openSlots === g.id) { setOpenSlots(null); return; }
    setOpenSlots(g.id);
    setSlotForm(EMPTY_SLOT);
    if (!slots[g.id]) await loadSlots(g.id);
  };

  const addSlot = async (eventId: string) => {
    const res = await fetch(`/api/admin/events/${eventId}/slots`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: slotForm.kind, label: slotForm.label.trim(), needed: Number(slotForm.needed) || 1, note: slotForm.note.trim() || null }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d?.error ?? "That did not work"); return; }
    toast.success("Slot added");
    setSlotForm(EMPTY_SLOT);
    await loadSlots(eventId);
  };

  const removeSlot = async (eventId: string, slotId: string) => {
    const res = await fetch(`/api/admin/events/${eventId}/slots/${slotId}`, { method: "DELETE", headers: auth });
    if (res.ok) { toast.success("Slot removed"); await loadSlots(eventId); } else toast.error("That did not work");
  };

  // ── 0088: the weekly brief's evening ───────────────────────────────────────

  const saveBrief = async (next: { enabled: boolean; day: number; hour: number }) => {
    setBriefBusy(true);
    try {
      // setModuleConfig REPLACES the whole config, so carry everything else.
      const mods = await fetch("/api/admin/modules", { headers: auth });
      const all = mods.ok ? await mods.json() : { modules: [] };
      const events = (all.modules ?? []).find((m: any) => m.id === "events");
      const config = { ...(events?.config && typeof events.config === "object" ? events.config : {}), brief: next };
      const res = await fetch("/api/admin/modules/events/config", {
        method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d?.error ?? "That did not work"); }
      else { toast.success("Weekly brief settings saved"); setBrief(next); }
    } catch { toast.error("That did not work"); }
    setBriefBusy(false);
  };

  const previewBrief = async () => {
    setBriefBusy(true);
    try {
      const res = await fetch("/api/admin/events/brief", { headers: auth });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(d?.error ?? "That did not work");
      else setBriefPreview({ subject: d.subject, html: d.html });
    } catch { toast.error("That did not work"); }
    setBriefBusy(false);
  };

  const body = () => {
    const keys = form.structureKeys.split(",").map((s) => s.trim()).filter(Boolean);
    return {
      title: form.title.trim(),
      description: form.description.trim() || null,
      // The picker gives local time; the server stores UTC. Converting here
      // keeps every other reader working in one timezone.
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : "",
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      locationText: form.locationText.trim() || null,
      structureKeys: keys,
      // Blank means uncapped. "" would be read as a number by a less careful
      // server, and 0 is a real cap meaning nobody.
      capacity: form.capacity === "" ? null : Number(form.capacity),
      // Both halves travel together. The server refuses one without the other
      // out loud, which is what a host needs to hear.
      seatPrice: form.seatPrice === "" ? 0 : Number(form.seatPrice),
      seatToken: form.seatToken || null,
      status: form.status,
      attendanceMode: form.attendanceMode,
      onlineUrl: form.onlineUrl.trim() || null,
      kind: form.kind,
      layer: form.layer,
      allDay: form.allDay,
      recurrence: repeatToRecurrence(form.repeat, form.startsAt),
      link: form.link.trim() || null,
    };
  };

  const save = async () => {
    setSaving(true);
    try {
      const editingId = editing;
      const res = await fetch(
        editingId ? `/api/admin/events/${editingId}` : "/api/admin/events",
        {
          method: editingId ? "PUT" : "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify(body()),
        },
      );
      const data = await res.json().catch(() => ({}));
      // The server owns validation, so its message is the one worth showing.
      if (!res.ok) { toast.error(data?.error ?? "Save failed"); setSaving(false); return; }
      toast.success(editingId ? "Gathering updated" : "Gathering added");
      setForm(EMPTY); setEditing(null); load();
    } catch { toast.error("Save failed"); }
    setSaving(false);
  };

  const edit = (g: CalendarItem) => {
    setEditing(g.id);
    setForm({
      title: g.title,
      description: g.description ?? "",
      startsAt: toLocalInput(g.startsAt),
      endsAt: toLocalInput(g.endsAt),
      locationText: g.locationText ?? "",
      structureKeys: g.structureKeys.join(", "),
      capacity: g.capacity === null ? "" : String(g.capacity),
      status: g.status,
      attendanceMode: g.attendanceMode,
      onlineUrl: g.onlineUrl ?? "",
      kind: g.kind === "festival" ? "festival" : "gathering",
      layer: g.layer ?? "village",
      allDay: Boolean(g.allDay),
      repeat: recurrenceToRepeat(g.recurrence),
      link: g.link ?? "",
      seatPrice: g.seatPrice ? String(g.seatPrice) : "",
      seatToken: g.seatToken ?? "",
    });
  };

  const setStatus = async (g: CalendarItem, status: string) => {
    const res = await fetch(`/api/admin/events/${g.id}`, {
      method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) { toast.success(`Marked ${status}`); load(); } else toast.error("That did not work");
  };

  const remove = async (g: CalendarItem) => {
    if (!window.confirm(`Delete "${g.title}"? Answers to it go too.`)) return;
    const res = await fetch(`/api/admin/events/${g.id}`, { method: "DELETE", headers: auth });
    if (res.ok) { toast.success("Deleted"); load(); } else toast.error("That did not work");
  };

  const toggleRsvps = async (g: CalendarItem) => {
    if (openRsvps === g.id) { setOpenRsvps(null); return; }
    setOpenRsvps(g.id);
    if (rsvps[g.id]) return;
    const res = await fetch(`/api/admin/events/${g.id}/rsvps`, { headers: auth });
    if (res.ok) { const d = await res.json(); setRsvps((p) => ({ ...p, [g.id]: d.rsvps ?? [] })); }
  };

  const saveName = async (index: number) => {
    const name = nameDrafts[index] ?? "";
    const res = await fetch(`/api/admin/events/month-names/${index}`, {
      method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(d?.error ?? "That did not work"); return; }
    toast.success(d.monthName?.isExample ? `The year's moon ${index} is back to its example name` : `The year's moon ${index} named`);
    setNameDrafts((p) => { const n = { ...p }; delete n[index]; return n; });
    loadNames();
  };

  const addCalendar = async () => {
    setCalBusy("add");
    try {
      const res = await fetch("/api/admin/events/calendars", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: calForm.name.trim(), url: calForm.url.trim(), layer: calForm.layer, colour: calForm.colour.trim() || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d?.error ?? "That did not work"); }
      else {
        toast.success(d.poll?.ok ? `Attached, ${d.poll.imported} item(s) imported` : `Attached, first fetch failed: ${d.poll?.error ?? "unknown"}`);
        setCalForm({ name: "", url: "", layer: "village", colour: "" });
        loadCalendars(); load();
      }
    } catch { toast.error("That did not work"); }
    setCalBusy(null);
  };

  const pollCalendar = async (c: ExternalCalendar) => {
    setCalBusy(c.id);
    try {
      const res = await fetch(`/api/admin/events/calendars/${c.id}/poll`, { method: "POST", headers: auth });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(d?.error ?? "That did not work");
      else toast[d.poll?.ok ? "success" : "error"](d.poll?.ok ? `${d.poll.imported} item(s), ${d.poll.retired} retired` : d.poll?.error ?? "Fetch failed");
      loadCalendars(); load();
    } catch { toast.error("That did not work"); }
    setCalBusy(null);
  };

  const removeCalendar = async (c: ExternalCalendar) => {
    if (!window.confirm(`Detach "${c.name}"? Its imported items leave the calendar.`)) return;
    const res = await fetch(`/api/admin/events/calendars/${c.id}`, { method: "DELETE", headers: auth });
    if (res.ok) { toast.success("Detached"); loadCalendars(); load(); } else toast.error("That did not work");
  };

  const input = "w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2";
  const field = (label: string, key: keyof Form, type = "text", placeholder = "") => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor={`ev-${key}`}>{label}</label>
      <input id={`ev-${key}`} type={type} value={String(form[key])} placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })} className={input} />
    </div>
  );

  if (events === null) return <div className="text-center py-12 text-gray-400">Loading...</div>;

  const authored = events.filter((g) => g.kind === "gathering" || g.kind === "festival");

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Calendar</h2>
      <p className="text-sm text-gray-500 mb-5">
        The village calendar: gatherings you write here, the thirteen moons by name, and calendars you attach
        from elsewhere. Everything starts as a draft, so nothing reaches the calendar until you publish it.
        {timezone ? ` Times are village time, ${timezone.replace(/_/g, " ")}.` : ""}
      </p>

      {moduleOff && (
        <p className="mb-5 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          The Events module is off, so the calendar is not being served. Turn it on under
          Module Library and this page starts working.
        </p>
      )}

      <div className="border border-gray-200 rounded-xl p-5 mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">
          {editing ? "Edit gathering" : "Add a gathering"}
        </h3>
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          {field("Title", "title", "text", "Harvest work party")}
          {field("Where (in words)", "locationText", "text", "The greenhouse")}
          {field("Starts", "startsAt", "datetime-local")}
          {field("Ends (optional)", "endsAt", "datetime-local")}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="ev-capacity">
              Capacity
            </label>
            <input id="ev-capacity" type="number" min={0} value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              placeholder="blank = no limit" className={input} />
            {/* The distinction the whole capacity path turns on. */}
            <p className="text-[11px] text-gray-400 mt-0.5">Blank means no limit. 0 means nobody.</p>
          </div>
          {/* 0092: a gathering that asks for credits. Held from the moment
              somebody takes a place, and returned in full on every way out:
              changing their answer, leaving the queue, or this gathering
              being cancelled or taken off the calendar. */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="ev-seat-price">
              Seat fee
            </label>
            <div className="flex gap-2">
              <input id="ev-seat-price" type="number" min={0} step={1} value={form.seatPrice}
                onChange={(e) => setForm({ ...form, seatPrice: e.target.value })}
                placeholder="0" className={input} />
              <select value={form.seatToken}
                onChange={(e) => setForm({ ...form, seatToken: e.target.value })}
                className={input}>
                <option value="">Free</option>
                {payableTokens.map((t) => (
                  <option key={t.slug} value={t.slug}>{t.name}</option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Held when somebody takes a place, returned whenever they give it up.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="ev-keys">
              Map structures
            </label>
            <input id="ev-keys" value={form.structureKeys}
              onChange={(e) => setForm({ ...form, structureKeys: e.target.value })}
              placeholder="greenhouse, commons" className={input} />
            <p className="text-[11px] text-gray-400 mt-0.5">
              Comma separated. The map lights these buildings.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="ev-status">Status</label>
            <select id="ev-status" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className={`${input} bg-white`}>
              {EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="ev-mode">Attendance</label>
            <select id="ev-mode" value={form.attendanceMode}
              onChange={(e) => setForm({ ...form, attendanceMode: e.target.value })}
              className={`${input} bg-white`}>
              {ATTENDANCE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {form.attendanceMode !== "offline" && field("Online link", "onlineUrl", "text", "https://")}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="ev-kind">Kind</label>
            <select id="ev-kind" value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className={`${input} bg-white`}>
              <option value="gathering">gathering</option>
              <option value="festival">festival</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="ev-layer">Who sees it</label>
            <select id="ev-layer" value={form.layer}
              onChange={(e) => setForm({ ...form, layer: e.target.value })}
              className={`${input} bg-white`}>
              {CALENDAR_LAYERS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-0.5">village and public: anyone past the module gate. circle, household: members. admin: founders.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="ev-repeat">Repeats</label>
            <select id="ev-repeat" value={form.repeat}
              onChange={(e) => setForm({ ...form, repeat: e.target.value })}
              className={`${input} bg-white`}>
              {REPEATS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-0.5">A moon or sun rhythm lands on the village date of the sky event, at the start's time of day.</p>
          </div>
          {field("Link (optional)", "link", "text", "https:// or /quests/...")}
          <div className="flex items-center gap-2 pt-5">
            <input id="ev-allday" type="checkbox" checked={form.allDay}
              onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
            <label className="text-sm text-gray-700" htmlFor="ev-allday">All day</label>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="ev-desc">Description</label>
          <textarea id="ev-desc" rows={3} value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} />
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button onClick={save} disabled={saving}
            className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? "Saving..." : editing ? "Save changes" : "Add gathering"}
          </button>
          {editing && (
            <button onClick={() => { setEditing(null); setForm(EMPTY); }}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm">Cancel</button>
          )}
        </div>
      </div>

      {authored.length === 0 && !moduleOff && (
        <p className="text-sm text-gray-400 py-6 text-center">Nothing on the calendar yet.</p>
      )}

      {/* 0088: members' requests for the public calendar wait here. */}
      {authored.some((g) => g.status === "draft" && g.layer === "public") && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 mb-4">
          <h3 className="font-semibold text-amber-900 mb-1">Approve for the public calendar</h3>
          <p className="text-xs text-amber-800 mb-2">
            Members asked for these on the public calendar. Publishing puts them in front of visitors and search
            engines; they stay drafts until you say yes.
          </p>
          <ul className="space-y-1.5">
            {authored.filter((g) => g.status === "draft" && g.layer === "public").map((g) => (
              <li key={`approve:${g.id}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-gray-900">
                  {g.title}
                  <span className="text-xs text-gray-500"> {new Date(g.startsAt).toLocaleString()}</span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setStatus(g, "scheduled")}
                    className="px-2.5 py-1 text-xs bg-teal-deep text-white rounded-lg">Approve</button>
                  <button onClick={() => remove(g)}
                    className="px-2.5 py-1 text-xs border border-red-200 text-red-700 rounded-lg">Delete</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {authored.map((g) => (
          <div key={`${g.id}:${g.occurrenceKey}`} className="border border-gray-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="font-medium text-gray-900">
                  {g.title}
                  <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded border align-middle ${
                    g.status === "scheduled" ? "text-emerald-700 bg-emerald-50 border-emerald-100"
                    : g.status === "draft" ? "text-gray-600 bg-gray-50 border-gray-200"
                    : "text-amber-700 bg-amber-50 border-amber-100"}`}>{g.status}</span>
                  {g.recurrence && (
                    <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded border align-middle text-gray-600 bg-gray-50 border-gray-200">
                      repeats{g.occurrenceKey ? `, ${g.occurrenceKey}` : ""}
                    </span>
                  )}
                  {g.layer !== "village" && (
                    <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded border align-middle text-gray-600 bg-gray-50 border-gray-200">{g.layer}</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {timezone ? new Date(g.startsAt).toLocaleString(undefined, { timeZone: timezone }) : new Date(g.startsAt).toLocaleString()}
                  {g.locationText ? ` · ${g.locationText}` : ""}
                  {g.structureKeys.length ? ` · ${g.structureKeys.join(", ")}` : ""}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {g.capacity === null
                    ? `${g.goingCount} going, no limit`
                    : `${g.goingCount} of ${g.capacity} going`}
                  {g.spotsLeft === 0 ? " · full" : ""}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                <button onClick={() => toggleRsvps(g)}
                  className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                  {openRsvps === g.id ? "Hide answers" : "Answers"}
                </button>
                <button onClick={() => toggleSlots(g)}
                  className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                  {openSlots === g.id ? "Hide slots" : "Slots"}
                </button>
                <button onClick={() => edit(g)}
                  className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">Edit</button>
                {g.status === "draft" && (
                  <button onClick={() => setStatus(g, "scheduled")}
                    className="px-2.5 py-1 text-xs bg-teal-deep text-white rounded-lg">Publish</button>
                )}
                {g.status === "scheduled" && (
                  <button onClick={() => setStatus(g, "cancelled")}
                    className="px-2.5 py-1 text-xs border border-amber-200 text-amber-800 rounded-lg">Cancel</button>
                )}
                <button onClick={() => remove(g)}
                  className="px-2.5 py-1 text-xs border border-red-200 text-red-700 rounded-lg">Delete</button>
              </div>
            </div>

            {openRsvps === g.id && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                {(rsvps[g.id] ?? []).length === 0 && (
                  <p className="text-xs text-gray-400">Nobody has answered yet.</p>
                )}
                <ul className="text-xs text-gray-600 space-y-1">
                  {(rsvps[g.id] ?? []).map((r) => (
                    <li key={`${r.userId}:${r.occurrenceKey ?? ""}`} className="flex items-center justify-between gap-3">
                      {/* A deleted member's answer still counts toward the room,
                          so it stays listed with the tombstone spelled out. */}
                      <span>{r.name ?? "a member who has since left"}{r.occurrenceKey ? <span className="text-gray-400"> ({r.occurrenceKey})</span> : null}</span>
                      <span className="text-gray-400">{r.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 0088: what this gathering asks people to bring or hold. */}
            {openSlots === g.id && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-500 mb-2">
                  Slots the gathering asks for: a dish, a ride, childcare, setup crew. Members going can take
                  them; counts are public, names show to people going and to you.
                </p>
                {(slots[g.id] ?? []).length === 0 && (
                  <p className="text-xs text-gray-400 mb-2">No slots declared yet.</p>
                )}
                <ul className="text-xs text-gray-600 space-y-1 mb-3">
                  {(slots[g.id] ?? []).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">
                        <span className="text-gray-900">{s.label}</span>
                        <span className="text-gray-400"> ({s.kind}, {s.takenCount} of {s.needed})</span>
                        {s.names && s.names.length > 0 && (
                          <span className="text-gray-500"> {s.names.map((n) => n.name ?? "a member who has since left").join(", ")}</span>
                        )}
                      </span>
                      <button onClick={() => removeSlot(g.id, s.id)}
                        className="px-2 py-0.5 text-[11px] border border-red-200 text-red-700 rounded-lg shrink-0">Remove</button>
                    </li>
                  ))}
                </ul>
                <div className="flex items-end gap-2 flex-wrap">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-0.5" htmlFor={`slot-kind-${g.id}`}>Kind</label>
                    <select id={`slot-kind-${g.id}`} value={slotForm.kind}
                      onChange={(e) => setSlotForm({ ...slotForm, kind: e.target.value })}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                      {SLOT_KIND_CHOICES.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-[11px] font-medium text-gray-500 mb-0.5" htmlFor={`slot-label-${g.id}`}>What is needed</label>
                    <input id={`slot-label-${g.id}`} value={slotForm.label}
                      onChange={(e) => setSlotForm({ ...slotForm, label: e.target.value })}
                      placeholder="A salad for twelve" className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                  </div>
                  <div className="w-16">
                    <label className="block text-[11px] font-medium text-gray-500 mb-0.5" htmlFor={`slot-needed-${g.id}`}>How many</label>
                    <input id={`slot-needed-${g.id}`} type="number" min={1} value={slotForm.needed}
                      onChange={(e) => setSlotForm({ ...slotForm, needed: e.target.value })}
                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                  </div>
                  <button onClick={() => addSlot(g.id)} disabled={!slotForm.label.trim()}
                    className="px-3 py-1.5 text-xs bg-teal-deep text-white rounded-lg disabled:opacity-50">Add slot</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── 0088: the weekly brief's evening ─────────────────────────────── */}
      {brief && (
        <div className="border border-gray-200 rounded-xl p-5 mt-8">
          <h3 className="font-semibold text-gray-900 mb-1">The weekly brief</h3>
          <p className="text-sm text-gray-500 mb-4">
            Once a week, on the evening you pick here in village time, every member gets one digest: arrivals
            and departures, meals and gatherings, the moon and the season, open roles, new quests. Written by a
            template from the village's own records, no AI spend, and each member can turn theirs off.
          </p>
          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={brief.enabled}
                onChange={(e) => saveBrief({ ...brief, enabled: e.target.checked })} disabled={briefBusy} />
              Send the weekly brief
            </label>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-0.5" htmlFor="brief-day">Evening</label>
              <select id="brief-day" value={String(brief.day)} disabled={briefBusy}
                onChange={(e) => saveBrief({ ...brief, day: Number(e.target.value) })}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                {WEEKDAY_CHOICES.map((w, i) => <option key={w} value={i}>{w}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-0.5" htmlFor="brief-hour">From (village time)</label>
              <select id="brief-hour" value={String(brief.hour)} disabled={briefBusy}
                onChange={(e) => saveBrief({ ...brief, hour: Number(e.target.value) })}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </div>
            <button onClick={previewBrief} disabled={briefBusy}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              {briefBusy ? "Working..." : "Preview for me"}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">The preview renders this week's brief for you and sends nothing.</p>
          {briefPreview && (
            <div className="mt-4 border border-gray-200 rounded-lg p-4">
              <div className="font-medium text-gray-900 mb-2">{briefPreview.subject}</div>
              <div className="text-sm text-gray-700 [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_ul]:pl-4 [&_li]:my-0.5"
                dangerouslySetInnerHTML={{ __html: briefPreview.html }} />
            </div>
          )}
        </div>
      )}

      {monthNames && (
        <div className="border border-gray-200 rounded-xl p-5 mt-8">
          <h3 className="font-semibold text-gray-900 mb-1">The thirteen moons of the year, by name</h3>
          {/*
            THESE THIRTEEN ARE POSITIONS IN THE LUNAR YEAR, and they are the
            one place a number 1 to 13 still belongs. A name comes round every
            year, so it is keyed by where the moon sits in the year and cannot
            be keyed by the village count, which never repeats a number. Every
            member-facing surface now prints the village count instead, so this
            copy says "of the year" on every slot: the two numbers sit two
            clicks apart and nothing else tells them apart.
          */}
          <p className="text-sm text-gray-500 mb-4">
            The year's first moon begins at the first new moon after the year anchor (Game Variables, Calendar). The
            names ship as almanac examples, which describe someone else's land: write the village's own word for each
            moon. Blank restores the example. The thirteenth is the extra moon some years hold. These are positions in
            the year and they come round again; the moon number members read on the calendar counts from this
            village's first moon and never resets.
          </p>
          <ul className="grid md:grid-cols-2 gap-2">
            {monthNames.map((m) => (
              <li key={m.index} className="flex items-center gap-2">
                <span className="w-28 text-xs text-gray-500 shrink-0">Moon {m.index} of the year</span>
                <input
                  aria-label={`Name of moon ${m.index} of the lunar year`}
                  value={nameDrafts[m.index] ?? m.name}
                  onChange={(e) => setNameDrafts((p) => ({ ...p, [m.index]: e.target.value }))}
                  className={`${input} ${m.isExample && nameDrafts[m.index] === undefined ? "text-gray-500 italic" : ""}`}
                  maxLength={80}
                />
                {m.isExample && nameDrafts[m.index] === undefined && (
                  <span className="text-[10px] uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 shrink-0">example</span>
                )}
                {nameDrafts[m.index] !== undefined && (
                  <button onClick={() => saveName(m.index)}
                    className="px-2.5 py-1 text-xs bg-teal-deep text-white rounded-lg shrink-0">Save</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {calendars && (
        <div className="border border-gray-200 rounded-xl p-5 mt-8">
          <h3 className="font-semibold text-gray-900 mb-1">Calendars from elsewhere</h3>
          <p className="text-sm text-gray-500 mb-4">
            Paste a calendar's iCal address (Google Calendar's "secret address in iCal format", an Apple or Outlook
            published calendar, Luma, Meetup, any .ics) and its events join the village calendar as read-only items,
            refreshed every three hours. The address is kept in the secrets store and shown to nobody, this page
            included: only its host and last four characters appear here.
          </p>
          <div className="grid md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="xc-name">Name</label>
              <input id="xc-name" value={calForm.name} onChange={(e) => setCalForm({ ...calForm, name: e.target.value })} className={input} placeholder="Farm Google Calendar" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="xc-url">iCal address (https)</label>
              <input id="xc-url" value={calForm.url} onChange={(e) => setCalForm({ ...calForm, url: e.target.value })} className={input} placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" type="password" autoComplete="off" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="xc-layer">Who sees it</label>
              <select id="xc-layer" value={calForm.layer} onChange={(e) => setCalForm({ ...calForm, layer: e.target.value })} className={`${input} bg-white`}>
                {CALENDAR_LAYERS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1" htmlFor="xc-colour">Colour (optional)</label>
              <input id="xc-colour" value={calForm.colour} onChange={(e) => setCalForm({ ...calForm, colour: e.target.value })} className={input} placeholder="#0369a1" /* theme-ok: format hint text in an empty field, never applied as a rendered colour */ />
            </div>
          </div>
          <button onClick={addCalendar} disabled={calBusy === "add" || !calForm.name.trim() || !calForm.url.trim()}
            className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {calBusy === "add" ? "Attaching..." : "Attach calendar"}
          </button>

          {calendars.length > 0 && (
            <ul className="mt-5 space-y-2">
              {calendars.map((c) => (
                <li key={c.id} className="border border-gray-200 rounded-lg p-3 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium text-gray-900">
                      {c.name}
                      <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded border align-middle text-gray-600 bg-gray-50 border-gray-200">{c.layer}</span>
                      {c.colour && <span className="ml-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: c.colour }} aria-hidden="true" />}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {c.urlHost} (ends {c.urlLast4}) · {c.importedCount} item(s)
                      {c.lastPolledAt ? ` · fetched ${new Date(c.lastPolledAt).toLocaleString()}` : " · never fetched"}
                    </div>
                    <div className={`text-xs mt-0.5 ${c.lastStatus === "failed" ? "text-red-700" : "text-gray-500"}`}>
                      {c.lastStatus === "failed" ? `Last fetch failed: ${c.lastError ?? "unknown"}` : c.lastStatus === "ok" ? "Last fetch ok" : "Waiting for the first fetch"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => pollCalendar(c)} disabled={calBusy === c.id}
                      className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                      {calBusy === c.id ? "Fetching..." : "Fetch now"}
                    </button>
                    <button onClick={() => removeCalendar(c)}
                      className="px-2.5 py-1 text-xs border border-red-200 text-red-700 rounded-lg">Detach</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
