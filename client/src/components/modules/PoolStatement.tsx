/**
 * The builders' pool statement (lane METER).
 *
 * R59, the founder: "Platform made modules can still earn ReGen to keep the
 * system flowing well but those earnings just cycle back into the bucket to
 * give out again next cycle." His instruction about this surface was that the
 * recycling be visible: "a village or an author should be able to see that the
 * platform's share went back in, not into our pocket." So the returning share
 * is a number on the page and never a footnote.
 *
 * R56: state what is true, then get out of the way. Every line here is a count
 * or an amount. There is no encouragement to use more modules, no health
 * colour, and no verdict on what any of it means.
 *
 * R55: never a scorecard. This shows one village its own reading and has no
 * access to any other village's, so there is nothing here to rank against and
 * no way to add one later without a new route. The modules are ordered by share
 * because a statement is ordered by amount, and no member appears anywhere: the
 * server counts people and never names them.
 */
import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";

interface PoolModule {
  id: string;
  name: string;
  core: boolean;
  builtBy: string | null;
  pool: { eligible: boolean; reason: string; disposition: "paid" | "recycled" | "none" };
  membersReached: number;
  reach: number;
  share: number;
  settlement: "payable" | "accrued" | "recycled";
}

interface PoolPayload {
  basis: string;
  cycle: string;
  sealed: boolean;
  activeMembers: number;
  totals: {
    pool: number;
    payable: number;
    accrued: number;
    distributed: number;
    recycled: number;
    nextCyclePool: number;
  };
  modules: PoolModule[];
}

const num = (n: number) => n.toLocaleString();
const pct = (n: number) => `${Math.round(n * 100)}%`;

/*
 * OWED, never "paid". Nothing in this codebase can move a token, and no
 * distribution has ever been made, so a label reading "Paid to the builder"
 * would be the product asserting an event that did not happen. `payable` and
 * `accrued` are both owed; what separates them is whether there is an account
 * to settle against, which is what these two sentences say.
 */
const WHERE_IT_GOES: Record<PoolModule["settlement"], string> = {
  payable: "Owed to the builder",
  accrued: "Held for the builder",
  recycled: "Back into the pool",
};

export default function PoolStatement() {
  const [data, setData] = useState<PoolPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/modules/pool")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        // Shape-checked before it is trusted. `num()` calls `toLocaleString` on
        // `totals.pool` and the table maps `modules`, so a well-formed 200 of
        // the wrong shape (an old server behind a new bundle) would throw
        // during render and take the whole Modules page down with it, not only
        // this card. A statement that cannot be read renders as no statement.
        if (!d || typeof d.totals !== "object" || d.totals === null || !Array.isArray(d.modules)) {
          throw new Error("unreadable pool statement");
        }
        setData(d as PoolPayload);
      })
      .catch(() => setFailed(true));
  }, []);

  if (failed || !data) return null;

  const used = data.modules.filter((m) => m.membersReached > 0);

  return (
    <section className="mt-10 rounded-xl border border-border bg-card p-4 sm:p-6 min-w-0">
      <h2 className="text-lg font-semibold text-foreground">
        The builders&rsquo; pool this cycle{" "}
        <InfoTip
          label="What this statement is"
          tip="Every module earns a share of the $ReGen pool from how many members open it. A module somebody outside the platform built is owed its share. A module the platform built earns its share the same way, and that share goes back into the pool to be given out again next cycle."
        />
      </h2>
      <p className="text-sm text-muted-foreground mt-1">
        Cycle {data.cycle}. {num(data.activeMembers)} members opened a module.
      </p>
      {!data.sealed && (
        <p className="text-sm text-muted-foreground mt-1">
          This cycle is still open, so these numbers are still moving.
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        This is what this village&rsquo;s own usage says. The pool is settled across every village at
        once, so these shares are a reading and not a payment.
      </p>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 [overflow-wrap:anywhere] [&>*]:min-w-0">
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">The pool</dt>
          <dd className="text-xl font-semibold text-foreground">{num(data.totals.pool)}</dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">To builders</dt>
          <dd className="text-xl font-semibold text-foreground">{num(data.totals.distributed)}</dd>
        </div>
        <div className="rounded-lg border border-teal-deep/30 bg-teal-deep/5 p-3">
          <dt className="text-xs text-teal-deep">Back into the pool</dt>
          <dd className="text-xl font-semibold text-teal-deep">{num(data.totals.recycled)}</dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">Next cycle holds</dt>
          <dd className="text-xl font-semibold text-foreground">{num(data.totals.nextCyclePool)}</dd>
        </div>
      </dl>

      <p className="text-sm text-foreground mt-3">
        {num(data.totals.distributed)} of {num(data.totals.pool)} $ReGen is owed to builders outside
        the platform, and {num(data.totals.recycled)} returns to the pool.{" "}
        {data.totals.accrued > 0 && (
          <>
            {num(data.totals.accrued)} of what is owed is held for a builder who has no ReGen Civics
            account linked yet.{" "}
          </>
        )}
        The two add up to {num(data.totals.payable + data.totals.accrued + data.totals.recycled)}.
      </p>

      {used.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-4">
          No module has been opened this cycle, so the whole pool carries forward.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-medium">Module</th>
                <th className="py-2 pr-3 font-medium">Built by</th>
                <th className="py-2 pr-3 font-medium text-right">Members</th>
                <th className="py-2 pr-3 font-medium text-right">Reach</th>
                <th className="py-2 pr-3 font-medium text-right">Share</th>
                <th className="py-2 font-medium">Where it goes</th>
              </tr>
            </thead>
            <tbody>
              {used.map((m) => (
                <tr key={m.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2 pr-3 text-foreground">{m.name}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{m.builtBy ?? "The platform"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                    {num(m.membersReached)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-foreground">{pct(m.reach)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-foreground">{num(m.share)}</td>
                  <td
                    className={`py-2 ${m.settlement === "recycled" ? "text-teal-deep" : "text-foreground"}`}
                  >
                    {WHERE_IT_GOES[m.settlement]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-4">
        Reach is the share of members who opened a module this cycle. Opening it again does not
        count twice, and neither does writing in it, so a module earns by being opened by more
        people and never by asking more of the same ones.
      </p>
    </section>
  );
}
