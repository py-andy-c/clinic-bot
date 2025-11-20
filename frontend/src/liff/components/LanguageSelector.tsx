import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { liffApiService } from '../../services/liffApi';
import { isValidLanguage, getLanguageDisplayName, type LanguageCode } from '../../utils/languageUtils';
import { logger } from '../../utils/logger';
import { useModal } from '../../contexts/ModalContext';

const LANGUAGE_OPTIONS: LanguageCode[] = ['zh-TW', 'en', 'ja'];

export const LanguageSelector: React.FC = () => {
  const { i18n, t } = useTranslation();
  const { alert } = useModal();
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleLanguageChange = async (newLanguage: LanguageCode) => {
    if (!isValidLanguage(newLanguage) || newLanguage === i18n.language) {
      setIsOpen(false);
      return;
    }

    // Optimistic update - change UI immediately
    i18n.changeLanguage(newLanguage);
    setIsOpen(false);
    setIsUpdating(true);

    try {
      await liffApiService.updateLanguagePreference(newLanguage);
    } catch (error) {
      // Show error but keep UI updated (user intent is clear)
      logger.error('Failed to save language preference:', error);
      const errorMessage = t('language.updateFailed');
      await alert(errorMessage);
    } finally {
      setIsUpdating(false);
    }
  };

  const currentLanguage = i18n.language as LanguageCode;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        disabled={isUpdating}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-2 rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200"
        aria-label={t('language.selectLanguage')}
        aria-haspopup="true"
        aria-expanded={isOpen}
        title={t('language.selectLanguage')}
      >
        {/* Globe icon to make it clear this is for language selection */}
        <svg
          className="w-5 h-5 text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="text-sm font-medium text-gray-700">
          {getLanguageDisplayName(currentLanguage)}
        </span>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200">
          <div className="py-1" role="menu">
            {LANGUAGE_OPTIONS.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => handleLanguageChange(lang)}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                  lang === currentLanguage ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700'
                }`}
                role="menuitem"
              >
                {getLanguageDisplayName(lang)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

