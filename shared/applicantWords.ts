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
    conversationTitle: "We would like to talk with you",
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
};

const es: ApplicantMessages = {
  hello: (n) => (n ? `Hola ${n},` : "Hola,"),
  list: esList,
  aRole: "un rol",
  keepStatusLink: "El enlace a la página del estado de tu propuesta está en el primer correo que te enviamos, para que puedas seguirla cuando quieras.",
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
};

/** The tables. `Record<ApplicantLanguage, ...>` makes a language without a table, or a table with a missing line, a compile error. */
export const LANGUAGES: Record<ApplicantLanguage, ApplicantMessages> = { en, es };

export const wordsIn = (lang: ApplicantLanguage | null | undefined): ApplicantMessages => LANGUAGES[lang && isApplicantLanguage(lang) ? lang : DEFAULT_APPLICANT_LANGUAGE];

/** How every language's "your status page link" line begins, so a notice can drop it whichever language wrote it. */
export const STATUS_LINK_STARTS: readonly string[] = APPLICANT_LANGUAGES.map((l) => LANGUAGES[l].keepStatusLink.slice(0, 21));

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
