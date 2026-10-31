/**
 * EVERY READ THE DASHBOARD TAKES, in one place (approved design, 2026-10-30).
 *
 * Nothing here is new on the server. Each figure comes off a door that already
 * answers for this member, and each door is read once for the whole page:
 *
 *   /api/me/wallet                 the village token and Voice, with their scale
 *   /api/game/ledger               what moved, for "this moon" and the latest lines
 *   /api/game/cycle                this moon's bounds and the days it has left
 *   /api/game/cycle/distributions  the closed moons' bounds, for "earned by moon"
 *   /api/game/gratitude/me         thanks received, and the giving allowance
 *   /api/me/cash-owed              cash owed, claimed and paid (0285)
 *   /api/badges/of/:id             badges held, and the featured cap (the flower)
 *   /api/season                    the season's name and its days
 *   /api/governance/waiting-on-me  consents asked of this member
 *   /api/sessions/tasks/count      tasks waiting and the nearest date
 *   /api/messages                  unread conversations, and the parties (work chats)
 *   /api/sessions                  the next meeting of a circle this member sits in
 *   /api/quests                    what a claimed quest pays when it is consented
 *
 * EVERY FIELD IS NULL UNTIL ITS DOOR ANSWERS, and stays null when the door is
 * closed (a module off answers 404) or fails. The components draw nothing, or
 * an honest empty line, for a null; none of them draws a zero standing in for
 * an answer that never came.
 */
import { useEffect, useState } from "react";
import { authToken, gameFetch } from "@/lib/gameApi";
import { onProfileRefresh } from "@/lib/profileRefresh";
import type { CashOwedEntry } from "@shared/cashOwed";
import type { WaitingConsent } from "@shared/waitingOnYou";
import { WAITING_URL } from "@shared/waitingOnYou";
import type { WorkPay } from "@shared/workValue";
import type { FlowerBadge } from "@/components/badges/BadgeFlower";
import type { InboxConversation } from "@/lib/messaging";
import { partiesOf, type Party } from "./PartiesCard";

export interface WalletRowLite {
  token: string;
  name: string;
  kind: string;
  role: "claimable" | "village" | "gratitude";
  decimals: number;
  heldUnits: number;
}

export interface LedgerLine {
  tokenType: string;
  tokenName: string;
  amount: number;
  decimals: number;
  source: string;
  description: string;
  at: string;
  withName?: string;
}

export interface MoonWindow {
  id: string;
  cycleNumber: number;
  startsAt: string;
  endsAt: string;
}

export interface DashData {
  wallet: WalletRowLite[] | null;
  ledger: LedgerLine[] | null;
  cycle: (MoonWindow & { daysRemaining: number | null }) | null;
  pastMoons: MoonWindow[] | null;
  gratitude: { receivedThisCycle: number; remaining: number; total: number } | null;
  cash: CashOwedEntry[] | null;
  badges: number | null;
  /** The badges themselves, featured first, for the flower on the portrait. */
  badgeList: FlowerBadge[] | null;
  /** How many may show on the card (`badges.max_featured`). */
  maxFeatured: number | null;
  season: { name: string; day: number | null; of: number | null } | null;
  consents: WaitingConsent[] | null;
  tasks: { waiting: number; nextDue: string | null } | null;
  messages: {
    unreadTotal: number;
    top: { id: string; title: string; preview: string; unread: number } | null;
    /** The shared chat of each quest or task this member is on (PR #642), newest first. */
    parties: Party[];
  } | null;
  session: { circle: string; title: string | null; words: string; href: string } | null;
  questPay: Record<string, WorkPay> | null;
}

const EMPTY: DashData = {
  wallet: null,
  ledger: null,
  cycle: null,
  pastMoons: null,
  gratitude: null,
  cash: null,
  badges: null,
  badgeList: null,
  maxFeatured: null,
  season: null,
  consents: null,
  tasks: null,
  messages: null,
  session: null,
  questPay: null,
};

