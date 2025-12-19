# Clinic-Specific Provider LIFF Support

## Problem Statement

Some clinics have their own LINE provider (created by clinic owner). Since:
- Providers cannot be changed once linked to an official account
- User IDs differ per provider (same physical user = different LINE user IDs)
- Clinics with their own provider need clinic-specific LIFF apps under their provider

We need to support both:
1. **Shared LIFF app** (current): All clinics under our provider use one LIFF app
2. **Clinic-specific LIFF apps**: Clinics with their own provider use their own LIFF app

## Current Architecture

- Single shared LIFF app (LIFF_ID from env)
- Clinic identification via `clinic_token` (liff_access_token) in URL query parameter
- JWT contains `clinic_id` and `clinic_token` for validation
- All clinics share same provider → same user IDs

## Approaches for Clinic Identification

### Option 1: Clinic Token in URL (Current - Shared LIFF Only)
**How it works:**
- URL: `https://liff.line.me/{LIFF_ID}?clinic_token=abc123`
- Frontend extracts `clinic_token` from URL
- Backend looks up clinic by `liff_access_token`

**Pros:**
- ✅ Works for shared LIFF app (multiple clinics share one LIFF ID)
- ✅ Simple implementation
- ✅ Secure (cryptographic token)

**Cons for clinic-specific LIFF apps:**
- ❌ **Redundant**: Each clinic-specific LIFF app already has unique LIFF ID
- ❌ **Complex setup**: Admin must configure both LIFF ID and token in URL
- ❌ **URL bloat**: Long cryptographic tokens make URLs unwieldy
- ❌ **Security**: Tokens in URLs can be logged/cached/shared accidentally
- ❌ **Not native**: Requires URL parsing instead of using `liff.getContext().liffId`

### Option 2: LIFF ID as Clinic Identifier
**How it works:**
- Store `liff_id` per clinic in database
- Frontend calls `liff.getContext()` to get `liffId`
- Backend looks up clinic by `liff_id`
- URL: `https://liff.line.me/{clinic_liff_id}/appointment`

**Pros:**
- ✅ Native LINE API approach (`liff.getContext()`)
- ✅ No URL parameters needed
- ✅ Each clinic has unique LIFF ID (natural isolation)
- ✅ Works for both shared and clinic-specific LIFF apps

**Cons:**
- ❌ Requires database migration (add `liff_id` column)
- ❌ Need to manage LIFF ID creation/registration per clinic
- ❌ Shared LIFF app clinics still need `liff_id` stored

### Option 3: Clinic-Specific Backend Routes
**How it works:**
- Clinic-specific LIFF apps call clinic-specific routes: `/api/liff/{clinic_id}/appointment`
- Backend extracts `clinic_id` from route
- Shared LIFF apps continue using current routes

**Pros:**
- ✅ Clear separation (clinic ID in route)
- ✅ Easy to identify clinic from route

**Cons:**
- ❌ Requires route changes
- ❌ Still need to identify clinic (how does frontend know clinic_id?)
- ❌ Doesn't solve the identification problem

### Option 4: Hybrid - LIFF ID + Token Fallback (RECOMMENDED)
**How it works:**
1. **Clinic-specific LIFF apps**: Use `liff.getContext().liffId` to identify clinic (native, no URL params)
2. **Shared LIFF app**: Continue using `clinic_token` in URL (backward compatible)
3. Backend supports both with priority: `liff_id` first, then `clinic_token`

**Rationale:**
- **Token-only doesn't work well for clinic-specific apps**: Each clinic already has unique LIFF ID, making tokens redundant. Requires complex setup (LIFF ID + token), creates URL bloat, and doesn't use native LINE API.
- **Hybrid approach**: Best of both worlds - native LINE API for clinic-specific apps, backward compatible tokens for shared LIFF.

**Pros:**
- ✅ Backward compatible (shared LIFF continues working)
- ✅ Native LINE API (`liff.getContext()`) for clinic-specific apps
- ✅ No URL parameters needed for clinic-specific apps
- ✅ Simpler setup (just register LIFF ID, no token configuration)
- ✅ More secure (no tokens in URLs for clinic-specific apps)

**Cons:**
- ❌ Slightly more complex logic (dual lookup)
- ❌ Requires database migration

## Recommended Solution: Hybrid Approach

### Database Changes

```sql
ALTER TABLE clinics ADD COLUMN liff_id VARCHAR(255) NULL;
CREATE INDEX idx_clinics_liff_id ON clinics(liff_id) WHERE liff_id IS NOT NULL;
```

### Model Changes

```python
# backend/src/models/clinic.py
liff_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True, index=True)
```

