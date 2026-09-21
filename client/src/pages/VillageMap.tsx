/**
 * How power is held (0083, R29): /map/circles rebuilt as the power map.
 *
 * The 14-point interaction spec drives the page: tap-to-zoom with a real
 * breadcrumb, five seat glyphs, deterministic search, filters as chips,
 * relation lines on demand, term and season time, a legend with counts and
 * the shape spectrum, keyboard and screen-reader paths, an accordion where
 * a canvas would be worse, and print/export. The SHAPE morphs the picture:
 * `layoutForShape` draws the same circles as rings, a pyramid, a council, a
 * flat ring, a steward's trust or a network, and framer-motion carries the
 * seats between them.
 *
 * The layout stays `shared/mapLayout` pure functions; the camera is a pure
 * reducer (components/power/camera.ts); this file owns only wiring: fetch,
 * URL, state, and which furniture shows at which width.
 */
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { useEffect, useMemo, useRef, useState } from "react";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { layoutForShape, type NestedInput } from "@shared/mapLayout";
import { cssColourForCircle } from "@shared/circleView";
import { authToken } from "@/lib/gameApi";
import { rememberMapAvailable } from "@/lib/landing";
import { ChevronDown, Download, Link2, List, Map as MapIcon, X } from "lucide-react";
import { ExampleChip, ExamplesBanner, useExampleModules } from "@/components/ExamplesBanner";
import { FirstWalkInvite } from "@/pages/FirstWalk";
import PowerMap from "@/components/power/PowerMap";
import Breadcrumb from "@/components/power/Breadcrumb";
import Legend from "@/components/power/Legend";
import SearchBar, { type SearchHit } from "@/components/power/SearchBar";
import FilterChips from "@/components/power/FilterChips";
import HolderCard from "@/components/power/HolderCard";
import CircleCard from "@/components/power/CircleCard";
import CirclePeek from "@/components/power/CirclePeek";
import SeatSheet from "@/components/power/SeatSheet";
import { phoneDepthFor } from "@/components/power/phoneDepth";
import { phoneKeysFor } from "@/components/power/phoneKeys";
import ShapePicker from "@/components/power/ShapePicker";
import CurrencyPicker from "@/components/power/CurrencyPicker";
import DecideLens, { DecideKey } from "@/components/power/DecideLens";
// Lane L3: the resources lens rides PowerMap's `lenses` seam and the
// layout's pad argument; these two imports and the wiring below are its
// whole footprint in this file.
import ResourcesLens, { ResourcesKey, RESOURCES_PAD, useResources } from "@/components/power/ResourcesLens";
import ResourcesPanel from "@/components/power/ResourcesPanel";
import SetupWalk from "@/components/power/SetupWalk";
import ArrangeBar from "@/components/power/ArrangeBar";
import ArrangeLens from "@/components/power/ArrangeLens";
import { useArrange } from "@/components/power/useArrange";
import { withMoves } from "@/components/power/arrange";
import { useVision, VisionGhosts, VisionPanel } from "@/components/power/VisionLayer";
import {
  NO_FILTERS,
  seatPassesFilters,
  type Filters,
  type PowerData,
  type PowerSeat,
  type Selection,
} from "@/components/power/types";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/**
 * The modules that draw this one page, and they retire independently. The
 * flag rides every node so each set is marked on its own.
 */
const EXAMPLE_SETS: Array<{ id: string; noun: string }> = [
  { id: "map", noun: "circle" },
  { id: "progression", noun: "role" },
  { id: "quests", noun: "quest" },
];

/** The focus the URL carries, so a view is a link and Back works (spec 1). */
function focusFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("focus");
}

