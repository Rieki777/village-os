/**
 * EVERY WORD AN APPLICANT READS FROM US, BY LANGUAGE.
 *
 * The emails, the profile notices and the status page for a role proposal come
 * from here. English is the source. A language is one entry of `LANGUAGES`
 * typed as `ApplicantMessages`, so a line added to the English table and left
 * out of another language fails the TYPECHECK, and `applicantWords.test.ts`
 * checks the same thing at run time (and that the two tables agree on the
 * shape of every line).
 *
 * WHICH LANGUAGE is decided in shared/applicantLanguage.ts. A language here
 * must also be one the site offers (shared/i18nLocales.ts), which the test pins.
 *
 * Voice: plain, warm, first person plural. Spanish uses "tú".
 * NEEDS A NATIVE EAR: the Spanish below is written carefully and has not been
 * read by a native speaker yet. The lines most worth a second look are marked
 * `// check:` and listed in the lane's report.
 */

import { STEP_WORDS } from "./applicationReview";

export const APPLICANT_LANGUAGES = ["en", "es"] as const;
export type ApplicantLanguage = (typeof APPLICANT_LANGUAGES)[number];
export const DEFAULT_APPLICANT_LANGUAGE: ApplicantLanguage = "en";

export const isApplicantLanguage = (v: unknown): v is ApplicantLanguage => (APPLICANT_LANGUAGES as readonly string[]).includes(String(v));

export interface ApplicantMessages {
  hello(firstName: string | null): string;
  /** "A, B and C". */
  list(items: readonly string[]): string;
  aRole: string;
  /** The line that points to the status link in the first email. Also how a notice drops it. */
  keepStatusLink: string;
  /** The same pointer with the link itself in it, for a letter sent by a door that can mint one. */
  statusLinkLine(link: string): string;
  replyPromise(days: number): string;
  /** Introduces a decider's note in an email or a notice. */
  noteIntro: string;
  day(iso: string): string;

  confirm: {
    subject(village: string): string;
    proposed(roles: string, village: string, when: string | null): string;
    nextSeason: string;
    thisMoon(from: string, to: string): string;
    ask: string;
    validFor(hours: number): string;
    aiDrafts: string;
  };
  statusEmail: { subject: string; text(link: string, replyPromise: string): string };

  update: {
    confirmedTitle(village: string): string;
    confirmed(roles: string, promise: string): string;
    firstReplyTitle: string;
    firstReply(roles: string): string;
    conversationTitle: string;
    conversation(roles: string, withRole: string | null, minutes: number | null): string;
    consentTitle: string;
    consent(roles: string): string;
    termsTitle: string;
    terms(roles: string): string;
    adoptedTitle(village: string): string;
    adopted(village: string, roles: string, next: string): string;
    declinedTitle(village: string): string;
    declined(roles: string): string;
  };

  adopt: {
    subject(village: string): string;
    headline(village: string, roles: string, forWhen: string): string;
    forThisMoon: string;
    forNextSeason: string;
    inviteIntro: string;
    inviteWorks(days: number, whenRolesStart: string): string;
    signIn(whenRolesStart: string): string;
    moonRuns(from: string, to: string): string;
    seasonStarts(season: string | null, startsOn: string): string;
    firstDay: string;
    nextSeasonName: string;
    nextAfterProfile: string;
    button: string;
    signFirst(): string;
  };

  declined: {
    subject(village: string): string;
    thanks(roles: string, village: string): string;
    stayClose: string;
    quest(url: string): string;
    roles(url: string): string;
    again: string;
  };

  page: {
    declinedHeading: string;
    declinedLine: string;
    quests: string;
    roles: string;
    again: string;
    noteHeading: string;
  };

  /** The status page itself (`/application-status/:ref`): every word the page draws, so it reads in one language. */
  status: {
    heading: string;
    missing: string;
    nextLabel: string;
    by(day: string): string;
    /** The eyebrow over the card: the step the proposal is on. */
    step: Record<"confirmed" | "first_reply" | "interview" | "scores_in" | "consent" | "decided" | "cleared", string>;
    /** The path, line by line. */
    received: string;
    firstReply: string;
    conversationWith(role: string, minutes: number): string;
    consent: string;
    decision: string;
    stateDone: string;
    stateNow: string;
    stateLater: string;
    /** What happens next, one line each. */
    move: {
      firstReply: string;
      interview(role: string, minutes: number): string;
      interviewWaiting: string;
      consent: string;
      adopted: string;
      withdrawn: string;
      declined: string;
    };
    booking: {
      label: string;
      block(total: string, firstRole: string | null): string;
      split: string;
      splitAsk: string;
      /** "100 minutes": minutes only, so a long block never reads as time that is counted. */
      minutes(total: number): string;
    };
    references: {
      none: string;
      some(n: number): string;
    };
    private: string;
    wait: { heading: string; line: string; quests: string; map: string; events: string };
  };
}

