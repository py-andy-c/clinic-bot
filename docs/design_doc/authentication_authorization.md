# Authentication & Authorization - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for authentication and authorization in the clinic system. It covers Google OAuth-based authentication, role-based access control, clinic isolation, and multi-clinic user support.

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

## Backend Technical Design

### API Endpoints

#### `GET /api/auth/google/login`
- **Description**: Initiate Google OAuth login
- **Query Parameters**: `redirect_uri` (optional)
- **Response**: Redirect to Google OAuth consent screen
- **Errors**: 500 (OAuth configuration error)

#### `GET /api/auth/google/callback`
- **Description**: Google OAuth callback handler
- **Query Parameters**: `code`, `state`, `error`
- **Response**: Redirect to frontend with JWT token
- **Errors**: 400 (OAuth error), 500 (token generation error)

#### `POST /api/auth/refresh`
- **Description**: Refresh JWT token using refresh token
- **Request Body**: `{ refresh_token: string }`
- **Response**: `{ access_token: string, refresh_token: string }`
- **Errors**:
  - 400: Invalid refresh token
  - 401: Refresh token expired
  - 500: Token generation error

#### `POST /clinic/auth/switch-clinic`
- **Description**: Switch active clinic for clinic user
- **Request Body**: `{ clinic_id: number }`
- **Response**: `{ success: true, token: string }`
- **Errors**:
  - 400: Invalid clinic ID, rate limit exceeded
  - 403: Clinic not associated, clinic inactive
  - 429: Rate limit exceeded
  - 500: Token generation error

#### `GET /api/liff/auth/liff-login`
- **Description**: LIFF authentication for LINE users
- **Headers**: `X-LIFF-User-ID`, `X-LIFF-Channel-ID`
- **Query Parameters**: `liff_id`, `clinic_token`
- **Response**: `{ token: string, line_user: LineUser }`
- **Errors**:
  - 400: Missing headers, invalid clinic token
  - 403: Clinic isolation violation
  - 500: Token generation error

### Database Schema

**Users Table**:
- `id`: Primary key
- `email`: String (unique, required)
- `google_sub`: String (Google subject ID, required)
- `full_name`: String (nullable, used for system admins)
- `is_active`: Boolean (default: true)
- `created_at`: DateTime
- `updated_at`: DateTime

**UserClinicAssociation Table**:
- `id`: Primary key
- `user_id`: Foreign key to users
- `clinic_id`: Foreign key to clinics
- `full_name`: String (clinic-specific name)
- `roles`: JSONB array (e.g., ["admin", "practitioner"])
- `is_active`: Boolean (default: true)
- `last_accessed_at`: DateTime (nullable)
- `created_at`: DateTime
- `updated_at`: DateTime

**RefreshTokens Table**:
- `id`: Primary key
- `user_id`: Foreign key to users
- `token_hash`: String (hashed refresh token)
- `expires_at`: DateTime
- `created_at`: DateTime

**Constraints**:
- Users with clinic associations cannot be system admins
- System admin emails must be in whitelist
- One active association per user-clinic combination

### Business Logic Implementation

**AuthService** (`backend/src/services/auth_service.py`):
- `initiate_google_oauth()`: Generate OAuth URL and state
- `handle_google_callback()`: Exchange code for tokens, create/update user
- `generate_tokens()`: Create JWT and refresh tokens
- `validate_token()`: Verify JWT and extract user context
- `refresh_access_token()`: Validate refresh token and generate new access token

**ClinicIsolationMiddleware** (`backend/src/middleware/clinic_isolation.py`):
- Validates `active_clinic_id` against user associations
- Injects clinic context into request
- Enforces clinic-scoped queries

