/**
 * The typed-payout guard's own guard.
 *
 * The control that matters most is the defect the guard was written for: the
 * Co-Creators Guide's own two lines, "40-300 ${tokenName}" and
 * "200-500/month", which said quests and roles paid figures nothing in the
 * platform paid (Rye, 2026-10-21). They must stay red. Beside them, the shapes
 * that are data and must stay green: an interpolated amount, a figure that
 * names no token or period, and a worked example carrying its waiver.
 *
 * Run: node scripts/check-typed-payouts.test.mjs
 */
import assert from "node:assert/strict";
import { scan, typedPayout } from "./check-typed-payouts.mjs";

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}\n     ${e.message}`);
  }
};

check("the guide's own two lines stay red", () => {
  const src = [
    "const items = (tokenName: string) => [",
    '  { label: "Quests", range: `40-300 ${tokenName}` },',
    '  { label: "Circle Roles", range: "200-500/month" },',
    "];",
  ].join("\n");
  const { found } = scan("Guide.tsx", src);
  assert.deepEqual(
    found.map((f) => [f.line, f.rule]),
    [
      [2, "figure-and-token"],
      [3, "range-per-period"],
    ],
  );
});

check("a figure in front of a token's own name is a typed payout", () => {
  assert.equal(typedPayout("Every quest pays 25 Village Credits")?.rule, "figure-and-token");
  assert.equal(typedPayout("Earn 10 to 50 Gratitude a week")?.rule, "figure-and-token");
  assert.equal(typedPayout("Roles pay 100-200 / moon")?.rule, "range-per-period");
});

check("an amount read from data passes", () => {
  const src = "const line = `${amount} ${name}`;\nconst also = `Worth ${formatMoney(v.minor, v.currency)}`;";
  assert.deepEqual(scan("Card.tsx", src).found, []);
});

check("a figure that names no token or period passes", () => {
  assert.equal(typedPayout("Seven circles, 40 members, 3 seasons"), null);
  assert.equal(typedPayout("Version 1.2.0"), null);
});

check("class names and paths are machinery, never copy", () => {
  const src = '<div className="w-40-300 Gratitude" data-x="1">{label}</div>';
  assert.deepEqual(scan("Box.tsx", src).found, []);
});

check("a worked example carries its waiver, and the waiver is counted", () => {
  const src = 'const example = "Ash pays 25 Village Credits"; // payout-ok: a worked example in the explainer, no promise';
  const { found, waived } = scan("Explainer.tsx", src);
  assert.deepEqual(found, []);
  assert.equal(waived.length, 1);
});

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\ncheck-typed-payouts self-test passed.");
