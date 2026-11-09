/**
 * ROLES OPEN NOW, under a character's class card (build days S2).
 *
 * Two lists the class card did not have:
 *
 *  - ALSO OPEN IN THE VILLAGE: open roles tagged for no class (`alsoOpen` from
 *    `/api/archetypes/:key/paths`). A village that never tagged its roles used
 *    to show every character an empty board; these are offered beside the fit
 *    and never called a fit. Each one has its apply link.
 *  - ROLES THIS CHARACTER COULD OPEN: platform ideas the village's chart does
 *    not carry yet (shared/characterRoleIdeas.ts), such as the Catalyst's
 *    investment, crowd pooling and village weaving roles. Each opens the
 *    ordinary role proposal, so the village decides by its own power; nothing
 *    here writes a role into anyone's chart.
 *
 * It always leaves the member one thing to do (spec R25): when both lists are
 * empty it points at every role and at the quest board.
 *
 * Born in Lingui. Frozen inks on the class card's frozen white surface, and no
 * `text-gray-*` (that ratchet is full).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Trans } from "@lingui/react/macro";
import { applySeatsHref } from "@shared/seatApplyLinks";
import { unmetRoleIdeas, type CharacterRoleIdea } from "@shared/characterRoleIdeas";
import { loadOrg } from "@/components/governance/pickSources";

export interface AlsoOpenRole {
  id: string;
  name: string;
  recruiting: boolean;
}

export default function RolesOpenNow({ archetypeKey, alsoOpen }: { archetypeKey: string; alsoOpen: readonly AlsoOpenRole[] }) {
  const [chartNames, setChartNames] = useState<string[] | null>(null);

  useEffect(() => {
    let gone = false;
    loadOrg()
      .then((org) => {
        if (gone) return;
        const roles = Array.isArray(org?.roles) ? org.roles : [];
        setChartNames(roles.map((r: { name?: unknown }) => String(r?.name ?? "")));
      })
      .catch(() => {
        if (!gone) setChartNames([]);
      });
    return () => {
      gone = true;
    };
  }, []);

  // Until the chart has been read, no idea is offered: offering one the chart
  // already carries, then taking it back, would be worse than a short wait.
  const ideas: CharacterRoleIdea[] = chartNames === null ? [] : unmetRoleIdeas(archetypeKey, chartNames);

  return (
    <section aria-labelledby="roles-open-now" className="mt-6">
      <h3 id="roles-open-now" className="text-sm font-semibold uppercase tracking-wide text-teal-deep">
        <Trans context="character card section heading">Roles open now</Trans>
      </h3>

      {alsoOpen.length > 0 ? (
        <>
          <p className="mt-1 text-sm text-sage">
            <Trans context="character card, open roles tagged for no character">Also open in the village, for anyone:</Trans>
          </p>
          <ul className="mt-2 space-y-2">
            {alsoOpen.map((r) => {
              const name = r.name;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-sage/30 px-3 py-2">
                  <span className="min-w-0 flex-1 break-words text-sm text-teal-deep">{name}</span>
                  <Link href={applySeatsHref([r.id])} className="inline-flex min-h-11 items-center text-sm font-medium text-teal-deep underline">
                    <Trans context="character card, apply for one open role">Apply for {name}</Trans>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {ideas.length > 0 ? (
        <>
          <p className="mt-4 text-sm text-sage">
            <Trans context="character card, role ideas the village does not have yet">Roles this character could open. Propose one and the village decides:</Trans>
          </p>
          <ul className="mt-2 space-y-2">
            {ideas.map((idea) => (
              <li key={idea.slug} className="rounded-lg border border-dashed border-teal-deep/40 px-3 py-2">
                <p className="text-sm font-semibold text-teal-deep">{idea.name}</p>
                <p className="mt-0.5 text-sm text-sage">{idea.aim}</p>
              </li>
            ))}
          </ul>
          <Link href="/role-proposals/new" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-teal-deep underline">
            <Trans context="character card, open the role proposal">Propose a new role</Trans>
          </Link>
        </>
      ) : null}

      {alsoOpen.length === 0 && ideas.length === 0 && chartNames !== null ? (
        <p className="mt-2 text-sm text-sage">
          <Trans context="character card, nothing open right now">No role is open right now.</Trans>{" "}
          <Link href="/quests" className="font-medium text-teal-deep underline">
            <Trans context="character card, link to the quest board">Try a quest on the board</Trans>
          </Link>{" "}
          <Trans context="character card, joins two links">or</Trans>{" "}
          <Link href="/roles" className="font-medium text-teal-deep underline">
            <Trans context="character card, link to every role">see every role</Trans>
          </Link>
        </p>
      ) : null}
    </section>
  );
}