export default function VillageMap() {
  const modules = useModules();
  const mapModule = useModule("map");
  const { modules: exampleModules } = useExampleModules();
  const [data, setData] = useState<PowerData | null>(null);
  const [denied, setDenied] = useState(false);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);

  const [focusId, setFocusId] = useState<string | null>(() => focusFromUrl());
  const [selected, setSelected] = useState<Selection>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [personName, setPersonName] = useState<string | null>(null);
  const [linesOn, setLinesOn] = useState(false);
  const [pulseSeatId, setPulseSeatId] = useState<string | null>(null);
  const [listMode, setListMode] = useState(false);
  const [shapePreview, setShapePreview] = useState<string | null>(null);
  const [lensOn, setLensOn] = useState(false);
  const [lensDomain, setLensDomain] = useState<string | null>(null);
  const [resourcesOn, setResourcesOn] = useState(false);
  const [mode, setMode] = useState<"now" | "vision">("now");
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  const [walkOpen, setWalkOpen] = useState(false);
  const [arranging, setArranging] = useState(false);
  // A publish in flight: the gestures and the Arrange toggle wait for its answer.
  const [publishing, setPublishing] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const vision = useVision(mode === "vision");
  const resourcesModule = useModule("resources");
  const resources = useResources(resourcesOn && !!resourcesModule);

  /*
   * ARRANGE MODE draws the village as the pending moves leave it, and the
   * things that read structure read that picture: the layout, both canvases
   * and the breadcrumb. `data` stays the published truth, which is what every
   * refusal and the Publish bar measure against.
   */
  // Off in list mode, where there is no map to arrange, and while a publish is in flight.
  const arrange = useArrange({ on: arranging && !listMode && !publishing, svgRef, live: data?.circles ?? null });
  const shown = useMemo(
    () => (data && arranging && arrange.moves.length ? { ...data, circles: withMoves(data.circles, arrange.moves) } : data),
    [data, arranging, arrange.moves],
  );

  /** The fresh picture, or null when it did not arrive. Arrange checks its moves against it before writing anything. */
  const refetchMap = (): Promise<PowerData | null> =>
    fetch("/api/map", { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: PowerData) => {
        setData(d);
        return d;
      })
      .catch((status) => {
        if (status === 401) setDenied(true);
        return null;
      });

  useEffect(() => {
    if (!mapModule) return;
    refetchMap();
    const t = authToken();
    if (t) {
      fetch("/api/profile", { headers: headers() })
        .then((r) => (r.ok ? r.json() : null))
        .then((u) => {
          setViewerUserId(u?.id ?? null);
          setViewerIsAdmin(u?.role === "admin" || u?.role === "founder");
        })
        .catch(() => {});
    }
  }, [mapModule?.id]);

  // Cache visibility for the landing decision on the NEXT visit.
  useEffect(() => {
    if (modules.loaded) rememberMapAvailable(Boolean(mapModule));
  }, [modules.loaded, mapModule?.id]);

  // ?focus= lives in the URL: push on change, follow the Back button.
  const focusTo = (id: string | null) => {
    setFocusId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("focus", id);
    else url.searchParams.delete("focus");
    window.history.pushState({}, "", url.toString());
  };
  useEffect(() => {
    const onPop = () => setFocusId(focusFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Arrange pins the declared shape: a previewed one would move every drop target mid-drag.
  const shape = (arranging ? null : shapePreview) ?? data?.power.shape ?? "circle";

  const layout = useMemo(() => {
    if (!data || !shown) return null;
    const inputs: NestedInput[] = shown.circles.map((c) => ({
      id: c.id,
      parentId: c.parentCircleId ?? null,
      order: c.order ?? 0,
      memberCount: data.roles.filter((r) => r.circleId === c.id).reduce((n, r) => n + r.holderCount, 0),
      roles: data.roles.filter((r) => r.circleId === c.id).map((r) => ({ id: r.id, vacant: r.vacant })),
      questCount: data.quests.filter((q) => q.circleId === c.id).length,
      name: String(c.name ?? c.id),
    }));
    const villageRoles = data.roles.filter((r) => !r.circleId).map((r) => ({ id: r.id, vacant: r.vacant }));
    // The resources ring draws AROUND the village, so the canvas grows by
    // the pad while that lens is on; pad 0 hands back the base layout.
    return layoutForShape(shape, inputs, villageRoles, resourcesOn ? RESOURCES_PAD : 0);
  }, [data, shown, shape, resourcesOn]);

  // A focus pointing at a circle the layout does not draw falls back to the
  // village, so a stale link cannot strand the camera.
  useEffect(() => {
    if (!layout || !focusId) return;
    if (!layout.circles.some((c) => c.id === focusId)) setFocusId(null);
  }, [layout, focusId]);

  const pickFromSearch = (hit: SearchHit) => {
    if (hit.kind === "circle") {
      focusTo(hit.id);
      return;
    }
    if (hit.kind === "holder" && hit.holderKey) {
      setFilters((f) => ({ ...f, person: hit.holderKey! }));
      setPersonName(hit.title);
    }
    if (hit.circleId) focusTo(hit.circleId);
    setSelected({ kind: "role", id: hit.id });
    setPulseSeatId(hit.id);
    window.setTimeout(() => setPulseSeatId(null), 3800);
  };

  const pickPerson = (holderKey: string, name: string | null) => {
    setFilters((f) => ({ ...f, person: f.person === holderKey ? null : holderKey }));
    setPersonName(name);
  };

  const selectedSeat: PowerSeat | null =
    selected?.kind === "role" ? (data?.roles?.find((r) => r.id === selected.id) ?? null) : null;
  const selectedCircle = selectedSeat?.circleId
    ? (data?.circles?.find((c) => c.id === selectedSeat.circleId) ?? null)
    : null;
  /*
   * THE CIRCLE YOU ARE STANDING IN.
   *
   * Stepping into a circle changed the picture and nothing else: the panel
   * went on showing the village summary until a SEAT was tapped, so the
   * question a reader arrives with (what does this circle do, who do I bring
   * what to) had no surface anywhere. This is the focus, read as a circle,
   * and it drives the inspector on both the standing panel and the sheet.
   */
  // The arranged picture, so the card and the canvas agree about where the focus sits.
  const focusedCircle = focusId ? ((shown ?? data)?.circles?.find((c) => c.id === focusId) ?? null) : null;

  /*
   * HOW DEEP THE PHONE DRAWS.
   *
   * One level at a time, because seventeen circles and their children in a
   * 375px square is a picture nobody can use: a grandchild is a few pixels
   * across and its seats are smaller than a fingertip. Undefined on desktop,
   * where there is room for the whole nest.
   *
   * The rule is `phoneDepthFor`, and it is NOT simply one level down from the
   * camera: a level holding a single circle is descended past. Nesting this
   * village under the General Coordinating Circle made the top level one disc,
   * and the phone drew exactly that, correctly and uselessly. The helper
   * carries the measurement that found it.
   */
  const phoneMaxDepth = useMemo(() => phoneDepthFor(layout?.circles ?? [], focusId), [layout, focusId]);

  /*
   * THE KEY UNDER THE PHONE MAP (2026-09-21). A phone circle is too small for
   * its name, so the circles a reader is choosing between carry a number,
   * counted clockwise from twelve o'clock (`phoneKeysFor`), and a list under
   * the map names every number. The first tap on a numbered circle names it on
   * the map; the second steps in. Stepping anywhere clears the name.
   *
   * Stepping in shows the circle as a peek under the map, and its full card
   * only once asked for (`sheetOpen`), so every step starts from the peek.
   */
  const [namedId, setNamedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    setNamedId(null);
    setSheetOpen(false);
  }, [focusId]);
  const phoneKeys = useMemo(() => {
    if (!layout || !data) return [];
    const parent = new Map(data.circles.map((c) => [c.id, (c.parentCircleId as string | null) ?? null]));
    return phoneKeysFor(layout.circles, (id) => parent.get(id) ?? null, focusId, phoneMaxDepth);
  }, [layout, data, focusId, phoneMaxDepth]);
  const phoneKeyMap = useMemo(() => new Map(phoneKeys.map((k) => [k.id, k.key])), [phoneKeys]);

  const mayDeclareVillage = !!data?.viewer.mayDeclare?.includes("village");

  // Both canvases draw the same lens nodes through PowerMap's `lenses`
  // seam, exactly the seam L3's resources ring uses without editing here.
  const lensNodes =
    data && layout ? (
      <>
        {lensOn && <DecideLens layout={layout} circles={data.circles} power={data.power} domain={lensDomain} />}
        {resourcesOn && resources && <ResourcesLens layout={layout} circles={data.circles} resources={resources} />}
        {mode === "vision" && <VisionGhosts layout={layout} drafts={vision.drafts} />}
        {arranging && <ArrangeLens layout={layout} picked={arrange.picked} target={arrange.target} refused={!!arrange.refusal} />}
      </>
    ) : null;

  const exportSvg = () => {
    const el = svgRef.current;
    if (!el) return;
    const clone = el.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "power-map.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportPng = () => {
    const el = svgRef.current;
    if (!el || !layout) return;
    const clone = el.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const svgText = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = layout.width * 2;
      canvas.height = layout.height * 2;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = "power-map.png";
        a.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  // The framework decides existence. ModuleGate keeps the ordinary 404 for
  // off and preview, and offers sign-in when the module is members-only and
  // the visitor simply is not signed in yet (R36).
  if (modules.loaded && !mapModule) return <ModuleGate moduleId="map" name="How Power Is Held" />;

  return (
    <Layout>
      {/* Print (spec 14): the chrome goes, the picture and the list stay. */}
      <style>{`@media print {
        [data-power-search], [data-power-filters], [data-power-actions],
        [data-power-shape-picker], nav, footer, [data-power-card] button { display: none !important; }
        [data-power-map-box] { height: auto !important; }
      }`}</style>

      {/* WHAT A PHONE SPENDS BEFORE IT REACHES THE PICTURE.
          Measured on the live site at 390x844: the site header took 135px,
          this title and its subtitle 124, and the examples banner with the
          walk invite another 210. The map began at 469 of 844 and its last
          80px ran under the tab bar, so a reader met a third of a circle.

          The title stays, because a page says what it is. The subtitle is a
          second saying of the same thing and waits for the room to say it.
          The two invitations moved BELOW the map, beside the search that
          also acts on it. */}
      <section className="py-6 sm:py-10 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-foreground mb-2 sm:mb-3">How Power Is Held</h1>
          <p className="hidden sm:block text-muted-foreground max-w-xl mx-auto">
            The village's shape, how each circle decides, who holds each seat, and the seats waiting
            for someone like you.
          </p>
        </div>
      </section>

      {/* THE LENS IS ITS OWN WORLD, and `circle-lens` is what makes it one.
          It re-declares the semantic tokens for this subtree only (see
          index.css), so every surface inside, the search box, the chips, the
          panel, the legend, the accordion and the sheet, arrives on the
          living map's ground with the pairing it was written against. The
          rest of the site is untouched.

          Crossing from the land to the circles used to mean leaving the world
          and arriving somewhere that shared only the data. */}
      <section className="circle-lens py-6 bg-background text-foreground">
        <div className="container max-w-7xl">
          {denied && (
            <p className="text-center text-muted-foreground py-16">Sign in to see the village map.</p>
          )}
          {data && layout && (
            <>
              {/* THE MAP COMES FIRST ON A PHONE.
                  It used to sit under the search box, the breadcrumb, the
                  lens row and three rows of filter chips: measured on a
                  390x844 handset, the picture began below the fold and the
                  whole first screen was controls for a thing you could not
                  see yet. A reader arriving at "how power is held" should
                  meet the village, then the tools for filtering it.

                  Phone only. From `sm` up the standing canvas below is the
                  map and this is hidden, so the order here costs the desktop
                  nothing. */}
              {!listMode && (
                <div className="sm:hidden -mx-4 mb-4">
                  <div className="relative aspect-square block" data-power-map-box>
                    <PowerMap
                      data={shown ?? data}
                      layout={layout}
                      shape={shape}
                      focusId={focusId}
                      onFocus={focusTo}
                      selected={selected}
                      onSelect={setSelected}
                      filters={filters}
                      viewerUserId={viewerUserId}
                      linesOn={linesOn}
                      pulseSeatId={pulseSeatId}
                      lenses={lensNodes}
                      // The phone draws one level at a time; the breadcrumb
                      // is the way down, and the accordion below carries the
                      // rest. Seventeen circles and their children in a
                      // 375px square is a picture nobody can use.
                      maxDepth={phoneMaxDepth}
                      // And a name only where it fits INSIDE its circle. At
                      // 358px the floor made every label legible and then
                      // piled fifteen of them on top of each other.
                      compact
                      keys={phoneKeyMap}
                      namedId={namedId}
                      onName={setNamedId}
                    />
                  </div>
                  {/* THE KEY. Every number on the map, named, in the order it
                      is counted round the ring. A row steps into its circle;
                      the one a tap has named on the map is marked here too. */}
                  {phoneKeys.length > 0 && (
                    <ol aria-label="The circles on the map, by number" className="grid grid-cols-2 gap-2 px-4 mt-3">
                      {phoneKeys.map(({ id, key }) => {
                        const circle = data.circles.find((o) => o.id === id);
                        const named = namedId === id;
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              onClick={() => focusTo(id)}
                              aria-current={named ? "true" : undefined}
                              className={`w-full min-h-[44px] flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm text-foreground ${
                                named ? "border-foreground/60 bg-muted" : "border-border bg-card"
                              }`}
                            >
                              <span
                                className="shrink-0 w-6 h-6 rounded-full border-2 grid place-items-center text-xs font-semibold"
                                style={{ borderColor: cssColourForCircle({ id, color: circle?.color ?? null }) }}
                              >
                                {key}
                              </span>
                              <span className="min-w-0 text-[13px] leading-snug hyphens-auto break-words">{circle?.name ?? id}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              )}

              {/* THE TWO INVITATIONS, UNDER THE PICTURE THEY POINT AT.
                  Above the map they cost a phone 210 of its 844 pixels
                  before anything was drawn. The map block above is
                  `sm:hidden`, so from `sm` up these sit exactly where they
                  always did: above the standing canvas, under the title. */}
              {EXAMPLE_SETS.filter((s) => exampleModules.includes(s.id)).map((s) => (
                <ExamplesBanner key={s.id} moduleId={s.id} noun={s.noun} />
              ))}
              <div className="max-w-2xl mx-auto text-left mt-4 mb-2">
                <FirstWalkInvite />
              </div>

              <SearchBar data={data} onPick={pickFromSearch} />

              <div className="flex items-center justify-between gap-2 flex-wrap mt-4 mb-2">
                <Breadcrumb
                  villageName="Village"
                  circles={(shown ?? data).circles}
                  focusId={focusId}
                  filters={filters}
                  onFocus={focusTo}
                  onClearFilters={() => {
                    setFilters(NO_FILTERS);
                    setPersonName(null);
                  }}
                />
                <div className="flex items-center gap-1.5 flex-wrap" data-power-actions>
                  <div role="group" aria-label="Now or Vision" className="inline-flex rounded-full border border-border overflow-hidden">
                    <button
                      type="button"
                      aria-pressed={mode === "now"}
                      onClick={() => setMode("now")}
                      className={`text-xs px-2.5 py-1 ${mode === "now" ? "bg-teal-deep text-white" : "bg-card text-muted-foreground"}`}
                    >
                      Now
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === "vision"}
                      onClick={() => setMode("vision")}
                      className={`text-xs px-2.5 py-1 ${mode === "vision" ? "bg-teal-deep text-white" : "bg-card text-muted-foreground"}`}
                    >
                      Vision
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-pressed={lensOn}
                    onClick={() => setLensOn((v) => !v)}
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
                      lensOn ? "bg-teal-deep text-white border-teal-deep" : "bg-card text-muted-foreground border-border"
                    }`}
                  >
                    How we decide
                  </button>
                  {data.viewer.mayArrange && !listMode && (
                    <button
                      type="button"
                      aria-pressed={arranging}
                      disabled={publishing}
                      onClick={() => {
                        if (!arranging) setShapePreview(null);
                        setArranging((v) => !v);
                      }}
                      data-arrange-toggle
                      // A mouse, pen or trackpad, on a screen wide enough for the card beside the canvas, which holds the bar.
                      className={`hidden md:any-pointer-fine:inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border disabled:opacity-40 ${
                        arranging ? "bg-teal-deep text-white border-teal-deep" : "bg-card text-muted-foreground border-border"
                      }`}
                    >
                      {arranging || !arrange.moves.length ? "Arrange circles" : `Arrange circles (${arrange.moves.length} not published)`}
                    </button>
                  )}
                  {resourcesModule && (
                    <button
                      type="button"
                      aria-pressed={resourcesOn}
                      onClick={() => setResourcesOn((v) => !v)}
                      data-resources-toggle
                      className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
                        resourcesOn ? "bg-teal-deep text-white border-teal-deep" : "bg-card text-muted-foreground border-border"
                      }`}
                    >
                      Resources
                    </button>
                  )}
                  <button
                    type="button"
                    aria-pressed={linesOn}
                    onClick={() => setLinesOn((v) => !v)}
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
                      linesOn ? "bg-teal-deep text-white border-teal-deep" : "bg-card text-muted-foreground border-border"
                    }`}
                  >
                    <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Links
                  </button>
                  <button
                    type="button"
                    aria-pressed={listMode}
                    onClick={() => setListMode((v) => !v)}
                    className={`hidden sm:inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
                      listMode ? "bg-teal-deep text-white border-teal-deep" : "bg-card text-muted-foreground border-border"
                    }`}
                  >
                    {listMode ? <MapIcon className="w-3.5 h-3.5" aria-hidden="true" /> : <List className="w-3.5 h-3.5" aria-hidden="true" />}
                    {listMode ? "Map" : "List"}
                  </button>
                  <button
                    type="button"
                    onClick={exportSvg}
                    className="hidden sm:inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border bg-card text-muted-foreground border-border"
                    aria-label="Download the map as SVG"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" /> SVG
                  </button>
                  <button
                    type="button"
                    onClick={exportPng}
                    className="hidden sm:inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border bg-card text-muted-foreground border-border"
                    aria-label="Download the map as PNG"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" /> PNG
                  </button>
                </div>
              </div>

              <div className="mb-3 space-y-2" data-power-filters-row>
                <FilterChips
                  filters={filters}
                  onChange={setFilters}
                  circles={data.circles.filter((c) => !c.isExample || data.circles.every((x) => x.isExample))}
                  signedIn={!!viewerUserId}
                  personName={personName}
                />
                {lensOn && (
                  <div className="flex items-center gap-2 flex-wrap" data-power-lens-row>
                    <div role="group" aria-label="Which domain" className="flex items-center gap-1">
                      {[null, ...data.power.glossary.domains.map((d) => d.id)].map((d) => {
                        const def = d ? data.power.glossary.domains.find((x) => x.id === d) : null;
                        return (
                          <button
                            key={d ?? "overall"}
                            type="button"
                            aria-pressed={lensDomain === d}
                            title={def?.gloss}
                            onClick={() => setLensDomain(d)}
                            className={`text-xs px-2 py-1 rounded-full border ${
                              lensDomain === d
                                ? "bg-teal-deep text-white border-teal-deep"
                                : "bg-card text-muted-foreground border-border"
                            }`}
                          >
                            {def?.label ?? "Overall"}
                          </button>
                        );
                      })}
                    </div>
                    <DecideKey circles={data.circles} power={data.power} domain={lensDomain} />
                  </div>
                )}
                {resourcesOn && resources && <ResourcesKey resources={resources} />}
              </div>

              {mode === "vision" && (
                <div className="mb-4 max-w-2xl">
                  <VisionPanel drafts={vision.drafts} isAdmin={viewerIsAdmin} />
                </div>
              )}

              {resourcesOn && (
                <div className="mb-4 max-w-2xl">
                  <ResourcesPanel resources={resources} circles={data.circles} />
                </div>
              )}

              {/* Desktop and tablet: the canvas, the legend riding its corner,
                  the card standing beside it. Below sm (spec 12's 480): the
                  accordion IS the page, with the card as a bottom sheet. */}
              {!listMode && (
                <div className="hidden sm:flex gap-6 items-start">
                  {/* The stage is HEIGHT-driven and the drawing is a disc, so
                      this number is the one that decides how big the picture
                      renders. At 74vh on a 720px screen the canvas was 533px
                      tall inside an 864px-wide column: the disc fitted to the
                      height, drew at 0.51x, and left 331px of width empty.
                      Taller stage, bigger disc, and the width beside it is
                      the gutter a long name is now allowed to use. */}
                  <div
                    className={`relative flex-1 min-w-0 aspect-square md:aspect-auto md:h-[86vh] md:min-h-[560px] md:max-h-[980px]${
                      arranging ? " [&_[data-circle-id]]:cursor-grab" : ""
                    }`}
                    data-power-map-box
                  >
                    <PowerMap
                      data={shown ?? data}
                      layout={layout}
                      shape={shape}
                      focusId={focusId}
                      onFocus={focusTo}
                      selected={selected}
                      onSelect={setSelected}
                      filters={filters}
                      viewerUserId={viewerUserId}
                      linesOn={linesOn}
                      pulseSeatId={pulseSeatId}
                      lenses={lensNodes}
                      svgRef={svgRef}
                      arrangeHint={arranging && !publishing ? "press M to pick it up and move it" : undefined}
                    />
                  </div>
                  <aside data-scroll-contain className="w-80 shrink-0 bg-card border border-border rounded-2xl p-5 sticky top-24 max-h-[80vh] overflow-y-auto hidden md:block">
                    {/* Arranging rides the top of this card, so the canvas never moves when it turns on. */}
                    {arranging && (
                      <ArrangeBar
                        live={data.circles}
                        moves={arrange.moves}
                        status={arrange.status}
                        busy={publishing}
                        onBusy={setPublishing}
                        reload={refetchMap}
                        onPropose={arrange.propose}
                        onSettled={arrange.settle}
                        onDiscard={arrange.clear}
                      />
                    )}
                    {selectedSeat ? (
                      <div>
                        <div className="flex justify-end">
                          <button type="button" onClick={() => setSelected(null)} aria-label="Back to the village overview" className="text-muted-foreground hover:text-foreground">
                            <X className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                        <HolderCard seat={selectedSeat} circle={selectedCircle} data={data} onPickPerson={pickPerson} />
                      </div>
                    ) : focusedCircle ? (
                      <CircleCard
                        circle={focusedCircle}
                        data={data}
                        onSelectSeat={(id) => setSelected({ kind: "role", id })}
                        onOut={() => focusTo((focusedCircle.parentCircleId as string | null) ?? null)}
                      />
                    ) : (
                      <VillageSummary
                        data={data}
                        mayDeclareVillage={mayDeclareVillage}
                        isAdmin={viewerIsAdmin}
                        onOpenWalk={() => setWalkOpen(true)}
                        shapePreview={shapePreview}
                        onPreview={setShapePreview}
                        onSaved={(p) => {
                          setShapePreview(null);
                          setData((d) => (d ? { ...d, power: { ...d.power, ...p } } : d));
                        }}
                      />
                    )}

                    {/* THE KEY BELONGS BESIDE THE PICTURE, NOT ON TOP OF IT.
                        It floated at the canvas's bottom-left corner, and
                        once the stage grew to 86vh the disc reaches every
                        corner: it was sitting over Business & Finance and
                        Community Life, hiding the two circles a reader would
                        have to move the panel to see.

                        There is no free corner on a disc that fills its box,
                        so the honest place is the column that already has
                        room. The panel is `sticky top-24` and scrolls, so the
                        key travels with whatever card is open instead of
                        competing with the map for the same pixels. */}
                    <div className="mt-5 pt-5 border-t border-border">
                      <Legend seats={data.roles} power={data.power} footer={<CurrencyPicker />} />
                    </div>
                  </aside>
                </div>
              )}

              {/* The list: the phone's whole page, the tablet's under-map
                  companion, and the desktop's choice (spec 12). */}
              <div className={`${listMode ? "" : "sm:hidden"} space-y-4 mt-2`}>
                <div className="sm:max-w-xl">
                  <Legend seats={data.roles} power={data.power} footer={<CurrencyPicker />} />
                </div>
                <CircleAccordion data={data} filters={filters} viewerUserId={viewerUserId} onSelect={setSelected} onFocus={focusTo} />
              </div>

              {/* The card as a bottom sheet wherever the standing panel is
                  not. A tapped SEAT opens straight into it. A circle you step
                  into does NOT: it opened here on every step-in and covered
                  the map the step was taken to see (measured live, 169px to
                  the bottom of an 844px screen). The circle's card waits for
                  the peek below to ask for it, and closing it goes back to
                  the peek, not out of the circle. */}
              {(selectedSeat || (focusedCircle && sheetOpen)) && (
                <div className="md:hidden">
                  <SeatSheet
                    label={selectedSeat ? selectedSeat.name : focusedCircle!.name}
                    onClose={() => (selectedSeat ? setSelected(null) : setSheetOpen(false))}
                  >
                    {selectedSeat ? (
                      <HolderCard seat={selectedSeat} circle={selectedCircle} data={data} onPickPerson={pickPerson} />
                    ) : (
                      <CircleCard
                        circle={focusedCircle!}
                        data={data}
                        onSelectSeat={(id) => setSelected({ kind: "role", id })}
                        onOut={() => focusTo((focusedCircle!.parentCircleId as string | null) ?? null)}
                      />
                    )}
                  </SeatSheet>
                </div>
              )}

              {walkOpen && <SetupWalk data={data} onClose={() => setWalkOpen(false)} onChanged={refetchMap} />}

              {/* Last in the section, because it is sticky: it rides the
                  bottom of the screen while the map section is in view, then
                  settles above the footer instead of covering it. */}
              {focusedCircle && (
                <CirclePeek
                  circle={focusedCircle}
                  data={data}
                  outTo={data.circles.find((c) => c.id === focusedCircle.parentCircleId)?.name ?? "the village"}
                  onOut={() => focusTo((focusedCircle.parentCircleId as string | null) ?? null)}
                  onExpand={() => setSheetOpen(true)}
                />
              )}
            </>
          )}
        </div>
      </section>
    </Layout>
  );
}

/** The unselected side panel: counts, and the shape picker for declarers. */
function VillageSummary({
  data,
  mayDeclareVillage,
  isAdmin,
  onOpenWalk,
  shapePreview,
  onPreview,
  onSaved,
}: {
  data: PowerData;
  mayDeclareVillage: boolean;
  isAdmin: boolean;
  onOpenWalk: () => void;
  shapePreview: string | null;
  onPreview: (s: string | null) => void;
  onSaved: (p: { shape: string; shapeGloss?: string | null; decidesBy: string; decidesByGloss?: string | null }) => void;
}) {
  const filled = data.roles.reduce((n, r) => n + r.holderCount, 0);
  const seats = data.roles.reduce((n, r) => n + r.seats, 0);
  const open = data.roles.filter((r) => r.vacant).length;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold text-foreground mb-1">The whole village</h2>
        <p className="text-xs text-muted-foreground">
          {data.circles.length} circle{data.circles.length === 1 ? "" : "s"} · {data.roles.length} seat
          {data.roles.length === 1 ? "" : "s"} · {filled} of {seats} held
        </p>
        {open > 0 && (
          <p className="text-xs text-amber-700 bg-amber/10 rounded-lg px-3 py-2 mt-3">
            {open} open call{open === 1 ? "" : "s"}: the dashed seats are waiting for someone.
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Tap a circle to step inside it. Tap a seat to meet whoever holds it, or to raise your hand.
      </p>
      {isAdmin && (
        <button
          type="button"
          onClick={onOpenWalk}
          data-power-walk-launch
          className="w-full text-sm bg-amber/90 text-teal-deep rounded-lg px-4 py-2 font-semibold"
        >
          Walk the setup: seats, methods, shape
        </button>
      )}
      {mayDeclareVillage && (
        <ShapePicker power={data.power} preview={shapePreview} onPreview={onPreview} onSaved={onSaved} />
      )}
    </div>
  );
}

/** The same data as a list you can act from: every seat reachable by
 *  scrolling, no pinching, and the same filters dimming the same rows. */
function CircleAccordion({
  data,
  filters,
  viewerUserId,
  onSelect,
  onFocus,
}: {
  data: PowerData;
  filters: Filters;
  viewerUserId: string | null;
  onSelect: (s: Selection) => void;
  /** Opening a circle also flies the map to it. On a phone the map sits
   *  directly above this list now, so the two move together. */
  onFocus: (id: string | null) => void;
}) {
  const [open, setOpen] = useState<string>("");
  const decideLabel = (id: string | null | undefined) =>
    data.power.glossary.decidesBy.find((d) => d.id === id)?.label ?? null;
  return (
    <div className="space-y-3" data-power-accordion>
      {data.circles.map((c) => {
        const roles = data.roles.filter((r) => r.circleId === c.id);
        const quests = data.quests.filter((q) => q.circleId === c.id);
        const isOpen = open === c.id;
        const method = decideLabel(c.decidesBy) ?? decideLabel(data.power.decidesBy);
        return (
          <div key={c.id} className={`bg-card border border-border rounded-xl ${c.status === "forming" ? "opacity-60" : ""}`}>
            <button type="button" className="w-full flex items-center justify-between px-4 py-3" onClick={() => {
              const next = isOpen ? "" : c.id;
              setOpen(next);
              onFocus(next || null);
            }} aria-expanded={isOpen}>
              <span className="font-semibold text-foreground text-sm text-left flex items-center gap-2 min-w-0">
                {/* THE KEY BETWEEN THE PICTURE AND THE NAMES.
                    On a phone the map draws colour and almost no text: at
                    358px only one circle is big enough to hold a name, and
                    the rest are 18 to 30px across. That is honest for the
                    space and it left the picture unreadable as a legend,
                    because nothing said which colour was which circle.
                    Same hue, same resolver (shared/circleView.ts), so this
                    row IS the map's key and cannot drift from it. */}
                <span
                  aria-hidden="true"
                  className="w-2.5 h-2.5 rounded-full shrink-0 border"
                  style={{
                    background: cssColourForCircle({ id: c.id, color: c.color ?? null }),
                    borderColor: cssColourForCircle({ id: c.id, color: c.color ?? null }),
                  }}
                />
                <span className="min-w-0">
                {c.name}
                {c.status === "forming" && <span className="ml-2 text-xs text-muted-foreground">(forming)</span>}
                {c.isExample && <ExampleChip className="ml-2 align-middle" />}
                {method && <span className="ml-2 text-[10px] bg-teal-deep/10 text-teal-deep px-1.5 py-0.5 rounded-full">{method}</span>}
                </span>
              </span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {isOpen && (
              <div className="px-4 pb-4 space-y-2">
                {c.purpose && <p className="text-xs text-muted-foreground">{c.purpose}</p>}
                {roles.map((r) => {
                  const dim = !seatPassesFilters(r, filters, viewerUserId) && (filters.open || filters.mine || filters.expiring || !!filters.circle || !!filters.person);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onSelect({ kind: "role", id: r.id })}
                      className={`w-full flex items-center justify-between text-left text-sm px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted ${dim ? "opacity-30" : ""}`}
                    >
                      <span>
                        {r.name}
                        {r.isExample && <ExampleChip className="ml-1.5 align-middle" />}
                      </span>
                      {r.vacant ? (
                        <span className="text-[10px] bg-amber/20 text-amber-700 px-1.5 py-0.5 rounded-full">open call</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {r.holderCount}/{r.seats}
                        </span>
                      )}
                    </button>
                  );
                })}
                {quests.length > 0 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    {quests.length} open Quest{quests.length === 1 ? "" : "s"}, see the{" "}
                    <a href="/quests" className="text-teal-deep font-medium">
                      Quest board
                    </a>
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/*
 * `LandingToggle` stood here: an undo for someone who had made the map their
 * home page. Nothing could ever reach it. The automatic promotion is off
 * (AUTO_LANDING_ENABLED in client/src/lib/landing.ts), and its own button was
 * the only writer of a landing preference in the product, so the "map"
 * preference it tested for was never set by any code path and the component
 * returned null on every render. It also sat on /map/circles while the
 * redirect it undid pointed at /map.
 */
