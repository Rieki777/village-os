/**
 * Email, with a second transport and an honest answer about whether either
 * one actually works (bridges lane, R58/item 3).
 *
 * THE PROBLEM THIS CLOSES. Every email this platform sends (welcome
 * messages, receipts, notification digests, claim links, password resets)
 * rides one hardcoded path to one vendor (`sendResendEmail` in
 * `server/index.ts`, calling `https://api.resend.com/emails` directly), and
 * `docs/FORK_RUNBOOK.md`'s own runbook records that Resend answers HTTP 200
 * for a sender domain whose SPF/DKIM were never published and then delivers
 * NOTHING. That failure is silent twice over: the vendor's own API tells
 * this platform nothing went wrong, and until now nothing here recorded
 * whether a send had EVER actually worked, only whether a key was typed.
 *
 * TWO THINGS SHIP HERE:
 *
 *   1. `sendViaSmtp` / `verifySmtpTransport`: a generic SMTP transport, so a
 *      village whose Resend domain is unverified (or that would rather use
 *      its own mail provider, or Gmail with an app password, or a
 *      self-hosted Postfix) is not stuck with the one vendor this platform
 *      shipped a client for. Built on Node's own `net`/`tls`, no new
 *      dependency: EHLO, opportunistic STARTTLS, AUTH LOGIN, a properly
 *      dot-stuffed message body, one connection per send.
 *
 *   2. `sendEmail` wraps BOTH transports through `callVendor`
 *      (`./integrations.ts`), the SAME "one wrapper, one correlation id, one
 *      health row" seam every other outbound integration call in this
 *      codebase already goes through - this file does not invent a second
 *      mechanism. Every real send updates `integration_health` under
 *      `moduleId: "email"`, and `verifyEmailTransport` gives a steward an
 *      on-demand check (SMTP: connect, EHLO, STARTTLS, AUTH, then QUIT - NO
 *      message sent; Resend: one real send to Resend's own test recipient,
 *      `probeResendSend` below) that ALSO records through the same wrapper,
 *      so "test my connection" and "my last real send" read from one honest
 *      record instead of two.
 *
 * WHAT IS WIRED AND WHAT IS NOT. `integrationCards()` in `server/index.ts`
 * attaches this file's `email` health rows to the Resend card, and the card's
 * "Send a test" button runs `verifyEmailTransport` through
 * `server/routes/emailProbe.ts`, so a steward sees what the last check found.
 * `sendResendEmail` in `server/index.ts` still calls `api.resend.com` directly
 * and is not on this file's path yet, so a real send records nothing here.
 */
import net from "net";
import tls from "tls";
import { randomUUID } from "crypto";
import { callVendor } from "./integrations";

// ── Shared shape: this MUST stay assignment-compatible with server/index.ts's
//    existing MailResult, so wiring `sendResendEmail` to call `sendEmail`
//    here is a body swap, not a type change at every call site. ───────────

export type MailResult = {
  sent: boolean;
  reason?: "no_transport" | "no_sender" | "no_recipients" | "rejected" | "failed";
};

export interface EmailOpts {
  to: string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** True: connect with TLS from the first byte (the port 465 convention).
   *  False/omitted: connect in the clear and upgrade with STARTTLS if the
   *  server offers it, refusing to send credentials over a connection that
   *  never upgraded and never was TLS to begin with. */
  secure?: boolean;
  user?: string;
  pass?: string;
  /** Default 10s per network step (connect, each command, TLS handshake). */
  timeoutMs?: number;
}

export interface EmailTransportConfig {
  resendApiKey?: string;
  smtp?: SmtpConfig;
}

// ── Recipients: the SAME normalization sendResendEmail already does
//    (split a comma-separated inbox, trim, drop non-addresses, dedupe),
//    pulled out so both transports and the tests share one definition. ───

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeRecipients(to: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of to) {
    for (const part of String(raw ?? "").split(",")) {
      const addr = part.trim();
      if (addr && EMAIL_RE.test(addr) && !seen.has(addr)) {
        seen.add(addr);
        out.push(addr);
      }
    }
  }
  return out;
}

// ── Resend ────────────────────────────────────────────────────────────────

