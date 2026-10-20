/**
 * The published village.
 *
 * These documents go to the open internet with no session behind them, and a
 * fetched document can be cached, relayed, indexed and handed to an agent
 * forever. So the test that matters most is not that the shape is right, it is
 * that NOTHING PRIVATE IS IN IT: the leak test below serialises the whole
 * export and every Markdown page and asserts that no name, user id, email,
 * focus string or holder note survives anywhere in the bytes.
 *
 * Written that way on purpose. A field-by-field assertion only catches the
 * fields somebody remembered to assert on, and the failure mode here is a
 * field nobody thought about being added later.
 */
import { describe, expect, it } from "vitest";
import {
  buildOrgExport,
  canonicalJson,
  circleMarkdown,
  isSlug,
  orgIndexMarkdown,
  seatMarkdown,
  signDocument,
  verifyDocument,
  type SigningKey,
} from "./villageExport";
import { generateKeyPairSync } from "crypto";
import type { OrgAssignment as A, OrgRole as R } from "./orgChart";

const role = (id: string, over: Partial<R> = {}): R => ({
  id, circleId: null, name: id, aim: null, domain: null,
  accountabilities: [], whyItMatters: null, seats: 1, criticality: "normal",
  active: true, recruiting: false, expiresEachSeason: null,
  statusOverride: null, statusOverrideExpiresAt: null,
  icon: null, color: null, order: 0, isExample: false, archetypes: [],
  authority: null, firstYearOutcomes: null, first90DayOutcomes: null,
  locationExpectations: null, compensationReality: null, evidenceRequired: null,
  representsCircle: false, howChosen: null, howChosenGloss: null,
  termsOffer: null, termsOfferAt: null, termsOfferBy: null,
  ...over,
});

let n = 0;
const seating = (orgRoleId: string, over: Partial<A> = {}): A => ({
  id: `a${(n += 1)}`, orgRoleId, holderKind: "member", userId: "u-ada",
  displayName: "Ada Vance", holderKey: "u-ada", focus: null, note: null,
  seasonId: null, termEndsAt: null, startedAt: new Date("2026-01-01"),
  endedAt: null, endedReason: null, isExample: false,
  // 0142. See the note on the same line in server/lib/orgLoad.test.ts: a
  // seating always has an answer for this in the schema, so the fixture does
  // too.
  isAgent: false,
  ...over,
});

const circle = (id: string, over: Record<string, any> = {}) => ({
  id, name: id, purpose: null, status: "active", parentCircleId: null,
  grownFromOrgRoleId: null, order: 0, isExample: false, ...over,
});

const build = (roles: R[], assignments: A[], circles: any[]) =>
  buildOrgExport({
    instanceId: "inst-1", villageName: "Riverbend", roles, assignments, circles,
    updatedAt: "2026-08-03T00:00:00.000Z",
  });

// ── The promise ─────────────────────────────────────────────────────────────

