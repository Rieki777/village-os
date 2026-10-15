/**
 * WHO DOES WHAT. Every action from every item, in agenda order, each with the
 * person or seat holding it. The count of actions nobody holds yet sits on top
 * until it reaches none, because the session cannot close before it does.
 * After a refused close the room lands here, with the refusal said once more
 * and the actions it named marked, until each has someone holding it.
 */
import { ROOM_COPY, SESSION_COPY, unownedActions } from "@shared/sessions";
import { ActionRow, AddAction } from "./ActionRow";
import { CARD, H3, HINT, agendaOrder, type StageProps } from "./roomUi";

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
      <p
        role="status"
        className={`rounded-xl px-4 py-3 text-sm font-semibold ${
          unowned.length ? "border border-notice/40 bg-amber-light text-foreground" : "bg-sage-light text-open"
        }`}
      >
        {unowned.length === 1
          ? ROOM_COPY.unownedOne
          : unowned.length
            ? `${unowned.length} ${SESSION_COPY.unownedLeft}`
            : SESSION_COPY.everyoneHolds}
      </p>

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
