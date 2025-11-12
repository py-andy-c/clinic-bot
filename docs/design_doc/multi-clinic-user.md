# Multi-Clinic User Support Design Document

## Overview

This document describes the design for supporting users who work at multiple clinics. The design maintains strict clinic isolation while enabling users to switch between clinics and, in the future, view consolidated calendars across all their clinics.

## Objectives

1. **Clinic Isolation**: User's settings, appointments, roles, calendar, and availability must be separate between clinics
2. **Multi-Clinic Access**: Users can be members of multiple clinics with different roles at each
3. **Clinic Switching**: Users can easily switch between clinics in the UI
4. **Future-Ready**: Architecture supports future consolidated calendar views across clinics
5. **Backward Compatible**: Existing single-clinic users continue to work without changes

## Current State Analysis

### Current User Model

The current `User` model has:
- `clinic_id`: Single foreign key (nullable for system admins)
- `email`: Unique identifier
- `google_subject_id`: Unique identifier for Google OAuth
- `roles`: JSONB array of roles (e.g., `["admin", "practitioner"]`)
- Unique constraint: `(clinic_id, email)`

### Current Authentication Flow

1. User authenticates via Google OAuth
2. JWT token includes `clinic_id` for clinic users
3. `UserContext` has single `clinic_id`
4. All queries filter by `user.clinic_id`

### Current Data Relationships

All user-related data is clinic-scoped:
- `PractitionerAvailability`: Linked to `user_id` (implicitly clinic-scoped via user)
- `CalendarEvent`: Linked to `user_id` (implicitly clinic-scoped via user)
- `PractitionerAppointmentTypes`: Linked to `user_id` (implicitly clinic-scoped via user)
- `Appointment`: Linked to `patient_id` → `clinic_id` (explicitly clinic-scoped)

### Current Query Patterns

Most queries filter by clinic in one of two ways:
1. **Direct clinic filter**: `User.clinic_id == clinic_id`
2. **Implicit via user**: `CalendarEvent.user_id == user_id` (where user has clinic_id)

## Requirements

### Functional Requirements

1. **User-Clinic Association**
   - Users can be members of multiple clinics
   - Each user-clinic association has its own roles
   - Users can have different roles at different clinics (e.g., admin at Clinic A, practitioner at Clinic B)

2. **Clinic Isolation**
   - All user data must be clinic-scoped:
     - Availability schedules
     - Calendar events (appointments, exceptions)
     - Appointment type associations
     - User settings/preferences (future)
   - Queries must always filter by active clinic context

3. **Clinic Selection**
   - Users must select an active clinic when logging in
   - Users can switch clinics without re-authenticating
   - Active clinic context is maintained in JWT token
   - Frontend displays current clinic context

4. **Role-Based Access**
   - Roles are per-clinic (not global)
   - User may be admin at Clinic A but read-only at Clinic B
   - API endpoints check roles within active clinic context

5. **Future Consolidated Calendar**
   - Architecture must support querying calendar events across multiple clinics
   - But maintain isolation for normal operations
   - Consolidated view is opt-in, not default

### Non-Functional Requirements

1. **Performance**: No significant performance degradation from additional joins
2. **Security**: Clinic isolation must be enforced at database and API levels
3. **Backward Compatibility**: Existing single-clinic users work without migration
4. **Data Integrity**: No data leakage between clinics

## Database Schema Design

### New Table: `user_clinic_associations`

Many-to-many relationship between users and clinics with clinic-specific roles and names.

```sql
CREATE TABLE user_clinic_associations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    roles JSONB NOT NULL DEFAULT '[]',  -- Clinic-specific roles: ["admin"], ["practitioner"], etc.
    full_name VARCHAR(255) NOT NULL,  -- Clinic-specific display name
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_accessed_at TIMESTAMP WITH TIME ZONE,  -- Track most recently accessed clinic for default selection
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Ensure one association per user-clinic pair
    UNIQUE(user_id, clinic_id)
);

CREATE INDEX idx_user_clinic_associations_user ON user_clinic_associations(user_id);
CREATE INDEX idx_user_clinic_associations_clinic ON user_clinic_associations(clinic_id);
CREATE INDEX idx_user_clinic_associations_active ON user_clinic_associations(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_user_clinic_associations_user_active_clinic ON user_clinic_associations(user_id, is_active, clinic_id) WHERE is_active = TRUE;
CREATE INDEX idx_user_clinic_associations_last_accessed ON user_clinic_associations(user_id, last_accessed_at DESC) WHERE is_active = TRUE;
```

**Notes**: 
- `full_name` is stored per clinic association, allowing users to have different names at different clinics (e.g., "Dr. Smith" at Clinic A, "John Smith" at Clinic B).
- `last_accessed_at` is updated on login and clinic switch to enable "most recently used" default clinic selection.
- `is_active` flag allows soft-deleting associations (user loses access but history is preserved).

### Modified Table: `users`

**Decision: Remove `clinic_id` entirely**

Since we have a small user base and can migrate aggressively:
- Remove `clinic_id` column completely
- All clinic access via `user_clinic_associations`
- Migration will populate `user_clinic_associations` from existing `clinic_id` before dropping the column
- `full_name` in `users` table becomes a fallback/default name (can be used for system admins or as default)
- Clinic-specific names are stored in `user_clinic_associations.full_name`

### Modified Tables: Clinic-Scoped Data

All user-related data that needs clinic isolation must include `clinic_id`:

#### `practitioner_availability`
```sql
ALTER TABLE practitioner_availability 
ADD COLUMN clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE;

CREATE INDEX idx_practitioner_availability_clinic ON practitioner_availability(user_id, clinic_id);
```

**Rationale**: Availability schedules are clinic-specific. A practitioner may work different hours at different clinics.

#### `calendar_events`
```sql
ALTER TABLE calendar_events 
ADD COLUMN clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE;

CREATE INDEX idx_calendar_events_clinic ON calendar_events(user_id, clinic_id, date);
```

**Rationale**: Calendar events (appointments, exceptions) are clinic-specific. A practitioner's appointments at Clinic A are separate from Clinic B.

#### `practitioner_appointment_types`
```sql
ALTER TABLE practitioner_appointment_types 
ADD COLUMN clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE;

CREATE INDEX idx_practitioner_appointment_types_clinic ON practitioner_appointment_types(user_id, clinic_id);
```

**Rationale**: Which appointment types a practitioner offers may differ by clinic.

### Migration Strategy

1. **Phase 1: Add new table and columns**
   - Create `user_clinic_associations` table
   - Add `clinic_id` to clinic-scoped tables
   - Populate `user_clinic_associations` from existing `users.clinic_id`
   - Set `clinic_id` on existing records in clinic-scoped tables

2. **Phase 2: Update application code**
   - Update models and relationships
   - Update authentication logic
   - Update all queries to filter by clinic_id

3. **Phase 3: Data validation**
   - Verify all existing data has clinic_id set
   - Verify user-clinic associations are correct

4. **Phase 4: Remove backward compatibility (optional)**
   - After sufficient time, consider removing `users.clinic_id` if desired
   - Or keep it as "primary clinic" for convenience

## Authentication & Authorization Design

### JWT Token Structure

Current token payload:
```json
{
  "user_type": "clinic_user",
  "email": "user@example.com",
  "clinic_id": 1,
  "roles": ["admin", "practitioner"],
  "sub": "google_subject_id",
  "exp": 1234567890
}
```

**New token payload** (with active clinic context):
```json
{
  "user_type": "clinic_user",
  "email": "user@example.com",
  "user_id": 123,
  "active_clinic_id": 1,  // Currently selected clinic
  "roles": ["admin", "practitioner"],  // Roles at active_clinic_id
  "name": "Dr. Smith",  // Clinic-specific name at active_clinic_id
  "sub": "google_subject_id",
  "exp": 1234567890
}
```

**Note**: 
- Roles in token are for the `active_clinic_id` only. To get roles for other clinics, query `user_clinic_associations`.
- Name in token is clinic-specific from `user_clinic_associations.full_name`.

### UserContext Updates

```python
class UserContext:
    def __init__(
        self,
        user_type: str,
        email: str,
        user_id: int,
        active_clinic_id: Optional[int],  # Currently selected clinic
        roles: list[str],  # Roles at active_clinic_id
        google_subject_id: str,
        name: str,  # Clinic-specific name at active_clinic_id
        available_clinics: Optional[list[dict]] = None  # Optional: list of clinics user can access
    ):
        self.user_type = user_type
        self.email = email
        self.user_id = user_id
        self.active_clinic_id = active_clinic_id
        self.roles = roles  # Roles at active_clinic_id
        self.google_subject_id = google_subject_id
        self.name = name  # Clinic-specific name
        self.available_clinics = available_clinics  # For clinic switching UI
```

### Authentication Flow

1. **Initial Login**
   - User authenticates via Google OAuth
   - Backend queries `user_clinic_associations` for user (where `is_active = True`)
   - **Default Clinic Selection Logic** (in order of priority):
     1. User preference (if stored in user settings - future enhancement)
     2. Most recently accessed (`last_accessed_at DESC`)
     3. First created association (`created_at ASC`)
     4. First clinic by ID (deterministic fallback)
   - If user has only one clinic: auto-select it
   - If user has multiple clinics: auto-select using default logic above (or show selection screen)
   - Generate JWT with `active_clinic_id` and roles for that clinic
   - Update `last_accessed_at` for selected clinic

2. **Clinic Switching**
   - User selects different clinic in UI
   - Frontend debounces rapid clicks (prevent multiple simultaneous requests)
   - Frontend calls `POST /api/auth/switch-clinic` with `clinic_id`
   - Backend validates:
     - Association exists and is active
     - Clinic is active
     - User has access to requested clinic
   - If validation fails: return appropriate error (see Error Responses above)
   - If already on requested clinic: return success without new token (idempotent)
   - Backend updates `last_accessed_at` for new clinic
   - Backend generates new JWT with new `active_clinic_id` and roles
   - Backend returns new token and clinic information
   - Frontend updates token and refreshes UI
   - **Rate Limiting**: Max 10 switches per minute per user
   - **Race Condition Handling**: Use database transaction, handle concurrent switches gracefully

