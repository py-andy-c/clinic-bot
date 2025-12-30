# Admin Notification Enhancements - Design Document

## Overview

This document proposes enhancements to give clinic admins more control over LINE notifications they receive. The changes include:
1. **Appointment Change Event Subscription**: Admins can opt-in to receive notifications about appointment changes (new/cancel/edit/reschedule) for all practitioners
2. **Daily Appointment Reminder for Admins**: Admins receive daily reminders with appointments for ALL practitioners in the clinic
3. **Auto-Assigned Notification Timing**: Admins can choose immediate notification or scheduled notification at a specific time

---

## Requirements

### 1. Appointment Change Event Subscription

**Purpose**: Allow admins to monitor appointment changes across all practitioners in real-time.

**Settings**:
- New field in `PractitionerSettings`: `subscribe_to_appointment_changes: bool = False`
- Only applicable to users with `admin` role
- Per-clinic setting (stored in `UserClinicAssociation.settings` JSONB column, validated via `PractitionerSettings` Pydantic model)
- **Backend validation**: Settings update endpoint must validate that admin-only fields are only set for users with `admin` role

**Events to Subscribe To**:
- **New Appointment**: When appointment is manually assigned to any practitioner (excludes auto-assigned)
- **Cancellation**: When appointment is cancelled (by patient or clinic)
- **Edit/Reschedule**: When appointment time or practitioner changes

**Note**: Auto-assigned appointments are excluded from change subscription (handled by auto-assigned notification system).

**Message Format**:
- Include context: practitioner name, patient name, appointment time, type, and change type
- Format similar to practitioner notifications but with admin context
- Consistent field ordering: practitioner → patient → time → type → change type
- Example: "📅 預約變更通知\n\n治療師：{practitioner_name}\n病患：{patient_name}\n時間：{time}\n類型：{type}\n變更：新預約"
- **i18n**: Messages use Traditional Chinese (consistent with existing notification system). Future: consider i18n system if needed.

**Trigger Points**:
- Same locations where practitioner notifications are sent:
  - `AppointmentService.create_appointment()` - after practitioner notification
  - `AppointmentService.cancel_appointment()` - after practitioner cancellation notification
  - `AppointmentService.edit_appointment()` - after practitioner edit notification

**Implementation**:
- New method: `NotificationService.send_admin_appointment_change_notification()` (add to existing `NotificationService` class for consistency)
- Query all admins efficiently: Use SQLAlchemy JSONB operators and filter by role
  ```python
  db.query(UserClinicAssociation).filter(
      UserClinicAssociation.clinic_id == clinic_id,
      UserClinicAssociation.is_active == True,
      UserClinicAssociation.roles.contains(['admin']),
      UserClinicAssociation.settings['subscribe_to_appointment_changes'].astext == 'true',
      UserClinicAssociation.line_user_id.isnot(None)
  )
  ```
- Check admin role and active association before sending
- Format messages with practitioner, patient, time, type, and change context
- **Performance**: Consider caching admin list per clinic if querying becomes expensive

---

### 2. Daily Appointment Reminder for Admins

**Purpose**: Admins receive daily summary of ALL appointments for ALL practitioners in the clinic.

**Settings**:
- New field in `PractitionerSettings`: `admin_daily_reminder_enabled: bool = False`
- New field: `admin_daily_reminder_time: str = "21:00"` (HH:MM format, 24-hour)
- Only applicable to users with `admin` role
- Per-clinic setting

**Message Format**:
- Group appointments by practitioner
- Include all confirmed appointments for next day (future appointments only)
- Format:
  ```
  📅 明日預約總覽 ({date})
  
  治療師：{practitioner_name}
  共有 {count} 個預約：
  1. {time} - {patient_name} - {type}
  2. {time} - {patient_name} - {type}
  ...
  
  治療師：{practitioner_name}
  共有 {count} 個預約：
  ...
  ```
- If >50 appointments total, show first 50 and append "... 還有 {remaining_count} 個預約"

**Scheduling**:
- Use daily cron job (similar to `AdminAutoAssignedNotificationService`) that runs hourly
- Query appointments at send time (not per-appointment scheduling) to ensure accuracy
- Send at configured time (default 21:00) in Taiwan timezone (UTC+8)
- "Next day" defined as: appointments with `date = notification_date + 1 day` (00:00 to 23:59 Taiwan time)
- Skip notification if no appointments for next day

