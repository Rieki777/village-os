/**
 * "NEW ROLE FROM A CARD" (role journey, PR-B): choose the circle, bring in a card
 * (paste, file or Google Doc, in the "Amora role card v1" format), read it, and
 * make the role. The new role starts unlisted with its door closed, ready to edit
 * and list. Loaded as its own chunk with the editor.
 */
import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import CirclePicker from "@/components/circles/CirclePicker";
import type { PickerCircle } from "@shared/circlePicker";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FOCUS, INPUT, LEDE, PRIMARY, SECONDARY } from "@/components/roleProposal/parts";
import { newFromFile, newFromText, type NewFromCard } from "./roleEditApi";

type Mode = "paste" | "file" | "link";

export default function NewRoleFromCard({ onClose, onMade }: { onClose: () => void; onMade?: (roleId: string) => void }) {
  const { t } = useLingui();
  const [circles, setCircles] = useState<PickerCircle[]>([]);
  const [circleId, setCircleId] = useState("");
  const [mode, setMode] = useState<Mode>("paste");
  const [pasted, setPasted] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<NewFromCard | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/org")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d || !Array.isArray(d.circles)) return;
        setCircles(d.circles.filter((c: any) => c && !c.isExample && typeof c.id === "string").map((c: any) => ({ id: String(c.id), name: String(c.name ?? c.id), status: c.status ? String(c.status) : null, isAnchor: !!c.isAnchor, parentCircleId: c.parentCircleId ?? null })));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const go = async (create: boolean) => {
    setBusy(true);
    setError(null);
    const file = mode === "file" ? fileRef.current?.files?.[0] : undefined;
    if (mode === "file" && !file) {
      setBusy(false);
      return setError(t({ message: "Choose the file to bring in.", context: "new role from a card" }));
    }
    const r = file
      ? await newFromFile(file, circleId, create)
      : await newFromText({ ...(mode === "link" ? { link } : { text: pasted }), circleId, create });
    setBusy(false);
    if (!r.ok) {
      setRead((r.body as NewFromCard | null) ?? null);
      return setError(r.error);
    }
    setRead(r.data);
    if (r.data.created && r.data.roleId) onMade?.(r.data.roleId);
  };

  const blocking = (read?.problems ?? []).filter((p) => p.blocks);
  const madeId = read?.created ? read.roleId : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto bg-card text-foreground">
        <DialogTitle className="font-display text-xl"><Trans context="new role from a card">New role from a card</Trans></DialogTitle>
        <DialogDescription className={LEDE}>
          <Trans context="new role from a card">The new role starts unlisted, with its door closed, in the circle you choose. Open it with Edit this role when it is ready.</Trans>
        </DialogDescription>
        <label className="space-y-1 text-sm font-semibold">
          <span><Trans context="new role from a card">Circle</Trans></span>
          <CirclePicker className={INPUT} circles={circles} value={circleId} onChange={setCircleId} autoDefault leading={<option value="">{"-"}</option>} />
        </label>
        <div className="flex flex-wrap gap-2">
          {(["paste", "file", "link"] as const).map((m) => (
            <button key={m} type="button" className={mode === m ? PRIMARY : SECONDARY} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "paste" ? <Trans context="new role from a card">Paste</Trans> : m === "file" ? <Trans context="new role from a card">File</Trans> : <Trans context="new role from a card">Google Doc</Trans>}
            </button>
          ))}
        </div>
        {mode === "paste" && <textarea className={`${INPUT} min-h-[160px]`} value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label={t({ message: "The card's words", context: "new role from a card" })} />}
        {mode === "file" && <input ref={fileRef} type="file" accept=".docx,.pdf,.md,.txt" className={`${INPUT} py-2 ${FOCUS}`} aria-label={t({ message: "Choose a file", context: "new role from a card" })} />}
        {mode === "link" && <input className={INPUT} inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} aria-label={t({ message: "Link to a Google Doc shared with anyone who has the link", context: "new role from a card" })} />}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECONDARY} disabled={busy || !circleId} onClick={() => void go(false)}>
            <Trans context="new role from a card">Read the card</Trans>
          </button>
          <button type="button" className={PRIMARY} disabled={busy || !circleId || !read || !read.isCard || blocking.length > 0 || !!madeId} onClick={() => void go(true)}>
            <Trans context="new role from a card">Make the role</Trans>
          </button>
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-coral">{error}</p>}
        {read && !read.isCard && <p role="status" className={LEDE}><Trans context="new role from a card">That is not a role card. A role card starts with the line Role card v1.</Trans></p>}
        {read?.isCard && (
          <div role="status" className="space-y-1 text-sm">
            {read.title && <p className="font-semibold text-foreground">{read.title}{read.circleName ? ` (${read.circleName})` : ""}</p>}
            {(read.problems ?? []).map((p) => (
              <p key={`${p.field}:${p.sentence}`} className={p.blocks ? "font-semibold text-coral" : "text-muted-foreground"}>{p.sentence}</p>
            ))}
            {madeId && <p className="font-semibold text-foreground"><Trans context="new role from a card">The role is made, unlisted. Find it in its circle and choose Edit this role.</Trans></p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
