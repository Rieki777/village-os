/**
 * The nightly rehearsal: five made-up people walk the whole joining path
 * against a freshly booted build on a scratch database, at 390 and at 1280,
 * with screenshots, captured emails and a stub AI endpoint, and the summary
 * flags anything that changed since the last run. docs/REHEARSAL.md is the
 * guide.
 *
 *   pnpm build
 *   REHEARSAL_DEPS=<folder with playwright and axe-core> node --import tsx scripts/rehearsal/run.mjs
 *
 * Options:
 *   --out <dir>            where runs are written (default .rehearsal)
 *   --baseline <dir>       the previous run's shots (default: the latest run in <out>/runs)
 *   --save-baseline <dir>  copy this run's shots there when every act passed
 *   --only a,b             walk only these personas (ids in personas.mjs)
 *   --width 390|1280       walk only one width
 *   --keep                 leave the server up after the walks, for looking around
 *
 * Environment:
 *   REHEARSAL_DB_SERVER    mysql://user:pass@127.0.0.1:3306 (default: the CI test MySQL)
 *   REHEARSAL_SCHEMA       scratch schema, must start with village_rehearsal
 *   REHEARSAL_PORT         the server's port (default 5871)
 *   REHEARSAL_BASE_URL     the address the browsers use (default http://localhost:<port>);
 *                          refused unless it is loopback
 *
 * It never touches production: the base URL must be loopback, the database a
 * loopback scratch schema with the rehearsal prefix, mail goes to a fake and the
 * AI endpoint is a stub. Exit code: 0 when every act passed, 1 when any act
 * failed, 2 when the rehearsal itself could not start.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import { assertLocalBase, assertScratchDb, SCRATCH_PREFIX } from "./guard.mjs";
import { startMail, startAiStub, MAIL_KEY } from "./stubs.mjs";
import { seedVillage } from "./seed.mjs";
import { loadBrowserDeps, Walk } from "./page.mjs";
import { PERSONAS } from "./personas.mjs";
import { buildSummary, compareShots, summaryMarkdown } from "./report.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const OUT = path.resolve(opt("out", path.join(ROOT, ".rehearsal")));
const PORT = Number(process.env.REHEARSAL_PORT || 5871);
const BASE = process.env.REHEARSAL_BASE_URL || `http://localhost:${PORT}`;
const DB_SERVER = process.env.REHEARSAL_DB_SERVER || "mysql://root:ci-test@127.0.0.1:3306";
const SCHEMA = process.env.REHEARSAL_SCHEMA || SCRATCH_PREFIX;
const ADMIN_PASSWORD = "rehearsal-admin-not-real";
const WIDTHS = { 390: "phone", 1280: "desktop" };

function log(...m) {
  console.log("[rehearsal]", ...m);
}

function latestRun(runsDir, except) {
  if (!fs.existsSync(runsDir)) return null;
  const runs = fs.readdirSync(runsDir).filter((d) => d !== except && fs.existsSync(path.join(runsDir, d, "summary.json"))).sort();
  return runs.length ? path.join(runsDir, runs[runs.length - 1], "shots") : null;
}

async function waitForHealth(child) {
  const until = Date.now() + 180_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`the server exited with ${child.exitCode} before it answered; read server.log`);
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return r.json().catch(() => ({}));
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("the server did not answer /health within three minutes; read server.log");
}

async function main() {
  assertLocalBase(BASE);
  assertScratchDb(DB_SERVER, SCHEMA);
  const dist = path.join(ROOT, "dist", "index.js");
  if (!fs.existsSync(dist)) throw new Error("no dist/index.js: run pnpm build first");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(OUT, "runs", stamp);
  const shotsDir = path.join(runDir, "shots");
  fs.mkdirSync(shotsDir, { recursive: true });
  const baseline = opt("baseline") ? path.resolve(opt("baseline")) : latestRun(path.join(OUT, "runs"), stamp);
  log(`run ${runDir}`);
  log(`baseline ${baseline ?? "(none)"}`);

  const admin = await mysql.createConnection(`${DB_SERVER}/mysql`);
  await admin.query(`DROP DATABASE IF EXISTS \`${SCHEMA}\``);
  await admin.query(`CREATE DATABASE \`${SCHEMA}\``);
  await admin.end();

  const mail = await startMail();
  const ai = await startAiStub(0);
  const dataDir = path.join(runDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const serverLog = fs.createWriteStream(path.join(runDir, "server.log"));
  const child = spawn(process.execPath, [dist], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: `${DB_SERVER}/${SCHEMA}`,
      ADMIN_PASSWORD,
      AUTH_TOKEN_SECRET: "rehearsal-token-secret-not-real",
      FRONTEND_URL: BASE,
      TRUSTED_PROXY_HOPS: "1",
      RESEND_API_BASE: mail.url,
      RESEND_API_KEY: MAIL_KEY,
      EMAIL_FROM: "Example Village <hello@village.example.test>",
      ANTHROPIC_API_KEY: "sk-rehearsal-stub",
      ANTHROPIC_BASE_URL: ai.url,
      FOUNDER_EMAILS: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      STRIPE_SECRET_KEY: "",
      FEEDBACK_HUB_URL: "",
      ERROR_WEBHOOK_URL: "",
    },
  });
  child.stdout.pipe(serverLog);
  child.stderr.pipe(serverLog);
  const stop = async () => {
    if (child.exitCode === null) child.kill();
    await mail.close().catch(() => {});
    await ai.close().catch(() => {});
  };
  process.on("SIGINT", () => void stop().then(() => process.exit(130)));

  const started = Date.now();
  let summary;
  try {
    const health = await waitForHealth(child);
    log(`server up, build ${health?.build ?? health?.marker ?? "?"}`);
    const seed = await seedVillage({ base: BASE, dbUrl: `${DB_SERVER}/${SCHEMA}`, adminPassword: ADMIN_PASSWORD, log });

    const { chromium, axeSource } = await loadBrowserDeps();
    const browser = await chromium.launch();
    const only = opt("only") ? opt("only").split(",") : null;
    const widths = opt("width") ? [WIDTHS[opt("width")]] : ["phone", "desktop"];
    const ctx = { base: BASE, mail, seed, carry: {} };
    const walks = [];
    let ip = 0;
    for (const vp of widths) {
      for (const p of PERSONAS) {
        if (only && !only.includes(p.id)) continue;
        ip++;
        const w = new Walk({ browser, axeSource, persona: p.id, vp, shotsDir, base: BASE, locale: p.locale, token: p.member ? p.member(seed, vp) : null, ip: `10.77.${ip}.1` });
        log(`walk ${p.id} at ${vp}`);
        await p.run(w, ctx).catch((e) => w.steps.push({ name: "walk", ok: false, error: String(e?.message ?? e).slice(0, 300) }));
        const done = await w.finish();
        const passed = done.steps.filter((s) => s.ok).length;
        log(`  ${passed}/${done.steps.length} acts`);
        walks.push(done);
      }
    }
    await browser.close();

    fs.writeFileSync(path.join(runDir, "emails.json"), JSON.stringify(mail.emails().map((e) => e.body), null, 1));
    fs.writeFileSync(path.join(runDir, "ai-calls.json"), JSON.stringify(ai.calls(), null, 1));
    fs.writeFileSync(path.join(runDir, "walks.json"), JSON.stringify(walks, null, 1));
    const visual = compareShots(shotsDir, baseline, path.join(runDir, "diff"));
    summary = buildSummary({
      walks,
      emails: mail.emails(),
      aiCalls: ai.calls(),
      visual,
      meta: { startedAt: new Date(started).toISOString(), seconds: (Date.now() - started) / 1000, build: health?.build ?? health?.marker ?? null, base: BASE },
    });
    fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 1));
    const md = summaryMarkdown(summary);
    fs.writeFileSync(path.join(runDir, "summary.md"), md);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "latest.txt"), runDir + "\n");
    console.log("\n" + md);

    const saveTo = opt("save-baseline");
    if (saveTo && !summary.ok) log(`not saving a baseline: someone was stopped, so the last complete run stays the one to compare with`);
    if (saveTo && summary.ok) {
      fs.rmSync(saveTo, { recursive: true, force: true });
      fs.cpSync(shotsDir, saveTo, { recursive: true });
      log(`shots saved as the next baseline in ${saveTo}`);
    }
    if (flag("keep")) {
      log(`server left up at ${BASE}; founder token in ${path.join(runDir, "seed.json")}. Ctrl-C to stop.`);
      fs.writeFileSync(path.join(runDir, "seed.json"), JSON.stringify(seed, null, 1));
      await new Promise(() => {});
    }
  } finally {
    await stop();
  }
  return summary.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("[rehearsal] could not run:", e?.message ?? e);
    process.exit(2);
  },
);
