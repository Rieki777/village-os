/**
 * The import's calls, in the order they go, through doors that already exist.
 *
 * shared/regenImport.ts builds every body; this file only sends them and says
 * what came back. The order is the one that header gives: the needs first,
 * because a seat can only be tagged with a need the village has taken on;
 * the org draft next, which writes nothing live until it is published; and
 * after the publish, the four kinds of call that need the seats and circles
 * to exist.
 *
 * A REFUSAL IS PRINTED AS RECEIVED. Every route here refuses in a whole
 * sentence, and `refusal` (./adminApi) picks it out. Nothing is paraphrased.
 *
 * THE NEEDS WRITE STOPS EVERYTHING AFTER IT. It is all or nothing on the
 * server, and the seats' tags depend on it, so a refused scope ends the load
 * there. A refused tag or declaration after a publish does not undo the
 * publish: it is listed, and the founder can do that one by hand.
 */
import type { LiveVillage } from "@shared/regenImport";
import {
  afterPublishFor,
  draftChangesFor,
  draftWordsFor,
  scopeBodyFor,
  type ImportChoices,
  type ImportPlan,
} from "@shared/regenImport";
import { decidesByLabel, needName } from "@shared/regenImport";
import { API_BASE, authHeaders, refusal } from "./adminApi";

export type StepKind = "needs" | "whole" | "draft" | "publish" | "decides" | "links" | "howChosen" | "forming" | "revert" | "withdraw";

export interface StepResult {
  kind: StepKind;
  label: string;
  ok: boolean;
  /** The server's own sentence when it refused, else what happened. */
  message: string;
}

export interface DraftPreview {
  lines: { reads: string; blocked: string | null }[];
  blocked: number;
}

/** The title every draft this screen makes starts with, so the screen can find its own again. */
export const IMPORT_DRAFT_PREFIX = "Started from ";

