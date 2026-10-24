/**
 * Signs, as the approved design draws them: the count large in gold, a meter
 * under it, what is counted, and where it is counted from. Each keeps its
 * trend against the moon before, and a tap opens the rows behind it at the
 * reader's tier. The sheet lists rows in the order they happened, never
 * ranked, with first names only.
 *
 * THE METER is the count's own fraction ("9 of 10"), or the count against the
 * sign's target when it has one and no fraction of its own. A sign with
 * neither, or not counted yet, draws an empty meter: the design's shape, with
 * nothing claimed.
 */
import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { CARD_WORDS as W, type SignOut } from "@shared/playerCard";
import { formatDay } from "@shared/roleSheet";
import type { SignSheetOut } from "@shared/playerCardPayload";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** How full the sign's meter is, 0 to 100. */
export function meterOf(sign: SignOut): number {
  if (sign.reading.kind !== "counted") return 0;
  const { n, of } = sign.reading.now;
  const whole = of ?? sign.target?.n;
  if (!whole || whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((n / whole) * 100)));
}

function TrendLine({ sign }: { sign: SignOut }) {
  if (sign.reading.kind !== "counted" || !sign.reading.trend) return null;
  const t = sign.reading.trend;
  if (t.kind === "later") return <span className="pc-trend">{W.trendLater}</span>;
  const Icon = t.direction === "up" ? ArrowUp : t.direction === "down" ? ArrowDown : ArrowRight;
  return (
    <span className="pc-trend">
      <Icon width={14} height={14} aria-hidden="true" />
      {W.trend[t.direction]}
    </span>
  );
}

function SignBody({ sign }: { sign: SignOut }) {
  return (
    <>
      <span className="pc-num">{sign.value}</span>
      <span className="pc-meter" aria-hidden="true">
        <i style={{ width: `${meterOf(sign)}%` }} />
      </span>
      <span className="pc-what">{sign.measure}</span>
      {sign.target ? <span className="pc-trend">{W.ofTarget(sign.target.n)}</span> : null}
      <TrendLine sign={sign} />
      {sign.from ? <span className="pc-from">{sign.from}</span> : null}
    </>
  );
}

export function SignList({ signs, sheets, timeZone }: { signs: SignOut[]; sheets: Record<string, SignSheetOut>; timeZone: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const sheet = open ? sheets[open] : undefined;
  return (
    <>
      <ul className="pc-signs">
        {signs.map((s, i) => (
          <li key={`${s.roleId}-${i}`}>
            {s.sheetKey && sheets[s.sheetKey] ? (
              <button type="button" onClick={() => setOpen(s.sheetKey)} aria-label={W.openSheet(s.measure)} className="pc-sign">
                <SignBody sign={s} />
              </button>
            ) : (
              <div className="pc-sign">
                <SignBody sign={s} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={!!sheet} onOpenChange={(o) => !o && setOpen(null)}>
        {sheet ? (
          <DialogContent className="pc-night pc-sheet max-h-[85vh] overflow-y-auto">
            <DialogTitle className="font-normal" style={{ fontFamily: "var(--pc-display)" }}>
              {sheet.title}
            </DialogTitle>
            <DialogDescription>
              {sheet.countedFrom} {sheet.note}
            </DialogDescription>
            {sheet.rows.length ? (
              <ul>
                {sheet.rows.map((r, i) => (
                  <li key={i}>
                    {r.at ? <span className="pc-dim">{formatDay(r.at, false, timeZone)}</span> : null}
                    {r.who ? <b>{r.who}</b> : null}
                    <span>{r.words}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pc-dim pc-f14">Nothing to show in this window yet</p>
            )}
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
