/**
 * THE ADMIN HELPER PANEL: the village's guide, docked beside Admin.
 *
 * Opened from the "you" menu in the header's corner, or with Ctrl+/ (Cmd+/ on
 * a Mac); AdminHelperHost owns that and lazy-loads this file, so the panel
 * costs the first page nothing. It docks on the right UNDER the sticky header
 * (the host hands it the header's bottom edge as `top`), so it never covers
 * the page name or the corner menu.
 *
 * Three states, and the component test walks each one:
 *   off        the village has not switched the helper on (the dial
 *              `platform.admin_helper`, off by default), or has no key of its
 *              own yet: plain steps for whichever is missing.
 *   ready      a conversation. The guide answers, and may offer a page to open.
 *   proposing  the guide's answer carries ONE change, drawn as a card with the
 *              setting, what it is now and what it would become. Apply calls
 *              the dial's own admin route; Not now drops the card.
 *
 * Paints with the sheet tokens only (bg-card, text-foreground, border-border,
 * bg-muted, bg-primary), so it follows the Admin palette and its night look.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, Loader2, Send, X } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { HelperAnswer, HelperProposal, HelperStatus } from "@shared/adminHelper";
import { guideNameAtSentenceStart } from "@shared/guideName";
import type { NavGroup } from "./adminNavGroups";
import { applyProposal, askHelper, fetchHelperStatus, tabsFromGroups, type HelperLine } from "./adminHelperApi";

type Turn = HelperLine & { answer?: HelperAnswer; applied?: "done" | "dropped"; note?: string };

export default function AdminHelperPanel({
  password,
  groups,
  tab,
  top,
  bottom = 0,
  onClose,
  onOpenTab,
  initialStatus,
}: {
  password: string;
  groups: readonly NavGroup[];
  /** The open admin tab, so the guide knows where the admin is. */
  tab: string;
  /** The header's bottom edge, in pixels: the panel starts below it. */
  top: number;
  /** The phone's bottom bar height, in pixels: the panel stops above it. */
  bottom?: number;
  onClose: () => void;
  onOpenTab: (key: string) => void;
  /** For tests and previews: skip the status fetch. */
  initialStatus?: HelperStatus;
}) {
  const { t } = useLingui();
  const [status, setStatus] = useState<HelperStatus | null>(initialStatus ?? null);
  const [statusError, setStatusError] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialStatus) return;
    const ctrl = new AbortController();
    fetchHelperStatus(password, ctrl.signal)
      .then(setStatus)
      .catch((e) => {
        if (!ctrl.signal.aborted) setStatusError(String(e?.message ?? e));
      });
    return () => ctrl.abort();
  }, [password, initialStatus]);

  useEffect(() => {
    if (status?.on) input.current?.focus();
  }, [status?.on]);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [turns, busy]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const guide = guideNameAtSentenceStart(status?.guide || t({ message: "your village guide", context: "admin helper, unnamed guide" }));

  const send = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const words = draft.trim();
      if (!words || busy) return;
      const next: Turn[] = [...turns, { role: "user", content: words }];
      setTurns(next);
      setDraft("");
      setError("");
      setBusy(true);
      const out = await askHelper(password, {
        messages: next.map(({ role, content }) => ({ role, content })),
        tabs: tabsFromGroups(groups),
        tab,
      });
      setBusy(false);
      if (!out.ok) {
        if (out.off) setStatus((s) => ({ guide: s?.guide ?? "", on: false, off: out.off }));
        else setError(out.error);
        return;
      }
      setTurns([...next, { role: "assistant", content: out.answer.reply, answer: out.answer }]);
    },
    [draft, busy, turns, password, groups, tab],
  );

  const apply = async (index: number, p: HelperProposal) => {
    setApplying(true);
    const out = await applyProposal(password, p);
    setApplying(false);
    setTurns((all) =>
      all.map((turn, i) =>
        i === index
          ? out.ok
            ? { ...turn, applied: "done", note: out.message }
            : { ...turn, note: out.error }
          : turn,
      ),
    );
  };

  const drop = (index: number) => setTurns((all) => all.map((turn, i) => (i === index ? { ...turn, applied: "dropped" } : turn)));

  return (
    <aside
      aria-label={t({ message: `${guide}, your Admin helper`, context: "admin helper panel" })}
      data-testid="admin-helper"
      style={{ top, bottom }}
      className="fixed right-0 z-20 flex w-full flex-col border-l border-border bg-card text-card-foreground shadow-lg sm:w-[26rem]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-semibold text-foreground">{guide}</h2>
          <p className="text-xs text-muted-foreground"><Trans context="admin helper panel">Helps you find things and proposes changes for you to approve.</Trans></p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t({ message: "Close the helper", context: "admin helper panel" })}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {!status && !statusError && (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          <Trans context="admin helper panel">Opening the helper</Trans>
        </div>
      )}
      {statusError && <p role="alert" className="p-4 text-sm text-destructive">{statusError}</p>}

      {status && !status.on && (status.off === "switch" ? <SwitchedOff /> : <ConnectSteps />)}

      {status?.on && (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {turns.length === 0 && (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p><Trans context="admin helper panel">Ask me how to do something in Admin, where a setting lives, or what a control does. If you want something changed, I will show you the change first and you decide.</Trans></p>
                <p><Trans context="admin helper panel">I read settings, help text and the shape of the org chart. I never read applications, proposals, interviews, terms or pay, and I can't help with choosing people for roles. Money stays with you too.</Trans></p>
              </div>
            )}
            {turns.map((turn, i) => (
              <div key={i} className={turn.role === "user" ? "flex justify-end" : ""}>
                <div
                  className={
                    turn.role === "user"
                      ? "max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground"
                      : "max-w-full whitespace-pre-wrap rounded-2xl bg-muted px-3 py-2 text-sm text-foreground"
                  }
                >
                  {turn.content}
                </div>
                {turn.answer?.open && (
                  <button
                    type="button"
                    onClick={() => onOpenTab(turn.answer!.open!.key)}
                    className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <OpenLabel label={turn.answer.open.label} />
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
                {turn.answer?.refused && (
                  <p className="mt-2 text-xs text-muted-foreground">{turn.answer.refused}</p>
                )}
                {turn.answer?.proposal && (
                  <ProposalCard
                    proposal={turn.answer.proposal}
                    state={turn.applied ?? null}
                    note={turn.note ?? ""}
                    busy={applying}
                    onApply={() => apply(i, turn.answer!.proposal!)}
                    onDrop={() => drop(i)}
                  />
                )}
              </div>
            ))}
            {busy && (
              <p className="flex items-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                <Trans context="admin helper panel">{guide} is thinking</Trans>
              </p>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="flex items-end gap-2 border-t border-border p-3">
            <label className="sr-only" htmlFor="admin-helper-input">
              <Trans context="admin helper panel">Your question</Trans>
            </label>
            <textarea
              id="admin-helper-input"
              ref={input}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={t({ message: "How do I…", context: "admin helper, question box placeholder" })}
              className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label={t({ message: "Send", context: "admin helper, sends the question" })}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </>
      )}
    </aside>
  );
}

/** Off by the village's own switch, which ships off. Turning it on is the village's decision. */
function SwitchedOff() {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm text-foreground">
      <h3 className="font-semibold"><Trans context="admin helper panel">Your helper is switched off</Trans></h3>
      <p className="text-muted-foreground">
        <Trans context="admin helper panel">The helper stays off until your village decides to use AI in Admin. Whoever governs that here says yes first.</Trans>
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li><Trans context="admin helper, switch step">Open Game Mechanics and find "The guide's helper in Admin" under Platform.</Trans></li>
        <li><Trans context="admin helper, switch step">Turn it on. It also needs the village's own Anthropic key on the server.</Trans></li>
      </ol>
    </div>
  );
}

/** The off state: what Rye (or any admin with the hosting) does to turn it on. */
function ConnectSteps() {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm text-foreground">
      <h3 className="font-semibold"><Trans context="admin helper panel">Connect Claude to turn on your helper</Trans></h3>
      <p className="text-muted-foreground">
        <Trans context="admin helper panel">The helper runs on Claude, using an Anthropic key that belongs to your village. Nobody can set it from this page, and the key never comes to your browser.</Trans>
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li><Trans context="admin helper, connect step">Sign in at console.anthropic.com and create an API key for the village.</Trans></li>
        <li><Trans context="admin helper, connect step">Open your hosting (Railway), choose the village's service, and open Variables.</Trans></li>
        <li><Trans context="admin helper, connect step">Add a variable named ANTHROPIC_API_KEY and paste the key as its value. Railway restarts the service, which takes roughly two minutes.</Trans></li>
        <li><Trans context="admin helper, connect step">Come back here and open the helper again.</Trans></li>
      </ol>
    </div>
  );
}

