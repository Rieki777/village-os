/**
 * The one gate every module page renders when its module is invisible (R36).
 *
 * Before this, fourteen pages each carried `if (modules.loaded && !module)
 * return <NotFound />`, which made a members-only module read as a 404 to a
 * signed-out visitor: the manifest omits members modules for anonymous
 * readers, so the page's own sign-in card never rendered. Rye's ruling:
 * ["Non signed in members should get a prompt to sign-in not a 401 in
 * messaging"], widened to every members-only page.
 *
 * The decision: signed out AND the id is in the manifest's `signInToSee`
 * (modules whose SERVED lifecycle is members) renders the sign-in card, with
 * the Sign in link carrying `?next=` back here.
 *
 * Everything else renders the module-off card (R43 Q8). It used to render
 * NotFound, so a shared link to a module the village had not enabled read as
 * a page that never existed. Rye's ruling: [this land project hasn't enabled
 * this module. reach out to the admin team or make a proposal to initiate
 * this module in your village(s).] The card carries the project's configured
 * name, never a hardcoded one, and it still says who to ask. What it no
 * longer says is "make a proposal", because nothing in this product turns a
 * module on by proposal; the note over `ModuleOff` below has the working.
 *
 * ── WHAT THE SIGN-IN CARD OWES A VISITOR ─────────────────────────────────
 *
 * It used to be a heading, one grey line ("This part of the village opens
 * when you sign in") and a Sign in button. Three things were missing and all
 * three were things the card already knew or could know:
 *
 *   what is behind it   the same sentence over the forum and over messages
 *                       says nothing about either. `gateCopy.ts` holds one
 *                       line per module, and a page whose module covers more
 *                       than one surface passes its own as `behind`.
 *   what is still open   the manifest in hand IS the list of what this reader
 *                       can already reach. A visitor who can see the shape of
 *                       the village is being invited; one who sees a grey box
 *                       is being dismissed.
 *   a way in at all      the person this card meets most often has no account,
 *                       and it offered them nothing but a sign-in form.
 *
 * This follows the shape `PeopleLock` set: lead with a fact, say what is
 * still visible, then offer the door. One answer to the question, not two.
 *
 * ── AND IT NEVER TELLS A SIGNED-IN PERSON TO SIGN IN ─────────────────────
 *
 * `AuthProvider` reads the token synchronously and the USER asynchronously,
 * so between first paint and `/api/profile` answering, a signed-in member
 * has `token` and no `user`. `Messages` renders this card on `!user`, which
 * meant a member who was already signed in got "Sign in" for the length of
 * that round trip. So the card reads `loading` itself and holds a quiet
 * loader instead of making a claim it cannot yet support.
 *
 * The two refusals are genuinely different and are told apart:
 *
 *   signed out  the page is one sign-in or one account away, so offer both
 *               doors and say what is on the other side.
 *   signed in   sign-in is useless advice. The reader falls through to the
 *               module-off card, which is the founder-ruled sentence and the
 *               only sentence this repository has for that fact.
 */
import Layout from "@/components/Layout";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/modules/ModuleProvider";
import { useGameConfig } from "@/lib/gameApi";
import BreathingLoader from "@/components/natural/BreathingLoader";
import { gateLine, nameList } from "./gateCopy";
import { internalPath } from "@/lib/internalPath";


const DOOR =
  "inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg font-semibold" +
  " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2";
const DOOR_PRIMARY = `${DOOR} bg-teal-deep text-white hover:bg-teal-deep-dark`;
const DOOR_SECOND = `${DOOR} border border-teal-deep text-teal-deep hover:bg-teal-deep/5`;

