/**
 * Admin, The Game, Org Chart: the links between circles and seats.
 *
 * ── THE DOOR THIS FILE IS ────────────────────────────────────────────────
 * `org_relations` is stored, served and DRAWN. `GET /api/map` carries
 * `relations` and `relationTypes`, `client/src/components/power/RelationLines.tsx`
 * draws them as dashed chords on the Power Map, and `POST /api/admin/org/relations`
 * with its DELETE sibling had no caller in the browser. So a renderer that
 * could only ever draw nothing shipped beside two routes only curl could
 * reach. This is the form that writes them.
 *
 * ── IT SPEAKS THE DRAWING'S VOCABULARY ───────────────────────────────────
 * Everything here says what the map will do with a link, because a person
 * drawing structure is choosing a picture. Chords draw for the FOCUSED circle
 * only, which is the map's own discipline about never showing every line at
 * once; `escalation` draws as an arrow because "if I disagree, where do I go"
 * has a direction; a cover type feeds the health dashboard's answer about
 * which seats have somebody named to carry them.
 *
 * ── ENDPOINTS ARE NODES, NEVER PEOPLE ────────────────────────────────────
 * `server/lib/orgRelations.ts` has no `user` endpoint kind on purpose: a link
 * between two seats names nobody and is publishable by construction. This form
 * offers circles and seats and nothing else, so it cannot be the place that
 * changes.
 *
 * ── THE LABEL FLIPS ──────────────────────────────────────────────────────
 * One row reads two ways: from the first end it is "is deputised by", from the
 * other it is "deputises for". The list below prints the from-side reading and
 * the inverse under it, so the direction a founder picked is visible before
 * they save and afterwards.
 */
import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import InfoTip from "@/components/InfoTip";

type NodeKind = "circle" | "org_role";

interface RelationType {
  id: string;
  label: string;
  inverseLabel: string;
  symmetric: boolean;
  isCover: boolean;
}

interface Relation {
  id: string;
  typeId: string;
  fromKind: NodeKind;
  fromId: string;
  toKind: NodeKind;
  toId: string;
  note: string | null;
}

interface NodeOption {
  key: string;
  kind: NodeKind;
  id: string;
  label: string;
}

const inputCls =
  "border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-deep";

/**
 * What the map does with this type, as its own sentence. It follows a full
 * stop on the line, so it starts capitalised: the first draft ran the clause
 * on lowercase after a period and read as a sentence cut in half.
 */
function drawnAs(t: RelationType): string {
  if (t.id === "escalation") return "Drawn as a thin arrow on the Power Map";
  return "Drawn as a dashed chord on the Power Map";
}

