/**
 * External calendars (0085, §9.3, R28): Admin attaches a Google Calendar,
 * an Apple, Outlook, Luma or Meetup calendar, any `.ics` by address, and the
 * scheduler mirrors it into the one calendar.
 *
 * THE URL IS A CREDENTIAL. Google's "secret address in iCal format" reads
 * the whole calendar for anyone holding it, so it is stored in the
 * integration secrets store under `external_calendar_url:<id>` (write-only
 * to the browser, read by the server) and this module's row keeps only the
 * host and the last four characters. Nothing here returns the URL, logs the
 * URL, or writes it into last_error: `scrub` strips anything URL-shaped from
 * an error before it is stored, and the poller's report names the id only.
 * putSecret takes any key string and the Secrets panel lists only
 * SECRET_KEYS, so a namespaced key never reaches that panel (tested).
 *
 * THE FETCH GOES THROUGH THE SSRF GUARD: guardedFetchText (toolcheck.ts),
 * https only, address range-checked and pinned per hop, 1 MB cap, timeout.
 * The URL is range-checked again at write time so an admin cannot store a
 * private address to begin with.
 *
 * Imports are read-only mirrors keyed by upstream UID (insert, update,
 * soft-remove when gone), kind `external`, on the layer the admin chose;
 * upstream RRULEs are expanded 365 days out through ical.js with the feed's
 * own VTIMEZONEs. RSVP still works on our side: the kitchen still counts.
 */
import { createHash } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import ICAL from "ical.js";
import { CALENDAR_LAYERS, type CalendarLayer } from "../../shared/gatherings";
import { calendarRemoveMissing, calendarUpsert } from "./calendar";
import {
  NO_VILLAGE_SECRETS_KEY_SENTENCE, putSecret, secretValue, villageSecretsConfigured, villageSecretsRefusal,
} from "./secrets";
import { guardOutboundUrl, guardedFetchText } from "./toolcheck";

export const EXTERNAL_SECRET_PREFIX = "external_calendar_url:";
const secretRefFor = (id: string) => `${EXTERNAL_SECRET_PREFIX}${id}`;
const sourceModuleFor = (id: string) => `external:${id}`;

/** What every reader gets. Never the URL. */
export interface ExternalCalendarView {
  id: string;
  name: string;
  layer: CalendarLayer;
  colour: string | null;
  urlHost: string;
  urlLast4: string;
  lastPolledAt: string | null;
  lastStatus: string;
  lastError: string | null;
  importedCount: number;
  createdAt: string;
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

function rowToView(r: RowDataPacket): ExternalCalendarView {
  return {
    id: String(r.id),
    name: String(r.name),
    layer: CALENDAR_LAYERS.includes(r.layer) ? r.layer : "village",
    colour: r.colour ?? null,
    urlHost: String(r.url_host),
    urlLast4: String(r.url_last4 ?? ""),
    lastPolledAt: iso(r.last_polled_at),
    lastStatus: String(r.last_status ?? "never"),
    lastError: r.last_error ?? null,
    importedCount: Number(r.imported_count ?? 0),
    createdAt: iso(r.created_at) ?? "",
  };
}

/**
 * Anything URL-shaped, and anything after a `?`, out of a message before it
 * is stored or shown. A Google secret address is a URL with a token in its
 * path, so both the scheme-prefixed form and bare `host/path` forms go.
 */
const safeDecode = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };

export function scrub(message: string, url?: string | null): string {
  let m = String(message ?? "");
  if (url) {
    m = m.split(url).join("<url>");
    try {
      const u = new URL(url);
      if (u.pathname.length > 1) m = m.split(u.pathname).join("<path>");
      if (u.search) m = m.split(u.search).join("");
      // Every path segment of any length worth stealing, encoded or not: a
      // Google secret address is its token in the path.
      const segments = new Set<string>();
      for (const p of [u.pathname, safeDecode(u.pathname)]) for (const seg of p.split("/")) if (seg.length >= 6) segments.add(seg);
      segments.forEach((seg) => { m = m.split(seg).join("<path>"); });
    } catch { /* not a URL: nothing more to strip */ }
  }
  m = m.replace(/https?:\/\/\S+/gi, "<url>").replace(/\?[^\s]*/g, "");
  return m.slice(0, 200);
}

