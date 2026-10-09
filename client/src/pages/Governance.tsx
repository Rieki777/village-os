import Layout from "@/components/Layout";
import { useVillageName } from "@/hooks/useVillageName";
import { Link } from "wouter";
import LiveDecisionsBand from "@/components/governance/LiveDecisionsBand";
import ConflictAgreementPublic from "@/components/canvas/ConflictAgreementPublic";
import CanvasPublicLines from "@/components/canvas/CanvasPublicLines";
import DecisionMatrix from "@/components/canvas/DecisionMatrix";
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
import { CANVAS_CREDIT } from "@shared/governanceCanvasText";
import { CANVAS_PUBLIC_MATRIX_PATH } from "@shared/canvasPublicLines";
import { useBrochurePages } from "@/lib/brochure";

const PRINCIPLES = [
  {
    icon: CheckCircle2,
    title: "Consent over consensus",
    body:
      "We don't need everyone to love a decision. We need no one to have a serious objection. This keeps us moving without demanding perfection.",
  },
  {
    icon: Users,
    title: "Circles, not hierarchy",
    body:
      "Decisions are made in the circle closest to the work. The Development Circle governs the build. The Community Circle governs the human experience. No top-down override.",
  },
  {
    icon: Eye,
    title: "Transparency by default",
    body:
      "Meeting notes, decisions, and proposals are recorded and accessible to all members. Nothing happens in secret.",
  },
];

const DECISION_STEPS = [
  { Icon: Lightbulb, text: "Someone senses a tension or opportunity." },
  { Icon: MessageSquare, text: "They bring a proposal to their circle." },
  { Icon: Users, text: "The circle discusses, amends, and tests for consent." },
  { Icon: CheckCircle2, text: "If no one has a paramount objection, the proposal passes." },
  { Icon: Eye, text: "The decision is logged and published." },
];

/**
 * HOW WE WORK TOGETHER, at /governance (plan section 1, 2026-09-28).
 *
 * The page every fork already has, renamed for what it now holds: the
 * village's own account of how it works, block by block, from the Governance
 * Canvas. The route stays /governance so every link, bookmark and sitemap
 * entry keeps working; the heading, the menu label and the tab title say
 * "How we work together".
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
 */
