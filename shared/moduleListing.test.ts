import { describe, expect, it } from "vitest";
import {
  MANAGED_LISTING_CAP,
  MODULES,
  MODULE_LIBRARY_CONTRACT_VERSION,
  isPaid,
  moduleListingProblems,
  offeredModules,
  priceLine,
  registrySecretKeys,
  supportRoute,
  vendorModules,
  type ModuleDef,
} from "./modules";
import { listingRequirements } from "./launchRequirements";

/**
 * The tier is defined by where the credential lives. These assertions are what
 * keep that mechanical: a listing whose credential sits in the wrong plane is
 * not mislabelled, it is a different tier wearing the wrong word.
 *
 * `assertModuleGraph` throws on the same function at boot, and this file is why
 * a malformed entry fails in CI without anybody having to start a server.
 */
const base = (over: Partial<ModuleDef>): ModuleDef => ({
  id: "fixture",
  name: "Fixture",
  description: "A registry entry that exists only inside this test.",
  tier: "included",
  dataClass: "none",
  requires: [],
  recommends: [],
  capabilities: [],
  variableKeys: [],
  apiPrefixes: ["/api/fixture"],
  ...over,
});

const goodVendor = {
  legalName: "Example Systems Ltd",
  url: "https://example.invalid/product",
  supportUrl: "https://example.invalid/support",
  supportEmail: "support@example.invalid",
  statusUrl: "https://example.invalid/status",
  termsUrl: "https://example.invalid/terms",
  secretKeys: ["example_api_key"],
  liveness: { mode: "window", withinHours: 24 } as const,
};

describe("the shipped registry", () => {
  it("gives every module a tier and a data class", () => {
    for (const m of MODULES) {
      expect(m.tier, m.id).toBeDefined();
      expect(["included", "connected", "managed"], m.id).toContain(m.tier);
      expect(["none", "village-content", "member-pii"], m.id).toContain(m.dataClass);
    }
  });

  it("carries no listing problems", () => {
    expect(moduleListingProblems()).toEqual([]);
  });

  it("ships no listing yet, so the library adds no secret slot", () => {
    expect(vendorModules()).toEqual([]);
    expect(registrySecretKeys()).toEqual([]);
  });

  it("routes every platform module's support at the platform", () => {
    for (const m of MODULES) {
      expect(supportRoute(m).party, m.id).toBe("platform");
      expect(supportRoute(m).vendorName, m.id).toBeNull();
    }
  });
});

describe("what a listing must carry", () => {
  it("accepts a well-formed connected listing", () => {
    expect(moduleListingProblems([base({ tier: "connected", vendor: { ...goodVendor } })])).toEqual([]);
  });

  it("refuses a listing with no named counterparty", () => {
    const problems = moduleListingProblems([base({ tier: "connected" })]);
    expect(problems.join(" ")).toContain("names no counterparty");
  });

  it("refuses a listing with no support email, at every tier", () => {
    const noEmail = { ...goodVendor, supportEmail: "" };
    expect(moduleListingProblems([base({ tier: "connected", vendor: noEmail })]).join(" ")).toContain("support email");
    expect(
      moduleListingProblems([
        base({ tier: "managed", vendor: { ...noEmail, secretKeys: [], managedEnvKey: "EXAMPLE_PLATFORM_KEY" } }),
      ]).join(" "),
    ).toContain("support email");
  });

  it("refuses a listing with no support URL", () => {
    const problems = moduleListingProblems([base({ tier: "connected", vendor: { ...goodVendor, supportUrl: "" } })]);
    expect(problems.join(" ")).toContain("supportUrl");
  });

  /*
   * A VENDOR THAT RUNS NO STATUS PAGE, which is the ordinary case for a small
   * one. Rye's word to a vendor on 2026-09-23: if a status page does not
   * exist, say so and it is recorded instead of leaving a dead link. The three
   * cases below are the whole rule, and the middle one is the point: a made-up
   * URL used to be the ONLY way to satisfy this field, and it renders as a
   * link that fails at the moment somebody needs it.
   */
  it("ACCEPTS a listing that says plainly there is no status page", () => {
    expect(
      moduleListingProblems([base({ tier: "connected", vendor: { ...goodVendor, statusUrl: null } })]),
    ).toEqual([]);
  });

  it("refuses a listing that says nothing at all about a status page", () => {
    const { statusUrl: _dropped, ...noMention } = goodVendor;
    const problems = moduleListingProblems([
      base({ tier: "connected", vendor: noMention as unknown as typeof goodVendor }),
    ]);
    expect(problems.join(" ")).toContain("whether the vendor runs a status page");
  });

  it("still refuses a status page that is not an https address", () => {
    const problems = moduleListingProblems([
      base({ tier: "connected", vendor: { ...goodVendor, statusUrl: "ask us" } }),
    ]);
    expect(problems.join(" ")).toContain("statusUrl");
  });

  it("refuses a managed listing that puts its credential in the village's store", () => {
    const problems = moduleListingProblems([
      base({ tier: "managed", vendor: { ...goodVendor, managedEnvKey: "EXAMPLE_PLATFORM_KEY" } }),
    ]);
    expect(problems.join(" ")).toContain("platform-held");
  });

  it("refuses a managed listing that names no environment variable", () => {
    const problems = moduleListingProblems([base({ tier: "managed", vendor: { ...goodVendor, secretKeys: [] } })]);
    expect(problems.join(" ")).toContain("names no environment variable");
  });

  it("refuses a managed listing that prints setup steps the village cannot perform", () => {
    const problems = moduleListingProblems([
      base({
        tier: "managed",
        vendor: { ...goodVendor, secretKeys: [], managedEnvKey: "EXAMPLE_PLATFORM_KEY", setupSteps: ["Log into their dashboard"] },
      }),
    ]);
    expect(problems.join(" ")).toContain("no account here");
  });

  it("refuses a connected listing with no key the village can hold", () => {
    const problems = moduleListingProblems([base({ tier: "connected", vendor: { ...goodVendor, secretKeys: [] } })]);
    expect(problems.join(" ")).toContain("no secret slot");
  });

  it("refuses an included module that carries a counterparty", () => {
    const problems = moduleListingProblems([base({ tier: "included", vendor: { ...goodVendor } })]);
    expect(problems.join(" ")).toContain("carries a vendor record");
  });

  it("refuses a liveness window of zero hours", () => {
    const problems = moduleListingProblems([
      base({ tier: "connected", vendor: { ...goodVendor, liveness: { mode: "window", withinHours: 0 } } }),
    ]);
    expect(problems.join(" ")).toContain("liveness window");
  });
});

