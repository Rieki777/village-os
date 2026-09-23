import Layout from "@/components/Layout";
import { motion } from "framer-motion";
import { Users, ArrowRight, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { Image } from "@/components/Image";
import { useEffect, useState } from "react";
import { gameFetch, useGameConfig, useVillageLinks } from "@/lib/gameApi";
import { PeopleLockNote, type PeopleTier } from "@/components/PeopleLock";
import { useVillageName } from "@/hooks/useVillageName";
import { readVillageSection } from "@/hooks/useVillageContent";

interface TeamMember {
  name: string;
  role: string;
  circle?: string;
  bio?: string;
  photo?: string;
}

const advisoryHighlights = [
  "Regenerative Agriculture & Permaculture Leaders",
  "Wellness & Healing Arts Practitioners",
  "Education & Child Development Experts",
  "Arts & Culture Leaders",
  "Local Community Representatives",
  "Cultural Liaisons from where the village sits"
];

export default function Team() {
  const config = useGameConfig();
  const villageName = useVillageName();
  // Blank hides the button rather than pointing at another village.
  const { eventsUrl } = useVillageLinks();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  // The tier this page's copy of /api/org came back at, plus the two counts
  // that are public on every tier. Held for the lock note below.
  const [people, setPeople] = useState<PeopleTier | null>(null);
  const [seatCounts, setSeatCounts] = useState({ seats: 0, held: 0 });

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
            if (!h?.name) continue;
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
          <motion.div
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
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              The people holding seats here, and the circles they hold them in.
            </p>
          </motion.div>

          {/* Leadership */}
          <div className="mb-20">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="font-display text-3xl font-bold text-foreground mb-4">
                Leadership Circle
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                The full circle of roles, filled and open, lives on the{" "}
                <Link href="/roles" className="text-sage font-medium hover:underline">Roles &amp; Circles page</Link>.
              </p>
            </motion.div>

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
                Nobody holds a seat here yet. Seats and the people in them appear on this
                page as the village fills them.
              </p>
            ) : null}

            <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
              {(team ?? []).map((member, index) => (
                <motion.div
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
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="text-center mt-10"
            >
              <p className="text-muted-foreground text-sm max-w-xl mx-auto mb-4">
                The team is growing, and several leadership seats and steward roles are open right now.
              </p>
              <Link href="/roles" className="inline-flex items-center gap-2 text-sage font-semibold hover:underline">
                See the open seats <ArrowRight className="w-4 h-4" />
              </Link>
            </motion.div>
          </div>

          {/* Advisory Council */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="bg-amber/5 rounded-3xl p-8 md:p-12 border border-amber/20 mb-20"
          >
            <div className="text-center mb-10">
              <h2 className="font-display text-3xl font-bold text-foreground mb-4">
                Community Advisory Council
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Practitioners and thought leaders shaping this village's culture, partnerships, and community integration.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-4 max-w-4xl mx-auto mb-8">
              {advisoryHighlights.map((highlight, index) => (
                <motion.div
                  key={highlight}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  className="flex gap-3 items-start"
                >
                  <span className="text-amber font-bold text-lg flex-shrink-0">✦</span>
                  <p className="text-muted-foreground">{highlight}</p>
                </motion.div>
              ))}
            </div>
            <p className="text-center text-sm text-muted-foreground">
              Advisors receive First Right of Refusal on lot purchases, retreat discounts, and recognition as Founding Advisors.
            </p>
          </motion.div>

          {/* Development Board */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="bg-teal-deep/5 rounded-3xl p-8 md:p-12 border border-teal-deep/20 mb-20"
          >
            <div className="text-center">
              <h2 className="font-display text-3xl font-bold text-foreground mb-4">
                Development Board of Directors
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto mb-8">
                5-7 expert members providing strategic oversight, fiduciary responsibility, and guidance on business, legal, and financial aspects.
              </p>
              <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
                <div className="text-left">
                  <h3 className="font-semibold text-foreground mb-2">Expertise Areas</h3>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>Legal &amp; Regulatory</li>
                    <li>Real Estate Development</li>
                    <li>Financial &amp; Investment</li>
                  </ul>
                </div>
                <div className="text-left">
                  <h3 className="font-semibold text-foreground mb-2">Responsibilities</h3>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>Financial Oversight</li>
                    <li>Development Milestones</li>
                    <li>Investor Relations</li>
                  </ul>
                </div>
                <div className="text-left">
                  <h3 className="font-semibold text-foreground mb-2">Meeting Schedule</h3>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>Monthly Meetings</li>
                    <li>Quarterly Sessions</li>
                    <li>Annual Retreat</li>
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mt-16 bg-sage/5 p-8 rounded-2xl border border-sage/20"
          >
            <h2 className="font-display text-2xl font-bold text-foreground mb-4">
              Join Our Community
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-6">
              Whether you're an investor, resident, steward, or prosperity creator, there's a place for you at {villageName}.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/#choose-path">
                <span className="inline-flex items-center gap-2 px-6 py-3 bg-sage text-white rounded-lg hover:bg-sage/90 transition-colors font-medium cursor-pointer">
                  Find Your Path
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
                  Join Community Call
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
