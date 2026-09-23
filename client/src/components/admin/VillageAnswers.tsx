/**
 * WHAT THIS VILLAGE HAS NOT SAID ABOUT ITSELF, on every admin screen, for as
 * long as it stays unsaid.
 *
 * The launch checklist carries the same two questions, and it stops speaking
 * the moment a village launches: the admin banner returns null once
 * `launchedAt` is set, and the Journey page keeps its list only "as the record
 * of what that took". A launched village is exactly the one that has been
 * running on somebody else's clock the longest, so the checklist alone would
 * have asked every village except the ones that most need asking.
 *
 * TWO FACTS, both inherited in silence. The season timezone ships as Costa
 * Rica's and the currency ships as whatever the platform carries; a fork
 * derives dated seasons whatever the zone, and an empty currency box reads
 * like an answered one behind its placeholder. Neither renders as broken
 * anywhere, which is why a prompt is the only thing that can surface them.
 *
 * IT ASKS AND NEVER BLOCKS, and it disappears for good once both are
 * answered. Light-only, like the rest of `client/src/components/admin`.
 */
import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/components/admin/adminApi";

/**
 * The two launch items this banner speaks for, by id.
 *
 * The SENTENCES are not repeated here: the title, the reason, the address and
 * the state all come from `shared/launchRequirements.ts` through
 * `/api/admin/launch`, so this surface and the checklist can never drift into
 * saying different things about the same question.
 */
const ASKS = ["village-timezone", "village-currency"];

interface LaunchItem {
  id: string;
  title: string;
  detail: string;
  state: string;
  fixAt: string;
}

export default function VillageAnswers({ password }: { password: string }) {
  const [missing, setMissing] = useState<LaunchItem[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/launch`, { headers: authHeaders(password) });
        if (!res.ok) return;
        const data = await res.json();
        const items: LaunchItem[] = Array.isArray(data?.items) ? data.items : [];
        const asks = items.filter((i) => ASKS.includes(i.id) && i.state === "missing");
        if (alive) setMissing(asks);
      } catch {
        /* a reading we could not take is not something to announce */
      }
    })();
    return () => { alive = false; };
  }, [password]);

  if (!missing.length) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3" role="status">
      <p className="text-sm font-semibold text-amber-900">Only this village can answer this</p>
      <ul className="mt-1.5 space-y-1.5">
        {missing.map((m) => (
          <li key={m.id} className="text-xs text-amber-800">
            {m.detail}.{" "}
            <a href={m.fixAt} className="underline font-medium">{m.title}</a>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-amber-700 mt-1.5">
        Nothing is blocked. Answering takes one click each, and this goes for good once it is said.
      </p>
    </div>
  );
}
