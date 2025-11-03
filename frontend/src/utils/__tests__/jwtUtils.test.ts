/**
 * Unit tests for JWT token utilities.
 * 
 * Tests the clinic_id extraction from JWT tokens to ensure
 * the fallback mechanism works correctly.
 */

import { describe, it, expect } from 'vitest';

/**
 * Helper function to create a mock JWT token for testing.
 * In real scenarios, tokens are signed by the backend.
 */
function createMockJWT(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  // Note: In real JWT, there's a signature, but for testing we don't need it
  return `${encodedHeader}.${encodedPayload}.mock-signature`;
}

/**
 * Extract clinic_id from JWT token payload.
 * This is the same logic used in useLineAuth.ts
 */
function getClinicIdFromToken(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2 || !parts[1]) {
      return null;
    }
    const payload = JSON.parse(atob(parts[1]));
    return payload.clinic_id ? parseInt(payload.clinic_id, 10) : null;
  } catch (e) {
    return null;
  }
}

describe('getClinicIdFromToken', () => {
  describe('valid tokens', () => {
    it('should extract clinic_id from valid JWT token', () => {
      const token = createMockJWT({
        line_user_id: 'U123456789',
        clinic_id: 123,
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
      });

      const clinicId = getClinicIdFromToken(token);

      expect(clinicId).toBe(123);
    });

    it('should handle clinic_id as number in payload', () => {
      const token = createMockJWT({
        clinic_id: 456,
        line_user_id: 'U987654321',
      });

      const clinicId = getClinicIdFromToken(token);

      expect(clinicId).toBe(456);
    });

    it('should handle clinic_id as string in payload', () => {
      const token = createMockJWT({
        clinic_id: '789',
        line_user_id: 'U111111111',
      });

      const clinicId = getClinicIdFromToken(token);

      expect(clinicId).toBe(789);
    });
  });

  describe('invalid tokens', () => {
    it('should return null for malformed token (missing parts)', () => {
      const token = 'invalid.token';
      const clinicId = getClinicIdFromToken(token);
      expect(clinicId).toBeNull();
    });

    it('should return null for token with only one part', () => {
      const token = 'only-onepart';
      const clinicId = getClinicIdFromToken(token);
      expect(clinicId).toBeNull();
    });

    it('should return null for token without clinic_id', () => {
      const token = createMockJWT({
        line_user_id: 'U123456789',
        exp: Date.now() / 1000 + 3600,
      });

      const clinicId = getClinicIdFromToken(token);

      expect(clinicId).toBeNull();
    });

    it('should return null for invalid base64 payload', () => {
      const token = 'header.invalid-base64!.signature';
      const clinicId = getClinicIdFromToken(token);
      expect(clinicId).toBeNull();
    });

    it('should return null for invalid JSON in payload', () => {
      const invalidPayload = btoa('not valid json');
      const token = `header.${invalidPayload}.signature`;
      const clinicId = getClinicIdFromToken(token);
      expect(clinicId).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle clinic_id as zero', () => {
      const token = createMockJWT({
        clinic_id: 0,
        line_user_id: 'U123456789',
      });

      const clinicId = getClinicIdFromToken(token);

      expect(clinicId).toBeNull();
    });

    it('should handle very large clinic_id', () => {
      const largeId = 2147483647; // Max 32-bit integer
      const token = createMockJWT({
        clinic_id: largeId,
        line_user_id: 'U123456789',
      });

      const clinicId = getClinicIdFromToken(token);

      expect(clinicId).toBe(largeId);
    });

    it('should handle empty string token', () => {
      const clinicId = getClinicIdFromToken('');
      expect(clinicId).toBeNull();
    });
  });

  describe('real-world scenarios', () => {
    it('should extract clinic_id from typical LIFF token', () => {
      // Simulate a real token structure from backend
      const token = createMockJWT({
        line_user_id: 'U1234567890abcdef',
        clinic_id: 42,
        exp: Math.floor(Date.now() / 1000) + 604800, // 7 days
        iat: Math.floor(Date.now() / 1000),
      });

      const clinicId = getClinicIdFromToken(token);

      expect(clinicId).toBe(42);
    });

    it('should handle token with additional fields', () => {
      const token = createMockJWT({
        line_user_id: 'U123456789',
        clinic_id: 999,
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
        display_name: 'Test User',
        custom_field: 'custom_value',
      });

      const clinicId = getClinicIdFromToken(token);

      expect(clinicId).toBe(999);
    });
  });
});

