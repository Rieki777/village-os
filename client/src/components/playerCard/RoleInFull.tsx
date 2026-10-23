/**
 * One role in full, in the order of the approved CCOS card
 * (https://claude.ai/artifact/XGP6VP5WFU1T6ti7RD482P, Rye 2026-10-22): its
 * full title; its chips (key role, circle, held until, the review week, the
 * time chip); its purpose in a highlighted block, with "This role exists
 * while" inside it; "What I look after" and "What I can decide on my own" in
 * one box beside "Bring me"; what you can count on it for; what it does
 * regularly; how we'll know it's working; who it works with and its powers;
 * "Holding this role well"; what is not its to hold; its runbook; tensions;
 * and how ready it is to hand over: four checks read as "N of 4 ready", never
 * a percentage, the card check listing its five parts from
 * shared/roleHandover.ts underneath. The CCOS words never count toward it.
 *
 * Plain headings, each with its CCOS term on hover or tap where the village
 * shows the terms (CcosTerm, the circle card's pattern).
 *
 * NOTHING EXTRA FOR A ROLE THAT HAS NONE OF THE CCOS WORDS. Each of them draws
 * only once it is written, so no empty box appears. In "Edit my card" an
 * unwritten one draws with its "Not written yet" and its edit control, so the
 * owner can propose words for it.
 *
 * Tensions read as counts in plain words ("1 open tension, private to the
 * role's holders"), with the words only where the server sent them. A member
 * who does not hold the role gets the raise control; the holder's own card
 * links to Waiting on you, where they answer.
 *
 * Role words carry the owner's edit control in edit mode; saving one opens a
 * proposed change that waits for consent. Other roles are named by their full
 * title and nobody but the owner is named anywhere.
 *
 * Phone first: one column at 375px, every control at least 44px, long words
 * wrap, and nothing is wider than the screen.
 */
import { useContext } from "react";
import { CARD_WORDS as W, type RoleOut, type Slot } from "@shared/playerCard";
import type { RoleEditKey } from "@shared/playerCardEdit";
import type { SignSheetOut } from "@shared/playerCardPayload";
import { ROLE_HANDOVER_WORDS, runbookIsLink } from "@shared/roleHandover";
import { ROLE_CCOS_WORDS } from "@shared/roleCcos";
import type { HoldingKey } from "@shared/playerCardCcos";
import { TASK_BOARD_PATH } from "@shared/sessionTasks";
import RaiseTension from "@/components/roleTension/RaiseTension";
import { BOX, CardEditContext, EditInPlace, Eyebrow, LINK, ListSlot, PendingNote, SlotView } from "./cardParts";
import { CcosTerm, INLINE_TAP } from "./CcosTerm";
import { SignList } from "./SignList";

/** The hint under each "Holding this role well" line's edit control. */
const HOLDING_HINTS: Record<HoldingKey, string> = {
  signsStretched: ROLE_CCOS_WORDS.signsStretchedHint,
  flowsBack: ROLE_CCOS_WORDS.flowsBackHint,
  stepBack: ROLE_CCOS_WORDS.stepBackHint,
};

const asText = (slot: { kind: string; value?: unknown }): string =>
  slot.kind !== "shown" ? "" : Array.isArray(slot.value) ? (slot.value as string[]).join("\n") : String(slot.value ?? "");

/** One role word: its heading, its words, the pending note and the owner's edit control. */
function Part({
  role,
  k,
  heading,
  term = null,
  children,
  initial,
  hint,
  multiline = true,
}: {
  role: RoleOut;
  k: RoleEditKey;
  heading: string;
  term?: string | null;
  children: React.ReactNode;
  initial: string;
  hint?: string;
  multiline?: boolean;
}) {
  return (
    <>
      <Eyebrow term={term}>{heading}</Eyebrow>
      <div className="mt-1 min-w-0 break-words">{children}</div>
      <PendingNote show={role.pending.includes(k)} />
      <EditInPlace target={{ kind: "role", key: k, roleId: role.id }} label={`${heading}, ${role.title}`} initial={initial} hint={hint} multiline={multiline} />
    </>
  );
}

