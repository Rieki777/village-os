/**
 * The packages a pull request may add, each by name, exact version and
 * section (validate-module.mjs, contribution check 3a).
 *
 * The house rule is that the answer to a new dependency is no: it is a
 * supply-chain guard, and CI runs a Node version behind the dev boxes. An
 * entry here is a ruled exception, never a habit. Each one names:
 *   - the exact version, pinned with no range: a bump is a new version and
 *     needs its own entry;
 *   - the section: build and test tools are devDependencies and never ship;
 *   - why, and the date it was allowed.
 * Before an entry is added the package is checked for install scripts (none
 * allowed) and `pnpm audit` is run; the pull request records both.
 *
 * A package already in package.json before the change is not this list's
 * business, unless the change moves it to a version or section an entry does
 * not name.
 */
export const ALLOWED_NEW_DEPENDENCIES = [
  // i18n, coordinator ruling 2026-11-06 (option a, with conditions). No
  // install scripts in any of the six or in @lingui/native-tools 0.2.0, their
  // native transitive; pnpm audit shows no advisory on them.
  { name: "@lingui/core", version: "6.12.0", section: "dependencies", purpose: "i18n runtime: message lookup and ICU interpolation in the browser", date: "2026-11-06" },
  { name: "@lingui/react", version: "6.12.0", section: "dependencies", purpose: "i18n runtime: the React provider and the Trans component", date: "2026-11-06" },
  { name: "@lingui/cli", version: "6.12.0", section: "devDependencies", purpose: "i18n build: extracting messages and compiling catalogs", date: "2026-11-06" },
  { name: "@lingui/vite-plugin", version: "6.12.0", section: "devDependencies", purpose: "i18n build: the macro transform in vite and vitest", date: "2026-11-06" },
  { name: "@lingui/format-po", version: "6.12.0", section: "devDependencies", purpose: "i18n build: reading and writing the PO catalogs", date: "2026-11-06" },
  { name: "@lingui/message-utils", version: "6.12.0", section: "devDependencies", purpose: "i18n build: compiling English at build time, message ids in tests", date: "2026-11-06" },
];

const SECTIONS = ["dependencies", "devDependencies"];

function entries(pkg) {
  const out = new Map();
  for (const section of SECTIONS) {
    for (const [name, version] of Object.entries(pkg?.[section] ?? {})) out.set(`${section}:${name}`, { name, version, section });
  }
  return out;
}

/** Problems with the packages `after` adds or re-pins against `before`; empty when there are none. */
export function newDependencyProblems(before, after, allowed = ALLOWED_NEW_DEPENDENCIES) {
  const had = entries(before);
  const hadNames = new Set([...had.values()].map((e) => e.name));
  const listed = new Map(allowed.map((e) => [e.name, e]));
  const problems = [];
  for (const [key, dep] of entries(after)) {
    const prev = had.get(key);
    if (prev && prev.version === dep.version) continue;
    const entry = listed.get(dep.name);
    if (prev && !entry) continue;
    if (!prev && hadNames.has(dep.name) && !entry) continue;
    if (!entry) {
      problems.push(`${dep.name}@${dep.version} is a new dependency not on the allow-list (scripts/dependency-allowlist.mjs)`);
      continue;
    }
    if (dep.version !== entry.version) {
      problems.push(`${dep.name}@${dep.version}: the allow-list names ${entry.name}@${entry.version} only; a different version needs its own entry`);
    }
    if (dep.section !== entry.section) {
      problems.push(`${dep.name} is in ${dep.section}; the allow-list names it for ${entry.section}`);
    }
  }
  return problems;
}
