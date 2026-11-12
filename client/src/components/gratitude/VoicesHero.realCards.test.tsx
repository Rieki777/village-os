// @vitest-environment jsdom
/**
 * D-24: a real card never carries the Example chip. Only a row the server
 * marks `isExample` is labelled (rule 2 of the standing-examples contract).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));

import VoicesHero from "./VoicesHero";

afterEach(() => vi.unstubAllGlobals());

const answer = (voices: Array<{ id: string; message: string; isExample: boolean }>) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ voices, realTotal: voices.filter((v) => !v.isExample).length }) })));

describe("the wall's real cards", () => {
  it("draws no Example chip on a neighbour's words", async () => {
    answer([{ id: "r1", message: "You carried water to the new beds.", isExample: false }]);
    render(<VoicesHero />);
    await screen.findByText("You carried water to the new beds.");
    expect(screen.queryByText("Example")).toBeNull();
  });
  it("CONTROL: a platform example still carries its label", async () => {
    answer([{ id: "e1", message: "A shipped example line.", isExample: true }]);
    render(<VoicesHero />);
    await screen.findByText("A shipped example line.");
    expect(screen.getByText("Example")).toBeTruthy();
  });
});
