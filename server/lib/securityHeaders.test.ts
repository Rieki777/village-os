import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { shellWithTheme } from "../routes/brandTheme";
import {
  ALWAYS_ENFORCED,
  ARTIFACT_PATH,
  CLOUDFLARE_BEACON_CONNECT,
  CLOUDFLARE_BEACON_SCRIPT,
  UPLOADED_PDF_PATH,
  analyticsOriginOf,
  buildAppPolicy,
  buildArtifactPolicy,
  cspModeOf,
  inlineScriptHashes,
  reportUriOf,
  securityHeaders,
} from "./securityHeaders";

/**
 * The header block's contract: every response carries the headers; every
 * page outside the map artifact gets a script policy with no 'unsafe-inline'
 * and no 'unsafe-eval'; the shell's own inline script is allowed by a hash
 * computed from the very file the SPA fallback sends; and the artifact
 * exemption covers exactly the two URLs that serve it.
 *
 * What these tests cannot see is a browser. The production sweep with this
 * policy injected (every signed-out route, desktop and 390px, with a planted
 * inline script, inline handler and foreign script that it must refuse) is
 * what proves no page loses a feature; see the sec-headers report.
 */

const TEMPLATE = fs.readFileSync(path.resolve(__dirname, "..", "..", "client", "index.html"), "utf8");

/** The value of one directive, split into its sources. */
function directive(policy: string, name: string): string[] | null {
  for (const part of policy.split(";")) {
    const [key, ...sources] = part.trim().split(/\s+/);
    if (key === name) return sources;
  }
  return null;
}

describe("inline script hashes", () => {
  it("hashes inline scripts the way the CSP spec does (a known answer)", () => {
    // sha256("alert(1)"), checked against two independent implementations.
    expect(inlineScriptHashes("<p><script>alert(1)</script></p>")).toEqual(["'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='"]);
  });

  it("skips scripts that load from a src, which are governed by origin", () => {
    expect(inlineScriptHashes('<script type="module" crossorigin src="/assets/index-x.js"></script>')).toEqual([]);
    expect(inlineScriptHashes("<script\n  src='/a.js'></script><script>alert(1)</script>")).toHaveLength(1);
  });

  it("hashes CRLF text as the parser hands it to the browser, which is LF", () => {
    const lf = inlineScriptHashes("<script>\n  var a = 1;\n</script>");
    expect(inlineScriptHashes("<script>\r\n  var a = 1;\r\n</script>")).toEqual(lf);
    expect(inlineScriptHashes("<script>\r  var a = 1;\r</script>")).toEqual(lf);
  });

  it("finds the shell's analytics loader in client/index.html", () => {
    expect(inlineScriptHashes(TEMPLATE).length).toBeGreaterThan(0);
  });

  it("keeps every hash valid through the theme splice the SPA fallback applies", () => {
    const policy = buildAppPolicy({ scriptHashes: inlineScriptHashes(TEMPLATE) });
    const served = shellWithTheme(TEMPLATE, () => ({ theme: { fontBody: "Inter, sans-serif" } }));
    expect(served, "the splice must have run for this to prove anything").not.toBe(TEMPLATE);
    const allowed = directive(policy, "script-src")!;
    for (const h of inlineScriptHashes(served)) expect(allowed).toContain(h);
  });
});

describe("the analytics loader's origin", () => {
  it("is nothing while the build left the placeholders, which is what production ships", () => {
    expect(TEMPLATE).toContain("%VITE_ANALYTICS_ENDPOINT%");
    expect(analyticsOriginOf(TEMPLATE)).toBeNull();
  });

  it("is nothing for a blank build and for anything that is not http(s)", () => {
    expect(analyticsOriginOf('var endpoint = "";')).toBeNull();
    expect(analyticsOriginOf('var endpoint = "javascript:alert(1)";')).toBeNull();
    expect(analyticsOriginOf('var endpoint = "not a url";')).toBeNull();
  });

  it("is the endpoint's origin when a build filled one in", () => {
    const filled = TEMPLATE.replace("%VITE_ANALYTICS_ENDPOINT%", "https://stats.example.org/u").replace("%VITE_ANALYTICS_WEBSITE_ID%", "abc");
    expect(analyticsOriginOf(filled)).toBe("https://stats.example.org");
  });

  it("still reads the loader's declaration in client/index.html (a tripwire for whoever edits it)", () => {
    if (/umami/.test(TEMPLATE)) expect(TEMPLATE).toMatch(/var\s+endpoint\s*=\s*"[^"]*"/);
  });
});