describe("the export carries counts and never people", () => {
  const PRIVATE = [
    "Ada Vance", "Ada", "Vance",          // a member's name, whole and in parts
    "u-ada",                               // the user id
    "ada@example.com",                     // an address that reached a note
    "doc:bo-reyes", "Bo Reyes",            // a documented holder
    "wants to step back next season",      // a holder note
    "mornings only",                       // a focus string
    // The recruitment pack. 0049 created these six columns, nothing read them
    // back until now, and a column called `compensation_reality` sitting
    // unread beside a public export is the trap this list closes. They are
    // admin-tier on /api/org and they are not structure, so the export must
    // never grow them by somebody adding a field it looked reasonable beside.
    "signs cheques up to 500",
    "the well is metered by March",
    "first 90: walk every line",
    "on site three days a week",
    "unpaid, board seat after a year",
    "two references from water work",
    // 0083: the glosses. Ids publish ("consent", "other"); the village's own
    // words do NOT, because free text can hold a name, and here it does.
    "ask Ada Vance before spending",
    "Bo Reyes chooses the next one",
    "Ada holds it as the land trust",
  ];

  const pack = {
    authority: "signs cheques up to 500",
    firstYearOutcomes: "the well is metered by March",
    first90DayOutcomes: "first 90: walk every line",
    locationExpectations: "on site three days a week",
    compensationReality: "unpaid, board seat after a year",
    evidenceRequired: "two references from water work",
  };

  const doc = build(
    [
      role("water-steward", {
        circleId: "land-circle", name: "Water Steward", seats: 2, aim: "Keep the water running.",
        howChosen: "other", howChosenGloss: "Bo Reyes chooses the next one", ...pack,
      }),
      role("gate-steward", { circleId: "land-circle", name: "Gate Steward", ...pack }),
    ],
    [
      seating("water-steward", { focus: "mornings only", note: "wants to step back next season" }),
      seating("water-steward", {
        holderKind: "documented", userId: null,
        holderKey: "doc:bo-reyes", displayName: "Bo Reyes", note: "ada@example.com",
      }),
      seating("gate-steward"),
    ],
    [
      circle("land-circle", {
        name: "Land Circle",
        decidesBy: "consent",
        decidesByGloss: "ask Ada Vance before spending",
        decidesByDomains: {
          money: { method: "lead_decides", gloss: "ask Ada Vance before spending" },
          space_land: { method: "other", gloss: "Ada holds it as the land trust" },
        },
      }),
    ],
  );

  it("leaks nothing private into the JSON", () => {
    const blob = JSON.stringify(doc);
    for (const secret of PRIVATE) {
      expect(blob, `"${secret}" reached the published JSON`).not.toContain(secret);
    }
  });

  it("leaks nothing private into any Markdown page", () => {
    const pages = [
      orgIndexMarkdown(doc),
      ...doc.circles.map((c) => circleMarkdown(doc, c)),
      ...doc.seats.map((s) => seatMarkdown(doc, s)),
    ].join("\n");
    for (const secret of PRIVATE) {
      expect(pages, `"${secret}" reached the published Markdown`).not.toContain(secret);
    }
  });

  it("still publishes the counts, which are the whole point", () => {
    // Vacancy is what makes the chart useful to a partner or a recruit, and it
    // names nobody. Stripping it to be safe would leave a document saying only
    // that seats exist.
    const water = doc.seats.find((s) => s.id === "water-steward")!;
    expect(water.seats).toBe(2);
    expect(water.filled).toBe(2);
    expect(water.state).toBe("filled");
    expect(doc.seats.find((s) => s.id === "gate-steward")!.state).toBe("filled");
  });

  it("says out loud what it leaves out, so nobody infers from silence", () => {
    expect(doc.omits.join(" ")).toContain("never people");
  });
});

// ── What must not be published ──────────────────────────────────────────────

describe("what the export drops", () => {
  it("drops standing examples instead of flagging them", () => {
    // /api/org carries isExample so a member's UI can badge them, which works
    // because that UI knows what the flag means. A crawler does not, and a
    // demo seat presented as real governance is worse than no export.
    const doc = build(
      [role("real"), role("demo", { isExample: true })],
      [],
      [circle("real-circle"), circle("demo-circle", { isExample: true })],
    );
    expect(doc.seats.map((s) => s.id)).toEqual(["real"]);
    expect(doc.circles.map((c) => c.id)).toEqual(["real-circle"]);
    expect(JSON.stringify(doc)).not.toContain("isExample");
  });

  it("drops retired seats but KEEPS dormant and forming circles", () => {
    // "We ran this and paused it" is real information about how a village
    // works. Hiding it would make the chart read as though they never tried.
    const doc = build(
      [role("live"), role("retired", { active: false })],
      [],
      [circle("a", { status: "dormant" }), circle("b", { status: "forming" })],
    );
    expect(doc.seats.map((s) => s.id)).toEqual(["live"]);
    expect(doc.circles.map((c) => c.status).sort()).toEqual(["dormant", "forming"]);
  });

  it("drops an id that is not a plain slug, because ids build URLs", () => {
    // These become /org/roles/<id>.md. Escaping a hostile id would still
    // publish it; there is no legitimate seat called ../../etc/passwd.
    const doc = build(
      [role("../../etc/passwd"), role("Has Spaces"), role("good-seat")],
      [],
      [circle("../evil")],
    );
    expect(doc.seats.map((s) => s.id)).toEqual(["good-seat"]);
    expect(doc.circles).toEqual([]);
  });

  it("nulls a circle link whose circle was dropped, never a dangling one", () => {
    // An agent that follows links must not be sent to a 404 by a seat
    // pointing at an example circle that never published.
    const doc = build(
      [role("seat", { circleId: "demo-circle" })],
      [],
      [circle("demo-circle", { isExample: true })],
    );
    expect(doc.seats[0].circleId).toBeNull();
  });

  it("does not count an ended seating as a holder", () => {
    const doc = build(
      [role("seat", { seats: 1 })],
      [seating("seat", { endedAt: new Date("2026-03-01") })],
      [],
    );
    expect(doc.seats[0].filled).toBe(0);
    expect(doc.seats[0].state).toBe("open");
  });
});

