/**
 * THE COMPANION'S DOORS ON THE CANVAS (plan 5.4; Wave 4, 2026-09-28).
 *
 * One panel, many doors. `CompanionProvider` wraps the Canvas view and holds
 * the panel; an `AskButton` anywhere inside it opens the panel on the block it
 * sits on, or on the whole canvas. The doors today: the Canvas view's header,
 * every block's card, and each block's Learn frame.
 *
 * The panel is its own chunk (`CompanionPanel`), fetched the first time
 * somebody presses Ask, so a member who only reads the canvas downloads
 * nothing for it. The buttons render nothing outside a provider, so a card
 * reused somewhere without the panel never offers a door that opens onto
 * nothing.
 */
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import type { CanvasBlockId } from "@shared/governanceCanvas";

const CompanionPanel = lazy(() => import("./CompanionPanel"));

type OpenCompanion = (block: CanvasBlockId | null) => void;

const CompanionContext = createContext<OpenCompanion | null>(null);

/**
 * ONE PANEL IN THE CORNER AT A TIME (audit of Wave 4). The Journey page's
 * organizing guide sits in the same fixed corner box as this panel, and drawn
 * later it covered it: a founder pressed Ask and saw nothing while keystrokes
 * went into the hidden field. `cornerTaken` closes this panel whenever the
 * other one opens, and `onOpen` lets the page close the other one when Ask is
 * pressed.
 */
export function CompanionProvider({
  children,
  cornerTaken = false,
  onOpen,
}: {
  children: ReactNode;
  cornerTaken?: boolean;
  onOpen?: () => void;
}) {
  // `turn` remounts the panel for each press, so asking about another block
  // starts a fresh conversation about that block.
  const [asking, setAsking] = useState<{ block: CanvasBlockId | null; turn: number } | null>(null);
  const open = useCallback<OpenCompanion>(
    (block) => {
      onOpen?.();
      setAsking((a) => ({ block, turn: (a?.turn ?? 0) + 1 }));
    },
    [onOpen],
  );
  useEffect(() => {
    if (cornerTaken) setAsking(null);
  }, [cornerTaken]);
  return (
    <CompanionContext.Provider value={open}>
      {children}
      {asking && (
        <Suspense fallback={null}>
          <CompanionPanel key={asking.turn} block={asking.block} onClose={() => setAsking(null)} />
        </Suspense>
      )}
    </CompanionContext.Provider>
  );
}

/**
 * A door to the companion. `label` is what the button says; `name` is the
 * accessible name when the visible words are short ("Ask" on a card), and it
 * always begins with those words, so a person using speech input can say what
 * they see.
 */
export function AskButton({
  block,
  label,
  name,
  className,
}: {
  block: CanvasBlockId | null;
  label: string;
  name?: string;
  className?: string;
}) {
  const open = useContext(CompanionContext);
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={() => open(block)}
      aria-label={name}
      className={
        className ??
        "inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium rounded-lg px-3 text-teal-deep border border-stone-300 bg-white hover:bg-stone-50"
      }
    >
      <MessageCircle className="w-4 h-4" aria-hidden="true" />
      {label}
    </button>
  );
}
