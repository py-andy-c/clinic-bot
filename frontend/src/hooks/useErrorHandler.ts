import { useState } from 'react';
import { logger } from '../utils/logger';

export const useErrorHandler = () => {
  const [error, setError] = useState<string | null>(null);

  const handleError = (err: unknown, fallbackMessage: string = '發生錯誤，請稍後再試') => {
    const message = extractErrorMessage(err, fallbackMessage);
    setError(message);
    logger.error(err);
  };

  const clearError = () => setError(null);

  return { error, handleError, clearError };
};

// Utility function to extract error messages consistently
export const extractErrorMessage = (
  error: unknown,
  fallback: string = '發生錯誤，請稍後再試'
): string => {
  if (isAxiosError(error)) {
    return error.response?.data?.detail
      || error.response?.data?.message
      || error.message
      || fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

// Type guard for axios errors
function isAxiosError(error: any): error is { response?: { data?: { detail?: string; message?: string } }; message: string } {
  return error && typeof error === 'object' && 'response' in error;
}
