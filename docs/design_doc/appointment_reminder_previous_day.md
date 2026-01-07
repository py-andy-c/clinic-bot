# Appointment Reminder - Previous Day Setting - Business Logic & Technical Design

## Overview

This feature extends the existing appointment reminder system to allow clinics to set reminders to be sent at a specific time on the previous day (e.g., "9:00 PM the day before"), in addition to the current "X hours before" setting. This provides clinics with more flexibility in when patients receive appointment reminders.

---

## Key Business Logic

### 1. Reminder Timing Options

**Two Reminder Timing Modes**:
- **Hours Before**: Send reminder X hours before appointment (existing behavior)
- **Previous Day**: Send reminder at specific time Y on the day before appointment

**Mutually Exclusive Settings**: Clinic can choose only one timing mode at a time. If "previous day" is selected, "hours before" setting is ignored.

**Default Behavior**: New clinics default to "hours before" mode (24 hours) for backward compatibility.

**Rationale**: Provides clinics with flexible reminder timing while maintaining simplicity in the UI and business logic.

### 2. Previous Day Timing Calculation

**Timing Logic**:
- Appointment date = D, Appointment time = T
- Reminder sent on date D-1 (previous day)
- Reminder sent at time Y (clinic-configured time)
- Timezone: All times in Taiwan timezone

**Edge Cases**:
- If appointment is on current day, reminder cannot be sent (skip scheduling)
- If calculated reminder time is in past when scheduling, skip reminder
- If clinic changes setting after reminders are scheduled, existing reminders are unaffected

**Rationale**: Previous day timing is intuitive for clinics and patients, similar to calendar reminders.

### 3. Setting Validation

**Time Format**: 24-hour format (00:00 to 23:59)
**Business Hours Consideration**: No restrictions on time (clinic can choose any time)
**Default Time**: 21:00 (9:00 PM) - common reminder time

**Rationale**: 24-hour format avoids AM/PM confusion, 9 PM is a reasonable default for evening reminders.

### 4. Backward Compatibility

**Existing Clinics**: Continue using "hours before" mode unchanged
**Migration**: No data migration needed - new setting defaults to null/disabled
**API Contracts**: Extend existing settings API without breaking changes

**Rationale**: Zero-impact rollout maintains existing clinic configurations.

---

## Backend Technical Design

### API Endpoints

#### `GET /clinic/settings`
- **Response**: Extended `NotificationSettings` model includes new fields
- **No changes** to existing endpoint structure

#### `PUT /clinic/settings`
- **Request Body**: Extended `NotificationSettings` model with new fields
- **Validation**: New fields validated only when provided
- **No breaking changes** to existing functionality

### Database Schema

**NotificationSettings Model** (extends existing):
```python
from pydantic import BaseModel, Field, field_validator
import re
from typing import Optional

class NotificationSettings(BaseModel):
    """Notification settings for clinic."""
    reminder_hours_before: int = Field(default=24, ge=1, le=168)
    reminder_timing_mode: str = Field(default="hours_before", description="Reminder timing mode: 'hours_before' or 'previous_day'")
    reminder_previous_day_time: Optional[str] = Field(default="21:00", description="Time to send reminder on previous day (24-hour format HH:MM)")

    @field_validator('reminder_previous_day_time')
    @classmethod
    def validate_time_format(cls, v):
        if v is not None:
            if not re.match(r'^([01]?[0-9]|2[0-3]):[0-5][0-9]$', v):
                raise ValueError('Time must be in 24-hour format HH:MM')
        return v
```

**Database Storage**: JSONB in `clinics.settings.notification_settings`
- `reminder_timing_mode`: "hours_before" (default) | "previous_day"
- `reminder_previous_day_time`: "HH:MM" format (24-hour), defaults to "21:00"

**Migration**: No database schema changes required (JSONB extension)

### Business Logic Implementation

