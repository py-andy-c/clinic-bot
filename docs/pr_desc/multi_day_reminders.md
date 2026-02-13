# Multi-Day Appointment Reminders for Practitioners and Admins

## Summary
This PR enhances the daily appointment reminder system by allowing practitioners and admins to configure a custom look-ahead range (1-14 days) for their daily summaries. Previously, the system only provided reminders for the next day.

## Changes

### Backend
- **Database Model:** Added `reminder_days_ahead` (default 1, range 1-14) to the `PractitionerSettings` Pydantic model stored in the `user_clinic_associations.settings` JSONB column.
- **Notification Services:**
    - Updated `PractitionerDailyNotificationService` and `AdminDailyNotificationService` to fetch appointments for the user-specified date range.
    - Implemented robust multi-message splitting logic to ensure summaries stay under the LINE Messaging API's 5,000 character limit, including mid-practitioner splitting for very large schedules.
    - Added continuation headers (e.g., `(續上頁)`) and multi-part indicators (e.g., `第 1/2 部分`) for long summaries.
    - Standardized error handling and settings retrieval across services.
    - Deprecated legacy single-day appointment retrieval methods.
- **Message Formatting:** Updated `DailyNotificationMessageBuilder` to support date range headers and daily grouping headers (e.g., `【2026年02月13日 (五)】`). Maintained the "明日" prefix for single-day reminders for backward compatibility.

### Frontend
- **Profile Page:** Added a new "預約提醒天數" (Reminder Days Ahead) numeric input field to the personal profile settings, making it configurable per-practitioner.
- **Input Validation:** Implemented robust numeric input handling with automatic clamping (1-14 days) and prevention of invalid characters.
- **Change Detection:** Updated the profile settings utility to correctly detect changes in the new field using type-safe numeric comparisons, ensuring the "Save Changes" UI and unsaved changes alerts work as expected.
- **Schema & Types:** Updated Zod schemas and TypeScript interfaces to include the new setting.

## Test Plan
- [x] Verified that `reminder_days_ahead` correctly defaults to 1 for existing users.
- [x] Verified that changing the range on the Profile Page triggers the "Save Changes" button.
- [x] Verified that the setting persists correctly in the database after saving.
- [x] Enhanced unit tests in `test_practitioner_daily_notification_service.py` to cover multi-day ranges (2-day, 7-day).
- [x] Ran `./run_tests.sh` to ensure all backend unit tests and frontend type checks pass.
- [x] Manually verified message formatting for single-day and multi-day ranges.

## User Impact
Practitioners and admins can now plan their schedules further in advance by receiving summaries of up to 14 days of upcoming appointments directly in their LINE daily notification. The configuration is now conveniently located on their personal profile page.
