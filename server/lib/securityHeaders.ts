/**
 * SECURITY RESPONSE HEADERS, on every response this process writes.
 *
 * Registered FIRST in server/index.ts, ahead of the webhooks and every route,
 * because a header set per-route is a header some route will be added
 * without. Live measurement before the first version landed: no CSP, no
 * X-Frame-Options, no nosniff, no Referrer-Policy, no Permissions-Policy on
 * any path, and `x-powered-by: Express` announcing the stack.
 *
 * ── WHY A SCRIPT POLICY MATTERS HERE MORE THAN MOST PLACES ──────────────────
 *
 * The session is a Bearer token in localStorage (`village-auth-token`), with no
 * cookie behind it. Any script that runs on this origin can read it, so any
 * injection anywhere in the app is a full account takeover, and a founder's
 * account holds the treasury. `script-src` below is the line that makes an
 * injected `<script>` or `onerror=` attribute inert: only files served from
 * this origin, plus the shell's own inline script by hash, may run.
 *
 * ── TWO EXCEPTIONS, BOTH EXACT: THE MAP ARTIFACT AND AN UPLOADED PDF ────────
 *
 * The PDF case is short and lives beside UPLOADED_PDF_PATH below. The map:
 *
 * docs/prototypes/grounds-v0.html (~6 MB, served under /grounds/) is inline
 * scripts, inline handlers, a blob: Worker and a CDN import throughout, so any
 * script policy worth writing would blank the map. It keeps what it had
 * (`frame-ancestors 'self'`) plus three directives measured to break nothing
 * there: it contains no <object>, no <base> and no <form>. ARTIFACT_PATH
 * matches ONLY the two URLs that serve it. Every other /grounds/* path falls
 * through to the SPA shell, and a broad prefix would have handed that shell
 * to anyone who typed /grounds/x with no script policy at all.
 *
 * ── WHAT THE APP POLICY ALLOWS, AND THE MEASUREMENT BEHIND EACH LINE ────────
 *
 * Inventoried on a5905b4 across all 167 built chunks (signed-in pages
 * included, since they ship in the same bundle) and swept on production with
 * the policy injected, every signed-out route at desktop and 390px:
 *
 *  - script: this origin, the shell's inline script(s) by hash, and
 *    Cloudflare's Web Analytics beacon. Cloudflare injects that beacon at the
 *    edge into HTML requested with `Accept: text/html` (invisible to a plain
 *    curl, and to this repository). static.cloudflareinsights.com serves only
 *    Cloudflare's own beacon, so allowing it opens no host a stranger can
 *    publish to. Its report goes by sendBeacon to cloudflareinsights.com
 *    /cdn-cgi/rum, so connect allows that host too; measured with the
 *    collector removed, the POST is refused and the village's Cloudflare
 *    analytics stop without a word. Keeping them is a product decision;
 *    deleting both CLOUDFLARE_BEACON_* entries is how to make the other one.
 *    No eval, no new Function, no string timers in any chunk.
 *  - the inline-script hashes are COMPUTED from the shell on disk, never
 *    typed. The analytics loader's text differs per build (production ships
 *    the literal `%VITE_ANALYTICS_ENDPOINT%` placeholders, a local build ships
 *    ""), so a typed hash would be right on one machine and wrong on the next.
 *    Carriage returns are normalised first, as the HTML parser does.
 *  - style: 'unsafe-inline', because React writes style attributes and the
 *    dialog scroll lock injects a <style>. Styles cannot read the token.
 *    https: because a village's brand theme may @import any https font CSS
 *    (server/lib/themeCss.ts), and fonts follow it.
 *  - img/media: https:, data:, blob:. Brand images and email previews may
 *    point anywhere; blob: is image previews and downloads.
 *  - connect: this origin and the beacon's collector. No chunk fetches
 *    another origin.
 *  - frame: this origin. The only frames are /grounds/ and sandboxed srcdoc
 *    email previews (which inherit this policy and run no script).
 *  - worker: this origin (/sw.js). object none, base-uri self, form-action
 *    self (no native form posts anywhere; sign-in and checkout are full-page
 *    redirects, which CSP does not govern).
 *
 * ── THE OTHER HEADERS ───────────────────────────────────────────────────────
 *
 * `frame-ancestors 'self'` came first and still matters most. /map is a
 * full-viewport iframe of /grounds/index.html, so without it the whole village
 * was embeddable in anyone's page: a pixel-perfect copy under a stranger's
 * domain, with the member's own session inside it. Same-origin framing is
 * what the shell does (LivingMap, MapPeek, WalkEditorPanel), so 'self' keeps
 * every one of them and refuses the rest. X-Frame-Options says the same for
 * browsers that still read it. Both ride on every response, the artifact
 * included, and in report-only mode too.
 *
 * Cross-Origin-Opener-Policy: same-origin. Google sign-in and Stripe are
 * full-page redirects, the one window.open passes noopener, and nothing reads
 * window.opener, so severing it costs nothing and stops a page that opened
 * this one from holding a handle to it.
 *
 * X-Permitted-Cross-Domain-Policies: none, and Origin-Agent-Cluster: ?1. The
 * first refuses Flash/Acrobat cross-domain policy files (this server answers
 * /crossdomain.xml with the SPA shell, which is no policy at all). The second
 * keys the agent cluster by origin; nothing here or in the artifact sets
 * document.domain, the one thing it disables.
 *
 * NO Cross-Origin-Resource-Policy. It guards no-cors loads, and here those
 * carry no credential (the session is a header a page has to add itself, never
 * a cookie), while ORB already refuses no-cors reads of the JSON and HTML. What
 * it WOULD do is break any page elsewhere that hotlinks a village's uploaded
 * images, such as a village's own brochure site on another domain, and that
 * cannot be enumerated from here.
 *
 * Permissions-Policy denies camera and geolocation outright. The microphone
 * is allowed for THIS origin only, `microphone=(self)`, because MicButton's
 * speech input (the journal, every guide chat) needs it, and `microphone=()`
 * made every mic fail silently with `not-allowed`. Widening a list here is a
 * deliberate act and never a default.
 *
 * NO Strict-Transport-Security from the platform. It is believed for its whole
 * max-age, and this one image serves thirteen villages on hostnames nobody
 * here has checked. Measured 2026-10-21 for the live deployment only: the
 * Railway hostname sits under `.app`, a TLD that is HSTS-preloaded in every
 * major browser, and the apex regencivics.earth already sends
 * `max-age=31536000; includeSubDomains; preload`, which covers the custom
 * domain for anyone who has visited the apex. So that village is TLS-only in
 * practice; the per-hostname switch belongs at its edge (Cloudflare), where
 * the hostnames are known, until every fork's are.
 *
 * ── TWO OPERATOR LEVERS (environment) ───────────────────────────────────────
 *
 * CSP_MODE=report-only  nothing new blocks; the policy is sent as
 *                       Content-Security-Policy-Report-Only and only
 *                       `frame-ancestors 'self'` stays enforced. For a fork
 *                       whose edge injects a script this policy does not
 *                       know, while it finds out what. Anything else, or
 *                       unset, enforces.
 * CSP_REPORT_URI=https://…  where browsers POST violation reports (a hosted
 *                       collector). Unset sends no report directives, so
 *                       this process grows no public write route.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/** The two URLs that serve the map artifact, and nothing else under /grounds/. */
