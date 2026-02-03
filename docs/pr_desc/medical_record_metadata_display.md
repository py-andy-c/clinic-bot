# Medical Record Metadata Display

## Overview
Added always-visible metadata to medical record cards showing appointment details, creation/edit timestamps with user names, and deletion countdown. Optimized to fetch deleted records only when needed.

## Changes

### Backend

**`backend/src/api/clinic/medical_records.py`**
- Added `AppointmentInfo` Pydantic model for structured appointment data
- Enhanced `MedicalRecordResponse` with appointment and user name fields
- Added `_batch_fetch_user_names()` helper to fetch all user names in a single query
- Updated `_enrich_record_with_photos()` to:
  - Combine `calendar_event.date` + `calendar_event.start_time` into full datetime
  - Use `ensure_taiwan()` to add timezone offset (`+08:00`) for correct timezone handling
  - Accept pre-fetched `user_names_map` to avoid N+1 queries
- Updated all endpoints (`create_record`, `list_records`, `get_record`, `update_record`, `restore_record`) to:
  - Batch fetch user names before enrichment
  - Pass `user_names_map` to enrichment function
- Added `status` query parameter to `list_records` endpoint ('active', 'deleted', or 'all')
- Replaced `assert` statements with proper `HTTPException` for production safety

**`backend/src/services/medical_record_service.py`**
- Added eager loading for `calendar_event` relationship in `get_record()` and `list_patient_records()`
- Added eager loading for `photos` relationship to prevent N+1 queries
- Added `status` parameter to `list_patient_records()` and `count_patient_records()`
- Maintains backward compatibility with `include_deleted` parameter
- Prevents N+1 queries when fetching multiple records

**`backend/src/utils/datetime_utils.py`**
- Reused existing `ensure_taiwan()` utility for timezone-aware datetime handling

### Frontend

**`frontend/src/types/medicalRecord.ts`**
- Added `appointment` field with id, start_time, end_time, appointment_type
- Added `created_by_user_name` and `updated_by_user_name` fields

**`frontend/src/components/PatientMedicalRecordsSection.tsx`**
- Split data fetching into two queries:
  - Active records: Always fetched with `status='active'` (default)
  - Deleted records: Only fetched when user clicks "查看最近刪除" with `status='deleted'`
- Fixed trash button visibility bug: Always show "查看最近刪除" button, display "尚無刪除記錄" inside if empty
- Updated `MedicalRecordCard` to display metadata:
  - Appointment info: `預約：2026/2/3(二) 14:00 • 複診`
  - Created time: `建立：2026/2/3(二) 09:03 by Dr. Chen`
  - Updated time: `編輯：2026/2/3(二) 09:24 by Dr. Wang` (only if different from created)
  - Deletion time: `刪除：2026/2/3(二) 10:43`
  - Deletion countdown: `將於27天後永久刪除` (in red)
- Fixed timestamp comparison using `getTime()` instead of string comparison
- Uses existing `formatAppointmentDateTime()` utility for consistent formatting
- Extracted retention period to `MEDICAL_RECORD_RETENTION_DAYS` constant

**`frontend/src/hooks/useMedicalRecords.ts`**
- Added `status` parameter support to `usePatientMedicalRecords` hook
- Updated query key to include status for proper cache separation
- Maintains backward compatibility with `include_deleted` parameter

**`frontend/src/services/api.ts`**
- Added `status` parameter to `listPatientMedicalRecords` method

**`frontend/src/constants/medicalRecords.ts`** (new file)
- Exported `MEDICAL_RECORD_RETENTION_DAYS` constant (30 days)

## Technical Details

### Timezone Handling (Critical Fix)
The key challenge was that `CalendarEvent` stores date and time separately:
- `calendar_event.date` → `2026-02-03` (date object)
- `calendar_event.start_time` → `13:00:00` (time object)

**Solution**: 
1. Use `datetime.combine()` to create full datetime
2. Use `ensure_taiwan()` to add timezone info before calling `.isoformat()`
3. Result: `2026-02-03T13:00:00+08:00` (with timezone offset)

This ensures the frontend correctly interprets the time regardless of user's local timezone.

### User Names & N+1 Prevention
Names are clinic-specific and stored in `UserClinicAssociation.full_name`, not on the `User` model. 

**Performance Fix**: Instead of querying user names individually for each record (N+1 problem), we now:
1. Collect all unique user IDs from the batch of records
2. Fetch all user names in a single query using `.filter(user_id.in_(user_ids))`
3. Pass the pre-fetched map to the enrichment function

This reduces database queries from O(2N) to O(1) for user name fetching.

### Photos & N+1 Prevention
Photos are eagerly loaded using `joinedload(MedicalRecord.photos)` in the service layer to prevent N+1 queries when listing records. Without this, each record would trigger a separate query to fetch its photos.

### Performance Optimization
- **Before**: Always fetched all records including deleted (unnecessary payload)
- **After**: 
  - Active records fetched with `status='active'` (default)
  - Deleted records only fetched when user expands trash with `status='deleted'`
  - Eliminates redundant active records in deleted query response
- Uses React Query's `enabled` option for conditional fetching

### API Design Improvement
Added explicit `status` parameter for better clarity:
- `status='active'` → Only active records (default behavior)
- `status='deleted'` → Only deleted records (new, eliminates redundancy)
- `status='all'` → Both active and deleted records
- Maintains backward compatibility with `include_deleted` boolean parameter

### Retention Policy
- 30 days confirmed in `backend/src/services/cleanup_service.py`
- Frontend calculates days remaining using `Math.ceil()` for accurate countdown

### Styling
- Font size: `text-sm` (matches appointment list)
- Color: `text-gray-600` for metadata, `text-red-600` for deletion countdown only
- Spacing: `mt-2 space-y-1` for clear visual separation

## Addressed Feedback
✅ **Timezone Issue**: Added `ensure_taiwan()` to include `+08:00` offset  
✅ **User Names**: Populated from `UserClinicAssociation.full_name`  
✅ **N+1 Query Problem**: Implemented batch fetching for user names (single query instead of 2N queries)  
✅ **Trash Button Visibility Bug**: Always show button, display "no records" message inside if empty  
✅ **String Comparison**: Fixed using `getTime()` instead of string equality  
✅ **Deleted Records Optimization**: Only fetch when needed  
✅ **Query Key**: Separated cache for active vs deleted records  
✅ **Redundant Data Fetching**: Added `status` parameter to fetch only deleted records (eliminates duplicate active records)  
✅ **Hardcoded Constants**: Extracted 30-day retention period to `MEDICAL_RECORD_RETENTION_DAYS` constant  
✅ **Assert Statements**: Replaced `assert` with proper `HTTPException` for production safety

## Testing
- ✅ Records with appointments display correctly with timezone
- ✅ Records without appointments don't show appointment line
- ✅ User names display when available
- ✅ Deleted records show countdown in red
- ✅ Deleted records only fetched when trash is expanded
- ✅ All dates display in Taiwan timezone with weekday format
- ✅ No syntax errors or type issues
