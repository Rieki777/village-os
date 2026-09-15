/**
 * The tag on the work: what need does this quest, or this seat, meet?
 *
 * ── WHY A PICKER AND NOT A TEXT BOX (R1, R18) ────────────────────────────
 * A village says what it is for by taking on needs, and `village_needs` holds
 * that scope. A quest or a seat then says which of those it meets. Typing the
 * word would make a second key space nobody reconciles, so this offers the
 * scope the village actually adopted and nothing else. A need this village has
 * not taken on is refused by the server BY NAME, and the sentence it sends
 * back is printed here word for word.
 *
 * ── THE TEN COME FROM shared/needs.ts AND ARE NEVER RETYPED ───────────────
 * `GET /api/needs/scope` answers with the village's rows and with the platform
 * taxonomy beside them, and the hint line under each row is
 * `expressionsLine()` over the deck's own expressions. Nothing in this file
 * spells a need's name or its expressions, so a change to the taxonomy reaches
 * this screen with no edit here. The short word on the row is the village's
 * OWN stored label, which `village_needs` copies at adoption so a platform
 * rename cannot rewrite what a village said it was for.
 *
 * ── A TAG NEVER GATES A CLAIM ────────────────────────────────────────────
 * Design rule A.1.7, and it is why this control can be as loose as it is.
 * Tagging a quest to Play does not price it, reserve it or open it. The claim
 * gate in server/routes/quests.ts reads a stage floor and a role gate, and a
 * need tag reaches neither. The sentence under the heading says so on screen,
 * because a founder ticking a box deserves to know what the box does.
 *
 * ── WEIGHT IS TWO WORDS ──────────────────────────────────────────────────
 * Primary says this alone meets the need. Partial says it helps. A percentage
 * would invite arithmetic nobody has agreed on, and the coverage read asks
 * only whether a need has something that meets it.
 *
 * ── HONESTY ON SAVE ──────────────────────────────────────────────────────
 * Every write reads the Response and its body. A refusal leaves the row where
 * it was and prints the server's own words, so this control cannot say a tag
 * landed when it did not.
 */
import { useEffect, useState } from "react";
import { gameFetch } from "@/lib/gameApi";
import {
  HUMAN_NEEDS_BY_ID,
  expressionsLine,
  type NeedSubject,
  type NeedWeight,
} from "@shared/needs";
import type { NeedTag } from "@/components/NeedChips";

/** One row of `village_needs`, as `GET /api/needs/scope` sends it. */
interface ScopeRow {
  needKey: string;
  label: string;
  active: boolean;
}

/** What each weight means, in the words the picker shows. */
const WEIGHT_COPY: Record<NeedWeight, string> = {
  primary: "Meets it",
  partial: "Helps with it",
};

const WEIGHTS: NeedWeight[] = ["primary", "partial"];

export default function NeedTagPicker({
  subjectType,
  subjectRef,
  tags,
  onChanged,
}: {
  subjectType: NeedSubject;
  subjectRef: string;
  /** The links this thing already carries, from its own read payload. */
  tags: NeedTag[];
  /** The saved list, after a write the server confirmed. */
  onChanged: (tags: NeedTag[]) => void;
}) {
  const [scope, setScope] = useState<ScopeRow[] | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let live = true;
    gameFetch("/api/needs/scope")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        setScope(
          (d.scope ?? []).map((s: ScopeRow) => ({
            needKey: String(s.needKey),
            label: String(s.label),
            active: s.active !== false,
          })),
        );
      })
      .catch(() => {
        /* The section stays out of the way when the scope cannot be read. */
      });
    return () => {
      live = false;
    };
  }, []);

  const tagFor = (needKey: string) => tags.find((t) => t.needKey === needKey);

  const link = async (row: ScopeRow, weight: NeedWeight) => {
    setBusy(row.needKey);
    setProblem("");
    try {
      const res = await gameFetch("/api/admin/needs/links", {
        method: "POST",
        body: JSON.stringify({ needKey: row.needKey, subjectType, subjectRef, weight }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server's sentence, word for word. It names the need and says
        // what is wrong with it, which no message written here could do.
        setProblem(String(body?.error ?? "That tag did not save."));
        return;
      }
      const saved: NeedTag = {
        id: String(body.link.id),
        needKey: row.needKey,
        needLabel: row.label,
        weight: body.link.weight,
        needActive: row.active,
      };
      onChanged([...tags.filter((t) => t.needKey !== row.needKey), saved]);
    } catch {
      setProblem("That tag did not save. Check the connection and try again.");
    } finally {
      setBusy("");
    }
  };

  const unlink = async (tag: NeedTag) => {
    setBusy(tag.needKey);
    setProblem("");
    try {
      const res = await gameFetch(`/api/admin/needs/links/${encodeURIComponent(tag.id)}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProblem(String(body?.error ?? "That tag did not come off."));
        return;
      }
      onChanged(tags.filter((t) => t.id !== tag.id));
    } catch {
      setProblem("That tag did not come off. Check the connection and try again.");
    } finally {
      setBusy("");
    }
  };

  if (!scope) return null;

  const live = scope.filter((s) => s.active);
  if (live.length === 0) {
    return (
      <div className="border border-border rounded-2xl p-4 bg-card">
        <h3 className="font-semibold text-foreground mb-1">What need does this meet?</h3>
        <p className="text-sm text-muted-foreground">
          This village has not said which needs it is taking on. Say that first in Setup, and
          every quest and seat can then name which of them it meets.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-2xl p-4 bg-card">
      <h3 className="font-semibold text-foreground mb-1">What need does this meet?</h3>
      <p className="text-sm text-muted-foreground mb-3">
        A tag describes the work. It never changes who may claim this, what it pays, or when it
        opens.
      </p>
      {problem && (
        <p className="text-sm text-destructive mb-3" role="alert">
          {problem}
        </p>
      )}
      <ul className="space-y-2">
        {live.map((row) => {
          const tag = tagFor(row.needKey);
          const platform = HUMAN_NEEDS_BY_ID[row.needKey];
          return (
            <li
              key={row.needKey}
              className="flex flex-wrap items-center gap-2 border border-border rounded-xl px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{row.label}</span>
                {platform && (
                  <span className="block text-xs text-muted-foreground">
                    {expressionsLine(platform)}
                  </span>
                )}
              </span>
              {WEIGHTS.map((w) => (
                <button
                  key={w}
                  type="button"
                  disabled={busy === row.needKey}
                  onClick={() => link(row, w)}
                  aria-pressed={tag?.weight === w}
                  className={
                    tag?.weight === w
                      ? "px-2.5 py-1 rounded-full text-xs font-semibold bg-primary text-primary-foreground"
                      : "px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:opacity-80"
                  }
                >
                  {WEIGHT_COPY[w]}
                </button>
              ))}
              <button
                type="button"
                disabled={!tag || busy === row.needKey}
                onClick={() => tag && unlink(tag)}
                className="px-2.5 py-1 rounded-full text-xs font-medium text-muted-foreground disabled:opacity-40"
              >
                {tag ? `Untag ${row.label}` : "Untagged"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
