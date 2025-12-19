# Migration Plan: Move `line_user_id` from User to UserClinicAssociation

## Problem
Currently, `line_user_id` is stored on the `User` model, which prevents:
- Users from enrolling in LINE notifications independently per clinic
- Supporting different LINE Messaging API channels per clinic (same LINE user has different `line_user_id` per channel)

## Solution
Move `line_user_id` from `User` to `UserClinicAssociation` to enable per-clinic LINE enrollment.

## Migration Steps

### Phase 1: Database Schema Changes
1. **Add `line_user_id` column to `user_clinic_associations`**
   - Type: `String(255)`, nullable
   - Add index for query performance
   - Add unique constraint on `(clinic_id, line_user_id)` to prevent duplicate links per clinic

2. **Data Migration**
   - For each `User` with `line_user_id`:
     - Find all active `UserClinicAssociation` records for that user
     - Copy `user.line_user_id` to each association's `line_user_id`
   - Handle edge cases:
     - Users with no associations (system admins) → skip
     - Users with multiple associations → copy to all

3. **Remove `line_user_id` from `users` table**
   - Drop column after data migration verified

### Phase 2: Model Updates
1. **Update `UserClinicAssociation` model**
   - Add `line_user_id: Mapped[Optional[str]]` field
   - Update docstring

2. **Update `User` model**
   - Remove `line_user_id` field
   - Update docstring

### Phase 3: Code Updates

#### API Endpoints
1. **`/api/profile` (GET/PUT)**
   - Change `line_linked` check from `user.line_user_id` to `association.line_user_id`
   - Update response to be clinic-specific

2. **`/api/profile/unlink-line` (DELETE)**
   - Update to set `association.line_user_id = None` instead of `user.line_user_id = None`
   - Must be clinic-scoped (use `current_user.active_clinic_id`)

3. **`/api/line-webhook` (POST)**
   - Update link code handling:
     - Check `association.line_user_id` instead of `user.line_user_id`
     - Set `association.line_user_id = line_user_id` instead of `user.line_user_id`
     - Verify code is clinic-specific (already has `clinic_id`)

#### Services
1. **`NotificationService.send_practitioner_appointment_notification()`**
   - Accept `UserClinicAssociation` instead of `User`
   - Use `association.line_user_id` instead of `practitioner.line_user_id`
   - Update callers to pass association

2. **`NotificationService.send_practitioner_cancellation_notification()`**
   - Same changes as above

3. **`AdminAutoAssignedNotificationService`**
   - Update `_get_admins_with_line_accounts()`:
     - Filter by `association.line_user_id IS NOT NULL` instead of `user.line_user_id`
   - Update `_send_notification_for_admin()`:
     - Use `association.line_user_id` instead of `admin.line_user_id`

4. **`PractitionerDailyNotificationService`**
   - Update `_send_daily_notifications()`:
     - Check `association.line_user_id` instead of `association.user.line_user_id`
   - Update `_send_notification_for_practitioner()`:
     - Use `association.line_user_id` instead of `practitioner.line_user_id`

5. **`ReminderService`**
   - No changes needed (uses patient's `line_user_id`, not practitioner's)

#### Query Updates
- All queries checking `user.line_user_id` → check `association.line_user_id`
- All queries filtering by `User.line_user_id` → join `UserClinicAssociation` and filter

### Phase 4: Frontend Updates
1. **Profile page**
   - `line_linked` status is now clinic-specific
   - Show per-clinic LINE enrollment status if user has multiple clinics

2. **LINE linking flow**
   - Already clinic-scoped (uses `PractitionerLinkCode` with `clinic_id`)
   - No changes needed

## Key Considerations

### Data Migration Strategy
- **Clean cutover**: Add column, migrate data, update code, then remove old column in single migration
- **No backward compatibility period**: Code will be updated immediately after migration
- **Validation**: Verify all users with `line_user_id` have it migrated to associations

### Edge Cases
1. **Users with multiple clinics**: Each association gets its own `line_user_id`
2. **System admins**: No associations, so no `line_user_id` (unchanged behavior)
3. **Existing link codes**: Already clinic-specific, no changes needed
4. **Users with `line_user_id` but no associations**: Skip migration (shouldn't happen in practice)

### Testing Checklist
- [ ] User can link LINE account per clinic
- [ ] User can unlink LINE account per clinic
- [ ] Notifications sent to correct `line_user_id` per clinic
- [ ] Users with multiple clinics can have different LINE enrollments
- [ ] Profile API returns correct `line_linked` status per clinic
- [ ] Daily notifications work per clinic
- [ ] Admin notifications work per clinic

## Questions (Answered)
1. **Migration timing**: ✅ Clean cutover (no backward compatibility)
2. **Default behavior**: ✅ No auto-linking across clinics
3. **Unlink behavior**: ✅ Clinic-specific only

## Remaining Questions (Answered)
1. **Unique constraint**: ✅ Yes - add `UniqueConstraint('clinic_id', 'line_user_id')`
2. **Data migration for multi-clinic users**: ✅ Yes - copy to all associations
3. **Validation during linking**: ✅ Yes - check and reject if already linked to different user in same clinic

## Implementation Notes
- Unique constraint ensures one LINE account can only link to one user per clinic
- During migration, copy existing `line_user_id` to all active associations for that user
- Webhook link handler must check `UserClinicAssociation` instead of `User` for existing links
- All notification services must use `association.line_user_id` instead of `user.line_user_id`

