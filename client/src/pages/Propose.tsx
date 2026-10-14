/**
 * `/propose`: the wizard's page.
 *
 * A thin shell on purpose. The wizard is a component so the same walk can be
 * opened from a seat card, a badge, or a quest with its subject prefilled once
 * those lanes land, and a page that carried the logic would make that a
 * rewrite instead of a prop.
 *
 * `?module=<id>` used to open an ADVISORY ask about turning a module on. Since
 * 2026-10-09 turning a module on is a binding village vote proposed from the
 * module's own page (client/src/components/modules/switchDoor.ts says why the
 * advisory door went), so an old ask link lands there instead.
 */
import { useState } from "react";
import { Link, Redirect } from "wouter";
import { ArrowLeft } from "lucide-react";
import Layout from "@/components/Layout";
import ModuleGate, { SignInDoors } from "@/components/modules/ModuleGate";
import { PAGE_GATE_LINES } from "@/components/modules/gateCopy";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import ProposalWizard from "@/components/governance/ProposalWizard";
import { askedModuleId } from "@/components/modules/switchDoor";

export default function Propose() {
  const { user } = useAuth();
  const modules = useModules();
  const governance = useModule("governance");
  const [askModuleId] = useState(() => askedModuleId(window.location.search));

  if (askModuleId) return <Redirect to={`/modules/${encodeURIComponent(askModuleId)}#propose`} replace />;

  if (modules.loaded && !governance)
    return <ModuleGate moduleId="governance" name="Start a proposal" behind={PAGE_GATE_LINES.propose} />;

  return (
    <Layout>
      <div className="container max-w-5xl px-4 py-8">
        <Link
          href="/decisions"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-teal-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Every decision
        </Link>

        <h1 className="mt-3 font-display text-3xl font-bold text-stone-900 sm:text-4xl">Start a proposal</h1>
        <p className="mt-2 max-w-2xl text-stone-600 leading-relaxed">
          Nothing you write here is public until you publish it, and you can leave at any point and come back to the same step on any device.
        </p>

        <div className="mt-8">
          {user ? (
            <ProposalWizard />
          ) : (
            <div className="rounded-xl border border-stone-200 bg-white p-8 text-center">
              <h2 className="font-display text-2xl font-bold text-stone-900">Sign in to write a proposal</h2>
              <p className="mx-auto mt-2 max-w-md text-stone-600 leading-relaxed">
                A proposal carries your name, so this part opens for members.
              </p>
              {/* The one card of the four that SignInToSee could nearly
                  replace. It keeps its own because the back link to every
                  decision is this page's shape and a visitor who is not ready
                  to write a proposal should still be able to go and read one. */}
              <div className="mt-5">
                <SignInDoors next="/propose" />
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