export async function listExternalCalendars(pool: Pool): Promise<ExternalCalendarView[]> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM external_calendars ORDER BY created_at ASC, id ASC");
  return rows.map(rowToView);
}

export async function getExternalCalendar(pool: Pool, id: string): Promise<ExternalCalendarView | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM external_calendars WHERE id = ? LIMIT 1", [id]);
  return rows.length ? rowToView(rows[0]) : null;
}

export interface AddExternalCalendarInput {
  name: string;
  url: string;
  layer?: CalendarLayer;
  colour?: string | null;
  createdBy: string;
}

/**
 * `message`, when present, is the sentence an admin should read. It is set only
 * on the missing-key refusal, where `error` stays the store's verbatim sentence
 * and `message` names what is actually wrong with the key.
 */
export type AddOutcome =
  | { ok: true; calendar: ExternalCalendarView }
  | { ok: false; error: string; message?: string };

/** Attach a calendar. The URL goes to the secrets store; the row keeps host and last4. */
export async function addExternalCalendar(pool: Pool, input: AddExternalCalendarInput): Promise<AddOutcome> {
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "Give the calendar a name" };
  // The address is a credential and the secrets store seals it, so it refuses
  // to write without a key. Asking first keeps that refusal in this function's
  // own shape: every other failure here is an {ok:false, error} a founder can
  // read, and a thrown one would be the only 500 on the path.
  if (!villageSecretsConfigured()) {
    return { ok: false, error: NO_VILLAGE_SECRETS_KEY_SENTENCE, message: villageSecretsRefusal(process.env, "add the calendar again") };
  }
  // webcal:// is what Apple hands out; it is https underneath. The prefix is
  // rewritten as a string because WHATWG ignores a scheme change from a
  // non-special scheme on a parsed URL.
  const raw = String(input.url ?? "").trim().replace(/^webcal:\/\//i, "https://");
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return { ok: false, error: "The address must be a full URL" };
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, error: "The address must be a full URL" }; }
  if (url.protocol !== "https:") return { ok: false, error: "Calendar addresses are https only" };
  if (raw.length > 2000) return { ok: false, error: "That address is too long" };
  const guard = await guardOutboundUrl(url.toString());
  if (!guard.ok) return { ok: false, error: `That address cannot be fetched from here (${guard.refused ?? "refused"})` };
  const layer: CalendarLayer = CALENDAR_LAYERS.includes(input.layer as CalendarLayer) ? (input.layer as CalendarLayer) : "village";
  const colour = typeof input.colour === "string" && /^#[0-9a-fA-F]{3,8}$/.test(input.colour.trim()) ? input.colour.trim() : null;
  const id = `xc-${Date.now()}-${createHash("sha1").update(url.toString()).digest("hex").slice(0, 6)}`;
  const clean = url.toString();
  await putSecret(pool, secretRefFor(id), clean, input.createdBy);
  await pool.query(
    "INSERT INTO external_calendars (id, name, layer, colour, url_host, url_last4, secret_ref, created_by) VALUES (?,?,?,?,?,?,?,?)",
    [id, name, layer, colour, url.host.slice(0, 255), clean.slice(-4), secretRefFor(id), input.createdBy],
  );
  return { ok: true, calendar: (await getExternalCalendar(pool, id))! };
}

