/**
 * THE CONNECTOR, ON THE ROUTE (the lead, 2026-11-11): "have this box pop up when
 * people add their Claude API key / download a document for their agent, so we
 * bring them on the route to add the connector to their Claude."
 *
 * A friendly panel that says in two lines what the connector is, lists the steps
 * to add the village connector to Claude, and, for an admin, shows the switch
 * that lets the agent make the changes the person approves in the chat.
 *
 * THE ADDRESS IS THE ONE THE APP ALREADY DOCUMENTS: `<origin>/api/agent/v1/mcp`
 * (docs/FORK_RUNBOOK.md, the remote MCP server; sign-in is Claude's custom
 * connector OAuth, server/lib/agentOAuth.ts). Nothing here invents a URL: the
 * origin is the one the page was served from, or the one /api/agent/setup
 * reported when the caller has it.
 *
 * DISMISSED PER PERSON. The choice is kept in this browser under a key that
 * carries the person's id, so one browser shared by two people asks each of
 * them once. Storage can be refused (a private window); the panel then shows
 * every time it is asked for, which is the safe side.
 *
 * Draws in the profile's look (docs/DESIGN_RULE.md, components/journey/look.ts).
 */
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Plug } from "lucide-react";
import { gameFetch } from "@/lib/gameApi";
import { readStored, writeStored } from "@/lib/safeStorage";
import { API_BASE, authHeaders } from "@/components/admin/adminApi";
import { BTN_PRIMARY, BTN_SECONDARY, CARD_FEATURED, EYEBROW, H2, HINT, TILE } from "@/components/journey/look";

export const CONNECTOR_VARIABLE = "agents.lead_approved_writes";
export const CONNECTOR_PATH = "/api/agent/v1/mcp";

/** The key this person's dismissal lives under. */
export function connectorDismissKey(person: string | null | undefined): string {
  return `village.connectorSetup.dismissed.${person || "anyone"}`;
}

export function connectorDismissed(person: string | null | undefined): boolean {
  const r = readStored("local", connectorDismissKey(person));
  return r.status === "value" && r.value === "1";
}

export function connectorUrl(origin?: string): string {
  const base = (origin || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  return `${base}${CONNECTOR_PATH}`;
}

export default function ConnectorSetupPanel({
  moment,
  person,
  origin,
  isAdmin = false,
  password,
  initialSwitch,
}: {
  /** What the person just did, so the first line can say so. */
  moment: "key" | "download";
  /** Who is looking, so a dismissal is theirs. */
  person?: string | null;
  /** The village's public origin, when the caller has it from /api/agent/setup. */
  origin?: string;
  isAdmin?: boolean;
  /** The admin tab's shared password; absent, the signed-in member's own token is used. */
  password?: string;
  /** For tests: skip the read of the switch. */
  initialSwitch?: boolean;
}) {
  const { t } = useLingui();
  const [hidden, setHidden] = useState(() => connectorDismissed(person));
  const [on, setOn] = useState<boolean | null>(initialSwitch ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const url = connectorUrl(origin);

  const headers = (extra: Record<string, string> = {}) => (password ? authHeaders(password, extra) : extra);
  const call = (path: string, init: RequestInit = {}) =>
    password ? fetch(path, { ...init, headers: headers({ "Content-Type": "application/json" }) }) : gameFetch(path, init);

  useEffect(() => {
    if (!isAdmin || initialSwitch !== undefined || hidden) return;
    let live = true;
    void (async () => {
      try {
        const r = await call(`${API_BASE}/admin/variables`);
        if (!r.ok) return;
        const d = await r.json();
        const flat: Array<{ key: string; value: string }> = Array.isArray(d) ? d : (d.categories ?? []).flatMap((c: any) => c.variables ?? []);
        const v = flat.find((x) => x.key === CONNECTOR_VARIABLE);
        if (live && v) setOn(String(v.value) === "true");
      } catch {
        /* no switch shown rather than a wrong one */
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, initialSwitch, hidden, password]);

  if (hidden) return null;

  const dismiss = () => {
    writeStored("local", connectorDismissKey(person), "1");
    setHidden(true);
  };

  const flip = async (next: boolean) => {
    setBusy(true);
    setNote("");
    try {
      const r = await call(`${API_BASE}/admin/variables/${encodeURIComponent(CONNECTOR_VARIABLE)}`, { method: "PUT", body: JSON.stringify({ value: next ? "true" : "false" }) });
      if (r.ok) setOn(next);
      else setNote(t({ message: "That did not save. Try again in a moment.", context: "connector setup panel, the switch" }));
    } catch {
      setNote(t({ message: "That did not save. Try again in a moment.", context: "connector setup panel, the switch" }));
    }
    setBusy(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setNote(t({ message: "Copied.", context: "connector setup panel, copy the address" }));
    } catch {
      setNote(t({ message: "Select the address and copy it.", context: "connector setup panel, copy the address" }));
    }
  };

  return (
    <section data-testid="connector-setup" aria-labelledby="connector-setup-title" className={`${CARD_FEATURED} space-y-4`}>
      <div className="flex items-start gap-3">
        <Plug className="mt-1 h-5 w-5 shrink-0 text-notice" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className={EYEBROW}>
            {moment === "key" ? <Trans context="connector setup panel, eyebrow after a key">One more step</Trans> : <Trans context="connector setup panel, eyebrow after a download">Before you hand it over</Trans>}
          </p>
          <h2 id="connector-setup-title" className={H2}>
            <Trans context="connector setup panel, title">Add the village connector to your Claude</Trans>
          </h2>
          <p className={HINT}>
            <Trans context="connector setup panel, what the connector is">
              The connector lets your Claude act for you in the village, and only with your approval in the chat. Every change it makes is recorded.
            </Trans>
          </p>
        </div>
      </div>

      <ol className="list-decimal space-y-2 pl-6 text-sm text-foreground">
        <li><Trans context="connector setup panel, step one">In Claude, open Settings, then Connectors, then Add custom connector.</Trans></li>
        <li><Trans context="connector setup panel, step two">Paste this address and save it.</Trans></li>
        <li><Trans context="connector setup panel, step three">Claude opens the village to sign you in. Say yes there.</Trans></li>
        <li><Trans context="connector setup panel, step four">In a chat, ask Claude about your moon. It asks you before it changes anything.</Trans></li>
      </ol>

      <div className={`${TILE} space-y-2`}>
        <code data-testid="connector-url" className="block overflow-x-auto text-xs text-foreground">{url}</code>
        <button type="button" onClick={copy} className={BTN_SECONDARY}>
          <Trans context="connector setup panel, copy the address">Copy the address</Trans>
        </button>
      </div>

      {isAdmin && on !== null && (
        <div data-testid="connector-switch" className={`${TILE} space-y-2`}>
          <label className="flex min-h-11 items-start gap-3 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-notice"
              checked={on}
              disabled={busy}
              onChange={(e) => void flip(e.target.checked)}
            />
            <span><Trans context="connector setup panel, the switch">Our agent may make the changes we approve in the chat</Trans></span>
          </label>
          <p className={HINT}>
            {on
              ? <Trans context="connector setup panel, the switch is on">On now. The agent's list of allowed paths is still yours to edit, and every change still needs an approval note from a person.</Trans>
              : <Trans context="connector setup panel, the switch is off">Off now. The connector does only what it did before.</Trans>}
          </p>
        </div>
      )}

      {note && <p role="status" className={HINT}>{note}</p>}

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={dismiss} className={BTN_PRIMARY}>
          <Trans context="connector setup panel, dismiss">Got it</Trans>
        </button>
      </div>
    </section>
  );
}
