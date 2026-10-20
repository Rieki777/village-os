/**
 * WHO DOES WHAT. Every action from every item, in agenda order, each with the
 * person or seat holding it. The count of actions nobody holds yet sits on top
 * until it reaches none, because the session cannot close before it does.
 * After a refused close the room lands here, with the refusal said once more
 * and the actions it named marked, until each has someone holding it.
 *
 * SEEDS ON THE WIND, ONCE. When an action that nobody held is taken up while
 * the room watches, a small drift of seeds marks it beside the count, once per
 * action. What was already held when the page opened is history and is not
 * celebrated, and an action let go and taken again does not throw seeds a
 * second time. The count line says the news in words either way.
 */
import { useEffect, useRef, useState } from "react";
import { ROOM_COPY, SESSION_COPY, unownedActions } from "@shared/sessions";
import Celebration from "@/components/natural/Celebration";
import { useMomentWindow } from "@/components/natural/moments";
import { ActionRow, AddAction } from "./ActionRow";
import { CARD, H3, HINT, agendaOrder, isHeld, type StageProps } from "./roomUi";

/**
 * The id of the action just taken up while this screen watched, as a key that
 * changes for each new one, or null. The first reading of the room seeds what
 * is held in silence; after that, an action that turns from unheld to held
 * fires, and each action fires at most once.
 */
function useTakenUp(entries: StageProps["view"]["entries"]): string | null {
  const seen = useRef<Map<number, boolean> | null>(null);
  const fired = useRef(new Set<number>());
  const [taken, setTaken] = useState<string | null>(null);
  const reading = entries
    .filter((e) => e.kind === "action")
    .map((e) => `${e.id}:${isHeld(e) ? 1 : 0}`)
    .join(",");

  useEffect(() => {
    const now = new Map<number, boolean>();
    for (const pair of reading ? reading.split(",") : []) {
      const [id, held] = pair.split(":");
      now.set(Number(id), held === "1");
    }
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    now.forEach((held, id) => {
      if (held && before.get(id) === false && !fired.current.has(id)) {
        fired.current.add(id);
        setTaken(`${id}:${fired.current.size}`);
      }
    });
  }, [reading]);

  return taken;
}

export default function StageActions({
  view,
  actions,
  highlight = [],
  refusal = null,
}: StageProps & {
  /** Actions a refused close named, marked until someone holds them. */
  highlight?: number[];
  /** The refused close's own sentence, said here while those actions still wait. */
  refusal?: string | null;
}) {
  const taken = useTakenUp(view.entries);
  const seeds = useMomentWindow(taken);
  const all = view.entries.filter((e) => e.kind === "action");
  const unowned = unownedActions(view.entries);
  const stillRefused = refusal && unowned.some((id) => highlight.includes(id));
  const groups = [
    ...agendaOrder(view.items).map((item) => ({ key: `i${item.id}`, title: item.title, list: all.filter((e) => e.itemId === item.id) })),
    { key: "loose", title: ROOM_COPY.outsideAgenda, list: all.filter((e) => e.itemId == null || !view.items.some((i) => i.id === e.itemId)) },
  ].filter((g) => g.list.length > 0);

  return (
    <div className="space-y-5">
      {stillRefused && (
        <p role="alert" className="rounded-xl border border-notice/40 bg-card px-4 py-3 text-sm font-medium text-foreground">
          {refusal}
        </p>
      )}
      <div className="flex items-center gap-3">
        <p
          role="status"
          className={`min-w-0 flex-1 rounded-xl border bg-muted px-4 py-3 text-sm font-semibold ${
            unowned.length ? "border-notice/50 text-foreground" : "border-open/40 text-open"
          }`}
        >
          {unowned.length === 1
            ? ROOM_COPY.unownedOne
            : unowned.length
              ? `${unowned.length} ${SESSION_COPY.unownedLeft}`
              : SESSION_COPY.everyoneHolds}
        </p>
        {seeds && taken && <Celebration kind="seeds" intensity="whisper" size={56} seed={Number(taken.split(":")[0])} />}
      </div>

      {groups.length === 0 && <p className={HINT}>{ROOM_COPY.nothingYet}</p>}

      {groups.map((g) => (
        <section key={g.key} className={CARD} aria-labelledby={`actions-${g.key}`}>
          <h3 id={`actions-${g.key}`} className={`${H3} mb-3`}>
            {g.title}
          </h3>
          <ul className="space-y-2">
            {g.list.map((e) => (
              <ActionRow key={e.id} view={view} actions={actions} entry={e} highlight={highlight.includes(e.id)} />
            ))}
          </ul>
        </section>
      ))}

      {view.status === "open" && view.me.joined && (
        <section className={CARD}>
          <AddAction view={view} actions={actions} itemId={null} />
        </section>
      )}
    </div>
  );
}
