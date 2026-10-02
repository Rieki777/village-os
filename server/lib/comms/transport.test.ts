import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeResend, type FakeResend } from "../../testkit/fakeResend";
import { RESEND_DEFAULT_BASE, resendApiBase, resendPayload, resendTransport, type TransportMessage } from "./transport";

/**
 * The one mail door, driven against the fake provider in this process
 * (docs/comms/BUILD_SPEC.md 5.2 and 8.1). Nothing here reaches the real API.
 */

let fake: FakeResend;
const KEY = "re_test_lane_f";

const message = (over: Partial<TransportMessage> = {}): TransportMessage => ({
  id: "msg_0123456789abcdef01234567",
  kind: "events",
  from: "Village <hello@village.example.test>",
  to: "ana@example.test",
  subject: "Seed swap: you are coming",
  html: "<p>See you there.</p>",
  text: "See you there.",
  listUnsubscribe: { url: "https://village.example.test/api/comms/unsubscribe?t=abc.def", mailto: "hello@village.example.test" },
  ...over,
});

beforeAll(async () => {
  fake = await startFakeResend({ apiKey: KEY });
});

afterAll(async () => {
  await fake.close();
});

beforeEach(() => {
  fake.requests.length = 0;
});

describe("the Resend transport", () => {
  it("sends one message with the row id as its Idempotency-Key and its tags, and answers the provider's id", async () => {
    const transport = resendTransport({ apiKey: () => KEY, baseUrl: () => fake.url });
    const result = await transport.send(message());
    expect(result).toEqual({ ok: true, providerId: expect.stringMatching(/^fake_/) });
    const req = fake.requests.at(-1)!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/emails");
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req.headers["idempotency-key"]).toBe("msg_0123456789abcdef01234567");
    expect(req.body).toMatchObject({
      from: "Village <hello@village.example.test>",
      to: ["ana@example.test"],
      subject: "Seed swap: you are coming",
      html: "<p>See you there.</p>",
      text: "See you there.",
      tags: [
        { name: "msg", value: "msg_0123456789abcdef01234567" },
        { name: "kind", value: "events" },
      ],
    });
  });

  it("carries one-click unsubscribe headers on every kind but essential", async () => {
    const transport = resendTransport({ apiKey: () => KEY, baseUrl: () => fake.url });
    await transport.send(message());
    expect(fake.requests.at(-1)!.body.headers).toEqual({
      "List-Unsubscribe": "<https://village.example.test/api/comms/unsubscribe?t=abc.def>, <mailto:hello@village.example.test?subject=unsubscribe>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    await transport.send(message({ kind: "essential", id: "msg_essential000000000000000" }));
    expect(fake.requests.at(-1)!.body.headers, "a password link never offers to unsubscribe").toBeUndefined();
  });

  it("is the one delivery for one row, however many times the row is retried", async () => {
    const transport = resendTransport({ apiKey: () => KEY, baseUrl: () => fake.url });
    const before = fake.emails().length;
    const a = await transport.send(message({ id: "msg_retried00000000000000000" }));
    const b = await transport.send(message({ id: "msg_retried00000000000000000" }));
    expect(a.ok && b.ok && a.providerId === b.providerId).toBe(true);
    expect(fake.emails().length - before).toBe(1);
  });

  it("calls a 429 and a 500 retryable and a 422 final, with the provider's own words", async () => {
    const transport = resendTransport({ apiKey: () => KEY, baseUrl: () => fake.url });
    fake.failNext(429);
    expect(await transport.send(message())).toMatchObject({ ok: false, retryable: true, status: 429 });
    fake.failNext(500);
    expect(await transport.send(message())).toMatchObject({ ok: false, retryable: true, status: 500 });
    fake.failNext(422);
    const refused = await transport.send(message());
    expect(refused).toMatchObject({ ok: false, retryable: false, status: 422 });
    expect(refused.ok ? "" : refused.error).toContain("The fake provider refused this email.");
    // And the next one goes through: the failures were for the next calls only.
    expect((await transport.send(message())).ok).toBe(true);
  });

  it("answers a refused key as final, and never throws", async () => {
    const transport = resendTransport({ apiKey: () => "re_wrong_key", baseUrl: () => fake.url });
    expect(await transport.send(message())).toMatchObject({ ok: false, retryable: false, status: 401 });
    const none = resendTransport({ apiKey: () => "", baseUrl: () => fake.url });
    const before = fake.requests.length;
    expect(await none.send(message())).toEqual({ ok: false, retryable: false, error: "no_api_key" });
    expect(fake.requests.length, "no key, no call").toBe(before);
  });

  it("calls an unreachable provider and a silent one retryable, and never throws", async () => {
    // A port that was listening a moment ago and is closed now.
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", () => r()));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const unreachable = resendTransport({ apiKey: () => KEY, baseUrl: () => `http://127.0.0.1:${deadPort}` });
    expect(await unreachable.send(message())).toMatchObject({ ok: false, retryable: true });

    // A server that takes the request and never answers.
    const silent = http.createServer(() => undefined);
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", () => r()));
    const silentPort = (silent.address() as AddressInfo).port;
    try {
      const slow = resendTransport({ apiKey: () => KEY, baseUrl: () => `http://127.0.0.1:${silentPort}`, timeoutMs: 300 });
      const answer = await slow.send(message());
      expect(answer).toMatchObject({ ok: false, retryable: true });
      expect(answer.ok ? "" : answer.error).toContain("did not answer");
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((r) => silent.close(() => r()));
    }
  });
});

describe("the provider's address", () => {
  it("is the real API unless RESEND_API_BASE names an https or loopback address", () => {
    expect(resendApiBase({} as NodeJS.ProcessEnv)).toBe(RESEND_DEFAULT_BASE);
    expect(resendApiBase({ RESEND_API_BASE: "http://127.0.0.1:4321/" } as NodeJS.ProcessEnv)).toBe("http://127.0.0.1:4321");
    expect(resendApiBase({ RESEND_API_BASE: "https://mail.example.test" } as NodeJS.ProcessEnv)).toBe("https://mail.example.test");
    // A plain http address off this machine would carry the key in the clear.
    expect(resendApiBase({ RESEND_API_BASE: "http://mail.example.test" } as NodeJS.ProcessEnv)).toBe(RESEND_DEFAULT_BASE);
  });

  it("builds attachments and leaves out what is empty", () => {
    const body = resendPayload(
      message({
        text: "",
        replyTo: null,
        attachments: [{ filename: "gathering.ics", contentType: "text/calendar", contentBase64: "QkVHSU4=" }],
      }),
    );
    expect(body.text).toBeUndefined();
    expect(body.reply_to).toBeUndefined();
    expect(body.attachments).toEqual([{ filename: "gathering.ics", content: "QkVHSU4=", content_type: "text/calendar" }]);
  });
});