3. **Token Refresh**
   - Refresh token maintains user identity (does not store `active_clinic_id`)
   - On refresh, validate that `active_clinic_id` from current access token still exists and is active
   - If association is inactive or user lost access: invalidate refresh token, force re-authentication
   - If association is active: generate new access token with same `active_clinic_id` and current roles
   - Roles are re-fetched from `user_clinic_associations` to ensure they're up-to-date
   - **Edge Case**: If user switched clinic but token hasn't expired, refresh uses new `active_clinic_id` from most recent token

### Authentication Implementation Details

**Critical Update**: The `get_current_user` function in `auth/dependencies.py` must be updated to validate against `user_clinic_associations`:

```python
def get_current_user(
    payload: Optional[TokenPayload] = Depends(get_token_payload),
    db: Session = Depends(get_db)
) -> UserContext:
    """Get authenticated user context from JWT token."""
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials not provided"
        )

    # Handle system admin authentication (no changes needed)
    if payload.user_type == "system_admin":
        # System admins don't have clinic associations
        user = db.query(User).filter(
            User.email == payload.email,
            User.clinic_id.is_(None)  # System admins have clinic_id=None
        ).first()
        
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive"
            )

        return UserContext(
            user_type="system_admin",
            email=user.email,
            roles=[],  # System admins don't have clinic-specific roles
            clinic_id=None,
            active_clinic_id=None,  # System admins don't have active clinic
            google_subject_id=user.google_subject_id,
            name=user.full_name,
            user_id=user.id
        )

    # Handle clinic user authentication (CRITICAL UPDATE)
    elif payload.user_type == "clinic_user":
        # Find user by Google subject ID and email
        user = db.query(User).filter(
            User.google_subject_id == payload.sub,
            User.email == payload.email
        ).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="帳戶已被停用，請聯繫診所管理員重新啟用"
            )

        # CRITICAL: Validate active_clinic_id against user_clinic_associations
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user.id,
            UserClinicAssociation.clinic_id == payload.active_clinic_id,
            UserClinicAssociation.is_active == True
        ).first()

        if not association:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Clinic access denied"
            )

        # Verify clinic is still active
        clinic = db.query(Clinic).filter(
            Clinic.id == payload.active_clinic_id,
            Clinic.is_active == True
        ).first()

        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Clinic is inactive"
            )

        # Update last_accessed_at for default clinic selection
        association.last_accessed_at = datetime.now(timezone.utc)
        db.commit()

        return UserContext(
            user_type="clinic_user",
            email=user.email,
            roles=association.roles,  # Roles from association, not user.roles
            active_clinic_id=association.clinic_id,
            google_subject_id=user.google_subject_id,
            name=association.full_name,  # Clinic-specific name
            user_id=user.id
        )

    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user type"
        )
```

### System Admin Handling

**Important**: System admins are handled differently:
- System admins don't have `user_clinic_associations` (they have `clinic_id = None` in `users` table)
- System admins don't have `active_clinic_id` (it's `None`)
- System admins can access all clinics for administrative purposes
- System admin authentication flow remains unchanged

### Authorization Dependencies

Update `require_clinic_access` to use `active_clinic_id`:

```python
def require_clinic_access(
    user: UserContext = Depends(require_clinic_user),
    clinic_id: Optional[int] = None
) -> UserContext:
    """
    Enforce clinic isolation - clinic users can only access their active clinic.
    
    If clinic_id is provided, it must match active_clinic_id.
    System admins bypass this check.
    """
    # System admins can access any clinic
    if user.is_system_admin():
        return user
    
    if clinic_id is not None and user.active_clinic_id != clinic_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this clinic"
        )
    return user
```

## API Design

### New Endpoints

#### `GET /api/auth/clinics`
Get list of clinics the user can access.

**Query Parameters**:
- `include_inactive` (optional, default: `false`): Include inactive associations

**Response**:
```json
{
  "clinics": [
    {
      "id": 1,
      "name": "Clinic A",
      "display_name": "Clinic A Display",
      "roles": ["admin", "practitioner"],
      "is_active": true,
      "last_accessed_at": "2025-01-27T10:30:00Z"
    },
    {
      "id": 2,
      "name": "Clinic B",
      "display_name": "Clinic B Display",
      "roles": ["practitioner"],
      "is_active": true,
      "last_accessed_at": null
    }
  ],
  "active_clinic_id": 1
}
```

**Implementation Notes**:
- Only return clinics where `is_active = True` by default
- Sort by `last_accessed_at DESC` (most recently used first)
- Include `last_accessed_at` for UI display ("Last accessed: 2 days ago")

#### `POST /api/auth/switch-clinic`
Switch active clinic context.

**Request**:
```json
{
  "clinic_id": 2
}
```

**Response** (Success):
```json
{
  "access_token": "new_jwt_token",
  "refresh_token": "new_refresh_token",
  "active_clinic_id": 2,
  "roles": ["practitioner"],
  "name": "Dr. Smith",
  "clinic": {
    "id": 2,
    "name": "Clinic B",
    "display_name": "Clinic B Display"
  }
}
```

**Error Responses**:

1. **User doesn't have access to clinic** (403):
```json
{
  "error": "clinic_access_denied",
  "message": "您沒有此診所的存取權限",
  "clinic_id": 2
}
```

2. **Clinic is inactive** (403):
```json
{
  "error": "clinic_inactive",
  "message": "此診所已停用",
  "clinic_id": 2
}
```

3. **Association is inactive** (403):
```json
{
  "error": "association_inactive",
  "message": "您在此診所的存取權限已被停用",
  "clinic_id": 2
}
```

4. **Already on requested clinic** (200 - idempotent):
```json
{
  "message": "Already on this clinic",
  "active_clinic_id": 2,
  "access_token": "current_token"  // No new token needed
}
```

**Implementation Notes**:
- Validate association exists and is active
- Validate clinic is active
- Update `last_accessed_at` in association
- Generate new access token with updated `active_clinic_id`
- Return clinic information for UI updates
- **Rate Limiting**: Max 10 switches per minute per user to prevent abuse
- **Idempotent**: If already on requested clinic, return success without new token

### Modified Endpoints

All existing endpoints that use `current_user.clinic_id` should use `current_user.active_clinic_id`:

- `GET /api/clinic/members` - List members of active clinic
- `GET /api/clinic/patients` - List patients of active clinic
- `GET /api/clinic/appointment-types` - List appointment types of active clinic
- `GET /api/clinic/settings` - Get settings of active clinic
- `GET /api/clinic/calendar` - Get calendar for active clinic
- etc.

**No endpoint changes needed** - just use `active_clinic_id` instead of `clinic_id` in UserContext.

### Query Updates

All queries must filter by `active_clinic_id`:

**Before**:
```python
# Implicit clinic filter via user.clinic_id
events = db.query(CalendarEvent).filter(
    CalendarEvent.user_id == user_id
).all()
```

**After**:
```python
# Explicit clinic filter
events = db.query(CalendarEvent).filter(
    CalendarEvent.user_id == user_id,
    CalendarEvent.clinic_id == user.active_clinic_id
).all()
```

## Frontend Design

### User Experience

#### Clinic Selection on Login

**Single Clinic User**:
- Auto-select clinic, proceed to dashboard
- No clinic selector shown

**Multi-Clinic User**:
- Show clinic selection screen after login
- Display list of clinics with roles
- User selects clinic, proceed to dashboard
- Remember last selected clinic (localStorage)

#### Clinic Switcher in UI

**Location**: Top navigation bar (next to user profile)

**Design**:
- Dropdown showing current clinic name
- Click to see list of available clinics
- Selecting a clinic:
  1. Shows loading state
  2. Calls `/api/auth/switch-clinic`
  3. Updates token
  4. Refreshes page data
  5. Shows success message

**Visual Indicator**:
- Current clinic name displayed prominently
- Badge showing role at current clinic (e.g., "Admin", "Practitioner")

#### Clinic Context Display

Throughout the UI, show current clinic context:
- Page titles: "Members - Clinic A"
- Breadcrumbs: "Home > Clinic A > Members"
- Settings page: "Clinic A Settings"

### State Management

#### Auth State Updates

```typescript
interface AuthUser {
  user_id: number;
  email: string;
  name: string;
  active_clinic_id: number;
  roles: string[];  // Roles at active_clinic_id
  available_clinics: Array<{
    id: number;
    name: string;
    display_name: string;
    roles: string[];
  }>;
}
```

#### Clinic Switching Flow

```typescript
const switchClinic = async (clinicId: number) => {
  setIsSwitching(true);
  try {
    const response = await apiService.switchClinic(clinicId);
    // Update token
    localStorage.setItem('access_token', response.access_token);
    // Update auth state
    setAuthState({
      ...authState,
      user: {
        ...authState.user,
        active_clinic_id: clinicId,
        roles: response.roles
      }
    });
    // Refresh page data
    await refreshAllData();
  } catch (error) {
    showError('Failed to switch clinic');
  } finally {
    setIsSwitching(false);
  }
};
```

### Component Updates

#### ClinicLayout Component

Add clinic switcher to header:
```tsx
<ClinicSwitcher 
  currentClinicId={user.active_clinic_id}
  availableClinics={user.available_clinics}
  onSwitch={switchClinic}
/>
```

#### All Clinic-Scoped Pages

Ensure all pages filter data by `active_clinic_id`:
- MembersPage: Only show members of active clinic
- PatientsPage: Only show patients of active clinic
- AvailabilityPage: Only show availability for active clinic
- SettingsPage: Only show settings for active clinic

## Future: Consolidated Calendar

### Design Considerations

The architecture must support future consolidated calendar views while maintaining isolation.

#### Option 1: Separate Endpoint (RECOMMENDED)

Create a new endpoint specifically for consolidated views:

