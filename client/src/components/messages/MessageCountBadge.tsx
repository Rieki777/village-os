/**
 * The small number beside "Messages" in the avatar menu and the mobile menu.
 *
 * One read of GET /api/messages/unread, which is a single COUNT for the
 * signed-in member and nobody else: messages from other people they have not
 * read yet, muted threads left out (server/lib/messaging.ts `totalUnreadFor`).
 * The menus mount it only while they are open, so it is one small request per
 * opening and never a poll, and nothing is kept between mounts, so a number
 * read for one member is never shown to the next one on the same browser.
 *
 * Nothing shows while it loads, when the read fails, or at zero. The digit is
 * for the eye; a screen reader hears a sentence instead ("2 unread messages").
 */
import { useEffect, useState } from "react";
import { authToken, gameFetch } from "@/lib/gameApi";

export const MESSAGES_UNREAD_URL = "/api/messages/unread";

/** The door's reply, read defensively. Null when it is not one. */
export function readUnread(v: unknown): number | null {
  const n = (v as { unreadTotal?: unknown } | null)?.unreadTotal;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

export function unreadWords(n: number): string {
  return n === 1 ? "1 unread message" : `${n} unread messages`;
}

export interface MessageCountBadgeProps {
  /** The signed-in member's id, so a change of member reads afresh. */
  who?: number | string | null;
}

export default function MessageCountBadge({ who }: MessageCountBadgeProps) {
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    setN(null);
    if (!authToken()) return;
    let live = true;
    gameFetch(MESSAGES_UNREAD_URL, { cache: "no-store" })
      .then(async (res) => (res.ok ? readUnread(await res.json().catch(() => null)) : null))
      .then((next) => live && setN(next))
      .catch(() => live && setN(null));
    return () => {
      live = false;
    };
  }, [who]);

  if (!n || n <= 0) return null;
  return (
    <>
      <span
        aria-hidden="true"
        data-message-count
        className="ml-2 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-teal-deep px-1.5 text-[11px] font-bold leading-none text-white align-middle"
      >
        {n > 99 ? "99+" : n}
      </span>
      <span className="sr-only">, {unreadWords(n)}</span>
    </>
  );
}
