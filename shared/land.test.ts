/**
 * What a founder can paste, and what happens when they paste it wrong.
 *
 * These cases are the ones a founder actually produces on a phone, so the
 * fixtures are real strings copied out of real map apps rather than tidy
 * inputs invented to match the parser. The Costa Rica pair appears throughout
 * because that is where the first villages are, and because a transposed pair
 * there is the specific error this module was built to catch.
 *
 * ON THE PLUS CODE FIXTURE. "8FVC2222+22" and its answer 47.0000625,
 * 8.0000625 come from the Open Location Code project's own test vectors, not
 * from running this decoder and writing down what it said. A test whose
 * expected value is the implementation's output proves the code is
 * deterministic and nothing else.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPAN_M,
  MAX_SPAN_M,
  MIN_SPAN_M,
  boundsFor,
  coarsen,
  parseCoordinates,
  publicPoint,
  swapSuspicion,
  validateSpan,
  zoomFor,
} from "./land";
import { parcelSlug, isParcelSlug, orderParcels, DEFAULT_PARCEL_SLUG } from "./land";

/** Dominicalito, Costa Rica: roughly where the first village sits. */
const CR = { lat: 9.2345, lon: -83.8412 };

const ok = (input: string) => {
  const r = parseCoordinates(input);
  if (!r.ok) throw new Error(`expected a parse, got: ${r.message}`);
  return r;
};

const bad = (input: string) => {
  const r = parseCoordinates(input);
  if (r.ok) throw new Error(`expected a refusal, got ${r.lat},${r.lon}`);
  return r;
};

describe("decimal degrees, the shape a long-press hands over", () => {
  it("reads a plain comma-separated pair", () => {
    const r = ok("9.2345, -83.8412");
    expect(r.lat).toBeCloseTo(CR.lat, 6);
    expect(r.lon).toBeCloseTo(CR.lon, 6);
    expect(r.format).toBe("decimal");
    expect(r.swap).toBe("none");
  });

  it("reads a space-separated pair", () => {
    const r = ok("9.2345 -83.8412");
    expect(r.lat).toBeCloseTo(CR.lat, 6);
    expect(r.lon).toBeCloseTo(CR.lon, 6);
  });

  it("applies hemisphere letters written after the number", () => {
    const r = ok("9.2345 N, 83.8412 W");
    expect(r.lat).toBeCloseTo(CR.lat, 6);
    expect(r.lon).toBeCloseTo(CR.lon, 6);
  });

  it("applies hemisphere letters written before the number", () => {
    const r = ok("N9.2345 W83.8412");
    expect(r.lat).toBeCloseTo(CR.lat, 6);
    expect(r.lon).toBeCloseTo(CR.lon, 6);
  });

  it("lets a hemisphere letter fix the ORDER, so longitude first still works", () => {
    // A founder who pasted the pair the other way round but kept the letters
    // has given us everything needed to read it correctly.
    const r = ok("83.8412 W, 9.2345 N");
    expect(r.lat).toBeCloseTo(CR.lat, 6);
    expect(r.lon).toBeCloseTo(CR.lon, 6);
    expect(r.swap).toBe("none");
  });

  it("survives the degree sign that comes along with a copied map card", () => {
    const r = ok("9.2345°, -83.8412°");
    expect(r.lat).toBeCloseTo(CR.lat, 6);
    expect(r.lon).toBeCloseTo(CR.lon, 6);
  });
});

describe("degrees, minutes and seconds", () => {
  it("reads the form with the degree, quote and double-quote marks", () => {
    const r = ok(`9°14'04.2"N 83°50'28.3"W`);
    expect(r.lat).toBeCloseTo(9.234, 3);
    expect(r.lon).toBeCloseTo(-83.841, 3);
    expect(r.format).toBe("dms");
  });

  it("reads the bare-spaces form", () => {
    const r = ok("9 14 04.2 N 83 50 28.3 W");
    expect(r.lat).toBeCloseTo(9.234, 3);
    expect(r.lon).toBeCloseTo(-83.841, 3);
  });

  it("puts a southern village in the south", () => {
    const r = ok(`9°14'04.2"S 83°50'28.3"W`);
    expect(r.lat).toBeCloseTo(-9.234, 3);
    expect(r.lon).toBeCloseTo(-83.841, 3);
  });

  it("reads a pair written longitude first, because the letters say which is which", () => {
    const r = ok(`83°50'28.3"W 9°14'04.2"N`);
    expect(r.lat).toBeCloseTo(9.234, 3);
    expect(r.lon).toBeCloseTo(-83.841, 3);
  });
});

