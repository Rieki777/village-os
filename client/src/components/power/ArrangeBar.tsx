/**
 * THE ARRANGE BAR: what has moved, one button to make it true, and the words
 * for anything the village refused. It sits at the top of the card beside the
 * canvas, so turning Arrange on never pushes the map down the page.
 *
 * THE VILLAGE IS READ AGAIN BEFORE ANYTHING IS WRITTEN. The moves were checked
 * against the map as it stood when they were made, and somebody else may have
 * moved a circle since. So Publish reads the map first and runs every move, in
 * publish order, against that fresh picture. A move that no longer fits is
 * refused in words and taken off the list, the map redraws as the village now
 * stands, and no draft is made, so a refusal never leaves a stray draft under
 * Vision.
 *
 * PUBLISH IS ONE ORG DRAFT. The moves go in as `move_circle` changes (0208), in
 * the order `publishOrder` gives so the server never passes through a loop.
 * The draft's own preview is read, and only then is the draft published. That
 * is the door every reorganisation uses, so the decide gate the governance lane
 * is building covers a drag with no second path to guard, and Undo is that same
 * draft's revert.
 *
 * EVERY STEP READS ITS ANSWER. `send` throws on anything that is not ok,
 * carrying the server's own sentence, and nothing says "Published" until the
 * publish itself has answered AND the map has been read again.
 *
 * THE ROUTES ARE WRITTEN OUT IN FULL at each call, never assembled from a
 * helper, because `check-admin-reach` reads these literals to learn which admin
 * writes a founder can reach, and a path built from parts is invisible to it.
 */
import { useState } from "react";
import { toast } from "sonner";
import { gameFetch } from "@/lib/gameApi";
import { describeMove, dropRefusal, publishOrder, type PendingMove } from "./arrange";

type Circle = { id: string; name: string; parentCircleId?: string | null; isExample?: boolean };

/** One call to the village. Throws with the village's own words unless the answer was ok. */
async function send(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const res = await gameFetch(path, {
    method: init.method ?? "POST",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const said = json && typeof json === "object" ? (json.message ?? json.error) : null;
    throw new Error(
      typeof said === "string" && said ? said : `The village answered ${res.status}, and nothing was changed.`,
    );
  }
  return json;
}

/** The first move that no longer fits the village as it now stands, with the words why, or null. */
function firstStaleMove(fresh: Circle[], batch: PendingMove[]): { move: PendingMove; words: string } | null {
  const applied: PendingMove[] = [];
  for (const m of publishOrder(fresh, batch)) {
    const refused = dropRefusal(fresh, applied, m.circleId, m.parentId);
    if (refused) return { move: m, words: `${describeMove(fresh, m)}: ${refused}` };
    applied.push(m);
  }
  return null;
}

export default function ArrangeBar({
  live,
  moves,
  status,
  reload,
  onSettled,
  onDiscard,
}: {
  /** The circles as published. */
  live: Circle[];
  moves: PendingMove[];
  /** The sentence the gestures last produced. */
  status: string;
  /** Read the map again. Answers the fresh picture, or null when it did not arrive. */
  reload(): Promise<{ circles: Circle[] } | null>;
  /** These moves need publishing no longer: they were published, or the village no longer allows them. */
  onSettled(moves: PendingMove[]): void;
  onDiscard(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  const refuse = (why: string) => {
    setSaid(why);
    toast.error(why);
    setBusy(false);
  };

  const undo = async (draftId: string) => {
    try {
      await send(`/api/admin/org/drafts/${encodeURIComponent(draftId)}/revert`);
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
      return;
    }
    const redrawn = !!(await reload());
    toast.success(
      redrawn ? "Undone. The circles are back where they were." : "Undone. Reload the page to see the circles back where they were.",
    );
  };

  const publish = async () => {
    if (!moves.length || busy) return;
    const batch = moves;
    setBusy(true);
    setSaid("");

    const fresh = await reload();
    if (!fresh) return refuse("The map could not be read just now, so nothing was published.");
    const stale = firstStaleMove(fresh.circles, batch);
    if (stale) {
      onSettled([stale.move]);
      return refuse(`${stale.words} That move is off the list, the map shows the village as it stands, and nothing was published.`);
    }
    const needed = batch.filter(
      (m) => (fresh.circles.find((c) => c.id === m.circleId)?.parentCircleId ?? null) !== m.parentId,
    );
    if (!needed.length) {
      onSettled(batch);
      setBusy(false);
      toast.success("The village already sits this way, so there was nothing to publish.");
      return;
    }

    let draftId = "";
    try {
      const title = needed.length === 1 ? describeMove(fresh.circles, needed[0]) : `Arranging ${needed.length} circles`;
      const made = await send("/api/admin/org/drafts", { body: { title } });
      draftId = String(made?.id ?? "");
      if (!draftId) throw new Error("The village did not say which draft it made, so nothing was published.");
      const id = encodeURIComponent(draftId);
      for (const m of publishOrder(fresh.circles, needed)) {
        await send(`/api/admin/org/drafts/${id}/changes`, {
          body: { op: "move_circle", orgRoleId: `circle:${m.circleId}`, payload: { parentCircleId: m.parentId } },
        });
      }
      const preview = await send(`/api/admin/org/drafts/${id}/preview`, { method: "GET" });
      const stuck = (preview?.lines ?? []).find((l: any) => l?.blocked);
      if (stuck) throw new Error(`${stuck.reads}: ${stuck.blocked}`);
      await send(`/api/admin/org/drafts/${id}/publish`);
    } catch (e: any) {
      const why = String(e?.message ?? e);
      return refuse(draftId ? `${why} Nothing was published, and the unpublished draft shows under Vision.` : why);
    }
    const published = draftId;
    // Read the map BEFORE forgetting the moves, so the picture never flashes back to the old shape.
    const redrawn = !!(await reload());
    onSettled(batch);
    setBusy(false);
    toast.success(
      redrawn
        ? needed.length === 1
          ? "Published. The map shows the move."
          : `Published. The map shows all ${needed.length} moves.`
        : "Published. Reload the page to see the new shape.",
      { duration: 12000, action: { label: "Undo", onClick: () => void undo(published) } },
    );
  };

  const count = moves.length;
  return (
    <section aria-labelledby="arrange-bar-title" className="mb-4 pb-4 border-b border-border text-sm" data-arrange-bar>
      <h3 id="arrange-bar-title" className="font-semibold text-sm text-foreground">
        Arranging circles
      </h3>
      <p className="mt-1 text-muted-foreground">
        Drag a circle onto the circle it belongs inside. Ground outside every circle is the top of the village. With a
        keyboard, press M on a circle to pick it up, then M on the circle it belongs inside.
      </p>
      {count > 0 ? (
        <ul className="mt-2 space-y-0.5 text-foreground" data-arrange-moves>
          {moves.map((m) => (
            <li key={m.circleId}>{describeMove(live, m)}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-foreground">Nothing has moved yet.</p>
      )}
      <p className="mt-2 min-h-[1.25rem] text-foreground" aria-live="polite" data-arrange-status>
        {said || status}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void publish()}
          disabled={!count || busy}
          className="text-xs px-3 py-1.5 rounded-full bg-teal-deep text-white disabled:opacity-40"
        >
          {busy ? "Publishing" : count === 1 ? "Publish 1 move" : `Publish ${count} moves`}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={!count || busy}
          className="text-xs px-3 py-1.5 rounded-full border border-border bg-card text-muted-foreground disabled:opacity-40"
        >
          Discard
        </button>
      </div>
    </section>
  );
}