async function sendViaResend(apiKey: string, from: string, to: string[], opts: EmailOpts): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend answered ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
}

/**
 * Resend's own test recipient. A send to it is accepted, recorded as
 * delivered, and reaches no person (resend.com/docs, "Send test emails").
 */
export const RESEND_PROBE_RECIPIENT = "delivered@resend.dev";

/**
 * THE BEE FOR THE EMAIL GUILD: one real send, from the village's own sender,
 * to Resend's test recipient. Alive means Resend accepted it.
 *
 * WHY A SEND AND NOT A READ. This used to be `GET /api-keys`, which lists the
 * account's keys and sends nothing. Two things were wrong with it. A key that
 * can only send (`sending_access`, the narrowest Resend offers and the one the
 * setup game plants) is documented as able to send and nothing else, so the
 * check would refuse exactly the key it should bless. And a key that CAN list
 * keys proves nothing about the sender domain, which is the failure that
 * actually bites here: Resend answers 200 for a key and delivers nothing from
 * a domain it never verified. A send through the real sender exercises the key,
 * its permission, the domain restriction and the sender address in one call.
 * It was also wired to nothing; `server/routes/emailProbe.ts` is its caller now.
 */
export async function probeResendSend(apiKey: string, from: string): Promise<void> {
  await sendViaResend(apiKey, from, [RESEND_PROBE_RECIPIENT], {
    to: [RESEND_PROBE_RECIPIENT],
    subject: "Email check",
    html: "<p>This message checks that this village can send email. It goes to a test address and reaches nobody.</p>",
  });
}

// ── SMTP: a small, real client on Node's own net/tls. No third-party
//    dependency - the same choice toolcheck.ts made for HTTPS, for the same
//    reason: the codebase's convention is to own the seam that carries a
//    credential rather than trust a library's defaults with it. ──────────

/** One line of a raw MIME message, RFC 5321's "byte-stuffing": a line that
 *  starts with "." gets a second "." prepended, because a lone "." on its
 *  own line is what ends the DATA command. Exported and pure so the escaping
 *  rule is checked without a socket. */
export function dotStuff(body: string): string {
  return body
    .split(/\r\n|\n/)
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

/** The raw RFC 5322 message SMTP's DATA command carries. Pure: given the
 *  same inputs it always builds the same bytes, so it is testable with no
 *  socket and no clock dependency beyond the one passed in. */
export function buildMimeMessage(
  opts: EmailOpts & { from: string; to: string[] },
  now: Date = new Date(),
): string {
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to.join(", ")}`,
    `Subject: ${opts.subject}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${randomUUID()}@${(opts.from.split("@")[1] || "localhost").trim()}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
  ];
  return `${headers.join("\r\n")}\r\n\r\n${dotStuff(opts.html)}`;
}

/** One multi-line SMTP reply: `250-a\r\n250-b\r\n250 c\r\n` is one reply
 *  ending at the first line whose 4th character is a space rather than a
 *  hyphen. Returns the numeric code and the joined text, or null when the
 *  buffer does not yet hold a complete reply (the caller keeps reading). */
export function parseSmtpReply(buffer: string): { code: number; text: string; consumed: number } | null {
  const lines = buffer.split("\r\n");
  let consumedLines = 0;
  let code = 0;
  const textLines: string[] = [];
  for (const line of lines) {
    if (line === "" && consumedLines === lines.length - 1) break; // trailing partial
    const m = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!m) return null; // not a complete/valid reply yet
    code = Number(m[1]);
    textLines.push(m[3]);
    consumedLines++;
    if (m[2] === " ") {
      const consumed = lines.slice(0, consumedLines).join("\r\n").length + 2; // + the CRLF that ended it
      return { code, text: textLines.join(" "), consumed };
    }
  }
  return null;
}

interface SmtpSession {
  write(cmd: string): void;
  /** Reads until one complete SMTP reply is available. */
  readReply(): Promise<{ code: number; text: string }>;
  upgradeToTls(host: string): Promise<void>;
  close(): void;
}

