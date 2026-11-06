/**
 * HOW MUCH WORK THERE IS, READ FROM THE WORK ITSELF.
 *
 * The Co-Creators Guide used to type its own payout figures ("40-300", "200-500
 * a month"), and nothing in the platform paid them. Then this said what the
 * quests and roles were set to pay. Rye ruled on 2026-10-23 that no sentence
 * restates pay, because each quest and role card already shows its value, so
 * this now counts the open quests and the roles and links to them. The cards
 * say the rest.
 *
 * Example quests and example roles are not counted: they show what the work
 * looks like until the village posts its own, and nobody can take them.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2 } from "lucide-react";
import { gameFetch, useGameConfig } from "@/lib/gameApi";
import { villageWord, type CatalystLabel } from "@shared/villageWord";

/** The platform's word for a role until the village names its own: `ROLE_FALLBACK` in gameApi. */
const ROLE_WORD = "Role";

interface Read {
  /** Null when the board could not be read. */
  quests: number | null;
  /** Null when the roles could not be read. */
  roles: number | null;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The quest line: a count, or what to do when there is none to give. */
export function questLine(read: Read | null): string {
  if (!read) return "Reading the quest board.";
  if (read.quests === null) return "The quest board lists every open quest.";
  if (read.quests === 0) return "No open quests yet.";
  return count(read.quests, "open quest", "open quests");
}

/** The role line, the same way, in the village's own word for a role (Admin, Make This Yours). */
export function roleLine(read: Read | null, role: CatalystLabel = villageWord("", ROLE_WORD)): string {
  const one = role.name.toLowerCase();
  const many = role.plural.toLowerCase();
  if (!read) return `Reading the ${many}.`;
  if (read.roles === null) return `The ${many} page lists every ${one}.`;
  if (read.roles === 0) return `No ${many} yet.`;
  return count(read.roles, one, many);
}

export default function EarningsFromTheWork() {
  const role = villageWord(useGameConfig()?.project?.roleName, ROLE_WORD);
  const [read, setRead] = useState<Read | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/quests")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      gameFetch("/api/org")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([quests, org]) => {
      if (!alive) return;
      const openQuests = Array.isArray(quests)
        ? quests.filter((q: any) => !q?.isExample && String(q?.status ?? "").trim().toLowerCase() !== "closed").length
        : null;
      const roles = Array.isArray(org?.roles) ? org.roles.filter((r: any) => !r?.isExample).length : null;
      setRead({ quests: openQuests, roles });
    });
    return () => {
      alive = false;
    };
  }, []);

  const rows = [
    { label: "Quests", line: questLine(read), href: "/quests", link: "See the quest board" },
    { label: role.plural, line: roleLine(read, role), href: "/roles", link: `See the ${role.plural.toLowerCase()}` },
  ];

  return (
    <div className="space-y-3" data-earnings-from-the-work>
      {rows.map((row) => (
        <div key={row.label} className="flex items-start gap-3 pb-3 border-b border-muted last:border-0">
          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">{row.label}</p>
            <p className="text-xs text-muted-foreground">{row.line}</p>
            <Link href={row.href} className="text-xs text-teal-deep underline">
              {row.link}
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
