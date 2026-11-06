/**
 * A module's history, on its page: when it went on, paused or went off, who
 * did it, and which vote did it when a vote did. Signed-in readers only; the
 * server (`GET /api/modules/:id/history`) decides what each reader may see, so
 * a member never learns about a preview and a visitor sees no names at all.
 */
import { Link } from "wouter";
import { History } from "lucide-react";
import { lifecycleWords } from "@shared/moduleSwitch";
import type { HistoryEvent } from "./catalog";

const day = (iso: string) => new Date(iso).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" });

export function historySentence(e: HistoryEvent): string {
  const to = lifecycleWords(e.to).toLowerCase();
  const reach: Record<string, string> = { preview: "in preview", members: "for members", public: "for everyone" };
  const what = e.to === "off" ? "Turned off" : e.from === "off" ? `Turned on ${reach[e.to] ?? ""}`.trim() : `Moved to ${to}`;
  return e.ballot ? `${what}, by the village's vote` : e.by ? `${what} by ${e.by}` : what;
}

export default function ModuleHistoryStrip({ events }: { events: HistoryEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="module-history" className="mt-8">
      <h2 id="module-history" className="flex items-center gap-2 font-semibold text-foreground mb-2">
        <History className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        Its history here
      </h2>
      <ol className="space-y-1.5 text-sm">
        {events.slice(0, 8).map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex flex-wrap gap-x-2 text-muted-foreground">
            <span className="text-foreground">{day(e.at)}</span>
            <span>{historySentence(e)}</span>
            {e.ballot && (
              <Link href={`/decisions/${e.ballot.id}`} className="text-teal-deep underline">
                Read the vote
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
