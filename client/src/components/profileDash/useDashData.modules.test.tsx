// @vitest-environment jsdom
/**
 * The profile's reads of OPTIONAL modules go only when the module is on. An off
 * module has no routes, so each read was a 404 and a console error on every
 * profile load (audit M14). CONTROL: with the modules on the same reads go.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const modules = vi.hoisted(() => ({ state: { loaded: true, failed: false, modules: [] as Array<{ id: string; lifecycle: string }> } }));
vi.mock("@/modules/ModuleProvider", async (orig) => ({ ...(await orig<typeof import("@/modules/ModuleProvider")>()), useModules: () => modules.state }));
const asked = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => "t",
  gameFetch: async (url: string) => {
    asked.urls.push(url);
    return new Response("{}", { status: 200 });
  },
}));

import { useDashData } from "./useDashData";

function Probe() {
  useDashData("u1");
  return null;
}

afterEach(() => {
  cleanup();
  asked.urls = [];
});

describe("the profile's reads of optional modules", () => {
  it("asks for badges, messages and sessions only when those modules are on", async () => {
    modules.state = { loaded: true, failed: false, modules: [] };
    render(<Probe />);
    await waitFor(() => expect(asked.urls).toContain("/api/season"));
    expect(asked.urls.filter((u) => /\/api\/badges|\/api\/messages|\/api\/sessions/.test(u))).toEqual([]);
  });

  it("CONTROL: with all three on, the same reads go", async () => {
    modules.state = { loaded: true, failed: false, modules: ["badges", "messaging", "sessions"].map((id) => ({ id, lifecycle: "members" })) };
    render(<Probe />);
    await waitFor(() => expect(asked.urls.some((u) => u.startsWith("/api/badges/of/"))).toBe(true));
    expect(asked.urls).toEqual(expect.arrayContaining(["/api/messages", "/api/sessions", "/api/sessions/tasks/count"]));
  });
});