**NotificationSettings Model Updates**:
- Extend `backend/src/models/clinic.py` NotificationSettings class
- Add `reminder_timing_mode: str = "hours_before"`
- Add `reminder_previous_day_time: Optional[str] = "21:00"`
- Add time format validation for `reminder_previous_day_time`

**API Settings Updates**:
- Extend `backend/src/api/clinic/settings.py` NotificationSettings class
- Add same fields with validation
- Ensure backward compatibility with existing settings

**ReminderSchedulingService Extension** (`backend/src/services/reminder_scheduling_service.py`):
- Add `calculate_previous_day_send_time(appointment: Appointment, clinic: Clinic) -> datetime` method
- Modify `schedule_reminder(db: Session, appointment: Appointment) -> None` to check timing mode
- Add validation to skip reminders for same-day appointments when using previous_day mode

**Key Logic Examples**:
```python
def calculate_previous_day_send_time(appointment: Appointment, clinic: Clinic) -> datetime:
    """Calculate reminder send time for previous day mode."""
    # Combine appointment date and time
    appointment_dt = datetime.combine(appointment.date, appointment.start_time)
    appointment_dt = ensure_taiwan(appointment_dt)

    # Parse configured time (e.g., "21:00" -> hour=21, minute=0)
    hour, minute = map(int, clinic.reminder_previous_day_time.split(':'))
    configured_time = appointment_dt.replace(hour=hour, minute=minute)

    # Send on previous day at configured time
    return configured_time - timedelta(days=1)

def schedule_reminder(db: Session, appointment: Appointment) -> None:
    # ... existing validation logic ...

    # Get clinic reminder configuration
    clinic = appointment.patient.clinic
    reminder_hours_before = clinic.reminder_hours_before

    if clinic.reminder_timing_mode == "previous_day":
        # Previous day mode: calculate send time
        reminder_send_time = calculate_previous_day_send_time(appointment, clinic)

        # Skip if appointment is today (can't send reminder yesterday)
        current_time = taiwan_now()
        if reminder_send_time.date() >= current_time.date():
            logger.debug(f"Skipping previous day reminder for same-day appointment {appointment.id}")
            return
    else:
        # Hours before mode: existing logic
        appointment_dt = datetime.combine(appointment.date, appointment.start_time)
        appointment_dt = ensure_taiwan(appointment_dt)
        reminder_send_time = appointment_dt - timedelta(hours=reminder_hours_before)

    # ... rest of existing scheduling logic ...
```

**Rescheduling**: When appointment time changes, existing reminders are canceled and new ones scheduled with current timing mode.

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: `/clinic/settings` endpoint (existing)
- [x] **React Query Hooks**: Extend existing `useClinicSettingsQuery`
- [x] **Query Keys**: `['clinic-settings', clinicId]` (existing)
- [x] **Cache Strategy**:
  - `staleTime`: 5 minutes
  - `cacheTime`: 10 minutes
  - Invalidation triggers: Settings save, clinic switch

#### Client State (UI State)
- [x] **SettingsContext**: Extend existing context with new reminder fields
- [x] **Local Component State**: Form state for timing mode selection

#### Form State
- [x] **React Hook Form**: Extend `frontend/src/schemas/api.ts` notification_settings schema
- [x] **Form Fields**:
  - `notification_settings.reminder_timing_mode`: Radio buttons ("hours_before", "previous_day")
  - `notification_settings.reminder_previous_day_time`: Time input (conditionally shown)
  - `notification_settings.reminder_hours_before`: Number input (conditionally shown)
- [x] **Validation Rules**:
  - `reminder_timing_mode`: Required, must be "hours_before" or "previous_day"
  - `reminder_previous_day_time`: Required when mode is "previous_day", 24-hour format HH:MM, hours 00-23, minutes 00-59
  - `reminder_hours_before`: Required when mode is "hours_before", integer 1-72
  - **Error Messages**: "請選擇提醒時間模式" (timing mode), "時間格式必須為 HH:MM" (time format), "小時數必須在 1-72 之間" (hours range)

