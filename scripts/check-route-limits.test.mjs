/**
 * The route-limit guard's own guard.
 *
 * check-route-limits.mjs excuses a route when it calls a helper whose body can
 * answer 401/403 (a guard) or is bounded. Everything therefore rests on where a
 * helper's body ENDS. Until 2026-09-14 it ended at the next declaration found
 * anywhere in the file, so `const reply = (r) => res.json(r);`, a one-line
 * helper inside `POST /api/map/promise`, borrowed a `status(401)` from code
 * written after it and excused every route in server/index.ts that called
 * `reply(`. Inserting an unrelated one-line helper elsewhere changed the answer.
 *
 * These cases pin both directions of the span rule: a short helper does not
 * borrow what follows it, and a real guard is not cut short by what it holds.
 * Each spawns the REAL script against a scratch tree via ROUTE_LIMITS_ROOT.
 *
 * Run: node scripts/check-route-limits.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT = fileURLToPath(new URL("./check-route-limits.mjs", import.meta.url));
let run = 0;
const failures = [];
// Every case runs even after one fails, so a broken span rule names ALL the
// controls it breaks, not only the first.
const check = (name, fn) => {
  run += 1;
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${String(e.message).split("\n").join("\n        ")}`);
  }
};

/** A scratch repo root holding the given server files. */
function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "route-limits-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

const gate = (root) =>
  spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, ROUTE_LIMITS_ROOT: root },
  });

