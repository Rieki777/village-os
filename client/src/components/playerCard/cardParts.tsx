/**
 * The small parts every section of the player card draws with: the section
 * frame, the eyebrow, a slot (unread draws nothing, empty draws its words),
 * and the owner's in-place edit control.
 *
 * Drawn in the profile's own semantic tokens (`bg-card`, `text-card-foreground`,
 * `text-muted-foreground`, `text-notice`), so the same card reads on the
 * owner's night sheet and on the light public profile with no colour of its
 * own. No hex colour anywhere.
 */
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Pencil } from "lucide-react";
import type { Slot } from "@shared/playerCard";
import { EDIT_WORDS, roleWordPayload, type PersonalEditKey, type RoleEditKey } from "@shared/playerCardEdit";
import { proposeRoleWords, savePersonalWords } from "./playerCardApi";
import { CcosTerm } from "./CcosTerm";

export const SECTION = "rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-8";
export const BOX = "rounded-xl border border-border/70 p-4";
export const EYEBROW = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
export const EYEBROW_GOLD = "text-xs font-semibold uppercase tracking-wide text-notice";
export const H2 = "font-display text-2xl font-bold text-card-foreground";
export const TAP =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring";
export const QUIET_BUTTON = `${TAP} border border-border text-card-foreground hover:bg-muted`;
export const LINK = "inline-flex min-h-11 items-center text-sm font-medium text-notice underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring";

/**
 * A section's small heading. With a `term` it carries its CCOS term on hover
 * or tap (CcosTerm), the circle card's pattern; without one it is plain words.
 */
export function Eyebrow({ children, gold = false, term = null }: { children: ReactNode; gold?: boolean; term?: string | null }) {
  return (
    <p className={gold ? EYEBROW_GOLD : EYEBROW}>
      <CcosTerm term={term}>{children}</CcosTerm>
    </p>
  );
}

/** Draw a slot: nothing when unread, its words when empty, the value when shown. */
export function SlotView<T>({ slot, children }: { slot: Slot<T>; children: (value: T) => ReactNode }) {
  if (slot.kind === "unread") return null;
  if (slot.kind === "empty") return <p className="text-sm text-muted-foreground">{slot.words}</p>;
  return <>{children(slot.value)}</>;
}

/** A list slot as bullets. */
export function ListSlot({ slot }: { slot: Slot<string[]> }) {
  return (
    <SlotView slot={slot}>
      {(items) => (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {items.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </SlotView>
  );
}

export interface CardEditState {
  /** The owner has "Edit my card" switched on. */
  editing: boolean;
  /** The reader is the card's owner, on their live card: their own controls (the load slider) draw. */
  owner?: boolean;
  /** Read the card again after a save. */
  reload: () => void;
  reviewHref: string | null;
}

export const CardEditContext = createContext<CardEditState>({ editing: false, owner: false, reload: () => undefined, reviewHref: null });

type Target = { kind: "personal"; key: PersonalEditKey; goal?: string } | { kind: "role"; key: RoleEditKey; roleId: string };

/**
 * A role word checked in the browser before it is proposed, by the same
 * function the card's route runs (`roleWordPayload`), so the refusal reads the
 * same as the route's and the draft preview's: the handover words and the
 * CCOS words through their parsers, and 3 to 6 lines of what the role answers
 * for. Null is fine.
 */
export function roleWordProblem(key: RoleEditKey, text: string): string | null {
  const r = roleWordPayload({ key, text });
  return r.ok ? null : r.error;
}

/**
 * The owner's edit control, in place beside a text block. Draws nothing until
 * the owner turns edit mode on. Personal words save to their own record; role
 * words open a proposed change and the block then says it waits for consent.
 */
export function EditInPlace({
  target,
  label,
  initial,
  multiline = true,
  hint,
}: {
  target: Target;
  /** What is being edited, for the control's accessible name. */
  label: string;
  initial: string;
  multiline?: boolean;
  hint?: string;
}) {
  const { editing, reload, reviewHref } = useContext(CardEditContext);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const id = useId();
  if (!editing) return null;

  const save = async () => {
    if (target.kind === "role") {
      const problem = roleWordProblem(target.key, text);
      if (problem) {
        setSaid(problem);
        return;
      }
    }
    setBusy(true);
    const r =
      target.kind === "personal"
        ? await savePersonalWords(target.key, text, { goal: target.goal })
        : await proposeRoleWords(target.roleId, target.key, text);
    setBusy(false);
    if (r.ok) {
      setSaid(target.kind === "personal" ? EDIT_WORDS.saved : EDIT_WORDS.proposed);
      setOpen(false);
      reload();
    } else setSaid(r.error);
  };

  return (
    <div className="mt-2">
      {open ? (
        <div className="grid gap-2">
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
          {target.kind === "role" && <p className="text-xs text-muted-foreground">{EDIT_WORDS.roleWordsNote}</p>}
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          {multiline ? (
            <textarea
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-border bg-card p-3 text-sm text-card-foreground"
            />
          ) : (
            <input
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-card-foreground"
            />
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void save()} className={`${TAP} bg-teal-deep text-white hover:bg-teal-deep-dark`}>
              {target.kind === "personal" ? EDIT_WORDS.save : EDIT_WORDS.proposeChange}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={QUIET_BUTTON}>
              {EDIT_WORDS.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setText(initial); setSaid(null); setOpen(true); }} className={QUIET_BUTTON} aria-label={`${EDIT_WORDS.edit}: ${label}`}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {EDIT_WORDS.edit}
        </button>
      )}
      {said && (
        <p role="status" className="mt-1 text-sm text-card-foreground">
          {said}
          {said === EDIT_WORDS.proposed && reviewHref ? (
            <>
              {" "}
              <Link href={reviewHref} className={LINK}>
                {EDIT_WORDS.seeProposal}
              </Link>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

/** "Proposed, waiting for consent", beside a role word an open draft would change. */
export function PendingNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="mt-1 text-sm font-medium text-notice">{EDIT_WORDS.proposed}</p>;
}
