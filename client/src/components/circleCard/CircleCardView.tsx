/**
 * THE CIRCLE CARD, drawn from the model the server sends (`CircleCard`,
 * shared/circleCard.ts). Every section here draws what arrived and decides
 * nothing: an unread slot draws nothing, an empty one draws its words.
 *
 * The order is the model's, which leads with the work. Consecutive word
 * sections share one panel, two to a row on a wide screen and one column on a
 * phone, so the card reads as a few panels and never as a dozen boxes.
 *
 * A heading with a CCOS term is an `InfoTip` trigger: hover, tap, Tab and
 * Enter all show "CCOS: <term>", and a screen reader hears it as the heading's
 * description. A village that turned the terms off gets plain headings.
 *
 * Phone first: one column with 16px gutters at 375px, every control at least
 * 44px, and no row wider than the screen. Drawn in the semantic tokens the
 * player card uses (`bg-card`, `text-card-foreground`, `text-muted-foreground`,
 * `text-notice`); no colour of its own.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import InfoTip from "@/components/InfoTip";
import { BOX, EYEBROW, LINK, SECTION, SlotView } from "@/components/playerCard/cardParts";
import type { CircleCard, CircleSection, RoleRowOut } from "@shared/circleCard";

const H2 = "font-display text-xl font-bold text-card-foreground sm:text-2xl";
const H3 = "text-sm font-semibold text-card-foreground";
const HEADING_TAP = "inline-flex min-h-11 items-center text-left";

/** A heading, with its CCOS term on hover or tap when the village shows the terms. */
function Heading({ text, term, level }: { text: string; term: string | null; level: 2 | 3 }) {
  const Tag = level === 2 ? "h2" : "h3";
  const cls = level === 2 ? H2 : H3;
  if (!term) return <Tag className={`${cls} ${level === 3 ? "flex min-h-11 items-center" : ""}`}>{text}</Tag>;
  return (
    <Tag className={cls}>
      <InfoTip tip={term} triggerClassName={HEADING_TAP}>
        {text}
      </InfoTip>
    </Tag>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

/** One word section inside a shared panel. */
function WordBox({ section }: { section: CircleSection }) {
  return (
    <div className={BOX} data-circle-section={section.key}>
      <Heading text={section.heading} term={section.term} level={3} />
      {section.kind === "list" ? (
        <>
          <SlotView slot={section.slot}>{(items) => <Bullets items={items} />}</SlotView>
          {section.note ? <p className="mt-2 text-xs text-muted-foreground">{section.note}</p> : null}
        </>
      ) : null}
      {section.kind === "values" ? (
        <SlotView slot={section.slot}>
          {(pairs) => (
            <ul className="space-y-2 text-sm">
              {pairs.map((p, i) => (
                <li key={i}>
                  <span className="font-semibold">{p.value}:</span> {p.practice}
                </li>
              ))}
            </ul>
          )}
        </SlotView>
      ) : null}
    </div>
  );
}

function RoleRow({ role }: { role: RoleRowOut }) {
  return (
    <li className={`${BOX} grid gap-1`} data-circle-role={role.id}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Link href={role.href} className="inline-flex min-h-11 items-center font-semibold text-card-foreground underline underline-offset-2">
          {role.name}
        </Link>
        <span className={`rounded-full border border-border px-2.5 py-0.5 text-xs font-medium ${role.filled ? "text-card-foreground" : "text-notice"}`}>
          {role.stateWords}
        </span>
      </div>
      {role.holderCards.length || role.applyHref ? (
        <div className="flex flex-wrap gap-x-4">
          {role.holderCards.map((h) => (
            <Link key={h.href} href={h.href} aria-label={h.ariaLabel} className={LINK}>
              {h.label}
            </Link>
          ))}
          {role.applyHref ? (
            <Link href={role.applyHref} className={LINK}>
              {role.applyLabel}
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Panel({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <section aria-label={label} className={`${SECTION} grid gap-4`}>
      {children}
    </section>
  );
}

/** Group the model's sections into panels: consecutive word sections share one. */
function panels(sections: CircleSection[]): CircleSection[][] {
  const out: CircleSection[][] = [];
  for (const s of sections) {
    const words = s.kind === "list" || s.kind === "values";
    const last = out[out.length - 1];
    if (words && last && (last[0]!.kind === "list" || last[0]!.kind === "values")) last.push(s);
    else out.push([s]);
  }
  return out;
}

function SectionPanel({ group }: { group: CircleSection[] }) {
  const first = group[0]!;
  if (first.kind === "list" || first.kind === "values") {
    if (group.every((s) => s.slot.kind === "unread")) return null;
    return (
      <Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          {group.map((s) => (s.slot.kind === "unread" ? null : <WordBox key={s.key} section={s} />))}
        </div>
      </Panel>
    );
  }
  if (first.kind === "roles") {
    if (first.slot.kind === "unread") return null;
    return (
      <Panel label={first.heading}>
        <Heading text={first.heading} term={first.term} level={2} />
        <SlotView slot={first.slot}>
          {(roles) => (
            <ul className="grid gap-3" data-circle-roles="">
              {roles.map((r) => (
                <RoleRow key={r.id} role={r} />
              ))}
            </ul>
          )}
        </SlotView>
        {first.note ? <p className="text-sm text-muted-foreground">{first.note}</p> : null}
      </Panel>
    );
  }
  if (first.kind === "adoption") {
    if (first.slot.kind === "unread") return null;
    return (
      <Panel label={first.heading}>
        <Heading text={first.heading} term={first.term} level={2} />
        <SlotView slot={first.slot}>
          {(a) => (
            <div className="grid gap-2 text-sm">
              <p className="font-medium">{a.latest}</p>
              {a.summary ? <p className="text-muted-foreground">{a.summary}</p> : null}
              {a.lines.length > 1 ? (
                <ul className="grid gap-1 text-muted-foreground">
                  {a.lines.map((l, i) => (
                    <li key={i}>
                      {l.what}. {l.how}.
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </SlotView>
      </Panel>
    );
  }
  // The purpose is drawn in the header panel.
  return null;
}

export default function CircleCardView({ card }: { card: CircleCard }) {
  const { header } = card;
  const purpose = card.sections.find((s) => s.kind === "text");
  return (
    <div data-circle-card="" className="grid gap-4 sm:gap-6">
      <section className={`${SECTION} grid gap-4`}>
        <div className="grid gap-1">
          <p className={EYEBROW}>{header.eyebrow}</p>
          <h1 className="font-display text-3xl font-bold text-card-foreground break-words sm:text-4xl">{header.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {header.parent ? (
              <span>
                {header.parent.label}{" "}
                <Link href={header.parent.href} className={LINK}>
                  {header.parent.name}
                </Link>
              </span>
            ) : null}
            {header.status ? (
              <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-card-foreground">{header.status}</span>
            ) : null}
          </div>
        </div>
        {purpose && purpose.kind === "text" ? (
          <div className="grid gap-2" data-circle-section="purpose">
            <Heading text={purpose.heading} term={purpose.term} level={2} />
            <SlotView slot={purpose.slot}>{(t) => <p className="whitespace-pre-line text-base">{t}</p>}</SlotView>
            {header.existsWhile.kind !== "unread" ? (
              <p className="text-sm text-muted-foreground">
                {header.existsWhileTerm ? <InfoTip tip={header.existsWhileTerm}>{header.existsWhileLabel}</InfoTip> : header.existsWhileLabel}
                {header.existsWhile.kind === "shown" ? ` ${header.existsWhile.value}` : `: ${header.existsWhile.words}`}
              </p>
            ) : null}
          </div>
        ) : null}
        {header.termsKey ? <p className="text-xs text-muted-foreground">{header.termsKey}</p> : null}
      </section>
      {panels(card.sections.filter((s) => s.kind !== "text")).map((g) => (
        <SectionPanel key={g[0]!.key} group={g} />
      ))}
    </div>
  );
}
