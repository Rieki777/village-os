/**
 * Where a `pick` field's options come from.
 *
 * The wizard config names a source ("seats", "badges", …) and never a URL, so
 * a proposal type is declared in one place and the plumbing lives in one
 * other. That separation is what makes the config readable by somebody who
 * does not know this codebase.
 *
 * EVERY SOURCE DEGRADES TO AN EMPTY LIST. A village with no badges module on,
 * or no seats declared yet, gets a picker that says there is nothing to pick
 * rather than a spinner that never resolves or an error card in the middle of
 * a wizard. The step still renders and the member can still go back.
 *
 * Members are a SEARCH rather than a list: the platform has no route that
 * hands out every member, on purpose, and building one for a picker would be
 * the wrong trade.
 */
import { authToken } from "@/lib/gameApi";
import type { PickSource } from "./wizardConfig";

export interface PickOption {
  value: string;
  label: string;
  /** A second line under the label. Optional everywhere. */
  hint?: string;
  /** Seats only: every place is held (red team U4). */
  full?: boolean;
  /** Seats only: who holds it, when the reader may see names. */
  holderIds?: string[];
}

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * THE ROLES WITH POWERS (`/api/roles`), ONE READ SHARED BY EVERY ASKER.
 *
 * The "roles" picker below and the wizard's live preview of the picked role
 * (`WizardRolePreview`) both read this list, and the review step names the
 * picked role from it. One loader is what keeps them from becoming twins that
 * fetch twice and drift apart: the preview can never draw a role the picker
 * did not offer under that name.
 *
 * The answer is tiered (holder names ride `map.viewPeople`), so a different
 * session asks again, and a read older than a minute is asked again, so a
 * wizard left open does not preview a role as it stood an hour ago. A failed
 * read is dropped at once, so the next asker tries again instead of
 * inheriting the failure. Null when the list cannot be had.
 */
const ROLES_FRESH_MS = 60_000;
let rolesRead: { token: string | null; at: number; list: Promise<any[] | null> } | null = null;

export function loadPermissionRoles(): Promise<any[] | null> {
  const token = authToken();
  if (!rolesRead || rolesRead.token !== token || Date.now() - rolesRead.at > ROLES_FRESH_MS) {
    const entry = {
      token,
      at: Date.now(),
      list: getJson<unknown>("/api/roles").then((r) => (Array.isArray(r) ? r : null)),
    };
    rolesRead = entry;
    entry.list.then((r) => {
      if (r === null && rolesRead === entry) rolesRead = null;
    });
  }
  return rolesRead.list;
}

/**
 * THE ORG CHART (`/api/org`), ONE READ SHARED BY EVERY ASKER, on the same
 * terms as `loadPermissionRoles` above: the "seats" and "circles" pickers and
 * the wizard's live seat preview (`WizardSeatPreview`) read this one answer,
 * so the preview can never draw a seat the picker did not offer under that
 * name. Tiered by session, asked again after a minute, and a failed read is
 * dropped at once. Null when the chart cannot be had.
 */
let orgRead: { token: string | null; at: number; body: Promise<any | null> } | null = null;

export function loadOrg(): Promise<any | null> {
  const token = authToken();
  if (!orgRead || orgRead.token !== token || Date.now() - orgRead.at > ROLES_FRESH_MS) {
    const entry = { token, at: Date.now(), body: getJson<any>("/api/org") };
    orgRead = entry;
    entry.body.then((r) => {
      if (r === null && orgRead === entry) orgRead = null;
    });
  }
  return orgRead.body;
}

/** A role as the picker offers it, and so as the review step names it. */
const roleOption = (r: any): PickOption => ({
  value: String(r.id),
  label: String(r.name ?? r.id),
  hint: r.description ? String(r.description).slice(0, 120) : undefined,
});

