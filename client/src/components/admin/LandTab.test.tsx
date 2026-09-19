// @vitest-environment jsdom
/**
 * The land screen, rendered, because everything worth asserting about it is a
 * claim about what a founder SEES.
 *
 * FIVE OUTCOMES, each one taken from docs/VILLAGE_LAND.md section 6 rather
 * than from the implementation:
 *
 *   1. THE READING IS SHOWN AS THEY TYPE, from the SHARED parser. Seeing the
 *      decimal pair is how a founder catches a wrong pin before it is saved.
 *   2. A REFUSAL PRINTS THE PARSER'S OWN SENTENCE. The copy in shared/land.ts
 *      is written for a founder and says what to do; "Invalid input" is the
 *      named failure, and this file asserts that phrase never appears.
 *   3. THE PICTURE WARNING IS NEXT TO THE RADIOS. The three settings cover the
 *      coordinates only, and the setting is named in a way that invites a
 *      founder to assume otherwise. The spec requires this said in plain
 *      words, so a test asks for it in plain words.
 *   4. A SAVE NAMES A PARCEL. Absent means 'home', which is the row every
 *      village that predates parcels already has.
 *   5. A DEPLOYMENT WITH NO PROVIDER SAYS SO and does not offer a button that
 *      would fail.
 *
 * `fetch` is stubbed; everything else is the real component.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseCoordinates } from "@shared/land";
import LandTab from "./LandTab";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

/** One parcel, saved, with a kept picture and a ready provider. */
const ONE_PARCEL = {
  parcels: [
    {
      slug: "home",
      label: "",
      sortOrder: 0,
      centre: { lat: 9.2345, lon: -83.8412 },
      spanM: 800,
      visibility: "exact",
      sourceText: "9.2345, -83.8412",
      imagery: {
        provider: "sentinel2",
        url: "/api/uploads/land-sentinel2.jpg",
        attribution: "Contains modified Copernicus Sentinel data 2026",
        fetchedAt: "2026-09-19 10:00:00",
        error: null,
      },
    },
  ],
  configured: { providerId: "sentinel2", providerLabel: "Copernicus Sentinel-2", ready: true, missingEnv: null },
};

/** A fresh deployment: no parcel row at all, and nothing to fetch from. */
const UNSET = { parcels: [], configured: { providerId: null, providerLabel: null, ready: false, missingEnv: null } };

function stubFetch(read: unknown, write: { ok: boolean; body?: unknown } = { ok: true, body: { success: true } }) {
  const calls: Array<{ url: string; init: any }> = [];
  const fn = vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url: String(url), init });
    const isWrite = (init.method ?? "GET") !== "GET";
    const body = isWrite ? (write.body ?? {}) : read;
    return {
      ok: isWrite ? write.ok : true,
      status: isWrite && !write.ok ? 400 : 200,
      json: async () => body,
    } as any;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("the land screen a founder actually meets", () => {
  it("shows the reading of what they typed, from the shared parser", async () => {
    stubFetch(ONE_PARCEL);
    render(<LandTab password="pw" />);
    await waitFor(() => expect(screen.getByDisplayValue("9.2345, -83.8412")).toBeTruthy());
    // The interpretation, not just the echo: this is how a wrong pin is caught.
    await waitFor(() => expect(screen.getByText(/a pair of decimal numbers/i)).toBeTruthy());
  });

  it("prints the parser's own sentence on a bad paste, and never says 'Invalid input'", async () => {
    stubFetch(ONE_PARCEL);
    const user = userEvent.setup();
    render(<LandTab password="pw" />);
    const BAD = "somewhere near the big rock";
    const failure = parseCoordinates(BAD);
    if (failure.ok) throw new Error("this fixture must be a parse FAILURE for the test to mean anything");

    const field = await screen.findByDisplayValue("9.2345, -83.8412");
    await user.clear(field);
    await user.type(field, BAD);

    /*
     * The parser's OWN sentence, word for word, taken from the parser rather
     * than retyped here. An assertion on a vaguer pattern passed against this
     * screen's ambient helper copy while the message itself was absent, which
     * is the exact failure this test exists to catch.
     */
    await waitFor(() => expect(screen.getByText(failure.message)).toBeTruthy());
    expect(document.body.innerHTML).not.toContain("Invalid input");
  });

  it("says in plain words that the picture is shown at every visibility setting", async () => {
    stubFetch(ONE_PARCEL);
    render(<LandTab password="pw" />);
    await waitFor(() => expect(screen.getByText(/coordinates only/i)).toBeTruthy());
    expect(screen.getByText(/shown to visitors at every setting/i)).toBeTruthy();
  });

  it("saves against 'home' when the project has only one piece of ground", async () => {
    const calls = stubFetch(ONE_PARCEL);
    const user = userEvent.setup();
    render(<LandTab password="pw" />);
    const save = await screen.findByRole("button", { name: /save this location/i });
    await user.click(save);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(JSON.parse(put.init.body).slug).toBe("home");
  });

  it("tells a deployment with no provider why there is nothing to fetch", async () => {
    stubFetch(UNSET);
    render(<LandTab password="pw" />);
    await waitFor(() => expect(screen.getByText(/No imagery provider is set up/i)).toBeTruthy());
    const fetchBtn = screen.getByRole("button", { name: /fetch the picture/i }) as HTMLButtonElement;
    expect(fetchBtn.disabled).toBe(true);
  });

  it("derives a parcel's address from the name a founder types", async () => {
    stubFetch(ONE_PARCEL);
    const user = userEvent.setup();
    render(<LandTab password="pw" />);
    const add = await screen.findByPlaceholderText("North field");
    await user.type(add, "The Ridge");
    // The address is shown before they commit to it.
    await waitFor(() => expect(screen.getByText("/the-ridge")).toBeTruthy());
  });
});
