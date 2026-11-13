/**
 * `/role-measures`: how the role journey is going, for administrators (L11).
 *
 * Counts and medians per season and circle, from stamped times. No names. A
 * number built from fewer than three people is withheld and shown as "too few",
 * so nobody can be picked out of it. Admin only: the page asks the server for
 * nothing unless the viewer is signed in as an admin or founder. The server is
 * server/routes/roleMeasures.ts, which refuses everybody else.
 */
import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import Layout from "@/components/Layout";
import { BreathingLoader } from "@/components/natural";
import { useAuth, useIsAdmin } from "@/contexts/AuthContext";
import { gameFetch } from "@/lib/gameApi";
import { CARD, H1, H2, HINT, LEDE, TILE, WORLD } from "@/components/journey/look";
import type { MeasureRow, Share } from "@shared/roleMeasures";

type Served = MeasureRow & { circleName: string | null };

const pct = (s: Share) => (s.share === null ? "too few" : `${Math.round(s.share * 100)}%`);
const count = (s: Share) => (s.eligible === 0 ? "" : ` (${s.yes} of ${s.eligible})`);
const hours = (h: number | null) => (h === null ? "too few" : h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`);

export default function RoleMeasures() {
  const [rows, setRows] = useState<Served[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const { user, loading } = useAuth();
  const admin = useIsAdmin();

  useEffect(() => {
    if (!admin) return;
    let live = true;
    gameFetch("/api/role-measures")
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) throw new Error("Only administrators can see how roles are going.");
        if (!r.ok) throw new Error("Could not read the measures.");
        return r.json();
      })
      .then((j) => live && setRows(j.rows ?? []))
      .catch((e) => live && setProblem(e.message));
    return () => {
      live = false;
    };
  }, [admin]);

  if (loading) {
    return (
      <Layout>
        <main className={`${WORLD} py-8`}><div className="mx-auto max-w-4xl px-4"><BreathingLoader /></div></main>
      </Layout>
    );
  }
  if (!admin) {
    return (
      <Layout>
        <main className={`${WORLD} py-8 sm:py-12`}>
          <div className="mx-auto max-w-4xl px-4">
          <h1 className={H1}><Trans>How roles are going</Trans></h1>
          <p className={`${LEDE} mt-4`} data-testid="measures-admin-only">
            {user ? <Trans>This page is for administrators.</Trans> : <Trans>This page is for administrators. Sign in with an administrator account to see it.</Trans>}
          </p>
          </div>
        </main>
      </Layout>
    );
  }

  return (
    <Layout>
      <main className={`${WORLD} py-8 sm:py-12`}>
      <div className="mx-auto max-w-4xl px-4">
        <h1 className={H1}><Trans>How roles are going</Trans></h1>
        <p className={`${LEDE} mt-2`}>
          <Trans>Counts and medians per season and circle, from stamped times. No names. "Too few" means fewer than three people, so the number is withheld.</Trans>
        </p>
        {problem && <p role="alert" className="mt-6 rounded-xl border border-destructive bg-destructive/10 p-4 text-destructive">{problem}</p>}
        {!problem && rows === null && <BreathingLoader />}
        {rows && rows.length === 0 && <p className={`${HINT} mt-6`}><Trans>Nothing has been stamped yet.</Trans></p>}
        {rows && rows.length > 0 && (
          <div className="mt-6 space-y-6">
            {rows.map((r) => (
              <section key={`${r.seasonId}|${r.circleId}`} className={CARD} aria-label={`${r.circleName ?? "No circle"}, ${r.seasonId ?? "no season"}`}>
                <h2 className={H2}>
                  {r.circleName ?? "No circle"} <span className="text-base font-normal text-muted-foreground">{r.seasonId ?? "no season"}</span>
                </h2>
                <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
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
      </div>
      </main>
    </Layout>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className={`${TILE} flex items-baseline justify-between gap-4`}>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-semibold text-foreground">{v}</dd>
    </div>
  );
}