/** Detach: clear the secret, retire the mirrored rows, drop the row. */
export async function removeExternalCalendar(pool: Pool, id: string, by: string): Promise<boolean> {
  const existing = await getExternalCalendar(pool, id);
  if (!existing) return false;
  await putSecret(pool, secretRefFor(id), "", by);
  await calendarRemoveMissing(pool, sourceModuleFor(id), []);
  await pool.query("DELETE FROM external_calendars WHERE id = ?", [id]);
  return true;
}

// ── Import ──────────────────────────────────────────────────────────────────

export interface ImportedEvent {
  uid: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  cancelled: boolean;
  url: string | null;
}

const clip = (v: unknown, n: number): string | null => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s ? s.slice(0, n) : null;
};

/**
 * Parse an iCalendar text and expand it into instances inside [from, to).
 * Recurring events expand through their own VTIMEZONEs; each instance keeps
 * the master's UID plus its recurrence id, so the mirror can update and
 * retire per instance. Pure, so a test can feed it a fixture.
 */
export function parseIcs(text: string, from: Date, to: Date, cap = 2000): ImportedEvent[] {
  const jcal = ICAL.parse(text);
  const comp = new ICAL.Component(jcal);
  // The feed's own VTIMEZONEs are registered for THIS parse and forgotten
  // after it: ical.js's service is process-global, and a hostile feed must
  // not be able to redefine America/New_York for the next subscription.
  for (const vt of comp.getAllSubcomponents("vtimezone")) {
    try { ICAL.TimezoneService.register(new ICAL.Timezone(vt)); } catch { /* a broken VTIMEZONE falls back to floating */ }
  }
  try {
    return parseRegistered(comp, from, to, cap);
  } finally {
    try { ICAL.TimezoneService.reset(); } catch { /* nothing to reset */ }
  }
}

function parseRegistered(comp: InstanceType<typeof ICAL.Component>, from: Date, to: Date, cap: number): ImportedEvent[] {
  const out: ImportedEvent[] = [];
  const vevents = comp.getAllSubcomponents("vevent");
  // Overrides (RECURRENCE-ID) attach to their master through ical.js.
  const masters = vevents.filter((v) => !v.getFirstProperty("recurrence-id"));
  const overridesByUid = new Map<string, any[]>();
  for (const v of vevents) {
    if (!v.getFirstProperty("recurrence-id")) continue;
    const uid = String(v.getFirstPropertyValue("uid") ?? "");
    (overridesByUid.get(uid) ?? overridesByUid.set(uid, []).get(uid)!).push(v);
  }
  const push = (uid: string, ev: any, start: any, end: any, cancelled: boolean) => {
    if (out.length >= cap) return;
    const startsAt = start.toJSDate();
    const endsAt = end ? end.toJSDate() : null;
    if (Number.isNaN(startsAt.getTime())) return;
    if (startsAt.getTime() >= to.getTime() || (endsAt ?? startsAt).getTime() < from.getTime()) return;
    out.push({
      uid: uid.slice(0, 190),
      title: clip(ev.summary, 200) ?? "Untitled",
      description: clip(ev.description, 4000),
      location: clip(ev.location, 255),
      startsAt,
      endsAt: endsAt && endsAt.getTime() > startsAt.getTime() ? endsAt : null,
      allDay: Boolean(start.isDate),
      cancelled,
      url: (() => { const u = clip(ev.component.getFirstPropertyValue("url"), 500); return u && /^https:\/\/\S+$/.test(u) && !/[\u0000-\u001f\u007f]/.test(u) ? u : null; })(),
    });
  };
  for (const master of masters) {
    const uid = String(master.getFirstPropertyValue("uid") ?? "").trim();
    if (!uid) continue;
    let ev: any;
    try { ev = new ICAL.Event(master, { exceptions: overridesByUid.get(uid) ?? [] }); } catch { continue; }
    if (!ev.startDate) continue;
    const status = String(master.getFirstPropertyValue("status") ?? "").toUpperCase();
    const cancelled = status === "CANCELLED";
    if (!ev.isRecurring()) {
      push(uid, ev, ev.startDate, ev.endDate, cancelled);
      continue;
    }
    let it: any;
    try { it = ev.iterator(); } catch { continue; }
    let guard = 0;
    for (let next = it.next(); next && guard < 400; next = it.next(), guard++) {
      const inst = next.toJSDate();
      if (inst.getTime() >= to.getTime()) break;
      let details: any;
      try { details = ev.getOccurrenceDetails(next); } catch { continue; }
      const item = details.item ?? ev;
      const key = next.toString();
      const itemStatus = String(item.component?.getFirstPropertyValue("status") ?? "").toUpperCase();
      push(`${uid}:${key}`, item, details.startDate, details.endDate, cancelled || itemStatus === "CANCELLED");
    }
  }
  return out;
}

