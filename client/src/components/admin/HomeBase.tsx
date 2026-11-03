/**
 * Home: six areas and the one thing that needs you now.
 *
 * It reads lists the admin already loads. It does not change them. The time
 * is when this page finished reading. A switch on this device can make the
 * next visit open the form list instead.
 */
import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/components/admin/adminApi";
import type { NavGroup } from "@/components/admin/adminNavGroups";
import { ADMIN_AREAS, setHomeBaseOn, tabsInArea, type AreaId } from "./adminAreas";
import { connectionRows, glanceSentence, readLastGlance, rememberGlance, sinceLastVisit } from "./todayGlance";

interface Needs {
  sentence: string;
  shape: "tick" | "dot" | "cross";
  word: string;
}

function needsFrom(submissions: number, blocking: number): Needs {
  if (submissions > 0) {
    const noun = submissions === 1 ? "request is" : "requests are";
    return { sentence: `${submissions} ${noun} waiting.`, shape: "dot", word: "Waiting" };
  }
  if (blocking > 0) {
    const noun = blocking === 1 ? "thing needs" : "things need";
    return { sentence: `${blocking} ${noun} you before the village can open.`, shape: "cross", word: "Needs you" };
  }
  return { sentence: "Nothing is waiting on you.", shape: "tick", word: "All clear" };
}

const MARK = "inline-block h-3 w-3 border-2 border-gray-900";

function Mark({ shape }: { shape: Needs["shape"] }) {
  const form = shape === "tick" ? "rounded-sm" : shape === "dot" ? "rounded-full" : "rounded-sm rotate-45";
  return <span aria-hidden="true" className={`${MARK} ${form}`} />;
}

export default function HomeBase({
  password, onOpenTab, groups,
}: {
  password: string;
  onOpenTab: (tab: string) => void;
  groups: NavGroup[];
}) {
  const [needs, setNeeds] = useState<Needs | null>(null);
  const [glance, setGlance] = useState<string | null>(null);
  const [since, setSince] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const [area, setArea] = useState<AreaId>("today");
  const allowed = new Set(groups.flatMap((group) => group.items.map((item) => item.key)));

  const load = () => {
    setProblem(null);
    Promise.all([
      fetch(`${API_BASE}/admin/submissions`, { headers: authHeaders(password) }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_BASE}/admin/launch`, { headers: authHeaders(password) }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}/admin/integrations`, { headers: authHeaders(password) }).then((r) => (r.ok ? r.json() : {})),
    ]).then(([subs, launch, integrations]) => {
      const count = Array.isArray(subs) ? subs.length : 0;
      const blocking = Number(launch?.blockingOpen ?? 0);
      const rows = connectionRows(integrations ?? {});
      const prev = readLastGlance();
      setNeeds(needsFrom(count, Number.isFinite(blocking) ? blocking : 0));
      setGlance(glanceSentence(count, rows));
      setSince(sinceLastVisit(prev, count));
      rememberGlance(count, rows.filter((row) => row.state !== "working").length);
      setUpdated(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    }).catch(() => setProblem("This did not load. Try again in a moment."));
  };

  useEffect(() => { load(); }, [password]);

  const tabs = tabsInArea(area).filter((tab) => tab.key === "home" || tab.key === "email-settings" || allowed.has(tab.key));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-gray-900">Today</h2>
        {glance && <p className="w-full text-base text-gray-900">{glance}</p>}
        {since && <p className="w-full text-sm text-gray-700">{since}</p>}
        {updated && <p className="text-sm text-gray-600">Updated {updated}</p>}
      </div>
      {problem ? (
        <div role="alert" className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-base text-gray-900">{problem}</p>
          <button type="button" onClick={load} className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-teal-deep px-4 text-white">Try again</button>
        </div>
      ) : needs ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4" aria-label="What needs you now">
          <p className="flex items-center gap-2 text-sm font-medium text-gray-900"><Mark shape={needs.shape} />{needs.word}</p>
          <p className="mt-1 text-lg text-gray-900">{needs.sentence}</p>
        </section>
      ) : (
        <p className="text-base text-gray-600">Reading what is waiting...</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {ADMIN_AREAS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={area === item.id}
            onClick={() => setArea(item.id)}
            className={`min-h-[44px] rounded-xl border px-3 py-3 text-left ${area === item.id ? "border-gray-900 bg-white" : "border-gray-200 bg-white"}`}
          >
            <span className="block text-base font-semibold text-gray-900">{item.name}</span>
            <span className="block text-sm text-gray-700">{item.plain}</span>
          </button>
        ))}
      </div>
      <div>
        <p className="text-sm text-gray-700">{ADMIN_AREAS.find((item) => item.id === area)?.help}</p>
        <ul className="mt-2 space-y-1">
          {tabs.filter((tab) => tab.key !== "home").map((tab) => (
            <li key={tab.key}>
              <button type="button" onClick={() => onOpenTab(tab.key)} className="flex min-h-[44px] w-full items-center rounded-lg px-2 text-left text-base text-gray-900 hover:bg-gray-50">
                <span className="font-medium">{tab.name}</span>
                <span className="sr-only">. {tab.help}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-900">
        <input
          type="checkbox"
          onChange={(e) => {
            setHomeBaseOn(!e.target.checked);
            if (e.target.checked) onOpenTab("submissions");
          }}
        />
        Start on the form list instead
      </label>
    </div>
  );
}
