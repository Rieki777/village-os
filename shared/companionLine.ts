/**
 * THE COMPANION'S ONE LINE: the village guide saying the same next step as the
 * path, in the person's language, a little more warmly for someone who is new.
 *
 * WHAT THIS IS. A pure lookup. A next-step key (the same key the path
 * conductor names: today the ids of `nextActions` in shared/gameConfig.ts,
 * plus the four joining steps a visitor walks) becomes one short line in
 * English or Spanish. No model writes it, nothing about the person leaves the
 * page to make it, and it never invents a step: an unknown key gets no line,
 * because a companion that disagrees with the path is worse than a quiet one.
 *
 * THE RULES IT HOLDS.
 *   - One line per screen. The caller asks once; this returns one line or null.
 *   - Never the heading again. When the screen's heading already says what the
 *     line would say, there is no line (`echoesHeading`).
 *   - Visitors too, with a strict limit: only the joining steps, and only on the
 *     first VISITOR_LINE_LIMIT screens of a visit. After that the page speaks
 *     for itself.
 *   - Newness without singling out. A person who is new gets the same line plus
 *     a `why`: the reason behind the step. Nothing says "new", nothing is shown
 *     to anybody else, and nobody is labelled. The test holds the first two.
 *   - Two lengths, on purpose (the lead's phone and desktop rule): `short` is
 *     for one thumb at the bottom of a phone; `line` sits beside the step on a
 *     desktop. `why` opens on a tap on a phone and shows under the line on a
 *     desktop.
 *
 * WHO SPEAKS. The lines are in the village's "we" voice and never name the
 * guide; the surface shows the guide's name beside them through
 * shared/guideName.ts, so an unnamed guide reads "the village guide" and no
 * village borrows another's name.
 *
 * THE VILLAGE'S WORD for what members sign arrives as `commitment`
 * (`brand.project.commitmentName`), the way `withCommitmentName` does it, so
 * no line ever carries a raw brace.
 *
 * Spanish uses "tú". NEEDS A NATIVE EAR: written carefully, not yet read by a
 * native Costa Rican speaker.
 */

/** The joining steps a visitor walks before an account exists. */
export const VISITOR_STEPS = ["find-role", "propose", "check-email", "proposal-waiting"] as const;

/** The member steps: the ids of `nextActions` in shared/gameConfig.ts, plus the founder's setup step. */
export const MEMBER_STEPS = [
  "founder-setup",
  "training",
  "membership",
  "membership-waiting",
  "first-days",
  "first-quest",
  "finish-quest",
  "send-gratitude",
  "gene-keys",
  "explore",
] as const;

export const COMPANION_STEPS = [...VISITOR_STEPS, ...MEMBER_STEPS] as const;
export type VisitorStep = (typeof VISITOR_STEPS)[number];
export type CompanionStep = (typeof COMPANION_STEPS)[number];

export const isCompanionStep = (v: unknown): v is CompanionStep => (COMPANION_STEPS as readonly string[]).includes(String(v));
export const isVisitorStep = (v: unknown): v is VisitorStep => (VISITOR_STEPS as readonly string[]).includes(String(v));

export const COMPANION_LANGUAGES = ["en", "es"] as const;
export type CompanionLanguage = (typeof COMPANION_LANGUAGES)[number];

/** A visitor hears the companion on at most this many screens of one visit. */
export const VISITOR_LINE_LIMIT = 3;

/** Length ceilings, in characters, after the village's word is put in. The test holds every line to them. */
export const MAX_SHORT = 52;
export const MAX_LINE = 100;
export const MAX_WHY = 120;

interface StepWords {
  short: string;
  line: string;
  why: string;
}

/** Keyed by the union, so a step added above and left out here fails the typecheck. */
type StepTable = Record<CompanionStep, StepWords>;

