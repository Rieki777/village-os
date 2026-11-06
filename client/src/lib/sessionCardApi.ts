/**
 * The session card's HTTP surface, client side. The routes are
 * server/routes/sessionCard.ts and the shapes are at the foot of
 * shared/sessionCard.ts; this file only calls them, through `gameFetch`, so
 * every call carries the member's token.
 *
 * A pull sends the day's sky, read in this browser (shared/geneKeysSky.ts
 * `skyAt`). The ephemeris is loaded only when somebody pulls, so a room that
 * never pulls a card never downloads it.
 */
import { SESSION_CARD_API, type CardsAnswer } from "@shared/sessionCard";
import { gameFetch } from "./gameApi";

/** A refusal the room can act on, in the server's own sentence. */
export class CardRefusal extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call(path: string, init?: RequestInit): Promise<CardsAnswer> {
  const res = await gameFetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const sentence = typeof body?.error === "string" && /\s/.test(body.error) ? body.error : "That did not work. Try again.";
    throw new CardRefusal(sentence, res.status);
  }
  return body as CardsAnswer;
}

export function readCards(sessionId: number): Promise<CardsAnswer> {
  return call(`${SESSION_CARD_API}/${sessionId}`);
}

export async function pullCard(sessionId: number): Promise<CardsAnswer> {
  const { skyAt } = await import("@shared/geneKeysSky");
  const sky = skyAt(new Date());
  return call(`${SESSION_CARD_API}/${sessionId}`, { method: "POST", body: JSON.stringify({ sky }) });
}

export function shareMyLine(sessionId: number, cardId: number, shared: boolean): Promise<CardsAnswer> {
  return call(`${SESSION_CARD_API}/${sessionId}/cards/${cardId}/share`, { method: "POST", body: JSON.stringify({ shared }) });
}