describe("the app policy", () => {
  const policy = buildAppPolicy({ scriptHashes: ["'sha256-abc='"], analyticsOrigin: "https://stats.example.org" });

  it("lets no inline or evaluated script run, and names every script source it allows", () => {
    const script = directive(policy, "script-src")!;
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain("'strict-dynamic'");
    expect(script.filter((s) => !s.startsWith("'sha256-"))).toEqual(["'self'", CLOUDFLARE_BEACON_SCRIPT, "https://stats.example.org"]);
    expect(directive(policy, "script-src-attr")).toBeNull();
    expect(directive(policy, "script-src-elem")).toBeNull();
  });

  it("allows a scheme-wide source nowhere a script could come from", () => {
    for (const name of ["default-src", "script-src", "connect-src", "frame-src", "worker-src", "object-src", "base-uri", "form-action", "frame-ancestors"]) {
      const sources = directive(policy, name)!;
      expect(sources, name).toBeTruthy();
      expect(sources.some((s) => s === "https:" || s === "http:" || s === "*" || s === "data:" || s === "blob:"), name).toBe(false);
    }
  });

  it("closes the plugin, base and framing doors", () => {
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'self'"]);
    expect(directive(policy, "frame-ancestors")).toEqual(["'self'"]);
    expect(directive(policy, "connect-src")).toEqual(["'self'", CLOUDFLARE_BEACON_CONNECT, "https://stats.example.org"]);
  });

  it("asks for no reports unless an operator named where they go", () => {
    expect(policy).not.toMatch(/report-/);
    const reporting = buildAppPolicy({ scriptHashes: [], reportUri: "https://csp.example.org/r" });
    expect(directive(reporting, "report-uri")).toEqual(["https://csp.example.org/r"]);
    expect(directive(reporting, "report-to")).toEqual(["csp"]);
  });
});

