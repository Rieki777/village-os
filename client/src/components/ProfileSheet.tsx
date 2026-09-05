/**
 * The character-sheet sections of your own profile: Standing, Gratitude, your
 * and where you are in this moon. The party itself lives in ProfileHero.
 *
 * A separate component rather than four more blocks inside a page that is
 * already long, and it owns its own fetch. That means the sections appear when
 * the economy has something to say and stay quiet when it does not, without
 * the host page learning anything about tokens.
 *
 * Everything here is a LENS over the ledger. No number is stored on a profile
 * and none is computed twice: the server reads balances from `token_balances`
 * and the allowance from the gratitude rows, and this renders what arrives.
 *
 * Deliberately absent: Inventory. Borrowed items, booked stays and reserved
 * lots are real and this endpoint does not carry them yet, and a section that
 * renders an empty box tells a member they have nothing rather than that
 * nobody has asked. It arrives when the read does.
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { authToken } from "@/lib/gameApi";
import { useTokenName } from "@/hooks/useTokenNames";
import { formatTokenAmount } from "@/lib/tokenAmount";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

interface Sheet {
  standing?: Array<{ token: string; name: string; balance: number; decimals: number }>;
  gratitude?: { receivedThisSeason: number; givenThisSeason: number; lifetime: number };
  party?: Array<{ id: string; archetypeKey: string; avatar: string | null; isPrimary: boolean }>;
  allowance?: { total: number; spent: number; remaining: number; cycleKey: string };
  moonsOnTheLand?: number;
}

/*
 * This card's own copy of the minor-units rule is gone.
 *
 * It was RIGHT, and being right in one file is what caused the damage: the
 * wallet had no copy at all and printed 10000 for the same ten Voice this chip
 * printed correctly, an inch apart on the same profile. One rule, one file, so
 * a surface can only be wrong by forgetting to call it, which is visible.
 */

const card = "bg-card rounded-2xl shadow-lg p-8";
const heading = "text-2xl font-display font-bold text-card-foreground mb-6";

export default function ProfileSheet() {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const tokenName = useTokenName("Recognition");

  useEffect(() => {
    fetch("/api/me/profile", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSheet(d))
      .catch(() => {});
  }, []);

  if (!sheet) return null;

  const standing = sheet.standing ?? [];
  const party = sheet.party ?? [];
  const g = sheet.gratitude;
  const a = sheet.allowance;
  // Somebody who has held nothing and thanked nobody is NEW, and a screenful of
  // zeros is the wrong first thing to tell them. The whole block stays away
  // until there is something true to say.
  const nothingYet = standing.length === 0 && !party.length && (!g || g.receivedThisSeason === 0);
  if (nothingYet) return null;

  return (
    <>
      {/* Your Party has moved to ProfileHero, at the very top of the page.
          A member's characters are the first thing the sheet should answer,
          and having them here as well would be the same row twice. */}
      {standing.length > 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={card}>
          <h2 className={heading}>Standing</h2>
          <ul className="flex flex-wrap gap-2">
            {standing.map((s) => (
              <li
                key={s.token}
                className="rounded-full border border-border bg-muted px-4 py-2 text-sm font-medium text-card-foreground"
              >
                {formatTokenAmount(s.balance, s.decimals)} {s.name}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            {tokenName}: held, never spent. A record of what the village noticed.
          </p>
        </motion.div>
      ) : null}

      {g ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={card}>
          <h2 className={heading}>{tokenName}</h2>
          <p className="text-card-foreground">
            {g.receivedThisSeason === 0
              ? "No thanks yet this season."
              : `Thanked by ${g.receivedThisSeason} members this season.`}
          </p>
          {/* Given sits beside received, never beneath it. Generosity is a
              status axis here, and a sheet showing one number teaches members
              to collect instead of to notice each other. */}
          <p className="mt-1 text-card-foreground">
            {g.givenThisSeason === 0
              ? "You have not thanked anyone yet this season."
              : `You thanked ${g.givenThisSeason} members in return.`}
          </p>
          <p className="mt-3 text-sm text-muted-foreground">{g.lifetime} {tokenName} held in all.</p>
        </motion.div>
      ) : null}

      {a ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={card}>
          <h2 className={heading}>This moon</h2>
          <p className="text-card-foreground">
            {a.remaining === 0
              ? "You have given everything you had to give this moon."
              : `You can still give ${a.remaining} ${tokenName} this moon.`}
          </p>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${a.remaining} of ${a.total} left`}
          >
            <div
              className="h-full rounded-full bg-teal-deep"
              /* Clamped, because a dial lowered mid-cycle can leave spent above
                 total and a bar wider than its track is a rendering bug that
                 looks like a data one. */
              style={{ width: `${Math.min(100, Math.max(0, (a.remaining / (a.total || 1)) * 100))}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            The allowance resets with the new moon. Nothing you were given is ever taken back.
          </p>
        </motion.div>
      ) : null}
    </>
  );
}
