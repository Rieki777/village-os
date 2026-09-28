/**
 * THE RESOURCES UNDER ONE CANVAS BLOCK, inside its Learn frame (plan 5.1-5.3,
 * Wave 4, 2026-09-28).
 *
 * What GET /api/canvas/resources?block=<id>&surface=learn sends: the
 * Governance Canvas Database's resources for this block, the village's own
 * placings first. Each shows its name (a link when the database gives one),
 * its kind and authors, its description, and, only when a member should be
 * told, why it is here and whether its link failed the last check. Under the
 * list: the credit with a link to the database, how old the copy is, and the
 * database's own suggestion form once the village has set
 * `canvas.suggest_url` (no link before that, plan 5.3).
 *
 * THE PEN chooses where a resource shows in this village (`mayPlace`): a
 * short form per resource, twelve boxes in canvas order, and a way back to
 * the platform's placing. The write is PUT /api/canvas/resources/:key/blocks;
 * the server's gate decides, and this form only decides whether to offer.
 *
 * Every sentence is in client/src/lib/canvasResourcesCopy.ts. This file
 * sifts, sorts and counts nothing: client/src/lib/canvasCopy.test.ts reads
 * it with the rest of the canvas.
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { readFailure, refusalText } from "@/lib/canvasFramesCopy";
import {
  brokenLinkLine,
  byLine,
  emptyLine,
  LINK_PENDING_LINE,
  placingLine,
  sourceLine,
  withBlock,
  type CanvasResourcesPayload,
  type CanvasResourceView,
} from "@/lib/canvasResourcesCopy";
import { CANVAS_ORDER, type CanvasBlock, type CanvasBlockId } from "@shared/governanceCanvas";

const headers = (json = false): Record<string, string> => {
  const t = authToken();
  return { ...(json ? { "Content-Type": "application/json" } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

const quiet = "text-sm font-medium rounded-lg px-3 min-h-[44px] text-teal-deep border border-teal-deep bg-white hover:bg-stone-50";

export default function CanvasLearnResources({ block }: { block: CanvasBlock }) {
  const [payload, setPayload] = useState<CanvasResourcesPayload | null>(null);
  const [failed, setFailed] = useState<{ message: string; retry: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(null);
    fetch(`/api/canvas/resources?block=${block.id}&surface=learn`, { headers: headers() })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return setFailed(readFailure(r.status, d?.error, "the resources for this block"));
        setPayload(d as CanvasResourcesPayload);
      })
      .catch(() => setFailed(readFailure(null, null, "the resources for this block")));
  }, [block.id]);

  useEffect(() => {
    load();
  }, [load]);

  const saved = (message: string) => {
    setNotice(message);
    load();
  };

  return (
    <div className="space-y-3" data-testid="canvas-learn-resources">
      <h4 className="font-semibold text-stone-900">From the Governance Canvas Database</h4>
      {notice && (
        <p role="status" className="text-sm rounded-lg bg-teal-deep/10 text-stone-900 px-3 py-2">
          {notice}
        </p>
      )}
      {failed ? (
        <div role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3 space-y-2">
          <p>{failed.message}</p>
          {failed.retry && (
            <button type="button" onClick={load} className={quiet}>
              Try again
            </button>
          )}
        </div>
      ) : !payload ? (
        <p className="text-stone-600 py-2">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Reading the resources for {block.name}
        </p>
      ) : (
        <>
          {payload.resources[0] ? (
            <ul className="space-y-2" data-testid="canvas-resources-list">
              {payload.resources.map((r) => (
                <ResourceItem key={r.key} resource={r} block={block} mayPlace={payload.mayPlace} onSaved={saved} />
              ))}
            </ul>
          ) : (
            <p className="text-stone-700">{emptyLine(block.name)}</p>
          )}
          <p className="text-xs text-stone-600" data-testid="canvas-resources-credit">
            From the{" "}
            <a href={payload.credit.url} target="_blank" rel="noreferrer" className="font-medium text-stone-800 hover:underline">
              {payload.credit.text}
            </a>
            . {sourceLine(payload.source)}
          </p>
          {payload.suggestUrl && (
            <p className="text-xs text-stone-600" data-testid="canvas-resources-suggest">
              To add a resource,{" "}
              <a href={payload.suggestUrl} target="_blank" rel="noreferrer" className="font-medium text-teal-deep hover:underline">
                suggest it to the Governance Canvas Database
              </a>{" "}
              on its keepers' own form. You send it yourself, and this village sends nothing.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ResourceItem({
  resource: r,
  block,
  mayPlace,
  onSaved,
}: {
  resource: CanvasResourceView;
  block: CanvasBlock;
  mayPlace: boolean;
  onSaved: (message: string) => void;
}) {
  const placing = placingLine(r, block.name);
  const broken = brokenLinkLine(r);
  return (
    <li className="rounded-lg border border-stone-200 bg-white px-3 py-2" data-testid={`canvas-resource-${r.key}`}>
      {r.url ? (
        <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-teal-deep hover:underline">
          {r.name}
          <ExternalLink className="inline w-3 h-3 ml-0.5 align-[-1px]" aria-hidden="true" />
        </a>
      ) : (
        <span className="font-medium text-stone-900">{r.name}</span>
      )}
      <span className="block text-xs text-stone-600">{byLine(r)}</span>
      {r.description && <p className="mt-1 text-stone-800">{r.description}</p>}
      {r.linkPending && <p className="mt-1 text-xs text-stone-600">{LINK_PENDING_LINE}</p>}
      {broken && <p className="mt-1 text-xs text-stone-600">{broken}</p>}
      {placing && <p className="mt-1 text-xs text-stone-600">{placing}</p>}
      {mayPlace && <PlaceForm resource={r} onSaved={onSaved} />}
    </li>
  );
}

/** The pen's form: which blocks this resource shows under, in this village only. */
function PlaceForm({ resource: r, onSaved }: { resource: CanvasResourceView; onSaved: (message: string) => void }) {
  const [blocks, setBlocks] = useState<CanvasBlockId[]>(r.blocks);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const send = async (next: CanvasBlockId[] | null) => {
    setBusy(true);
    setRefused(null);
    try {
      const res = await fetch(`/api/canvas/resources/${r.key}/blocks`, {
        method: "PUT",
        headers: headers(true),
        body: JSON.stringify({ blocks: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setRefused(refusalText(d, "That could not be saved just now."));
      onSaved(
        next
          ? `Saved. ${r.name} now shows under the blocks you chose, in this village only.`
          : `Saved. ${r.name} shows where the platform places it again.`,
      );
    } catch {
      setRefused("That could not be saved just now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer min-h-[44px] flex items-center font-medium text-teal-deep">Choose where this shows</summary>
      <fieldset className="mt-2 space-y-2">
        <legend className="text-xs text-stone-600">The blocks {r.name} shows under in this village. Other villages are not affected.</legend>
        <div className="grid grid-cols-2 gap-1">
          {CANVAS_ORDER.map((b) => (
            <label key={b.id} className="flex items-center gap-2 min-h-[44px]">
              <input
                type="checkbox"
                checked={blocks.includes(b.id)}
                onChange={(e) => setBlocks((was) => withBlock(was, b.id, e.target.checked))}
              />
              {b.name}
            </label>
          ))}
        </div>
        {refused && (
          <p role="alert" className="text-sm text-red-700">
            {refused}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => send(blocks)} className={quiet}>
            Save where it shows
          </button>
          {r.placing.by === "village" && (
            <button type="button" disabled={busy} onClick={() => send(null)} className={quiet}>
              Use the platform's placing
            </button>
          )}
        </div>
      </fieldset>
    </details>
  );
}