/** The `VERB /url` pairs the gate reported as unbounded public routes. */
const reported = (r) =>
  [...r.stderr.matchAll(/^\s+(GET|POST|PUT|PATCH|DELETE) (\S+)\s+\(/gm)].map((m) => `${m[1]} ${m[2]}`);

console.log("check-route-limits.mjs");

check("a short arrow helper with no refusal of its own is NOT a guard, even when a refusing function follows it", () => {
  const root = tree({
    "server/index.ts": `
app.post("/api/open", async (req, res) => {
  const reply = (r: unknown) => res.json(r);
  return reply({ ok: true });
});

// Written over three lines, so it is not read as a declaration of its own,
// and a span running to the next declaration used to reach its 401.
const refuse = (
  res: any,
) => res.status(401).json({ error: "sign in" });

function unrelated() {
  return 1;
}
`,
  });
  const r = gate(root);
  assert.equal(r.status, 1, `the helper borrowed a 401 it does not contain:\n${r.stdout}${r.stderr}`);
  assert.deepEqual(reported(r), ["POST /api/open"]);
});

check("a short arrow helper does not borrow a BOUND that follows it either", () => {
  const root = tree({
    "server/index.ts": `
app.post("/api/signup", async (req, res) => {
  const send = (r: unknown) => res.json(r);
  return send({ ok: true });
});

const throttle = async (
  req: any,
) => overLimit(\`signup:\${req.ip}\`, 5, 60_000);

function unrelated() {
  return 1;
}
`,
  });
  const r = gate(root);
  assert.equal(r.status, 1, `the helper borrowed an overLimit it does not contain:\n${r.stdout}${r.stderr}`);
  assert.deepEqual(reported(r), ["POST /api/signup"]);
});

check("a function whose OWN body refuses IS a guard, past a nested helper, a braced return type and a brace in a string", () => {
  const root = tree({
    "server/index.ts": `
app.post("/api/closed", async (req, res) => {
  const user = await member(req, res);
  if (!user) return;
  res.json({ ok: true });
});

async function member(req: any, res: any): Promise<{ id: string } | null> {
  const label = (u: { id: string }) => \`member \${u.id}\`;
  if (!req.user) {
    res.status(200).json({ note: "}" });
    const nested = () => { return "}"; };
    res.status(401).json({ error: label({ id: "anonymous" }) });
    return null;
  }
  return req.user;
}

function after() {
  return 2;
}
`,
  });
  const r = gate(root);
  assert.equal(r.status, 0, `a real guard stopped counting:\n${r.stdout}${r.stderr}`);
  assert.deepEqual(reported(r), []);
});

check("a block arrow whose own body refuses IS a guard, and a bounded one IS a bounder", () => {
  const root = tree({
    "server/index.ts": `
const standing = async (req: any, res: any): Promise<boolean> => {
  const why = (s: string) => s.trim();
  if (!req.user) {
    res.status(403).json({ error: why(" members only ") });
    return false;
  }
  return true;
};
const limited = async (req: any, res: any) => {
  const key = (ip: string) => \`contact:\${ip}\`;
  if (await overLimit(key(req.ip), 5, 600_000)) {
    res.status(429).json({ error: "slow down" });
    return true;
  }
  return false;
};

app.post("/api/members-only", async (req, res) => {
  if (!(await standing(req, res))) return;
  res.json({ ok: true });
});
app.post("/api/contact", async (req, res) => {
  if (await limited(req, res)) return;
  res.json({ ok: true });
});
`,
  });
  const r = gate(root);
  assert.equal(r.status, 0, `a real guard or bounder stopped counting:\n${r.stdout}${r.stderr}`);
});

check("a declaration inside a comment is not a declaration", () => {
  const root = tree({
    "server/index.ts": `
app.post("/api/write", async (req, res) => {
  that(req);
  res.json({ ok: true });
});
export function gate(req: any, res: any) {
  // What reaches here is handed to a function that refuses, so
  return res.status(401).end();
}
`,
  });
  const r = gate(root);
  assert.equal(r.status, 1, `a comment's "function that" became a guard:\n${r.stdout}${r.stderr}`);
  assert.deepEqual(reported(r), ["POST /api/write"]);
});

check("PER FILE still holds: a refusing helper in one file does not excuse a same-named call in another", () => {
  const root = tree({
    "server/lib/a.ts": `
export function byId(req: any, res: any) {
  return res.status(401).end();
}
`,
    "server/routes/b.ts": `
const byId = (id: string) => id.trim();
r.post("/api/things/:id", async (req, res) => {
  res.json({ id: byId(req.params.id) });
});
`,
  });
  const r = gate(root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(reported(r), ["POST /api/things/:id"]);
});

check("an imported guard and a guard destructured from deps still excuse a route", () => {
  const root = tree({
    "server/lib/auth.ts": `
export const requireMember = async (req: any, res: any) => {
  if (!req.user) { res.status(401).json({ error: "sign in" }); return null; }
  return req.user;
};
export function isAdmin(req: any, res: any) {
  if (!req.admin) return res.sendStatus(403);
  return true;
}
`,
    "server/routes/imported.ts": `
import { requireMember } from "../lib/auth";
r.post("/api/mine", async (req, res) => {
  if (!(await requireMember(req, res))) return;
  res.json({ ok: true });
});
`,
    "server/routes/viaDeps.ts": `
export function register(app: any, deps: any) {
  const { isAdmin, db } = deps;
  app.post("/api/admin/thing", async (req, res) => {
    if (isAdmin(req, res) !== true) return;
    res.json({ ok: true });
  });
}
`,
  });
  const r = gate(root);
  assert.equal(r.status, 0, `import or deps handling regressed:\n${r.stdout}${r.stderr}`);
});

check("a route with NO guard and no bound is still reported, and a same-line waiver still clears it", () => {
  const bare = tree({
    "server/index.ts": `
app.post("/api/walk-log", async (req, res) => {
  res.json({ ok: true });
});
`,
  });
  const r = gate(bare);
  assert.equal(r.status, 1);
  assert.deepEqual(reported(r), ["POST /api/walk-log"]);

  const waived = tree({
    "server/index.ts": `
app.post("/api/walk-log", async (req, res) => { // limit-ok: fixture
  res.json({ ok: true });
});
`,
  });
  const w = gate(waived);
  assert.equal(w.status, 0, w.stdout + w.stderr);
  assert.match(w.stdout, /1 waiver\(s\) in force/);
});

if (failures.length) {
  console.log(`\n  ${failures.length} failure(s) of ${run}: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`\n  ${run} check(s) passed.`);
