// Language utility functions

export const VALID_LANGUAGES = ['zh-TW', 'en'] as const;
export type LanguageCode = typeof VALID_LANGUAGES[number];

export function isValidLanguage(code: string): code is LanguageCode {
  return VALID_LANGUAGES.includes(code as LanguageCode);
}

export function getLanguageDisplayName(code: LanguageCode): string {
  const names: Record<LanguageCode, string> = {
    'zh-TW': '繁體中文',
    'en': 'English',
  };
  return names[code];
}

