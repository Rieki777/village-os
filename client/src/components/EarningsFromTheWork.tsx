/**
 * WHAT QUESTS AND ROLES PAY, READ FROM THE WORK ITSELF (0265, Rye 2026-10-21).
 *
 * The Co-Creators Guide used to type its own payout figures ("40-300", "200-500
 * a month"), and nothing in the platform paid them. This reads what the board's
 * quests and the village's roles are actually set to, through the same `pay`
 * their cards render, so a general page stays true as values change.
 *
 * Roles say what they pay only to a reader who may read their terms, the same
 * tier the role cards use (server/lib/seatProjection.ts), so a visitor is told
 * where to look and shown no figure.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2 } from "lucide-react";
import { gameFetch } from "@/lib/gameApi";
import { paySummary, summaryWords, type WorkPay } from "@/lib/workPay";

interface Read {
  quests: Array<WorkPay | null | undefined> | null;
  /** Null when this reader is not shown what roles pay. */
  roles: Array<WorkPay | null | undefined> | null;
}

export default function EarningsFromTheWork() {
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
        ? quests.filter((q: any) => !q?.isExample && String(q?.status ?? "").trim().toLowerCase() !== "closed")
        : null;
      const roles = Array.isArray(org?.roles) ? org.roles.filter((r: any) => !r?.isExample && "pay" in r) : [];
      setRead({
        quests: openQuests ? openQuests.map((q: any) => q.pay) : null,
        roles: roles.length ? roles.map((r: any) => r.pay) : null,
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const questLine = (() => {
    if (!read) return "Reading what the board's quests pay.";
    if (!read.quests) return "Every quest card says what it pays.";
    const s = paySummary(read.quests);
    const words = summaryWords(s);
    if (!words) return "Every quest card says what it pays. None has a value set yet, so each says to inquire.";
    return `${s.valued} of ${s.count} open quests carry a value, ${words}.`;
  })();

  const roleLine = (() => {
    if (!read) return "Reading what roles pay.";
    if (!read.roles) return "Each role says what it pays on its card, for members, and its agreement states any cash.";
    const s = paySummary(read.roles);
    const words = summaryWords(s);
    if (!words) return "Each role says what it pays on its card. None has a value set yet, so each says to inquire.";
    return `${s.valued} of ${s.count} roles carry a value, ${words} each cycle. Any cash is stated in the role's agreement.`;
  })();

  const rows = [
    { label: "Quests", line: questLine, href: "/quests", link: "See the quest board" },
    { label: "Roles", line: roleLine, href: "/roles", link: "See the roles" },
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
