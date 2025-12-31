# Settings Management - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for settings management in the clinic system. It covers clinic settings, practitioner settings, validation, defaults, and how settings affect system behavior.

---

## Key Business Logic

### 1. Settings Architecture

**Two-Level Settings**:
- **Clinic Settings**: Configured per clinic, affect all clinic operations
- **Practitioner Settings**: Configured per practitioner per clinic, affect individual practitioner behavior

**Storage**: Both stored as JSONB columns in database with Pydantic schema validation

**Validation**: Settings validated using Pydantic models before saving to ensure type safety and data integrity

**Rationale**: JSONB provides flexibility while Pydantic ensures type safety and validation.

### 2. Clinic Settings

**Structure**: `ClinicSettings` model contains five setting groups:

**Notification Settings** (`NotificationSettings`):
- `reminder_hours_before`: Hours before appointment to send reminder (default: 24)

**Booking Restriction Settings** (`BookingRestrictionSettings`):
- `booking_restriction_type`: Type of restriction ("minimum_hours_required" or "none")
- `minimum_booking_hours_ahead`: Minimum hours in advance for booking (default: 24)

**Clinic Info Settings** (`ClinicInfoSettings`):
- `display_name`: Custom display name (overrides clinic name)
- `address`: Clinic address
- `phone_number`: Clinic phone number
- `appointment_type_instructions`: Instructions for appointment types
- `appointment_notes_instructions`: Instructions for appointment notes
- `require_birthday`: Whether to require birthday when creating patients
- `require_gender`: Whether to require gender when creating patients
- `restrict_to_assigned_practitioners`: Whether to restrict patient booking to assigned practitioners
- `query_page_instructions`: Instructions for query page
- `settings_page_instructions`: Instructions for settings page
- `notifications_page_instructions`: Instructions for notifications page

**Chat Settings** (`ChatSettings`):
- `chat_enabled`: Whether AI chatbot is enabled
- `clinic_description`: Clinic description for AI context
- `therapist_info`: Therapist information for AI context
- `treatment_details`: Treatment details for AI context
- `service_item_selection_guide`: Guide for service item selection
- `operating_hours`: Operating hours information
- `location_details`: Location and transportation details
- `booking_policy`: Booking and cancellation policy
- `payment_methods`: Payment methods accepted
- `equipment_facilities`: Equipment and facilities available
- `common_questions`: Common questions and answers
- `other_info`: Other clinic information
- `ai_guidance`: Custom AI instructions (can override default persona/formatting, but NOT safety rules)

**Receipt Settings** (`ReceiptSettings`):
- `custom_notes`: Custom notes to append at end of receipts
- `show_stamp`: Whether to display stamp with clinic name and checkout date

**Rationale**: Grouped settings improve organization and make it easier to manage related configurations.

### 3. Practitioner Settings

**Structure**: `PractitionerSettings` model contains:

**Compact Schedule Settings**:
- `compact_schedule_enabled`: Whether to use compact schedule view (default: false)

**Future Settings**: Can be extended with additional practitioner-specific settings

**Storage**: Stored in `UserClinicAssociation.settings` JSONB column (per association = per practitioner per clinic)

**Rationale**: Allows practitioners to have different preferences at different clinics.

### 4. Settings Validation

**Pydantic Models**: All settings use Pydantic models for validation:
- Type checking (e.g., `reminder_hours_before` must be int)
- Field validation (e.g., string max length)
- Default values
- Required vs. optional fields

**Validation Methods**:
- `clinic.get_validated_settings()`: Returns validated `ClinicSettings` object
- `association.get_validated_settings()`: Returns validated `PractitionerSettings` object
- `clinic.set_validated_settings(settings)`: Validates and saves settings
- `association.set_validated_settings(settings)`: Validates and saves settings

**Error Handling**: Invalid settings raise validation errors before saving

**Rationale**: Validation ensures data integrity and prevents invalid configurations.

### 5. Settings Defaults

**Clinic Settings**: All settings have sensible defaults:
- `reminder_hours_before`: 24 hours
- `booking_restriction_type`: "minimum_hours_required"
- `minimum_booking_hours_ahead`: 24 hours
- `chat_enabled`: false
- `show_stamp`: false
- (Other fields default to None/null)

**Practitioner Settings**: 
- `compact_schedule_enabled`: false

