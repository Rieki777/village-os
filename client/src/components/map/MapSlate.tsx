/**
 * THE BLANK SLATE: a village that has published no map is not shown somebody
 * else's land.
 *
 * The artifact ships one village's land baked in, and until this a village
 * with nothing published was handed `scene: null`, which the map reads as
 * "keep your own". So every fresh village opened onto the seed village's
 * buildings, roads, water and satellite ground as if they were its own. The
 * map may never invent geography (Rye's standing ruling), and another place's
 * land drawn at the fidelity of the real thing is the plainest case of it.
 *
 * WHAT DECIDES IT is `liveVersion` from `GET /api/map/draft`, the read the
 * shell already makes on every boot to learn what this viewer may do: 0 means
 * nothing has ever been published (`publishedVersion` in server/lib/mapScene.ts).
 * It answers a signed-out visitor too, with every permission false.
 *
 *   - A VISITOR on a blank village gets an honest empty state and the org view,
 *     and the four-megabyte map is never fetched for them.
 *   - SOMEONE WHO MAY DRAFT THE LAND (`canEdit`) gets the way to make it: the
 *     masterplan, their own agent, and the draft waiting for review. Opening
 *     the map from here hands it `blankScene()` (LivingMap's config push), so
 *     what they draw on and review against carries nothing that is not theirs.
 *
 * A READ THAT FAILS DECIDES NOTHING. `unknown` keeps the shell exactly as it
 * was, because hiding a village's real map on a dropped request would be a
 * worse failure than the one this closes, and the config push still hands a
 * blank village the blank scene once the map is open.
 *
 * Out of LivingMap.tsx, which is a shell held under the client line ceiling.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { DoorOpen, FileUp, Map as MapIcon, Bot, Trash2 } from "lucide-react";
import { authToken, gameFetch } from "@/lib/gameApi";
import { useVillageName } from "@/hooks/useVillageName";
import { sceneSummary } from "@shared/mapScene";
import { MASTERPLAN_ACCEPT, MASTERPLAN_TYPES, type MasterplanRecord } from "@shared/mapFromMasterplan";

/** What is waiting for review, counted the way the map's own offer counts it. */
export interface WaitingDraft {
  buildings: number;
  features: number;
  flows: number;
  changes: number;
}

export type Slate =
  | { state: "checking" }
  | { state: "published" }
  | { state: "unknown" }
  | { state: "blank"; canEdit: boolean; canPublish: boolean; draft: WaitingDraft | null };

/**
 * The answer `GET /api/map/draft` gave, read into a slate. Pure, so the rule
 * is tested without a network: ONLY a number that is exactly 0 is blank. A
 * missing field, a string or a failed request is `unknown`, never blank.
 */
export function slateFrom(ok: boolean, body: any): Slate {
  if (!ok || !body || typeof body !== "object" || typeof body.liveVersion !== "number") return { state: "unknown" };
  if (body.liveVersion > 0) return { state: "published" };
  if (body.liveVersion !== 0) return { state: "unknown" };
  let draft: WaitingDraft | null = null;
  if (body.draft && typeof body.draft.scene === "string") {
    try {
      const scene = JSON.parse(body.draft.scene);
      const s = sceneSummary(scene);
      draft = { buildings: s.buildings, features: s.features, flows: s.flows, changes: s.edits };
    } catch {
      /* A draft that will not parse is no draft to offer. The map says the same. */
    }
  }
  return { state: "blank", canEdit: body.canEdit === true, canPublish: body.canPublish === true, draft };
}

/** Whether this village has a map of its own, asked once per visit. */
export function useMapSlate(): Slate {
  const [slate, setSlate] = useState<Slate>({ state: "checking" });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await gameFetch("/api/map/draft");
        const body = await res.json().catch(() => null);
        if (live) setSlate(slateFrom(res.ok, body));
      } catch {
        if (live) setSlate({ state: "unknown" });
      }
    })();
    return () => { live = false; };
  }, []);
  return slate;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sizeOf = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const BUTTON =
  "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-sm rounded-lg border border-border bg-background text-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const PRIMARY =
  "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-sm font-semibold rounded-lg bg-teal-deep text-white shadow-sm hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-60";

/**
 * The village's masterplan: what is kept, and the way to keep one.
 *
 * Posted as the file it is. A plan is never shrunk in the browser the way a
 * photograph is (`imagePrep.ts`): an agent reading it measures the world off
 * its pixels, and a smaller picture is a smaller village.
 */