export const ARTIFACT_PATH = /^\/grounds\/(?:index|grounds-[A-Za-z0-9]+)\.html\/?$/i;

/**
 * An uploaded PDF, which the uploads route serves inline by its extension and
 * which only that route answers (the file or a JSON 404, never the shell). A
 * PDF runs no script in this origin's pages, so a page policy protects nothing
 * there, and whether `object-src 'none'` on a top-level PDF blanks Safari's
 * built-in viewer could not be measured (Chromium's was measured and is fine).
 * It keeps the framing rule it always had. Anchored to the route on purpose:
 * a bare `.pdf` suffix would hand `/quests.pdf`, which the SPA shell answers,
 * no script policy at all.
 */
export const UPLOADED_PDF_PATH = /^\/api\/uploads\/[^/]+\.pdf$/i;

/**
 * The API's default cache rule: kept by no shared cache, revalidated by the
 * browser. Several answers differ by who asks (heartedByMe, the role-shaped
 * /api/modules), and none said so: nothing leaked only because Cloudflare
 * does not cache JSON by default (measured: every /api JSON answers
 * `cf-cache-status: DYNAMIC`), so one "cache everything" rule would have
 * served one member's answer to the next. Browsers see no change: the JSON
 * carries an ETag and no Last-Modified, so it was already revalidated every
 * time. A route that sets its own rule (uploads one year immutable, the
 * versioned theme stylesheet, the public documents, the calendar) sets it
 * later and wins.
 */
export const API_PATH = /^\/api\//i;
export const API_DEFAULT_CACHE = "private, no-cache";

/** Cloudflare Web Analytics, injected at the edge (see the header above). */
export const CLOUDFLARE_BEACON_SCRIPT = "https://static.cloudflareinsights.com";
export const CLOUDFLARE_BEACON_CONNECT = "https://cloudflareinsights.com";

export type CspMode = "enforce" | "report-only";

/**
 * `'sha256-…'` for every inline <script> in an HTML document, in order.
 * A script with a src attribute is not inline and is governed by origin.
 */
