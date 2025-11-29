/**
 * API-related types and error handling
 */

import i18n from '../i18n';

/**
 * Standard API error response structure
 */
export interface ApiError {
  message: string;
  status?: number;
  code?: string;
}

/**
 * Axios error response structure (common pattern in the codebase)
 */
export interface AxiosErrorResponse {
  response?: {
    data?: {
      detail?: string | Array<{ msg: string; type?: string }>;
      message?: string;
      error?: string;
    };
    status?: number;
  };
  message?: string;
}

/**
 * Validation error detail from FastAPI
 */
export interface ValidationErrorDetail {
  msg: string;
  type?: string;
}

/**
 * Generic error type for catch blocks
 */
export type ApiErrorType = AxiosErrorResponse | Error | ApiError | unknown;

/**
 * Result type for API operations
 */
export interface ApiResult<T> {
  data?: T;
  error?: ApiError;
  success: boolean;
}

/**
 * Helper function to extract error message from various error types
 * Strips FastAPI's "Value error, " prefix and ensures messages are user-friendly
 */
export const getErrorMessage = (error: ApiErrorType): string => {
  let message = '';

  // Axios error with response
  if (typeof error === 'object' && error && 'response' in error) {
    const axiosError = error as AxiosErrorResponse;

    // FastAPI validation error (422)
    if (axiosError.response?.data?.detail) {
      const detail = axiosError.response.data.detail;
      if (Array.isArray(detail)) {
        message = detail.map(d => d.msg).join(', ');
      } else if (typeof detail === 'string') {
        message = detail;
      }
    }

    // Other API error messages
    if (!message && axiosError.response?.data?.message) {
      message = axiosError.response.data.message;
    }

    if (!message && axiosError.response?.data?.error) {
      message = axiosError.response.data.error;
    }
  }

  // Standard Error object
  if (!message && error instanceof Error) {
    message = error.message;
  }

  // ApiError interface
  if (!message && typeof error === 'object' && error && 'message' in error) {
    message = (error as ApiError).message;
  }

  // Fallback - use i18n for translation
  if (!message) {
    return i18n.t('common.unknownError');
  }

  // Strip FastAPI's "Value error, " prefix (case-insensitive)
  // FastAPI automatically prefixes ValueError messages with "Value error, "
  message = message.replace(/^Value error,\s*/i, '');

  return message;
};
