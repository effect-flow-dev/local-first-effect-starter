// FILE: src/lib/client/stores/i18nStore.ts
import { signal, computed } from "@preact/signals-core";
import { en } from "../i18n/en";
import { es } from "../i18n/es";
import { ja } from "../i18n/ja";
import { clientLog } from "../clientLog";
import { runClientUnscoped } from "../runtime";

export type Locale = "en" | "es" | "ja";

const dictionaries = { en, es, ja };

// 1. The State
// Initialize from localStorage for persistence
const storedLocale = (localStorage.getItem("app-locale") as Locale) || "en";
export const localeState = signal<Locale>(storedLocale in dictionaries ? storedLocale : "en");

// 2. The Computed Dictionary
// Automatically updates when localeState changes
const dictionaryState = computed(() => dictionaries[localeState.value]);

// 3. Actions
export const setLocale = (newLocale: Locale) => {
  if (localeState.value === newLocale) return;
  
  localeState.value = newLocale;
  localStorage.setItem("app-locale", newLocale);
  
  // Update HTML lang attribute for accessibility
  document.documentElement.lang = newLocale;

  runClientUnscoped(clientLog("info", `Language switched to ${newLocale}`));
};

// 4. The Translation Helper Function
export const t = (path: string, vars?: Record<string, string | number>): string => {
  const keys = path.split(".");
  // ✅ FIX: Use unknown instead of any to satisfy linter
  let current: unknown = dictionaryState.value;

  for (const key of keys) {
    // ✅ FIX: Safe object check before accessing property
    if (
      typeof current === "object" && 
      current !== null && 
      key in current
    ) {
      // ✅ FIX: Safe cast now that we know key exists
      current = (current as Record<string, unknown>)[key];
    } else {
      console.warn(`[i18n] Missing key: ${path} for locale ${localeState.value}`);
      return path;
    }
  }

  // Cast strictly to string for return
  let text = String(current);

  if (vars) {
    Object.entries(vars).forEach(([key, value]) => {
      text = text.replace(`{${key}}`, String(value));
    });
  }

  return text;
};