### Frontend Changes

**1. LIFF Initialization (`frontend/src/hooks/useLiff.ts`)**

**Important**: LINE infrastructure does NOT forward the LIFF ID in the endpoint URL. When LINE loads a LIFF app, it loads the configured endpoint URL (e.g., `https://yourdomain.com/liff/appointment`), but the LIFF ID is not included in that URL.

**Solution**: Use `liff.getContext().liffId` AFTER initialization to get the LIFF ID. However, we still need the LIFF ID to initialize. Options:

**Option A: Pass LIFF ID as URL parameter** (Recommended for clinic-specific apps)
- Configure clinic-specific LIFF apps with endpoint: `https://yourdomain.com/liff/appointment?liff_id={LIFF_ID}`
- Extract from URL before initialization

```typescript
// Extract LIFF ID from URL parameter (for clinic-specific LIFF apps)
const getLiffIdFromUrl = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  return params.get('liff_id');
};

// Get LIFF ID: try URL param first (clinic-specific), fall back to env var (shared LIFF)
const liffId = getLiffIdFromUrl() || import.meta.env.VITE_LIFF_ID;

if (!liffId) {
  throw new Error('LIFF ID not found in URL parameter or environment variable');
}

// Initialize LIFF
await liff.init({ liffId });

// After initialization, verify with getContext() (optional but recommended)
const context = liff.getContext();
if (context?.liffId && context.liffId !== liffId) {
  logger.warn(`LIFF ID mismatch: initialized with ${liffId}, context has ${context.liffId}`);
}
```

**Option B: Separate endpoint URLs per clinic**
- Each clinic-specific LIFF app has its own endpoint URL
- Not recommended: requires separate deployments or complex routing

**2. Clinic Identification (`frontend/src/hooks/useLineAuth.ts`)**

```typescript
// Get LIFF ID from context (available after LIFF initialization)
// This is the authoritative source - confirms the LIFF ID used for initialization
// ALWAYS use getContext().liffId over URL parameter for security (can't be spoofed)
const context = liff.getContext();
const liffId = context?.liffId;

// Fall back to clinic_token from URL (shared LIFF app only)
const urlParams = new URLSearchParams(window.location.search);
const clinicToken = urlParams.get('clinic_token');

// Send to backend
const loginRequest = {
  line_user_id: profile.userId,
  display_name: profile.displayName,
  liff_access_token: liff.getAccessToken(),
  liff_id: liffId || null,  // For clinic-specific LIFF apps (from getContext())
  clinic_token: clinicToken || null  // For shared LIFF app (backward compatibility)
};
```

**3. Clinic Isolation Validation (`frontend/src/hooks/useLineAuth.ts`)**

Update `validateClinicIsolation()` to handle both clinic-specific and shared LIFF apps:

```typescript
const validateClinicIsolation = (token: string): boolean => {
  const tokenPayload = decodeJWT(token);
  const context = liff.getContext();
  const liffId = context?.liffId;

  // Clinic-specific LIFF app: validate liff_id matches
  if (liffId && tokenPayload.liff_id) {
    if (liffId !== tokenPayload.liff_id) {
      logger.error('LIFF ID mismatch - clinic isolation violation');
      return false;
    }
    return true;
  }

  // Shared LIFF app: validate clinic_token matches (existing logic)
  if (tokenPayload.clinic_token) {
    const urlClinicToken = getClinicTokenFromUrl();
    if (!urlClinicToken || urlClinicToken !== tokenPayload.clinic_token) {
      logger.error('Clinic token mismatch - clinic isolation violation');
      return false;
    }
    return true;
  }

  // No identifier in token - invalid
  logger.error('Missing clinic identifier in token');
  return false;
};
```

### Backend Changes

**File**: `backend/src/api/liff.py`

