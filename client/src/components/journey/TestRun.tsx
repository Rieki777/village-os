/**
 * THE TEST RUN, moved out of client/src/pages/JourneyToLaunch.tsx whole
 * (2026-09-26) so that page has room for the canvas. Nothing in it changed:
 * members and admins still meet the same card, and it still posts to
 * `/api/dry-run` with the member's own token.
 */
import { useState } from "react";
import { ChevronRight, FlaskConical } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { villageMoonLabel, type VillageMoon } from "@shared/villageMoon";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/**
 * THE TEST RUN (R86), the button immediately before the launch ballot.
 *
 * Rye: "we also need a 'test the village' option where all the cycles can run
 * rapidly so we can test how they are all working ... so the 'journey to
 * launch' has this as the second to last button to run a quick test over all
 * settings to see if they would work in production or break in some way."
 *
 * The card after this one opens the vote that turns issuance on for good, so
 * this is the last moment anybody can find out that a setting breaks.
 *
 * R56 governs the copy: the panel says what the run will do AND what it will
 * not, before anybody presses it, and the sentences it shows afterwards are
 * the server's own words about what happened. Nothing here is a warning about
 * what a founder ought to want. R55 governs the framing: a village that has
 * not launched is young, and this is a tool a founder reaches for.
 *
 * THE REFUSALS COME FIRST on purpose. A run that only showed the successes
 * would have told the founder nothing they needed.
 *
 * R12 OPENED THE DOOR. "Any member as all members may suggest upgrades and
 * will need to run models and tests." The card is the same card for everybody
 * and it carries no admin affordance of its own: it posts to `/api/dry-run`,
 * which answers any signed-in member (`server/routes/dryRun.ts`), and it
 * renders whatever comes back. A member's report leaves out the rules that are
 * switched off and the changes an admin has queued, and the route's header says
 * why. Nothing on this card needs to know which of the two it is holding.
 */
interface DryRunFinding { area: string; outcome: "issued" | "refused" | "idle"; sentence: string }
// `cycleKey` is the stored id and stays the React key for the list. `moon` is
// what the founder reads: a village running this report has usually not
// launched, so it carries dates and no number, which is the truth.
interface DryRunTurn { cycleNumber: number; cycleKey: string; startsAt: string; endsAt: string; moon: VillageMoon; findings: DryRunFinding[] }
interface DryRunReport {
  moons: number;
  spanDays: number;
  gameStarted: boolean;
  isolation: string;
  turns: DryRunTurn[];
  runFindings: DryRunFinding[];
  allowances: Array<{ stageId: string; stageName: string; allowance: number; shareCap: number; heartsSendable: boolean; note: string }>;
  jobs: Array<{ name: string; cadence: string; runsInSpan: string; note: string }>;
  refusals: DryRunFinding[];
  covered: string[];
  notCovered: string[];
}

/** The three outcomes, as a dot somebody can scan down a column. */
function OutcomeDot({ outcome }: { outcome: string }) {
  const tone =
    outcome === "refused" ? "bg-red-400" : outcome === "issued" ? "bg-emerald-400" : "bg-stone-300";
  return <span className={`shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full ${tone}`} />;
}

