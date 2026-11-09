/**
 * THE CONFLICT AGREEMENT ON /governance: what anybody can read, and what a
 * member can do from it.
 *
 * PUBLIC, WITH ROLES ONLY. The body comes from GET /api/conflict-agreement/public,
 * which names roles and never people: outside contacts by organisation or role,
 * no safety contacts, and every piece of text naming a member of the village
 * withheld by the server (server/lib/conflictAgreement.ts). This component
 * prints what it is given and says when something was held back.
 *
 * NO AGREEMENT YET: the page keeps what it printed before, the village's
 * restorative steps from its exit policy (`VillageConflictSteps`).
 *
 * FOR A MEMBER, the body is the members' copy, whole: the page never tells a
 * member that a part shows to members and then hides it from them. And four
 * more things, all from GET /api/conflict-agreement:
 *   - the safety contacts, which are members-only;
 *   - the OMBUDS DOOR: ask an outside contact to talk. The server keeps who
 *     asked, when and which contact, and answers with how to reach them. No
 *     words are sent anywhere, and the button says so before it is pressed.
 *     A contact the member has asked keeps showing how to reach them;
 *   - an open change vote, with the agreement it would adopt in full, since
 *     the vote's own page holds back names and the members-only parts;
 *   - the editor, for whoever the server says holds the pen, loaded only
 *     when opened.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { authToken } from "@/lib/gameApi";
import VillageConflictSteps from "@/components/governance/VillageConflictSteps";
import {
  APPEAL_NOT_ENFORCED,
  LADDER_RUNGS,
  contactLabel,
  type ConflictAgreementContent,
  type LadderRungNumber,
  type SafetyContact,
} from "@shared/conflictAgreement";
import type { AgreementPayload } from "./ConflictAgreementEditor";

const ConflictAgreementEditor = lazy(() => import("./ConflictAgreementEditor"));

/** Text the public may read, or null where the server withheld it for naming a member. */
type Guarded = string | null;

/**
 * What GET /api/conflict-agreement/public answers, as `publicAgreementView` builds it.
 * `heldToday` is whether anybody holds the role today, by the intake's own reach rule.
 */
export interface PublicAgreement {
  steps: Array<{ what: Guarded; whoInRoom: Guarded }>;
  careRole: { id: string; name: Guarded; heldToday?: boolean } | null;
  coverRole: { id: string; name: Guarded; heldToday?: boolean } | null;
  replyHours: number | null;
  outsideContacts: Array<{ id: string; label: Guarded }>;
  whenPowerInvolved: { role: Guarded; outsideContact: Guarded; words: Guarded };
  consequencesLadder: { rungs: Array<{ rung: number; words: Guarded }>; appeal: Guarded };
  practices: Array<{ name: Guarded; when: Guarded }>;
  version: number;
  adoptedHow: "founders" | "ballot" | null;
  adoptedAt: string | null;
  reviewDate: string | null;
  withheld: boolean;
}

type MembersView = AgreementPayload & { yourAsks: Array<{ id: string; contactId: string; contactLabel: string; askedAt: string }> };

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/** Where the server held something back, the page says so in the same place. */
function Withheld() {
  return (
    <em className="text-stone-500">
      <Trans>Names a person, so members only.</Trans>
    </em>
  );
}

const show = (text: Guarded) => (text === null ? <Withheld /> : text);

const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString();

/**
 * A members' copy in the card's shape, with nothing withheld: roles by name,
 * outside contacts by organisation or role (their people and how to reach them
 * are listed with the ombuds door), the stamp when there is one.
 */