### Component Architecture

#### Component Hierarchy
```
SettingsRemindersPage
  ├── SettingsSection
      ├── ClinicReminderSettings
          ├── ReminderTimingModeSelector (New)
          │   ├── FormField (reminder_timing_mode)
          │   │   ├── RadioGroup ("hours_before", "previous_day")
          │   │   └── InfoButton (help modal)
          │   └── ConditionalTimeInput
          │       ├── FormField (reminder_previous_day_time)
          │       │   └── TimeInput (HH:MM format)
          │       └── Hidden when mode = "hours_before"
          ├── HoursBeforeInput (Conditional)
          │   ├── FormField (reminder_hours_before)
          │   │   └── NumberInput (1-72 hours)
          │   └── Hidden when mode = "previous_day"
          └── ReminderPreview
              ├── PreviewLabel
              └── PreviewContent (updates based on selected mode)
```

#### Component List
- [x] **ReminderTimingModeSelector**: New component extending `ClinicReminderSettings`
  - Props: `control` (React Hook Form), `isClinicAdmin`
  - State: None (form-controlled)
  - Dependencies: React Hook Form, existing form components

- [x] **ClinicReminderSettings**: Extend existing component (`frontend/src/components/ClinicReminderSettings.tsx`)
  - Add timing mode selector above existing hours input
  - Conditionally show hours input or time input based on mode
  - Update preview API call to handle both timing modes

### User Interaction Flows

#### Flow 1: Switch to Previous Day Mode
1. User navigates to reminder settings page
2. User selects "前一天特定時間" radio button
3. Time input field appears with default 21:00
4. User adjusts time using time picker
5. User clicks "儲存"
6. Settings saved, preview updates to show new timing
7. Future appointments use previous day timing

#### Flow 2: Switch Back to Hours Before Mode
1. User selects "預約前幾小時" radio button
2. Hours input field appears with current value
3. User adjusts hours if needed
4. User clicks "儲存"
5. Settings saved, future appointments use hours-before timing

#### Flow 3: Preview Message Updates
1. User changes timing mode or time
2. Preview automatically updates (if refreshTrigger implemented)
3. User sees sample message with calculated send time

### Edge Cases and Error Handling

#### Edge Cases
- [x] **Appointment Too Soon**: Previous day reminder for same-day appointment → Skip scheduling
- [x] **Past Reminder Time**: Calculated reminder time in past → Skip scheduling
- [x] **Clinic Timezone**: All times calculated in Taiwan timezone
- [x] **Mode Switching**: Existing scheduled reminders unaffected by mode changes
- [x] **Invalid Time**: Malformed time string → Validation error on save

#### Error Scenarios
- [x] **Validation Errors**: Invalid time format → Field-level error message
- [x] **API Errors**: Save fails → Generic error message, retry option
- [x] **Preview Failure**: Preview API fails → Fallback message, non-blocking

### Testing Requirements

#### E2E Tests (Playwright)
- [x] **Test Scenario**: Switch to previous day mode and save
  - **Steps**: Navigate to settings → Select "前一天特定時間" → Set time to "20:00" → Click save
  - **Assertions**: Success message shown, settings persisted on page refresh, future appointments use previous day timing
- [x] **Test Scenario**: Switch back to hours before mode
  - **Steps**: Change to "預約前幾小時" → Set hours to 48 → Save
  - **Assertions**: Settings saved, UI switches to hours input, preview updates
- [x] **Test Scenario**: Invalid time format handling
  - **Steps**: Select previous day mode → Enter "25:00" → Try to save
  - **Assertions**: Validation error "時間格式必須為 HH:MM", save prevented

#### Integration Tests (MSW)
- [x] **Test Scenario**: Previous day reminder scheduling
  - **Mock API**: Appointment creation response
  - **Setup**: Clinic with previous_day mode, time "21:00"
  - **User Action**: Create appointment for tomorrow at 10:00 AM
  - **Assertions**: Reminder scheduled for today at 9:00 PM
