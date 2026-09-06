#!/usr/bin/env node
/**
 * Self-test for `scripts/dependency-audit.mjs`.
 *
 * THE PROPERTY THIS EXISTS FOR: the gate was changed so that an unreachable
 * registry no longer blocks a merge. The whole risk of that change is that it
 * stops blocking on FINDINGS too, and a security gate that silently passes
 * everything looks exactly like one that is working. So the first case below is
 * the one that matters: a high advisory must still exit 1.
 *
 * It tests the REAL script rather than an extracted function, by pointing
 * `npm_config_registry` at a local server that answers the audit endpoint with
 * a canned document. That way the parsing, the severity arithmetic and the exit
 * code are all the shipped ones.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";

const SCRIPT = path.resolve(import.meta.dirname, "dependency-audit.mjs");
let failures = 0;

function serve(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve({ server: s, port: s.address().port }));
  });
}

function runGate(registry) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, npm_config_registry: registry },
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
    failures += 1;
  }
}

const auditBody = (doc) => (req, res) => {
  if (!req.url.includes("/-/npm/v1/security/audits")) {
    res.writeHead(404).end("{}");
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(doc));
};

console.log("dependency-audit.mjs");

// 1. A high advisory still blocks. THE case.
{
  const { server, port } = await serve(
    auditBody({
      actions: [],
      advisories: {
        "1": {
          module_name: "left-pad",
          severity: "high",
          title: "Prototype pollution",
          patched_versions: ">=1.3.1",
          url: "https://example.invalid/advisory/1",
        },
      },
      muted: [],
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
    }),
  );
  const { code, out } = await runGate(`http://127.0.0.1:${port}/`);
  server.close();
  check("a high advisory exits 1", code === 1, `exit was ${code}`);
  check("it names the package", out.includes("left-pad"));
  check("it does not claim to be clean", !out.includes("clean at high and above"));
}

// 2. A critical advisory blocks too.
{
  const { server, port } = await serve(
    auditBody({
      advisories: { "2": { module_name: "evil", severity: "critical", title: "RCE" } },
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 1 } },
    }),
  );
  const { code } = await runGate(`http://127.0.0.1:${port}/`);
  server.close();
  check("a critical advisory exits 1", code === 1, `exit was ${code}`);
}

// 3. Moderate and below do NOT block, which is what --audit-level high meant.
{
  const { server, port } = await serve(
    auditBody({
      advisories: { "3": { module_name: "meh", severity: "moderate", title: "Minor" } },
      metadata: { vulnerabilities: { info: 1, low: 2, moderate: 3, high: 0, critical: 0 } },
    }),
  );
  const { code, out } = await runGate(`http://127.0.0.1:${port}/`);
  server.close();
  check("moderate and below exit 0", code === 0, `exit was ${code}`);
  check("the counts are still reported", out.includes("3 moderate"));
}

// 4. A clean tree passes and says so.
{
  const { server, port } = await serve(
    auditBody({ advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } }),
  );
  const { code, out } = await runGate(`http://127.0.0.1:${port}/`);
  server.close();
  check("a clean tree exits 0", code === 0, `exit was ${code}`);
  check("it says it was clean", out.includes("clean at high and above"));
}

// 5. An unreachable registry warns and passes, and is HONEST that it did not audit.
{
  // Port 9 is discard; nothing listens, so the connection is refused at once.
  const { code, out } = await runGate("http://127.0.0.1:9/");
  check("an unreachable registry exits 0", code === 0, `exit was ${code}`);
  check("it says the audit could not run", out.includes("COULD NOT RUN"));
  check("it refuses to call that clean", !out.includes("clean at high and above"));
  check("it retried before giving up", out.includes("attempt 3 of 3"));
}

if (failures) {
  console.error(`\nFAIL -- ${failures} check(s) failed in dependency-audit.test.mjs\n`);
  process.exit(1);
}
console.log("  PASS");