describe("who a village is sent to", () => {
  it("sends a connected listing at the vendor, by name and by address", () => {
    const route = supportRoute(base({ tier: "connected", vendor: { ...goodVendor } }));
    expect(route.party).toBe("vendor");
    expect(route.vendorName).toBe("Example Systems Ltd");
    expect(route.supportUrl).toBe("https://example.invalid/support");
    expect(route.supportEmail).toBe("support@example.invalid");
  });

  it("never names the vendor behind a managed listing", () => {
    const route = supportRoute(
      base({ tier: "managed", vendor: { ...goodVendor, secretKeys: [], managedEnvKey: "EXAMPLE_PLATFORM_KEY" } }),
    );
    expect(route.party).toBe("platform");
    expect(route.vendorName).toBeNull();
  });
});

describe("secret slots the registry contributes", () => {
  it("takes a connected listing's slots", () => {
    expect(registrySecretKeys([base({ tier: "connected", vendor: { ...goodVendor } })])).toEqual(["example_api_key"]);
  });

  it("takes nothing from a managed listing, whatever it declares", () => {
    // Belt and braces: moduleListingProblems already refuses this shape, and
    // the derivation refuses it a second time, because a managed credential
    // reaching the village's store is the one mistake with no recovery.
    const rogue = base({ tier: "managed", vendor: { ...goodVendor, secretKeys: ["should_never_appear"] } });
    expect(registrySecretKeys([rogue])).toEqual([]);
  });
});

describe("the managed cap", () => {
  const managed = (id: string) =>
    base({ id, tier: "managed", vendor: { ...goodVendor, secretKeys: [], managedEnvKey: `${id.toUpperCase()}_KEY`, setupSteps: undefined } });

  it("allows two, because the second is a transition slot", () => {
    expect(moduleListingProblems([managed("m1"), managed("m2")])).toEqual([]);
  });

  it("refuses a third", () => {
    const problems = moduleListingProblems([managed("m1"), managed("m2"), managed("m3")]);
    expect(problems.join(" ")).toContain(`against a cap of ${MANAGED_LISTING_CAP}`);
  });

  it("counts only managed, so connected listings are uncapped", () => {
    const connected = (id: string) => base({ id, tier: "connected", vendor: { ...goodVendor } });
    expect(moduleListingProblems([connected("c1"), connected("c2"), connected("c3"), connected("c4")])).toEqual([]);
  });
});

describe("the contract version", () => {
  it("is a value a listing can be stamped against", () => {
    expect(MODULE_LIBRARY_CONTRACT_VERSION).toMatch(/^\d+\.\d+$/);
  });
});

// ── Lane M: price, credit, and withdrawal ────────────────────────────────────

const paidVendor = { ...goodVendor, secretKeys: ["example_api_key", "example_licence_key"] };
const paid = {
  amount: 4900,
  currency: "USD",
  period: "month" as const,
  billingUrl: "https://example.invalid/pricing",
  licenceKey: "example_licence_key",
};

