// @vitest-environment jsdom
/**
 * ON A PHONE, MY MOON SITS ABOVE THE PLAYER CARD (batch 157, C2 Q1), and
 * /profile#my-moon opens the Roles tab. The document keeps the desktop order;
 * only the phone draws the card and the season plan after the moon.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import RolesBand, { AFTER_MOON_ON_PHONE } from "./RolesBand";
import { TAB_OF_ANCHOR } from "./ProfileTabs";

afterEach(cleanup);

const slots = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>("[data-roles-slot]"));

/** The order a phone draws: flex `order` (0 unless the phone-only class says 1), then the document order. */
function phoneOrder(c: HTMLElement): string[] {
  return slots(c)
    .map((el, i) => ({ name: el.dataset.rolesSlot!, i, order: el.className.split(/\s+/).includes(AFTER_MOON_ON_PHONE) ? 1 : 0 }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map((s) => s.name);
}

describe("the Roles band", () => {
  const band = (season: boolean) =>
    render(
      <RolesBand
        id="roles"
        roles={<p>roles</p>}
        card={<p>card</p>}
        moon={<p>moon</p>}
        season={season ? <p>season</p> : null}
      />,
    ).container;

  it("keeps the desktop order in the document", () => {
    expect(slots(band(true)).map((el) => el.dataset.rolesSlot)).toEqual(["roles", "card", "moon", "season"]);
  });

  it("draws My moon above the player card on a phone", () => {
    expect(phoneOrder(band(true))).toEqual(["roles", "moon", "card", "season"]);
    expect(phoneOrder(band(false))).toEqual(["roles", "moon", "card"]);
  });

  it("moves nothing on a desktop: the only order class is phone-only", () => {
    for (const el of slots(band(true))) {
      expect(el.className.split(/\s+/).filter((k) => /(^|:)-?order-/.test(k) && !k.startsWith("max-sm:"))).toEqual([]);
    }
  });

  it("opens the Roles tab for /profile#my-moon", () => {
    expect(TAB_OF_ANCHOR["my-moon"]).toBe("roles");
  });
});
