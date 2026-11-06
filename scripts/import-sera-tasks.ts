#!/usr/bin/env -S npx tsx
/**
 * Preview one member's knowledge-library import from a saved answer, offline.
 *
 *   npx tsx scripts/import-sera-tasks.ts --file jessica-tasks.json --owner <library owner id>
 *
 * Reads the JSON that the library's list_voice_tasks returned (an array, or an
 * object with tasks / items / results), plans the import exactly as the server
 * would for a member whose list is empty, and prints the counts, the first ten
 * titles, the unknown priorities and the Needs Owner items. It touches no
 * database and calls nothing: the real run is the steward's "Import for real"
 * in Admin, Players, Personal task lists (POST /api/admin/member-tasks/import),
 * which also dry-runs by default and checks what the member already holds.
 */
import fs from "node:fs";
import { itemsOf, planImport, planSummary } from "../shared/memberTaskImport";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
}

const file = arg("file");
const owner = arg("owner");
if (!file || !owner) {
  console.error("usage: npx tsx scripts/import-sera-tasks.ts --file <answer.json> --owner <library owner id>");
  process.exit(2);
}
const items = itemsOf(JSON.parse(fs.readFileSync(file, "utf8")));
const summary = planSummary(planImport(items, owner, []));
console.log(JSON.stringify({ dryRun: true, items: items.length, ...summary }, null, 2));