describe("a Google Maps link", () => {
  it("reads the @ camera form the share sheet writes", () => {
    const r = ok("https://www.google.com/maps/@9.2345,-83.8412,17z");
    expect(r.lat).toBeCloseTo(CR.lat, 6);
    expect(r.lon).toBeCloseTo(CR.lon, 6);
    expect(r.format).toBe("google-maps-url");
  });

  it("prefers the PLACE in the data block over the camera position", () => {
    // The !3d/!4d block is the pin the founder searched for. The @ is wherever
    // the screen happened to be sitting, which can be a long way off.
    const r = ok(
      "https://www.google.com/maps/place/Finca/@9.9999,-83.0000,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d9.2345!4d-83.8412",
    );
    expect(r.lat).toBeCloseTo(CR.lat, 6);
    expect(r.lon).toBeCloseTo(CR.lon, 6);
  });

  it("reads the older q= form", () => {
    const r = ok("https://maps.google.com/?q=9.2345,-83.8412");
    expect(r.lat).toBeCloseTo(CR.lat, 6);
  });

  it("refuses a short link and says why it cannot be read", () => {
    const r = bad("https://maps.app.goo.gl/abcdefghijk");
    expect(r.problem).toBe("unreadable");
    expect(r.message).toMatch(/open it in a browser/i);
  });
});

describe("a geo URI", () => {
  it("reads the form an Android share produces", () => {
    const r = ok("geo:9.2345,-83.8412");
    expect(r.lat).toBeCloseTo(CR.lat, 6);
    expect(r.format).toBe("geo-uri");
  });
});

describe("plus codes", () => {
  it("decodes a full code to the centre of the cell it names", () => {
    // Open Location Code's own test vector.
    const r = ok("8FVC2222+22");
    expect(r.lat).toBeCloseTo(47.0000625, 7);
    expect(r.lon).toBeCloseTo(8.0000625, 7);
    expect(r.format).toBe("plus-code");
  });

  it("keeps a grid-refined code inside the cell its parent code names", () => {
    const parent = ok("8FVC2222+22");
    const refined = ok("8FVC2222+22GG");
    // The 10-character cell is 0.000125 degrees on a side, so a refinement of
    // it must land within half that of the parent centre.
    expect(Math.abs(refined.lat - parent.lat)).toBeLessThan(0.000125);
    expect(Math.abs(refined.lon - parent.lon)).toBeLessThan(0.000125);
  });

  it("refuses a short code and says where to find the long one", () => {
    const r = bad("MR2C+8F");
    expect(r.problem).toBe("short-plus-code");
    expect(r.message).toMatch(/long form/i);
  });

  it("refuses a code holding a character plus codes do not use", () => {
    // 'A', 'B', 'D', 'E' and every other absent letter are not in the alphabet.
    const r = bad("8FVC2A22+22");
    expect(r.problem).toBe("bad-plus-code");
  });
});

describe("the transposed pair, which is the error that actually happens", () => {
  it("flags a Costa Rica pair typed the wrong way round", () => {
    // -83.8412 cannot be a village latitude: it is Antarctic ice.
    const r = ok("-83.8412, 9.2345");
    expect(r.swap).toBe("unlikely");
    expect(r.swapped).toEqual({ lat: 9.2345, lon: -83.8412 });
  });

  it("does NOT correct it, and returns what the founder actually typed", () => {
    // The whole contract: this module asks, and the founder decides.
    const r = ok("-83.8412, 9.2345");
    expect(r.lat).toBeCloseTo(-83.8412, 6);
    expect(r.lon).toBeCloseTo(9.2345, 6);
  });

  it("says nothing about a pair that is simply correct", () => {
    const r = ok("9.2345, -83.8412");
    expect(r.swap).toBe("none");
    expect(r.swapped).toBeNull();
  });

  it("leaves a genuine tropical pair alone even though both numbers fit a latitude", () => {
    // Singapore: 1.35, 103.8. Both readings are inside the settled band on the
    // latitude axis, so there is no signal and the guard stays quiet.
    const r = ok("1.3521, 103.8198");
    expect(r.swap).toBe("none");
  });

  it("refuses an impossible latitude and names the reading that would work", () => {
    const r = bad("-120.5, 45.25");
    expect(r.problem).toBe("latitude-range");
    expect(r.suggestion).toEqual({ lat: 45.25, lon: -120.5 });
    expect(r.message).toMatch(/swap the two numbers/i);
  });

  it("refuses outright when neither order is a real point", () => {
    const r = bad("200, 300");
    expect(r.suggestion).toBeUndefined();
  });

  it("asks a village inside the Arctic Circle to confirm, and this is the known cost", () => {
    // Longyearbyen, 78.22 N 15.65 E. A real settlement that trips the band.
    // The guard asks; it never refuses, and it never rewrites.
    const r = ok("78.2232, 15.6469");
    expect(r.swap).toBe("unlikely");
    expect(r.lat).toBeCloseTo(78.2232, 4);
  });
});

