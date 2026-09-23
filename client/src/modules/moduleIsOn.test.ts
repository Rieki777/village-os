/**
 * THE RULE A COMPONENT READS BEFORE ASKING AN OPTIONAL MODULE'S API.
 *
 * Tested as a pure function because the rule is the whole point: the provider
 * that feeds it does its own network fetching, which is a different contract
 * (see ModuleGate.test.tsx for the same reasoning). Components read it through
 * `useModuleOn`, and MoonDock.test.tsx runs that path with this real function.
 *
 * The loading case is the one worth the file. `useModule` answers undefined
 * before the catalog arrives exactly as it does for an off module, so a guard
 * that read it would treat every module as off until load. Every test run
 * against an already-loaded provider would pass, and a village with events on
 * would flash an empty state in the one window no test waits through.
 */
import { describe, expect, it } from "vitest";
import { moduleIsOn, type ClientModule } from "./ModuleProvider";

const events = (lifecycle: ClientModule["lifecycle"]): ClientModule => ({
  id: "events", name: "Events", description: "", core: false, lifecycle, hyphaLinks: [],
});

describe("whether a component may ask an optional module's API", () => {
  it("waits while the catalog is still loading, even for a module that will turn out to be on", () => {
    expect(moduleIsOn({ modules: [events("public")], loaded: false, failed: false }, "events")).toBe(false);
    expect(moduleIsOn({ modules: [], loaded: false, failed: false }, "events")).toBe(false);
  });

  it("says no once the catalog has loaded without the module, which is what an off module looks like", () => {
    expect(moduleIsOn({ modules: [], loaded: true, failed: false }, "events")).toBe(false);
  });

  it("says no for a module the catalog does carry but reads as off", () => {
    expect(moduleIsOn({ modules: [events("off")], loaded: true, failed: false }, "events")).toBe(false);
  });

  it("says yes for a module that is on, in every lifecycle that is not off", () => {
    for (const l of ["preview", "members", "public"] as const) {
      expect(moduleIsOn({ modules: [events(l)], loaded: true, failed: false }, "events"), l).toBe(true);
    }
  });

  it("lets the caller ask when the catalog could not be read, because unknown is not empty", () => {
    // The provider keeps `failed` apart from an empty catalog on purpose. A
    // blip on /api/modules must not hide a feature whose own endpoint works.
    expect(moduleIsOn({ modules: [], loaded: true, failed: true }, "events")).toBe(true);
  });

  it("answers for the module it was asked about and not for its neighbours", () => {
    expect(moduleIsOn({ modules: [{ ...events("public"), id: "library" }], loaded: true, failed: false }, "events")).toBe(false);
  });
});
