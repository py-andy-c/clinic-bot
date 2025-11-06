import { describe, it, expect } from 'vitest';
import { getErrorMessage, type ApiError, type AxiosErrorResponse, type ValidationErrorDetail } from '../api';

describe('API Types and Utilities', () => {
  describe('getErrorMessage', () => {
    it('should extract message from Axios validation error (array)', () => {
      const error: AxiosErrorResponse = {
        response: {
          data: {
            detail: [
              { msg: 'Name is required', type: 'missing' },
              { msg: 'Email format invalid', type: 'value_error' }
            ]
          }
        }
      };

      expect(getErrorMessage(error)).toBe('Name is required, Email format invalid');
    });

    it('should extract message from Axios validation error (string)', () => {
      const error: AxiosErrorResponse = {
        response: {
          data: {
            detail: 'Invalid input data'
          }
        }
      };

      expect(getErrorMessage(error)).toBe('Invalid input data');
    });

    it('should extract message from Axios error with message field', () => {
      const error: AxiosErrorResponse = {
        response: {
          data: {
            message: 'Server error occurred'
          }
        }
      };

      expect(getErrorMessage(error)).toBe('Server error occurred');
    });

    it('should extract message from Axios error with error field', () => {
      const error: AxiosErrorResponse = {
        response: {
          data: {
            error: 'Authentication failed'
          }
        }
      };

      expect(getErrorMessage(error)).toBe('Authentication failed');
    });

    it('should extract message from standard Error object', () => {
      const error = new Error('Network timeout');
      expect(getErrorMessage(error)).toBe('Network timeout');
    });

    it('should extract message from ApiError interface', () => {
      const error: ApiError = {
        message: 'Custom error message',
        status: 400,
        code: 'VALIDATION_ERROR'
      };

      expect(getErrorMessage(error)).toBe('Custom error message');
    });

    it('should return fallback message for unknown error types', () => {
      expect(getErrorMessage(null)).toBe('發生未知錯誤，請稍後再試');
      expect(getErrorMessage(undefined)).toBe('發生未知錯誤，請稍後再試');
      expect(getErrorMessage('string error')).toBe('發生未知錯誤，請稍後再試');
      expect(getErrorMessage(123)).toBe('發生未知錯誤，請稍後再試');
    });

    it('should handle errors without response', () => {
      const error: AxiosErrorResponse = {
        message: 'Network Error'
      };

      expect(getErrorMessage(error)).toBe('Network Error');
    });
  });

  describe('Type definitions', () => {
    it('should properly type ApiError', () => {
      const error: ApiError = {
        message: 'Test error',
        status: 404,
        code: 'NOT_FOUND'
      };

      expect(error.message).toBe('Test error');
      expect(error.status).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should properly type AxiosErrorResponse', () => {
      const error: AxiosErrorResponse = {
        response: {
          data: {
            detail: 'Error detail'
          },
          status: 422
        },
        message: 'Validation Error'
      };

      expect(error.response?.status).toBe(422);
      expect(error.message).toBe('Validation Error');
    });

    it('should properly type ValidationErrorDetail', () => {
      const detail: ValidationErrorDetail = {
        msg: 'Field is required',
        type: 'missing'
      };

      expect(detail.msg).toBe('Field is required');
      expect(detail.type).toBe('missing');
    });
  });
});
