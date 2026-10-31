/**
 * The small parts every section of the player card draws with: the eyebrow, a
 * slot (unread draws nothing, empty draws its words), a list, and the owner's
 * in-place edit control, all in the approved design's own marks
 * (playerCard.css, the `pc-` classes).
 *
 * The card is a theme-frozen night surface: every colour comes from the
 * `.pc-night` tokens in playerCard.css, and no component writes one.
 *
 * `TAP` and `QUIET_BUTTON` stay Tailwind strings on the semantic tokens,
 * because the decide doors (client/src/components/review/DecideDoors.tsx)
 * draw with them wherever they are mounted; inside the card those tokens read
 * the night palette.
 */
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import type { Slot } from "@shared/playerCard";
import { EDIT_WORDS, roleWordPayload, type PersonalEditKey, type RoleEditKey } from "@shared/playerCardEdit";
import { proposeRoleWords, savePersonalWords } from "./playerCardApi";
import { CardTerm } from "./CcosTerm";

export const TAP =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring";
export const QUIET_BUTTON = `${TAP} border border-border text-card-foreground hover:bg-muted`;

/*
 * The circle card's frame (client/src/components/circleCard/), in the app's
 * semantic tokens. The player card no longer draws with these: it draws the
 * approved design's own marks. They stay here, unchanged, because the circle
 * card imports them from this file.
 */
export const SECTION = "rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-8";
export const BOX = "rounded-xl border border-border/70 p-4";
export const EYEBROW = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
export const EYEBROW_GOLD = "text-xs font-semibold uppercase tracking-wide text-notice";
export const H2 = "font-display text-2xl font-bold text-card-foreground";
export const LINK = "inline-flex min-h-11 items-center text-sm font-medium text-notice underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring";

/**
 * A section's small heading. With a `term` it carries its CCOS term on hover
 * or tap (CardTerm, the design's dotted underline); without one it is plain words.
 */
export function Eyebrow({ children, gold = false, term = null, className = "" }: { children: ReactNode; gold?: boolean; term?: string | null; className?: string }) {
  return (
    <p className={`pc-eyebrow${gold ? " pc-gold" : ""}${className ? ` ${className}` : ""}`}>
      <CardTerm term={term}>{children}</CardTerm>
    </p>
  );
}

/**
 * True inside the player card's night: a slot's empty words take the design's
 * dim line there, and the app's muted line anywhere else that draws a slot
 * (the circle card).
 */
export const NightContext = createContext(false);

/** Draw a slot: nothing when unread, its words when empty, the value when shown. */
export function SlotView<T>({ slot, children }: { slot: Slot<T>; children: (value: T) => ReactNode }) {
  const night = useContext(NightContext);
  if (slot.kind === "unread") return null;
  if (slot.kind === "empty") return <p className={night ? "pc-dim pc-f14" : "text-sm text-muted-foreground"}>{slot.words}</p>;
  return <>{children(slot.value)}</>;
}

/** A list slot as the design's bullets. */
export function ListSlot({ slot }: { slot: Slot<string[]> }) {
  return (
    <SlotView slot={slot}>
      {(items) => (
        <ul className="pc-list">
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
}

export const CardEditContext = createContext<CardEditState>({ editing: false, owner: false, reload: () => undefined });

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
  const { editing, reload } = useContext(CardEditContext);
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
      setSaid(target.kind === "personal" ? EDIT_WORDS.saved : EDIT_WORDS.sent);
      setOpen(false);
      reload();
    } else setSaid(r.error);
  };

  return (
    <div className="pc-edit">
      {open ? (
        <>
          <label htmlFor={id}>{label}</label>
          {target.kind === "role" && <p className="pc-note">{EDIT_WORDS.roleWordsNote}</p>}
          {hint && <p className="pc-note">{hint}</p>}
          {multiline ? (
            <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={4} />
          ) : (
            <input id={id} value={text} onChange={(e) => setText(e.target.value)} />
          )}
          <div className="pc-btnrow">
            <button type="button" disabled={busy} onClick={() => void save()} className="pc-btn">
              {target.kind === "personal" ? EDIT_WORDS.save : EDIT_WORDS.proposeChange}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="pc-tab">
              {EDIT_WORDS.cancel}
            </button>
          </div>
        </>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              setText(initial);
              setSaid(null);
              setOpen(true);
            }}
            className="pc-tab"
            aria-label={`${EDIT_WORDS.edit}: ${label}`}
          >
            <Pencil aria-hidden="true" />
            {EDIT_WORDS.edit}
          </button>
        </div>
      )}
      {said && (
        <p role="status" className="pc-said">
          {said}
        </p>
      )}
    </div>
  );
}

/**
 * A ROLE PROPOSAL'S CHANGED WORDS, drawn in gold (role proposals PR C). The
 * proposal steps hand the card, per role, the sections whose words differ
 * from the posted role, or mark the role new; each such section says so in
 * the design's gold. Absent, nothing is marked.
 */
export interface ChangedWords {
  keys: readonly RoleEditKey[];
  isNew: boolean;
}

export const CHANGED_WORDS = { changed: "Changed from the posted role", isNew: "New" } as const;

export const ChangedContext = createContext<ChangedWords | null>(null);

/** Whether a section is changed (or new) in these changed words. Pure, so a list can ask it per item. */
export function isChanged(c: ChangedWords | null, k: RoleEditKey): boolean {
  return !!c && (c.isNew || c.keys.includes(k));
}

/** Whether this role's section is changed (or new) in the proposal being drawn. */
export function useChanged(k: RoleEditKey): boolean {
  return isChanged(useContext(ChangedContext), k);
}

/** The gold frame a changed section takes, or nothing: the design's gold edge on the night (playerCard.css `.pc-changed`). */
export const GOLD_FRAME = "pc-changed";

/** "Changed from the posted role", or "New", under a changed section's heading. */
export function ChangedMark({ k }: { k: RoleEditKey }) {
  const c = useContext(ChangedContext);
  if (!c || !(c.isNew || c.keys.includes(k))) return null;
  return (
    <p className="pc-changedmark" data-changed-mark={k}>
      {c.isNew ? CHANGED_WORDS.isNew : CHANGED_WORDS.changed}
    </p>
  );
}

/** "Proposed, waiting for consent", beside a role word an open draft would change. */
export function PendingNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="pc-pending">{EDIT_WORDS.proposed}</p>;
}
