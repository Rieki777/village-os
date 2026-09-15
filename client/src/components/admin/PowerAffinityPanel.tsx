/**
 * Which character suits which power: the village's own map.
 *
 * ── WHAT THIS EDITS ───────────────────────────────────────────────────────
 *
 * Every power the village hands out by appointment down the side, and every
 * class it has across the top. A tick says the power suits that class. A member
 * who reaches Contributor and plays a ticked class sees the power marked as
 * suiting them on their profile, and each class card on the character select
 * lists the powers ticked for it. It recommends and permits nothing: the
 * capability gate never reads this map, so a tick hands nobody a power.
 *
 * The platform ships a suggestion (shared/powerAffinity.ts, Rye's ruling of
 * 2026-09-09). A power this village never touched follows it, so a better
 * suggestion later still reaches the village. A power changed here is the
 * village's own from then on, and its row says so, with the one control that
 * hands it back to the platform.
 *
 * ── A TICK SAVES AT ONCE, AND PUTS ITSELF BACK WHEN THE SERVER SAYS NO ────
 *
 * The contract `ArchetypesPanel`'s reorder keeps: the box moves when it is
 * pressed, one power goes to the server, and a refusal puts that row back and
 * says why. The revert touches only the row that failed, so a save on another
 * row that landed in between is never undone by it. One request per power at a
 * time, held by a ref, so a second press cannot race the first and leave the
 * server holding the older list.
 *
 * ── THE ROWS HOLD STILL ────────────────────────────────────────────────────
 *
 * The powers that carry a class, a suggestion or a decision lead the table, and
 * that order is taken when the table LOADS. It used to be re-sorted on every
 * render, so a power's first tick made it "decided" and lifted its row into the
 * top group, and the founder's second click landed on whichever neighbour slid
 * into its place and saved the wrong power. A save never moves a row now.
 *
 * ── THE COLUMNS FOLLOW THE CLASSES PANEL ───────────────────────────────────
 *
 * `castOrder` is the order the classes panel above is showing. Its reorder is
 * optimistic, so the reload it triggers can read the old order back from the
 * server. The columns sort by `castOrder` whatever the server sent, and a tick
 * saves its list in that same order, which is the order "Suits A and B" prints
 * in on a member's profile.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "./adminApi";

/** One class as the server names it today. */
interface ClassName {
  key: string;
  name: string;
}

/** One power as `GET /api/admin/power-affinity` sends it. */
interface PowerRow {
  key: string;
  label: string;
  /** The classes it suits in this village now. */
  classes: string[];
  /** What the platform suggests. */
  suggested: string[];
  /** True when this village changed it. */
  decided: boolean;
  /** False when its module is off here. */
  live: boolean;
  /** False when this village's own ladder opens it, so no member is recommended it. Absent from an older server. */
  entrusted?: boolean;
}

interface Affinity {
  classes: ClassName[];
  powers: PowerRow[];
}

const quietBtnCls =
  "mt-1 min-h-[44px] px-2.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-deep";

/** The server's sentence, or an honest line naming the status. Same reasoning as ArchetypesPanel. */
async function sentenceFor(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  if (body && typeof body === "object") return refusal(body, `${fallback} (status ${res.status})`);
  return `${fallback} (status ${res.status})`;
}