**Implementation**:
- New service: `AdminDailyReminderService` with hourly scheduler (similar to `AdminAutoAssignedNotificationService`)
- At configured time, query all confirmed appointments for next day, grouped by practitioner
- Query all admins with `admin_daily_reminder_enabled = True` and LINE account linked
- Send one message per admin with all practitioners' appointments
- Use SQLAlchemy JSONB operators to query settings: `association.settings['admin_daily_reminder_enabled'].astext == 'true'`

---

### 3. Auto-Assigned Notification Timing Control

**Purpose**: Allow admins to choose between immediate notification or scheduled notification.

**Settings**:
- Modify existing `auto_assigned_notification_time` field behavior
- New field: `auto_assigned_notification_mode: str = "scheduled"` 
  - Options: `"immediate"` or `"scheduled"`
- If `"immediate"`: Send notification when auto-assigned appointment is created
- If `"scheduled"`: Use existing behavior (send at configured time, default 21:00)

**Immediate Mode**:
- Trigger: When auto-assigned appointment is created in `AppointmentService.create_appointment()`
- Check `auto_assigned_notification_mode == "immediate"` for each admin
- Send notification immediately (similar to current auto-assigned notification format)
- **Batching**: Send individual notifications per appointment initially
- **Note**: If many appointments created simultaneously (e.g., bulk import), admins may receive multiple notifications. Consider batching within 5-minute windows if this becomes an issue.

**Scheduled Mode**:
- Keep existing `AdminAutoAssignedNotificationService` behavior
- Check `auto_assigned_notification_mode == "scheduled"` before sending
- Use `auto_assigned_notification_time` for timing

**Implementation**:
- Modify `AppointmentService.create_appointment()` to check for immediate mode admins
- Modify `AdminAutoAssignedNotificationService._send_admin_notifications()` to check mode
- New method: `NotificationService.send_immediate_auto_assigned_notification()`

---

## Data Model Changes

### PractitionerSettings Schema

```python
class PractitionerSettings(BaseModel):
    # Existing fields
    compact_schedule_enabled: bool = False
    next_day_notification_time: str = "21:00"
    auto_assigned_notification_time: str = "21:00"
    patient_booking_allowed: bool = True
    step_size_minutes: Optional[int] = None
    
    # New fields for admins
    subscribe_to_appointment_changes: bool = Field(
        default=False,
        description="Admin-only: Subscribe to appointment change notifications for all practitioners"
    )
    admin_daily_reminder_enabled: bool = Field(
        default=False,
        description="Admin-only: Receive daily appointment reminders for all practitioners"
    )
    admin_daily_reminder_time: str = Field(
        default="21:00",
        description="Admin-only: Time to send daily appointment reminder (HH:MM format, 24-hour)"
    )
    auto_assigned_notification_mode: str = Field(
        default="scheduled",
        description="Admin-only: Auto-assigned notification mode - 'immediate' or 'scheduled'"
    )
```

**Validation**:
- `auto_assigned_notification_mode` must be one of: `["immediate", "scheduled"]`
- `admin_daily_reminder_time` must be valid HH:MM format (24-hour, interpreted as Taiwan timezone UTC+8)
- **Backend validation**: Settings update endpoint must validate that admin-only fields (`subscribe_to_appointment_changes`, `admin_daily_reminder_enabled`, `admin_daily_reminder_time`, `auto_assigned_notification_mode`) are only set for users with `admin` role
- **Settings storage**: Stored in `UserClinicAssociation.settings` JSONB column, validated via `PractitionerSettings` Pydantic model. The model name "PractitionerSettings" is used for historical reasons (shared infrastructure), but these fields are admin-only.

---

## Implementation Plan

### Phase 1: Settings Model Updates
1. Update `PractitionerSettings` Pydantic model with new fields
2. Add validation for new fields (`auto_assigned_notification_mode` enum, time format validation)
3. **Backend validation**: Add validation in `/profile` endpoint (`backend/src/api/profile.py:204-238`) BEFORE calling `set_validated_settings()`:
   - Check if user has `admin` role in current clinic association
   - If non-admin tries to set admin-only fields (`subscribe_to_appointment_changes`, `admin_daily_reminder_enabled`, `admin_daily_reminder_time`, `auto_assigned_notification_mode`), reject with clear error message
   - Validation in API endpoint (not Pydantic model) provides better error messages to frontend