describe("what a price must carry", () => {
  it("accepts a well-formed paid connected listing", () => {
    expect(moduleListingProblems([base({ tier: "connected", vendor: paidVendor, pricing: paid })])).toEqual([]);
  });

  it("refuses a paid listing that names no licence slot", () => {
    // THE rule the whole design rests on: a fork owns shared/modules.ts, so a
    // price resting on a code gate is a price the buyer can delete.
    const { licenceKey, ...noSlot } = paid;
    const problems = moduleListingProblems([base({ tier: "connected", vendor: paidVendor, pricing: noSlot })]);
    expect(problems.join(" ")).toContain("no credential behind it");
  });

  it("refuses a licence slot the listing does not own", () => {
    const problems = moduleListingProblems([
      base({ tier: "connected", vendor: paidVendor, pricing: { ...paid, licenceKey: "somebody_elses_key" } }),
    ]);
    expect(problems.join(" ")).toContain("must be one of this listing's own secret slots");
  });

  it("allows a free listing to name no licence slot", () => {
    const { licenceKey, ...noSlot } = paid;
    expect(
      moduleListingProblems([base({ tier: "connected", vendor: paidVendor, pricing: { ...noSlot, amount: 0 } })]),
    ).toEqual([]);
  });

  it("refuses a managed listing that names a licence slot", () => {
    const problems = moduleListingProblems([
      base({
        tier: "managed",
        vendor: { ...goodVendor, secretKeys: [], managedEnvKey: "EXAMPLE_PLATFORM_KEY" },
        pricing: { ...paid, licenceKey: "example_licence_key" },
      }),
    ]);
    expect(problems.join(" ")).toContain("platform-held");
  });

  it("refuses a price on an included module", () => {
    const problems = moduleListingProblems([base({ tier: "included", pricing: { ...paid, licenceKey: undefined } })]);
    expect(problems.join(" ")).toContain("inside the platform price already");
  });

  it("refuses a price that is not whole minor units", () => {
    const problems = moduleListingProblems([base({ tier: "connected", vendor: paidVendor, pricing: { ...paid, amount: 49.5 } })]);
    expect(problems.join(" ")).toContain("whole number of minor units");
  });

  it("refuses a currency that is not a three letter code", () => {
    const problems = moduleListingProblems([base({ tier: "connected", vendor: paidVendor, pricing: { ...paid, currency: "dollars" } })]);
    expect(problems.join(" ")).toContain("currency code");
  });

  it("refuses a billing address that is not https", () => {
    const problems = moduleListingProblems([
      base({ tier: "connected", vendor: paidVendor, pricing: { ...paid, billingUrl: "http://example.invalid/pricing" } }),
    ]);
    expect(problems.join(" ")).toContain("billingUrl");
  });
});

describe("a price rendered as words", () => {
  it("says free rather than a zero", () => {
    expect(priceLine({ ...paid, amount: 0 })).toBe("Free");
  });

  it("reads minor units as money", () => {
    expect(priceLine(paid)).toContain("49.00");
    expect(priceLine(paid)).toContain("a month");
    expect(priceLine({ ...paid, period: "year" })).toContain("a year");
    expect(priceLine({ ...paid, period: "once" })).toContain("once");
  });

  it("uses the currency's own exponent rather than an assumed two", () => {
    // Yen has no minor unit. Dividing by a hundred would have shown 49.00 for
    // a price of 4900 yen, which is out by a factor of a hundred.
    expect(priceLine({ ...paid, currency: "JPY" })).toContain("4,900");
  });

  it("formats an unrecognised but well-formed code rather than refusing it", () => {
    // Intl accepts any three letter code and prefixes it, so the registry does
    // not have to carry an enumeration of ISO 4217 that would go stale.
    expect(priceLine({ ...paid, currency: "ZZZ" })).toContain("49.00");
  });

  it("survives a malformed currency instead of throwing inside a render", () => {
    // moduleListingProblems refuses this shape and boot asserts on it, so this
    // is the belt to that braces: priceLine runs inside a render, and a throw
    // there would blank the admin page rather than show one wrong price.
    expect(() => priceLine({ ...paid, currency: "dollars" })).not.toThrow();
    expect(priceLine({ ...paid, currency: "dollars" })).toContain("4900");
  });

  it("reads paid and free apart", () => {
    expect(isPaid(base({ tier: "connected", vendor: paidVendor, pricing: paid }))).toBe(true);
    expect(isPaid(base({ tier: "connected", vendor: paidVendor, pricing: { ...paid, amount: 0 } }))).toBe(false);
    expect(isPaid(base({}))).toBe(false);
  });
});

