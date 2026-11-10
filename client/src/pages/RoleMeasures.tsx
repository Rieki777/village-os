/**
 * `/role-measures`: how the role journey is going, for members (L11).
 *
 * Counts and medians per season and circle, from stamped times. No names. A
 * number built from fewer than three people is withheld and shown as "too few",
 * so nobody can be picked out of it. The server is server/routes/roleMeasures.ts.
 */
import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import Layout from "@/components/Layout";
import { BreathingLoader } from "@/components/natural";
import { gameFetch } from "@/lib/gameApi";
import type { MeasureRow, Share } from "@shared/roleMeasures";

type Served = MeasureRow & { circleName: string | null };

const pct = (s: Share) => (s.share === null ? "too few" : `${Math.round(s.share * 100)}%`);
const count = (s: Share) => (s.eligible === 0 ? "" : ` (${s.yes} of ${s.eligible})`);
const hours = (h: number | null) => (h === null ? "too few" : h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`);

export default function RoleMeasures() {
  const [rows, setRows] = useState<Served[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    gameFetch("/api/role-measures")
      .then(async (r) => {
        if (r.status === 401) throw new Error("Sign in as a member to see how roles are going.");
        if (!r.ok) throw new Error("Could not read the measures.");
        return r.json();
      })
      .then((j) => live && setRows(j.rows ?? []))
      .catch((e) => live && setProblem(e.message));
    return () => {
      live = false;
    };
  }, []);

  return (
    <Layout>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-semibold"><Trans>How roles are going</Trans></h1>
        <p className="mt-2 text-sm opacity-80">
          <Trans>Counts and medians per season and circle, from stamped times. No names. "Too few" means fewer than three people, so the number is withheld.</Trans>
        </p>
        {problem && <p role="alert" className="mt-6">{problem}</p>}
        {!problem && rows === null && <BreathingLoader />}
        {rows && rows.length === 0 && <p className="mt-6"><Trans>Nothing has been stamped yet.</Trans></p>}
        {rows && rows.length > 0 && (
          <div className="mt-6 space-y-6">
            {rows.map((r) => (
              <section key={`${r.seasonId}|${r.circleId}`} className="rounded-lg border p-4" aria-label={`${r.circleName ?? "No circle"}, ${r.seasonId ?? "no season"}`}>
                <h2 className="font-medium">
                  {r.circleName ?? "No circle"} <span className="opacity-70">{r.seasonId ?? "no season"}</span>
                </h2>
                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <Row k="Applications" v={String(r.applications.count)} />
                  <Row k="Answered" v={pct(r.applications.answered) + count(r.applications.answered)} />
                  <Row k="Median time to first reply" v={hours(r.applications.medianHoursToReply)} />
                  <Row k="Median time to first interview" v={hours(r.applications.medianHoursToInterview)} />
                  <Row k="Median time to decision" v={hours(r.applications.medianHoursToDecision)} />
                  <Row k="Holders seated" v={String(r.holders.count)} />
                  <Row k="Path complete by day 30" v={pct(r.holders.pathCompleteBy30) + count(r.holders.pathCompleteBy30)} />
                  <Row k="First quest by day 14" v={pct(r.holders.firstQuestBy14) + count(r.holders.firstQuestBy14)} />
                  <Row k="Still in role at day 90" v={pct(r.holders.stillInRoleAt90) + count(r.holders.stillInRoleAt90)} />
                  <Row k="Renewed at each moon" v={pct(r.holders.renewed) + count(r.holders.renewed)} />
                </dl>
              </section>
            ))}
          </div>
        )}
      </main>
    </Layout>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed py-1">
      <dt>{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