**Rationale**: Defaults ensure clinics work out-of-the-box without requiring all settings to be configured.

### 6. Settings Access

**Centralized Service**: `SettingsService` provides centralized access to settings:
- `get_clinic_settings(db, clinic_id)`: Get validated clinic settings
- `get_practitioner_settings(db, user_id, clinic_id)`: Get validated practitioner settings

**Direct Access**: Models also provide direct access methods:
- `clinic.get_validated_settings()`: Get clinic settings
- `association.get_validated_settings()`: Get practitioner settings

**Rationale**: Centralized service provides consistent access pattern, while direct access is convenient for model methods.

### 7. Settings Updates

**Partial Updates**: Settings can be updated partially - only provided fields are updated, others remain unchanged

**Merge Strategy**: 
1. Get current settings
2. Merge with new settings (new values override current)
3. Validate merged settings
4. Save to database

**Atomic Updates**: Settings updates are atomic - either all changes succeed or none do

**Rationale**: Partial updates allow updating individual settings without affecting others.

### 8. Settings Impact on System Behavior

**Reminder Hours**: Affects when appointment reminders are sent (used by reminder scheduler)

**Booking Restrictions**: Affects when patients can book appointments (enforced in appointment creation)

**Chat Settings**: Affects AI chatbot behavior (clinic context, AI guidance, enabled/disabled)

**Receipt Settings**: Affects receipt generation (custom notes, stamp display)

**Practitioner Settings**: Affects UI display (compact schedule view)

**Rationale**: Settings drive system behavior, so validation and defaults are critical.

---

## Backend Technical Design

### API Endpoints

#### `GET /clinic/settings`
- **Description**: Get clinic settings
- **Parameters**: None (clinic ID from auth context)
- **Response**: `ClinicSettings` object
- **Errors**: 
  - 404: Clinic not found
  - 500: Internal server error

#### `PUT /clinic/settings`
- **Description**: Update clinic settings (partial update supported)
- **Request Body**: `Partial<ClinicSettings>` (only fields to update)
- **Response**: `{ success: true, settings: ClinicSettings }`
- **Errors**:
  - 400: Validation errors
  - 404: Clinic not found
  - 500: Internal server error

#### `GET /clinic/practitioner-settings/{user_id}`
- **Description**: Get practitioner settings for a specific user
- **Path Parameters**: `user_id` (practitioner user ID)
- **Response**: `PractitionerSettings` object
- **Errors**:
  - 404: User or association not found
  - 500: Internal server error

#### `PUT /clinic/practitioner-settings/{user_id}`
- **Description**: Update practitioner settings (partial update supported)
- **Path Parameters**: `user_id` (practitioner user ID)
- **Request Body**: `Partial<PractitionerSettings>` (only fields to update)
- **Response**: `{ success: true, settings: PractitionerSettings }`
- **Errors**:
  - 400: Validation errors
  - 404: User or association not found
  - 500: Internal server error

### Database Schema

**Clinic Settings**: Stored in `clinics.settings` JSONB column
```sql
settings JSONB NOT NULL DEFAULT '{}'
```

**Practitioner Settings**: Stored in `user_clinic_associations.settings` JSONB column
```sql
settings JSONB NOT NULL DEFAULT '{}'
```

**Indexing**: JSONB columns are indexed for efficient querying (PostgreSQL automatically indexes JSONB)

### Business Logic Implementation

**SettingsService** (`backend/src/services/settings_service.py`):
- `get_clinic_settings(db, clinic_id)`: Returns validated `ClinicSettings` with defaults
- `get_practitioner_settings(db, user_id, clinic_id)`: Returns validated `PractitionerSettings` or None
- Settings validation via Pydantic models
- Default values applied when settings are missing

**Model Methods**:
- `clinic.get_validated_settings()`: Returns validated settings with defaults
- `clinic.set_validated_settings(settings)`: Validates and saves settings
- `association.get_validated_settings()`: Returns validated practitioner settings with defaults
- `association.set_validated_settings(settings)`: Validates and saves practitioner settings

