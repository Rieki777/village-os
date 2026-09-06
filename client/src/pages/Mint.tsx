/**
 * The Mint: what the village pays for, and what it has issued.
 *
 * Its own route rather than a tab inside the 5,000-line Admin page, because
 * editing that file is how another lane's in-flight work gets swept up, and
 * because this surface has one job and can be read in one screen.
 *
 * EVERY EDIT HERE WAITS FOR THE MOON, and the panel says so at the point of
 * change rather than in a help text nobody opens. That is not a UI choice: the
 * server defers it, so an admin who expects an immediate change would otherwise
 * watch nothing happen and try again. A surface that could write a live amount
 * would be a way around the deferral rather than a use of it.
 *
 * Colours follow what this lane learned the hard way: text on the page
 * background is measured against #f2f2f2 and never against white, `-light`
 * tokens are backgrounds and never foregrounds, and a tint set on an element is
 * the backdrop for the text on that element.
 */
import Layout from "@/components/Layout";
import NotFound from "@/pages/NotFound";
import { Link } from "wouter";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { villageMoonSentence, type VillageMoon } from "@shared/villageMoon";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t
    ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
};

interface Rule {
  id: string;
  trigger: string;
  token: string;
  tokenName: string;
  amount: number | null;
  ceiling: number;
  recipient: string;
  enabled: boolean;
  pending: null | { amount: number | null; ceiling: number; enabled: boolean; fromCycle: number };
}

interface View {
  /** The stored cycle id. Machinery: every rule's effective-from is compared
   *  against it, and this panel does not print it. */
  cycleKey: string;
  /** The village's own moon, which is what the page says out loud. */
  moon: VillageMoon;
  rules: Rule[];
  supply: Array<{ token: string; source: string; issued: number }>;
  settlementPreview: { seats: number; mints: Array<{ token: string; units: number }> };
}

/**
 * One dial from the variables registry.
 *
 * Read and written through `/api/admin/variables`, NOT through a second
 * endpoint of this panel's own: that route already carries the bounds, the
 * refusal wording and the audit line, and a parallel writer would have to
 * reproduce all three and would eventually disagree with one of them.
 */
interface Dial {
  key: string;
  label: string;
  description: string;
  type: string;
  value: string;
  default: string;
  isDefault: boolean;
  min?: number;
  max?: number;
  unit?: string;
}

/** The slug is pulled out of the list and given the top of the page. */
const HYPHA_KEY = "economy.hypha_space";

const card = "bg-white rounded-2xl shadow-lg p-6";
const h2 = "text-xl font-display font-bold text-teal-deep mb-4";

/** Plain words for a machine-readable trigger. */
const TRIGGER_WORDS: Record<string, string> = {
  "quest.completed": "A steward confirms finished work",
  "gratitude.given": "A member thanks another",
  "role.cycle": "Each moon, to everyone holding a seat",
  "journey.stage_reached": "Reaching a stage of the journey",
  "welcome_aboard.quest": "A welcome quest",
  "library.contributed": "Lending something to the library",
  "stay.work_exchange": "A work exchange for a stay",
};