export function readable(
  a: ConflictAgreementContent & { version?: number; adoptedHow?: PublicAgreement["adoptedHow"]; adoptedAt?: string | null },
  roles: ReadonlyArray<{ id: string; name: string; liveHolders?: number }>,
): PublicAgreement {
  const role = (id: string) => {
    const r = id ? roles.find((x) => x.id === id) : undefined;
    return r ? { id: r.id, name: r.name, heldToday: (r.liveHolders ?? 0) > 0 } : null;
  };
  const powerContact = a.outsideContacts.find((c) => c.id === a.whenPowerInvolved.outsideContactId);
  return {
    steps: a.steps,
    careRole: role(a.careRole),
    coverRole: role(a.coverRole),
    replyHours: a.replyHours,
    outsideContacts: a.outsideContacts.map((c) => ({ id: c.id, label: contactLabel(c) })),
    whenPowerInvolved: {
      role: role(a.whenPowerInvolved.roleId)?.name ?? "",
      outsideContact: powerContact ? contactLabel(powerContact) : "",
      words: a.whenPowerInvolved.words,
    },
    consequencesLadder: a.consequencesLadder,
    practices: a.practices,
    version: a.version ?? 0,
    adoptedHow: a.adoptedHow ?? null,
    adoptedAt: a.adoptedAt ?? null,
    reviewDate: a.reviewDate,
    withheld: false,
  };
}

/**
 * THE REPLY PROMISE, only while somebody would keep it (Wave 3a audit,
 * 2026-09-28). The card printed "hears back within N hours" whether or not
 * anybody held the care role, while /exit-policy, on the same village, said
 * nobody did. Every seat has a term, so a held care role goes empty at a
 * season turn as a matter of course. The rule is /exit-policy's: a request
 * reaches the care role's live holders and nobody else, so the promise is
 * printed while the care role is held, and the same "Nobody holds" sentence
 * otherwise. With no care role, the outside contacts are the way in, and the
 * promise is theirs.
 */
function ReplyLine({ a }: { a: PublicAgreement }) {
  const replyHours = a.replyHours;
  if (replyHours === null) return null;
  if (a.careRole) {
    if (a.careRole.heldToday) {
      return (
        <>
          {" "}
          <Trans>
            Someone who reaches out hears back within <Plural value={replyHours} one="# hour" other="# hours" />.
          </Trans>
        </>
      );
    }
    const careName = a.careRole.name;
    return (
      <>
        {" "}
        {careName === null ? (
          <Trans>Nobody holds the care role today, so a private intake would reach nobody.</Trans>
        ) : (
          <Trans>Nobody holds the {careName} role today, so a private intake would reach nobody.</Trans>
        )}
      </>
    );
  }
  return a.outsideContacts.length > 0 ? (
    <>
      {" "}
      <Trans>
        Someone who reaches a contact outside the village hears back within <Plural value={replyHours} one="# hour" other="# hours" />.
      </Trans>
    </>
  ) : null;
}

