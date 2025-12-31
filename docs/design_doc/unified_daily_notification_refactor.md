# Unified Daily Notification Refactor

## Overview

Unify admin and practitioner daily notifications to use the same setting (`next_day_notification_time`) and share message formatting code. Both use hourly check (real-time aggregation) instead of pre-scheduling.

## Goals

1. **Deprecate admin-specific settings**: Remove `admin_daily_reminder_enabled` and `admin_daily_reminder_time`
2. **Unify setting**: Both admins and practitioners use `next_day_notification_time`
3. **Migrate practitioners**: Move from pre-scheduling to hourly check (real-time aggregation)
4. **Share code**: Extract common message formatting/aggregation logic
5. **Unified format**: Admin receives clinic-wide view using same format as practitioner (all practitioners' content concatenated)

## Current State

### Admin Daily Reminder
- **Service**: `AdminDailyReminderService` with hourly scheduler
- **Settings**: `admin_daily_reminder_enabled` (opt-in), `admin_daily_reminder_time` (default 21:00)
- **Scheduling**: Hourly check, real-time aggregation
- **Format**: Clinic-wide view grouped by practitioner
- **Message splitting**: Yes (4500 char target, 5000 char max)

### Practitioner Daily Notification
- **Service**: `PractitionerNotificationSchedulingService` (pre-scheduling) + `ScheduledMessageScheduler`
- **Settings**: `next_day_notification_time` (default 21:00)
- **Scheduling**: Pre-scheduled per appointment via `ScheduledLineMessage`
- **Format**: Personal view with detailed appointment info
- **Message splitting**: No (unlikely to exceed limit)

## Proposed Changes

### 1. Deprecate Admin-Specific Settings

**Actions:**
- Remove `admin_daily_reminder_enabled` from UI and backend
- Remove `admin_daily_reminder_time` from UI and backend
- Use `next_day_notification_time` for both admins and practitioners
- Auto-enable for all admins (no opt-in needed)

**Migration:**
- One-time script: Copy `admin_daily_reminder_time` → `next_day_notification_time` if `next_day_notification_time` is null/empty
- Database: Old settings remain in JSONB but ignored

### 2. Migrate Practitioners to Hourly Check

**Actions:**
- Remove `PractitionerNotificationSchedulingService` (pre-scheduling logic)
- Remove calls to `schedule_notification_for_appointment()`, `cancel_pending_notifications()`, `reschedule_notification()`
- Update `PractitionerDailyNotificationService` to use hourly check (currently deprecated, will be reactivated)
- Mark existing `ScheduledLineMessage` entries for `practitioner_daily` type as `skipped`

**Benefits:**
- Always fresh data (no stale scheduled messages)
- Simpler code (remove ~260 lines of scheduling/rescheduling logic)
- Handles edge cases automatically (appointment changes, cancellations)
- Consistent with admin approach

### 3. Share Message Formatting Code

**Extract Common Utilities:**

```python
class DailyNotificationMessageBuilder:
    """Shared message building utilities for daily notifications."""
    
    @staticmethod
    def format_date(date: date) -> str:
        """Format date as 'YYYY年MM月DD日'."""
    
    @staticmethod
    def build_appointment_line(
        appointment: Appointment, 
        index: int
    ) -> str:
        """Build single appointment line (time, patient, type, notes)."""
    
    @staticmethod
    def build_practitioner_section(
        practitioner_name: str,
        appointments: List[Appointment],
        is_clinic_wide: bool = False
    ) -> str:
        """Build practitioner section header."""
    
    @staticmethod
    def build_message_header(
        date: date,
        is_clinic_wide: bool = False,
        part_number: Optional[int] = None,
        total_parts: Optional[int] = None
    ) -> str:
        """Build message header (明日預約提醒 or 明日預約總覽)."""
```

**Message Format (Shared):**
```
📅 明日預約提醒 ({date})  # or 明日預約總覽 for admin

治療師：{practitioner_name}
共有 {count} 個預約：  # or 您有 {count} 個預約： for practitioner

1. {time}
   病患：{patient_name}
   類型：{appointment_type_name}
   {備註：{notes} if exists}

2. {time}
   ...
```
(No footer message)

### 4. Service Architecture

**Keep Services Separate:**

- **`AdminDailyNotificationService`** (rename from `AdminDailyReminderService`):
  - Iterate by clinic
  - Get all appointments for clinic (clinic-wide)
  - Group appointments by practitioner
  - Build clinic-wide message using shared utilities
  - Apply message splitting (4500/5000 char limits)
  - Send to multiple admins (batched)

- **`PractitionerDailyNotificationService`**:
  - Iterate by practitioner
  - Get practitioner's appointments
  - Build personal message using shared utilities
  - No message splitting needed
  - Send to single practitioner

**Shared Code:**
- `DailyNotificationMessageBuilder` (message formatting utilities)
- Time parsing/validation logic
- Date formatting
- Appointment line building

### 5. Deduplication Logic

**Admin-Practitioners:**
- If user has both `admin` and `practitioner` roles in same clinic:
  - Receive ONLY clinic-wide admin notification
  - Skip personal practitioner notification
- Implementation: Check in `PractitionerDailyNotificationService` - skip if `'admin' in roles`

## Implementation Plan

### Phase 1: Extract Shared Utilities
1. Create `DailyNotificationMessageBuilder` class
2. Extract common message formatting functions
3. Update both services to use shared utilities

### Phase 2: Migrate Practitioners
1. Update `PractitionerDailyNotificationService` to use hourly check
2. Remove `PractitionerNotificationSchedulingService`
3. Remove all calls to scheduling methods
4. Mark existing `practitioner_daily` ScheduledLineMessage entries as `skipped`

### Phase 3: Unify Settings
1. Update `AdminDailyNotificationService` to use `next_day_notification_time`
2. Remove `admin_daily_reminder_time` references
3. Update UI to remove admin-specific settings
4. Add migration script for existing data

### Phase 4: Testing & Cleanup
1. Update tests for both services
2. Verify deduplication works correctly
3. Test message splitting for admins
4. Remove deprecated code

## Edge Cases & Decisions

### Message Format Differences

**Proposed:**
- **Header**: Admin uses "明日預約總覽" (clinic-wide), Practitioner uses "明日預約提醒" (personal)
- **Practitioner section**: Admin uses "共有 X 個預約" (third-person), Practitioner uses "您有 X 個預約" (second-person)
- **Footer**: None (removed "請準時為病患服務！" entirely)

**Rationale**: Maintains distinction between clinic-wide view (admin) and personal reminder (practitioner) while using same format structure. Footer removed as it doesn't provide useful information.

### Message Splitting for Admin

**Proposed:**
- **Primary**: Split at practitioner boundaries (clean breaks)
- **Fallback**: Split mid-practitioner if single practitioner exceeds limit
- **Part indicators**: Include "第 1/3 部分" in header for multi-part messages
- **Continuation format**: Use "治療師：{name} (續上頁)" for mid-practitioner splits

**Rationale**: Matches current implementation, provides best readability.

### Migration Timing

**Proposed:**
1. **Before code deployment**: Run migration script to copy `admin_daily_reminder_time` → `next_day_notification_time`
2. **Conflict handling**: If both exist, prefer existing `next_day_notification_time` (user may have already set it)
3. **Rollback safety**: Old settings remain in database, can revert if needed

**Rationale**: Data migration before code ensures smooth transition, no data loss.

### Practitioner Service Reactivation

**Proposed:**
- Remove deprecation marker from `PractitionerDailyNotificationService._send_daily_notifications()`
- Update method to use hourly check (remove pre-scheduling logic)
- Keep same method name for consistency

**Rationale**: Simpler than creating new method, maintains existing service structure.

### ScheduledLineMessage Cleanup

**Proposed:**
- Mark existing `practitioner_daily` messages as `skipped` (don't delete)
- Add one-time cleanup script to mark all pending `practitioner_daily` as `skipped`
- Let them expire naturally (for audit trail)

**Rationale**: Preserves audit trail, prevents accidental deletion, cleaner than leaving as `pending`.

### Admin-Practitioner in Multiple Clinics

**Proposed:**
- Receive separate clinic-wide message per clinic
- Each clinic's message sent at that clinic's admin's `next_day_notification_time`
- No personal practitioner reminder for any clinic (deduplication applies per clinic)

**Rationale**: Admin needs clinic-wide view per clinic, deduplication prevents duplicates within same clinic.

### Performance Considerations

**Proposed:**
- **Query optimization**: Use `joinedload` for appointments (already implemented)
- **Batching**: Group admins by time to build message once per clinic
- **No caching needed**: Hourly checks are infrequent, real-time data is priority
- **Expected scale**: Most clinics < 50 practitioners, acceptable performance

**Rationale**: Current query patterns are sufficient, caching adds complexity without significant benefit.

### Other Edge Cases

1. **Admin with no `next_day_notification_time` set**: Use default 21:00
2. **Practitioner with no `next_day_notification_time` set**: Use default 21:00
3. **Admin-practitioner**: Receives only clinic-wide view (deduplication)
4. **Appointment created after hourly check**: Included in next hour's check
5. **Appointment canceled/modified**: Automatically reflected (no rescheduling needed)
6. **Empty next day**: No notification sent (both admin and practitioner)
7. **Multiple clinics**: Admin receives separate message per clinic (each at its own time)
8. **Time setting changed**: Takes effect on next hourly check (no immediate rescheduling needed)
9. **Auto-assigned appointments**: Included in admin clinic-wide view (grouped under "不指定"), excluded from practitioner personal view
10. **Deleted appointment types**: Filter out appointments with deleted appointment types
11. **No LINE account**: Skip user if no `line_user_id` linked
12. **No LINE credentials**: Skip clinic if missing LINE channel credentials
13. **Scheduler downtime**: Missed notifications during downtime (acceptable, not critical)

## Success Criteria

1. ✅ Both admins and practitioners use `next_day_notification_time`
2. ✅ Admin-specific settings removed from UI and backend
3. ✅ Practitioners use hourly check (no pre-scheduling)
4. ✅ Message formatting code shared between services
5. ✅ Admin receives clinic-wide view with same format as practitioner
6. ✅ Deduplication works (admin-practitioners receive only clinic-wide)
7. ✅ Message splitting works for admins (stays under 5000 chars)
8. ✅ All tests pass

## Migration Notes

- **Data Migration**: Alembic migrations handle data migration automatically:
  - `migrate_admin_reminder_time`: Copies `admin_daily_reminder_time` → `next_day_notification_time` (runs before code deployment)
  - `cleanup_practitioner_daily`: Marks pending `practitioner_daily` ScheduledLineMessage entries as `skipped` (runs after code deployment)
- **Backward Compatibility**: Old settings remain in database but ignored
- **Rollout**: Migrations run automatically as part of deployment via `alembic upgrade head`
- **Dev Database**: If migration was already run manually on dev, use `alembic stamp <revision_id>` to mark as complete

