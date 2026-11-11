/**
 * "ASK SERA FOR A FIRST DRAFT": the button and the mark (joining lane PR 5).
 *
 *   AskSera     the explicit button for one part (the aim, the goals or the
 *               story line). Drawn only for somebody signed in with a guide
 *               that can answer: a visitor with no account has no guide to
 *               ask, and the form works without it. It says who answers and
 *               exactly what goes: the roles, "Why you" and the aim. Nothing
 *               is sent until it is pressed.
 *   DraftMark   the "Draft from Sera" chip with "Keep this", on a draft until
 *               the person edits it or keeps it.
 *
 * The page owns where a draft goes and what marks it (shared/seraDrafts.ts).
 */
import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Sparkles } from "lucide-react";
import { useOptionalAuth } from "@/contexts/AuthContext";
import { fetchGuide } from "@/lib/guideApi";
import { askForDraft } from "@/lib/seraDraftApi";
import { draftBody, type DraftKind, type DraftReply, type DraftRoleIn } from "@shared/seraDrafts";

const BTN =
  "inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Who would answer, or null: signed out, or no guide can answer. */
function useAnsweringGuide(): string | null {
  const signedIn = !!useOptionalAuth()?.user;
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) return setName(null);
    let alive = true;
    void fetchGuide().then((g) => {
      if (alive) setName(g?.options?.find((o) => o.id === g.answering)?.name ?? null);
    });
    return () => {
      alive = false;
    };
  }, [signedIn]);
  return name;
}

export function AskSera({
  kind,
  roles,
  why,
  aim,
  onDraft,
  disabled,
}: {
  kind: DraftKind;
  roles: readonly DraftRoleIn[];
  why: string;
  aim: string;
  onDraft: (reply: DraftReply) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const name = useAnsweringGuide();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  if (!name) return null;

  const press = async () => {
    setBusy(true);
    setSaid(null);
    const r = await askForDraft(draftBody(kind, { roles, why, aim }));
    setBusy(false);
    if (!r.ok) return setSaid(r.error);
    const empty = (r.reply.kind === "aim" && !r.reply.aim) || (r.reply.kind === "story" && !r.reply.story) || (r.reply.kind === "goals" && !r.reply.goals?.length);
    if (empty) return setSaid(t`There is not enough of your own writing to draft from yet. Add a few lines to "Why you" and try again.`);
    onDraft(r.reply);
  };

  const what = kind === "aim" ? t`a draft of your aim` : kind === "goals" ? t`three draft goals for your first moon` : t`a draft of your story line`;
  return (
    <div className="grid gap-1.5" data-ask-sera={kind}>
      <div>
        <button type="button" className={BTN} disabled={busy || disabled} onClick={() => void press()} aria-describedby={`ask-sera-${kind}-sends`}>
          <Sparkles className="size-4" aria-hidden="true" />
          {/* Phase A, build list section 3: the line the visionary asked for, in place of "Ask Sera for a first draft". */}
          {t`Get help drafting from ${name}, our regeneratively trained digital assistant`}
        </button>
      </div>
      <p id={`ask-sera-${kind}-sends`} className="text-xs text-muted-foreground">
        {t`This asks ${name} for ${what}. It sends the roles you picked, your "Why you" and your aim, and nothing else: not your references, links, files, name or email. Nothing is sent until you press it.`}
      </p>
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {t`${name} is writing a first draft. You can keep going while you wait.`}
        </p>
      )}
      {said && (
        <p role="alert" className="text-sm text-muted-foreground" data-ask-sera-said="">
          {said}
        </p>
      )}
    </div>
  );
}

/** The mark on a draft until it is edited or kept. */
export function DraftMark({ onKeep }: { onKeep: () => void }) {
  const { t } = useLingui();
  const name = useAnsweringGuide();
  return (
    <div className="grid gap-1.5 rounded-lg border border-border bg-muted/60 p-2 text-sm" data-sera-draft="">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-foreground">{name && name !== "Sera" ? t({ message: `Draft from ${name}`, context: "sera draft mark" }) : t({ message: "Draft from Sera", context: "sera draft mark" })}</span>
        <button type="button" className={`${BTN} min-h-11`} onClick={onKeep}>
          {t({ message: "Keep this", context: "sera draft mark" })}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t`Edit it or keep it. We cannot send your proposal until you have done one or the other.`}</p>
    </div>
  );
}