**Key Business Logic**:
- Clinic isolation: All clinic-scoped operations validated against user associations
- Role inheritance: System admins bypass role checks
- Token refresh: Refresh tokens stored hashed in database
- Rate limiting: Clinic switching limited to prevent abuse

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: Authentication endpoints, clinic switching endpoint
- [x] **Current Implementation**: Using `useAuth` context and local API calls
  - **Note**: Migration to React Query planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`
- [x] **Query Keys** (when migrated to React Query):
  - `['user-associations']` - User clinic associations
  - `['clinic-list']` - Available clinics (system admin)
- [x] **Cache Strategy**:
  - **Current**: User context cached in `useAuth` context, clinic associations cached locally
  - **Future (React Query)**:
    - `staleTime`: 5 minutes (user associations don't change frequently)
    - `cacheTime`: 10 minutes
    - Invalidation triggers: Clinic association changes, clinic switching

#### Client State (UI State)
- [x] **useAuth Context** (`frontend/src/hooks/useAuth.tsx`):
  - **State Properties**:
    - `user`: Current user object (email, roles, active clinic, associations)
    - `isAuthenticated`: Authentication status
    - `isLoading`: Initial auth check loading
    - `isSystemAdmin`: Whether user is system admin
    - `isClinicUser`: Whether user is clinic user
    - `activeClinicId`: Current active clinic ID
  - **Actions**:
    - `login()`: Initiate OAuth login
    - `logout()`: Clear authentication
    - `switchClinic()`: Change active clinic
  - **Usage**: Global authentication state, available throughout app

- [x] **Local Component State**:
  - Login page: OAuth redirect handling
  - Clinic switcher: Available clinics list, switching logic
  - Protected routes: Authentication checks

#### Form State
- [x] **Not Applicable**: Authentication uses OAuth, no forms involved

### Component Architecture

#### Component Hierarchy
```
App
  ├── AuthProvider (Context)
  │   ├── LoginPage (OAuth redirect)
  │   ├── ClinicSwitcher (clinic selection)
  │   └── Protected Routes
      ├── AdminRoutes
      │   ├── ClinicLayout
      │   │   └── ClinicSwitcher (in header)
      │   └── SystemAdminLayout
      └── LiffApp (separate LIFF routes)
