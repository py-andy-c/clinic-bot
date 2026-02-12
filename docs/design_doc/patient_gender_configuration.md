# Patient Gender Configuration

## Overview

Make patient gender (生理性別) configurable as a required field during patient registration, similar to how patient birthday is currently handled.

## Current Implementation (Birthday Reference)

### Backend
- **Settings Model**: `ClinicInfoSettings.require_birthday` (bool, default=False) in `backend/src/models/clinic.py`
- **Database**: `Patient.birthday` (nullable Date field)
- **API**: Birthday is optional in request models, validated only when `require_birthday=True` during creation
- **Validation**: Birthday validation only enforced during patient creation when setting is enabled

### Frontend
- **Settings UI**: Toggle in `ClinicAppointmentSettings.tsx` (Settings → Appointments page)
- **Forms**: Birthday field conditionally shown/required in:
  - `PatientForm.tsx` (LIFF patient creation)
  - `PatientCreationModal.tsx` (Clinic admin patient creation)
  - `PatientInfoSection.tsx` (Patient detail page edit mode)
  - `PatientManagement.tsx` (LIFF patient management)
- **Display**: Birthday shown in patient detail view only when `require_birthday=True` (conditional display)
- **Patient List**: Birthday column removed from patients list (no clinic settings query needed)

## Proposed Implementation

### Backend Changes

#### 1. Database Migration
- Add `gender` column to `patients` table:
  - Type: `String(20)` (nullable)
  - Values: `'male'`, `'female'`, `'other'`, or `null`
  - Default: `null`

#### 2. Patient Model (`backend/src/models/patient.py`)
- Add `gender: Mapped[Optional[str]]` field (nullable)

#### 3. Settings Model (`backend/src/models/clinic.py`)
- Add `require_gender: bool = Field(default=False)` to `ClinicInfoSettings`

#### 4. API Request/Response Models
- **LIFF API** (`backend/src/api/liff.py`):
  - Add `gender: Optional[str]` to `PatientCreateRequest` and `PatientUpdateRequest`
  - Validate gender when `require_gender=True` during creation
- **Clinic API** (`backend/src/api/clinic.py`):
  - Add `gender: Optional[str]` to `ClinicPatientCreateRequest` and `ClinicPatientUpdateRequest`
  - Validate gender when `require_gender=True` during creation
- **Response Models** (`backend/src/api/responses.py`):
  - Add `gender: Optional[str]` to `PatientResponse`

#### 5. Validation Logic
- Gender validation:
  - Required when `require_gender=True` during patient creation
  - Must be one of: `'male'`, `'female'`, `'other'`
  - Optional during updates (same pattern as birthday)
  - Existing patients without gender remain valid even after setting is enabled

#### 6. Service Layer
- Update `PatientService` methods to handle gender field

### Frontend Changes

#### 1. Settings UI (`frontend/src/components/ClinicAppointmentSettings.tsx`)
- Add toggle for "要求填寫生理性別" (Require Gender)
- Place after "要求填寫生日" toggle
- Add info modal explaining the setting

#### 2. Type Definitions (`frontend/src/types/index.ts`)
- Add `gender?: string | null` to `Patient` interface

#### 3. Patient Profile Forms

**LIFF Patient Profile Form** (`frontend/src/liff/components/PatientProfileForm.tsx`):
- Add gender dropdown field
- Show conditionally when `requireGender` prop is true
- Dropdown options:
  - Empty option: "請選擇生理性別" (when required)
  - `'male'` → "男性"
  - `'female'` → "女性"
  - `'other'` → "其他"
- Add to `PatientFormData` interface

**Clinic Admin Patient Creation** (`frontend/src/components/PatientCreationModal.tsx`):
- Add gender dropdown field (always shown, required based on clinic setting)
- Fetch clinic settings to determine if required
- Same dropdown options as LIFF form
- Add gender to form state and submission

**Patient Detail Page** (`frontend/src/components/patient/PatientInfoSection.tsx`):
- Add gender dropdown field in edit mode (always editable, regardless of setting)
- Display gender in view mode if present (regardless of `require_gender` setting)
- Show Chinese label: "男性", "女性", or "其他"
- Note: Gender display differs from birthday (birthday only shows when `require_birthday=True`, gender shows if present)

**LIFF Patient Management** (`frontend/src/liff/settings/PatientManagement.tsx`):
- Add gender dropdown field to edit form
- Fetch clinic settings only for validation (not for display)

**Patients List Page** (`frontend/src/pages/PatientsPage.tsx`):
- **No changes needed**: Birthday and gender columns removed from patient list
- Simplifies rendering (no clinic settings query required)