function OpenLabel({ label }: { label: string }) {
  return <Trans context="admin helper, opens an admin page">Open {label}</Trans>;
}

function ProposalCard({
  proposal,
  state,
  note,
  busy,
  onApply,
  onDrop,
}: {
  proposal: HelperProposal;
  state: "done" | "dropped" | null;
  note: string;
  busy: boolean;
  onApply: () => void;
  onDrop: () => void;
}) {
  const { t } = useLingui();
  const blank = t({ message: "(blank)", context: "admin helper, proposal: an empty value" });
  if (state === "dropped") {
    return <p className="mt-2 text-xs text-muted-foreground"><Trans context="admin helper, proposal">Left as it was.</Trans></p>;
  }
  return (
    <div data-testid="helper-proposal" className="mt-2 rounded-xl border border-border bg-card p-3 text-sm">
      <p className="text-xs uppercase tracking-wider text-muted-foreground"><Trans context="admin helper, proposal">Proposed change</Trans></p>
      <p className="mt-1 font-semibold text-foreground">{proposal.label}</p>
      <p className="text-xs text-muted-foreground">{proposal.category}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground"><Trans context="admin helper, proposal: current value">Now</Trans></dt>
        <dd className="break-words font-mono text-foreground line-through decoration-muted-foreground">{proposal.from || blank}</dd>
        <dt className="text-muted-foreground"><Trans context="admin helper, proposal: new value">Becomes</Trans></dt>
        <dd className="break-words font-mono font-semibold text-foreground">{proposal.to || blank}</dd>
      </dl>
      {proposal.why && <p className="mt-2 text-muted-foreground">{proposal.why}</p>}
      {state === "done" ? (
        <p className="mt-2 flex items-center gap-1 font-medium text-open">
          <Check className="h-4 w-4" aria-hidden="true" />
          <Trans context="admin helper, proposal">Applied.</Trans> {note}
        </p>
      ) : (
        <>
          {note && <p role="alert" className="mt-2 text-destructive">{note}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onApply}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trans context="admin helper, applies the proposed change">Apply</Trans>
            </button>
            <button
              type="button"
              onClick={onDrop}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trans context="admin helper, declines the proposed change">Not now</Trans>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
