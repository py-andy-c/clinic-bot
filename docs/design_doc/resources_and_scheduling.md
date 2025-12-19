# Resources & Scheduling - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for resource management, resource constraints, availability checking, and scheduling in the clinic system. It covers resource types, resource requirements, automatic allocation, conflict detection, and override availability scheduling.

---

## Key Business Logic

### 1. Resource Types and Resources

**Resource Types**: Categories of resources (e.g., "治療室" - Treatment Room, "設備" - Equipment)
- Clinic-specific
- Each resource type has a name (unique within clinic)

**Resources**: Individual instances of a resource type (e.g., "治療室1", "治療室2")
- Belong to a resource type
- Have a name (required, unique within type) and description (optional)
- Auto-generated names with sequential numbering (e.g., "治療室1", "治療室2")
- Support soft delete (`is_deleted` flag)

**Rationale**: Allows clinics to manage facility resources (rooms, equipment) separately from practitioner availability.

### 2. Resource Requirements

**Location**: Defined at the service item (appointment type) level only.

**Structure**: Each service item specifies which resource types it needs and the quantity required.

**Example**: "物理治療" appointment type requires 1 "治療室" resource.

**Rationale**: Resource requirements are service-specific, not practitioner-specific. This is the single source of truth for resource requirements.

### 3. Resource Allocation

**Automatic Allocation**: When an appointment is created, system allocates required resources automatically.

**Allocation Strategy**: 
- Simple: First available resource ordered by name (deterministic)
- Future: Can extend to round-robin, least-recently-used, or resource preferences

**Multiple Resources**: One appointment can use multiple resources (of same or different types).

**Storage**: Allocation is stored as appointment-resource relationships (`appointment_resource_allocations` table).

**Rationale**: Ensures appointments have required resources without manual intervention, while maintaining flexibility for manual override.

### 4. Slot Calculation with Resource Constraints

**Available Slot Calculation**: Slot is only available if both practitioner AND resources are available.

**Priority Order**:
1. Check if practitioner is available (existing logic)
2. Check if required resources are available
3. Slot is only available if both conditions are met

**Resource Availability Check**:
- For a given time slot (start_time, end_time):
  - Query all appointments that overlap with this time slot
  - **Exclude cancelled appointments** (only count confirmed appointments)
  - **Exclude current appointment** when editing (use `exclude_calendar_event_id` parameter)
  - For each overlapping appointment, get its allocated resources
  - Count how many resources of each type are allocated
  - **Exclude soft-deleted resources** from total count (only count active resources)
  - Available quantity = Total active resources of type - Allocated resources of type

**Rationale**: Prevents double-booking of resources while maintaining flexibility for clinic users to override constraints.

### 5. Conflict Detection Priority

All conflicts are detected and returned to the frontend. Priority determines the order of display:

1. **Past Appointment** (Highest Priority)
2. **Appointment Conflict**
3. **Availability Exception Conflict**
4. **Outside Default Availability**
5. **Resource Conflict** (Lowest Priority)

**Multiple Conflicts**: If multiple conflict types exist (e.g., appointment conflict + resource conflict), ALL are displayed to the user.

**Rationale**: Resource conflicts are lowest priority because they can be overridden by clinic users, while appointment conflicts are hard conflicts.

### 6. Override Availability Scheduling

**Purpose**: Allow clinic users (admins and practitioners) to schedule appointments at any time, regardless of practitioner default availability or availability exceptions.

**Override Mode**:
- **Default Mode (Override Toggle OFF)**: Shows only available time slots within practitioner's default availability
- **Override Mode (Toggle ON)**: 
  - All dates become selectable (even if no normal availability)
  - Time selection changes to **free-form time input** (12-hour format: H:MM AM/PM or 24-hour: HH:MM)
  - Allows any time selection regardless of availability, including **past dates/times**
  - Real-time conflict detection and display (warnings, not blockers)

**Permissions**: 
- Clinic admins: ✅ Always available
- Practitioners: ✅ Always available
- Read-only users: ❌ Not available (cannot create appointments anyway)

**Rationale**: Provides flexibility for urgent appointments, special arrangements, or administrative overrides while maintaining transparency (conflicts shown as warnings).

### 7. Resource Selection During Appointment Creation

**Auto-Selection**: System automatically selects suggested resources when available.

**Selection Logic**:
- When appointment time, practitioner, and appointment type are selected:
  1. Get all required resource types and quantities (from appointment type requirements)
  2. For each required resource type:
     - Find available resources at that time slot
     - Auto-select the required quantity of resources (first available)
     - If insufficient resources available, auto-select what's available and show quantity warning
  3. Selection updates in real-time as user selects time (with debouncing, ~300ms)

**Manual Override**: Users can manually change resource selection (select any resource, available or unavailable).

**Rationale**: Reduces manual work while allowing flexibility for special cases.

---

## Edge Cases

### 1. Resource Deletion

**Scenario**: Resource is deleted while allocated to appointments.

**Behavior**: Prevent deletion if resource has active allocations (confirmed appointments only, exclude cancelled). Show list of appointments using it. Require admin to reassign or cancel appointments first.

### 2. Resource Type Deletion

**Scenario**: Resource type is deleted.

**Behavior**: Prevent deletion if any resources of this type have active allocations (confirmed appointments). Show list of affected appointments. Require admin to reassign or cancel appointments first. Do not allow cascade deletion.