const enList = (items: readonly string[]): string => {
  const clean = items.map((s) => s.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
};

const esList = (items: readonly string[]): string => {
  const clean = items.map((s) => s.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  const last = clean[clean.length - 1];
  // "e" before a word that starts with the sound i (Spanish spelling rule); role names are the village's own words.
  const y = /^(i|hi)(?![aeou])/i.test(last) ? "e" : "y"; // check: role names starting with i or hi
  return `${clean.slice(0, -1).join(", ")} ${y} ${last}`;
};

const dayIn = (locale: string) => (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? "").trim());
  if (!m) return String(iso ?? "");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

export const OPEN_AI_DRAFTS_EN = "An AI may help draft our replies to you; a person always reads and sends them, and no AI takes part in choosing.";

const en: ApplicantMessages = {
  hello: (n) => (n ? `Hi ${n},` : "Hi,"),
  list: enList,
  aRole: "a role",
  keepStatusLink: "Your status page link is in the first email we sent you, so you can follow it any time.",
  statusLinkLine: (link) => `Your status page, to follow it any time: ${link}`,
  replyPromise: (days) => `We reply within ${days} ${days === 1 ? "day" : "days"}.`,
  noteIntro: "A note from us:",
  day: dayIn("en-GB"),

  confirm: {
    subject: (v) => `Confirm your proposal to ${v}`,
    proposed: (roles, v, when) => `You proposed to hold ${roles} in ${v} ${when ? `for ${when}` : "next season"}.`,
    nextSeason: "next season",
    thisMoon: (from, to) => `this moon, from ${from} to ${to}`,
    ask: "Confirm it's you, and your proposal goes to the village:",
    validFor: (h) => `The link works for ${h} hours. If this wasn't you, leave it, and nothing happens.`,
    aiDrafts: OPEN_AI_DRAFTS_EN,
  },
  statusEmail: {
    subject: "Where your proposal is",
    text: (link, promise) => `Your proposal is with the village. Follow where it is, who acts next and by when:\n\n${link}\n\n${promise} Keep this link to yourself: it is how we know it is you.`,
  },

  update: {
    confirmedTitle: (v) => `Your proposal is with ${v}`,
    confirmed: (roles, promise) => `Your proposal to hold ${roles} is with us. ${promise}`,
    firstReplyTitle: "We have taken up your proposal",
    firstReply: (roles) => `The role that welcomes people has taken up your proposal to hold ${roles} and is writing to you about a time to talk.`,
    conversationTitle: "A conversation is asked for",
    conversation: (roles, withRole, minutes) => `The next step on your proposal to hold ${roles} is a conversation${withRole ? ` with ${withRole}` : ""}${minutes ? `, about ${minutes} minutes` : ""}. We will write to you about a time.`,
    consentTitle: "The circle is weighing your proposal",
    consent: (roles) => `The conversations are written up, and the circle is now asked to consent to your proposal to hold ${roles}. We will tell you what it decides.`,
    termsTitle: "The terms for your proposal changed",
    terms: (roles) => `We changed the terms we suggest for your proposal to hold ${roles}. Open your status page to read them, and tell us what you think.`,
    adoptedTitle: (v) => `${v} adopted your proposal`,
    adopted: (v, roles, next) => `${v} adopted your proposal to hold ${roles}. ${next}`,
    declinedTitle: (v) => `Your proposal to ${v}`,
    declined: (roles) => `Thank you for proposing to hold ${roles}. We can't say yes this time. You can take a quest, look at other open roles, or propose again next season.`,
  },

  adopt: {
    subject: (v) => `${v} adopted your proposal`,
    headline: (v, roles, forWhen) => `${v} adopted your proposal to hold ${roles} ${forWhen}.`,
    forThisMoon: "this moon",
    forNextSeason: "next season",
    inviteIntro: "Here is your invitation. Use the button to create your profile, or open this link:",
    inviteWorks: (days, when) => `It works once and lasts ${days} days. ${when}`,
    signIn: (when) => `Sign in with this address to see your roles. ${when}`,
    moonRuns: (from, to) => `Your roles run from ${from} to the next new moon, ${to}.`,
    seasonStarts: (season, startsOn) => `Your roles start when ${season || "next season"} begins, on ${startsOn}.`,
    firstDay: "the season's first day",
    nextSeasonName: "next season",
    nextAfterProfile: "Then check your profile. Your tasks for the moon appear there, and it is where we run our sessions and track our work together.",
    button: "Create your profile",
    signFirst: () => "Before you are seated, align with the Love Letter, the village's membership agreement (aligning is the village's way of signing). Aligning with it is what makes you a member, with a voice in the village's decisions:",
  },

  declined: {
    subject: (v) => `Your proposal to ${v}`,
    thanks: (roles, v) => `Thank you for proposing to hold ${roles} in ${v}. We can't say yes this time.`,
    stayClose: "We're glad you found us. If you'd like to stay close, here are three ways in:",
    quest: (url) => `Take a quest: ${url}`,
    roles: (url) => `Look at other open roles: ${url}`,
    again: "Or propose again next season. We would be glad to read it.",
  },

  page: {
    declinedHeading: "Thank you for proposing",
    declinedLine: "We can't say yes this time, and we're glad you found us. If you'd like to stay close:",
    quests: "Take a quest",
    roles: "Look at other open roles",
    again: "Or propose again next season.",
    noteHeading: "A note for you",
  },

  status: {
    heading: "Where your proposal is",
    missing: "That link does not match a proposal. Check the link in your email.",
    nextLabel: "What happens next",
    by: (day) => `By ${day}`,
    step: {
      confirmed: "Received",
      first_reply: "First reply",
      interview: "Conversation",
      scores_in: "Conversations done",
      consent: "The circle's consent",
      decided: "Decision",
      cleared: "Cleared",
    },
    received: "Received",
    firstReply: "First reply",
    conversationWith: (role, minutes) => `Conversation with ${role} (${minutes} minutes)`,
    consent: "The circle's consent",
    decision: "Decision",
    stateDone: "done",
    stateNow: "now",
    stateLater: "later",
    move: {
      firstReply: "Our move: the role that welcomes people writes to you with a time to talk.",
      interview: (role, minutes) => `Our move: ${role} talks with you for ${minutes} minutes, then adds a note.`,
      interviewWaiting: "Our move: we arrange the next conversation once the last one is written up.",
      consent: "Our move: the circle weighs your proposal and consents, or says what is missing.",
      adopted: "Your move: make your account. The link to make it is in your email.",
      withdrawn: "Nothing more is needed. You withdrew this proposal.",
      declined: "Nothing more is needed from you. We have answered.",
    },
    booking: {
      label: "How the conversations are booked",
      block: (total, firstRole) => `The conversations are one block of ${total}, booked through ${firstRole ?? "the first role"}, with the others joining at set times. Ask for them to be split over days if that suits you better.`,
      split: "The conversations are booked one at a time, over several days, each through its own role.",
      splitAsk: "Split the conversations over days",
      minutes: (total) => `${total} minutes`,
    },
    references: {
      none: "You gave no references, so we run a background check. You agreed to it when you proposed. We cover its cost, and we contact no one before our first conversation with you.",
      some: (n) => `You gave ${n} ${n === 1 ? "reference" : "references"}. We contact references only after our first conversation, and only with your OK.`,
    },
    private: "This page shows steps only. What the people who talk with you write down stays with them.",
    wait: {
      heading: "While you wait",
      line: "The village is open to you. Here are three ways to look around:",
      quests: "Take a quest",
      map: "See the living map",
      events: "Come to an event",
    },
  },
};

const es: ApplicantMessages = {
  hello: (n) => (n ? `Hola ${n},` : "Hola,"),
  list: esList,
  aRole: "un rol",
  keepStatusLink: "El enlace a la página del estado de tu propuesta está en el primer correo que te enviamos, para que puedas seguirla cuando quieras.",
  statusLinkLine: (link) => `La página del estado de tu propuesta, para seguirla cuando quieras: ${link}`, // needs-native-review
  replyPromise: (days) => `Respondemos en un plazo de ${days} ${days === 1 ? "día" : "días"}.`,
  noteIntro: "Una nota de parte nuestra:",
  day: dayIn("es"),

  confirm: {
    subject: (v) => `Confirma tu propuesta a ${v}`,
    proposed: (roles, v, when) => `Propusiste ocupar ${roles} en ${v} ${when ? `para ${when}` : "la próxima temporada"}.`, // check: "ocupar" for "hold a role"
    nextSeason: "la próxima temporada",
    thisMoon: (from, to) => `esta luna, del ${from} al ${to}`,
    ask: "Confirma que eres tú, y tu propuesta llega a la aldea:", // check: "aldea" for village
    validFor: (h) => `El enlace funciona durante ${h} horas. Si no fuiste tú, ignóralo y no pasará nada.`,
    aiDrafts: "Una IA puede ayudarnos a redactar nuestras respuestas; siempre las lee y las envía una persona, y ninguna IA participa en la elección.", // check
  },
  statusEmail: {
    subject: "Dónde está tu propuesta",
    text: (link, promise) => `Tu propuesta está con la aldea. Sigue dónde está, quién actúa ahora y para cuándo:\n\n${link}\n\n${promise} Guarda este enlace para ti: es la forma en que sabemos que eres tú.`,
  },

  update: {
    confirmedTitle: (v) => `Tu propuesta está con ${v}`,
    confirmed: (roles, promise) => `Tu propuesta para ocupar ${roles} ya está con nosotros. ${promise}`,
    firstReplyTitle: "Hemos recibido tu propuesta",
    firstReply: (roles) => `El rol que da la bienvenida a las personas ha recibido tu propuesta para ocupar ${roles} y te está escribiendo para acordar un momento para conversar.`, // check
    conversationTitle: "Te pedimos una conversación",
    conversation: (roles, withRole, minutes) => `El siguiente paso de tu propuesta para ocupar ${roles} es una conversación${withRole ? ` con ${withRole}` : ""}${minutes ? `, de unos ${minutes} minutos` : ""}. Te escribiremos para acordar un momento.`,
    consentTitle: "El círculo está considerando tu propuesta", // check: "círculo" is the village's term for circle
    consent: (roles) => `Las conversaciones ya están escritas, y ahora le pedimos al círculo su consentimiento para tu propuesta de ocupar ${roles}. Te contaremos lo que decida.`,
    termsTitle: "Cambiaron las condiciones de tu propuesta",
    terms: (roles) => `Cambiamos las condiciones que sugerimos para tu propuesta de ocupar ${roles}. Abre la página del estado de tu propuesta para leerlas y cuéntanos qué piensas.`,
    adoptedTitle: (v) => `${v} adoptó tu propuesta`, // check: "adoptó" for "adopted"
    adopted: (v, roles, next) => `${v} adoptó tu propuesta para ocupar ${roles}. ${next}`,
    declinedTitle: (v) => `Tu propuesta a ${v}`,
    declined: (roles) => `Gracias por proponerte para ocupar ${roles}. Esta vez no podemos decir que sí. Puedes tomar una misión, ver otros roles abiertos o volver a proponer la próxima temporada.`, // check: "misión" for quest
  },

  adopt: {
    subject: (v) => `${v} adoptó tu propuesta`,
    headline: (v, roles, forWhen) => `${v} adoptó tu propuesta para ocupar ${roles} ${forWhen}.`,
    forThisMoon: "esta luna",
    forNextSeason: "la próxima temporada",
    inviteIntro: "Aquí está tu invitación. Usa el botón para crear tu perfil, o abre este enlace:",
    inviteWorks: (days, when) => `Funciona una sola vez y dura ${days} días. ${when}`,
    signIn: (when) => `Inicia sesión con este correo para ver tus roles. ${when}`,
    moonRuns: (from, to) => `Tus roles van del ${from} hasta la próxima luna nueva, el ${to}.`,
    seasonStarts: (season, startsOn) => `Tus roles comienzan cuando empieza ${season || "la próxima temporada"}, el ${startsOn}.`,
    firstDay: "el primer día de la temporada",
    nextSeasonName: "la próxima temporada",
    nextAfterProfile: "Después revisa tu perfil. Allí aparecen tus tareas de la luna, y es donde hacemos nuestras sesiones y seguimos nuestro trabajo juntos.",
    button: "Crea tu perfil",
    signFirst: () => "Antes de ocupar tu rol, alínea con la Carta de Amor, el acuerdo de membresía de la aldea (alinear es nuestra forma de firmar). Alinear con ella es lo que te hace miembro, con voz en las decisiones de la aldea:", // check: "Love Letter" name, "alinear", "membresía"
  },

  declined: {
    subject: (v) => `Tu propuesta a ${v}`,
    thanks: (roles, v) => `Gracias por proponerte para ocupar ${roles} en ${v}. Esta vez no podemos decir que sí.`,
    stayClose: "Nos alegra que nos hayas encontrado. Si quieres seguir cerca, aquí hay tres maneras de entrar:",
    quest: (url) => `Toma una misión: ${url}`,
    roles: (url) => `Mira otros roles abiertos: ${url}`,
    again: "O vuelve a proponer la próxima temporada. Nos dará gusto leerte.",
  },

  page: {
    declinedHeading: "Gracias por proponerte",
    declinedLine: "Esta vez no podemos decir que sí, y nos alegra que nos hayas encontrado. Si quieres seguir cerca:",
    quests: "Toma una misión",
    roles: "Mira otros roles abiertos",
    again: "O vuelve a proponer la próxima temporada.",
    noteHeading: "Una nota para ti",
  },

  // needs-native-review: the whole status block below
  status: {
    heading: "Dónde está tu propuesta",
    missing: "Ese enlace no corresponde a ninguna propuesta. Revisa el enlace de tu correo.",
    nextLabel: "Lo que sigue",
    by: (day) => `Para el ${day}`,
    step: {
      confirmed: "Recibida",
      first_reply: "Primera respuesta",
      interview: "Conversación",
      scores_in: "Conversaciones terminadas",
      consent: "El consentimiento del círculo",
      decided: "Decisión",
      cleared: "Resuelta",
    },
    received: "Recibida",
    firstReply: "Primera respuesta",
    conversationWith: (role, minutes) => `Conversación con ${role} (${minutes} minutos)`,
    consent: "El consentimiento del círculo",
    decision: "Decisión",
    stateDone: "hecho",
    stateNow: "ahora",
    stateLater: "después",
    move: {
      firstReply: "Nos toca a nosotros: el rol que da la bienvenida a las personas te escribe para acordar un momento para conversar.",
      interview: (role, minutes) => `Nos toca a nosotros: ${role} conversa contigo unos ${minutes} minutos y luego deja una nota.`,
      interviewWaiting: "Nos toca a nosotros: acordamos la siguiente conversación cuando la anterior esté escrita.",
      consent: "Nos toca a nosotros: el círculo valora tu propuesta y da su consentimiento, o dice qué falta.",
      adopted: "Te toca a ti: crear tu cuenta. El enlace para hacerlo está en tu correo.",
      withdrawn: "No hace falta nada más. Retiraste esta propuesta.",
      declined: "No hace falta nada más de tu parte. Ya respondimos.",
    },
    booking: {
      label: "Cómo se agendan las conversaciones",
      block: (total, firstRole) => `Las conversaciones son un solo bloque de ${total}, agendado con ${firstRole ?? "el primer rol"}, y los demás roles se suman en momentos fijos. Si te queda mejor, pide que se repartan en varios días.`,
      split: "Las conversaciones se agendan una por una, en varios días, cada una con su propio rol.",
      splitAsk: "Repartir las conversaciones en varios días",
      minutes: (total) => `${total} minutos`,
    },
    references: {
      none: "No diste referencias, así que haremos una verificación de antecedentes. Aceptaste cuando enviaste tu propuesta. Nosotros cubrimos su costo y no contactamos a nadie antes de nuestra primera conversación contigo.",
      some: (n) => `Diste ${n} ${n === 1 ? "referencia" : "referencias"}. Contactamos a las referencias solo después de nuestra primera conversación, y solo con tu visto bueno.`,
    },
    private: "Esta página muestra solo los pasos. Lo que anotan las personas que conversan contigo se queda con ellas.",
    wait: {
      heading: "Mientras esperas",
      line: "La aldea está abierta para ti. Aquí hay tres formas de conocerla:",
      quests: "Toma una misión",
      map: "Mira el mapa vivo",
      events: "Ven a un evento",
    },
  },
};

/** The tables. `Record<ApplicantLanguage, ...>` makes a language without a table, or a table with a missing line, a compile error. */
export const LANGUAGES: Record<ApplicantLanguage, ApplicantMessages> = { en, es };

export const wordsIn = (lang: ApplicantLanguage | null | undefined): ApplicantMessages => LANGUAGES[lang && isApplicantLanguage(lang) ? lang : DEFAULT_APPLICANT_LANGUAGE];

/** How every language's "your status page link" line begins, so a notice can drop it whichever language wrote it. */
export const STATUS_LINK_STARTS: readonly string[] = APPLICANT_LANGUAGES.flatMap((l) => [LANGUAGES[l].keepStatusLink.slice(0, 21), LANGUAGES[l].statusLinkLine("").slice(0, 21)]);

/** A decider's note for an applicant: plain text, trimmed, one blank line at most, capped. Null when empty. */
export const APPLICANT_NOTE_MAX = 600;
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const lines = raw.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").split("\n").map((l) => l.trim());
  const out: string[] = [];
  for (const l of lines) {
    if (l === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  const s = out.join("\n").slice(0, APPLICANT_NOTE_MAX).trim();
  return s ? s : null;
}

// ── The status page, read in the applicant's language ───────────────────────

/** What `/api/application-status` serves that the view reads (shared/applicationReview.ts `statusFor`, plus the route's own fields). */
export interface StatusServedForView {
  step: string;
  actsNext: string;
  path: Array<{ label: string; state: "done" | "now" | "later" }>;
  booking: string | null;
  mode: "block" | "split";
  outcome?: "adopted" | "declined" | "withdrawn" | null;
  referencesGiven?: number | null;
}

export interface StatusView {
  stepWords: string;
  move: string;
  path: Array<{ label: string; state: "done" | "now" | "later" }>;
  booking: { text: string; canSplit: boolean } | null;
  references: string | null;
}

const CONVERSATION_LABEL = /^Conversation with (.+) \((\d+) minutes\)$/;
const INTERVIEW_MOVE = /^(.+) talks with you for (\d+) minutes, then adds a note\.$/;

/**
 * The status page's words, from the steps the server sends. The server writes
 * the path and the "next" line in English (shared/applicationReview.ts), so this
 * reads them by shape and says them again in the applicant's language, and it
 * shapes three things the raw path got wrong:
 *   - only ONE step reads "now": the first, so the page never points two ways;
 *   - after a decline or a withdrawal the steps that never happened leave the
 *     path, and "The circle's consent" with them, because nobody consented;
 *   - the references line never follows a decision, so "you gave no references"
 *     does not sit under a thank-you.
 * The background check is stated only as far as the server tells us: how many
 * references were given. Whether a role always needs a check is not on this page.
 */
export function statusView(lang: ApplicantLanguage | null | undefined, s: StatusServedForView): StatusView {
  const w = wordsIn(lang).status;
  const decided = s.outcome === "declined" || s.outcome === "withdrawn" || s.outcome === "adopted";
  const closed = s.outcome === "declined" || s.outcome === "withdrawn";

  const say = (label: string): string => {
    if (label === STEP_WORDS.confirmed) return w.received;
    if (label === STEP_WORDS.first_reply) return w.firstReply;
    if (label === STEP_WORDS.consent) return w.consent;
    if (label === STEP_WORDS.decided) return w.decision;
    const m = CONVERSATION_LABEL.exec(label);
    if (m) return w.conversationWith(m[1], Number(m[2]));
    return label;
  };

  let seenNow = false;
  const path: StatusView["path"] = [];
  for (const p of s.path) {
    if (closed && (p.label === STEP_WORDS.consent || p.state !== "done")) continue;
    if (decided && p.state === "now") continue;
    let state = p.state;
    if (state === "now") {
      if (seenNow) state = "later";
      seenNow = true;
    }
    path.push({ label: say(p.label), state });
  }

  let move: string;
  if (s.outcome === "adopted") move = w.move.adopted;
  else if (s.outcome === "withdrawn") move = w.move.withdrawn;
  else if (s.outcome === "declined") move = w.move.declined;
  else if (s.step === "first_reply") move = w.move.firstReply;
  else if (s.step === "consent") move = w.move.consent;
  else {
    const m = INTERVIEW_MOVE.exec(s.actsNext);
    move = m ? w.move.interview(m[1], Number(m[2])) : w.move.interviewWaiting;
  }

  const talks = s.path.map((p) => CONVERSATION_LABEL.exec(p.label)).filter((m): m is RegExpExecArray => !!m);
  const total = talks.reduce((n, m) => n + Number(m[2]), 0);
  const booking =
    s.booking && !decided && talks.length > 0
      ? { text: s.mode === "split" ? w.booking.split : w.booking.block(w.booking.minutes(total), talks[0][1]), canSplit: s.mode === "block" }
      : null;

  const references = closed || typeof s.referencesGiven !== "number" ? null : s.referencesGiven === 0 ? w.references.none : w.references.some(s.referencesGiven);

  return { stepWords: (w.step as Record<string, string>)[s.step] ?? s.step, move, path, booking, references };
}
