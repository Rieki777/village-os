import { lingui } from "@lingui/vite-plugin";
import { precompileEnglish } from "./precompileEnglish";

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
 */
export function linguiMacros() {
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
    precompileEnglish(),
  ];
}
