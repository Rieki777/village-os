/**
 * THE ONE-CLICK RAILWAY TEMPLATE, AS DATA (a spike, 2026-11-01).
 *
 * The biggest wall for a new village's founder came before the setup game
 * could run at all: create a Railway project, add MySQL, add the app, attach a
 * volume, run scripts/fork-init.mjs on their own computer, then type about a
 * dozen generated secrets into Railway by hand. Railway's template composer
 * can do most of that: `${{secret(length, alphabet)}}` generates a value per
 * deploy, `${{Service.VAR}}` references another service's variable, and every
 * deployment carries `RAILWAY_PUBLIC_DOMAIN`
 * (docs.railway.com/templates/create and docs.railway.com/reference/variables,
 * read 2026-11-01).
 *
 * A Railway template is built in the dashboard, never from a file in a
 * repository, so this sheet is what someone with the account types into the
 * composer, and docs/RAILWAY_TEMPLATE.md walks them through it. It lives in
 * code so a test can hold it to `.env.example` and to the soil guild: a
 * variable the app needs at deploy that this sheet forgets would only be found
 * by a village that deployed and broke.
 *
 * Nothing here touches Railway. Creating and publishing the template, and the
 * one live deploy that proves the parts marked unverified, are Rye's to do
 * (every Railway action reaches production and needs his yes).
 */

/** How a variable gets its value on a one-click deploy. */
export type TemplateSource =
  /** Railway generates it at deploy, through a template variable function. */
  | "generated"
  /** Railway fills it from another service's or this deployment's own variable. */
  | "referenced"
  /** A fixed value the template carries for every village. */
  | "fixed"
  /** The founder types it into the deploy form. */
  | "founder"
  /** Railway sets it with no template entry at all. */
  | "railway";

export interface TemplateVariable {
  name: string;
  source: TemplateSource;
  /** What goes in the composer's value box. Empty for "founder" and "railway". */
  value: string;
  why: string;
  /** Read from Railway's docs, or only a live deploy can confirm it. */
  certainty: "verified" | "unverified";
}

/** 32 random bytes as 64 lowercase hex characters, the recipe fork-init and sealedBox use. */
export const HEX64 = '${{secret(64, "0123456789abcdef")}}';

export const TEMPLATE_IMAGE = "ghcr.io/rieki777/village-os:1.2.0"; // brand-ok: the upstream platform image's own address, never a village's brand

export const TEMPLATE_SERVICES = [
  {
    name: "MySQL",
    source: "Railway's own MySQL database service",
    note: "The app's DATABASE_URL references it, so nobody types a connection string.",
  },
  {
    name: "village",
    source: `Docker image ${TEMPLATE_IMAGE}, a pinned release, never :edge`,
    note: "Public networking on, so Railway issues the *.up.railway.app address. A volume mounted at /app/data holds member uploads.",
  },
] as const;

export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  {
    name: "DATABASE_URL",
    source: "referenced",
    value: "${{MySQL.MYSQL_URL}}",
    why: "The connection string, from the MySQL service in the same template.",
    certainty: "unverified",
  },
  {
    name: "FRONTEND_URL",
    source: "referenced",
    value: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
    why: "Every email link, the sign-in callback and the claim link are built from it. Change it to the village's own domain once DNS points there.",
    certainty: "unverified",
  },
  { name: "AUTH_TOKEN_SECRET", source: "generated", value: HEX64, why: "Signs every session. Without it a restart signs everyone out.", certainty: "verified" },
  { name: "MEMBER_SECRETS_KEY", source: "generated", value: HEX64, why: "Seals each member's own AI key. Must be exactly 64 hex characters.", certainty: "verified" },
  { name: "VILLAGE_SECRETS_KEY", source: "generated", value: HEX64, why: "Seals the village's integration keys (the root cellar). Must be exactly 64 hex characters.", certainty: "verified" },
  { name: "BACKUP_EXPORT_TOKEN", source: "generated", value: HEX64, why: "Authenticates the uploads backup export.", certainty: "verified" },
  {
    name: "ADMIN_PASSWORD",
    source: "generated",
    value: "${{secret(24)}}",
    why: "The one-time password that claims the village. The founder reads it once from the Variables tab, on /claim.",
    certainty: "unverified",
  },
  { name: "TRUSTED_PROXY_HOPS", source: "fixed", value: "1", why: "Railway's edge is one proxy hop, so rate limits see the real visitor.", certainty: "verified" },
  { name: "BREAK_GLASS_ADMIN_EMAIL", source: "founder", value: "", why: "The address that can still claim the village if every admin is locked out. The founder's own.", certainty: "verified" },
  { name: "PORT", source: "railway", value: "", why: "Railway sets it.", certainty: "verified" },
];

/** Everything a founder still does on a one-click deploy, in order. */
export const FOUNDER_STEPS = [
  "Sign in to Railway and press Deploy on the template.",
  "Type your own email address into the one box the deploy form asks for.",
  "When it is live, open the village service's Variables tab and copy ADMIN_PASSWORD once.",
  "Open your village's address, go to /claim, and claim it with that password and your email.",
  "Then play the setup game: it plants everything else.",
] as const;

/** What only a live deploy can settle, before this template is published. */
export const LIVE_DEPLOY_PROVES = [
  "The MySQL service's connection variable is named MYSQL_URL, so DATABASE_URL resolves.",
  "RAILWAY_PUBLIC_DOMAIN is already set when the village service first boots, so FRONTEND_URL is not https:// with nothing after it.",
  "The ADMIN_PASSWORD the Variables tab shows is the value the running container received. A community thread reports a secret() value that changed each time it was revealed.",
  "secret(64, \"0123456789abcdef\") yields 64 lowercase hex characters, which sealedBox accepts.",
  "The volume at /app/data survives a redeploy, and boot migrations apply on the first start.",
] as const;
