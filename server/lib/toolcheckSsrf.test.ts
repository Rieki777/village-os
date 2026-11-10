/**
 * SSRF range check: every spelling of a private, loopback or internal host
 * must be refused, including the forms a URL parser or a resolver can hand
 * back (v4-mapped v6, link-local, unique-local, unspecified).
 */
import { describe, expect, it } from "vitest";
import { guardOutboundUrl, ipIsPrivate } from "./toolcheck";

describe("ipIsPrivate", () => {
  it.each([
    "127.0.0.1", "0.0.0.0", "10.1.2.3", "169.254.169.254", "192.168.1.1", "172.16.0.1", "100.64.0.1",
    "::1", "::", "[::]", "[::1]",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:7f00:0001", "0:0:0:0:0:ffff:7f00:1", "[::ffff:a9fe:a9fe]",
    "::ffff:10.0.0.1", "::127.0.0.1",
    "fe80::1", "febf::1", "fc00::1", "fd12:3456::1", "fe80::1%eth0",
  ])("refuses %s", (ip) => {
    expect(ipIsPrivate(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808", "fec0::1"])(
    "allows public %s",
    (ip) => {
      expect(ipIsPrivate(ip)).toBe(false);
    },
  );
});

describe("guardOutboundUrl literal hosts", () => {
  // The WHATWG URL parser rewrites decimal, octal and hex IPv4 to dotted form.
  it.each([
    "https://2130706433/",
    "https://0177.0.0.1/",
    "https://0x7f.1/",
    "https://0.0.0.0/",
    "https://[::]/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:7f00:1]/",
    "https://[fe80::1]/",
    "https://[fc00::1]/",
    "https://[fd00::1]/",
  ])("refuses %s", async (u) => {
    expect((await guardOutboundUrl(u)).ok).toBe(false);
  });

  it("passes a public literal address", async () => {
    expect((await guardOutboundUrl("https://93.184.216.34/")).ok).toBe(true);
    expect((await guardOutboundUrl("https://[2606:4700:4700::1111]/")).ok).toBe(true);
  });
});
