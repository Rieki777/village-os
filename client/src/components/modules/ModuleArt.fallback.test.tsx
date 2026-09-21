// @vitest-environment jsdom
/**
 * A module card asks only for pictures that exist, and still looks finished.
 *
 * `client/src/lib/moduleImages.test.ts` lets a module ship the drawn fallback
 * instead of a webp, because the image budget ratchet has no headroom left and
 * the fallback costs none. That exemption is only honest if the card really
 * draws something, so this renders the case the exemption creates: redemption,
 * whose `/images/modules/redemption.webp` does not exist.
 *
 * THIS FILE USED TO ASSERT THE DEFECT. It checked that the card tried
 * `/images/modules/redemption.webp` first and only drew the gradient after the
 * <img> failed. On production that request is answered with the SPA shell (200,
 * text/html, 3536 bytes), so every render cost a wasted round trip and left an
 * image any `complete && naturalWidth === 0` check reads as broken. The member
 * saw the right art; the test defended the request that should never be made.
 *
 * So the unit here is the WHOLE list of sources a card puts on screen, walked
 * by failing each one in turn (`error` is what the browser fires on a missing
 * file, and what `ModuleArt` listens for), not a mock of fetch. Redemption must
 * walk nothing it cannot have; a module that does ship art is the positive
 * control, so a card that stopped requesting ANY bundled art would fail too.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MODULE_CATALOG } from "@shared/moduleCatalog";
import ModuleArt from "./ModuleArt";

/** `hsl(h s% l%)` as the style attribute serialises it: `rgb(r, g, b)`. */
function rgbOf(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = lig - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

/**
 * Render a card and fail every image it shows until it draws the fallback.
 * Returns each `src` in the order it was put on screen.
 */
function walk(ui: ReactElement) {
  const { container } = render(ui);
  const srcs: string[] = [];
  for (let img = container.querySelector("img"); img; img = container.querySelector("img")) {
    srcs.push(img.getAttribute("src") ?? "");
    fireEvent.error(img);
    if (srcs.length > 5) throw new Error(`the card never stopped walking: ${srcs.join(", ")}`);
  }
  return { srcs, container };
}

/** The drawn fallback is on screen: a gradient and an emblem, and no <img>. */
function expectDrawn(container: HTMLElement) {
  expect(container.querySelector("img"), "no image is left on screen").toBeNull();
  const drawn = container.firstElementChild as HTMLElement;
  expect(drawn.getAttribute("style") ?? "").toContain("linear-gradient");
  expect(container.querySelector("svg"), "the emblem is drawn").toBeTruthy();
}

/** ...in this module's own catalog colours. */
function expectCatalogColours(container: HTMLElement, hue: number) {
  // The gradient is asserted through the CATALOG HUE and not as literal
  // text: the style attribute comes back with every colour serialised to
  // `rgb(...)`, so matching on "hsl(40" would fail while the card renders
  // exactly right. Both stops are derived here the way `FallbackArt` builds
  // them, so changing the hue in the catalog moves this test with it.
  const style = (container.firstElementChild as HTMLElement).getAttribute("style") ?? "";
  expect(style).toContain(rgbOf(hue, 42, 28));
  expect(style).toContain(rgbOf((hue + 40) % 360, 55, 52));
}

describe("a module card with no bundled art", () => {
  const card = MODULE_CATALOG.redemption;

  it("draws the gradient and the emblem without requesting a file that does not exist", () => {
    expect(card, "redemption must have a catalog card").toBeTruthy();
    const { srcs, container } = walk(
      <ModuleArt id="redemption" hue={card.hue} emblem={card.emblem} className="h-32" />,
    );
    expect(srcs, "redemption ships no webp, so the card must not ask for one").toEqual([]);
    expectDrawn(container);
    expectCatalogColours(container, card.hue);
  });

  it("tries the village's own upload, then draws, never guessing a bundled path", () => {
    const upload = "/uploads/modules/redemption-own.webp";
    const { srcs, container } = walk(
      <ModuleArt id="redemption" hue={card.hue} emblem={card.emblem} imageUrl={upload} />,
    );
    expect(srcs).toEqual([upload]);
    expectDrawn(container);
  });
});

describe("a module card with bundled art (the positive control)", () => {
  const card = MODULE_CATALOG.automation;

  it("still renders its file, and draws only once that fails", () => {
    expect(card, "automation must have a catalog card").toBeTruthy();
    const { srcs, container } = walk(
      <ModuleArt id="automation" hue={card.hue} emblem={card.emblem} />,
    );
    expect(srcs).toEqual(["/images/modules/automation.webp"]);
    expectDrawn(container);
  });

  it("walks the upload, then the bundled file, then the drawing", () => {
    const upload = "/uploads/modules/automation-own.webp";
    const { srcs } = walk(
      <ModuleArt id="automation" hue={card.hue} emblem={card.emblem} imageUrl={upload} />,
    );
    expect(srcs).toEqual([upload, "/images/modules/automation.webp"]);
  });
});
