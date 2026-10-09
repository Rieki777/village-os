/**
 * The shelf: every place on the land somebody has photographed.
 *
 * This page is the door the map tab will eventually sit beside, never replace.
 * A photograph belongs to a place, and a place is a thing on the living map,
 * so the map's own panel is the natural home for a gallery. This page exists
 * because a shareable address for a place's pictures is worth having on its
 * own, and because a village whose map module is on but whose map artifact is
 * mid-redraw still has somewhere for its photographs to live.
 *
 * The curator's queue is on this page and not in Admin, deliberately. Whoever
 * holds `map.curatePhotos` can work it, and a founder is only one of the
 * people who might.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { PAGE_GATE_LINES } from "@/components/modules/gateCopy";
import BreathingLoader from "@/components/natural/BreathingLoader";
import PlaceCard, { type PlaceCardData } from "@/components/places/PlaceCard";
import PhotoReportsPanel from "@/components/places/PhotoReportsPanel";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";

const jsonHeaders = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

interface ShelfPayload {
  places: PlaceCardData[];
  canContribute: boolean;
  canCurate: boolean;
  openReports: number;
  perPlace: number;
}

export default function Places() {
  const modules = useModules();
  const mapModule = useModule("map");
  if (modules.loaded && !mapModule) {
    return <ModuleGate moduleId="map" name="Places" behind={PAGE_GATE_LINES.places} />;
  }
  return <PlacesPage />;
}

function PlacesPage() {
  const [data, setData] = useState<ShelfPayload | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/places", { headers: jsonHeaders() })
      .then((r) => {
        if (r.status === 401) {
          if (live) setLocked(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((payload) => {
        if (live && payload) setData(payload);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        <header className="space-y-2">
          <h1 className="font-serif text-3xl">Places, photographed</h1>
          {/* R47: the Trail line leads, and the Lore line comes last. */}
          <p className="text-muted-foreground">
            Open a place to see its photographs. Each one carries the name of whoever took it and the month it was
            taken.
          </p>
          <nav aria-label="Every photograph">
            <Link href="/photographs" className="text-sm text-teal-deep underline inline-block py-1.5 min-h-[44px]">
              See every photograph on one page, newest first
            </Link>
          </nav>
          <p className="text-sm italic text-muted-foreground">
            Every place on the land that somebody has stood in front of with a camera.
          </p>
        </header>

        {locked ? (
          <p className="rounded-xl border border-border bg-card p-6">
            <Link href={`/login?next=${encodeURIComponent("/places")}`} className="text-teal-deep underline">
              Sign in
            </Link>{" "}
            to see the places this village has photographed.
          </p>
        ) : !data ? (
          <BreathingLoader label="Opening the places" />
        ) : data.places.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
            No photographs yet.
          </p>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 list-none p-0">
            {data.places.map((p) => (
              <PlaceCard key={p.structureKey} place={p} />
            ))}
          </ul>
        )}

        {data?.canCurate && <PhotoReportsPanel />}
      </div>
    </Layout>
  );
}
