// @vitest-environment jsdom
/**
 * A long sitting keeps working.
 *
 * The server refuses a conversation longer than MAX_TURNS (40 messages,
 * server/lib/assistant.ts) with "conversation too long". The panel used to
 * send the whole sitting on every ask, so after twenty exchanges the 21st ask
 * failed, and every ask after it, reloads included. The fetch stand-in below
 * refuses exactly what the server refuses.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { GuideMessage } from "@shared/journal";
import { TOKEN_KEY } from "@/lib/gameApi";
import GuidePanel, { GUIDE_MAX_MESSAGES, guideWindow } from "./GuidePanel";

const SERVER_MAX_TURNS = 40;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** `n` exchanges: the member, then the guide, n times. */
function exchanges(n: number): GuideMessage[] {
  return Array.from({ length: n }, (_, i): GuideMessage[] => [
    { role: "user", content: `ask ${i + 1}` },
    { role: "assistant", content: `answer ${i + 1}` },
  ]).flat();
}

let sent: GuideMessage[][];

beforeEach(() => {
  sent = [];
  const map = new Map<string, string>([[TOKEN_KEY, "tok-wren"]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "/api/journal/guide") return json({ error: "not-here" }, 404);
      const messages = JSON.parse(String(init?.body)).messages as GuideMessage[];
      sent.push(messages);
      // The same two refusals sanitizeMessages makes.
      if (messages.length > SERVER_MAX_TURNS) return json({ error: "conversation too long" }, 400);
      if (messages[messages.length - 1]?.role !== "user") return json({ error: "last message must be from the user" }, 400);
      return json({ reply: `heard: ${messages[messages.length - 1]!.content}`, nextQuestion: "", reflection: "" });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The panel inside a sitting that keeps its conversation, as TodayTab does. */
function Sitting({ start }: { start: GuideMessage[] }) {
  const [messages, setMessages] = useState(start);
  return (
    <>
      <GuidePanel
        open
        onClose={() => {}}
        request={() => ({ practice: "free", depth: "light", answers: [] })}
        messages={messages}
        onMessages={setMessages}
        onAddQuestion={() => {}}
        onConfirmReflection={() => {}}
      />
      <output data-testid="count">{messages.length}</output>
    </>
  );
}

async function ask(text: string) {
  fireEvent.change(screen.getByLabelText("Your message to the guide"), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  });
}

describe("a long sitting", () => {
  it("answers the 21st ask, and the 22nd, keeping the whole conversation on the page", async () => {
    render(<Sitting start={exchanges(20)} />);

    await ask("the twenty-first");
    expect(await screen.findByText("heard: the twenty-first")).toBeInTheDocument();
    expect(screen.queryByText(/conversation too long/)).toBeNull();

    await ask("the twenty-second");
    expect(await screen.findByText("heard: the twenty-second")).toBeInTheDocument();

    // Only the request was trimmed: the member still reads every turn.
    expect(screen.getByTestId("count")).toHaveTextContent("44");
    expect(screen.getByText("ask 1")).toBeInTheDocument();

    for (const body of sent) {
      expect(body.length).toBeLessThanOrEqual(SERVER_MAX_TURNS);
      expect(body[0]!.role).toBe("user");
    }
    expect(sent[0]!.at(-1)).toEqual({ role: "user", content: "the twenty-first" });
    expect(sent[1]!.at(-1)).toEqual({ role: "user", content: "the twenty-second" });
  });
});

describe("guideWindow", () => {
  const turn: GuideMessage = { role: "user", content: "now" };

  it("stays inside the server's limit", () => {
    expect(GUIDE_MAX_MESSAGES).toBeLessThanOrEqual(SERVER_MAX_TURNS);
  });

  it("sends a short conversation whole", () => {
    expect(guideWindow(exchanges(3), turn)).toEqual([...exchanges(3), turn]);
  });

  it("drops the oldest turns and starts the window on one of the member's own", () => {
    const window = guideWindow(exchanges(20), turn);
    expect(window.length).toBeLessThanOrEqual(GUIDE_MAX_MESSAGES);
    expect(window[0]!.role).toBe("user");
    expect(window.at(-1)).toBe(turn);
    // The newest turns are the ones kept.
    expect(window.at(-2)).toEqual({ role: "assistant", content: "answer 20" });
  });

  it("keeps the member's turn even when the history is far past the limit", () => {
    const window = guideWindow(exchanges(200), turn);
    expect(window.length).toBeLessThanOrEqual(GUIDE_MAX_MESSAGES);
    expect(window.at(-1)).toBe(turn);
  });
});
