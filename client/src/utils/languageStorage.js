export const LANGUAGE_STORAGE_KEY = 'novacart_storefront_lang';
export const DEFAULT_LANGUAGE = 'en';

export const SUPPORTED_STORAGE_LANGUAGES = [
  'en', 'hi', 'mr', 'es', 'de', 'fr', 'ja', 'pt', 'ar', 'zh-CN', 'bn', 'ta'
];

export function loadLanguageFromStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return DEFAULT_LANGUAGE;
    }
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && SUPPORTED_STORAGE_LANGUAGES.includes(saved)) {
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