4. **Frontend UI**: Update Profile/Settings page to show admin-only options:
   - Only visible when user has `admin` role (conditional rendering)
   - Group admin notification settings in separate section for clarity
   - Users who are both admin and practitioner see both practitioner and admin settings
5. No database migration needed (JSONB fields, defaults applied via Pydantic model)

### Phase 2: Appointment Change Subscription
1. Create `NotificationService.send_admin_appointment_change_notification()`
2. Add calls in:
   - `AppointmentService.create_appointment()` (after practitioner notification, exclude auto-assigned)
   - `AppointmentService.cancel_appointment()` (after practitioner cancellation)
   - `AppointmentService.edit_appointment()` (after practitioner edit)
3. Query all admins efficiently using SQLAlchemy JSONB operators (see Implementation section)
4. Format messages with practitioner, patient, time, type, and change context
5. **Deduplication**: If admin has both `subscribe_to_appointment_changes=True` and `auto_assigned_notification_mode="immediate"`, they may receive both notifications when auto-assigned appointment is later confirmed/reassigned. This is acceptable as notifications serve different purposes (immediate: auto-assigned created, change subscription: manual assignment).

### Phase 3: Admin Daily Reminder
1. Create `AdminDailyReminderService` with hourly scheduler (similar to `AdminAutoAssignedNotificationService`)
2. Use daily cron job that queries appointments at send time (not per-appointment scheduling)
3. Query all confirmed appointments for next day (date = notification_date + 1 day), grouped by practitioner
4. Query all admins with `admin_daily_reminder_enabled = True` using JSONB operators
5. Send at configured `admin_daily_reminder_time` in Taiwan timezone (UTC+8)
6. Skip if no appointments for next day

### Phase 4: Auto-Assigned Notification Mode
1. Modify `AppointmentService.create_appointment()` to check for immediate mode admins
2. Create `NotificationService.send_immediate_auto_assigned_notification()` (add to existing `NotificationService` class)
3. Modify `AdminAutoAssignedNotificationService._send_admin_notifications()` to check mode before scheduled sending
4. Send individual notifications per appointment (no batching initially; can add 5-minute window batching later if bulk imports become common)

---

## Edge Cases & Decisions

### Edge Cases

1. **Admin is also a practitioner**
   - Admin receives both practitioner notifications (for their own appointments) AND admin notifications (for all appointments)
   - Intentional design for full visibility

2. **Multiple admins with different settings**
   - Each admin's settings are independent per clinic
   - Each admin receives notifications based on their own settings

3. **No appointments for next day**
   - Daily reminder: Skip notification (avoid noise)
   - Appointment change subscription: Only triggers when changes occur

4. **Auto-assigned appointment created then immediately confirmed/reassigned**
   - Immediate notification sent for initial auto-assigned state
   - If appointment change subscription enabled, admin also receives change notification
   - Both notifications are valid and informative

5. **Admin without LINE account**
   - Skip all notifications (same as current behavior)
   - Settings can still be configured, but notifications won't send

6. **Clinic with no practitioners**
   - Daily reminder: Skip (no appointments to show)
   - Appointment change subscription: Skip (no practitioners to monitor)

7. **Appointment change subscription excludes auto-assigned**
   - Auto-assigned appointments are handled by auto-assigned notification system
   - Change subscription only notifies on manual assignments, cancellations, and edits

8. **Immediate auto-assigned notification batching**
   - Send individual notifications per appointment (no batching)
   - Can add batching later if needed

9. **Daily reminder with many appointments**
   - Include all practitioners and appointments
   - If >50 appointments total, show first 50 and append "... 還有 {remaining_count} 個預約"
   - Rationale: LINE message length limits, prioritize showing first appointments

10. **Settings validation**
    - Settings are independent - time settings preserved even when feature disabled
    - Allows easy re-enabling without reconfiguring times

11. **Daily reminder sent late (past appointments)**
    - Only include future appointments (next day from notification time)
    - Exclude appointments that have already passed

12. **Appointment change subscription granularity**
    - All-or-nothing subscription (all event types)
    - Can add granularity (subscribe to specific event types) in future if needed

13. **Backward compatibility**
    - Default `auto_assigned_notification_mode = "scheduled"` maintains current behavior
    - Existing `auto_assigned_notification_time` settings continue to work

14. **Notification failures**
    - Notification failures don't block appointment operations (same as current behavior)
    - Errors logged but appointment changes succeed

