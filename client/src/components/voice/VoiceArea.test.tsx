// @vitest-environment jsdom
/**
 * A long box you can talk to: the mic beside every wrapped box, and "Talk it
 * out" for a signed-in member, whose draft reaches the box only on "Use this"
 * or "Add to mine".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

let signedIn = true;
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: signedIn ? { id: "u-1", name: "Wren" } : null }) }));
vi.mock("@/components/MicButton", () => ({
  default: ({ onText }: { onText: (s: string) => void }) => (
    <button type="button" aria-label="Speak instead of typing" onClick={() => onText("spoken words")} />
  ),
}));

import VoiceArea from "./VoiceArea";

function Box({ start = "" }: { start?: string }) {
  const [v, setV] = useState(start);
  return (
    <>
      <VoiceArea value={v} onValue={setV} talk={{ label: "About you", purpose: "Who you are." }}>
        <textarea aria-label="About you" value={v} onChange={(e) => setV(e.target.value)} className="box" />
      </VoiceArea>
      <output data-testid="value">{v}</output>
    </>
  );
}

const guide = { choice: null, options: [{ id: "village", name: "Maia", named: true, available: true }, { id: "saberra", name: "Sera", named: true, available: true }], answering: "village", note: null, canChoose: true };

function mockFetch(answer: unknown) {
  const calls: Array<{ url: string; init: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url, init });
    const body = url === "/api/guide" ? guide : answer;
    return { ok: true, status: 200, json: async () => body } as any;
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  signedIn = true;
});

describe("VoiceArea", () => {
  it("adds the mic, leaves the box as it was, and appends what is said", async () => {
    render(<Box start="I grow food." />);
    const box = screen.getByRole("textbox", { name: "About you" });
    expect(box.className).toContain("box");
    expect(box.className).toContain("pr-12");
    await userEvent.click(screen.getByRole("button", { name: "Speak instead of typing" }));
    expect(screen.getByTestId("value").textContent).toBe("I grow food. spoken words");
  });

  it("keeps the box's own length limit for spoken words too", async () => {
    function Short() {
      const [v, setV] = useState("12345678");
      return (
        <>
          <VoiceArea value={v} onValue={setV}>
            <textarea aria-label="Short" maxLength={12} value={v} onChange={(e) => setV(e.target.value)} />
          </VoiceArea>
          <output data-testid="short">{v}</output>
        </>
      );
    }
    render(<Short />);
    await userEvent.click(screen.getByRole("button", { name: "Speak instead of typing" }));
    expect(screen.getByTestId("short").textContent).toBe("12345678 spo");
  });

  it("offers Talk it out to a member only", () => {
    signedIn = false;
    render(<Box />);
    expect(screen.queryByRole("button", { name: "Talk it out" })).toBeNull();
  });

  it("talks it through with the member's guide, shows who answers, and puts the draft in only on Use this", async () => {
    const calls = mockFetch({ reply: "What do you grow?", draft: "I grow beans and squash for the village kitchen.", guide: { id: "village", name: "Maia" } });
    render(<Box start="I grow food." />);
    await userEvent.click(screen.getByRole("button", { name: "Talk it out" }));
    expect(await screen.findByTestId("talk-it-out")).toBeTruthy();
    expect((await screen.findAllByText(/Maia/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Sera/ })).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "Your words to the guide" }), "beans mostly{Enter}");
    expect(await screen.findByText("What do you grow?")).toBeTruthy();
    const post = calls.find((c) => c.url === "/api/guide/field")!;
    expect(JSON.parse(post.init.body)).toMatchObject({ field: { label: "About you", purpose: "Who you are." }, text: "I grow food.", messages: [{ role: "user", content: "beans mostly" }] });
    expect(screen.getByTestId("value").textContent).toBe("I grow food.");
    await userEvent.click(screen.getByRole("button", { name: "Add to mine" }));
    expect(screen.getByTestId("value").textContent).toBe("I grow food.\n\nI grow beans and squash for the village kitchen.");
  });

  it("says plainly when the guide cannot answer, and the box keeps its words", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/guide"
      ? { ok: true, status: 200, json: async () => guide }
      : { ok: false, status: 503, json: async () => ({ error: "The guide can't answer right now. Your words are safe in the box." }) }) as any));
    render(<Box start="mine" />);
    await userEvent.click(screen.getByRole("button", { name: "Talk it out" }));
    await userEvent.click(await screen.findByRole("button", { name: "Help me make it clearer" }));
    expect(await screen.findByText("The guide can't answer right now. Your words are safe in the box.")).toBeTruthy();
    expect(screen.getByTestId("value").textContent).toBe("mine");
  });
});
