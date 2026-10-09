/**
 * One open room, the way GET /api/sessions/:id answers it, for the room's
 * tests. Three people: Ada facilitates, Bo is the member reading the page,
 * Cy joined and has stepped away.
 */
import { defaultSessionState, type SessionView } from "@shared/sessions";

export const T0 = Date.UTC(2026, 9, 9, 17, 0, 0);

export function makeView(over: Partial<SessionView> = {}): SessionView {
  return {
    id: 7,
    title: "Water circle",
    circleId: "water",
    circleName: "Water",
    status: "open",
    version: 3,
    serverNow: T0,
    durationMin: 60,
    state: defaultSessionState(),
    stamp: { moonName: "Waxing gibbous", moonGlyph: "o", moonOrdinal: 4, season: "spring", placeLine: "We meet on the hill above the creek." },
    facilitatorUserId: 1,
    secretaryUserId: null,
    createdAt: "2026-10-09T17:00:00.000Z",
    closedAt: null,
    people: [
      { userId: 1, name: "Ada Moss", present: true, arrival: null, wish: null, handle: "ada" },
      { userId: 2, name: "Bo Fern", present: true, arrival: 7, wish: "More sleep", handle: "bo" },
      { userId: 3, name: "Cy Reed", present: false, arrival: null, wish: null },
    ],
    items: [],
    entries: [],
    responses: [],
    facilitation: null,
    seats: [{ id: "seat1", name: "Water steward", circleId: "water" }],
    arrival: null,
    carried: null,
    me: { userId: 2, joined: true, facilitates: false, secretary: false, admin: false },
    ...over,
  };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 304 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** A recorded call: the path, the method and the parsed body. */
export interface Call {
  url: string;
  method: string;
  body: any;
  headers: Record<string, string>;
}

export function record(calls: Call[], url: string, init?: RequestInit): Call {
  const headers: Record<string, string> = {};
  const h = init?.headers;
  if (h && typeof h === "object" && !Array.isArray(h) && !(h instanceof Headers)) Object.assign(headers, h);
  const call: Call = {
    url,
    method: (init?.method ?? "GET").toUpperCase(),
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    headers,
  };
  calls.push(call);
  return call;
}
