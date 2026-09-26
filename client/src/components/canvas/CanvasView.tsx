/**
 * THE CANVAS VIEW on /journey-to-launch: the season's week map above the
 * canvas baseline, with the baseline's cards ordered by the week's focus
 * (2026-09-26).
 *
 * The network for the season lives here, as the canvas's lives in
 * CanvasBaseline: the panel and its form are handed functions and hold no
 * fetch of their own. A season that cannot be read, or none at all, leaves
 * the baseline exactly as it was, in canvas order, so a village without a
 * season file (a self-hosted one, or one a release behind) loses nothing.
 */
import { useCallback, useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { seasonFocus, seasonMoment, type CanvasSeason as Season, type CanvasSeasonPayload } from "@shared/canvasSeason";
import { CanvasBaseline } from "./CanvasBaseline";
import { CanvasSeason } from "./CanvasSeason";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

export function CanvasView() {
  const [payload, setPayload] = useState<CanvasSeasonPayload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/canvas/season", { headers: headers() })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error === "auth_required" ? "Sign in to read the season." : "The season could not be read just now.");
        return d as CanvasSeasonPayload;
      })
      .then((d) => {
        setPayload(d);
        setFailed(null);
      })
      .catch((e: Error) => setFailed(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (season: Season): Promise<string | null> => {
    try {
      const r = await fetch("/api/canvas/season", { method: "PUT", headers: headers(), body: JSON.stringify(season) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return String(d?.error ?? "That season was not saved.");
      load();
      return null;
    } catch {
      return "That season did not reach the server.";
    }
  };

  const remove = async (): Promise<string | null> => {
    try {
      const r = await fetch("/api/canvas/season", { method: "DELETE", headers: headers() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return String(d?.error ?? "The season was not taken off.");
      load();
      return null;
    } catch {
      return "That did not reach the server.";
    }
  };

  const now = new Date();
  const season = payload?.season ?? null;
  const focus = seasonFocus(season, now);
  const phase = season ? seasonMoment(season, now).phase : null;

  return (
    <div className="space-y-6" data-testid="canvas-view">
      <CanvasSeason payload={payload} failed={failed} now={now} onSave={save} onRemove={remove} />
      <CanvasBaseline focus={focus} focusLabel={phase === "before" ? "First up" : "This week"} />
    </div>
  );
}
