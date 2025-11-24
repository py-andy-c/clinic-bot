/**
 * Search utility functions for server-side search functionality.
 * 
 * Provides functions for determining when to trigger search and debouncing.
 */

import { useState, useEffect } from 'react';

/**
 * Determines if search should be triggered based on query content.
 * 
 * Search triggers:
 * - 3+ digits for phone numbers (Taiwan format: 09XX-XXX-XXX)
 * - 1+ English letter for English names
 * - 1+ Chinese/CJK character for Chinese names
 * 
 * @param query - Search query string
 * @returns true if search should trigger, false otherwise
 */
export function shouldTriggerSearch(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return false;
  
  // Check if starts with digits (phone number)
  if (/^\d/.test(trimmed)) {
    const digitCount = trimmed.replace(/\D/g, '').length;
    return digitCount >= 3; // 3+ digits for phone
  }
  
  // Check for Chinese/CJK characters
  // Includes: Chinese (U+4E00-U+9FFF), CJK Extension A (U+3400-U+4DBF),
  // Hiragana (U+3040-U+309F), Katakana (U+30A0-U+30FF)
  if (/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff]/.test(trimmed)) {
    return true; // 1+ Chinese/CJK character
  }
  
  // Check for English letters
  if (/[a-zA-Z]/.test(trimmed)) {
    return true; // 1+ letter
  }
  
  return false;
}

/**
 * Custom hook for debounced search.
 * 
 * Delays updating the search query until the user stops typing.
 * Only updates if the query meets trigger criteria or is empty.
 * Respects IME composition state to avoid interrupting Chinese input methods.
 * 
 * @param query - Current search query
 * @param delay - Debounce delay in milliseconds (default: 400ms)
 * @param isComposing - Whether the user is currently composing text (IME composition)
 * @returns Debounced search query
 */

export function useDebouncedSearch(
  query: string,
  delay: number = 400,
  isComposing: boolean = false
): string {
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  
  useEffect(() => {
    // Don't update debounced query during IME composition
    if (isComposing) {
      return;
    }
    
    const handler = setTimeout(() => {
      if (shouldTriggerSearch(query) || query.trim() === '') {
        setDebouncedQuery(query.trim());
      }
    }, delay);
    
    return () => clearTimeout(handler);
  }, [query, delay, isComposing]);
  
  return debouncedQuery;
}

