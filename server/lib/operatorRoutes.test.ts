import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_ONLY_ROUTES, ROUTE_POWERS, adminOrRouteHolder, routePower } from "./operatorRoutes";
import { ALL_CAPABILITIES, STAGE_UNLOCKS, TRANSFERABLE, type Capability } from "../../shared/capabilities";

const ROOT = path.resolve(__dirname, "../..");
const sources = [path.join(ROOT, "server/index.ts"), ...fs.readdirSync(path.join(ROOT, "server/routes")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => path.join(ROOT, "server/routes", f))]
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

describe("ROUTE_POWERS: which power opens each admin-only route", () => {
  it("names only powers the gate knows", () => {
    for (const [route, cap] of Object.entries(ROUTE_POWERS)) expect(ALL_CAPABILITIES, route).toContain(cap);
  });

  it("names only powers the village can be handed, so every mapped route has a power_transfer vote path (Rye, 2026-11-06)", () => {
    // "EVERYTHING can change with the highest village vote": a route whose power could never be handed
    // over would be the admin's alone forever, with no vote that could reach it.
    for (const [route, cap] of Object.entries(ROUTE_POWERS)) expect(TRANSFERABLE[cap], `${route} -> ${cap}`).toBe(true);
  });

  it("names no power the stage ladder hands every member, or every member would reach the route", () => {
    for (const [route, cap] of Object.entries(ROUTE_POWERS)) expect(STAGE_UNLOCKS[cap], `${route} -> ${cap}`).toBeUndefined();
  });

  it("names only routes that exist, method and path as Express registers them", () => {
    for (const route of [...Object.keys(ROUTE_POWERS), ...Object.keys(ADMIN_ONLY_ROUTES)]) {
      const [method, p] = route.split(" ");
      expect(sources.includes(`app.${method.toLowerCase()}("${p}"`), route).toBe(true);
    }
  });

  it("leaves the launch and the two hand-over doors to the admin, on purpose", () => {
    expect(routePower("POST", "/api/admin/launch/confirm")).toBeNull();
    expect(routePower("PUT", "/api/admin/capabilities/:capability/holding")).toBeNull();
    expect(routePower("DELETE", "/api/admin/capabilities/:capability/holding")).toBeNull();
  });

  it("keeps secrets their own power, so the settings never reach a provider key", () => {
    expect(routePower("PUT", "/api/admin/integrations/:key")).toBe("operator.secrets");
    expect(routePower("PUT", "/api/admin/settings")).toBe("operator.config");
  });

  it("matches the method as well as the path, and nothing for a route it does not name", () => {
    expect(routePower("put", "/api/admin/integrations/:key")).toBe("operator.secrets");
    expect(routePower("GET", "/api/admin/integrations/:key")).toBeNull();
    expect(routePower("POST", undefined)).toBeNull();
  });
});

describe("adminOrRouteHolder: nobody who reached a route before loses it", () => {
  const holdsNothing = async () => false;
  const throwsIfAsked = async (): Promise<boolean> => {
    throw new Error("the holder question was asked of an admin");
  };

  it("an admin reaches EVERY mapped route without the holder question being asked, whatever they hold", async () => {
    for (const cap of new Set(Object.values(ROUTE_POWERS))) {
      expect(await adminOrRouteHolder(true, cap, holdsNothing)).toBe(true);
      expect(await adminOrRouteHolder(true, cap, throwsIfAsked)).toBe(true);
    }
    expect(await adminOrRouteHolder(true, null, throwsIfAsked)).toBe(true);
  });

  it("a holder of the route's power reaches it, and a non-holder does not", async () => {
    const holds = async (c: Capability) => c === "story.tell";
    expect(await adminOrRouteHolder(false, "story.tell", holds)).toBe(true);
    expect(await adminOrRouteHolder(false, "operator.config", holds)).toBe(false);
  });

  it("a route with no power stays the admin's alone", async () => {
    expect(await adminOrRouteHolder(false, null, async () => true)).toBe(false);
  });
});
