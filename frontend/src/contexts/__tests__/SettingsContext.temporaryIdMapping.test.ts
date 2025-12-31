/**
 * Unit tests for temporary ID mapping functionality in SettingsContext
 * 
 * Tests the logic that maps temporary appointment type IDs (Date.now()) 
 * to real IDs after saving, and updates practitionerAssignments and billingScenarios.
 */

import { describe, it, expect } from 'vitest';
import { BillingScenario } from '../../types';

describe('Temporary ID Mapping Logic', () => {
  /**
   * Helper function to simulate the ID mapping logic
   */
  // Temporary IDs are generated using Date.now(), which produces large timestamps
  // Real IDs from the backend are small integers, so we use this threshold to distinguish them
  const TEMPORARY_ID_THRESHOLD = 1000000000000;

  const mapTemporaryIdsToRealIds = (
    originalTypes: Array<{ id: number; name: string; duration_minutes: number }>,
    savedTypes: Array<{ id: number; name: string; duration_minutes: number }>
  ): Record<number, number> => {
    const mapping: Record<number, number> = {};
    const tempTypes = originalTypes.filter(at => at.id > TEMPORARY_ID_THRESHOLD);
    
    for (const tempType of tempTypes) {
      const realType = savedTypes.find(at => 
        at.name === tempType.name && 
        at.duration_minutes === tempType.duration_minutes &&
        at.id < TEMPORARY_ID_THRESHOLD
      );
      if (realType) {
        mapping[tempType.id] = realType.id;
      }
    }
    return mapping;
  };

  /**
   * Helper function to update practitionerAssignments with real IDs
   */
  const updatePractitionerAssignments = (
    assignments: Record<number, number[]>,
    mapping: Record<number, number>
  ): Record<number, number[]> => {
    const updated: Record<number, number[]> = {};
    for (const [tempId, practitionerIds] of Object.entries(assignments)) {
      const tempIdNum = parseInt(tempId, 10);
      const realId = mapping[tempIdNum];
      if (realId) {
        updated[realId] = practitionerIds;
      } else {
        updated[tempIdNum] = practitionerIds;
      }
    }
    return updated;
  };

  /**
   * Helper function to update billingScenarios keys with real IDs
   */
  const updateBillingScenariosKeys = (
    scenarios: Record<string, BillingScenario[]>,
    mapping: Record<number, number>
  ): Record<string, BillingScenario[]> => {
    const updated: Record<string, BillingScenario[]> = {};
    for (const [key, scenarioList] of Object.entries(scenarios)) {
      const parts = key.split('-');
      if (parts.length === 2) {
        const tempServiceItemId = parseInt(parts[0], 10);
        const practitionerId = parseInt(parts[1], 10);
        const realServiceItemId = mapping[tempServiceItemId];
        
        if (realServiceItemId) {
          const newKey = `${realServiceItemId}-${practitionerId}`;
          updated[newKey] = scenarioList;
        } else {
          updated[key] = scenarioList;
        }
      } else {
        updated[key] = scenarioList;
      }
    }
    return updated;
  };

  describe('mapTemporaryIdsToRealIds', () => {
    it('should map temporary IDs to real IDs by matching name and duration', () => {
      const originalTypes = [
        { id: 1734567890123, name: '初診', duration_minutes: 60 }, // Temporary ID
        { id: 1, name: '複診', duration_minutes: 30 }, // Real ID (existing)
      ];
      
      const savedTypes = [
        { id: 48, name: '初診', duration_minutes: 60 }, // Real ID from backend
        { id: 1, name: '複診', duration_minutes: 30 }, // Existing
      ];
      
      const mapping = mapTemporaryIdsToRealIds(originalTypes, savedTypes);
      
      expect(mapping).toEqual({
        1734567890123: 48,
      });
    });

    it('should not map if name or duration does not match', () => {
      const originalTypes = [
        { id: 1734567890123, name: '初診', duration_minutes: 60 },
      ];
      
      const savedTypes = [
        { id: 48, name: '初診', duration_minutes: 30 }, // Different duration
      ];
      
      const mapping = mapTemporaryIdsToRealIds(originalTypes, savedTypes);
      
      expect(mapping).toEqual({});
    });

    it('should handle multiple temporary IDs', () => {
      const originalTypes = [
        { id: 1734567890123, name: '初診', duration_minutes: 60 },
        { id: 1734567890456, name: '複診', duration_minutes: 30 },
      ];
      
      const savedTypes = [
        { id: 48, name: '初診', duration_minutes: 60 },
        { id: 49, name: '複診', duration_minutes: 30 },
      ];
      
      const mapping = mapTemporaryIdsToRealIds(originalTypes, savedTypes);
      
      expect(mapping).toEqual({
        1734567890123: 48,
        1734567890456: 49,
      });
    });

    it('should not map real IDs (small integers)', () => {
      const originalTypes = [
        { id: 1, name: '初診', duration_minutes: 60 }, // Real ID
      ];
      
      const savedTypes = [
        { id: 1, name: '初診', duration_minutes: 60 },
      ];
      
      const mapping = mapTemporaryIdsToRealIds(originalTypes, savedTypes);
      
      expect(mapping).toEqual({});
    });
  });

  describe('updatePractitionerAssignments', () => {
    it('should update keys from temporary to real IDs', () => {
      const assignments: Record<number, number[]> = {
        1734567890123: [11, 12], // Temporary ID
        1: [13], // Real ID
      };
      
      const mapping: Record<number, number> = {
        1734567890123: 48,
      };
      
      const updated = updatePractitionerAssignments(assignments, mapping);
      
      expect(updated).toEqual({
        48: [11, 12], // Updated key
        1: [13], // Unchanged
      });
    });

    it('should keep original keys if not in mapping', () => {
      const assignments: Record<number, number[]> = {
        1734567890123: [11],
        999: [12], // Not in mapping
      };
      
      const mapping: Record<number, number> = {
        1734567890123: 48,
      };
      
      const updated = updatePractitionerAssignments(assignments, mapping);
      
      expect(updated).toEqual({
        48: [11],
        999: [12], // Kept as-is
      });
    });

    it('should handle empty mapping', () => {
      const assignments: Record<number, number[]> = {
        1734567890123: [11],
      };
      
      const mapping: Record<number, number> = {};
      
      const updated = updatePractitionerAssignments(assignments, mapping);
      
      expect(updated).toEqual({
        1734567890123: [11], // Unchanged
      });
    });
  });

  describe('updateBillingScenariosKeys', () => {
    it('should update keys from temporary to real IDs', () => {
      const scenarios: Record<string, BillingScenario[]> = {
        '1734567890123-11': [{ id: 1, name: '原價' }], // Temporary serviceItemId
        '1-12': [{ id: 2, name: '特約' }], // Real serviceItemId
      };
      
      const mapping: Record<number, number> = {
        1734567890123: 48,
      };
      
      const updated = updateBillingScenariosKeys(scenarios, mapping);
      
      expect(updated).toEqual({
        '48-11': [{ id: 1, name: '原價' }], // Updated key
        '1-12': [{ id: 2, name: '特約' }], // Unchanged
      });
    });

    it('should keep original keys if not in mapping', () => {
      const scenarios: Record<string, BillingScenario[]> = {
        '1734567890123-11': [{ id: 1, name: '原價' }],
        '999-12': [{ id: 2, name: '特約' }], // Not in mapping
      };
      
      const mapping: Record<number, number> = {
        1734567890123: 48,
      };
      
      const updated = updateBillingScenariosKeys(scenarios, mapping);
      
      expect(updated).toEqual({
        '48-11': [{ id: 1, name: '原價' }],
        '999-12': [{ id: 2, name: '特約' }], // Kept as-is
      });
    });

    it('should handle invalid key format', () => {
      const scenarios: Record<string, BillingScenario[]> = {
        'invalid-key': [{ id: 1, name: '原價' }],
      };
      
      const mapping: Record<number, number> = {
        1734567890123: 48,
      };
      
      const updated = updateBillingScenariosKeys(scenarios, mapping);
      
      expect(updated).toEqual({
        'invalid-key': [{ id: 1, name: '原價' }], // Kept as-is
      });
    });

    it('should handle empty mapping', () => {
      const scenarios: Record<string, BillingScenario[]> = {
        '1734567890123-11': [{ id: 1, name: '原價' }],
      };
      
      const mapping: Record<number, number> = {};
      
      const updated = updateBillingScenariosKeys(scenarios, mapping);
      
      expect(updated).toEqual({
        '1734567890123-11': [{ id: 1, name: '原價' }], // Unchanged
      });
    });
  });

  describe('Integration: Full flow', () => {
    it('should handle complete flow: create appointment type, assign practitioner, add billing scenario', () => {
      // Step 1: Create mapping
      const originalTypes = [
        { id: 1734567890123, name: '初診', duration_minutes: 60 },
      ];
      const savedTypes = [
        { id: 48, name: '初診', duration_minutes: 60 },
      ];
      const mapping = mapTemporaryIdsToRealIds(originalTypes, savedTypes);
      
      // Step 2: Update practitioner assignments
      const assignments: Record<number, number[]> = {
        1734567890123: [11], // Practitioner 11 assigned to temporary ID
      };
      const updatedAssignments = updatePractitionerAssignments(assignments, mapping);
      
      // Step 3: Update billing scenarios
      const scenarios: Record<string, BillingScenario[]> = {
        '1734567890123-11': [{ id: -1734567890456, name: '原價', amount: 1000 }], // Temporary IDs
      };
      const updatedScenarios = updateBillingScenariosKeys(scenarios, mapping);
      
      // Verify results
      expect(mapping).toEqual({ 1734567890123: 48 });
      expect(updatedAssignments).toEqual({ 48: [11] });
      expect(updatedScenarios).toEqual({
        '48-11': [{ id: -1734567890456, name: '原價', amount: 1000 }],
      });
    });
  });
});

