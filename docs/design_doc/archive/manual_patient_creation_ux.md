# Manual Patient Creation - UX Design Document

## Overview

This document describes the user experience design for clinic users (admins and practitioners) to manually create patient records. This feature enables clinics to register walk-in patients, patients who don't use LINE, and patients who visit before setting up their LINE account.

## Phase 1 Features

The following features are included in Phase 1 implementation:

1. **Manual Patient Creation**
   - Clinic users (admin/practitioner) can create patients via form modal
   - Required field: Name only
   - Optional fields: Phone number, Birthday (both always shown)
   - Phone validation only if provided (empty phone allowed)
   - Duplicate phone numbers allowed

2. **Duplicate Name Detection** ⭐
   - Real-time warning as user types name (debounced, 400ms)
   - Exact name matching (case-insensitive)
   - Shows count of existing patients with same name
   - Non-blocking warning (does not prevent creation)
   - New endpoint: `GET /clinic/patients/check-duplicate?name={name}`

3. **Success Confirmation Modal**
   - Modal with "新增預約" button to create appointment
   - X button to close (no auto-close)
   - Navigates to calendar with patient pre-selected

4. **UI Enhancements**
   - "新增病患" button on Patients page (hidden during search)
   - Integration with Calendar page for appointment creation

## Design Principles

1. **Simplicity**: Minimal steps, clear form fields
2. **Consistency**: Follow existing UI patterns from the clinic admin interface
3. **Efficiency**: Quick creation for busy clinic staff
4. **Error Prevention**: Real-time validation and clear error messages
5. **Context Awareness**: Show relevant information (e.g., birthday requirement based on clinic settings)

## User Roles & Permissions

- **Admin**: Can create patients
- **Practitioner**: Can create patients
- **Read-only**: Cannot create patients (no access to create button)

## User Flows

### Primary Flow: Creating a New Patient

```
1. User navigates to Patients Page (/admin/clinic/patients)
2. User clicks "新增病患" (Add Patient) button
3. Modal opens with patient creation form
4. User fills in:
   - 姓名 (Full Name) - Required
   - 手機號碼 (Phone Number) - Optional (always shown)
   - 生日 (Birthday) - Optional (always shown)
5. User clicks "建立" (Create) button
6. System validates input
7. If valid: 
   - Patient created
   - Patient creation modal closes
   - Success confirmation modal opens (with "新增預約" button and X button)
   - User can create appointment or close modal
8. If invalid: Error message shown in form, user can correct and retry
```

### Secondary Flow: Creating Patient from Calendar Page

```
1. User navigates to Calendar Page (/admin/calendar)
2. User clicks on a time slot to create appointment
3. In appointment creation modal, user can:
   - Select existing patient from dropdown
   - Click "新增病患" (Add New Patient) link/button
4. Patient creation modal opens (same as primary flow)
5. After patient is created, appointment modal reopens with new patient pre-selected
```

## UI Components & Layout

### 1. Patients Page Enhancement

#### Current State
- Table showing all patients
- Search functionality
- Pagination
- "新增預約" (Create Appointment) button per patient

#### New State
- **Add "新增病患" (Add Patient) button** in the page header area
  - Position: Top-right, next to search bar
  - Style: Primary button (blue background, white text)
  - Icon: Plus (+) icon
  - Only visible to admin and practitioner roles
  - **Hidden when user is searching**: Button is hidden when search input has value

#### Button Placement
```
┌─────────────────────────────────────────────────────┐
│  病患管理                                    [新增病患] │
│  (Button hidden when searching)                    │
├─────────────────────────────────────────────────────┤
│  [搜尋病患姓名、電話或LINE使用者名稱...]              │
├─────────────────────────────────────────────────────┤
│  [Patient Table]                                     │
└─────────────────────────────────────────────────────┘
```

### 2. Patient Creation Modal

