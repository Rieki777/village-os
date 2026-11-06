import Layout from "@/components/Layout";
import { Link } from "wouter";
import LiveDecisionsBand from "@/components/governance/LiveDecisionsBand";
import VillageAgreements from "@/components/governance/VillageAgreements";
import { lazy, Suspense } from "react";
import VillageConflictSteps from "@/components/governance/VillageConflictSteps";
import { useModuleOn } from "@/modules/ModuleProvider";
import VoiceSpreadBand from "@/components/governance/VoiceSpreadBand";
import {
  Vote,
  Users,
  Eye,
  Lightbulb,
  MessageSquare,
  CheckCircle2,
  RefreshCw,
  Network,
  ArrowRight,
  Scale,
  ShieldCheck,
  Printer,
} from "lucide-react";
import { useStoryPageShown } from "@/lib/brochure";
import { useHypha } from "@/modules/ModuleProvider";
import { HyphaAdminNote } from "@/components/HyphaAdminNote";
import { usePageContent } from "@/hooks/usePageContent";
import { useVetoHours } from "@/hooks/useVetoHours";
import { Emphasized } from "@/components/PageText";
import { fillVars } from "@shared/pageContent/resolve";
import { GOVERNANCE_PAGE, VETO_HOURS_MIN, vetoWindowWords } from "@shared/pageContent/governance";
import { CANVAS_CREDIT } from "@shared/governanceCanvasText";
import { CANVAS_PUBLIC_MATRIX_PATH } from "@shared/canvasPublicLines";

// Each behind its module, so a village with both off downloads none of them.
const ConflictAgreementPublic = lazy(() => import("@/components/canvas/ConflictAgreementPublic"));
const CanvasPublicLines = lazy(() => import("@/components/canvas/CanvasPublicLines"));
const DecisionMatrix = lazy(() => import("@/components/canvas/DecisionMatrix"));

/** The icons the cards and steps take in turn, whatever the village wrote. */
const PRINCIPLE_ICONS = [CheckCircle2, Users, Eye];
const STEP_ICONS = [Lightbulb, MessageSquare, Users, CheckCircle2, Eye];

/** Paragraphs a village left blank are not drawn. */
const paragraphs = (...texts: string[]) => texts.filter((t) => t.trim() !== "");

/**
 * HOW WE WORK TOGETHER, at /governance (plan section 1, 2026-09-28).
 *
 * The page every fork already has, renamed for what it now holds: the
 * village's own account of how it works, block by block, from the Governance
 * Canvas. The route stays /governance so every link, bookmark and sitemap
 * entry keeps working. The hero's eyebrow, headline and intro are the
 * village's own words (Admin, Pages, shared/pageContent/governance.ts), so
 * this page no longer types a name for itself; the canvas sections below
 * are drawn whatever the village wrote there.
 *
 * WHAT A VISITOR SEES, AND WHAT A MEMBER SEES BESIDE IT (plan 4.6):
 *
 *   - each block's public line under the canvas's question (CanvasPublicLines);
 *   - who decides what: the Decision Matrix rows the platform generates, read
 *     only, from the public door that serves nothing a village wrote;
 *   - the conflict section: the adopted conflict agreement's public view
 *     (ConflictAgreementPublic), roles only.
 *
 * A signed-in member also opens the village's words each block keeps for its
 * members. The canvas's readings and its radar are never on this page, for
 * anybody.
 *
 * EACH ADDITION FOLLOWS ITS MODULE (Rye's module ruling, 2026-10-01). The
 * public lines, the matrix and the workbook card render only while the
 * Governance Canvas is on for this reader (`useModuleOn`: the catalogue a
 * visitor is served leaves out a module that is not public). The conflict
 * section shows the agreement's public view only while Conflict Evolution is
 * on, and the exit policy's restorative steps (VillageConflictSteps, core)
 * otherwise. With both off the page is what it was before the canvas build,
 * with its honest-copy fixes kept.
 */