/** The whole list for a source, or an empty list when it cannot be had. */
export async function loadPickOptions(source: PickSource): Promise<PickOption[]> {
  switch (source) {
    case "seats": {
      const org = await loadOrg();
      return (org?.roles ?? [])
        .filter((r: any) => !r.isExample)
        .map((r: any) => ({
          value: String(r.id),
          label: String(r.title ?? r.name ?? r.id),
          hint: r.recruiting ? "recruiting" : r.circleName ? String(r.circleName) : undefined,
          full: r.state === "filled",
          holderIds: Array.isArray(r.holders) ? r.holders.map((h: any) => String(h?.userId ?? "")).filter(Boolean) : [],
        }));
    }
    case "circles": {
      const org = await loadOrg();
      return (org?.circles ?? [])
        .filter((c: any) => !c.isExample && c.status !== "retired")
        .map((c: any) => ({ value: String(c.id), label: String(c.name), hint: c.purpose ?? undefined }));
    }
    case "badges": {
      const badges = await getJson<any>("/api/badges");
      const list = Array.isArray(badges) ? badges : (badges?.badges ?? []);
      return list
        .filter((b: any) => !b.isExample && b.active !== false)
        .map((b: any) => ({ value: String(b.id), label: String(b.name), hint: b.kind ?? undefined }));
    }
    case "quests": {
      const quests = await getJson<any>("/api/quests");
      const list = Array.isArray(quests) ? quests : (quests?.quests ?? []);
      return list
        .filter((q: any) => !q.isExample)
        .map((q: any) => ({ value: String(q.id), label: String(q.title ?? q.name ?? q.id), hint: q.status ?? undefined }));
    }
    case "tokens": {
      const exchange = await getJson<any>("/api/exchange");
      return (exchange?.listings ?? [])
        .filter((t: any) => !t.isExample)
        .map((t: any) => ({ value: String(t.slug), label: String(t.name), hint: t.kind ?? undefined }));
    }
    case "powers": {
      /*
       * The powers this village could take on, straight from the registry the
       * gate itself reads.
       *
       * `movable` is the platform's own answer to "can this key ever leave the
       * admin panel", and filtering on it here is what stops the wizard
       * walking a member five steps toward a transfer the route would refuse.
       * The hint is the consequence sentence, which is written on the
       * principle that these say what a holder could DO and never the key.
       *
       * A power the village already holds is left OUT: the ask has already
       * been answered, and offering it again would produce a ceremony about
       * nothing.
       */
      const payload = await getJson<any>("/api/village/powers");
      return (payload?.powers ?? [])
        .filter((p: any) => p.movable === true && !p.heldBy)
        .map((p: any) => ({
          value: String(p.capability),
          label: String(p.title ?? p.capability),
          hint: p.consequence ? String(p.consequence) : undefined,
        }));
    }
    case "grantablePowers": {
      /*
       * The powers the village could vote onto a role.
       *
       * `movable` and nothing else. It deliberately does NOT drop a power the
       * village already holds, which is the one way this list differs from
       * `powers` above: holding `library.keep` through the stewards does not
       * make "should the gardeners be able to do this too" a settled
       * question, and a power that NO role carries is exactly the case the
       * runway exists for.
       *
       * The route refuses a role that already carries the power it was given,
       * and that refusal cannot be made here: which powers are already on a
       * role depends on the role, and the role is picked on the next field.
       * A picker that filtered on it would have to re-filter itself every
       * time the second answer changed, and would still be a guess about a
       * check the server owns.
       */
      const payload = await getJson<any>("/api/village/powers");
      return (payload?.powers ?? [])
        .filter((p: any) => p.movable === true)
        .map((p: any) => ({
          value: String(p.capability),
          label: String(p.title ?? p.capability),
          hint: p.consequence ? String(p.consequence) : undefined,
        }));
    }
    case "heldPowers": {
      /*
       * The powers this village is holding right now, which is the whole of
       * what a return ballot can name.
       *
       * `heldBy` is the server's own record of the holding, so a village
       * holding nothing gets an empty picker and the wizard says there is
       * nothing to pick. That is the honest state for a village that has not
       * taken anything on, and it needs no separate sentence: there is no way
       * back from somewhere you have not been.
       */
      const payload = await getJson<any>("/api/village/powers");
      return (payload?.powers ?? [])
        .filter((p: any) => !!p.heldBy)
        .map((p: any) => ({
          value: String(p.capability),
          label: String(p.title ?? p.capability),
          hint: p.heldBy?.roleName ? `${String(p.heldBy.roleName)} looks after it` : undefined,
        }));
    }
    case "roles": {
      /*
       * The roles that could hold a power. `/api/roles` serves the village's
       * SHAPE to anyone and the names of holders only behind map.viewPeople,
       * so a picker built on it never leaks who sits where.
       *
       * Example roles are out for the same reason they are everywhere else:
       * platform demo content in a village's own list of who looks after what
       * is indistinguishable from the village's own decision.
       */
      const roles = await loadPermissionRoles();
      return (roles ?? []).filter((r: any) => !r.isExample).map(roleOption);
    }
    case "members":
      // Searched, never listed. See searchMembers below.
      return [];
    default:
      return [];
  }
}

/** True when this source is searched rather than listed. */
export const isSearchSource = (source: PickSource): boolean => source === "members";

/** Member search: the platform's own two-character minimum, ten at a time. */
export async function searchMembers(query: string): Promise<PickOption[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const people = await getJson<any[]>(`/api/messages/people?q=${encodeURIComponent(q)}`);
  return (people ?? []).map((p) => ({
    value: String(p.userId),
    label: String(p.name),
    hint: p.handle ? `@${p.handle}` : undefined,
  }));
}

/** What the review step prints for a picked value it has an option list for. */
export const labelFor = (options: PickOption[], value: unknown): string =>
  options.find((o) => o.value === String(value ?? ""))?.label ?? String(value ?? "");
