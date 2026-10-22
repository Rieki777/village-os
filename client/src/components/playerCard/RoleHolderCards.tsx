/**
 * ON /roles, UNDER ONE ROLE: HOW IT IS GOING, AND EACH HOLDER'S CARD (PR 3 of 7).
 *
 * Drawn only from the `/api/org` row the page already holds:
 *
 *   health   three facts and a dot per role (server/lib/orgRoleHealth.ts),
 *            read once for the whole page in a fixed number of queries
 *   handle   on each member holder row, at the member tier only
 *
 * Each holder gets "See their card", a plain link to
 * `/profile/:handle#role-<id>`, which lands on that role's section of their
 * player card. The card itself loads only when somebody follows the link, so
 * this page never asks the card endpoint once per holder. A holder with no
 * handle (a documented holder, an agent, or a reader below the member tier)
 * gets no link: there is no card to open.
 */
import { Link } from "wouter";
import type { HealthDot } from "@shared/playerCardHealth";

export const ROLE_HOLDER_WORDS = {
  health: "How the role is going",
  seeCard: "See their card",
  seeCardOf: (name: string) => `See the card of ${name}`,
  openTensions: (n: number) => (n === 1 ? "1 open tension" : `${n} open tensions`),
} as const;

interface HealthRow {
  facts?: Array<{ words?: unknown }>;
  dot?: HealthDot;
  dotWords?: unknown;
  openTensions?: number | null;
}

/**
 * `/profile/:handle#role-<id>`: the holder's card, at this role. The anchor is
 * `ROLE_ANCHOR` (shared/playerCard.ts), spelled here so /roles does not carry
 * the whole card model; `RoleHolderCards.test.tsx` holds the two equal.
 */
export function holderCardHref(handle: string, roleId: string): string {
  return `/profile/${encodeURIComponent(handle)}#role-${roleId}`;
}

const DOT: Record<HealthDot, string> = {
  steady: "bg-sage",
  look: "bg-gold",
  act: "bg-coral",
};

export default function RoleHolderCards({ role }: { role: any }) {
  const health: HealthRow | null = role?.health && typeof role.health === "object" ? role.health : null;
  const holders: Array<{ name: string; handle: string }> = (Array.isArray(role?.holders) ? role.holders : [])
    .filter((h: any) => typeof h?.handle === "string" && h.handle && !h.isAgent)
    .map((h: any) => ({ name: String(h.name ?? ""), handle: String(h.handle) }));
  const facts = (health?.facts ?? []).map((f) => String(f?.words ?? "")).filter(Boolean);
  if (typeof health?.openTensions === "number") facts.push(ROLE_HOLDER_WORDS.openTensions(health.openTensions));
  if (!health && !holders.length) return null;
  return (
    <div data-role-holder-cards="" className="pt-4 border-t border-border space-y-2">
      {health ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
          <span className="font-medium">{ROLE_HOLDER_WORDS.health}:</span>
          {health.dot ? <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[health.dot] ?? "bg-muted"}`} /> : null}
          {health.dotWords ? <span className="font-medium">{String(health.dotWords)}</span> : null}
          {facts.length ? <span className="text-muted-foreground">{facts.join(" · ")}</span> : null}
        </p>
      ) : null}
      {holders.length ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {holders.map((h) => (
            <li key={h.handle} className="text-sm">
              <span className="text-muted-foreground">{h.name} </span>
              <Link
                href={holderCardHref(h.handle, String(role.id))}
                aria-label={ROLE_HOLDER_WORDS.seeCardOf(h.name)}
                className="inline-flex min-h-[44px] items-center font-medium text-foreground underline underline-offset-2"
              >
                {ROLE_HOLDER_WORDS.seeCard}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