const EN: StepTable = {
  "find-role": {
    short: "Start with the roles that call to you.",
    line: "Read a few roles slowly. The one that stays with you is a good place to start.",
    why: "Each role card says what the work is and who it serves, so you can choose with your eyes open.",
  },
  propose: {
    short: "Tell us in your own words, one step at a time.",
    line: "Tell us in your own words. A few honest lines are plenty.",
    why: "People read what you write here, and only people decide.",
  },
  "check-email": {
    short: "Your link is waiting in your inbox.",
    line: "We sent you a link. Open it from your inbox and we carry on from there.",
    why: "The link shows the address is yours, so word from us reaches you and nobody else.",
  },
  "proposal-waiting": {
    short: "It's with us now. Wander while you wait.",
    line: "Your proposal is with us. While it rests, the side paths below are open to you.",
    why: "A few people read each proposal and answer together, so it takes a little while. We write when there's news.",
  },
  "founder-setup": {
    short: "One more piece of your village to set.",
    line: "The setup list shows what the village still needs before members arrive.",
    why: "Each item there is something a member would otherwise trip over on their first day.",
  },
  training: {
    short: "The training is a calm first walk.",
    line: "The training walks you through how we decide and share, one small part at a time.",
    why: "Everyone here took the same walk, so we share the same words for how things work.",
  },
  membership: {
    short: "When you're ready, sign the {commitment}.",
    line: "When it feels right, read the {commitment} and sign it. There's no rush.",
    why: "Signing is how you ask to belong. A person reads every one, and the village answers.",
  },
  "membership-waiting": {
    short: "Your {commitment} is with us now.",
    line: "Your {commitment} is with us now. A Quest is a good way to meet people meanwhile.",
    why: "Someone reads each signing, so an answer can take a little while.",
  },
  "first-days": {
    short: "Your first days in your role are open.",
    line: "Your role's first days are laid out on your profile. Take the next one when you can.",
    why: "They help you find the people, tools and rhythms your role leans on.",
  },
  "first-quest": {
    short: "Pick a first Quest that suits you.",
    line: "Pick one Quest that suits you this week. Small ones count just as much.",
    why: "Quests are how we meet each other through real work, side by side.",
  },
  "finish-quest": {
    short: "Your Quest is waiting for you.",
    line: "When your Quest is done, turn it in so the person who asked can see it landed.",
    why: "Turning it in lets the person who offered it say thank you.",
  },
  "send-gratitude": {
    short: "Someone helped this cycle. Thank them.",
    line: "Think of someone who helped this cycle and send them a thank-you.",
    why: "Thank-yous are how we notice each other's care, and they carry real weight here.",
  },
  "gene-keys": {
    short: "Your lines are here if you'd like them.",
    line: "If you'd like, add your lines. They stay yours, and you can skip them.",
    why: "They're a way to know yourself a little better. Nobody decides anything from them.",
  },
  explore: {
    short: "Another Quest might be calling.",
    line: "Have a look at the Quests board. Something there may want your hands.",
    why: "There is always more to tend, and every Quest is offered by someone here.",
  },
};

const ES: StepTable = {
  "find-role": {
    short: "Empieza por los roles que te llaman.",
    line: "Lee algunos roles con calma. El que se quede contigo es un buen comienzo.",
    why: "Cada tarjeta de rol dice cuál es el trabajo y a quién sirve, para que elijas con claridad.",
  },
  propose: {
    short: "Cuéntanos con tus palabras, paso a paso.",
    line: "Cuéntanos con tus propias palabras. Unas pocas líneas sinceras bastan.",
    why: "Personas leen lo que escribes aquí, y solo personas deciden.",
  },
  "check-email": {
    short: "Tu enlace te espera en tu correo.",
    line: "Te enviamos un enlace. Ábrelo desde tu correo y seguimos desde ahí.",
    why: "El enlace muestra que la dirección es tuya, así nuestras noticias te llegan solo a ti.",
  },
  "proposal-waiting": {
    short: "Ya la tenemos. Pasea mientras esperas.",
    line: "Tu propuesta está con nosotros. Mientras reposa, los senderos de abajo están abiertos.",
    why: "Varias personas leen cada propuesta y responden juntas, así que toma un tiempo. Te escribimos cuando haya noticias.",
  },
  "founder-setup": {
    short: "Falta una pieza más de tu aldea.",
    line: "La lista de preparación muestra lo que la aldea aún necesita antes de que lleguen miembros.",
    why: "Cada punto ahí es algo con lo que un miembro tropezaría en su primer día.",
  },
  training: {
    short: "La formación es un primer paseo tranquilo.",
    line: "La formación te muestra cómo decidimos y compartimos, una parte pequeña a la vez.",
    why: "Todas las personas aquí dieron el mismo paseo, así compartimos las mismas palabras.",
  },
  membership: {
    short: "Cuando quieras, firma tu {commitment}.",
    line: "Cuando te parezca bien, lee tu {commitment} y firma. No hay prisa.",
    why: "Firmar es tu forma de pedir pertenecer. Una persona lee cada firma y la aldea responde.",
  },
  "membership-waiting": {
    short: "Tu {commitment} ya está con nosotros.",
    line: "Tu {commitment} ya está con nosotros. Mientras, una misión es buena forma de conocer gente.",
    why: "Alguien lee cada firma, así que la respuesta puede tardar un poco.",
  },
  "first-days": {
    short: "Tus primeros días en el rol te esperan.",
    line: "Los primeros días de tu rol están en tu perfil. Da el siguiente paso cuando puedas.",
    why: "Te ayudan a encontrar a las personas, herramientas y ritmos en los que se apoya tu rol.",
  },
  "first-quest": {
    short: "Elige una primera misión a tu medida.",
    line: "Elige una misión que te quede bien esta semana. Las pequeñas cuentan igual.",
    why: "Las misiones son cómo nos conocemos trabajando de verdad, lado a lado.",
  },
  "finish-quest": {
    short: "Tu misión te está esperando.",
    line: "Cuando termines tu misión, entrégala para que quien la pidió vea que llegó.",
    why: "Entregarla le permite a quien la ofreció darte las gracias.",
  },
  "send-gratitude": {
    short: "Alguien te ayudó este ciclo. Agradécele.",
    line: "Piensa en alguien que te ayudó este ciclo y envíale un agradecimiento.",
    why: "Los agradecimientos son cómo notamos el cuidado de los demás, y aquí tienen peso real.",
  },
  "gene-keys": {
    short: "Tus líneas están aquí si las quieres.",
    line: "Si quieres, agrega tus líneas. Son tuyas y puedes saltarlas.",
    why: "Son una forma de conocerte un poco mejor. Nadie decide nada a partir de ellas.",
  },
  explore: {
    short: "Otra misión podría estar llamándote.",
    line: "Echa un vistazo al tablero de misiones. Algo ahí puede necesitar tus manos.",
    why: "Siempre hay más que cuidar, y cada misión la ofrece alguien de aquí.",
  },
};