export function MasterplanCard() {
  const [plan, setPlan] = useState<MasterplanRecord | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let live = true;
    gameFetch("/api/map/masterplan")
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (live) setPlan(res.ok ? (body?.masterplan ?? null) : null);
      })
      .catch(() => { if (live) setPlan(null); });
    return () => { live = false; };
  }, []);

  const send = useCallback(async (file: File) => {
    setBusy(true);
    setNote("");
    try {
      const form = new FormData();
      form.append("file", file);
      const token = authToken();
      const res = await fetch("/api/map/masterplan", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setNote(body?.error || "The plan was not kept. Try the file again.");
      } else {
        setPlan(body?.masterplan ?? null);
        setNote("Kept. Your agent reads this one from now on.");
      }
    } catch {
      setNote("The village could not be reached. The plan was not kept.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }, []);

  const removePlan = useCallback(async () => {
    setBusy(true);
    setNote("");
    try {
      const res = await gameFetch("/api/map/masterplan", { method: "DELETE" });
      if (res.ok) setPlan(null);
      else setNote("The plan could not be removed. Try again.");
    } catch {
      setNote("The village could not be reached.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-3">
      {plan === undefined && <p className="text-sm text-muted-foreground">Looking for your masterplan...</p>}
      {plan && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <a href={plan.url} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-2 break-all">
            {plan.originalName || plan.filename}
          </a>
          <span className="text-muted-foreground">
            {plan.kind === "pdf" ? "PDF" : plan.width && plan.height ? `picture, ${plan.width} by ${plan.height}` : "picture"}, {sizeOf(plan.bytes)}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label className={`${BUTTON} cursor-pointer`}>
          <FileUp className="w-4 h-4 shrink-0" aria-hidden="true" />
          {busy ? "Working..." : plan ? "Replace the masterplan" : "Upload your masterplan"}
          <input
            ref={input}
            type="file"
            accept={MASTERPLAN_ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void send(f);
            }}
          />
        </label>
        {plan && (
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void removePlan()}>
            <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            Remove it
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{MASTERPLAN_TYPES}, up to 25 MB. Kept for the people who draw the map.</p>
      {note && <p role="status" className="text-sm text-foreground">{note}</p>}
    </div>
  );
}

function Step({ n, title, icon, children }: { n: number; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-border bg-background p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-foreground mb-2">
        {icon}
        <span>{n}. {title}</span>
      </h2>
      {children}
    </li>
  );
}

/**
 * What a blank village shows in place of the land.
 *
 * `onOpenBoard` opens the map itself, for someone who may draft it: to review
 * a draft that is waiting, or to draw the land by hand in build mode.
 */
export default function BlankSlate({ slate, onOpenBoard, onLeave }: {
  slate: Extract<Slate, { state: "blank" }>;
  onOpenBoard: () => void;
  onLeave: () => void;
}) {
  const villageName = useVillageName();
  const leave = (
    <button type="button" onClick={onLeave} className={BUTTON}>
      <DoorOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
      Leave the map
    </button>
  );

  if (!slate.canEdit) {
    return (
      <div className="h-full overflow-y-auto">
        <main className="mx-auto max-w-xl px-4 py-20 text-center">
          <h1 className="font-display text-2xl font-bold text-foreground mb-3">{villageName} has not drawn its map yet</h1>
          <p className="text-muted-foreground mb-6">
            The map shows the village's real land once the people who look after it publish the first version.
            Until then, the circles and roles are on the org view.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/map/circles" className={BUTTON}>See the circles and roles</Link>
            {leave}
          </div>
        </main>
      </div>
    );
  }

  const d = slate.draft;
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
        <h1 className="font-display text-3xl font-bold text-foreground mb-2">Make your map</h1>
        <p className="text-muted-foreground mb-6">
          Nothing is published yet, so visitors see a page saying the map is coming. The first version is drawn
          from your masterplan, by your own agent or by hand, and goes live only when you publish it.
        </p>
        <ol className="space-y-4 mb-6">
          <Step n={1} title="Upload your masterplan" icon={<FileUp className="w-5 h-5 shrink-0" aria-hidden="true" />}>
            <MasterplanCard />
          </Step>
          <Step n={2} title="Ask your agent to draw version 1.0" icon={<Bot className="w-5 h-5 shrink-0" aria-hidden="true" />}>
            <p className="text-sm text-muted-foreground mb-3">
              In your profile, under Your agent, make a token with the scope to draft the village map, and give it
              to your agent with the village map skill. It reads your masterplan and the method this map was first
              made by, and sends a draft. It cannot publish anything.
            </p>
            <Link href="/profile#your-agent" className={BUTTON}>Set up your agent</Link>
          </Step>
          <Step n={3} title="Review it on the map, then publish" icon={<MapIcon className="w-5 h-5 shrink-0" aria-hidden="true" />}>
            {d ? (
              <p className="text-sm text-foreground mb-3">
                A draft is waiting for you: {plural(d.buildings, "building")}, {plural(d.features, "feature")} and{" "}
                {plural(d.flows, "flow")}, in {plural(d.changes, "change")}.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mb-3">
                A draft from your agent waits here for you. You can also draw the land yourself in build mode.
              </p>
            )}
            {!slate.canPublish && (
              <p className="text-sm text-muted-foreground mb-3">
                Publishing it takes someone who may publish the map. Your draft is kept for them to see.
              </p>
            )}
            <button type="button" onClick={onOpenBoard} className={PRIMARY}>
              <MapIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
              {d ? "Review the draft on the map" : "Open the map to draw it"}
            </button>
          </Step>
        </ol>
        {leave}
      </main>
    </div>
  );
}
