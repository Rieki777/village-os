/**
 * The pinned dialer's lookup contract (round 4, lane L2; exception R39).
 *
 * WHAT BROKE. Node >= 20 calls a custom `lookup` with `{ all: true }` and
 * reads an ARRAY of `{address, family}` back; toolcheck's callbacks handed
 * back a bare string, so EVERY real dial through dialPinned/dialPinnedJson/
 * dialPinnedText died with "Invalid IP address: undefined" before a packet
 * moved. Reproduced standalone: the string-form callback fails against a
 * live host, the array form connects, on the same Node. Nobody had noticed
 * because every existing consumer short-circuits on empty data before
 * dialling (zero tools to check, network module off, zero agent deliveries
 * queued, no calendar subscriptions); the fx-rates-daily job was the first
 * to dial in anger and failed on its first tick.
 *
 * WHAT THIS FILE HOLDS, per the coordinator's ratification:
 *   1. BOTH callback forms resolve: `{all: true}` receives the one-element
 *      array, the legacy form receives the string, and a request driven
 *      either way completes against a real local HTTPS fixture.
 *   2. The PIN is unchanged: whichever form asks, the ONLY address ever
 *      handed out is the single vetted one; a second public DNS answer is
 *      never offered, and a private answer still refuses the whole dial
 *      before https.request is touched.
 *   3. The fx job cannot go hollow again: refreshDailyRates runs its whole
 *      guarded dial, parse and store against the fixture serving a captured
 *      ECB body, and the stored rows are asserted.
 */
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const VETTED = "198.51.100.7"; // TEST-NET-2: public-looking, never routed
const SECOND_PUBLIC = "203.0.113.9"; // TEST-NET-3: must never be offered
const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("dns/promises", async (importOriginal) => {
  const real = (await importOriginal()) as any;
  const mod = real.default ?? real;
  return { ...real, default: { ...mod, lookup: (...a: any[]) => lookupMock(...a) } };
});

// Partial mock: `request` is routed through `interceptor` so the test can
// (a) exercise the pinned lookup callback exactly as modern Node does and
// (b) forward the request over a REAL socket to the local HTTPS fixture.
const interceptor = vi.hoisted(() => ({ fn: null as null | ((opts: any, cb: any) => any) }));
vi.mock("https", async (importOriginal) => {
  const real = (await importOriginal()) as any;
  const mod = real.default ?? real;
  const request = (opts: any, cb: any) => (interceptor.fn ? interceptor.fn(opts, cb) : mod.request(opts, cb));
  return { ...real, default: { ...mod, request }, request };
});

import { guardedFetchJson } from "./toolcheck";
import { dailyRatesUrl, parseDailyRates, refreshDailyRates } from "./fxRates";

