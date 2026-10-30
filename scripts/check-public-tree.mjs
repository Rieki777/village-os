/**
 * Nothing private reaches this public repository's tree.
 *
 * WHY THIS IS A GATE. On 2026-10-02 the public tree still carried the fleet
 * ledger, a dozen session prompts and fix lists, the public TCP proxy host of
 * the first village's production database, a Railway deployment id, Railway
 * volume ids, and the full local path to the backup recovery key. None of it
 * was a password, and all of it was a map for somebody looking for one. It was
 * moved to the maintainers' private operations repository the same day. Git
 * history keeps the old copies, so anything that was a live secret in them was
 * rotated, not just deleted; this gate is what stops the next copy arriving.
 *
 * WHAT IT REFUSES, in every file git tracks:
 *
 *   by NAME   the fleet ledger, CLAUDE_CODE_PROMPT_* and FIXES_TO_MAKE_* files,
 *             SESSION_HANDOFF.md, PLAN_TO_A.md, the old foundation upgrade
 *             plan, any .env file other than .env.example, and the two
 *             database-URL dotfiles that have sat untracked in a checkout.
 *   by TEXT   a Railway TCP proxy host (*.proxy.rlwy.net), a Railway-generated
 *             service domain (name-1234.up.railway.app), a Railway id written
 *             next to the word deployment, project, service, environment or
 *             volume, the recovery-key folder or file name, a private key
 *             block, and an absolute path into somebody's home folder
 *             (C:\Users\name\, /c/Users/name/, /Users/name/, /home/name/). The
 *             CI runner's and node's homes are excepted, and so is
 *             /home/claude/, the sandbox the map generators were written in.
 *
 * The maintainers' coordination notes live in ReGen-Civics/village-os-ops, which
 * is private. Put them there, never here.
 *
 * A false positive takes an inline `public-tree-ok: <reason>` on the same line,
 * or an entry in EXEMPT below with its reason. Both are counted and printed.
 *
 * Usage:
 *   node scripts/check-public-tree.mjs           # the gate, over `git ls-files`
 *   node scripts/check-public-tree.mjs --root <dir> --files a,b,c   # for the self-test
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT_DEFAULT = path.resolve(path.dirname(SELF), "..");

/** Files that must not exist in this tree at all. */
export const FORBIDDEN_NAMES = [
  { re: /(^|\/)SEASON2_FLEET_LEDGER\.md$/, why: "the fleet ledger lives in the private operations repository" },
  { re: /(^|\/)CLAUDE_CODE_PROMPT_[^/]*$/, why: "a session prompt, an internal working note" },
  { re: /(^|\/)FIXES_TO_MAKE_[^/]*$/, why: "a fix list, an internal working note" },
  { re: /(^|\/)SESSION_HANDOFF\.md$/, why: "a session handoff, an internal working note" },
  { re: /(^|\/)PLAN_TO_A\.md$/, why: "an internal plan" },
  { re: /(^|\/)AMORA_FOUNDATION_UPGRADE_PLAN\.md$/, why: "an internal plan" }, // brand-ok: a filename this gate refuses
  { re: /(^|\/)\.env(\.(?!example$)[^/]+)?$/, why: "an environment file holds secrets; only .env.example belongs in git" },
  { re: /(^|\/)\.(demo|qa)-db-url$/, why: "a database URL" },
];

/** Text that must not appear in any tracked file. */
export const FORBIDDEN_TEXT = [
  { id: "railway-proxy", re: /\b[a-z0-9-]+\.proxy\.rlwy\.net\b/i, why: "a Railway public TCP proxy host reaches a database from anywhere" },
  { id: "railway-domain", re: /\b[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-z]{4,}\.up\.railway\.app\b/i, why: "a Railway-generated service domain names a real service" },
  {
    id: "railway-id",
    re: /\b(deployment|project|service|environment|volume)\b[^\n]{0,40}?\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    why: "a Railway id names one live deployment, project, service or volume",
  },
  { id: "recovery-key", re: /RECOVERY-KEY|PRIVATE-KEY-KEEP-OFFLINE/, why: "says where the backup recovery key is kept" },
  {
    id: "private-key",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
    why: "a private key",
  },
  {
    id: "home-path",
    re: /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s`'"<>]+[\\/]|\/c\/Users\/[^/\s`'"<>]+\/|(?<![\w.-])\/(?:Users|home)\/(?!runner\/|node\/|claude\/)[a-z][^/\s`'"<>]*\//,
    why: "an absolute path into somebody's home folder names a person and a machine",
  },
];

