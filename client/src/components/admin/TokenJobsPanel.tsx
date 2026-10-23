/**
 * Which token does what (Rye, 2026-10-22): "in admin we should set what token
 * is responsible (if at all) for any of these functions."
 *
 * A READER, deliberately. Every job already has one place that decides it (a
 * dial, the mint rules, the exchange settings, a module), and a second place
 * to set the same thing is how two answers drift apart. So each row says which
 * tokens do the job right now and sends the founder to the door that owns it.
 * The model is the economics engine's (shared/tokenJobs.ts,
 * GET /api/admin/token-jobs); this file only draws it.
 *
 * No sentence here says what a token does. Labels name the job; the village
 * decides what its tokens mean.
 */
import { useEffect, useState } from "react";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import type { TokenJob, TokenJobSource } from "@shared/tokenJobs";

/** Where a founder goes to change a job, in words and as a link. */
export function doorFor(source: TokenJobSource): { text: string; href?: string } {
  switch (source.kind) {
    case "dial":
      return { text: "Set in Game Mechanics", href: `/admin?tab=variables&variable=${encodeURIComponent(source.key)}` };
    case "mint_rules":
      return { text: "Set in the mint rules", href: "/admin/mint" };
    case "exchange":
      return { text: "Set in the exchange settings", href: "/admin?tab=exchange-admin" };
    case "module":
      return { text: "Set by its module", href: `/modules/${encodeURIComponent(source.module)}` };
    case "code":
      return { text: "Fixed in the platform" };
    case "nothing":
      return { text: "No token does this here" };
  }
}

export default function TokenJobsPanel({ password }: { password: string }) {
  const [jobs, setJobs] = useState<TokenJob[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/admin/token-jobs`, { headers: authHeaders(password) })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(refusal(d, "The list could not be read."));
        if (alive) setJobs(Array.isArray(d?.jobs) ? d.jobs : []);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "The list could not be read."));
    return () => {
      alive = false;
    };
  }, [password]);

  return (
    <section aria-labelledby="token-jobs-h" className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
      <h3 id="token-jobs-h" className="font-semibold text-foreground mb-1">Which token does what</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Each job your village's tokens can do, which tokens do it today, and where you change that.
      </p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!jobs && !error && <p className="text-sm text-muted-foreground">Loading...</p>}
      {jobs && (
        <ul className="divide-y divide-gray-100">
          {jobs.map((job) => {
            const door = doorFor(job.setBy);
            const off = job.module ? job.module.lifecycle === "off" : false;
            return (
              <li key={job.id} className={`py-3 flex flex-wrap items-start gap-x-4 gap-y-1 ${off ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm font-medium text-foreground">{job.label}</p>
                  {off && <p className="text-[11px] text-muted-foreground">Its module is off, so this job is not running.</p>}
                </div>
                <div className="min-w-0 flex-1 basis-40 flex flex-wrap gap-1.5">
                  {job.tokens.length ? (
                    job.tokens.map((t) => (
                      <span key={t.slug} className="inline-block px-2 py-0.5 rounded-full text-xs bg-teal-deep/10 text-teal-deep">
                        {t.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">None</span>
                  )}
                </div>
                <div className="shrink-0 basis-44 text-xs">
                  {door.href && job.assignable ? (
                    <a href={door.href} className="text-teal-deep font-medium hover:underline">{door.text}</a>
                  ) : (
                    <span className="text-muted-foreground">{door.text}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
