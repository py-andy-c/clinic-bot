import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhTW from './locales/zh-TW';
import en from './locales/en';
import { logger } from '../utils/logger';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-TW': { translation: zhTW },
      'en': { translation: en },
    },
    lng: 'zh-TW', // Default language
    fallbackLng: 'zh-TW',
    interpolation: {
      escapeValue: false, // React already escapes
    },
    missingKeyHandler: (lng, _ns, key) => {
      if (import.meta.env.DEV) {
        logger.warn(`Missing translation: ${key} for language: ${lng}`);
      }
    },
  });

export default i18n;

