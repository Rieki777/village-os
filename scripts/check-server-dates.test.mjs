/**
 * The server-dates guard's own guard (readiness R134).
 *
 * Pins what the guard refuses and what it leaves alone, on the pure line
 * reader, so a loosened pattern is caught here before it lets the next bare
 * notice date through.
 *
 * Run: node scripts/check-server-dates.test.mjs
 */
import assert from "node:assert";
import { bareDateCalls, scanText } from "./check-server-dates.mjs";

let run = 0;
const check = (name, fn) => {
  fn();
  run += 1;
  console.log(`  PASS  ${name}`);
};

check("refuses the bare forms the two vote notices shipped with", () => {
  assert.deepStrictEqual(
    bareDateCalls("body: `Voting is open until ${new Date(result.ballot.closesAt).toLocaleDateString()}.`,"),
    ["toLocaleDateString()"],
  );
  assert.deepStrictEqual(bareDateCalls("const t = d.toLocaleTimeString( );"), ["toLocaleTimeString( )"]);
  assert.deepStrictEqual(bareDateCalls("const s = d.toLocaleString();"), ["toLocaleString()"]);
});

check("refuses a call that passes only undefined, which is the same container default", () => {
  assert.deepStrictEqual(bareDateCalls("x.toLocaleDateString(undefined)"), ["toLocaleDateString(undefined)"]);
});

check("leaves alone a call that names its locale", () => {
  assert.deepStrictEqual(bareDateCalls('d.toLocaleDateString("en-GB", { timeZone: "UTC" })'), []);
  assert.deepStrictEqual(bareDateCalls('n.toLocaleString("en-US")'), []);
  assert.deepStrictEqual(bareDateCalls("m.toLocaleString(undefined, { minimumFractionDigits: 2 })"), []);
});

check("reads code, not commentary", () => {
  assert.deepStrictEqual(bareDateCalls(" * `toLocaleDateString()`, which on a server is the container's UTC"), []);
  assert.deepStrictEqual(bareDateCalls("const a = 1; // was d.toLocaleDateString()"), []);
});

check("a waiver on the line itself lets one through", () => {
  assert.deepStrictEqual(bareDateCalls("d.toLocaleDateString(); // server-date-ok: a log line only the operator reads"), []);
  assert.deepStrictEqual(bareDateCalls("d.toLocaleDateString(); // server-date-ok:"), ["toLocaleDateString()"]);
});

check("reports the line each hit is on, CRLF or not", () => {
  const text = "const a = 1;\r\nconst b = d.toLocaleDateString();\r\nconst c = 2;\r\n";
  assert.deepStrictEqual(scanText(text), [{ line: 2, call: "toLocaleDateString()" }]);
});

console.log(`check-server-dates.test: ${run} cases passed`);