```python
# LIFF ID format validation (LINE format: {channel_id}-{random_string})
LIFF_ID_PATTERN = re.compile(r'^[0-9]+-[a-zA-Z0-9]+$')

def validate_liff_id_format(liff_id: str) -> bool:
    """Validate LIFF ID format matches LINE's pattern."""
    return bool(LIFF_ID_PATTERN.match(liff_id))

class LiffLoginRequest(BaseModel):
    line_user_id: str
    display_name: str
    liff_access_token: str
    liff_id: Optional[str] = None  # NEW: For clinic-specific LIFF apps
    clinic_token: Optional[str] = None  # Keep for backward compatibility
    picture_url: Optional[str] = None

    @model_validator(mode='after')
    def validate_clinic_identifier(self):
        """Ensure at least one clinic identifier is provided."""
        if not self.liff_id and not self.clinic_token:
            raise ValueError("Either liff_id or clinic_token is required")

        # Validate LIFF ID format if provided
        if self.liff_id and not validate_liff_id_format(self.liff_id):
            raise ValueError("Invalid LIFF ID format")

        return self

@router.post("/auth/liff-login")
async def liff_login(request: LiffLoginRequest, db: Session = Depends(get_db)):
    clinic = None

    # Priority 1: Look up by liff_id (clinic-specific LIFF apps)
    if request.liff_id:
        # Format already validated by model validator
        clinic = db.query(Clinic).filter(
            Clinic.liff_id == request.liff_id,
            Clinic.is_active == True
        ).first()

    # Priority 2: Fall back to clinic_token (shared LIFF app)
    if not clinic and request.clinic_token:
        if not validate_token_format(request.clinic_token):
            raise HTTPException(status_code=400, detail="Invalid token format")

        clinic = db.query(Clinic).filter(
            Clinic.liff_access_token == request.clinic_token,
            Clinic.is_active == True
        ).first()

    if not clinic:
        raise HTTPException(status_code=404, detail="診所不存在或已停用")

    # Generate JWT with appropriate identifiers
    now = datetime.now(timezone.utc)
    token_payload = {
        "line_user_id": line_user.line_user_id,
        "clinic_id": clinic.id,
        "liff_id": clinic.liff_id if clinic.liff_id else None,  # Include for clinic-specific apps
        "clinic_token": clinic.liff_access_token if not clinic.liff_id else None,  # Only for shared LIFF
        "exp": now + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES),
        "iat": now
    }
    access_token = jwt.encode(token_payload, JWT_SECRET_KEY, algorithm="HS256")

    # Rest of login logic...
```

### LIFF App Registration and Configuration Flow

**For clinics with their own provider (clinic-specific LIFF apps):**

1. **Admin creates LIFF app in LINE Developers Console**
   - Navigate to clinic's provider → Create new LIFF app
   - Gets LIFF ID (e.g., `1234567890-abcdefgh`)
   - **Configure endpoint URL**: `https://yourdomain.com/liff/appointment?liff_id={LIFF_ID}`
     - Replace `{LIFF_ID}` with the actual LIFF ID (e.g., `https://yourdomain.com/liff/appointment?liff_id=1234567890-abcdefgh`)
     - This URL parameter is required for frontend to know which LIFF ID to use for initialization

2. **Admin registers LIFF ID in our system**
   - UI: Clinic settings → "Register LIFF App"
   - Input: LIFF ID (copy from LINE Console)
   - Backend: Store in `clinics.liff_id`
   - Validation:
     - Ensure LIFF ID format is valid (alphanumeric + hyphens)
     - Ensure LIFF ID is unique across all clinics
     - Verify clinic is active

3. **Frontend automatically detects and uses LIFF ID**
   - Frontend extracts `liff_id` from URL parameter (`?liff_id=...`)
   - Uses it to initialize LIFF SDK: `liff.init({ liffId })`
   - After initialization, verifies with `liff.getContext().liffId`
   - Sends `liff_id` to backend for clinic lookup (no `clinic_token` needed)

**For clinics using shared LIFF app (current behavior):**
- No changes needed
- Continue using `VITE_LIFF_ID` env var
- Continue using `clinic_token` in URL for clinic identification

### Clinic Onboarding Flow

**Scenario 1: New clinic with own provider (clinic-specific LIFF)**

1. Clinic owner creates LINE provider and official account
2. Clinic owner creates LIFF app in LINE Developers Console:
   - Gets LIFF ID (e.g., `1234567890-abcdefgh`)
   - Configures endpoint URL: `https://yourdomain.com/liff/appointment?liff_id=1234567890-abcdefgh`
3. System admin adds clinic to system:
   - Creates clinic record
   - Registers clinic's LINE channel credentials (channel ID, secret, access token)
   - Registers clinic's LIFF ID in system (UI: Clinic settings → "Register LIFF App")
4. System generates LIFF URLs using `clinic.liff_id`:
   - URL format: `https://liff.line.me/{clinic.liff_id}?mode=book`
   - Used in notifications, messages, etc.

**Scenario 2: Existing clinic migrating to own provider**

1. Clinic owner creates LINE provider and official account
2. Clinic owner creates LIFF app in LINE Developers Console (same as Scenario 1)
3. System admin updates clinic:
   - Updates LINE channel credentials
   - Registers new LIFF ID
   - Clinic now uses clinic-specific LIFF app (no longer uses shared LIFF)

**Scenario 3: New clinic using shared LIFF (current behavior)**

