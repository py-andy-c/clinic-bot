# Clinic-Specific LIFF ID Support

## Problem Statement

Some clinics have their Messaging API channel under a different provider than our global LIFF app. This causes user ID mismatches because LINE assigns user IDs per provider:

- **LIFF user ID**: From our provider (global LIFF app)
- **Messaging API user ID**: From clinic's provider (different provider)

When these don't match, appointment confirmations fail because we try to send messages using the LIFF user ID to a Messaging API channel that expects a different user ID.

**Root Cause**: LINE's design permanently associates providers with Official Accounts. Once a clinic's Messaging API channel is linked to a provider, it cannot be moved.

**Solution**: Allow clinics to use their own LIFF app under the same provider as their Messaging API channel. This ensures both LIFF and Messaging API return the same user ID.

## Architecture: Single Deployment

**Key Requirement**: All LIFF apps (global and clinic-specific) are served from a single backend deployment.

**How It Works**:
- All LIFF apps redirect to the same endpoint URL (configured in LINE Developers Console)
- Backend serves a single React app that handles all clinics
- Frontend extracts `liff_id` from URL query parameters to identify clinic and initialize LIFF
- For global LIFF: Uses `clinic_token` to identify clinic
- For clinic-specific LIFF: Uses `liff_id` to identify clinic (no `clinic_token` needed)

## Proposed Changes

### 1. Database Schema

**Add to `clinics` table:**
- `liff_id` (VARCHAR(255), nullable, optional)
  - Stores clinic-specific LIFF app ID
  - When set, clinic uses this LIFF instead of global one
  - When NULL, clinic uses global `LIFF_ID` from `config.py`

### 2. Backend Changes

#### 2.1 Model Updates
- Add `liff_id` field to `Clinic` model (`backend/src/models/clinic.py`)

#### 2.2 API Updates
- **Clinic Creation** (`POST /api/system/clinics`):
  - Add optional `liff_id` field to `ClinicCreateRequest`
  - Basic validation: non-empty string, alphanumeric

- **Clinic Update** (`PUT /api/system/clinics/{clinic_id}`):
  - Add optional `liff_id` field to `ClinicUpdateRequest`
  - Same validation as creation

- **Clinic Response**:
  - Include `liff_id` in clinic detail response

- **LIFF Authentication** (`POST /api/liff/auth/liff-login`):
  - Accept either `clinic_token` (for global LIFF) or `liff_id` (for clinic-specific LIFF)
  - If `liff_id` provided: Look up clinic by `liff_id`
  - If `clinic_token` provided: Look up clinic by `clinic_token` (existing behavior)

#### 2.3 LIFF URL Generation
- **Update `generate_liff_url()` in `backend/src/utils/liff_token.py`**:
  ```python
  def generate_liff_url(clinic: Clinic, mode: str = "book") -> str:
      # Priority: clinic.liff_id > global LIFF_ID from config
      liff_id = clinic.liff_id or LIFF_ID
      
      if not liff_id:
          logger.warning(f"Clinic {clinic.id}: No LIFF_ID configured")
          base_url = f"https://liff.line.me/clinic_{clinic.id}"
      else:
          base_url = f"https://liff.line.me/{liff_id}"
      
      params = {
          "mode": mode,
          "liff_id": liff_id,  # Always include liff_id in query params
      }
      
      # Only include clinic_token for global LIFF (when clinic.liff_id is NULL)
      if not clinic.liff_id:
          # Global LIFF: need clinic_token to identify clinic
          if clinic.liff_access_token:
              params["clinic_token"] = clinic.liff_access_token
          else:
              params["clinic_id"] = str(clinic.id)  # Backward compatibility
      
      query_string = "&".join([f"{k}={v}" for k, v in params.items()])
      return f"{base_url}?{query_string}"
  ```

**Key Changes**:
- Always include `liff_id` as query parameter
- Only include `clinic_token` when `clinic.liff_id` is NULL (global LIFF)
- Clinic-specific LIFF URLs don't include `clinic_token`

