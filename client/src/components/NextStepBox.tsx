/**
 * THE NEXT-STEP BOX, shown under the claim button once a member has taken a
 * quest: who to talk to, the first task, the crew link and the date.
 *
 * It reads `GET /api/game/quests/:id/next`, so it is there after a reload, a
 * lost reply on a weak signal, or a tap on the claim bell. Every part has an
 * honest empty state and nothing here invents a person or a date: the server
 * sends structured parts (shared/questNextStep.ts) and this only words them.
 *
 * The talk-to line is "Role (FirstName)", read live (III.2). A role nobody
 * holds says so and points at the roles page instead of at a person.
 *
 * Born in Lingui, so the box reads in the member's language from day one.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { CalendarDays, Footprints, MessageCircle, Users } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { gameFetch } from "@/lib/gameApi";
import { formatDate } from "@/i18n/format";
import { roleWithHolders } from "@shared/roleHolderLabel";
import type { ResolvedNextStep } from "@shared/questNextStep";

export function NextStepParts({ next, questId }: { next: ResolvedNextStep; questId: string }) {
  const { t } = useLingui();
  const live = next.talkToLive;

  let talk: React.ReactNode;
  if (next.talkTo.kind === "role") {
    const role = live?.roleName ?? t({ message: "the circle's lead role", context: "next step box, a role whose name could not be read" });
    if (next.talkTo.vacant) {
      talk = (
        <>
          <Trans context="next step box">Nobody holds {role} yet.</Trans>{" "}
          <Link href="/roles" className="underline text-teal-deep">
            <Trans context="next step box, link to open roles">See the open roles</Trans>
          </Link>
        </>
      );
    } else {
      const label = roleWithHolders(role, live?.holders ?? []);
      talk = <Trans context="next step box">Talk to {label}</Trans>;
    }
  } else if (next.talkTo.kind === "circle") {
    const circle = live?.circleName ?? t({ message: "this quest's circle", context: "next step box" });
    talk = <Trans context="next step box">Ask in {circle}</Trans>;
  } else {
    talk = <Trans context="next step box, nobody named on the quest">Ask in the quest chat below</Trans>;
  }

  const task =
    next.firstTask.kind === "step" ? (
      next.firstTask.text
    ) : (
      <Trans context="next step box, the quest has no first step written">Read the quest above, then start with the first thing you can do today</Trans>
    );

  let crew: React.ReactNode = null;
  if (next.crew.kind === "invite") {
    const size = next.crew.size;
    crew = (
      <>
        <Trans context="next step box">Your crew has {size} so far.</Trans>{" "}
        <CopyLink path={next.crew.path} />
      </>
    );
  } else if (next.crew.kind === "start") {
    crew = (
      <a href={`/quests/${encodeURIComponent(questId)}#quest-crews`} className="underline text-teal-deep">
        <Trans context="next step box, start a crew for this quest">Start a crew and invite friends</Trans>
      </a>
    );
  }

  let when: React.ReactNode;
  if (next.when.kind === "date") {
    const at = formatDate(new Date(next.when.at), { dateStyle: "full", timeStyle: "short" });
    when =
      next.when.source === "due" ? (
        <Trans context="next step box, the deadline">Due by {at}</Trans>
      ) : next.when.source === "build_day" ? (
        <Trans context="next step box, the next build day">Next build day: {at}</Trans>
      ) : (
        <Trans context="next step box, when the quest starts">Starts {at}</Trans>
      );
  } else {
    when = <Trans context="next step box, no date on the quest">No date yet. Agree one when you talk.</Trans>;
  }

  return (
    <ul className="space-y-2.5 text-sm">
      <li className="flex gap-2.5 items-start">
        <MessageCircle className="w-4 h-4 mt-0.5 shrink-0 text-teal-deep" aria-hidden="true" />
        <span className="min-w-0 break-words">{talk}</span>
      </li>
      <li className="flex gap-2.5 items-start">
        <Footprints className="w-4 h-4 mt-0.5 shrink-0 text-teal-deep" aria-hidden="true" />
        <span className="min-w-0 break-words">
          <span className="font-semibold"><Trans context="next step box, label before the first task">First:</Trans></span> {task}
        </span>
      </li>
      {crew && (
        <li className="flex gap-2.5 items-start">
          <Users className="w-4 h-4 mt-0.5 shrink-0 text-teal-deep" aria-hidden="true" />
          <span className="min-w-0 break-words">{crew}</span>
        </li>
      )}
      <li className="flex gap-2.5 items-start">
        <CalendarDays className="w-4 h-4 mt-0.5 shrink-0 text-teal-deep" aria-hidden="true" />
        <span className="min-w-0 break-words">{when}</span>
      </li>
    </ul>
  );
}

function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" onClick={copy} className="underline text-teal-deep min-h-[44px] sm:min-h-0">
      {copied ? <Trans context="next step box, after copying the crew link">Link copied</Trans> : <Trans context="next step box, copy the crew invite link">Copy the crew link</Trans>}
    </button>
  );
}

export default function NextStepBox({ questId, claimStatus }: { questId: string; claimStatus: string | undefined }) {
  const [next, setNext] = useState<ResolvedNextStep | null>(null);
  const live = claimStatus === "claimed" || claimStatus === "submitted";
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!live) {
      setNext(null);
      return;
    }
    let gone = false;
    gameFetch(`/api/game/quests/${encodeURIComponent(questId)}/next`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!gone) setNext(d?.next ?? null);
      })
      .catch(() => {
        if (!gone) setNext(null);
      });
    return () => {
      gone = true;
    };
  }, [questId, live]);

  if (!live || !next) return null;
  return (
    <section
      aria-labelledby="next-step-heading"
      role="status"
      aria-live="polite"
      className="mx-6 mb-4 rounded-xl border border-teal-deep/30 bg-teal-deep/5 p-4"
    >
      <h3 id="next-step-heading" ref={heading} tabIndex={-1} className="font-semibold text-foreground mb-2.5">
        <Trans context="next step box heading">Your next step</Trans>
      </h3>
      <NextStepParts next={next} questId={questId} />
    </section>
  );
}
