/**
 * The provider's account API, from Comms Settings (server/lib/comms/resendAdmin.ts).
 *
 * Driven against the fake provider (server/testkit/fakeResend.ts) for every
 * shape the fake can play, and against a hand-answered fetch for the two it
 * cannot: a key that is only allowed to send, and a network that is down.
 * Nothing here reaches the real provider.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeResend, type FakeResend } from "../../testkit/fakeResend";
import { DELIVERY_REPORT_EVENTS, manualDomainSteps, manualWebhookSteps, resendAdmin, webhookUrl } from "./resendAdmin";

/** Short on purpose: a test key, never a credential. */
const KEY = "re_test_lane_b4";

let fake: FakeResend;
const client = (apiKey = KEY) => resendAdmin({ apiKey: () => apiKey, baseUrl: () => fake.url });

beforeAll(async () => {
  fake = await startFakeResend({ apiKey: KEY });
});
afterAll(async () => {
  await fake?.close();
});

describe("the sending domain, against the fake provider", () => {
  it("adds a domain pending, shows its DNS records, and reads it verified once the provider says so", async () => {
    fake.setDomainStatus("pending");
    const made = await client().createDomain("village.example.test");
    expect(made.ok, JSON.stringify(made)).toBe(true);
    if (!made.ok) return;
    expect(made.value).toMatchObject({ name: "village.example.test", status: "pending" });
    expect(made.value.id).toMatch(/^dom_/);
    // The records a founder copies to their DNS host.
    expect(made.value.records.length).toBeGreaterThan(0);
    for (const r of made.value.records) {
      expect(r.type).toBeTruthy();
      expect(r.name).toContain("village.example.test");
      expect(r.value).toBeTruthy();
    }

    const listed = await client().listDomains();
    expect(listed.ok && listed.value.map((d) => d.name)).toContain("village.example.test");

    fake.setDomainStatus("verified");
    const asked = await client().verifyDomain(made.value.id);
    expect(asked).toEqual({ ok: true, value: { id: made.value.id } });
    const got = await client().getDomain(made.value.id);
    expect(got.ok && got.value.status).toBe("verified");

    const sent = fake.requests.map((r) => `${r.method} ${r.path}`);
    expect(sent).toEqual(
      expect.arrayContaining(["POST /domains", "GET /domains", `POST /domains/${made.value.id}/verify`, `GET /domains/${made.value.id}`]),
    );
    expect(fake.requests.every((r) => r.headers.authorization === `Bearer ${KEY}`)).toBe(true);
  });

  it("answers not_found for a domain the provider does not have", async () => {
    const got = await client().getDomain("dom_missing");
    expect(got).toMatchObject({ ok: false, refusal: "not_found", status: 404 });
  });

  it("answers bad_key when the provider does not accept the key at all", async () => {
    const got = await client("re_wrong_key").listDomains();
    expect(got).toMatchObject({ ok: false, refusal: "bad_key", status: 401 });
  });

  it("answers no_key without calling anybody when no key is set", async () => {
    const before = fake.requests.length;
    expect(await client("").listDomains()).toMatchObject({ ok: false, refusal: "no_key" });
    expect(fake.requests.length).toBe(before);
  });
});

describe("delivery reports, against the fake provider", () => {
  it("makes the webhook with our address and the seven events, and answers its signing secret", async () => {
    const url = webhookUrl("https://village.example.test/");
    expect(url).toBe("https://village.example.test/api/comms/webhooks/resend");
    const made = await client().createWebhook(url, DELIVERY_REPORT_EVENTS);
    expect(made.ok, JSON.stringify(made)).toBe(true);
    if (!made.ok) return;
    expect(made.value.signingSecret).toBe(fake.webhookSecret());
    expect(made.value.signingSecret.startsWith("whsec_")).toBe(true);
    const call = fake.requests.filter((r) => r.method === "POST" && r.path === "/webhooks").pop()!;
    expect(call.body).toEqual({ endpoint: url, events: [...DELIVERY_REPORT_EVENTS] });
    expect(DELIVERY_REPORT_EVENTS).toEqual([
      "email.sent",
      "email.delivered",
      "email.delivery_delayed",
      "email.bounced",
      "email.complained",
      "email.failed",
      "email.suppressed",
    ]);
  });

  it("has no address to give when this server does not know its own", () => {
    expect(webhookUrl("")).toBe("");
  });
});

/** A fetch that answers one fixed response, for the shapes the fake cannot play. */
const answering = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as typeof fetch;

describe("the refusals a founder can act on", () => {
  it("reads a sending-only key as no_rights, and the screen has the steps to do it by hand", async () => {
    const restricted = resendAdmin({
      apiKey: () => KEY,
      baseUrl: () => "https://provider.invalid",
      fetchImpl: answering(401, { statusCode: 401, name: "restricted_api_key", message: "This API key is restricted to only send emails" }),
    });
    const domain = await restricted.createDomain("village.example.test");
    expect(domain).toMatchObject({ ok: false, refusal: "no_rights", status: 401 });
    const hook = await restricted.createWebhook("https://village.example.test/api/comms/webhooks/resend", DELIVERY_REPORT_EVENTS);
    expect(hook).toMatchObject({ ok: false, refusal: "no_rights" });

    const domainSteps = manualDomainSteps("village.example.test");
    expect(domainSteps[0]).toBe("Open resend.com/domains and add village.example.test.");
    expect(domainSteps.join(" ")).toContain("Resend says it is verified");
    const hookSteps = manualWebhookSteps("https://village.example.test/api/comms/webhooks/resend");
    expect(hookSteps.join(" ")).toContain("https://village.example.test/api/comms/webhooks/resend");
    expect(hookSteps.join(" ")).toContain("email.suppressed");
    expect(hookSteps.join(" ")).toContain("whsec_");
  });

  it("reads busy and failing answers as unavailable, keeping the provider's words", async () => {
    for (const status of [429, 500, 503]) {
      const got = await resendAdmin({
        apiKey: () => KEY,
        baseUrl: () => "https://provider.invalid",
        fetchImpl: answering(status, { message: "slow down" }),
      }).listDomains();
      expect(got, String(status)).toMatchObject({ ok: false, refusal: "unavailable", status });
      if (!got.ok) expect(got.error).toContain("slow down");
    }
  });

  it("reads a refusal of the request itself as refused, with the provider's words", async () => {
    const got = await resendAdmin({
      apiKey: () => KEY,
      baseUrl: () => "https://provider.invalid",
      fetchImpl: answering(422, { name: "validation_error", message: "The domain name is invalid." }),
    }).createDomain("x");
    expect(got).toMatchObject({ ok: false, refusal: "refused", status: 422 });
    if (!got.ok) expect(got.error).toBe("Resend answered 422: The domain name is invalid.");
  });

  it("reads a network that is down as unreachable, never a throw", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const got = await resendAdmin({ apiKey: () => KEY, baseUrl: () => "https://provider.invalid", fetchImpl: down }).listDomains();
    expect(got).toMatchObject({ ok: false, refusal: "unreachable" });
  });

  it("reads a webhook answered without a signing secret as refused, so nothing half-connected is stored", async () => {
    const got = await resendAdmin({
      apiKey: () => KEY,
      baseUrl: () => "https://provider.invalid",
      fetchImpl: answering(200, { object: "webhook", id: "wh_1" }),
    }).createWebhook("https://village.example.test/api/comms/webhooks/resend", DELIVERY_REPORT_EVENTS);
    expect(got).toMatchObject({ ok: false, refusal: "refused" });
  });
});
