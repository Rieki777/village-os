/**
 * WHAT THE HEARTH READS, beside the card itself (Phase D, lane D1). Every
 * read is one the village already serves, and each one that fails or is
 * closed to this reader simply leaves its part of the hearth out: no error
 * line, no spinner, the card stands as it is.
 *
 *   /api/events                 the circle's next meeting, as one evening of
 *                               its mirrored gathering, with the `going` count
 *                               and this reader's own answer (events module)
 *   /api/quests, /quests/field  the circle's open work and its plant (core)
 *   /api/org                    which circles sit in this one (the threads)
 *   /api/sessions/circles/:id   the decisions log, for those who keep the
 *                               circle (its summary's `canKeep`), only while
 *                               Live Sessions is open to the reader
 *
 * "I'll be there" answers through the gatherings' own door
 * (`POST /api/events/:id/rsvp` with the evening's `occurrenceKey`), so its
 * capacity lock, waitlist and any seat fee stay exactly as they are.
 */
import { useCallback, useEffect, useState } from "react";
import { gameFetch } from "@/lib/gameApi";
import { circleSummaryUrl } from "@shared/sessionRhythm";
import { circleDecisionsUrl, type CircleDecision } from "@shared/sessionDecisions";
import { nextGathering, tendOf, type CalendarItemIn, type NextGathering, type QuestIn, type TendRow } from "./hearthModel";

const DAY = 86_400_000;
/** How far ahead the next meeting is looked for: a moon and a half covers weekly and moon rhythms. */
export const LOOK_AHEAD_DAYS = 45;

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gameFetch(path, { method: "GET" });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}

export interface MeetState {
  gathering: NextGathering | null;
  timezone: string | null;
  /** The village takes answers to gatherings. */
  answersOpen: boolean;
}

export interface HearthData {
  meet: MeetState | null;
  /** The board's quests and their counts, read once; `tendFor` picks this circle's. */
  quests: QuestIn[] | null;
  perQuest: Record<string, { active: number; done: number }>;
  orgCircles: { id: string; name: string; parentCircleId?: string | null; isExample?: boolean }[];
  /** The decisions log, newest first, for those who keep the circle; null when not theirs to read. */
  decisions: CircleDecision[] | null;
  keeps: boolean;
}

/** This circle's plants, once the board has been read; an example circle tends example work. */
export function tendFor(data: HearthData, circle: { id: string; name: string }): { rows: TendRow[]; more: number } | null {
  if (!data.quests) return null;
  const example = data.orgCircles.find((c) => c.id === circle.id)?.isExample === true;
  return tendOf(data.quests, data.perQuest, { ...circle, isExample: example });
}

export function useHearth(circle: { id: string; name: string } | null, sessionsOn: boolean) {
  const [data, setData] = useState<HearthData>({ meet: null, quests: null, perQuest: {}, orgCircles: [], decisions: null, keeps: false });
  const id = circle?.id ?? "";

  const readMeet = useCallback(async () => {
    if (!id) return;
    const now = new Date();
    const from = new Date(now.getTime() - DAY).toISOString();
    const to = new Date(now.getTime() + LOOK_AHEAD_DAYS * DAY).toISOString();
    const out = await readJson<{ events?: CalendarItemIn[]; timezone?: string; rsvpEnabled?: boolean }>(
      `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    setData((d) => ({
      ...d,
      meet: out && Array.isArray(out.events)
        ? { gathering: nextGathering(out.events, id, now), timezone: out.timezone ?? null, answersOpen: out.rsvpEnabled === true }
        : null,
    }));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let live = true;
    void readMeet();
    void Promise.all([
      readJson<QuestIn[]>("/api/quests"),
      readJson<{ perQuest?: Record<string, { active: number; done: number }> }>("/api/quests/field"),
    ]).then(([quests, field]) => {
      if (!live) return;
      setData((d) => ({ ...d, quests: Array.isArray(quests) ? quests : null, perQuest: field?.perQuest ?? {} }));
    });
    void readJson<{ circles?: HearthData["orgCircles"] }>("/api/org").then((org) => {
      if (live && Array.isArray(org?.circles)) setData((d) => ({ ...d, orgCircles: org!.circles! }));
    });
    if (sessionsOn) {
      void readJson<{ canKeep?: boolean }>(circleSummaryUrl(id)).then(async (s) => {
        if (!live || s?.canKeep !== true) return;
        const log = await readJson<{ decisions?: CircleDecision[] }>(circleDecisionsUrl(id));
        if (live) setData((d) => ({ ...d, keeps: true, decisions: Array.isArray(log?.decisions) ? log!.decisions! : null }));
      });
    }
    return () => {
      live = false;
    };
  }, [id, sessionsOn, readMeet]);

  /** Say "going" or "declined" for the next meeting, through the gatherings' own door. Returns the server's words on a refusal. */
  const answer = useCallback(
    async (status: "going" | "declined"): Promise<{ ok: true } | { ok: false; error: string | null }> => {
      const g = data.meet?.gathering;
      if (!g) return { ok: false, error: null };
      try {
        const res = await gameFetch(`/api/events/${encodeURIComponent(g.eventId)}/rsvp`, {
          method: "POST",
          body: JSON.stringify({ status, occurrenceKey: g.occurrenceKey }),
        });
        const out = (await res.json().catch(() => null)) as { error?: unknown } | null;
        if (!res.ok) return { ok: false, error: typeof out?.error === "string" && /\s/.test(out.error) ? out.error : null };
        await readMeet();
        return { ok: true };
      } catch {
        return { ok: false, error: null };
      }
    },
    [data.meet, readMeet],
  );

  return { data, answer };
}