- [x] **Test Scenario**: Form validation edge cases
  - **Mock API**: Settings save with validation errors
  - **Test Cases**:
    - Empty time field → "此欄位為必填"
    - Invalid format "9:00" → "時間格式必須為 HH:MM"
    - Hours > 23 → "小時必須在 00-23 之間"
    - Minutes > 59 → "分鐘必須在 00-59 之間"

#### Unit Tests
- [x] **Service**: ReminderSchedulingService.calculate_previous_day_send_time
  - **Test Cases**:
    - Appointment tomorrow 10:00 AM, clinic time "21:00" → Returns today 9:00 PM
    - Appointment today 2:00 PM, clinic time "21:00" → Skips (same day)
    - Edge case: Appointment at clinic time exactly → Calculates correctly
- [x] **Model**: NotificationSettings validation
  - **Test Cases**:
    - Valid times: "00:00", "23:59", "09:30" → Accept
    - Invalid formats: "9:00", "24:00", "12:60", "ab:cd" → Reject with appropriate errors

---

## Integration Points

### Backend Integration
- [x] **ReminderSchedulingService**: Extend with previous day logic
- [x] **ScheduledMessageService**: No changes needed (works with any send time)
- [x] **Clinic Model**: Add convenience properties for new settings

### Frontend Integration
- [x] **SettingsContext**: Extend with new fields
- [x] **Form Schemas**: Add validation for new fields
- [x] **API Types**: Extend existing types

---

## Security Considerations

- [x] **Input validation**: Time format validated on frontend and backend
- [x] **No new permissions**: Uses existing clinic settings permissions
- [x] **Data isolation**: Clinic-scoped settings prevent cross-clinic access

---

## Migration Plan

### Phase 1: Backend Model Updates
- [x] Update `NotificationSettings` in `backend/src/models/clinic.py`
- [x] Update `NotificationSettings` in `backend/src/api/clinic/settings.py`
- [x] Add time format validation for `reminder_previous_day_time`
- [x] Ensure backward compatibility (existing clinics use "hours_before" mode)

### Phase 2: Backend Business Logic
- [x] Extend `ReminderSchedulingService.schedule_reminder()` method
- [x] Add `calculate_previous_day_send_time()` helper method
- [x] Update rescheduling logic to use current timing mode

### Phase 3: Frontend Schema Updates
- [x] Update `frontend/src/schemas/api.ts` notification_settings schema
- [x] Update `frontend/src/types/api.ts` and `frontend/src/types/index.ts`
- [x] Add validation for time format and timing mode

### Phase 4: Frontend UI Implementation
- [x] Extend `ClinicReminderSettings` component with mode selector
- [x] Add conditional rendering for time vs hours input
- [x] Update preview logic and API calls

### Phase 5: Testing & Deployment
- [x] Unit tests for new business logic
- [x] Integration tests for scheduling logic
- [x] E2E tests for UI functionality
- [x] Gradual rollout with backward compatibility

---

## Success Metrics

- [x] **Adoption Rate**: 30% of clinics switch to previous day mode within 3 months
- [x] **Reminder Delivery**: 95% of reminders sent within ±5 minutes of scheduled time
- [x] **Zero Disruption**: No increase in failed reminders for clinics using hours-before mode
- [x] **User Satisfaction**: 90% positive feedback on timing flexibility in user surveys
- [x] **Error Rate**: <1% of reminder scheduling failures due to timing mode logic

---

## Open Questions / Future Enhancements

**Open Questions:**
- Should clinics be able to set different reminder times for different days of the week? (Propose: Not needed initially, keep simple)
- Should there be a minimum advance notice requirement for previous day reminders? (Propose: No, clinics can decide)

**Future Enhancements:**
- Multiple reminder times (e.g., 1 day before + 2 hours before)
- Per-appointment-type reminder settings
- Patient preference for reminder timing
