# Patient Detail Page: Edit and Delete Appointment Feature

## Goal

Add edit and delete appointment functionality to the patient detail page. Each future appointment should have an "Edit Appointment" and "Delete Appointment" button. The user experience should be identical to the calendar page's edit and delete appointment flow, but without redirecting away from the patient detail page.

## Requirements

1. **Edit Appointment Button**
   - Should appear on each future appointment in the patient detail page
   - Opens the same `EditAppointmentModal` used in the calendar page
   - Original appointment information should be pre-populated
   - Should prompt for 備注 (notification note) when applicable
   - Should show preview of LINE messages when applicable
   - User experience should be exactly the same as calendar page edit flow
   - After successful edit, stay on patient detail page and refresh appointments list

2. **Delete Appointment Button**
   - Should appear on each future appointment in the patient detail page
   - Opens the same delete flow modals used in the calendar page:
     - `CancellationNoteModal` (for entering optional cancellation note)
     - `CancellationPreviewModal` (for previewing LINE message)
   - User experience should be exactly the same as calendar page delete flow
   - After successful delete, stay on patient detail page and refresh appointments list

3. **Code Sharing**
   - Reuse existing modal components without modification
   - Share as much code as possible between calendar page and patient detail page
   - Avoid code duplication

## Current Implementation Analysis

### Calendar Page Edit Flow

The calendar page uses the following flow for editing appointments:

1. User clicks on appointment event → opens `EventModal`
2. User clicks "編輯預約" button → opens `EditAppointmentModal`
3. `EditAppointmentModal` handles multiple steps:
   - **Form step**: Select practitioner, date, time
   - **Review step**: Show original vs new appointment details
   - **Note step**: Enter optional notification note (備注)
   - **Preview step**: Show LINE message preview
4. On confirm, calls `handleConfirmEditAppointment` which:
   - Calls `apiService.editClinicAppointment()`
   - Invalidates cache for affected dates
   - Refreshes calendar data
   - Closes modal

### Calendar Page Delete Flow

The calendar page uses the following flow for deleting appointments:

1. User clicks on appointment event → opens `EventModal`
2. User clicks "刪除預約" button → opens `CancellationNoteModal`
3. User enters optional cancellation note → clicks "下一步"
4. System generates preview → opens `CancellationPreviewModal`
5. User reviews preview → clicks "確認取消預約"
6. System calls `apiService.cancelClinicAppointment()`
7. Invalidates cache and refreshes calendar data

### Patient Detail Page Current State

- `PatientAppointmentsList` component displays appointments in tabs (future, completed, cancelled)
- Future appointments are displayed as cards with:
  - Appointment type name
  - Date and time
  - Practitioner name
  - Status badge
  - Patient notes (if available)
- No edit/delete functionality currently exists
- Appointments are fetched via `apiService.getPatientAppointments()`

### Data Structure Differences

**Calendar Page:**
- Uses `CalendarEvent` type with `start: Date`, `end: Date`, and rich `resource` object
- Includes fields like `calendar_event_id`, `appointment_id`, `line_display_name`, etc.

**Patient Detail Page:**
- Uses simpler appointment object from `getPatientAppointments()`:
  ```typescript
  {
    id: number;  // Currently this is calendar_event_id (see note below)
    patient_id: number;
    patient_name: string;
    practitioner_name: string;
    appointment_type_name: string;
    start_time: string;  // ISO string
    end_time: string;    // ISO string
    status: string;
    notes?: string | null;
  }
  ```

**Important Note on ID Confusion:**
- The current backend response uses `id: appointment.calendar_event_id` (line 579 in `appointment_service.py`)
- Both edit and delete APIs use parameter names like `appointment_id`, but they actually expect `calendar_event_id`:
  - Edit API: `PUT /appointments/{appointment_id}` - actually uses `calendar_event_id` internally
  - Delete API: `DELETE /appointments/{appointment_id}` - actually uses `calendar_event_id` internally
- The current `id` field in the response works for both APIs, but we'll add an explicit `calendar_event_id` field for clarity

