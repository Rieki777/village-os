/**
 * Admin then Tokens: the registry, and the ONE place a token is named.
 *
 * MOVED OUT OF client/src/pages/Admin.tsx. The monolith ratchet
 * (scripts/check-file-lines.mjs) says the page may only ever get smaller, and
 * this tab is the one this lane was editing, so it is the one that leaves.
 * Everything that changed on the way out, in full:
 *
 *   - the imports at the top of this file, and `export default` on the
 *     function
 *   - a `lifecycles` prop, so the list can follow which modules run here
 *   - each row gained a plain sentence, its slug stated as fixed, and a line
 *     when its module is off
 *   - the governance chip says where a token is MINTED in words
 *   - the mint picker reads the same filtered list the table does
 *   - the lines this lane wrote use `text-muted-foreground` rather than a
 *     Tailwind default gray, because scripts/check-tailwind-gray.mjs starts a
 *     new file at zero
 *
 * The mint, rename, sending, visibility and grant-signing flows moved
 * untouched.
 *
 * Why this tab in particular is worth its own file: it is the surface a
 * founder rebrands through, and the platform has just removed two rival
 * naming boxes from the Setup Wizard that could never win against this
 * registry. Keeping the winner buried mid-monolith is how the losers survived.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ModuleLifecycle } from "@shared/modules";
import { ExampleChip, forgetExamplesCache } from "@/components/ExamplesBanner";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { describeToken, tokenModule, tokenModuleIsOff, visibleTokens } from "@/components/admin/tokenCatalog";
import { formatTokenAmount, toMinorUnits } from "@/lib/tokenAmount";

/**
 * THE ONE PAGE WHERE A TOKEN IS NAMED.
 *
 * `lifecycles` is the modules map the shell already holds. A module's own
 * token is absent from this list while its module is off, which is the
 * founder's ruling that module tokens are named inside their module and go
 * dark when it is switched off. `visibleTokens` keeps an already-issued one
 * listed anyway, with a line saying its module is off, because the same ruling
 * says the row is never destroyed and a steward answering for somebody's
 * balance has to be able to find it. Null means the map has not arrived: show
 * everything rather than flash a short registry.
 */