export default function Governance() {
  const brochureOn = useBrochurePages() === true;
  const villageName = useVillageName();
  return (
    <Layout>
      {/* Hero */}
      <section className="bg-teal-band text-white py-20">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-3">
            <Vote className="w-6 h-6 text-amber-on-band" />
            <span className="text-amber-on-band font-medium text-sm tracking-widest uppercase">
              Governance
            </span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-4">
            How we work together
          </h1>
          {/* The sociocracy sentence is the first village's own story, so it
              goes with the brochure (audit of Wave 4). Every other village is
              told only what this page actually holds: its decision method is
              a dial, and nothing here may presume which one it chose. */}
          <p className="text-white text-lg max-w-3xl leading-relaxed">
            {brochureOn
              ? `${villageName} uses sociocracy, a consent-based governance system where every voice can influence decisions. While the systems are still finding their feet, members elect stewards who can veto a decision, and those same members can vote a steward out.`
              : `How ${villageName} works, part by part, who decides what, and where a conflict goes.`}
          </p>
        </div>
      </section>

      {/* The live votes, before any theory. This page used to explain how
          decisions get made and stop there, which left a member reading about
          governance while the village was holding a vote they never saw. The
          band renders nothing where the engine is off. */}
      <LiveDecisionsBand />

      {/* The canvas, one public line per block. Visitors read the lines; a
          signed-in member also opens the words kept for members. */}
      <section className="bg-stone-50 py-16">
        <div className="container max-w-5xl mx-auto px-4">
          <CanvasPublicLines />
        </div>
      </section>

      {/* Who decides what: the half of the canvas's Decision Matrix the
          platform writes from the rules it enforces. Read only, and from the
          PUBLIC door, which can serve nothing a village wrote. */}
      <section className="bg-white py-16">
        <div className="container max-w-5xl mx-auto px-4">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep mb-3">
            Who Decides What
          </h2>
          <p className="text-stone-700 leading-relaxed">
            Who approves each kind of decision, who is asked first, who is told, and how it is made. These answers come
            from the rules this village runs on today, so they change when the village changes them.
          </p>
          <DecisionMatrix src={CANVAS_PUBLIC_MATRIX_PATH} />
        </div>
      </section>

      {/* Core Principles */}
      <section className="bg-stone-50 py-20">
        <div className="container max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep">
              The Core Principles
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {PRINCIPLES.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.title}
                  className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6"
                >
                  <div className="w-12 h-12 rounded-xl bg-teal-deep/10 text-teal-deep flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-teal-deep mb-2">
                    {p.title}
                  </h3>
                  <p className="text-sm text-stone-600 leading-relaxed">{p.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How a decision gets made */}
      <section className="bg-white py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep mb-3">
              How a Decision Gets Made
            </h2>
            <p className="text-muted-foreground">
              Every decision follows the same simple path.
            </p>
          </div>
          <ol className="space-y-4">
            {DECISION_STEPS.map((s, i) => {
              const Icon = s.Icon;
              return (
                <li
                  key={i}
                  className="flex gap-4 items-start bg-stone-50 rounded-2xl border border-stone-200 px-5 py-4"
                >
                  <div className="shrink-0 w-10 h-10 rounded-full bg-teal-deep text-white flex items-center justify-center font-display font-bold">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <Icon className="w-5 h-5 text-teal-deep shrink-0" />
                    <p className="text-stone-700 leading-relaxed">{s.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Circles and their domains */}
      <section className="bg-sage/15 py-20">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="text-center mb-10">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep mb-3">
              Circles and Their Domains
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Authority lives close to the work. Each circle governs its domain and reports up only when something crosses boundaries.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            {[
              { name: "General Coordinating Circle", body: "Where the circles meet: the four leads and circle representatives, coordinating strategy, budget stewardship, and decisions that cross circle boundaries." },
              { name: "Outreach & Growth Circle", body: "Connects with people and guides their whole journey into the village: marketing, sales, social media, and membership & onboarding as one flow." },
              { name: "Community Circle", body: "The lived experience: events, hospitality, stays on the land, and the governance and team-health practices that keep the human systems honest." },
              { name: "Development Circle", body: "The physical realization: master planning, architecture, permitting, construction, land operations, and regenerative systems." },
              { name: "Finance & Business Circle", body: "Stewards the money and builds the engines that generate it: financial operations, the legal container, and business development." },
            ].map((c) => (
              <div key={c.name} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
                <h3 className="font-display text-lg font-semibold text-teal-deep mb-1.5">{c.name}</h3>
                <p className="text-sm text-stone-600 leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>
          <div className="text-center">
            <Link
              href="/circles"
              className="inline-flex items-center gap-2 text-teal-deep font-semibold hover:text-teal transition-colors"
            >
              See all circles in detail <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Conflict resolution: the village's conflict agreement, public with
          roles only, and before there is one the restorative steps of its
          published exit policy. This used to be three compiled paragraphs
          every fork published as its own practice, ending in a promise that
          nobody is removed without a circle consent vote, while removal is an
          admin act in the server. The reasoning is in VillageConflictSteps and
          ConflictAgreementPublic. */}
      <section className="bg-white py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-4">
            <Scale className="w-6 h-6 text-teal-deep" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep">
              Conflict Resolution
            </h2>
          </div>
          {/* THE ADOPTED CONFLICT AGREEMENT'S PUBLIC VIEW (plan 4.6 and 6.2), roles
              only. Before the village saves an agreement, or when it cannot be
              read, ConflictAgreementPublic prints the restorative steps of the
              published exit policy (VillageConflictSteps) in its place. */}
          <div data-testid="conflict-agreement-slot">
            <ConflictAgreementPublic />
          </div>
        </div>
      </section>

      {/* Stewards: the training wheels, and the fact that they come off.
          The hero used to say no single person holds veto power, which stopped
          being true the moment the engine shipped one. A member reading this
          page has to be able to find out who can stop a decision, how long they
          have, and what the village can do about it. */}
      <section className="bg-white py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-4">
            <ShieldCheck className="w-6 h-6 text-teal-deep" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep">
              Stewards, and Why They Are Temporary
            </h2>
          </div>
          <div className="space-y-4 text-stone-700 leading-relaxed">
            <p>
              The community votes stewards in. A steward holds a veto: once a major proposal passes, a steward has three days to stop it before it takes effect. That window exists so somebody with the whole picture can catch a decision that would cause harm or break something the village depends on.
            </p>
            <p>
              A veto is answerable. It is recorded with the steward's name and their stated reason, both visible to every member, so stopping a decision costs a steward something and cannot be done quietly.
            </p>
            <p>
              The community checks the stewards. Members who put a steward in can vote that steward out, and the settings governing stewards are the one thing no steward may veto, so a seat can never defend itself against the village that granted it.
            </p>
            <p>
              These are training wheels. Stewards exist while the systems are young and still being proven, and the village can lower or retire the role by vote once it no longer needs them.
            </p>
          </div>
        </div>
      </section>

      {/* How rules evolve */}
      <section className="bg-stone-50 py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-4">
            <RefreshCw className="w-6 h-6 text-teal-deep" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep">
              How Rules Evolve
            </h2>
          </div>
          <p className="text-stone-700 leading-relaxed">
            The agreements we launch with are not permanent. Any member can propose a change through their circle. Rules that no longer serve the community get amended or removed. Governance is alive; it grows with us.
          </p>
        </div>
      </section>

      {/* The Governance Canvas on paper: twelve questions a group can talk
          through about how it governs itself, printable by anyone, signed in
          or not. Credited wherever the canvas appears. */}
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

      {/* Hypha. Logging governance on Hypha is the first village's own
          arrangement: the Hypha bridge is an optional module that needs a DHO
          of the village's own, so on any other village this section was false
          (audit of Wave 4). It goes with the brochure. */}
      {brochureOn && (
      <section className="bg-white py-20">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-3 mb-4">
            <Network className="w-6 h-6 text-teal-deep" />
            <h2 className="font-display text-3xl md:text-4xl font-bold text-teal-deep">
              The Hypha Platform
            </h2>
          </div>
          <p className="text-stone-700 leading-relaxed mb-4">
            Governance is logged on Hypha, an open-source platform owned by its contributors. Every proposal, vote, and contribution is transparent and traceable. Value in, value out.
          </p>
          <Link
            href="/co-creators-guide"
            className="inline-flex items-center gap-2 text-teal-deep font-semibold hover:text-teal transition-colors"
          >
            Learn more in the Game Guide <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
      )}

      {/* CTA. Both of its doors are brochure pages, so it goes with them. */}
      {brochureOn && (
      <section className="bg-teal-deep text-white py-20">
        <div className="container max-w-3xl mx-auto px-4 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
            Ready to help govern?
          </h2>
          <p className="text-white/80 mb-8">
            Join the circle closest to your gifts and start shaping the village from the inside.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/steward"
              className="inline-flex items-center gap-2 bg-amber text-foreground font-semibold px-6 py-3 rounded-xl hover:bg-amber/90 transition-colors"
            >
              Become a Steward <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/love-letter"
              className="inline-flex items-center gap-2 bg-white/10 text-white font-semibold px-6 py-3 rounded-xl hover:bg-white/20 transition-colors border border-white/20"
            >
              Sign the Love Letter
            </Link>
          </div>
        </div>
      </section>
      )}
    </Layout>
  );
}