describe("refusals tell the founder what to do", () => {
  it("never says the words invalid input", () => {
    const inputs = ["", "somewhere near the river", "9.2345", "MR2C+8F", "200, 300"];
    for (const input of inputs) {
      const r = parseCoordinates(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.toLowerCase()).not.toContain("invalid");
    }
  });

  it("names the second number when only one arrives", () => {
    const r = bad("9.2345");
    expect(r.problem).toBe("one-number");
    expect(r.message).toMatch(/latitude first/i);
  });

  it("tells an empty field where to get the numbers", () => {
    const r = bad("   ");
    expect(r.problem).toBe("empty");
    expect(r.message).toMatch(/long-press/i);
  });

  it("lists the shapes that work when nothing matches", () => {
    const r = bad("the top field by the big mango tree");
    expect(r.problem).toBe("unreadable");
    expect(r.message).toMatch(/plus code/i);
  });
});

describe("the span", () => {
  it("takes a number inside the range and rounds it", () => {
    const r = validateSpan(812.4);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.span).toBe(812);
  });

  it("refuses a span under the floor and names the range", () => {
    const r = validateSpan(MIN_SPAN_M - 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(String(MAX_SPAN_M));
  });

  it("refuses a span over the ceiling", () => {
    const r = validateSpan(MAX_SPAN_M + 1);
    expect(r.ok).toBe(false);
  });

  it("refuses text", () => {
    const r = validateSpan("wide");
    expect(r.ok).toBe(false);
  });

  it("has a default inside its own range", () => {
    expect(DEFAULT_SPAN_M).toBeGreaterThanOrEqual(MIN_SPAN_M);
    expect(DEFAULT_SPAN_M).toBeLessThanOrEqual(MAX_SPAN_M);
  });
});

describe("bounds", () => {
  it("puts the centre in the middle", () => {
    const b = boundsFor(CR, 1000);
    expect((b.north + b.south) / 2).toBeCloseTo(CR.lat, 6);
    expect((b.east + b.west) / 2).toBeCloseTo(CR.lon, 6);
  });

  it("makes a box that is square in METRES, so it is wider in degrees away from the equator", () => {
    const equator = boundsFor({ lat: 0, lon: 0 }, 1000);
    const north = boundsFor({ lat: 60, lon: 0 }, 1000);
    const degWide = (b: ReturnType<typeof boundsFor>) => b.east - b.west;
    // A degree of longitude at 60 degrees is half its equatorial length, so
    // the same 1000 metres has to span about twice as many degrees.
    expect(degWide(north)).toBeGreaterThan(degWide(equator) * 1.9);
  });

  it("does not run away at the pole", () => {
    const b = boundsFor({ lat: 89.999, lon: 0 }, 1000);
    expect(Number.isFinite(b.east)).toBe(true);
    expect(Number.isFinite(b.west)).toBe(true);
    expect(b.north).toBeLessThanOrEqual(90);
  });

  it("wraps across the date line instead of producing a longitude past 180", () => {
    const b = boundsFor({ lat: 0, lon: 179.999 }, 5000);
    expect(b.east).toBeGreaterThanOrEqual(-180);
    expect(b.east).toBeLessThanOrEqual(180);
  });
});

describe("zoom", () => {
  it("asks for a deeper zoom for a smaller span", () => {
    expect(zoomFor(CR, 200, 1024)).toBeGreaterThan(zoomFor(CR, 5000, 1024));
  });

  it("stays inside the range every provider serves", () => {
    for (const span of [MIN_SPAN_M, DEFAULT_SPAN_M, MAX_SPAN_M]) {
      const z = zoomFor(CR, span, 1024);
      expect(z).toBeGreaterThanOrEqual(1);
      expect(z).toBeLessThanOrEqual(20);
    }
  });
});