function RoleWord(props: React.ComponentProps<typeof Part>) {
  return (
    <div className={`${BOX} min-w-0`} data-role-section={props.k}>
      <Part {...props} />
    </div>
  );
}

export function RoleInFull({ role, sheets, timeZone }: { role: RoleOut; sheets: Record<string, SignSheetOut>; timeZone: string }) {
  const { editing } = useContext(CardEditContext);
  /** A CCOS section draws once it is written, or in edit mode so the owner can propose words for it. */
  const draws = (slot: Slot<unknown>): boolean => slot.kind === "shown" || (slot.kind === "empty" && editing);
  const headingId = `${role.anchor}-h`;
  const time = role.time.text;
  const exists = role.existsWhile.text;
  const holding = role.holdingWell.parts.filter((p) => draws(p.text));
  return (
    <article id={role.anchor} aria-labelledby={headingId} className="grid min-w-0 scroll-mt-6 gap-4 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-8">
      <h3 id={headingId} className="font-display text-2xl font-bold break-words">
        {role.title}
      </h3>

      {role.chips.length || time.kind === "shown" ? (
        <ul className="flex flex-wrap gap-2" aria-label="About this role">
          {role.chips.map((c) => (
            <li key={c} className="rounded-full border border-border px-3 py-1 text-sm">
              {c}
            </li>
          ))}
          {time.kind === "shown" ? (
            <li className="rounded-full border border-border px-3 py-1 text-sm" data-role-chip="time">
              <CcosTerm term={role.time.term} tap={INLINE_TAP}>
                {time.value}
              </CcosTerm>
            </li>
          ) : null}
        </ul>
      ) : null}
      {editing && time.kind !== "unread" ? (
        <div data-role-section="timeCommitment">
          {time.kind === "empty" ? (
            <p className="text-sm text-muted-foreground">
              {role.time.heading}: {time.words}
            </p>
          ) : null}
          <PendingNote show={role.pending.includes("timeCommitment")} />
          <EditInPlace
            target={{ kind: "role", key: "timeCommitment", roleId: role.id }}
            label={`${role.time.heading}, ${role.title}`}
            initial={asText(time)}
            hint={ROLE_CCOS_WORDS.timeCommitmentHint}
            multiline={false}
          />
        </div>
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

      <div className="min-w-0 rounded-xl border border-notice/40 border-l-4 border-l-notice bg-card p-4">
        <Eyebrow gold term={role.purpose.term}>
          {role.purpose.heading}
        </Eyebrow>
        <SlotView slot={role.purpose.text}>{(t) => <p className="mt-1 font-display text-xl break-words">{t}</p>}</SlotView>
        {role.purpose.why ? <p className="mt-2 text-sm text-muted-foreground">{role.purpose.why}</p> : null}
        <PendingNote show={role.pending.includes("purpose")} />
        <EditInPlace target={{ kind: "role", key: "purpose", roleId: role.id }} label={`${role.purpose.heading}, ${role.title}`} initial={asText(role.purpose.text)} />
        {draws(exists) ? (
          <div className="mt-3" data-role-section="existsWhile">
            <p className="text-sm text-muted-foreground break-words">
              <span className="font-semibold text-notice">
                <CcosTerm term={role.existsWhile.term} tap={INLINE_TAP}>
                  {role.existsWhile.heading}
                </CcosTerm>
              </span>
              {exists.kind === "shown" ? ` ${exists.value}` : exists.kind === "empty" ? `: ${exists.words}` : null}
            </p>
            <PendingNote show={role.pending.includes("existsWhile")} />
            <EditInPlace
              target={{ kind: "role", key: "existsWhile", roleId: role.id }}
              label={`${role.existsWhile.heading}, ${role.title}`}
              initial={asText(exists)}
              hint={ROLE_CCOS_WORDS.existsWhileHint}
              multiline={false}
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={`${BOX} min-w-0`} data-role-section="decide">
          <Part role={role} k="decide" heading={role.decide.heading} term={role.decide.term} initial={asText(role.decide.text)}>
            <SlotView slot={role.decide.text}>{(t) => <p className="text-sm">{t}</p>}</SlotView>
          </Part>
          {draws(role.authorities.items) ? (
            <div className="mt-4" data-role-section="authorities">
              <Part
                role={role}
                k="authorities"
                heading={role.authorities.heading}
                term={role.authorities.term}
                initial={asText(role.authorities.items)}
                hint={ROLE_CCOS_WORDS.authoritiesHint}
              >
                <ListSlot slot={role.authorities.items} />
              </Part>
            </div>
          ) : null}
        </div>
        {role.bringMe.items.kind !== "unread" && (
          <RoleWord role={role} k="bringMe" heading={role.bringMe.heading} initial={asText(role.bringMe.items)} hint={ROLE_HANDOVER_WORDS.bringMeHint}>
            <ListSlot slot={role.bringMe.items} />
          </RoleWord>
        )}
      </div>

      <RoleWord role={role} k="countOnMe" heading={role.countOnMe.heading} term={role.countOnMe.term} initial={asText(role.countOnMe.items)}>
        <ListSlot slot={role.countOnMe.items} />
      </RoleWord>

      {draws(role.responsibilities.items) ? (
        <RoleWord
          role={role}
          k="responsibilities"
          heading={role.responsibilities.heading}
          term={role.responsibilities.term}
          initial={asText(role.responsibilities.items)}
          hint={ROLE_CCOS_WORDS.responsibilitiesHint}
        >
          <ListSlot slot={role.responsibilities.items} />
        </RoleWord>
      ) : null}

      {role.working.items.kind !== "unread" && (
        <div className="grid min-w-0 gap-2">
          <Eyebrow term={role.working.term}>{role.working.heading}</Eyebrow>
          <SlotView slot={role.working.items}>{(signs) => <SignList signs={signs} sheets={sheets} timeZone={timeZone} />}</SlotView>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {role.worksWith.items.kind !== "unread" && (
          <div className={`${BOX} min-w-0`}>
            <Eyebrow>{role.worksWith.heading}</Eyebrow>
            <div className="mt-1">
              <ListSlot slot={role.worksWith.items} />
            </div>
          </div>
        )}
        {role.powers.items.kind !== "unread" && (
          <div className={`${BOX} min-w-0`}>
            <Eyebrow>{role.powers.heading}</Eyebrow>
            <div className="mt-1">
              <ListSlot slot={role.powers.items} />
            </div>
          </div>
        )}
      </div>

      {holding.length ? (
        <div className={`${BOX} min-w-0`} data-role-section="holdingWell">
          <Eyebrow gold>{role.holdingWell.heading}</Eyebrow>
          <div className="mt-2 grid gap-4 md:grid-cols-3">
            {holding.map((p) => (
              <div key={p.key} className="min-w-0" data-holding={p.key}>
                <p className="text-sm font-semibold">
                  <CcosTerm term={p.term} tap={INLINE_TAP}>
                    {p.heading}
                  </CcosTerm>
                </p>
                <SlotView slot={p.text}>{(t) => <p className="mt-1 whitespace-pre-line break-words text-sm text-muted-foreground">{t}</p>}</SlotView>
                <PendingNote show={role.pending.includes(p.key)} />
                <EditInPlace
                  target={{ kind: "role", key: p.key, roleId: role.id }}
                  label={`${p.heading}, ${role.title}`}
                  initial={asText(p.text)}
                  hint={HOLDING_HINTS[p.key]}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {role.notMine.items.kind !== "unread" && (
        <RoleWord
          role={role}
          k="notMine"
          heading={role.notMine.heading}
          term={role.notMine.term}
          initial={asText(role.notMine.items)}
          hint={ROLE_HANDOVER_WORDS.notMineHint}
        >
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
