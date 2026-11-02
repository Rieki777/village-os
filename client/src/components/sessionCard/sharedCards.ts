/**
 * ONE CARD POLL PER ROOM, however many parts of the room read it.
 *
 * The card in the drop in stage and the invitation that follows a member
 * through every stage both need the session's cards. Each polling on its own
 * would double the requests against the read door's hourly bound
 * (server/routes/sessionCard.ts), so they share this: the first reader starts
 * one poll, every reader gets each answer, and the last to leave stops it. An
 * answer a door hands back (a pull, a share) is published to all of them too.
 */
import { useEffect, useState } from "react";
import type { CardsAnswer } from "@shared/sessionCard";
import { readCards } from "@/lib/sessionCardApi";

/** How often an open room asks for its cards. */
export const CARD_POLL_MS = 5000;

type Listener = (a: CardsAnswer) => void;

interface Room {
  listeners: Set<Listener>;
  timer: ReturnType<typeof setInterval> | null;
  last: CardsAnswer | null;
}

const rooms = new Map<number, Room>();

function roomOf(sessionId: number): Room {
  let room = rooms.get(sessionId);
  if (!room) {
    room = { listeners: new Set(), timer: null, last: null };
    rooms.set(sessionId, room);
  }
  return room;
}

/** Hand every reader of this room an answer, from the poll or from a door. */
export function publishCards(sessionId: number, answer: CardsAnswer): void {
  const room = roomOf(sessionId);
  room.last = answer;
  room.listeners.forEach((l) => l(answer));
}

function read(sessionId: number): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  // A refusal (the module turned off, somebody no longer a member) leaves the last answer as it was.
  readCards(sessionId).then((a) => publishCards(sessionId, a), () => {});
}

/** The room's cards, polled once for every reader, or null until the first answer. */
export function useSharedCards(sessionId: number, live: boolean): CardsAnswer | null {
  const [answer, setAnswer] = useState<CardsAnswer | null>(() => (live ? rooms.get(sessionId)?.last ?? null : null));
  useEffect(() => {
    if (!live) return;
    const room = roomOf(sessionId);
    room.listeners.add(setAnswer);
    if (room.last) setAnswer(room.last);
    if (!room.timer) {
      read(sessionId);
      room.timer = setInterval(() => read(sessionId), CARD_POLL_MS);
    }
    return () => {
      room.listeners.delete(setAnswer);
      if (!room.listeners.size && room.timer) {
        clearInterval(room.timer);
        room.timer = null;
      }
    };
  }, [sessionId, live]);
  return live ? answer : null;
}

/** Stop every poll and forget every answer. Tests start from here. */
export function forgetSharedCards(): void {
  rooms.forEach((room) => room.timer && clearInterval(room.timer));
  rooms.clear();
}
