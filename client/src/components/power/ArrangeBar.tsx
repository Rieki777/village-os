/**
 * THE ARRANGE BAR: what has moved, one button to make it true, the words for
 * anything the village refused, and a way to move a circle without dragging.
 * It sits at the top of the card beside the canvas, so turning Arrange on never
 * pushes the map down the page.
 *
 * THE VILLAGE IS READ AGAIN BEFORE ANYTHING IS WRITTEN. The moves were checked
 * against the map as it stood when they were made, and somebody else may have
 * moved a circle since. So Publish reads the map first and settles the whole
 * list against that fresh picture (`settleAgainst`). Every move that no longer
 * fits is refused in words at once and taken off the list, the map redraws as
 * the village stands, and no draft is made, so a refusal never leaves a stray
 * draft under Vision.
 *
 * PUBLISH IS ONE ORG DRAFT. The moves go in as `move_circle` changes (0208), in
 * the order `publishOrder` gives so the server never passes through a loop.
 * The draft's own preview is read, and only then is the draft published. That
 * is the door every reorganisation uses, so the decide gate the governance lane
 * is building covers a drag with no second path to guard, and Undo is that same
 * draft's revert.
 *
 * NOTHING MOVES WHILE A PUBLISH IS IN FLIGHT. `busy` belongs to the page, which
 * turns the gestures and the Arrange toggle off for the length of the round
 * trips. A drop made mid-publish can then never be silently overridden by the
 * publish landing after it, and toggling Arrange cannot remount this bar ready
 * to publish the same moves twice.
 *
 * EVERY STEP READS ITS ANSWER. `send` throws on anything that is not ok,
 * carrying the server's own sentence, and nothing says "Published" until the
 * publish itself has answered AND the map has been read again. A publish the
 * server applied but could not redraw says so, and still offers Undo.
 *
 * AN ERROR HAS ITS OWN LINE. The live status line keeps saying what a carried
 * circle would do; a refusal from Publish sits beside it as an alert until the
 * next Publish or Discard.
 *
 * THE ROUTES ARE WRITTEN OUT IN FULL at each call, never assembled from a
 * helper, because `check-admin-reach` reads these literals to learn which admin
 * writes a founder can reach, and a path built from parts is invisible to it.
 */
import { useState } from "react";
import { toast } from "sonner";
import { gameFetch } from "@/lib/gameApi";
import { parentChoicesFor } from "@shared/circleView";
import { describeMove, publishOrder, settleAgainst, withMoves, type PendingMove } from "./arrange";

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

const selectCls =
  "mt-1 w-full rounded-md border border-border bg-card text-foreground text-sm px-2 py-1.5 disabled:opacity-40";

