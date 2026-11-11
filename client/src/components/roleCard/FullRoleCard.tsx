/**
 * THE FULL ROLE CARD (phase A, lane A3, build list 4.4 to 4.8): everything the
 * role editor holds, read-only, in one card.
 *
 *   - the role's words, under the editor's own headings (CARD_WORDS), each
 *     drawn only once it is written, so no heading sits over blank space;
 *   - the founding sections (shared/roleCardSections.ts): "This is a paid
 *     role", Ideal background, Qualities we're looking for, AI support with its
 *     animal companion, and How pay works as SHARES of the whole, never an
 *     amount or a range;
 *   - the listing details (track, goals, where, languages, how it is filled,
 *     selection criteria), through the same view model every card host reads
 *     (RoleCardParams, shared/roleCardView.ts);
 *   - the roots it grows from (RootsSlot, lane A4's RootTags once it lands);
 *   - who last edited it and on what day;
 *   - one act, "Apply for this role", to /propose-a-role?role=<id>, lit by the
 *     one firefly cluster on the screen.
 *
 * READ-ONLY FOR EVERYONE WITHOUT THE POWER. The only edit control is the
 * editor's own door (EditRoleButton), which draws nothing for a visitor, an
 * applicant or a member without the power to decide the structure; the server
 * asks the same question again on every write.
 *
 * Two registers (phase A brief). `founding` is the quiet one for a paid
 * founding role: larger display type, more space, gold rules. `game` is the
 * directory's. Both use the night world's semantic tokens only.
 *
 * Phone and desktop: one column on a phone with the act at the end of the
 * card; from lg, the role's words on the left and a sticky column on the right
 * holding the pay shape, the details and the act, so the act stays beside what
 * a reader is reading.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, Bird, Cat, Dog, Feather, Fish, PawPrint, Rabbit, Snail, Squirrel, Turtle } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { CARD_WORDS as W } from "@shared/playerCardWords";
import { cardPay, NO_VILLAGE_PAY, SECTION_WORDS, type RoleCardSections, type VillagePay } from "@shared/roleCardSections";
import { roleCardView } from "@shared/roleCardView";
import { civilDayWords } from "@shared/seasonPlans";
import { BTN_PRIMARY, EYEBROW, HINT } from "@/components/journey/look";
import { Fireflies } from "@/components/journey/nature";
import RoleCardParams from "@/components/power/RoleCardParams";
import EditRoleButton from "@/components/roleEdit/EditRoleButton";
import RootsSlot from "./RootsSlot";
import { useWide } from "./useWide";
import { readRoleCard, type RoleCardAnswer } from "./roleCardApi";

export type CardRegister = "founding" | "game";

/** Where the Apply act goes: the application, with this one role already chosen (ruling 1). */
export function applyHrefForRole(roleId: string): string {
  return `/propose-a-role?role=${encodeURIComponent(roleId)}`;
}

/** Whether this reader may apply for the seat: a live, open, complete card. */
export function mayApply(seat: Record<string, any>): boolean {
  if (!seat || seat.isExample) return false;
  if (seat.state === "filled") return false;
  return roleCardView(seat).applyAllowed;
}

const ANIMALS: Array<[RegExp, typeof Bird]> = [
  [/turtle|tortoise/i, Turtle],
  [/rabbit|hare/i, Rabbit],
  [/squirrel/i, Squirrel],
  [/fish|salmon|whale|dolphin/i, Fish],
  [/snail/i, Snail],
  [/cat|jaguar|ocelot|puma/i, Cat],
  [/dog|wolf|fox/i, Dog],
  [/owl|heron|hummingbird|toucan|bird|parrot|macaw|eagle|hawk/i, Bird],
  [/feather/i, Feather],
];

/** The companion's animal as a drawing: the named animal where there is one, a paw print otherwise. */
function AnimalIcon({ name }: { name: string }) {
  const Icon = ANIMALS.find(([re]) => re.test(name))?.[1] ?? PawPrint;
  return <Icon className="size-6 text-notice" aria-hidden="true" />;
}

const asText = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const asLines = (v: unknown): string[] => {
  let x = v;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return x ? [String(x)] : [];
    }
  }
  return Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : [];
};

function Block({ heading, register, children, testId }: { heading: string; register: CardRegister; children: ReactNode; testId?: string }) {
  return (
    <section className={register === "founding" ? "border-t border-notice/30 pt-5" : "border-t border-border pt-4"} data-testid={testId}>
      <h4 className={register === "founding" ? "font-display text-xl text-card-foreground" : "font-display text-lg font-bold text-card-foreground"}>{heading}</h4>
      <div className="mt-2 text-card-foreground">{children}</div>
    </section>
  );
}