```

#### Component List
- [x] **AuthProvider** (`frontend/src/hooks/useAuth.tsx`)
  - **Props**: `children` (ReactNode)
  - **State**: User authentication state, loading states
  - **Dependencies**: OAuth API calls, localStorage for token storage

- [x] **LoginPage** (`frontend/src/pages/LoginPage.tsx`)
  - **Props**: None
  - **State**: OAuth redirect handling
  - **Dependencies**: `useAuth` for login initiation

- [x] **ClinicSwitcher** (`frontend/src/components/ClinicSwitcher.tsx`)
  - **Props**: None (uses context)
  - **State**: Clinic switching modal, available clinics
  - **Dependencies**: `useAuth` for clinic switching

- [x] **ClinicLayout** (`frontend/src/components/ClinicLayout.tsx`)
  - **Props**: None
  - **State**: None (layout only)
  - **Dependencies**: `useAuth` for role checks, clinic context

### User Interaction Flows

#### Flow 1: Initial Login (Google OAuth)
1. User visits app without authentication
2. Redirected to `/login` page
3. User clicks "登入" button
4. `useAuth.login()` initiates OAuth flow
5. User redirected to Google OAuth consent screen
6. User grants permissions
7. Google redirects back to `/auth/google/callback`
8. Frontend receives JWT token from URL fragment
9. Token stored in localStorage
10. `useAuth` context updates with user data
11. User redirected to default route (based on role)
   - **Edge case**: System admin → Redirected to system admin dashboard
   - **Edge case**: Clinic user → Redirected to default clinic calendar/members
   - **Error case**: OAuth error → Error page shown with retry option

#### Flow 2: Clinic Switching (Multi-Clinic User)
1. User clicks clinic switcher in header
2. Available clinics list shown (from user associations)
3. User selects different clinic
4. API call to `/clinic/auth/switch-clinic`
5. New JWT token returned with updated `active_clinic_id`
6. Token stored in localStorage
7. `useAuth` context updates active clinic
8. All clinic-specific data refetches automatically
9. UI updates to show new clinic's data
   - **Edge case**: Rate limit exceeded → Error message shown, wait required
   - **Edge case**: Clinic inactive → Error message, clinic removed from list
   - **Error case**: Network error → Switching fails, user stays on current clinic

#### Flow 3: Protected Route Access
1. User navigates to protected route
2. `useAuth` checks authentication status
3. If not authenticated → Redirected to login
4. If authenticated but wrong clinic context → Clinic switcher shown
5. If authenticated but insufficient permissions → Access denied page
6. If authorized → Route renders normally
   - **Edge case**: Token expired → Automatic token refresh attempted
   - **Edge case**: Refresh fails → Redirected to login

#### Flow 4: LIFF Authentication
1. Patient opens LIFF app in LINE
2. LIFF SDK provides user ID
3. Frontend calls `/api/liff/auth/liff-login`
4. JWT token returned for LIFF context
5. Token stored separately from clinic user tokens
6. LIFF app loads with patient-specific UI
   - **Edge case**: Clinic isolation violation → Authentication fails, user blocked
   - **Error case**: LINE API unavailable → Patient cannot access LIFF features

### Edge Cases and Error Handling

#### Edge Cases
- [x] **Race Condition**: User switches clinic during data fetch
  - **Solution**: All API calls include clinic context, clinic switching invalidates caches
  - **Future (React Query)**: Query invalidation on clinic switch

- [x] **Concurrent Clinic Switching**: User switches clinics rapidly
  - **Solution**: Rate limiting (10 switches/minute), latest switch wins
  - **Behavior**: Excess switches blocked, error message shown

- [x] **Clinic Switching During Modal Open**: User switches clinic while checkout modal open
  - **Solution**: Modal should close, or show warning about clinic context change

- [x] **Component Unmount**: Component unmounts during auth API call
  - **Solution**: `useAuth` handles cleanup, prevents state updates after unmount

- [x] **Network Failure**: API call fails during clinic switching
  - **Solution**: Error message shown, user can retry switching
  - **Implementation**: `useAuth` handles network errors gracefully

- [x] **Stale Token**: User has expired token during operation
  - **Solution**: Automatic token refresh, or redirect to login on refresh failure

- [x] **Association Deactivated**: User's clinic association deactivated while logged in
  - **Solution**: Next request fails, user must switch clinics or re-authenticate

- [x] **Clinic Deactivated**: Active clinic becomes inactive
  - **Solution**: Next request fails, user forced to switch to active clinic

- [x] **LIFF Clinic Mismatch**: LIFF token has wrong clinic context
  - **Solution**: Authentication fails, user blocked from accessing mismatched clinic data

#### Error Scenarios
- [x] **API Errors (4xx, 5xx)**:
  - **User Message**: User-friendly error messages ("登入失敗", "切換診所失敗")
  - **Recovery Action**: User can retry operation, or logout and login again
  - **Implementation**: `getErrorMessage()` utility, auth context displays errors

- [x] **Validation Errors**:
  - **User Message**: "無效的診所" or "權限不足"
  - **Recovery Action**: User cannot proceed with invalid action
  - **Implementation**: Backend validation, frontend error handling

- [x] **Loading States**:
  - **Initial Load**: Loading spinner during OAuth callback processing
  - **Clinic Switching**: Loading indicator during clinic switch API call
  - **Implementation**: `useAuth` provides loading states, UI shows spinners

- [x] **Permission Errors (403)**:
  - **User Message**: "您沒有權限存取此頁面"
  - **Recovery Action**: User redirected to appropriate page or shown access denied
  - **Implementation**: Route guards check permissions, redirect on failure

- [x] **Authentication Errors (401)**:
  - **User Message**: "請重新登入"
  - **Recovery Action**: Redirect to login page
  - **Implementation**: Auth interceptors catch 401, trigger logout

### Testing Requirements

#### E2E Tests (Playwright)
- [ ] **Test Scenario**: OAuth login flow
  - Steps:
    1. Visit app without authentication
    2. Verify redirect to login page
    3. Click login button
    4. Verify redirect to Google OAuth
    5. Mock OAuth callback
    6. Verify successful login and redirect to dashboard
  - Assertions: Login succeeds, user context loaded, correct redirect
  - Edge cases: Test OAuth error handling

- [ ] **Test Scenario**: Clinic switching
  - Steps:
    1. Login as multi-clinic user
    2. Click clinic switcher
    3. Select different clinic
    4. Verify clinic switch API called
    5. Verify UI updates with new clinic data
  - Assertions: Clinic switches successfully, data refetches, UI updates
  - Edge cases: Test rate limiting, test inactive clinic

- [ ] **Test Scenario**: Protected route access
  - Steps:
    1. Visit protected route without authentication
    2. Verify redirect to login
    3. Login and verify access to protected route
    4. Test insufficient permissions
  - Assertions: Unauthenticated users blocked, authenticated users can access authorized routes

#### Integration Tests (MSW)
- [ ] **Test Scenario**: Authentication state management
  - Mock API responses: OAuth callback, token refresh
  - User interactions: Login, logout, token refresh
  - Assertions: Auth state updates correctly, tokens stored properly

- [ ] **Test Scenario**: Clinic switching with data refetch
  - Mock API responses: Clinic switch success, new clinic data
  - User interactions: Switch clinic
  - Assertions: Active clinic updates, clinic-specific queries refetch

- [ ] **Test Scenario**: Error handling
  - Mock API responses: 401 (expired token), 403 (clinic access denied)
  - User interactions: Trigger errors
  - Assertions: Appropriate error handling, redirects work correctly

#### Unit Tests
- [ ] **Hook**: `useAuth`
  - Test cases: Login initiation, logout, clinic switching, token storage, error handling
- [ ] **Component**: `ClinicSwitcher`
  - Test cases: Renders available clinics, handles switching, shows loading states
- [ ] **Utility**: Authentication helpers
  - Test cases: Token validation, role checking, clinic association validation

### Performance Considerations

- [x] **Data Loading**: 
  - User associations loaded once on login
  - Clinic switching is fast (just token update + cache invalidation)
  - LIFF authentication is lightweight

- [x] **Caching**: 
  - User context cached in memory (React context)
  - Clinic associations cached locally
  - JWT tokens cached in localStorage

- [x] **Optimistic Updates**: 
  - Clinic switching uses optimistic updates (UI updates immediately, reverts on failure)

- [x] **Lazy Loading**: 
  - Auth components loaded as needed
  - Protected routes lazy loaded

- [x] **Memoization**: 
  - Auth context values memoized
  - Role checking functions memoized

---

## Integration Points

### Backend Integration
- [x] **Dependencies on other services**:
  - Authentication affects all other services (clinic isolation, role checks)
  - OAuth integration with Google APIs
  - LIFF integration with LINE APIs

- [x] **Database relationships**:
  - Users linked to clinic associations
  - Refresh tokens linked to users
  - Foreign key constraints enforce data integrity

- [x] **API contracts**:
  - JWT token format standardized
  - Error responses follow consistent format

### Frontend Integration
- [x] **Shared components used**:
  - `LoadingSpinner`, `ErrorMessage`
  - Route protection components

- [x] **Shared hooks used**:
  - `useAuth` (authentication context, used throughout app)
  - `useModal` (error modals)

- [x] **Shared stores used**:
  - None (authentication is context-based)

- [x] **Navigation/routing changes**:
  - Route protection based on authentication status
  - Role-based route access
  - Clinic-specific routing

---

## Security Considerations

- [x] **Authentication requirements**:
  - All protected routes require valid JWT token
  - OAuth provides secure authentication flow

- [x] **Authorization checks**:
  - Role-based access control enforced on every request
  - Clinic isolation prevents cross-clinic data access
  - System admin vs clinic user separation

- [x] **Input validation**:
  - OAuth responses validated for required fields
  - Clinic IDs validated against user associations
  - Rate limiting prevents abuse

- [x] **XSS prevention**:
  - JWT tokens stored securely (localStorage with httpOnly consideration)
  - User input sanitized before display

- [x] **CSRF protection**:
  - JWT tokens prevent CSRF attacks
  - Stateless authentication

- [x] **Data isolation**:
  - Clinic isolation enforced at API level
  - Users can only access data from associated clinics
  - LIFF tokens scoped to specific clinics

---

## Summary

This document covers:
- User types (system admins vs clinic users)
- Authentication flow (Google OAuth, JWT tokens)
- Clinic isolation (critical security requirement)
- Multi-clinic user support (clinic associations, switching)
- Role-based access control (roles, permissions)
- LIFF authentication (LINE user access)
- Token validation (security measures)
- Edge cases (clinic switching, association changes, token expiration)
- Backend technical design (API endpoints, database schema, business logic)
- Frontend technical design (state management, components, user flows, testing requirements)

All authentication and authorization rules are enforced at both frontend (UX) and backend (source of truth) levels.

**Migration Status**: This document has been migrated to the new template format. Frontend sections reflect current implementation. Authentication is primarily backend/API-focused with minimal frontend complexity, focused on context management and UI flow.