```python
@router.get("/calendar/consolidated")
async def get_consolidated_calendar(
    date: str,
    clinic_ids: Optional[List[int]] = Query(None),  # Optional: filter specific clinics
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    """
    Get consolidated calendar across all user's clinics.
    
    Only returns data for clinics the user has access to.
    If clinic_ids is provided, further filters to those clinics.
    """
    # Get all clinics user can access
    user_clinics = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == current_user.user_id,
        UserClinicAssociation.is_active == True
    ).all()
    
    clinic_ids = [uc.clinic_id for uc in user_clinics]
    if clinic_ids_param:
        # Intersect with requested clinics
        clinic_ids = [cid for cid in clinic_ids if cid in clinic_ids_param]
    
    # Query calendar events across all clinics
    events = db.query(CalendarEvent).filter(
        CalendarEvent.user_id == current_user.user_id,
        CalendarEvent.clinic_id.in_(clinic_ids),
        CalendarEvent.date == date
    ).all()
    
    # Group by clinic for display
    events_by_clinic = {}
    for event in events:
        if event.clinic_id not in events_by_clinic:
            events_by_clinic[event.clinic_id] = []
        events_by_clinic[event.clinic_id].append(event)
    
    return {
        "events_by_clinic": events_by_clinic,
        "clinics": [get_clinic_info(cid) for cid in clinic_ids]
    }
```

**Benefits**:
- Clear separation: consolidated view is opt-in
- Maintains isolation: normal endpoints still filter by active_clinic_id
- Flexible: can filter by specific clinics
- Secure: only returns data for clinics user has access to

#### Option 2: Query Parameter

Add `?consolidated=true` parameter to existing calendar endpoint:

```python
@router.get("/calendar")
async def get_calendar(
    date: str,
    consolidated: bool = Query(False),
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
):
    if consolidated:
        # Return consolidated view
        clinic_ids = get_user_clinic_ids(current_user.user_id)
        events = query_events(user_id=current_user.user_id, clinic_ids=clinic_ids)
    else:
        # Return single clinic view (current behavior)
        events = query_events(
            user_id=current_user.user_id, 
            clinic_id=current_user.active_clinic_id
        )
```

**Drawbacks**:
- Less clear separation
- Risk of accidentally exposing multi-clinic data
- Harder to enforce security

**Recommendation: Option 1** - Separate endpoint is clearer and safer.

### UI Design for Consolidated Calendar

**Future Feature** (not in initial implementation):

1. **Toggle View**: Switch between "Single Clinic" and "All Clinics" views
2. **Color Coding**: Different colors for each clinic
3. **Clinic Filter**: Checkboxes to show/hide specific clinics
4. **Clinic Labels**: Each event shows which clinic it belongs to

## Data Migration Plan

### Pre-Migration Validation

**CRITICAL**: Run these validation queries before migration to catch data integrity issues:

```python
# Validation queries to run before migration
def validate_pre_migration(db: Session):
    """Validate data integrity before migration."""
    errors = []
    
    # 1. Check for orphaned practitioner_availability records
    orphaned_availability = db.execute("""
        SELECT COUNT(*) FROM practitioner_availability pa
        LEFT JOIN users u ON pa.user_id = u.id
        WHERE u.id IS NULL OR (u.clinic_id IS NULL AND u.id IS NOT NULL)
    """).scalar()
    
    if orphaned_availability > 0:
        errors.append(f"Found {orphaned_availability} orphaned practitioner_availability records")
    
    # 2. Check for orphaned calendar_events records
    orphaned_events = db.execute("""
        SELECT COUNT(*) FROM calendar_events ce
        LEFT JOIN users u ON ce.user_id = u.id
        WHERE u.id IS NULL OR (u.clinic_id IS NULL AND u.id IS NOT NULL)
    """).scalar()
    
    if orphaned_events > 0:
        errors.append(f"Found {orphaned_events} orphaned calendar_events records")
    
    # 3. Check for orphaned practitioner_appointment_types records
    orphaned_types = db.execute("""
        SELECT COUNT(*) FROM practitioner_appointment_types pat
        LEFT JOIN users u ON pat.user_id = u.id
        WHERE u.id IS NULL OR (u.clinic_id IS NULL AND u.id IS NOT NULL)
    """).scalar()
    
    if orphaned_types > 0:
        errors.append(f"Found {orphaned_types} orphaned practitioner_appointment_types records")
    
    # 4. Check for users with NULL or empty full_name
    users_without_name = db.execute("""
        SELECT COUNT(*) FROM users
        WHERE clinic_id IS NOT NULL 
        AND (full_name IS NULL OR full_name = '')
    """).scalar()
    
    if users_without_name > 0:
        errors.append(f"Found {users_without_name} users without full_name")
    
    # 5. Check for invalid user_id references
    invalid_user_refs = db.execute("""
        SELECT COUNT(*) FROM practitioner_availability pa
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = pa.user_id)
    """).scalar()
    
    if invalid_user_refs > 0:
        errors.append(f"Found {invalid_user_refs} invalid user_id references in practitioner_availability")
    
    if errors:
        raise Exception(f"Pre-migration validation failed:\n" + "\n".join(errors))
    
    return True
```

### Step 1: Schema Migration

```python
# Migration: add_user_clinic_associations.py

def upgrade():
    # Step 1: Ensure all users have full_name (backfill if needed)
    op.execute("""
        UPDATE users 
        SET full_name = COALESCE(full_name, email, 'User')
        WHERE full_name IS NULL OR full_name = ''
    """)
    
    # Step 2: Create user_clinic_associations table
    op.create_table(
        'user_clinic_associations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('roles', sa.JSON(), nullable=False),
        sa.Column('full_name', sa.String(255), nullable=False),  # CRITICAL: Include full_name
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('last_accessed_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('user_id', 'clinic_id')
    )
    
    # Step 3: Add clinic_id to clinic-scoped tables (nullable initially)
    op.add_column('practitioner_availability', 
                  sa.Column('clinic_id', sa.Integer(), nullable=True))
    op.add_column('calendar_events', 
                  sa.Column('clinic_id', sa.Integer(), nullable=True))
    op.add_column('practitioner_appointment_types', 
                  sa.Column('clinic_id', sa.Integer(), nullable=True))
    
    # Step 4: Populate user_clinic_associations from users.clinic_id
    # CRITICAL: Include full_name in INSERT
    op.execute("""
        INSERT INTO user_clinic_associations (user_id, clinic_id, roles, full_name, created_at, updated_at)
        SELECT id, clinic_id, roles, COALESCE(full_name, email, 'User'), created_at, updated_at
        FROM users
        WHERE clinic_id IS NOT NULL
    """)
    
    # Step 5: Populate clinic_id in clinic-scoped tables
    # For practitioner_availability: get clinic_id from user
    op.execute("""
        UPDATE practitioner_availability pa
        SET clinic_id = u.clinic_id
        FROM users u
        WHERE pa.user_id = u.id AND pa.clinic_id IS NULL AND u.clinic_id IS NOT NULL
    """)
    
    # For calendar_events: get clinic_id from user
    op.execute("""
        UPDATE calendar_events ce
        SET clinic_id = u.clinic_id
        FROM users u
        WHERE ce.user_id = u.id AND ce.clinic_id IS NULL AND u.clinic_id IS NOT NULL
    """)
    
    # For practitioner_appointment_types: get clinic_id from user
    op.execute("""
        UPDATE practitioner_appointment_types pat
        SET clinic_id = u.clinic_id
        FROM users u
        WHERE pat.user_id = u.id AND pat.clinic_id IS NULL AND u.clinic_id IS NOT NULL
    """)
    
    # Step 6: Verify no NULL clinic_id remains (should be 0)
    null_availability = op.get_bind().execute("SELECT COUNT(*) FROM practitioner_availability WHERE clinic_id IS NULL").scalar()
    null_events = op.get_bind().execute("SELECT COUNT(*) FROM calendar_events WHERE clinic_id IS NULL").scalar()
    null_types = op.get_bind().execute("SELECT COUNT(*) FROM practitioner_appointment_types WHERE clinic_id IS NULL").scalar()
    
    if null_availability > 0 or null_events > 0 or null_types > 0:
        raise Exception(f"Migration failed: Found NULL clinic_id values (availability: {null_availability}, events: {null_events}, types: {null_types})")
    
    # Step 7: Make clinic_id NOT NULL after populating
    op.alter_column('practitioner_availability', 'clinic_id', nullable=False)
    op.alter_column('calendar_events', 'clinic_id', nullable=False)
    op.alter_column('practitioner_appointment_types', 'clinic_id', nullable=False)
    
    # Step 8: Add foreign key constraints
    op.create_foreign_key(
        'fk_practitioner_availability_clinic',
        'practitioner_availability', 'clinics', ['clinic_id'], ['id'], ondelete='CASCADE'
    )
    op.create_foreign_key(
        'fk_calendar_events_clinic',
        'calendar_events', 'clinics', ['clinic_id'], ['id'], ondelete='CASCADE'
    )
    op.create_foreign_key(
        'fk_practitioner_appointment_types_clinic',
        'practitioner_appointment_types', 'clinics', ['clinic_id'], ['id'], ondelete='CASCADE'
    )
    
    # Step 9: Remove unique constraint on (clinic_id, email) from users table
    # Email remains globally unique via unique=True on the column
    op.drop_constraint('uq_clinic_user_email', 'users', type_='unique')
    
    # Step 10: Create indexes for user_clinic_associations
    op.create_index('idx_user_clinic_associations_user', 'user_clinic_associations', ['user_id'])
    op.create_index('idx_user_clinic_associations_clinic', 'user_clinic_associations', ['clinic_id'])
    op.create_index('idx_user_clinic_associations_active', 'user_clinic_associations', ['user_id', 'is_active'], 
                    postgresql_where=sa.text('is_active = TRUE'))
    op.create_index('idx_user_clinic_associations_user_active_clinic', 'user_clinic_associations', 
                    ['user_id', 'is_active', 'clinic_id'], 
                    postgresql_where=sa.text('is_active = TRUE'))
    op.create_index('idx_user_clinic_associations_last_accessed', 'user_clinic_associations', 
                    ['user_id', 'last_accessed_at'], 
                    postgresql_where=sa.text('is_active = TRUE'))

def downgrade():
    """Rollback migration."""
    # Drop indexes
    op.drop_index('idx_user_clinic_associations_last_accessed', 'user_clinic_associations')
    op.drop_index('idx_user_clinic_associations_user_active_clinic', 'user_clinic_associations')
    op.drop_index('idx_user_clinic_associations_active', 'user_clinic_associations')
    op.drop_index('idx_user_clinic_associations_clinic', 'user_clinic_associations')
    op.drop_index('idx_user_clinic_associations_user', 'user_clinic_associations')
    
    # Restore unique constraint
    op.create_unique_constraint('uq_clinic_user_email', 'users', ['clinic_id', 'email'])
    
    # Drop foreign keys
    op.drop_constraint('fk_practitioner_appointment_types_clinic', 'practitioner_appointment_types')
    op.drop_constraint('fk_calendar_events_clinic', 'calendar_events')
    op.drop_constraint('fk_practitioner_availability_clinic', 'practitioner_availability')
    
    # Drop clinic_id columns
    op.drop_column('practitioner_appointment_types', 'clinic_id')
    op.drop_column('calendar_events', 'clinic_id')
    op.drop_column('practitioner_availability', 'clinic_id')
    
    # Drop user_clinic_associations table
    op.drop_table('user_clinic_associations')
```