function openSmtpSession(cfg: SmtpConfig): Promise<SmtpSession> {
  const timeoutMs = cfg.timeoutMs ?? 10_000;
  return new Promise((resolve, reject) => {
    let socket: net.Socket | tls.TLSSocket = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, timeout: timeoutMs })
      : net.connect({ host: cfg.host, port: cfg.port, timeout: timeoutMs });

    let buffer = "";
    let pendingResolve: ((r: { code: number; text: string }) => void) | null = null;
    let pendingReject: ((e: Error) => void) | null = null;
    let settled = false;

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const reply = parseSmtpReply(buffer);
      if (reply && pendingResolve) {
        buffer = buffer.slice(reply.consumed);
        const r = pendingResolve;
        pendingResolve = null;
        pendingReject = null;
        r({ code: reply.code, text: reply.text });
      }
    };
    const onError = (e: Error) => {
      if (pendingReject) {
        const r = pendingReject;
        pendingResolve = null;
        pendingReject = null;
        r(e);
      } else if (!settled) {
        settled = true;
        reject(e);
      }
    };
    const onTimeout = () => onError(new Error(`SMTP connection to ${cfg.host}:${cfg.port} timed out`));

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("timeout", onTimeout);
    socket.once("connect", () => {
      if (settled) return;
      settled = true;
      const session: SmtpSession = {
        write(cmd: string) {
          socket.write(`${cmd}\r\n`);
        },
        readReply() {
          return new Promise((res, rej) => {
            pendingResolve = res;
            pendingReject = rej;
          });
        },
        upgradeToTls(host: string) {
          return new Promise((res, rej) => {
            const upgraded = tls.connect({ socket, servername: host, timeout: timeoutMs }, () => {
              socket.removeListener("data", onData);
              socket.removeListener("error", onError);
              socket.removeListener("timeout", onTimeout);
              socket = upgraded;
              socket.on("data", onData);
              socket.on("error", onError);
              socket.on("timeout", onTimeout);
              res();
            });
            upgraded.once("error", rej);
          });
        },
        close() {
          socket.end();
        },
      };
      resolve(session);
    });
    // secure:true connects over tls.connect, whose 'secureConnect' fires
    // instead of a plain 'connect' on some Node versions for the initial
    // handshake; 'connect' still fires first on a TLSSocket in current Node,
    // but this is defensive rather than assumed.
    if (cfg.secure) socket.once("secureConnect", () => socket.emit("connect"));
  });
}

async function expectCode(session: SmtpSession, min: number, max: number, step: string): Promise<string> {
  const { code, text } = await session.readReply();
  if (code < min || code > max) throw new Error(`SMTP ${step} refused: ${code} ${text}`.trim());
  return text;
}

/** EHLO, opportunistic STARTTLS, AUTH LOGIN if credentials were given.
 *  Shared by both `sendViaSmtp` (which continues to MAIL FROM/DATA) and
 *  `verifySmtpTransport` (which stops here and QUITs - the whole point of
 *  the verify path is to prove exactly this much without a message). */
async function smtpHandshake(session: SmtpSession, cfg: SmtpConfig): Promise<void> {
  await expectCode(session, 200, 299, "greeting");
  session.write(`EHLO ${cfg.host}`);
  let ehlo = await expectCode(session, 200, 299, "EHLO");

  if (!cfg.secure && /STARTTLS/i.test(ehlo)) {
    session.write("STARTTLS");
    await expectCode(session, 200, 299, "STARTTLS");
    await session.upgradeToTls(cfg.host);
    session.write(`EHLO ${cfg.host}`);
    ehlo = await expectCode(session, 200, 299, "EHLO (post-STARTTLS)");
  }

  if (cfg.user && cfg.pass) {
    if (!/AUTH/i.test(ehlo)) {
      throw new Error("this server did not advertise AUTH, so the configured username/password cannot be used");
    }
    session.write("AUTH LOGIN");
    await expectCode(session, 300, 399, "AUTH LOGIN");
    session.write(Buffer.from(cfg.user, "utf8").toString("base64"));
    await expectCode(session, 300, 399, "AUTH LOGIN (username)");
    session.write(Buffer.from(cfg.pass, "utf8").toString("base64"));
    await expectCode(session, 200, 299, "AUTH LOGIN (password)");
  }
}