describe("the artifact exemption", () => {
  it("covers the two URLs that serve the map, as case-blind as Express routing", () => {
    for (const p of ["/grounds/index.html", "/grounds/grounds-0a1b2c3d4e5f.html", "/GROUNDS/INDEX.HTML", "/grounds/index.html/"]) {
      expect(ARTIFACT_PATH.test(p), p).toBe(true);
    }
  });

  it("covers nothing else under /grounds/, where the SPA shell answers", () => {
    for (const p of ["/grounds", "/grounds/", "/grounds/x", "/grounds/foo.html", "/grounds/manifest.json", "/grounds/index.html.x", "/grounds/grounds-.html", "/grounds/grounds-a.b.html", "/x/grounds/index.html", "/map"]) {
      expect(ARTIFACT_PATH.test(p), p).toBe(false);
    }
  });

  it("keeps the map's framing rule and adds only what the artifact measurably never uses", () => {
    const a = buildArtifactPolicy();
    expect(a).toBe("frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
    expect(directive(a, "script-src")).toBeNull();
    expect(directive(a, "default-src")).toBeNull();
  });
});

describe("the uploaded-PDF exemption", () => {
  it("covers a PDF the uploads route serves inline", () => {
    for (const p of ["/api/uploads/1700000000-ab12.pdf", "/api/uploads/Deck.PDF"]) expect(UPLOADED_PDF_PATH.test(p), p).toBe(true);
  });

  it("covers no path the SPA shell answers, whatever it ends in", () => {
    for (const p of ["/quests.pdf", "/uploads/a.pdf", "/x/api/uploads/a.pdf", "/api/uploads/a.pdf/x", "/api/uploads/a/b.pdf", "/api/uploads/a.pdf.html"]) {
      expect(UPLOADED_PDF_PATH.test(p), p).toBe(false);
    }
  });
});

describe("operator levers", () => {
  it("enforces unless report-only is asked for by name", () => {
    expect(cspModeOf(undefined)).toBe("enforce");
    expect(cspModeOf("")).toBe("enforce");
    expect(cspModeOf("reportonly")).toBe("enforce");
    expect(cspModeOf(" Report-Only ")).toBe("report-only");
  });

  it("takes a report address only when it is a plain https URL", () => {
    expect(reportUriOf("https://csp.example.org/r?x=1")).toBe("https://csp.example.org/r?x=1");
    for (const bad of ["", "http://csp.example.org/r", "https://a.example/r; script-src *", 'https://a.example/"x', "https://a.example/r, b", "not a url"]) {
      expect(reportUriOf(bad), bad).toBeNull();
    }
  });
});

describe("the middleware, on a real server", () => {
  let dir = "";
  let shellPath = "";
  const servers: http.Server[] = [];

  async function boot(env: NodeJS.ProcessEnv, shell: string | null = shellPath): Promise<string> {
    const app = express();
    app.use(securityHeaders({ shellPath: shell ?? path.join(dir, "absent.html"), env }));
    app.use("/assets", express.static(path.join(dir, "assets")));
    app.get("/api/thing", (_req, res) => res.json({ ok: true }));
    app.get("/api/public.json", (_req, res) => {
      res.header("Cache-Control", "public, max-age=300");
      res.json({ public: true });
    });
    app.get("/api/uploads/:filename", (_req, res) => res.type("application/pdf").send(Buffer.from("%PDF-1.4")));
    app.get("/api/boom", () => {
      throw new Error("boom");
    });
    app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));
    app.get("/grounds/index.html", (_req, res) => res.type("html").send("<script>window.map = 1</script>"));
    app.get("/{*splat}", (_req, res) => res.type("html").send(shellWithTheme(fs.readFileSync(shellPath, "utf8"), () => null)));
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void err;
      res.status(500).json({ error: "server_error" });
    });
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sechdr-"));
    shellPath = path.join(dir, "index.html");
    fs.writeFileSync(shellPath, TEMPLATE.replace(/\n/g, "\r\n"));
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "assets", "x.js"), "export {};");
  });

  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("puts the whole set on every kind of response: page, deep route, JSON, asset, 404 and error", async () => {
    const base = await boot({});
    const shellHashes = inlineScriptHashes(fs.readFileSync(shellPath, "utf8"));
    expect(shellHashes.length).toBeGreaterThan(0);
    for (const [p, status] of [["/", 200], ["/quests/some/deep/route", 200], ["/api/thing", 200], ["/assets/x.js", 200], ["/api/nothing", 404], ["/api/boom", 500], ["/grounds/x", 200]] as const) {
      const r = await fetch(base + p);
      expect(r.status, p).toBe(status);
      const csp = r.headers.get("content-security-policy") ?? "";
      expect(directive(csp, "script-src"), p).toEqual(["'self'", ...shellHashes, CLOUDFLARE_BEACON_SCRIPT]);
      expect(r.headers.get("content-security-policy-report-only"), p).toBeNull();
      expect(r.headers.get("x-frame-options"), p).toBe("SAMEORIGIN");
      expect(r.headers.get("x-content-type-options"), p).toBe("nosniff");
      expect(r.headers.get("referrer-policy"), p).toBe("strict-origin-when-cross-origin");
      expect(r.headers.get("permissions-policy"), p).toBe("camera=(), microphone=(self), geolocation=()");
      expect(r.headers.get("cross-origin-opener-policy"), p).toBe("same-origin");
      expect(r.headers.get("x-permitted-cross-domain-policies"), p).toBe("none");
      expect(r.headers.get("origin-agent-cluster"), p).toBe("?1");
      expect(r.headers.get("reporting-endpoints"), p).toBeNull();
    }
  });

  it("keeps API answers out of shared caches by default, and lets a route that sets its own rule win", async () => {
    const base = await boot({});
    expect((await fetch(base + "/api/thing")).headers.get("cache-control")).toBe("private, no-cache");
    expect((await fetch(base + "/api/nothing")).headers.get("cache-control")).toBe("private, no-cache");
    expect((await fetch(base + "/api/public.json")).headers.get("cache-control")).toBe("public, max-age=300");
    expect((await fetch(base + "/")).headers.get("cache-control"), "pages are the SPA fallback's to decide").not.toBe("private, no-cache");
    expect((await fetch(base + "/assets/x.js")).headers.get("cache-control")).not.toBe("private, no-cache");
  });

  it("allows exactly the inline scripts of the page it sends, and the page sends CRLF on disk", async () => {
    const base = await boot({});
    const r = await fetch(base + "/");
    const body = await r.text();
    expect(body).toContain("?v=");
    const allowed = directive(r.headers.get("content-security-policy")!, "script-src")!;
    const sent = inlineScriptHashes(body);
    expect(sent.length).toBeGreaterThan(0);
    for (const h of sent) expect(allowed).toContain(h);
  });

  it("keeps an uploaded PDF on the framing rule alone, in both modes, and the SPA on the full policy", async () => {
    for (const mode of ["", "report-only"]) {
      const base = await boot({ CSP_MODE: mode });
      const pdf = await fetch(base + "/api/uploads/1700000000-ab12.pdf");
      expect(pdf.headers.get("content-type"), mode).toContain("application/pdf");
      expect(pdf.headers.get("content-security-policy"), mode).toBe(ALWAYS_ENFORCED);
      expect(pdf.headers.get("content-security-policy-report-only"), mode).toBeNull();
      expect(pdf.headers.get("x-frame-options"), mode).toBe("SAMEORIGIN");
    }
    const base = await boot({});
    const spa = await fetch(base + "/quests.pdf");
    expect(spa.headers.get("content-type")).toContain("text/html");
    expect(directive(spa.headers.get("content-security-policy")!, "script-src")).not.toBeNull();
  });

  it("gives the map artifact its own policy, and nothing else under /grounds/", async () => {
    const base = await boot({});
    const map = await fetch(base + "/grounds/index.html");
    expect(map.headers.get("content-security-policy")).toBe(buildArtifactPolicy());
    const shell = await fetch(base + "/grounds/x");
    expect(directive(shell.headers.get("content-security-policy")!, "script-src")).not.toBeNull();
  });

  it("in report-only mode enforces nothing new, and keeps the framing rule enforced", async () => {
    const base = await boot({ CSP_MODE: "report-only" });
    const r = await fetch(base + "/");
    expect(r.headers.get("content-security-policy")).toBe(ALWAYS_ENFORCED);
    expect(directive(r.headers.get("content-security-policy-report-only")!, "script-src")).toContain("'self'");
    const map = await fetch(base + "/grounds/index.html");
    expect(map.headers.get("content-security-policy")).toBe(ALWAYS_ENFORCED);
    expect(map.headers.get("content-security-policy-report-only")).toBe(buildArtifactPolicy());
  });

  it("names the report endpoint when one is configured, on the page and the artifact", async () => {
    const base = await boot({ CSP_REPORT_URI: "https://csp.example.org/r" });
    for (const p of ["/", "/grounds/index.html"]) {
      const r = await fetch(base + p);
      expect(r.headers.get("reporting-endpoints"), p).toBe('csp="https://csp.example.org/r"');
      expect(directive(r.headers.get("content-security-policy")!, "report-uri"), p).toEqual(["https://csp.example.org/r"]);
    }
  });

  it("serves a policy with no hashes, rather than failing, when there is no built shell", async () => {
    const base = await boot({}, path.join(dir, "absent.html"));
    const r = await fetch(base + "/api/thing");
    expect(r.status).toBe(200);
    expect(directive(r.headers.get("content-security-policy")!, "script-src")).toEqual(["'self'", CLOUDFLARE_BEACON_SCRIPT]);
  });

  it("says once, in production, that the shell is missing, since every page then refuses its inline script", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const base = await boot({ NODE_ENV: "production" }, path.join(dir, "absent.html"));
      await fetch(base + "/");
      await fetch(base + "/api/thing");
      const lines = warned.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[security-headers]"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("absent.html");
    } finally {
      warned.mockRestore();
    }
  });
});
