// @vitest-environment jsdom
/**
 * The picker, rendered, because "the ten needs are never retyped" is a claim
 * about what a founder SEES and nothing else in this tree could be asked it.
 *
 * FOUR OUTCOMES:
 *
 *   1. THE ROWS COME FROM shared/needs.ts. The hint line under each need is
 *      asserted against `expressionsLine(HUMAN_NEEDS_BY_ID[key])`, which is
 *      the deck's own row and is NOT in the payload the server sends. If this
 *      component ever spelled a need's expressions itself, that string would
 *      have to be kept in step with the taxonomy by hand, and this assertion
 *      is what makes the drift impossible.
 *   2. A TICK POSTS THE LINK and hands the saved row back, keyed by the need
 *      the founder pressed and carrying the weight of the button they pressed.
 *   3. A REFUSAL PRINTS THE SERVER'S SENTENCE WORD FOR WORD, and the caller is
 *      told nothing landed. The server names the need it refused and says why;
 *      no sentence written in this file could do that, so it prints theirs.
 *   4. A VILLAGE WITH NO SCOPE gets a sentence saying so. An empty picker and
 *      a village that has not said what it is for are different facts.
 *
 * `fetch` is stubbed and `gameFetch` is the real one, so the Authorization
 * header this component depends on is exercised and not mocked away.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HUMAN_NEEDS_BY_ID, expressionsLine } from "@shared/needs";
import { TOKEN_KEY } from "@/lib/gameApi";
import NeedTagPicker from "./NeedTagPicker";
import type { NeedTag } from "@/components/NeedChips";

/** What `GET /api/needs/scope` answers with, trimmed to what the picker reads. */
const SCOPE = {
  scope: [
    { needKey: "vitality", label: "Vitality & Survival Needs", active: true },
    { needKey: "play", label: "Play", active: true },
    { needKey: "growth", label: "Growth", active: false },
  ],
};

type Answer = { ok: boolean; status: number; body: unknown };

function stubFetch(answers: { scope?: unknown; write?: Answer }) {
  const calls: Array<{ url: string; init: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/api/needs/scope")) {
        return { ok: true, status: 200, json: async () => answers.scope ?? SCOPE };
      }
      const w = answers.write ?? { ok: true, status: 200, body: {} };
      return { ok: w.ok, status: w.status, json: async () => w.body };
    }),
  );
  return calls;
}

/*
 * A Storage of our own. jsdom hands this file a `localStorage` that is not a
 * real Storage under this vitest, and the point of the header's promise is
 * that `gameFetch` is the REAL one, so the token has to come from somewhere it
 * genuinely reads. Keyed by the exported `TOKEN_KEY`, never a retyped string:
 * a key spelled here by hand would go on passing on the day the app changed it
 * and the header assertion below would be testing nothing.
 */
beforeEach(() => {
  const store = new Map<string, string>([[TOKEN_KEY, "a-token"]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const mount = (tags: NeedTag[] = [], onChanged = vi.fn()) => {
  render(
    <NeedTagPicker subjectType="quest" subjectRef="q-forest" tags={tags} onChanged={onChanged} />,
  );
  return onChanged;
};

describe("the picker offers the village's own scope, spelled from shared/needs.ts", () => {
  it("prints the deck's expressions under each need, which no payload carried", async () => {
    stubFetch({});
    mount();
    // The label is the village's stored word; the hint line exists only in
    // shared/needs.ts, so finding it proves where the row was built from.
    expect(await screen.findByText("Play")).toBeTruthy();
    expect(screen.getByText(expressionsLine(HUMAN_NEEDS_BY_ID.vitality!))).toBeTruthy();
    expect(screen.getByText(expressionsLine(HUMAN_NEEDS_BY_ID.play!))).toBeTruthy();
  });

  it("leaves a retired need out of the list", async () => {
    stubFetch({});
    mount();
    await screen.findByText("Play");
    expect(screen.queryByText("Growth")).toBeNull();
  });

  it("says so when the village has taken on nothing", async () => {
    stubFetch({ scope: { scope: [] } });
    mount();
    expect(
      await screen.findByText(/This village has not said which needs it is taking on/),
    ).toBeTruthy();
  });
});

describe("what a tick does", () => {
  it("posts the link and hands back the saved row", async () => {
    const calls = stubFetch({
      write: { ok: true, status: 200, body: { success: true, link: { id: "nlink-1", weight: "partial" } } },
    });
    const onChanged = mount();
    await screen.findByText("Play");
    // Two weights per row, so the button is found within the row's own list item.
    const row = screen.getByText("Play").closest("li")!;
    const helps = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Helps with it")!;
    await userEvent.click(helps);

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const write = calls.find((c) => c.url.includes("/api/admin/needs/links"))!;
    expect(write.init.method).toBe("POST");
    expect(JSON.parse(write.init.body)).toEqual({
      needKey: "play",
      subjectType: "quest",
      subjectRef: "q-forest",
      weight: "partial",
    });
    // The Authorization header is gameFetch's, and this is the one place a
    // stubbed helper would have hidden its absence.
    expect(write.init.headers.Authorization).toBe("Bearer a-token");
    expect(onChanged.mock.calls[0][0]).toEqual([
      { id: "nlink-1", needKey: "play", needLabel: "Play", weight: "partial", needActive: true },
    ]);
  });

  it("prints the server's refusal word for word, and saves nothing", async () => {
    const refusal = 'This village has not taken on "play".';
    stubFetch({ write: { ok: false, status: 400, body: { error: refusal } } });
    const onChanged = mount();
    await screen.findByText("Play");
    const row = screen.getByText("Play").closest("li")!;
    const meets = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Meets it")!;
    await userEvent.click(meets);

    const said = await screen.findByRole("alert");
    expect(said.textContent).toBe(refusal);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
