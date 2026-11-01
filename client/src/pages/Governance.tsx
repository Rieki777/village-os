import Layout from "@/components/Layout";
import { Link } from "wouter";
import LiveDecisionsBand from "@/components/governance/LiveDecisionsBand";
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
} from "lucide-react";
import { useBrochurePages } from "@/lib/brochure";
import { useHypha } from "@/modules/ModuleProvider";
import { HyphaAdminNote } from "@/components/HyphaAdminNote";
import { usePageContent } from "@/hooks/usePageContent";
import { useVetoHours } from "@/hooks/useVetoHours";
import { Emphasized } from "@/components/PageText";
import { fillVars } from "@shared/pageContent/resolve";
import { GOVERNANCE_PAGE, VETO_HOURS_MIN, vetoWindowWords } from "@shared/pageContent/governance";

/** The icons the cards and steps take in turn, whatever the village wrote. */
const PRINCIPLE_ICONS = [CheckCircle2, Users, Eye];
const STEP_ICONS = [Lightbulb, MessageSquare, Users, CheckCircle2, Eye];

/** Paragraphs a village left blank are not drawn. */
const paragraphs = (...texts: string[]) => texts.filter((t) => t.trim() !== "");

export default function Governance() {
  const brochureOn = useBrochurePages() === true;
  // A Hypha section needs a Hypha space to describe: the village's switch AND its DHO link.
  const hypha = useHypha();
  // Every word on this page is the village's own, from Admin, Pages, How We
  // Govern (shared/pageContent/governance.ts). Null until the saved words
  // have arrived, so the defaults never flash first.
  const page = usePageContent(GOVERNANCE_PAGE);
  // The steward's window is the village's setting, never a typed "three
  // days". Unreadable, it is said as the floor every village shares.
  const vetoHours = useVetoHours();
  if (!page) {
    return (
      <Layout>
        <section className="min-h-[70vh]" aria-busy="true" />
      </Layout>
    );
  }
  const { hero, principles, decision, circles, conflict, stewards, rules, cta } = page;
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

      {/* Conflict resolution */}
      {!conflict.hidden && (
      <section className="bg-white py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-4">
            <Scale className="w-6 h-6 text-teal-deep shrink-0" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep break-words min-w-0">
              {conflict.fields.heading}
            </h2>
          </div>
          <div className="space-y-4 text-stone-700 leading-relaxed">
            {conflictParagraphs.map((text, i) => (
              <p key={i} className="break-words">
                <Emphasized text={text} />
              </p>
            ))}
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
          {brochureOn && (
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

      {/* CTA. Both of its doors are brochure pages, so it goes with them. */}
      {brochureOn && !cta.hidden && (
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
            <Link
              href="/steward"
              className="inline-flex items-center gap-2 bg-amber text-foreground font-semibold px-6 py-3 rounded-xl hover:bg-amber/90 transition-colors"
            >
              {cta.fields.stewardLabel} <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/love-letter"
              className="inline-flex items-center gap-2 bg-white/10 text-white font-semibold px-6 py-3 rounded-xl hover:bg-white/20 transition-colors border border-white/20"
            >
              {cta.fields.commitmentLabel}
            </Link>
          </div>
        </div>
      </section>
      )}
    </Layout>
  );
}
