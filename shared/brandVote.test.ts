/**
 * What a village vote may change in the brand (Rye, 2026-11-06: "EVERYTHING
 * can change with the highest village vote"), and what it never may: a secret,
 * a key that does not exist. The currency code moves only at the highest tier.
 */
import { describe, expect, it } from "vitest";
import { BRAND_VOTE_MAX, brandFieldTier, brandFieldValue, brandVoteProblem, currencyChangeSentence, parseBrandField, withBrandField } from "./brandVote";

const brand = {
  project: { name: "Larksfield", tagline: "A village by the river", fiatCurrency: "EUR" },
  currency: { name: "Seeds" },
  images: { logo: "/uploads/logo.webp" },
  theme: { primary: "#336655" },
  identityPack: {},
  skin: { water: "#0000ff" },
  secrets: { resendApiKey: "re_live_x" },
};

describe("which brand fields a vote may change", () => {
  it("lets a vote rename the village, its currency's word, an image or a colour", () => {
    expect(brandVoteProblem(brand, "project.name", "Larkfield")).toBeNull();
    expect(brandVoteProblem(brand, "currency.name", "Acorns")).toBeNull();
    expect(brandVoteProblem(brand, "images.logo", "/uploads/new.webp")).toBeNull();
    expect(brandVoteProblem(brand, "theme.primary", "#224433")).toBeNull();
  });

  it("never writes anything that reads like a credential, in any section", () => {
    expect(brandVoteProblem(brand, "secrets.resendApiKey", "x")).not.toBeNull();
    expect(brandVoteProblem({ project: { apiKey: "" } }, "project.apiKey", "x")).toContain("credential");
    expect(brandVoteProblem({ theme: { webhookUrl: "" } }, "theme.webhookUrl", "x")).toContain("credential");
  });

  it("lets a vote change the currency code, at the highest tier only (Rye, 2026-11-06)", () => {
    expect(brandVoteProblem(brand, "project.fiatCurrency", "USD")).toBeNull();
    expect(brandFieldTier("project.fiatCurrency")).toBe("constitutional");
    expect(brandFieldTier(" project.fiatCurrency ")).toBe("constitutional");
    expect(brandFieldTier("project.name")).toBe("routine");
    expect(brandFieldTier("currency.name"), "the currency's WORD is an ordinary name").toBe("routine");
  });

  it("takes the currency only as the code the admin route stores, and never blank", () => {
    for (const to of ["", "usd", " USD", "USD ", "US", "USDX", "US1", "€"]) {
      expect(brandVoteProblem(brand, "project.fiatCurrency", to), JSON.stringify(to)).toContain("three letter code");
    }
    // A village that launched without naming one can still be given one by vote.
    expect(brandVoteProblem({ project: { name: "Larksfield" } }, "project.fiatCurrency", "CRC")).toBeNull();
  });

  it("says on the ballot that nothing is converted, and by how much amounts move between decimal places", () => {
    const same = currencyChangeSentence("EUR", "USD");
    expect(same).toContain("from EUR to USD");
    expect(same).toContain("Nothing already recorded is converted");
    expect(same).not.toContain("times");
    expect(currencyChangeSentence("CRC", "JPY")).toContain("JPY counts 0 decimal places where CRC counts 2, so each of those amounts reads 100 times larger");
    expect(currencyChangeSentence("JPY", "USD")).toContain("100 times smaller");
    expect(currencyChangeSentence("", "CRC")).toContain("changes to CRC");
  });

  it("keeps the map skin to its own writer", () => {
    expect(brandVoteProblem(brand, "skin.water", "#00ff00")).not.toBeNull();
  });

  it("refuses a field that does not exist, a malformed name, a long value and a second line", () => {
    expect(brandVoteProblem(brand, "project.invented", "x")).toContain("no text field");
    expect(brandVoteProblem(brand, "project", "x")).not.toBeNull();
    expect(brandVoteProblem(brand, "project.name", "x".repeat(BRAND_VOTE_MAX + 1))).toContain("at most");
    expect(brandVoteProblem(brand, "project.name", "two\nlines")).toContain("one line");
    expect(parseBrandField("project.name")).toEqual({ section: "project", key: "name" });
  });

  it("writes exactly one field and leaves the rest of the document as it was", () => {
    const next = withBrandField(brand, "project.name", "Larkfield");
    expect(brandFieldValue(next, "project.name")).toBe("Larkfield");
    expect(next.project.tagline).toBe(brand.project.tagline);
    expect(next.currency).toBe(brand.currency);
    expect(brand.project.name, "the input is never mutated").toBe("Larksfield");
  });
});
