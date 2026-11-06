/**
 * "Chat": the door from a quest or a task into the chat everyone on it shares.
 *
 * The chat belongs to the work (server/lib/sharedWork.ts): one per quest or
 * task with two or more people on it, and its members are exactly those
 * people. Pressing the button opens it, creating it the first time, and lands
 * on /messages/<id>.
 *
 * TWO WAYS TO DECIDE WHETHER TO SHOW. A quest page is one piece of work, so it
 * asks the server once (`probe`): the button appears only when this member is
 * on the quest and someone else is too. A task board draws many cards, and a
 * question per card would be a request per task on every load, so a card says
 * from what it already knows (`likely`) and the press asks; a press that finds
 * no chat says so instead of failing quietly.
 *
 * Nothing at all while the messaging module is off for this viewer, or signed
 * out: the server would answer 404 to both.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { useModuleOn } from "@/modules/ModuleProvider";
import { authToken, gameFetch } from "@/lib/gameApi";

export type WorkKind = "quest" | "task";

export function workChatUrl(kind: WorkKind, id: string | number): string {
  return `/api/messages/work/${kind}/${encodeURIComponent(String(id))}`;
}

export interface WorkChatButtonProps {
  kind: WorkKind;
  id: string | number;
  /** Ask the server whether a chat is there before showing (one piece of work on the page). */
  probe?: boolean;
  /** Without a probe: whether the caller already knows two or more people are on it. */
  likely?: boolean;
  className?: string;
}

const LOOK =
  "inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg border border-teal-deep/40 bg-white text-teal-deep text-sm font-semibold hover:bg-teal-deep/5 transition-colors disabled:opacity-60";

export default function WorkChatButton({ kind, id, probe = false, likely = false, className }: WorkChatButtonProps) {
  // The session token, the way the menu counts read it: no AuthProvider needed,
  // so a card can carry this button wherever it is drawn.
  const signedIn = !!authToken();
  const on = useModuleOn("messaging");
  const [, navigate] = useLocation();
  const [available, setAvailable] = useState<boolean>(!probe && likely);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!probe) {
      setAvailable(likely);
      return;
    }
    setAvailable(false);
    if (!on || !signedIn) return;
    let live = true;
    gameFetch(workChatUrl(kind, id), { cache: "no-store" })
      .then(async (res) => (res.ok ? await res.json().catch(() => null) : null))
      .then((b) => live && setAvailable(b?.available === true))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, [probe, likely, on, signedIn, kind, id]);

  if (!on || !signedIn || !available) return null;

  const open = async () => {
    setBusy(true);
    try {
      const res = await gameFetch(workChatUrl(kind, id), { method: "POST" });
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (body?.id) {
        navigate(`/messages/${encodeURIComponent(String(body.id))}`);
        return;
      }
      toast.error(
        res.status === 404
          ? `This ${kind} has no chat yet. It opens once two people are on it.`
          : "The chat did not open. Try again in a moment.",
      );
    } catch {
      toast.error("The chat did not open. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={open} disabled={busy} className={className ? `${LOOK} ${className}` : LOOK}>
      <MessagesSquare className="w-4 h-4" aria-hidden="true" />
      Chat
    </button>
  );
}
