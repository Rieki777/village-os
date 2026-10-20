/**
 * THE COMMS SETUP CHECKLIST, as pure rules (server/lib/comms/setup.ts).
 *
 * The acceptance line this file carries: the readiness reader is not ready
 * until items 1 to 5 and 13 are green, and then it is. The database-backed
 * half of the same claim, with real rows behind each fact, is
 * server/lib/comms/settings.db.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { backfillCommsSettings } from "../../../shared/comms/settings";
import type { TestEmailRow } from "../../repos/commsOverview";
import { createMailer } from "./mailer";
import { effectiveSender } from "./settings";
import { REQUIRED_SETUP_KEYS, SETUP_KEYS, buildChecklist, readinessOf, testEmailDelivered, type SetupFacts } from "./setup";

const PATHS = [
  { id: "investor", label: "Investor" },
  { id: "steward", label: "Village Steward" },
  { id: "resident", label: "Resident" },
  { id: "prosperity-creator", label: "Prosperity Creator" },
];

/** A village that has done nothing yet. */
function facts(over: Partial<SetupFacts> = {}, settings: Record<string, unknown> = {}): SetupFacts {
  return {
    settings: backfillCommsSettings(settings),
    key: { configured: false, source: "none", last4: null },
    webhookSecret: { configured: false, source: "none", last4: null },
    sender: { line: "", source: "none" },
    inboxes: { investor: "", steward: "", resident: "", prosperity: "" },
    paths: PATHS,
    testEmail: null,
    lastReportAt: null,
    holders: null,
    memberNames: null,
    adminEmails: null,
    ...over,
  };
}

const DELIVERED_TEST: TestEmailRow = {
  id: "msg_1",
  toEmail: "ada@example.test",
  status: "sent",
  skipReason: null,
  lastError: null,
  providerMessageId: "fake_1",
  createdAt: 1,
  sentAt: 1,
  deliveredAt: null,
  deliveredReport: true,
};

const item = (f: SetupFacts, key: string) => buildChecklist(f).find((i) => i.key === key)!;