export default function Governance() {
  // Each story page has its own switch now; a door goes with its page.
  const storyShown = useStoryPageShown();
  // A Hypha section needs a Hypha space to describe: the village's switch AND its DHO link.
  const hypha = useHypha();
  // Every word on this page is the village's own, from Admin, Pages, How We
  // Govern (shared/pageContent/governance.ts). Null until the saved words
  // have arrived, so the defaults never flash first.
  const page = usePageContent(GOVERNANCE_PAGE);
  // The steward's window is the village's setting, never a typed "three
  // days". Unreadable, it is said as the floor every village shares.
  const vetoHours = useVetoHours();
  // The two canvas modules (Rye, 2026-10-01): each section below is behind its own.
  const canvasOn = useModuleOn("canvas");
  const conflictOn = useModuleOn("conflict-evolution");
  if (!page) {
    return (
      <Layout>
        <section className="min-h-[70vh]" aria-busy="true" />
      </Layout>
    );
  }
  const { hero, spread, principles, decision, circles, conflict, stewards, rules, cta } = page;
  const hyphaSection = page.hypha;
  const showHypha = !hyphaSection.hidden && hypha.configured;
  const veto = vetoHours === null ? `at least ${vetoWindowWords(VETO_HOURS_MIN)}` : vetoWindowWords(vetoHours);
  const conflictParagraphs = paragraphs(conflict.fields.first, conflict.fields.second, conflict.fields.third);
  const stewardParagraphs = paragraphs(stewards.fields.first, stewards.fields.second, stewards.fields.third, stewards.fields.fourth).map(
    (text) => fillVars(text, { veto }),
  );
  return (
    <Layout>
      {/* Hero */}
      <section className="bg-teal-band text-white py-20">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-3">
            <Vote className="w-6 h-6 text-amber-on-band shrink-0" />
            <span className="text-amber-on-band font-medium text-sm tracking-widest uppercase break-words min-w-0">
              {hero.fields.eyebrow}
            </span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-4 break-words">
            {hero.fields.headline}
          </h1>
          <p className="text-white text-lg max-w-3xl leading-relaxed break-words">
            <Emphasized text={hero.fields.intro} />
          </p>
        </div>
      </section>

      {/* The live votes, before any theory. This page used to explain how
          decisions get made and stop there, which left a member reading about
          governance while the village was holding a vote they never saw. The
          band renders nothing where the engine is off. */}
      <LiveDecisionsBand />

      {/* Who holds the Voice: the spread across everyone who votes, in groups,
          and this season's votes as counts. Draws nothing while governance is
          off, or for a stranger while the village keeps its people. */}
      {!spread.hidden && <VoiceSpreadBand heading={spread.fields.heading} intro={spread.fields.intro} />}

      {/* The agreements the village adopted, for members (W4-agreements-no-page).
          Renders nothing to a visitor or while governance is off. */}
      <VillageAgreements />

      {/* The canvas, one public line per block. Visitors read the lines; a
          signed-in member also opens the words kept for members. */}
      {canvasOn && (
      <section className="bg-stone-50 py-16">
        <div className="container max-w-5xl mx-auto px-4">
          <Suspense fallback={null}>
            <CanvasPublicLines />
          </Suspense>
        </div>
      </section>
      )}

      {/* Who decides what: the half of the canvas's Decision Matrix the
          platform writes from the rules it enforces. Read only, and from the
          PUBLIC door, which can serve nothing a village wrote. */}
      {canvasOn && (
      <section className="bg-white py-16">
        <div className="container max-w-5xl mx-auto px-4">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep mb-3">
            Who Decides What
          </h2>
          <p className="text-stone-700 leading-relaxed">
            Who approves each kind of decision, who is asked first, who is told, and how it is made. These answers come
            from the rules this village runs on today, so they change when the village changes them.
          </p>
          <Suspense fallback={null}>
            <DecisionMatrix src={CANVAS_PUBLIC_MATRIX_PATH} />
          </Suspense>
        </div>
      </section>
      )}

      {/* Core Principles */}
      {!principles.hidden && (
      <section className="bg-stone-50 py-20">
        <div className="container max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep break-words">
              {principles.fields.heading}
            </h2>
          </div>
          {principles.lists.items.length > 0 && (
          <div className="grid md:grid-cols-3 gap-5">
            {principles.lists.items.map((p, i) => {
              const Icon = PRINCIPLE_ICONS[i % PRINCIPLE_ICONS.length];
              return (
                <div
                  key={`${i}-${p.title}`}
                  className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 min-w-0"
                >
                  <div className="w-12 h-12 rounded-xl bg-teal-deep/10 text-teal-deep flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-teal-deep mb-2 break-words">
                    {p.title}
                  </h3>
                  <p className="text-sm text-stone-600 leading-relaxed break-words">{p.body}</p>
                </div>
              );
            })}
          </div>
          )}
        </div>
      </section>
      )}

      {/* How a decision gets made */}
      {!decision.hidden && (
      <section className="bg-white py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep mb-3 break-words">
              {decision.fields.heading}
            </h2>
            {decision.fields.intro && (
            <p className="text-muted-foreground break-words">
              {decision.fields.intro}
            </p>
            )}
          </div>
          {decision.lists.steps.length > 0 && (
          <ol className="space-y-4">
            {decision.lists.steps.map((s, i) => {
              const Icon = STEP_ICONS[i % STEP_ICONS.length];
              return (
                <li
                  key={`${i}-${s.text}`}
                  className="flex gap-4 items-start bg-stone-50 rounded-2xl border border-stone-200 px-5 py-4"
                >
                  <div className="shrink-0 w-10 h-10 rounded-full bg-teal-deep text-white flex items-center justify-center font-display font-bold">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <Icon className="w-5 h-5 text-teal-deep shrink-0" />
                    <p className="text-stone-700 leading-relaxed break-words min-w-0">{s.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          )}
        </div>
      </section>
      )}

      {/* Circles and their domains. The circles page draws the real ones. */}
      {!circles.hidden && (
      <section className="bg-sage/15 py-20">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="text-center mb-10">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep mb-3 break-words">
              {circles.fields.heading}
            </h2>
            {circles.fields.intro && (
            <p className="text-muted-foreground max-w-2xl mx-auto break-words">
              <Emphasized text={circles.fields.intro} />
            </p>
            )}
          </div>
          {circles.lists.items.length > 0 && (
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            {circles.lists.items.map((c, i) => (
              <div key={`${i}-${c.name}`} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 min-w-0">
                <h3 className="font-display text-lg font-semibold text-teal-deep mb-1.5 break-words">{c.name}</h3>
                <p className="text-sm text-stone-600 leading-relaxed break-words">{c.body}</p>
              </div>
            ))}
          </div>
          )}
          <div className="text-center">
            <Link
              href="/circles"
              className="inline-flex items-center gap-2 text-teal-deep font-semibold hover:text-teal transition-colors"
            >
              {circles.fields.linkLabel} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
      )}

      {/* Conflict resolution: the village's own words on how tension is worked
          through (Admin, Pages), then its conflict agreement, public with roles
          only, and before there is one the restorative steps of its published
          exit policy. This used to be three compiled paragraphs every fork
          published as its own practice, ending in a promise that nobody is
          removed without a circle consent vote, while removal is an admin act
          in the server. The reasoning is in VillageConflictSteps and
          ConflictAgreementPublic. */}
      {!conflict.hidden && (
      <section className="bg-white py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-4">
            <Scale className="w-6 h-6 text-teal-deep shrink-0" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep break-words min-w-0">
              {conflict.fields.heading}
            </h2>
          </div>
          {conflictParagraphs.length > 0 && (
            <div className="space-y-4 text-stone-700 leading-relaxed mb-6">
              {conflictParagraphs.map((text, i) => (
                <p key={i} className="break-words">
                  <Emphasized text={text} />
                </p>
              ))}
            </div>
          )}
          {/* THE ADOPTED CONFLICT AGREEMENT'S PUBLIC VIEW (plan 4.6 and 6.2), roles
              only. Before the village saves an agreement, or when it cannot be
              read, ConflictAgreementPublic prints the restorative steps of the
              published exit policy (VillageConflictSteps) in its place. */}
          <div data-testid="conflict-agreement-slot">
            {conflictOn ? (
              <Suspense fallback={null}>
                <ConflictAgreementPublic />
              </Suspense>
            ) : (
              <VillageConflictSteps />
            )}
          </div>
        </div>
      </section>
      )}

      {/* Stewards: the training wheels, and the fact that they come off.
          The hero used to say no single person holds veto power, which stopped
          being true the moment the engine shipped one. A member reading this
          page has to be able to find out who can stop a decision, how long they
          have, and what the village can do about it. "How long" is the
          village's own `governance.veto_hours`, held back until it is known so
          a member never reads a guess that then changes. */}
      {!stewards.hidden && vetoHours !== undefined && (
      <section className="bg-white py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-4">
            <ShieldCheck className="w-6 h-6 text-teal-deep shrink-0" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep break-words min-w-0">
              {stewards.fields.heading}
            </h2>
          </div>
          <div className="space-y-4 text-stone-700 leading-relaxed">
            {stewardParagraphs.map((text, i) => (
              <p key={i} className="break-words">
                <Emphasized text={text} />
              </p>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* How rules evolve */}
      {!rules.hidden && (
      <section className="bg-stone-50 py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-4">
            <RefreshCw className="w-6 h-6 text-teal-deep shrink-0" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep break-words min-w-0">
              {rules.fields.heading}
            </h2>
          </div>
          <p className="text-stone-700 leading-relaxed break-words">
            <Emphasized text={rules.fields.body} />
          </p>
        </div>
      </section>
      )}

      {/* The Governance Canvas on paper: twelve questions a group can talk
          through about how it governs itself, printable by anyone, signed in
          or not. Credited wherever the canvas appears. */}
      {canvasOn && (
      <section className="bg-white py-16">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-4">
            <Printer className="w-6 h-6 text-teal-deep" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep">
              The Governance Canvas, on Paper
            </h2>
          </div>
          <p className="text-stone-700 leading-relaxed mb-3">
            Twelve blocks, from purpose to impact, that a group can talk through together: who decides, how conflict is
            held, how resources move. The workbook prints each block on its own page with room to write, and it can be
            saved as a Markdown file too.
          </p>
          <p className="text-sm text-stone-600 mb-4">
            The canvas is the{" "}
            <a href={CANVAS_CREDIT.url} target="_blank" rel="noreferrer" className="underline hover:text-teal-deep">
              {CANVAS_CREDIT.text}
            </a>
            .
          </p>
          <Link
            href="/canvas/workbook"
            className="inline-flex items-center gap-2 text-teal-deep font-semibold hover:text-teal transition-colors"
          >
            Open the canvas workbook <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
      )}

      {/* Hypha: drawn only while this village has a Hypha space to describe. */}
      {showHypha && (
      <section className="bg-white py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-4">
            <Network className="w-6 h-6 text-teal-deep shrink-0" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep break-words min-w-0">
              {hyphaSection.fields.heading}
            </h2>
          </div>
          <p className="text-stone-700 leading-relaxed mb-4 break-words">
            <Emphasized text={hyphaSection.fields.body} />
          </p>
          {storyShown("/co-creators-guide") && (
            <Link
              href="/co-creators-guide"
              className="inline-flex items-center gap-2 text-teal-deep font-semibold hover:text-teal transition-colors"
            >
              {hyphaSection.fields.linkLabel} <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </section>
      )}
      {!hyphaSection.hidden && <HyphaAdminNote />}

      {/* CTA. Both of its doors are brochure pages, so it goes with them,
          and each door goes with its own page when that one is off alone. */}
      {(storyShown("/steward") || storyShown("/love-letter")) && !cta.hidden && (
      <section className="bg-teal-deep text-white py-20">
        <div className="container max-w-3xl mx-auto px-4 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4 break-words">
            {cta.fields.heading}
          </h2>
          {cta.fields.body && (
          <p className="text-white/80 mb-8 break-words">
            <Emphasized text={cta.fields.body} />
          </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3">
            {storyShown("/steward") && (
              <Link
                href="/steward"
                className="inline-flex items-center gap-2 bg-amber text-foreground font-semibold px-6 py-3 rounded-xl hover:bg-amber/90 transition-colors"
              >
                {cta.fields.stewardLabel} <ArrowRight className="w-4 h-4" />
              </Link>
            )}
            {storyShown("/love-letter") && (
              <Link
                href="/love-letter"
                className="inline-flex items-center gap-2 bg-white/10 text-white font-semibold px-6 py-3 rounded-xl hover:bg-white/20 transition-colors border border-white/20"
              >
                {cta.fields.commitmentLabel}
              </Link>
            )}
          </div>
        </div>
      </section>
      )}
    </Layout>
  );
}
