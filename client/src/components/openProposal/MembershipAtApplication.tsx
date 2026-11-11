/**
 * MEMBERSHIP AT APPLICATION, ON THE OPEN FORM (role journey L7, Rye's answer 8).
 *
 * The applicant reads the village's membership letter here and aligns with it
 * when they apply. The form sends back the version of the letter it drew
 * (`membership.letterVersion`), and the server records the alignment against
 * the address once it confirms, then carries it to the account at sign-up
 * (server/lib/applicationMembership.ts), so nobody is asked twice.
 *
 * A signed-in member already aligned with the letter is told so and asked
 * nothing. No payment is asked: the letter's suggested contribution stays a
 * paragraph in the letter, and this block says so.
 */
import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ALIGN_WORDS } from "@shared/alignments";
import type { ServedLetter } from "@shared/membershipLetter";
import { fetchMyAlignments } from "@/components/alignment/alignmentsApi";

export type MembershipChoice =
  /** Still reading, or the letter could not be read. */
  | { kind: "none" }
  /** Aligned on the form, with this version of the letter. */
  | { kind: "aligned"; letterVersion: string }
  /** Already aligned from their account: nothing to send. */
  | { kind: "member" };

export function MembershipAtApplication({
  signedIn,
  choice,
  onChoice,
  refreshKey = 0,
}: {
  signedIn: boolean;
  choice: MembershipChoice;
  onChoice: (next: MembershipChoice) => void;
  /** Bumped by the form when the server said the letter changed, so it is read again. */
  refreshKey?: number;
}) {
  const { t } = useLingui();
  const [letter, setLetter] = useState<ServedLetter | null>(null);
  const [failed, setFailed] = useState(false);
  const [member, setMember] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    fetch("/api/membership-letter")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ServedLetter) => {
        if (!alive) return;
        setLetter(d);
        // A version the form held before the letter changed is not the one on screen now.
        if (choice.kind === "aligned" && choice.letterVersion !== d.version) onChoice({ kind: "none" });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void fetchMyAlignments().then((a) => {
      if (!alive || !a.ok) return;
      const holds = (a.data.alignments ?? []).some((x) => x.kind === "membership" && x.state === "in-force");
      if (holds) {
        setMember(true);
        onChoice({ kind: "member" });
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  if (member) {
    return (
      <p data-membership="member" className="text-sm text-foreground">
        {t`You are already aligned with the village's membership letter, so there is nothing to do here.`}
      </p>
    );
  }
  if (failed) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t`The membership letter didn't load. Reload the page to read it and align.`}
      </p>
    );
  }
  if (!letter) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t`Loading the membership letter...`}
      </p>
    );
  }
  const title = letter.title;
  return (
    <div data-membership="ask" className="grid gap-2">
      <details className="rounded-lg border border-border bg-background p-3 text-sm text-foreground">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">{t({ message: `Read the ${title}`, context: "membership letter on the open form" })}</summary>
        <div className="mt-2 whitespace-pre-line break-words">{letter.body}</div>
      </details>
      <label className="flex min-h-11 items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          required
          className="mt-0.5 size-5 shrink-0 accent-notice"
          checked={choice.kind === "aligned"}
          onChange={(e) => onChoice(e.target.checked ? { kind: "aligned", letterVersion: letter.version } : { kind: "none" })}
        />
        {letter.intent}
      </label>
      <p className="text-xs text-muted-foreground">
        {ALIGN_WORDS.waysOfSigning} {t`It takes effect once you confirm your address, and you won't be asked again when you make your account. No payment is asked: any contribution the letter suggests stays your choice.`}
      </p>
    </div>
  );
}
