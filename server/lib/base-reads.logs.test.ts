/**
 * A FAILED CHAIN READ MUST NOT PRINT THE ENDPOINT'S KEY INTO THE LOG.
 *
 * viem's HttpRequestError carries `URL: <the whole endpoint>` in its message.
 * It strips a `user:pass@` and nothing else, so an Alchemy or Infura endpoint
 * keeps its key in the path, and every reader in base-reads.ts logged
 * `e.message`. One timeout or one 429 and the key was in the host's log
 * stream, which is readable by anybody with the hosting dashboard.
 *
 * Needs no database: the secrets cache is loaded from an empty fake, the
 * endpoint arrives through BASE_RPC_URL, and the "chain" is a local stub that
 * answers 500, which is the shape of a provider having a bad minute.
 *
 * Every key below is fake.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { HttpRequestError } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadSecrets } from "./secrets";
import { readVillageMetric, rpcErrorText } from "./base-reads";

const FAKE_KEY = "LogFakeKeyNotReal0123456789abcd";

describe("rpcErrorText", () => {
  it("drops the key a viem error carries, and keeps what went wrong", () => {
    const url = `https://base-mainnet.g.alchemy.com/v2/${FAKE_KEY}`;
    const err = new HttpRequestError({ url, status: 429, body: { method: "eth_call" } });
    // The positive half: viem really does print the endpoint, key and all.
    expect(err.message).toContain(FAKE_KEY);
    const text = rpcErrorText(err, url);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).toContain("HTTP request failed");
    // Any other error passes through with the endpoint taken out.
    expect(rpcErrorText(new Error(`boom at ${url}`), url)).not.toContain(FAKE_KEY);
    expect(rpcErrorText("plain", url)).toBe("plain");
  });
});

describe("a reader whose endpoint fails", () => {
  let server: http.Server;
  let hits = 0;
  let url = "";
  const saved = process.env.BASE_RPC_URL;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits += 1;
      req.resume();
      req.on("end", () => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "provider unavailable" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v2/${FAKE_KEY}`;
    // An empty store: nothing typed, no sealing key, so BASE_RPC_URL decides.
    await loadSecrets({ query: async () => [[]] } as any, {});
    process.env.BASE_RPC_URL = url;
  });

  afterAll(async () => {
    if (saved === undefined) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = saved;
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("returns nothing, dialled the configured endpoint, and logged no key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await readVillageMetric({ contractAddress: "0x1111111111111111111111111111111111111111", metric: "totalSupply" });
    const said = error.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    error.mockRestore();

    expect(out).toBeNull();
    // The positive half: the read went to the endpoint BASE_RPC_URL named,
    // so the log below is about that endpoint failing.
    expect(hits, "the reader dialled the configured endpoint").toBeGreaterThan(0);
    expect(said).toContain("[base-reads]");
    expect(said).not.toContain(FAKE_KEY);
  });
});