export function AgreementBody({ a }: { a: PublicAgreement }) {
  const outside = a.outsideContacts;
  const adoptedDay = a.adoptedAt ? day(a.adoptedAt) : "";
  const reviewDay = a.reviewDate ? day(a.reviewDate) : "";
  const careShown = a.careRole ? show(a.careRole.name) : null;
  const coverShown = a.coverRole ? show(a.coverRole.name) : null;
  const outsideList = (
    <>
      {outside.map((c, i) => (
        <span key={c.id}>
          {i > 0 ? ", " : ""}
          {show(c.label)}
        </span>
      ))}
    </>
  );
  const powerHolder = show(a.whenPowerInvolved.role !== "" ? a.whenPowerInvolved.role : a.whenPowerInvolved.outsideContact);
  const appealShown = show(a.consequencesLadder.appeal);
  return (
    <div className="space-y-5 text-stone-700 leading-relaxed">
      <p className="text-sm text-stone-600">
        {a.adoptedAt ? (
          a.adoptedHow === "ballot" ? (
            <Trans>Adopted on {adoptedDay} by the village's vote.</Trans>
          ) : (
            <Trans>Adopted on {adoptedDay} by the founders, before the Game started.</Trans>
          )
        ) : (
          <Trans>A draft the village has not adopted yet.</Trans>
        )}
        {a.reviewDate ? (
          <>
            {" "}
            <Trans>It comes back for review on {reviewDay}.</Trans>
          </>
        ) : (
          ""
        )}
      </p>

      <div>
        <h3 className="font-semibold text-stone-900">
          <Trans>When two of us disagree</Trans>
        </h3>
        <ol className="mt-2 space-y-2 list-decimal pl-6">
          {a.steps.map((s, i) => (
            <li key={i}>
              {show(s.what)}
              {s.whoInRoom !== "" && <span className="block text-sm text-stone-600"><Trans context="who is present at a conflict step">In the room: {show(s.whoInRoom)}</Trans></span>}
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h3 className="font-semibold text-stone-900">
          <Trans>Who hears it first</Trans>
        </h3>
        <p className="mt-1">
          {a.careRole ? (
            a.coverRole ? (
              <Trans>The {careShown} role, and the {coverShown} role when they cannot.</Trans>
            ) : (
              <Trans context="the care role that hears a conflict first">The {careShown} role.</Trans>
            )
          ) : (
            <Trans>No role is named yet.</Trans>
          )}
          <ReplyLine a={a} />
        </p>
        {outside.length > 0 && (
          <p className="mt-1">
            <Trans>Outside the village: {outsideList}.</Trans>
          </p>
        )}
      </div>

      {/* A withheld name is null, and still a clause: it prints the withheld marker. */}
      {(a.whenPowerInvolved.role !== "" || a.whenPowerInvolved.outsideContact !== "" || a.whenPowerInvolved.words !== "") && (
        <div>
          <h3 className="font-semibold text-stone-900">
            <Trans>When it involves someone who holds power here</Trans>
          </h3>
          {(a.whenPowerInvolved.role !== "" || a.whenPowerInvolved.outsideContact !== "") && (
            <p className="mt-1">
              <Trans>It goes to {powerHolder} instead.</Trans>
            </p>
          )}
          {a.whenPowerInvolved.words !== "" && <p className="mt-1">{show(a.whenPowerInvolved.words)}</p>}
        </div>
      )}

      {a.consequencesLadder.rungs.length > 0 && (
        <div>
          <h3 className="font-semibold text-stone-900">
            <Trans>Consequences, and how to appeal</Trans>
          </h3>
          <ul className="mt-2 space-y-2">
            {a.consequencesLadder.rungs.map((r) => (
              <li key={r.rung}>
                <span className="font-medium text-stone-900">{LADDER_RUNGS[r.rung as LadderRungNumber]?.name}: </span>
                {show(r.words)}
              </li>
            ))}
          </ul>
          {a.consequencesLadder.appeal !== "" && <p className="mt-2"><Trans context="how someone appeals a consequence">Appeal: {appealShown}</Trans></p>}
          <p className="mt-2 text-sm text-stone-600">{APPEAL_NOT_ENFORCED}</p>
        </div>
      )}

      {a.practices.length > 0 && (
        <div>
          <h3 className="font-semibold text-stone-900">
            <Trans>What keeps small tensions small</Trans>
          </h3>
          <ul className="mt-2 space-y-1 list-disc pl-6">
            {a.practices.map((p, i) => (
              <li key={i}>
                {show(p.name)}
                {p.when !== "" && <>: {show(p.when)}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.withheld && <p className="text-sm text-stone-600"><Trans>Parts of this agreement name people, so they show to members only.</Trans></p>}
    </div>
  );
}

/**
 * The ombuds door for one outside contact. Once the member has asked (`asked`,
 * from their own recorded asks), how to reach the contact stays on the page,
 * so looking again never costs another ask.
 */
function OmbudsDoor({
  contact,
  asked,
  onAsked,
}: {
  contact: { id: string; name: string; organisation: string; role: string; howToReach: string };
  asked: boolean;
  onAsked: () => void;
}) {
  const { t } = useLingui();
  const [answer, setAnswer] = useState<{ name: string; howToReach: string; organisation: string; role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = contact.role && contact.organisation ? `${contact.role}, ${contact.organisation}` : contact.role || contact.organisation;
  const reach = answer ?? (asked ? contact : null);
  const reachName = reach?.name ?? "";
  const reachHow = reach?.howToReach ?? "";

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/conflict-agreement/ombuds-asks", { method: "POST", headers: headers(), body: JSON.stringify({ contactId: contact.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(String(d?.error ?? t`That was not recorded.`));
        return;
      }
      setAnswer(d.contact);
      onAsked();
    } catch {
      setError(t`That did not reach the server, so nothing was recorded.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-stone-200 p-3 space-y-2">
      <p className="font-medium text-stone-900">
        {contact.name}
        {label ? `, ${label}` : ""}
      </p>
      {reach ? (
        <p role="status" className="text-sm">
          <Trans>
            Reach {reachName} here: <span className="font-medium">{reachHow}</span>. The village has a note that you asked, and when. What you say to them is yours: nothing was sent.
          </Trans>
        </p>
      ) : (
        <>
          <p className="text-xs text-stone-600">
            <Trans>Asking records that you asked, when, and which contact, and then shows you how to reach them. No words go anywhere, and nobody is sent a notice.</Trans>
          </p>
          <button type="button" disabled={busy} onClick={() => void ask()} className="min-h-[44px] rounded-lg border border-teal-deep px-3 text-sm font-medium text-teal-deep hover:bg-stone-50 disabled:opacity-50">
            <Trans context="button that asks an outside contact to talk">Ask to talk</Trans>
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

/** The safety contacts, members-only. */
function SafetyContacts({ contacts }: { contacts: readonly SafetyContact[] }) {
  return (
    <div>
      <h3 className="font-semibold text-stone-900">
        <Trans>If it is not something to mediate</Trans>
      </h3>
      <p className="mt-1 text-sm">
        <Trans>If anyone is in danger now, call local emergency services first. Then:</Trans>
      </p>
      <ul className="mt-2 space-y-1 list-disc pl-6 text-sm">
        {contacts.map((c, i) => (
          <li key={i}>
            {c.name}: {c.howToReach}
            {c.when ? ` (${c.when})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * An open change vote, and the agreement it would adopt in full. The vote's
 * page withholds names and says of the members-only parts only whether they
 * change, so this is where a member reads what they are voting on.
 */
function OpenVote({ vote, roles }: { vote: NonNullable<MembersView["openBallot"]>; roles: MembersView["roles"] }) {
  const p = vote.proposal;
  const closesOn = day(vote.closesAt);
  const voteId = vote.id;
  return (
    <div className="rounded-lg border border-stone-200 p-3 space-y-2">
      <h3 className="font-semibold text-stone-900">
        <Trans>A vote to change this agreement is open</Trans>
      </h3>
      <p className="text-sm">
        <Trans>
          Voting closes on {closesOn}.{" "}
          <a className="font-medium text-teal-deep underline" href={`/decisions/${voteId}`}>
            Read the vote and cast yours
          </a>
          . The vote's page holds back anything that names a person, and the members-only parts. All of what it would adopt is here.
        </Trans>
      </p>
      {p ? (
        <details className="text-sm">
          <summary className="cursor-pointer min-h-[44px] py-2 font-medium text-teal-deep">
            <Trans>The agreement this vote would adopt</Trans>
          </summary>
          <div className="mt-2 space-y-4">
            <AgreementBody a={readable(p, roles)} />
            {p.safetyContacts.length > 0 ? <SafetyContacts contacts={p.safetyContacts} /> : <p><Trans>It names no safety contacts.</Trans></p>}
            {p.outsideContacts.length > 0 && (
              <div>
                <h3 className="font-semibold text-stone-900">
                  <Trans>The people outside the village it names</Trans>
                </h3>
                <ul className="mt-2 space-y-1 list-disc pl-6">
                  {p.outsideContacts.map((c) => (
                    <li key={c.id}>
                      {c.name}, {contactLabel(c)}: {c.howToReach}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      ) : (
        <p className="text-sm text-stone-600">
          <Trans>What this vote would adopt could not be read just now. The vote's page shows it, with names held back.</Trans>
        </p>
      )}
    </div>
  );
}

/** Everything a member adds to the public card. */
function ForMembers({ view, reload }: { view: MembersView; reload: () => void }) {
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  const a = view.agreement;
  const openLabel = view.pen.mayWrite
    ? view.stored
      ? t({ message: "Edit the agreement", context: "button that opens the conflict agreement editor" })
      : t({ message: "Write the agreement", context: "button that opens the conflict agreement editor" })
    : view.pen.mayPropose
      ? t({ message: "Propose a change", context: "button that opens the conflict agreement editor to propose a change" })
      : t({ message: "Read every frame", context: "button that opens the conflict agreement editor to read" });
  const askedList = view.yourAsks
    .map((x) => {
      const contact = x.contactLabel;
      const when = day(x.askedAt);
      return t({ message: `${contact} on ${when}`, context: "an outside contact you asked, and the day" });
    })
    .join("; ");

  return (
    <div className="space-y-4 border-t border-stone-200 pt-4">
      {a.safetyContacts.length > 0 && <SafetyContacts contacts={a.safetyContacts} />}

      {a.outsideContacts.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold text-stone-900">
            <Trans>Talk to someone outside the village</Trans>
          </h3>
          {a.outsideContacts.map((c) => (
            <OmbudsDoor key={c.id} contact={c} asked={view.yourAsks.some((x) => x.contactId === c.id)} onAsked={reload} />
          ))}
          {view.yourAsks.length > 0 && (
            <p className="text-xs text-stone-600">
              <Trans>You asked: {askedList}. Only you see this list.</Trans>
            </p>
          )}
        </div>
      )}

      {view.openBallot && <OpenVote vote={view.openBallot} roles={view.roles} />}

      <div>
        <button
          type="button"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
          className="min-h-[44px] rounded-lg border border-teal-deep px-3 text-sm font-medium text-teal-deep hover:bg-stone-50"
        >
          {editing ? t`Close the agreement's frames` : openLabel}
        </button>
        {editing && (
          <div className="mt-3">
            <Suspense fallback={<p role="status" className="text-sm text-stone-600"><Trans context="the conflict agreement editor is loading">Loading the frames…</Trans></p>}>
              <ConflictAgreementEditor onDone={reload} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConflictAgreementPublic() {
  const [pub, setPub] = useState<{ stored: boolean; agreement: PublicAgreement | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [members, setMembers] = useState<MembersView | null>(null);

  const load = useCallback(() => {
    fetch("/api/conflict-agreement/public")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setPub(d))
      .catch(() => setFailed(true));
    if (authToken()) {
      fetch("/api/conflict-agreement", { headers: headers() })
        .then(async (r) => (r.ok ? ((await r.json()) as MembersView) : null))
        .then((d) => setMembers(d))
        .catch(() => setMembers(null));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (failed) return <VillageConflictSteps />;
  if (!pub) {
    return (
      <p role="status" className="text-stone-600">
        <Trans>Loading this village's conflict agreement…</Trans>
      </p>
    );
  }
  return (
    <div id="conflict-agreement" className="space-y-4">
      {/* A member reads the members' copy whole; everybody else, the public view. */}
      {pub.stored && pub.agreement ? (
        <AgreementBody a={members?.stored ? readable(members.agreement, members.roles) : pub.agreement} />
      ) : (
        <VillageConflictSteps />
      )}
      {members && <ForMembers view={members} reload={load} />}
    </div>
  );
}