#### Modal Structure
- **Title**: "新增病患" (Add Patient)
- **Size**: Medium (max-width: 500px)
- **Position**: Centered overlay
- **Close**: X button in top-right, or click outside to close

#### Duplicate Detection (Phase 1)
- **When**: As user types in the "姓名" (Full Name) field
- **Trigger**: Debounced check (400ms delay after user stops typing)
- **Method**: New endpoint or query for exact name matching
  - **Exact match only** - checks for patients with identical name
  - Case-insensitive matching (e.g., "王小明" matches "王小明" exactly)
  - Does NOT use existing search API (which does partial matching)
- **Display**: Show warning message below name field if matches found
- **Warning Message**: "發現 {count} 位同名病患，請確認是否為重複建立" (Found {count} patients with the same name, please confirm if this is a duplicate)
- **Style**: Yellow/orange warning box with info icon
- **Non-blocking**: Warning does not prevent form submission
- **Behavior**: 
  - Only checks when name field has value (2+ characters, trimmed)
  - Clears warning when name field is cleared
  - Updates count as user types (debounced)
- **Exact Match**: Only matches patients with identical name (no partial matches)

#### Form Fields

**Field 1: 姓名 (Full Name)**
- Type: Text input
- Required: Yes
- Placeholder: "請輸入病患姓名（與健保卡上相同）"
- Validation:
  - Cannot be empty
  - Max length: 255 characters
  - Show error: "請輸入病患姓名"
- Helper text: "請輸入與健保卡上相同的姓名"
- **Duplicate Detection**:
  - Triggers when name has 2+ characters (trimmed)
  - Debounced check (400ms delay)
  - Calls new endpoint or query for exact name matching
  - **Exact match only** - checks for patients with identical name (case-insensitive)
  - Shows warning if count > 0: "發現 {count} 位同名病患，請確認是否為重複建立"
  - Warning is informational only (does not block submission)
  - **No false positives** - only matches exact name matches

**Field 2: 手機號碼 (Phone Number)**
- Type: Tel input
- Required: No (optional)
- Placeholder: "0912345678（選填）"
- Validation:
  - **If empty**: No validation - patient can be created without phone number
  - **If provided**: Must be valid Taiwan phone number (10 digits, starts with 09)
  - Auto-format: Remove spaces, dashes, parentheses
  - Show error only if phone is provided and invalid: "請輸入有效的手機號碼（10碼，以09開頭）"
- Helper text: "選填：請輸入10碼手機號碼，例如：0912345678"
- Visibility: Always shown
- **Important**: Duplicate phone numbers are allowed (multiple patients can share the same phone number)

**Field 3: 生日 (Birthday)**
- Type: Date picker
- Required: No (optional)
- Placeholder: "YYYY/MM/DD（選填）" or date picker
- Validation:
  - If provided: Must be valid date
  - Cannot be in the future
  - Show error: "請輸入有效的日期"
- Helper text: "選填：請輸入病患生日"
- Visibility: Always shown

#### Form Layout
```
┌─────────────────────────────────────────┐
│  新增病患                          [×]  │
├─────────────────────────────────────────┤
│                                          │
│  姓名 *                                  │
│  [_____________________________]        │
│  請輸入與健保卡上相同的姓名              │
│  ⚠️ 發現 3 位同名病患，請確認是否為重複建立│
│                                          │
│  手機號碼（選填）                        │
│  [_____________________________]        │
│  選填：請輸入10碼手機號碼，例如：0912345678│
│                                          │
│  生日（選填）                            │
│  [_____________________________]        │
│  選填：請輸入病患生日                    │
│                                          │
│  [Error message if validation fails]    │
│                                          │
│          [取消]        [建立]           │
└─────────────────────────────────────────┘
```

#### Button States

**Create Button (建立)**
- Default: Blue background, white text, enabled when form is valid
- Disabled: Gray background, gray text, when:
  - Name is empty
  - Phone is provided but invalid format (empty phone is allowed)
  - Birthday is provided but invalid date (empty birthday is allowed)
  - Form is submitting
