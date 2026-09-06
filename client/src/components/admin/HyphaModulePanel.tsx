/**
 * The Hypha Bridge module's founder surface.
 *
 * FOUR THINGS A FOUNDER COULD NOT SEE BEFORE, and each one is here because its
 * absence let somebody believe something untrue:
 *
 *  1. Who is watching Base for this village. The hub runs one listener for
 *     every fork, and a fork had no way to know it was leaning on it.
 *  2. What the token contracts actually call themselves. The names on screen
 *     came from a founder typing them into a variable; these come from the
 *     contract, read at the moment somebody confirmed it, with the date.
 *  3. What happens to decisions already running if the village changes how it
 *     decides. The rule was already right and nothing said it out loud.
 *  4. Outcomes that arrived and matched no proposal. They used to be answered
 *     and forgotten, so a village learned a decision went missing when
 *     somebody asked why nothing had applied.
 *
 * DISCOVERY PROPOSES AND THE FOUNDER CONFIRMS. The lookup below never picks.
 * It lists every token the founder's account holds, marks the ones whose name
 * matches, and waits. Confirming reads name() and symbol() off the contract
 * itself, which is the check a name match cannot do for itself, and only then
 * is anything stored.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, RefreshCw, Search } from "lucide-react";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import { HYPHA_FIRST_STEPS } from "@shared/hypha";

const card = "border border-gray-200 rounded-xl px-4 py-4 bg-white";
const btn =
  "min-h-[44px] px-3 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-deep disabled:opacity-40";
const primary =
  "min-h-[44px] px-4 text-sm rounded-lg bg-teal-deep text-white font-medium focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-teal-deep disabled:opacity-40";
const input =
  "border border-gray-200 rounded-lg px-2 py-1.5 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-teal-deep";

/**
 * The Base account that created the DAO and issued the first tokens.
 *
 * Everything else on this screen depends on it: the lookup reads what THIS
 * account holds, and with it unset the discovery route answers 409 with the
 * first steps rather than an empty list.
 */
const FOUNDER_KEY = "hypha.founder_base_address";

/** The account settings, most-needed first. A key absent from `vars` renders nothing. */
const HYPHA_KEYS = [FOUNDER_KEY, "hypha.org_url", "hypha.space_id", "hypha.treasury_address"];

/**
 * Where the address is, drawn rather than screenshotted.
 *
 * A raster screenshot cannot ship: scripts/check-image-budget.mjs holds
 * client/public to a downward-only total and refuses to raise it, so a 4 KB
 * WebP fails on the total and a PNG fails on the format as well. Inline SVG is
 * outside that scan entirely.
 *
 * currentColor and opacity ONLY. scripts/check-theme-literals.mjs starts a new
 * file at zero, so one hex here turns CI red, and a fixed colour would be
 * wrong anyway the moment the panel is read in the other theme.
 */
function HyphaCopyDiagram() {
  return (
    <svg
      viewBox="0 0 240 140"
      role="img"
      aria-labelledby="hypha-copy-diagram-title"
      className="w-full max-w-[240px] text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <title id="hypha-copy-diagram-title">
        A browser window with the Hypha profile menu open at the top right. The
        account address sits under your name with a copy button beside it.
      </title>
      <rect x="4" y="4" width="232" height="132" rx="6" opacity="0.4" />
      <line x1="4" y1="24" x2="236" y2="24" opacity="0.4" />
      <circle cx="214" cy="14" r="6" />
      <rect x="140" y="32" width="92" height="52" rx="5" />
      <line x1="150" y1="44" x2="196" y2="44" opacity="0.7" />
      <line x1="150" y1="56" x2="212" y2="56" strokeWidth="2" />
      <rect x="198" y="50" width="12" height="12" rx="2" />
      <line x1="150" y1="70" x2="186" y2="70" opacity="0.5" />
      <line x1="214" y1="22" x2="214" y2="32" opacity="0.5" />
    </svg>
  );
}

const LISTENER_TONE: Record<string, string> = {
  hub: "bg-emerald-50 border-emerald-200 text-emerald-900",
  self: "bg-sky-50 border-sky-200 text-sky-900",
  none: "bg-amber-50 border-amber-200 text-amber-900",
};

