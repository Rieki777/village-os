/**
 * THE CONTROL THAT REACHES PAST A VILLAGE-HELD POWER.
 *
 * Mounted once, beside the toaster, and it draws nothing until a refusal
 * arrives. `client/src/lib/breakGlass.ts` carries the argument for why the
 * refusal is answered in one place; this file is what an operator sees when
 * it is.
 *
 * ── WHAT IT IS AND IS NOT ─────────────────────────────────────────────────
 *
 * It is a question with the consequence stated, and the consequence is a
 * fact. There is no red, no warning triangle, no second confirmation, no
 * counting of how many times somebody has done this. An operator with a good
 * reason should be able to act and get on with their day.
 *
 * The queue is real and not decoration. A panel can fire several writes at
 * once, and answering one dialog while three more stack behind it invisibly
 * would let somebody agree to one act and pay for four.
 *
 * A hand-built overlay and not the shadcn primitive, matching the four other
 * modal surfaces in this client. It lives in the main chunk because the
 * wrapper it hosts is app-wide, so a dependency pulled in here is bytes on
 * every page in the product.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import {
  breakGlassCopy,
  installBreakGlass,
  type BreakGlassAsk,
} from "@/lib/breakGlass";
import { useModalFocus } from "@/lib/useModalFocus";

interface Waiting {
  ask: BreakGlassAsk;
  answer: (go: boolean) => void;
}

export default function BreakGlass() {
  const [current, setCurrent] = useState<Waiting | null>(null);
  const queue = useRef<Waiting[]>([]);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const next = useCallback(() => {
    const following = queue.current.shift() ?? null;
    setCurrent(following);
  }, []);

  useEffect(() => {
    return installBreakGlass(
      (ask) =>
        new Promise<boolean>((resolve) => {
          const waiting: Waiting = { ask, answer: resolve };
          setCurrent((open) => {
            if (open) {
              queue.current.push(waiting);
              return open;
            }
            return waiting;
          });
        }),
    );
  }, []);

  // Declared BEFORE the effect below, so it notes who held focus before the
  // confirm button takes it, and hands focus back there when the queue empties.
  // Tab wraps inside the panel; Escape stays with the effect below.
  const panel = useRef<HTMLDivElement | null>(null);
  useModalFocus(current !== null, panel, { initial: confirmRef });

  useEffect(() => {
    if (!current) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      current.answer(false);
      next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, next]);

  if (!current) return null;
  const copy = breakGlassCopy(current.ask);
  const decide = (go: boolean) => {
    current.answer(go);
    next();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="break-glass-title"
      data-testid="break-glass"
      ref={panel}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/40 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <KeyRound className="h-5 w-5 mt-1 shrink-0 text-stone-500" aria-hidden />
          <div>
            <h2 id="break-glass-title" className="text-lg font-bold text-stone-900">
              {copy.heading}
            </h2>
            <p className="mt-2 text-sm text-stone-700 leading-relaxed" data-testid="break-glass-power">
              {copy.power}
            </p>
            <p className="mt-2 text-sm text-stone-700 leading-relaxed" data-testid="break-glass-holder">
              {copy.holder}
            </p>
            <p className="mt-3 text-sm text-stone-600 leading-relaxed" data-testid="break-glass-record">
              {copy.record}
            </p>
          </div>
        </div>
        <div className="mt-5 space-y-2">
          <button
            type="button"
            ref={confirmRef}
            data-testid="break-glass-act"
            onClick={() => decide(true)}
            className="min-h-[44px] w-full rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
          >
            {copy.confirm}
          </button>
          <button
            type="button"
            data-testid="break-glass-leave"
            onClick={() => decide(false)}
            className="min-h-[44px] w-full rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
          >
            {copy.dismiss}
          </button>
        </div>
      </div>
    </div>
  );
}