#### 4. Validation Utilities (`frontend/src/utils/patientProfileFormValidation.ts`)
- Update `validateLiffPatientProfileForm` to validate gender when required
- Update `validateClinicPatientProfileForm` to validate gender when required
- Gender must be one of: `'male'`, `'female'`, `'other'`

#### 5. API Service (`frontend/src/services/api.ts` and `liffApi.ts`)
- Update patient creation/update methods to include gender field

#### 6. Settings Context/Hooks
- Update settings types to include `require_gender`
- Ensure settings are fetched where needed for form validation


## Design Decisions

### 1. Gender Values
**Decision**: 
- API values: `'male'`, `'female'`, `'other'`
- Display labels: "男性", "女性", "其他"
- Stored as strings in database (not enum)

### 2. UI Component
**Decision**: Dropdown (select element)
- Better for mobile UX
- Consistent with other form fields
- Placeholder: "請選擇生理性別" when required

### 3. Display Logic
**Decision**: 
- **Patient Detail Page View Mode**: 
  - Birthday: Only shown when `require_birthday=True` (current behavior)
  - Gender: Show if present (regardless of `require_gender` setting) - more flexible than birthday
- **Patient List**: Do not show birthday or gender columns (simplifies rendering, no settings query needed)
- **Edit Mode**: Gender always editable in patient detail page (same as birthday)

### 4. Existing Patients
**Behavior**: 
- Existing patients without gender remain valid
- When `require_gender` is enabled, only new patient creations require gender
- Updates to existing patients do not require gender (same as birthday pattern)

### 5. Migration Strategy
- Existing patients will have `gender=null`
- No data migration needed (field is nullable)
- Backward compatible: existing API calls without gender continue to work

### 6. Validation Scope
- **Creation**: Gender required when `require_gender=True`
- **Updates**: Gender optional (allows adding gender to existing patients without forcing it)
- **LIFF vs Clinic Admin**: Same validation rules apply

### 7. Field Label
**Decision**: Use "生理性別" (biological gender) as specified in requirements

## Implementation Order

1. **Backend**:
   - Database migration
   - Model updates
   - Settings model update
   - API request/response updates
   - Validation logic

2. **Frontend**:
   - Type definitions
   - Settings UI
   - Form components
   - Validation utilities
   - API service updates

3. **Testing**:
   - Unit tests for validation
   - Integration tests for patient creation/update
   - UI tests for form behavior

## Implementation Notes

### Performance Optimization
- **Patient List**: Removed birthday/gender columns eliminates need to:
  - Query clinic settings for each list render
  - Conditionally render columns based on settings
  - Simplifies table structure and improves performance

### Form Field Order
- Gender field placed after birthday field in all forms for consistency

### Dropdown Implementation
- Use standard HTML `<select>` element
- Styling consistent with existing form inputs
- Empty option shown as placeholder when field is required
- When not required, empty option can be "請選擇" or blank

## Edge Cases

### 1. Gender Display Inconsistency
**Issue**: Birthday only shows when `require_birthday=True`, but gender shows if present
**Decision**: This is intentional - gender display is more flexible to show existing data even if clinic doesn't require it

### 2. Empty Gender Value
**Behavior**: When gender is `null` or empty string:
- View mode: Don't show gender field (same as when birthday is missing)
- Edit mode: Dropdown shows empty/placeholder state
- API: Send `null` or omit field

### 3. Invalid Gender Values
**Handling**: If existing data has invalid gender values (e.g., from future changes):
- Backend validation rejects invalid values during updates
- Frontend dropdown only allows valid options
- Existing invalid data: Display as-is or show error? (Recommend: show as-is, allow edit)

### 4. Settings Change Impact
**Scenario**: Clinic enables `require_gender` after having patients without gender
**Behavior**: 
- Existing patients remain valid (no validation errors)
- Only new patient creations require gender
- Existing patients can optionally add gender via edit

### 5. LIFF vs Clinic Admin Forms
**Difference**: 
- LIFF: Gender field only shown when `requireGender` prop is true
- Clinic Admin: Gender field always shown, required based on setting
**Rationale**: LIFF forms are more compact, clinic admin has more space

### 6. Gender Translation Helper
**Implementation**: Create helper function (e.g., `getGenderLabel()`, `getGenderValue()`) in `frontend/src/utils/` or constants file:
- API value → Display label: `'male'` → "男性"
- Display label → API value: "男性" → `'male'`
- Reusable across all components

