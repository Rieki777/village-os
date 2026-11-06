// @vitest-environment jsdom
/**
 * EVERY DIALOG'S AND SHEET'S CLOSE IS A 44 PX TARGET, ON EVERY POINTER.
 *
 * jsdom lays nothing out, so this pins the arithmetic and that both shared
 * primitives actually wear the hit area, unconditionally (a `pointer-coarse:`
 * prefix would leave a fine or misreported pointer at 16 px). The geometry was
 * measured in a real browser for the pull request.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetTitle } from "./sheet";
import { CLOSE_HIT_AREA, CLOSE_HIT_REACH_PX, CLOSE_ICON_PX } from "./closeHitArea";

const reach = () => {
  const m = CLOSE_HIT_AREA.match(/before:-inset-\[(\d+)px\]/);
  return m ? Number(m[1]) : 0;
};

describe("the close button's target", () => {
  it("is at least 44 px across", () => {
    expect(reach()).toBe(CLOSE_HIT_REACH_PX);
    expect(CLOSE_ICON_PX + 2 * reach()).toBeGreaterThanOrEqual(44);
    expect(CLOSE_HIT_AREA).toContain("before:absolute");
    expect(CLOSE_HIT_AREA).toContain("before:content-['']");
  });

  it.each([
    [
      "dialog",
      () => (
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Small</DialogTitle>
          </DialogContent>
        </Dialog>
      ),
    ],
    [
      "sheet",
      () => (
        <Sheet open>
          <SheetContent aria-describedby={undefined}>
            <SheetTitle>Small</SheetTitle>
          </SheetContent>
        </Sheet>
      ),
    ],
  ])("is worn by the %s close, for every pointer", (_name, ui) => {
    render(ui());
    const close = screen.getByRole("button", { name: "Close" });
    for (const cls of CLOSE_HIT_AREA.split(" ")) expect(close.className.split(/\s+/)).toContain(cls);
    // The hit area is positioned against the button itself.
    expect(close.className).toMatch(/(^|\s)absolute(\s|$)/);
  });
});
