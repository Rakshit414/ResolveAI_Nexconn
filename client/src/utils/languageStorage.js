export const LANGUAGE_STORAGE_KEY = 'novacart_storefront_lang';
export const DEFAULT_LANGUAGE = 'en';

export function loadLanguageFromStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return DEFAULT_LANGUAGE;
    }
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && ['en', 'hi', 'mr'].includes(saved)) {
      return saved;
    }
    return DEFAULT_LANGUAGE;
  } catch (err) {
    console.warn('[LanguageContext] Error loading language from storage:', err);
    return DEFAULT_LANGUAGE;
  }
}

export function saveLanguageToStorage(lang) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    }
  } catch (err) {
    console.warn('[LanguageContext] Error saving language to storage:', err);
  }
}
