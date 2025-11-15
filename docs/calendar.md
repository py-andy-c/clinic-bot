# Calendar View Design - Multi-Practitioner Support

## Overview

This document describes the design for allowing all clinic users to view calendars of all practitioners within their clinic. Currently, only practitioners can access the calendar page and only view their own calendar. This enhancement will enable all users (admins, practitioners, read-only users) to view any practitioner's calendar.

## Objectives

1. **Universal Calendar Access**: All clinic users can access the calendar page
2. **Practitioner Selection**: Users can select which practitioner's calendar to view from a dropdown
3. **Empty Calendar for Non-Practitioners**: Non-practitioners' own calendars will be empty (no appointments or availability), but they can view other practitioners' calendars
4. **Maintain Current Functionality**: Practitioners can still view and manage their own calendars as before

## User Experience Design

### Navigation Changes

**Current State:**
- Calendar page (`/admin/calendar`) is only visible to practitioners in the navigation menu
- Default route for practitioners is `/admin/calendar`

**New State:**
- Calendar page is visible to **all clinic users** in the navigation menu
- Default route for practitioners remains `/admin/calendar`
- Default route for non-practitioners remains `/admin/clinic/members` (or their previous default)

### Calendar Page Layout

#### Header Section

The calendar page header will include:

1. **Page Title**: "行事曆" (Calendar)
2. **Practitioner Selector** (NEW):
   - Dropdown/select component positioned prominently in the header
   - Always displays current practitioner's calendar by default
   - Dropdown lists other practitioners to add to the view
   - For practitioners: Their own calendar is always visible
   - For non-practitioners: First practitioner's calendar is shown by default
3. **Action Button** (Conditional):
   - "新增休診時段" (Add Unavailable Time) button
   - **Always shown for practitioners** (since their calendar is always displayed)
   - **Never shown for non-practitioners**
   - When clicked, adds exception to the current practitioner's own calendar (not to other practitioners' calendars)
   - Button is always available for practitioners regardless of whether other practitioners' calendars are also visible

#### Practitioner Selector Design