export default function Mint() {
  const { user, loading } = useAuth();
  const [view, setView] = useState<View | null>(null);
  const [dials, setDials] = useState<Dial[]>([]);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  /*
   * CONTROLLED, deliberately.
   *
   * These were `defaultValue` with an onBlur, which React never updates on a
   * re-render: pressing "Back to 100" saved the default, flipped the chip to
   * "Platform default", and left the discarded village number sitting in the
   * box. Focusing and leaving that box then wrote the discarded number straight
   * back, so the reset undid itself and the panel disagreed with the server
   * about what the village had chosen.
   */
  const [edits, setEdits] = useState<Record<string, string>>({});
  /** A refusal belongs beside the control that caused it, not 1500px above it. */
  const [dialNote, setDialNote] = useState<{ key: string; text: string } | null>(null);

  const load = () => {
    fetch("/api/admin/economy", { headers: headers() })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          setDenied(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => d && setView(d))
      .catch(() => {});
    fetch("/api/admin/variables", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const mine = (d.categories ?? []).find((c: { name: string }) => c.name === "The Mint");
        setDials(mine?.variables ?? []);
      })
      .catch(() => {});
  };
  /*
   * NOTHING IS ASKED FOR UNTIL SOMEONE IS SIGNED IN.
   *
   * This ran `load` on every mount. A signed-out visitor opening /admin/mint
   * therefore fired GET /api/admin/economy and GET /api/admin/variables with no
   * token, collected two 401s in the console, and was then shown the 404 body
   * while the tab still read "Village settings". /admin has answered the same
   * visitor with a sign-in prompt all along; this makes the two agree, and the
   * prompt below is what renders instead of the 404.
   *
   * `loading` is the guard that makes it correct rather than merely quiet: the
   * session is restored asynchronously, so a first paint with `user` still null
   * is "we do not know yet" and not "this is a stranger".
   */
  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const hypha = dials.find((d) => d.key === HYPHA_KEY) ?? null;

  /**
   * Write one dial. The refusal wording comes from the server, never from here.
   *
   * On success the local edit is DROPPED so the refreshed stored value takes
   * over the box. On refusal the edit is kept, so the admin can see and correct
   * what they typed, with the reason beside that control.
   *
   * The `finally` is load-bearing: without it a rejected fetch (an offline
   * laptop, a dropped connection) skipped `setBusy("")` and pinned the whole
   * page's busy key forever, disabling that dial and its reset button with the
   * message already cleared and nothing to explain it.
   */
  const saveDial = async (dial: Dial, value: string): Promise<boolean> => {
    setBusy(dial.key);
    setDialNote(null);
    try {
      const res = await fetch(`/api/admin/variables/${encodeURIComponent(dial.key)}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDialNote({ key: dial.key, text: body.error || "That value was refused." });
        return false;
      }
      setEdits((e) => {
        const next = { ...e };
        delete next[dial.key];
        return next;
      });
      setDialNote({ key: dial.key, text: `Saved. ${dial.label} is now ${value || "blank"}.` });
      load();
      return true;
    } catch {
      setDialNote({ key: dial.key, text: "That did not reach the server. Nothing was changed." });
      return false;
    } finally {
      setBusy("");
    }
  };

  /** What the box shows: the admin's unsaved edit, else the stored value. */
  const shown = (d: Dial) => edits[d.key] ?? d.value;

  const queue = async (rule: Rule, change: Record<string, unknown>) => {
    setBusy(rule.id);
    setNote("");
    const res = await fetch(`/api/admin/economy/rules/${encodeURIComponent(rule.id)}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(change),
    });
    setBusy("");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(body.error || "That change was refused.");
      return;
    }
    if (body.view) setView(body.view);
    setNote("Queued. It takes effect at the next moon.");
  };

  /*
   * Signed out is a DOOR, not a dead end. A signed-in account without the
   * capability still gets the 404 body below, which is the opacity /admin's
   * own gate keeps: a member has no way to learn that this surface exists.
   */
  if (loading) {
    return (
      <Layout>
        <div className="container py-16 text-gray-700">Looking.</div>
      </Layout>
    );
  }
  if (!user) {
    return (
      <Layout>
        <div className="container max-w-md py-16">
          <div className={card}>
            <h1 className="text-2xl font-display font-bold text-teal-deep">The Mint</h1>
            <p className="mt-3 text-gray-700">
              Sign in with your admin account to open the Mint.
            </p>
            <Link
              href="/admin"
              className="mt-6 inline-block rounded-lg bg-teal-deep px-5 py-3 text-white"
            >
              Go to village settings
            </Link>
          </div>
        </div>
      </Layout>
    );
  }
  if (denied) return <NotFound />;
  if (!view) {
    return (
      <Layout>
        <div className="container py-16 text-gray-700">Looking.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-teal-deep/5 to-amber/5 py-10">
        <div className="container max-w-4xl">
          <h1 className="text-3xl font-display font-bold text-teal-deep">The Mint</h1>
          <p className="mt-2 text-gray-700">
            What this village pays for, and what it has issued. Every change here takes effect at
            the next moon, so nothing can be raised and lowered around a settlement.
          </p>
          <p className="mt-1 text-sm text-sage">{villageMoonSentence(view.moon)}</p>

          {note ? (
            <p className="mt-4 rounded-lg border border-sage/40 bg-sage-light px-4 py-3 text-sm text-sage">
              {note}
            </p>
          ) : null}

          {/*
            THE HYPHA SPACE, AT THE TOP AND ON ITS OWN.
            It is one text field, and it is the single thing standing between
            accruing voice and voice that can actually be claimed, so it gets
            the first thing an admin sees rather than a row in a list of dials.
            The card states which of the two states the village is in, because
            "empty field" and "deliberately not using this" look identical.
          */}
          {hypha ? (
            <section
              className={`${card} mt-6 border-2 ${hypha.value ? "border-sage/50" : "border-amber/60"}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-display font-bold text-teal-deep">Your Hypha space</h2>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    hypha.value ? "bg-sage-light text-sage" : "bg-amber-light text-gray-900"
                  }`}
                >
                  {hypha.value ? "Saved" : "Not set yet"}
                </span>
              </div>
              <p className="mt-3 text-gray-800">{hypha.description}</p>
              <label className="mt-4 block text-sm font-semibold text-gray-900">
                DHO slug
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-700">app.hypha.earth/</span>
                  <input
                    type="text"
                    value={shown(hypha)}
                    placeholder="your-space"
                    maxLength={120}
                    onChange={(e) => setEdits((s) => ({ ...s, [HYPHA_KEY]: e.target.value }))}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== hypha.value) void saveDial(hypha, v);
                    }}
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base"
                  />
                </div>
              </label>
              <p className="mt-3 text-sm text-gray-700">
                {hypha.value
                  ? "Saved. Voice claims will be raised into this space once the connection is finished. Clearing it puts things back as they were: voice keeps gathering and members are told it cannot be claimed yet."
                  : "Safe to fill in as soon as you have it. Nothing is lost by leaving it empty while the space is being set up."}
              </p>
              {/*
                SETTING THE SLUG IS NOT THE LAST STEP, and the panel has to say
                so. Claims stay shut until the dispatch that raises the proposal
                on Hypha exists, because a claim debits a member's voice and
                waits for an answer: with nothing raising the proposal, no
                answer is ever coming and the voice would sit stranded. An admin
                who filled this in and believed claims were live would be
                waiting on something that had not started.
              */}
              {dialNote?.key === HYPHA_KEY ? (
                <p className="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900">
                  {dialNote.text}
                </p>
              ) : null}
              <p className="mt-3 rounded-lg bg-amber-light px-3 py-2 text-sm text-gray-900">
                Claims are not open yet, whatever is in this box. The piece that raises the
                proposal on Hypha is still being built, and until it ships a claim would take a
                member's voice with nothing able to answer it. The member-facing chip that shows
                gathering voice is not built either, so nobody is being shown a promise about it.
              </p>
            </section>
          ) : null}

          {/* The rules. */}
          <section className={`${card} mt-6`}>
            <h2 className={h2}>What the village pays</h2>
            {view.rules.length === 0 ? (
              <p className="text-gray-700">No rules seeded yet. The economy mints nothing until there are.</p>
            ) : (
              <ul className="space-y-4">
                {view.rules.map((r) => (
                  <li key={r.id} className="rounded-xl border border-gray-200 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-gray-900">
                        {TRIGGER_WORDS[r.trigger] ?? r.trigger}
                      </p>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          r.enabled ? "bg-sage-light text-sage" : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {r.enabled ? "Paying" : "Paused"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-700">
                      {r.amount === null
                        ? `up to ${r.ceiling} ${r.tokenName}, as much as the work was posted for`
                        : `${r.amount} ${r.tokenName}`}
                      {" to each "}
                      {r.recipient}
                    </p>

                    {r.pending ? (
                      <p className="mt-2 rounded-lg bg-amber-light px-3 py-2 text-sm text-gray-900">
                        Queued for the next moon:{" "}
                        {r.pending.amount === null ? "read from the source" : `${r.pending.amount} ${r.tokenName}`}
                        {r.pending.enabled ? "" : ", paused"}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="text-sm text-gray-700">
                        Amount
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          defaultValue={r.amount ?? ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v === String(r.amount ?? "")) return;
                            queue(r, { amount: v === "" ? null : Number(v) });
                          }}
                          className="ml-2 w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-base"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => queue(r, { enabled: !r.enabled })}
                        className="min-h-11 rounded-lg border border-teal-deep px-4 py-2 text-sm font-semibold text-teal-deep disabled:opacity-50"
                      >
                        {r.enabled ? "Pause at the next moon" : "Resume at the next moon"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/*
            THE DIALS, WITH THEIR REASONING ATTACHED.
            The description is shown in full rather than behind a tooltip: these
            are set once, by somebody deciding how their village should work,
            and the cost of reading a paragraph is far below the cost of picking
            a number blind. Each one also shows the platform default, so a
            founder can see what they have changed and put it back.
          */}
          {dials.filter((d) => d.key !== HYPHA_KEY).length ? (
            <section className={`${card} mt-6`}>
              <h2 className={h2}>When voice can be claimed</h2>
              <p className="-mt-2 mb-5 text-gray-700">
                Voice gathers all season and formalises in one pass, so a season of contribution
                becomes a handful of proposals your circle can genuinely sit with. These decide
                when that happens and how much it takes.
              </p>
              <ul className="space-y-5">
                {dials
                  .filter((d) => d.key !== HYPHA_KEY)
                  .map((d) => (
                    <li key={d.key} className="rounded-xl border border-gray-200 p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-semibold text-gray-900">{d.label}</p>
                        {d.isDefault ? (
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                            Platform default
                          </span>
                        ) : (
                          <span className="rounded-full bg-sage-light px-3 py-1 text-xs font-semibold text-sage">
                            Set by this village
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-gray-800">{d.description}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <input
                          type={d.type === "integer" || d.type === "decimal" ? "number" : "text"}
                          inputMode={d.type === "integer" ? "numeric" : undefined}
                          min={d.min}
                          max={d.max}
                          value={shown(d)}
                          onChange={(e) => setEdits((s) => ({ ...s, [d.key]: e.target.value }))}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== d.value) void saveDial(d, v);
                          }}
                          className="min-h-11 w-44 rounded-lg border border-gray-300 px-3 py-2 text-base"
                        />
                        {d.unit ? <span className="text-sm text-gray-700">{d.unit}</span> : null}
                        {d.isDefault ? null : (
                          <button
                            type="button"
                            /*
                              NOT disabled on `busy`, and mousedown is swallowed.
                              The input's blur sets busy to this same key, and
                              blur flushes synchronously during mousedown, so
                              the button disabled itself in the instant between
                              press and click and the reset silently never fired.
                              Preventing the default on mousedown keeps focus in
                              the input, so no blur happens and the click lands.
                            */
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setEdits((s) => ({ ...s, [d.key]: d.default }));
                              void saveDial(d, d.default);
                            }}
                            className="min-h-11 rounded-lg border border-teal-deep px-4 py-2 text-sm font-semibold text-teal-deep"
                          >
                            Back to {d.default || "blank"}
                          </button>
                        )}
                      </div>
                      {dialNote?.key === d.key ? (
                        <p className="mt-2 rounded-lg bg-amber-light px-3 py-2 text-sm text-gray-900">
                          {dialNote.text}
                        </p>
                      ) : null}
                      {d.min !== undefined && d.max !== undefined ? (
                        <p className="mt-2 text-xs text-gray-700">
                          Anything from {d.min} to {d.max}. The platform default is {d.default}.
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-gray-700">The platform default is {d.default || "blank"}.</p>
                      )}
                    </li>
                  ))}
              </ul>
              <p className="mt-5 text-sm text-gray-700">
                A change you make here takes effect straight away, because you are the founder and
                this is your setup. The same dials moved by a governance proposal wait for the next
                moon instead, so a vote cannot shift the goalposts under a season already counting.
              </p>
            </section>
          ) : null}

          {/* Supply, per source. This detail is admin-only on purpose. */}
          <section className={`${card} mt-6`}>
            <h2 className={h2}>What has been issued</h2>
            {view.supply.length === 0 ? (
              <p className="text-gray-700">Nothing yet. Every faucet is still at zero.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-gray-700">
                    <th className="pb-2 font-semibold">Token</th>
                    <th className="pb-2 font-semibold">From</th>
                    <th className="pb-2 text-right font-semibold">Issued</th>
                  </tr>
                </thead>
                <tbody>
                  {view.supply.map((s) => (
                    <tr key={`${s.token}:${s.source}`} className="border-t border-gray-100">
                      <td className="py-2 text-gray-900">{s.token}</td>
                      <td className="py-2 text-gray-700">{s.source}</td>
                      <td className="py-2 text-right text-gray-900">{s.issued}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-4 text-sm text-gray-700">
              This breakdown stays here. The public feed publishes village totals only, because at
              a small size a per-source figure can be read back to one person's balance.
            </p>
          </section>

          {/* Settlement preview. */}
          <section className={`${card} mt-6`}>
            <h2 className={h2}>At the next moon</h2>
            {view.settlementPreview.seats === 0 ? (
              <p className="text-gray-700">Nobody holds a seat, so the settlement pays nothing.</p>
            ) : (
              <p className="text-gray-800">
                {view.settlementPreview.seats} seat
                {view.settlementPreview.seats === 1 ? "" : "s"} thanked
                {view.settlementPreview.mints.length
                  ? `, and ${view.settlementPreview.mints
                      .map((m) => `${m.units} of ${m.token}`)
                      .join(", ")} minted.`
                  : "."}
              </p>
            )}
            <p className="mt-3 text-sm text-gray-700">
              Computed from the rules in force now, so a change queued today is not in this
              number until the moon it lands in.
            </p>
          </section>
        </div>
      </div>
    </Layout>
  );
}