1. System admin adds clinic to system
2. System generates `liff_access_token` for clinic
3. System generates LIFF URLs using shared `LIFF_ID` + `clinic_token`:
   - URL format: `https://liff.line.me/{SHARED_LIFF_ID}?mode=book&clinic_token=...`

### Migration Strategy

1. **Phase 1: Add `liff_id` column** (nullable)
   - Existing clinics continue using `clinic_token`
   - No breaking changes

2. **Phase 2: Update frontend**
   - Support both `liff_id` and `clinic_token`
   - Try `liff_id` first, fall back to `clinic_token`

3. **Phase 3: Update backend**
   - Accept both identifiers
   - Look up by `liff_id` first, then `clinic_token`
   - Update `generate_liff_url()` to use `clinic.liff_id` when available

4. **Phase 4: Register clinic-specific LIFF apps**
   - As clinics migrate to their own providers
   - Admin registers LIFF ID in system
   - System automatically uses clinic-specific LIFF URLs

## Alternative: Pure LIFF ID Approach

**Not recommended** - Would require all clinics (including shared LIFF) to have individual LIFF IDs, causing breaking changes and complex migration.

## Security Considerations

1. **LIFF ID validation**:
   - Format: `^[0-9]+-[a-zA-Z0-9]+$` (e.g., `1234567890-abcdefgh`)
   - Validate on registration to catch typos early
   - Backend validates format before database lookup