export async function sendViaSmtp(cfg: SmtpConfig, from: string, to: string[], opts: EmailOpts): Promise<void> {
  const session = await openSmtpSession(cfg);
  try {
    await smtpHandshake(session, cfg);
    session.write(`MAIL FROM:<${from}>`);
    await expectCode(session, 200, 299, "MAIL FROM");
    for (const addr of to) {
      session.write(`RCPT TO:<${addr}>`);
      await expectCode(session, 200, 299, `RCPT TO:<${addr}>`);
    }
    session.write("DATA");
    await expectCode(session, 300, 399, "DATA");
    session.write(`${buildMimeMessage({ ...opts, from, to })}\r\n.`);
    await expectCode(session, 200, 299, "message body");
    session.write("QUIT");
  } finally {
    session.close();
  }
}

/** Proves the credentials and the connection work WITHOUT sending a
 *  message: connect, EHLO, STARTTLS if offered, AUTH if configured, then
 *  QUIT. No MAIL FROM, no RCPT TO, no DATA ever go out on this path. */
export async function verifySmtpTransport(cfg: SmtpConfig): Promise<void> {
  const session = await openSmtpSession(cfg);
  try {
    await smtpHandshake(session, cfg);
    session.write("QUIT");
  } finally {
    session.close();
  }
}

// ── The unified entry point: picks a transport, sends, and records the
//    outcome through the SAME wrapper every other integration in this
//    codebase uses (integrations.ts's callVendor). ─────────────────────

export async function sendEmail(cfg: EmailTransportConfig, opts: EmailOpts): Promise<MailResult> {
  const from = String(opts.from ?? "").trim();
  const to = normalizeRecipients(opts.to);
  const transport: "resend" | "smtp" | null = cfg.resendApiKey ? "resend" : cfg.smtp ? "smtp" : null;

  if (!transport) return { sent: false, reason: "no_transport" };
  if (!from) return { sent: false, reason: "no_sender" };
  if (!to.length) return { sent: false, reason: "no_recipients" };

  try {
    await callVendor("email", `${transport}-send`, () =>
      transport === "resend" ? sendViaResend(cfg.resendApiKey!, from, to, opts) : sendViaSmtp(cfg.smtp!, from, to, opts),
    );
    return { sent: true };
  } catch (e) {
    console.error(`[email/${transport}]`, (e as Error)?.message ?? e);
    return { sent: false, reason: "rejected" };
  }
}

export interface EmailHealthCheck {
  ok: boolean;
  transport: "resend" | "smtp" | "none";
  detail: string;
}

/** The on-demand "does sending actually work" check a steward can trigger.
 *  SMTP spends no send; Resend spends one, to a test address that reaches
 *  nobody, because nothing short of a send proves a send. Recorded through the same
 *  `callVendor` wrapper as a real send, under a distinct operation name
 *  (`${transport}-verify`), so `integration_health` shows both what the
 *  last REAL send did and what the last deliberate CHECK found - two
 *  different questions a steward might be asking. */
export async function verifyEmailTransport(cfg: EmailTransportConfig, from = ""): Promise<EmailHealthCheck> {
  const transport: "resend" | "smtp" | null = cfg.resendApiKey ? "resend" : cfg.smtp ? "smtp" : null;
  if (!transport) return { ok: false, transport: "none", detail: "No email transport is configured (neither Resend nor SMTP)." };
  // A Resend check is a send, and a send needs a sender. Refusing here keeps
  // "no sender" from being recorded as a failure of the key.
  if (transport === "resend" && !from.trim()) {
    return { ok: false, transport, detail: "No sender address is set, so there is nothing to send from yet." };
  }
  try {
    await callVendor("email", `${transport}-verify`, () =>
      transport === "resend" ? probeResendSend(cfg.resendApiKey!, from.trim()) : verifySmtpTransport(cfg.smtp!),
    );
    return {
      ok: true,
      transport,
      detail: transport === "resend"
        ? `Resend accepted a test send from ${from.trim()}.`
        : "The SMTP server accepted the connection and credentials.",
    };
  } catch (e) {
    return { ok: false, transport, detail: (e as Error)?.message ?? String(e) };
  }
}