/**
 * BOTH DOORS, WITH NO CARD AROUND THEM.
 *
 * Four pages carry their own sign-in gate rather than this file's, and every
 * one of those is a deliberate choice that is still right: `Decisions` and
 * `Propose` keep their own hero, `Introductions` renders the PUBLIC board
 * underneath its card, and `ResourcesPanel` is a panel inside the map and
 * cannot host a second site shell. `SignInToSee` owns a `Layout`, so it can
 * never be the answer for any of them.
 *
 * What all five DO share is the pair of doors, and four of them were missing
 * the second one. The person a sign-in card meets most often has no account,
 * and until now three of those pages offered them a sign-in form and nothing
 * else while the fourth offered a sentence with no link in it at all.
 *
 * So the doors come out and the cards stay. This owns no margin, no border
 * and no copy about what is behind it, because each of those belongs to the
 * page that knows its own subject.
 *
 * `/register` takes no `next` and that is not an oversight of this component:
 * `Register.tsx` sends a new member to character creation with `?first=1`,
 * which is a first-run walk and the right place to land. Sign-in is the door
 * that returns you to where you were.
 */
export function SignInDoors({
  next,
  /** Centred inside a card of its own, left where it sits in a panel. */
  align = "center",
}: {
  next?: string;
  align?: "center" | "start";
}) {
  const [location] = useLocation();
  const target = internalPath(next ?? location) ?? "/";
  return (
    <div
      className={`flex flex-col sm:flex-row gap-3 ${align === "start" ? "sm:justify-start" : "justify-center"}`}
    >
      <Link href={`/login?next=${encodeURIComponent(target)}`} className={DOOR_PRIMARY}>
        Sign in
      </Link>
      <Link href="/register" className={DOOR_SECOND}>
        Create an account
      </Link>
    </div>
  );
}

/** The card's frame, so all four states are one shape at one width. */
function GateShell({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <Layout>
      <div className="container py-16">
        <div className="mx-auto max-w-xl text-center">
          <h1 className="font-display text-3xl font-bold mb-3">{name}</h1>
          {children}
        </div>
      </div>
    </Layout>
  );
}

/**
 * What this reader can already reach, read off the manifest they are holding.
 *
 * The manifest is viewer-scoped, so its `modules` array is exactly the list
 * of what is open to whoever is looking: a count is a fact and the names are
 * facts (R56). It says nothing about what a village ought to have on, and it
 * compares this village to nothing (R55). When the list is empty there is
 * nothing true to say, so it says nothing.
 */
function StillOpen({ signedIn }: { signedIn: boolean }) {
  const { modules } = useModules();
  const names = modules.map((m) => m.name).filter(Boolean);
  if (!names.length) return null;
  const reach = signedIn ? "open to you right now" : "open without an account";
  return (
    <p className="text-sm text-muted-foreground leading-relaxed">
      {names.length <= 3
        ? `Still ${reach}: ${nameList(names)}.`
        : `${names.length} parts of this village are ${reach}, including ${nameList(names.slice(0, 3))}.`}
    </p>
  );
}

/**
 * The sign-in card, extracted from Messages.tsx and shared. `name` is the
 * page's catalog name; `next` defaults to where the visitor already is;
 * `behind` overrides the module's own line for a page that shares a module
 * id with a different surface.
 */
export function SignInToSee({
  moduleId, name, next, behind,
}: {
  moduleId?: string;
  name: string;
  next?: string;
  behind?: string;
}) {
  const [location] = useLocation();
  const { user, loading } = useAuth();
  const target = internalPath(next ?? location) ?? "/";
  const line = behind ?? gateLine(moduleId);

  // The session is still being read. Claiming anything about this reader here
  // is how a signed-in member got told to sign in.
  if (loading) {
    return (
      <GateShell name={name}>
        <div className="flex justify-center py-4">
          <BreathingLoader label="Reading your account" />
        </div>
      </GateShell>
    );
  }

  // Signed in already: "sign in" is useless advice, and the module-off card
  // carries the founder-ruled sentence for this exact fact.
  if (user) return <ModuleOff name={name} />;

  return (
    <GateShell name={name}>
      {line && <p className="text-foreground leading-relaxed mb-2">{line}</p>}
      <p className="text-muted-foreground mb-6">This part of the village opens when you sign in.</p>
      <div className="mb-6">
        <SignInDoors next={target} />
      </div>
      <StillOpen signedIn={false} />
    </GateShell>
  );
}