function Lines({ lines }: { lines: string[] }) {
  if (lines.length === 1) return <p className="leading-relaxed">{lines[0]}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 leading-relaxed marker:text-notice">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

export interface FullRoleCardProps {
  /** The role as `/api/org` sent it. */
  seat: Record<string, any>;
  /** The circle it sits in, by name. */
  circleName?: string | null;
  register?: CardRegister;
  /** The founding sections when the host already holds them; read here otherwise. */
  sections?: RoleCardSections | null;
  /** The id of the heading that names the card, when the host draws it. */
  labelledBy?: string;
  /** Whether the card draws its own title (the founding section does; the directory row header names it). */
  showTitle?: boolean;
  /** The village's pay shape when the host already holds it; read here otherwise. */
  villagePay?: VillagePay | null;
}

export default function FullRoleCard({ seat, circleName = null, register = "game", sections: given, labelledBy, showTitle = true, villagePay: givenPay = null }: FullRoleCardProps) {
  const { t } = useLingui();
  const id = String(seat?.id ?? "");
  const [answer, setAnswer] = useState<RoleCardAnswer | null>(null);
  useEffect(() => {
    let live = true;
    if (!id) return;
    void readRoleCard(id).then((a) => live && setAnswer(a));
    return () => {
      live = false;
    };
  }, [id]);

  const sections = answer?.sections ?? given ?? null;
  // How pay works: the village's shape on every card, the card's own where it wrote one (lead, 11 Nov).
  const pay = cardPay(sections, answer?.villagePay ?? givenPay ?? NO_VILLAGE_PAY);
  // RANGES STAY HIDDEN whatever the role data holds: the server leaves the range out while the village
  // keeps it hidden, and the card drops it again here so an older payload can never draw one.
  const showsRange = answer?.showPayRanges === true;
  const params = showsRange || !seat?.card?.publicPay ? seat : { ...seat, card: { ...seat.card, publicPay: undefined } };
  const founding = register === "founding";
  const words: Array<{ key: string; heading: string; lines: string[] }> = [
    { key: "whyItMatters", heading: t({ message: "Why it matters", context: "full role card heading" }), lines: asLines(seat.whyItMatters) },
    { key: "domain", heading: W.decide, lines: asLines(seat.domain) },
    { key: "authorities", heading: W.authorities, lines: asLines(seat.authorities) },
    { key: "accountabilities", heading: W.countOnMe, lines: asLines(seat.accountabilities) },
    { key: "responsibilities", heading: W.responsibilities, lines: asLines(seat.responsibilities) },
  ].filter((w) => w.lines.length > 0);
  const bringMe = asLines(seat.bringMe);
  const notMine = asLines(seat.notMine);
  const holding = [
    { key: "signsStretched", heading: W.signsStretched, text: asText(seat.signsStretched) },
    { key: "flowsBack", heading: W.flowsBack, text: asText(seat.flowsBack) },
    { key: "stepBack", heading: W.stepBack, text: asText(seat.stepBack) },
  ].filter((h) => h.text);
  const aim = asText(seat.aim);
  const existsWhile = asText(seat.existsWhile);
  const commitment = asText(seat.timeCommitment);
  const roots = Array.isArray(seat.archetypes) ? seat.archetypes.map(String) : [];
  const apply = mayApply(seat);
  const last = answer?.lastEdited ?? null;
  const wide = useWide();

  const act = apply ? (
    <Fireflies block>
      <Link href={applyHrefForRole(id)} className={`w-full ${BTN_PRIMARY}`} data-apply-role={id}>
        <Trans context="full role card: the one act">Apply for this role</Trans>
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </Fireflies>
  ) : null;

  const side = (
    <div className="flex flex-col gap-5">
      {pay && (
        <section className={`rounded-xl border ${founding ? "border-notice/50" : "border-border"} bg-card p-4`} data-testid="pay-shape">
          <h4 className="font-display text-lg text-card-foreground">{SECTION_WORDS.payShape}</h4>
          {pay.ceiling && <p className="mt-2 font-display text-xl leading-snug text-notice" data-testid="pay-ceiling">{pay.ceiling}</p>}
          {pay.split && <p className="mt-2 leading-relaxed text-card-foreground" data-testid="pay-split">{pay.split}</p>}
          {pay.atRisk && <p className="mt-3 text-sm leading-relaxed text-card-foreground" data-testid="pay-at-risk">{pay.atRisk}</p>}
          {pay.note && <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground" data-testid="pay-note">{pay.note}</p>}
        </section>
      )}
      {commitment && (
        <p className="text-card-foreground">
          <span className={EYEBROW}>{W.timeCommitment}</span>
          <span className="mt-1 block">{commitment}</span>
        </p>
      )}
      <RoleCardParams seat={params} />
      {wide && act}
    </div>
  );

  return (
    <article
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : String(seat?.name ?? "")}
      className={founding ? "sheet-night rounded-2xl border border-notice/40 bg-card p-5 shadow-sm sm:p-8" : "sheet-night rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6"}
      data-full-role-card={id}
      data-register={register}
    >
      <header className="flex flex-col gap-2">
        {(circleName || sections?.paid) && (
          <p className={EYEBROW}>
            {[circleName, sections?.paid ? t({ message: "Paid role", context: "full role card chip" }) : null].filter(Boolean).join(" · ")}
          </p>
        )}
        {showTitle && <h3 className={founding ? "font-display text-3xl leading-tight text-card-foreground sm:text-4xl" : "font-display text-2xl text-card-foreground"}>{String(seat?.name ?? "")}</h3>}
        {/* The roots it grows from: lane A4's RootTags renders here (RootsSlot.tsx). */}
        <RootsSlot roots={roots} />
        {sections?.paid && (
          <p className="font-semibold text-notice" data-testid="paid-role-line">{SECTION_WORDS.paid}</p>
        )}
      </header>

      <div className={`mt-5 grid gap-6 ${founding ? "lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10" : "lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-8"}`}>
        <div className="flex min-w-0 flex-col gap-5 break-words">
          {aim && (
            <section className="rounded-xl border-l-4 border-notice bg-muted px-4 py-3" data-testid="purpose">
              <h4 className={EYEBROW}>{W.purpose}</h4>
              <p className={founding ? "mt-1 font-display text-xl leading-snug text-card-foreground sm:text-2xl" : "mt-1 text-lg text-card-foreground"}>{aim}</p>
              {existsWhile && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {W.existsWhile} {existsWhile}
                </p>
              )}
            </section>
          )}
          {words.map((w) => (
            <Block key={w.key} heading={w.heading} register={register} testId={`words-${w.key}`}>
              <Lines lines={w.lines} />
            </Block>
          ))}
          {sections && sections.idealBackground.length > 0 && (
            <Block heading={SECTION_WORDS.idealBackground} register={register} testId="ideal-background">
              <Lines lines={sections.idealBackground} />
            </Block>
          )}
          {sections && sections.qualities.length > 0 && (
            <Block heading={SECTION_WORDS.qualities} register={register} testId="qualities">
              <Lines lines={sections.qualities} />
            </Block>
          )}
          {sections && (sections.aiSupport || sections.aiCompanion) && (
            <Block heading={SECTION_WORDS.aiSupport} register={register} testId="ai-support">
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full border border-notice/50">
                  <AnimalIcon name={sections.aiCompanion} />
                </span>
                <div>
                  {sections.aiCompanion && <p className="font-semibold">{sections.aiCompanion}</p>}
                  {sections.aiSupport && <p className="leading-relaxed">{sections.aiSupport}</p>}
                </div>
              </div>
            </Block>
          )}
          {bringMe.length > 0 && (
            <Block heading={W.bringMe} register={register} testId="words-bringMe">
              <Lines lines={bringMe} />
            </Block>
          )}
          {holding.length > 0 && (
            <Block heading={W.holdingWell} register={register} testId="holding-well">
              <dl className="grid gap-3 sm:grid-cols-3">
                {holding.map((h) => (
                  <div key={h.key}>
                    <dt className="text-sm font-semibold text-muted-foreground">{h.heading}</dt>
                    <dd className="mt-0.5 leading-relaxed">{h.text}</dd>
                  </div>
                ))}
              </dl>
            </Block>
          )}
          {notMine.length > 0 && (
            <Block heading={W.notMine} register={register} testId="words-notMine">
              <Lines lines={notMine} />
            </Block>
          )}
        </div>
        <div className="lg:sticky lg:top-28 lg:self-start">{side}</div>
      </div>

      {/* A PHONE'S THUMB: the one act rides at the bottom of the screen while the card is read
          (rehearsal, 11 Nov: it sat three screens down). On a desktop it stays in the side column. */}
      {!wide && act && <div className="sticky bottom-[calc(var(--tabbar-h,0px)+0.75rem)] z-20 mt-6">{act}</div>}
      <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className={HINT} data-testid="last-edited">
          {last ? SECTION_WORDS.lastEdited(last.by, civilDayWords(last.on)) : ""}
        </p>
        {!seat.isExample && <EditRoleButton roleId={id} onSaved={() => window.location.reload()} />}
      </footer>
    </article>
  );
}