/** Self-signed for CN=fx.ecb.test, valid to 2126, generated for this test. */
const FIXTURE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCzEnLMMzcYhRt2
CQxM0txrTezMD/Y90/de5HRrgKe5gYomymdDDULYmFnRBVuumJ6ixlH3EouH5tIb
bUGU0YvhLsbptRbBcOCL6e0aTW3ESqx6djqZz6idrrtiTMt4bYlFWNzWdwXsePmy
kDe4wmQKEcFw1hmeoQM6fANxtVLbkBVRH8PojuGW2P+7n7uoTuKYAPnflZLjkwc/
D4aZ/whEGhM7McwKAew//Hp5z5fWDmnhlNfWnGAzLAH26HtZt/OKsvHBc+lOc7Kb
tfsAKfe0krVhHRlpEwXlActd++/tPP2lYjTCex8Qn1iY2aNvJwB3ywzB02gUQFyp
icQFuUe5AgMBAAECggEAN7iw4hu5tDaPIf6Uxj8C+Zzo52K8I+cWXX/HPkBtcIr/
myx2T2YL++wEXsdFDSJOkqYVkUVDB8nqbUBlHNLLrQlqOgTwjMb8CG2FKx8W3fLC
kuTBPWVhuZdKlb8BvXqQMXUCWvX0cO3//PFldWd/y6ZUxDDLDhJaN9OpGrPqkYlR
tVcA3acNCp5js4uLozNdkXBIr6fc02XesR2fZ8+I/V8f8pUTDK0W73UhnlkEn7zd
NSqQcS6ZymnaS2aRqPOYBQ0TS59pDloZ7jIISVIPKuXOwaK4GNyEA86aSPZli0ey
JzPI+AH9xlH17/bdP5HvpbrXa6DvdUY3SfSpOcDuxQKBgQDiNx1xsnB08KV3Nj+9
F2TKQ+bYN9dL7+f3rNUUMbnbfEfHkpMYGgTgaklGJdbtYVHrmpA47hSbtXJ9bRYc
0W7TgHEbEw0jeQrpWdQKQ2+CcMswzCDLUAb5ZBW46JXmeI1fkMRWMqwbj00jztpU
t2lHFn9C6DfrFPgCK7XJQXKY4wKBgQDKpk8E9mloxj6Z7uuVyWEXRsjsJCPNa3fq
3Y6PaaBwq4zIpK2LqC6C3wBOVR5Gpcapgryx8T3nc7L0vKB027MGf532jtViWfuo
Ez9X+KqIySVvBbiVTjpSa+zcn3GUYzVxbfwOCoFfxKkVpSsXQG6V0hgXjJnOFsyS
E1OE4sDrswKBgBJr/JjauC+9vSvVHiGu+wVBvFXVTlIfylswFvYbCpCmMU4+UH5A
+C6yWR8+S59vMnWmU6JfOQxpHVa7gHZ+U7Ejn5Jd3c8Kt2nDZ/IiBb2wo8tohC8q
aDb9AIvbXQG0xYaHyoVegQeJhvWojb0iZo9kdJ6lPJCHV58NojMugj+TAoGARF+Y
ibQaHJ/Gv2k9U2x+tbvMTuBitAxuiW/3iau51koLVic55sT37HARSlytumh0fvz9
bYxXtp/y4WBDQypdXPPx+B55IJX7stnLpYLhBwXW+36SqM2cH/MKF+Y0DDzs6ziQ
sqwYupc/9W2k/FNg/GvGdSubOU23+BFNPKjFLsECgYA9CZcYmhc0cCFiWoP3D6cd
LaJcYvoGk5hCae/u1DMbsXQ36/0jLaXkYMoGvO+3YbnOtFQDgozY5T2xU8RipvnL
nNBsW8uQkKhzZmLgBmzOAsDfCsVofHqzB2XmSkY2bKz0aTIl5nMRE8j7r/xiQVM7
2WKzET+fzvfsSFQkolqsVQ==
-----END PRIVATE KEY-----`;

const FIXTURE_CERT = `-----BEGIN CERTIFICATE-----
MIIDDzCCAfegAwIBAgIUZXilvesRH6Cln1oOT2UDffTnHzwwDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLZnguZWNiLnRlc3QwIBcNMjYwODIxMTQyMTAyWhgPMjEy
NjA3MjgxNDIxMDJaMBYxFDASBgNVBAMMC2Z4LmVjYi50ZXN0MIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsxJyzDM3GIUbdgkMTNLca03szA/2PdP3XuR0
a4CnuYGKJspnQw1C2JhZ0QVbrpieosZR9xKLh+bSG21BlNGL4S7G6bUWwXDgi+nt
Gk1txEqsenY6mc+ona67YkzLeG2JRVjc1ncF7Hj5spA3uMJkChHBcNYZnqEDOnwD
cbVS25AVUR/D6I7hltj/u5+7qE7imAD535WS45MHPw+Gmf8IRBoTOzHMCgHsP/x6
ec+X1g5p4ZTX1pxgMywB9uh7WbfzirLxwXPpTnOym7X7ACn3tJK1YR0ZaRMF5QHL
Xfvv7Tz9pWI0wnsfEJ9YmNmjbycAd8sMwdNoFEBcqYnEBblHuQIDAQABo1MwUTAd
BgNVHQ4EFgQUg5r+3rs5cWPQHzTjPPPPrENfZrswHwYDVR0jBBgwFoAUg5r+3rs5
cWPQHzTjPPPPrENfZrswDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOC
AQEAG582AXWcvykrnsySJOGxiNPOrTr7gPFX894p9Jq5p4zVhmf3FVjDislh6P01
9gLOo4zCd8Z0lzXT/UoS4oBjuGA873PoghoXnDLMLE9ZBLF1zxRtlc1IxhZjc4hN
QruvauGltdcXMHEUXwHdv1iaUg4ByDnOEgphfmXYIkiIWHTpg9CF8ZAIGUd6TTvl
vdQKfrgqKlriGMSZ7K/2t+pVrku57chpasXKUA8p1QwLxaxvHXxrhi0sJrunsPC5
eJCtt90AuIWaa108EfOGjfzSETg5AGYEC2mydlDmpFYvj6Z7R48XFOp3R/Oi7S+l
YVmI4Zp0AJm9dhZJbw8q4F1xzA==
-----END CERTIFICATE-----`;

/**
 * The body the fixture serves, trimmed from the live answer of 2026-09-25.
 *
 * It used to be the ECB's SDMX. The source changed because the ECB daily
 * reference list does not carry colones and the first village this platform
 * serves prices in them; this one answers 166 codes with no key. The envelope
 * is kept verbatim because `parseDailyRates` checks `result` and `base_code`
 * before it reads a single rate, and a fixture that dropped them would be
 * testing a parser nobody ships.
 */
const RATES_BODY = JSON.stringify({
  result: "success",
  provider: "https://www.exchangerate-api.com",
  time_last_update_unix: 1790294551,
  time_last_update_utc: "Fri, 25 Sep 2026 00:02:31 +0000",
  base_code: "EUR",
  rates: { CHF: 0.941694, USD: 1.13807 },
});

let fixture: https.Server;
let fixturePort = 0;
let lookupCalls: Array<{ options: any; delivered: any }> = [];

beforeAll(async () => {
  fixture = https.createServer({ key: FIXTURE_KEY, cert: FIXTURE_CERT }, (req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(RATES_BODY);
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  fixturePort = (fixture.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => fixture.close(r));
});

beforeEach(() => {
  lookupCalls = [];
  lookupMock.mockReset();
  // The interceptor: drive the dialer's own lookup callback both ways modern
  // and legacy Node do, record what it hands out, then carry the request over
  // a REAL TLS socket to the fixture. `request` here is the mocked https
  // module's, whose fallback IS the real implementation once interceptor.fn
  // is cleared for the forwarded call.
  interceptor.fn = (opts: any, cb: any) => {
    const call: { options: any; delivered: any } = { options: { ...opts, lookup: undefined }, delivered: {} };
    if (typeof opts.lookup === "function") {
      opts.lookup(opts.hostname, { all: true, hints: 0 }, (e: any, addrs: any) => {
        call.delivered.all = e ?? addrs;
      });
      opts.lookup(opts.hostname, {}, (e: any, addr: any, family: any) => {
        call.delivered.legacy = e ?? [addr, family];
      });
    }
    lookupCalls.push(call);
    const previous = interceptor.fn;
    interceptor.fn = null; // the forwarded call uses the REAL https.request
    try {
      return https.request(
        {
          host: "127.0.0.1",
          port: fixturePort,
          path: opts.path,
          method: opts.method,
          headers: opts.headers,
          rejectUnauthorized: false,
        },
        cb,
      );
    } finally {
      interceptor.fn = previous;
    }
  };
});

describe("both lookup forms resolve, over a real dial to the HTTPS fixture", () => {
  it("completes a guarded fetch and hands the array form the one vetted address", async () => {
    lookupMock.mockResolvedValue([{ address: VETTED, family: 4 }]);
    const doc = await guardedFetchJson("https://fx.ecb.test/service/data/EXR/x?format=jsondata", 5000);
    expect(doc?.result).toBe("success");
    expect(doc?.base_code).toBe("EUR");
    expect(lookupCalls).toHaveLength(1);
    // Node >= 20's contract: an ARRAY, exactly one entry, the vetted address.
    expect(lookupCalls[0].delivered.all).toEqual([{ address: VETTED, family: 4 }]);
    // The legacy contract still answers the string form.
    expect(lookupCalls[0].delivered.legacy).toEqual([VETTED, 4]);
  });

  it("never offers any address but the vetted one, whichever form asks", async () => {
    lookupMock.mockResolvedValue([
      { address: VETTED, family: 4 },
      { address: SECOND_PUBLIC, family: 4 },
    ]);
    await guardedFetchJson("https://fx.ecb.test/x", 5000);
    const flat = JSON.stringify(lookupCalls.map((c) => c.delivered));
    expect(flat).toContain(VETTED);
    expect(flat).not.toContain(SECOND_PUBLIC);
    expect(flat).not.toContain("127.0.0.1");
  });
});

describe("the pin's refusals are untouched", () => {
  it("refuses a private answer before https.request is ever called", async () => {
    lookupMock.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    await expect(guardedFetchJson("https://internal.test/x", 5000)).rejects.toThrow(/private address/);
    expect(lookupCalls).toHaveLength(0);
  });

  it("refuses a round-robin that mixes one public and one private answer", async () => {
    lookupMock.mockResolvedValue([
      { address: VETTED, family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(guardedFetchJson("https://mixed.test/x", 5000)).rejects.toThrow(/private address/);
    expect(lookupCalls).toHaveLength(0);
  });
});

describe("the fx job dials for real (lane harm metric, R39 condition 3)", () => {
  it("fetches, parses and stores the fixture's rates end to end", async () => {
    lookupMock.mockResolvedValue([{ address: VETTED, family: 4 }]);
    const writes: any[] = [];
    const pool = {
      query: async (sql: string, args: any[]) => {
        writes.push({ sql, args });
        return [{ affectedRows: 1 }];
      },
    } as any;
    const summary = await refreshDailyRates(pool);
    expect(summary).toContain("2 rate(s)");
    expect(writes).toHaveLength(2);
    expect(writes[0].sql).toContain("fx_rates");
    expect(writes.map((w) => w.args[0]).sort()).toEqual(["CHF", "USD"]);
    expect(writes.find((w) => w.args[0] === "CHF")?.args[1]).toBe(0.941694);
    // The day stored is the SOURCE's, taken from time_last_update_unix, never
    // this machine's: a job running before the source updates would otherwise
    // write today's row from yesterday's numbers, and latestRates takes MAX.
    expect(writes.find((w) => w.args[0] === "CHF")?.args[2]).toBe("2026-09-25");
    // And the URL the job dialled carries no currency codes at all.
    expect(lookupCalls[0].options.path).toBe(new URL(dailyRatesUrl()).pathname + new URL(dailyRatesUrl()).search);
    // The parser answered the same rows the fixture served.
    expect(parseDailyRates(JSON.parse(RATES_BODY))).toHaveLength(2);
  });
});
