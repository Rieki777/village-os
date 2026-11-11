/**
 * The two training pages (/training/steward, /training/resident), as fields.
 *
 * WHY TWO (the lead, 11 Nov 2026): "Community training is both steward and
 * resident routes (and will have different trainings, but for now is holding
 * the same, but should have 2 different routes in admin)." So each track has
 * its own page with its own words in Admin, Pages, and each track's
 * "Community training" step points at its own page. The lessons themselves
 * are still one list (Admin, Training modules), shown on both, because the
 * rung that counts them (`training-complete`) is one rule for everybody.
 * Splitting the lessons by track is a change to that rule, and it waits for
 * the lead.
 *
 * ONE BUILDER, TWO SPECS, the way the rights pages do it. `/training` itself
 * is the chooser: it shows each page's `door` words and sends a member on.
 *
 * THE DEFAULTS ARE NEUTRAL STARTER TEXT. They name no practice, no method and
 * no teacher, because those are a village's own. The founding village's
 * words are in server/seeds/, applied by hand in Admin, Pages.
 */
import type { FieldSpec, PageSpec } from "./types";

export const TRAINING_TRACKS = ["steward", "resident"] as const;
export type TrainingTrack = (typeof TRAINING_TRACKS)[number];

export function isTrainingTrack(v: unknown): v is TrainingTrack {
  return typeof v === "string" && (TRAINING_TRACKS as readonly string[]).includes(v);
}

/** The address of a track's training page, and of the chooser between them. */
export const TRAINING_PATH = "/training";
export const trainingPathFor = (track: TrainingTrack): string => `${TRAINING_PATH}/${track}`;

interface TrainingWords {
  track: TrainingTrack;
  label: string;
  hero: { eyebrow: string; headline: string; intro: string };
  door: { title: string; line: string };
}

function text(key: string, label: string, max: number, def: string, more: Partial<FieldSpec> = {}): FieldSpec {
  return { key, label, kind: "text", max, default: def, ...more };
}

function long(key: string, label: string, max: number, def: string, more: Partial<FieldSpec> = {}): FieldSpec {
  return { key, label, kind: "long", max, default: def, ...more };
}

function trainingPage(words: TrainingWords): PageSpec {
  return {
    id: `training-${words.track}`,
    label: words.label,
    path: trainingPathFor(words.track),
    sections: [
      {
        id: "hero",
        label: "Top of the page",
        shows: "The first thing a member sees on this training page.",
        fields: [
          text("eyebrow", "Small label above the headline", 30, words.hero.eyebrow),
          text("headline", "Headline", 45, words.hero.headline),
          long("intro", "Paragraph under the headline", 280, words.hero.intro),
        ],
      },
      {
        id: "lessons",
        label: "Lessons",
        shows: "The heading over the lessons. The lessons themselves are edited in Training modules, and both training pages show them.",
        fields: [
          text("heading", "Heading", 40, "Your lessons"),
          long("intro", "Sentence under the heading", 200, "Each lesson opens in a new tab. Mark it done when you finish.", {
            optional: true,
            help: "Leave blank for no sentence.",
          }),
        ],
      },
      {
        id: "door",
        label: "On the training chooser",
        shows: "How this page is named on /training, where a member picks the training for their path.",
        fields: [text("title", "Name", 40, words.door.title), long("line", "One line under the name", 140, words.door.line)],
      },
      {
        id: "close",
        label: "Closing note",
        shows: "A short note under the lessons.",
        hideable: true,
        fields: [
          text("heading", "Heading", 45, "Already living these practices?"),
          long("body", "Paragraph", 280, "If you already know and live these practices, tell us when we meet."),
          text("ctaLabel", "Button words", 32, "", { optional: true, help: "Leave blank for no button." }),
          {
            key: "ctaTarget",
            label: "Button goes to",
            kind: "link",
            max: 300,
            default: "",
            optional: true,
            help: "A page here (/visit), a full web address, or mailto:. Leave blank for no button.",
          },
        ],
      },
    ],
  };
}

const SHARED_HERO = {
  headline: "Learn together, grow together",
  intro: "The practices that help us live, work and decide together. Take each lesson at your own pace.",
};

export const TRAINING_STEWARD_PAGE: PageSpec = trainingPage({
  track: "steward",
  label: "Training: steward",
  hero: { eyebrow: "Steward training", ...SHARED_HERO },
  door: { title: "Training for stewards", line: "For everyone holding a role in {village}." },
});

export const TRAINING_RESIDENT_PAGE: PageSpec = trainingPage({
  track: "resident",
  label: "Training: resident",
  hero: { eyebrow: "Resident training", ...SHARED_HERO },
  door: { title: "Training for residents", line: "For everyone making a home in {village}." },
});

export const TRAINING_PAGES: Readonly<Record<TrainingTrack, PageSpec>> = {
  steward: TRAINING_STEWARD_PAGE,
  resident: TRAINING_RESIDENT_PAGE,
};
