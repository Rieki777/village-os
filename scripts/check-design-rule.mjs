#!/usr/bin/env node
/**
 * The design rule, held (docs/DESIGN_RULE.md).
 *
 * The lead, 10 Nov 2026: "the design of the role proposal flow doesn't match
 * the design of the rest of the site. We should definitely have a built in rule
 * for matching designs." The rule is the profile's own look: the sheet's night
 * world (`.sheet-night`), the semantic colour tokens, the display face, three
 * corner sizes and one shadow. client/src/components/journey/look.ts names it
 * as class strings; this script fails when a journey file draws outside it.
 *
 * WHAT IT CHECKS, on the files in JOURNEY below (comments stripped first):
 *
 *   world      every journey PAGE imports WORLD from components/journey/look
 *              and puts it on an element, so it stands on the sheet's ground.
 *   palette    no Tailwind default-palette colour (`text-stone-600`,
 *              `bg-red-50`): use the semantic token (`text-muted-foreground`,
 *              `bg-destructive/10`).
 *   tone       no tone-layer colour that the night world does not re-theme
 *              (`text-sage`, `bg-cream`, `text-teal-deep`, `bg-white`): use
 *              `text-open`, `bg-card`, `text-notice`. The one brand fill the
 *              profile keeps, `bg-teal-deep` with `hover:bg-teal-deep-dark`
 *              and white text, is allowed.
 *   colour     no literal colour in a class (`bg-[#fff]`, `text-[rgb(...)]`).
 *   font       no ad-hoc family (`font-serif`, `font-mono`, `font-[...]`):
 *              `font-display` for headings, the body face for the rest,
 *              `font-accent` for a signed letter.
 *   radius     corners from the scale only: `rounded-lg` (fields, buttons),
 *              `rounded-xl` (tiles, main buttons), `rounded-2xl` (panels),
 *              `rounded-full` (rings, chips). Never `rounded-md`, `-sm`,
 *              `-3xl` or `rounded-[...]`.
 *   shadow     `shadow-sm` only (the sheet deepens it on the night ground);
 *              never `shadow-md`/`-lg`/`-xl`/`-2xl`/`shadow-[...]`.
 *   type       no arbitrary text size or tracking (`text-[11px]`,
 *              `tracking-[0.14em]`): `text-xs`, `tracking-widest`.
 *
 * WHY A LIST AND NOT THE TREE. The rule landed with the joining journey made to
 * pass it. Most of the rest of client/src predates it; `--report` prints what
 * it WOULD flag there, file by file, so the next page brought into the rule is
 * chosen from a measured list. Adding a file to JOURNEY is how a page joins.
 *
 * A genuine exception takes `design-ok: <reason>` on its line, and the count of
 * waivers is printed so they stay honest.
 *
 * The colour gates beside it (check-tailwind-palette.mjs, check-theme-literals.mjs)
 * are repo-wide ratchets on colour alone; this one is a hard rule on a short
 * list and also covers type, corners, shadow and the world.
 *
 * Usage:
 *   node scripts/check-design-rule.mjs             # the gate
 *   node scripts/check-design-rule.mjs --report    # what it would flag outside the list
 *   node scripts/check-design-rule.mjs --root <dir> --files a.tsx,b.tsx --pages a.tsx   # self-test
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./brand-strip.mjs";

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const ROOT = path.resolve(flag("--root") ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const REPORT = process.argv.includes("--report");

/** Journey pages: each stands in the sheet's world. */
const PAGES = [
  "client/src/pages/Roles.tsx",
  "client/src/pages/RoleDraft.tsx",
  "client/src/pages/ProposeARole.tsx",
  "client/src/pages/Propose.tsx",
  "client/src/pages/LoveLetter.tsx",
  "client/src/pages/ApplicationStatus.tsx",
  "client/src/pages/StewardJourney.tsx",
  "client/src/pages/Quests.tsx",
  "client/src/pages/RoleMeasures.tsx",
  "client/src/pages/Approvals.tsx",
  "client/src/pages/VerifyEmail.tsx",
  "client/src/pages/SetPassword.tsx",
  "client/src/pages/Register.tsx",
  "client/src/pages/Aligned.tsx",
  "client/src/pages/SeatApplication.tsx",
  "client/src/pages/ResidentJourney.tsx",
  "client/src/pages/OpenProposal.tsx",
];