**Missing fields needed for modals:**
- `calendar_event_id` (explicit field - currently available as `id`, but we'll add explicit field)
- `appointment_type_id` (required for edit modal - currently missing)
- `practitioner_id` (required for edit modal - currently missing, available as `appointment.calendar_event.user_id`)
- `line_display_name` (to determine if LINE user exists - currently missing, requires joining with `Patient.line_user`)
- `originally_auto_assigned` (for edit modal logic - available in Appointment model but not in response)

## Implementation Plan

### Phase 1: Enhance Backend API Response

**File:** `backend/src/services/appointment_service.py` and `backend/src/api/clinic.py`

Modify `list_appointments_for_patient` method and `get_patient_appointments` endpoint to include additional fields needed for edit/delete functionality.

**Backend Service Changes (`appointment_service.py`):**

1. Update the query to eagerly load `Patient.line_user` relationship:
   ```python
   # In list_appointments_for_patient method, update the query:
   appointments: List[Appointment] = query.options(
       contains_eager(Appointment.calendar_event).joinedload(CalendarEvent.user),
       joinedload(Appointment.appointment_type),
       joinedload(Appointment.patient).joinedload(Patient.line_user),  # ADD THIS
   ).order_by(CalendarEvent.date.desc(), CalendarEvent.start_time.desc()).all()
   ```

2. Update the result dictionary to include new fields:
   ```python
   result.append({
       "id": appointment.calendar_event_id,  # Keep for backward compatibility
       "calendar_event_id": appointment.calendar_event_id,  # NEW - explicit field
       "patient_id": appointment.patient_id,
       "patient_name": patient_obj.full_name,
       "practitioner_id": appointment.calendar_event.user_id,  # NEW
       "practitioner_name": practitioner_name,
       "appointment_type_id": appointment.appointment_type_id,  # NEW
       "appointment_type_name": get_appointment_type_name_safe(appointment.appointment_type_id, db),
       "start_time": start_datetime.isoformat() if start_datetime else "",
       "end_time": end_datetime.isoformat() if end_datetime else "",
       "status": appointment.status,
       "notes": appointment.notes,
       "line_display_name": patient_obj.line_user.effective_display_name if patient_obj.line_user else None,  # NEW
       "originally_auto_assigned": appointment.originally_auto_assigned,  # NEW
   })
   ```

**API Response Model Changes (`clinic.py`):**

Update `AppointmentListItem` model (if it exists) or ensure the response includes:
```python
class AppointmentListItem(BaseModel):
    id: int  # calendar_event_id (keep for backward compatibility)
    calendar_event_id: int  # NEW - explicit field
    patient_id: int
    patient_name: str
    practitioner_id: int  # NEW
    practitioner_name: str
    appointment_type_id: int  # NEW
    appointment_type_name: str
    start_time: str
    end_time: str
    status: str
    notes: Optional[str]
    line_display_name: Optional[str] = None  # NEW
    originally_auto_assigned: bool = False  # NEW
```

**Performance Considerations:**
- The eager loading of `Patient.line_user` adds one join, which should be minimal performance impact
- Consider adding an index on `Patient.line_user_id` if not already present

### Phase 2: Update Frontend Types

**File:** `frontend/src/services/api.ts`

Update the `getPatientAppointments` return type to include new fields:

```typescript
appointments: Array<{
  id: number;  // calendar_event_id (kept for backward compatibility)
  calendar_event_id: number;  // NEW - explicit field
  patient_id: number;
  patient_name: string;
  practitioner_id: number;  // NEW
  practitioner_name: string;
  appointment_type_id: number;  // NEW
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: string;
  notes?: string | null;
  line_display_name?: string | null;  // NEW
  originally_auto_assigned?: boolean;  // NEW
}>;
```

### Phase 3: Create Appointment to CalendarEvent Converter

**File:** `frontend/src/components/patient/appointmentUtils.ts` (new utility file)

Create a helper function to convert appointment data to `CalendarEvent` format. This function should be defensive and handle both old and new API formats during transition:

```typescript
import moment from 'moment-timezone';
import { CalendarEvent } from '../../utils/calendarDataAdapter';

interface Appointment {
  id: number;  // calendar_event_id (old format)
  calendar_event_id?: number;  // explicit field (new format)
  patient_id: number;
  patient_name: string;
  practitioner_id?: number;
  practitioner_name: string;
  appointment_type_id?: number;
  appointment_type_name: string;
  start_time: string;
  end_time: string;
  status: string;
  notes?: string | null;
  line_display_name?: string | null;
  originally_auto_assigned?: boolean;
}

/**
 * Converts appointment data from patient appointments API to CalendarEvent format.
 * Handles both old API format (id = calendar_event_id) and new format (explicit calendar_event_id field).
 * 
 * @param appointment - Appointment data from getPatientAppointments API
 * @returns CalendarEvent object compatible with calendar modals
 * @throws Error if required fields are missing
 */
export function appointmentToCalendarEvent(appointment: Appointment): CalendarEvent {
  // Handle both old API format (id = calendar_event_id) and new format (explicit calendar_event_id field)
  const calendarEventId = appointment.calendar_event_id ?? appointment.id;
  
  if (!calendarEventId) {
    throw new Error('Missing calendar_event_id in appointment data');
  }
  
  // Validate required fields
  if (!appointment.start_time || !appointment.end_time) {
    throw new Error('Missing start_time or end_time in appointment data');
  }
  
  const startMoment = moment.tz(appointment.start_time, 'Asia/Taipei');
  const endMoment = moment.tz(appointment.end_time, 'Asia/Taipei');
  
  // Validate dates are valid
  if (!startMoment.isValid() || !endMoment.isValid()) {
    throw new Error('Invalid date format in appointment data');
  }
  
  return {
    id: calendarEventId,
    title: `${appointment.patient_name} - ${appointment.appointment_type_name}`,
    start: startMoment.toDate(),
    end: endMoment.toDate(),
    resource: {
      type: 'appointment',
      calendar_event_id: calendarEventId,
      // Note: appointment_id is not needed for delete API (it uses calendar_event_id)
      // But we include it for consistency with CalendarEvent type
      appointment_id: calendarEventId,  // Same as calendar_event_id for these APIs
      patient_id: appointment.patient_id,
      patient_name: appointment.patient_name,
      practitioner_id: appointment.practitioner_id ?? undefined,
      practitioner_name: appointment.practitioner_name,
      appointment_type_id: appointment.appointment_type_id ?? undefined,
      appointment_type_name: appointment.appointment_type_name,
      status: appointment.status,
      notes: appointment.notes || undefined,
      line_display_name: appointment.line_display_name || undefined,
      originally_auto_assigned: appointment.originally_auto_assigned ?? false,
    },
  };
}
```

**Location Decision:** Create a new utility file `frontend/src/components/patient/appointmentUtils.ts` to keep patient-specific utilities organized and easy to find.

### Phase 4: Add Edit/Delete Buttons to PatientAppointmentsList

**File:** `frontend/src/components/patient/PatientAppointmentsList.tsx`

**Changes:**

1. Add state for modals:
   
   **Option A: Individual State Variables (Simpler, recommended for initial implementation):**
   ```typescript
   const [editingAppointment, setEditingAppointment] = useState<CalendarEvent | null>(null);
   const [deletingAppointment, setDeletingAppointment] = useState<CalendarEvent | null>(null);
   const [cancellationNote, setCancellationNote] = useState<string>('');
   const [cancellationPreviewMessage, setCancellationPreviewMessage] = useState<string>('');
   const [cancellationPreviewLoading, setCancellationPreviewLoading] = useState(false);
   const [deleteStep, setDeleteStep] = useState<'note' | 'preview' | null>(null);
   const [editErrorMessage, setEditErrorMessage] = useState<string | null>(null);
   ```
   
   **Option B: Combined State Objects (Better for complex state, consider if state grows):**
   ```typescript
   const [editState, setEditState] = useState<{
     appointment: CalendarEvent | null;
     error: string | null;
   }>({ appointment: null, error: null });
   
   const [deleteState, setDeleteState] = useState<{
     appointment: CalendarEvent | null;
     step: 'note' | 'preview' | null;
     note: string;
     previewMessage: string;
     loading: boolean;
   }>({ 
     appointment: null, 
     step: null, 
     note: '', 
     previewMessage: '', 
     loading: false 
   });
   ```
   
   **Recommendation:** Start with Option A for simplicity. Refactor to Option B if state management becomes complex or if you need to add more state variables later.

2. Add props to component:
   - `practitioners`: Array of practitioners (from parent)
   - `appointmentTypes`: Array of appointment types (from parent)

3. Add edit and delete buttons to each future appointment card:
   
   **Button Placement:** Place buttons in the top-right area of each appointment card, next to the status badge. Use flexbox layout for proper alignment.
   
   ```tsx
   <div className="flex justify-between items-start mb-2 gap-2">
     <div className="flex-1 min-w-0">
       <h3 className="font-medium text-gray-900">
         {appointment.appointment_type_name}
       </h3>
       <p className="text-sm text-gray-600 mt-1">
         {formatAppointmentTime(
           new Date(appointment.start_time),
           new Date(appointment.end_time)
         )}
       </p>
     </div>
     <div className="flex-shrink-0 flex items-center gap-2">
       {renderStatusBadge(appointment.status) && (
         <div className="flex-shrink-0">{renderStatusBadge(appointment.status)}</div>
       )}
       {activeTab === 'future' && (
         <>
           <button
             onClick={() => {
               try {
                 const event = appointmentToCalendarEvent(appointment);
                 setEditingAppointment(event);
                 setEditErrorMessage(null);
               } catch (error) {
                 logger.error('Error converting appointment to calendar event:', error);
                 alert('無法載入預約資料，請重新整理頁面');
               }
             }}
             className="btn-primary bg-blue-600 hover:bg-blue-700 text-sm px-3 py-1.5"
             aria-label="編輯預約"
           >
             編輯預約
           </button>
           <button
             onClick={() => {
               try {
                 const event = appointmentToCalendarEvent(appointment);
                 setDeletingAppointment(event);
                 setCancellationNote('');
                 setCancellationPreviewMessage('');
                 setDeleteStep('note');
               } catch (error) {
                 logger.error('Error converting appointment to calendar event:', error);
                 alert('無法載入預約資料，請重新整理頁面');
               }
             }}
             className="btn-primary bg-red-600 hover:bg-red-700 text-sm px-3 py-1.5"
             aria-label="刪除預約"
           >
             刪除預約
           </button>
         </>
       )}
     </div>
   </div>
   ```
   
   **Accessibility:** 
   - Add `aria-label` attributes for screen readers
   - Ensure buttons are keyboard accessible
   - Maintain proper focus order
   
   **Responsive Design:**
   - On mobile, consider stacking buttons vertically or using icon buttons
   - Ensure buttons don't overflow on small screens

5. Add edit handler with proper error handling:
   ```typescript
   const { alert } = useModal();  // Get alert from useModal hook
   
   const handleEditConfirm = async (formData: {
     practitioner_id: number | null;
     start_time: string;
     notes?: string;
     notification_note?: string;
   }) => {
     if (!editingAppointment) return;
     
     try {
       await apiService.editClinicAppointment(
         editingAppointment.resource.calendar_event_id,
         formData
       );
       
       // Invalidate cache for appointments list
       invalidateCacheForFunction(fetchAppointments);
       
       // Also invalidate calendar cache if user has calendar page open
       // This ensures consistency across pages
       const appointmentDate = moment(formData.start_time).format('YYYY-MM-DD');
       // Note: Calendar cache invalidation would need to be done via a shared cache key
       // For now, we'll just invalidate the appointments list
       
       // Refetch appointments
       await refetch();
       
       setEditingAppointment(null);
       setEditErrorMessage(null);
       await alert('預約已更新');
     } catch (error) {
       logger.error('Error editing appointment:', error);
       const errorMessage = getErrorMessage(error);
       setEditErrorMessage(errorMessage);
       // Don't throw - let the modal handle the error display
       // The modal will show the error message and allow user to retry or cancel
     }
   };
   ```
   
   **Note on Cache Invalidation:**
   - We invalidate the appointments list cache to refresh the UI
   - If the user has the calendar page open, they may see stale data until they refresh
   - This is acceptable as the primary use case is editing from patient detail page
   - Future enhancement: implement shared cache keys for cross-page invalidation

6. Add delete handlers with proper error handling:
   ```typescript
   const { alert } = useModal();  // Get alert from useModal hook
   
   const handleCancellationNoteSubmit = async () => {
     if (!deletingAppointment) return;
     
     setCancellationPreviewLoading(true);
     try {
       const response = await apiService.generateCancellationPreview({
         appointment_type: deletingAppointment.resource.appointment_type_name || '',
         appointment_time: formatAppointmentTime(
           deletingAppointment.start,
           deletingAppointment.end
         ),
         therapist_name: deletingAppointment.resource.practitioner_name || '',
         patient_name: deletingAppointment.resource.patient_name || '',
         ...(cancellationNote.trim() && { note: cancellationNote.trim() }),
       });
       
       setCancellationPreviewMessage(response.preview_message);
       setDeleteStep('preview');
     } catch (error) {
       logger.error('Error generating cancellation preview:', error);
       const errorMessage = getErrorMessage(error);
       await alert(`無法產生預覽訊息：${errorMessage}`, '錯誤');
       // Stay on note step so user can retry
     } finally {
       setCancellationPreviewLoading(false);
     }
   };
   
   const handleConfirmDelete = async () => {
     if (!deletingAppointment || !deletingAppointment.resource.calendar_event_id) return;
     
     try {
       // Note: cancelClinicAppointment API uses calendar_event_id despite parameter name
       await apiService.cancelClinicAppointment(
         deletingAppointment.resource.calendar_event_id,
         cancellationNote.trim() || undefined
       );
       
       // Invalidate cache for appointments list
       invalidateCacheForFunction(fetchAppointments);
       
       // Refetch appointments
       await refetch();
       
       setDeletingAppointment(null);
       setCancellationNote('');
       setCancellationPreviewMessage('');
       setDeleteStep(null);
       await alert('預約已取消');
     } catch (error) {
       logger.error('Error deleting appointment:', error);
       const errorMessage = getErrorMessage(error);
       await alert(`取消預約失敗：${errorMessage}`, '錯誤');
       // Stay on preview step so user can retry or go back
     }
   };
   ```
   
   **Important:** The `cancelClinicAppointment` API parameter is named `appointment_id` but actually expects `calendar_event_id`. We use `calendar_event_id` from the resource object.

7. Render modals:
   ```tsx
   {/* Edit Appointment Modal */}
   {editingAppointment && (
     <EditAppointmentModal
       event={editingAppointment}
       practitioners={practitioners}
       appointmentTypes={appointmentTypes}
       onClose={() => {
         setEditingAppointment(null);
         setEditErrorMessage(null);
       }}
       onConfirm={handleEditConfirm}
       formatAppointmentTime={(start, end) => {
         const startMoment = moment(start).tz('Asia/Taipei');
         const endMoment = moment(end).tz('Asia/Taipei');
         return `${startMoment.format('YYYY-MM-DD HH:mm')} - ${endMoment.format('HH:mm')}`;
       }}
       errorMessage={editErrorMessage}
     />
   )}
   
   {/* Cancellation Note Modal */}
   {deletingAppointment && deleteStep === 'note' && (
     <CancellationNoteModal
       cancellationNote={cancellationNote}
       isLoading={cancellationPreviewLoading}
       onNoteChange={setCancellationNote}
       onBack={() => {
         setDeletingAppointment(null);
         setDeleteStep(null);
         setCancellationNote('');
       }}
       onSubmit={handleCancellationNoteSubmit}
     />
   )}
   
   {/* Cancellation Preview Modal */}
   {deletingAppointment && deleteStep === 'preview' && (
     <CancellationPreviewModal
       previewMessage={cancellationPreviewMessage}
       onBack={() => setDeleteStep('note')}
       onConfirm={handleConfirmDelete}
     />
   )}
   ```

### Phase 5: Update PatientDetailPage

**File:** `frontend/src/pages/PatientDetailPage.tsx`

**Changes:**

1. **Ensure practitioners and appointment types are always fetched:**
   - Currently, practitioners are only fetched when `isAppointmentModalOpen` is true
   - Update to always fetch practitioners when component mounts (needed for edit/delete buttons)
   - Appointment types are already fetched via `getClinicSettings()`

2. **Update component to pass required props:**
   ```tsx
   <PatientAppointmentsList
     patientId={patient.id}
     practitioners={practitioners}
     appointmentTypes={appointmentTypes}
   />
   ```

3. **Data Fetching Strategy:**
   ```typescript
   // Fetch practitioners on mount (not just when modal opens)
   useEffect(() => {
     const fetchPractitioners = async () => {
       try {
         const data = await apiService.getPractitioners();
         setPractitioners(data);
       } catch (error) {
         logger.error('Error fetching practitioners:', error);
       }
     };
     
     if (practitioners.length === 0) {
       fetchPractitioners();
     }
   }, [practitioners.length]);
   ```
   
   **Alternative:** Fetch practitioners inside `PatientAppointmentsList` if parent doesn't already have them. This keeps data fetching closer to where it's used.

### Phase 6: Import Required Components and Utilities

**File:** `frontend/src/components/patient/PatientAppointmentsList.tsx`

Add imports:
```typescript
import { EditAppointmentModal } from '../calendar/EditAppointmentModal';
import { CancellationNoteModal } from '../calendar/CancellationNoteModal';
import { CancellationPreviewModal } from '../calendar/CancellationPreviewModal';
import { CalendarEvent } from '../../utils/calendarDataAdapter';
import { invalidateCacheForFunction } from '../../hooks/useApiData';
import { useModal } from '../../contexts/ModalContext';
import { formatAppointmentTime } from '../../utils/calendarUtils';
import { appointmentToCalendarEvent } from './appointmentUtils';
import { getErrorMessage } from '../../types/api';
import { logger } from '../../utils/logger';
import moment from 'moment-timezone';
```

**Note:** 
- `formatAppointmentTime` is already imported in the current file (line 6), so this is just ensuring all needed imports are present
- The `appointmentToCalendarEvent` function is imported from the new utility file created in Phase 3

## Important Technical Notes

### API Parameter Naming Confusion

**Critical Understanding:** The edit and delete APIs use parameter names that are misleading:

- **Edit API:** `PUT /appointments/{appointment_id}` 
  - Parameter name: `appointment_id`
  - **Actually expects:** `calendar_event_id`
  - Implementation: `Appointment.calendar_event_id == appointment_id` (line 2066 in `clinic.py`)

- **Delete API:** `DELETE /appointments/{appointment_id}`
  - Parameter name: `appointment_id`
  - **Actually expects:** `calendar_event_id`
  - Implementation: `CalendarEvent.id == appointment_id` (line 1766 in `clinic.py`)
  - Service method: `Appointment.calendar_event_id == appointment_id` (line 626 in `appointment_service.py`)

**Why This Matters:**
- The current backend response includes `id: appointment.calendar_event_id`, which works correctly
- We're adding an explicit `calendar_event_id` field for clarity
- The converter function should use `calendar_event_id` (or fallback to `id`) when calling these APIs
- **Do not confuse with `Appointment.id`** (the actual appointment primary key) - this is not used by these APIs

**Documentation:** This naming confusion is documented in the service method docstring (line 608 in `appointment_service.py`): "appointment_id: Calendar event ID of the appointment"

## Code Sharing Strategy

### Reused Components (No Changes Needed)

1. **EditAppointmentModal** - Fully reusable as-is
2. **CancellationNoteModal** - Fully reusable as-is
3. **CancellationPreviewModal** - Fully reusable as-is
4. **BaseModal** - Already shared base component

### Shared Utilities

1. **formatAppointmentTime** - Already shared utility function
2. **getErrorMessage** - Already shared utility function
3. **apiService methods** - Already shared:
   - `editClinicAppointment()`
   - `cancelClinicAppointment()`
   - `generateCancellationPreview()`
   - `previewEditNotification()`

### New Shared Code

1. **appointmentToCalendarEvent converter** - Can be placed in:
   - Option A: `frontend/src/utils/calendarDataAdapter.ts` (if it makes sense to extend this file)
   - Option B: `frontend/src/components/patient/appointmentUtils.ts` (new utility file)
   - Option C: Inline in `PatientAppointmentsList.tsx` (if it's only used there)

   **Recommendation:** Option B - Create a new utility file for patient-specific appointment utilities. This keeps concerns separated and makes it easy to find patient-related utilities.

## Testing Considerations

1. **Edit Flow:**
   - Test editing practitioner
   - Test editing time
   - Test editing both practitioner and time
   - Test with LINE user (should show note and preview steps)
   - Test without LINE user (should skip note and preview steps)
   - Test with originally auto-assigned appointments
   - Test error handling (validation errors, API errors)
   - Verify appointments list refreshes after edit

2. **Delete Flow:**
   - Test deletion with cancellation note
   - Test deletion without cancellation note
   - Test with LINE user (should show note and preview steps)
   - Test without LINE user (should still work)
   - Test error handling
   - Verify appointments list refreshes after delete
   - Verify appointment moves to "已取消" tab after deletion

3. **UI/UX:**
   - Verify buttons only show on future appointments
   - Verify buttons are properly styled and positioned
   - Verify modals open and close correctly
   - Verify user stays on patient detail page after operations

## Edge Cases

1. **Missing Data:**
   - Handle case where `calendar_event_id` is missing (should not show edit/delete buttons)
   - Handle case where `appointment_type_id` is missing (edit modal should handle gracefully)
   - Handle case where `practitioner_id` is missing (edit modal should handle gracefully)

2. **Permissions:**
   - **Backend Validation:** The APIs (`editClinicAppointment`, `cancelClinicAppointment`) already validate permissions:
     - Practitioners can only edit/delete their own appointments
     - Admins can edit/delete any appointment in their clinic
     - Read-only users cannot edit/delete
   - **Frontend Handling:**
     - Buttons should be visible to all users (backend will reject unauthorized requests)
     - On permission error, show appropriate error message from backend
     - Consider hiding buttons for read-only users if user role is known (optional optimization)
   - **Error Messages:**
     - "您只能編輯自己的預約" - Practitioner trying to edit another's appointment
     - "您只能取消自己的預約" - Practitioner trying to delete another's appointment
     - "您沒有權限編輯預約" - Read-only user attempting to edit

3. **Concurrent Edits:**
   - If appointment is edited/deleted from calendar page while patient detail page is open, refresh should handle it

4. **Network Errors:**
   - Handle network failures gracefully
   - Show appropriate error messages
   - Allow retry

## Migration Notes

- **No database migration needed** - All required data already exists in the database
- **Backend API changes are backward compatible:**
  - Adding new fields to response (existing `id` field remains for backward compatibility)
  - No breaking changes to existing API contract
- **Frontend changes are additive:**
  - New buttons and modals added
  - Existing appointment display functionality remains unchanged
  - Converter function handles both old and new API formats
- **Deployment Strategy:**
  - Backend can be deployed first (new fields will be available)
  - Frontend can be deployed after backend (will work with both old and new formats)
  - No coordination required between deployments

## Known Limitations

1. **Cache Invalidation:**
   - Editing/deleting from patient detail page doesn't invalidate calendar page cache
   - If user has both pages open, calendar page may show stale data until refresh
   - This is acceptable as primary use case is single-page editing

2. **API Parameter Naming:**
   - Edit and delete APIs use parameter name `appointment_id` but actually expect `calendar_event_id`
   - This is confusing but functionally correct
   - Documented in code comments and this design doc

3. **Loading States:**
   - Buttons don't show loading state during operations (modals handle their own loading)
   - Consider adding button disabled state during operations to prevent double-clicks

4. **Success Feedback:**
   - Currently uses `alert()` for success messages
   - Consider implementing toast notifications for better UX (future enhancement)

## Future Enhancements (Out of Scope)

- Add edit/delete to completed appointments (if needed)
- Add bulk edit/delete operations
- Add undo functionality
- Add appointment history/audit log