### Post-Migration Validation

**CRITICAL**: Run these validation queries after migration:

```python
def validate_post_migration(db: Session):
    """Validate data integrity after migration."""
    errors = []
    
    # 1. Verify all users with clinic_id have associations
    users_without_associations = db.execute("""
        SELECT COUNT(*) FROM users u
        WHERE u.clinic_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM user_clinic_associations uca
            WHERE uca.user_id = u.id AND uca.clinic_id = u.clinic_id
        )
    """).scalar()
    
    if users_without_associations > 0:
        errors.append(f"Found {users_without_associations} users without associations")
    
    # 2. Verify all clinic-scoped data has clinic_id
    null_availability = db.execute("SELECT COUNT(*) FROM practitioner_availability WHERE clinic_id IS NULL").scalar()
    null_events = db.execute("SELECT COUNT(*) FROM calendar_events WHERE clinic_id IS NULL").scalar()
    null_types = db.execute("SELECT COUNT(*) FROM practitioner_appointment_types WHERE clinic_id IS NULL").scalar()
    
    if null_availability > 0:
        errors.append(f"Found {null_availability} practitioner_availability records without clinic_id")
    if null_events > 0:
        errors.append(f"Found {null_events} calendar_events records without clinic_id")
    if null_types > 0:
        errors.append(f"Found {null_types} practitioner_appointment_types records without clinic_id")
    
    # 3. Verify all associations have valid user_id and clinic_id
    invalid_associations = db.execute("""
        SELECT COUNT(*) FROM user_clinic_associations uca
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = uca.user_id)
        OR NOT EXISTS (SELECT 1 FROM clinics c WHERE c.id = uca.clinic_id)
    """).scalar()
    
    if invalid_associations > 0:
        errors.append(f"Found {invalid_associations} invalid associations")
    
    # 4. Verify all associations have full_name
    associations_without_name = db.execute("""
        SELECT COUNT(*) FROM user_clinic_associations
        WHERE full_name IS NULL OR full_name = ''
    """).scalar()
    
    if associations_without_name > 0:
        errors.append(f"Found {associations_without_name} associations without full_name")
    
    if errors:
        raise Exception(f"Post-migration validation failed:\n" + "\n".join(errors))
    
    return True
```

### Rollback Plan

**CRITICAL**: Have a rollback plan ready before migration.

**Rollback Strategy**:

1. **Database Backup**: Create full database backup before migration
   ```bash
   pg_dump clinic_bot > backup_before_migration_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Rollback Migration**: The migration includes a `downgrade()` function (see Step 1 above) that:
   - Drops indexes
   - Restores unique constraint on `(clinic_id, email)`
   - Drops foreign key constraints
   - Drops `clinic_id` columns from clinic-scoped tables
   - Drops `user_clinic_associations` table

3. **Application Rollback**: 
   - Revert to previous application version (git tag/commit)
   - Application code must support both old and new schema during transition
   - Or deploy old version that uses `users.clinic_id`

4. **Data Recovery**: 
   - If migration partially completes, restore from backup
   - Verify data integrity after rollback
   - Re-run validation queries

5. **Rollback Decision Criteria**:
   - Migration fails with errors
   - Post-migration validation fails
   - Data corruption detected
   - Critical bugs discovered in new code

**Important Notes**:
- Keep `users.clinic_id` column during transition period (make nullable, don't drop immediately)
- This allows rollback without data loss
- Can drop `users.clinic_id` in a later migration after verifying everything works

### Step 2: Model Updates

**Update `User` model** (`backend/src/models/user.py`):

```python
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    # Remove: clinic_id (no longer needed)
    
    email: Mapped[str] = mapped_column(String(255), unique=True)  # Globally unique
    google_subject_id: Mapped[str] = mapped_column(String(255), unique=True)
    full_name: Mapped[str] = mapped_column(String(255))  # Default/fallback name
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Remove: roles (now in user_clinic_associations)
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)

    # New relationship
    clinic_associations = relationship(
        "UserClinicAssociation", 
        back_populates="user", 
        cascade="all, delete-orphan"
    )
    
    # Remove: clinic relationship (use associations instead)
    refresh_tokens = relationship("RefreshToken", back_populates="user")
    availability = relationship("PractitionerAvailability", back_populates="user", cascade="all, delete-orphan")
    calendar_events = relationship("CalendarEvent", back_populates="user", cascade="all, delete-orphan")
    practitioner_appointment_types = relationship("PractitionerAppointmentTypes", back_populates="user", cascade="all, delete-orphan")
    
    # Remove: UniqueConstraint('clinic_id', 'email') - email is globally unique
    __table_args__ = (
        UniqueConstraint('google_subject_id', name='uq_google_subject_id'),
    )
```

**Create `UserClinicAssociation` model** (`backend/src/models/user_clinic_association.py`):

```python
from typing import Optional
from datetime import datetime
from sqlalchemy import String, TIMESTAMP, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class UserClinicAssociation(Base):
    """Many-to-many relationship between users and clinics with clinic-specific roles and names."""
    
    __tablename__ = "user_clinic_associations"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"))
    roles: Mapped[list[str]] = mapped_column(JSONB, default=list)
    full_name: Mapped[str] = mapped_column(String(255))  # Clinic-specific name
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_accessed_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="clinic_associations")
    clinic = relationship("Clinic", back_populates="user_associations")
    
    __table_args__ = (
        UniqueConstraint('user_id', 'clinic_id', name='uq_user_clinic'),
    )
```

**Update `Clinic` model** (`backend/src/models/clinic.py`):

```python
# Add new relationship
user_associations = relationship("UserClinicAssociation", back_populates="clinic", cascade="all, delete-orphan")