// ── Signing ─────────────────────────────────────────────────────────────────

const testKey = (): SigningKey => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    kid: "test-kid",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
};

describe("signed documents", () => {
  it("verifies a document it signed", () => {
    const k = testKey();
    const signed = signDocument({ name: "Riverbend", seats: 3 }, k, "2026-08-03T00:00:00.000Z");
    expect(signed.proof.alg).toBe("ed25519");
    expect(signed.proof.kid).toBe("test-kid");
    expect(verifyDocument(signed, k.publicKeyPem)).toBe(true);
  });

  it("refuses a document whose body was edited", () => {
    // The point of the whole exercise: a relayed or cached copy that somebody
    // altered must not verify.
    const k = testKey();
    const signed: any = signDocument({ name: "Riverbend", seats: 3 }, k, "2026-08-03T00:00:00.000Z");
    signed.seats = 4;
    expect(verifyDocument(signed, k.publicKeyPem)).toBe(false);
  });

  it("refuses a document whose signedAt was moved", () => {
    // signedAt is inside the signed bytes, so a stale document cannot be
    // passed off as fresh by editing the timestamp.
    const k = testKey();
    const signed: any = signDocument({ name: "Riverbend" }, k, "2026-08-03T00:00:00.000Z");
    signed.proof.signedAt = "2026-09-01T00:00:00.000Z";
    expect(verifyDocument(signed, k.publicKeyPem)).toBe(false);
  });

  it("refuses a signature from a different key", () => {
    const signed = signDocument({ name: "Riverbend" }, testKey(), "2026-08-03T00:00:00.000Z");
    expect(verifyDocument(signed, testKey().publicKeyPem)).toBe(false);
  });

  it("refuses a document with no proof at all instead of throwing", () => {
    expect(verifyDocument({ name: "Riverbend" }, testKey().publicKeyPem)).toBe(false);
  });

  it("refuses garbage in the signature field instead of throwing", () => {
    const k = testKey();
    expect(verifyDocument(
      { name: "Riverbend", proof: { alg: "ed25519", kid: "x", signedAt: "now", signature: "!!!not-base64!!!" } },
      k.publicKeyPem,
    )).toBe(false);
  });
});

describe("canonical JSON, which is what makes a signature checkable", () => {
  it("gives two objects built in different key orders the same bytes", () => {
    // A verifier reconstructs the document from parsed JSON, where key order
    // is whatever its parser did. If the bytes differ, every signature fails.
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ x: { d: 1, c: 2 } })).toBe(canonicalJson({ x: { c: 2, d: 1 } }));
  });

  it("keeps array order, because array order is meaning", () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it("survives round-tripping through JSON.parse, which is the real path", () => {
    const k = testKey();
    const signed = signDocument({ z: 1, a: { n: [1, 2] }, m: "x" }, k, "2026-08-03T00:00:00.000Z");
    const overTheWire = JSON.parse(JSON.stringify(signed));
    expect(verifyDocument(overTheWire, k.publicKeyPem)).toBe(true);
  });
});

// ── The Markdown mirror ─────────────────────────────────────────────────────

