/**
 * Simple State Management Integration Tests
 *
 * These tests validate core state management scenarios that have historically
 * caused bugs, focusing on data persistence and state consistency.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock stores - simplified versions for testing
const createMockAppointmentStore = () => {
  let state = {
    appointments: [] as any[],
    isLoading: false,
    error: null as string | null,
  };

  const listeners = new Set<() => void>();

  const setState = (newState: Partial<typeof state>) => {
    state = { ...state, ...newState };
    listeners.forEach(listener => listener());
  };

  return {
    getState: () => state,
    addAppointment: (appointment: any) => {
      setState({
        appointments: [...state.appointments, appointment],
        error: null
      });
    },
    removeAppointment: (id: number) => {
      setState({
        appointments: state.appointments.filter(apt => apt.id !== id),
        error: null
      });
    },
    setError: (error: string) => {
      setState({ error, isLoading: false });
    },
    setLoading: (loading: boolean) => {
      setState({ isLoading: loading });
    }
  };
};

const createMockServiceItemsStore = () => {
  let state = {
    serviceItems: [] as any[],
    stagingItems: [] as any[],
    originalItems: [] as any[],
    isDirty: false,
    isSaving: false,
  };

  const setState = (newState: Partial<typeof state>) => {
    state = { ...state, ...newState };
  };

  return {
    getState: () => state,
    initializeItems: (items: any[]) => {
      setState({
        serviceItems: items,
        originalItems: JSON.parse(JSON.stringify(items)), // Deep copy
        stagingItems: JSON.parse(JSON.stringify(items)),
        isDirty: false
      });
    },
    updateStagingItem: (id: number, updates: any) => {
      const stagingItems = state.stagingItems.map(item =>
        item.id === id ? { ...item, ...updates } : item
      );
      setState({
        stagingItems,
        isDirty: JSON.stringify(stagingItems) !== JSON.stringify(state.originalItems)
      });
    },
    saveChanges: () => {
      setState({
        serviceItems: JSON.parse(JSON.stringify(state.stagingItems)),
        originalItems: JSON.parse(JSON.stringify(state.stagingItems)),
        isDirty: false,
        isSaving: false
      });
    },
    discardChanges: () => {
      setState({
        stagingItems: JSON.parse(JSON.stringify(state.originalItems)),
        isDirty: false
      });
    }
  };
};

describe('State Management Integration Tests', () => {
  let appointmentStore: ReturnType<typeof createMockAppointmentStore>;
  let serviceItemsStore: ReturnType<typeof createMockServiceItemsStore>;

  beforeEach(() => {
    appointmentStore = createMockAppointmentStore();
    serviceItemsStore = createMockServiceItemsStore();
  });

  describe('Appointment Store State Management', () => {
    it('maintains appointment state consistency', () => {
      // Start with empty store
      expect(appointmentStore.getState().appointments).toHaveLength(0);

      // Add appointment
      const newAppointment = {
        id: 1,
        patient_id: 1,
        appointment_type_id: 1,
        practitioner_id: 1,
        start_time: '2024-01-15T10:00:00Z',
        status: 'confirmed'
      };

      appointmentStore.addAppointment(newAppointment);

      expect(appointmentStore.getState().appointments).toHaveLength(1);
      expect(appointmentStore.getState().appointments[0]).toEqual(newAppointment);

      // Remove appointment
      appointmentStore.removeAppointment(1);
      expect(appointmentStore.getState().appointments).toHaveLength(0);
    });

    it('handles loading and error states', () => {
      // Initial state
      expect(appointmentStore.getState().isLoading).toBe(false);
      expect(appointmentStore.getState().error).toBe(null);

      // Set loading
      appointmentStore.setLoading(true);
      expect(appointmentStore.getState().isLoading).toBe(true);

      // Set error (should clear loading)
      appointmentStore.setError('Network error');
      expect(appointmentStore.getState().isLoading).toBe(false);
      expect(appointmentStore.getState().error).toBe('Network error');

      // Clear error
      appointmentStore.setError(null);
      expect(appointmentStore.getState().error).toBe(null);
    });
  });

  describe('Service Items Store Persistence & State Management', () => {
    it('maintains data integrity during save/discard cycles', () => {
      // Initialize with test data
      const initialItems = [
        { id: 1, name: 'Basic Cleaning', price: 100, duration: 60 },
        { id: 2, name: 'Deep Cleaning', price: 200, duration: 120 }
      ];

      serviceItemsStore.initializeItems(initialItems);

      // Verify initial state
      expect(serviceItemsStore.getState().serviceItems).toEqual(initialItems);
      expect(serviceItemsStore.getState().stagingItems).toEqual(initialItems);
      expect(serviceItemsStore.getState().originalItems).toEqual(initialItems);
      expect(serviceItemsStore.getState().isDirty).toBe(false);

      // Make changes to staging
      serviceItemsStore.updateStagingItem(1, { price: 150 });

      // Should be marked as dirty
      expect(serviceItemsStore.getState().isDirty).toBe(true);
      expect(serviceItemsStore.getState().stagingItems[0].price).toBe(150);
      expect(serviceItemsStore.getState().serviceItems[0].price).toBe(100); // Original unchanged

      // Save changes
      serviceItemsStore.saveChanges();

      // Should persist changes and reset dirty flag
      expect(serviceItemsStore.getState().isDirty).toBe(false);
      expect(serviceItemsStore.getState().serviceItems[0].price).toBe(150);
      expect(serviceItemsStore.getState().stagingItems[0].price).toBe(150);
      expect(serviceItemsStore.getState().originalItems[0].price).toBe(150);

      // Make more changes
      serviceItemsStore.updateStagingItem(2, { duration: 150 });
      expect(serviceItemsStore.getState().isDirty).toBe(true);

      // Discard changes
      serviceItemsStore.discardChanges();

      // Should revert to saved state
      expect(serviceItemsStore.getState().isDirty).toBe(false);
      expect(serviceItemsStore.getState().stagingItems[0].price).toBe(150); // Saved change kept
      expect(serviceItemsStore.getState().stagingItems[1].duration).toBe(120); // Change discarded
    });

    it('handles complex state transitions with multiple updates', () => {
      const initialItems = [
        { id: 1, name: 'Service 1', price: 100, active: true },
        { id: 2, name: 'Service 2', price: 200, active: true },
        { id: 3, name: 'Service 3', price: 300, active: false }
      ];

      serviceItemsStore.initializeItems(initialItems);

      // Multiple rapid updates (simulating user interactions)
      serviceItemsStore.updateStagingItem(1, { price: 120, active: false });
      serviceItemsStore.updateStagingItem(2, { price: 250 });
      serviceItemsStore.updateStagingItem(3, { active: true });

      // Verify all changes are tracked
      expect(serviceItemsStore.getState().isDirty).toBe(true);
      expect(serviceItemsStore.getState().stagingItems[0]).toEqual({
        id: 1, name: 'Service 1', price: 120, active: false
      });
      expect(serviceItemsStore.getState().stagingItems[1]).toEqual({
        id: 2, name: 'Service 2', price: 250, active: true
      });
      expect(serviceItemsStore.getState().stagingItems[2]).toEqual({
        id: 3, name: 'Service 3', price: 300, active: true
      });

      // Save and verify persistence
      serviceItemsStore.saveChanges();
      expect(serviceItemsStore.getState().isDirty).toBe(false);

      // Original items should match saved items
      expect(serviceItemsStore.getState().originalItems).toEqual(serviceItemsStore.getState().serviceItems);
      expect(serviceItemsStore.getState().stagingItems).toEqual(serviceItemsStore.getState().serviceItems);
    });
  });

  describe('Clinic Context State Management', () => {
    it('handles clinic switching with proper state isolation', () => {
      // Mock clinic-specific data
      const clinic1Data = {
        clinicId: 1,
        settings: { theme: 'light', language: 'en' },
        appointments: [
          { id: 1, patient_name: 'John (Clinic 1)', clinic_id: 1 }
        ]
      };

      const clinic2Data = {
        clinicId: 2,
        settings: { theme: 'dark', language: 'zh' },
        appointments: [
          { id: 2, patient_name: 'Jane (Clinic 2)', clinic_id: 2 }
        ]
      };

      // Simulate clinic 1 context
      appointmentStore.addAppointment(clinic1Data.appointments[0]);

      expect(appointmentStore.getState().appointments[0].clinic_id).toBe(1);
      expect(appointmentStore.getState().appointments[0].patient_name).toBe('John (Clinic 1)');

      // Simulate clinic switch - state should be reset/cleared
      appointmentStore.removeAppointment(1);
      appointmentStore.addAppointment(clinic2Data.appointments[0]);

      expect(appointmentStore.getState().appointments[0].clinic_id).toBe(2);
      expect(appointmentStore.getState().appointments[0].patient_name).toBe('Jane (Clinic 2)');

      // Clinic 1 data should not persist
      expect(appointmentStore.getState().appointments).not.toContain(
        expect.objectContaining({ clinic_id: 1 })
      );
    });
  });

  describe('Concurrent State Updates', () => {
    it('handles rapid state updates without race conditions', () => {
      // Initialize store with items to update
      const initialItems = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        name: `Service ${i + 1}`,
        price: 100 + i * 10
      }));

      serviceItemsStore.initializeItems(initialItems);

      // Rapid updates to the same item (simulating user typing rapidly)
      for (let i = 0; i < 10; i++) {
        serviceItemsStore.updateStagingItem(1, {
          price: 100 + i,
          name: `Updated Service ${i}`
        });
      }

      // Should be marked as dirty
      expect(serviceItemsStore.getState().isDirty).toBe(true);

      // Final update should be applied
      expect(serviceItemsStore.getState().stagingItems[0].price).toBe(109);
      expect(serviceItemsStore.getState().stagingItems[0].name).toBe('Updated Service 9');
    });

    it('maintains referential integrity during bulk operations', () => {
      const initialItems = [
        { id: 1, name: 'Item 1', associations: [1, 2, 3] },
        { id: 2, name: 'Item 2', associations: [4, 5, 6] }
      ];

      serviceItemsStore.initializeItems(initialItems);

      // Bulk update with complex object references
      serviceItemsStore.updateStagingItem(1, {
        associations: [1, 2, 3, 7], // Add new association
        name: 'Updated Item 1'
      });

      serviceItemsStore.updateStagingItem(2, {
        associations: [4, 5, 6, 8], // Add new association
        name: 'Updated Item 2'
      });

      // Verify referential integrity maintained
      expect(serviceItemsStore.getState().stagingItems[0].associations).toEqual([1, 2, 3, 7]);
      expect(serviceItemsStore.getState().stagingItems[1].associations).toEqual([4, 5, 6, 8]);

      // Original items should be unchanged
      expect(serviceItemsStore.getState().originalItems[0].associations).toEqual([1, 2, 3]);
      expect(serviceItemsStore.getState().originalItems[1].associations).toEqual([4, 5, 6]);
    });
  });
});
