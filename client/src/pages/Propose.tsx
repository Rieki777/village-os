/**
 * `/propose`: the wizard's page.
 *
 * A thin shell on purpose. The wizard is a component so the same walk can be
 * opened from a seat card, a badge, or a quest with its subject prefilled once
 * those lanes land, and a page that carried the logic would make that a
 * rewrite instead of a prop.
 *
 * THE FIRST OF THOSE HAS LANDED: `?module=<id>` opens the ask a member starts
 * from the module library. It is the same advisory screen the type step opens,
 * with the question already written, and it is not a draft, so the page's own
 * heading and promise change with it. "Nothing you write here is public until
 * you publish it" is true of the wizard walk and false of an ask, which opens
 * a vote the moment the button is pressed.
 *
 * THE SECOND: `?type=role_application&seat=<id>` opens "Apply for a seat" with
 * that seat picked (`roleApplicationStart`), the door a seat card's raised hand
 * opens for a member who reads terms.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import Layout from "@/components/Layout";
import ModuleGate, { SignInDoors } from "@/components/modules/ModuleGate";
import { PAGE_GATE_LINES } from "@/components/modules/gateCopy";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import ProposalWizard from "@/components/governance/ProposalWizard";
import ModuleAsk from "@/components/modules/ModuleAsk";
import { askedModuleId } from "@/components/modules/askDoor";
import { askHref } from "@/components/modules/ModuleAskDoor";
import { roleApplicationStart } from "@/components/governance/roleApplicationType";

export default function Propose() {
  const { user } = useAuth();
  const modules = useModules();
  const governance = useModule("governance");
  // Read once. A member does not change this without a navigation, and a
  // re-read on every render would rebuild the ask mid-typing.
  const [askModuleId] = useState(() => askedModuleId(window.location.search));
  // `?type=role_application&seat=<id>`: a seat card's door, opening "Apply for a
  // seat" with that seat picked. Read once, for the reason the ask is.
  const [start] = useState(() => roleApplicationStart(window.location.search));

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

        <h1 className="mt-3 font-display text-3xl font-bold text-stone-900 sm:text-4xl">
          {askModuleId ? "Ask the village" : "Start a proposal"}
        </h1>
        <p className="mt-2 max-w-2xl text-stone-600 leading-relaxed">
          {askModuleId
            ? "One question, put to the whole village on the roll it votes with. You write why you are asking."
            : "Nothing you write here is public until you publish it, and you can leave at any point and come back to the same step on any device."}
        </p>

        <div className="mt-8">
          {user ? (
            askModuleId ? (
              <ModuleAsk moduleId={askModuleId} />
            ) : (
              <ProposalWizard start={start} />
            )
          ) : (
            <div className="rounded-xl border border-stone-200 bg-white p-8 text-center">
              <h2 className="font-display text-2xl font-bold text-stone-900">
                {askModuleId ? "Sign in to ask the village" : "Sign in to write a proposal"}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-stone-600 leading-relaxed">
                {askModuleId
                  ? "An ask carries your name, so this part opens for members."
                  : "A proposal carries your name, so this part opens for members."}
              </p>
              {/* The one card of the four that SignInToSee could nearly
                  replace. It keeps its own because the back link to every
                  decision is this page's shape and a visitor who is not ready
                  to write a proposal should still be able to go and read one. */}
              <div className="mt-5">
                {/* Back to the ask they came for, not to a blank wizard. */}
                <SignInDoors next={askModuleId ? askHref(askModuleId) : `/propose${start ? window.location.search : ""}`} />
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
