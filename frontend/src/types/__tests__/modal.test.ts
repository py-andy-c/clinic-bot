/**
 * Tests for modal types and utilities
 */

import { describe, it, expect } from 'vitest';
import { modalUtils } from '../modal';

describe('Modal Utilities', () => {
  describe('isOpen', () => {
    it('returns true when modal type matches', () => {
      const state = { type: 'create_appointment' as const };
      expect(modalUtils.isOpen(state, 'create_appointment')).toBe(true);
    });

    it('returns false when modal type does not match', () => {
      const state = { type: 'create_appointment' as const };
      expect(modalUtils.isOpen(state, 'edit_appointment')).toBe(false);
    });

    it('returns false when modal is closed', () => {
      const state = { type: null };
      expect(modalUtils.isOpen(state, 'create_appointment')).toBe(false);
    });
  });

  describe('open', () => {
    it('creates modal state with type and data', () => {
      const data = { patientId: 1 };
      const result = modalUtils.open('create_appointment', data);

      expect(result).toEqual({
        type: 'create_appointment',
        data: { patientId: 1 },
      });
    });

    it('creates modal state without data', () => {
      const result = modalUtils.open('checkout');

      expect(result).toEqual({
        type: 'checkout',
        data: undefined,
      });
    });
  });

  describe('close', () => {
    it('creates closed modal state', () => {
      const result = modalUtils.close();

      expect(result).toEqual({
        type: null,
      });
    });
  });
});