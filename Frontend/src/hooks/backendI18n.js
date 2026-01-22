// utils/backendI18n.js - Frontend version
// Translation utility for Redux slices and frontend code

import { backendEn } from '../locales/backend/en';
import { backendEs } from '../locales/backend/es';

const backendTranslations = {
  en: backendEn,
  es: backendEs,
};

const DEFAULT_LANGUAGE = 'en';

/**
 * Translate backend error messages
 * @param {string} lang - Language code ('en' or 'es')
 * @param {string} key - Translation key (e.g., 'auth.invalidEmail')
 * @param {Object} params - Optional parameters for string interpolation
 * @returns {string} - Translated error message
 */
export const translateError = (lang, key, params = {}) => {
  const language = backendTranslations[lang] || backendTranslations[DEFAULT_LANGUAGE];
  
  const keys = key.split('.');
  let translation = language;
  
  for (const k of keys) {
    if (translation && typeof translation === 'object' && k in translation) {
      translation = translation[k];
    } else {
      console.warn(`Backend translation key not found: ${key} for language: ${lang}`);
      return key;
    }
  }
  
  if (typeof translation !== 'string') {
    console.warn(`Backend translation is not a string: ${key}`);
    return key;
  }
  
  // Replace parameters
  let result = translation;
  Object.keys(params).forEach(param => {
    result = result.replace(`{${param}}`, params[param]);
  });
  
  return result;
};

/**
 * Get current language from localStorage (for Redux slices/frontend)
 * @returns {string} - Language code ('en' or 'es')
 */
export const getCurrentLanguage = () => {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('preferredLanguage') || DEFAULT_LANGUAGE;
  }
  return DEFAULT_LANGUAGE;
};

/**
 * Check if language is supported
 * @param {string} lang - Language code
 * @returns {boolean}
 */
export const isLanguageSupported = (lang) => {
  return lang in backendTranslations;
};

/**
 * Get list of supported languages
 * @returns {Array<string>}
 */
export const getSupportedLanguages = () => {
  return Object.keys(backendTranslations);
};

export default {
  translateError,
  getCurrentLanguage,
  isLanguageSupported,
  getSupportedLanguages,
};