describe("the Markdown mirror", () => {
  const doc = build(
    [
      role("water-steward", {
        circleId: "land-circle", name: "Water Steward", seats: 3,
        aim: "Keep the water running.", domain: "Springs, tanks and irrigation.",
        accountabilities: ["Checks the tanks weekly", "Holds the spring agreement"],
        recruiting: true,
      }),
      role("loose-seat", { name: "Loose Seat" }),
    ],
    [seating("water-steward")],
    [
      circle("land-circle", { name: "Land Circle", purpose: "Water, soil and the growing year." }),
      circle("kids-circle", { name: "Kids Circle", status: "forming", parentCircleId: "land-circle" }),
    ],
  );

  it("links a circle to its seats with paths that actually resolve", () => {
    // /org/circles/land-circle.md linking ../roles/water-steward.md resolves
    // to /org/roles/water-steward.md, which is the route that exists.
    const page = circleMarkdown(doc, doc.circles.find((c) => c.id === "land-circle")!);
    expect(page).toContain("(../roles/water-steward.md)");
    expect(page).toContain("Water, soil and the growing year.");
  });

  it("links a seat back to its circle, and a loose seat to the index", () => {
    const seat = seatMarkdown(doc, doc.seats.find((s) => s.id === "water-steward")!);
    expect(seat).toContain("(../circles/land-circle.md)");
    const loose = seatMarkdown(doc, doc.seats.find((s) => s.id === "loose-seat")!);
    expect(loose).toContain("(../index.md)");
  });

  it("names a nested circle's parent", () => {
    const page = circleMarkdown(doc, doc.circles.find((c) => c.id === "kids-circle")!);
    expect(page).toContain("(land-circle.md)");
    expect(page).toContain("forming");
  });

  it("carries frontmatter a parser can read", () => {
    const seat = seatMarkdown(doc, doc.seats.find((s) => s.id === "water-steward")!);
    expect(seat.startsWith("---\n")).toBe(true);
    expect(seat).toContain('id: "water-steward"');
    expect(seat).toContain('type: "role"');
    expect(seat).toContain("seats: 3");
    expect(seat).toContain("filled: 1");
  });

  it("quotes and escapes a village's own words so they cannot break the block", () => {
    // Villages write colons, hashes and quotes in names. An unquoted YAML
    // scalar containing a colon silently becomes a nested map.
    const odd = build([role("seat", { name: 'Water: the "big" one # 2' })], [], []);
    const page = seatMarkdown(odd, odd.seats[0]);
    expect(page).toContain('name: "Water: the \\"big\\" one # 2"');
    // And the heading still reads as the village wrote it.
    expect(page).toContain('# Water: the "big" one # 2');
  });

  it("lists every seat on the index, grouped under its circle", () => {
    const index = orgIndexMarkdown(doc);
    expect(index).toContain("(circles/land-circle.md)");
    expect(index).toContain("(roles/water-steward.md)");
    expect(index).toContain("1 of 3 held");
    expect(index).toContain("Seats outside any circle");
  });

  it("says a recruiting seat is open to anyone", () => {
    const seat = seatMarkdown(doc, doc.seats.find((s) => s.id === "water-steward")!);
    expect(seat).toContain("open to anyone");
  });
});

describe("slug validation", () => {
  it("accepts ordinary ids and refuses everything path-shaped", () => {
    for (const ok of ["water-steward", "a", "seat-2026", "x9"]) expect(isSlug(ok), ok).toBe(true);
    for (const bad of ["../etc", "a/b", "A-Caps", "-leading", "has space", "", "a".repeat(65), "dot.dot"]) {
      expect(isSlug(bad), bad).toBe(false);
    }
  });
});