/** Every file the joining journey draws with, pages included. */
const JOURNEY = [
  ...PAGES,
  "client/src/components/journey/look.ts",
  "client/src/components/journey/Trail.tsx",
  "client/src/components/journey/Leaf.tsx",
  "client/src/components/agent/ConnectorSetupPanel.tsx",
  "client/src/components/roleDraft/SeasonGoals.tsx",
  "client/src/components/roleDraft/ArchetypeStep.tsx",
  "client/src/components/roleDraft/IkigaiDoor.tsx",
  "client/src/components/roleDraft/DiscoverStep.tsx",
  "client/src/components/roleDraft/HumanDesignStep.tsx",
  "client/src/components/roleDraft/DraftCarry.tsx",
  "client/src/components/roleDraft/CastStrip.tsx",
  "client/src/components/roleDraft/Burst.tsx",
  "client/src/components/roleDraft/SelectStepper.tsx",
  "client/src/components/governance/ProposalWizard.tsx",
  "client/src/components/governance/WizardField.tsx",
  "client/src/components/governance/WizardStepper.tsx",
  "client/src/components/governance/GoalsList.tsx",
  "client/src/components/governance/GoalsField.tsx",
  "client/src/components/governance/SeasonGoalField.tsx",
  "client/src/components/governance/SeatPicksField.tsx",
  "client/src/components/governance/DraftCards.tsx",
  "client/src/components/FaqSection.tsx",
  "client/src/components/approvals/ApprovalInbox.tsx",
  "client/src/components/profile/OnboardingPath.tsx",
  "client/src/components/alignment/EndingActions.tsx",
  "client/src/components/alignment/LeavingEnds.tsx",
  "client/src/components/alignment/AlignmentReview.tsx",
  "client/src/components/alignment/AlignmentMarks.tsx",
  "client/src/components/alignment/AlignmentCard.tsx",
  "client/src/components/alignment/RegisterEntry.tsx",
  "client/src/components/alignment/AlignButton.tsx",
  "client/src/components/alignment/ConfidentialityCard.tsx",
  // The decider and holder side of a proposal (audit M11). CircleConsent.tsx joins once its two classes are on tokens.
  "client/src/components/openProposal/AboutYou.tsx",
  "client/src/components/openProposal/MembershipAtApplication.tsx",
  "client/src/components/openProposal/ProposalAttachments.tsx",
  "client/src/components/openProposal/RoleCardBridge.tsx",
  "client/src/components/modules/ModuleGate.tsx",
  "client/src/components/admin/OnboardingPathEditor.tsx",
  "client/src/pages/RequestMembership.tsx",
  // Profile Today (Phase B): our first 14 days and the week.
  "client/src/components/today/FirstFourteenDays.tsx",
  "client/src/components/today/WeekStrip.tsx",
];

const listFlag = (name) => flag(name)?.split(",").filter(Boolean);
const pages = listFlag("--pages") ?? PAGES;
const files = listFlag("--files") ?? JOURNEY;

const TW_FAMILIES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTIL = "bg|text|border|border-[trblxy]|ring|ring-offset|outline|divide|from|via|to|fill|stroke|accent|caret|decoration|placeholder|shadow";
const PRE = "(?<![\\w-])(?:[\\w-]+:)*";

/** Each rule: an id, a pattern over a stripped line, and the "use X, not Y" it prints. */
const RULES = [
  { id: "palette", re: new RegExp(`${PRE}(?:${UTIL})-(?:${TW_FAMILIES})-\\d{2,3}(?:\\/\\d+)?(?![\\w-])`, "g"), use: "a semantic token (text-foreground, text-muted-foreground, bg-card, bg-muted, border-border, text-notice, text-open, text-destructive)" },
  {
    id: "tone",
    re: new RegExp(`${PRE}(?:${UTIL})-(?:teal|teal-light|teal-band|teal-deep|aqua|aqua-light|cream|cream-dark|sage|sage-light|amber|amber-light|amber-ink|amber-on-band|forest|gold|coral|cyan|green-light|gray-light|ocean|white|black|secondary|accent)(?:\\/\\d+)?(?![\\w-])`, "g"),
    // The profile's own brand fill: bg-teal-deep, its hover partner, and white text on it.
    allow: (m) => /^(?:hover:)?bg-teal-deep(?:-dark)?$/.test(m) || /^text-white$/.test(m),
    use: "the sheet's tokens: text-notice (gold), text-open (living green), bg-card / bg-muted, border-border",
  },
  { id: "colour", re: new RegExp(`${PRE}(?:${UTIL})-\\[(?:#|rgb|hsl|oklch)[^\\]]*\\]`, "g"), use: "a token; a literal colour never re-themes" },
  { id: "font", re: new RegExp(`${PRE}font-(?:serif|sans|mono|\\[[^\\]]*\\])(?![\\w-])`, "g"), use: "font-display for headings (the body face is the default)" },
  { id: "radius", re: new RegExp(`${PRE}rounded(?:-[trblse]{1,2})?-(?:sm|md|3xl|\\[[^\\]]*\\])(?![\\w-])`, "g"), use: "rounded-lg, rounded-xl, rounded-2xl or rounded-full" },
  { id: "shadow", re: new RegExp(`${PRE}shadow-(?:md|lg|xl|2xl|inner|\\[[^\\]]*\\])(?![\\w-])`, "g"), use: "shadow-sm" },
  { id: "type", re: new RegExp(`${PRE}(?:text|tracking|leading)-\\[[^\\]]*\\]`, "g"), use: "text-xs, tracking-widest, leading-snug / leading-relaxed" },
];

