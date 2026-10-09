/**
 * THE OPEN MAP FOLLOWS THE VILLAGE'S LIVE ORG (Rye, D3).
 *
 * "We need to wire it up so the map can realtime update to new seats, and
 * circle structures, etc." The map draws the village's circles and seats on
 * the land, and until now it learned them once, when it booted: a seat a
 * steward created in the org tools reached an open map only on a reload.
 *
 * So the shell polls `GET /api/map/org` while the map is on screen, and hands
 * the map a fresh `lens` message only when the answer changed. The server
 * names every answer with a version (a hash of exactly what the map draws,
 * server/lib/mapOrg.ts), the shell sends that version back as If-None-Match,
 * and an unchanged village answers 304 with no body. Nothing is parsed,
 * posted or redrawn for a poll that found nothing.
 *
 * PAUSED WHILE NOBODY CAN SEE IT. A hidden tab polls nothing, and the moment
 * it is shown again it asks once at once, so a map left open in a background
 * tab all afternoon is current the instant somebody looks at it, without
 * having spent the afternoon asking.
 *
 * STOPPED BY A REFUSAL. A 401, 403 or 404 is an answer that will not change
 * on its own: a visitor to a village that keeps its map to members, or a
 * deployment without the route. Asking again every fifteen seconds would only
 * log the same refusal. A network failure or a 5xx is not that, so the poll
 * carries on at its interval and catches up when the village answers again.
 *
 * WHY A POLL, and not a stream: server/routes/mapOrg.ts says it in full. In
 * short, every route authenticates by a Bearer header an EventSource cannot
 * send, and one interval is the whole requirement.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { authToken, gameFetch } from "@/lib/gameApi";

/** How often an open, visible map asks. A new seat is on the land within this. */
export const ORG_POLL_MS = 15_000;

export interface LensCircle {
  id: string;
  name: string;
  parentCircleId: string | null;
  status: string;
  colour: string;
}

export interface LensRole {
  id: string;
  name: string;
  circleId: string | null;
  state: string;
  seats: number;
  holderCount: number;
  archetypes: string[];
  description: string;
  /** Names only, and only on the tier the server sends them to. */
  holders: string[];
}

export interface LensOrg {
  version: string;
  circles: LensCircle[];
  roles: LensRole[];
}

/**
 * The server's answer, in the shape the map's `lens` message carries.
 *
 * Defensive on every field because the map is a separate document that trusts
 * nothing it is handed, and a row with no name has nothing to be drawn as.
 */
export function lensFromOrg(body: any): LensOrg | null {
  if (!body || typeof body !== "object" || typeof body.version !== "string") return null;
  const str = (v: unknown) => (v == null ? "" : String(v));
  const circles: LensCircle[] = Array.isArray(body.circles)
    ? body.circles
        .filter((c: any) => c && typeof c.id === "string" && typeof c.name === "string")
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          parentCircleId: c.parentCircleId ? str(c.parentCircleId) : null,
          status: str(c.status || "active"),
          colour: /^#[0-9a-f]{6}$/i.test(str(c.colour)) ? str(c.colour) : "",
        }))
    : [];
  const roles: LensRole[] = Array.isArray(body.roles)
    ? body.roles
        .filter((r: any) => r && typeof r.name === "string" && r.name.trim())
        .map((r: any) => ({
          id: str(r.id),
          name: r.name,
          circleId: r.circleId ? str(r.circleId) : null,
          state: str(r.state || "open"),
          seats: Number(r.seats) || 1,
          holderCount: Number(r.holderCount) || 0,
          archetypes: Array.isArray(r.archetypes) ? r.archetypes.map(String) : [],
          description: str(r.description),
          holders: Array.isArray(r.holders)
            ? r.holders.map((h: any) => str(h?.name)).filter(Boolean)
            : [],
        }))
    : [];
  return { version: body.version, circles, roles };
}