describe("the fixes the recon pass found", () => {
  it("does not let an EXAMPLE seating inflate a real seat's count", () => {
    // org_role_assignments carries is_example and ASSIGN_COLS was not
    // selecting it, so every read handed back demo seatings indistinguishable
    // from real ones. The progression module is CORE, so a brand-new fork has
    // them before a human enables anything, and claimSeating does not filter
    // examples, so a real member can end up sitting on one.
    const doc = build(
      [role("seat", { seats: 2 })],
      [seating("seat"), seating("seat", { holderKey: "u-demo", isExample: true })],
      [],
    );
    expect(doc.seats[0].filled).toBe(1);
    expect(doc.seats[0].state).toBe("partial");
  });

  it("stops publishing a seat that argues with itself", () => {
    // The live Amora chart ships land-steward with a 60-day statusOverride of
    // "filled" and no holder recorded, which published as
    // { seats: 1, filled: 0, state: "filled" } and read "Held. 0 of 1 held."
    const doc = build(
      [role("land-steward", {
        name: "Land Steward", seats: 1,
        statusOverride: "filled",
        statusOverrideExpiresAt: new Date(Date.now() + 60 * 86400000),
      })],
      [],
      [],
    );
    const seat = doc.seats[0];
    // The village's own claim survives, because an override exists for when a
    // village knows better than the count.
    expect(seat.state).toBe("filled");
    expect(seat.filled).toBe(0);
    // And a reader is told where the claim came from.
    expect(seat.stateSource).toBe("declared");
    const page = seatMarkdown(doc, seat);
    expect(page).not.toContain("Held. 0 of 1 seat(s) held.");
    expect(page).toContain("No holder for it is written down here");
  });

  it("marks a state that the count DOES back up as read from the records", () => {
    const doc = build([role("seat")], [seating("seat")], []);
    expect(doc.seats[0].stateSource).toBe("records");
    expect(seatMarkdown(doc, doc.seats[0])).toContain("Held. 1 of 1 seat(s) held.");
  });

  it("ignores a statusOverride that has already expired", () => {
    const doc = build(
      [role("seat", {
        statusOverride: "filled",
        statusOverrideExpiresAt: new Date(Date.now() - 86400000),
      })],
      [],
      [],
    );
    expect(doc.seats[0].state).toBe("open");
    expect(doc.seats[0].stateSource).toBe("records");
  });

  it("nulls a parent circle and a grown-from seat that never published", () => {
    // Every cross-reference must point at something this document carries, or
    // an agent that follows links walks into a 404. circleId was guarded from
    // the start; these two were not.
    const doc = build(
      [role("retired-seat", { active: false }), role("live-seat")],
      [],
      [
        circle("orphan", { parentCircleId: "demo-parent", grownFromOrgRoleId: "retired-seat" }),
        circle("demo-parent", { isExample: true }),
      ],
    );
    const orphan = doc.circles.find((c) => c.id === "orphan")!;
    expect(orphan.parentCircleId).toBeNull();
    expect(orphan.grownFromOrgRoleId).toBeNull();
  });

  it("does not let a village's own punctuation break a link", () => {
    // Villages name things "Water (springs)" and "Steward [land]". Unescaped,
    // the bracket closes the label and the paren opens the target, so every
    // link that mentions the seat points somewhere else. These documents exist
    // to be walked by agents, so a broken link is not cosmetic.
    const doc = build(
      [role("water", { name: "Water (springs) [land]", circleId: "c" })],
      [],
      [circle("c", { name: "Land [north]" })],
    );
    const index = orgIndexMarkdown(doc);
    expect(index).toContain("[Water \\(springs\\) \\[land\\]](roles/water.md)");
    expect(index).toContain("[Land \\[north\\]](circles/c.md)");
  });

  it("does not let free text become a heading in somebody else's parser", () => {
    // A village writing "# 1 priority: water" in an aim would otherwise open a
    // top-level heading in the middle of a seat page, and "---" would look
    // like a frontmatter fence.
    const doc = build(
      [role("seat", { aim: "# 1 priority: water\n---\n> keep it running" })],
      [],
      [],
    );
    const page = seatMarkdown(doc, doc.seats[0]);
    expect(page).toContain("\\# 1 priority: water");
    expect(page).toContain("\\---");
    expect(page).toContain("\\> keep it running");
  });

  it("keeps one accountability on one bullet", () => {
    const doc = build([role("seat", { accountabilities: ["Checks the tanks\nevery week"] })], [], []);
    expect(seatMarkdown(doc, doc.seats[0])).toContain("- Checks the tanks every week");
  });

  it("publishes links between nodes, and only when both ends published", () => {
    // 0054. Safe by construction: an endpoint can only be a seat or a circle,
    // so there is no person to leave out. What still needs guarding is a link
    // pointing at something this document dropped, which an agent following
    // links would walk into.
    const doc = buildOrgExport({
      instanceId: "i", villageName: "Riverbend", updatedAt: "2026-08-04T00:00:00.000Z",
      roles: [role("water"), role("gate"), role("demo", { isExample: true })],
      assignments: [],
      circles: [circle("land")],
      relations: [
        { typeId: "deputy", label: "is deputised by", inverseLabel: "deputises for",
          fromKind: "org_role", fromId: "water", toKind: "org_role", toId: "gate" },
        { typeId: "deputy", label: "is deputised by", inverseLabel: "deputises for",
          fromKind: "org_role", fromId: "water", toKind: "org_role", toId: "demo" },
        { typeId: "deputy", label: "is deputised by", inverseLabel: "deputises for",
          fromKind: "org_role", fromId: "water", toKind: "circle", toId: "vanished" },
        { typeId: "secret", label: "x", inverseLabel: "y", isExample: true,
          fromKind: "org_role", fromId: "water", toKind: "org_role", toId: "gate" },
      ],
    });
    expect(doc.relations.length).toBe(1);
    expect(doc.relations[0]).toMatchObject({ fromId: "water", toId: "gate" });
  });

  it("phrases a link from the side of the seat whose page it is", () => {
    const doc = buildOrgExport({
      instanceId: "i", villageName: "Riverbend", updatedAt: "2026-08-04T00:00:00.000Z",
      roles: [role("water", { name: "Water Steward" }), role("gate", { name: "Gate Steward" })],
      assignments: [], circles: [],
      relations: [{ typeId: "deputy", label: "is deputised by", inverseLabel: "deputises for",
        fromKind: "org_role", fromId: "water", toKind: "org_role", toId: "gate" }],
    });
    const water = seatMarkdown(doc, doc.seats.find((s) => s.id === "water")!);
    expect(water).toContain("is deputised by [Gate Steward](gate.md)");
    const gate = seatMarkdown(doc, doc.seats.find((s) => s.id === "gate")!);
    expect(gate).toContain("deputises for [Water Steward](water.md)");
  });

  it("keeps a cross-reference that DOES resolve", () => {
    const doc = build(
      [role("lead-seat")],
      [],
      [circle("parent"), circle("child", { parentCircleId: "parent", grownFromOrgRoleId: "lead-seat" })],
    );
    const child = doc.circles.find((c) => c.id === "child")!;
    expect(child.parentCircleId).toBe("parent");
    expect(child.grownFromOrgRoleId).toBe("lead-seat");
  });
});

