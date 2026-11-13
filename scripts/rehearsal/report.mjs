/**
 * Turns one night's walks into summary.json and summary.md, and compares this
 * run's screenshots with the previous run's.
 *
 * What fails a run: an act that did not complete. Everything else is reported
 * and fails nothing, at first: console errors, failed requests, sideways
 * scroll, axe violations, the phone and desktop findings, and visual change.
 * A green run therefore means every person got all the way through, and the
 * summary is where to read how well.
 */
import fs from "node:fs";
import path from "node:path";
import { decodePng, diffImages, encodePng } from "./png.mjs";

/** Compares every PNG in `shotsDir` with the same name in `baselineDir`. */
export function compareShots(shotsDir, baselineDir, diffDir, opts = {}) {
  const out = { baseline: baselineDir ?? null, compared: 0, changed: [], added: [], removed: [], unreadable: [] };
  const now = fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir).filter((f) => f.endsWith(".png")) : [];
  if (!baselineDir || !fs.existsSync(baselineDir)) {
    out.added = now;
    out.note = "no previous run to compare with";
    return out;
  }
  const before = new Set(fs.readdirSync(baselineDir).filter((f) => f.endsWith(".png")));
  fs.mkdirSync(diffDir, { recursive: true });
  for (const f of now) {
    if (!before.has(f)) {
      out.added.push(f);
      continue;
    }
    before.delete(f);
    try {
      const a = decodePng(fs.readFileSync(path.join(baselineDir, f)));
      const b = decodePng(fs.readFileSync(path.join(shotsDir, f)));
      const d = diffImages(a, b, { ...opts, picture: true });
      out.compared++;
      if (!d.comparable) out.changed.push({ shot: f, reason: d.reason });
      else if (d.changed) {
        const diffFile = path.join(diffDir, f);
        fs.writeFileSync(diffFile, encodePng(d.picture));
        out.changed.push({ shot: f, share: Number((d.share * 100).toFixed(2)), diff: path.relative(path.dirname(diffDir), diffFile) });
      }
    } catch (e) {
      out.unreadable.push({ shot: f, reason: String(e.message ?? e) });
    }
  }
  out.removed = [...before];
  return out;
}

export function buildSummary({ walks, emails, aiCalls, visual, meta }) {
  const rows = walks.map((w) => {
    const passed = w.steps.filter((s) => s.ok).length;
    const failed = w.steps.filter((s) => !s.ok && !s.skipped);
    const skipped = w.steps.filter((s) => s.skipped).length;
    const axe = w.pages.reduce((n, p) => n + (p.axe ?? []).reduce((m, v) => m + (v.id === "axe-error" ? 0 : v.nodes), 0), 0);
    const findings = w.pages.flatMap((p) => p.findings.map((f) => ({ page: p.name, ...f })));
    return {
      persona: w.persona,
      width: w.width,
      steps: { passed, total: w.steps.length, failed: failed.map((s) => `${s.name}: ${s.error}`), skipped },
      consoleErrors: w.console.length,
      failedRequests: w.failedRequests.length,
      sidewaysScroll: w.pages.filter((p) => p.overflow > 1).map((p) => `${p.name} (${p.overflow}px)`),
      axeViolations: axe,
      findings,
      blockedExternal: w.blockedExternal.length,
      detail: { console: w.console.slice(0, 20), failedRequests: [...new Set(w.failedRequests)].slice(0, 20), axe: w.pages.map((p) => ({ page: p.name, violations: p.axe })), blockedExternal: w.blockedExternal.slice(0, 10) },
    };
  });
  const totals = {
    steps: rows.reduce((n, r) => n + r.steps.passed, 0),
    stepsTotal: rows.reduce((n, r) => n + r.steps.total, 0),
    consoleErrors: rows.reduce((n, r) => n + r.consoleErrors, 0),
    failedRequests: rows.reduce((n, r) => n + r.failedRequests, 0),
    sidewaysScroll: rows.reduce((n, r) => n + r.sidewaysScroll.length, 0),
    axeViolations: rows.reduce((n, r) => n + r.axeViolations, 0),
    findings: rows.reduce((n, r) => n + r.findings.length, 0),
    emails: emails.length,
    aiCalls: aiCalls.length,
    visualChanged: visual.changed.length,
  };
  const ok = rows.every((r) => r.steps.failed.length === 0 && r.steps.skipped === 0);
  return {
    ok,
    meta,
    totals,
    rows,
    emails: emails.map((e) => ({ to: [].concat(e.body?.to ?? []).join(", "), subject: e.body?.subject ?? "" })),
    visual,
  };
}

export function summaryMarkdown(s) {
  const L = [];
  L.push(`# Nightly rehearsal: ${s.ok ? "everyone got through" : "someone was stopped"}`);
  L.push("");
  L.push(`Build ${s.meta.build ?? "unknown"}, ${s.meta.startedAt}, ${Math.round(s.meta.seconds)}s.`);
  L.push("");
  const t = s.totals;
  L.push(`Acts passed ${t.steps} of ${t.stepsTotal}. Console errors ${t.consoleErrors}. Failed requests ${t.failedRequests}. Sideways scroll on ${t.sidewaysScroll} page(s). Axe violations ${t.axeViolations}. Phone and desktop findings ${t.findings}. Emails sent ${t.emails}. AI stub calls ${t.aiCalls}. Screenshots changed since the last run ${t.visualChanged}.`);
  L.push("");
  L.push("| persona | width | acts | console | failed requests | sideways | axe | findings |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const r of s.rows) {
    L.push(`| ${r.persona} | ${r.width} | ${r.steps.passed}/${r.steps.total} | ${r.consoleErrors} | ${r.failedRequests} | ${r.sidewaysScroll.length} | ${r.axeViolations} | ${r.findings.length} |`);
  }
  const stopped = s.rows.filter((r) => r.steps.failed.length);
  if (stopped.length) {
    L.push("", "## Where someone was stopped", "");
    for (const r of stopped) for (const f of r.steps.failed) L.push(`- ${r.persona} at ${r.width}: ${f}`);
  }
  const finds = s.rows.flatMap((r) => r.findings.map((f) => ({ ...f, who: `${r.persona} at ${r.width}` })));
  if (finds.length) {
    L.push("", "## Phone and desktop findings (reported, not failing)", "");
    for (const f of finds) L.push(`- ${f.who}, ${f.page}: ${f.kind}, ${f.detail}${f.samples ? ` (${f.samples.join("; ")})` : ""}`);
  }
  const v = s.visual;
  L.push("", "## Visual change since the last run", "");
  if (v.note) L.push(v.note + ".");
  else {
    L.push(`Compared ${v.compared}. Changed ${v.changed.length}. New ${v.added.length}. Gone ${v.removed.length}.`);
    for (const c of v.changed) L.push(`- ${c.shot}: ${c.reason ?? `${c.share}% of pixels moved, diff in ${c.diff}`}`);
    for (const a of v.added) L.push(`- new: ${a}`);
    for (const r of v.removed) L.push(`- gone: ${r}`);
  }
  L.push("", "## Emails sent", "");
  for (const e of s.emails) L.push(`- to ${e.to}: ${e.subject}`);
  L.push("");
  return L.join("\n");
}
