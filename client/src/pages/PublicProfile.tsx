/**
 * Somebody else's character sheet, at /profile/:handle.
 *
 * A separate page from the owner's `/profile` on purpose. The two answer
 * different questions and share a URL shape, not a component: mixing them
 * means one file deciding on every render which of two audiences it is talking
 * to, and that decision is exactly where a privacy leak hides. The server
 * already filtered; this page renders what arrived and asks no questions about
 * what did not.
 *
 * So every section here is conditional on the FIELD BEING PRESENT, never on a
 * flag. An absent field means the server withheld it, and the page has nothing
 * to say about why.
 */
import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { authToken } from "@/lib/gameApi";
import { useTokenName } from "@/hooks/useTokenNames";
import { formatTokenAmount } from "@/lib/tokenAmount";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

interface Party {
  id: string;
  archetypeKey: string;
  avatar: string | null;
  isPrimary: boolean;
}

/** Only the two fields this page needs off `/api/archetypes`. */
interface Archetype {
  key: string;
  name: string;
}

interface PublicSheet {
  handle: string | null;
  name: string;
  title: string | null;
  moonsOnTheLand: number;
  homeStructureKey?: string | null;
  standing?: Array<{ token: string; name: string; balance: number; decimals: number }>;
  gratitude?: { receivedThisSeason: number; givenThisSeason: number; lifetime: number };
  party?: Party[];
}

/* The minor-units rule lives once, in client/src/lib/tokenAmount.ts. This page
   carried a second spelling of it that agreed with the profile chip's third
   spelling by luck, while the wallet had none at all and printed 10000 Voice
   for the same ten. */

export default function PublicProfile() {
  const [, params] = useRoute("/profile/:handle");
  const [sheet, setSheet] = useState<PublicSheet | null>(null);
  const [missing, setMissing] = useState(false);
  /**
   * The class names, so a portrait can say WHICH path it shows.
   *
   * The public route, the same one ProfileHero and the character select
   * already read without a token. A key that this list cannot place falls
   * back to the key itself, which is a poor label and still infinitely
   * better than the empty string that shipped.
   */
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const tokenName = useTokenName("Recognition");

  useEffect(() => {
    if (!params?.handle) return;
    setSheet(null);
    setMissing(false);
    fetch(`/api/profiles/${encodeURIComponent(params.handle)}`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d ? setSheet(d) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [params?.handle]);

  useEffect(() => {
    fetch("/api/archetypes")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setArchetypes(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  const nameOf = (key: string) => archetypes.find((a) => a.key === key)?.name ?? key;

  /**
   * THE ONE POLITE REGION FOR THIS PAGE.
   *
   * Whose sheet this is arrives asynchronously, and following a link from the
   * map or the forum swaps the entire page contents with nothing announced.
   * The region has to OUTLIVE the three states to speak at all: a live region
   * inserted into the DOM already holding its text announces nothing. So it
   * is the FIRST CHILD OF `Layout` in every branch below, at the same
   * position and the same element type, which is what makes React reconcile
   * it in place across the state change instead of unmounting one region and
   * mounting a silent new one. Its first paint is silent, which is right.
   */
  const said = missing
    ? "Nobody here by that name."
    : sheet
      ? `${sheet.name}. Their sheet is open.`
      : "Looking for that member.";

  if (missing || !sheet) {
    return (
      <Layout>
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
        {missing ? (
          <div className="mx-auto max-w-2xl px-4 py-16 text-center">
            <h1 className="text-2xl font-semibold text-teal-deep">Nobody here by that name</h1>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl px-4 py-16 text-center text-gray-700">Looking.</div>
        )}
      </Layout>
    );
  }

  const hero = sheet.party?.find((c) => c.isPrimary) ?? sheet.party?.[0] ?? null;

  return (
    <Layout>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="flex flex-col items-center gap-5 sm:flex-row sm:items-end">
          <div className="h-40 w-32 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
            {hero?.avatar ? (
              <img
                src={hero.avatar}
                alt={nameOf(hero.archetypeKey)}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-sage/60 text-2xl text-teal-deep">
                  {sheet.name.slice(0, 1)}
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h1 className="text-3xl font-semibold text-teal-deep">{sheet.name}</h1>
            {sheet.title ? <p className="mt-1 text-sage">{sheet.title}</p> : null}
            <p className="mt-2 text-sm text-gray-700">
              {sheet.moonsOnTheLand === 0
                ? "New on the land"
                : `${sheet.moonsOnTheLand} moons on the land`}
            </p>
            {sheet.homeStructureKey ? (
              <p className="mt-1 text-sm text-gray-700">Hearths at {sheet.homeStructureKey}</p>
            ) : null}
          </div>
        </header>

        {/*
          THE PORTRAITS WERE THE ONLY CARRIER, AND THEY WERE DECORATIVE.

          Every image here shipped `alt=""`, and no text named a single path,
          so this whole section read to a screen reader as a heading followed
          by an empty list: "Paths they walk", then nothing. Which paths a
          member walks is the fact the section exists to carry, so it is now
          carried twice: in the `alt`, and in a visible caption that also
          helps anyone who cannot tell thirty near-identical portraits apart.

          THE CAPTION IS `aria-hidden` AND THAT IS THE POINT. Two carriers of
          one fact is two announcements of it, and "The Steward The Steward"
          per portrait is its own defect. The `alt` is the accessible carrier
          because it survives the caption being restyled or moved, and the
          caption is the visual one. Whichever half a reader gets, they get
          the name exactly once.
        */}
        {sheet.party && sheet.party.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-sage">Paths they walk</h2>
            <ul className="mt-3 flex flex-wrap gap-3">
              {sheet.party.map((c) => (
                <li
                  key={c.id}
                  className="w-24 overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                >
                  <div className="aspect-[3/4] w-full">
                    {c.avatar ? (
                      <img
                        src={c.avatar}
                        alt={nameOf(c.archetypeKey)}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  {/* text-teal-deep, which is what this file already puts on
                      `bg-gray-50` for the standing chips below. 9.92:1 at the
                      platform default, measured in Chromium against the built
                      stylesheet, and no new `text-gray-*` on a ratchet with no
                      headroom. */}
                  <p
                    aria-hidden="true"
                    className="truncate px-2 py-1.5 text-xs font-medium text-teal-deep"
                  >
                    {nameOf(c.archetypeKey)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Present only when the member chose to show it. Absent is not empty:
            the page says nothing rather than saying they have nothing. */}
        {sheet.standing ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-sage">Standing</h2>
            {sheet.standing.length === 0 ? (
              <p className="mt-2 text-sm text-gray-700">New on the land.</p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {sheet.standing.map((s) => (
                  <li
                    key={s.token}
                    className="rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-teal-deep"
                  >
                    {formatTokenAmount(s.balance, s.decimals)} {s.name}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {sheet.gratitude ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-sage">{tokenName}</h2>
            <p className="mt-2 text-gray-800">
              {sheet.gratitude.receivedThisSeason === 0
                ? "No thanks yet this season."
                : `Thanked by ${sheet.gratitude.receivedThisSeason} members this season.`}
            </p>
            {/* Given sits beside received, never beneath it. Generosity is a
                status axis here and not only accumulation. */}
            <p className="mt-1 text-gray-800">
              {sheet.gratitude.givenThisSeason === 0
                ? "Has not thanked anyone yet this season."
                : `Thanked ${sheet.gratitude.givenThisSeason} members in return.`}
            </p>
          </section>
        ) : null}
      </div>
    </Layout>
  );
}
