/**
 * THE BELL AS A PLACE (S16, rebuilt in round 5).
 *
 * What changed, and why each one:
 *
 *  - GROUPED, not one flat scroll. Five sections, declared in
 *    shared/notificationKinds.ts, ordered so anything unread sits at the top
 *    without the sections shuffling under a reader's hand.
 *
 *  - SEEN IS NOT READ. Opening the panel used to mark everything read, which
 *    meant a member who glanced at the bell lost the record of what they had
 *    actually dealt with. Opening now quiets the badge and touches nothing.
 *    Reading a line, by going to the thing it is about, marks that line. And
 *    "Mark all read" is a button that says HOW MANY it marked, with the rows
 *    staying in the list, visibly read, so it can never delete anything.
 *    (Knock and Novu both split seen from read; the argument is in
 *    docs/NOTIFICATION_RESEARCH.md part 1 section 2.)
 *
 *  - A BATCHED ROW OPENS, it does not link. Four library notices point at four
 *    different items, so sending one line to the newest of them would be a
 *    small lie told four times.
 *
 *  - THE ROW RENDERS WITHOUT ITS OBJECT. Title, body and link are stored text.
 *    A ballot that was withdrawn still reads, and can still be cleared. This is
 *    GitHub's phantom notification, answered before it happens.
 *
 * ACCESSIBILITY CONTRACT. The trigger is a button carrying `aria-expanded`,
 * `aria-controls`, and a label that speaks the whole string ("3 unread
 * notifications", never "3", per WCAG SC 4.1.3's own worked example). The
 * panel is a non-modal disclosure holding a list: focus moves into it on open,
 * Escape closes it and returns focus to the bell, and Tab is never trapped.
 * Unread carries a dot AND the word "New" AND a heavier weight, so colour is
 * never the only signal (SC 1.4.1). Every row and control clears 44px.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Bell, ChevronDown, Settings2 } from "lucide-react";
import { Link } from "wouter";
import { buildFeed, unreadIdsOf, type FeedRow } from "@/lib/notificationFeed";
import {
  getNotifyState,
  markNotificationsRead,
  markNotificationsSeen,
  refreshNotifications,
  subscribeNotifications,
} from "@/lib/notificationStore";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** The unread mark: a dot, a word, and a weight. Never the colour alone. */
function NewMark() {
  return (
    <span className="inline-flex items-center gap-1 shrink-0 text-[10px] font-bold uppercase tracking-wide text-teal-deep">
      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-teal-deep" />
      New
    </span>
  );
}

