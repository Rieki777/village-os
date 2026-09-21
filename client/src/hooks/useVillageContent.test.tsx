// @vitest-environment jsdom
/**
 * A page asks only for the content sections a village has written.
 *
 * THE DEFECT THIS PINS. Eleven public pages asked `GET /api/content/<section>`
 * for `legal`, `money` or `covenant` on every load, and on a village that had
 * written none of them every one of those answered 404. The 404 is the right
 * answer and the hook already read it as a placeholder, so nothing on the page
 * looked wrong. The console did: a browser logs every failed request by itself,
 * whatever the code does with the response, and those pages loaded red on every
 * visit. So the harm is a REQUEST, and the assertions below read the requests
 * the hook makes, not only what it returns. A version that caught the 404 more
 * politely would pass every check on `content` and fail the first one here.
 *
 * FOUR THINGS ARE PROVED:
 *
 *   1. An unwritten section is never requested, and still reads as a placeholder.
 *   2. A written section is requested and read exactly as before.
 *   3. A listing that cannot be read falls back to asking, so an outage in the
 *      list can never hide words a village has written.
 *   4. Two sections on one page share one listing request, and the next page
 *      asks again, so a section written a moment ago shows on the next visit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { readVillageSection, useVillageContent } from "./useVillageContent";

type Answer = { status: number; body: unknown };

/** Records every URL asked for, and answers from a table keyed by URL. */
function stubServer(answers: Record<string, Answer>): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any) => {
      const path = String(url);
      asked.push(path);
      const a = answers[path] ?? { status: 404, body: { error: "Section not found" } };
      return new Response(JSON.stringify(a.body), {
        status: a.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useVillageContent asks only for what exists", () => {
  it("never requests a section the village has not written, and reads it as a placeholder", async () => {
    const asked = stubServer({
      "/api/content": { status: 200, body: { sections: ["team", "investor"] } },
    });
    const { result } = renderHook(() => useVillageContent("legal"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.content).toBeNull();
    expect(result.current.isPlaceholder).toBe(true);
    expect(asked, "the unwritten section must not be requested at all").toEqual(["/api/content"]);
  });

  it("requests and reads a section the village has written, exactly as before", async () => {
    const asked = stubServer({
      "/api/content": { status: 200, body: { sections: ["legal"] } },
      "/api/content/legal": { status: 200, body: { jurisdictionOverview: "Our own words." } },
    });
    const { result } = renderHook(() => useVillageContent<{ jurisdictionOverview: string }>("legal"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.content?.jurisdictionOverview).toBe("Our own words.");
    expect(result.current.isPlaceholder).toBe(false);
    expect(asked).toEqual(["/api/content", "/api/content/legal"]);
  });

  it("asks for the section anyway when the listing cannot be read", async () => {
    const asked = stubServer({
      "/api/content": { status: 500, body: { error: "boom" } },
      "/api/content/money": { status: 200, body: { valueConversion: "One to one." } },
    });
    const { result } = renderHook(() => useVillageContent<{ valueConversion: string }>("money"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.content?.valueConversion, "an unreadable list must never hide written words").toBe(
      "One to one.",
    );
    expect(asked).toEqual(["/api/content", "/api/content/money"]);
  });

  it("still reads a 404 as a placeholder on that fallback path", async () => {
    const asked = stubServer({
      "/api/content": { status: 503, body: {} },
    });
    const { result } = renderHook(() => useVillageContent("covenant"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isPlaceholder).toBe(true);
    expect(asked).toEqual(["/api/content", "/api/content/covenant"]);
  });

  it("shares one listing between two sections on one page, and asks again on the next page", async () => {
    const asked = stubServer({
      "/api/content": { status: 200, body: { sections: ["covenant"] } },
      "/api/content/covenant": { status: 200, body: { opening: "Dear village," } },
    });
    const first = renderHook(() => ({
      legal: useVillageContent("legal"),
      covenant: useVillageContent<{ opening: string }>("covenant"),
    }));
    await waitFor(() => {
      expect(first.result.current.legal.loading).toBe(false);
      expect(first.result.current.covenant.loading).toBe(false);
    });
    expect(first.result.current.legal.isPlaceholder).toBe(true);
    expect(first.result.current.covenant.content?.opening).toBe("Dear village,");
    expect(asked.filter((u) => u === "/api/content"), "one listing for the whole page").toHaveLength(1);
    expect(asked).not.toContain("/api/content/legal");
    first.unmount();

    // The next page: a founder has written `legal` in the meantime.
    const again = stubServer({
      "/api/content": { status: 200, body: { sections: ["covenant", "legal"] } },
      "/api/content/legal": { status: 200, body: { membership: "Written a moment ago." } },
    });
    const next = renderHook(() => useVillageContent<{ membership: string }>("legal"));
    await waitFor(() => expect(next.result.current.loading).toBe(false));
    expect(next.result.current.content?.membership, "a new section shows on the next visit").toBe(
      "Written a moment ago.",
    );
    expect(again).toEqual(["/api/content", "/api/content/legal"]);
  });
});

describe("readVillageSection, the door /team reads through", () => {
  it("hands back the team cards as the array they are when the section is written", async () => {
    const asked = stubServer({
      "/api/content": { status: 200, body: { sections: ["team"] } },
      "/api/content/team": { status: 200, body: [{ name: "Rowan" }] },
    });
    expect(await readVillageSection("team")).toEqual([{ name: "Rowan" }]);
    expect(asked).toEqual(["/api/content", "/api/content/team"]);
  });

  it("answers null without a request on a fork that has written no team cards", async () => {
    const asked = stubServer({
      "/api/content": { status: 200, body: { sections: [] } },
    });
    expect(await readVillageSection("team")).toBeNull();
    expect(asked).toEqual(["/api/content"]);
  });
});
