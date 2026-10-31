// @vitest-environment jsdom
/**
 * `/circles/:id` mounts the circle's sessions below its card, handed the
 * circle, its name, and whether the reader is signed in, as the card's own
 * answer says. The card and the sessions are their own tests'; this one holds
 * the wiring between them.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ body: null as unknown, mounted: [] as unknown[] }));
vi.mock("@/lib/gameApi", () => ({
  gameFetch: async () => new Response(JSON.stringify(state.body), { status: 200, headers: { "Content-Type": "application/json" } }),
}));
vi.mock("wouter", () => ({
  useParams: () => ({ id: "qa-garden" }),
  Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/circleCard/CircleCardView", () => ({ default: () => <div data-testid="card" /> }));
vi.mock("@/components/sessions/CircleSessions", () => ({
  default: (props: unknown) => {
    state.mounted.push(props);
    return <div data-testid="sessions" />;
  },
}));

import CircleCardPage from "./CircleCardPage";

const answer = (signedIn: boolean) => ({
  circleId: "qa-garden",
  card: { header: { name: "Garden Circle" }, sections: [], pending: [], pendingWords: [], proposals: [] },
  viewer: { signedIn, mayPropose: false },
});

beforeEach(() => {
  state.mounted = [];
});

describe("the circle card page", () => {
  it("mounts the circle's sessions below the card for a signed-in reader", async () => {
    state.body = answer(true);
    render(<CircleCardPage />);
    expect(await screen.findByTestId("sessions")).toBeInTheDocument();
    const card = screen.getByTestId("card");
    expect(card.compareDocumentPosition(screen.getByTestId("sessions")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(state.mounted.at(-1)).toEqual({ circleId: "qa-garden", circleName: "Garden Circle", signedIn: true });
  });

  it("tells the sessions a visitor is signed out, so they ask nothing", async () => {
    state.body = answer(false);
    render(<CircleCardPage />);
    await screen.findByTestId("sessions");
    expect(state.mounted.at(-1)).toEqual({ circleId: "qa-garden", circleName: "Garden Circle", signedIn: false });
  });
});