- **Note**: Button is enabled as long as name is provided, even if phone and birthday are empty
- Loading: Show spinner + "建立中..." (Creating...)
- Success: Button returns to normal state, patient creation modal closes, success confirmation modal opens

**Cancel Button (取消)**
- Default: Gray background, gray text
- Action: Closes modal, discards form data
- Always enabled (except during submission)

### 3. Success Confirmation Modal

#### Success Modal Structure
- **Type**: Modal dialog (does NOT auto-close)
- **Title**: "病患已成功建立" (Patient created successfully)
- **Size**: Medium (max-width: 500px)
- **Position**: Centered overlay
- **Close**: X button in top-right corner
- **Style**: Success theme (green checkmark icon, positive messaging)

#### Success Modal Content
- **Icon**: Green checkmark (✓) or success icon
- **Message**: "病患已成功建立" (Patient created successfully)
- **Patient Info** (optional): Show created patient name
- **Actions**:
  - **新增預約** (Create Appointment) button - Primary action
    - Navigates to calendar page with patient pre-selected
    - Closes success modal
    - Opens appointment creation flow
  - **X button** (top-right corner) - Close action
    - Closes success modal
    - Returns to patient list

#### Success Modal Layout
```
┌──────────────────────────────────────┐
│  病患已成功建立                  [×]  │
├──────────────────────────────────────┤
│                                       │
│            ✓                          │
│                                       │
│      病患已成功建立                   │
│                                       │
│      病患：王小明                     │
│      (Optional patient name display) │
│                                       │
│                                       │
│              [新增預約]               │
│                                       │
└──────────────────────────────────────┘
```

#### Post-Creation Actions
1. Patient creation modal closes
2. Success confirmation modal opens (does NOT auto-close)
3. User can:
   - Click "新增預約" to create appointment (navigates to calendar)
   - Click X button (top-right) to close modal and return to patient list
4. Patient list refreshes when user returns to it
5. New patient appears in the list (may need to navigate to correct page if paginated)
6. Optional: Highlight the newly created patient row (blue background)

### 4. Error Handling

#### Validation Errors
- **Display**: Red text below the invalid field
- **Style**: Red border on input field
- **Message**: Specific error message for each field
- **Persistence**: Error clears when user corrects the field

