/**
 * THE VILLAGE'S OWN CONFLICT STEPS, OR A PLAIN STATEMENT THAT IT HAS NONE YET.
 *
 * `/governance` and `/roles` used to print a compiled conflict process: a
 * direct conversation, then a facilitated one, then a circle mediation, closing
 * with "No one is removed from the community without a circle consent vote."
 * Every fork published that as its own practice. The last sentence was false on
 * all of them: opening an involuntary exit is `POST /api/admin/exits` in
 * server/index.ts, gated by `isAdmin` and by no vote of any circle.
 *
 * The village already writes its repair path down, as the restorative steps of
 * its published exit policy (Admin, Departures; printed at `/exit-policy`). So
 * this prints THOSE, read from the public `GET /api/exit-policy`.
 *
 * WHO DECIDES WHETHER THE VILLAGE WROTE THEM IS THE SERVER. Every village's
 * policy starts as the platform's own words, and printing those here would be
 * the same defect with a different source. The route answers `platformWording`,
 * the keys of terms still word for word the platform's, from the same
 * comparison the publish gate uses (`platformDefaultTermKeys` in
 * server/lib/exitPolicy.ts). A client copy of the platform's steps would drift
 * the first time somebody edited the seed.
 *
 * Four states, and each one says only what is known:
 *   - loading: says it is loading;
 *   - the read failed: says so and points at `/exit-policy`;
 *   - the steps are still the platform's, or empty: says the village has not
 *     written them, and hands an admin the door to write them;
 *   - the village wrote them: prints them, and says they are a draft while the
 *     policy still carries its draft flag.
 *
 * It renders the body only. Each page keeps its own heading and frame.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useIsAdmin } from "@/contexts/AuthContext";

interface ExitPolicyAnswer {
  policy?: {
    placeholder?: boolean;
    restorative?: { steps?: unknown };
  };
  platformWording?: unknown;
}

type Reading =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "unwritten" }
  | { state: "written"; steps: string[]; draft: boolean };

/** Where an admin writes the steps: the Departures tab holds the exit policy editor. */
export const WRITE_STEPS_HREF = "/admin?tab=exits-admin";

/**
 * What the answer says about the village's own steps. Exported so the rule is
 * testable on its own. A missing `platformWording` list counts as unwritten:
 * when the server cannot vouch that the words are the village's, this page
 * does not present them as the village's.
 */
export function readConflictSteps(answer: ExitPolicyAnswer | null | undefined): Reading {
  const rawSteps = answer?.policy?.restorative?.steps;
  const steps = Array.isArray(rawSteps)
    ? rawSteps.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  const wording = answer?.platformWording;
  const stillPlatforms = !Array.isArray(wording) || wording.includes("restorativeSteps");
  if (stillPlatforms || steps.length === 0) return { state: "unwritten" };
  return { state: "written", steps, draft: answer?.policy?.placeholder === true };
}

export default function VillageConflictSteps() {
  const isAdmin = useIsAdmin();
  const [reading, setReading] = useState<Reading>({ state: "loading" });

  useEffect(() => {
    let alive = true;
    fetch("/api/exit-policy")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((answer: ExitPolicyAnswer) => {
        if (alive) setReading(readConflictSteps(answer));
      })
      .catch(() => {
        if (alive) setReading({ state: "failed" });
      });
    return () => {
      alive = false;
    };
  }, []);

  const policyLink = (
    <Link
      href="/exit-policy"
      className="inline-flex items-center gap-2 text-teal-deep font-semibold hover:text-teal transition-colors"
    >
      Read the village's exit policy <ArrowRight className="w-4 h-4" />
    </Link>
  );

  if (reading.state === "loading") {
    return (
      <p role="status" className="text-stone-600 leading-relaxed">
        Loading this village's conflict steps…
      </p>
    );
  }

  if (reading.state === "failed") {
    return (
      <div className="space-y-3 text-stone-700 leading-relaxed">
        <p role="status">This village's conflict steps could not be loaded just now.</p>
        {policyLink}
      </div>
    );
  }

  if (reading.state === "unwritten") {
    return (
      <div className="space-y-3 text-stone-700 leading-relaxed">
        <p>This village has not written its conflict steps yet.</p>
        {isAdmin && (
          <p>
            <Link href={WRITE_STEPS_HREF} className="text-teal-deep font-semibold underline">
              Write them in Admin, under Departures
            </Link>
            . They are the restorative steps of the exit policy, and this page prints them once they are in the village's own words.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 text-stone-700 leading-relaxed">
      <p>When tension between people needs repair, these are the steps this village wrote for it:</p>
      <ol className="space-y-2 list-decimal pl-6">
        {reading.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {reading.draft && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          These steps are still a draft. The community has not yet adopted its exit policy.
        </p>
      )}
      {policyLink}
    </div>
  );
}
