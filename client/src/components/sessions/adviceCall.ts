/**
 * One call to the advice process's doors (shared/sessionAdvice.ts). It reads
 * `res.ok` before anything else, and a refusal comes back in the server's own
 * sentence, or in the section's own words when the answer carries none.
 */
import { ADVICE_COPY } from "@shared/sessionAdvice";
import { gameFetch } from "@/lib/gameApi";

export type AdviceSent<T> = { ok: true; body: T } | { ok: false; error: string; status: number };

export async function adviceCall<T>(path: string, method: string, body?: unknown): Promise<AdviceSent<T>> {
  try {
    const res = await gameFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const out = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
    if (res.ok && out) return { ok: true, body: out };
    const text = typeof out?.error === "string" ? out.error.trim() : "";
    return { ok: false, error: /\s/.test(text) ? text : ADVICE_COPY.failed, status: res.status };
  } catch {
    return { ok: false, error: ADVICE_COPY.failed, status: 0 };
  }
}