/**
 * THE NATURE KIT (game feel wave 2, 11 Nov 2026): the shared drawings the
 * chosen designs grow from, held to the same rule as the journey. Kept apart
 * from JOURNEY so a lane adding pages there never meets this list.
 *
 * THE FIREFLY EXCEPTION. Firefly glow is the one light the art direction
 * allows to loop, and only around the one next act or inside an
 * illustration, resting after about 20 seconds without input. It is drawn in
 * the kit's own stylesheet (components/journey/nature/nature.css), from the
 * sheet's knobs, so no class string here carries a literal glow or an
 * arbitrary shadow, and none needs a waiver. A `shadow-[...]` or a literal
 * colour in these files is still a problem: the glow belongs to the kit's
 * stylesheet, never to a page's classes.
 */
const NATURE_KIT = [
  "client/src/components/journey/nature/Fireflies.tsx",
  "client/src/components/journey/nature/SeedOfLife.tsx",
  "client/src/components/journey/nature/FernUnfurl.tsx",
  "client/src/components/journey/nature/Vesica.tsx",
  "client/src/components/journey/nature/MoonPhase.tsx",
  "client/src/components/journey/nature/RootStrip.tsx",
];
/** A self-test names its own files; the gate itself also holds the kit. */
const held = listFlag("--files") ? files : [...files, ...NATURE_KIT];

/** Comments out: block comments across lines first, then each line's `//` tail. */
function linesOf(src, ext) {
  const blanked = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  return blanked.split("\n").map((l) => stripComments(l, ext));
}

function scan(rel) {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, "utf8");
  const raw = src.split("\n");
  const hits = [];
  let waived = 0;
  linesOf(src, path.extname(rel)).forEach((line, i) => {
    if (/design-ok:/.test(raw[i] ?? "")) {
      if (RULES.some((r) => (line.match(r.re) ?? []).some((m) => !r.allow?.(m)))) waived++;
      return;
    }
    for (const r of RULES) {
      for (const m of line.match(r.re) ?? []) if (!r.allow?.(m)) hits.push({ line: i + 1, rule: r.id, cls: m, use: r.use });
    }
  });
  return { hits, waived, src };
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return out;
}

if (REPORT) {
  const inList = new Set(held);
  const rows = walk(path.join(ROOT, "client", "src"))
    .filter((f) => !inList.has(f))
    .map((f) => ({ f, n: scan(f).hits.length }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const total = rows.reduce((s, r) => s + r.n, 0);
  console.log(`design rule, outside the journey: ${total} classes in ${rows.length} files would be flagged.`);
  for (const r of rows.slice(0, Number(flag("--top") ?? 40))) console.log(`  ${String(r.n).padStart(4)}  ${r.f}`);
  process.exit(0);
}

const problems = [];
let waivers = 0;
for (const rel of held) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    problems.push(`${rel}: listed in JOURNEY but missing. Remove it from the list or restore the file.`);
    continue;
  }
  const { hits, waived, src } = scan(rel);
  waivers += waived;
  for (const h of hits) problems.push(`${rel}:${h.line}  [${h.rule}] ${h.cls}  -> use ${h.use}`);
  if (pages.includes(rel)) {
    const imported = /import\s*\{[^}]*\bWORLD\b[^}]*\}\s*from\s*["']@\/components\/journey\/look["']/.test(src);
    const used = /\$\{WORLD\}|\{WORLD\}/.test(src);
    if (!imported || !used) problems.push(`${rel}  [world] a journey page puts WORLD (components/journey/look) on its outer element, so it stands on the sheet's ground.`);
  }
}

if (problems.length) {
  console.error(`design rule: ${problems.length} problem(s) in the joining journey (docs/DESIGN_RULE.md).`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`design rule: ${held.length} journey and nature kit files, ${pages.length} pages in the sheet's world, 0 problems, ${waivers} waiver(s).`);