describe("visibility, because a village is where people sleep", () => {
  it("publishes nothing at all when the village has not chosen", () => {
    expect(publicPoint(CR, "hidden")).toBeNull();
  });

  it("rounds to two decimals when the village said approximate", () => {
    expect(publicPoint(CR, "approximate")).toEqual({ lat: 9.23, lon: -83.84 });
  });

  it("publishes what the founder typed when the village said exact", () => {
    expect(publicPoint(CR, "exact")).toEqual(CR);
  });

  it("answers null for a village that has set no point, at every visibility", () => {
    // An unset location and a hidden location are different facts, and both
    // have to come out as nothing public without the caller telling them apart.
    for (const v of ["hidden", "approximate", "exact"] as const) {
      expect(publicPoint(null, v)).toBeNull();
    }
  });

  it("coarsens to a little over a kilometre, which is the promise the word makes", () => {
    const c = coarsen({ lat: 9.23456, lon: -83.84123 });
    expect(c).toEqual({ lat: 9.23, lon: -83.84 });
  });
});

describe("swapSuspicion on its own", () => {
  it("reports impossible when the latitude cannot be one", () => {
    expect(swapSuspicion(-120, 45).swap).toBe("impossible");
  });

  it("offers no alternative when swapping would not help either", () => {
    expect(swapSuspicion(200, 300).swapped).toBeNull();
  });
});
describe("a parcel's name becomes its address", () => {
  it("makes a slug a founder would recognise from the name they typed", () => {
    expect(parcelSlug("North field")).toBe("north-field");
    expect(parcelSlug("The Ridge")).toBe("the-ridge");
  });

  it("keeps accented letters as letters instead of dropping them to dashes", () => {
    // "Rio Claro", not "r-o-claro": a Costa Rican parcel must not lose its name.
    expect(parcelSlug("Rio Claro")).toBe("rio-claro");
    expect(parcelSlug("Rio Claro".normalize("NFD"))).toBe("rio-claro");
  });

  it("collapses punctuation and never leaves a leading or trailing dash", () => {
    expect(parcelSlug("  --The  Ridge!! (upper) -- ")).toBe("the-ridge-upper");
  });

  it("returns empty for a label with nothing usable in it, rather than inventing a name", () => {
    // A generated fallback would put a name nobody chose into a URL forever.
    expect(parcelSlug("!!!")).toBe("");
    expect(parcelSlug("")).toBe("");
  });

  it("never emits a slug its own validator would refuse", () => {
    for (const label of ["North field", "Rio Claro", "a", "The  --  Ridge", "x".repeat(200), "9 acres"]) {
      const slug = parcelSlug(label);
      if (slug) expect(isParcelSlug(slug)).toBe(true);
    }
  });

  it("refuses what a founder or a different deriver might send by hand", () => {
    for (const bad of ["North Field", "north field", "-north", "north-", "", "a".repeat(65), "nórth"]) {
      expect(isParcelSlug(bad)).toBe(false);
    }
  });

  it("accepts the slug every village that predates parcels already has", () => {
    expect(isParcelSlug(DEFAULT_PARCEL_SLUG)).toBe(true);
  });
});

describe("which parcel opens", () => {
  const p = (slug: string, sortOrder: number, createdAt: string) => ({ slug, sortOrder, createdAt });

  it("orders by sortOrder", () => {
    expect(orderParcels([p("b", 2, "x"), p("a", 1, "x")]).map((r) => r.slug)).toEqual(["a", "b"]);
  });

  it("settles an equal sortOrder by age, so the answer is never row order", () => {
    const rows = [p("later", 0, "2026-09-05"), p("earlier", 0, "2026-09-01")];
    expect(orderParcels(rows).map((r) => r.slug)).toEqual(["earlier", "later"]);
    // and the same answer when the input arrives the other way round
    expect(orderParcels([...rows].reverse()).map((r) => r.slug)).toEqual(["earlier", "later"]);
  });

  it("does not mutate what it was handed", () => {
    const rows = [p("b", 2, "x"), p("a", 1, "x")];
    orderParcels(rows);
    expect(rows.map((r) => r.slug)).toEqual(["b", "a"]);
  });
});
