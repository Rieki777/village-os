#!/usr/bin/env node
/**
 * The guard's own guard: the real script, real exit codes, scratch trees.
 *
 * check-import-casing.mjs exists because main at 5e4f5f0 shipped
 * `AdminFeel.tsx` beside `adminFeel.ts` (and `AdminQueueState.tsx` beside
 * `adminQueueState.ts`), which build on Linux and break every Windows box. A
 * check that lower-cases whole paths finds nothing in that tree, because the
 * extensions differ, so the first scenario below is that exact pair: if the
 * guard ever regresses to the naive scan, it goes vacuously green and this
 * file goes red.
 *
 * Run: node scripts/check-import-casing.test.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "check-import-casing.mjs");

let failures = 0;
let assertions = 0;
const check = (name, ok, detail = "") => {
  assertions += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
};

/** A scratch tree from { "client/src/a.ts": "body" }. */
function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "import-casing-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

function run(root) {
  const args = [SCRIPT, "--json", ...(root ? ["--root", root] : [])];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", shell: false });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* the assertion on status says why */
  }
  return { status: r.status, json, stderr: r.stderr };
}

function scenario(name, files, fn) {
  const root = tree(files);
  try {
    fn(run(root));
  } catch (err) {
    check(`${name}: threw`, false, String(err?.stack ?? err));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("check-import-casing: the guard's own regression test\n");

// ── 1. THE CONTROL: the 5 Nov pair, reintroduced ────────────────────────────
scenario(
  "the AdminFeel pair",
  {
    "client/src/components/admin/AdminFeel.tsx": 'import { simpleNav } from "./adminFeel";\nexport const TourCard = () => simpleNav;\n',
    "client/src/components/admin/adminFeel.ts": "export const simpleNav = 1;\n",
    "client/src/components/admin/AdminHelp.tsx": 'import { TourCard } from "./AdminFeel";\nexport default TourCard;\n',
  },
  (r) => {
    check("a .tsx and a .ts whose names differ only by case FAIL the run", r.status === 1, `status ${r.status}`);
    check(
      "the pair is named as one fault",
      r.json?.faults?.some((f) => f.kind === "stem" && f.files.join(",") === "AdminFeel.tsx,adminFeel.ts"),
      JSON.stringify(r.json?.faults),
    );
    check(
      "and the import Windows resolves to the wrong file is named too",
      r.json?.faults?.some((f) => f.kind === "spelling" && f.at.endsWith("AdminHelp.tsx") && f.spec === "./AdminFeel"),
      JSON.stringify(r.json?.faults),
    );
  },
);

// ── 2. The same pair once one side is renamed: green ────────────────────────
scenario(
  "the pair renamed",
  {
    "client/src/components/admin/AdminFeel.tsx": 'import { simpleNav } from "./adminFeelState";\nexport const TourCard = () => simpleNav;\n',
    "client/src/components/admin/adminFeelState.ts": "export const simpleNav = 1;\n",
    "client/src/components/admin/AdminHelp.tsx": 'import { TourCard } from "./AdminFeel";\nimport x from "@/components/admin/AdminFeel";\nexport default TourCard;\n',
  },
  (r) => check("renaming one side clears it", r.status === 0 && r.json?.faults?.length === 0, JSON.stringify(r.json?.faults)),
);

// ── 3. A test file pair collides on its own ─────────────────────────────────
scenario(
  "two test files",
  {
    "client/src/q/AdminQueueState.test.tsx": "export {};\n",
    "client/src/q/adminQueueState.test.ts": "export {};\n",
  },
  (r) => check("AdminQueueState.test.tsx beside adminQueueState.test.ts fails", r.status === 1, JSON.stringify(r.json?.faults)),
);

// ── 4. What is NOT a collision ──────────────────────────────────────────────
scenario(
  "harmless neighbours",
  {
    "client/src/s/CardInvite.tsx": "export const A = 1;\n",
    "client/src/s/cardInvite.test.tsx": 'import { A } from "./CardInvite";\n',
    "client/src/s/adminNight.ts": 'import "./adminNight.css";\n',
    "client/src/s/adminNight.css": "a{}\n",
    "client/src/Map.tsx": "export {};\n",
    "client/src/map/MapSlate.tsx": 'import "../Map";\n',
    "server/x.ts": 'import fs from "node:fs";\nimport y from "./missing-on-purpose";\n',
  },
  (r) =>
    check(
      "a component beside its lower-case test, a stylesheet beside its module, a folder with no index, and an unresolvable import all pass",
      r.status === 0 && r.json?.faults?.length === 0,
      JSON.stringify(r.json?.faults),
    ),
);

// ── 5. A misspelled import with no twin on disk ─────────────────────────────
scenario(
  "one file, wrong case",
  {
    "shared/tokenScale.ts": "export const s = 1;\n",
    // Split so this file's own text never holds the misspelled specifiers: the guard reads every
    // string in scripts/, and scenario 7 runs it on this repository.
    "server/a.ts": 'import { s } from "../shared/' + 'TokenScale";\nimport t from "@shared/' + 'tokenscale";\n',
  },
  (r) => {
    check("an import spelled in another case fails", r.status === 1);
    check("both spellings are named, relative and alias", r.json?.faults?.filter((f) => f.kind === "spelling").length === 2, JSON.stringify(r.json?.faults));
  },
);

// ── 6. A folder index ───────────────────────────────────────────────────────
scenario(
  "folder index",
  {
    "client/src/widgets/index.ts": "export {};\n",
    "client/src/Widgets.tsx": "export {};\n",
  },
  (r) => check("a folder with an index beside a file of the same name in another case fails", r.status === 1, JSON.stringify(r.json?.faults)),
);

// ── 7. This repository ──────────────────────────────────────────────────────
{
  const r = run(null);
  check("this repository is clean", r.status === 0 && r.json?.faults?.length === 0, JSON.stringify(r.json?.faults));
  check("and it read the tree, not nothing", (r.json?.files ?? 0) > 1000, `files ${r.json?.files}`);
}

console.log("");
console.log(`${failures === 0 ? "PASS" : "FAIL"}  check-import-casing: ${assertions - failures} of ${assertions} assertion(s) held.`);
process.exit(failures === 0 ? 0 : 1);
