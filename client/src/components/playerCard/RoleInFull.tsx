/**
 * One role in full: its full title first, then its purpose in a highlighted
 * block, then what it decides, what to bring it, what it answers for, how
 * we'll know it's working, who it works with, what is not its to hold, its
 * runbook, its powers, tensions, and how ready it is to hand over: four
 * checks read as "N of 4 ready", never a percentage, the card check listing
 * its five parts from shared/roleHandover.ts underneath.
 *
 * Tensions read as counts in plain words ("1 open tension, private to the
 * role's holders"), with the words only where the server sent them. A member
 * who does not hold the role gets the raise control; the holder's own card
 * links to Waiting on you, where they answer.
 *
 * Role words carry the owner's edit control in edit mode; saving one opens a
 * proposed change that waits for consent. Other roles are named by their full
 * title and nobody but the owner is named anywhere.
 */
import { useContext, useState } from "react";
import { Link } from "wouter";
import { CARD_WORDS as W, type RoleOut } from "@shared/playerCard";
import type { RoleEditKey } from "@shared/playerCardEdit";
import type { SignSheetOut } from "@shared/playerCardPayload";
import { ROLE_HANDOVER_WORDS, runbookIsLink } from "@shared/roleHandover";
import { TASK_BOARD_PATH } from "@shared/sessionTasks";
import RaiseTension from "@/components/roleTension/RaiseTension";
import DecideDoors, { type DecideDoorWords } from "@/components/review/DecideDoors";
import { ROLE_PROPOSAL_WORDS as PW } from "@shared/playerCardProposals";
import { BOX, CardEditContext, EditInPlace, Eyebrow, LINK, ListSlot, PendingNote, SlotView } from "./cardParts";
import { SignList } from "./SignList";

const asText = (slot: { kind: string; value?: unknown }): string =>
  slot.kind !== "shown" ? "" : Array.isArray(slot.value) ? (slot.value as string[]).join("\n") : String(slot.value ?? "");

function RoleWord({
  role,
  k,
  heading,
  children,
  initial,
  hint,
}: {
  role: RoleOut;
  k: RoleEditKey;
  heading: string;
  children: React.ReactNode;
  initial: string;
  hint?: string;
}) {
  return (
    <div className={BOX}>
      <Eyebrow>{heading}</Eyebrow>
      <div className="mt-1">{children}</div>
      <PendingNote show={role.pending.includes(k)} />
      <EditInPlace target={{ kind: "role", key: k, roleId: role.id }} label={`${heading}, ${role.title}`} initial={initial} hint={hint} />
    </div>
  );
}