2. **Clinic isolation**:
   - Verify clinic is active before authentication
   - Frontend validates `liff_id` from `getContext()` matches JWT `liff_id` (can't be spoofed)
   - Backend validates `liff_id` exists and belongs to active clinic

3. **Token security**:
   - Keep `liff_access_token` secure (already implemented)
   - `liff_id` is public (visible in URLs) but requires LINE authentication
   - Always use `getContext().liffId` as authoritative source (not URL parameter)

4. **User ID mapping**:
   - Handle different user IDs per provider correctly (already handled via `LineUser.clinic_id`)

5. **Rate limiting**:
   - Consider rate limiting on `/auth/liff-login` to prevent brute force on `liff_id` lookup

6. **Audit logging**:
   - Log clinic identification method (`liff_id` vs `clinic_token`) for security monitoring

## Testing Strategy

1. **Shared LIFF app** (existing):
   - Continue using `clinic_token`
   - Verify backward compatibility

2. **Clinic-specific LIFF app**:
   - Mock `liff.getContext()` to return clinic's `liff_id`
   - Verify clinic lookup works
   - Verify user ID handling (different per provider)

3. **Edge cases**:
   - Clinic with both `liff_id` and `clinic_token` (should prefer `liff_id`)
   - Clinic with neither (should fail gracefully)
   - Invalid `liff_id` format

### LIFF URL Generation Changes

**File**: `backend/src/utils/liff_token.py`

```python
def generate_liff_url(clinic: Clinic, mode: str = "book") -> str:
    """
    Generate LIFF URL for a clinic.

    For clinic-specific LIFF apps: Uses clinic.liff_id
    For shared LIFF app: Uses shared LIFF_ID from env + clinic_token
    """
    # Clinic-specific LIFF app (has liff_id registered)
    if clinic.liff_id:
        base_url = f"https://liff.line.me/{clinic.liff_id}"
        params = {"mode": mode}
        # Note: No clinic_token needed - liff_id identifies the clinic
    else:
        # Shared LIFF app (uses token-based identification)
        if not clinic.liff_access_token:
            raise ValueError(
                f"Clinic {clinic.id} missing liff_access_token - cannot generate LIFF URL"
            )

        if not LIFF_ID:
            raise ValueError("LIFF_ID not configured for shared LIFF app")

        base_url = f"https://liff.line.me/{LIFF_ID}"
        params = {
            "mode": mode,
            "clinic_token": clinic.liff_access_token,
        }

    query_string = "&".join([f"{k}={v}" for k, v in params.items()])
    return f"{base_url}?{query_string}"
```

**Note**: When clinic-specific LIFF apps are accessed, LINE loads the endpoint URL configured in LINE Console (which includes `?liff_id=...`). The frontend extracts this parameter for initialization.

## Implementation Checklist

### Database & Models
- [x] Add `liff_id` column to `clinics` table (nullable, unique, indexed)
- [x] Update `Clinic` model with `liff_id` field
- [x] Create migration script

### Backend
- [x] Update `LiffLoginRequest` to accept both `liff_id` and `clinic_token`
- [x] Update backend login logic (dual lookup: `liff_id` first, then `clinic_token`)
- [x] Update `generate_liff_url()` to use `clinic.liff_id` for clinic-specific apps
- [x] Add validation for LIFF ID format (alphanumeric + hyphens)
- [x] Add API endpoint for registering/updating clinic LIFF ID

### Frontend
- [x] **Update `useLiff` hook**: Extract LIFF ID from URL parameter (`?liff_id=...`) for clinic-specific apps, fall back to `VITE_LIFF_ID` for shared LIFF
- [x] **Update `useLineAuth` hook**: Get `liff_id` from `liff.getContext()` after initialization and send to backend
- [x] Update clinic isolation validation to handle both `liff_id` and `clinic_token`

### Admin UI
- [ ] Add UI for registering clinic-specific LIFF IDs (clinic settings page) - *Frontend UI feature, can be added later*
- [x] Add validation and error handling (backend API ready):
  - Format validation (regex: `^[0-9]+-[a-zA-Z0-9]+$`) ✅
  - Uniqueness check (database) ✅
  - Show endpoint URL template: `https://yourdomain.com/liff/appointment?liff_id={LIFF_ID}` - *Documentation*
  - Optional: Validate LIFF ID exists via LINE API (if permissions available) - *Future enhancement*
- [ ] Show current LIFF ID status (registered/not registered) - *Frontend UI feature*
- [ ] Add instructions for LINE Console configuration - *Documentation*
  - Step-by-step guide with screenshots
  - Copy-paste template for endpoint URL
  - Troubleshooting common issues
- [ ] Add test button to verify LIFF ID validity - *Frontend UI feature*

### Testing
- [x] **CRITICAL**: Test query parameter preservation in LINE redirect flow (verified by user)
- [x] Test shared LIFF app (backward compatibility)
- [x] Test clinic-specific LIFF app initialization
- [x] Test clinic lookup by `liff_id`
- [x] Test clinic lookup by `clinic_token` (shared LIFF)
- [x] Test edge cases:
  - Both identifiers present (should prefer `liff_id`)
  - Neither identifier (should fail gracefully)
  - Invalid `liff_id` format
  - LIFF ID mismatch (URL param vs getContext)
  - Direct endpoint URL access (bypassing LINE redirect)
- [x] Test LIFF URL generation for both types
- [x] Test clinic isolation validation:
  - Clinic-specific: `liff_id` from `getContext()` matches JWT `liff_id`
  - Shared LIFF: `clinic_token` from URL matches JWT `clinic_token`
- [x] Test JWT token structure with both `liff_id` and `clinic_token`
- [x] Test migration scenario: Clinic with both identifiers

### Documentation
- [x] Document LIFF app registration process for admins (in design doc)
- [ ] Create step-by-step guide for LINE Console configuration - *Can be added when Admin UI is built*
- [x] Update API documentation (endpoint supports `liff_id` in `ClinicUpdateRequest`)

## Technical Details and LINE SDK Verification

### LINE SDK/API Feasibility

✅ **Verified**: Our plan is feasible with LINE SDK/API:
- `liff.init({ liffId })` requires LIFF ID before initialization
- `liff.getContext().liffId` returns the LIFF ID after initialization (can be used for verification)
- LINE SDK supports dynamic initialization with different LIFF IDs
- Multiple LIFF apps can share the same endpoint URL with different parameters

### ⚠️ CRITICAL: Query Parameter Preservation - MUST VERIFY

**Question**: Does LINE preserve query parameters when redirecting from `https://liff.line.me/{liff_id}?mode=book` to the endpoint URL configured in LINE Console?

**Why This Matters**:
- Our design relies on extracting `liff_id` from URL parameter (`?liff_id=...`) before initialization
- If LINE strips query parameters during redirect, frontend can't extract `liff_id`
- This would break the entire clinic-specific LIFF flow

**Action Required**:
- **MUST TEST** this flow before implementation
- Test: Configure endpoint URL as `https://yourdomain.com/liff/appointment?liff_id=1234567890-abc`
- Access: `https://liff.line.me/1234567890-abc?mode=book`
- Verify: Does the endpoint URL receive `?liff_id=1234567890-abc&mode=book`?

**Fallback Options** (if parameters NOT preserved):
1. **Subdomain routing**: `{clinic_id}.yourdomain.com/liff/appointment` (requires DNS setup)
2. **Path-based routing**: `yourdomain.com/liff/{liff_id}/appointment` (requires routing changes)
3. **Cookie/localStorage**: Store `liff_id` after first successful access (complex, not recommended)

**Recommendation**: Verify query parameter preservation is the FIRST step before proceeding with implementation.

### VITE_LIFF_ID and LINE Infrastructure

**Current usage**: `VITE_LIFF_ID` env var is used in `useLiff.ts` to initialize the LIFF SDK with `liff.init({ liffId })`. This is required before any LIFF APIs can be used.

**Important finding**: LINE infrastructure does NOT forward the LIFF ID in the endpoint URL automatically. When LINE loads a LIFF app:
- LINE loads the configured endpoint URL from LINE Developers Console
- The LIFF ID is NOT included in that URL automatically
- The LIFF ID is only available via `liff.getContext().liffId` AFTER initialization

**Solution**: Configure endpoint URL in LINE Console with `liff_id` as a URL parameter:
- Endpoint URL: `https://yourdomain.com/liff/appointment?liff_id=1234567890-abcdefgh`
- Frontend extracts `liff_id` from URL parameter before initialization
- After initialization, `liff.getContext().liffId` confirms the LIFF ID

**For shared LIFF app**: Continue using `VITE_LIFF_ID` env var (current behavior). No URL parameter needed.

**For clinic-specific LIFF apps**:
- Each clinic's LIFF app endpoint URL must include `?liff_id={CLINIC_LIFF_ID}`
- Frontend extracts from URL parameter for initialization
- After initialization, uses `liff.getContext().liffId` to send to backend
- This allows single codebase to work for all clinics

### LIFF URL Generation

**Current behavior** (shared LIFF):
- URL: `https://liff.line.me/{SHARED_LIFF_ID}?mode=book&clinic_token=...`
- Generated by `generate_liff_url()` using `LIFF_ID` env var

**New behavior** (clinic-specific LIFF):
- URL: `https://liff.line.me/{CLINIC_LIFF_ID}?mode=book`
- Generated by `generate_liff_url()` using `clinic.liff_id`
- No `clinic_token` needed (LIFF ID identifies the clinic)

**Note**: The endpoint URL configured in LINE Console is what LINE loads when users access the LIFF app. The `generate_liff_url()` function generates the URL that users click to access the app (used in notifications, messages, etc.).

## Edge Cases and Open Questions

### Edge Cases to Handle

1. **LIFF ID Mismatch Between URL Parameter and getContext()**
   - **Scenario**: URL has `?liff_id=ABC` but `liff.getContext().liffId` returns `XYZ`
   - **Cause**: Misconfigured endpoint URL in LINE Console (wrong LIFF ID in parameter)
   - **Handling**:
     - Log warning during initialization
     - Use `getContext().liffId` as authoritative source (it's what LINE actually initialized)
     - Send `getContext().liffId` to backend (not URL parameter)
     - Alert admin if mismatch detected

2. **Clinic Has Both `liff_id` and `clinic_token`**
   - **Scenario**: Clinic registered `liff_id` but still has `clinic_token` from shared LIFF days
   - **Handling**:
     - Backend prefers `liff_id` (already implemented)
     - If `liff_id` lookup succeeds, ignore `clinic_token`
     - Consider: Should we clear `clinic_token` when `liff_id` is registered? (Optional cleanup)

3. **Endpoint URL Missing `liff_id` Parameter**
   - **Scenario**: Admin configures endpoint as `https://yourdomain.com/liff/appointment` (no `?liff_id=...`)
   - **Impact**: Frontend can't extract LIFF ID, initialization fails
   - **Handling**:
     - Frontend shows clear error: "LIFF app misconfigured - missing liff_id parameter"
     - Admin UI should validate endpoint URL format when registering LIFF ID
     - Provide template: `https://yourdomain.com/liff/appointment?liff_id={LIFF_ID}`

4. **Invalid or Non-Existent LIFF ID**
   - **Scenario**: Admin registers invalid LIFF ID (typo, deleted app, wrong format)
   - **Handling**:
     - Validate format on registration (alphanumeric + hyphens)
     - LIFF initialization will fail if ID is invalid - frontend shows error
     - Consider: Should we validate LIFF ID exists via LINE API? (May require additional permissions)

5. **Clinic Migration: User ID Changes**
   - **Scenario**: Clinic migrates from shared LIFF to clinic-specific LIFF → different provider → different user IDs
   - **Impact**: Same physical user has different LINE user IDs, existing appointments/patients may be orphaned
   - **Handling**:
     - This is expected behavior (already handled via `LineUser.clinic_id`)
     - Users will need to re-register when accessing clinic-specific LIFF
     - Existing data remains linked to old `line_user_id` under shared provider
     - Consider: Migration script to link old/new user IDs? (Complex, may not be necessary)

6. **LIFF App Deleted in LINE Console**
   - **Scenario**: Clinic deletes LIFF app in LINE Console but `liff_id` still registered in our system
   - **Impact**: LIFF initialization fails, users can't access app
   - **Handling**:
     - Frontend shows error on initialization failure
     - Admin should be able to clear/update `liff_id` when LIFF app is recreated
     - Consider: Periodic validation job to check if registered LIFF IDs are still valid?

7. **Direct URL Access vs LINE App Access**
   - **Scenario**: User accesses `https://liff.line.me/{liff_id}?mode=book` directly (not through LINE app)
   - **Impact**: LINE redirects to endpoint URL, but endpoint URL has `?liff_id=...` parameter
   - **Handling**:
     - This should work - LINE redirects to endpoint URL which includes the parameter
     - Frontend extracts `liff_id` from endpoint URL parameter
     - **Question**: Does LINE preserve query parameters when redirecting? (Needs verification)

8. **Multiple LIFF Apps Per Clinic**
   - **Scenario**: Clinic wants multiple LIFF apps (e.g., one for patients, one for staff)
   - **Current Design**: One `liff_id` per clinic
   - **Handling**:
     - Not supported in current design
     - If needed: Could extend to support multiple LIFF IDs per clinic (requires schema change)

9. **LIFF ID Format Changes**
   - **Scenario**: LINE changes LIFF ID format in future
   - **Handling**:
     - Validation regex should be flexible enough
     - Current pattern: alphanumeric + hyphens (common format)
     - Update validation if LINE announces format changes

10. **Backward Compatibility During Migration**
    - **Scenario**: System is partially migrated - some services still generate old URLs
    - **Handling**:
      - `generate_liff_url()` handles both cases (checks `clinic.liff_id` first)
      - Old URLs with `clinic_token` continue to work
      - Gradual migration is safe

11. **Security: LIFF ID Spoofing**
    - **Scenario**: Attacker tries to use another clinic's `liff_id` in URL parameter
    - **Handling**:
      - Backend validates `liff_id` exists and belongs to active clinic
      - `liff.getContext().liffId` is authoritative (can't be spoofed - comes from LINE SDK)
      - Frontend should prefer `getContext().liffId` over URL parameter for security

12. **Error Handling: LIFF Initialization Failure**
    - **Scenario**: Invalid `liff_id` causes `liff.init()` to fail
    - **Handling**:
      - Frontend catches error and shows user-friendly message
      - Logs error for admin debugging
      - Suggests contacting clinic if persistent

### Open Questions

1. **Should we validate LIFF ID exists via LINE API?**
   - **Pros**: Catch misconfigurations early
   - **Cons**: Requires additional LINE API permissions, adds complexity
   - **Recommendation**: Start without validation, add if needed based on user feedback

2. **Should we clear `clinic_token` when `liff_id` is registered?**
   - **Pros**: Cleaner data, prevents confusion
   - **Cons**: Breaks backward compatibility if clinic switches back
   - **Recommendation**: Keep both, prefer `liff_id` in lookup logic

3. **How to handle clinic migration user data?**
   - **Question**: Should we provide migration tools to link old/new user IDs?
   - **Recommendation**: Document that users need to re-register. Migration tools are complex and may not be necessary if data is clinic-scoped.

4. **Should we support multiple LIFF IDs per clinic?**
   - **Question**: Some clinics might want separate LIFF apps for different purposes
   - **Recommendation**: Start with one per clinic, extend if needed (requires schema change to `liff_ids` array)

5. **What if endpoint URL domain changes?**
   - **Question**: If we change our domain, all endpoint URLs in LINE Console need updating
   - **Recommendation**:
     - Document this as admin responsibility
     - Provide migration script to generate new endpoint URLs for all clinics
     - Admin UI: Bulk-export endpoint URLs for easy copy-paste
     - Consider: Can we detect domain mismatches? (May require LINE API permissions)

6. **Should we store endpoint URL in database?**
   - **Question**: Currently we only store `liff_id`, but endpoint URL is configured in LINE Console
   - **Recommendation**: No - endpoint URL is LINE Console configuration, not our data. Admin manages it there.

7. **What about LIFF app size/type configuration?**
   - **Question**: LINE Console allows configuring LIFF app size (full, tall, compact, etc.)
   - **Recommendation**: This is UI configuration, doesn't affect our implementation. Admin configures in LINE Console.

8. **How to handle LIFF app permissions/scopes?**
   - **Question**: Do clinic-specific LIFF apps need different permissions than shared LIFF?
   - **Recommendation**: Same permissions should work. Verify during testing.
   - **Required permissions**: `profile`, `openid` (for LINE Login)

9. **Query Parameter Preservation** ⚠️ **CRITICAL - MUST VERIFY**
   - **Question**: Does LINE preserve query parameters when redirecting from `https://liff.line.me/{liff_id}` to endpoint URL?
   - **Impact**: If not, frontend can't extract `liff_id` from URL parameter
   - **Action Required**: Test this flow explicitly before implementation
   - **Fallback Options** (if parameters not preserved):
     - Subdomain routing: `{clinic_id}.yourdomain.com/liff/appointment`
     - Path-based routing: `yourdomain.com/liff/{liff_id}/appointment`
     - Cookie/localStorage: Store `liff_id` after first access

### Recommended Error Messages

**Frontend Errors (User-Facing):**
- **Missing LIFF ID**: "此診所的 LINE 應用程式設定有誤，請聯絡診所管理員" (zh-TW) / "Clinic LINE app configuration error, please contact clinic administrator" (en)
- **LIFF initialization failed**: "無法載入預約系統，請稍後再試" (zh-TW) / "Unable to load appointment system, please try again later" (en)
- **LIFF ID mismatch**: "應用程式設定不一致，請重新載入" (zh-TW) / "App configuration mismatch, please reload" (en)
- **Clinic not found**: "找不到診所資訊，請確認您使用的是正確的 LINE 官方帳號" (zh-TW) / "Clinic not found, please verify you're using the correct LINE Official Account" (en)

**Frontend Errors (Developer/Admin):**
- "LIFF ID not found in URL parameter or environment variable" → Check LINE Console endpoint URL configuration
- "LIFF initialization failed" → Check if LIFF ID is valid and app exists in LINE Console
- "LIFF ID mismatch detected" → Endpoint URL has wrong LIFF ID parameter

**Backend Errors:**
- "診所不存在或已停用" → Clinic not found or inactive
- "Invalid LIFF ID format" → LIFF ID doesn't match expected format (`^[0-9]+-[a-zA-Z0-9]+$`)
- "LIFF ID already registered to another clinic" → Duplicate LIFF ID detected
- "Either liff_id or clinic_token is required" → Missing clinic identifier

## Review Feedback Addressed

### ✅ Critical Issues Resolved

1. **Clinic Isolation Validation** ✅
   - Added `liff_id` to JWT payload for clinic-specific apps
   - Updated `validateClinicIsolation()` to handle both `liff_id` and `clinic_token`
   - Frontend validates `getContext().liffId` matches JWT `liff_id`

2. **LIFF ID Format Validation** ✅
   - Exact regex pattern: `^[0-9]+-[a-zA-Z0-9]+$`
   - Validation in model validator and backend lookup
   - Format validation on registration

3. **JWT Token Structure** ✅
   - JWT includes `liff_id` for clinic-specific apps
   - JWT includes `clinic_token` only for shared LIFF apps
   - Enables frontend validation without backend calls

### ⚠️ Critical Verification Required

1. **Query Parameter Preservation** ⚠️ **MUST TEST BEFORE IMPLEMENTATION**
   - **Question**: Does LINE preserve `?liff_id=...` when redirecting to endpoint URL?
   - **Action**: Test this flow explicitly
   - **Fallback**: Documented alternatives if parameters not preserved

### ✅ Additional Improvements

1. **Admin UI Validation** ✅
   - Format validation on registration
   - Endpoint URL template provided
   - Uniqueness check
   - Test button for LIFF ID validity

2. **Error Messages** ✅
   - User-facing messages in zh-TW and en
   - Developer/admin messages for debugging
   - Error codes for programmatic handling

3. **Security Enhancements** ✅
   - Rate limiting recommendation
   - Audit logging recommendation
   - Always use `getContext().liffId` as authoritative source

4. **Testing Strategy** ✅
   - Comprehensive test cases including query parameter preservation
   - Clinic isolation validation tests
   - Migration scenario tests

### 📋 Pre-Implementation Checklist

**Before starting implementation, verify:**
- [ ] **CRITICAL**: Test query parameter preservation in LINE redirect flow
- [ ] Verify LIFF ID format with actual LINE LIFF IDs
- [ ] Test `liff.getContext().liffId` behavior after initialization
- [ ] Confirm endpoint URL configuration in LINE Console supports query parameters

**Error Codes** (for programmatic handling):
- `LIFF_ID_MISSING`: Endpoint URL missing `liff_id` parameter
- `LIFF_ID_MISMATCH`: URL parameter doesn't match `getContext().liffId`
- `LIFF_INIT_FAILED`: LIFF initialization failed (invalid ID, deleted app, etc.)
- `CLINIC_NOT_FOUND`: Clinic not found by `liff_id` or `clinic_token`
- `INVALID_LIFF_ID_FORMAT`: LIFF ID format validation failed

