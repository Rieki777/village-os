/**
 * One of the moon review's three village documents (decision 22), read and
 * saved through its own door: /api/moon-review/payers, /settings or /rhythm.
 *
 * The server decides everything: who may read (`cash.pay`), what is valid
 * (the contract's parser), and what changed. This hook only carries the
 * answer. A 404 means the moon review module is off, and the panel then
 * renders nothing.
 */
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { ADMIN_WORDS } from "@shared/moonRecap";
import type { SaveResult } from "@/components/SaveBar";

export type DocState<T> =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "refused"; text: string }
  | { kind: "ready"; doc: T; gaps: Array<{ key: string; words: string }>; pendingSeraInbox?: { address: string; proposedBy: string; proposedAt: string } | null };

export function useSettingsDocument<T>(path: "payers" | "settings" | "rhythm", password: string) {
  const [state, setState] = useState<DocState<T>>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const url = `${API_BASE}/moon-review/${path}`;

  const take = (status: number, body: any): void => {
    if (status === 404) return setState({ kind: "off" });
    if (status === 401 || status === 403) return setState({ kind: "refused", text: typeof body?.message === "string" && body.message ? body.message : ADMIN_WORDS.noKey });
    if (status >= 300) return setState({ kind: "refused", text: refusal(body, ADMIN_WORDS.loadFailed) });
    setState({ kind: "ready", doc: body.document as T, gaps: Array.isArray(body.gaps) ? body.gaps : [], pendingSeraInbox: body.pendingSeraInbox ?? null });
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { headers: authHeaders(password) });
      take(res.status, await res.json().catch(() => ({})));
    } catch {
      setState({ kind: "refused", text: ADMIN_WORDS.loadFailed });
    }
  }, [url, password]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Answers what the server said, for the floating save bar: ok only when the write landed. */
  const save = async (doc: T): Promise<SaveResult> => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ document: doc }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 400) {
        const text = refusal(body, ADMIN_WORDS.loadFailed);
        setMessage({ ok: false, text });
        return { ok: false, reason: text };
      }
      take(res.status, body);
      if (res.ok) {
        setMessage({ ok: true, text: ADMIN_WORDS.saved(Number(body.changed) || 0) });
        return { ok: true };
      }
      return { ok: false, reason: refusal(body, ADMIN_WORDS.loadFailed) };
    } catch {
      setMessage({ ok: false, text: ADMIN_WORDS.loadFailed });
      return { ok: false, reason: ADMIN_WORDS.loadFailed };
    } finally {
      setSaving(false);
    }
  };

  /** A waiting change of Sera's inbox, confirmed or cancelled by a second signer (C7). */
  const decideInbox = async (what: "confirm" | "cancel"): Promise<void> => {
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/moon-review/settings/sera-inbox/${what}`, { method: "POST", headers: authHeaders(password) });
      const body = await res.json().catch(() => ({}));
      setMessage(res.ok ? { ok: true, text: what === "confirm" ? ADMIN_WORDS.settings.seraInboxConfirmed : ADMIN_WORDS.settings.seraInboxCancelled } : { ok: false, text: refusal(body, ADMIN_WORDS.loadFailed) });
    } catch {
      setMessage({ ok: false, text: ADMIN_WORDS.loadFailed });
    }
    await load();
  };

  return { state, save, saving, message, decideInbox };
}

/** Comma or line separated words into a clean list. */
export function listOf(text: string): string[] {
  return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

export const inputClass = "mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground";
export const labelClass = "block text-sm font-medium text-foreground";
export const buttonClass = "min-h-9 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground";
export const primaryClass = "min-h-9 rounded-lg bg-teal-deep px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40";
