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
 *
 * `?type=role_application&seat=<id>` opens "Apply for a seat" with that seat
 * picked (`roleApplicationStart`), the door a seat card's raised hand opens for
 * a member who reads terms.
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
import { WORLD } from "@/components/journey/look";
import { askedModuleId } from "@/components/modules/switchDoor";
import { roleApplicationStart } from "@/components/governance/roleApplicationType";
import { isDoor } from "@/components/governance/wizardDoor";
import { doorBackOf } from "@shared/seatApplyLinks";
import { useLingui } from "@lingui/react/macro";

/**
 * Where the door's back link goes: the `from` the role card or the board sent,
 * else the same-site page the browser came from, else the roles board.
 */
export function doorBack(search: string, referrer: string = typeof document === "undefined" ? "" : document.referrer): { href: string; card: boolean; circle: boolean } {
  return doorBackOf(search, referrer, typeof window === "undefined" ? "" : window.location.origin);
}

export default function Propose() {
  const { user } = useAuth();
  const { t } = useLingui();
  const modules = useModules();
  const governance = useModule("governance");
  const [askModuleId] = useState(() => askedModuleId(window.location.search));
  // `?type=role_application&seat=<id>`: a seat card's door, opening "Apply for a
  // seat" with that seat picked. Read once, for the reason the ask is.
  const [start] = useState(() => roleApplicationStart(window.location.search));

  if (askModuleId) return <Redirect to={`/modules/${encodeURIComponent(askModuleId)}#propose`} replace />;

  if (modules.loaded && !governance)
    return <ModuleGate moduleId="governance" name="Start a proposal" behind={PAGE_GATE_LINES.propose} />;

  // THE MEMBER DOOR (Rye, 10 Nov 2026): opened from a role card or the roles
  // board, it reads as applying for a role, and its back link returns there.
  const door = isDoor(start?.answers);
  const from = door ? doorBack(window.location.search) : null;
  const roleCount = Array.isArray(start?.answers?.seatIds) ? (start!.answers.seatIds as unknown[]).length : 0;

  return (
    <Layout>
      {/* The member door is the joining journey, so it stands in the sheet's world (docs/DESIGN_RULE.md); every other proposal keeps the page's own ground. */}
      <div className={door ? `${WORLD} py-2` : undefined}>
      <div className="container max-w-5xl px-4 py-8">
        {door && from ? (
          <Link
            href={from.href}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-door-back=""
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            {from.card ? t`Back to the role` : from.circle ? t`Back to the circle` : t`Back to the roles`}
          </Link>
        ) : (
          <Link
            href="/decisions"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Every decision
          </Link>
        )}

        {door ? (
          <>
            <h1 className="mt-3 font-display text-3xl font-bold text-foreground sm:text-4xl">
              {roleCount > 1 ? t`Propose for these roles` : t`Propose for a role`}
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground leading-relaxed">
              {t`Say what you would bring, which of the village's goals it serves, and whether the terms on offer suit you. Nothing is sent until you send it, and you can leave and come back to the same step.`}
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-3 font-display text-3xl font-bold text-foreground sm:text-4xl">Start a proposal</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground leading-relaxed">
              Nothing you write here is public until you publish it, and you can leave at any point and come back to the same step on any device.
            </p>
          </>
        )}

        <div className="mt-8">
          {user ? (
            <ProposalWizard start={start} leaveTo={from?.href ?? "/decisions"} />
          ) : (
            <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
              <h2 className="font-display text-2xl font-bold text-card-foreground">Sign in to write a proposal</h2>
              <p className="mx-auto mt-2 max-w-md text-muted-foreground leading-relaxed">
                A proposal carries your name, so this part opens for members.
              </p>
              {/* The one card of the four that SignInToSee could nearly
                  replace. It keeps its own because the back link to every
                  decision is this page's shape and a visitor who is not ready
                  to write a proposal should still be able to go and read one. */}
              <div className="mt-5">
                <SignInDoors next={`/propose${start ? window.location.search : ""}`} />
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </Layout>
  );
}