**Key Business Logic**:
- Partial updates: Only provided fields are updated, others remain unchanged
- Atomic updates: All changes succeed or none do (database transaction)
- Default values: Applied when settings are missing or empty
- Validation: Pydantic models validate types, constraints, and formats before saving

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: `/clinic/settings` endpoint for clinic settings, `/clinic/practitioner-settings/{user_id}` for practitioner settings
- [x] **Current Implementation**: Using `useApiData` hook via `SettingsContext`
  - **Note**: Migration to React Query planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`)
- [x] **Query Keys** (when migrated to React Query):
  - `['clinic-settings', clinicId]` - Clinic settings
  - `['practitioner-settings', userId, clinicId]` - Practitioner settings
- [x] **Cache Strategy**:
  - **Current**: Custom cache with TTL (5 minutes default), clinic ID auto-injection
  - **Future (React Query)**:
    - `staleTime`: 5 minutes (settings don't change frequently)
    - `cacheTime`: 10 minutes
    - Invalidation triggers: Settings save, clinic switch

#### Client State (UI State)
- [x] **SettingsContext** (`frontend/src/contexts/SettingsContext.tsx`):
  - **State Properties**:
    - `settings`: Current clinic settings (ClinicSettings | null)
    - `originalData`: Original settings for comparison (ClinicSettings | null)
    - `uiState`: Loading, saving, error states
    - `sectionChanges`: Track which sections have unsaved changes
  - **Actions**: 
    - `saveData()`: Save all changes to backend
    - `updateData()`: Update settings in memory (doesn't save)
    - `fetchData()`: Refresh settings from backend
  - **Usage**: All settings pages use this context for shared state

- [x] **Local Component State**: 
  - Each settings page (`SettingsAppointmentsPage`, `SettingsChatPage`, etc.): Form state via React Hook Form
  - Unsaved changes detection: Tracks form dirty state
  - Loading/saving states: Per-page loading indicators

#### Form State
- [x] **React Hook Form**: Used in all settings pages
  - **Form Fields**: Varies by page (appointments, chat, clinic info, reminders, receipts, resources)
  - **Validation Rules**: Zod schemas (`AppointmentsSettingsFormSchema`, `ChatSettingsFormSchema`, etc.)
  - **Default Values**: Populated from `SettingsContext.settings`
  - **Mode**: `onBlur` validation (validates on field blur)

### Component Architecture

#### Component Hierarchy
```
SettingsLayout
  ├── SettingsIndexPage (index)
  │   └── SettingCard[] (navigation cards)
  ├── SettingsAppointmentsPage
  │   ├── ClinicAppointmentSettings
  │   │   ├── BookingRestrictionSettings
  │   │   └── ClinicInfoSettings
  │   └── PractitionerSettings (per practitioner)
  ├── SettingsChatPage
  │   └── ChatSettings
  ├── SettingsClinicInfoPage
  │   └── ClinicInfoSettings
  ├── SettingsRemindersPage
  │   └── ClinicReminderSettings
  ├── SettingsReceiptsPage
  │   └── ReceiptSettings
  └── SettingsResourcesPage
      └── ResourcesSettings

SettingsProvider (Context)
  └── useSettingsPage (hook)
      └── useApiData (settings fetch)