/**
 * The module-off card. Rendered for a module the caller knows exists (it
 * named it) but the manifest does not serve: off, or preview a visitor
 * cannot see. The page keeps the site shell so a shared link lands somewhere
 * with a menu, never on a dead end.
 *
 * ── THE SECOND DOOR CAME OUT, AND HERE IS WHY ────────────────────────────
 *
 * The ruled sentence used to end "…or make a proposal to initiate it in your
 * village", and this card is mounted on 22 pages, so that was the product's
 * most-rendered instruction. It named an act the product cannot perform.
 * A module's lifecycle is written in exactly one place, `setModuleLifecycle`
 * in server/lib/modules.ts, reached by exactly one route,
 * `PUT /api/admin/modules/:id/lifecycle`, which refuses anyone who is not an
 * admin. The proposal wizard publishes eight kinds (role_application,
 * mechanics, agreement, badge_grant, quest_payout, power_transfer,
 * power_grant, power_return) and not one of them touches a lifecycle. So no
 * proposal any member can write turns a module on.
 *
 * It was worst on `/propose` itself, where governance being off is the very
 * reason this card is showing: the page told the reader to go and do the
 * thing they were standing in front of, refused. Two QA passes found that
 * independently.
 *
 * R56 says state what is true and then get out of the way, so the sentence
 * now says who can turn it on, which is true on every one of the 22 pages
 * and true for a signed-out reader who has no account to propose with. The
 * fact about what this reader CAN still reach stays underneath it.
 */
export function ModuleOff({ name }: { name: string }) {
  const cfg = useGameConfig();
  const { user } = useAuth();
  const project = cfg?.project?.name ?? "This village";
  return (
    <GateShell name={name}>
      <p className="text-muted-foreground mb-6 max-w-md mx-auto">
        {project} hasn't opened this room yet. Only the team running the village can
        open it, so ask them if you'd like it open.
      </p>
      <Link href="/" className={`${DOOR_PRIMARY} mb-6`}>
        Back to the village
      </Link>
      <StillOpen signedIn={!!user} />
    </GateShell>
  );
}

/**
 * The manifest could not be read at all.
 *
 * `ModuleProvider` retries three times and then sets `failed`, and its own
 * comment says why that is a different fact from an empty catalog: "a blip
 * must not latch an empty catalog". The gate then ignored the distinction and
 * rendered the module-off card anyway, so a dropped request told a reader
 * this village had not enabled a module it may well have enabled. That is a
 * false statement about why they cannot see something, which is the one thing
 * this card exists to avoid.
 */
function CatalogUnread({ name }: { name: string }) {
  const { refresh } = useModules();
  return (
    <GateShell name={name}>
      <p className="text-muted-foreground mb-6 max-w-md mx-auto">
        {name} didn't load. Try again in a moment.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button type="button" onClick={refresh} className={DOOR_PRIMARY}>
          Try again
        </button>
        <Link href="/" className={DOOR_SECOND}>
          Back to the village
        </Link>
      </div>
    </GateShell>
  );
}

export default function ModuleGate({
  moduleId, name, next, behind,
}: {
  moduleId: string;
  name: string;
  next?: string;
  /** This page's own line, for a module id that covers more than one surface. */
  behind?: string;
}) {
  const { signInToSee, failed } = useModules();
  if (failed) return <CatalogUnread name={name} />;
  // `signInToSee` only ever rides the ANONYMOUS manifest, so its presence is
  // already the signed-out fact. SignInToSee re-checks the session anyway and
  // hands a signed-in reader to ModuleOff, which is what makes the old
  // `!user &&` guard here redundant instead of load-bearing.
  if (signInToSee.includes(moduleId)) {
    return <SignInToSee moduleId={moduleId} name={name} next={next} behind={behind} />;
  }
  return <ModuleOff name={name} />;
}
