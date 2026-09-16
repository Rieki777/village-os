// @vitest-environment jsdom
/**
 * A refused claim or submit reads the member's claim again (from the #235 review).
 *
 * The quest page kept whatever claim it had loaded. A submit refused because a
 * steward decided the claim meanwhile left the form open on work that could no
 * longer land, and a claim refused because the member already held one kept
 * offering the button. The server's sentence still shows, and now the claim is
 * read again. A request that never reached the server reads nothing more,
 * because the page could not reach the claim either.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const gameFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gameApi", () => ({ gameFetch }));

import QuestActions from "./QuestActions";

const onChanged = vi.fn();

const answer = (status: number, body: unknown) =>
  gameFetch.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => body });

const CLAIMED = {
  id: "claim-1",
  questId: "q-1",
  questTitle: "Tend the swale",
  status: "claimed" as const,
  claimedAt: "2026-09-14T10:00:00.000Z",
  artifactUrl: "",
  note: "",
};

describe("a refused claim or submit reads the member's claim again", () => {
  beforeEach(() => {
    gameFetch.mockReset();
    onChanged.mockReset();
  });

  it("a refused submit keeps the server's sentence and what was typed, and reads the claim again", async () => {
    const refusal = "This claim was already consented when this submission arrived, so nothing was changed.";
    answer(409, { error: refusal });
    render(<QuestActions questId="q-1" signedIn claim={CLAIMED} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /Submit your work/ }));
    const words = screen.getByPlaceholderText("A few words about what you did") as HTMLTextAreaElement;
    fireEvent.change(words, { target: { value: "Dug the first ten metres." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(refusal));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(words.value).toBe("Dug the first ten metres.");
  });

  it("a refused claim says why, and reads the claim again", async () => {
    answer(409, { error: "Already claimed", claim: CLAIMED });
    render(<QuestActions questId="q-1" signedIn claim={undefined} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /Claim this quest/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Already claimed"));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a claim that never reached the server says so, and reads nothing", async () => {
    gameFetch.mockRejectedValueOnce(new Error("offline"));
    render(<QuestActions questId="q-1" signedIn claim={undefined} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /Claim this quest/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not claim. Try again."));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a claim that lands reads the claim again, as it always did", async () => {
    answer(200, CLAIMED);
    render(<QuestActions questId="q-1" signedIn claim={undefined} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /Claim this quest/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
