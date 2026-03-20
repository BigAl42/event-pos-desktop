import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "de"],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
    initImmediate: false,
  });

if (import.meta.env.MODE === "test") {
  const noopLogger = { type: "logger" as const, log: () => {}, warn: () => {}, error: () => {} };
  (i18n as unknown as { logger: typeof noopLogger }).logger = noopLogger;
}

/** BCP 47 locale for `Intl` / `toLocaleString` from current i18n language. */
export function intlLocaleFor(lang: string): string {
  if (lang.startsWith("de")) return "de-DE";
  return "en-GB";
}

export default i18n;
