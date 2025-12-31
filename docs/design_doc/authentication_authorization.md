# Authentication & Authorization - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for authentication and authorization in the clinic system. It covers JWT-based authentication, role-based access control, clinic isolation, and multi-clinic user support.

---

## Key Business Logic

### 1. User Types

**System Admin**: 
- Has no clinic associations
- Email must be in `SYSTEM_ADMIN_EMAILS` whitelist
- Full system access (all clinics, system management)
- Uses email as name (no clinic-specific name)

**Clinic User**:
- Has one or more clinic associations via `UserClinicAssociation`
- Clinic-specific roles and names per association
- Can switch between clinics
- Access limited to associated clinics

**Rationale**: Separates system-level administration from clinic-specific operations.

### 2. Authentication Flow

**Google OAuth**:
1. User initiates login via `/api/auth/google/login`
2. Redirected to Google OAuth consent screen
3. Google redirects back with authorization code
4. Backend exchanges code for user info (email, Google subject ID)
5. User record created/updated in database
6. JWT token generated with user context

**JWT Token Structure**:
- **Clinic Users**: `user_type`, `email`, `sub` (Google subject ID), `active_clinic_id`, `roles`, `exp`, `iat`
- **System Admins**: `user_type`, `email`, `sub`, `exp`, `iat` (no `active_clinic_id` or `roles`)

**Token Refresh**: Uses refresh tokens stored in database for long-lived sessions

**Rationale**: OAuth provides secure authentication without password management. JWT enables stateless authentication with embedded user context.

### 3. Clinic Isolation

**Core Principle**: Clinic users can ONLY access data from their associated clinics

**Enforcement**:
- JWT token includes `active_clinic_id` for clinic users
- All clinic-scoped queries filter by `clinic_id` from user's association
- `active_clinic_id` validated against `UserClinicAssociation` on every request
- Clinic must be active (`is_active = True`)

**System Admins**: Cannot access clinic endpoints - must use system endpoints

**Rationale**: Critical security requirement to prevent data leakage between clinics.

### 4. Multi-Clinic User Support

**UserClinicAssociation**: Many-to-many relationship between users and clinics
- Each association has its own `roles`, `full_name`, `is_active` flag
- User can have different roles at different clinics
- User can have different names at different clinics

**Clinic Switching**:
- User can switch between associated clinics
- `active_clinic_id` updated in JWT token
- Rate limited: 10 switches per minute per user
- `last_accessed_at` updated for default clinic selection

**Default Clinic**: Most recently accessed clinic (by `last_accessed_at`), or first active association if none accessed

**Rationale**: Enables users to work at multiple clinics while maintaining strict data isolation.

### 5. Role-Based Access Control

**Roles**: Stored as JSONB array in `UserClinicAssociation.roles`

**Common Roles**:
- `admin`: Full clinic access (settings, appointments, patients, etc.)
- `practitioner`: Appointment management, patient viewing
- (Other roles can be added as needed)

**Role Checking**:
- `user.has_role("admin")`: Checks if user has specific role OR is system admin
- System admins bypass all role checks (have full access)

**Dependency Functions**:
- `require_authenticated`: Any authenticated user (system admin or clinic user)
- `require_system_admin`: System admin only
- `require_clinic_user`: Clinic user only (not system admin)
- `require_admin_role`: Admin role OR system admin
- `require_practitioner_or_admin`: Practitioner role OR admin role OR system admin

**Rationale**: Flexible role system allows fine-grained access control while system admins have full access.

### 6. LIFF Authentication

**Purpose**: Authenticate LINE users accessing LIFF (LINE Front-end Framework) app

**Flow**:
1. User opens LIFF app in LINE
2. Frontend calls `/api/liff/auth/liff-login` with LINE user ID
3. Backend creates/retrieves `LineUser` for clinic
4. JWT token generated with `line_user_id`, `clinic_id`, `liff_id` (or `clinic_token`)

**Token Structure**: Different from clinic user tokens - includes `line_user_id` and clinic identifiers

**Clinic Isolation**: 
- Clinic-specific LIFF: Validates `liff_id` matches URL parameter
- Shared LIFF: Validates `clinic_token` matches URL parameter
- Frontend validates clinic isolation before making API calls

**Rationale**: Separate authentication flow for LINE users accessing patient-facing LIFF app.

### 7. Token Validation

**JWT Verification**: 
- Token signature verified using `JWT_SECRET_KEY`
- Expiration checked (`exp` claim)
- Payload structure validated

**User Lookup**: 
- System admins: Looked up by email (must have no clinic associations)
- Clinic users: Looked up by Google subject ID + email, then association validated

**Association Validation**:
- `active_clinic_id` must match an active `UserClinicAssociation`
- Association must be active (`is_active = True`)
- Clinic must be active (`is_active = True`)

**Rationale**: Multi-layer validation ensures security and prevents unauthorized access.

---

## Edge Cases

### 1. User Switches Clinic Mid-Session

**Scenario**: User switches clinic while viewing calendar or other clinic-specific data

**Behavior**: Frontend refreshes all clinic-specific data when clinic context changes. Cached data for previous clinic is cleared

**Rationale**: Ensures user always sees correct clinic's data.

### 2. Clinic Association Deactivated

