import { createRoot } from "react-dom/client";
import App from "./App";
import { fetchConfigCached } from "./lib/gameApi";
import "./index.css";

/**
 * SELF-HOSTED FONTS (was: a render-blocking Google Fonts <link> in index.html).
 *
 * Three reasons, each sufficient on its own:
 *  - Privacy: the old link sent every member's IP to Google on every page
 *    load. A German court (LG München, 2022) has already held that a GDPR
 *    violation — untenable for a platform sold as "your deployment, your
 *    data".
 *  - Reach: Google's font CDN is blocked in China. A village there simply
 *    could not load the typefaces.
 *  - Speed: two extra DNS+TLS handshakes to third parties before text could
 *    settle. Bundled woff2 rides the same origin with a content hash and a
 *    year-long cache, like every other asset.
 *
 * Latin subset only (covers Spanish: U+0000-00FF has á é í ó ú ñ ü). The old
 * link also fetched Cormorant Garamond in five variants that no font stack
 * used at the time. It came back later as a catalogue offering, below.
 *
 * Weights match what the Tailwind classes actually use (light..bold). Fonts
 * are declared with `font-display: swap` by @fontsource, so text renders in
 * the fallback immediately and never blocks on a font file.
 */
import "@fontsource/montserrat/latin-300.css";
import "@fontsource/montserrat/latin-400.css";
import "@fontsource/montserrat/latin-500.css";
import "@fontsource/montserrat/latin-600.css";
import "@fontsource/montserrat/latin-700.css";
import "@fontsource/raleway/latin-300.css";
import "@fontsource/raleway/latin-400.css";
import "@fontsource/raleway/latin-500.css";
import "@fontsource/raleway/latin-600.css";
import "@fontsource/raleway/latin-700.css";
import "@fontsource/kalam/latin-400.css";
import "@fontsource/kalam/latin-700.css";

/*
 * The FOUNDATION CATALOGUE beyond the defaults (shared/fontCatalog.ts) — the
 * fonts a village can pick in Admin → Typography. All OFL. Declaring a
 * @font-face costs nothing at runtime: the browser downloads a file only
 * when an element actually renders in that family, so unchosen offerings are
 * a few hundred bytes of CSS, not font traffic. Display faces carry
 * 400–700; the body face carries the full working range; accents 400+700;
 * Marcellus is a single-weight face by design.
 *
 * Three offerings carry exactly the cuts they are for, and no more. Cormorant
 * Garamond adds 300 and the 400 and 500 italics, so a heading set light and an
 * italic place line render in the real cuts instead of browser-faked ones.
 * Jost is a light body face set at 300 to 500, and carries 600 and 700 too
 * because buttons, tiles and labels across the app are set semibold; without
 * them the browser fakes the bold. Pinyon Script is a one-line
 * copperplate with a single weight.
 */
import "@fontsource/josefin-sans/latin-400.css";
import "@fontsource/josefin-sans/latin-500.css";
import "@fontsource/josefin-sans/latin-600.css";
import "@fontsource/josefin-sans/latin-700.css";
import "@fontsource/cormorant-garamond/latin-300.css";
import "@fontsource/cormorant-garamond/latin-400.css";
import "@fontsource/cormorant-garamond/latin-400-italic.css";
import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/cormorant-garamond/latin-500-italic.css";
import "@fontsource/cormorant-garamond/latin-600.css";
import "@fontsource/cormorant-garamond/latin-700.css";
import "@fontsource/playfair-display/latin-400.css";
import "@fontsource/playfair-display/latin-500.css";
import "@fontsource/playfair-display/latin-600.css";
import "@fontsource/playfair-display/latin-700.css";
import "@fontsource/marcellus/latin-400.css";
import "@fontsource/nunito-sans/latin-300.css";
import "@fontsource/nunito-sans/latin-400.css";
import "@fontsource/nunito-sans/latin-500.css";
import "@fontsource/nunito-sans/latin-600.css";
import "@fontsource/nunito-sans/latin-700.css";
import "@fontsource/jost/latin-300.css";
import "@fontsource/jost/latin-400.css";
import "@fontsource/jost/latin-500.css";
import "@fontsource/jost/latin-600.css";
import "@fontsource/jost/latin-700.css";
import "@fontsource/caveat/latin-400.css";
import "@fontsource/caveat/latin-700.css";
import "@fontsource/pinyon-script/latin-400.css";
import { warmFirstScreenFonts } from "./fontWarmup";

/*
 * Before the first render, not after it: React's first paint here waits on
 * /api/game/config, and these downloads should already be under way while it
 * does. fontWarmup.ts says which faces and why.
 */
warmFirstScreenFonts();

// Consume the preloaded config now, so it has usually resolved before the
// first render and useGameConfig/useBrandImages start with it (gameApi.ts).
fetchConfigCached();

createRoot(document.getElementById("root")!).render(<App />);

/*
 * Register the service worker, which exists to cache the Living Map artifact
 * and nothing else (client/public/sw.js explains why it stays that narrow).
 *
 * After `load`, so it never competes with first paint, and wrapped because a
 * registration failure is a missing optimisation and must never be an error a
 * member sees. Served over http in dev, where browsers refuse to register on
 * anything but localhost; the catch covers that too.
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* No caching this visit. The site is unaffected. */
    });
  });
}
