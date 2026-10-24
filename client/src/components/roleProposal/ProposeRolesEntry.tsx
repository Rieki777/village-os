/**
 * "Propose my roles for next season", on the member's own profile (role
 * proposals PR C), always there for a signed-in member.
 *
 * It reads `GET /api/governance/role-proposals/mine` once. With a draft open
 * it reads "Continue my proposal for next season" and opens that draft; with
 * none it starts one from the member's current card (/role-proposals/new).
 * The read answers a guest 403 and a village with governance off 404, and
 * either way nothing is drawn: a button that leads to a refusal is worse
 * than none. Nobody signed out is asked anything.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { fetchMine, type MineOut } from "./proposalApi";
import { RP_WORDS } from "./proposalWords";
import { FOCUS } from "./parts";

export default function ProposeRolesEntry() {
  const [mine, setMine] = useState<MineOut | null>(null);
  useEffect(() => {
    if (!authToken()) return;
    let alive = true;
    void fetchMine().then((r) => {
      if (alive && r.ok) setMine(r.data);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!mine) return null;
  const draft = mine.draftId;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2" data-propose-entry={draft ? "continue" : "propose"}>
      <Link
        href={draft ? `/role-proposals/${encodeURIComponent(draft)}` : "/role-proposals/new"}
        className={`inline-flex min-h-11 items-center gap-2 rounded-lg bg-teal-deep px-4 py-2 font-semibold text-white hover:bg-teal-deep-dark ${FOCUS}`}
      >
        {draft ? RP_WORDS.continue : RP_WORDS.propose}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
      {mine.nextSeasonWords && <span className="text-sm text-muted-foreground">{mine.nextSeasonWords}</span>}
    </div>
  );
}
