/**
 * `/circles/:id`: one circle's card, the circle's home page.
 *
 * Reads `GET /api/org/circles/:id/card` (server/routes/circleCard.ts) and
 * draws it with `CircleCardView`. Below the card, for the circle's members
 * and admins, sit Live Sessions' own sections for this circle, its decision
 * log and this season's pulse (client/src/components/sessions/CircleSessions.tsx).
 * Coming up is the card's own "How we meet".
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import Layout from "@/components/Layout";
import CircleCardView from "@/components/circleCard/CircleCardView";
import CircleSessions from "@/components/sessions/CircleSessions";
import { LINK } from "@/components/playerCard/cardParts";
import { gameFetch } from "@/lib/gameApi";
import type { CircleCard } from "@shared/circleCard";
import { CIRCLE_CARD_WORDS as W } from "@shared/circleCardWords";

type View =
  | { kind: "loading" }
  | { kind: "ok"; card: CircleCard; mayPropose: boolean; sessionsOn: boolean }
  | { kind: "missing" }
  | { kind: "failed" };

export default function CircleCardPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "");
  const [view, setView] = useState<View>({ kind: "loading" });

  const load = useCallback(() => {
    let alive = true;
    void gameFetch(`/api/org/circles/${encodeURIComponent(id)}/card`)
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 404) return setView({ kind: "missing" });
        if (!res.ok) return setView({ kind: "failed" });
        const out = await res.json();
        if (!alive) return;
        setView(
          out?.card
            ? { kind: "ok", card: out.card as CircleCard, mayPropose: out.viewer?.mayPropose === true, sessionsOn: out.viewer?.sessionsOn === true }
            : { kind: "failed" },
        );
      })
      .catch(() => alive && setView({ kind: "failed" }));
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => load(), [load]);

  return (
    <Layout>
      <section className="bg-background py-8 sm:py-12">
        <div className="mx-auto grid max-w-3xl gap-4 px-4">
          <Link href="/circles" className={LINK}>
            {W.backToCircles}
          </Link>
          {view.kind === "ok" ? (
            <>
              <CircleCardView card={view.card} circleId={id} mayPropose={view.mayPropose} reload={load} />
              <CircleSessions circleId={id} circleName={view.card.header.name} sessionsOn={view.sessionsOn} />
            </>
          ) : null}
          {view.kind === "missing" ? <p className="text-foreground">{W.notFound}</p> : null}
          {view.kind === "failed" ? (
            <p role="status" className="text-foreground">
              {W.failed}{" "}
              <button type="button" onClick={load} className="min-h-11 font-medium text-notice underline underline-offset-2">
                {W.retry}
              </button>
            </p>
          ) : null}
        </div>
      </section>
    </Layout>
  );
}