/** The body of a door that answered, or null for one that did not. Never throws. */
async function read<T>(url: string): Promise<T | null> {
  try {
    const r = await gameFetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Whole days between two ISO dates (YYYY-MM-DD or full), counting the first as day 1. */
function dayOf(startsOn: string, today: string): number | null {
  const a = Date.parse(startsOn.slice(0, 10));
  const b = Date.parse(today.slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export function useDashData(userId: string | number | null | undefined): DashData {
  const [data, setData] = useState<DashData>(EMPTY);

  useEffect(() => {
    if (!authToken() || userId == null) return;
    let live = true;
    const put = (patch: Partial<DashData>) => {
      if (live) setData((d) => ({ ...d, ...patch }));
    };

    const load = () => {
      read<{ rows: WalletRowLite[] }>("/api/me/wallet").then((w) => put({ wallet: w?.rows ?? null }));
      read<{ entries: LedgerLine[] }>("/api/game/ledger").then((l) => put({ ledger: l?.entries ?? null }));
      read<MoonWindow & { daysRemaining?: number }>("/api/game/cycle").then((c) =>
        put({ cycle: c?.startsAt ? { ...c, daysRemaining: typeof c.daysRemaining === "number" ? c.daysRemaining : null } : null }),
      );
      read<MoonWindow[]>("/api/game/cycle/distributions").then((d) => put({ pastMoons: Array.isArray(d) ? d : null }));
      read<{ received: Array<{ amount: number; cycleId: string }>; budget: { remaining: number; total: number; cycleId: string } }>(
        "/api/game/gratitude/me",
      ).then((g) =>
        put({
          gratitude: g?.budget
            ? {
                receivedThisCycle: (g.received ?? [])
                  .filter((r) => r.cycleId === g.budget.cycleId)
                  .reduce((n, r) => n + (Number(r.amount) || 0), 0),
                remaining: Number(g.budget.remaining) || 0,
                total: Number(g.budget.total) || 0,
              }
            : null,
        }),
      );
      read<{ entries: CashOwedEntry[] }>("/api/me/cash-owed").then((c) => put({ cash: c?.entries ?? null }));
      read<{ badges: FlowerBadge[]; maxFeatured?: number }>(`/api/badges/of/${encodeURIComponent(String(userId))}`).then((b) => {
        const list = Array.isArray(b?.badges) ? b.badges : null;
        put({
          badges: list ? list.length : null,
          badgeList: list,
          maxFeatured: typeof b?.maxFeatured === "number" ? b.maxFeatured : null,
        });
      });
      read<{ current: { name: string; startsOn: string; endsOn?: string | null } | null; today: string }>("/api/season").then((s) => {
        const cur = s?.current;
        if (!cur?.name) return put({ season: null });
        const day = s?.today ? dayOf(cur.startsOn, s.today) : null;
        const of = cur.endsOn ? dayOf(cur.startsOn, cur.endsOn) : null;
        put({ season: { name: cur.name, day, of: of !== null ? Math.max(1, of - 1) : null } });
      });
      read<{ toConsent?: WaitingConsent[] }>(WAITING_URL).then((w) => put({ consents: w ? (w.toConsent ?? []) : null }));
      read<{ waiting: number; nextDue: string | null }>("/api/sessions/tasks/count").then((t) =>
        put({ tasks: t && typeof t.waiting === "number" ? { waiting: t.waiting, nextDue: t.nextDue ?? null } : null }),
      );
      read<{ unreadTotal: number; conversations: InboxConversation[] }>("/api/messages").then((m) => {
        if (!m || typeof m.unreadTotal !== "number") return put({ messages: null });
        const top = (m.conversations ?? []).find((c) => c.unreadCount > 0 && !c.muted) ?? null;
        put({
          messages: {
            unreadTotal: m.unreadTotal,
            top: top
              ? { id: String(top.id), title: String(top.title || top.name || ""), preview: String(top.preview ?? ""), unread: top.unreadCount }
              : null,
            parties: partiesOf(m.conversations ?? [], String(userId)),
          },
        });
      });
      read<{ comingUp?: { rows: Array<{ circleName: string; nextTitle: string | null; words: string; mine: boolean; openRoom: { id: number } | null }> } }>(
        "/api/sessions",
      ).then((s) => {
        const row = s?.comingUp?.rows?.find((r) => r.mine) ?? null;
        put({
          session: row
            ? {
                circle: row.circleName,
                title: row.nextTitle,
                words: row.words,
                href: row.openRoom ? `/sessions/${row.openRoom.id}` : "/sessions",
              }
            : null,
        });
      });
      read<Array<{ id: string; pay?: WorkPay }>>("/api/quests").then((q) =>
        put({
          questPay: Array.isArray(q)
            ? Object.fromEntries(q.filter((x) => x.pay).map((x) => [String(x.id), x.pay as WorkPay]))
            : null,
        }),
      );
    };

    load();
    const off = onProfileRefresh(load);
    return () => {
      live = false;
      off();
    };
  }, [userId]);

  return data;
}
