/**
 * TODAY: what is waiting on this member, as four doors (approved design,
 * 2026-10-30).
 *
 *   a consent      the first role proposal their circle is asked about
 *                  (/api/governance/waiting-on-me, `toConsent`)
 *   tasks          how many session tasks wait, and the nearest date
 *                  (/api/sessions/tasks/count)
 *   unread         the newest unread conversation (/api/messages)
 *   a session      the next meeting of a circle they sit in (/api/sessions)
 *
 * Each card stands only when its read answered with something to say, so a
 * village with the sessions module off simply has fewer cards. The design's
 * "clear them all for a full moon streak" line is left out: the platform keeps
 * no streak, and a promise of one would be a reward that never arrives.
 */
import { Link } from "wouter";
import type { DashData } from "./useDashData";
import { daysUntil } from "./dashModel";

type Tone = "gold" | "cash" | "session";
const TONE_TEXT: Record<Tone, string> = { gold: "text-dash-gold-lit", cash: "text-dash-cash", session: "text-dash-session" };
const TONE_EDGE: Record<Tone, string> = { gold: "border-dash-warm-edge", cash: "border-dash-edge", session: "border-dash-edge" };

interface TodayCard {
  key: string;
  kicker: string;
  title: string;
  meta: string;
  href: string;
  tone: Tone;
}

/**
 * A due date in calendar days, the reader's own: a task due at six this
 * evening is due TODAY, whatever the hours say. A bare "YYYY-MM-DD" is that
 * day where the reader is, never UTC midnight shifted into yesterday.
 */
const dayWords = (iso: string, now = new Date()): string => {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const due = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(iso);
  if (!Number.isFinite(due.getTime())) return "";
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const left = Math.round((day(due) - day(now)) / 86_400_000);
  if (left < 0) return "Overdue";
  if (left === 0) return "Due today";
  if (left === 1) return "Due tomorrow";
  return `Due ${due.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
};

/** The cards, in the design's order. Pure, so the order and the wording are testable. */
export function todayCards(d: Pick<DashData, "consents" | "tasks" | "messages" | "session"> & Partial<Pick<DashData, "asks">>, now = new Date()): TodayCard[] {
  const out: TodayCard[] = [];
  // Someone is stuck on this member first: an ask marked blocking leads the strip.
  if (d.asks && d.asks.waiting > 0) {
    out.push({
      key: "asks",
      kicker: d.asks.blocking > 0 ? "Someone is stuck on you" : "Asked of you",
      title: d.asks.waiting === 1 ? "One ask waiting on you" : `${d.asks.waiting} asks waiting on you`,
      meta: d.asks.blocking > 0 ? `${d.asks.blocking} blocking · Open your asks` : "Open your asks",
      href: "/profile#waiting",
      tone: "gold",
    });
  }
  const consent = d.consents?.[0];
  if (consent) {
    const left = daysUntil(consent.closesOn, now);
    const more = (d.consents?.length ?? 0) - 1;
    out.push({
      key: "consent",
      kicker: ["Your consent", left === null ? "" : left === 0 ? "closes today" : `${left} ${left === 1 ? "day" : "days"} left`].filter(Boolean).join(" · "),
      title: `${consent.circle}: ${consent.roles.join(", ")}`,
      meta: more > 0 ? `Consent or object · ${more} more waiting` : "Consent or object",
      href: consent.href,
      tone: "gold",
    });
  }
  if (d.tasks && d.tasks.waiting > 0) {
    out.push({
      key: "tasks",
      kicker: d.tasks.nextDue ? dayWords(d.tasks.nextDue, now) : "Waiting on you",
      title: d.tasks.waiting === 1 ? "One task from your sessions" : `${d.tasks.waiting} tasks from your sessions`,
      meta: "Open your task board",
      href: "/profile#my-tasks",
      tone: "gold",
    });
  }
  if (d.messages && d.messages.unreadTotal > 0) {
    const top = d.messages.top;
    out.push({
      key: "messages",
      kicker: `${d.messages.unreadTotal} unread`,
      title: top?.title || "Your messages",
      meta: top?.preview ?? "",
      href: top ? `/messages/${encodeURIComponent(top.id)}` : "/messages",
      tone: "cash",
    });
  }
  if (d.session) {
    out.push({
      key: "session",
      kicker: `Live session · ${d.session.words}`,
      title: d.session.title || d.session.circle,
      meta: "Add to the agenda",
      href: d.session.href,
      tone: "session",
    });
  }
  return out;
}

export default function TodayStrip({ data }: { data: DashData }) {
  const cards = todayCards(data);
  const anyRead = data.consents !== null || data.tasks !== null || data.messages !== null || data.session !== null || data.asks !== null;
  if (!anyRead) return null;
  const waiting =
    (data.asks?.waiting ?? 0) + (data.consents?.length ?? 0) + (data.tasks?.waiting ?? 0) + (data.messages && data.messages.unreadTotal > 0 ? 1 : 0);

  return (
    <section aria-labelledby="today-h" className="flex flex-col gap-2.5 sm:gap-3.5">
      <div className="flex flex-wrap items-baseline gap-3.5">
        <h2 id="today-h" className="m-0 font-display text-[28px] leading-tight sm:text-[34px]">
          Today
        </h2>
        <p className="m-0 hidden text-[15px] text-muted-foreground sm:block">
          {waiting === 0 ? "Nothing is waiting on you" : waiting === 1 ? "1 thing waiting on you" : `${waiting} things waiting on you`}
        </p>
      </div>
      {cards.length === 0 ? (
        <p className="m-0 rounded-[18px] border border-dash-edge bg-card p-[18px] text-[15px] text-muted-foreground">
          Nothing waits on you today. Your quests and roles are below.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-[repeat(auto-fit,minmax(250px,1fr))] sm:gap-4">
          {cards.map((c) => (
            <li key={c.key} className="flex">
              <Link
                href={c.href}
                className={`flex w-full flex-col gap-1 rounded-[14px] border bg-card p-3.5 text-foreground no-underline hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[130px] sm:gap-2 sm:rounded-[18px] sm:p-[18px] ${TONE_EDGE[c.tone]}`}
              >
                <span className={`text-[11px] font-semibold uppercase tracking-[0.12em] sm:text-xs ${TONE_TEXT[c.tone]}`}>{c.kicker}</span>
                <span className="text-[15px] font-medium sm:text-[17px]">{c.title}</span>
                {c.meta ? <span className="mt-auto hidden text-[13px] text-muted-foreground sm:block">{c.meta}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
