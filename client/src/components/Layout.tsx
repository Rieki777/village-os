import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { TreePine, Menu, X, User, LogOut, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/modules/ModuleProvider";
import NotificationBell from "@/components/NotificationBell";
import NotificationToasts from "@/components/NotificationToasts";
import { altOr, useGameConfig } from "@/lib/gameApi";
import { NAV, ACCOUNT_MENU, isGroup, type NavLink, type NavGroup } from "@/config/nav";
import { useTokenName } from "@/hooks/useTokenNames";
import MobileTabBar, { isBareRoute } from "./mobile/MobileTabBar";
import MobileFab from "./mobile/MobileFab";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [openMobileGroup, setOpenMobileGroup] = useState<string | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const [location] = useLocation();
  const bare = isBareRoute(location);
  const { user, logout } = useAuth();
  // The shell's identity — logo, name, outside links, footer copy — comes
  // from the live config, never from literals: this is what makes a fork's
  // shell the fork's without touching a component. While config is loading
  // the logo boxes reserve their height (64px header / 90px footer) so the
  // page never shifts on first paint, and outside links simply don't render.
  const cfg = useGameConfig();
  const siteUrl = String(cfg?.project?.siteUrl ?? "").trim();
  const eventsUrl = String(cfg?.project?.eventsUrl ?? "").trim();
  const villageName = String(cfg?.project?.name ?? "").trim();
  // One subscription for the whole shell instead of thirteen useModule calls.
  // The nav is data now (config/nav.ts), and a list cannot call a hook per row.
  const { modules } = useModules();
  const moduleOn = (id?: string) => !id || modules.some((m) => m.id === id);
  const lifecycleOf = (id?: string) => modules.find((m) => m.id === id)?.lifecycle;

  // A link survives when its module is on AND the viewer holds one of its
  // roles. Both absent means everyone sees it. The role is read once into a
  // local so a signed-out viewer (no user, no role) filters out by the same
  // test rather than a second branch.
  const tokenName = useTokenName("Recognition");
  const role = user?.role;
  const visible = (item: NavLink) =>
    moduleOn(item.module) && (!item.roles || (!!role && item.roles.includes(role)));

  // An entry named after a token carries the village's word for it, and its
  // href stays put. Substituted HERE, once, because both the desktop dropdown
  // and the mobile drawer render their items through groupItems.
  const withTokenLabel = (link: NavLink): NavLink => (link.token ? { ...link, label: tokenName } : link);

  // Groups collapse to nothing when every child is filtered out, so a fork with
  // its optional modules off never renders an empty dropdown.
  const groupItems = (group: NavGroup) => group.items.filter(visible).map(withTokenLabel);
  const navEntries = NAV.filter((e) => (isGroup(e) ? groupItems(e).length > 0 : visible(e))).map((e) =>
    isGroup(e) ? e : withTokenLabel(e),
  );
  const accountItems = ACCOUNT_MENU.filter(visible);

  // Footer-only modules. A gated footer link would be a dead end on a fresh
  // fork, because every one of these pages renders NotFound with its module
  // off and every optional module ships off.
  const commerceModule = moduleOn("commerce");
  const networkModule = moduleOn("network");
  const crowdpoolModule = moduleOn("crowdpool");
  const staysModule = moduleOn("stays");
  const toolsModule = moduleOn("tools");
  const healthModule = moduleOn("health");
  const mapModule = moduleOn("map");

  // A click anywhere else closes the account menu. Without this the only way
  // out was to click the trigger again, and the menu covered the page beneath.
  useEffect(() => {
    if (!accountOpen) return;
    const onDown = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [accountOpen]);

  // The bottom tab bar's "More" slot opens this same drawer rather than being a
  // second, separately-maintained menu. No scrolling: the header is sticky, so
  // the drawer is already in view wherever the person is on the page. An earlier
  // version scrolled to the top first and the smooth scroll fought the drawer's
  // height animation, jumping the page a few hundred pixels down instead.
  useEffect(() => {
    const openMenu = () => setMobileMenuOpen(true);
    window.addEventListener("open-mobile-menu", openMenu);
    return () => window.removeEventListener("open-mobile-menu", openMenu);
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      {/*
       * Skip link. Measured before it existed: 40 to 63 focus stops between the
       * first Tab and the page content, on every route, because the header nav
       * and its dropdowns come first. A keyboard or switch user paid that toll
       * on every navigation.
       *
       * Visually hidden until focused rather than display:none, because a
       * display:none link is not focusable and the skip link would not exist
       * for exactly the people it is for.
       */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-white focus:text-teal-deep focus:font-semibold focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-teal-deep"
      >
        Skip to content
      </a>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-teal-deep text-white shadow-lg">
        <div className="container py-4 flex items-center justify-between">
          {/* One anchor, not two. wouter's Link renders the <a> itself, so a
              nested <a> is invalid markup: the browser closes the outer one
              early and leaves an EMPTY focusable link as the first stop in
              the tab order on every page, so a keyboard or screen-reader user
              meets an unnamed link before anything else on the site.

              THE HOME LINK IS NEVER EMPTY, BECAUSE AN EMPTY ONE IS NOT A LINK.

              A village with no uploaded logo used to get a bare 64px spacer
              here. An empty flex child gives the anchor a width of ZERO:
              measured 0px on the live deployment, with a click at the centre
              of the header landing on the surrounding div and never on the
              link. On a phone that left the entire header with no visible
              character in it. Every one of the thirteen deployments starts
              in that state and the one that is live is in it now.

              So the name is the wordmark. It is set in the village's own
              display face, so a village that has chosen a font gets its own
              lettering, and it re-themes with the rest of the shell rather
              than being a second thing to upload.

              The third branch is the one a falsiness check cannot tell apart
              from the second: config still in flight is not the same fact as
              a village with no name. While cfg is null nothing is known yet,
              so the box holds a width as well as its 64px height, and the
              home link stays clickable THROUGH the load instead of only
              after it. */}
          <Link
            href="/"
            aria-label={villageName ? `${villageName} home` : "Home"}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            style={{ minHeight: "64px" }}
          >
            {cfg?.images?.logo ? (
              <img
                src={cfg.images.logo}
                alt={altOr(cfg.images.logoAlt, villageName || "Village logo")}
                style={{ height: "64px", width: "auto" }}
                draggable={false}
              />
            ) : villageName ? (
              /* A flex item of the link above, which is already `items-center`
                 inside a 64px box, so the wordmark sits on the same baseline
                 the logo would have. `truncate` caps a long name rather than
                 letting it push the menu button off a narrow screen. */
              <span className="font-display text-xl sm:text-2xl font-semibold tracking-wide text-white truncate max-w-[60vw] lg:max-w-[16rem]">
                {villageName}
              </span>
            ) : (
              <span
                aria-hidden="true"
                style={{ height: "64px", width: "7rem", display: "inline-block" }}
              />
            )}
          </Link>

          {/* Desktop Menu.
              Shown from `lg`. The old bar carried seventeen top-level links,
              measured ~1250px, and could only render from `xl`: every viewport
              between 768px and ~1310px got no desktop nav at all, and below xl
              some pages scrolled sideways. Six grouped entries fit in roughly
              half the width. This breakpoint and the mobile button's below are
              a matched pair and must always move together, or some viewport
              gets no navigation at all. */}
          <div className="hidden lg:flex items-center gap-4 xl:gap-6">
            {navEntries.map((entry) =>
              isGroup(entry) ? (
                <NavDropdown
                  key={entry.label}
                  group={entry}
                  items={groupItems(entry)}
                  open={openGroup === entry.label}
                  setOpen={(v) => setOpenGroup(v ? entry.label : null)}
                  lifecycleOf={lifecycleOf}
                />
              ) : (
                <Link
                  key={entry.href}
                  href={entry.href}
                  className="text-white hover:underline transition-colors text-sm whitespace-nowrap"
                >
                  {entry.label}
                </Link>
              )
            )}

            {user ? (
              <div className="flex items-center gap-3">
                <NotificationBell />
                {/* The profile link and sign out used to sit side by side with
                    twelve pixels between them, and sign out was a bare icon
                    with no background of its own: at a glance the arrow read
                    as part of the name pill, so the bar said "Rye→". One stray
                    click ended the session on every device, because
                    tokenVersion is the only revocation lever there is. Sign
                    out now lives inside this menu, under a divider. */}
                <div
                  className="relative"
                  ref={accountRef}
                  onKeyDown={(e) => { if (e.key === "Escape") setAccountOpen(false); }}
                >
                  <button
                    type="button"
                    onClick={() => setAccountOpen((v) => !v)}
                    aria-expanded={accountOpen}
                    aria-haspopup="true"
                    aria-controls="account-menu"
                    className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
                  >
                    <User className="w-4 h-4" />
                    <span>{user.name.split(" ")[0]}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${accountOpen ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {accountOpen && (
                      <motion.div
                        id="account-menu"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full right-0 mt-2 w-52 bg-white rounded-xl shadow-xl overflow-hidden z-50"
                      >
                        {accountItems.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            className="block px-4 py-2.5 text-sm text-foreground hover:bg-gray-50 transition-colors"
                            onClick={() => setAccountOpen(false)}
                          >
                            {item.label}
                          </Link>
                        ))}
                        <button
                          type="button"
                          onClick={() => { setAccountOpen(false); logout(); }}
                          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-coral hover:bg-gray-50 transition-colors text-left border-t border-gray-100"
                          // "Everywhere" is honest, not decorative: tokenVersion
                          // is the only revocation lever, so this ends the
                          // session on every device the member is signed in on.
                          title="Sign out everywhere"
                        >
                          <LogOut className="w-4 h-4" />
                          Sign Out Everywhere
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            ) : (
              <Link href="/login" className="flex items-center gap-2 px-3 py-1.5 bg-black/10 hover:bg-black/20 rounded-lg text-sm transition-colors whitespace-nowrap">
                <User className="w-4 h-4" />
                Sign In
              </Link>
            )}

            {siteUrl && (
              <a
                href={siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-amber text-foreground rounded-lg font-medium hover:bg-amber/90 transition-colors text-sm whitespace-nowrap"
              >
                Main Site
              </a>
            )}
          </div>

          {/* Mobile Menu Button (bell beside it when signed in) */}
          <div className="lg:hidden flex items-center gap-1 text-white">
            {user && <NotificationBell />}
            {/* Icon-only, so it needs a spoken name and a state a screen
                reader can hear — otherwise it announces as bare "button". */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
              className="text-white inline-flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:-m-2"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              id="mobile-menu"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              // bg-teal-band, not bg-teal-deep: this drawer carries the
              // amber accent below as small TEXT, and shared/brandTokens.ts
              // only guarantees that pairing (--tone-sun-on-band vs
              // --tone-brand-band) against band. Checked across all 54
              // CHARACTER_CARDS x seed combinations: sun-on-band against
              // brand (teal-deep) fails 46 of them (worst 2.11:1); against
              // band it holds for all of them (brandTokens.test.ts's own
              // "accent on band" assertion). white text only gets safer on
              // the darker surface (band's own contrast floor for white is
              // 5.36:1 worst case vs brand's 4.50:1), so nothing else in
              // this drawer is put at risk by the change.
              className="lg:hidden bg-teal-band/95 border-t border-white/10 overflow-hidden"
            >
              <div className="container py-4 space-y-1">
                {navEntries.map((entry) =>
                  isGroup(entry) ? (
                    <div key={entry.label}>
                      <button
                        type="button"
                        onClick={() => setOpenMobileGroup(openMobileGroup === entry.label ? null : entry.label)}
                        aria-expanded={openMobileGroup === entry.label}
                        className="flex items-center justify-between w-full text-white hover:underline transition-colors text-sm py-2"
                      >
                        <span>{entry.label}</span>
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${openMobileGroup === entry.label ? "rotate-180" : ""}`} />
                      </button>
                      <AnimatePresence>
                        {openMobileGroup === entry.label && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden pl-3 border-l border-white/20 ml-1"
                          >
                            {groupItems(entry).map((item) => (
                              <Link
                                key={item.href}
                                href={item.href}
                                className={`block transition-colors text-sm py-1.5 ${item.accent ? "text-amber-on-band hover:underline" : "text-white hover:underline"}`}
                                onClick={() => { setMobileMenuOpen(false); setOpenMobileGroup(null); }}
                              >
                                {item.label}
                                {lifecycleOf(item.module) === "preview" ? " (preview)" : ""}
                              </Link>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <Link
                      key={entry.href}
                      href={entry.href}
                      className="block text-white hover:underline transition-colors text-sm py-2"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {entry.label}
                    </Link>
                  )
                )}

                {/* The account block sits under a rule of its own, so sign out
                    is never the neighbour of an ordinary destination. These
                    links also close the drawer now: the old pair did not, so
                    tapping "My Profile" navigated with the menu still open
                    over the page. */}
                <div className="pt-2 mt-2 border-t border-white/10 space-y-1">
                  {user ? (
                    <>
                      {accountItems.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="block text-white hover:underline transition-colors text-sm py-2"
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          {item.label === "My Profile" ? `My Profile (${user.name.split(" ")[0]})` : item.label}
                        </Link>
                      ))}
                      <button
                        onClick={() => { setMobileMenuOpen(false); logout(); }}
                        className="block text-white hover:opacity-80 transition-opacity text-sm py-2 text-left"
                      >
                        Sign Out Everywhere
                      </button>
                    </>
                  ) : (
                    <Link
                      href="/login"
                      className="block text-white hover:underline transition-colors text-sm py-2"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Sign In / Register
                    </Link>
                  )}
                </div>

                {siteUrl && (
                  <a
                    href={siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-2 bg-amber text-foreground rounded-lg font-medium hover:bg-amber/90 transition-colors text-center mt-3"
                  >
                    Main Site
                  </a>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* Main Content */}
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-teal-deep text-white py-16">
        <div className="container">
          <div className="grid md:grid-cols-5 gap-12 mb-12">
            {/* Brand */}
            <div className="md:col-span-1">
              {/* The box is reserved WHILE THE CONFIG LOADS and only then, which
                  is the same three-way distinction the header link makes above.
                  It used to be unconditional, so a village that has uploaded no
                  heart mark published a 154x90 hole in its own footer, above
                  the blurb, forever. The header's defect was a link nobody
                  could click; this one is only dead space, but it comes from
                  the same place: `null` config and "no mark uploaded" are
                  different facts and the box was treating them as one. */}
              {cfg === null ? (
                <div aria-hidden="true" style={{ height: "90px" }} className="mb-4" />
              ) : cfg.images?.heartLogo ? (
                <div className="flex items-center gap-2 mb-4">
                  <img
                    src={cfg.images.heartLogo}
                    alt={altOr(cfg.images.heartLogoAlt, villageName || "Village mark")}
                    style={{ height: "90px", width: "auto" }}
                    draggable={false}
                  />
                </div>
              ) : null}
              {cfg?.project?.footerBlurb && (
                <p className="text-white text-sm leading-relaxed">{cfg.project.footerBlurb}</p>
              )}
            </div>

            {/* Your Journey */}
            <div>
              <h2 className="font-display text-lg font-semibold mb-4">Your Journey</h2>
              <ul className="space-y-2">
                <li>
                  <Link href="/investor" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Investor
                  </Link>
                </li>
                <li>
                  <Link href="/steward" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Village Steward
                  </Link>
                </li>
                <li>
                  <Link href="/resident" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Resident
                  </Link>
                </li>
                <li>
                  <Link href="/prosperity" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Prosperity Creator
                  </Link>
                </li>
                <li>
                  <Link href="/love-letter" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Sign the Love Letter
                  </Link>
                </li>
                <li>
                  <Link href="/visit" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Plan a Visit
                  </Link>
                </li>
                <li>
                  <Link href="/gratitude" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    {tokenName} Wall
                  </Link>
                </li>
                <li>
                  <Link href="/work-with-us" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Work With Us
                  </Link>
                </li>
              </ul>
            </div>

            {/* Governance & Structure */}
            <div>
              <h2 className="font-display text-lg font-semibold mb-4">Governance</h2>
              <ul className="space-y-2">
                <li>
                  <Link href="/governance" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Governance
                  </Link>
                </li>
                <li>
                  <Link href="/circles" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Circles
                  </Link>
                </li>
                <li>
                  <Link href="/roles" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Roles & Leadership
                  </Link>
                </li>
                <li>
                  <Link href="/how-we-create" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    How We Create
                  </Link>
                </li>
                <li>
                  <Link href="/good-neighbor" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Good Neighbor Criteria
                  </Link>
                </li>
                <li>
                  <Link href="/team" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Our Team
                  </Link>
                </li>
                {/* Three pages the app mounted and then linked from nowhere.
                    The module-gated two must stay gated: both render NotFound
                    when their module is off, which is the default for every
                    optional module, so an ungated link would be a dead end on
                    a fresh fork. /exit-policy is core and always reachable. */}
                <li>
                  <Link href="/game-mechanics" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Game Mechanics
                  </Link>
                </li>
                <li>
                  <Link href="/exit-policy" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Leaving Well
                  </Link>
                </li>
                {networkModule && (
                  <li>
                    <Link href="/network" className="text-white hover:underline transition-colors text-sm block py-1.5">
                      Village Network
                    </Link>
                  </li>
                )}
                {/* The health dashboard had one door in the whole client, the
                    Village menu, and a menu reshuffle would have taken it. */}
                {healthModule && (
                  <li>
                    <Link href="/village-health" className="text-white hover:underline transition-colors text-sm block py-1.5">
                      Village Health
                    </Link>
                  </li>
                )}
                {/* The review queue. Signed-in only, because a visitor has no
                    use for it, and NOT gated on admin here: the whole point of
                    that page is that a steward who is not an admin can open
                    it, and a door only admins can see would put it back where
                    it started. The page itself says plainly when the person
                    looking may not open it, so a member who follows this link
                    without the capability gets a sentence and never a blank
                    screen. */}
                {user && (
                  <li>
                    <Link href="/review" className="text-white hover:underline transition-colors text-sm block py-1.5">
                      Review Queue
                    </Link>
                  </li>
                )}
              </ul>
            </div>

            {/* Resources */}
            <div>
              <h2 className="font-display text-lg font-semibold mb-4">Resources</h2>
              <ul className="space-y-2">
                <li>
                  <Link href="/co-creators-guide" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Co-Creators Guide
                  </Link>
                </li>
                <li>
                  <Link href="/feedback" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Report a Bug / Share an Idea
                  </Link>
                </li>
                <li>
                  <Link href="/quests" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Community Quests
                  </Link>
                </li>
                {commerceModule && (
                  <li>
                    <Link href="/contribute" className="text-white hover:underline transition-colors text-sm block py-1.5">
                      Contribute
                    </Link>
                  </li>
                )}
                {/* Three module pages that lived behind exactly one menu entry
                    each. The footer is the second door: it is on every page, it
                    survives a nav reshuffle, and it costs a fork nothing when
                    the module is off. */}
                {crowdpoolModule && (
                  <li>
                    <Link href="/campaigns" className="text-white hover:underline transition-colors text-sm block py-1.5">
                      Our Raisings
                    </Link>
                  </li>
                )}
                {staysModule && (
                  <li>
                    <Link href="/stay" className="text-white hover:underline transition-colors text-sm block py-1.5">
                      Stay With Us
                    </Link>
                  </li>
                )}
                {toolsModule && (
                  <li>
                    <Link href="/tools" className="text-white hover:underline transition-colors text-sm block py-1.5">
                      Village Tools
                    </Link>
                  </li>
                )}
                {mapModule && (
                  <li>
                    <Link href="/places" className="text-white hover:underline transition-colors text-sm block py-1.5">
                      Places, Photographed
                    </Link>
                  </li>
                )}
                <li>
                  <Link href="/housing" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Housing
                  </Link>
                </li>
                <li>
                  <Link href="/opportunities" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Business Opportunities
                  </Link>
                </li>
                <li>
                  <Link href="/master-plan" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    Master Plan
                  </Link>
                </li>
              </ul>
            </div>

            {/* Connect */}
            <div>
              <h2 className="font-display text-lg font-semibold mb-4">Connect</h2>
              <ul className="space-y-2">
                {siteUrl && (
                  <li>
                    <a
                      href={siteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white hover:underline transition-colors text-sm block py-1.5"
                    >
                      Main Website
                    </a>
                  </li>
                )}
                {eventsUrl && (
                  <li>
                    <a
                      href={eventsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white hover:underline transition-colors text-sm block py-1.5"
                    >
                      Events
                    </a>
                  </li>
                )}
                <li>
                  <Link href="/profile" className="text-white hover:underline transition-colors text-sm block py-1.5">
                    My Village Profile
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/20 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            {/* Solid white, not a fade. --color-teal-deep is a mid-tone, so
                even 100% white lands at 4.81:1 and every step of opacity below
                that drops small text under AA. Fine print gets its quietness
                from size here, not from lightness. */}
            <p className="text-white text-sm">
              © {new Date().getFullYear()}{villageName ? ` ${villageName}.` : ""} All rights reserved.
            </p>
            <div className="flex items-center gap-2 text-white text-sm">
              <TreePine className="w-4 h-4" />
              <span>Built with Pura Vida by ReGenCivics.Earth</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Clearance so the fixed tab bar never covers the end of the footer.
          Height comes from --tabbar-h (index.css), which is the bar's own
          measurement and collapses to 0 from `md` up. It used to be spelled
          out here a second time, one border-width short of the truth, and a
          change to the bar's height would not have reached it. It is dropped
          entirely on the routes that render no bar. */}
      {!bare && <div aria-hidden="true" style={{ height: "var(--tabbar-h)" }} />}

      <MobileTabBar />
      <MobileFab />
      {/* ONCE, deliberately. The bell above renders twice (desktop bar, mobile
          bar) and CSS hides one of them; React mounts both. The celebration
          surface and the page's single polite live region live here so a
          member never sees the same moment twice. */}
      {user && <NotificationToasts />}
    </div>
  );
}

/**
 * One grouped menu in the desktop bar.
 *
 * Hover opens it for a mouse, click toggles it for a keyboard, and Escape
 * closes it. All three matter: the dropdown this replaces opened on hover
 * ONLY, because its trigger carried no onClick, so Enter and Space fired a
 * click with no listener and its children never entered the tab order at any
 * desktop width. Escape is the second way out that a click-toggle needs, since
 * a mouse user whose pointer is still inside the wrapper fires no fresh
 * mouseenter and could not otherwise reopen it.
 */
function NavDropdown({
  group,
  items,
  open,
  setOpen,
  lifecycleOf,
}: {
  group: NavGroup;
  items: readonly NavLink[];
  open: boolean;
  setOpen: (open: boolean) => void;
  lifecycleOf: (id?: string) => string | undefined;
}) {
  // The join paths carry a second line; the rest are one word. A single width
  // for both leaves either the paths cramped or the short menus floating.
  const wide = items.some((i) => i.subtitle);
  const menuId = `nav-menu-${group.label.toLowerCase()}`;

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={menuId}
        className="flex items-center gap-1 text-white hover:underline transition-colors text-sm whitespace-nowrap"
      >
        {group.label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 ${wide ? "w-60" : "w-48"} bg-white rounded-xl shadow-xl overflow-hidden z-50`}
          >
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors group"
                onClick={() => setOpen(false)}
              >
                {item.icon && (
                  <span className="mt-0.5 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                    <item.icon className="w-3.5 h-3.5 text-primary" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${item.accent ? "text-gold" : "text-foreground"}`}>
                    {item.label}
                    {/* Same badge the bar used to carry, in the ink the white
                        sheet needs: amber-200 on white measured below 2:1. */}
                    {lifecycleOf(item.module) === "preview" && (
                      <span className="ml-1.5 text-[9px] bg-amber/30 text-gold px-1 py-0.5 rounded uppercase align-middle">preview</span>
                    )}
                  </span>
                  {item.subtitle && <span className="block text-xs text-muted-foreground">{item.subtitle}</span>}
                </span>
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
