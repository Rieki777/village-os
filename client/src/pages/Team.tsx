import Layout from "@/components/Layout";
import { m } from "framer-motion";
import { Users, ArrowRight, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { Image } from "@/components/Image";
import { useEffect, useState } from "react";
import { gameFetch, useGameConfig, useVillageLinks } from "@/lib/gameApi";
import { PeopleLockNote, type PeopleTier } from "@/components/PeopleLock";
import { readVillageSection } from "@/hooks/useVillageContent";
import { usePageContent } from "@/hooks/usePageContent";
import { Emphasized } from "@/components/PageText";
import { TEAM_PAGE } from "@shared/pageContent/team";
import { orgRowIsAgent } from "@shared/roleSheetInputs";

interface TeamMember {
  name: string;
  role: string;
  circle?: string;
  bio?: string;
  photo?: string;
}

/**
 * How many roles have a place nobody holds, from the counts /api/org gives
 * every reader. An example role is the platform's, never this village's
 * opening. The page used to say "several roles are open right now" under a
 * village with every role filled; this is what it asks first now.
 */
export function openRoleCount(roles: ReadonlyArray<{ seats?: unknown; holderCount?: unknown; isExample?: unknown }>): number {
  return roles.filter((r) => !r.isExample && Number(r.holderCount ?? 0) < Number(r.seats ?? 1)).length;
}

/** A board column's lines, blanks left out. */
const columnLines = (column: Readonly<Record<string, string>>) =>
  [column.first, column.second, column.third, column.fourth].filter((line) => (line ?? "").trim() !== "");

export default function Team() {
  const config = useGameConfig();
  // Every word on this page that is not a person's is the village's own, from
  // Admin, Pages, Team (shared/pageContent/team.ts). Null until the saved
  // words have arrived, so the defaults never flash first.
  const page = usePageContent(TEAM_PAGE);
  // Blank hides the button rather than pointing at another village.
  const { eventsUrl } = useVillageLinks();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  // The tier this page's copy of /api/org came back at, plus the two counts
  // that are public on every tier. Held for the lock note below.
  const [people, setPeople] = useState<PeopleTier | null>(null);
  const [seatCounts, setSeatCounts] = useState({ seats: 0, held: 0, open: 0 });

  useEffect(() => {
    // Two sources, merged. Seats and their holders come from the org rows
    // (0049), so anyone actually holding a seat appears here without being
    // added to a second list by hand. The team cards still supply photos and
    // bios, matched by name, because a row has no portrait.
    //
    // Before this the Team page was its own hand-kept list, and it showed two
    // people out of the eight who held seats.
    //
    // `gameFetch` CARRIES THE TOKEN and a bare `fetch` does not, which is the
    // whole reason this line changed. `/api/org` tiers its holder names
    // behind `map.viewPeople`, `authedUser` reads the Authorization header
    // alone with no cookie fallback, and this page had never sent one: the
    // capability was therefore consulted on a viewer that was always null,
    // and it had never granted anybody anything here.
    Promise.all([
      gameFetch("/api/org").then((r) => (r.ok ? r.json() : { circles: [], roles: [] })).catch(() => ({ circles: [], roles: [] })),
      // Through the section listing, so a fork that has written no team cards
      // never requests them (see client/src/hooks/useVillageContent.ts).
      readVillageSection("team").then((cards) => (Array.isArray(cards) ? cards : [])),
    ])
      .then(([org, cards]) => {
        setPeople(org.people ?? null);
        setSeatCounts({
          seats: (org.roles ?? []).reduce((n: number, r: any) => n + Number(r.seats ?? 0), 0),
          held: (org.roles ?? []).reduce((n: number, r: any) => n + Number(r.holderCount ?? 0), 0),
          open: openRoleCount(org.roles ?? []),
        });
        const profileByName = new Map<string, any>();
        for (const c of Array.isArray(cards) ? cards : []) {
          if (c?.name) profileByName.set(String(c.name).trim().toLowerCase(), c);
        }
        const circleName = new Map<string, string>(
          (org.circles ?? []).map((c: any) => [c.id, c.name]),
        );
        // One entry per person, carrying every seat they hold.
        const seatsByPerson = new Map<string, { name: string; seats: string[]; circle?: string }>();
        for (const r of org.roles ?? []) {
          for (const h of r.holders ?? []) {
            // An agent is not a person on the team. Its member row carries a
            // vendor's product name and its public row reads "An agent", and
            // either one would become a person's card here.
            if (!h?.name || orgRowIsAgent(h)) continue;
            const key = String(h.name).trim().toLowerCase();
            const entry = seatsByPerson.get(key) ?? {
              name: String(h.name).trim(),
              seats: [],
              circle: circleName.get(r.circleId) ?? undefined,
            };
            entry.seats.push(h.focus ? `${r.name} (${h.focus})` : r.name);
            seatsByPerson.set(key, entry);
          }
        }
        const merged: TeamMember[] = Array.from(seatsByPerson.values()).map((p) => {
          const card = profileByName.get(p.name.toLowerCase());
          return {
            name: card?.name ?? p.name,
            role: p.seats.join(" · "),
            /*
             * THE LIVE CIRCLE NAME WINS OVER THE CARD'S.
             *
             * These two were the other way around, so a founder who renamed a
             * circle in Admin, Org Chart watched /circles and /roles update and
             * /team keep printing the old name, out of the same team-card store
             * the banner above that editor says the public pages no longer
             * read. The card still supplies what a seat row has no place for, a
             * portrait and a bio, and it fills in the circle only for somebody
             * whose seat sits in none.
             */
            circle: p.circle ?? card?.circle,
            bio: card?.bio,
            photo: card?.photo,
          };
        });
        // A card for somebody who holds no seat still belongs on the page.
        for (const c of Array.isArray(cards) ? cards : []) {
          if (!c?.name) continue;
          if (!seatsByPerson.has(String(c.name).trim().toLowerCase())) merged.push(c);
        }
        setTeam(merged);
      })
      .catch(() => setTeam([]));
  }, []);

  return (
    <Layout>
      <section className="py-24 bg-background">
        <div className="container">
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <div className="w-16 h-16 rounded-full bg-sage/10 flex items-center justify-center mx-auto mb-6">
              <Users className="w-8 h-8 text-sage" />
            </div>
            {/* The heading and the sentence under it used to name one village
                and describe that village's founding team, so every fork of this
                platform published a claim about four people it had never met.
                The name comes from the live config now, and the sentence says
                only what is true of any village reading it. */}
            <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4">
              {config?.project?.name ? `The ${config.project.name} Team` : "The Team"}
            </h1>
            <p className={`text-xl text-muted-foreground max-w-2xl mx-auto break-words${page ? "" : " invisible"}`}>
              <Emphasized text={page?.header.fields.intro || "\u00a0"} />
            </p>
          </m.div>

          {/* Leadership */}
          <div className="mb-20">
            <m.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className={`font-display text-3xl font-bold text-foreground mb-4 break-words${page ? "" : " invisible"}`}>
                {page?.leadership.fields.heading || "\u00a0"}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                The full circle of roles, filled and open, lives on the{" "}
                <Link href="/roles" className="text-sage font-medium hover:underline">Roles &amp; Circles page</Link>.
              </p>
            </m.div>

            {/* Members-only people: say so, with the counts that stay public.
                Without this the grid below simply renders short and a visitor
                reads a busy village as an empty one. */}
            <div className="mb-12">
              <PeopleLockNote people={people} seats={seatCounts.seats} held={seatCounts.held} />
            </div>

            {/* R55: a village with nobody seated yet is new, not failing. The
                grid used to render zero cards under three headings, which reads
                as a broken page rather than an early one, and it read that way
                on a fork's very first day. */}
            {team !== null && team.length === 0 && people?.visible ? (
              <p className="text-center text-muted-foreground max-w-xl mx-auto">
                Nobody holds a role here yet. Roles and the people in them appear on this
                page as the village fills them.
              </p>
            ) : null}

            <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
              {(team ?? []).map((member, index) => (
                <m.div
                  key={member.name}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  whileHover={{ y: -6 }}
                  className="bg-card rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-border"
                >
                  {member.photo && (
                    <div className="h-64 overflow-hidden">
                      <Image
                        src={member.photo}
                        alt={member.name}
                        className="w-full h-full"
                        imgClassName="object-top"
                      />
                    </div>
                  )}
                  <div className="p-6">
                    <h3 className="font-display text-xl font-bold text-foreground mb-1">
                      {member.name}
                    </h3>
                    <p className="text-sage font-semibold text-sm mb-2">
                      {member.role}
                    </p>
                    {member.circle && (
                      <p className="text-xs text-muted-foreground mb-3 pb-3 border-b border-border">
                        {member.circle}
                      </p>
                    )}
                    {member.bio && (
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {member.bio}
                      </p>
                    )}
                  </div>
                </m.div>
              ))}
            </div>

            {/* Said only while a role really is open: counted from /api/org,
                whose seat counts every reader gets. */}
            {page && seatCounts.open > 0 && (
            <m.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="text-center mt-10"
            >
              {page.leadership.fields.openNote && (
              <p className="text-muted-foreground text-sm max-w-xl mx-auto mb-4 break-words">
                <Emphasized text={page.leadership.fields.openNote} />
              </p>
              )}
              <Link href="/roles" className="inline-flex items-center gap-2 text-sage font-semibold hover:underline">
                {page.leadership.fields.openLink} <ArrowRight className="w-4 h-4" />
              </Link>
            </m.div>
            )}
          </div>

          {/* Advisory Council: a village with none hides it in Admin, Pages, Team. */}
          {page && !page.advisory.hidden && (
          <m.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="bg-amber/5 rounded-3xl p-6 sm:p-8 md:p-12 border border-amber/20 mb-20"
          >
            <div className="text-center mb-10">
              <h2 className="font-display text-3xl font-bold text-foreground mb-4 break-words">
                {page.advisory.fields.heading}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto break-words">
                <Emphasized text={page.advisory.fields.intro} />
              </p>
            </div>
            {page.advisory.lists.items.length > 0 && (
            <div className="grid md:grid-cols-2 gap-4 max-w-4xl mx-auto mb-8">
              {page.advisory.lists.items.map((item, index) => (
                <m.div
                  key={`${index}-${item.text}`}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  className="flex gap-3 items-start"
                >
                  <span className="text-amber font-bold text-lg flex-shrink-0">✦</span>
                  <p className="text-muted-foreground min-w-0 break-words">{item.text}</p>
                </m.div>
              ))}
            </div>
            )}
            {page.advisory.fields.terms && (
            <p className="text-center text-sm text-muted-foreground break-words">
              <Emphasized text={page.advisory.fields.terms} />
            </p>
            )}
          </m.div>
          )}

          {/* Board: a village with none hides it in Admin, Pages, Team. */}
          {page && !page.board.hidden && (
          <m.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="bg-teal-deep/5 rounded-3xl p-6 sm:p-8 md:p-12 border border-teal-deep/20 mb-20"
          >
            <div className="text-center">
              <h2 className="font-display text-3xl font-bold text-foreground mb-4 break-words">
                {page.board.fields.heading}
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto mb-8 break-words">
                <Emphasized text={page.board.fields.intro} />
              </p>
              {page.board.lists.columns.length > 0 && (
              <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
                {page.board.lists.columns.map((column, index) => (
                <div key={`${index}-${column.heading}`} className="text-left min-w-0">
                  <h3 className="font-semibold text-foreground mb-2 break-words">{column.heading}</h3>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {columnLines(column).map((line, i) => (
                      <li key={`${i}-${line}`} className="break-words">{line}</li>
                    ))}
                  </ul>
                </div>
                ))}
              </div>
              )}
            </div>
          </m.div>
          )}

          {/* CTA */}
          {page && !page.cta.hidden && (
          <m.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mt-16 bg-sage/5 p-6 sm:p-8 rounded-2xl border border-sage/20"
          >
            <h2 className="font-display text-2xl font-bold text-foreground mb-4 break-words">
              {page.cta.fields.heading}
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-6 break-words">
              <Emphasized text={page.cta.fields.body} />
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/#choose-path">
                <span className="inline-flex items-center gap-2 px-6 py-3 bg-sage text-white rounded-lg hover:bg-sage/90 transition-colors font-medium cursor-pointer">
                  {page.cta.fields.pathLabel}
                  <ArrowRight className="w-4 h-4" />
                </span>
              </Link>
              {eventsUrl && (
                <a
                  href={eventsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors font-medium"
                >
                  {page.cta.fields.callLabel}
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </m.div>
          )}
        </div>
      </section>
    </Layout>
  );
}
