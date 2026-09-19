// @vitest-environment jsdom
/**
 * A module with no bundled art still looks finished.
 *
 * `client/src/lib/moduleImages.test.ts` lets a module ship the drawn fallback
 * instead of a webp, because the image budget ratchet has no headroom left and
 * the fallback costs none. That exemption is only honest if the card really
 * draws something, so this renders the case the exemption creates: redemption,
 * whose `/images/modules/redemption.webp` does not exist.
 *
 * The server answers any missing asset with the SPA shell, which is HTML where
 * a picture should be, so the browser fires `error` on the <img>. That is the
 * event fired here, and it is the whole mechanism: `ModuleArt` walks past the
 * source and returns `FallbackArt`.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
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

describe("a module card with no bundled art", () => {
  it("draws the gradient and the emblem once the image fails", () => {
    const card = MODULE_CATALOG.redemption;
    expect(card, "redemption must have a catalog card").toBeTruthy();
    const { container } = render(
      <ModuleArt id="redemption" hue={card.hue} emblem={card.emblem} className="h-32" />,
    );

    const img = container.querySelector("img");
    expect(img, "the bundled source is tried first").toBeTruthy();
    expect(img!.getAttribute("src")).toBe("/images/modules/redemption.webp");

    fireEvent.error(img!);

    expect(container.querySelector("img"), "the failed source is left behind").toBeNull();
    // The gradient is asserted through the CATALOG HUE and not as literal
    // text: the style attribute comes back with every colour serialised to
    // `rgb(...)`, so matching on "hsl(40" would fail while the card renders
    // exactly right. Both stops are derived here the way `FallbackArt` builds
    // them, so changing the hue in the catalog moves this test with it.
    const drawn = container.firstElementChild as HTMLElement;
    const style = drawn.getAttribute("style") ?? "";
    expect(style).toContain("linear-gradient");
    expect(style).toContain(rgbOf(card.hue, 42, 28));
    expect(style).toContain(rgbOf((card.hue + 40) % 360, 55, 52));
    expect(container.querySelector("svg"), "the emblem is drawn").toBeTruthy();
  });
});