export function TestRun() {
  const [moons, setMoons] = useState(12);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState("");
  const [openMoons, setOpenMoons] = useState(false);

  const run = () => {
    setRunning(true);
    setProblem("");
    fetch("/api/dry-run", { method: "POST", headers: headers(), body: JSON.stringify({ moons }) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "The run was refused");
        setReport(d);
      })
      .catch((e) => { setReport(null); setProblem(String(e.message ?? e)); })
      .finally(() => setRunning(false));
  };

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex items-start gap-3 flex-wrap justify-between">
        <div className="max-w-md">
          <p className="font-semibold text-stone-900 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-teal-deep" /> Test run
          </p>
          <p className="text-xs text-stone-500 mt-1">
            Turn your village's moons over quickly and read what your settings would do: who the
            settlement thanks, what each rule pays, when Claims Week opens, and what a member can
            give. A good thing to do before the vote below.
          </p>
          <p className="text-xs text-stone-500 mt-1.5">
            This writes nothing. No balance moves, no recognition is recorded, and nothing is
            issued. It reads your settings and works out what each moon would do.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-stone-500" htmlFor="dry-run-moons">Moons</label>
          <select
            id="dry-run-moons"
            value={moons}
            onChange={(e) => setMoons(Number(e.target.value))}
            className="text-sm border border-stone-200 rounded-lg px-2 py-2 bg-white"
          >
            {[3, 6, 12, 24, 40].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            onClick={run}
            disabled={running}
            className="text-sm bg-teal-deep text-white rounded-lg px-5 py-2.5 font-semibold disabled:opacity-40"
          >
            {running ? "Running" : "Run the test"}
          </button>
        </div>
      </div>

      {problem && (
        <p role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{problem}</p>
      )}

      {report && (
        <div className="mt-5 border-t border-stone-900/10 pt-4 space-y-5">
          <p className="text-xs text-stone-500">
            {report.moons} moons, about {report.spanDays} days. {report.isolation}
          </p>

          {/* The refusals. This is the part a founder came for. */}
          <div>
            <h3 className="text-sm font-semibold text-stone-900">
              {report.refusals.length === 1
                ? "One thing would not work as set"
                : report.refusals.length > 1
                  ? `${report.refusals.length} things would not work as set`
                  : "Nothing refused across the whole run"}
            </h3>
            {report.refusals.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {report.refusals.map((f, i) => (
                  <li key={i} className="flex gap-2 text-xs text-stone-700">
                    <OutcomeDot outcome="refused" />
                    <span>{f.sentence}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-stone-500 mt-1">
                Every rule this run reached would pay what it says it pays.
              </p>
            )}
          </div>

          {/* What holds across the whole run. */}
          <div>
            <h3 className="text-sm font-semibold text-stone-900">Across the whole run</h3>
            <ul className="mt-2 space-y-1.5">
              {report.runFindings.map((f, i) => (
                <li key={i} className="flex gap-2 text-xs text-stone-700">
                  <OutcomeDot outcome={f.outcome} />
                  <span>{f.sentence}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* What a member can give, at each stage of the path. */}
          <div>
            <h3 className="text-sm font-semibold text-stone-900">What a member can give each moon</h3>
            <ul className="mt-2 space-y-1.5">
              {report.allowances.map((a) => (
                <li key={a.stageId} className="flex gap-2 text-xs text-stone-700">
                  <OutcomeDot outcome={a.allowance > 0 && a.heartsSendable ? "issued" : a.allowance > 0 ? "refused" : "idle"} />
                  <span>{a.note}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Moon by moon, folded away until somebody wants it. */}
          <div>
            <button
              onClick={() => setOpenMoons((v) => !v)}
              className="text-sm font-semibold text-stone-900 inline-flex items-center gap-1.5"
            >
              Moon by moon
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${openMoons ? "rotate-90" : ""}`} />
            </button>
            {openMoons && (
              <ul className="mt-2 space-y-3">
                {report.turns.map((t) => (
                  <li key={t.cycleKey}>
                    <p className="text-xs font-medium text-stone-900">
                      {villageMoonLabel(t.moon)}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {t.findings.map((f, i) => (
                        <li key={i} className="flex gap-2 text-xs text-stone-600">
                          <OutcomeDot outcome={f.outcome} />
                          <span>{f.sentence}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* The background jobs, counted and never run. */}
          <div>
            <h3 className="text-sm font-semibold text-stone-900">Background work over this span</h3>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {report.jobs.map((j) => (
                <li key={j.name} className="text-xs text-stone-600">
                  <span className="font-medium text-stone-800">{j.name}</span>: {j.cadence},
                  about {j.runsInSpan} times
                </li>
              ))}
            </ul>
          </div>

          {/* What it looked at, then what it did not. Both, every time. */}
          <div>
            <h3 className="text-sm font-semibold text-stone-900">What this run looked at</h3>
            <ul className="mt-2 space-y-1.5">
              {report.covered.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs text-stone-600">
                  <OutcomeDot outcome="issued" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-stone-900">What this run did not test</h3>
            <ul className="mt-2 space-y-1.5">
              {report.notCovered.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs text-stone-600">
                  <OutcomeDot outcome="idle" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