export default function ArrangeBar({
  live,
  moves,
  status,
  busy,
  onBusy,
  reload,
  onPropose,
  onSettled,
  onDiscard,
}: {
  /** The circles as published. */
  live: Circle[];
  moves: PendingMove[];
  /** The sentence the gestures last produced. */
  status: string;
  /** A publish is in flight, and nothing may be arranged until it answers. */
  busy: boolean;
  onBusy(busy: boolean): void;
  /** Read the map again. Answers the fresh picture, or null when it did not arrive. */
  reload(): Promise<{ circles: Circle[] } | null>;
  /** Record a move chosen in the picker. */
  onPropose(circleId: string, parentId: string | null): void;
  /** These moves need publishing no longer: they were published, or the village no longer allows them. */
  onSettled(moves: PendingMove[]): void;
  onDiscard(): void;
}) {
  const [said, setSaid] = useState("");
  const [pickId, setPickId] = useState("");
  const [toId, setToId] = useState("");

  const refuse = (why: string) => {
    setSaid(why);
    toast.error(why);
    onBusy(false);
  };

  const undo = async (draftId: string) => {
    let answer: any = null;
    try {
      answer = await send(`/api/admin/org/drafts/${encodeURIComponent(draftId)}/revert`);
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
      return;
    }
    const redrawn = !!(await reload());
    toast.success(
      redrawn && answer?.reloaded !== false
        ? "Undone. The circles are back where they were."
        : "Undone. The map is still catching up, so reload the page in a moment to see the circles back where they were.",
    );
  };

  const publish = async () => {
    if (!moves.length || busy) return;
    const batch = moves;
    onBusy(true);
    setSaid("");

    const fresh = await reload();
    if (!fresh) return refuse("The map could not be read just now, so nothing was published.");
    const { kept, dropped } = settleAgainst(fresh.circles, batch);
    const refusals = dropped.map((d) => d.words).filter((w): w is string => !!w);
    if (refusals.length) {
      onSettled(dropped.map((d) => d.move));
      return refuse(
        `${refusals.join(" ")} ${refusals.length === 1 ? "That move is" : "Those moves are"} off the list, the map shows the village as it stands, and nothing was published.`,
      );
    }
    if (!kept.length) {
      onSettled(batch);
      onBusy(false);
      toast.success("The village already sits this way, so there was nothing to publish.");
      return;
    }

    let draftId = "";
    let answer: any = null;
    try {
      const title = kept.length === 1 ? describeMove(fresh.circles, kept[0]) : `Arranging ${kept.length} circles`;
      const made = await send("/api/admin/org/drafts", { body: { title } });
      draftId = String(made?.id ?? "");
      if (!draftId) throw new Error("The village did not say which draft it made, so nothing was published.");
      const id = encodeURIComponent(draftId);
      for (const m of publishOrder(fresh.circles, kept)) {
        await send(`/api/admin/org/drafts/${id}/changes`, {
          body: { op: "move_circle", orgRoleId: `circle:${m.circleId}`, payload: { parentCircleId: m.parentId } },
        });
      }
      const preview = await send(`/api/admin/org/drafts/${id}/preview`, { method: "GET" });
      const stuck = (preview?.lines ?? []).find((l: any) => l?.blocked);
      if (stuck) throw new Error(`${stuck.reads}: ${stuck.blocked}`);
      answer = await send(`/api/admin/org/drafts/${id}/publish`);
    } catch (e: any) {
      const why = String(e?.message ?? e);
      return refuse(draftId ? `${why} Nothing was published, and the unpublished draft shows under Vision.` : why);
    }
    const published = draftId;
    // Read the map BEFORE forgetting the moves, so the picture never flashes back to the old shape.
    const redrawn = !!(await reload());
    onSettled(batch);
    onBusy(false);
    toast.success(
      redrawn && answer?.reloaded !== false
        ? kept.length === 1
          ? "Published. The map shows the move."
          : `Published. The map shows all ${kept.length} moves.`
        : "Published. The map is still catching up, so reload the page in a moment to see the new shape.",
      { duration: 12000, action: { label: "Undo", onClick: () => void undo(published) } },
    );
  };

  const picture = withMoves(live, moves);
  const movable = picture.filter((c) => !c.isExample).sort((a, b) => a.name.localeCompare(b.name));
  const choices = pickId ? parentChoicesFor(picture, pickId) : [];
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
        {status}
      </p>
      {said && (
        <p role="alert" className="mt-2 text-foreground" data-arrange-error>
          {said}
        </p>
      )}
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
          onClick={() => {
            setSaid("");
            onDiscard();
          }}
          disabled={!count || busy}
          className="text-xs px-3 py-1.5 rounded-full border border-border bg-card text-muted-foreground disabled:opacity-40"
        >
          Discard
        </button>
      </div>

      <div className="mt-4" role="group" aria-labelledby="arrange-picker-title" data-arrange-picker>
        <p id="arrange-picker-title" className="text-xs font-semibold text-foreground">
          Move a circle without dragging
        </p>
        <label className="mt-2 block text-xs text-muted-foreground">
          Circle
          <select
            value={pickId}
            disabled={busy}
            onChange={(e) => {
              const id = e.target.value;
              setPickId(id);
              setToId(picture.find((c) => c.id === id)?.parentCircleId ?? "");
            }}
            className={selectCls}
          >
            <option value="">Choose a circle</option>
            {movable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-2 block text-xs text-muted-foreground">
          Sits inside
          <select value={toId} disabled={busy || !pickId} onChange={(e) => setToId(e.target.value)} className={selectCls}>
            <option value="">The village, at the top</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !pickId}
          onClick={() => {
            onPropose(pickId, toId || null);
            setPickId("");
            setToId("");
          }}
          className="mt-2 text-xs px-3 py-1.5 rounded-full border border-border bg-card text-foreground disabled:opacity-40"
        >
          Add move
        </button>
      </div>
    </section>
  );
}
