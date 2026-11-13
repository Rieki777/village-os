// @vitest-environment jsdom
/**
 * The profile asks for the moon reviews queue only for a reader who holds a
 * reviewing power (batch 158): it asked for everybody, and every non-reviewer's
 * profile logged a 403 for /api/moon-review/queue.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: () => true }));
vi.mock("./MyMoon", () => ({ default: () => <p>my moon</p> }));
const queueMounted = vi.fn();
vi.mock("./ReviewQueue", () => ({
  default: () => {
    queueMounted();
    return <p>the queue</p>;
  },
}));

import MyMoonMount, { holdsReviewPower } from "./MyMoonMount";

afterEach(() => {
  cleanup();
  queueMounted.mockClear();
});

describe("holdsReviewPower", () => {
  it("is unknown until the powers are read, and true only for an approver or a payer", () => {
    expect(holdsReviewPower(null)).toBeUndefined();
    expect(holdsReviewPower([{ key: "quests.claim", held: true }, { key: "moon.approve", held: false }])).toBe(false);
    expect(holdsReviewPower([{ key: "moon.approve", held: true }])).toBe(true);
    expect(holdsReviewPower([{ key: "cash.pay", held: true }])).toBe(true);
  });
});

describe("MyMoonMount", () => {
  it("never mounts the queue (so never asks for it) for a member who is not a reviewer, or while that is unknown", async () => {
    const { rerender } = render(<MyMoonMount />);
    await screen.findByText("my moon");
    rerender(<MyMoonMount reviewer={false} />);
    await screen.findByText("my moon");
    expect(screen.queryByText("the queue")).toBeNull();
    expect(queueMounted).not.toHaveBeenCalled();
  });

  it("mounts the queue for a reviewer", async () => {
    render(<MyMoonMount reviewer />);
    expect(await screen.findByText("the queue")).toBeTruthy();
  });
});