**Scenario**: User's clinic association is deactivated while they have active session

**Behavior**: Next request with that clinic's `active_clinic_id` fails with 403 Forbidden. User must switch to another clinic or re-authenticate

**Rationale**: Prevents access to clinics user is no longer associated with.

### 3. Clinic Deactivated

**Scenario**: Clinic is deactivated (`is_active = False`) while users have active sessions

**Behavior**: Next request fails with 403 Forbidden. Users must switch to another clinic

**Rationale**: Prevents access to inactive clinics.

### 4. Token Expiration

**Scenario**: JWT token expires during user session

**Behavior**: Request fails with 401 Unauthorized. Frontend handles by refreshing token using refresh token or redirecting to login

**Rationale**: Tokens expire for security - refresh tokens enable long-lived sessions.

### 5. Rate Limit Exceeded

**Scenario**: User attempts to switch clinics more than 10 times per minute

**Behavior**: Request fails with 429 Too Many Requests. User must wait before switching again

**Rationale**: Prevents abuse and excessive database updates.

### 6. System Admin with Clinic Associations

**Scenario**: User has system admin email but also has clinic associations

**Behavior**: Authentication fails with 401 Unauthorized. System admins cannot have clinic associations

**Rationale**: Maintains clear separation between system admin and clinic user roles.

### 7. Invalid Clinic ID in Token

**Scenario**: JWT token has `active_clinic_id` that doesn't match user's associations

**Behavior**: Request fails with 403 Forbidden. User must re-authenticate or switch clinic

**Rationale**: Prevents token tampering and ensures clinic isolation.

### 8. LIFF Clinic Isolation Violation

**Scenario**: LIFF token has `liff_id` or `clinic_token` that doesn't match URL parameter

**Behavior**: Frontend validation fails, forces re-authentication. Prevents cross-clinic data access

**Rationale**: Critical security check to prevent clinic data leakage in LIFF app.

---

## Technical Design

### JWT Token Structure

**Clinic User Token**:
```json
{
  "user_type": "clinic_user",
  "email": "user@example.com",
  "sub": "google_subject_id",
  "active_clinic_id": 123,
  "roles": ["admin"],
  "exp": 1234567890,
  "iat": 1234567890
}
```

**System Admin Token**:
```json
{
  "user_type": "system_admin",
  "email": "admin@example.com",
  "sub": "google_subject_id",
  "exp": 1234567890,
  "iat": 1234567890
}
```

**LIFF Token**:
```json
{
  "line_user_id": "U1234567890abcdef",
  "clinic_id": 123,
  "liff_id": "1234567890-abcdefgh",
  "exp": 1234567890,
  "iat": 1234567890
}
```

### Dependency Injection

**FastAPI Dependencies**: Authentication and authorization implemented as FastAPI dependencies

**Dependency Chain**:
1. `get_token_payload`: Extracts and validates JWT token
2. `get_current_user`: Builds `UserContext` from token payload
3. Role/access dependencies: Check specific requirements

**UserContext**: Immutable context object containing:
- `user_type`: "system_admin" or "clinic_user"
- `email`: User email
- `roles`: List of roles at active clinic
- `active_clinic_id`: Currently selected clinic (None for system admins)
- `user_id`: Database user ID
- `name`: Clinic-specific name or email

### Clinic Switching

**API Endpoint**: `POST /api/auth/switch-clinic`

**Rate Limiting**: In-memory per-user rate limit (10 switches per minute)

**Token Refresh**: New JWT token generated with updated `active_clinic_id`

**Last Accessed Update**: `last_accessed_at` updated in `UserClinicAssociation` for default clinic selection

### LIFF Clinic Isolation

**Frontend Validation**: 
- Extracts `liff_id` or `clinic_token` from URL
- Validates against token payload
- Forces re-authentication if mismatch detected

**Backend Validation**:
- Validates `clinic_id` from token against database
- Ensures clinic exists and is active
- Validates `line_user_id` belongs to that clinic

### Token Refresh

**Refresh Tokens**: Stored in `refresh_tokens` table with:
- `user_id`: Associated user
- `token`: Cryptographically secure token
- `expires_at`: Expiration timestamp
- `created_at`: Creation timestamp

**Refresh Flow**:
1. Client sends refresh token to `/api/auth/refresh`
2. Backend validates refresh token
3. New JWT token generated
4. Refresh token rotated (old one invalidated, new one created)

**Rationale**: Refresh tokens enable long-lived sessions while JWT tokens remain short-lived for security.

---

## Summary

This document covers:
- User types (system admin vs. clinic user)
- Authentication flow (Google OAuth, JWT tokens, refresh tokens)
- Clinic isolation (enforcement, validation, system admin restrictions)
- Multi-clinic user support (associations, switching, default clinic)
- Role-based access control (roles, dependency functions, system admin bypass)
- LIFF authentication (LINE user authentication, clinic isolation)
- Token validation (JWT verification, user lookup, association validation)
- Edge cases (clinic switching, deactivation, expiration, rate limiting, isolation violations)
- Technical design (JWT structure, dependency injection, clinic switching, LIFF isolation, token refresh)

All authentication and authorization logic is enforced at the dependency level, ensuring consistent security across all endpoints.