# Remove or update: users relationship (users now accessed via user_associations)
# Keep for backward compatibility during transition, but mark as deprecated
```

### Step 3: Application Code Updates

1. Update `UserContext` to use `active_clinic_id` (already documented above)
2. Update `get_current_user` in `auth/dependencies.py` (see Authentication Implementation Details above)
3. Update all queries to filter by `clinic_id` (see Database Query Review section)
4. Update authentication logic to support clinic switching
5. Add new API endpoints for clinic management
6. **Handle race conditions**: Use database transactions and handle `IntegrityError` for association creation

### Step 4: Frontend Updates

1. Update auth state to include `active_clinic_id` and `available_clinics`
2. Add clinic switcher component
3. Update all pages to use `active_clinic_id`
4. Add clinic selection screen for multi-clinic users

### Step 5: Testing

#### Test Strategy Overview

**Key Changes for Multi-Clinic Support:**

1. **Database Schema Changes**: All tests must work with the new schema where users don't have `clinic_id` directly, but through `user_clinic_associations`.

2. **Authentication Changes**: Tests must use `active_clinic_id` instead of `clinic_id` in `UserContext`.

3. **Query Changes**: All database queries that previously filtered by `User.clinic_id` must now join with `UserClinicAssociation` and filter by `active_clinic_id`.

4. **Fixture Updates**: Test fixtures must create `UserClinicAssociation` records alongside users.

5. **Isolation Testing**: New tests must verify clinic isolation works correctly.

**Test Categories:**
- **Backward Compatibility**: Existing single-clinic functionality must continue working
- **Multi-Clinic Functionality**: New features for multi-clinic users
- **Security**: Clinic isolation must be enforced
- **Performance**: Query performance with new joins
- **Migration**: Data integrity during schema changes

#### Unit Tests

1. **Model Tests** (`test_models.py`)
   - [x] Test `UserClinicAssociation` model creation (model exists and works)
   - [x] Test relationships (`User.clinic_associations`, `Clinic.user_associations`) (relationships defined)
   - [x] Test unique constraints (`user_id, clinic_id`) (constraint defined in model)
   - [ ] Test cascade deletes (needs explicit test)
   - [ ] Update existing `User` model tests to work without `clinic_id` - **IN PROGRESS** (backward compatibility maintained)

2. **Authentication Tests** (`test_auth_dependencies.py`)
   - [ ] Update `UserContext` tests to include `active_clinic_id`
   - [ ] Update `get_current_user` tests to validate against `user_clinic_associations`
   - [ ] Add tests for system admin handling (no associations)
   - [ ] Add tests for clinic user validation (active association required)
   - [ ] Add tests for `require_clinic_access` with `active_clinic_id`
   - [ ] Add tests for clinic switching endpoint
   - [ ] Add tests for clinics listing endpoint

3. **JWT Service Tests** (`test_jwt_service.py`)
   - [ ] Update token creation to include `active_clinic_id` - **NOT STARTED**
   - [ ] Update token validation tests - **NOT STARTED**
   - [ ] Add tests for clinic-specific roles in tokens - **NOT STARTED**

4. **Service Tests**
   - [x] Fix `test_appointment_service.py` - all tests passing (added `clinic_id` to all `CalendarEvent` creations)
   - [x] Fix `test_reminder_service.py` - all tests passing (added `clinic_id` to all `CalendarEvent` creations)
   - [x] Fix `test_appointment_type_service.py` - all tests passing (added `clinic_id` to `PractitionerAppointmentTypes`)
   - [x] Fix `test_calendar_models.py` - all tests passing (added `clinic_id` to all `CalendarEvent` creations)

#### Integration Tests

4. **Authentication Integration** (`test_auth_integration.py`)
   - [ ] Update existing signup flows to use `user_clinic_associations`
   - [ ] Add tests for existing user joining new clinic
   - [ ] Add tests for clinic switching
   - [ ] Add tests for multi-clinic user flows
   - [ ] Update fixtures to create `UserClinicAssociation` records

5. **Clinic Management Integration** (`test_clinic_management_integration.py`)
   - [x] Update fixtures to create `UserClinicAssociation` records (using helper)
   - [x] Add `clinic_id` to all `CalendarEvent` and `PractitionerAppointmentTypes` creations
   - [ ] Update all user queries to use `active_clinic_id` instead of `clinic_id` - **NOT STARTED**
   - [ ] Add tests for cross-clinic isolation (user can only see own clinics)
   - [ ] Add tests for clinic-specific roles
   - [ ] Update member management tests to use associations

6. **Clinic Admin Isolation** (`test_clinic_admin_isolation.py`)
   - [ ] Update fixtures to create `UserClinicAssociation` records
   - [ ] Update user context creation to use `active_clinic_id`
   - [ ] Add tests for multi-clinic admin isolation
   - [ ] Add tests for role-based access across clinics

6a. **Appointment Service Integration** (`test_appointment_service_integration.py`)
   - [x] Update fixtures to create `UserClinicAssociation` records (1 test fixed)
   - [x] Add `clinic_id` to all `CalendarEvent` creations (using helper)
   - [ ] Update user context creation to use `active_clinic_id` - **NOT STARTED**
   - [ ] Add tests for multi-clinic admin isolation - **NOT STARTED**
   - [ ] Add tests for role-based access across clinics - **NOT STARTED**

7. **LIFF Integration** (`test_liff_integration.py`)
   - [x] Update fixtures to use helper functions for `PractitionerAvailability` and `CalendarEvent`
   - [x] Add `clinic_id` to all `PractitionerAppointmentTypes` creations
   - [ ] Update JWT creation to include `active_clinic_id` - **NOT STARTED**
   - [ ] Update clinic validation tests
   - [ ] Add tests for clinic isolation in LIFF context

8. **Practitioner Availability** (`test_practitioner_availability.py`)
   - [x] Update fixtures to create `UserClinicAssociation` records (using helper)
   - [x] Add `clinic_id` to all `PractitionerAvailability` creations
   - [x] All tests passing
   - [ ] Update tests to use `active_clinic_id` instead of `clinic_id` in queries - **NOT STARTED**
   - [ ] Add tests for clinic-scoped availability (implicitly tested)

9. **Practitioner Calendar API** (`test_practitioner_calendar_api.py`)
   - [x] Update fixtures to create `UserClinicAssociation` records (using helper)
   - [x] Refactored to use helper functions for `PractitionerAvailability` and `CalendarEvent`
   - [x] All tests passing
   - [ ] Update tests to use `active_clinic_id` instead of `clinic_id` in queries - **NOT STARTED**
   - [ ] Update clinic isolation tests

#### Test Fixtures Updates

10. **conftest.py**
    - [x] Add `UserClinicAssociation` import
    - [x] Add helper function `create_user_with_clinic_association` for creating users with associations
    - [x] Add helper function `create_practitioner_availability_with_clinic` for creating availability with clinic_id
    - [x] Add helper function `create_calendar_event_with_clinic` for creating calendar events with clinic_id
    - [x] Add helper function `get_user_clinic_id` for backward compatibility
    - [ ] Update `sample_user_data` fixture to work without `clinic_id` (if exists)
    - [ ] Add fixtures for creating multi-clinic users
    - [ ] Add fixtures for testing clinic switching

11. **Helper Functions**
    - [x] Create helper functions for creating users with associations (`create_user_with_clinic_association`)
    - [ ] Create helper functions for mocking `active_clinic_id` context - **NOT STARTED**
    - [ ] Create helper functions for testing clinic isolation - **NOT STARTED**

#### Critical Test Updates

**Files Requiring Major Changes:**

1. **`conftest.py`** - Test fixtures
   - Add `UserClinicAssociation` import
   - Update user creation helpers to create associations
   - Add fixtures for multi-clinic scenarios

2. **`test_auth_dependencies.py`** - Authentication logic
   - Update `get_current_user` tests to validate associations
   - Update `UserContext` tests for `active_clinic_id`
   - Add tests for clinic switching

3. **`test_models.py`** - Model validation
   - Remove `clinic_id` from `User` model tests
   - Add `UserClinicAssociation` model tests
   - Update relationship tests

**Common Test Patterns That Must Change:**

4. **User Context Creation** (used in ~50+ tests)
    ```python
    # BEFORE (used throughout tests)
    def _uc(user_id, clinic_id, roles):
        return UserContext(
            user_type="clinic_user",
            email=f"u{user_id}@ex.com",
            roles=roles,
            clinic_id=clinic_id,  # ❌ This becomes active_clinic_id
            google_subject_id=f"sub-{user_id}",
            name=f"User {user_id}",
            user_id=user_id,
        )

    # AFTER
    def _uc(user_id, active_clinic_id, roles, name="User"):
        return UserContext(
            user_type="clinic_user",
            email=f"u{user_id}@ex.com",
            roles=roles,
            active_clinic_id=active_clinic_id,  # ✅ Changed
            google_subject_id=f"sub-{user_id}",
            name=name,  # ✅ Clinic-specific name
            user_id=user_id,
        )
    ```

5. **User Creation in Tests** (~100+ instances)
    ```python
    # BEFORE
    user = User(
        clinic_id=clinic.id,  # ❌ Removed
        full_name="Test User",
        email="test@example.com",
        google_subject_id="sub123",
        roles=["practitioner"]
    )

    # AFTER
    user = User(
        # clinic_id removed ✅
        full_name="Test User",
        email="test@example.com",
        google_subject_id="sub123"
        # roles moved to association ✅
    )
    db_session.add(user)
    db_session.commit()

    # Create association separately
    association = UserClinicAssociation(
        user_id=user.id,
        clinic_id=clinic.id,
        roles=["practitioner"],
        full_name="Test User",
    )
    db_session.add(association)
    ```

6. **Database Queries in Tests** (~200+ instances)
    ```python
    # BEFORE - Direct clinic_id filter
    users = db_session.query(User).filter(User.clinic_id == clinic.id).all()

    # AFTER - Join with associations
    users = db_session.query(User).join(UserClinicAssociation).filter(
        UserClinicAssociation.clinic_id == clinic.id,
        UserClinicAssociation.is_active == True
    ).all()
    ```

7. **Clinic Isolation Assertions** (existing tests that need updates)
    ```python
    # BEFORE - Direct property check
    assert user.clinic_id == clinic.id

    # AFTER - Association-based check
    association = db_session.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user.id,
        UserClinicAssociation.clinic_id == clinic.id,
        UserClinicAssociation.is_active == True
    ).first()
    assert association is not None
    assert association.roles == ["practitioner"]
    ```

#### New Test Requirements

8. **Multi-Clinic User Tests**
    - [ ] Test user with associations to multiple clinics
    - [ ] Test clinic switching API endpoints
    - [ ] Test role differences across clinics
    - [ ] Test name differences across clinics

9. **Clinic Isolation Security Tests**
    - [ ] Test that users cannot access other clinics
    - [ ] Test that inactive associations block access
    - [ ] Test that deactivated clinics block access
    - [ ] Test token validation with wrong `active_clinic_id`

10. **Migration Tests**
    - [ ] Test migration on clean database
    - [ ] Test migration with existing data
    - [ ] Test rollback procedure
    - [ ] Test pre-migration validation
    - [ ] Test post-migration validation

#### Test Execution Strategy

**Phase 1: Schema Migration Testing**
- Run migration on test database
- Execute pre/post-migration validation
- Test basic model operations

**Phase 2: Unit Test Updates**
- Update unit tests to work with new schema
- Add new model tests
- Verify authentication logic

**Phase 3: Integration Test Updates**
- Update fixtures and helpers
- Fix broken queries
- Add multi-clinic scenarios

**Phase 4: End-to-End Testing**
- Test complete user flows
- Performance testing
- Security testing

#### Test Coverage Requirements

- **Backward Compatibility**: All existing single-clinic functionality
- **Multi-Clinic Features**: Clinic switching, role management, data isolation
- **Security**: Clinic isolation enforcement
- **Edge Cases**: Inactive associations, concurrent operations, token validation
- **Performance**: Query performance with new joins

## Security Considerations

### Clinic Isolation Enforcement

1. **Database Level**:
   - Foreign key constraints ensure `clinic_id` references valid clinic
   - NOT NULL constraints prevent NULL `clinic_id` in clinic-scoped tables
   - Unique constraints prevent duplicate associations
   - Indexes on `(user_id, clinic_id)` for efficient filtering
   - Database triggers could be added to prevent `clinic_id = NULL` inserts (optional)

2. **API Level**:
   - All endpoints use `require_clinic_access` dependency
   - `active_clinic_id` in token is validated against `user_clinic_associations` on every request
   - Association must be active and clinic must be active
   - Queries always filter by `active_clinic_id`
   - System admins bypass clinic checks (can access any clinic)

3. **Frontend Level**:
   - Clinic switcher only shows clinics user has access to (filtered server-side)
   - API calls include `active_clinic_id` in context (from token)
   - No way to manually set `clinic_id` in requests
   - Token validation on every API call

### Token Security

- JWT tokens include `active_clinic_id` but roles are re-validated on each request
- `active_clinic_id` is validated against `user_clinic_associations` on every request
- Clinic switching requires new token generation (not just frontend state change)
- Refresh tokens maintain user identity but don't store `active_clinic_id`
- Token refresh validates association is still active
- Include `iat` (issued at) in token to prevent token replay attacks
- **Rate Limiting**: Clinic switching endpoint limited to 10 switches/minute per user

### Data Leakage Prevention

- All queries must explicitly filter by `clinic_id`
- No queries should return data from multiple clinics unless explicitly requested (consolidated view)
- Consolidated calendar view re-validates clinic access on each request
- Code review checklist: Verify all clinic-scoped queries include `clinic_id` filter
- Automated tests to detect missing clinic filters
- Database constraints prevent NULL `clinic_id` in clinic-scoped tables

### Audit Logging

**Recommended**: Add audit logging for security and debugging:

```python
# Optional: Create audit log table
CREATE TABLE clinic_access_audit (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    active_clinic_id INTEGER REFERENCES clinics(id),
    action VARCHAR(50) NOT NULL,  -- 'login', 'switch_clinic', 'api_call', etc.
    endpoint VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clinic_access_audit_user ON clinic_access_audit(user_id, created_at DESC);
CREATE INDEX idx_clinic_access_audit_clinic ON clinic_access_audit(active_clinic_id, created_at DESC);
```

**What to log**:
- Clinic switches (user_id, from_clinic_id, to_clinic_id, timestamp)
- Association creation/deletion (user_id, clinic_id, action, admin_user_id)
- Role changes per clinic (user_id, clinic_id, old_roles, new_roles, admin_user_id)
- Failed access attempts (user_id, requested_clinic_id, reason)

### Race Condition Prevention

1. **Clinic Switching**: Use database transactions, handle concurrent switches
2. **Association Creation**: Use unique constraint, handle `IntegrityError`
3. **Token Validation**: Validate association on every request (prevents stale tokens)

### Monitoring & Alerts

**Recommended monitoring**:
- Queries that return data from wrong clinic (data isolation violations)
- Failed clinic switches (access denied errors)
- Association deactivations
- Migration data integrity issues
- Token validation failures
- Rate limit violations on clinic switching

## Testing Strategy

### Unit Tests

1. **Model Tests**:
   - Test `UserClinicAssociation` model
   - Test relationships between User, Clinic, and associations
   - Test role validation per clinic

2. **Service Tests**:
   - Test clinic switching logic
   - Test role retrieval per clinic
   - Test query filtering by clinic_id

3. **Auth Tests**:
   - Test JWT token generation with `active_clinic_id`
   - Test clinic access validation
   - Test role checking per clinic

### Integration Tests

1. **Multi-Clinic User Flow**:
   - User with access to 2 clinics
   - Login → clinic selection → dashboard
   - Switch clinic → verify data changes
   - Verify isolation between clinics

2. **Single-Clinic User Flow**:
   - User with access to 1 clinic
   - Login → auto-select → dashboard
   - Verify no clinic switcher shown
   - Verify backward compatibility

3. **Role-Based Access**:
   - User is admin at Clinic A, practitioner at Clinic B
   - Verify admin features work at Clinic A
   - Verify admin features blocked at Clinic B
   - Verify practitioner features work at both

4. **Data Isolation**:
   - Create availability at Clinic A
   - Verify it doesn't appear at Clinic B
   - Create appointment at Clinic A
   - Verify it doesn't appear at Clinic B

### E2E Tests

1. **Clinic Switching Flow**:
   - Login as multi-clinic user
   - Select clinic
   - View calendar
   - Switch clinic
   - Verify calendar updates
   - Verify no data from previous clinic visible

2. **Backward Compatibility**:
   - Login as single-clinic user
   - Verify normal flow works
   - Verify no errors or warnings

## Migration Context

**Important**: We have a small user base (handful of users), so we can:
- Migrate aggressively with short downtime
- Reduce technical debt by making breaking changes if needed
- Complete migration in a single deployment window
- Skip gradual rollout phases

This allows us to:
- Remove backward compatibility code faster
- Make cleaner schema changes
- Complete the migration in 1-2 days instead of weeks

## Rollout Plan

### Phase 1: Database Migration (Day 1 - Morning)
- Create migration scripts
- Test migration on staging
- **Schedule short maintenance window** (30-60 minutes)
- Run migration on production
- Verify data integrity
- **No backward compatibility needed** - we can update all code immediately

### Phase 2: Backend Updates (Day 1 - Afternoon)
- Update models and relationships
- Update authentication logic
- Update all queries (see comprehensive list below)
- Add new API endpoints
- Comprehensive testing

### Phase 3: Frontend Updates (Day 2 - Morning)
- Update auth state management
- Add clinic switcher component
- Update all pages
- Add clinic selection screen
- UI/UX testing

### Phase 4: Testing & Deployment (Day 2 - Afternoon)
- Create test multi-clinic users
- Test all flows
- Fix any issues
- Performance testing
- **Deploy to production**

### Phase 5: User Communication (Day 2 - Evening)
- Notify users of new multi-clinic support
- Provide instructions for clinic switching
- Monitor for issues

## Signup Flow Design

### New User Signup (Not Logged In)

**Flow**:
1. User receives signup link (clinic admin or member invitation)
2. User clicks link → redirected to signup page
3. User clicks "Sign up with Google"
4. OAuth flow → Google authentication
5. Backend checks if `google_subject_id` exists:
   - **If new user**: Continue to name confirmation
   - **If existing user**: See "Existing User Signup" flow below
6. Name confirmation page (user can customize name for this clinic)
7. Create `User` record (if new) and `UserClinicAssociation` record
8. Generate JWT with `active_clinic_id` = the clinic from signup token
9. Redirect to dashboard

### Existing User Signup (Already Member of Another Clinic)

**Scenario**: User is already logged in to Clinic A, receives invitation to Clinic B.

**Flow**:
1. User receives signup link for Clinic B (while logged in to Clinic A)
2. User clicks link → signup page detects existing session
3. **Two options**:
   
   **Option A: Continue in Current Session (RECOMMENDED)**
   - Show message: "您已經登入為 [Clinic A]。要加入 [Clinic B] 嗎？"
   - User confirms → backend creates `UserClinicAssociation` for Clinic B
   - Backend switches active clinic to Clinic B (or asks user to switch)
   - Redirect to Clinic B dashboard
   
   **Option B: New Session**
   - Show message: "您已經登入為 [Clinic A]。要為 [Clinic B] 建立新的登入嗎？"
   - User confirms → backend creates `UserClinicAssociation` for Clinic B
   - User can switch clinics using clinic switcher
   - Stay on current page (Clinic A)

**Implementation Details**:

```python
@router.get("/member", summary="Initiate team member signup")
async def initiate_member_signup(
    token: str,
    current_user: Optional[UserContext] = Depends(get_optional_user),  # Optional auth
    db: Session = Depends(get_db)
) -> dict[str, str]:
    """
    Handle signup for both new and existing users.
    
    If user is already logged in:
    - Check if they already have access to this clinic
    - If yes: redirect to dashboard with message
    - If no: create association and optionally switch clinic
    """
    signup_token = validate_signup_token(token, db)
    
    # If user is logged in
    if current_user:
        # Check if user already has access to this clinic
        existing_assoc = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == current_user.user_id,
            UserClinicAssociation.clinic_id == signup_token.clinic_id
        ).first()
        
        if existing_assoc:
            # Already a member - redirect to dashboard
            return {
                "redirect_url": f"{FRONTEND_URL}/admin?message=already_member",
                "clinic_id": signup_token.clinic_id
            }
        
        # Create association for existing user
        # Ask user for clinic-specific name (or use default)
        return {
            "auth_url": None,  # Skip OAuth
            "existing_user": True,
            "clinic_id": signup_token.clinic_id,
            "action": "create_association"  # Frontend will call create_association endpoint
        }
    
    # New user - proceed with OAuth
    return {"auth_url": oauth_url}