export default function HyphaModulePanel({ password, vars, onVariableSaved }: {
  password: string;
  /** The game-variable rows the Game Mechanics tab already loaded. */
  vars: any[];
  /** Refresh that list. A write from here changes rows it also renders. */
  onVariableSaved: () => void;
}) {
  const [status, setStatus] = useState<any>(null);
  /** Per-key edits to the Hypha account fields, before they are saved. */
  const [accountDrafts, setAccountDrafts] = useState<Record<string, string>>({});
  /**
   * The getting-started steps, kept from whatever the lookup answered.
   *
   * They arrive on TWO routes and this panel could only see one of them.
   * `/status` carries them and is behind requireModule, so on a fresh village
   * (the module ships OFF) the panel's status is just `{moduleOff:true}` and
   * `status.firstSteps` is undefined. The card headed "Find your contracts on
   * Base" then rendered an EMPTY numbered list, in exactly the state this
   * panel was rebuilt to serve. `/candidates` returns the same constant on
   * its success body AND on both its 409s, so the first lookup fills this in
   * even when it refuses.
   */
  const [lookupSteps, setLookupSteps] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState("");
  const [candidates, setCandidates] = useState<any[] | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/hypha/status`, { headers: authHeaders(password) });
      // A 404 is the module answering that it is off. The panel says so
      // instead of showing an error, because off is a state and not a fault.
      if (res.status === 404) { setStatus({ moduleOff: true }); return; }
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "Could not read the bridge"));
      setStatus(d);
    } catch (e: any) {
      toast.error(e?.message || "Could not read the bridge");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => { void load(); }, [load]);

  const lookup = async () => {
    setBusy("lookup");
    setCandidates(null);
    try {
      const res = await fetch(`${API_BASE}/admin/hypha/candidates`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ nameHint: hint.trim() }),
      });
      const d = await res.json();
      // Kept BEFORE the throw: a 409 is the answer that most needs the steps.
      if (Array.isArray(d?.firstSteps)) setLookupSteps(d.firstSteps);
      if (!res.ok) throw new Error(refusal(d, "The lookup failed"));
      setCandidates(d.candidates ?? []);
      if ((d.candidates ?? []).length === 0) {
        toast.error("Nothing found on that account. Issue yourself some of the token on Hypha first");
      }
    } catch (e: any) {
      toast.error(e?.message || "The lookup failed");
    } finally {
      setBusy("");
    }
  };

  const confirmBinding = async (slug: string, contractAddress: string) => {
    setBusy(`bind:${contractAddress}:${slug}`);
    try {
      const res = await fetch(`${API_BASE}/admin/hypha/bind`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ tokenSlug: slug, contractAddress }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "Nothing was stored"));
      toast.success(refusal(d, "Confirmed"));
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Nothing was stored");
    } finally {
      setBusy("");
    }
  };

  /**
   * The one audited variable write this panel makes, for the pointer and for
   * the account fields alike.
   *
   * `onVariableSaved` is not optional politeness. This panel now renders the
   * Hypha rows that the variables list below it ALSO renders, so a write that
   * refreshed only the bridge status would leave the field and the row on one
   * screen showing different addresses. That would make the merged panel worse
   * than the two it replaced, where the disagreement was at least invisible.
   */
  const saveVariable = async (variableKey: string, address: string, busyKey?: string) => {
    setBusy(busyKey ?? `point:${variableKey}`);
    try {
      const res = await fetch(`${API_BASE}/admin/variables/${encodeURIComponent(variableKey)}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ value: address }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "Could not save"));
      toast.success(`Saved as ${variableKey}`);
      await load();
      onVariableSaved();
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    } finally {
      setBusy("");
    }
  };

  const unbind = async (slug: string) => {
    setBusy(`unbind:${slug}`);
    try {
      const res = await fetch(`${API_BASE}/admin/hypha/bindings/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        headers: authHeaders(password),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "Could not unbind"));
      toast.success(refusal(d, "Unbound"));
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Could not unbind");
    } finally {
      setBusy("");
    }
  };

  const refresh = async () => {
    setBusy("refresh");
    try {
      const res = await fetch(`${API_BASE}/admin/hypha/refresh`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: "{}",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "Could not read Base"));
      toast.success(refusal(d, "Read"));
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Could not read Base");
    } finally {
      setBusy("");
    }
  };

  const resolveOrphan = async (id: string) => {
    const note = window.prompt("What did this outcome turn out to be? An orphan closed with no words is one nobody can audit.");
    if (!note?.trim()) return;
    setBusy(`orphan:${id}`);
    try {
      const res = await fetch(`${API_BASE}/admin/hypha/outcomes/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ note: note.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(refusal(d, "Could not answer that one"));
      toast.success(refusal(d, "Answered"));
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Could not answer that one");
    } finally {
      setBusy("");
    }
  };

  if (loading) return <p className="text-sm text-gray-400">Loading the bridge…</p>;
  if (!status) return null;
  /*
   * MODULE OFF IS NO LONGER AN EARLY RETURN, and that is the point of the
   * merge. A founder integrates their DAO BEFORE the Bridge is on, because
   * the addresses discovered here are what the Bridge is then configured
   * with. Returning early hid the account fields and the lookup behind the
   * very module they exist to configure, which is why a second panel was
   * built outside the gate in the first place.
   *
   * What genuinely belongs to the running module still hides: the listener
   * posture, the confirmed contracts, the switchover rule and the orphans.
   */
  const moduleOff = !!status.moduleOff;

  const posture = status.listener ?? {};
  const slots: any[] = status.slots ?? [];
  const orphans: any[] = status.orphans ?? [];
  const sw = status.switchover ?? {};
  /*
   * Substring on name, symbol or address, so a founder who remembers "voice"
   * finds "Village Voice" and one who pasted an address finds that. An empty
   * box shows everything, which is the honest default: this is a list of what
   * the account holds, and hiding rows by default would be the same mistake
   * the exact-name lookup made.
   */
  /*
   * True when the founder has typed a Base address and not saved it. The
   * lookup route reads the STORED variable, so an unsaved box is invisible
   * to it.
   */
  const founderVar = (vars ?? []).find((row: any) => row.key === FOUNDER_KEY);
  const founderAddressUnsaved =
    !!founderVar &&
    accountDrafts[FOUNDER_KEY] !== undefined &&
    accountDrafts[FOUNDER_KEY].trim() !== String(founderVar.value ?? "").trim();

  const q = hint.trim().toLowerCase();
  const shown = (candidates ?? []).filter((c: any) =>
    !q ||
    String(c.tokenName ?? "").toLowerCase().includes(q) ||
    String(c.tokenSymbol ?? "").toLowerCase().includes(q) ||
    String(c.contractAddress ?? "").toLowerCase().includes(q),
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900 text-sm">Hypha Bridge</h3>
        <p className="text-xs text-gray-500 mt-1 max-w-2xl">
          What this village reads from Base, who reads it, and where an outcome
          goes when it comes home. Everything here is read only. The platform
          displays what the chain says and links you out to Hypha to act.
        </p>
      </div>


      {/*
        THE ACCOUNT FIELDS, FIRST, because a founder cannot do anything else
        on this screen until the Base account address is set. Rye asked where
        to put it: "where's the section to put in hypha account name (with a
        little screenshot showing where to find it in Hypha top right copy
        keys button)". It was in Game Mechanics, one row among a hundred and
        twenty, findable only by knowing to search for "hypha".
      */}
      <div className={card}>
        <h4 className="font-medium text-foreground text-sm">Your Hypha account</h4>
        <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
          What this village reads from, and where it reads it. These are ordinary
          audited settings; saving one here is the same act as editing it below.
        </p>

        <div className="mt-3 space-y-3">
          {HYPHA_KEYS.map((key) => {
            const v = (vars ?? []).find((row: any) => row.key === key);
            if (!v) return null;
            const current = String(v.value ?? "");
            const draft = accountDrafts[key] ?? current;
            /*
             * Compared TRIMMED, because the save trims. Typing a trailing
             * space, saving, and getting the trimmed value back left the box
             * permanently different from the stored value: Save stayed lit
             * for a change that had already landed, and pressing it again
             * did nothing observable.
             */
            const dirty = draft.trim() !== current.trim();
            return (
              <div key={key}>
                <label htmlFor={`hypha-${key}`} className="text-xs font-medium text-foreground block mb-1">
                  {v.label ?? key}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id={`hypha-${key}`}
                    value={draft}
                    onChange={(e) => setAccountDrafts({ ...accountDrafts, [key]: e.target.value })}
                    placeholder={key === FOUNDER_KEY ? "0x..." : ""}
                    className={`${input} flex-1 min-w-[16rem]`}
                  />
                  <button
                    type="button"
                    disabled={!dirty || busy === `var:${key}`}
                    onClick={() => saveVariable(key, draft.trim(), `var:${key}`)}
                    className={primary}
                  >
                    {busy === `var:${key}` ? "Saving…" : "Save"}
                  </button>
                </div>
                {v.description && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl">{v.description}</p>
                )}
                {key === FOUNDER_KEY && (
                  <details className="mt-1.5">
                    <summary className="text-[11px] text-teal-deep cursor-pointer">Where to find it in Hypha</summary>
                    <div className="mt-2 text-[11px] text-muted-foreground max-w-md">
                      <ol className="list-decimal list-inside space-y-0.5 mb-2">
                        <li>Open your DAO on Hypha and sign in.</li>
                        <li>Click your avatar, top right.</li>
                        <li>Use the copy button beside the address under your name.</li>
                      </ol>
                      <HyphaCopyDiagram />
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {moduleOff && (
        <div className={card}>
          <p className="text-xs text-muted-foreground max-w-2xl">
            The Hypha Bridge module is off, so nothing below is running and no
            contract can be confirmed yet. Your Hypha links and the proposal
            handoff work exactly as they always have. Set your account address
            above and find your contracts first; turn the module on when you
            are ready for this village to read its DAO's numbers from Base.
          </p>
        </div>
      )}

      {/* 3. Discovery as a pick-list. It proposes; a human confirms. */}
      <div className={card}>
        <h4 className="font-medium text-gray-900 text-sm">Find your contracts on Base</h4>
        <ol className="text-xs text-gray-500 mt-1 space-y-0.5 list-decimal list-inside max-w-2xl">
          {(status.firstSteps ?? lookupSteps ?? HYPHA_FIRST_STEPS).map((s: string) => <li key={s}>{s}</li>)}
        </ol>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="Token name, if you remember it"
            aria-label="Filter the tokens this account holds"
            className={`${input} min-w-[220px]`}
          />
          <button type="button" onClick={lookup} disabled={busy === "lookup"} className={primary}>
            <Search className="w-4 h-4 inline mr-1.5" />
            {busy === "lookup" ? "Looking…" : "List what this account holds"}
          </button>
        </div>
        {/*
          THE LOOKUP READS THE SAVED ADDRESS, not the box above.
          A founder who pastes their address and comes straight down here gets
          the server's 409 telling them to set an address they can see they
          have already typed. Say it before they press, rather than refusing
          them afterwards with a message that looks wrong.
        */}
        {founderAddressUnsaved && (
          <p className="text-xs text-amber-700 mt-2 max-w-2xl">
            The Base account address above has not been saved yet, and this looks up whatever is
            saved. Press Save on that field first.
          </p>
        )}
        {candidates && (
          <div className="mt-3">
            {/*
              THE NAME BOX IS A FILTER NOW, and it used to be a second panel.
              The retired IntegrateDaoPanel took an EXACT on-chain name, and a
              founder who mistyped it or misremembered the capitalisation was
              told the token did not exist. Substring matching here, over the
              list the account really holds, so a half-remembered name narrows
              the list instead of emptying it. The exact-match semantics stay
              on the server, where the "name matches" badge is minted.
            */}
            {hint.trim() && (
              <p className="text-xs text-muted-foreground mb-1">
                Showing {shown.length} of {candidates.length} token(s) this account holds.{" "}
                <button type="button" onClick={() => setHint("")} className="text-teal-deep underline">
                  Clear the filter
                </button>
              </p>
            )}
            <p className="text-xs text-gray-500 max-w-2xl">
              Every token the founder account holds. Airdropped tokens land in any
              account that has ever been used, and a token built to impersonate
              yours will carry your exact name, so read the address before you
              confirm one. Confirming reads the name and symbol off the contract
              itself.
            </p>
            <ul className="mt-2 space-y-1.5">
              {shown.map((c) => (
                <li key={c.contractAddress} className="border border-gray-100 rounded-lg px-3 py-2 text-sm">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span>
                      <span className="font-medium text-gray-900">{c.tokenName}</span>{" "}
                      <span className="text-gray-500">({c.tokenSymbol})</span>
                      {c.nameMatches && <span className="ml-2 text-xs text-emerald-700">name matches</span>}
                    </span>
                    <code className="text-xs text-gray-500 select-all">{c.contractAddress}</code>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {/*
                      With the Bridge off there are no slots to confirm into,
                      and a row with no control and no explanation reads as a
                      broken screen. Say why, and still hand over the address:
                      a founder can paste it into the settings above right
                      now, which is the whole reason this lookup is reachable
                      with the module off.
                    */}
                    {moduleOff ? (
                      <span className="text-xs text-muted-foreground">
                        Turn the Hypha Bridge module on to confirm this contract against a token.
                      </span>
                    ) : (
                      slots.map((s) => (
                        <button
                          key={s.slug}
                          type="button"
                          onClick={() => confirmBinding(s.slug, c.contractAddress)}
                          disabled={busy === `bind:${c.contractAddress}:${s.slug}`}
                          className={btn}
                        >
                          Confirm as {s.slug}
                        </button>
                      ))
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {!moduleOff && (
      <>
      {/* 1. Who watches Base. Derived from the hosting relationship, never a toggle. */}
      <div className={`border rounded-xl px-4 py-3 text-sm ${LISTENER_TONE[posture.mode] ?? LISTENER_TONE.none}`}>
        <p className="font-medium">{posture.summary}</p>
        <p className="text-xs mt-1 opacity-90">{posture.cost}</p>
        {posture.todo && <p className="text-xs mt-1 opacity-90">{posture.todo}</p>}
        <p className="text-[11px] mt-2 opacity-75">
          This follows who hosts this village and is not a setting. A village the
          hub carries uses the hub's listener; a village hosting itself runs its own.
        </p>
      </div>

      {/* 2. The bindings: what the chain calls each contract, and who said yes. */}
      <div className={card}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="font-medium text-gray-900 text-sm">Token contracts</h4>
          <button type="button" onClick={refresh} disabled={busy === "refresh"} className={btn}>
            <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />
            {busy === "refresh" ? "Reading Base…" : "Read Base again"}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {slots.map((s) => (
            <div key={s.slug} className="border border-gray-100 rounded-lg px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-medium text-gray-900">{s.slug}</span>
                {s.binding ? (
                  <span className="text-xs text-emerald-700 inline-flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    confirmed {new Date(s.binding.confirmedAt).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="text-xs text-amber-700">nobody has confirmed a contract for this</span>
                )}
              </div>
              {s.binding ? (
                <p className="text-xs text-gray-600 mt-1">
                  The contract answers to{" "}
                  <span className="font-medium text-gray-900">{s.binding.chainName}</span> ({s.binding.chainSymbol}),
                  read from Base on {new Date(s.binding.readAt).toLocaleDateString()}. {s.binding.decimals} decimals.
                </p>
              ) : null}
              <p className="text-xs text-gray-500 mt-1">
                {s.pointerAddress ? (
                  <>Platform points at <code className="select-all">{s.pointerAddress}</code></>
                ) : (
                  <>The platform points at nothing yet, so nothing is read for this token.</>
                )}
              </p>
              {s.binding && !s.agrees && (
                <p className="text-xs text-red-700 mt-1 inline-flex items-start gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  The confirmed contract and the address the platform reads are different. One of the two is stale.
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                {s.binding && !s.agrees && (
                  <button
                    type="button"
                    onClick={() => saveVariable(s.variableKey, s.binding.contractAddress)}
                    disabled={busy === `point:${s.variableKey}`}
                    className={btn}
                  >
                    Point {s.variableKey} at the confirmed contract
                  </button>
                )}
                {s.binding && (
                  <button type="button" onClick={() => unbind(s.slug)} disabled={busy === `unbind:${s.slug}`} className={btn}>
                    Unbind
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>


      {/* 4. The switchover. The rule was already true; nothing said it out loud. */}
      <div className={card}>
        <h4 className="font-medium text-gray-900 text-sm">If this village changes how it decides</h4>
        <p className="text-xs text-gray-600 mt-1 max-w-2xl">{sw.rule}</p>
        <p className="text-xs text-gray-900 mt-2 max-w-2xl">{sw.effect}</p>
      </div>

      {/* 5. The orphans. Recorded instead of dropped. */}
      <div className={card}>
        <h4 className="font-medium text-gray-900 text-sm">Outcomes that landed nowhere</h4>
        {orphans.length === 0 ? (
          <p className="text-xs text-gray-500 mt-1">
            None waiting. An outcome arrives here when its agreement id and its
            title marker both match no proposal in this village.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {orphans.map((o) => (
              <li key={o.id} className="border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-sm">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-amber-900">
                    {o.verdict} · agreement {o.agreementId || "none given"} · marker {o.marker || "none given"}
                  </span>
                  <span className="text-xs text-amber-800">{new Date(o.receivedAt).toLocaleString()}</span>
                </div>
                <button
                  type="button"
                  onClick={() => resolveOrphan(o.id)}
                  disabled={busy === `orphan:${o.id}`}
                  className={`${btn} mt-2`}
                >
                  Say what this was
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      </>
      )}
    </div>
  );
}