describe("the checklist's shape", () => {
  it("is the thirteen items of the spec's table, in its order, six of them required", () => {
    const list = buildChecklist(facts());
    expect(list.map((i) => i.key)).toEqual([...SETUP_KEYS]);
    expect(list.map((i) => i.n)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(list.filter((i) => i.required).map((i) => i.n)).toEqual([1, 2, 3, 4, 5, 13]);
    for (const i of list) {
      expect(i.label, i.key).toBeTruthy();
      expect(i.detail, i.key).toBeTruthy();
      expect(i.fix, i.key).toBeTruthy();
    }
  });
});

describe("the readiness reader", () => {
  it("is not ready until items 1 to 5 and 13 are green, and then it is", () => {
    // Each step turns one more required item green, in the order a founder works.
    const steps: Array<[string, (f: SetupFacts) => SetupFacts]> = [
      ["api-key", (f) => ({ ...f, key: { configured: true, source: "admin", last4: "abcd" } })],
      ["domain", (f) => ({ ...f, settings: { ...f.settings, domain: "village.example.test", domainId: "dom_1", domainStatus: "verified" } })],
      ["sender", (f) => ({ ...f, sender: { line: "Hill Village <hello@village.example.test>", source: "admin" } })],
      ["delivery-reports", (f) => ({ ...f, webhookSecret: { configured: true, source: "admin", last4: "wxyz" } })],
      ["postal-address", (f) => ({ ...f, settings: { ...f.settings, postalAddress: "1 Orchard Lane" } })],
      ["test-email", (f) => ({ ...f, testEmail: { ...DELIVERED_TEST } })],
    ];
    let f = facts();
    expect(readinessOf(buildChecklist(f)).ready).toBe(false);
    expect(readinessOf(buildChecklist(f)).open.map((i) => i.key)).toEqual([...REQUIRED_SETUP_KEYS]);
    for (const [key, apply] of steps) {
      f = apply(f);
      expect(item(f, key).done, `${key} reads done once its fact is true`).toBe(true);
      const { ready, open } = readinessOf(buildChecklist(f));
      const last = key === steps[steps.length - 1][0];
      expect(ready, `ready after ${key}`).toBe(last);
      if (!last) expect(open.length).toBeGreaterThan(0);
    }
  });

  it("stays ready with every optional item open", () => {
    const f = facts(
      {
        key: { configured: true, source: "admin", last4: "abcd" },
        webhookSecret: { configured: true, source: "admin", last4: "wxyz" },
        sender: { line: "Hill Village <hello@village.example.test>", source: "admin" },
        testEmail: { ...DELIVERED_TEST },
        holders: [],
        memberNames: {},
      },
      { domain: "village.example.test", domainId: "dom_1", domainStatus: "verified", postalAddress: "1 Orchard Lane" },
    );
    const list = buildChecklist(f);
    for (const key of ["reply-to", "path-contacts", "who-runs-comms", "investor-words"]) {
      expect(list.find((i) => i.key === key)!.done, key).toBe(false);
    }
    expect(readinessOf(list).ready).toBe(true);
  });

  it("is not ready again the moment one required item goes red", () => {
    const ready = facts(
      {
        key: { configured: true, source: "admin", last4: "abcd" },
        webhookSecret: { configured: true, source: "admin", last4: "wxyz" },
        sender: { line: "Hill Village <hello@village.example.test>", source: "admin" },
        testEmail: { ...DELIVERED_TEST },
      },
      { domain: "village.example.test", domainId: "dom_1", domainStatus: "verified", postalAddress: "1 Orchard Lane" },
    );
    expect(readinessOf(buildChecklist(ready)).ready).toBe(true);
    const noKey = { ...ready, key: { configured: false, source: "none" as const, last4: null } };
    expect(readinessOf(buildChecklist(noKey)).open.map((i) => i.key)).toEqual(["api-key"]);
  });
});

describe("each required item", () => {
  it("counts a domain only when the provider says verified", () => {
    const at = (status: string, domainId = "dom_1") =>
      item(facts({}, { domain: "village.example.test", domainId, domainStatus: status }), "domain");
    expect(at("verified").done).toBe(true);
    expect(at("pending").done).toBe(false);
    expect(at("pending").detail).toContain("waiting for its DNS records");
    expect(at("not_started").done).toBe(false);
    expect(at("failed").detail).toContain("could not find the DNS records");
    // Added with a key that cannot read domains, and nobody has vouched yet.
    expect(at("unknown", "").done).toBe(false);
    expect(at("unknown", "").detail).toContain("cannot ask Resend");
    const vouched = item(facts({}, { domain: "village.example.test", domainStatus: "verified", domainConfirmedBy: "Ada" }), "domain");
    expect(vouched.done).toBe(true);
    expect(vouched.detail).toContain("Ada confirmed by hand");
  });

  it("counts a sender only with a name, on the verified domain", () => {
    const withDomain = { domain: "village.example.test", domainStatus: "verified", domainId: "d" };
    const sender = (line: string, settings: Record<string, unknown> = withDomain, source: "admin" | "env" = "admin") =>
      item(facts({ sender: { line, source } }, settings), "sender");
    expect(sender("").done).toBe(false);
    expect(sender("Hill Village <hello@village.example.test>").done).toBe(true);
    // A bare address goes out with no name beside it.
    expect(sender("hello@village.example.test").done).toBe(false);
    // An address on somebody else's domain is delivered nowhere.
    expect(sender("Hill Village <hello@elsewhere.test>").detail).toContain("is not on village.example.test");
    expect(sender("Hill Village <hello@elsewhere.test>").done).toBe(false);
    // No domain yet, so the address cannot be checked against one.
    expect(sender("Hill Village <hello@village.example.test>", {}).done).toBe(false);
    expect(sender("Hill Village <hello@village.example.test>", withDomain, "env").detail).toContain("EMAIL_FROM");
  });

  it("counts the test email once the provider reports it delivered", () => {
    const t = (over: Partial<TestEmailRow>): TestEmailRow => ({ ...DELIVERED_TEST, ...over });
    expect(testEmailDelivered(null)).toBe(false);
    expect(testEmailDelivered(t({ status: "delivered", deliveredReport: false }))).toBe(true);
    // The report has arrived and waits to be applied: still the provider's word.
    expect(testEmailDelivered(t({ status: "sent", deliveredReport: true }))).toBe(true);
    expect(testEmailDelivered(t({ status: "sent", deliveredReport: false }))).toBe(false);
    // A later bounce outranks an earlier delivery report.
    expect(testEmailDelivered(t({ status: "bounced", deliveredReport: true }))).toBe(false);
    expect(item(facts({ testEmail: t({ status: "sent", deliveredReport: false }) }), "test-email").detail).toContain(
      "Waiting for the delivery report",
    );
    expect(
      item(facts({ testEmail: t({ status: "skipped", skipReason: "not_configured", deliveredReport: false }) }), "test-email").detail,
    ).toContain("key or the sender was missing");
  });

  it("names where a key and a webhook secret come from", () => {
    expect(item(facts({ key: { configured: true, source: "env", last4: "1234" } }), "api-key").detail).toContain("RESEND_API_KEY");
    expect(item(facts({ key: { configured: true, source: "admin", last4: "1234" } }), "api-key").detail).toContain("1234");
    expect(item(facts({ webhookSecret: { configured: true, source: "env", last4: null } }), "delivery-reports").detail).toContain(
      "RESEND_WEBHOOK_SECRET",
    );
    expect(item(facts({ webhookSecret: { configured: true, source: "admin", last4: null }, lastReportAt: 5 }), "delivery-reports").detail).toContain(
      "Reports are arriving",
    );
  });

  it("needs words in the postal address, not spaces", () => {
    expect(item(facts({}, { postalAddress: "   " }), "postal-address").done).toBe(false);
    expect(item(facts({}, { postalAddress: "1 Orchard Lane" }), "postal-address").done).toBe(true);
  });
});

describe("the optional items say what is true", () => {
  it("counts a path contact who left as nobody", () => {
    const f = facts(
      { memberNames: { u1: "Ada", u2: "Bo", u3: "Cy" } },
      { pathContacts: { investor: "u1", steward: "u2", resident: "u3", "prosperity-creator": "gone" } },
    );
    const contacts = item(f, "path-contacts");
    expect(contacts.done).toBe(false);
    expect(contacts.detail).toContain("Prosperity Creator");
  });

  it("names the inboxes that fall back to the sender", () => {
    const f = facts({ inboxes: { investor: "i@example.test", steward: "", resident: "r@example.test", prosperity: "" } });
    expect(item(f, "reply-to").detail).toBe("Village Steward and Prosperity Creator have no inbox, so replies go to the sender address.");
  });

  it("says the rehearsal inbox is the admins until somebody names one", () => {
    expect(item(facts({ adminEmails: ["a@example.test"] }), "rehearsal-inbox").detail).toBe("Rehearsals go to the admins: a@example.test.");
    expect(item(facts({}, { rehearsalTo: ["r@example.test"] }), "rehearsal-inbox").detail).toBe("Rehearsals go to r@example.test.");
  });

  it("says who reviewed the investor words", () => {
    const reviewed = item(facts({}, { investorWordsReviewed: { by: "Rye", at: "2026-10-02T12:00:00Z" } }), "investor-words");
    expect(reviewed.done).toBe(true);
    expect(reviewed.detail).toContain("Reviewed by Rye");
    expect(item(facts(), "investor-words").detail).toContain("only its welcome and its three-week check-in");
  });
});

describe("the From line, read two ways, must agree", () => {
  const saved = process.env.EMAIL_FROM;
  afterEach(() => {
    if (saved === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = saved;
    vi.restoreAllMocks();
  });

  it("resolves exactly as the mailer does, over every combination of typed and environment senders", () => {
    // The mailer logs a malformed sender; the comparison is the point here.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const typed = ["", "  ", "a@village.test", "Hill <a@village.test>", "  Hill <a@village.test>  ", "bad", "Hill <bad>", "<a@village.test>"];
    const envs = [undefined, "", "e@village.test", "Env <e@village.test>", "not an address"];
    let compared = 0;
    for (const t of typed) {
      for (const e of envs) {
        if (e === undefined) delete process.env.EMAIL_FROM;
        else process.env.EMAIL_FROM = e;
        const mailer = createMailer({
          emailConfig: () => ({ sender: t }),
          secretValue: () => "",
          projectName: () => "Test Village",
          getPool: () => {
            throw new Error("no pool in this test");
          },
          origin: () => "http://localhost",
        });
        expect(effectiveSender(t, e).line, `typed ${JSON.stringify(t)}, env ${JSON.stringify(e)}`).toBe(mailer.resolvedEmailSender());
        compared += 1;
      }
    }
    // The denominator, so a loop that ran zero times cannot pass.
    expect(compared).toBe(typed.length * envs.length);
  });
});
