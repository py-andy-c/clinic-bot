# Date/Time Format Standardization

## Overview

This document defines the standardized date/time formatting conventions for the clinic admin platform to ensure consistency across all user-facing displays.

## Goals

1. **Consistency**: Use uniform date/time formats across the entire clinic admin platform
2. **Clarity**: Make dates and times easy to read and understand at a glance
3. **Localization**: Support weekday translation for internationalization
4. **Maintainability**: Centralize formatting logic in reusable utility functions

## Standard Format

### Primary Format: Appointment Date/Time

**Format**: `YYYY/M/D(weekday) H:MM AM/PM`

**Example**: `2025/12/8(一) 9:00 AM`

**Characteristics**:
- Full year (`YYYY`) for clarity
- No leading zeros for month/day (`M/D`) for compactness
- Weekday in parentheses without space before it: `(一)`
- 12-hour time format with AM/PM
- Single space between date and time

**Use Cases**:
- Appointment creation/edit forms (collapsed date picker display)
- Appointment confirmation/review displays
- Conflict resolution displays
- Appointment lists and tables
- Event modals

### Time Range Format

**Format**: `YYYY/M/D(weekday) H:MM AM/PM - H:MM AM/PM`

**Example**: `2025/12/8(一) 9:00 AM - 10:00 AM`

**Use Cases**:
- Appointment time ranges in lists
- Event modal displays
- Calendar event details

### Date-Only Format

**Format**: `YYYY/M/D`

**Example**: `2025/12/8`

**Characteristics**:
- No leading zeros for month/day
- No weekday (not needed for date-only displays)
- No time component

**Use Cases**:
- Birthday displays
- Created date displays
- Date input fields
- Any context where only the date is relevant

## Utility Functions

### `formatAppointmentDateTime(dateTime: Date | string): string`

Formats a single date/time value for appointment displays.

**Input**: Date object or ISO string
**Output**: `2025/12/8(一) 9:00 AM`

**Implementation Notes**:
- Uses Taiwan timezone (`Asia/Taipei`)
- Supports weekday translation via i18n
- Falls back to Chinese weekdays if i18n unavailable

### `formatAppointmentTimeRange(start: Date, end: Date): string`

Formats an appointment time range.

**Input**: Start and end Date objects
**Output**: `2025/12/8(一) 9:00 AM - 10:00 AM`

**Implementation Notes**:
- Uses Taiwan timezone
- Assumes start and end are on the same date
- Supports weekday translation

### `formatDateOnly(date: Date | string): string`

Formats a date without time or weekday.

**Input**: Date object or ISO string
**Output**: `2025/12/8`

**Implementation Notes**:
- Uses Taiwan timezone
- No leading zeros for month/day

## Exceptions

### 1. Calendar Grid Events

**Format**: `H:MM AM/PM - H:MM AM/PM` (time-only)

**Example**: `10:30 AM - 11:00 AM`

**Rationale**: The date is already visible in the calendar grid, so showing it again would be redundant.

**Function**: `formatEventTimeRange` (keep existing implementation)

**Location**: `CalendarComponents.tsx` - `CustomEventComponent`

### 2. Calendar Headers

**Formats**:
- Month header: `YYYY年M月` (e.g., `2025年12月`)
- Day header: `M月D日 (weekday)` (e.g., `12月8日 (一)`)
- Week header: `M月D日 (weekday) - M月D日 (weekday)`

**Rationale**: Chinese date format is more natural for calendar UI elements and provides better visual hierarchy.

**Location**: `CalendarView.tsx` - calendar header formats

### 3. Calendar Toolbar

**Format**: `M/D(weekday)` (e.g., `12/8(一)`)

**Rationale**: Compact format needed for toolbar space constraints.

**Location**: `CalendarComponents.tsx` - toolbar date display

### 4. System Timestamps

**Format**: `YYYY/MM/DD HH:mm:ss` (e.g., `2025/12/08 14:30:00`)

**Rationale**: Technical/system information requires precise timestamp format with leading zeros.

**Location**: `SystemClinicsPage.tsx` - health check timestamps

## Internationalization

