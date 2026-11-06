// @vitest-environment jsdom
/**
 * The join form offers THIS village's paths, in its own words (Admin, Make it
 * yours, Paths & Stages), and records the fixed ids behind them.
 *
 * Its own file because the public config is fetched once per module and
 * cached: Register.test.tsx renders with no config at all (and so pins that
 * the form still offers today's four when the config cannot be had), and this
 * file needs the config a renamed village serves from the first render.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import type { ReactNode } from "react";

const registerMock = vi.fn();

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ register: registerMock }),
}));
vi.mock("@/components/auth/signInMethods", () => ({
  fetchSignInMethods: () => Promise.resolve({ password: true, google: false, inviteOnly: false }),
}));

/** What `/api/game/config` serves a village that renamed its paths. */
const CONFIG = {
  project: { name: "Riverbend" },
  currency: { name: "Thanks", nameLower: "thanks" },
  images: {},
  paths: [
    { id: "investor", label: "Backer", role: "Funder", route: "/investor", description: "Fund the build." },
    { id: "steward", label: "Keeper", role: "Tender", route: "/steward", description: "Keep Riverbend running." },
    { id: "resident", label: "Neighbour", role: "Dweller", route: "/resident", description: "Live in Riverbend." },
    { id: "prosperity-creator", label: "Maker", role: "Builder", route: "/prosperity", description: "Build a trade here." },
  ],
  stages: [],
  ladder: { title: "The Spiral" },
  season: {},
};

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any) =>
      String(url).endsWith("/api/game/config")
        ? new Response(JSON.stringify(CONFIG), { status: 200 })
        : new Response("{}", { status: 404 }),
    ),
  );
});
afterAll(() => vi.unstubAllGlobals());

import Register from "./Register";

describe("Register, in a village that named its own paths", () => {
  it("offers the village's names and sentences, and none of the platform's", async () => {
    render(
      <Router>
        <Register />
      </Router>,
    );
    expect(await screen.findByRole("button", { name: /Keeper/ })).toBeInTheDocument();
    for (const label of ["Backer", "Neighbour", "Maker"]) expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    expect(screen.getByText("Fund the build.")).toBeInTheDocument();
    expect(screen.getByText("Keep Riverbend running.")).toBeInTheDocument();
    for (const platform of ["Investor", "Village Steward", "Prosperity Creator"]) {
      expect(screen.queryByRole("button", { name: new RegExp(platform) })).toBeNull();
    }
  });

  it("records the fixed ids behind the village's names", async () => {
    registerMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(
      <Router>
        <Register />
      </Router>,
    );
    await user.type(await screen.findByLabelText(/^name$/i), "Ada");
    await user.type(screen.getByLabelText(/^email$/i), "ada@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "hunter22");
    await user.type(screen.getByLabelText(/confirm password/i), "hunter22");
    await user.click(await screen.findByRole("button", { name: /Keeper/ }));
    await user.click(screen.getByRole("button", { name: /Maker/ }));
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(registerMock).toHaveBeenCalledWith("Ada", "ada@example.com", "hunter22", ["steward", "prosperity-creator"]);
  });
});
