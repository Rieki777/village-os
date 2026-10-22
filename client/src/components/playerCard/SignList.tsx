/**
 * Signs: each count with its trend against the moon before, and a tap that
 * opens the rows behind it at the reader's tier. The sheet lists rows in the
 * order they happened, never ranked, with first names only.
 */
import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { CARD_WORDS as W, type SignOut } from "@shared/playerCard";
import { formatDay } from "@shared/roleSheet";
import type { SignSheetOut } from "@shared/playerCardPayload";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

function TrendLine({ sign }: { sign: SignOut }) {
  if (sign.reading.kind !== "counted" || !sign.reading.trend) return null;
  const t = sign.reading.trend;
  if (t.kind === "later") return <span className="text-xs text-muted-foreground">{W.trendLater}</span>;
  const Icon = t.direction === "up" ? ArrowUp : t.direction === "down" ? ArrowDown : ArrowRight;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {W.trend[t.direction]}
    </span>
  );
}

function SignBody({ sign }: { sign: SignOut }) {
  return (
    <>
      <span className="font-display text-2xl font-bold text-card-foreground">{sign.value}</span>
      <span className="text-sm text-card-foreground">{sign.measure}</span>
      {sign.target ? <span className="text-xs text-muted-foreground">{W.ofTarget(sign.target.n)}</span> : null}
      <TrendLine sign={sign} />
      {sign.from ? <span className="text-xs text-muted-foreground">{sign.from}</span> : null}
    </>
  );
}

const TILE = "flex min-h-11 w-full flex-col items-start gap-1 rounded-xl border border-border/70 p-3 text-left";

export function SignList({ signs, sheets, timeZone }: { signs: SignOut[]; sheets: Record<string, SignSheetOut>; timeZone: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const sheet = open ? sheets[open] : undefined;
  return (
    <>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {signs.map((s, i) => (
          <li key={`${s.roleId}-${i}`}>
            {s.sheetKey && sheets[s.sheetKey] ? (
              <button
                type="button"
                onClick={() => setOpen(s.sheetKey)}
                aria-label={W.openSheet(s.measure)}
                className={`${TILE} hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring`}
              >
                <SignBody sign={s} />
              </button>
            ) : (
              <div className={TILE}>
                <SignBody sign={s} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={!!sheet} onOpenChange={(o) => !o && setOpen(null)}>
        {sheet ? (
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogTitle>{sheet.title}</DialogTitle>
            <DialogDescription>
              {sheet.countedFrom} {sheet.note}
            </DialogDescription>
            {sheet.rows.length ? (
              <ul className="grid gap-1 text-sm">
                {sheet.rows.map((r, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2 border-b border-border/60 py-2">
                    {r.at ? <span className="text-muted-foreground">{formatDay(r.at, false, timeZone)}</span> : null}
                    {r.who ? <span className="font-medium">{r.who}</span> : null}
                    <span>{r.words}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to show in this window yet</p>
            )}
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
