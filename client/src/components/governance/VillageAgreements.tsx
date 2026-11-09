/**
 * THE VILLAGE'S AGREEMENTS, where members read them (W4-agreements-no-page).
 *
 * The "Write an agreement" wizard tells its author that a carried vote makes
 * the agreement "an active agreement, exactly as written, with its own review
 * date", and nothing on any page asked GET /api/governance/agreements, so the
 * words lived only in the ballot's document. This lists them on the
 * governance page: the active ones in full, with their circle and review date,
 * and the ones at a vote now, each linked to its decision.
 *
 * Members only, as the route is (a visitor asks nothing, and an account the
 * route refuses sees nothing), and only while governance is on. It states the
 * review date as a date; nothing reminds anybody when it comes yet, and the
 * page does not say otherwise.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleOn } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";

interface ServedAgreement {
  id: string;
  title: string;
  body: string;
  circleName: string | null;
  reviewAt: string | null;
  status: string;
  ballotId: string;
  decidedAt: string | null;
}

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/** "1 March 2027", from a `YYYY-MM-DD` date, read as that calendar day. */
function dayWords(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function VillageAgreements() {
  const { user } = useAuth();
  const { t } = useLingui();
  const governanceOn = useModuleOn("governance");
  const [agreements, setAgreements] = useState<ServedAgreement[] | null>(null);

  useEffect(() => {
    if (!user || !governanceOn) return;
    let alive = true;
    fetch("/api/governance/agreements", { headers: headers() })
      .then(async (r) => {
        if (!r.ok) return null;
        const d = await r.json().catch(() => null);
        return Array.isArray(d?.agreements) ? (d.agreements as ServedAgreement[]) : null;
      })
      .then((list) => {
        if (alive && list) setAgreements(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user, governanceOn]);

  if (!user || !governanceOn || !agreements) return null;
  const active = agreements.filter((a) => a.status === "active");
  const voting = agreements.filter((a) => a.status === "voting");

  return (
    <section className="bg-white py-12" data-testid="village-agreements">
      <div className="container max-w-5xl mx-auto px-4">
        <h2 className="font-display text-2xl md:text-3xl font-bold text-teal-deep mb-2">
          <Trans context="heading of the adopted agreements list">The village&apos;s agreements</Trans>
        </h2>
        <p className="text-stone-700 leading-relaxed">
          <Trans>Agreements the village adopted by its own vote, exactly as written, and the ones at a vote now.</Trans>
        </p>
        {active.length === 0 && <p className="mt-4 text-sm text-stone-600"><Trans>The village has not adopted an agreement yet.</Trans></p>}
        <ul className="mt-4 space-y-4">
          {active.map((a) => (
            <li key={a.id} className="rounded-xl border border-stone-200 p-4">
              <h3 className="font-semibold text-stone-900">{a.title}</h3>
              <p className="mt-2 text-stone-800 whitespace-pre-line">{a.body}</p>
              <p className="mt-2 text-xs text-stone-600">
                {a.circleName ? t({ message: `Circle: ${a.circleName}. `, context: "the circle an agreement belongs to" }) : ""}
                {a.decidedAt ? t({ message: `Adopted on ${new Date(a.decidedAt).toLocaleDateString()}.`, context: "the day an agreement was adopted" }) : ""}
              </p>
              {a.reviewAt && (
                <p className="mt-1 text-xs text-stone-600" data-testid={`agreement-review-${a.id}`}>
                  <Trans context="the day an agreement comes back for review">Review date: {dayWords(a.reviewAt)}.</Trans>
                </p>
              )}
            </li>
          ))}
        </ul>
        {voting.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-stone-900"><Trans context="agreements whose vote is open">At a vote now</Trans></h3>
            <ul className="mt-2 space-y-1">
              {voting.map((a) => (
                <li key={a.id}>
                  <Link href={`/decisions/${a.ballotId}`} className="text-sm font-medium text-teal-deep underline">
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
