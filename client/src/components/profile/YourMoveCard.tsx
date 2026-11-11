/**
 * YOUR MOVE, first on your own profile (guide v2, Rye 10 Nov 2026: "whose move
 * it is"). The guide-v2 audit found a new holder's role terms waiting on them
 * on /aligned ("not yet") with nothing on their profile saying so, while the
 * profile led with proposing for next season.
 *
 * It lists what waits on YOU to align with, each linking to where you align:
 * your role's terms, the confidentiality agreement. Nothing waiting, it draws
 * nothing, so the profile reads as before.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { authToken } from "@/lib/gameApi";
import { fetchMyAlignments, type ServedAlignment } from "@/components/alignment/alignmentsApi";

/** What waits on this reader: a text they are a party to, have not aligned with, and may align with now. */
export function waitingOnYou(alignments: readonly ServedAlignment[] | null | undefined): ServedAlignment[] {
  // A response without the list (an older server, a page's own test mock) waits on nothing.
  if (!Array.isArray(alignments)) return [];
  return alignments.filter((a) => a.you && !a.you.aligned && a.you.mayAlign);
}

/** `embedded`: inside the profile's "Your path" card (the Root), as a list with a small heading and no frame or footer of its own. */
export default function YourMoveCard({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useLingui();
  const [waiting, setWaiting] = useState<ServedAlignment[]>([]);
  useEffect(() => {
    if (!authToken()) return;
    let alive = true;
    void fetchMyAlignments().then((r) => {
      if (alive && r.ok) setWaiting(waitingOnYou(r.data?.alignments));
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!waiting.length) return null;
  return (
    <section aria-labelledby="your-move" className={embedded ? "rounded-xl border border-border bg-muted p-4" : "rounded-2xl border-2 border-primary/40 bg-card p-5"} data-your-move="">
      <h2 id="your-move" className={`font-display font-bold text-card-foreground ${embedded ? "text-lg" : "text-2xl"}`}>
        {t({ message: "Your move", context: "profile, what waits on you" })}
      </h2>
      <ul className="mt-3 grid gap-2">
        {waiting.map((a) => {
          const title = a.title;
          return (
            <li key={`${a.textId ?? a.title}-${a.version}`}>
              <Link
                href={a.href ?? "/aligned"}
                className={
                  embedded
                    ? "inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-card focus-visible:outline-2 focus-visible:outline-ring"
                    : "inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                }
              >
                {t({ message: `Align with ${title}`, context: "profile, your move" })}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
      {/* The footer spoke of a role starting to anybody with any text waiting, role or not (STATE_MAP C24). Inside the path card it goes. */}
      {!embedded && <p className="mt-3 text-sm text-muted-foreground">{t`Aligning is the village's way of signing. Your role starts once every agreement it needs is aligned with.`}</p>}
    </section>
  );
}
