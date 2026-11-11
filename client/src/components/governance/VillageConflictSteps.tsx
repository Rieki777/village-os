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
 * It renders the body only. Each page keeps its own heading and frame. Its inks are the
 * semantic tokens, so the steps read on the night world of /roles as on any other page
 * (phase A: the stone and amber inks were near-invisible on the night card).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import { useIsAdmin } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";

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
    // Signed in, the token goes along: a member reads the steps whole, and
    // anybody else has a step that names a member withheld by the server.
    const token = authToken();
    (token ? fetch("/api/exit-policy", { headers: { Authorization: `Bearer ${token}` } }) : fetch("/api/exit-policy"))
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
      className="inline-flex min-h-11 items-center gap-2 font-semibold text-notice underline underline-offset-2 hover:text-foreground transition-colors"
    >
      <Trans>Read the village's exit policy</Trans> <ArrowRight className="w-4 h-4" />
    </Link>
  );

  if (reading.state === "loading") {
    return (
      <p role="status" className="text-muted-foreground leading-relaxed">
        <Trans>Loading this village's conflict steps…</Trans>
      </p>
    );
  }

  if (reading.state === "failed") {
    return (
      <div className="space-y-3 text-foreground leading-relaxed">
        <p role="status"><Trans>This village's conflict steps could not be loaded just now.</Trans></p>
        {policyLink}
      </div>
    );
  }

  if (reading.state === "unwritten") {
    return (
      <div className="space-y-3 text-foreground leading-relaxed">
        <p><Trans>This village has not written its conflict steps yet.</Trans></p>
        {isAdmin && (
          <p>
            <Trans>
              <Link href={WRITE_STEPS_HREF} className="font-semibold text-notice underline underline-offset-2">
                Write them in Admin, under Departures
              </Link>
              . They are the restorative steps of the exit policy, and this page prints them once they are in the village's own words.
            </Trans>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 text-foreground leading-relaxed">
      <p><Trans>When tension between people needs repair, these are the steps this village wrote for it:</Trans></p>
      <ol className="space-y-2 list-decimal pl-6">
        {reading.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {reading.draft && (
        <p className="text-sm text-foreground bg-notice/10 border border-notice/50 rounded-lg px-4 py-2.5">
          <Trans>These steps are still a draft. The community has not yet adopted its exit policy.</Trans>
        </p>
      )}
      {policyLink}
    </div>
  );
}