/** Whole files excused from one rule, each with its reason. */
export const EXEMPT = {
  "scripts/check-public-tree.mjs": { rules: "*", why: "this gate states the patterns it refuses" },
  "scripts/check-public-tree.test.mjs": { rules: "*", why: "the self-test feeds the patterns to the gate" },
  "server/lib/toolcheckLookup.test.ts": { rules: ["private-key"], why: "a throwaway key generated for the test, never a credential" },
  "server/routes/brandUploads.test.ts": { rules: ["home-path"], why: "a fixture proving an uploaded Windows path is flattened" },
};

const WAIVER = /public-tree-ok:/;

/** Extensions never worth reading as text. */
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp3|mp4|webm|pdf|zip|gz|tgz|br|wasm|glb|gltf|bin|sqlite)$/i;

function exempt(file, ruleId) {
  const e = EXEMPT[file];
  if (!e) return false;
  return e.rules === "*" || e.rules.includes(ruleId);
}

/** Scan a list of repo-relative paths under `root`. Returns the findings. */
export function scan(root, files) {
  const findings = [];
  let read = 0;
  let waived = 0;
  for (const file of files) {
    const rel = file.split(path.sep).join("/");
    for (const n of FORBIDDEN_NAMES) {
      if (n.re.test(rel) && !exempt(rel, "name")) findings.push({ file: rel, line: 0, rule: "name", why: n.why });
    }
    if (BINARY.test(rel)) continue;
    const abs = path.join(root, file);
    let text;
    try {
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) continue; // binary by content
      text = buf.toString("utf8");
    } catch {
      continue; // listed by git, absent on disk (a deletion not yet committed)
    }
    read += 1;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const t of FORBIDDEN_TEXT) {
        if (!t.re.test(line) || exempt(rel, t.id)) continue;
        if (WAIVER.test(line)) {
          waived += 1;
          continue;
        }
        findings.push({ file: rel, line: i + 1, rule: t.id, why: t.why, text: line.trim().slice(0, 160) });
      }
    }
  }
  return { findings, read, waived };
}

function trackedFiles(root) {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) {
    console.error("check-public-tree: `git ls-files` failed, so nothing was checked. This is a failure, not a pass.");
    console.error(r.stderr);
    process.exit(2);
  }
  return r.stdout.split("\0").filter(Boolean);
}

function main(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = path.resolve(at("--root") ?? ROOT_DEFAULT);
  const files = at("--files") ? at("--files").split(",").filter(Boolean) : trackedFiles(root);
  if (!files.length) {
    console.error("check-public-tree: no files to check. A gate that read nothing has not passed.");
    process.exit(2);
  }
  const { findings, read, waived } = scan(root, files);
  if (findings.length) {
    for (const f of findings) {
      console.error(`  ${f.file}${f.line ? `:${f.line}` : ""}  [${f.rule}] ${f.why}`);
      if (f.text) console.error(`      ${f.text}`);
    }
    console.error("");
    console.error(`Public tree guard FAILED: ${findings.length} finding(s) across ${files.length} tracked file(s).`);
    console.error("Internal notes belong in the private operations repository (ReGen-Civics/village-os-ops).");
    console.error("Anything that was a live secret must be ROTATED: deleting it here leaves it in git history.");
    process.exit(1);
  }
  console.log(
    `Public tree guard passed: ${files.length} tracked file(s), ${read} read as text, ` +
      `${Object.keys(EXEMPT).length} file exemption(s), ${waived} inline waiver(s).`,
  );
}

if (path.resolve(process.argv[1] ?? "") === SELF) main(process.argv.slice(2));
