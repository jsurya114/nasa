// utils/backendI18n.js - Backend error message translations only
// This works alongside your existing translation.js for UI text
import { backendEn } from '../locales/backend/en.js';
import { backendEs } from '../locales/backend/es.js';

const backendTranslations = {
  en: backendEn,
  es: backendEs,
};

/**
 * Translate backend error messages
 * @param {string} lang - Language code ('en' or 'es')
 * @param {string} key - Translation key (e.g., 'auth.invalidEmail')
 * @param {Object} params - Optional parameters for string interpolation
 * @returns {string} - Translated error message
 */
export const translateError = (lang, key, params = {}) => {
  const language = backendTranslations[lang] || backendTranslations['en'];
  
  const keys = key.split('.');
  let translation = language;
  
  for (const k of keys) {
    if (translation && typeof translation === 'object' && k in translation) {
      translation = translation[k];
    } else {
      console.warn(`Backend translation key not found: ${key}`);
      return key;
    }
  }
  
  if (typeof translation !== 'string') {
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
 * Get language from request (for controllers)
 */
export const getLangFromRequest = (req) => {
  return req.headers['x-language'] || req.query?.lang || 'en';
};

/**
 * Get language from localStorage (for Redux slices)
 */
export const getCurrentLanguage = () => {
  return localStorage.getItem('preferredLanguage') || 'en';
};

export default {
  translateError,
  getLangFromRequest,
  getCurrentLanguage,
};