15. **Admin role changes or deactivation**
    - If admin role removed or association deactivated: Skip notifications (role check fails)
    - Settings remain in database but notifications won't send

16. **Clinic LINE credentials missing**
    - Skip all notifications (same as current behavior)
    - Applies to all notification types

17. **Settings changed mid-day**
    - Settings checked at notification time, so latest settings apply
    - No need to handle stale settings

18. **Notification deduplication with immediate mode**
    - If admin has both `subscribe_to_appointment_changes=True` and `auto_assigned_notification_mode="immediate"`:
      - **Scenario 1**: Auto-assigned appointment created → immediate notification sent (event: auto-assigned created)
      - **Scenario 2a**: Later immediately confirmed/reassigned → change subscription notification sent (event: manual assignment)
      - **Scenario 2b**: Later reassigned (not immediate) → change subscription notification sent (event: appointment change)
    - Both notifications are valid and intentional (different events: creation vs. change)
    - No deduplication needed - each notification serves a distinct purpose

19. **Timezone handling**
    - All notification times interpreted in Taiwan timezone (UTC+8)
    - Consistent with existing `auto_assigned_notification_time` and `next_day_notification_time` behavior
    - "Next day" defined relative to Taiwan timezone

20. **Performance considerations**
    - Querying admins per appointment change: Use efficient JSONB queries, consider caching admin lists per clinic
    - LINE API rate limits: LINE allows 2,000 requests/second per channel (well above our needs)
    - Notification failures: Logged but don't block operations, no automatic retry (same as current behavior)

21. **Daily reminder scheduling mechanism**
    - Uses daily cron job (hourly check) that queries appointments at send time
    - Not per-appointment scheduling (avoids stale data when appointments cancelled/edited)
    - More reliable than scheduling per appointment

---

## Testing Considerations

1. **Unit Tests**:
   - Settings validation for new fields
   - Notification service methods with various settings combinations
   - Message formatting for different scenarios

2. **Integration Tests**:
   - Admin receives appointment change notifications when subscribed
   - Admin receives daily reminder when enabled
   - Immediate vs scheduled auto-assigned notifications
   - Multiple admins with different settings

3. **Edge Case Tests**:
   - Admin without LINE account (should skip all notifications)
   - No appointments for next day (should skip daily reminder)
   - Admin who is also practitioner (receives both practitioner and admin notifications)
   - Multiple admins with different settings (each receives based on own settings)
   - Auto-assigned appointments excluded from change subscription
   - Immediate mode sends individual notifications (no batching)
   - Daily reminder truncation when >50 appointments
   - Backend validation prevents non-admins from setting admin-only fields
   - Timezone handling (Taiwan timezone, DST transitions)
   - Notification deduplication (immediate + change subscription)
   - Daily reminder "next day" definition around midnight
   - Performance: Querying many admins efficiently

4. **Performance Tests**:
   - Clinic with many admins (10+) receiving change notifications
   - Clinic with many appointments (100+) in daily reminder
   - Bulk appointment creation triggering immediate notifications

---

## Summary

This design adds three notification enhancements for admins:
1. **Appointment change subscription**: Real-time monitoring of appointment changes
2. **Daily appointment reminder**: Overview of all practitioners' appointments
3. **Auto-assigned timing control**: Immediate or scheduled notifications

All settings are per-clinic, stored in `UserClinicAssociation.settings`, and only apply to users with `admin` role. The implementation follows existing patterns and integrates with current notification infrastructure.

## Additional Notes

### Message Format Consistency
- All notification messages follow consistent format: emoji prefix, clear section headers, consistent field ordering
- Date/time formatting uses existing `format_datetime()` utility (Taiwan timezone)
- Messages use Traditional Chinese (consistent with existing system)

### Settings Discovery
- New settings default to `False` or `"scheduled"` (opt-in)
- Admins discover settings via Profile/Settings page UI
- No automatic migration needed - admins enable features as needed

### Notification Failure Handling
- **Decision**: Notification failures are logged but don't block appointment operations
- **No automatic retry**: Same as current behavior - failed notifications are not retried automatically
- **No admin notification of failures**: Admins are not notified when their notifications fail (would create notification loop)
- **Error tracking**: Failed notifications can be tracked via `LinePushMessage` records for debugging
- **Partial failures**: If multiple admins should receive notification and some fail, successful notifications are sent, failed ones are logged
- **Error context**: Log errors with sufficient context (clinic_id, admin_id, appointment_id, notification_type) for debugging

