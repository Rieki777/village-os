/**
 * "ASK SERA FOR A FIRST DRAFT" on a proposal, one door (joining lane PR 5).
 *
 *   POST /api/governance/proposal-drafts   { kind, roles, why, aim }
 *
 * It rides the road every guide surface already uses: a signed-in member, the
 * guide they chose (`guideStateFor`: Sera through `seraGuideAsk`, or the
 * village's own), the engine's burst guard and day budget, and the member's
 * own key when they have one. Registered from routes/roleGuide.ts, behind the
 * governance module, so server/index.ts gains no line.
 *
 * WHO CAN ASK. A signed-in member, or a signed-in visitor on the open form:
 * both reach the guide the same way. A visitor with no account has no guide
 * choice, no rate-limit identity and no key to spend, so there is no road for
 * them and the form draws no button (it works without it).
 *
 * WHAT GOES TO THE MODEL. Only `forAssistants(body)` (shared/proposalAbout.ts:
 * roles, why, aim), the roles' public card words read here from the org chart,
 * and the season's goals for the village. The route is the one place that
 * names the proposal allow-list; the prompt file stays clear of it
 * (server/lib/seraDrafts.ts is scanned by proposalAbout.privacy.test.ts).
 *
 * NOTHING IS STORED. The reply goes back to the asker's page alone. Not the
 * words sent, not the draft, not which part was drafted: the page marks a draft
 * until it is kept, and the intake never hears of it.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { DEFAULT_ASSISTANT_MODEL, callAssistant, type AssistantResult } from "../lib/assistant";
import { resolveMemberKey } from "../lib/memberSecrets";
import { listOrgRoles } from "../lib/orgChart";
import { draftBrief, draftSystem, readDraft, type DraftRole } from "../lib/seraDrafts";
import { seraGuideAsk } from "../lib/seraGuideCall";
import { guideStateFor } from "./guideChoice";
import { guidePromptName } from "@shared/guideName";
import { civilDateKey } from "@shared/lunar";
import { OPEN_AIM_MAX } from "@shared/openProposals";
import { ABOUT_STORY_MAX, forAssistants } from "@shared/proposalAbout";
import { GOAL_LIMITS } from "@shared/proposalGoals";
import { DRAFT_KINDS, DRAFT_WORDS, type DraftKind, type DraftReply } from "@shared/seraDrafts";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "clientIp" | "overLimit" | "seasonState"> & {
  villageGuideName: () => string;
  villageName: () => string;
  noteUsage: (pool: any, call: AssistantResult, userId: string) => Promise<void>;
};

const HOUR_MS = 60 * 60 * 1000;
const TURNS_PER_HOUR = 12;
const TURNS_PER_DAY = 30;
const ROLES_MAX = 5;
const SEASON_GOALS_MAX = 12;

const dayBucket = (uid: string): string => `proposal-drafts-day:${uid}:${new Date().toISOString().slice(0, 10)}`;
const UNAVAILABLE = { error: DRAFT_WORDS.unavailable };

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, clientIp, overLimit, seasonState, villageGuideName, villageName, noteUsage } = deps;

  /** The goals of the season a proposal is for: the next one when there is one, else the one running. Done goals drop off. */
  const seasonGoals = (): string[] => {
    const state = seasonState();
    const today = civilDateKey(new Date(), state.timezone || "UTC");
    const all = (state.seasons ?? []).filter((s: any) => s && s.id && s.startsOn);
    const next = [...all].sort((a: any, b: any) => String(a.startsOn).localeCompare(String(b.startsOn))).find((s: any) => String(s.startsOn) > today);
    const season = next ?? all.find((s: any) => state.current && String(s.id) === String(state.current.id)) ?? null;
    return (Array.isArray(season?.goals) ? season.goals : [])
      .filter((g: any) => g && typeof g.text === "string" && g.text.trim() && !g.done)
      .map((g: any) => String(g.text).trim())
      .slice(0, SEASON_GOALS_MAX);
  };

  app.post("/api/governance/proposal-drafts", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const uid = String(user.id);
    const kind: DraftKind | null = DRAFT_KINDS.includes(req.body?.kind) ? req.body.kind : null;
    if (!kind) return res.status(400).json({ error: "Ask for the aim, the goals or the story line." });
    if (await overLimit(`proposal-drafts:${uid}`, TURNS_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of asking in an hour. The guide rests for a little while, and your form works without it." });
    }

    const state = guideStateFor(user, user.prefs?.guide, villageGuideName());
    const answering = state.options.find((o) => o.id === state.answering);
    const sera = state.answering === "saberra" ? seraGuideAsk() : null;
    if (!answering || (state.answering === "saberra" && !sera)) return res.status(503).json(UNAVAILABLE);

    const pool = getPool();
    const memberKey = await resolveMemberKey(pool, uid);
    if (!memberKey && (await overLimit(dayBucket(uid), TURNS_PER_DAY, 24 * HOUR_MS))) {
      return res.status(429).json({ error: "You have asked the guide a lot today. It rests until tomorrow, and your form works without it." });
    }

    // THE ONE DOOR: of everything the page sent, only the allow-listed fields go on.
    const candidate = forAssistants(req.body);
    const asked = (Array.isArray(candidate.roles) ? candidate.roles : [])
      .map((r: any) => ({ roleId: String(r?.roleId ?? "").trim(), ...(typeof r?.note === "string" && r.note.trim() ? { note: r.note.trim().slice(0, 600) } : {}) }))
      .filter((r) => r.roleId)
      .slice(0, ROLES_MAX);
    candidate.roles = asked;
    candidate.why = typeof candidate.why === "string" ? candidate.why.slice(0, 1200) : "";
    candidate.aim = typeof candidate.aim === "string" ? candidate.aim.slice(0, OPEN_AIM_MAX) : "";

    const chart = await listOrgRoles(pool);
    const roles: DraftRole[] = asked
      .map((a) => chart.find((r) => r.id === a.roleId && r.active))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({
        id: r.id,
        name: r.name,
        aim: r.aim ?? null,
        goals: Array.isArray(r.accountabilities) ? r.accountabilities.map((a: unknown) => String(a ?? "").trim()).filter(Boolean) : [],
      }));
    if (roles.length === 0) return res.status(400).json({ error: "Pick the role you are proposing for first." });

    const call = await callAssistant({
      mode: "roleGuide",
      system: draftSystem(kind, sera ? answering.name : guidePromptName(villageGuideName()), villageName()),
      messages: [{ role: "user", content: "Write the first draft." }],
      model: DEFAULT_ASSISTANT_MODEL,
      clientIp: clientIp(req),
      burstKey: `assist-proposal-drafts:${uid}`,
      burstPerHour: TURNS_PER_HOUR,
      userId: uid,
      prefetch: [{ key: "proposal.draft", data: draftBrief({ kind, roles, seasonGoals: seasonGoals(), candidate }) }],
      memberKey,
      sera,
    });
    await noteUsage(pool, call, uid);
    if (!call.ok) return res.status(call.status).json(UNAVAILABLE);

    const read = readDraft(kind, call.text, roles, { aim: OPEN_AIM_MAX, title: GOAL_LIMITS.title, doneWhen: GOAL_LIMITS.doneWhen, story: ABOUT_STORY_MAX });
    if (!read) return res.status(200).json({ guide: { id: answering.id, name: answering.name }, note: state.note, kind } satisfies DraftReply);
    const out: DraftReply = {
      guide: { id: answering.id, name: answering.name },
      note: state.note,
      kind,
      ...(read.kind === "aim" ? { aim: read.aim } : read.kind === "story" ? { story: read.story } : { goals: read.goals }),
    };
    res.json(out);
  });
}
