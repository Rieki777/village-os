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
import { parseCoordinates, seedFrame } from "@shared/land";
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
describe("the frame, the undo, and saying which outcome a founder got", () => {
  const SEED = seedFrame();

  it("offers the map's own frame when somebody pastes a place near it that is not it", async () => {
    // The fixture is about a kilometre from the seed at 800 m wide: the exact mistake.
    stubFetch(ONE_PARCEL);
    render(<LandTab password="pw" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /use the map's frame/i })).toBeTruthy());
  });

  it("fills the frame exactly when asked, and the offer then goes away", async () => {
    stubFetch(ONE_PARCEL);
    const user = userEvent.setup();
    render(<LandTab password="pw" />);
    await user.click(await screen.findByRole("button", { name: /use the map's frame/i }));
    await waitFor(() => expect(screen.getByDisplayValue(`${SEED.centre.lat.toFixed(7)}, ${SEED.centre.lon.toFixed(7)}`)).toBeTruthy());
    expect(screen.getByDisplayValue(String(SEED.spanM))).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: /use the map's frame/i })).toBeNull());
  });

  it("never offers another place's frame to a village on another continent", async () => {
    stubFetch({ ...ONE_PARCEL, parcels: [{ ...ONE_PARCEL.parcels[0], sourceText: "-1.2921, 36.8219" }] });
    render(<LandTab password="pw" />);
    await screen.findByDisplayValue("-1.2921, 36.8219");
    expect(screen.queryByRole("button", { name: /use the map's frame/i })).toBeNull();
  });

  it("takes a picture down through the route, for the parcel on screen", async () => {
    const calls = stubFetch(ONE_PARCEL);
    vi.stubGlobal("confirm", () => true);
    const user = userEvent.setup();
    render(<LandTab password="pw" />);
    await user.click(await screen.findByRole("button", { name: /remove the picture/i }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "DELETE")).toBe(true));
    const del = calls.find((c) => c.init?.method === "DELETE")!;
    expect(del.url).toContain("/admin/land/imagery?slug=home");
  });

  it("does nothing when the founder cancels the removal", async () => {
    const calls = stubFetch(ONE_PARCEL);
    vi.stubGlobal("confirm", () => false);
    const user = userEvent.setup();
    render(<LandTab password="pw" />);
    await user.click(await screen.findByRole("button", { name: /remove the picture/i }));
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
  });

  it("offers no remove button when there is no picture to remove", async () => {
    stubFetch({ ...ONE_PARCEL, parcels: [{ ...ONE_PARCEL.parcels[0], imagery: { ...ONE_PARCEL.parcels[0].imagery, url: null } }] });
    render(<LandTab password="pw" />);
    await screen.findByDisplayValue("9.2345, -83.8412");
    expect(screen.queryByRole("button", { name: /remove the picture/i })).toBeNull();
  });

  it("says, after a fetch, whether the map kept its own frame or took a new one", async () => {
    stubFetch({ ...ONE_PARCEL, parcels: [{ ...ONE_PARCEL.parcels[0], seedFrame: true }] });
    const { unmount } = render(<LandTab password="pw" />);
    await waitFor(() => expect(screen.getByText(/keeps its coastline and place names/i)).toBeTruthy());
    unmount();
    stubFetch({ ...ONE_PARCEL, parcels: [{ ...ONE_PARCEL.parcels[0], seedFrame: false }] });
    render(<LandTab password="pw" />);
    await waitFor(() => expect(screen.getByText(/sets its own frame/i)).toBeTruthy());
  });
});

/*
 * TAKING A PIECE OF LAND BACK OFF, and what stops a founder removing the
 * wrong thing.
 *
 * The Add button writes a parcel from a text box, so the day it shipped it
 * became possible to add one by mistake with no way back from the screen. Rye
 * asked for the way back on 2026-09-24 after making one by accident.
 */
describe("removing a piece of land", () => {
  /** Two parcels: the village's own ground, and one added after it. */
  const TWO_PARCELS = {
    parcels: [
      { ...ONE_PARCEL.parcels[0] },
      {
        slug: "second-home",
        label: "second home",
        sortOrder: 1,
        centre: { lat: 9.31, lon: -83.79 },
        spanM: 2400,
        visibility: "hidden",
        sourceText: "9.31, -83.79",
        imagery: { provider: null, url: null, attribution: "", fetchedAt: null, error: null },
      },
    ],
    configured: ONE_PARCEL.configured,
  };

  it("offers no way to remove the first parcel, because the server refuses it", async () => {
    stubFetch(TWO_PARCELS);
    render(<LandTab password="pw" />);
    /*
     * The first row is published as the village's own ground, so removing it
     * would move the map to whichever parcel sorted next. Drawing a button
     * that only ever produces a refusal is worse than drawing none.
     */
    await waitFor(() => expect(screen.getByText("second home")).toBeTruthy());
    expect(screen.queryByText(/Remove this piece of land/i)).toBeNull();
  });

  it("asks the server for the parcel the founder is looking at", async () => {
    const calls = stubFetch(TWO_PARCELS);
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<LandTab password="pw" />);

    await user.click(await screen.findByText("second home"));
    await user.click(await screen.findByText(/Remove this piece of land/i));

    await waitFor(() => {
      const del = calls.find((c) => (c.init.method ?? "GET") === "DELETE");
      expect(del).toBeTruthy();
      // The parcel by name, and the parcel route: never the picture route,
      // which is a different button with a different consequence.
      expect(del!.url).toContain("/admin/land/parcel");
      expect(del!.url).toContain("slug=second-home");
    });
  });

  it("does nothing at all when the founder says no to the question", async () => {
    const calls = stubFetch(TWO_PARCELS);
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<LandTab password="pw" />);

    await user.click(await screen.findByText("second home"));
    await user.click(await screen.findByText(/Remove this piece of land/i));

    expect(calls.filter((c) => (c.init.method ?? "GET") === "DELETE")).toHaveLength(0);
  });
});

/*
 * WHAT A WIDTH BUYS, said while it is being typed.
 *
 * The number in that box decides how much ground each pixel covers, and
 * nothing on the page connected the two until this line. A founder picked a
 * width for how much land it framed and met its cost after the fetch.
 */
describe("the width says what it costs", () => {
  const WITH_ARITHMETIC = {
    ...ONE_PARCEL,
    configured: {
      ...ONE_PARCEL.configured,
      groundResolutionM: 0.5,
      detailVariesByPlace: true,
      maxPixels: 2400,
      minPixels: 256,
    },
  };

  it("works out the metres per pixel for the width in the box", async () => {
    stubFetch(WITH_ARITHMETIC);
    render(<LandTab password="pw" />);
    // 800 m over a 0.5 m provider is 1600 px, which is 0.50 m per pixel.
    await waitFor(() => expect(screen.getByText(/About 0.50 m per pixel/i)).toBeTruthy());
  });

  it("warns that a mosaic holds less detail over open country", async () => {
    stubFetch(WITH_ARITHMETIC);
    render(<LandTab password="pw" />);
    await waitFor(() => expect(screen.getByText(/less detail over open country/i)).toBeTruthy());
  });

  it("says nothing at all when the server sent no figures to say it with", async () => {
    /*
     * A deployment serving an older payload has none of the three numbers.
     * Absent has to read as silence: a guessed ceiling would be a confident
     * wrong number beside the box a founder is trusting.
     */
    stubFetch(ONE_PARCEL);
    render(<LandTab password="pw" />);
    await waitFor(() => expect(screen.getByDisplayValue("9.2345, -83.8412")).toBeTruthy());
    expect(screen.queryByText(/m per pixel/i)).toBeNull();
  });
});
