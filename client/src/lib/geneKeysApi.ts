/**
 * The Gene Keys HTTP surface, client side. The routes are server/routes/geneKeys.ts
 * and the shapes are at the foot of shared/geneKeys.ts; this file only calls
 * them. Every call goes through `gameFetch`, so every call carries the
 * member's token: no Gene Keys route answers a stranger.
 *
 * NO BIRTH DATA IS EVER SENT FROM HERE. A save carries a chart (26 activations)
 * read from the sky in this browser by shared/geneKeysSky.ts.
 */
import type { Chart, ComplementsAnswer, GeneKeysSource, GeneKeysView, GeneKeysVisibility, OwnGeneKeysView } from "@shared/geneKeys";
import { gameFetch } from "./gameApi";

/** A refusal the member can act on, in the server's own sentence. */
export class GeneKeysRefusal extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await gameFetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const sentence = typeof body?.error === "string" && /\s/.test(body.error) ? body.error : "That did not work. Try again.";
    throw new GeneKeysRefusal(sentence, res.status);
  }
  return body as T;
}

export async function readMyGeneKeys(): Promise<OwnGeneKeysView | null> {
  return (await call<{ geneKeys: OwnGeneKeysView | null }>("/api/gene-keys/me")).geneKeys ?? null;
}

export async function saveMyGeneKeys(save: {
  chart: Chart;
  source: GeneKeysSource;
  visibility: GeneKeysVisibility;
  maia: boolean;
}): Promise<{ mine: OwnGeneKeysView; badgeEarned: string | null }> {
  const got = await call<{ geneKeys: OwnGeneKeysView; badgeEarned?: string | null }>("/api/gene-keys/me", { method: "PUT", body: JSON.stringify(save) });
  return { mine: got.geneKeys, badgeEarned: got.badgeEarned ?? null };
}

export interface GeneKeysSettings {
  visibility?: GeneKeysVisibility;
  maia?: boolean;
  /** "Who complements me" (opt-in on both sides). */
  complement?: boolean;
  /** "Talk to me plainly". */
  maiaPlain?: boolean;
  /** "Leave me out of session cards". */
  /** Yes or no to being read on session cards. */
  cards?: boolean;
}

export async function changeMyGeneKeys(patch: GeneKeysSettings): Promise<OwnGeneKeysView> {
  return (await call<{ geneKeys: OwnGeneKeysView }>("/api/gene-keys/me", { method: "PATCH", body: JSON.stringify(patch) })).geneKeys;
}

/** "Who complements me": opted-in members whose lines fill the asker's gaps. */
export async function readComplements(): Promise<ComplementsAnswer> {
  return call<ComplementsAnswer>("/api/gene-keys/complements");
}

export async function removeMyGeneKeys(): Promise<boolean> {
  return (await call<{ removed: boolean }>("/api/gene-keys/me", { method: "DELETE" })).removed;
}

/** Other members' shown lines, keyed by user id. A hidden member is simply absent. */
export async function readPeopleGeneKeys(ids: string[]): Promise<Record<string, GeneKeysView>> {
  if (!ids.length) return {};
  const q = encodeURIComponent(ids.slice(0, 60).join(","));
  return (await call<{ people: Record<string, GeneKeysView> }>(`/api/gene-keys/people?ids=${q}`)).people ?? {};
}

export async function readHandleGeneKeys(handle: string): Promise<GeneKeysView | null> {
  return (await call<{ geneKeys: GeneKeysView | null }>(`/api/gene-keys/people/${encodeURIComponent(handle)}`)).geneKeys ?? null;
}

/** The birth-town list as text; client/src/components/geneKeys/places.ts parses it. */
export async function readPlacesText(): Promise<string> {
  const res = await gameFetch("/api/gene-keys/places", { headers: { Accept: "text/plain" } });
  if (!res.ok) throw new GeneKeysRefusal("The town list did not load. Try again.", res.status);
  return res.text();
}
