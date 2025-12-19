# UI Components - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for shared UI components, state management, and date/time formatting standards used across the clinic admin platform.

---

## Key Business Logic

### 1. DateTimePicker Component

**Purpose**: Date and time selection for appointment creation and editing.

**Initial State and Validation**:
- **Form Load**: Try to populate with original selection time (edit and duplicate only)
- **Initial Validation**:
  - If `selectedTime` is empty → Auto-expand immediately (new appointment flow)
  - If `selectedTime` is populated → Wait for slots to load, then validate:
    - Show loading state while slots are loading
    - After slots load, check if `selectedTime` exists in `allTimeSlots`
    - **If valid**: Keep picker collapsed, keep time selected
    - **If invalid**: Expand picker, deselect time, set override mode to `false`

**Auto-Expand Behavior**:
- **Initial Load**: If `selectedTime` is empty or invalid → Auto-expand
- **After Initial Validation**: Only trigger when `overrideMode` is OFF
  - Practitioner changes → time becomes invalid → auto-expand and deselect
  - Appointment type changes → time becomes invalid → auto-expand and deselect
  - Date changes → time becomes invalid → auto-expand and deselect
- **When NOT to Auto-Expand**: If `overrideMode` is ON or user manually collapsed

**Override Mode**:
- **State Ownership**: DateTimePicker manages override mode internally (parent components don't control it)
- **On Form Load**: Always start with `overrideMode = false` (never enabled on initial load)
- **After Form Load**: User can toggle override mode on/off
- **Reset Conditions**: Override mode resets to OFF when slot candidates change (practitioner, appointment type, or date changes)

**Conflict Detection**:
- **Initial Validation**: NO conflict checks (only slot existence check)
- **Always Active**: Conflict detection runs whenever date/time/practitioner/appointment type changes
  - Checks immediately when practitioner/appointment type changes (no debounce)
  - Debounced (300ms) when date/time changes to avoid excessive API calls
  - Shows conflicts even when picker is collapsed

**Rationale**: Provides intuitive date/time selection with automatic validation and conflict detection, while allowing clinic users to override constraints when needed.

### 2. Date/Time Format Standardization

**Primary Format**: `YYYY/M/D(weekday) H:MM AM/PM`

**Example**: `2025/12/8(一) 9:00 AM`

**Characteristics**:
- Full year (`YYYY`) for clarity
- No leading zeros for month/day (`M/D`) for compactness
- Weekday in parentheses without space: `(一)`
- 12-hour time format with AM/PM
- Single space between date and time

**Time Range Format**: `YYYY/M/D(weekday) H:MM AM/PM - H:MM AM/PM`

**Date-Only Format**: `YYYY/M/D` (no leading zeros, no weekday, no time)

**Exceptions**:
- Calendar grid events: Time-only format (date already visible in grid)
- Calendar headers: Chinese date format (`YYYY年M月`, `M月D日 (weekday)`)
- Calendar toolbar: Compact format (`M/D(weekday)`)
- System timestamps: Technical format with leading zeros (`YYYY/MM/DD HH:mm:ss`)

**Rationale**: Ensures consistency across the platform while maintaining readability and appropriate formatting for different contexts.

### 3. Settings Form State Management

**Purpose**: Manage complex form state for clinic settings with multiple sections and nested data.

**Key Features**:
- Centralized state management
- Validation before save
- Optimistic updates with rollback on error
- Section-level save (save individual sections independently)

**Rationale**: Provides efficient settings management with clear feedback and error handling.

---

## Edge Cases

### 1. DateTimePicker Initial Validation Failure

**Scenario**: Slots fail to load (API error, practitioner doesn't offer appointment type).

**Behavior**: 
- If `selectedTime` exists → Expand picker, deselect time, override mode OFF
- This ensures user can still select a time even if initial validation fails

### 2. Override Mode with Valid Time

**Scenario**: User enables override mode with valid time selected.

**Behavior**: Immediately check conflicts for that time (no need to wait for user to change time).

### 3. Date Format Edge Cases

**Scenario**: Dates at month/year boundaries, leap years, timezone transitions.

**Behavior**: All dates converted to Taiwan timezone before formatting. Utility functions handle edge cases correctly.

### 4. Settings Form Concurrent Edits

**Scenario**: Multiple users edit settings simultaneously.

**Behavior**: Last write wins. Consider showing warning if settings were recently modified.

---

## Technical Design

### DateTimePicker Component

**Location**: `frontend/src/components/calendar/DateTimePicker.tsx`

**Props**:
- `selectedDate`, `selectedTime`: Current selection
- `selectedPractitionerId`, `appointmentTypeId`: Required for slot calculation
- `onDateSelect`, `onTimeSelect`: Callbacks for selection changes
- `allowOverride`: Whether override mode is available (default: false)
- `onOverrideChange`: Callback when override mode changes
- `initialExpanded`: Whether to start expanded (for duplication mode)

**State Management**:
- Internal state for override mode (not controlled by parent)
- Cached availability data for performance
- Debounced conflict checking (300ms)

**Rationale**: Provides flexible date/time selection with performance optimizations and conflict detection.

### Date/Time Formatting Utilities

**Location**: `frontend/src/utils/calendarUtils.ts`

**Functions**:
- `formatAppointmentDateTime(dateTime: Date | string): string`: Formats single date/time
- `formatAppointmentTimeRange(start: Date, end: Date): string`: Formats time range
- `formatDateOnly(date: Date | string): string`: Formats date without time

**Implementation**:
- Uses Taiwan timezone (`Asia/Taipei`)
- Supports weekday translation via i18n
- Falls back to Chinese weekdays if i18n unavailable

**Rationale**: Centralizes formatting logic for consistency and maintainability.

### Settings Form State Management

**Location**: `frontend/src/components/settings/` (various settings components)

**Pattern**: 
- Local state for form values
- React Query for data fetching and mutations
- Optimistic updates with rollback on error
- Section-level validation and save

**Rationale**: Provides efficient settings management with clear feedback and error handling.

---

## Summary

This document covers:
- DateTimePicker component (initial validation, auto-expand, override mode, conflict detection)
- Date/time format standardization (primary format, time range, date-only, exceptions)
- Settings form state management (centralized state, validation, optimistic updates)
- Edge cases (validation failures, override mode, date edge cases, concurrent edits)
- Technical design (component props, utility functions, state management patterns)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.

