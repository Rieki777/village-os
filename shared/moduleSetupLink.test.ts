import { describe, expect, it } from "vitest";
import { moduleCardHref, setupAside, setupHref, setupLinkText } from "./moduleSetupLink";
import type { SetupTarget } from "./modules";

/**
 * The address a founder is handed when a module is waiting for something.
 *
 * Every assertion here is about a promise made to a person: that the link
 * lands on the control rather than near it, that it does not send them to a
 * screen which would 404 on arrival, and that it says which control it is
 * about before they click.
 */
describe("moduleSetupLink", () => {
  const dial: SetupTarget = { kind: "setting", key: "calendar.hemisphere", label: "Hemisphere" };
  const config: SetupTarget = { kind: "config", module: "crowdpool", label: "Crowdpool" };
  const tab: SetupTarget = { kind: "tab", tab: "stays-admin", label: "Stays" };

  it("sends a dial to the module's own card, carrying the key", () => {
    expect(setupHref("events", dial, { on: true })).toBe(
      "/admin?tab=modules&module=events&setting=calendar.hemisphere",
    );
  });

  it("sends a dial to the same place while the module is off", () => {
    // Settings are editable at every lifecycle (Rye, 2026-09-15): a village
    // sets a module up before it turns it on, so this link must not change
    // shape with the switch.
    expect(setupHref("events", dial, { on: false })).toBe(
      "/admin?tab=modules&module=events&setting=calendar.hemisphere",
    );
  });

  it("sends a config editor to the card too", () => {
    expect(setupHref("crowdpool", config, { on: true })).toBe(
      "/admin?tab=modules&module=crowdpool&setting=config",
    );
  });

  it("sends content to the module's own screen while it is on", () => {
    expect(setupHref("stays", tab, { on: true })).toBe("/admin?tab=stays-admin");
  });

  it("sends content to the card while the module is off, and says why", () => {
    // Measured: the rail hides a module's own tab while it is off
    // (client/src/lib/adminNav.ts) and `/api/admin/stays` sits behind
    // requireModule("stays"), so a room cannot be posted there yet. A link to
    // that tab would land on a screen that answers 404.
    expect(setupHref("stays", tab, { on: false })).toBe("/admin?tab=modules&module=stays");
    expect(setupAside(tab, { on: false })).toContain("Turn it on in preview first");
    expect(setupAside(tab, { on: true })).toBeNull();
  });

  it("says nothing extra about a dial, which needs nothing extra", () => {
    expect(setupAside(dial, { on: false })).toBeNull();
    expect(setupAside(config, { on: false })).toBeNull();
  });

  it("falls back to the card when a reader names no target at all", () => {
    expect(setupHref("tools", undefined, { on: true })).toBe("/admin?tab=modules&module=tools");
    expect(setupAside(undefined, { on: false })).toBeNull();
  });

  it("names the control in the link text, never just 'settings'", () => {
    expect(setupLinkText(dial, { on: true })).toBe("Set Hemisphere");
    expect(setupLinkText(config, { on: true })).toBe("Set up Crowdpool");
    expect(setupLinkText(tab, { on: true })).toBe("Open Stays");
    expect(setupLinkText(tab, { on: false })).toBe("Open its settings");
  });

  it("escapes what it puts in the address", () => {
    // A key is a dotted slug today and the encoding is not this file's
    // promise to keep; a module id or key with a space or an ampersand must
    // never be able to end one parameter and start another.
    const odd: SetupTarget = { kind: "setting", key: "a key&tab=secrets", label: "Odd" };
    expect(setupHref("a module", odd, { on: true })).toBe(
      "/admin?tab=modules&module=a%20module&setting=a%20key%26tab%3Dsecrets",
    );
  });

  it("agrees with itself about where a module's card is", () => {
    expect(moduleCardHref("events")).toBe("/admin?tab=modules&module=events");
    expect(setupHref("events", undefined, { on: true })).toBe(moduleCardHref("events"));
  });
});
