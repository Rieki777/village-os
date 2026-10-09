/**
 * THE MEMBER'S VIEW OF THE VILLAGE'S EMAIL (the comms build spec 5.13): every
 * journey with whether it is on, its steps and their timing, each email's
 * words rendered with sample data, and the comms dials. Read-only; the shapes
 * and the "Propose a change" doors are in shared/comms/memberView.ts.
 *
 * THE WORDS ARE THE VILLAGE'S OWN. Each email renders through the same
 * `renderTemplate` the post office's callers use, so a member reads exactly
 * the words the village sends, with the reader's own first name in the
 * greeting and sample facts everywhere else (a sample gathering, a sample
 * path contact). Nothing personal about anybody else is ever put in.
 *
 * A template that cannot render shows the step with no email, and the page
 * says so. One broken email must not hide the rest of the village's mail.
 */
import type { JourneyKind } from "../../../shared/comms/contracts";
import { templateGroups, templateLabel } from "../../../shared/comms/defaults/templates";
import { CONDITION_LABELS, STOP_LABELS, timingLabel } from "../../../shared/comms/journeySteps";
import { sampleValues } from "../../../shared/comms/mergeFields";
import type { MemberCommsView, MemberDialView, MemberEmailView } from "../../../shared/comms/memberView";
import { GAME_CONFIG } from "../../../shared/gameConfig";
import { ringOf, VARIABLES_BY_KEY } from "../../../shared/gameVariables";
import { allVariables } from "../variables";
import { allJourneyStatuses, villagePathIds } from "./journeyDefinitions";
import { derivedValues, loadEmailVillage, renderTemplate, type RenderContext } from "./render";
import type { Pool } from "mysql2/promise";

export interface MemberViewDeps {
  getPool(): Pool;
  /** The village's own site, for the links inside the sample emails. */
  origin(): string;
  /** The comms dials with their current values. Absent: the game variables. Tests pass their own. */
  dials?(): Array<{ key: string; value: string; isDefault: boolean }>;
}

/** What a journey is called: a path by its own name, everything else by its Words group. */
export function journeyTitle(key: string): string {
  const pathId = key.match(/^path\.([a-z0-9-]+)$/)?.[1];
  const path = pathId ? GAME_CONFIG.paths.find((p) => p.id === pathId) : undefined;
  if (path) return `${path.label} path`;
  return templateGroups(villagePathIds()).find((g) => g.journeyKey === key)?.title ?? key;
}

/** One email, rendered with sample data for the reader. Null when it cannot render. */
async function sampleEmail(templateKey: string, firstName: string, ctx: RenderContext): Promise<MemberEmailView | null> {
  const derived = derivedValues(templateKey, ctx.village.url);
  const vars = sampleValues({
    villageUrl: ctx.village.url,
    firstName,
    fullName: firstName,
    pathUrl: typeof derived["path.pageUrl"] === "string" ? derived["path.pageUrl"] : null,
  });
  try {
    const email = await renderTemplate(templateKey, vars, ctx);
    return { templateKey, label: templateLabel(templateKey), subject: email.subject, preheader: email.preheader, text: email.text };
  } catch (err) {
    console.error(`[comms] the member view could not render ${templateKey}`, err);
    return null;
  }
}

/** The comms dials, read-only, each with the door its proposal goes through. */
export function commsDials(deps: Pick<MemberViewDeps, "dials">): MemberDialView[] {
  const values = deps.dials ? deps.dials() : allVariables().map((v) => ({ key: v.key, value: v.value, isDefault: v.isDefault }));
  return values
    .filter((v) => v.key.startsWith("comms."))
    .flatMap((v) => {
      const def = VARIABLES_BY_KEY[v.key];
      if (!def) return [];
      return [
        {
          key: def.key,
          label: def.label,
          description: def.description,
          value: v.value,
          defaultValue: def.default,
          unit: def.unit ?? null,
          isDefault: v.isDefault,
          // The village votes on an open dial through Game Mechanics; a
          // founder-held one has no vote to open, so it is asked for instead.
          door: ringOf(def) === "open" ? "mechanics" : "submission",
        } satisfies MemberDialView,
      ];
    });
}

/** Everything the member page shows, greeting the reader by their first name. */
export async function buildMemberView(deps: MemberViewDeps, reader: { firstName: string }): Promise<MemberCommsView> {
  const pool = deps.getPool();
  const village = await loadEmailVillage(pool, deps.origin());
  const ctx: RenderContext = { getPool: deps.getPool, village };
  const firstName = reader.firstName.trim() || "Sam";
  const statuses = await allJourneyStatuses({ getPool: deps.getPool });

  const journeys = [];
  for (const s of statuses) {
    const def = s.definition;
    const steps = [];
    for (const step of def.steps) {
      steps.push({
        key: step.key,
        label: templateLabel(step.templateKey),
        timing: timingLabel(def.kind as JourneyKind, step),
        skipIf: step.skipIf.map((c) => CONDITION_LABELS[c] ?? c),
        email: await sampleEmail(step.templateKey, firstName, ctx),
      });
    }
    journeys.push({ key: s.key, title: journeyTitle(s.key), state: s.state, stops: def.stops.map((k) => STOP_LABELS[k] ?? k), steps });
  }

  const others = [];
  for (const group of templateGroups(villagePathIds()).filter((g) => g.journeyKey === null)) {
    const emails: MemberEmailView[] = [];
    for (const key of group.keys) {
      const email = await sampleEmail(key, firstName, ctx);
      if (email) emails.push(email);
    }
    others.push({ title: group.title, emails });
  }

  return { journeys, others, dials: commsDials(deps) };
}

/** True when a key names something the member page shows: a journey, an email, or a comms dial. */
export async function knownTarget(
  deps: Pick<MemberViewDeps, "getPool">,
  target: "journey" | "step" | "words" | "dial",
  key: string,
  step: string | null,
): Promise<boolean> {
  if (target === "dial") return key.startsWith("comms.") && Boolean(VARIABLES_BY_KEY[key]);
  if (target === "words") return templateGroups(villagePathIds()).some((g) => g.keys.includes(key));
  const status = (await allJourneyStatuses({ getPool: deps.getPool })).find((s) => s.key === key);
  if (!status) return false;
  return target === "journey" || status.definition.steps.some((s) => s.key === step);
}