export function inlineScriptHashes(html: string): string[] {
  // The HTML parser turns CRLF and lone CR into LF before a script ever sees
  // its own text, and the browser hashes what the parser produced.
  const normalised = html.replace(/\r\n?/g, "\n");
  const out: string[] = [];
  const inline = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = inline.exec(normalised)) !== null) {
    const digest = crypto.createHash("sha256").update(m[1], "utf8").digest("base64");
    const token = `'sha256-${digest}'`;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * The origin client/index.html's analytics loader will fetch from, when a
 * build filled one in. The loader appends a <script src=endpoint/umami> and
 * the script then reports to the same host, so both script and connect need
 * it. Placeholders left unreplaced (`%VITE_…%`, what production ships) and
 * blanks mean no analytics, and no allowance.
 */
export function analyticsOriginOf(html: string): string | null {
  const m = html.match(/var\s+endpoint\s*=\s*"([^"]*)"/);
  const value = m?.[1]?.trim() ?? "";
  if (!value || value.includes("%")) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** An https URL safe to place in a header value, or null. */
export function reportUriOf(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  // Header grammar: no whitespace, quotes, commas or semicolons, which would
  // end the directive or the endpoint list and start another.
  if (/[\s"',;]/.test(v)) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

export function cspModeOf(raw: unknown): CspMode {
  return String(raw ?? "").trim().toLowerCase() === "report-only" ? "report-only" : "enforce";
}

const reportDirectives = (reportUri: string | null): string[] =>
  reportUri ? [`report-uri ${reportUri}`, "report-to csp"] : [];

export function buildAppPolicy(opts: {
  scriptHashes: string[];
  analyticsOrigin?: string | null;
  reportUri?: string | null;
}): string {
  const extra = opts.analyticsOrigin ? [opts.analyticsOrigin] : [];
  return [
    "default-src 'self'",
    ["script-src 'self'", ...opts.scriptHashes, CLOUDFLARE_BEACON_SCRIPT, ...extra].join(" "),
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    ["connect-src 'self'", CLOUDFLARE_BEACON_CONNECT, ...extra].join(" "),
    "media-src 'self' data: blob: https:",
    "frame-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...reportDirectives(opts.reportUri ?? null),
  ].join("; ");
}

export function buildArtifactPolicy(reportUri: string | null = null): string {
  return [
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...reportDirectives(reportUri),
  ].join("; ");
}

/** What stays enforced when the operator asks for report-only. */
export const ALWAYS_ENFORCED = "frame-ancestors 'self'";

export interface SecurityHeaderOptions {
  /** The built SPA shell (dist/public/index.html), read for its inline-script hashes. */
  shellPath: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * The middleware. The shell is read once, the first time a request finds it,
 * and the policy built from it is kept for the life of the process: the SPA
 * fallback caches the same file the same way (`indexShell` in
 * server/index.ts), so the two can never disagree about which shell is live.
 * A missing shell (dev, unit tests) gives a policy with no hashes and is
 * looked for again at most every 30 seconds.
 */
export function securityHeaders(opts: SecurityHeaderOptions): RequestHandler {
  const env = opts.env ?? process.env;
  const mode = cspModeOf(env.CSP_MODE);
  const reportUri = reportUriOf(env.CSP_REPORT_URI);
  if (String(env.CSP_REPORT_URI ?? "").trim() && !reportUri) {
    console.warn("[security-headers] CSP_REPORT_URI is not a plain https URL; sending no report directives.");
  }
  const artifactPolicy = buildArtifactPolicy(reportUri);
  let appPolicy: string | null = null;
  let fallback: string | null = null;
  let lookedAt = 0;
  let warnedMissing = false;

  const policyForApp = (): string => {
    if (appPolicy) return appPolicy;
    const now = Date.now();
    if (fallback && now - lookedAt < 30_000) return fallback;
    lookedAt = now;
    let html: string | null = null;
    try {
      html = fs.readFileSync(opts.shellPath, "utf8");
    } catch {
      html = null;
    }
    const built = buildAppPolicy({
      scriptHashes: html ? inlineScriptHashes(html) : [],
      analyticsOrigin: html ? analyticsOriginOf(html) : null,
      reportUri,
    });
    if (html) appPolicy = built;
    else {
      fallback = built;
      // In production a missing shell means the path here and `staticPath`
      // in server/index.ts have come apart, and the shell's inline script is
      // being refused on every page. Say so once, naming the file.
      if (!warnedMissing && env.NODE_ENV === "production") {
        warnedMissing = true;
        console.warn(`[security-headers] no shell at ${opts.shellPath}; its inline scripts get no hash and will be refused.`);
      }
    }
    return built;
  };

  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader("Origin-Agent-Cluster", "?1");
    if (API_PATH.test(req.path)) res.setHeader("Cache-Control", API_DEFAULT_CACHE);
    const policy = ARTIFACT_PATH.test(req.path)
      ? artifactPolicy
      : UPLOADED_PDF_PATH.test(req.path)
        ? ALWAYS_ENFORCED
        : policyForApp();
    if (mode === "enforce") {
      res.setHeader("Content-Security-Policy", policy);
    } else {
      res.setHeader("Content-Security-Policy", ALWAYS_ENFORCED);
      if (policy !== ALWAYS_ENFORCED) res.setHeader("Content-Security-Policy-Report-Only", policy);
    }
    if (reportUri) res.setHeader("Reporting-Endpoints", `csp="${reportUri}"`);
    next();
  };
}
