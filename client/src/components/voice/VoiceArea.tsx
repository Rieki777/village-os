/**
 * A LONG TEXT BOX YOU CAN TALK TO (Rye, 2026-11-09: "whenever long text is
 * about to be used to offer a mic option to talk directly to the field or
 * talk it out with Sera").
 *
 * Wrap any `<textarea>`:
 *
 *   <VoiceArea value={about} onValue={setAbout} talk={{ label: "About you", purpose: "..." }}>
 *     <textarea value={about} onChange={...} className="..." />
 *   </VoiceArea>
 *
 * Two things appear, and the box itself is untouched:
 *   - the mic (MicButton, the browser's own speech engine; nothing is sent to
 *     a server), in the box's corner. Each finished phrase is added to the end
 *     of what is there. It draws nothing where the browser cannot listen.
 *   - "Talk it out" (with `talk`), under the box, for a signed-in member: a
 *     short conversation with their own guide, Maia or Sera, that ends in a
 *     draft they can use or ignore. It loads only when opened.
 */
import { Children, cloneElement, isValidElement, lazy, Suspense, useState, type ReactElement, type ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import MicButton from "@/components/MicButton";
import { appendSpoken } from "@/components/journal/GrowingTextarea";
import { useOptionalAuth } from "@/contexts/AuthContext";

const TalkItOut = lazy(() => import("./TalkItOut"));

export interface TalkTarget {
  /** The box's name as the page shows it ("About you"). */
  label: string;
  /** What the box is for, in a sentence, for the guide. */
  purpose?: string;
}

export default function VoiceArea({
  value,
  onValue,
  talk,
  disabled,
  children,
}: {
  value: string;
  onValue: (next: string) => void;
  /** Offer "Talk it out" for this box. Members only; visitors get the mic alone. */
  talk?: TalkTarget;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useLingui();
  // Optional: a page rendered outside the auth provider still gets its mic.
  const user = useOptionalAuth()?.user ?? null;
  const [open, setOpen] = useState(false);
  const only = Children.only(children);
  // The box's own limit holds for what is spoken or drafted too; the browser only stops typing.
  const max = isValidElement(only) ? Number((only.props as { maxLength?: number }).maxLength) || 0 : 0;
  const set = (next: string) => onValue(max > 0 ? next.slice(0, max) : next);
  // Room in the corner for the mic, so the last line of text never sits under it.
  const box = isValidElement(only)
    ? cloneElement(only as ReactElement<{ className?: string }>, {
        className: `${(only as ReactElement<{ className?: string }>).props.className ?? ""} pr-12`,
      })
    : only;

  return (
    <div className="space-y-2">
      <div className="relative">
        {box}
        <MicButton
          className="absolute bottom-2 right-2"
          disabled={disabled}
          onText={(chunk) => set(appendSpoken(value, chunk))}
        />
      </div>
      {talk && user && !open && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessageCircle className="h-4 w-4 text-notice" aria-hidden="true" />
          {t({ message: "Talk it out", context: "voice field: opens a conversation with your guide about this box" })}
        </button>
      )}
      {talk && user && open && (
        <Suspense fallback={null}>
          <TalkItOut
            target={talk}
            current={value}
            onUse={(draft) => set(draft)}
            onAdd={(draft) => set(value.trim() ? `${value.trimEnd()}\n\n${draft}` : draft)}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
