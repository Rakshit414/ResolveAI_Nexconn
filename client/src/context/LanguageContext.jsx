import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { TRANSLATIONS, SUPPORTED_LANGUAGES } from '../utils/translations';
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
    if (['en', 'hi', 'mr'].includes(newLang)) {
      setLanguageState(newLang);
      saveLanguageToStorage(newLang);
    }
  }, []);

  // Listen for storage events (multi-tab synchronization)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === LANGUAGE_STORAGE_KEY && e.newValue && ['en', 'hi', 'mr'].includes(e.newValue)) {
        setLanguageState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const storefrontTranslations = useMemo(() => {
    return TRANSLATIONS[language]?.storefront || TRANSLATIONS.en.storefront;
  }, [language]);

  const value = useMemo(() => ({
    language,
    setLanguage,
    supportedLanguages: SUPPORTED_LANGUAGES,
    storefront: storefrontTranslations,
    t: (section, key, fallback = '') => {
      const val = storefrontTranslations?.[section]?.[key];
      return val !== undefined ? val : fallback;
    }
  }), [language, setLanguage, storefrontTranslations]);

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
      storefront: fallbackStorefront,
      t: (section, key, fallback = '') => fallbackStorefront?.[section]?.[key] || fallback
    };
  }
  return context;
}