#### 2.4 Database Migration
- Create Alembic migration to add `liff_id` column to `clinics` table
- Column: `liff_id VARCHAR(255) NULL`

### 3. Frontend Changes

#### 3.1 Type Definitions
- Add `liff_id?: string` to `Clinic` interface in `frontend/src/types/index.ts`

#### 3.2 Clinic Onboarding (Create Modal)
- **File**: `frontend/src/pages/SystemClinicsPage.tsx`
- Add optional input field for "LIFF ID" in clinic creation form
- Help text: "Optional. If clinic has their own LIFF app under the same provider as their Messaging API channel, enter the LIFF ID here. Leave empty to use global LIFF."

#### 3.3 Clinic Detail Page (Edit Mode)
- **File**: `frontend/src/pages/SystemClinicsPage.tsx`
- Add "LIFF ID" field in edit mode
- Display current `liff_id` value (or "Not set" if NULL)
- Allow editing the field

#### 3.4 LIFF Initialization
- **Update `useLiff.ts`**:
  - Extract `liff_id` from URL query parameters
  - If not found, show error (should always be present)
  - Initialize LIFF: `liff.init({ liffId })`
  - **Deprecate `VITE_LIFF_ID`** - no longer needed

#### 3.5 LIFF Authentication
- **Update `useLineAuth.ts`**:
  - Extract `liff_id` from URL query parameters
  - Extract `clinic_token` from URL query parameters (may be absent for clinic-specific LIFF)
  - If `liff_id` present: Call `/api/liff/auth/liff-login` with `liff_id` to identify clinic
  - If `clinic_token` present: Call `/api/liff/auth/liff-login` with `clinic_token` (existing behavior)
  - Backend looks up clinic by `liff_id` or `clinic_token` accordingly

## Complete Flow

### LIFF URL Format

**Clinic-Specific LIFF (when `clinic.liff_id` is set):**
```
https://liff.line.me/{liff_id}?mode=book&liff_id={liff_id}
```

**Global LIFF (when `clinic.liff_id` is NULL):**
```
https://liff.line.me/{global_liff_id}?mode=book&liff_id={global_liff_id}&clinic_token={clinic_token}
```

**Key Points:**
- `liff_id` is always included as query parameter (for frontend extraction)
- `clinic_token` is only included for global LIFF (to identify clinic)
- Clinic-specific LIFF doesn't need `clinic_token` (clinic identified by `liff_id`)

### End-to-End Flow

**1. URL Generation (Backend)**
- If `clinic.liff_id` is set: Generate URL with `liff_id` only (no `clinic_token`)
- If `clinic.liff_id` is NULL: Generate URL with `liff_id` and `clinic_token`

**2. User Clicks URL in LINE App**
- LINE recognizes the `{liff_id}` in the URL path
- LINE redirects to the endpoint URL configured for that LIFF app
- All LIFF apps redirect to the same endpoint URL
- Query parameters are preserved in the redirect

**3. Backend Serves React App**
- Backend catch-all route serves `index.html`
- React Router routes to `/liff/*` which renders `LiffApp` component

**4. Frontend Initializes LIFF**
- Extract `liff_id` from URL query parameters
- Initialize LIFF: `liff.init({ liffId })`

**5. Frontend Authenticates User**
- Extract `liff_id` and `clinic_token` from URL query parameters
- If `liff_id` present: Call `/api/liff/auth/liff-login` with `liff_id`
- If `clinic_token` present: Call `/api/liff/auth/liff-login` with `clinic_token`
- Backend identifies clinic and creates/updates LINE user record

**6. User Interacts with LIFF App**
- User can book appointments, view appointments, etc.
- All API calls include authentication token with `clinic_id`

### LINE Developers Console Configuration

