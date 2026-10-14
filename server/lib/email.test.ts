/**
 * Email: the pure pieces (recipient normalization, MIME building, SMTP reply
 * parsing) tested directly, and the SMTP transport tested against a REAL
 * local TCP server speaking a minimal SMTP state machine - no vendor
 * credentials, no network beyond localhost, and no mocked socket layer, so
 * these tests exercise the actual protocol bytes this module sends.
 */
import net from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { integrationHealth } from "./integrations";
import {
  buildMimeMessage,
  dotStuff,
  normalizeRecipients,
  parseSmtpReply,
  sendEmail,
  sendViaSmtp,
  RESEND_PROBE_RECIPIENT,
  verifyEmailTransport,
  verifySmtpTransport,
  type EmailOpts,
} from "./email";

describe("normalizeRecipients", () => {
  it("splits a comma-separated inbox, trims, and keeps only real-looking addresses", () => {
    expect(normalizeRecipients(["a@x.com, b@x.com ,not-an-address, c@x.com"])).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("dedupes across multiple entries", () => {
    expect(normalizeRecipients(["a@x.com", "a@x.com, b@x.com"])).toEqual(["a@x.com", "b@x.com"]);
  });

  it("an empty or all-invalid list normalizes to empty", () => {
    expect(normalizeRecipients([])).toEqual([]);
    expect(normalizeRecipients(["", "not an email", ","])).toEqual([]);
  });
});

describe("dotStuff", () => {
  it("prepends a second dot to a line that starts with one", () => {
    expect(dotStuff("hello\n.world\nfine")).toBe("hello\r\n..world\r\nfine");
  });

  it("leaves ordinary lines untouched", () => {
    expect(dotStuff("no dots here\nor here")).toBe("no dots here\r\nor here");
  });
});

describe("buildMimeMessage", () => {
  const opts: EmailOpts & { from: string; to: string[] } = {
    from: "village@example.org",
    to: ["a@example.com", "b@example.com"],
    subject: "Welcome",
    html: "<p>Hi</p>",
  };
  const at = new Date("2026-08-31T00:00:00Z");

  it("carries the standard headers and a blank line before the body", () => {
    const msg = buildMimeMessage(opts, at);
    expect(msg).toContain("From: village@example.org");
    expect(msg).toContain("To: a@example.com, b@example.com");
    expect(msg).toContain("Subject: Welcome");
    expect(msg).toContain("MIME-Version: 1.0");
    expect(msg.split("\r\n\r\n")[1]).toBe("<p>Hi</p>");
  });

  it("dot-stuffs the body inline", () => {
    const msg = buildMimeMessage({ ...opts, html: ".leading dot" }, at);
    expect(msg.endsWith("..leading dot")).toBe(true);
  });

  it("includes Reply-To only when given", () => {
    expect(buildMimeMessage(opts, at)).not.toContain("Reply-To");
    expect(buildMimeMessage({ ...opts, replyTo: "reply@example.org" }, at)).toContain("Reply-To: reply@example.org");
  });
});

describe("parseSmtpReply", () => {
  it("parses a single-line reply", () => {
    const r = parseSmtpReply("250 OK\r\n");
    expect(r?.code).toBe(250);
    expect(r?.text).toBe("OK");
  });

  it("parses a multi-line reply, joining the text", () => {
    const r = parseSmtpReply("250-fake.smtp\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n");
    expect(r?.code).toBe(250);
    expect(r?.text).toBe("fake.smtp STARTTLS AUTH LOGIN");
  });

  it("returns null on a reply that has not fully arrived yet", () => {
    expect(parseSmtpReply("250-fake.smtp\r\n250-STA")).toBeNull();
    expect(parseSmtpReply("25")).toBeNull();
  });

  it("reports how many characters of the buffer the reply consumed", () => {
    const buf = "250 OK\r\nEXTRA";
    const r = parseSmtpReply(buf);
    expect(buf.slice(r!.consumed)).toBe("EXTRA");
  });
});

// ── A minimal, real SMTP server on localhost, so the transport tests below
//    exercise actual socket I/O and the actual protocol bytes. ───────────

interface FakeSmtp {
  port: number;
  received: string[];
  /** Resolves once the server side of the connection has fully closed -
   *  i.e. it has processed QUIT (or the socket dropped for any other
   *  reason). A fire-and-forget QUIT means the client's promise can resolve
   *  before the server has actually seen those bytes; tests await this
   *  before asserting on `received` so they check what happened, not what
   *  had merely been queued. */
  connectionClosed: Promise<void>;
  close(): Promise<void>;
}

function startFakeSmtp(opts: { offerAuth?: boolean; offerStarttls?: boolean; rejectRcpt?: string; authUser?: string; authPass?: string } = {}): Promise<FakeSmtp> {
  const received: string[] = [];
  let resolveClosed: () => void = () => {};
  const connectionClosed = new Promise<void>((r) => {
    resolveClosed = r;
  });
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on("close", () => resolveClosed());
      socket.write("220 fake.smtp ready\r\n");
      let buffer = "";
      let authStage: "none" | "user" | "pass" = "none";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let idx: number;
        // eslint-disable-next-line no-cond-assign
        while ((idx = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          received.push(line);

          if (authStage === "user") {
            authStage = "pass";
            socket.write("334 UGFzc3dvcmQ6\r\n");
            continue;
          }
          if (authStage === "pass") {
            authStage = "none";
            const okAuth =
              !opts.authUser ||
              (received[received.length - 2] === Buffer.from(opts.authUser, "utf8").toString("base64") &&
                line === Buffer.from(opts.authPass ?? "", "utf8").toString("base64"));
            socket.write(okAuth ? "235 Authentication successful\r\n" : "535 Authentication failed\r\n");
            continue;
          }

          const cmd = line.split(" ")[0].toUpperCase();
          if (cmd === "EHLO" || cmd === "HELO") {
            const extras = [opts.offerStarttls ? "250-STARTTLS" : null, opts.offerAuth !== false ? "250-AUTH LOGIN" : null].filter(Boolean);
            socket.write(`${["250-fake.smtp", ...extras].join("\r\n")}\r\n250 OK\r\n`);
          } else if (cmd === "AUTH") {
            authStage = "user";
            socket.write("334 VXNlcm5hbWU6\r\n");
          } else if (cmd === "MAIL") {
            socket.write("250 OK\r\n");
          } else if (cmd === "RCPT") {
            if (opts.rejectRcpt && line.includes(opts.rejectRcpt)) socket.write("550 no such user\r\n");
            else socket.write("250 OK\r\n");
          } else if (cmd === "DATA") {
            socket.write("354 go ahead\r\n");
          } else if (line === ".") {
            socket.write("250 Queued\r\n");
          } else if (cmd === "QUIT") {
            socket.write("221 bye\r\n");
            socket.end();
          } else if (cmd === "STARTTLS") {
            // Not exercised by these tests (no fake TLS upgrade here); present
            // so a server that offers it does not hang a client that never
            // sends it because offerStarttls is false in every case used
            // below.
            socket.write("220 go ahead\r\n");
          }
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        received,
        connectionClosed,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

describe("SMTP transport against a real local server", () => {
  let fake: FakeSmtp;
  afterEach(async () => {
    await fake?.close();
  });

  it("sends a message through the full EHLO/MAIL/RCPT/DATA sequence with no auth configured", async () => {
    fake = await startFakeSmtp({ offerAuth: false });
    await sendViaSmtp(
      { host: "127.0.0.1", port: fake.port },
      "village@example.org",
      ["a@example.com"],
      { to: ["a@example.com"], subject: "Hi", html: "<p>hi</p>" },
    );
    await fake.connectionClosed; // the client's QUIT is fire-and-forget; wait for the server to actually see it
    expect(fake.received.some((l) => l.startsWith("MAIL FROM"))).toBe(true);
    expect(fake.received.some((l) => l.startsWith("RCPT TO:<a@example.com>"))).toBe(true);
    expect(fake.received).toContain("DATA");
    expect(fake.received).toContain("QUIT");
  });

  it("authenticates with AUTH LOGIN when credentials are configured, base64-round-tripping both", async () => {
    fake = await startFakeSmtp({ authUser: "steward", authPass: "hunter2" });
    await sendViaSmtp(
      { host: "127.0.0.1", port: fake.port, user: "steward", pass: "hunter2" },
      "village@example.org",
      ["a@example.com"],
      { to: ["a@example.com"], subject: "Hi", html: "<p>hi</p>" },
    );
    expect(fake.received).toContain("AUTH LOGIN");
    expect(fake.received).toContain(Buffer.from("steward", "utf8").toString("base64"));
    expect(fake.received).toContain(Buffer.from("hunter2", "utf8").toString("base64"));
  });

  it("refuses to send credentials when the server never advertises AUTH", async () => {
    fake = await startFakeSmtp({ offerAuth: false });
    await expect(
      sendViaSmtp({ host: "127.0.0.1", port: fake.port, user: "steward", pass: "x" }, "village@example.org", ["a@example.com"], {
        to: ["a@example.com"],
        subject: "Hi",
        html: "hi",
      }),
    ).rejects.toThrow(/did not advertise AUTH/);
  });

  it("a rejected recipient (550) surfaces as a thrown error naming the reason", async () => {
    fake = await startFakeSmtp({ offerAuth: false, rejectRcpt: "nobody@example.com" });
    await expect(
      sendViaSmtp({ host: "127.0.0.1", port: fake.port }, "village@example.org", ["nobody@example.com"], {
        to: ["nobody@example.com"],
        subject: "Hi",
        html: "hi",
      }),
    ).rejects.toThrow(/RCPT TO.*refused/);
  });

  it("verify NEVER sends MAIL, RCPT, or DATA - only the handshake and QUIT", async () => {
    fake = await startFakeSmtp({ authUser: "steward", authPass: "hunter2" });
    await verifySmtpTransport({ host: "127.0.0.1", port: fake.port, user: "steward", pass: "hunter2" });
    await fake.connectionClosed;
    expect(fake.received.some((l) => l.startsWith("MAIL"))).toBe(false);
    expect(fake.received.some((l) => l.startsWith("RCPT"))).toBe(false);
    expect(fake.received).not.toContain("DATA");
    expect(fake.received).toContain("QUIT");
    expect(fake.received).toContain("AUTH LOGIN"); // the handshake itself still ran
  });

  it("a connection nobody is listening on fails clearly rather than hanging", async () => {
    // Port 1 is privileged/unassigned on every platform this runs on; nothing
    // answers, so this proves the failure path without a slow OS-level
    // connect timeout dominating the test.
    await expect(verifySmtpTransport({ host: "127.0.0.1", port: 1, timeoutMs: 2000 })).rejects.toThrow();
  }, 5000);
});

describe("sendEmail: transport selection and the local refusals", () => {
  it("refuses with no_transport when neither Resend nor SMTP is configured", async () => {
    const r = await sendEmail({}, { to: ["a@x.com"], subject: "s", html: "h", from: "v@x.com" });
    expect(r).toEqual({ sent: false, reason: "no_transport" });
  });

  it("refuses with no_sender before ever touching a transport", async () => {
    const r = await sendEmail({ smtp: { host: "127.0.0.1", port: 1 } }, { to: ["a@x.com"], subject: "s", html: "h" });
    expect(r).toEqual({ sent: false, reason: "no_sender" });
  });

  it("refuses with no_recipients before ever touching a transport", async () => {
    const r = await sendEmail({ smtp: { host: "127.0.0.1", port: 1 } }, { to: [], subject: "s", html: "h", from: "v@x.com" });
    expect(r).toEqual({ sent: false, reason: "no_recipients" });
  });

  it("prefers Resend over SMTP when both are configured", async () => {
    const originalFetch = globalThis.fetch;
    let calledUrl = "";
    globalThis.fetch = (async (url: any) => {
      calledUrl = String(url);
      return new Response("{}", { status: 200 });
    }) as any;
    try {
      const r = await sendEmail(
        { resendApiKey: "re_test", smtp: { host: "127.0.0.1", port: 1 } },
        { to: ["a@x.com"], subject: "s", html: "h", from: "v@x.com" },
      );
      expect(r).toEqual({ sent: true });
      expect(calledUrl).toBe("https://api.resend.com/emails");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("sendEmail and verifyEmailTransport both record through integration_health", () => {
  let fake: FakeSmtp;
  beforeEach(async () => {
    fake = await startFakeSmtp({ offerAuth: false });
  });
  afterEach(async () => {
    await fake.close();
  });

  it("a successful send is the ONLY evidence integration_health accepts that email works", async () => {
    const cfg = { smtp: { host: "127.0.0.1", port: fake.port } };
    const r = await sendEmail(cfg, { to: ["a@x.com"], subject: "s", html: "h", from: "v@x.com" });
    expect(r.sent).toBe(true);
    const h = integrationHealth("email", "smtp-send");
    expect(h?.lastSuccessAt).toBeTruthy();
    expect(h?.consecutiveFailures).toBe(0);
  });

  it("a failed send is recorded as a failure, distinct from a successful verify", async () => {
    await fake.close(); // nothing is listening now
    const cfg = { smtp: { host: "127.0.0.1", port: fake.port, timeoutMs: 2000 } };
    const r = await sendEmail(cfg, { to: ["a@x.com"], subject: "s", html: "h", from: "v@x.com" });
    expect(r).toEqual({ sent: false, reason: "rejected" });
    const h = integrationHealth("email", "smtp-send");
    expect(h?.lastFailureAt).toBeTruthy();
    expect(h?.consecutiveFailures).toBeGreaterThan(0);
  }, 5000);

  it("verifyEmailTransport records under its OWN operation name, not conflated with a real send", async () => {
    const cfg = { smtp: { host: "127.0.0.1", port: fake.port } };
    const result = await verifyEmailTransport(cfg);
    expect(result.ok).toBe(true);
    expect(result.transport).toBe("smtp");
    const h = integrationHealth("email", "smtp-verify");
    expect(h?.lastSuccessAt).toBeTruthy();
  });

  it("verifyEmailTransport with nothing configured reports 'none' and touches no health row", async () => {
    const before = integrationHealth("email", "resend-verify");
    const result = await verifyEmailTransport({});
    expect(result).toEqual({ ok: false, transport: "none", detail: expect.stringContaining("No email transport") });
    expect(integrationHealth("email", "resend-verify")).toEqual(before);
  });
});

describe("the Resend live check is a real send to Resend's test recipient", () => {
  const withFetch = async (status: number, body: string, run: (calls: Array<{ url: string; init: any }>) => Promise<void>) => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init: any }> = [];
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return new Response(body, { status });
    }) as any;
    try {
      await run(calls);
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  it("sends from the village's own sender to delivered@resend.dev and records the check", async () => {
    await withFetch(200, '{"id":"e_1"}', async (calls) => {
      const r = await verifyEmailTransport({ resendApiKey: "re_send_only" }, "hello@village.example");
      expect(r).toEqual({ ok: true, transport: "resend", detail: "Resend accepted a test send from hello@village.example." });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.resend.com/emails");
      expect(calls[0].init.method).toBe("POST");
      const sent = JSON.parse(calls[0].init.body);
      expect(sent.to).toEqual([RESEND_PROBE_RECIPIENT]);
      expect(sent.from).toBe("hello@village.example");
      expect(calls[0].init.headers.Authorization).toBe("Bearer re_send_only");
    });
    expect(integrationHealth("email", "resend-verify")?.lastSuccessAt).toBeTruthy();
  });

  it("never lists API keys, so a send-only key can pass", async () => {
    await withFetch(200, "{}", async (calls) => {
      await verifyEmailTransport({ resendApiKey: "re_send_only" }, "hello@village.example");
      expect(calls.some((c) => c.url.includes("/api-keys"))).toBe(false);
    });
  });

  it("says plainly when there is no sender, and spends no call", async () => {
    await withFetch(200, "{}", async (calls) => {
      const r = await verifyEmailTransport({ resendApiKey: "re_send_only" }, "  ");
      expect(r.ok).toBe(false);
      expect(r.detail).toContain("No sender address");
      expect(calls).toHaveLength(0);
    });
  });

  it("records a refusal as a failure, with Resend's own words", async () => {
    await withFetch(403, '{"message":"domain not verified"}', async () => {
      const r = await verifyEmailTransport({ resendApiKey: "re_send_only" }, "hello@unverified.example");
      expect(r.ok).toBe(false);
      expect(r.detail).toContain("403");
      expect(r.detail).toContain("domain not verified");
    });
    expect(integrationHealth("email", "resend-verify")?.consecutiveFailures).toBeGreaterThan(0);
  });
});