export default function RelationsEditor({
  password,
  circles,
  roles,
}: {
  password: string;
  circles: Array<{ id: string; name: string; isExample?: boolean }>;
  roles: Array<{ id: string; name: string; circleId?: string | null; isExample?: boolean }>;
}) {
  const [types, setTypes] = useState<RelationType[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [fromKey, setFromKey] = useState("");
  const [typeId, setTypeId] = useState("");
  const [toKey, setToKey] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/org/relations", { headers: { Authorization: `Bearer ${password}` } });
      const body = res.ok ? await res.json() : { types: [], relations: [] };
      setTypes(Array.isArray(body.types) ? body.types : []);
      setRelations(Array.isArray(body.relations) ? body.relations : []);
    } catch {
      setTypes([]);
      setRelations([]);
    } finally {
      setLoading(false);
    }
  }, [password]);
  useEffect(() => {
    void load();
  }, [load]);

  // The example rows stay home the way they do everywhere else: a village's
  // own structure is what a link may join.
  const circleName = new Map(circles.filter((c) => !c.isExample).map((c) => [String(c.id), c.name]));
  const options: NodeOption[] = [
    ...circles
      .filter((c) => !c.isExample)
      .map((c) => ({ key: `circle:${c.id}`, kind: "circle" as NodeKind, id: String(c.id), label: `${c.name} (circle)` })),
    ...roles
      .filter((r) => !r.isExample)
      .map((r) => ({
        key: `org_role:${r.id}`,
        kind: "org_role" as NodeKind,
        id: String(r.id),
        label: r.circleId ? `${r.name} (role in ${circleName.get(String(r.circleId)) ?? "a circle"})` : `${r.name} (role)`,
      })),
  ];
  const byKey = new Map(options.map((o) => [o.key, o]));
  const nodeName = (kind: NodeKind, id: string): string =>
    byKey.get(`${kind}:${id}`)?.label ?? "A node that has since been removed";

  const from = byKey.get(fromKey);
  const to = byKey.get(toKey);
  const sameNode = !!from && !!to && from.key === to.key;
  const ready = !!from && !!to && !!typeId && !sameNode && !busy;

  const create = async () => {
    if (!from || !to) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/org/relations", {
        method: "POST",
        headers: { Authorization: `Bearer ${password}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          typeId,
          fromKind: from.kind,
          fromId: from.id,
          toKind: to.kind,
          toId: to.id,
          note: note.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.message ?? body?.error ?? "That link did not save");
        return;
      }
      toast.success("Link drawn");
      setFromKey("");
      setToKey("");
      setTypeId("");
      setNote("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Relation) => {
    const t = types.find((x) => x.id === r.typeId);
    const sentence = `${nodeName(r.fromKind, r.fromId)} ${t?.label ?? r.typeId} ${nodeName(r.toKind, r.toId)}`;
    if (!window.confirm(`Remove this link? It stops being drawn on the Power Map.\n\n${sentence}`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/org/relations/${encodeURIComponent(r.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${password}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.message ?? body?.error ?? "That link did not come off");
        return;
      }
      toast.success("Link removed");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <h3 className="flex items-center gap-2 font-semibold text-gray-900">
        Links between circles and roles
        <InfoTip
          tip="A link joins two nodes, never two people. It stays true when the holders change, which is why it can be published."
          label="What a link joins"
        />
      </h3>
      <p className="text-sm text-gray-500 mt-1 leading-relaxed">
        Deputies, successors, mentors and escalation paths. The Power Map draws a circle's links when that circle is
        focused, so a village sees the lines around one circle at a time.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400 mt-3">Reading the links...</p>
      ) : (
        <>
          <div className="mt-4 space-y-2">
            {relations.length === 0 && (
              <p className="text-sm text-gray-500">
                No links yet. The Power Map draws nothing around a circle until one is written here.
              </p>
            )}
            {relations.map((r) => {
              const t = types.find((x) => x.id === r.typeId);
              return (
                <div key={r.id} className="border border-gray-100 rounded-lg p-3 flex flex-wrap gap-2 items-start">
                  <div className="flex-1 min-w-[220px]">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{nodeName(r.fromKind, r.fromId)}</span>{" "}
                      {t?.label ?? r.typeId}{" "}
                      <span className="font-medium">{nodeName(r.toKind, r.toId)}</span>
                    </p>
                    {t && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Read from the other end: {nodeName(r.toKind, r.toId)} {t.inverseLabel}{" "}
                        {nodeName(r.fromKind, r.fromId)}. {drawnAs(t)}
                        {t.isCover && ", and counted as cover on the health dashboard"}.
                      </p>
                    )}
                    {r.note && <p className="text-xs text-gray-600 mt-0.5">{r.note}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove the link from ${nodeName(r.fromKind, r.fromId)} to ${nodeName(r.toKind, r.toId)}`}
                    onClick={() => void remove(r)}
                    className="inline-flex items-center gap-1 text-sm border border-gray-200 rounded-lg px-3 py-2 min-h-[44px] text-gray-700 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                    Remove
                  </button>
                </div>
              );
            })}
          </div>

          {/* THE FORM. Three choices in the order the sentence reads, so the
              line under it is the sentence the map will carry. */}
          <div className="mt-4 pt-4 border-t border-gray-50">
            <h4 className="text-sm font-semibold text-gray-900">Draw a link</h4>
            <div className="grid sm:grid-cols-3 gap-2 mt-2">
              <label className="text-xs text-gray-500">
                From
                <select
                  value={fromKey}
                  aria-label="From"
                  onChange={(e) => setFromKey(e.target.value)}
                  className={`${inputCls} w-full mt-1 min-h-[44px]`}
                >
                  <option value="">Choose a circle or role</option>
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-500">
                Relationship
                <select
                  value={typeId}
                  aria-label="Relationship"
                  onChange={(e) => setTypeId(e.target.value)}
                  className={`${inputCls} w-full mt-1 min-h-[44px]`}
                >
                  <option value="">Choose a relationship</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-500">
                To
                <select
                  value={toKey}
                  aria-label="To"
                  onChange={(e) => setToKey(e.target.value)}
                  className={`${inputCls} w-full mt-1 min-h-[44px]`}
                >
                  <option value="">Choose a circle or role</option>
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="text-xs text-gray-500 block mt-2">
              A note, if the link needs one
              <input
                value={note}
                maxLength={280}
                aria-label="A note, if the link needs one"
                onChange={(e) => setNote(e.target.value)}
                placeholder="Agreed at the spring gathering"
                className={`${inputCls} w-full mt-1 min-h-[44px] block`}
              />
            </label>

            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              {from && to && typeId && !sameNode
                ? `${from.label} ${types.find((t) => t.id === typeId)?.label ?? ""} ${to.label}.`
                : sameNode
                  ? "A circle or a role cannot be linked to itself."
                  : "Pick both ends and a relationship to see the sentence this will draw."}
            </p>

            <button
              type="button"
              disabled={!ready}
              onClick={() => void create()}
              className="mt-2 text-sm bg-teal-deep text-white rounded-lg px-4 py-2 min-h-[44px] font-medium disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
            >
              {busy ? "Saving..." : "Draw the link"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