describe("builtBy is a credit and never a tier", () => {
  it("is allowed on an included module, where a vendor record is refused", () => {
    expect(moduleListingProblems([base({ tier: "included", builtBy: "Somebody Who Helped" })])).toEqual([]);
  });

  it("refuses an empty credit", () => {
    const problems = moduleListingProblems([base({ builtBy: "   " })]);
    expect(problems.join(" ")).toContain("empty builtBy");
  });

  it("does not change who supports anything", () => {
    const route = supportRoute(base({ tier: "included", builtBy: "Somebody Who Helped" }));
    expect(route.party).toBe("platform");
    expect(route.vendorName).toBeNull();
  });
});

describe("withdrawal", () => {
  const gone = { since: "2026-08-15" };

  it("accepts a withdrawn listing", () => {
    expect(moduleListingProblems([base({ tier: "connected", vendor: paidVendor, withdrawn: gone })])).toEqual([]);
  });

  it("refuses a withdrawal with no date", () => {
    const problems = moduleListingProblems([base({ withdrawn: { since: "last spring" } })]);
    expect(problems.join(" ")).toContain("YYYY-MM-DD");
  });

  it("refuses a replacement that is not in the registry", () => {
    const problems = moduleListingProblems([base({ withdrawn: { ...gone, replacedBy: "nothing-here" } })]);
    expect(problems.join(" ")).toContain("not a module in this registry");
  });

  it("refuses a listing that replaces itself", () => {
    const problems = moduleListingProblems([base({ id: "self", withdrawn: { ...gone, replacedBy: "self" } })]);
    expect(problems.join(" ")).toContain("its own replacement");
  });

  it("accepts a replacement that IS in the registry", () => {
    const successor = base({ id: "successor" });
    const old = base({ id: "old", withdrawn: { ...gone, replacedBy: "successor" } });
    expect(moduleListingProblems([old, successor])).toEqual([]);
  });

  it("keeps a withdrawn listing IN the registry, which is the orphan promise", () => {
    // The whole clause. A withdrawn entry still resolves by id, so a village's
    // module_settings row resolves to the withdrawn listing and never to an
    // orphan. Deleting the entry instead is what the contract forbids.
    const old = base({ id: "old", withdrawn: gone });
    const registry = [old, base({ id: "kept" })];
    expect(registry.some((m) => m.id === "old")).toBe(true);
    expect(offeredModules(registry).map((m) => m.id)).toEqual(["kept"]);
  });
});

describe("a member-pii listing owes a member driver", () => {
  const listing = (over: Partial<ModuleDef>) =>
    ({ id: "fixture", name: "Fixture", tier: "connected", dataClass: "member-pii", vendor: { legalName: "Example Systems Ltd" }, ...over }) as any;

  it("generates a blocking requirement for a member-pii listing", () => {
    const reqs = listingRequirements([listing({})]);
    const driver = reqs.find((r) => r.id === "listing-member-driver-fixture");
    expect(driver).toBeDefined();
    expect(driver!.severity).toBe("blocking");
    expect(driver!.checkKey).toBe("listing-member-driver:fixture");
    // appliesWhenModule is what withdraws the requirement while the module is
    // off, so a village that never enabled this is never asked about it.
    expect(driver!.appliesWhenModule).toBe("fixture");
  });

  it("asks nothing of a listing that touches no member data", () => {
    const reqs = listingRequirements([listing({ dataClass: "village-content" })]);
    expect(reqs.find((r) => r.id.startsWith("listing-member-driver"))).toBeUndefined();
  });

  it("asks nothing of an included module, which holds no copy outside", () => {
    // All eighteen platform modules are member-pii and none of them hands a
    // copy to anybody. The obligation belongs to a vendor, not to a data class.
    const reqs = listingRequirements([listing({ tier: "included" })]);
    expect(reqs.find((r) => r.id.startsWith("listing-member-driver"))).toBeUndefined();
  });

  it("asks it of a managed listing too, because deletion does not soften by tier", () => {
    const reqs = listingRequirements([listing({ tier: "managed" })]);
    expect(reqs.find((r) => r.id === "listing-member-driver-fixture")).toBeDefined();
  });

  it("adds nothing today, because the shipped registry holds no listings", () => {
    expect(listingRequirements(MODULES)).toEqual([]);
  });
});

describe("what the federated documents project", () => {
  it("carries only id and lifecycle, whatever the registry grows", () => {
    /*
     * /api/platform/info and /.well-known/village.json both map MODULES to
     * exactly { id, lifecycle }. Price, credit, withdrawal, tier and vendor are
     * all invisible there and must stay so: nothing about a village's vendors
     * is published. This asserts the projection rather than the payload, so it
     * fails the moment somebody widens the map.
     */
    const projected = MODULES.map((m) => ({ id: m.id, lifecycle: m.core ? "public" : "off" }));
    for (const row of projected) {
      expect(Object.keys(row).sort()).toEqual(["id", "lifecycle"]);
    }
  });
});