export const COMPANION_WORDS: Readonly<Record<CompanionLanguage, StepTable>> = { en: EN, es: ES };

/** What the village calls the thing members sign, when the caller has no word for it. */
const DEFAULT_COMMITMENT: Record<CompanionLanguage, string> = { en: "letter", es: "carta" };

/** "es", "es-CR", "ES_mx" read as Spanish; anything else, or nothing, reads as English. */
export function companionLanguage(locale: unknown): CompanionLanguage {
  const tag = typeof locale === "string" ? locale.trim().toLowerCase().split(/[-_]/)[0] : "";
  return (COMPANION_LANGUAGES as readonly string[]).includes(tag) ? (tag as CompanionLanguage) : "en";
}

/** Lowercase letters and digits only, accents dropped, single-spaced. */
function plain(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * True when a line would only say the heading again: the same words, or the
 * heading whole inside it once the heading is three words or more. A one-word
 * heading ("Quests") inside a sentence is a sentence, and passes.
 */
export function echoesHeading(text: string, heading: string | null | undefined): boolean {
  const h = plain(heading ?? "");
  if (!h) return false;
  const t = plain(text);
  if (t === h) return true;
  return h.split(" ").length >= 3 && ` ${t} `.includes(` ${h} `);
}

export interface CompanionLineInput {
  /** The conductor's next-step key. Unknown keys get no line. */
  step: unknown;
  /** The reader's locale tag ("en", "es-CR"). */
  locale?: unknown;
  /** True while the reader is new to this step's part of the village. Shapes only `why`; never shown to others. */
  isNew?: boolean;
  /** True for somebody with no account. */
  visitor?: boolean;
  /** For a visitor: how many screens this visit have already shown a line. */
  shownThisVisit?: number;
  /** The heading on the screen the line sits under. */
  heading?: string | null;
  /** The village's word for what members sign (`brand.project.commitmentName`). */
  commitment?: string | null;
}

export interface CompanionLine {
  step: CompanionStep;
  language: CompanionLanguage;
  /** For a phone: one thumb, the bottom of the screen. */
  short: string;
  /** For a desktop: beside the step. */
  line: string;
  /** The reason behind the step, for someone new. Null for everyone else. */
  why: string | null;
}

/**
 * One line for one screen, or null when the companion should stay quiet: an
 * unknown step, a member step for a visitor, a visitor past the limit, or a
 * line that would only repeat the heading.
 */
export function companionLine(input: CompanionLineInput): CompanionLine | null {
  const { step } = input;
  if (!isCompanionStep(step)) return null;
  if (input.visitor) {
    if (!isVisitorStep(step)) return null;
    const shown = Number.isFinite(input.shownThisVisit) ? Number(input.shownThisVisit) : 0;
    if (shown >= VISITOR_LINE_LIMIT) return null;
  }
  const language = companionLanguage(input.locale);
  const words = COMPANION_WORDS[language][step];
  const word = (input.commitment ?? "").trim() || DEFAULT_COMMITMENT[language];
  const fill = (s: string) => s.replace(/\{commitment\}/g, word);
  const short = fill(words.short);
  const line = fill(words.line);
  if (echoesHeading(short, input.heading) || echoesHeading(line, input.heading)) return null;
  return { step, language, short, line, why: input.isNew ? fill(words.why) : null };
}