// ── 0083: how power is held, published as ids ───────────────────────────────

describe("the power vocabulary publishes ids and only ids", () => {
  it("publishes the village shape when it is a known id, and null otherwise", () => {
    const shaped = buildOrgExport({
      instanceId: "inst-1", villageName: "Riverbend", roles: [], assignments: [],
      circles: [], updatedAt: "2026-08-03T00:00:00.000Z", shape: "council",
    });
    expect(shaped.shape).toBe("council");
    const junk = buildOrgExport({
      instanceId: "inst-1", villageName: "Riverbend", roles: [], assignments: [],
      circles: [], updatedAt: "2026-08-03T00:00:00.000Z", shape: "Ada Vance's way",
    });
    expect(junk.shape).toBeNull();
    expect(JSON.stringify(junk)).not.toContain("Ada");
    const unsaid = build([], [], []);
    expect(unsaid.shape).toBeNull();
  });

  it("publishes a circle's decides-by id and its domain override ids", () => {
    const doc = build([], [], [circle("land-circle", {
      decidesBy: "consent",
      decidesByDomains: { money: { method: "lead_decides", gloss: "ask the lead first" } },
    })]);
    const c = doc.circles[0];
    expect(c.decidesBy).toBe("consent");
    expect(c.decidesByDomains).toEqual({ money: "lead_decides" });
    expect(JSON.stringify(doc)).not.toContain("ask the lead first");
  });

  it("degrades a hand-edited row to null instead of publishing its text", () => {
    const doc = build([], [], [circle("c", {
      decidesBy: "whatever Ada says",
      decidesByDomains: { money: { method: "whatever Ada says" }, weather: { method: "consent" } },
    })]);
    expect(doc.circles[0].decidesBy).toBeNull();
    expect(doc.circles[0].decidesByDomains).toBeNull();
    expect(JSON.stringify(doc)).not.toContain("whatever Ada says");
  });

  it("reads domain overrides that arrive as a JSON string, as mysql drivers hand them", () => {
    const doc = build([], [], [circle("c", {
      decidesBy: "majority",
      decidesByDomains: JSON.stringify({ rules: { method: "hypha" } }),
    })]);
    expect(doc.circles[0].decidesByDomains).toEqual({ rules: "hypha" });
  });

  it("says Decides by on the circle page, from the platform label", () => {
    const doc = build([], [], [circle("land-circle", { name: "Land Circle", decidesBy: "consent" })]);
    const page = circleMarkdown(doc, doc.circles[0]);
    expect(page).toContain("Decides by: consent.");
    const silent = build([], [], [circle("quiet-circle", { name: "Quiet Circle" })]);
    expect(circleMarkdown(silent, silent.circles[0])).not.toContain("Decides by");
  });
});
