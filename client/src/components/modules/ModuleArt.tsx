/**
 * A module card's picture, with the designed fallback (L1).
 *
 * Resolution order: the village's own upload (`imageUrl` in the module's
 * config), then the bundled platform art (L1a) IF the art manifest names a
 * file for this module, then the drawn fallback: a gradient from the module's
 * catalog hue plus its lucide emblem. The fallback costs zero image budget, so
 * a fork with no art, or a village that removed one, still looks finished.
 *
 * THE BUNDLED PATH IS DECLARED, NOT GUESSED. This used to request
 * `/images/modules/<id>.webp` for every module and let `onError` clean up. A
 * module that deliberately ships no file (redemption, see DRAWN_FALLBACK in
 * `client/src/lib/moduleImages.test.ts`) still drew the right thing, but only
 * after a wasted request: the server answers a missing file under /images/
 * with the SPA shell, 200 and text/html, so every render cost a round trip and
 * left an <img> that any `complete && naturalWidth === 0` check reads as
 * broken. Measured on production 2026-09-21: 3536 bytes of HTML per card.
 *
 * The manifest beside the images already records which modules have art (the
 * image budget gate's header names it as the place a runtime-built path is
 * declared). It is imported here, so the bundler inlines it at BUILD time:
 * no fetch, and no second copy of the fact to drift. `moduleImages.test.ts`
 * holds this function to the files on disk for every module in the registry.
 *
 * The emblem map is explicit instead of a dynamic lucide lookup so the lazy
 * chunk carries only the icons the catalog actually names; a name the map
 * does not know falls back to a neutral mark rather than a crash.
 */
import { useState } from "react";
import {
  Activity, Award, BedDouble, CalendarDays, Circle, Coins, Globe, Hammer,
  Handshake, Heart, Landmark, MessageCircle, MessagesSquare, Mic, Newspaper,
  Sparkles, TrendingUp, Users, Wrench, type LucideIcon,
} from "lucide-react";
import artManifest from "../../../public/images/modules/manifest.json";

const EMBLEMS: Record<string, LucideIcon> = {
  Activity, Award, BedDouble, CalendarDays, Coins, Globe, Hammer, Handshake,
  Heart, Landmark, MessageCircle, MessagesSquare, Mic, Newspaper, Sparkles,
  TrendingUp, Users, Wrench,
};

const BUNDLED: Record<string, { file?: unknown }> = artManifest.assets;

/** The platform art this build ships for a module, or null when it ships none. */
export function bundledArtPath(id: string): string | null {
  const file = Object.prototype.hasOwnProperty.call(BUNDLED, id) ? BUNDLED[id].file : undefined;
  return typeof file === "string" && file ? `/images/modules/${file}` : null;
}

export function FallbackArt({ hue, emblem, className = "" }: { hue: number; emblem: string; className?: string }) {
  const Emblem = EMBLEMS[emblem] ?? Circle;
  return (
    <div
      aria-hidden="true"
      className={`flex items-center justify-center ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 42% 28%), hsl(${(hue + 40) % 360} 55% 52%))`,
      }}
    >
      <Emblem className="w-10 h-10 text-white/80" strokeWidth={1.5} />
    </div>
  );
}

export default function ModuleArt({
  id, hue, emblem, imageUrl, className = "",
}: {
  id: string;
  hue: number;
  emblem: string;
  /** The village's own upload, from module_settings.config. */
  imageUrl?: string | null;
  className?: string;
}) {
  // Walk the source list forward on error; past the end, draw the fallback.
  const bundled = bundledArtPath(id);
  const sources = [
    ...(imageUrl ? [imageUrl] : []),
    ...(bundled ? [bundled] : []),
  ];
  const [at, setAt] = useState(0);
  if (at >= sources.length) return <FallbackArt hue={hue} emblem={emblem} className={className} />;
  return (
    <img
      src={sources[at]}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setAt((n) => n + 1)}
      className={`object-cover ${className}`}
    />
  );
}