export interface PollResult {
  id: string;
  ok: boolean;
  imported: number;
  retired: number;
  error: string | null;
}

export interface PollDeps {
  /** The village zone (unused by import itself; kept for symmetry with the mirror). */
  timezone: string;
  now?: Date;
  /** Test seam: what fetching the address returns. Defaults to the guarded fetch. */
  fetchText?: (url: string) => Promise<string>;
}

/** Fetch one subscription and mirror it in. Never throws; the row records the outcome. */
export async function pollExternalCalendar(pool: Pool, id: string, deps: PollDeps): Promise<PollResult> {
  const cal = await getExternalCalendar(pool, id);
  if (!cal) return { id, ok: false, imported: 0, retired: 0, error: "no such calendar" };
  const url = secretValue(secretRefFor(id));
  const now = deps.now ?? new Date();
  const from = new Date(now.getTime() - 60 * 86_400_000);
  const to = new Date(now.getTime() + 365 * 86_400_000);
  const finish = async (r: Omit<PollResult, "id">) => {
    await pool.query(
      "UPDATE external_calendars SET last_polled_at = UTC_TIMESTAMP(), last_status = ?, last_error = ?, imported_count = ? WHERE id = ?",
      [r.ok ? "ok" : "failed", r.error, r.imported, id],
    );
    return { id, ...r };
  };
  if (!url) return finish({ ok: false, imported: 0, retired: 0, error: "the address is missing from the secrets store" });
  let text: string;
  try {
    text = await (deps.fetchText ?? ((u: string) => guardedFetchText(u, 15_000, 1_000_000)))(url);
  } catch (e: any) {
    return finish({ ok: false, imported: 0, retired: 0, error: `fetch failed: ${scrub(String(e?.message ?? e), url)}` });
  }
  let events: ImportedEvent[];
  try {
    events = parseIcs(text, from, to);
  } catch (e: any) {
    return finish({ ok: false, imported: 0, retired: 0, error: `not a calendar: ${scrub(String(e?.message ?? e), url)}` });
  }
  const sourceModule = sourceModuleFor(id);
  const keep: string[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    const sourceId = ev.uid.length > 190 ? createHash("sha1").update(ev.uid).digest("hex") : ev.uid;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    keep.push(sourceId);
    await calendarUpsert(pool, {
      kind: "external",
      sourceModule,
      sourceId,
      title: ev.title,
      description: ev.description,
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      allDay: ev.allDay,
      layer: cal.layer,
      colour: cal.colour,
      locationText: ev.location,
      link: ev.url,
      status: ev.cancelled ? "cancelled" : "scheduled",
      externalSourceId: id,
      externalUid: sourceId,
    });
  }
  const retired = await calendarRemoveMissing(pool, sourceModule, keep);
  return finish({ ok: true, imported: keep.length, retired, error: null });
}

/** Every subscription, one after another. Never throws. */
export async function pollAllExternalCalendars(pool: Pool, deps: PollDeps): Promise<PollResult[]> {
  const all = await listExternalCalendars(pool);
  const out: PollResult[] = [];
  for (const c of all) out.push(await pollExternalCalendar(pool, c.id, deps));
  return out;
}
