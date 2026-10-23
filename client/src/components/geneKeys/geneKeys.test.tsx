// @vitest-environment jsdom
/**
 * Gene Keys in the browser: the birth-town list, the seal, and a circle's six
 * lines. Every person is invented; every chart comes from an invented birth
 * through the same calculator the flow page runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { viewOf, type GeneKeysView } from "@shared/geneKeys";
import { chartAt, zonedToUtc } from "@shared/geneKeysSky";

const modules = vi.hoisted(() => ({ on: true }));
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: (id: string) => id === "gene-keys" && modules.on }));

const api = vi.hoisted(() => ({ people: {} as Record<string, unknown>, asked: [] as string[][] }));
vi.mock("@/lib/geneKeysApi", () => ({
  readPeopleGeneKeys: async (ids: string[]) => {
    api.asked.push(ids);
    return api.people;
  },
  readPlacesText: async () => "",
  changeMyGeneKeys: async () => null,
  removeMyGeneKeys: async () => true,
  GeneKeysRefusal: class extends Error {},
}));

import { parsePlaces, searchPlaces } from "./places";
import GeneKeysSeal from "./GeneKeysSeal";
import CircleLines from "./CircleLines";

const view = (zone: string, y: number, mo: number, d: number, h: number, mi: number): GeneKeysView =>
  viewOf(chartAt(zonedToUtc(y, mo, d, h, mi, zone)));
/** Wren 2/5 Manifestor, Kai 3/6 Generator, Juno 1/3 Generator. */
const WREN = view("America/New_York", 1990, 6, 15, 14, 30);
const KAI = view("Europe/London", 2001, 7, 10, 4, 2);
const JUNO = view("Asia/Tokyo", 1995, 3, 3, 14, 54);

const inRouter = (node: ReactElement) => {
  const { hook } = memoryLocation({ path: "/profile" });
  return render(<Router hook={hook}>{node}</Router>);
};

beforeEach(() => {
  modules.on = true;
  api.people = {};
  api.asked = [];
});
afterEach(cleanup);

describe("the birth-town list", () => {
  const TEXT = [
    "# GeoNames cities15000, CC BY 4.0, https://www.geonames.org (generated 2026-10-22)",
    "America/Denver",
    "America/Phoenix",
    "America/Costa_Rica",
    "",
    "Phoenix\t\tUS\t1",
    "Denver\t\tUS\t0",
    "San José\tSan Jose\tCR\t2",
    "Boulder\t\tUS\t0",
    "",
  ].join("\r\n");

  it("reads CRLF and LF alike and keeps each town's own zone", () => {
    const places = parsePlaces(TEXT);
    expect(places.map((p) => `${p.name}:${p.zone}`)).toEqual([
      "Phoenix:America/Phoenix", "Denver:America/Denver", "San José:America/Costa_Rica", "Boulder:America/Denver",
    ]);
    expect(parsePlaces(TEXT.replace(/\r\n/g, "\n"))).toEqual(places);
  });

  it("finds a town by its start or a word in it, accents folded, and waits for two letters", () => {
    const places = parsePlaces(TEXT);
    expect(searchPlaces(places, "san jo").map((p) => p.name)).toEqual(["San José"]);
    expect(searchPlaces(places, "jose").map((p) => p.name)).toEqual(["San José"]);
    expect(searchPlaces(places, "b")).toEqual([]);
  });
});

describe("the seal", () => {
  it("is a named button that opens the lines card", async () => {
    inRouter(<GeneKeysSeal view={WREN} whose="Wren" />);
    const seal = screen.getByRole("button", { name: /Gene Keys lines 2 and 5, Dancer and Fixer/ });
    expect(seal.textContent).toBe("2/5");
    fireEvent.click(seal);
    expect(await screen.findByText("Explore more in depth on genekeys.com")).toBeTruthy();
    expect(screen.getByText("How Wren works best")).toBeTruthy();
    expect(screen.getByText("Manifestor")).toBeTruthy();
    expect(screen.getByText("12.2")).toBeTruthy();
  });
});

describe("a circle's six lines", () => {
  const HOLDERS = [
    { id: "m-wren", name: "Wren" },
    { id: "m-kai", name: "Kai" },
    { id: "m-juno", name: "Juno" },
    { id: "m-ash", name: "Ash" },
  ];

  it("shows who holds each line, the open one as an invitation, and the hidden as a count", async () => {
    api.people = { "m-wren": WREN, "m-kai": KAI, "m-juno": JUNO };
    inRouter(<CircleLines holders={HOLDERS} />);
    expect(await screen.findByText("5 of 6 lines held · 1 member keeps their lines private")).toBeTruthy();
    expect(screen.getAllByText("Open · who will hold it?")).toHaveLength(1);
    expect(screen.getByText("4 · Server")).toBeTruthy();
    expect(screen.queryByText(/Ash/)).toBeNull();
    expect(screen.getByText("1 Manifestor · 2 Generators")).toBeTruthy();
    expect(api.asked).toEqual([["m-ash", "m-juno", "m-kai", "m-wren"]]);
  });

  it("draws nothing while the module is off, and asks nothing", async () => {
    modules.on = false;
    const { container } = inRouter(<CircleLines holders={HOLDERS} />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(api.asked).toEqual([]);
  });

  it("draws nothing when nobody in the circle shows their lines", async () => {
    const { container } = inRouter(<CircleLines holders={HOLDERS} />);
    await waitFor(() => expect(api.asked).toHaveLength(1));
    expect(container.innerHTML).toBe("");
  });
});
