// WCAG contrast against a deployed site, measured from rendered pixels.
//
// This is the sixth version. The five before it each reported a confident wrong number, and
// every one of those failures announced itself as a RESULT rather than an error. The fixes
// are listed here because the next person to write a checker will hit the same five:
//
//   1. COLOUR SPACES. v1 parsed rgb() with a regex and silently skipped oklch(). It reported
//      "0 failures" on a page whose h1 measured 1.00:1. Every colour now goes through a
//      canvas, so the browser's own parser resolves oklch/oklab/hsl/named/hex alike.
//
//   2. BACKGROUND-IMAGE. v2 read background-COLOR only, so white text on a dark gradient
//      measured 1:1 — eleven times on one page. background-image is now checked BEFORE
//      background-color at every ancestor, because an image paints over the colour beneath it.
//
//   3. ALPHA. v3 read the declared colour and never composited. Grey on `bg-teal/5`, a five
//      percent tint, measured as grey on FULL teal: 1.12:1 reported, 4.54:1 actual. The whole
//      ancestor stack is now flattened, stopping at the first fully opaque layer.
//
//   4. THE BAIL-OUT THAT LOOKS LIKE A PASS. The first fix for #2 treated "a gradient anywhere
//      in the stack" as unmeasurable and skipped 57 nodes SILENTLY, reporting 0 FAIL on a page
//      with a real failure in it. Unmeasurable nodes are now COUNTED AND PRINTED. Zero-because-
//      unmeasured and zero-because-passing are the same output and opposite facts.
//
//   5. LEAF-ONLY SELECTION. v3 required `children.length === 0`, so `<a><Icon/>Label</a>` was
//      invisible: the label is a bare text node inside an element that HAS a child. Every
//      icon-plus-label button on the site went unmeasured. Any element with a non-empty DIRECT
//      text node now qualifies.
//
// AND ONE IT STILL CANNOT SEE, stated because a known limit is worth more than a silent one:
// an absolutely positioned photo is a SIBLING, not an ancestor. Text over a hero image will
// read as white-on-white. Those are reported as NOT MEASURABLE, never as failures.
//
// Usage:
//   QA_BASE_URL=https://your-deployment.example node scripts/qa/contrast.mjs [routes...]
//   QA_TOKEN=<token> ...                  to reach signed-in surfaces
import { baseUrl, authToken, playwright, contextFor, PROFILES } from "./lib.mjs";
import { routes } from "./routes.mjs";

