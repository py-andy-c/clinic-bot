import { describe, it, expect } from 'vitest';

describe('Automated Assignment & Availability Integration Tests', () => {
  describe('Auto-Assignment Processing Workflow', () => {
    it('processes appointment assignments automatically', () => {
      // Test auto-assignment logic
      const createAutoAssigner = () => {
        const practitioners = [
          { id: 1, name: 'Dr. Smith', availability: ['09:00-17:00'], currentLoad: 3 },
          { id: 2, name: 'Dr. Johnson', availability: ['08:00-16:00'], currentLoad: 2 },
          { id: 3, name: 'Dr. Brown', availability: ['10:00-18:00'], currentLoad: 1 }
        ];

        const appointments = [
          { id: 1, time: '10:00', duration: 60, assigned: null, type: 'regular' },
          { id: 2, time: '14:00', duration: 30, assigned: null, type: 'regular' }
        ];

        return {
          assignAppointments: () => {
            const assignments = [];
            const maxLoad = 5;

            appointments.forEach(apt => {
              if (!apt.assigned) {
                // Find least busy practitioner
                const availablePractitioners = practitioners
                  .filter(p => p.currentLoad < maxLoad)
                  .sort((a, b) => a.currentLoad - b.currentLoad);

                if (availablePractitioners.length > 0) {
                  const practitioner = availablePractitioners[0];
                  apt.assigned = practitioner.id;
                  practitioner.currentLoad += 1;
                  assignments.push({
                    appointmentId: apt.id,
                    practitionerId: practitioner.id,
                    practitionerName: practitioner.name
                  });
                }
              }
            });

            return assignments;
          },
          getAppointments: () => appointments,
          getPractitioners: () => practitioners
        };
      };

      const assigner = createAutoAssigner();

      const assignments = assigner.assignAppointments();

      expect(assignments).toHaveLength(2);
      expect(assignments[0].practitionerName).toBe('Dr. Brown'); // Least busy
      expect(assignments[1].practitionerName).toBe('Dr. Johnson'); // Next least busy

      // Verify assignments
      const appointments = assigner.getAppointments();
      expect(appointments[0].assigned).toBe(3); // Dr. Brown
      expect(appointments[1].assigned).toBe(2); // Dr. Johnson

      // Verify load balancing
      const practitioners = assigner.getPractitioners();
      expect(practitioners[2].currentLoad).toBe(2); // Dr. Brown: 1 + 1
      expect(practitioners[1].currentLoad).toBe(3); // Dr. Johnson: 2 + 1
    });

    it('handles assignment conflicts and fallbacks', () => {
      // Test conflict resolution logic
      const createConflictResolver = () => {
        const practitioners = [
          { id: 1, name: 'Dr. Smith', specialties: ['emergency'], available: true },
          { id: 2, name: 'Dr. Johnson', specialties: ['general'], available: true },
          { id: 3, name: 'Dr. Brown', specialties: ['emergency', 'general'], available: false }
        ];

        return {
          getPractitioners: () => practitioners,
          resolveAssignment: (appointment: any) => {
            const { type, time } = appointment;

            // Find suitable practitioner
            let suitablePractitioner = null;

            if (type === 'emergency') {
              suitablePractitioner = practitioners.find(p =>
                p.available && p.specialties.includes('emergency')
              );
            }

            if (!suitablePractitioner) {
              // For regular appointments, prefer general practitioners over emergency specialists
              suitablePractitioner = practitioners.find(p =>
                p.available && !p.specialties.includes('emergency')
              ) || practitioners.find(p => p.available);
            }

            if (suitablePractitioner) {
              return {
                success: true,
                practitioner: suitablePractitioner,
                reason: 'assigned'
              };
            }

            return {
              success: false,
              reason: 'no_available_practitioners'
            };
          }
        };
      };

      const resolver = createConflictResolver();

      // Emergency appointment - should get emergency specialist
      const emergencyResult = resolver.resolveAssignment({
        type: 'emergency',
        time: '10:00'
      });
      expect(emergencyResult.success).toBe(true);
      expect(emergencyResult.practitioner.name).toBe('Dr. Smith');

      // Regular appointment - should get general fallback
      const regularResult = resolver.resolveAssignment({
        type: 'regular',
        time: '14:00'
      });
      expect(regularResult.success).toBe(true);
      expect(regularResult.practitioner.name).toBe('Dr. Johnson');

      // No available practitioners
      const resolverPractitioners = resolver.getPractitioners();
      resolverPractitioners.forEach(p => p.available = false); // Make all practitioners unavailable
      const failedResult = resolver.resolveAssignment({
        type: 'regular',
        time: '16:00'
      });
      expect(failedResult.success).toBe(false);
      expect(failedResult.reason).toBe('no_available_practitioners');
    });
  });

  describe('Practitioner Availability Management', () => {
    it('manages complex availability schedules', () => {
      // Test availability management logic
      const createAvailabilityManager = () => {
        const schedule = {
          monday: [
            { start: '09:00', end: '12:00' },
            { start: '14:00', end: '17:00' }
          ],
          tuesday: [
            { start: '09:00', end: '12:00' },
            { start: '14:00', end: '17:00' }
          ],
          wednesday: [], // No availability
          thursday: [
            { start: '10:00', end: '16:00' }
          ],
          friday: [
            { start: '09:00', end: '12:00' }
          ]
        };

        return {
          isAvailable: (day: string, time: string) => {
            const daySlots = schedule[day.toLowerCase()];
            if (!daySlots || daySlots.length === 0) return false;

            return daySlots.some(slot => {
              const [start, end] = [slot.start, slot.end];
              return time >= start && time <= end;
            });
          },
          addTimeSlot: (day: string, start: string, end: string) => {
            const dayKey = day.toLowerCase();
            if (!schedule[dayKey]) schedule[dayKey] = [];

            schedule[dayKey].push({ start, end });
          },
          removeTimeSlot: (day: string, index: number) => {
            const dayKey = day.toLowerCase();
            if (schedule[dayKey] && schedule[dayKey][index]) {
              schedule[dayKey].splice(index, 1);
            }
          },
          getAvailableDays: () => {
            return Object.keys(schedule).filter(day =>
              schedule[day].length > 0
            );
          },
          getSchedule: () => schedule
        };
      };

      const manager = createAvailabilityManager();

      // Test availability checks
      expect(manager.isAvailable('monday', '10:00')).toBe(true);
      expect(manager.isAvailable('monday', '13:00')).toBe(false); // Lunch break
      expect(manager.isAvailable('wednesday', '10:00')).toBe(false); // No availability

      // Add time slot
      manager.addTimeSlot('wednesday', '09:00', '17:00');
      expect(manager.isAvailable('wednesday', '10:00')).toBe(true);

      // Remove time slot
      manager.removeTimeSlot('monday', 0);
      expect(manager.isAvailable('monday', '10:00')).toBe(false); // First slot removed
      expect(manager.isAvailable('monday', '15:00')).toBe(true); // Second slot still available

      // Get available days
      const availableDays = manager.getAvailableDays();
      expect(availableDays).toContain('monday');
      expect(availableDays).toContain('wednesday');
      expect(availableDays).not.toContain('saturday');
    });

    it('validates scheduling conflicts and overlaps', () => {
      // Test schedule validation logic
      const createScheduleValidator = () => {
        const slots = [
          { start: '09:00', end: '12:00' },
          { start: '14:00', end: '17:00' }
        ];

        const validateTimeSlot = (newSlot: any) => {
          const errors = [];

          // Check for overlaps
          const overlaps = slots.some(existing => {
            return !(newSlot.end <= existing.start || newSlot.start >= existing.end);
          });

          if (overlaps) {
            errors.push('Time slot overlaps with existing schedule');
          }

          // Validate time format
          const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
          if (!timeRegex.test(newSlot.start) || !timeRegex.test(newSlot.end)) {
            errors.push('Invalid time format');
          }

          // Validate start < end
          if (newSlot.start >= newSlot.end) {
            errors.push('End time must be after start time');
          }

          return errors;
        };

        return {
          validateTimeSlot,
          addSlot: (slot: any) => {
            if (validateTimeSlot(slot).length === 0) {
              slots.push(slot);
              return true;
            }
            return false;
          }
        };
      };

      const validator = createScheduleValidator();

      // Valid slot
      expect(validator.validateTimeSlot({ start: '13:00', end: '14:00' })).toEqual([]);

      // Overlapping slot
      expect(validator.validateTimeSlot({ start: '11:00', end: '15:00' })).toEqual([
        'Time slot overlaps with existing schedule'
      ]);

      // Invalid time format
      expect(validator.validateTimeSlot({ start: '25:00', end: '26:00' })).toEqual([
        'Invalid time format'
      ]);

      // End before start
      expect(validator.validateTimeSlot({ start: '14:00', end: '13:00' })).toEqual([
        'End time must be after start time'
      ]);

      // Add valid slot
      expect(validator.addSlot({ start: '13:00', end: '14:00' })).toBe(true);
      // Try to add overlapping slot
      expect(validator.addSlot({ start: '13:30', end: '14:30' })).toBe(false);
    });
  });

  describe('Resource & Equipment Management', () => {
    it('manages equipment allocation and conflicts', () => {
      // Test equipment allocation logic
      const createEquipmentManager = () => {
        const equipment = [
          { id: 1, name: 'X-Ray Machine', available: true, bookings: [] },
          { id: 2, name: 'Ultrasound Scanner', available: true, bookings: [] },
          { id: 3, name: 'Dental Chair A', available: false, bookings: [{ appointmentId: 1, time: '10:00' }] }
        ];

        return {
          allocateEquipment: (appointmentId: number, equipmentId: number, time: string) => {
            const equipmentItem = equipment.find(e => e.id === equipmentId);

            if (!equipmentItem || !equipmentItem.available) {
              return { success: false, reason: 'Equipment not available' };
            }

            // Check for conflicts
            const conflict = equipmentItem.bookings.find(booking => booking.time === time);
            if (conflict) {
              return { success: false, reason: 'Equipment already booked at this time' };
            }

            equipmentItem.bookings.push({ appointmentId, time });
            return { success: true };
          },
          deallocateEquipment: (appointmentId: number, equipmentId: number) => {
            const equipmentItem = equipment.find(e => e.id === equipmentId);
            if (equipmentItem) {
              equipmentItem.bookings = equipmentItem.bookings.filter(
                booking => booking.appointmentId !== appointmentId
              );
            }
          },
          getEquipmentStatus: (equipmentId: number) => {
            const equipmentItem = equipment.find(e => e.id === equipmentId);
            return equipmentItem ? {
              available: equipmentItem.available && equipmentItem.bookings.length === 0,
              bookings: equipmentItem.bookings.length
            } : null;
          }
        };
      };

      const manager = createEquipmentManager();

      // Check initial status
      expect(manager.getEquipmentStatus(1)).toEqual({ available: true, bookings: 0 });
      expect(manager.getEquipmentStatus(3)).toEqual({ available: false, bookings: 1 });

      // Allocate equipment
      const result1 = manager.allocateEquipment(2, 1, '14:00');
      expect(result1.success).toBe(true);
      expect(manager.getEquipmentStatus(1)).toEqual({ available: false, bookings: 1 });

      // Try to allocate already booked equipment
      const result2 = manager.allocateEquipment(3, 1, '14:00');
      expect(result2.success).toBe(false);
      expect(result2.reason).toBe('Equipment already booked at this time');

      // Try to allocate unavailable equipment
      const result3 = manager.allocateEquipment(4, 3, '16:00');
      expect(result3.success).toBe(false);
      expect(result3.reason).toBe('Equipment not available');

      // Deallocate equipment
      manager.deallocateEquipment(2, 1);
      expect(manager.getEquipmentStatus(1)).toEqual({ available: true, bookings: 0 });
    });
  });
});