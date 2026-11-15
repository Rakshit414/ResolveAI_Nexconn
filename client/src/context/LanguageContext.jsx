import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { TRANSLATIONS, SUPPORTED_LANGUAGES, SUPPORTED_LANGUAGE_CODES } from '../utils/translations';
import {
  LANGUAGE_STORAGE_KEY,
  DEFAULT_LANGUAGE,
  loadLanguageFromStorage,
  saveLanguageToStorage
} from '../utils/languageStorage';

export {
  LANGUAGE_STORAGE_KEY,
  DEFAULT_LANGUAGE,
  loadLanguageFromStorage,
  saveLanguageToStorage
};

const LanguageContext = createContext(null);

export function LanguageProvider({ children, initialLanguage = null }) {
  const [language, setLanguageState] = useState(() => {
    return initialLanguage || loadLanguageFromStorage();
  });

  const setLanguage = useCallback((newLang) => {
    if (SUPPORTED_LANGUAGE_CODES.includes(newLang)) {
      setLanguageState(newLang);
      saveLanguageToStorage(newLang);
    }
  }, []);

  // Synchronize document dir and lang attributes for full RTL/LTR flow
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const isRTL = language === 'ar';
      document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
      document.documentElement.lang = language;
    }
  }, [language]);

  // Listen for storage events (multi-tab synchronization)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === LANGUAGE_STORAGE_KEY && e.newValue && SUPPORTED_LANGUAGE_CODES.includes(e.newValue)) {
        setLanguageState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const storefrontTranslations = useMemo(() => {
    return TRANSLATIONS[language]?.storefront || TRANSLATIONS.en.storefront;
  }, [language]);

  const isRTL = language === 'ar';

  const t = useCallback((section, key, fallback = '') => {
    // Current language lookup
    const currentVal = TRANSLATIONS[language]?.storefront?.[section]?.[key] ?? TRANSLATIONS[language]?.[section]?.[key];
    if (currentVal !== undefined && currentVal !== null) return currentVal;

    // English deep fallback
    const enVal = TRANSLATIONS.en?.storefront?.[section]?.[key] ?? TRANSLATIONS.en?.[section]?.[key];
    if (enVal !== undefined && enVal !== null) return enVal;

    return fallback;
  }, [language]);

  const value = useMemo(() => ({
    language,
    setLanguage,
    supportedLanguages: SUPPORTED_LANGUAGES,
    supportedLanguageCodes: SUPPORTED_LANGUAGE_CODES,
    isRTL,
    storefront: storefrontTranslations,
    t
  }), [language, setLanguage, isRTL, storefrontTranslations, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    // Graceful fallback if rendered outside LanguageProvider
    const fallbackStorefront = TRANSLATIONS.en.storefront;
    return {
      language: 'en',
      setLanguage: () => {},
      supportedLanguages: SUPPORTED_LANGUAGES,
      supportedLanguageCodes: SUPPORTED_LANGUAGE_CODES,
      isRTL: false,
      storefront: fallbackStorefront,
      t: (section, key, fallback = '') =>
        fallbackStorefront?.[section]?.[key] || fallback
    };
  }
  return context;
}