### Weekday Translation

The weekday component `(一)` should be translated based on the current locale:

- **Traditional Chinese (zh-TW)**: `日`, `一`, `二`, `三`, `四`, `五`, `六`
- **English (en)**: `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`
- **Other locales**: Use i18n translation keys

**Implementation**: Use `i18n.t('datetime.weekdayAbbr', { returnObjects: true })` with fallback to Chinese weekdays.

## Migration Plan

### Phase 1: Create Utility Functions

1. Add new utility functions to `frontend/src/utils/calendarUtils.ts`:
   - `formatAppointmentDateTime`
   - `formatAppointmentTimeRange` (update existing)
   - `formatDateOnly`

### Phase 2: Update Clinic Admin Platform

Update the following files to use new formats:

1. **CreateAppointmentModal.tsx**
   - Confirmation step date display
   - Conflict resolution date display
   - Collapsed date picker display (new feature)

2. **EditAppointmentModal.tsx**
   - Original appointment time display
   - Review step date/time display

3. **AutoAssignedAppointmentsPage.tsx**
   - Appointment list date/time format

4. **PatientAppointmentsList.tsx**
   - Appointment time range format

5. **EventModal.tsx**
   - Appointment time display (uses `formatAppointmentTime` prop)

6. **CalendarView.tsx**
   - Update `formatAppointmentTime` prop passed to EventModal

### Phase 3: Update LIFF Patient-Facing

Update patient-facing displays to use the same format:

1. **AppointmentCard.tsx**
   - Update to use `formatAppointmentDateTime`

2. **Step6Confirmation.tsx** and **Step7Success.tsx**
   - Update to use `formatAppointmentDateTime`

3. **RescheduleFlow.tsx**
   - Update date/time displays

### Phase 4: Update Date-Only Displays

Update birthday and created date displays:

1. **PatientsPage.tsx**
   - Birthday column: use `formatDateOnly`

2. **PatientInfoSection.tsx**
   - Birthday display: use `formatDateOnly`
   - Created date display: use `formatDateOnly`

3. **PatientManagement.tsx** (LIFF)
   - Birthday display: use `formatDateOnly`

## Backward Compatibility

The existing `formatDateTime` function in `calendarUtils.ts` will be kept for backward compatibility but should be deprecated in favor of the new standardized functions.

**Deprecation Strategy**:
- Mark as `@deprecated` with migration guidance
- Keep implementation for existing code
- Gradually migrate all usages to new functions

## Testing Considerations

1. **Format Consistency**: Verify all appointment displays use the new format
2. **Timezone Handling**: Ensure all dates are correctly converted to Taiwan timezone
3. **Weekday Translation**: Test with different locales (zh-TW, en)
4. **Edge Cases**: Test with dates at month/year boundaries, leap years
5. **Date-Only Format**: Verify no time component appears in date-only displays

## Examples

### Before Standardization

```typescript
// Inconsistent formats across the platform:
"2025-12-08 09:00"           // AutoAssignedAppointmentsPage
"12/25 (三) 1:30 PM"         // formatDateTime (LIFF)
"12/25 (三) 9:00 AM - 10:00 AM"  // formatAppointmentTime
"2025/12/08 (一)"            // CreateAppointmentModal (no time)
"YYYY-MM-DD HH:mm"           // Various places
```

### After Standardization

```typescript
// Consistent formats:
"2025/12/8(一) 9:00 AM"                    // Single date/time
"2025/12/8(一) 9:00 AM - 10:00 AM"        // Time range
"2025/12/8"                                // Date only
"10:30 AM - 11:00 AM"                      // Calendar grid (time only)
```

## Related Files

- `frontend/src/utils/calendarUtils.ts` - Utility functions
- `frontend/src/utils/dateFormat.ts` - Date format conversions
- `frontend/src/i18n/locales/zh-TW.ts` - Chinese translations
- `frontend/src/i18n/locales/en.ts` - English translations

## References

- [Moment.js Format Documentation](https://momentjs.com/docs/#/displaying/format/)
- [i18n Weekday Abbreviations](../multi_lang.md)