```

**New Endpoint for Existing Users**:

```python
@router.post("/member/join-existing", summary="Join clinic as existing user")
async def join_clinic_as_existing_user(
    token: str,
    name: Optional[str] = None,  # Optional: clinic-specific name
    current_user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create user-clinic association for existing user.
    
    User must be authenticated. This is called when an existing user
    clicks a signup link for a new clinic.
    
    Handles race conditions via database unique constraint.
    """
    signup_token = validate_signup_token(token, db)
    
    # Validate clinic is active
    clinic = db.query(Clinic).filter(
        Clinic.id == signup_token.clinic_id,
        Clinic.is_active == True
    ).first()
    
    if not clinic:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="此診所已停用"
        )
    
    # Check if association already exists (optimistic check)
    existing = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == current_user.user_id,
        UserClinicAssociation.clinic_id == signup_token.clinic_id
    ).first()
    
    if existing:
        if existing.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="您已經是此診所的成員"
            )
        else:
            # Reactivate existing association
            existing.is_active = True
            existing.roles = signup_token.default_roles
            if name:
                existing.full_name = name.strip()
            db.commit()
            association = existing
    else:
        # Create new association (handle race condition via unique constraint)
        clinic_name = name.strip() if name else current_user.name
        if not clinic_name:
            clinic_name = "User"  # Fallback
        
        association = UserClinicAssociation(
            user_id=current_user.user_id,
            clinic_id=signup_token.clinic_id,
            roles=signup_token.default_roles,
            full_name=clinic_name
        )
        
        try:
            db.add(association)
            signup_token.used_at = datetime.now(timezone.utc)
            db.commit()
        except IntegrityError:
            # Race condition: association was created by another request
            db.rollback()
            # Fetch the existing association
            association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == current_user.user_id,
                UserClinicAssociation.clinic_id == signup_token.clinic_id
            ).first()
            
            if not association or not association.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="您已經是此診所的成員"
                )
    
    # Optionally switch to new clinic
    return {
        "association_created": True,
        "clinic_id": signup_token.clinic_id,
        "switch_clinic": True,  # Frontend can call switch-clinic endpoint
        "clinic": {
            "id": clinic.id,
            "name": clinic.name,
            "display_name": clinic.display_name or clinic.name
        }
    }
```

### Name Confirmation Flow

**For New Users**:
- After OAuth, user sees name confirmation page
- Pre-filled with Google name, but editable
- **Validation**: 
  - Minimum length: 1 character (after trim)
  - Maximum length: 255 characters (database limit)
  - Trim whitespace
  - Reject if empty after trim
- This name is stored in both:
  - `users.full_name` (default/fallback name)
  - `user_clinic_associations.full_name` (clinic-specific name)
- If user joins another clinic later, `users.full_name` is used as default

**For Existing Users Joining New Clinic**:
- Show name input field (optional)
- Pre-filled with their name from current clinic (or `users.full_name`), but editable
- **Validation**: Same as new users (min 1 char, max 255, trim whitespace)
- If not provided, use name from `users.full_name`
- Store in `user_clinic_associations.full_name`

### Edge Cases

1. **User tries to sign up for clinic they're already in**:
   - Show message: "您已經是此診所的成員"
   - Redirect to dashboard or offer to switch clinic
   - If association exists but is inactive, reactivate it

2. **Signup token expired while user is in OAuth flow**:
   - Detect on callback
   - Show error: "註冊連結已過期，請聯繫診所管理員重新發送"
   - Clean up any partial state

3. **User has multiple signup tokens for different clinics**:
   - Each token is processed independently
   - User can join multiple clinics through separate signup flows
   - Handle race conditions via database unique constraint

4. **User closes browser during name confirmation**:
   - Association is not created until name is confirmed
   - User can restart signup flow with same token (if not expired)
   - No orphaned data created

5. **OAuth callback fails after association creation**:
   - Use database transaction to ensure atomicity
   - If OAuth fails, rollback association creation
   - User can retry signup flow

6. **Concurrent signup requests**:
   - Database unique constraint prevents duplicate associations
   - Handle `IntegrityError` gracefully
   - Return appropriate message if association already exists

## Database Query Review

This section lists all database queries that need to be updated to enforce clinic isolation. Queries are organized by file and include the specific change needed.

### Critical: Queries That MUST Be Updated

These queries currently rely on implicit clinic filtering via `user.clinic_id` and will break clinic isolation if not updated.

#### `backend/src/api/clinic.py`

1. **Line 157-162**: List members
   ```python
   # BEFORE: members = db.query(User).filter(User.clinic_id == current_user.clinic_id)
   # AFTER: Must join with user_clinic_associations and filter by active_clinic_id
   members = db.query(User).join(UserClinicAssociation).filter(
       UserClinicAssociation.clinic_id == current_user.active_clinic_id,
       UserClinicAssociation.is_active == True
   )
   ```

2. **Line 259, 335, 393**: Get member by ID
   ```python
   # BEFORE: member = db.query(User).filter(User.id == user_id, User.clinic_id == current_user.clinic_id)
   # AFTER: Must verify user is associated with active clinic
   member = db.query(User).join(UserClinicAssociation).filter(
       User.id == user_id,
       UserClinicAssociation.clinic_id == current_user.active_clinic_id
   ).first()
   ```

3. **Line 275, 349**: Get admin users
   ```python
   # BEFORE: admin_users = db.query(User).filter(User.clinic_id == current_user.clinic_id, ...)
   # AFTER: Filter by active_clinic_id via association
   admin_users = db.query(User).join(UserClinicAssociation).filter(
       UserClinicAssociation.clinic_id == current_user.active_clinic_id,
       UserClinicAssociation.roles.contains(['admin'])
   )
   ```

4. **Line 436**: Get clinic settings
   ```python
   # BEFORE: clinic = db.query(Clinic).filter(Clinic.id == current_user.clinic_id)
   # AFTER: Use active_clinic_id
   clinic = db.query(Clinic).filter(Clinic.id == current_user.active_clinic_id)
   ```

5. **Line 962, 1035, 1152, 1264, 1467, 1529, 1537**: Get practitioner
   ```python
   # BEFORE: practitioner = db.query(User).filter(User.id == user_id, User.clinic_id == current_user.clinic_id)
   # AFTER: Must verify practitioner is in active clinic
   practitioner = db.query(User).join(UserClinicAssociation).filter(
       User.id == user_id,
       UserClinicAssociation.clinic_id == current_user.active_clinic_id
   ).first()
   ```

6. **Line 986, 1059, 1140, 1177, 1252**: PractitionerAvailability queries
   ```python
   # BEFORE: availability = db.query(PractitionerAvailability).filter(PractitionerAvailability.user_id == user_id)
   # AFTER: Must filter by clinic_id (now in PractitionerAvailability table)
   availability = db.query(PractitionerAvailability).filter(
       PractitionerAvailability.user_id == user_id,
       PractitionerAvailability.clinic_id == current_user.active_clinic_id
   )
   ```

#### `backend/src/services/availability_service.py`

7. **Line 95**: Get practitioners for appointment type
   ```python
   # BEFORE: query = db.query(User).filter(User.clinic_id == clinic_id, ...)
   # AFTER: Join with associations
   query = db.query(User).join(UserClinicAssociation).filter(
       UserClinicAssociation.clinic_id == clinic_id,
       ...
   )
   ```

8. **Line 456-462**: Get practitioners by appointment type
   ```python
   # BEFORE: query = db.query(User).join(...).filter(User.clinic_id == clinic_id)
   # AFTER: Filter via association
   query = db.query(User).join(UserClinicAssociation).join(...).filter(
       UserClinicAssociation.clinic_id == clinic_id
   )
   ```

9. **Line 554-557**: Fetch practitioner availability
   ```python
   # BEFORE: default_intervals = db.query(PractitionerAvailability).filter(
   #     PractitionerAvailability.user_id.in_(practitioner_ids),
   #     PractitionerAvailability.day_of_week == day_of_week
   # )
   # AFTER: Must filter by clinic_id
   default_intervals = db.query(PractitionerAvailability).filter(
       PractitionerAvailability.user_id.in_(practitioner_ids),
       PractitionerAvailability.clinic_id == clinic_id,  # ADD THIS
       PractitionerAvailability.day_of_week == day_of_week
   )
   ```

10. **Line 565-577**: Fetch calendar events
    ```python
    # BEFORE: events = db.query(CalendarEvent).filter(CalendarEvent.user_id.in_(practitioner_ids), ...)
    # AFTER: Must filter by clinic_id
    events = db.query(CalendarEvent).filter(
        CalendarEvent.user_id.in_(practitioner_ids),
        CalendarEvent.clinic_id == clinic_id,  # ADD THIS
        CalendarEvent.date == date,
        ...
    )
    ```

#### `backend/src/services/appointment_service.py`

11. **Line 433-436**: List appointments for clinic
    ```python
    # BEFORE: query = query.filter(User.clinic_id == clinic_id)
    # AFTER: Filter via association or use CalendarEvent.clinic_id
    query = query.filter(CalendarEvent.clinic_id == clinic_id)
    ```

12. **Line 137**: Get practitioner (for appointment creation)
    ```python
    # BEFORE: practitioner = db.query(User).get(assigned_practitioner_id)
    # AFTER: Must verify practitioner is in clinic
    practitioner = db.query(User).join(UserClinicAssociation).filter(
        User.id == assigned_practitioner_id,
        UserClinicAssociation.clinic_id == clinic_id
    ).first()
    ```

#### `backend/src/api/practitioner_calendar.py`

13. **Line 172**: Get availability
    ```python
    # BEFORE: availability = db.query(PractitionerAvailability).filter(...)
    # AFTER: Add clinic_id filter
    availability = db.query(PractitionerAvailability).filter(
        ...,
        PractitionerAvailability.clinic_id == current_user.active_clinic_id
    )
    ```

14. **Line 197**: Get appointments
    ```python
    # BEFORE: appointments = db.query(Appointment).join(CalendarEvent).filter(...)
    # AFTER: Add clinic_id filter
    appointments = db.query(Appointment).join(CalendarEvent).filter(
        ...,
        CalendarEvent.clinic_id == current_user.active_clinic_id
    )
    ```

15. **Line 243, 298, 406, 584, 660**: Get user/practitioner
    ```python
    # BEFORE: user = db.query(User).filter(User.id == user_id)
    # AFTER: Verify user is in active clinic
    user = db.query(User).join(UserClinicAssociation).filter(
        User.id == user_id,
        UserClinicAssociation.clinic_id == current_user.active_clinic_id
    ).first()
    ```

16. **Line 431-439**: Get calendar events
    ```python
    # BEFORE: events = db.query(CalendarEvent).filter(...)
    # AFTER: Add clinic_id filter
    events = db.query(CalendarEvent).filter(
        ...,
        CalendarEvent.clinic_id == current_user.active_clinic_id
    )
    ```

17. **Line 471**: Get availability exception
    ```python
    # BEFORE: exception = db.query(AvailabilityException).join(CalendarEvent).filter(...)
    # AFTER: Add clinic_id filter via CalendarEvent
    exception = db.query(AvailabilityException).join(CalendarEvent).filter(
        ...,
        CalendarEvent.clinic_id == current_user.active_clinic_id
    )
    ```

#### `backend/src/services/practitioner_service.py`

18. **Line 46, 94, 125, 156**: Get practitioners
    ```python
    # BEFORE: query = db.query(User).filter(User.clinic_id == clinic_id, ...)
    # AFTER: Join with associations
    query = db.query(User).join(UserClinicAssociation).filter(
        UserClinicAssociation.clinic_id == clinic_id,
        ...
    )
    ```

19. **Line 250**: Get practitioner appointment types
    ```python
    # BEFORE: db.query(PractitionerAppointmentTypes).filter(...)
    # AFTER: Add clinic_id filter
    db.query(PractitionerAppointmentTypes).filter(
        ...,
        PractitionerAppointmentTypes.clinic_id == clinic_id
    )
    ```

#### `backend/src/auth/dependencies.py`

20. **Line 108-111, 139-142**: Get user for authentication
    ```python
    # BEFORE: user = db.query(User).filter(User.email == email, User.clinic_id.is_(None))
    # AFTER: For system admin, no change. For clinic user, must check associations
    # System admin: user = db.query(User).filter(User.email == email, User.clinic_id.is_(None))
    # Clinic user: Must validate active_clinic_id against associations
    user = db.query(User).join(UserClinicAssociation).filter(
        User.email == email,
        UserClinicAssociation.clinic_id == payload.active_clinic_id
    ).first()
    ```

#### `backend/src/api/signup.py`

21. **Line 275-277**: Check existing user
    ```python
    # BEFORE: existing_user = db.query(User).filter(User.google_subject_id == google_subject_id)
    # AFTER: No change needed - this is checking if user exists globally
    # But when creating association, must check if already associated with clinic
    ```

22. **Line 289-293**: Check existing email in clinic
    ```python
    # BEFORE: existing_email = db.query(User).filter(
    #     User.clinic_id == signup_token.clinic_id,
    #     User.email == email
    # )
    # AFTER: Check via associations
    existing_email = db.query(User).join(UserClinicAssociation).filter(
        UserClinicAssociation.clinic_id == signup_token.clinic_id,
        User.email == email
    ).first()
    ```

### Queries That Are Already Safe

These queries already filter by explicit `clinic_id` and don't need changes:

- `backend/src/utils/patient_queries.py`: All queries filter by `Patient.clinic_id` ✅
- `backend/src/utils/appointment_type_queries.py`: All queries filter by `AppointmentType.clinic_id` ✅
- `backend/src/services/patient_service.py`: All queries filter by `Patient.clinic_id` ✅
- `backend/src/services/reminder_service.py`: Line 184 filters by `Appointment.patient.has(clinic_id=clinic_id)` ✅

### Queries That Need Clinic ID Added to WHERE Clause

These queries need `clinic_id` added to the filter, but the table already has the column:

- All `PractitionerAvailability` queries: Add `PractitionerAvailability.clinic_id == clinic_id`
- All `CalendarEvent` queries: Add `CalendarEvent.clinic_id == clinic_id`
- All `PractitionerAppointmentTypes` queries: Add `PractitionerAppointmentTypes.clinic_id == clinic_id`

## Database Indexing Review

### New Indexes Needed

1. **`user_clinic_associations` table**:
   ```sql
   -- Already defined in schema, but ensure these exist:
   CREATE INDEX idx_user_clinic_associations_user ON user_clinic_associations(user_id);
   CREATE INDEX idx_user_clinic_associations_clinic ON user_clinic_associations(clinic_id);
   CREATE INDEX idx_user_clinic_associations_active ON user_clinic_associations(user_id, is_active) 
       WHERE is_active = TRUE;
   ```

2. **`practitioner_availability` table**:
   ```sql
   -- Add composite index for common query pattern: (user_id, clinic_id, day_of_week)
   CREATE INDEX idx_practitioner_availability_user_clinic_day 
       ON practitioner_availability(user_id, clinic_id, day_of_week);
   
   -- Update existing index to include clinic_id
   -- DROP: idx_practitioner_availability_user_day
   -- CREATE: idx_practitioner_availability_user_clinic_day (above)
   ```

3. **`calendar_events` table**:
   ```sql
   -- Add composite index for common query pattern: (user_id, clinic_id, date)
   CREATE INDEX idx_calendar_events_user_clinic_date 
       ON calendar_events(user_id, clinic_id, date);
   
   -- Update existing index to include clinic_id
   -- DROP: idx_calendar_events_user_date
   -- CREATE: idx_calendar_events_user_clinic_date (above)
   
   -- Add index for clinic-scoped queries
   CREATE INDEX idx_calendar_events_clinic_date 
       ON calendar_events(clinic_id, date, event_type);
   ```

4. **`practitioner_appointment_types` table**:
   ```sql
   -- Add composite index for common query pattern: (user_id, clinic_id, appointment_type_id)
   CREATE INDEX idx_practitioner_types_user_clinic_type 
       ON practitioner_appointment_types(user_id, clinic_id, appointment_type_id);
   
   -- Update unique constraint to include clinic_id
   -- DROP: uq_practitioner_type
   -- CREATE: UNIQUE(user_id, clinic_id, appointment_type_id)
   ```

### Indexes to Update

1. **`practitioner_availability`**:
   - Current: `idx_practitioner_availability_user_day` on `(user_id, day_of_week)`
   - New: `idx_practitioner_availability_user_clinic_day` on `(user_id, clinic_id, day_of_week)`

2. **`calendar_events`**:
   - Current: `idx_calendar_events_user_date` on `(user_id, date)`
   - New: `idx_calendar_events_user_clinic_date` on `(user_id, clinic_id, date)`
   - Current: `idx_calendar_events_user_date_type` on `(user_id, date, event_type)`
   - New: `idx_calendar_events_user_clinic_date_type` on `(user_id, clinic_id, date, event_type)`

3. **`practitioner_appointment_types`**:
   - Current: `uq_practitioner_type` unique on `(user_id, appointment_type_id)`
   - New: Unique on `(user_id, clinic_id, appointment_type_id)`

### Indexes That Remain Unchanged

- `patients`: All indexes already include `clinic_id` ✅
- `appointment_types`: All indexes already include `clinic_id` ✅
- `appointments`: Indexes don't need clinic_id (filtered via CalendarEvent) ✅

## Resolved Questions

1. **Default Clinic Selection**: ✅ **RESOLVED**
   - Fallback order: User preference → Most recently accessed → First created → First by ID
   - Tracked via `last_accessed_at` field in `user_clinic_associations`
   - Updated on login and clinic switch

2. **Clinic Deactivation**: ✅ **RESOLVED**
   - Mark `is_active = False` in association (preserves history)
   - User cannot access deactivated clinic
   - If user's active clinic is deactivated, force clinic re-selection on next request
   - Deactivated associations don't appear in clinic switcher (filtered server-side)
   - Can be reactivated if clinic becomes active again
   - **Behavior**:
     - `is_active = False` means user no longer has access (but history preserved)
     - Only active associations appear in clinic switcher
     - Deactivation can be reversed (reactivation flow)
     - If user's only clinic is deactivated, user must be invited to another clinic or association must be reactivated
     - Global `users.is_active = False` → User cannot authenticate at all (blocks all clinics)
     - Association `is_active = False` → User cannot access that specific clinic, but can access others

3. **User Settings**: ✅ **RESOLVED**
   - Per-clinic for now (can add global later if needed)
   - Future: Consider `user_preferences` table with `(user_id, clinic_id, preferences)` structure

4. **Consolidated Calendar Timeline**: ✅ **RESOLVED**
   - Future release - focus on core multi-clinic support first
   - Design is ready for implementation when needed

5. **Email Uniqueness**: ✅ **RESOLVED**
   - Email remains globally unique (one account per email)
   - One user account can have multiple clinic associations
   - This is intentional for security and account management

6. **Cascade Deletes**: ✅ **RESOLVED**
   - If user is deleted → all associations are deleted (CASCADE)
   - If clinic is deleted → all associations are deleted (CASCADE)
   - This is by design for data consistency
   - Consider soft-delete pattern in future if audit trail is needed

## Implementation Checklist

### Pre-Implementation
- [ ] Review and approve design document
- [ ] Create database backup
- [ ] Run pre-migration validation queries
- [ ] Test migration on staging environment
- [ ] Prepare rollback plan

### Database Migration
- [x] Create migration script with all required fields (`full_name`, `last_accessed_at`)
- [x] Add pre-migration validation
- [x] Add post-migration validation
- [x] Test migration on production-like data (test database)
- [ ] Test rollback procedure
- [x] Create indexes as specified

### Backend Implementation
- [x] Create `UserClinicAssociation` model
- [x] Update `User` model (add relationship, keep `clinic_id` for backward compatibility)
- [x] Update `Clinic` model (add relationship)
- [ ] Update `get_current_user` in `auth/dependencies.py` (CRITICAL) - **IN PROGRESS**
- [x] Update models to add `clinic_id` to clinic-scoped tables (`PractitionerAvailability`, `CalendarEvent`, `PractitionerAppointmentTypes`)
- [x] Update API endpoints to include `clinic_id` when creating clinic-scoped records
- [ ] Update all queries identified in Database Query Review section - **IN PROGRESS**
- [ ] Add new API endpoints (`/api/auth/clinics`, `/api/auth/switch-clinic`)
- [ ] Update signup flow for existing users
- [ ] Add error handling for all edge cases
- [ ] Add rate limiting to clinic switching endpoint

### Frontend Implementation
- [ ] Update `AuthUser` interface to include `active_clinic_id` and `available_clinics`
- [ ] Update `useAuth` hook
- [ ] Create clinic switcher component
- [ ] Add clinic selection screen for multi-clinic users
- [ ] Update all pages to use `active_clinic_id`
- [ ] Add error handling for clinic switching
- [ ] Add loading states and optimistic updates

### Testing
- [x] Update test fixtures to create `UserClinicAssociation` records
- [x] Update test fixtures to add `clinic_id` to `PractitionerAvailability`, `CalendarEvent`, `PractitionerAppointmentTypes` creations
- [x] Fix `test_practitioner_availability.py` - all tests passing
- [x] Fix `test_clinic_management_integration.py` - all tests passing
- [x] Fix `test_practitioner_calendar_api.py` - all tests passing
- [x] Fix `test_liff_integration.py` - all tests passing
- [x] Fix `test_clinic_management_additional.py` - all tests passing
- [x] Fix `test_appointment_service_integration.py` - all tests passing
- [x] Fix `test_calendar_models.py` - all tests passing
- [x] Fix `test_appointment_service.py` - all tests passing
- [x] Fix `test_reminder_service.py` - all tests passing
- [x] Create helper functions in `conftest.py` (`create_user_with_clinic_association`, `create_practitioner_availability_with_clinic`, `create_calendar_event_with_clinic`)
- [ ] Run all test cases listed in Testing Strategy section - **IN PROGRESS** (many tests still need updates)
- [ ] Test migration on production-like data
- [ ] Test rollback procedure
- [ ] Performance testing (query benchmarks)
- [ ] Security testing (data isolation verification)

### Deployment
- [ ] Schedule maintenance window (30-60 minutes)
- [ ] Run migration on production
- [ ] Run post-migration validation
- [ ] Deploy application code
- [ ] Monitor for issues
- [ ] User communication

### Risk Mitigation

**High-Risk Areas:**
1. **Authentication Logic**: `get_current_user` changes affect all requests
2. **Database Queries**: ~200+ query updates across codebase
3. **Migration**: Schema changes with data transformation
4. **Test Coverage**: Extensive test changes required

**Mitigation Strategies:**
- **Phased Deployment**: Deploy schema changes first, then application code
- **Feature Flags**: Use feature flags to enable multi-clinic gradually
- **Rollback Plan**: Complete rollback procedures documented
- **Monitoring**: Enhanced monitoring for authentication failures
- **Testing**: Comprehensive test coverage before deployment

## Conclusion

This design provides a solid foundation for multi-clinic user support while maintaining strict clinic isolation. The architecture is future-ready for consolidated calendar views and other cross-clinic features, while ensuring security and data integrity.

**Key Improvements from Review Feedback**:
- ✅ Fixed migration SQL to include `full_name`
- ✅ Added `last_accessed_at` field for default clinic selection
- ✅ Detailed authentication flow with association validation
- ✅ Added pre-migration and post-migration validation queries
- ✅ Added rollback plan
- ✅ Clarified system admin handling
- ✅ Added error response specifications
- ✅ Added race condition handling
- ✅ Added comprehensive edge case handling
- ✅ Added audit logging recommendations

The aggressive migration approach (1-2 days) is appropriate for our small user base and allows us to reduce technical debt quickly while maintaining data integrity and security.