export default function NotificationBell() {
  const state = useSyncExternalStore(subscribeNotifications, getNotifyState, getNotifyState);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Layout mounts this component twice and hides one with CSS, so a literal
  // id would put two of the same id in the document. aria-controls pointing
  // at an ambiguous id is worse than no aria-controls at all.
  const uid = useId();

  const groups = useMemo(() => buildFeed(state.items), [state.items]);
  const unread = state.unread;
  // The badge counts UNSEEN, not unread. Opening the panel quiets it without
  // touching a single row's read state, which is the whole point: a number
  // that only clears by pretending to have read things is a number that
  // teaches people to stop opening the bell.
  const unseen = state.unseen;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Escape closes and hands focus back to the bell. The Disclosure pattern
  // does not specify this, so it is written out rather than assumed.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    setNote("");
    setOpen(true);
    // The list can be a poll old; opening is the one moment worth the full
    // read. Fired here and never inside the state updater: React invokes an
    // updater twice in development, and a fetch is not something to do twice.
    void refreshNotifications(true);
    void markNotificationsSeen();
  }, [open]);

  const readRow = useCallback((row: FeedRow) => {
    const ids = unreadIdsOf(row);
    if (ids.length) void markNotificationsRead(ids);
  }, []);

  const markAll = useCallback(async () => {
    const marked = await markNotificationsRead();
    setNote(
      marked === 0
        ? "Nothing was unread, so nothing changed."
        : `Marked ${marked} ${marked === 1 ? "notice" : "notices"} read. They stay in the list.`,
    );
  }, []);

  // The whole string, never the bare number: WCAG SC 4.1.3's own worked
  // example is a cart announcing "3 items" and not "3".
  const label =
    unseen > 0
      ? `Notifications, ${unseen} new`
      : unread > 0
        ? `Notifications, nothing new, ${unread} still unread`
        : "Notifications, nothing new";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${uid}-panel`}
        className="relative p-2 rounded-lg hover:bg-white/10 transition-colors inline-flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:-m-1"
      >
        <Bell className="w-5 h-5" />
        {unseen > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-amber text-[10px] font-bold text-foreground flex items-center justify-center"
          >
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <div
          id={`${uid}-panel`}
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-label="Notifications"
          className="absolute right-0 mt-2 w-[21rem] max-w-[calc(100vw-1.5rem)] max-h-[26rem] overflow-y-auto bg-white text-foreground rounded-xl shadow-xl border border-gray-200 z-50 focus:outline-none"
        >
          <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-2.5 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-xs font-medium text-teal-deep hover:underline inline-flex items-center min-h-11 px-1"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Present from the moment the panel opens, empty, so the text
              written into it later is actually announced. A region created
              together with its content is skipped by most screen readers. */}
          <p role="status" className={note ? "px-4 py-2 text-xs text-muted-foreground bg-gray-50" : "sr-only"}>
            {note}
          </p>

          {!state.loaded ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">Reading the village.</p>
          ) : groups.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nothing yet. Go be seen.</p>
          ) : (
            groups.map((g) => (
              <section key={g.id} aria-labelledby={`${uid}-${g.id}`}>
                <h3
                  id={`${uid}-${g.id}`}
                  className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  {g.title}
                  {g.unread > 0 && <span className="ml-1.5 font-semibold normal-case tracking-normal text-teal-deep">{g.unread} unread</span>}
                </h3>
                <ul>
                  {g.rows.map((row) =>
                    row.batched ? (
                      <li key={row.key}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((was) => (was.includes(row.key) ? was.filter((k) => k !== row.key) : [...was, row.key]))
                          }
                          aria-expanded={expanded.includes(row.key)}
                          className="w-full text-left flex items-start gap-2 px-4 py-3 min-h-11 border-b border-gray-50 hover:bg-gray-50"
                        >
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm leading-snug text-foreground ${row.unread ? "font-semibold" : ""}`}>
                              {row.title}
                            </span>
                            <span className="block text-xs text-muted-foreground mt-0.5">{row.detail}</span>
                            <span className="block text-[10px] text-muted-foreground mt-1">Newest {timeAgo(row.at)}</span>
                          </span>
                          {row.unread > 0 && <NewMark />}
                          <ChevronDown
                            aria-hidden="true"
                            className={`w-4 h-4 shrink-0 text-muted-foreground mt-0.5 ${expanded.includes(row.key) ? "rotate-180" : ""}`}
                          />
                        </button>
                        {expanded.includes(row.key) && (
                          <ul className="bg-gray-50/70">
                            {row.items.map((it) => (
                              <li key={it.id}>
                                <Link
                                  href={it.link ?? "/profile"}
                                  onClick={() => {
                                    if (!it.isRead) void markNotificationsRead([it.id]);
                                    setOpen(false);
                                  }}
                                  className="flex items-start gap-2 pl-7 pr-4 py-2.5 min-h-11 border-b border-gray-100 hover:bg-gray-100"
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className={`block text-xs leading-snug ${it.isRead ? "text-muted-foreground" : "font-semibold text-foreground"}`}>
                                      {it.title}
                                    </span>
                                    <span className="block text-[10px] text-muted-foreground mt-0.5">{timeAgo(it.at)}</span>
                                  </span>
                                  {!it.isRead && <NewMark />}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ) : (
                      <li key={row.key}>
                        <Link
                          href={row.link ?? "/profile"}
                          onClick={() => {
                            readRow(row);
                            setOpen(false);
                          }}
                          className="flex items-start gap-2 px-4 py-3 min-h-11 border-b border-gray-50 hover:bg-gray-50"
                        >
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm leading-snug text-foreground ${row.unread ? "font-semibold" : ""}`}>
                              {row.title}
                            </span>
                            {/* A row read in the app alone shows its words whole: its email left them out (notificationFeed.ts, `whole`). */}
                            {row.detail && (
                              <span
                                className={`block text-xs text-muted-foreground mt-0.5 ${row.whole ? "whitespace-pre-wrap break-words" : "line-clamp-2"}`}
                              >
                                {row.detail}
                              </span>
                            )}
                            <span className="block text-[10px] text-muted-foreground mt-1">{timeAgo(row.at)}</span>
                          </span>
                          {row.unread > 0 && <NewMark />}
                        </Link>
                      </li>
                    ),
                  )}
                </ul>
              </section>
            ))
          )}

          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-3 min-h-11 border-t border-gray-100 text-xs font-medium text-muted-foreground hover:bg-gray-50"
          >
            <Settings2 aria-hidden="true" className="w-3.5 h-3.5" />
            Choose what reaches you, and how
          </Link>
        </div>
      )}
    </div>
  );
}