#### API Errors
- **Network Error**: "網路連線錯誤，請稍後再試" (Network error, please try again)
- **Server Error**: "伺服器錯誤，請稍後再試" (Server error, please try again)
- **Permission Error**: "您沒有權限建立病患" (You don't have permission to create patients)
- **Note**: Duplicate phone numbers are explicitly allowed - no error will be shown if another patient has the same phone number

#### Error Display Location
- Inline below form fields for validation errors
- At top of modal for API errors

### 5. Loading States

#### Form Submission
- Disable all form inputs
- Show loading spinner on "建立" button
- Change button text to "建立中..." (Creating...)
- Disable "取消" button during submission

#### Data Fetching
- Show loading spinner in modal if fetching clinic settings
- Disable form until settings are loaded

## Integration Points

### 1. Calendar Page Integration

When creating an appointment from the calendar:
- **Option A**: Inline patient creation within appointment modal
  - Add "新增病患" link next to patient dropdown
  - Opens patient creation modal
  - After creation:
    - Patient creation modal closes
    - Success confirmation modal opens
    - If user clicks "新增預約": Success modal closes, appointment modal reopens with new patient selected
    - If user clicks X: Success modal closes, user returns to calendar (appointment modal closed)

- **Option B**: Separate patient creation flow
  - User creates patient first, then returns to calendar
  - New patient appears in patient dropdown

**Recommendation**: Option A for better UX (seamless flow)

### 2. Patient List Integration

After patient creation:
- Success confirmation modal opens (user must close it manually)
- When user closes success modal and returns to patient list:
  - Patient list refreshes automatically
  - If patient is on current page, show it
  - If patient would be on different page (due to sorting), navigate to correct page
  - Highlight newly created patient (fade out highlight after 3 seconds)

### 3. Search Integration

**Create Patient Button Visibility:**
- **Hidden during search**: "新增病患" button is hidden when search input has value
- **Visible when no search**: Button is visible when search input is empty
- **Rationale**: Prevents creating patients while searching, keeps UI clean

**After Patient Creation:**
- If user was searching when they created a patient:
  - Success modal opens (user can create appointment or close)
  - When user closes modal and returns to patient list:
    - Search remains active (not cleared)
    - New patient may not appear in filtered results
    - Show message: "病患已建立。若要查看，請清除搜尋條件。" (Patient created. To view, please clear search filters.)
    - Or: Automatically clear search to show new patient

## Accessibility

### Keyboard Navigation
- Tab through form fields in order
- Enter key submits form (when valid)
- Escape key closes modal
- Focus trap within modal

### Screen Reader Support
- All form fields have proper labels
- Error messages are announced
- Success messages are announced
- Modal has proper ARIA attributes

### Visual Accessibility
- High contrast for text and buttons
- Clear focus indicators
- Error states are visually distinct
- Loading states are clear

## Responsive Design

### Desktop (> 768px)
- Modal: 500px max-width, centered
- Form: Full width within modal
- Buttons: Side-by-side at bottom

### Tablet (768px - 1024px)
- Modal: 90% width, max 500px
- Form: Full width
- Buttons: Side-by-side

### Mobile (< 768px)
- Modal: Full width, full height (or near-full)
- Form: Full width, larger touch targets
- Buttons: Stacked vertically, full width
- Date picker: Native mobile date picker

## Edge Cases & Special Scenarios

### 1. Optional Fields
- Both phone number and birthday are always shown
- Both fields are optional (no asterisk *)
- Users can create patients with just a name if needed
- If phone is provided, it must be valid format
- If birthday is provided, it must be valid date

### 2. Missing Phone Number
- Patient can be created without phone number
- Useful for walk-in patients who don't provide contact info
- Phone can be added later via patient edit (if implemented)
- Consider showing indicator in patient list for patients without phone

### 3. Duplicate Name Detection (Phase 1)
- **Warning Only**: Shows warning if patients with exact same name exist
- **Non-Blocking**: Does not prevent form submission
- **Real-time**: Checks as user types (debounced)
- **New Endpoint/Query**: Does NOT use existing search API
  - Requires new endpoint or query method for exact name matching
  - Example: `GET /clinic/patients/check-duplicate?name={name}` or similar
- **Shows Count**: Displays number of patients with exact same name
- **Match Type**: **Exact match only** (case-insensitive)
  - Uses exact name comparison (e.g., `full_name.ilike('王小明')` or `full_name = '王小明'`)
  - Example: "王小明" matches ONLY "王小明" (not "王小明美" or "李王小明")
- **Use Cases**:
  - Helps identify potential duplicates before creation
  - Allows user to decide if they want to proceed
  - Useful for common names (e.g., "王小明")
- **Advantages**:
  - **No false positives** - only matches exact name matches
  - More accurate duplicate detection
  - Clear indication of actual duplicates
- **Limitations**:
  - Only checks by name (not phone or other fields)
  - Warning is informational only
  - Requires new endpoint/query (not reusing search API)

### 4. Duplicate Phone Numbers
- **Explicitly Allowed**: Multiple patients can have the same phone number
- **No Validation**: System does not check for duplicate phone numbers
- **No Warning**: No warning message is shown when creating a patient with an existing phone number
- **Use Cases**: 
  - Family members sharing a phone
  - Patients who change phone numbers (old number still in system)
  - Data entry errors that need to be corrected later
- **Future Consideration**: May add optional warning in Phase 2, but creation will always be allowed

### 5. Phone Number Validation Rules
- **Empty phone**: Completely allowed, no validation performed
- **Phone provided**: Must be valid Taiwan phone format (10 digits, starts with 09)
- **Invalid format**: Show error message, prevent submission
- **Valid format**: Allow submission, even if duplicate exists
- Clear distinction between "empty" (allowed), "invalid format" (error), and "valid" (allowed)

### 6. Network Issues
- Show retry button
- Preserve form data
- Allow user to try again

### 7. Permission Changes During Session
- If user loses permission, disable create button
- Show message: "您目前沒有建立病患的權限" (You don't currently have permission to create patients)

### 8. Multiple Tabs
- If patient is created in another tab, refresh list when tab becomes active
- Or: Show notification that list may be out of date

## User Feedback & Confirmation

### Before Submission
- Form validation provides immediate feedback
- Submit button disabled until form is valid
- Clear indication of required fields (*)

### During Submission
- Loading spinner on "建立" button
- Disabled inputs
- "建立中..." text
- Patient creation modal remains open (showing loading state)

### After Submission
- Patient creation modal closes
- Success confirmation modal opens immediately (does NOT auto-close)
- Modal shows:
  - Success icon (green checkmark)
  - "病患已成功建立" message
  - Patient name (optional)
  - "新增預約" button (primary, centered)
  - X button in top-right corner
- User actions:
  - Click "新增預約": Navigates to calendar with patient pre-selected for appointment creation
  - Click X button: Closes modal, returns to patient list
- Patient list refreshes when user returns to it
- Patient highlighted (optional)

## Future Enhancements (Not in Phase 1)

### 1. Bulk Patient Creation
- Upload CSV file
- Batch creation with validation
- Error report for failed entries

### 2. Patient Import
- Import from external systems
- Data mapping interface

### 3. Quick Create Mode
- Minimal form (name + phone only)
- Quick access from anywhere
- Keyboard shortcuts

### 4. Patient Templates
- Pre-fill common information
- Save frequently used data

### 5. Advanced Duplicate Detection UI (Phase 2+)
- Show detailed list of potential duplicates before creation
- Allow user to link/merge instead of creating new
- Multi-field matching (name + phone + birthday)
- Note: Basic duplicate detection (name-only warning) is already in Phase 1

## Technical Implementation Notes

### Form Component Reuse
- Reuse existing `PatientForm` component from LIFF (with modifications)
- Or create new `ClinicPatientForm` component
- Share validation logic

### API Integration

#### Create Patient
- Endpoint: `POST /clinic/patients`
- Request body: 
  - `full_name`: Required (string)
  - `phone_number`: Optional (string, null, or empty string allowed)
  - `birthday`: Optional (date string in YYYY-MM-DD format, or null)
- Response: Patient object with ID
- **Important**: 
  - `phone_number` can be omitted, null, or empty string
  - If `phone_number` is provided, it must be valid format (validated server-side)
  - Duplicate phone numbers are allowed (no uniqueness check)

#### Duplicate Detection (New Endpoint/Query)
- **Endpoint**: New endpoint needed (e.g., `GET /clinic/patients/check-duplicate?name={name}`)
- **Purpose**: Check for existing patients with exact same name
- **Match Type**: **Exact match only** (case-insensitive)
  - Uses exact name comparison: `Patient.full_name.ilike(name)` or `Patient.full_name == name`
  - Example: Searching "王小明" will match ONLY "王小明" (exact match)
  - Does NOT match "王小明美" or "李王小明"
- **Implementation**:
  - Call when name field has 2+ characters (trimmed)
  - Debounce: 400ms delay after user stops typing
  - Returns count of patients with exact same name
  - Show warning if count > 0
- **Backend Implementation**:
  - Query: `SELECT COUNT(*) FROM patients WHERE clinic_id = ? AND LOWER(full_name) = LOWER(?) AND is_deleted = false`
  - Or use SQLAlchemy: `db.query(Patient).filter(Patient.clinic_id == clinic_id, func.lower(Patient.full_name) == func.lower(name), Patient.is_deleted == False).count()`
- **Important Notes**:
  - **Exact match only** - no partial matching
  - **No false positives** - only matches identical names
  - Does NOT use existing search API (which does partial matching)
  - Requires new endpoint or query method

### State Management
- Use existing API service patterns
- Handle loading/error states
- Refresh patient list after creation

### Validation
- **Client-side**: Immediate feedback
  - Name: Required, cannot be empty
    - Duplicate detection: Checks for existing patients with exact same name (debounced, 400ms)
    - Uses exact match only (case-insensitive)
    - Shows warning if matches found (non-blocking)
    - No false positives - only matches identical names
  - Phone: Only validated if provided (not empty)
    - If empty: No validation, allowed
    - If provided: Must be valid Taiwan phone format
  - Birthday: Only validated if provided (not empty)
    - If empty: No validation, allowed
    - If provided: Must be valid date, cannot be future
- **Server-side**: Final validation
  - Same rules as client-side
  - Phone normalization: Remove formatting before validation/storage
  - **No duplicate phone check**: Multiple patients can have same phone number
  - **No duplicate name check**: Multiple patients can have same name (warning is informational only)

## Design Mockups

### Patients Page with Create Button
```
┌─────────────────────────────────────────────────────────────┐
│  病患管理                                    [🔵 新增病患]  │
├─────────────────────────────────────────────────────────────┤
│  [🔍 搜尋病患姓名、電話或LINE使用者名稱...]                │
├─────────────────────────────────────────────────────────────┤
│  姓名        │ 手機號碼    │ 生日      │ LINE使用者 │ 操作  │
├──────────────┼─────────────┼───────────┼───────────┼───────┤
│  王小明      │ 0912345678  │ 1990/01/01│ 王小明    │ 新增預約│
│  李美麗      │ 0923456789  │ -         │ -         │ 新增預約│
└─────────────────────────────────────────────────────────────┘
```

### Patient Creation Modal
```
┌──────────────────────────────────────┐
│  新增病患                        [×]  │
├──────────────────────────────────────┤
│                                       │
│  姓名 *                               │
│  ┌─────────────────────────────────┐ │
│  │ 王小明                           │ │
│  └─────────────────────────────────┘ │
│  ℹ️ 請輸入與健保卡上相同的姓名        │
│                                       │
│  手機號碼（選填）                     │
│  ┌─────────────────────────────────┐ │
│  │ 0912345678                      │ │
│  └─────────────────────────────────┘ │
│  ℹ️ 選填：請輸入10碼手機號碼，例如：0912345678│
│                                       │
│  生日（選填）                         │
│  ┌─────────────────────────────────┐ │
│  │ 1990/01/01          [📅]        │ │
│  └─────────────────────────────────┘ │
│  ℹ️ 選填：請輸入病患生日              │
│                                       │
│              [取消]    [建立]         │
└──────────────────────────────────────┘
```

### Success Confirmation Modal
```
┌──────────────────────────────────────┐
│  病患已成功建立                  [×]  │
├──────────────────────────────────────┤
│                                       │
│            ✓                          │
│                                       │
│      病患已成功建立                   │
│                                       │
│      病患：王小明                     │
│                                       │
│                                       │
│              [新增預約]               │
│                                       │
└──────────────────────────────────────┘
```

### Error State
```
┌──────────────────────────────────────┐
│  新增病患                        [×]  │
├──────────────────────────────────────┤
│                                       │
│  姓名 *                               │
│  ┌─────────────────────────────────┐ │
│  │                                  │ │
│  └─────────────────────────────────┘ │
│  ❌ 請輸入病患姓名                    │
│                                       │
│  手機號碼（選填）                     │
│  ┌─────────────────────────────────┐ │
│  │ 123                             │ │
│  └─────────────────────────────────┘ │
│  ❌ 請輸入有效的手機號碼（10碼，以09開頭）│
│  （或留空）                           │
│                                       │
│              [取消]    [建立]         │
└──────────────────────────────────────┘
```

### Duplicate Warning State
```
┌──────────────────────────────────────┐
│  新增病患                        [×]  │
├──────────────────────────────────────┤
│                                       │
│  姓名 *                               │
│  ┌─────────────────────────────────┐ │
│  │ 王小明                           │ │
│  └─────────────────────────────────┘ │
│  ⚠️ 發現 3 位同名病患，請確認是否為重複建立│
│  （此為提醒，仍可繼續建立）            │
│                                       │
│  手機號碼（選填）                     │
│  ┌─────────────────────────────────┐ │
│  │ 0912345678                      │ │
│  └─────────────────────────────────┘ │
│                                       │
│  生日（選填）                         │
│  ┌─────────────────────────────────┐ │
│  │ 1990/01/01          [📅]        │ │
│  └─────────────────────────────────┘ │
│                                       │
│              [取消]    [建立]         │
└──────────────────────────────────────┘
```

## User Testing Considerations

### Key Metrics
- Time to create a patient
- Error rate (validation failures)
- User satisfaction
- Feature adoption rate

### Test Scenarios
1. Happy path: Valid data, successful creation (name + phone + birthday)
   - Success modal opens with "新增預約" button and X button
2. Happy path: Name only (no phone, no birthday) - **Should succeed**
   - Success modal opens
3. Happy path: Name + phone (no birthday)
   - Success modal opens
4. Happy path: Name + birthday (no phone) - **Should succeed**
   - Success modal opens
5. Happy path: Create patient with duplicate phone number - **Should succeed** (no error)
   - Success modal opens
6. Success modal: Click "新增預約" button - **Should navigate to calendar** with patient pre-selected
7. Success modal: Click X button - **Should close modal** and return to patient list
8. Success modal: Does NOT auto-close - **Should remain open** until user action
9. Create patient button: Hidden when search input has value - **Should not be visible** during search
10. Create patient button: Visible when search is empty - **Should be visible** when not searching
11. Duplicate detection: Type exact name that exists - **Should show warning** (non-blocking)
12. Duplicate detection: Type name with no exact matches - **Should show no warning**
13. Duplicate detection: Type partial name (e.g., "王小明" when "王小明美" exists) - **Should show no warning** (exact match only)
14. Duplicate detection: Clear name field - **Warning should disappear**
15. Duplicate detection: Debounce delay works correctly (400ms)
16. Duplicate detection: Case-insensitive matching (e.g., "王小明" matches "王小明")
17. Validation: Missing required name field - Should show error
18. Validation: Invalid phone number format (when provided) - Should show error
19. Validation: Empty phone number - **Should succeed** (no validation error)
20. Validation: Invalid birthday date (when provided) - Should show error
21. Network error: Handle gracefully (including duplicate detection API call)
22. Permission: Read-only user cannot create

## Creation Source Tracking

### Should We Track Creation Source?

**Recommendation: Yes, track creation source**

#### Benefits of Tracking

1. **Audit Trail**: Know who created each patient record and how
2. **Analytics**: Understand patient acquisition channels (LINE vs clinic)
3. **Debugging**: Easier to troubleshoot issues by knowing creation method
4. **Future Features**: 
   - Different workflows based on creation source
   - Reporting on patient registration methods
   - Understanding clinic vs LINE user behavior

#### Implementation Options

**Option 1: Add `created_by_type` field (Recommended)**
```python
created_by_type: Mapped[str] = mapped_column(String(20))
# Values: 'line_user' | 'clinic_user'
```
- Simple enum-like field
- Easy to query and filter
- Clear distinction between creation methods
- Can add `created_by_user_id` later if needed for audit trail

**Option 2: Add `created_by_user_id` field**
```python
created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
```
- More detailed audit trail (knows which clinic user created it)
- Requires foreign key relationship
- More complex queries
- Can be null for LINE-created patients (or link to system user)

**Option 3: Infer from existing fields**
- Use `line_user_id IS NULL` to infer clinic-created
- Use `line_user_id IS NOT NULL` to infer LINE-created
- **Problem**: Doesn't work if patient is later linked to LINE user
- **Problem**: Doesn't distinguish between clinic-created and LINE-created if both can have null `line_user_id`

**Option 4: Hybrid (Recommended for Phase 2)**
```python
created_by_type: Mapped[str] = mapped_column(String(20))  # 'line_user' | 'clinic_user'
created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)  # Clinic user who created
created_by_line_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("line_users.id"), nullable=True)  # LINE user who created
```
- Most comprehensive
- Full audit trail
- Can track both clinic user and LINE user
- More complex, but future-proof

#### Recommendation for Phase 1

**Start with Option 1: `created_by_type` field**

**Rationale:**
- Simple to implement
- Meets immediate needs (distinguish creation source)
- Can enhance to Option 4 in Phase 2 if needed
- No breaking changes
- Easy to query: `WHERE created_by_type = 'clinic_user'`

**Database Migration:**
```sql
ALTER TABLE patients 
ADD COLUMN created_by_type VARCHAR(20) NOT NULL DEFAULT 'line_user';

-- Update existing records (all current patients are LINE-created)
UPDATE patients SET created_by_type = 'line_user' WHERE line_user_id IS NOT NULL;
-- For patients without line_user_id, we can't be sure, so mark as 'line_user' for backward compatibility
UPDATE patients SET created_by_type = 'line_user' WHERE line_user_id IS NULL;
```

**API Changes:**
- When clinic user creates: `created_by_type = 'clinic_user'`
- When LINE user creates: `created_by_type = 'line_user'`
- Backend validates and sets this automatically

**UI Considerations:**
- Can add filter in patient list: "Created by Clinic" / "Created by LINE" / "All"
- Can show badge/indicator in patient list
- Useful for reporting and analytics

#### Future Enhancements (Phase 2+)

If more detailed audit trail is needed:
- Add `created_by_user_id` for clinic users
- Add `created_by_line_user_id` for LINE users
- Track creation timestamp (already have `created_at`)
- Track creation IP address (if needed for security)

## Conclusion

This UX design provides a simple, efficient, and consistent experience for clinic users to create patient records. It follows existing UI patterns, provides clear feedback, and handles edge cases gracefully. 

**Key Design Decisions:**
- **Name is required** (only required field)
- **Phone and birthday are always shown but optional** (both fields visible, neither required)
- **Phone validation only if provided**: If phone field is empty, no validation is performed - patient can be created without phone number
- **Duplicate phone numbers allowed**: Multiple patients can share the same phone number - no uniqueness check or warning
- **Duplicate name detection (Phase 1)**: Warning shown if patients with same name exist (non-blocking, informational only)
- **Creation source tracking recommended** for audit and analytics

**Critical Implementation Notes:**
1. Phone number field must accept empty/null values - validation only runs if phone is provided
2. Backend must not enforce phone number uniqueness - allow duplicate phone numbers
3. Database schema should allow `phone_number` to be nullable or empty string
4. API should accept `phone_number` as optional (can be omitted, null, or empty string)
5. **Duplicate detection**: New endpoint for exact name matching
   - **Do NOT use existing search API** (which does partial matching)
   - Create new endpoint: `GET /clinic/patients/check-duplicate?name={name}`
   - Call with debounce (400ms) when name field has 2+ characters (trimmed)
   - Returns count of patients with exact same name (case-insensitive)
   - **Exact match only**: Uses exact name comparison, not partial matching
   - Show warning if count > 0 (non-blocking, informational only)
   - Warning message: "發現 {count} 位同名病患，請確認是否為重複建立"
   - **Backend query**: `SELECT COUNT(*) FROM patients WHERE clinic_id = ? AND LOWER(full_name) = LOWER(?) AND is_deleted = false`

The design is ready for implementation in Phase 1 of the manual patient creation feature.