### 3. No Resources Available

**Scenario**: Appointment type requires resources but no resources of that type exist.

**Behavior**: Show warning in slot calculation. Allow appointment creation with warning. System attempts to allocate but fails gracefully.

### 4. Multiple Resources of Same Type

**Scenario**: Appointment needs 2 rooms but only 1 available.

**Behavior**: Auto-select the 1 available room, show quantity warning. User can proceed or change time/resources.

### 5. Recurring Appointments

**Scenario**: How to handle resource allocation for recurring appointments.

**Behavior**: Allocate resources for each occurrence independently. Check availability for each occurrence. Show conflicts per occurrence.

### 6. Appointment Type Change

**Scenario**: User changes appointment type and new type requires different resources.

**Behavior**: Existing resource allocations are cleared first (deleted), then new allocations are made based on new appointment type requirements. This ensures clean state and prevents conflicts.

### 7. Time Change

**Scenario**: User changes appointment time and resources are no longer available.

**Behavior**: Try to keep same resources if available. If not, auto-select new available resources. If none available, keep selection but mark unavailable with warning.

### 8. Resource Requirements Change

**Scenario**: Resource requirements are changed for a service item that already has appointments.

**Behavior**: Existing appointments keep their current resource allocations. New appointments use the updated requirements. No automatic re-allocation of existing appointments.

### 9. Appointment Cancellation

**Scenario**: What happens to resource allocations when an appointment is cancelled.

**Behavior**: Resource allocations are released immediately when appointment is cancelled. Resources become available for other appointments. Allocation records are kept for historical tracking but resources are no longer considered allocated.

### 10. Soft-Deleted Resources

**Scenario**: Resource is soft-deleted but still referenced in allocations.

**Behavior**: Soft-deleted resources are excluded from availability checks and allocation. Only active resources are considered. Soft-deleted resources do NOT appear in resource selection UI.

---

## Technical Design

### Resource Selection Component

**UI Structure**: Two-level expansion design for space efficiency.

1. **Top Layer**: Main expand/collapse for entire resource selection section
   - **Collapsed (default)**: Shows compact summary text (e.g., "治療室: 1/1 ✓ (治療室1) | 設備: 0/1 ⚠️")
   - **Expanded**: Shows detailed resource selection interface

2. **Second Layer**: Individual expand/collapse for each resource type section
   - Each resource type can be independently expanded/collapsed
   - Shows grid of available resources when expanded

**Auto-Expansion Logic**:
- Top layer expands when: Unmet requirements, resource conflicts, prepopulated resources, or additional resource types added
- Second layer expands when: Top layer expanded AND section has issues (unmet requirements, conflicts)

**State Preservation**: Additional resource types and expanded sections are preserved when component remounts (e.g., when date/time changes) using refs.

**Rationale**: Provides space-efficient interface that shows summary by default and expands to show details when needed.

### Resource Availability API

**Endpoint**: `GET /clinic/appointments/resource-availability`

**Purpose**: Get resource availability and suggested allocation for a time slot (for frontend auto-selection).

**Response Structure**:
```json
{
  "requirements": [
    {
      "resource_type_id": 1,
      "resource_type_name": "治療室",
      "required_quantity": 2,
      "available_resources": [
        {"id": 1, "name": "治療室1", "is_available": true},
        {"id": 2, "name": "治療室2", "is_available": true},
        {"id": 3, "name": "治療室3", "is_available": false}
      ],
      "available_quantity": 2
    }
  ],
  "suggested_allocation": [
    {"id": 1, "name": "治療室1"},
    {"id": 2, "name": "治療室2"}
  ],
  "conflicts": []
}
```

**Rationale**: Enables frontend to perform auto-selection for UI display, while backend performs final allocation when appointment is created.

### Resource Service

**Core Methods**:
- `check_resource_availability()`: Check if required resources are available for a time slot
- `allocate_resources()`: Automatically allocate required resources for an appointment
- `_find_available_resources()`: Find available resources of a type for a time slot

**Allocation Strategy**: First available resource ordered by name (deterministic). Future: Can extend to round-robin, least-recently-used, or resource preferences.

**Rationale**: Provides centralized resource management logic that can be reused across scheduling, conflict detection, and availability notifications.

### Shared Availability Logic

**Refactor**: Create shared core function that determines slot availability (practitioner + resources).

**Method**: `AvailabilityService.check_slot_availability()`

**Returns**: `SlotAvailabilityResult` with:
- `is_available`: Overall availability (both practitioner and resources available)
- `practitioner_available`: Practitioner availability status
- `resources_available`: Resource availability status
- `resource_conflicts`: List of resource conflicts (if any)

**Used By**: Slot calculation, conflict checking, availability notifications.

**Rationale**: Ensures consistent availability logic across all scheduling paths.

---

## Summary

This document covers:
- Resource types and resources (clinic-specific facility management)
- Resource requirements (defined at service item level)
- Resource allocation (automatic allocation with manual override)
- Slot calculation with resource constraints (practitioner + resources)
- Conflict detection priority (resource conflicts lowest priority)
- Override availability scheduling (clinic users can schedule outside normal hours)
- Resource selection UI (two-level expansion, auto-selection)
- Edge cases (resource deletion, type deletion, no resources, recurring appointments)
- Technical design (resource service, shared availability logic, API endpoints)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.

