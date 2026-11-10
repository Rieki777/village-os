/**
 * THE LAND AS A PLAN, for the backdrop behind Enter the Land.
 *
 * The gate used to sit over the drawn map. Since the map waits behind the
 * button (it is megabytes), the gate stood on a blank page. This reads the
 * village's PUBLISHED scene, the same public `GET /api/map/config` the map
 * boots from, and turns it into the shapes of a masterplan: the boundary,
 * the clearings, ponds, creeks, roads and a mark for every building.
 *
 * Nothing is drawn that the scene does not hold, so a village gets its own
 * land, and a village with nothing published gets no backdrop at all. The
 * masterplan FILE stays private to the people who draw the map; this is the
 * published land, which every visitor may already see.
 *
 * Pure, so the rules are tested without a browser.
 */

export type Pt = [number, number];

export interface LandPlan {
  viewBox: string;
  /** The property line, closed and smoothed. Null when the scene has none. */
  boundary: string | null;
  clearings: { d: string; future: boolean }[];
  ponds: { d: string; future: boolean }[];
  creeks: string[];
  roads: { d: string; paved: boolean; future: boolean }[];
  marks: { x: number; y: number; standing: boolean }[];
  /** [lat, lon] of the scene's pin, when it has one. */
  pin: Pt | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function points(v: unknown): Pt[] {
  if (!Array.isArray(v)) return [];
  const out: Pt[] = [];
  for (const p of v) {
    if (!Array.isArray(p)) continue;
    const x = num(p[0]);
    const y = num(p[1]);
    if (x !== null && y !== null) out.push([x, y]);
  }
  return out;
}

const r = (n: number) => Math.round(n * 10) / 10;

/** A Catmull-Rom curve through the points, as cubic Béziers. */
export function smoothPath(pts: Pt[], closed: boolean): string {
  if (pts.length < 2) return "";
  if (pts.length < 3) return `M${pts.map((p) => `${r(p[0])},${r(p[1])}`).join("L")}${closed ? "Z" : ""}`;
  const P: Pt[] = closed
    ? [pts[pts.length - 1], ...pts, pts[0], pts[1]]
    : [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M${r(P[1][0])},${r(P[1][1])}`;
  for (let i = 1; i < P.length - 2; i++) {
    const [a, b, c, e] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    d += `C${r(b[0] + (c[0] - a[0]) / 6)},${r(b[1] + (c[1] - a[1]) / 6)} ${r(c[0] - (e[0] - b[0]) / 6)},${r(c[1] - (e[1] - b[1]) / 6)} ${r(c[0])},${r(c[1])}`;
  }
  return d + (closed ? "Z" : "");
}

/** Phase 1 stands; a later phase is planned and drawn fainter. */
const isFuture = (phase: unknown) => {
  const n = Number(phase ?? 1);
  return Number.isFinite(n) && n > 1;
};

/** 9°13′55″N · 83°50′04″W */
export function formatLatLon([lat, lon]: Pt): string {
  const dms = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    let d = Math.floor(a);
    let m = Math.floor((a - d) * 60);
    let s = Math.round(((a - d) * 60 - m) * 60);
    if (s === 60) { s = 0; m += 1; }
    if (m === 60) { m = 0; d += 1; }
    return `${d}°${String(m).padStart(2, "0")}′${String(s).padStart(2, "0")}″${v >= 0 ? pos : neg}`;
  };
  return `${dms(lat, "N", "S")} · ${dms(lon, "E", "W")}`;
}

/**
 * The plan of a published scene, or null when there is nothing to draw.
 * Takes the scene parsed or as the JSON text the config carries.
 */
export function landPlan(input: unknown): LandPlan | null {
  let scene: any = input;
  if (typeof scene === "string") {
    try {
      scene = JSON.parse(scene);
    } catch {
      return null;
    }
  }
  if (!scene || typeof scene !== "object") return null;

  const boundaryPts = points(scene.boundary?.scene_units);
  const zones: any[] = Array.isArray(scene.map_zones) ? scene.map_zones : [];
  const structures: any[] = Array.isArray(scene.map_structures) ? scene.map_structures : [];

  const plan: LandPlan = {
    viewBox: "",
    boundary: boundaryPts.length >= 3 ? smoothPath(boundaryPts, true) : null,
    clearings: [],
    ponds: [],
    creeks: [],
    roads: [],
    marks: [],
    pin: null,
  };
  const all: Pt[] = [...boundaryPts];

  for (const z of zones) {
    if (!z || typeof z !== "object") continue;
    const area = points(z.polygon);
    const line = points(z.path ?? z.points);
    const future = isFuture(z.phase);
    if (z.geom === "area" && area.length >= 3) {
      if (z.kind === "zone") plan.clearings.push({ d: smoothPath(area, true), future });
      else if (z.kind === "water") plan.ponds.push({ d: smoothPath(area, true), future });
      else continue;
      all.push(...area);
    } else if (z.geom === "line" && line.length >= 2) {
      if (z.kind === "water") plan.creeks.push(smoothPath(line, false));
      else if (z.kind === "road") plan.roads.push({ d: smoothPath(line, false), paved: z.subtype === "paved", future });
      else continue;
      all.push(...line);
    }
  }

  for (const s of structures) {
    const x = num(s?.anchor?.x);
    const y = num(s?.anchor?.y);
    if (x === null || y === null) continue;
    plan.marks.push({ x, y, standing: !isFuture(s.phase) });
    all.push([x, y]);
  }

  if (!plan.boundary && plan.marks.length === 0 && plan.roads.length === 0) return null;
  if (all.length === 0) return null;

  // Frame the land itself (the boundary when there is one), with a margin.
  const frame = boundaryPts.length >= 3 ? boundaryPts : all;
  const xs = frame.map((p) => p[0]);
  const ys = frame.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0 || 1;
  const h = Math.max(...ys) - y0 || 1;
  const pad = Math.max(w, h) * 0.08;
  plan.viewBox = `${r(x0 - pad)} ${r(y0 - pad)} ${r(w + 2 * pad)} ${r(h + 2 * pad)}`;

  const pin = scene.map_scene?.georef?.pin;
  const lat = num(Array.isArray(pin) ? pin[0] : null);
  const lon = num(Array.isArray(pin) ? pin[1] : null);
  if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) plan.pin = [lat, lon];

  return plan;
}