const PROBE = () => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const g = cv.getContext("2d", { willReadFrequently: true });

  // Normalise ANY css colour to straight rgba by letting the browser parse it.
  const rgba = (css) => {
    try {
      g.clearRect(0, 0, 1, 1);
      g.globalCompositeOperation = "copy";
      g.fillStyle = "#000";
      const probe = g.fillStyle;
      g.fillStyle = css;
      if (g.fillStyle === probe && !/^#000|black|rgb\(0, ?0, ?0\)/i.test(css)) return null;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    } catch { return null; }
  };

  const over = (top, bottom) => {
    const a = top[3];
    return [0, 1, 2].map((k) => Math.round(top[k] * a + bottom[k] * (1 - a))).concat(1);
  };
  const lum = (c) => {
    const [r, gg, b] = c.slice(0, 3).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const L1 = lum(a), L2 = lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  };

  // Walk up flattening every layer. ORDER MATTERS: an image paints over this element's own
  // background-colour, so an opaque colour underneath an image tells you nothing.
  const backdrop = (el) => {
    const layers = [];
    let e = el, gradient = false;
    while (e && e !== document.documentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== "none") { gradient = true; break; }
      const v = rgba(cs.backgroundColor);
      if (v && v[3] > 0) layers.push(v);
      if (v && v[3] >= 0.999) { e = null; break; }
      e = e.parentElement;
    }
    if (e) {
      const root = rgba(getComputedStyle(document.documentElement).backgroundColor);
      if (root && root[3] > 0) layers.push(root);
    }
    let out = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return { rgb: out, gradient };
  };

  /**
   * WHAT IS ACTUALLY PAINTED UNDER THIS TEXT, which the ancestor walk cannot see.
   *
   * `backdrop` walks ANCESTORS, so it finds a gradient or image set on one of
   * them. It cannot find a photo that is a SIBLING - the shape every hero card
   * uses: an <img> filling a positioned card with an absolutely positioned
   * caption over it. Nothing in the caption's ancestor chain has a background,
   * so the walk runs to an opaque white and reports white-on-white at 1:1.
   *
   * This is the case the header above has always promised to report as NOT
   * MEASURABLE rather than as a failure, and until now only the gradient half
   * was implemented. Measured on live `41debc4`: 60 such failures on /quests
   * alone, every one legible white text over a dark-scrimmed photograph, while
   * the four other flagged routes carried 77 REAL sub-AA failures. A gate
   * crying wolf on 60 lines teaches the next reader to skim the 77.
   *
   * TWO WAYS THIS WAS WRONG BEFORE IT WAS RIGHT, both worth keeping:
   *   - `elementsFromPoint` answers only for the visible viewport, so every
   *     card below the fold read as "nothing behind it" - which is all 60.
   *   - stopping at the nearest positioned ancestor looks INSIDE the caption,
   *     because the caption is itself the positioned element; the photo is a
   *     sibling of the caption, one level further out.
   */
  const imageBehind = (el, rect) => {
    const overlaps = (r) => !(r.right <= rect.left || r.left >= rect.right
                           || r.bottom <= rect.top || r.top >= rect.bottom);
    let a = el.parentElement;
    for (let depth = 0; a && a !== document.body && depth < 6; depth++, a = a.parentElement) {
      for (const cand of a.children) {
        if (cand === el || cand.contains(el)) continue; // our own line: backdrop sees it
        let painted = /^(IMG|VIDEO|CANVAS|PICTURE|SVG)$/i.test(cand.tagName);
        if (!painted) {
          const ccs = getComputedStyle(cand);
          painted = !!ccs.backgroundImage && ccs.backgroundImage !== "none";
        }
        if (!painted) {
          const inner = cand.querySelector("img, video, canvas, picture");
          if (!inner) continue;
          const ir = inner.getBoundingClientRect();
          if (ir.width >= 4 && ir.height >= 4 && overlaps(ir)) return true;
          continue;
        }
        const r = cand.getBoundingClientRect();
        if (r.width >= 4 && r.height >= 4 && overlaps(r)) return true;
      }
      const av = rgba(getComputedStyle(a).backgroundColor);
      if (av && av[3] >= 0.999) return false; // opaque ground: backdrop is right
    }
    return false;
  };

  // Its OWN text, not a descendant's, so an icon beside a label does not hide the label.
  const ownText = (el) => {
    let t = "";
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.trim();
  };

  const fails = [], unmeasurable = [];
  let measured = 0;
  for (const el of document.querySelectorAll("*")) {
    const t = ownText(el);
    if (t.length < 2) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 4 || b.height < 4) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity < 0.1) continue;

    const fgRaw = rgba(cs.color);
    if (!fgRaw) { unmeasurable.push(`"${t.slice(0, 30)}" — unparseable colour`); continue; }
    const bg = backdrop(el);
    if (bg.gradient) { unmeasurable.push(`"${t.slice(0, 30)}" — gradient or image in the backdrop`); continue; }
    if (imageBehind(el, b)) { unmeasurable.push(`"${t.slice(0, 30)}" — a picture is painted behind it, not in its ancestors`); continue; }

    measured++;
    const fg = over(fgRaw, bg.rgb);
    const cr = ratio(fg, bg.rgb);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
    const floor = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    if (cr < floor) {
      const path = [];
      let e = el;
      for (let i = 0; i < 3 && e; i++) {
        path.push(e.tagName + (typeof e.className === "string" && e.className
          ? "." + e.className.trim().split(/\s+/).slice(0, 3).join(".") : ""));
        e = e.parentElement;
      }
      fails.push({
        text: t.slice(0, 40), ratio: +cr.toFixed(2), floor, size: Math.round(size),
        fg: `rgb(${fg.slice(0, 3)})`, bg: `rgb(${bg.rgb.slice(0, 3)})`, path: path.join(" < "),
      });
    }
  }
  return { measured, fails: fails.sort((a, b) => a.ratio - b.ratio), unmeasurable };
};

const BASE = baseUrl();
const TOKEN = authToken();
const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ROUTES = targets.length ? targets : routes().concrete;

const pw = await playwright();
let totalFails = 0;
for (const profile of PROFILES) {
  const { browser, ctx } = await contextFor(pw, profile, TOKEN);
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 50000 });
    } catch {
      console.log(`\n=== ${profile.name} ${route} === NAVIGATION FAILED (not a pass)`);
      await page.close();
      continue;
    }
    await page.waitForTimeout(3200);
    const r = await page.evaluate(PROBE);
    totalFails += r.fails.length;
    console.log(`\n=== ${profile.name} ${route} ===  ${r.measured} measured · ${r.fails.length} FAIL · ${r.unmeasurable.length} NOT MEASURABLE`);
    for (const f of r.fails.slice(0, 10)) {
      console.log(`    ${f.ratio}:1 (needs ${f.floor}) ${f.size}px  "${f.text}"`);
      console.log(`        ${f.fg} on ${f.bg}   ${f.path}`);
    }
    for (const u of r.unmeasurable.slice(0, 4)) console.log(`    UNMEASURABLE  ${u}`);
    await page.close();
  }
  await browser.close();
}
console.log(`\n  ${totalFails} contrast failure(s) across ${ROUTES.length} route(s) x ${PROFILES.length} viewport(s)`);
process.exit(totalFails > 0 ? 1 : 0);