**For Each LIFF App (Global and Clinic-Specific):**
1. Create LIFF app in LINE Developers Console (under the appropriate provider)
2. Set **Endpoint URL** to your backend domain (e.g., `https://your-backend.com/`)
   - **Critical**: All LIFF apps must use the **same endpoint URL**
3. Save the LIFF ID (stored in `clinic.liff_id` for clinic-specific LIFFs)

## Implementation Steps

1. **Database Migration**
   - Create Alembic migration to add `liff_id` column

2. **Backend Model & API**
   - Add `liff_id` to `Clinic` model
   - Update `ClinicCreateRequest` and `ClinicUpdateRequest`
   - Update `generate_liff_url()` to conditionally include `clinic_token`
   - Update `/api/liff/auth/liff-login` to accept `liff_id` parameter

3. **Frontend UI**
   - Add `liff_id` field to clinic creation form
   - Add `liff_id` field to clinic detail edit page
   - Update TypeScript types

4. **Frontend LIFF Initialization**
   - Update `useLiff.ts` to extract `liff_id` from URL (remove `VITE_LIFF_ID` dependency)
   - Update `useLineAuth.ts` to handle both `liff_id` and `clinic_token` authentication

5. **Testing**
   - Test clinic creation with and without `liff_id`
   - Test clinic update with `liff_id`
   - Verify LIFF URL generation (with/without `clinic_token`)
   - Test LIFF initialization and authentication for both scenarios

## Usage Instructions

### For System Admin

**During Clinic Onboarding:**
1. If clinic has their own LIFF app: Enter the LIFF ID in the "LIFF ID" field
2. Leave empty to use the global LIFF app

**Editing Existing Clinic:**
1. Navigate to clinic detail page → Click "編輯診所" (Edit Clinic)
2. Set or update the "LIFF ID" field
3. Save changes

### For Clinic Admin (LIFF App Setup)

**Creating Clinic-Specific LIFF App:**
1. Log into LINE Developers Console
2. Navigate to the provider that contains the clinic's Messaging API channel
3. Go to "LIFF" tab → Click "Add"
4. Configure:
   - **Endpoint URL**: Set to your backend domain (same as global LIFF app)
   - **Size**: Full, Tall, or Compact
   - **Scope**: Configure as needed
5. Save and copy the **LIFF ID**
6. Provide LIFF ID to system admin

## URL Examples

### Example 1: Clinic Using Global LIFF

**Clinic Settings:**
- `liff_id`: `NULL`
- `liff_access_token`: `abc123xyz...`

**Generated LIFF URL:**
```
https://liff.line.me/1234567890-ab?mode=book&liff_id=1234567890-ab&clinic_token=abc123xyz...
```

**Flow:**
1. User clicks URL → LINE redirects with query parameters preserved
2. Frontend extracts `liff_id=1234567890-ab` → Initializes LIFF
3. Frontend extracts `clinic_token` → Authenticates with backend using `clinic_token`
4. Backend identifies clinic by `clinic_token`

### Example 2: Clinic Using Custom LIFF

**Clinic Settings:**
- `liff_id`: `9876543210-cd`
- `liff_access_token`: `xyz789abc...` (not used in URL)

**Generated LIFF URL:**
```
https://liff.line.me/9876543210-cd?mode=book&liff_id=9876543210-cd
```

**Flow:**
1. User clicks URL → LINE redirects with query parameters preserved
2. Frontend extracts `liff_id=9876543210-cd` → Initializes LIFF
3. Frontend authenticates with backend using `liff_id`
4. Backend identifies clinic by `liff_id` (looks up `clinic.liff_id = '9876543210-cd'`)

## Backward Compatibility

- Existing clinics without `liff_id` set continue using global LIFF with `clinic_token`
- No breaking changes to existing functionality
- All changes are additive and optional
- Existing LIFF URLs continue to work

## Future Considerations

In the future, we may migrate to using each clinic's provider with both Messaging API and LIFF channels under it by default. This change is a stepping stone that allows us to handle the current edge case while maintaining flexibility for future architecture changes.