export type OrgAnswer =
  | { kind: "fresh"; org: LensOrg }
  | { kind: "same" }
  | { kind: "refused"; status: number }
  | { kind: "failed" };

/**
 * One ask. `since` is the version the map is already drawing, or nothing for
 * the first ask. A 200 that carries the version already held is "same" too,
 * which is what a proxy that drops If-None-Match turns a 304 into.
 */
export async function fetchOrg(since?: string | null): Promise<OrgAnswer> {
  try {
    const res = await gameFetch("/api/map/org", since ? { headers: { "If-None-Match": `"org-${since}"` } } : {});
    if (res.status === 304) return { kind: "same" };
    if (res.status === 401 || res.status === 403 || res.status === 404) return { kind: "refused", status: res.status };
    if (!res.ok) return { kind: "failed" };
    const org = lensFromOrg(await res.json().catch(() => null));
    if (!org) return { kind: "failed" };
    return since && org.version === since ? { kind: "same" } : { kind: "fresh", org };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * Which characters this player has chosen, as archetype keys.
 *
 * A party is a signed-in player's. With no session the route answers 401,
 * which the browser logged on every signed-out visit, and the lens reads that
 * as no party. Not asking reads the same.
 */
export async function fetchParty(): Promise<string[]> {
  if (!authToken()) return [];
  try {
    const res = await gameFetch("/api/me/characters");
    if (!res.ok) return [];
    const body = await res.json().catch(() => null);
    return Array.isArray(body?.party)
      ? body.party.map((c: any) => String(c?.archetypeKey ?? "")).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

/** The tab is in front of somebody. jsdom and an old engine with no API count as yes. */
function visible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * The lens push the shell makes when the map boots, and the poll that keeps
 * it current afterwards.
 *
 * `live` is the artifact's grounds-ready: before it there is nobody listening
 * in the frame. `pushLens` is what grounds-ready calls; it asks for the party
 * and the org together and sends one message. Every later message carries the
 * party it found, because the map reads an absent party as "no narrowing" and
 * a poll that dropped it would widen a player's map behind their back.
 */
export function useOrgFollow({
  frame,
  live,
  intervalMs = ORG_POLL_MS,
}: {
  frame: RefObject<HTMLIFrameElement | null>;
  live: boolean;
  intervalMs?: number;
}): { pushLens: () => Promise<void> } {
  const party = useRef<string[]>([]);
  const version = useRef<string | null>(null);
  const stopped = useRef(false);
  const asking = useRef(false);

  const post = useCallback((org: LensOrg | null) => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        org
          ? { type: "lens", party: party.current, roles: org.roles, circles: org.circles, orgVersion: org.version }
          : { type: "lens", party: party.current, roles: [] },
        window.location.origin,
      );
    } catch {
      /* The frame went away under the fetch: the lens keeps what it has. */
    }
  }, [frame]);

  const pushLens = useCallback(async () => {
    asking.current = true;
    try {
      const [p, answer] = await Promise.all([fetchParty(), fetchOrg(null)]);
      party.current = p;
      if (answer.kind === "fresh") {
        version.current = answer.org.version;
        stopped.current = false;
        post(answer.org);
        return;
      }
      if (answer.kind === "refused") stopped.current = true;
      // No org to send, and the party still has to reach the map. An empty
      // list is what the map already reads as "the village has not said".
      post(null);
    } finally {
      asking.current = false;
    }
  }, [post]);

  const poll = useCallback(async () => {
    if (stopped.current || asking.current || !visible() || !frame.current?.contentWindow) return;
    asking.current = true;
    try {
      const answer = await fetchOrg(version.current);
      if (answer.kind === "fresh") {
        version.current = answer.org.version;
        post(answer.org);
      } else if (answer.kind === "refused") {
        stopped.current = true;
      }
    } finally {
      asking.current = false;
    }
  }, [frame, post]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void poll(), intervalMs);
    const onShow = () => {
      if (visible()) void poll();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [live, intervalMs, poll]);

  return { pushLens };
}