/** "The Architect", "The Architect and The Storyteller", "A, B and C". */
function namesOf(keys: readonly string[], classes: readonly ClassName[]): string {
  const names = keys.map((k) => classes.find((c) => c.key === k)?.name ?? k);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The row order for one load: powers carrying a class, a suggestion or a decision first, each group in the server's order. */
function orderOf(powers: readonly PowerRow[]): string[] {
  const carries = (p: PowerRow) => p.classes.length > 0 || p.suggested.length > 0 || p.decided;
  return [...powers.filter(carries), ...powers.filter((p) => !carries(p))].map((p) => p.key);
}

/** The rows in the order taken at load, with any row that order has not seen kept at the end. */
function inOrder(powers: readonly PowerRow[], order: readonly string[]): PowerRow[] {
  const placed = order.map((key) => powers.find((p) => p.key === key)).filter((p): p is PowerRow => !!p);
  return [...placed, ...powers.filter((p) => order.indexOf(p.key) < 0)];
}

/** The classes in the order the classes panel shows them, with any it does not list kept at the end. */
function columnsOf(classes: readonly ClassName[], castOrder: readonly string[]): ClassName[] {
  const placed = castOrder.map((key) => classes.find((c) => c.key === key)).filter((c): c is ClassName => !!c);
  return [...placed, ...classes.filter((c) => castOrder.indexOf(c.key) < 0)];
}

const readable = (d: any): d is Affinity => !!d && Array.isArray(d.classes) && Array.isArray(d.powers);

/** An id a checkbox can be found by. The keys are this panel's to read, never to choose, so they are flattened. */
const boxId = (powerKey: string, classKey: string): string =>
  `affinity-${powerKey}-${classKey}`.replace(/[^A-Za-z0-9_-]/g, "-");

export default function PowerAffinityPanel({
  password,
  castKey,
  castOrder = [],
}: {
  password: string;
  /** Changes when a class is added, renamed or moved in the panel above, which reloads the table. */
  castKey: string;
  /** The class keys in the order the classes panel shows them right now. */
  castOrder?: readonly string[];
}) {
  const [data, setData] = useState<Affinity | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [said, setSaid] = useState("");
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const inFlight = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/power-affinity`, { headers: authHeaders(password) });
      if (!res.ok) {
        setLoadError(await sentenceFor(res, "The powers did not load"));
        return;
      }
      const d = await res.json().catch(() => null);
      if (!readable(d)) {
        setLoadError("The powers did not load. The server sent something this panel cannot read.");
        return;
      }
      setLoadError("");
      setData({ classes: d.classes, powers: d.powers });
      setOrder(orderOf(d.powers));
    } catch {
      setLoadError("The powers did not load. The server did not answer.");
    }
  }, [password]);

  // `castKey` changes when a class is added, renamed or moved in the panel
  // above, so the table follows the cast without a page reload.
  useEffect(() => {
    void load();
  }, [load, castKey]);

  // A row handed back to the platform loses the button that did it, and focus
  // would fall to the page. It goes to the first box of that same row instead.
  useEffect(() => {
    if (!focusRow || !data) return;
    const first = columnsOf(data.classes, castOrder)[0];
    if (first) document.getElementById(boxId(focusRow, first.key))?.focus();
    setFocusRow(null);
  }, [focusRow, data, castOrder]);

  const putRow = (row: PowerRow) =>
    setData((cur) => (cur ? { ...cur, powers: cur.powers.map((p) => (p.key === row.key ? row : p)) } : cur));

  /** Save one power's classes, or `null` to hand it back to the platform. */
  const send = async (power: PowerRow, classes: string[] | null) => {
    if (inFlight.current.has(power.key)) return;
    inFlight.current.add(power.key);
    if (classes !== null) putRow({ ...power, classes, decided: true });
    try {
      const res = await fetch(`${API_BASE}/admin/power-affinity/${encodeURIComponent(power.key)}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ classes }),
      });
      if (!res.ok) {
        putRow(power);
        const sentence = await sentenceFor(res, `${power.label} did not save`);
        toast.error(sentence);
        setSaid(sentence);
        return;
      }
      const d = await res.json().catch(() => null);
      if (!readable(d)) {
        // Saved, with an echo this panel cannot read: read the whole table again.
        await load();
        return;
      }
      // The server's rows, drawn in the order already on screen.
      setData({ classes: d.classes, powers: d.powers });
      if (classes === null) setFocusRow(power.key);
      const now = d.powers.find((p) => p.key === power.key)?.classes ?? [];
      setSaid(
        now.length ? `${power.label} now suits ${namesOf(now, d.classes)}.` : `${power.label} now suits no class.`,
      );
    } catch {
      putRow(power);
      const sentence = `${power.label} did not save. The server did not answer.`;
      toast.error(sentence);
      setSaid(sentence);
    } finally {
      inFlight.current.delete(power.key);
    }
  };

  /** Tick or untick one class, keeping the list in the columns' own order. */
  const toggle = (power: PowerRow, classKey: string) => {
    if (!data) return;
    const next = power.classes.includes(classKey)
      ? power.classes.filter((k) => k !== classKey)
      : columnsOf(data.classes, castOrder)
          .map((c) => c.key)
          .filter((k) => k === classKey || power.classes.includes(k));
    void send(power, next);
  };

  if (!data && !loadError) return null;
  const columns = data ? columnsOf(data.classes, castOrder) : [];

  return (
    <section aria-labelledby="power-affinity-h" className="mt-6 border-t border-gray-100 pt-4">
      <h4 id="power-affinity-h" className="text-sm font-semibold text-gray-900 mb-1">
        Which powers suit each class
      </h4>
      <p className="text-xs text-gray-500 mb-2">
        A tick says a power suits that class. A member who reaches Contributor and plays a ticked class sees the
        power marked as suiting them, and each class card lists its powers. A tick hands nobody a power: the village
        still entrusts every one of these through a role or a badge.
      </p>
      <p className="text-[11px] text-gray-500 mb-4">
        The platform suggests a class for some powers, and a power you have not changed follows that suggestion. Once
        you change one, it stays as you left it until you hand it back.
      </p>

      {loadError ? (
        <p role="alert" className="text-sm text-red-600 border border-red-200 rounded-lg p-3 mb-4">
          {loadError}
        </p>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {said}
      </p>

      {data ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Powers down the side and classes across the top. A tick means the power suits that class.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="py-2 pr-3 text-left text-xs font-medium text-gray-700">
                  Power
                </th>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="px-1 py-2 text-center text-xs font-medium text-gray-700">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inOrder(data.powers, order).map((p) => (
                <tr key={p.key} className="border-t border-gray-100 align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <span className="block text-gray-900">{p.label}</span>
                    <span className="block text-[11px] text-gray-500">
                      {p.decided
                        ? "Your village's choice."
                        : p.suggested.length
                          ? `The platform suggests ${namesOf(p.suggested, data.classes)}.`
                          : "No suggestion from the platform."}
                      {p.live ? "" : " Its module is off here, so no member sees this yet."}
                      {p.live && p.entrusted === false
                        ? " This village's ladder opens it, so no member is recommended it."
                        : ""}
                    </span>
                    {p.decided ? (
                      <button type="button" className={quietBtnCls} onClick={() => void send(p, null)}>
                        {p.suggested.length ? "Use the platform's suggestion" : "Clear your choice"}
                      </button>
                    ) : null}
                  </th>
                  {columns.map((c) => (
                    <td key={c.key} className="px-1 py-2 text-center">
                      <label className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
                        <input
                          id={boxId(p.key, c.key)}
                          type="checkbox"
                          checked={p.classes.includes(c.key)}
                          onChange={() => toggle(p, c.key)}
                          aria-label={`${p.label}: suits ${c.name}`}
                          className="h-4 w-4 accent-teal-deep"
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
