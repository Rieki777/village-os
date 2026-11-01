/**
 * One role in full, as the approved CCOS card draws it
 * (https://claude.ai/artifact/XGP6VP5WFU1T6ti7RD482P, Rye 2026-10-22, the
 * `.rolecard`): its full title; its chips (key role, circle, held until, the
 * review week, the time chip, and any power it holds, in green); its purpose
 * in the highlighted gold block, with "This role exists while" inside it;
 * "What I look after" and "What I can decide on my own" in one box beside
 * "Bring me"; what you can count on it for; what it does regularly; how we'll
 * know it's working beside who it works closely with; "Holding this role
 * well" in three columns; and what is not its to hold.
 *
 * The live parts the design's page did not draw follow, in the design's own
 * boxes: the role's health in words under its chips, the open proposals for
 * its words with the doors that adopt them (#574), its runbook, the tensions
 * raised to it, and how ready it is to hand over: four checks read as "N of 4
 * ready", never a percentage, the card check listing its five parts from
 * shared/roleHandover.ts. The CCOS words never count toward it.
 *
 * Each heading carries its CCOS term on hover or tap, the design's dotted
 * underline, where the village shows the terms (`org.ccos_terms`).
 *
 * NOTHING EXTRA FOR A ROLE THAT HAS NONE OF THE CCOS WORDS. Each draws only
 * once it is written, so no empty box appears. In "Edit my card" an unwritten
 * one draws with its "Not written yet" and its edit control, so the owner can
 * propose words for it. Role words change by consent: saving one opens a
 * proposed change, and a role proposal's changed words are framed in gold.
 *
 * Phone first: the design's own breakpoints, one column at 375px, every
 * control at least 44px, long words wrap, nothing wider than the screen.
 */
import { useContext, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { CARD_WORDS as W, type RoleOut, type Slot } from "@shared/playerCard";
import type { RoleEditKey } from "@shared/playerCardEdit";
import type { HealthOut } from "@shared/playerCardHealth";
import { ROLE_HANDOVER_WORDS, runbookIsLink } from "@shared/roleHandover";
import { ROLE_CCOS_WORDS } from "@shared/roleCcos";
import type { HoldingKey } from "@shared/playerCardCcos";
import { TASK_BOARD_PATH } from "@shared/sessionTasks";
import RaiseTension from "@/components/roleTension/RaiseTension";
import DecideDoors, { type DecideDoorWords } from "@/components/review/DecideDoors";
import { ROLE_PROPOSAL_WORDS as PW } from "@shared/playerCardProposals";
import { CardEditContext, ChangedContext, ChangedMark, EditInPlace, Eyebrow, GOLD_FRAME, isChanged, ListSlot, PendingNote, SlotView, useChanged } from "./cardParts";
import { CardTerm } from "./CcosTerm";

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
  gold = false,
}: {
  role: RoleOut;
  k: RoleEditKey;
  heading: string;
  term?: string | null;
  children: ReactNode;
  initial: string;
  hint?: string;
  multiline?: boolean;
  gold?: boolean;
}) {
  return (
    <>
      <Eyebrow term={term} gold={gold}>
        {heading}
      </Eyebrow>
      <ChangedMark k={k} />
      {children}
      <PendingNote show={role.pending.includes(k)} />
      <EditInPlace target={{ kind: "role", key: k, roleId: role.id }} label={`${heading}, ${role.title}`} initial={initial} hint={hint} multiline={multiline} />
    </>
  );
}

/** A role word in its own box, framed in gold when a proposal changes it. */
function RoleWord(props: React.ComponentProps<typeof Part>) {
  return (
    <div className={`pc-box${useChanged(props.k) ? ` ${GOLD_FRAME}` : ""}`} data-role-section={props.k}>
      <Part {...props} />
    </div>
  );
}

/** Two boxes side by side, or one alone when only one has anything to draw. */
function Pair({ children }: { children: ReactNode[] }) {
  const kids = children.filter(Boolean);
  if (!kids.length) return null;
  if (kids.length === 1) return <>{kids[0]}</>;
  return <div className="pc-cols">{kids}</div>;
}

