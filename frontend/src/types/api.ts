/**
 * API-related types and error handling
 */

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
 */
export const getErrorMessage = (error: ApiErrorType): string => {
  // Axios error with response
  if (typeof error === 'object' && error && 'response' in error) {
    const axiosError = error as AxiosErrorResponse;

    // FastAPI validation error (422)
    if (axiosError.response?.data?.detail) {
      const detail = axiosError.response.data.detail;
      if (Array.isArray(detail)) {
        return detail.map(d => d.msg).join(', ');
      }
      if (typeof detail === 'string') {
        return detail;
      }
    }

    // Other API error messages
    if (axiosError.response?.data?.message) {
      return axiosError.response.data.message;
    }

    if (axiosError.response?.data?.error) {
      return axiosError.response.data.error;
    }
  }

  // Standard Error object
  if (error instanceof Error) {
    return error.message;
  }

  // ApiError interface
  if (typeof error === 'object' && error && 'message' in error) {
    return (error as ApiError).message;
  }

  // Fallback
  return '發生未知錯誤，請稍後再試';
};
