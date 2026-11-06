import { describe, expect, it } from "vitest";
import { singlePublicAddress } from "./publicAddress";
import { normalizeRecipients } from "./comms/mailer";

describe("singlePublicAddress", () => {
  it("accepts one ordinary address, trimmed", () => {
    expect(singlePublicAddress("  person@example.test ")).toBe("person@example.test");
    expect(singlePublicAddress("first.last+tag@sub.example.test")).toBe("first.last+tag@sub.example.test");
  });

  it("refuses a list, which the mailer would otherwise fan out into one email per address", () => {
    const list = "a@example.test,b@example.test,c@example.test";
    // The harm, measured: this is what the mailer would have sent to.
    expect(normalizeRecipients([list])).toHaveLength(3);
    expect(singlePublicAddress(list)).toBeNull();
    expect(singlePublicAddress("a@example.test;b@example.test")).toBeNull();
    expect(singlePublicAddress("a@example.test, b@example.test")).toBeNull();
  });

  it("refuses a comma even when only one part is an address", () => {
    expect(singlePublicAddress("junk,b@example.test")).toBeNull();
  });

  it("refuses anything that is not a string, because an array joins into a list", () => {
    const arr = ["a@example.test", "b@example.test"];
    expect(normalizeRecipients([String(arr)])).toHaveLength(2);
    expect(singlePublicAddress(arr)).toBeNull();
    expect(singlePublicAddress(["a@example.test"])).toBeNull();
    expect(singlePublicAddress({ email: "a@example.test" })).toBeNull();
    expect(singlePublicAddress(null)).toBeNull();
    expect(singlePublicAddress(undefined)).toBeNull();
    expect(singlePublicAddress(42)).toBeNull();
  });

  it("refuses what the address book refuses", () => {
    expect(singlePublicAddress("")).toBeNull();
    expect(singlePublicAddress("not an address")).toBeNull();
    expect(singlePublicAddress("a@b")).toBeNull();
    expect(singlePublicAddress(`${"x".repeat(200)}@example.test`)).toBeNull();
  });
});