/** "Not mine to hold": one line reads as the design's sentence, several as its bullets. */
function NotMineWords({ slot }: { slot: Slot<string[]> }) {
  return (
    <SlotView slot={slot}>
      {(items) =>
        items.length === 1 ? (
          <p className="pc-dim pc-f14">{items[0]}</p>
        ) : (
          <ul className="pc-list pc-dim">
            {items.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )
      }
    </SlotView>
  );
}

/** The role's health in words: the dot's words, then the three facts behind it. */
function HealthLine({ health }: { health: HealthOut }) {
  return (
    <p className="pc-health" data-role-health>
      <span className={`pc-dot pc-${health.dot}`} aria-hidden="true" />
      <b>{health.dotWords}</b>
      {health.facts.map((f) => (
        <span key={f.key}>· {f.words}</span>
      ))}
    </p>
  );
}

export function RoleInFull({ role, health = null }: { role: RoleOut; health?: HealthOut | null }) {
  const { editing } = useContext(CardEditContext);
  /** A CCOS section draws once it is written, or in edit mode so the owner can propose words for it. */
  const draws = (slot: Slot<unknown>): boolean => slot.kind === "shown" || (slot.kind === "empty" && editing);
  const headingId = `${role.anchor}-h`;
  const time = role.time.text;
  const exists = role.existsWhile.text;
  const holding = role.holdingWell.parts.filter((p) => draws(p.text));
  // A decided proposal's confirmation, kept here: adopting the last one empties its panel.
  const [decided, setDecided] = useState<string | null>(null);
  // A role proposal's changed words, drawn in gold (role proposals PR C).
  const changed = useContext(ChangedContext);
  const ch = (k: RoleEditKey) => isChanged(changed, k);
  const timeChanged = ch("timeCommitment");
  const keyRole = role.chips[0] === W.keyRole;
  const otherChips = keyRole ? role.chips.slice(1) : role.chips;
  // A10: a held power is a live chip; a "Suited to" reading is a quiet line
  // under the chips, because nothing has been handed over yet.
  const shownPowers = role.powers.items.kind === "shown" ? role.powers.items.value : [];
  const powers = role.powers.note ? [] : shownPowers;
  const suited = role.powers.note ? shownPowers : [];

  return (
    <article id={role.anchor} aria-labelledby={headingId} className="pc-rolecard">
      <h3 id={headingId} className="pc-roletitle">
        {role.title}
      </h3>

      {role.chips.length || role.circle || time.kind === "shown" || powers.length || role.plays ? (
        <ul className="pc-chips" aria-label="About this role">
          {keyRole ? <li className="pc-chip pc-gold">{W.keyRole}</li> : null}
          {role.circle ? (
            <li>
              {/* The circle this role sits in, linked to that circle's card. */}
              <Link href={role.circle.href} className="pc-chip">
                {role.circle.name}
              </Link>
            </li>
          ) : null}
          {otherChips.map((c) => (
            <li key={c} className="pc-chip">
              {c}
            </li>
          ))}
          {time.kind === "shown" ? (
            <li className={`pc-chip${timeChanged ? ` ${GOLD_FRAME}` : ""}`} data-role-chip="time">
              <CardTerm term={role.time.term}>{time.value}</CardTerm>
            </li>
          ) : null}
          {powers.map((p) => (
            <li key={p} className="pc-chip pc-live" data-role-chip="power">
              {p}
            </li>
          ))}
          {role.plays
            ? role.plays.chips.map((c) => (
                <li key={c.key} className="pc-chip pc-arch" title={role.plays!.label}>
                  {c.name}
                </li>
              ))
            : null}
        </ul>
      ) : null}
      {suited.length ? (
        <p className="pc-dim" data-role-powers="suited">
          {role.powers.heading}: {suited.join(", ")}. {role.powers.note}
        </p>
      ) : null}
      {time.kind === "shown" ? <ChangedMark k="timeCommitment" /> : null}
      {editing && time.kind !== "unread" ? (
        <div data-role-section="timeCommitment">
          {time.kind === "empty" ? (
            <p className="pc-dim pc-f14">
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
      {health ? <HealthLine health={health} /> : null}

      {role.proposals.length ? (
        <RoleProposals role={role} onDone={setDecided} />
      ) : decided ? (
        <p role="status" className="pc-said">
          {decided}
        </p>
      ) : null}

      <div className="pc-why" data-role-section="purpose">
        <Eyebrow gold term={role.purpose.term}>
          {role.purpose.heading}
        </Eyebrow>
        <ChangedMark k="purpose" />
        <SlotView slot={role.purpose.text}>{(t) => <q>{t}</q>}</SlotView>
        {role.purpose.why ? <p className="pc-dim pc-f14">{role.purpose.why}</p> : null}
        <PendingNote show={role.pending.includes("purpose")} />
        <EditInPlace target={{ kind: "role", key: "purpose", roleId: role.id }} label={`${role.purpose.heading}, ${role.title}`} initial={asText(role.purpose.text)} />
        {draws(exists) ? (
          <div data-role-section="existsWhile">
            <p className="pc-while">
              <span className="pc-ccos-lead">
                <CardTerm term={role.existsWhile.term}>{role.existsWhile.heading}</CardTerm>
              </span>
              {exists.kind === "shown" ? ` ${exists.value}` : exists.kind === "empty" ? `: ${exists.words}` : null}
            </p>
            <ChangedMark k="existsWhile" />
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

      <Pair>
        {[
          <div key="decide" className={`pc-box${ch("decide") || ch("authorities") ? ` ${GOLD_FRAME}` : ""}`} data-role-section="decide">
            <Part role={role} k="decide" heading={role.decide.heading} term={role.decide.term} initial={asText(role.decide.text)}>
              <SlotView slot={role.decide.text}>{(t) => <p>{t}</p>}</SlotView>
            </Part>
            {draws(role.authorities.items) ? (
              <div className="pc-stack pc-authorities" data-role-section="authorities">
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
          </div>,
          role.bringMe.items.kind !== "unread" ? (
            <RoleWord key="bring" role={role} k="bringMe" heading={role.bringMe.heading} initial={asText(role.bringMe.items)} hint={ROLE_HANDOVER_WORDS.bringMeHint}>
              <ListSlot slot={role.bringMe.items} />
            </RoleWord>
          ) : null,
        ]}
      </Pair>

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

      <Pair>
        {[
          role.working.items.kind !== "unread" ? (
            <div key="working" className="pc-box" data-role-section="working">
              <Eyebrow term={role.working.term}>{role.working.heading}</Eyebrow>
              <SlotView slot={role.working.items}>
                {(signs) => (
                  <ul className="pc-list">
                    {signs.map((s, i) => (
                      <li key={i}>{s.measure}</li>
                    ))}
                  </ul>
                )}
              </SlotView>
            </div>
          ) : null,
          role.worksWith.items.kind !== "unread" ? (
            <div key="with" className="pc-box" data-role-section="worksWith">
              <Eyebrow>{role.worksWith.heading}</Eyebrow>
              <ListSlot slot={role.worksWith.items} />
            </div>
          ) : null,
        ]}
      </Pair>

      {holding.length ? (
        <div className="pc-box pc-arc" data-role-section="holdingWell">
          <Eyebrow gold>{role.holdingWell.heading}</Eyebrow>
          <div className="pc-arc3">
            {holding.map((p) => (
              <div key={p.key} className={ch(p.key) ? GOLD_FRAME : undefined} data-holding={p.key}>
                <b>
                  <CardTerm term={p.term}>{p.heading}</CardTerm>
                </b>
                <ChangedMark k={p.key} />
                <SlotView slot={p.text}>{(t) => <p>{t}</p>}</SlotView>
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
          <NotMineWords slot={role.notMine.items} />
        </RoleWord>
      )}

      {role.runbook.text.kind !== "unread" && (
        <RoleWord role={role} k="runbook" heading={role.runbook.heading} initial={asText(role.runbook.text)} hint={ROLE_HANDOVER_WORDS.runbookHint}>
          <SlotView slot={role.runbook.text}>
            {(t) =>
              runbookIsLink(t) ? (
                <a href={t} target="_blank" rel="noopener noreferrer" className="pc-link">
                  {t}
                </a>
              ) : (
                <p className="pc-f14" style={{ whiteSpace: "pre-line" }}>
                  {t}
                </p>
              )
            }
          </SlotView>
        </RoleWord>
      )}

      {role.tensions.kind !== "unread" && (
        <div className="pc-box" data-role-tensions={role.id}>
          <Eyebrow>{W.tensions}</Eyebrow>
          <SlotView slot={role.tensions}>
            {(t) => (
              <div className="pc-tensions">
                <ul data-tension-counts>
                  {t.counts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                {t.open.length ? (
                  <ul className="pc-list" data-tension-words="open">
                    {t.open.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                ) : null}
                {t.public.length ? (
                  <div className="pc-stack">
                    <p className="pc-dim">{W.tensionsBrought}</p>
                    <ul className="pc-list" data-tension-words="circle">
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
            <a href={TASK_BOARD_PATH} className="pc-link" data-tension-door="waiting">
              {W.tensionsWaiting}
            </a>
          ) : null}
          {role.tensionDoor === "raise" ? <RaiseTension roleId={role.id} roleName={role.title} mayRaise /> : null}
        </div>
      )}

      <div className="pc-box" data-role-handover>
        <div className="pc-handhead">
          <Eyebrow>{role.handover.heading}</Eyebrow>
          <strong>{role.handover.summary}</strong>
        </div>
        <ul className="pc-checks" data-handover-checks>
          {role.handover.checks.map((c) => (
            <li key={c.key} data-check={c.key} data-ready={c.state === "ready" ? "true" : "false"}>
              <span aria-hidden="true" className={c.state === "ready" ? "pc-tick" : "pc-open"}>
                {c.state === "ready" ? "✓" : "○"}
              </span>
              <span>
                <b>{c.label}:</b> <span className={c.state === "ready" ? undefined : "pc-dim"}>{c.words}</span>
                {c.parts ? (
                  <ul data-handover-parts>
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
    <div className="pc-box pc-proposals" data-role-proposals={role.id}>
      <Eyebrow gold>{PW.heading}</Eyebrow>
      {role.proposals.map((p) => (
        <div key={p.draftId} className="pc-proposal">
          <p className="pc-dim pc-f12">{p.proposedOn}</p>
          {p.fields.map((f) => (
            <div key={f.key} className="pc-stack">
              <b>{f.label}</b>
              {f.lines.length ? (
                <ul className="pc-list">
                  {f.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="pc-dim pc-f14">{PW.clears}</p>
              )}
            </div>
          ))}
          <DecideDoors draftId={p.draftId} reload={reload} words={DOOR_WORDS} onDone={onDone} />
        </div>
      ))}
    </div>
  );
}
