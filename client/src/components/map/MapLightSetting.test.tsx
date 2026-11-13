// @vitest-environment jsdom
/**
 * The member's own light (Phase D, D2): the setting starts where the server
 * says (off by default), follows the server's answer instead of leading it,
 * stays hidden where the map is off, and the map's card says what the lights
 * are without a count or a name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

let mapOn = true;
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: () => mapOn }));

import MapLightSetting from "./MapLightSetting";
import TodayOnTheMap, { MY_LIGHT_HREF } from "./TodayOnTheMap";
import { readHearths } from "./useHearths";

i18n.load("en", {});
i18n.activate("en");
const wrap = (ui: React.ReactElement) => render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);

const answer = (status: number, body: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);

let server: { on: boolean; refuse: boolean };
let puts: unknown[];

beforeEach(() => {
  mapOn = true;
  server = { on: false, refuse: false };
  puts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/map/my-light" && (!init?.method || init.method === "GET")) return answer(200, { on: server.on });
      if (url === "/api/map/my-light" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        if (server.refuse) return answer(400, { error: "no" });
        server.on = body.on;
        return answer(200, { on: server.on });
      }
      return answer(404, {});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Show my light on the map", () => {
  it("starts off when the member never chose, and turns on with the server's answer", async () => {
    wrap(<MapLightSetting />);
    const box = (await screen.findByRole("checkbox", { name: /Show my light on the map/ })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(true));
    expect(puts).toEqual([{ on: true }]);
    expect(server.on).toBe(true);
  });

  it("stays where it was and says so when the server refuses", async () => {
    server.refuse = true;
    wrap(<MapLightSetting />);
    const box = (await screen.findByRole("checkbox", { name: /Show my light on the map/ })) as HTMLInputElement;
    fireEvent.click(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your light is unchanged.");
    expect(box.checked).toBe(false);
  });

  it("is not drawn where the village does not run the map", async () => {
    mapOn = false;
    wrap(<MapLightSetting />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(puts).toEqual([]);
  });
});

describe("the map's Today card", () => {
  const names: Record<string, string> = { garden: "Garden Circle", kitchen: "Kitchen Circle" };

  it("names the circles that meet and the member's own light, never a count of people", () => {
    wrap(
      <TodayOnTheMap
        today={{ day: "2026-11-12", myLight: false, hearths: [
          { circleId: "garden", meetsToday: true, lights: 5 },
          { circleId: "kitchen", meetsToday: false, lights: 2 },
        ] }}
        circleName={(id) => names[id] ?? id}
      />,
    );
    const card = document.querySelector("[data-today-on-map]")!;
    expect(card.querySelector("[data-meeting-today]")!.textContent).toBe("Meeting today: Garden Circle.");
    expect(card.textContent).toContain("never with a name");
    expect(card.textContent).not.toMatch(/\d/);
    expect(card.querySelector("[data-my-light]")!.getAttribute("data-my-light")).toBe("off");
    expect(screen.getByRole("link", { name: "Change it" }).getAttribute("href")).toBe(MY_LIGHT_HREF);
  });

  it("says plainly when no circle meets today", () => {
    wrap(<TodayOnTheMap today={{ day: "2026-11-12", myLight: true, hearths: [] }} circleName={(id) => id} />);
    expect(document.querySelector("[data-meeting-today]")!.textContent).toBe("No circle meets today.");
    expect(document.querySelector("[data-my-light]")!.getAttribute("data-my-light")).toBe("on");
  });
});

describe("reading today's hearths off the wire", () => {
  it("takes the shape the map draws and refuses anything else", () => {
    const good = { day: "2026-11-12", myLight: false, hearths: [{ circleId: "g", meetsToday: true, lights: 2 }] };
    expect(readHearths(good)).toEqual(good);
    expect(readHearths(null)).toBeNull();
    expect(readHearths({ ...good, myLight: "no" })).toBeNull();
    expect(readHearths({ ...good, hearths: [{ circleId: "g", meetsToday: true, lights: -1 }] })).toBeNull();
    expect(readHearths({ ...good, hearths: [{ circleId: "g", meetsToday: true, lights: 1.5 }] })).toBeNull();
  });
});
