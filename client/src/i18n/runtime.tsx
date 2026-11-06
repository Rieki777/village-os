import { LinguiContext } from "@lingui/react";
import { TransNoContext } from "@lingui/react/server";
import { useContext, type ComponentProps } from "react";
import { i18n } from "./i18n";

/**
 * What the Lingui macros compile to (linguiMacros.ts `runtimeModules`).
 *
 * Lingui's own `useLingui` and `Trans` throw when no `<I18nProvider>` is
 * mounted (in development and tests), and in production read a null context.
 * Hundreds of component tests render one component on its own, and every one
 * that gains a `<Trans>` would break. Outside a provider these fall back to the
 * global instance, which holds English until a language is activated; inside
 * one they use its context exactly as Lingui does, so a language switch still
 * re-renders everything under the provider.
 */
const fallback = { i18n, _: i18n.t.bind(i18n), defaultComponent: undefined };

export function useLingui() {
  return useContext(LinguiContext) ?? fallback;
}

type TransProps = Omit<ComponentProps<typeof TransNoContext>, "lingui">;

export function Trans(props: TransProps) {
  const lingui = useContext(LinguiContext) ?? fallback;
  return <TransNoContext {...props} lingui={lingui} />;
}