async function send(password: string, path: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: authHeaders(password, body === undefined ? {} : { "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: { error: "That did not reach the server. Nothing after it was sent." } };
  }
}

/** The village as the plan reads it. Each of the three reads has to answer, or there is nothing honest to compare against. */
export async function readLive(password: string): Promise<{ ok: true; live: LiveVillage } | { ok: false; error: string }> {
  const [scope, org, season] = await Promise.all([
    send(password, "/needs/scope", "GET"),
    send(password, "/org", "GET"),
    send(password, "/season", "GET"),
  ]);
  if (!scope.ok) return { ok: false, error: refusal(scope.json, "What this village is for could not be read, so the file cannot be compared against it yet.") };
  if (!org.ok) return { ok: false, error: refusal(org.json, "The org chart could not be read, so the file cannot be compared against it yet.") };
  const rows: any[] = Array.isArray(scope.json?.scope) ? scope.json.scope : [];
  const circles: any[] = Array.isArray(org.json?.circles) ? org.json.circles : [];
  const roles: any[] = Array.isArray(org.json?.roles) ? org.json.roles : [];
  const current = season.ok ? season.json?.current : null;
  return {
    ok: true,
    live: {
      scope: rows.map((r) => ({
        needKey: String(r.needKey),
        label: String(r.label ?? r.needKey),
        depthTarget: String(r.depthTarget ?? ""),
        breadthTargetPct: Number(r.breadthTargetPct ?? 100),
        retired: r.active === false || !!r.retiredAt,
      })),
      circles: circles.map((c) => ({
        id: String(c.id),
        name: String(c.name ?? c.id),
        status: String(c.status ?? "active"),
        isExample: !!c.isExample,
        aliases: Array.isArray(c.aliases) ? c.aliases.map(String) : [],
        decidesBy: c.decidesBy ? String(c.decidesBy) : null,
        decidesByGloss: c.decidesByGloss ? String(c.decidesByGloss) : null,
      })),
      seats: roles
        .filter((r) => !r.isExample)
        .map((r) => ({
          id: String(r.id),
          name: String(r.name ?? r.id),
          circleId: r.circleId ? String(r.circleId) : null,
          holders: (Array.isArray(r.holders) ? r.holders : []).map((h: any) => String(h?.name ?? "")).filter(Boolean),
        })),
      seasonEnds: !!(current && current.endsOn),
    },
  };
}

/** The drafts this screen made that nobody has published or withdrawn yet. */
export async function openImportDrafts(password: string): Promise<{ id: string; title: string; changes: number }[]> {
  const r = await send(password, "/admin/org/drafts", "GET");
  if (!r.ok || !Array.isArray(r.json)) return [];
  return r.json
    .filter((d: any) => d?.status === "open" && String(d?.title ?? "").startsWith(IMPORT_DRAFT_PREFIX))
    .map((d: any) => ({ id: String(d.id), title: String(d.title), changes: Array.isArray(d.changes) ? d.changes.length : 0 }));
}

export async function previewOf(password: string, draftId: string): Promise<DraftPreview | null> {
  const r = await send(password, `/admin/org/drafts/${encodeURIComponent(draftId)}/preview`, "GET");
  if (!r.ok) return null;
  const lines: any[] = Array.isArray(r.json?.lines) ? r.json.lines : [];
  return { lines: lines.map((l) => ({ reads: String(l.reads ?? ""), blocked: l.blocked ? String(l.blocked) : null })), blocked: Number(r.json?.blocked ?? 0) };
}

/**
 * Load what the founder kept, up to the draft. Nothing in the org chart is
 * live until the draft is published; the needs and the whole-village figure
 * are, because they describe and gate nothing.
 */
export async function loadKept(
  password: string,
  plan: ImportPlan,
  choices: ImportChoices,
): Promise<{ steps: StepResult[]; draftId: string | null; preview: DraftPreview | null; stopped: boolean }> {
  const steps: StepResult[] = [];
  const scope = scopeBodyFor(plan, choices);
  if (scope) {
    const r = await send(password, "/admin/needs/scope", "PUT", scope);
    const label = `${scope.needs.length} human need${scope.needs.length === 1 ? "" : "s"}`;
    if (!r.ok) {
      steps.push({ kind: "needs", label, ok: false, message: refusal(r.json, "The needs were not saved, so nothing after them was sent.") });
      return { steps, draftId: null, preview: null, stopped: true };
    }
    steps.push({ kind: "needs", label, ok: true, message: "Saved on What this village is for." });
  }
  if (choices.totality && plan.totality) {
    const r = await send(password, "/admin/variables/needs.totality_target_pct", "PUT", { value: plan.totality.pct });
    steps.push({
      kind: "whole",
      label: `${plan.totality.pct} percent of your people's human needs`,
      ok: r.ok,
      message: r.ok ? "Saved." : refusal(r.json, "That figure was not saved."),
    });
  }

  const changes = draftChangesFor(plan, choices);
  if (!changes.length) {
    // No draft to publish, so the calls that wait for one have nothing to wait for.
    steps.push(...(await finish(password, plan, choices)));
    return { steps, draftId: null, preview: null, stopped: false };
  }
  const words = draftWordsFor(plan.profile);
  const made = await send(password, "/admin/org/drafts", "POST", words);
  const draftId = made.ok && made.json?.id ? String(made.json.id) : null;
  if (!draftId) {
    steps.push({ kind: "draft", label: words.title, ok: false, message: refusal(made.json, "The draft could not be made. Nothing in your org chart changed.") });
    return { steps, draftId: null, preview: null, stopped: true };
  }
  for (const c of changes) {
    const r = await send(password, `/admin/org/drafts/${encodeURIComponent(draftId)}/changes`, "POST", c);
    if (!r.ok) {
      const why = refusal(r.json, "A line of the draft was refused.");
      const gone = await send(password, `/review/drafts/${encodeURIComponent(draftId)}/withdraw`, "POST", {});
      steps.push({
        kind: "draft",
        label: words.title,
        ok: false,
        message: gone.ok
          ? `${why} The half-made draft was withdrawn, so nothing in your org chart changed.`
          : `${why} Nothing in your org chart changed. The half-made draft is still open, listed above as a draft from an earlier load: withdraw it there.`,
      });
      // Never the draft on screen: a half-made draft is withdrawn, never published.
      return { steps, draftId: null, preview: null, stopped: true };
    }
  }
  steps.push({ kind: "draft", label: words.title, ok: true, message: `${changes.length} line${changes.length === 1 ? "" : "s"}, waiting for you to read and publish.` });
  return { steps, draftId, preview: await previewOf(password, draftId), stopped: false };
}

/** Publish the draft, then everything that needed its seats and circles to exist. */
export async function publishAndFinish(
  password: string,
  plan: ImportPlan | null,
  choices: ImportChoices | null,
  draftId: string,
): Promise<StepResult[]> {
  const r = await send(password, `/admin/org/drafts/${encodeURIComponent(draftId)}/publish`, "POST", {});
  if (!r.ok) return [{ kind: "publish", label: "The draft", ok: false, message: refusal(r.json, "The draft was not published. Nothing in your org chart changed.") }];
  const steps: StepResult[] = [{ kind: "publish", label: "The draft", ok: true, message: `Published: ${Number(r.json?.applied ?? 0)} change${Number(r.json?.applied) === 1 ? "" : "s"} applied at once.` }];
  if (plan && choices) steps.push(...(await finish(password, plan, choices)));
  return steps;
}

async function finish(password: string, plan: ImportPlan, choices: ImportChoices): Promise<StepResult[]> {
  const live = await readLive(password);
  const liveScope = live.ok ? live.live.scope.filter((s) => !s.retired).map((s) => s.needKey) : [];
  const after = afterPublishFor(plan, choices, liveScope);
  const steps: StepResult[] = [];
  for (const d of after.decides) {
    const body = d.decidesBy === "other" ? { decidesBy: d.decidesBy, decidesByGloss: d.decidesByGloss } : { decidesBy: d.decidesBy };
    const r = await send(password, `/org/circles/${encodeURIComponent(d.circleId)}/decides`, "PUT", body);
    steps.push({ kind: "decides", label: `${d.circleName} decides: ${decidesByLabel(d.decidesBy, d.decidesByGloss)}`, ok: r.ok, message: r.ok ? "Declared." : refusal(r.json, "Not declared.") });
  }
  for (const l of after.links) {
    const { seatName, ...body } = l;
    const r = await send(password, "/admin/needs/links", "POST", body);
    const need = needName(l.needKey, plan.needs.concat(plan.ownNeeds).find((n) => n.needKey === l.needKey)?.label);
    steps.push({ kind: "links", label: `${seatName} meets ${need}`, ok: r.ok, message: r.ok ? "Tagged." : refusal(r.json, "Not tagged.") });
  }
  for (const h of after.howChosen) {
    const r = await send(password, `/admin/org/roles/${encodeURIComponent(h.seatId)}`, "PUT", { howChosen: h.howChosen });
    steps.push({ kind: "howChosen", label: `${h.seatName}: how its next holder is chosen`, ok: r.ok && r.json?.success !== false, message: r.ok ? "Set." : refusal(r.json, "Not set.") });
  }
  for (const f of after.forming) {
    const r = await send(password, `/admin/circles/${encodeURIComponent(f.circleId)}`, "PUT", { status: "forming" });
    steps.push({ kind: "forming", label: `${f.circleName} is forming`, ok: r.ok, message: r.ok ? "Marked forming." : refusal(r.json, "Not changed.") });
  }
  return steps;
}

export async function revertImportDraft(password: string, draftId: string): Promise<StepResult> {
  const r = await send(password, `/admin/org/drafts/${encodeURIComponent(draftId)}/revert`, "POST", {});
  return { kind: "revert", label: "The draft", ok: r.ok, message: r.ok ? "Reverted. What was there before it is back, and the seats it made are resting." : refusal(r.json, "The draft was not reverted.") };
}

export async function withdrawImportDraft(password: string, draftId: string): Promise<StepResult> {
  const r = await send(password, `/review/drafts/${encodeURIComponent(draftId)}/withdraw`, "POST", {});
  return { kind: "withdraw", label: "The draft", ok: r.ok, message: r.ok ? "Withdrawn. Nothing in it was applied." : refusal(r.json, "The draft was not withdrawn.") };
}
