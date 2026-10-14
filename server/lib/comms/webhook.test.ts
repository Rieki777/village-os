import { describe, expect, it } from "vitest";
import { makeWebhookSecret, signSvix } from "../../testkit/fakeResend";
import { readDeliveryReport, SVIX_TOLERANCE_SECONDS, verifySvix } from "./webhook";

/**
 * The delivery-report proof (the comms build spec 8.1). The fake
 * provider's signer is the reference here, so a verifier that agreed with
 * itself and disagreed with the provider would fail.
 */

const SECRET = makeWebhookSecret();
const BODY = JSON.stringify({ type: "email.delivered", data: { email_id: "fake_000001", tags: { msg: "msg_abc" } } });
const NOW = 1_790_000_000;

const verify = (headers: Record<string, string>, body = BODY, secret = SECRET, now = NOW) =>
  verifySvix({
    secret,
    id: headers["svix-id"],
    timestamp: headers["svix-timestamp"],
    signature: headers["svix-signature"],
    body: Buffer.from(body),
    now,
  });

describe("a delivery report's signature", () => {
  it("is accepted when the provider signed exactly these bytes, and names the delivery", () => {
    const headers = signSvix(SECRET, BODY, { id: "msg_delivery_1", timestamp: NOW });
    expect(verify(headers)).toEqual({ ok: true, id: "msg_delivery_1" });
  });

  it("is refused for a changed body, even one byte of whitespace", () => {
    const headers = signSvix(SECRET, BODY, { timestamp: NOW });
    expect(verify(headers)).toMatchObject({ ok: true });
    expect(verify(headers, `${BODY} `)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verify(headers, BODY.replace("delivered", "bounced"))).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("is refused under another secret, and refused outright with none", () => {
    const headers = signSvix(SECRET, BODY, { timestamp: NOW });
    expect(verify(headers, BODY, makeWebhookSecret())).toEqual({ ok: false, reason: "bad_signature" });
    expect(verify(headers, BODY, "")).toEqual({ ok: false, reason: "no_secret" });
  });

  it("is refused when it is older or newer than five minutes", () => {
    const headers = signSvix(SECRET, BODY, { timestamp: NOW });
    expect(verify(headers, BODY, SECRET, NOW + SVIX_TOLERANCE_SECONDS)).toMatchObject({ ok: true });
    expect(verify(headers, BODY, SECRET, NOW + SVIX_TOLERANCE_SECONDS + 1)).toEqual({ ok: false, reason: "stale" });
    expect(verify(headers, BODY, SECRET, NOW - SVIX_TOLERANCE_SECONDS - 1)).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts any one matching signature among several, which is how a secret rotates", () => {
    const old = signSvix(makeWebhookSecret(), BODY, { id: "msg_rotating", timestamp: NOW });
    const current = signSvix(SECRET, BODY, { id: "msg_rotating", timestamp: NOW });
    const both = { ...current, "svix-signature": `${old["svix-signature"]} ${current["svix-signature"]}` };
    expect(verify(both)).toEqual({ ok: true, id: "msg_rotating" });
  });

  it("is refused without its headers, and never throws on a malformed one", () => {
    const headers = signSvix(SECRET, BODY, { timestamp: NOW });
    expect(verify({ ...headers, "svix-id": "" })).toEqual({ ok: false, reason: "missing_headers" });
    expect(verify({ ...headers, "svix-signature": "" })).toEqual({ ok: false, reason: "missing_headers" });
    expect(verify({ ...headers, "svix-timestamp": "yesterday" })).toEqual({ ok: false, reason: "stale" });
    for (const junk of ["v1", "v1,", "v2,abc", "v1,short", "v1,ÿÿ"]) {
      expect(verify({ ...headers, "svix-signature": junk }), junk).toEqual({ ok: false, reason: "bad_signature" });
    }
  });
});

describe("reading a delivery report", () => {
  it("names the type, the provider's id and our row from either shape of tags", () => {
    expect(readDeliveryReport(JSON.parse(BODY))).toEqual({ type: "email.delivered", providerMessageId: "fake_000001", messageId: "msg_abc" });
    expect(
      readDeliveryReport({ type: "email.bounced", data: { email_id: "x", tags: [{ name: "msg", value: "msg_def" }] } }),
    ).toEqual({ type: "email.bounced", providerMessageId: "x", messageId: "msg_def" });
  });

  it("keeps a report with no tags and refuses one with no type", () => {
    expect(readDeliveryReport({ type: "email.sent", data: {} })).toEqual({ type: "email.sent", providerMessageId: null, messageId: null });
    expect(readDeliveryReport({ data: {} })).toBeNull();
    expect(readDeliveryReport("nope")).toBeNull();
    // A tag that is not an id shape never reaches the ledger.
    expect(readDeliveryReport({ type: "email.sent", data: { tags: { msg: "'; DROP TABLE x" } } })?.messageId).toBeNull();
  });
});
