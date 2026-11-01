/**
 * ROLE PROPOSALS FROM PEOPLE WITH NO ACCOUNT, the desk side (sheet 19i):
 * the public link's switch, links made for one person, and the proposals
 * that have been confirmed. Server: server/routes/openProposals.ts.
 *
 * A link's address is shown once, when it is made: only its hash is kept.
 * Unconfirmed proposals never show here, because nothing unconfirmed reaches
 * a person. Asking the circle and adopting are the next change.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Link2 } from "lucide-react";
import { API_BASE, authHeaders } from "@/components/admin/adminApi";
import { OPEN_WORDS } from "@shared/openProposals";

interface DeskLink {
  id: string;
  label: string;
  createdAt: string;
  on: boolean;
}

interface DeskProposal {
  id: string;
  name: string | null;
  email: string | null;
  via: string | null;
  roles: Array<{ roleId: string; name: string | null; note: string }>;
  why: string;
  aim: string;
  confirmedAt: string | null;
}

interface Desk {
  publicLink: boolean;
  publicPath: string;
  links: DeskLink[];
  proposals: DeskProposal[];
}

const BUTTON = "inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep/40";

const copy = (text: string) => {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.error("Could not copy. Select the address and copy it yourself."),
  );
};

export default function OpenProposalsPanel({ password }: { password: string }) {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [label, setLabel] = useState("");
  const [made, setMade] = useState<{ label: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(
    async (url: string, method = "GET", body?: unknown) => {
      const res = await fetch(url, {
        method,
        headers: authHeaders(password, body === undefined ? {} : { "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "That did not work. Try again.");
      return data;
    },
    [password],
  );

  const load = useCallback(() => {
    call(`${API_BASE}/admin/open-proposals`)
      // Anything but the desk's own shape draws nothing, never a broken Submissions tab.
      .then((d) => setDesk(d && typeof d === "object" && Array.isArray(d.links) && Array.isArray(d.proposals) ? (d as Desk) : null))
      .catch(() => setDesk(null));
  }, [call]);

  useEffect(load, [load]);

  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      const d = await fn();
      if (typeof d?.message === "string") toast.success(d.message);
      load();
      return d;
    } catch (e: any) {
      toast.error(e?.message ?? "That did not work. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!desk) return null;
  const publicUrl = `${window.location.origin}${desk.publicPath}`;

  return (
    <details className="mb-6 rounded-xl border border-gray-200 bg-white p-4" data-open-proposals-desk="">
      <summary className="flex min-h-10 cursor-pointer items-center gap-2 font-semibold text-gray-900">
        <Link2 className="h-4 w-4" aria-hidden="true" />
        Role proposals from people with no account
        {desk.proposals.length > 0 && <span className="rounded-full bg-teal-deep px-2 py-0.5 text-xs text-white">{desk.proposals.length}</span>}
      </summary>

      <div className="mt-4 grid gap-5">
        <section className="grid gap-2">
          <label className="flex min-h-10 items-center gap-3 text-sm text-gray-800">
            <input
              type="checkbox"
              className="size-5 accent-teal-deep"
              checked={desk.publicLink}
              disabled={busy}
              onChange={(e) => void act(() => call(`${API_BASE}/admin/open-proposals/settings`, "PUT", { publicLink: e.target.checked }))}
            />
            The public link is on: anyone with it can propose
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded bg-gray-50 px-2 py-1 text-sm text-gray-800">{publicUrl}</code>
            <button type="button" className={BUTTON} onClick={() => copy(publicUrl)}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy
            </button>
          </div>
        </section>

        <section className="grid gap-2">
          <h3 className="text-sm font-semibold text-gray-900">A link for one person</h3>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!label.trim()) return;
              void act(() => call(`${API_BASE}/admin/open-proposals/links`, "POST", { label })).then((d) => {
                if (d?.url) {
                  setMade({ label: d.label, url: d.url });
                  setLabel("");
                }
              });
            }}
          >
            <label className="grid min-w-0 flex-1 gap-1 text-sm text-gray-700">
              Who it's for (only you see this)
              <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} className="min-h-10 rounded-lg border border-gray-200 px-3 py-2 text-gray-900" />
            </label>
            <button type="submit" className={BUTTON} disabled={busy || !label.trim()}>
              Make a link
            </button>
          </form>
          {made && (
            <div className="grid gap-2 rounded-lg border border-teal-deep/40 bg-teal-deep/5 p-3 text-sm" data-link-made="">
              <p className="text-gray-900">
                {OPEN_WORDS.linkMade} For {made.label}:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 break-all rounded bg-white px-2 py-1 text-gray-800">{made.url}</code>
                <button type="button" className={BUTTON} onClick={() => copy(made.url)}>
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copy
                </button>
              </div>
            </div>
          )}
          {desk.links.length > 0 && (
            <ul className="grid gap-1">
              {desk.links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-800">
                  <span className="min-w-0 break-words">
                    {l.label} {!l.on && <span className="text-gray-500">(switched off)</span>}
                  </span>
                  {l.on && (
                    <button type="button" className={BUTTON} disabled={busy} onClick={() => void act(() => call(`${API_BASE}/admin/open-proposals/links/${encodeURIComponent(l.id)}/revoke`, "POST"))}>
                      Switch off
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-gray-900">Confirmed proposals</h3>
          {desk.proposals.length === 0 ? (
            <p className="text-sm text-gray-500">None yet. A proposal shows here once its sender confirms their email.</p>
          ) : (
            desk.proposals.map((p) => (
              <article key={p.id} className="grid gap-2 rounded-lg border border-gray-200 p-3 text-sm" data-open-proposal-row={p.id}>
                <p className="break-words font-semibold text-gray-900">
                  {p.name ?? "Name taken off"} <span className="font-normal text-gray-600">{p.email}</span>
                  {p.via && <span className="font-normal text-gray-500"> (through the link for {p.via})</span>}
                </p>
                <ul className="grid gap-1">
                  {p.roles.map((r) => (
                    <li key={r.roleId} className="break-words text-gray-800">
                      <span className="font-medium">{r.name ?? "A role no longer offered"}</span>
                      {r.note && <span className="text-gray-600">: {r.note}</span>}
                    </li>
                  ))}
                </ul>
                <p className="whitespace-pre-line break-words text-gray-800">{p.why}</p>
                {p.aim && <p className="break-words text-gray-600">Aim: {p.aim}</p>}
              </article>
            ))
          )}
        </section>
      </div>
    </details>
  );
}
