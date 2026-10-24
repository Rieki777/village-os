/**
 * Who a member talks to (server/routes/guideChoice.ts): read the choice and
 * who answers now, and save a new choice.
 *
 *   fetchGuide   GET /api/guide
 *   saveGuide    PUT /api/guide
 *
 * Every call carries the member's token when there is one, and a failure
 * answers null, so a guide surface draws nothing it cannot back.
 */
import { authToken } from "@/lib/gameApi";
import type { GuideId, GuideState } from "@shared/guideChoice";

export const GUIDE_URL = "/api/guide";

async function call(method: "GET" | "PUT", body?: unknown): Promise<GuideState | null> {
  const t = authToken();
  try {
    const res = await fetch(GUIDE_URL, {
      method,
      headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) return null;
    return (await res.json()) as GuideState;
  } catch {
    return null;
  }
}

export const fetchGuide = () => call("GET");
export const saveGuide = (guide: GuideId) => call("PUT", { guide });
