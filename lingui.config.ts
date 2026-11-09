import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

/**
 * Translation catalogs (internal spec i18n, plan §1.1).
 *
 * English is the SOURCE: it stays in the components as the message, and the
 * id is a hash of message + context. Reviewed catalogs are PO files under
 * client/src/locales/; the server compiles them and serves JSON from
 * /api/i18n/catalog/:locale, so no non-English language is shipped in
 * dist/public (the total dist budget). The pseudo locales for the overflow
 * sweep (en-XA, ar-XB) are generated from the English source by
 * scripts/build-i18n-catalogs.mjs, so they have no PO file here.
 */
export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "es"],
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/client/src/locales/{locale}",
      include: ["<rootDir>/client/src"],
      exclude: ["**/node_modules/**", "**/*.test.ts", "**/*.test.tsx"],
    },
  ],
  format: formatter({ lineNumbers: false }),
  orderBy: "messageId",
});