```

#### Component List
- [x] **SettingsLayout** (`frontend/src/components/SettingsLayout.tsx`)
  - **Props**: None (uses `Outlet` from React Router)
  - **State**: None (layout only)
  - **Dependencies**: `SettingsProvider`, `PageHeader`

- [x] **SettingsIndexPage** (`frontend/src/pages/settings/SettingsIndexPage.tsx`)
  - **Props**: None
  - **State**: None (static navigation)
  - **Dependencies**: `useAuth` (for admin-only cards)

- [x] **SettingsAppointmentsPage** (`frontend/src/pages/settings/SettingsAppointmentsPage.tsx`)
  - **Props**: None
  - **State**: Form state via React Hook Form, practitioner settings loading
  - **Dependencies**: `useSettings`, `useForm`, `ClinicAppointmentSettings`, `useApiData` (members)

- [x] **SettingsChatPage** (`frontend/src/pages/settings/SettingsChatPage.tsx`)
  - **Props**: None
  - **State**: Form state via React Hook Form
  - **Dependencies**: `useSettings`, `useForm`, `ChatSettings`

- [x] **SettingsClinicInfoPage** (`frontend/src/pages/settings/SettingsClinicInfoPage.tsx`)
  - **Props**: None
  - **State**: Form state via React Hook Form
  - **Dependencies**: `useSettings`, `useForm`, `ClinicInfoSettings`

- [x] **SettingsRemindersPage** (`frontend/src/pages/settings/SettingsRemindersPage.tsx`)
  - **Props**: None
  - **State**: Form state via React Hook Form
  - **Dependencies**: `useSettings`, `useForm`, `ClinicReminderSettings`

- [x] **SettingsReceiptsPage** (`frontend/src/pages/settings/SettingsReceiptsPage.tsx`)
  - **Props**: None
  - **State**: Form state via React Hook Form
  - **Dependencies**: `useSettings`, `useForm`, `ReceiptSettings`

- [x] **SettingsResourcesPage** (`frontend/src/pages/settings/SettingsResourcesPage.tsx`)
  - **Props**: None
  - **State**: Form state via React Hook Form
  - **Dependencies**: `useSettings`, `useForm`, `ResourcesSettings`

- [x] **SettingsProvider** (`frontend/src/contexts/SettingsContext.tsx`)
  - **Props**: `children` (ReactNode)
  - **State**: Settings data, loading/saving states, section changes tracking
  - **Dependencies**: `useSettingsPage`, `useApiData`, `useAuth`

### User Interaction Flows

#### Flow 1: View Settings Index
1. User navigates to `/admin/clinic/settings`
2. `SettingsIndexPage` displays grid of setting cards
3. User sees available settings sections (service items, appointments, clinic info, reminders, chat, receipts, resources)
4. Admin-only cards (receipts, resources) only visible to admins
5. User clicks a card → Navigates to that settings page
   - **Edge case**: Non-admin user → Admin-only cards hidden

#### Flow 2: Edit Appointment Settings
1. User clicks "預約設定" card → Navigates to `/admin/clinic/settings/appointments`
2. `SettingsAppointmentsPage` loads
3. `SettingsContext` fetches current settings via `useApiData`
4. Form pre-fills with current settings
5. User modifies booking restrictions (e.g., changes `minimum_booking_hours_ahead` to 48)
6. Form shows as dirty (unsaved changes indicator)
7. User modifies clinic info settings (e.g., updates `appointment_type_instructions`)
8. User scrolls to practitioner section
9. System fetches practitioners list via `useApiData`
10. User modifies individual practitioner settings (e.g., `step_size_minutes`)
11. User clicks "儲存" button
12. Form validates (Zod schema)
13. If valid: Settings saved via `SettingsContext.saveData()`
14. Success message shown, form resets to clean state
15. If invalid: Validation errors shown, user can fix and retry
   - **Edge case**: Unsaved changes → Navigation warning shown
   - **Edge case**: Save fails → Error message shown, user can retry
   - **Edge case**: Concurrent edit → Last write wins (no conflict detection)

#### Flow 3: Edit Chat Settings
1. User clicks "AI 聊天" card → Navigates to `/admin/clinic/settings/chat`
2. `SettingsChatPage` loads
3. Form pre-fills with current chat settings
4. User enables `chat_enabled` toggle
5. User fills in `clinic_description`, `therapist_info`, etc.
6. User modifies `ai_guidance` (custom instructions)
7. User clicks "儲存"
8. Settings saved, success message shown
   - **Edge case**: Test mode → User can test unsaved settings via chatbot test feature

#### Flow 4: Edit Practitioner Settings (Compact Schedule)
1. Practitioner navigates to profile/settings (if available)
2. Practitioner toggles `compact_schedule_enabled`
3. Settings saved to `UserClinicAssociation.settings`
4. Calendar view updates to compact mode
   - **Note**: Currently practitioner settings are edited via appointment settings page

### Edge Cases and Error Handling

#### Edge Cases
- [x] **Race Condition**: User switches clinic during settings fetch
  - **Solution**: `useApiData` includes clinic ID in cache keys, automatically refetches on clinic switch
  - **Future (React Query)**: Query invalidation on clinic switch

- [x] **Concurrent Updates**: Multiple users update same clinic's settings simultaneously
  - **Solution**: Database transaction isolation, last write wins (no conflict detection in frontend)
  - **Behavior**: Second save overwrites first save (standard database behavior)

- [x] **Clinic Switching**: User switches clinic while settings page is open
  - **Solution**: Settings refetch automatically, form resets with new clinic's settings

- [x] **Component Unmount**: Component unmounts during settings save
  - **Solution**: `useApiData` checks `isMountedRef` before state updates, prevents memory leaks

- [x] **Network Failure**: API call fails (network error, timeout)
  - **Solution**: Error message shown to user, retry option available
  - **Implementation**: `useApiData` handles errors, `SettingsContext` shows error state

- [x] **Stale Data**: User views settings, another user modifies them, first user tries to save
  - **Solution**: Last write wins (no conflict detection), second save overwrites first

- [x] **Missing Settings**: Clinic has no settings configured (empty JSONB)
  - **Solution**: Backend returns defaults via Pydantic models, frontend displays defaults

- [x] **Invalid Settings Format**: Database contains invalid JSON
  - **Solution**: Backend validation fails, error returned, user cannot save until fixed

- [x] **Unsaved Changes**: User navigates away with unsaved changes
  - **Solution**: `useUnsavedChangesDetection` hook shows warning, user can cancel or confirm navigation

#### Error Scenarios
- [x] **API Errors (4xx, 5xx)**:
  - **User Message**: User-friendly error messages extracted from API response
  - **Recovery Action**: User can retry save operation
  - **Implementation**: `getErrorMessage()` utility, `SettingsContext` displays errors

- [x] **Validation Errors**:
  - **User Message**: Field-level error messages (e.g., "此欄位為必填", "數值必須大於0")
  - **Field-level Errors**: Shown inline next to form fields via React Hook Form
  - **Implementation**: Zod schema validation, React Hook Form error display

- [x] **Loading States**:
  - **Initial Load**: Loading spinner shown while fetching settings
  - **Save**: Submit button disabled, loading spinner shown during save
  - **Implementation**: `SettingsContext.uiState.loading`, `SettingsContext.uiState.saving`

- [x] **Permission Errors (403)**:
  - **User Message**: "您沒有權限執行此操作"
  - **Recovery Action**: User cannot proceed, must contact admin
  - **Implementation**: Backend returns 403, frontend shows error message

### Testing Requirements

#### E2E Tests (Playwright)
- [ ] **Test Scenario**: View settings index
  - Steps:
    1. Login as admin
    2. Navigate to `/admin/clinic/settings`
    3. Verify all setting cards visible
  - Assertions: All cards displayed, admin-only cards visible to admin
  - Edge cases: Test as non-admin (admin-only cards hidden)

- [ ] **Test Scenario**: Edit appointment settings
  - Steps:
    1. Navigate to appointment settings page
    2. Modify `minimum_booking_hours_ahead`
    3. Click "儲存"
    4. Verify success message
    5. Refresh page, verify changes persisted
  - Assertions: Settings saved, changes persisted, success message shown
  - Edge cases: Test validation errors, test unsaved changes warning

- [ ] **Test Scenario**: Edit chat settings
  - Steps:
    1. Navigate to chat settings page
    2. Enable `chat_enabled`
    3. Fill in clinic description
    4. Save
    5. Verify settings saved
  - Assertions: Settings saved, chatbot enabled

- [ ] **Test Scenario**: Unsaved changes warning
  - Steps:
    1. Open settings page
    2. Make changes (don't save)
    3. Try to navigate away
    4. Verify warning shown
  - Assertions: Warning modal shown, user can cancel or confirm

#### Integration Tests (MSW)
- [ ] **Test Scenario**: Settings form initialization
  - Mock API responses: Clinic settings
  - User interactions: Navigate to settings page
  - Assertions: Form pre-filled with current settings

- [ ] **Test Scenario**: Settings save with validation
  - Mock API responses: Success response
  - User interactions: Fill form, submit
  - Assertions: Validation errors shown for invalid fields, API called with correct data on valid submit

- [ ] **Test Scenario**: Error handling
  - Mock API responses: 400, 403, 500 errors
  - User interactions: Submit form, trigger errors
  - Assertions: Appropriate error messages shown, user can retry

- [ ] **Test Scenario**: Clinic switching
  - Mock API responses: Different settings for different clinics
  - User interactions: Switch clinic while on settings page
  - Assertions: Settings refetch, form resets with new clinic's settings

#### Unit Tests
- [ ] **Component**: `SettingsAppointmentsPage`
  - Test cases: Renders correctly, pre-fills form, handles save, shows validation errors
- [ ] **Component**: `SettingsChatPage`
  - Test cases: Renders correctly, handles save, validates form
- [ ] **Context**: `SettingsContext`
  - Test cases: Fetches settings, updates data, saves data, handles errors
- [ ] **Hook**: `useSettingsPage`
  - Test cases: Fetches settings, handles save, tracks changes

### Performance Considerations

- [x] **Data Loading**: 
  - Settings fetched once per clinic via `SettingsContext`
  - Shared across all settings pages (no redundant fetches)
  - Cache TTL: 5 minutes (settings don't change frequently)

- [x] **Caching**: 
  - Current: Custom cache with clinic ID injection
  - Future: React Query will provide better caching with automatic invalidation

- [x] **Optimistic Updates**: 
  - Not currently used (settings are saved optimistically in memory, but not persisted until save)
  - Form shows changes immediately, but backend save is explicit

- [x] **Lazy Loading**: 
  - Settings pages lazy loaded via React Router
  - Settings components loaded on demand

- [x] **Memoization**: 
  - Settings context values memoized to prevent unnecessary re-renders
  - Form components use React.memo where appropriate

---

## Integration Points

### Backend Integration
- [x] **Dependencies on other services**:
  - Settings affect appointment booking (booking restrictions)
  - Settings affect notification scheduling (reminder hours)
  - Settings affect chatbot behavior (chat settings)
  - Settings affect receipt generation (receipt settings)

- [x] **Database relationships**:
  - Clinic settings stored in `clinics` table
  - Practitioner settings stored in `user_clinic_associations` table
  - No foreign key constraints (JSONB storage)

- [x] **API contracts**:
  - RESTful API with consistent request/response models
  - Partial updates supported (only send changed fields)

### Frontend Integration
- [x] **Shared components used**:
  - `PageHeader`, `SettingsBackButton`, `LoadingSpinner`, `BaseModal`
  - `SettingsSection` (wrapper for settings sections)
  - Form components: `NumberInput`, `Textarea`, `Toggle`, etc.

- [x] **Shared hooks used**:
  - `useSettings` (from SettingsContext)
  - `useApiData` (data fetching)
  - `useAuth` (authentication context)
  - `useModal` (modal management)
  - `useUnsavedChangesDetection` (navigation warnings)
  - `useFormErrorScroll` (scroll to errors)

- [x] **Shared stores used**:
  - `serviceItemsStore` (for service items settings page)

- [x] **Navigation/routing changes**:
  - Settings pages: `/admin/clinic/settings/*` (nested routes)
  - Settings index: `/admin/clinic/settings`

---

## Security Considerations

- [x] **Authentication requirements**:
  - All settings endpoints require authenticated clinic user
  - Practitioner settings endpoints require admin or self-access

- [x] **Authorization checks**:
  - Clinic settings: Only clinic users can access
  - Practitioner settings: Admins can edit any practitioner, practitioners can edit own settings
  - Admin-only settings: Receipts, resources (enforced in frontend and backend)

- [x] **Input validation**:
  - All settings validated via Pydantic models on backend
  - Frontend validation via Zod schemas (client-side validation)
  - Type checking, field constraints, format validation

- [x] **XSS prevention**:
  - User input sanitized before display
  - React automatically escapes content
  - Rich text fields (if any) use sanitization libraries

- [x] **CSRF protection**:
  - API uses JWT authentication tokens
  - Tokens validated on every request

- [x] **Data isolation**:
  - Clinic isolation enforced via `ensure_clinic_access()` dependency
  - Users can only access settings for their active clinic
  - Practitioner settings scoped to user-clinic association

---

## Summary

This document covers:
- Settings architecture (two-level: clinic and practitioner, JSONB storage, Pydantic validation)
- Clinic settings (five setting groups: notification, booking restriction, clinic info, chat, receipt)
- Practitioner settings (compact schedule, extensible)
- Settings validation (Pydantic models, type checking, field validation)
- Settings defaults (sensible defaults for all settings)
- Settings access (centralized service, direct model access)
- Settings updates (partial updates, merge strategy, atomic updates)
- Settings impact on system behavior (reminders, booking, chat, receipts, UI)
- Edge cases (missing settings, invalid format, update failures, concurrency, deletion, schema migration, test mode)
- Backend technical design (API endpoints, database schema, business logic)
- Frontend technical design (state management, components, user flows, testing requirements)

All settings are validated before saving and have sensible defaults to ensure system reliability and ease of use.

**Migration Status**: This document has been migrated to the new template format. Frontend sections reflect current implementation using `useApiData` and `SettingsContext`. React Query migration is planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`.