export function RoleInFull({ role, sheets, timeZone }: { role: RoleOut; sheets: Record<string, SignSheetOut>; timeZone: string }) {
  const headingId = `${role.anchor}-h`;
  // A decided proposal's confirmation, kept here: adopting the last one empties its panel.
  const [decided, setDecided] = useState<string | null>(null);
  return (
    <article id={role.anchor} aria-labelledby={headingId} className="grid scroll-mt-6 gap-4 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-8">
      <h3 id={headingId} className="font-display text-2xl font-bold">
        {role.title}
      </h3>

      <div className="rounded-xl border border-notice/40 border-l-4 border-l-notice bg-card p-4">
        <Eyebrow gold>{role.purpose.heading}</Eyebrow>
        <SlotView slot={role.purpose.text}>{(t) => <p className="mt-1 font-display text-xl">{t}</p>}</SlotView>
        {role.purpose.why ? <p className="mt-2 text-sm text-muted-foreground">{role.purpose.why}</p> : null}
        <PendingNote show={role.pending.includes("purpose")} />
        <EditInPlace target={{ kind: "role", key: "purpose", roleId: role.id }} label={`${role.purpose.heading}, ${role.title}`} initial={asText(role.purpose.text)} />
      </div>

      {role.chips.length || role.circle ? (
        <ul className="flex flex-wrap items-center gap-2" aria-label="About this role">
          {role.circle ? (
            <li>
              {/* The circle this role sits in, linked to that circle's card. */}
              <Link
                href={role.circle.href}
                className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-sm underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
              >
                {role.circle.name}
              </Link>
            </li>
          ) : null}
          {role.chips.map((c) => (
            <li key={c} className="rounded-full border border-border px-3 py-1 text-sm">
              {c}
            </li>
          ))}
        </ul>
      ) : null}
      {role.proposals.length ? (
        <RoleProposals role={role} onDone={setDecided} />
      ) : decided ? (
        <p role="status" className="text-sm font-medium">
          {decided}
        </p>
      ) : null}
      {role.plays ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{role.plays.label}</span>
          {role.plays.chips.map((c) => (
            <span key={c.key} className="rounded-full border border-border px-3 py-1">
              {c.name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <RoleWord role={role} k="decide" heading={role.decide.heading} initial={asText(role.decide.text)}>
          <SlotView slot={role.decide.text}>{(t) => <p className="text-sm">{t}</p>}</SlotView>
        </RoleWord>
        {role.bringMe.items.kind !== "unread" && (
          <RoleWord role={role} k="bringMe" heading={role.bringMe.heading} initial={asText(role.bringMe.items)} hint={ROLE_HANDOVER_WORDS.bringMeHint}>
            <ListSlot slot={role.bringMe.items} />
          </RoleWord>
        )}
      </div>

      <RoleWord role={role} k="countOnMe" heading={role.countOnMe.heading} initial={asText(role.countOnMe.items)}>
        <ListSlot slot={role.countOnMe.items} />
      </RoleWord>

      {role.working.items.kind !== "unread" && (
        <div className="grid gap-2">
          <Eyebrow>{role.working.heading}</Eyebrow>
          <SlotView slot={role.working.items}>{(signs) => <SignList signs={signs} sheets={sheets} timeZone={timeZone} />}</SlotView>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {role.worksWith.items.kind !== "unread" && (
          <div className={BOX}>
            <Eyebrow>{role.worksWith.heading}</Eyebrow>
            <div className="mt-1">
              <ListSlot slot={role.worksWith.items} />
            </div>
          </div>
        )}
        {role.powers.items.kind !== "unread" && (
          <div className={BOX}>
            <Eyebrow>{role.powers.heading}</Eyebrow>
            <div className="mt-1">
              <ListSlot slot={role.powers.items} />
            </div>
          </div>
        )}
      </div>

      {role.notMine.items.kind !== "unread" && (
        <RoleWord role={role} k="notMine" heading={role.notMine.heading} initial={asText(role.notMine.items)} hint={ROLE_HANDOVER_WORDS.notMineHint}>
          <ListSlot slot={role.notMine.items} />
        </RoleWord>
      )}

      {role.runbook.text.kind !== "unread" && (
        <RoleWord role={role} k="runbook" heading={role.runbook.heading} initial={asText(role.runbook.text)} hint={ROLE_HANDOVER_WORDS.runbookHint}>
          <SlotView slot={role.runbook.text}>
            {(t) =>
              runbookIsLink(t) ? (
                <a href={t} target="_blank" rel="noopener noreferrer" className={`${LINK} break-all`}>
                  {t}
                </a>
              ) : (
                <p className="whitespace-pre-line break-words text-sm">{t}</p>
              )
            }
          </SlotView>
        </RoleWord>
      )}

      {role.tensions.kind !== "unread" && (
        <div className={BOX} data-role-tensions={role.id}>
          <Eyebrow>{W.tensions}</Eyebrow>
          <SlotView slot={role.tensions}>
            {(t) => (
              <div className="mt-1 grid gap-2 text-sm">
                <ul className="grid gap-0.5" data-tension-counts>
                  {t.counts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                {t.open.length ? (
                  <ul className="list-disc space-y-1 break-words pl-5" data-tension-words="open">
                    {t.open.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                ) : null}
                {t.public.length ? (
                  <div className="grid gap-1">
                    <p className="text-muted-foreground">{W.tensionsBrought}</p>
                    <ul className="list-disc space-y-1 break-words pl-5" data-tension-words="circle">
                      {t.public.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </SlotView>
          {role.tensionDoor === "waiting" ? (
            <a href={TASK_BOARD_PATH} className={LINK} data-tension-door="waiting">
              {W.tensionsWaiting}
            </a>
          ) : null}
          {role.tensionDoor === "raise" ? <RaiseTension roleId={role.id} roleName={role.title} mayRaise /> : null}
        </div>
      )}

      <div className={BOX}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Eyebrow>{role.handover.heading}</Eyebrow>
          <span className="text-sm font-semibold">{role.handover.summary}</span>
        </div>
        <ul className="mt-2 grid gap-1 text-sm" data-handover-checks>
          {role.handover.checks.map((c) => (
            <li key={c.key} data-check={c.key} data-ready={c.state === "ready" ? "true" : "false"} className="flex items-start gap-2">
              <span aria-hidden="true" className={c.state === "ready" ? "text-notice" : "text-muted-foreground"}>
                {c.state === "ready" ? "✓" : "○"}
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span>
                  <span className="font-medium">{c.label}:</span>{" "}
                  <span className={c.state === "ready" ? "text-card-foreground" : "text-muted-foreground"}>{c.words}</span>
                </span>
                {c.parts ? (
                  <ul className="grid gap-0.5 text-xs text-muted-foreground" data-handover-parts>
                    {c.parts.map((p) => (
                      <li key={p.key} data-done={p.done ? "true" : "false"}>
                        {p.words}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

/** The player card's words for the doors every org draft has. */
const DOOR_WORDS: DecideDoorWords = {
  adopt: PW.adopt,
  adoptConfirm: PW.adoptConfirm,
  adoptYes: PW.adoptYes,
  putToVillage: PW.putToVillage,
  putConfirm: PW.putConfirm,
  putYes: PW.putYes,
  voting: PW.voting,
  waitingHolder: PW.waitingHolder,
  waitingVillage: PW.waitingVillage,
  blocked: PW.blocked,
  adopted: PW.adopted,
  putDone: PW.putDone,
  cancel: PW.cancel,
  failed: PW.failed,
};

/**
 * The open proposals for this role's words, each with the words it would put
 * live and the doors that adopt it. A draft opened from a card is listed on no
 * review page, so the role's own section is where it is decided.
 */
function RoleProposals({ role, onDone }: { role: RoleOut; onDone: (said: string) => void }) {
  const { reload } = useContext(CardEditContext);
  return (
    <div className={`${BOX} grid gap-3`} data-role-proposals={role.id}>
      <Eyebrow gold>{PW.heading}</Eyebrow>
      {role.proposals.map((p) => (
        <div key={p.draftId} className="grid gap-2">
          <p className="text-xs text-muted-foreground">{p.proposedOn}</p>
          {p.fields.map((f) => (
            <div key={f.key} className="grid gap-1">
              <p className="text-sm font-semibold">{f.label}</p>
              {f.lines.length ? (
                <ul className="list-disc space-y-1 break-words pl-5 text-sm">
                  {f.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{PW.clears}</p>
              )}
            </div>
          ))}
          <DecideDoors draftId={p.draftId} reload={reload} words={DOOR_WORDS} onDone={onDone} />
        </div>
      ))}
    </div>
  );
}
