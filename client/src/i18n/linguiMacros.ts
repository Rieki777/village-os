import { lingui } from "@lingui/vite-plugin";
import { precompileEnglish, type LongCopySink } from "./precompileEnglish";

/**
 * The Lingui macro transform, shared by vite.config.ts and vitest.config.ts so
 * a component test renders exactly what the build ships.
 *
 * `descriptorFields: "message"` keeps each English source message in the
 * chunk that renders it, in production too (Lingui's default strips it to an
 * id). English is the source language: it then needs no catalog download, a
 * missing translation falls back to it, and English bytes stay spread over the
 * route chunks instead of piling into one catalog on the first page.
 * `precompileEnglish` then compiles each of those messages at build time, so
 * the browser never needs Lingui's ICU compiler.
 *
 * `splitLongEnglish` (vite.config.ts only, never vitest) takes the LONG
 * messages back out of the lazy chunks in a production build, into parts the
 * chunk loads before it runs: client/src/i18n/copySplit.ts. Boot chunks keep
 * theirs inline, so the first page still downloads no catalog.
 */
export function linguiMacros(splitLongEnglish?: LongCopySink) {
  return [
    lingui({
      macroTransform: {
        macro: {
          descriptorFields: "message",
          // Our runtime falls back to English outside a provider (runtime.tsx).
          runtimeModules: { Trans: ["@/i18n/runtime", "Trans"], useLingui: ["@/i18n/runtime", "useLingui"] },
        },
      },
    }),
    precompileEnglish(splitLongEnglish),
  ];
}
