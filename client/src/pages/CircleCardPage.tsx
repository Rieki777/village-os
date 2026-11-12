/**
 * `/circles/:id`: one circle's home, drawn as a HEARTH (Phase D, lane D1; the
 * lead's decision 3: "circle pages become a hearth").
 *
 * Reads `GET /api/org/circles/:id/card` (server/routes/circleCard.ts) and
 * draws it with `CircleCardView`, placed around the hearth:
 *
 *   - the roles as stones round a warm fire (a Seed of Life in embers), with
 *     mycelial threads to the circles this one is linked to (`Hearth`);
 *   - "We meet", the next meeting with "I'll be there" filling a Seed, the
 *     page's one lit act;
 *   - what we tend (the circle's open work as plants), who holds what, and
 *     what we decided, each decision marked with a vesica;
 *   - then the circle's own words, its signs and its open proposals, as the
 *     card has always drawn them, with "Propose new words" untouched.
 *
 * A circle with no roles yet is a quiet hearth: the embers, one sentence and
 * one door. Below the card, for those who keep the circle, sits this season's
 * pulse from Live Sessions.
 *
 * PHONE AND DESKTOP, each at its best.
 *   - Phone: one column in the order a newcomer asks. The header, the hearth
 *     full-bleed, "We meet" with its act under the thumb, then what we tend,
 *     who holds what, what we decided and the circle's words.
 *   - Desktop (lg): three columns. The hearth stays in view on the left,
 *     larger, with hover naming each stone; the reading column in the middle;
 *     the next gathering and the linked circles stay on the right.
 *
 * The night world (`WORLD`), the sheet's tokens and the nature kit only.
 * Nothing here scores or ranks a person: stones carry a role's letter,
 * plants describe work, and the seed counts who is coming to one evening.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import Layout from "@/components/Layout";
import CircleCardView from "@/components/circleCard/CircleCardView";
import Hearth from "@/components/circleCard/Hearth";
import { LinkedCircles, QuietHearth, WeDecided, WeMeet, WeTend, WhoHolds } from "@/components/circleCard/HearthSections";
import { adoptionOf, hearthRoles, linkedCircles, meetFacts, stonesOf, threadsOf } from "@/components/circleCard/hearthModel";
import { tendFor, useHearth } from "@/components/circleCard/useHearth";
import CirclePulse from "@/components/sessions/CirclePulse";
import { CARD, LINK, WORLD } from "@/components/journey/look";
import { gameFetch } from "@/lib/gameApi";
import type { CircleCard, CircleSection } from "@shared/circleCard";
import { CIRCLE_CARD_WORDS as W } from "@shared/circleCardWords";

type View =
  | { kind: "loading" }
  | { kind: "ok"; card: CircleCard; mayPropose: boolean; sessionsOn: boolean; signedIn: boolean }
  | { kind: "missing" }
  | { kind: "failed" };

/** The sections the hearth draws itself, so the card leaves them out. */
const HEARTH_DRAWS = ["roles", "meet", "adoption"] as const;

/** `/circles/<id>` back to its id. */
const idFromHref = (href: string): string | null => {
  const m = /^\/circles\/([^/?#]+)/.exec(href);
  return m ? decodeURIComponent(m[1]!) : null;
};

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
            ? {
                kind: "ok",
                card: out.card as CircleCard,
                mayPropose: out.viewer?.mayPropose === true,
                sessionsOn: out.viewer?.sessionsOn === true,
                signedIn: out.viewer?.signedIn === true,
              }
            : { kind: "failed" },
        );
      })
      .catch(() => alive && setView({ kind: "failed" }));
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => load(), [load]);

  const card = view.kind === "ok" ? view.card : null;
  const circle = useMemo(() => (card ? { id, name: card.header.name } : null), [card, id]);
  const { data, answer } = useHearth(circle, view.kind === "ok" && view.sessionsOn);

  return (
    <Layout>
      <div className={`${WORLD} py-6 sm:py-10`} data-circle-hearth="">
        <div className="mx-auto grid max-w-7xl gap-4 px-4">
          <Link href="/circles" className={LINK}>
            {W.backToCircles}
          </Link>
          {view.kind === "ok" && card ? (
            <HearthPage
              card={card}
              circleId={id}
              mayPropose={view.mayPropose}
              signedIn={view.signedIn}
              reload={load}
              data={data}
              answer={answer}
            />
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
      </div>
    </Layout>
  );
}

function HearthPage({
  card,
  circleId,
  mayPropose,
  signedIn,
  reload,
  data,
  answer,
}: {
  card: CircleCard;
  circleId: string;
  mayPropose: boolean;
  signedIn: boolean;
  reload: () => void;
  data: ReturnType<typeof useHearth>["data"];
  answer: ReturnType<typeof useHearth>["answer"];
}) {
  const roles = hearthRoles(card);
  const quiet = roles.kind === "none";
  const stones = roles.kind === "shown" ? stonesOf(roles.roles) : [];
  const parent = card.header.parent;
  const links = linkedCircles(circleId, parent, parent ? idFromHref(parent.href) : null, data.orgCircles);
  const threads = threadsOf(links, stones.length);
  const rolesSection = card.sections.find((s): s is Extract<CircleSection, { kind: "roles" }> => s.kind === "roles");
  const tend = tendFor(data, { id: circleId, name: card.header.name });

  return (
    <CircleCardView
      card={card}
      circleId={circleId}
      mayPropose={mayPropose}
      reload={reload}
      omit={HEARTH_DRAWS}
      arrange={({ header, proposals, rest }) => (
        <div
          data-circle-card=""
          data-hearth-quiet-circle={quiet ? "true" : "false"}
          className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(0,19rem)] lg:items-start lg:gap-8"
        >
          <div className="lg:col-start-2 lg:row-start-1">{header}</div>

          {/* The hearth: full-bleed on a phone, held in view on the left on a desktop. */}
          <div className="-mx-4 sm:mx-0 lg:sticky lg:top-24 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <div className={`${CARD} rounded-none border-x-0 px-2 py-6 sm:rounded-2xl sm:border-x lg:p-6`}>
              <Hearth circleName={card.header.name} stones={stones} threads={threads} />
              {quiet ? <QuietHearth signedIn={signedIn} /> : null}
            </div>
          </div>

          {!quiet ? (
            <aside className="grid gap-4 lg:sticky lg:top-24 lg:col-start-3 lg:row-span-2 lg:row-start-1">
              <WeMeet meet={data.meet} facts={meetFacts(card)} signedIn={signedIn} answer={answer} />
              <LinkedCircles links={links} />
            </aside>
          ) : (
            <aside className="grid gap-4 lg:col-start-3 lg:row-start-1">
              <LinkedCircles links={links} />
            </aside>
          )}

          <div className="grid gap-4 sm:gap-6 lg:col-start-2">
            {proposals}
            {!quiet ? <WeTend tend={tend} /> : null}
            {roles.kind === "shown" && rolesSection ? (
              <WhoHolds roles={roles.roles} heading={rolesSection.heading} note={rolesSection.note} />
            ) : null}
            {!quiet ? <WeDecided decisions={data.decisions} adoption={adoptionOf(card)} /> : null}
            {rest}
            {data.keeps ? (
              <CirclePulse
                circles={[{ id: circleId, name: card.header.name }]}
                keepCircleIds={[circleId]}
                myCircleIds={[circleId]}
                lede={W.pulseLede}
              />
            ) : null}
          </div>
        </div>
      )}
    />
  );
}