**Desktop View:**
- Dropdown positioned in the header, aligned to the right (or next to title)
- Styled as a select dropdown with search capability (if many practitioners)
- Shows "加入其他治療師" (Add Other Practitioners) or similar label
- Lists all other practitioners (excludes current user if they're a practitioner)

**Mobile View:**
- Full-width dropdown below the page title
- Touch-friendly select component

**Selector Behavior:**
- **Default Display**: Always shows current user's calendar (if practitioner) or first practitioner (if non-practitioner)
- **Dropdown Options**: Lists all other practitioners in the clinic
- **Selection**: Selecting a practitioner adds their calendar to the view (multi-select capability)
- **Current User**: If current user is a practitioner, their calendar is always visible and not in the dropdown

#### Calendar View Component

The existing `CalendarView` component will be enhanced to:

1. **Always display current practitioner**: If user is a practitioner, their calendar is always shown
2. **Accept additional practitioners**: Takes `additionalPractitionerIds` prop (array) to display multiple calendars
3. **Multi-practitioner display**: Shows appointments and events from all selected practitioners
   - Current user's events (if practitioner) are always included
   - Additional practitioners' events are added to the view
   - Events can be color-coded or labeled by practitioner
4. **Read-only mode for others**: When viewing other practitioners' calendars:
   - Their events are read-only (no editing, no adding exceptions)
   - Event details are view-only
   - No "Add Unavailable Time" button for other practitioners
5. **Empty state**: If no practitioners are available:
   - Shows empty calendar with helpful message
   - Suggests adding practitioners to the clinic

### User Flows

#### Flow 1: Practitioner Viewing Own Calendar (Current Behavior)

1. Practitioner navigates to `/admin/calendar`
2. Calendar loads with their own calendar (always displayed by default)
3. Practitioner can:
   - View their own appointments and events
   - Add availability exceptions
   - Manage their schedule
   - All current functionality preserved
4. Dropdown shows other practitioners available to add to view

#### Flow 2: Practitioner Adding Another Practitioner to View

1. Practitioner navigates to `/admin/calendar`
2. Calendar loads with their own calendar (always visible)
3. Practitioner selects another practitioner from dropdown
4. Calendar updates to show both calendars:
   - Current practitioner's calendar (editable)
   - Selected practitioner's calendar (read-only, overlaid or side-by-side)
5. Practitioner can:
   - See both practitioners' appointments and events
   - Edit their own calendar
   - View (but not edit) other practitioner's calendar
   - Remove other practitioner from view via dropdown

#### Flow 3: Non-Practitioner Viewing Calendar

1. Non-practitioner navigates to `/admin/calendar` (newly accessible)
2. Calendar loads with first practitioner's calendar (default)
3. Dropdown shows all practitioners
4. Non-practitioner can:
   - View any practitioner's calendar (read-only)
   - Add multiple practitioners to view simultaneously
   - See appointments and availability from selected practitioners
   - Switch between different practitioner combinations

#### Flow 4: Admin Viewing Multiple Practitioners

1. Admin navigates to `/admin/calendar`
2. Calendar loads with first practitioner's calendar (default)
3. Admin can:
   - View any practitioner's calendar
   - Add multiple practitioners to compare schedules
   - Monitor appointment distribution across practitioners
   - All in read-only mode (unless admin is also practitioner viewing own calendar)

## Technical Design

### Frontend Changes

#### 1. Navigation Menu Update

**File**: `frontend/src/components/ClinicLayout.tsx`

**Change**: Update navigation array to show calendar for all users:
```typescript
const navigation = useMemo(() => [
  { name: '行事曆', href: '/admin/calendar', icon: '📅', show: true }, // Changed from isPractitioner to true
  // ... other items
], []);
```

#### 2. AvailabilityPage Component

**File**: `frontend/src/pages/AvailabilityPage.tsx`

**Changes**:
- Always display current user's calendar (if practitioner)
- Add state for additional practitioners to display
- Add practitioner selector dropdown component (multi-select)
- Fetch list of practitioners on mount
- Pass current user ID and additional practitioner IDs to `CalendarView`
- Conditionally show "Add Unavailable Time" button only when:
  - User is a practitioner (their calendar is always displayed)

**New State**:
```typescript
const [additionalPractitionerIds, setAdditionalPractitionerIds] = useState<number[]>([]);
const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
```

**Default Display Logic**:
- If user is practitioner: Always show `user.user_id` calendar
- If user is not practitioner: Show first practitioner's calendar by default
- Additional practitioners can be added via dropdown (multi-select)

#### 3. CalendarView Component

**File**: `frontend/src/components/CalendarView.tsx`

**Changes**:
- Accept `currentUserId` prop (always displayed if practitioner)
- Accept `additionalPractitionerIds` prop (array of practitioner IDs to add to view)
- Fetch and merge calendar data from multiple practitioners
- Display events from all selected practitioners
- Color-code or label events by practitioner
- Allow editing only for current user's calendar (if practitioner)
- Update API calls to fetch data for all selected practitioners

**Props Update**:
```typescript
interface CalendarViewProps {
  currentUserId: number | null; // Always displayed if practitioner
  additionalPractitionerIds?: number[]; // Additional practitioners to display
  onSelectEvent?: (event: CalendarEvent) => void;
  onNavigate?: (date: Date) => void;
  onAddExceptionHandlerReady?: (handler: () => void, view: View) => void;
}
```

#### 4. Practitioner Selector Component

**New File**: `frontend/src/components/PractitionerSelector.tsx`

**Component**:
- Multi-select dropdown component for adding practitioners to view
- Filters out current user (if practitioner) from the list
- Lists all other practitioners with their names
- Handles adding/removing practitioners from view
- Shows selected practitioners as tags/chips that can be removed

**Props**:
```typescript
interface PractitionerSelectorProps {
  practitioners: Practitioner[];
  selectedPractitionerIds: number[]; // Currently selected additional practitioners
  currentUserId: number | null;
  isPractitioner: boolean;
  onChange: (practitionerIds: number[]) => void; // Array of selected practitioner IDs
}
```

#### 5. API Service Updates

**File**: `frontend/src/services/api.ts`

**New Method**:
```typescript
async getPractitioners(): Promise<Practitioner[]> {
  // Fetch list of practitioners for current clinic
  // Returns: Array of { id, full_name } objects
}
```

### Backend Changes

#### 1. Calendar API Permission Update

**File**: `backend/src/api/practitioner_calendar.py`

**Endpoint**: `GET /api/clinic/practitioners/{user_id}/availability/calendar`

**Current Permission Check** (Line 482-487):
```python
# Check permissions - practitioners can only view their own calendar
if current_user.user_type == 'clinic_user' and not current_user.has_role("admin"):
    if current_user.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您只能查看自己的行事曆"
        )
```

**New Permission Check**:
```python
# Check permissions - all clinic users can view any practitioner's calendar
# But only practitioners can edit their own calendar
clinic_id = ensure_clinic_access(current_user)

# Verify practitioner is in the same clinic
user, _ = _verify_practitioner_in_clinic(db, user_id, clinic_id)

# Read-only mode: If viewing another practitioner's calendar, return read-only data
# (This is handled by frontend, but backend can add read_only flag to response)
```

**Changes**:
- Remove restriction that prevents viewing other practitioners' calendars
- Keep clinic isolation (must be in same clinic)
- Verify practitioner exists and is in clinic
- Optionally add `read_only` flag to response when viewing others' calendars

#### 2. Practitioners List Endpoint

**File**: `backend/src/api/clinic.py` or create new endpoint

**New Endpoint**: `GET /api/clinic/practitioners`

**Purpose**: Return list of all practitioners for current clinic

**Response**:
```json
{
  "practitioners": [
    {
      "id": 1,
      "full_name": "Dr. 張三",
      "email": "zhang@example.com"
    },
    {
      "id": 2,
      "full_name": "Dr. 李四",
      "email": "li@example.com"
    }
  ]
}
```

**Permission**: All authenticated clinic users can access this endpoint

**Implementation**:
- Use existing `PractitionerService.list_practitioners_for_clinic()`
- Filter to return only basic info (id, full_name, email)
- Ensure clinic isolation

#### 3. Calendar Response Enhancement

**Optional**: Add `read_only` flag to calendar response when viewing another practitioner's calendar:

```python
class CalendarDayDetailResponse(BaseModel):
    date: str
    default_schedule: List[TimeInterval]
    events: List[CalendarEventResponse]
    read_only: bool = False  # New field
```

## Implementation Considerations

### State Management

- **Selected Practitioner**: Store in component state (not global state)
- **Practitioner List**: Fetch on mount, cache if needed
- **URL Parameter** (Optional): Consider adding `?practitioner_id=123` to URL for shareable links

### Performance

- **Lazy Loading**: Only fetch practitioner list when calendar page is accessed
- **Caching**: Cache practitioner list in component state (refetch on clinic switch)
- **Calendar Data**: Existing calendar data fetching remains unchanged

### Edge Cases

1. **No Practitioners**: If clinic has no practitioners, show empty state with message
2. **Practitioner Removed**: If selected practitioner is removed from clinic, reset to default
3. **Clinic Switch**: When switching clinics, reset to default practitioner for new clinic
4. **Non-Practitioner Own Calendar**: Show helpful empty state message

### Accessibility

- Practitioner selector should be keyboard navigable
- Screen reader announcements when switching practitioners
- Clear labels and ARIA attributes

### Mobile Experience

- Full-width practitioner selector on mobile
- Touch-friendly dropdown
- Calendar view remains responsive as current implementation

## Migration Plan

### Phase 1: Backend API Updates
1. Update calendar API permission checks
2. Add practitioners list endpoint
3. Test API changes

### Phase 2: Frontend Component Updates
1. Create `PractitionerSelector` component
2. Update `AvailabilityPage` to include selector
3. Update `CalendarView` to accept `selectedPractitionerId` and `isReadOnly`
4. Update navigation to show calendar for all users

### Phase 3: Testing
1. Test practitioner viewing own calendar (existing functionality)
2. Test practitioner viewing other practitioners' calendars
3. Test non-practitioner viewing calendars
4. Test admin viewing all calendars
5. Test edge cases (no practitioners, removed practitioner, etc.)

### Phase 4: Deployment
1. Deploy backend changes
2. Deploy frontend changes
3. Monitor for issues
4. Gather user feedback

## Future Enhancements

1. **Multi-Practitioner View**: Show multiple practitioners' calendars side-by-side
2. **Calendar Comparison**: Compare availability across practitioners
3. **Filter by Appointment Type**: Filter calendar view by appointment type
4. **Export Calendar**: Export practitioner calendar as iCal
5. **Calendar Sharing**: Share practitioner calendar via URL with read-only access
6. **Default Practitioner Preference**: Remember last viewed practitioner per user

## Questions & Decisions

### Q1: Should we show "My Calendar" as an option?
**Decision**: No. Current practitioner's calendar is always displayed by default. The dropdown only lists other practitioners to add to the view. This simplifies the UX.

### Q2: Should we persist selected practitioner in URL?
**Decision**: Optional enhancement. For now, keep it in component state. Can add URL parameter later for shareable links.

### Q3: Should calendar be read-only when viewing others, or allow some actions?
**Decision**: Fully read-only when viewing others' calendars. Only practitioners can edit their own calendars.

### Q4: What happens if a practitioner is viewing their own calendar and gets removed from clinic?
**Decision**: If user loses practitioner role but remains in clinic, their calendar becomes empty (non-practitioner state). If user is removed from clinic entirely, they lose access to calendar page.

### Q5: Should admins be able to edit any practitioner's calendar?
**Decision**: No, for now. Keep it simple - only practitioners can edit their own calendars. This can be a future enhancement if needed.

## Summary

This design enables all clinic users to view practitioner calendars with a simplified UX. The key changes are:

1. **Navigation**: Calendar page accessible to all users
2. **Always Display Current User**: If user is a practitioner, their calendar is always visible
3. **Multi-Select Dropdown**: Dropdown to add other practitioners to the view (not replace, but add)
4. **Read-Only Mode**: Other practitioners' calendars are read-only
5. **Backend Permissions**: Remove restriction on viewing other practitioners' calendars (within same clinic)

**Simplified UX Approach:**
- No "My Calendar" option needed - current user's calendar is always shown
- Dropdown only lists other practitioners to add to the view
- Users can see multiple practitioners' calendars simultaneously
- Current practitioner can still edit their own calendar

The implementation maintains backward compatibility while providing a cleaner, more intuitive user experience.