export default function TokensTab({ password, lifecycles }: { password: string; lifecycles: Record<string, ModuleLifecycle> | null }) {
  const [tokens, setTokens] = useState<any[]>([]);
  const [mintCap, setMintCap] = useState<number>(0);
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ slug: "", name: "", kind: "credit", transferable: false });
  const [mint, setMint] = useState({ slug: "", toUserId: "", amount: "", reason: "" });
  const [renaming, setRenaming] = useState<{ slug: string; name: string } | null>(null);
  /** 0106: grants waiting for a second steward, and the ones already decided. */
  const [grants, setGrants] = useState<any[]>([]);
  const [cosignOver, setCosignOver] = useState<number>(0);

  /*
   * THIS SCREEN SPEAKS WHOLE TOKENS. The ledger does not.
   *
   * Every amount the server sends here is MINOR units, and every token in the
   * registry except Village Voice carries 0 decimals, where the two are the
   * same number. Voice carries 3, so this tab showed a grant of 10 Voice as
   * "10,000" and its Amount box minted 0.010 Voice to a steward who typed 10.
   *
   * The box and the numbers beside it are converted TOGETHER and in the same
   * commit, which is the whole discipline: a screen that divides its display
   * and leaves its input posting minor units is worse than one that does
   * neither, because both raw at least agree with each other.
   */
  const decimalsOfSlug = (slug: string): number =>
    Number(tokens.find((t: any) => t.slug === slug)?.decimals ?? 0) || 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, pRes, gRes] = await Promise.all([
        fetch(`${API_BASE}/admin/tokens`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/mint-requests`, { headers: authHeaders(password) }),
      ]);
      const t = await tRes.json();
      const p = await pRes.json();
      const g = await gRes.json();
      setTokens(Array.isArray(t.tokens) ? t.tokens : []);
      setMintCap(Number(t.mintCapPerCycle) || 0);
      setPlayers(Array.isArray(p) ? p : []);
      setGrants(Array.isArray(g.requests) ? g.requests : []);
      setCosignOver(Number(g.cosignOver) || 0);
    } catch { setTokens([]); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/tokens`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success(`Token "${data.token?.name}" created`);
      setForm({ slug: "", name: "", kind: "credit", transferable: false });
      // The village minting its own token is what retires the example market.
      forgetExamplesCache("exchange");
      load();
    } catch (e: any) { toast.error(e?.message || "Create failed"); }
  };

  const rename = async () => {
    if (!renaming || !renaming.name.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/admin/tokens/${renaming.slug}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ name: renaming.name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success(`Renamed to "${data.token?.name}". Every page follows`);
      setRenaming(null);
      load();
    } catch (e: any) { toast.error(e?.message || "Rename failed"); }
  };

  /**
   * Show or hide a token for members. VISIBILITY ONLY: balances, history and
   * the ledger are untouched, so this is reversible and conservation still
   * proves at boot. Deliberately not called "disable" anywhere a founder can
   * read it — a word that sounds like it stops the economy, attached to a
   * switch that does not, is how somebody hides a token believing they have
   * frozen it.
   */
  /**
   * 0092: open or close member-to-member sending on one token.
   *
   * The server refuses by KIND, so recognition can never be opened from here.
   * The control is rendered only where the server would say yes, and the
   * refusal is surfaced verbatim when a stale panel tries anyway.
   */
  const setSending = async (t: any, transferable: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/admin/tokens/${t.slug}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ transferable }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success(
        transferable
          ? `Members can send ${t.name} to each other`
          : `${t.name} stays put. Balances are untouched`,
      );
      load();
    } catch (e: any) { toast.error(e?.message || "Could not change sending"); }
  };

  const setActive = async (t: any, active: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/admin/tokens/${t.slug}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success(
        active
          ? `${t.name} is visible to members again`
          : `${t.name} is hidden from members. Balances are untouched`,
      );
      load();
    } catch (e: any) { toast.error(e?.message || "Could not change visibility"); }
  };

  const doMint = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/tokens/${mint.slug}/mint`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          toUserId: mint.toUserId,
          // Typed in whole tokens, sent in the units the ledger moves.
          amount: toMinorUnits(mint.amount, decimalsOfSlug(mint.slug)),
          reason: mint.reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      /*
       * 0106: a grant over `ledger.admin_mint_cosign_over` answers 202 and
       * moves nothing. Saying "Minted" here would be the product telling a
       * steward something that did not happen, which is the one thing a
       * message may never do.
       */
      if (data.pending) toast.success(data.message || "Recorded. Awaiting a second steward's sign-off");
      else toast.success(`Minted: ${data.remaining} left under this cycle's cap`);
      setMint({ slug: "", toUserId: "", amount: "", reason: "" });
      load();
    } catch (e: any) { toast.error(e?.message || "Mint failed"); }
  };

  /** The SECOND steward agrees. The amount and token come from the record. */
  const signGrant = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/admin/mint-requests/${id}/approve`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success("Signed. The grant is credited");
      load();
    } catch (e: any) { toast.error(e?.message || "Could not sign that grant"); }
  };

  const declineGrant = async (id: string) => {
    // `?? ""` here would have made Cancel indistinguishable from an empty
    // reason, so pressing Escape would have turned the grant down instead of
    // walking away. Null is the cancel and it has to survive to the test.
    const note = window.prompt("Why are you turning this down? The record keeps it.");
    if (note === null) return;
    try {
      const res = await fetch(`${API_BASE}/admin/mint-requests/${id}/decline`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ reason: note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success("Turned down. The cap has its room back");
      load();
    } catch (e: any) { toast.error(e?.message || "Could not turn that grant down"); }
  };

  /* Every token this village runs, module tokens included while their module
     is on. See client/src/components/admin/tokenCatalog.ts for the one
     exception and why it exists. */
  const shown = visibleTokens(tokens, lifecycles);
  // Minting into an example token is refused, and no ledger row exists for
  // one, so it never belongs in the mint picker.
  //
  // Built from `shown` rather than from the full registry: a page that has
  // just left a token off its own list must not then offer to mint into it,
  // and a picker with more tokens in it than the table above is the kind of
  // disagreement that makes a founder distrust both.
  const platformTokens = shown.filter((t) => t.governance === "platform" && !t.isExample);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Tokens</h2>
        <p className="text-sm text-gray-500 mt-1">
          Every token this village runs, and the one place any of them is named.
          Renaming one here renames it everywhere it appears, wallet to public
          pages, and no other screen carries a second box for the same name. A
          token's <strong>slug</strong> is fixed from the day it is created:
          history is keyed on it and is never re-denominated.
          <br />
          <span className="mt-1 inline-block">
            A module's own token is listed while that module is on. Switch the
            module off and its token leaves this list, and every balance stays
            exactly where it is.
          </span>
          <br />
          <span className="mt-1 inline-block">
            <strong>Shown to members</strong> hides a token from member-facing pages and
            nothing more. Balances, history and the ledger are untouched, so hiding one
            is reversible and takes nothing away from anybody who holds it. It does not
            stop a mint rule from paying. To stop issuance, pause the rule in the Mint.
          </span>
        </p>
      </div>
      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : (
        <div className="space-y-6">
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5">Token</th>
                  <th className="px-4 py-2.5">Kind</th>
                  <th className="px-4 py-2.5">Where it is minted</th>
                  <th className="px-4 py-2.5">Peer transfers</th>
                  <th className="px-4 py-2.5">Shown to members</th>
                  <th className="px-4 py-2.5">Issued to date</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.slug} className="border-t border-gray-100">
                    <td className="px-4 py-2.5">
                      {renaming && renaming.slug === t.slug ? (
                        <span className="flex items-center gap-1.5">
                          <input
                            value={renaming.name}
                            onChange={(e) => setRenaming({ slug: t.slug, name: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setRenaming(null); }}
                            autoFocus
                            className="text-sm border border-gray-200 rounded-lg px-2 py-1 w-40"
                          />
                          <button onClick={rename} disabled={!renaming.name.trim()}
                            className="text-xs bg-teal-deep text-white rounded-lg px-2 py-1 disabled:opacity-40">Save</button>
                          <button onClick={() => setRenaming(null)} className="text-xs text-gray-400">Cancel</button>
                        </span>
                      ) : (
                        <>
                          <span className="font-medium text-gray-900">{t.name}</span>
                          {t.isExample && <ExampleChip className="ml-2 align-middle" />}
                          {/* Rename, mint and stock are all refused on a
                              seeded token. Without the chip an example token
                              is indistinguishable from a real one here, which
                              is the registry telling the founder a lie. */}
                          {t.governance === "platform" && !t.isExample && (
                            <button onClick={() => setRenaming({ slug: t.slug, name: t.name })}
                              className="ml-2 text-xs text-teal-deep underline">rename</button>
                          )}
                          {/* THE SENTENCE THAT USED TO BE MISSING. A registry
                              that prints a slug and a kind tells a founder what
                              a token is CALLED and never what it is FOR, which
                              is how a second naming box survived on another
                              screen for months. */}
                          <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{describeToken(t)}</p>
                          {/* The row SAYS the slug is fixed. Every
                              repeat-protection key in the ledger carries it,
                              so it is the one field here that can never move,
                              and printing it small left that unsaid. */}
                          <p className="text-[11px] text-muted-foreground mt-0.5 opacity-80">
                            slug <span className="font-mono text-muted-foreground">{t.slug}</span>, fixed for good
                          </p>
                          {tokenModuleIsOff(t, lifecycles) && (
                            <p className="text-[11px] text-amber-700 mt-0.5">
                              The {tokenModule(t.slug)} module is off. Members cannot see this
                              token, and every balance in it is still here.
                            </p>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{t.kind}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        t.governance === "platform"
                          ? "bg-teal-deep/10 text-teal-deep"
                          : "bg-purple-50 text-purple-700 border border-purple-200"
                      }`}>
                        {t.governance === "platform" ? "Minted here" : "Base mirror, read only"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {/* 0092: sending is a switch now, and only on a credit
                          token this platform governs. Recognition shows the
                          reason instead of a control, because a dead switch
                          reads as a bug and a stated rule reads as a rule. */}
                      {t.governance === "platform" && t.kind === "credit" && !t.isExample
                        && t.slug !== "stay-credit" && t.slug !== "library-credit" ? (
                        <button
                          type="button"
                          onClick={() => setSending(t, !t.transferable)}
                          aria-pressed={!!t.transferable}
                          className={`min-h-9 text-xs rounded-full px-3 py-1.5 border ${
                            t.transferable
                              ? "bg-teal-deep/10 text-teal-deep border-teal-deep/30"
                              : "bg-gray-100 text-gray-600 border-gray-300"
                          }`}
                        >
                          {t.transferable ? "yes" : "no"}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {t.kind === "recognition" ? "never" : "no"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {t.governance === "platform" && !t.isExample ? (
                        <button
                          type="button"
                          onClick={() => setActive(t, !t.active)}
                          aria-pressed={t.active !== false}
                          className={`min-h-9 text-xs rounded-full px-3 py-1.5 border ${
                            t.active !== false
                              ? "bg-teal-deep/10 text-teal-deep border-teal-deep/30"
                              : "bg-gray-100 text-gray-600 border-gray-300"
                          }`}
                        >
                          {t.active !== false ? "Shown" : "Hidden"}
                        </button>
                      ) : (
                        // The same two refusals the rename control respects, and
                        // said out loud rather than shown as a dead switch.
                        <span className="text-xs text-gray-400">
                          {t.isExample ? "example" : "read-only"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {Object.entries(t.issuedBy ?? {}).length === 0
                        ? <span className="text-gray-300">-</span>
                        : Object.entries(t.issuedBy).map(([acct, n]) => (
                            <div key={acct} className="text-xs">
                              <span className="font-mono text-gray-400">{acct.replace("sys:", "")}</span>: {formatTokenAmount(Number(n), Number(t.decimals ?? 0))}
                            </div>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Create a platform token</h3>
            <p className="text-xs text-gray-500 mb-3">
              Name tokens as you enable modules: stay credits, library credits, event
              tickets. The slug is permanent: history is never re-denominated.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="slug (e.g. stay-credits)" className="text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono w-48" />
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Display name" className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-48" />
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
                className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
                <option value="credit">credit</option>
                <option value="recognition">recognition</option>
              </select>
              <label className="text-xs text-gray-600 flex items-center gap-1.5">
                <input type="checkbox" checked={form.transferable}
                  onChange={(e) => setForm({ ...form, transferable: e.target.checked })} />
                members may send it
              </label>
              <button onClick={create} disabled={!form.slug || !form.name}
                className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
                Create
              </button>
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Mint by hand</h3>
            <p className="text-xs text-gray-500 mb-3">
              Issues from the dedicated mint faucet, with a reason, audited. All admins
              together can mint at most {mintCap.toLocaleString()} per token per lunar
              cycle (ledger.admin_mint_cycle_cap).
              {/* State what is true, then get out of the way (R56). Both of
                  these are facts about what the route will do, and neither
                  argues with the village about its own dials. */}
              {" "}Minting to your own account is refused.
              {cosignOver > 0
                ? ` A grant over ${cosignOver.toLocaleString()} waits for a second steward to agree before anything moves (ledger.admin_mint_cosign_over).`
                : " A second steward is not asked for at any amount (ledger.admin_mint_cosign_over is 0)."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={mint.slug} onChange={(e) => setMint({ ...mint, slug: e.target.value })}
                className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
                <option value="">Token…</option>
                {platformTokens.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
              </select>
              <select value={mint.toUserId} onChange={(e) => setMint({ ...mint, toUserId: e.target.value })}
                className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
                <option value="">Member…</option>
                {players.map((p) => <option key={p.id} value={p.id}>{p.name}{p.handle ? ` (@${p.handle})` : ""}</option>)}
              </select>
              <input value={mint.amount} onChange={(e) => setMint({ ...mint, amount: e.target.value })}
                placeholder="Amount" type="number" min="1" className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-28" />
              <input value={mint.reason} onChange={(e) => setMint({ ...mint, reason: e.target.value })}
                placeholder="Reason (required)" className="text-sm border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-48" />
              <button onClick={doMint} disabled={!mint.slug || !mint.toUserId || !mint.amount || !mint.reason.trim()}
                className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
                Mint
              </button>
            </div>
          </div>

          {/*
            0106: THE GRANTS RECORD.
            Every admin sees the same list, waiting first. A queue only its
            author can read is a drawer, and the point of a second signature is
            that somebody else saw it. The decided rows stay because who agreed
            to what, and when, is the record itself.
          */}
          {grants.length > 0 && (
            <div className="border border-gray-200 rounded-xl p-5">
              <h3 className="font-semibold text-gray-900 mb-1">Grants and their signatures</h3>
              <p className="text-xs text-gray-500 mb-3">
                A grant over the threshold moves nothing until a second steward agrees.
                Whoever asked for it cannot be the one who signs it.
              </p>
              <div className="space-y-2">
                {grants.map((g) => (
                  <div key={g.id} className="flex flex-wrap items-center gap-3 border border-gray-100 rounded-lg px-3 py-2.5">
                    <div className="flex-1 min-w-64">
                      <p className="text-sm text-gray-900">
                        <strong>{formatTokenAmount(Number(g.amount), decimalsOfSlug(g.tokenSlug))} {g.tokenName}</strong>
                        {" to "}{g.toName ?? g.toUserId}
                      </p>
                      <p className="text-xs text-gray-500">
                        {g.reason}
                        {" · asked for by "}{g.requestedByName ?? g.requestedBy}
                        {g.status === "pending"
                          ? " · waiting for a second steward"
                          : ` · ${g.status} by ${g.decidedByName ?? g.decidedBy}${g.decidedAt ? ` on ${new Date(g.decidedAt).toLocaleDateString()}` : ""}`}
                        {g.decisionNote ? ` · "${g.decisionNote}"` : ""}
                      </p>
                    </div>
                    {g.status === "pending" && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => signGrant(g.id)}
                          className="text-sm bg-teal-deep text-white rounded-lg px-3 py-2 font-medium">
                          Sign it
                        </button>
                        <button onClick={() => declineGrant(g.id)}
                          className="text-sm border border-gray-200 text-gray-700 rounded-lg px-3 py-2 font-medium">
                          Turn it down
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
