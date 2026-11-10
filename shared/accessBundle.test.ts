/** The access bundle names access and never holds the way in. */
import { describe, expect, it } from "vitest";
import { credentialProblem, parseAccessBundle, readAccessBundle } from "./accessBundle";

describe("a credential-shaped string is refused", () => {
  const bad = [
    "Bank portal password: hunter2",
    "login = treasurer",
    "api key: abc",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "sk-live-abcdefghijklmnop",
    ["AK", "IAABCDEFGHIJKLMNOP"].join(""),
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    "treasurer@example.org",
    "https://user:pw@bank.example/portal",
    "https://drive.example/folder?token=abc123",
    "https://drive.example/folder#access_token=abc",
    "Q3JlZGVudGlhbHNBcmVOb3RTdG9yZWRIZXJl0123456789",
  ];
  for (const s of bad) {
    it(`refuses: ${s.slice(0, 40)}`, () => {
      expect(credentialProblem(s)).not.toBeNull();
      expect(parseAccessBundle([{ label: s }]).ok).toBe(false);
    });
  }

  it("accepts plain access names", () => {
    const r = parseAccessBundle([
      { label: "Shared drive for the finance circle", grantingRoleId: "technical-operations" },
      "Bank portal, view only",
      { label: "Finance mailing list" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items.map((i) => i.label)).toEqual(["Shared drive for the finance circle", "Bank portal, view only", "Finance mailing list"]);
      expect(r.items[0].grantingRoleId).toBe("technical-operations");
      expect(r.items[2].grantingRoleId).toBeNull();
    }
  });

  it("one bad item refuses the whole list, and a stored bad item is dropped on read", () => {
    expect(parseAccessBundle(["Shared drive", "password: x"]).ok).toBe(false);
    expect(readAccessBundle(["Shared drive", "password: x"]).map((i) => i.label)).toEqual(["Shared drive"]);
  });

  it("drops duplicates and caps the list", () => {
    const r = parseAccessBundle(["Shared drive", "shared  drive"]);
    expect(r.ok && r.items.length).toBe(1);
    expect(parseAccessBundle(Array.from({ length: 21 }, (_, i) => `Item ${i}`)).ok).toBe(false);
  });
});
