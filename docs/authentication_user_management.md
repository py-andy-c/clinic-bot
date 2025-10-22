# Clinic Bot Authentication & User Management System

## Overview

This document outlines the complete authentication and user management system for the Clinic Bot platform. The system supports three user types with distinct roles and access levels:

- **System Admins**: Platform administrators who manage clinics and system configuration
- **Clinic Admins**: Clinic owners/managers who manage their specific clinic operations
- **Practitioners**: Healthcare providers who sync their calendars and provide treatments

**Key Design Principle**: System admins manage clinic onboarding and LINE integration setup. Clinic owners receive secure signup links to access their clinic dashboard.

## User Roles

- **System Admin**: Platform administrator who manages clinics and LINE integrations
- **Clinic Admin**: Clinic owner/manager who has full administrative access to their clinic
- **Practitioner**: Healthcare professional (doctor, therapist, dentist, etc.) who can view all clinic data and manage their own information

Users can have multiple roles simultaneously (e.g., a clinic admin who also provides services as a practitioner).

## System Admin Authentication

### How System Admins Sign Up

**System admins (you and your team) authenticate using Google OAuth with email whitelisting:**

1. **Environment Configuration**
   ```bash
   # In .env file
   SYSTEM_ADMIN_EMAILS=your-email@gmail.com,dev2@company.com
   ```

2. **Unified Authentication Flow**
   - Visit app login page (`/login`)
   - Click "Sign in with Google"
   - Google OAuth validates email
   - **Automatic role detection**:
     - Email in `SYSTEM_ADMIN_EMAILS` → redirect to `/system/dashboard`
     - Email associated with clinic → redirect to `/dashboard`
     - No association found → access denied
   - Single entry point for all user types

3. **Security**
   - Only whitelisted emails can become system admins
   - No database records needed for system admins
   - Simple environment variable management
   - Requires redeployment to add/remove system admins (acceptable for MVP)

### Technical Implementation

- **Backend**: Unified OAuth callback with automatic role detection and routing
- **Frontend**:
  - Single login page with automatic role-based routing
  - Auth callback handles all user types and redirects appropriately
  - Session management with role persistence
- **Environment**: `SYSTEM_ADMIN_EMAILS` comma-separated list

**Note**: This is separate from clinic admin authentication, which requires database records linking admins to specific clinics.

### System Admin vs Clinic Admin Access

| Aspect | System Admin | Clinic Admin | Practitioner |
|--------|---------------|--------------|-------------|
| **Signup Method** | Google OAuth (whitelisted emails) | Secure signup link from system admin | Secure signup link from clinic admin |
| **Database Records** | No database record needed | User record with 'admin' + 'practitioner' roles | User record with 'practitioner' role |
| **Post-Login Redirect** | `/system/dashboard` | `/dashboard` | `/dashboard` |
| **Data Access** | All clinics, system-wide metrics + full clinic admin permissions | Full read/write to their clinic | Read access to all clinic data, write access to self |
| **Features** | All clinic admin features + system-wide management, billing, analytics | Full clinic management | View patients, appointments, settings; edit own profile |
| **Access Control** | Email whitelist in environment | Database relationship to clinic | Database relationship to clinic |

### Role Permissions Summary

| Feature Area | System Admin | Clinic Admin | Practitioner |
|-------------|--------------|--------------|-------------|
| **Clinic Management** | Full access to all clinics | Full access to own clinic | View-only access |
| **Practitioner Management** | Full access to all practitioners | Full access to own clinic practitioners | View own clinic practitioners |
| **Patient Management** | Full access to all patients | Full access to own clinic patients | View-only access to own clinic patients |
| **Appointment Management** | Full access to all appointments | Full access to own clinic appointments | View own + manage own appointments |
| **Settings & Configuration** | Full access to all clinics | Full access to own clinic | View-only access |
| **LINE Integration** | Full management | View status only | No access |
| **System Administration** | Full access | No access | No access |
| **Profile Management** | Full access | Full access | Full access |

**Key Permissions:**
- **System Admin**: Platform-wide management + all clinic admin permissions
- **Clinic Admin**: Complete control over their clinic operations (multiple admins per clinic supported)
- **Practitioner**: Read access to clinic data + write access to own appointments/profile

**Role Management Notes:**
- All clinic admins have identical permissions (no hierarchy)
- Members can have flexible role combinations:
  - **Admin + Practitioner**: Full management + appointment scheduling
  - **Admin Only**: Management access without appointments
  - **Practitioner Only**: Appointment scheduling + read access
  - **Neither**: Read-only access to clinic data
- Clinic admins can change member roles dynamically
- System admins can override any clinic role assignments

## User Onboarding Flows

### System Admin Onboarding

**System admins are onboarded by the system administrator (you) through environment configuration:**

1. **System Administrator Setup**
   - Add system admin emails to `SYSTEM_ADMIN_EMAILS` environment variable
   - Configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for OAuth
   - Deploy the system with these environment variables

2. **System Admin Signup**
   - System admin visits `/login` (same as all users)
   - Clicks "Sign in with Google"
   - System automatically detects whitelisted email and redirects to `/system/dashboard`
   - **No database record needed** - permissions are determined by email whitelist

3. **System Admin Access**
   - **Immediate access** to all clinics in the system
   - **Full clinic admin permissions** for any clinic they access
   - **System-wide management** capabilities
   - **No signup link needed** - direct Google OAuth login

**Example Environment Configuration:**
```bash
# .env file
SYSTEM_ADMIN_EMAILS="admin@clinicbot.com,support@clinicbot.com"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

**System Admin Login Flow:**
1. Visit `/login` (same as all users)
2. Click "Sign in with Google"
3. Choose Google account
4. System automatically detects system admin email → redirects to `/system/dashboard`
5. If not a system admin → access denied error

**Adding New System Admins:**
1. **Add email to environment variable**: `SYSTEM_ADMIN_EMAILS="admin@clinicbot.com,support@clinicbot.com,newadmin@clinicbot.com"`
2. **Redeploy system** (or restart if using environment variable injection)
3. **New admin visits** `/login` and signs in with Google
4. **Automatic detection** → redirects to `/system/dashboard` with full access

**Removing System Admins:**
1. **Remove email from environment variable**
2. **Redeploy system**
3. **Admin loses access** on next login attempt

### Clinic Onboarding Flow

#### Step 1: System Admin Creates Clinic
1. **LINE Official Account Setup**
   - Clinic owner creates LINE Official Account for their clinic
   - Clinic owner adds system admin's LINE account as an admin to their Official Account
   - Clinic owner shares LINE credentials with system admin

2. **Webhook Configuration**
   - System admin logs into LINE Developers Console
   - Configures webhook URL: `https://your-domain.com/webhook/line`
   - Obtains `channel_access_token` and `channel_secret`

3. **Clinic Record Creation**
   - System admin uses system dashboard UI to create clinic
   - Enters LINE credentials and clinic information
   - System generates secure clinic admin signup token with `default_roles = ['admin', 'practitioner']`
   - System creates signup link and system admin shares it with clinic owner

#### Step 2: Clinic Admin Signup

1. **Access Signup Link**
   - Clinic admin clicks the signup link provided by system admin
   - Visits `/signup/clinic?token={secure_token}`

2. **Google OAuth Authentication**
   - Clinic admin clicks "Sign up with Google"
   - Redirects to Google OAuth flow
   - System validates the signup token

3. **Account Creation & Redirect**
   - Google provides user info (email, name)
   - System validates signup token and extracts `default_roles = ['admin', 'practitioner']`
   - System creates clinic admin user with roles from signup token
   - **Automatic redirect to `/dashboard`** (clinic admin dashboard)

#### Step 3: Team Member Invitations (Optional)

1. **Clinic Admin Invites Team Members**
   - Clinic admin navigates to "Members" section → "Invite Member"
   - System generates secure signup link (with specified roles)
   - Admin shares link with new team member

2. **Team Member Onboarding**
   - New member clicks link → visits `/signup/member?token={token}`
   - Completes Google OAuth → gains roles specified in invitation token
   - Clinic admin can later adjust member roles via checkboxes if needed

3. **Role Management**
   - All team members appear in unified member list
   - Admin can toggle admin/practitioner roles as needed
   - Supports flexible team structures (admin-only, practitioner-only, or both)

### Clinic Dashboard Features

After login, clinic admins, system admins, and practitioners access the clinic management interface, with role-based permissions:

#### **For Clinic Admins (Full Access):**
- **Complete administrative control** over their clinic
- All features listed below with full read/write permissions

#### **For System Admins (Full Access + System-wide):**
- **All clinic admin permissions** for any clinic they access
- **System-wide management** capabilities
- **Cross-clinic analytics** and reporting
- **Billing and subscription management**
- **All features listed below** with full read/write permissions across all clinics

#### **For Practitioners (Read Access):**
- **Read-only access** to all clinic data for coordination
- **Read/write access** to their own profile and information
- All features listed below with appropriate restrictions

#### **Member Management** (Clinic Admins Only)
- **View all active clinic members** with their current roles
- **Invite new team members** via secure signup links (choose roles during invitation)
- **Manage member roles** with checkboxes:
  - **Admin Access**: Grants full clinic management permissions
  - **Practitioner Role**: Allows scheduling appointments and calendar integration
- **Manage your own roles** (admins can adjust their own admin/practitioner status)
- **Remove members** from the clinic (with confirmation)

**Role Behavior:**
- **Admin + Practitioner**: Full management + can be scheduled for appointments
- **Admin Only**: Management access only (no appointments)
- **Practitioner Only**: Can be scheduled + read clinic data (default for new invites)
- **Neither Role**: Read-only access to clinic data

**Default Role Assignment:**
- **Clinic admin signup**: Both admin and practitioner roles
- **Team member invites**: Roles specified during invitation (typically practitioner only)

**Member Management UI Example:**
```
Clinic Members

┌─────────────────────────────────────────────────────────────┐
│ Name          │ Email              │ Admin │ Practitioner │
├─────────────────────────────────────────────────────────────┤
│ Dr. Chen      │ chen@clinic.com    │ ✅    │ ✅           │ ← Admin + Practitioner
│ Nurse Wang    │ wang@clinic.com    │ ☐    │ ✅           │ ← Practitioner only
│ Admin Zhang   │ zhang@clinic.com   │ ✅    │ ☐           │ ← Admin only
│ Receptionist  │ front@clinic.com   │ ☐    │ ☐           │ ← Read-only access
└─────────────────────────────────────────────────────────────┘

[Invite Team Member]
```

**Role Toggle Behavior:**
- **Admin checkbox**: Grants/revokes full clinic management permissions
- **Practitioner checkbox**: Enables/disables appointment scheduling and calendar sync
- **At least one admin required**: System prevents removing admin access from last admin
- **Self-management**: Admins can modify their own roles directly from the member list

#### **Clinic Configuration**
- Define appointment types (e.g., "初診評估", "一般複診", "徒手治療") *[Clinic Admins Only]*
- Set service durations *[Clinic Admins Only]*
- Configure operating hours and holidays *[Clinic Admins Only]*
- **View clinic settings** *[Practitioners: Read-only access]*

#### **Appointment Management**
- View integrated appointment calendar
- Handle patient bookings and rescheduling
- Monitor appointment status and no-shows

#### **Patient Management**
- View all auto-registered patients
- See LINE account link status for each patient
- Edit patient information (name, phone number)
- Manually resolve duplicate phone number issues
- View patient appointment history
- Merge duplicate patient records (if needed)

### Member Invitation Flow

**Clinic admins invite team members through secure signup links:**

1. **Clinic Admin Initiates Invitation**
   - Clinic admin clicks "Invite Team Member" button
   - Clinic admin selects roles for new member (e.g., practitioner only, or admin + practitioner)
   - System generates secure signup token (no database record created yet)
   - System creates signup link: `/signup/member?token={token}`
   - Clinic admin manually shares the link with team member (email, chat, etc.)

2. **Team Member Signup Process**
   - Team member clicks signup link from clinic admin
   - System validates token and extracts `default_roles` from signup token
   - Team member chooses their Google account during OAuth (grants calendar permissions)
   - System creates active user record with roles from `default_roles` upon successful OAuth
   - User gains immediate access to dashboard with appropriate permissions

**Clean Implementation:**
- **No placeholder records** - users are created only upon successful signup
- **Simple state management** - all users are active immediately
- **Automatic cleanup** - expired tokens don't leave database artifacts

3. **Dashboard & Calendar Integration**
   - Practitioner gains read access to all clinic data (patients, appointments, settings)
   - Practitioner can edit their own profile and information
   - Appointments automatically sync to practitioner's Google Calendar
   - Practitioner can view/edit appointments in their calendar

**Practitioner Dashboard Capabilities:**
- **Patient Management**: View all patients, appointment history, contact info (read-only)
- **Appointment Calendar**: Integrated calendar view with ability to view/edit own appointments
- **Clinic Settings**: View appointment types, operating hours, clinic policies (read-only)
- **Profile Management**: Edit own name, contact preferences, calendar settings
- **Team Coordination**: View other practitioners' schedules for coordination
- **Reporting**: View personal appointment statistics and clinic metrics

**Key Distinction:**
- **Clinic Admins**: Full administrative control over clinic operations
- **Practitioners**: Read access to all clinic data + write access to own profile + calendar integration

### When to Create Practitioners vs Assign Multiple Roles

**Create Separate Practitioner Account:**
- When hiring external healthcare providers (doctors, therapists, dentists, etc.)
- When team members need their own calendar integration
- When providers need read-only access to clinic data for coordination

**When to Assign Multiple Roles:**
- Clinic owners who both manage AND provide healthcare services
- Administrators who occasionally see patients
- Single-person clinics where one person handles both management and care

### Email Handling in Onboarding Flows

**No Email Pre-specification Required:**
- **System Admin → Clinic Admin**: System admin creates clinic record without specifying admin email
- **Clinic Admin → Practitioner**: Admin generates generic signup link, no name or email needed
- **Generic Signup Links**: All signup links are generic and not tied to specific email addresses
- **User Choice**: Users choose their preferred Google account during OAuth flow
- **Email & Name Capture**: System captures email and name from Google OAuth, allows updates later

**Benefits:**
- **Flexibility**: Users can choose work or personal Google accounts
- **No Coordination**: No need to coordinate email addresses or names beforehand
- **No Typos**: Google OAuth ensures email is verified and correct
- **Simplified Flow**: No email validation, name entry, or confirmation steps needed
- **Auto-Population**: Name and email automatically populated from Google account

## Technical Implementation Details

### Core Architecture

#### System Admin Authentication
- **Email Whitelist**: `SYSTEM_ADMIN_EMAILS` environment variable
- **Unified Login**: Same `/login` page as all users with automatic role detection
- **Access Control**: Full platform access + all clinic admin permissions

#### JWT Token Architecture
- **Access Tokens**: 1-hour expiry, stored in memory
- **Refresh Tokens**: 7-day expiry, stored in httpOnly cookies
- **Automatic Refresh**: Proactive token renewal before expiry
- **Role-Based Claims**: Include user roles, clinic_id, permissions

### Backend API Endpoints

#### System Admin Endpoints
- `POST /api/system/clinics` - Create clinic with LINE credentials
- `GET /api/system/clinics` - List all clinics
- `GET /api/system/clinics/{clinic_id}` - Get clinic details
- `PUT /api/system/clinics/{clinic_id}` - Update clinic settings
- `POST /api/system/clinics/{clinic_id}/signup-link` - Generate new clinic admin signup link
- `GET /api/system/metrics` - System-wide metrics and statistics

#### Authentication Endpoints (Public)
- `GET /api/auth/google/login` - Initiate Google OAuth login
- `GET /api/auth/google/callback` - Handle OAuth callback (all user types)
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout current user

#### Signup Endpoints (Public)
- `GET /api/signup/clinic?token={token}` - Initiate clinic admin OAuth signup (first admin for new clinic)
- `GET /api/signup/member?token={token}` - Initiate team member OAuth signup (any role)
- `GET /api/signup/callback` - Handle signup OAuth callback (all signup types)

#### Member Management Endpoints (Clinic Admins Only)
- `GET /api/clinic/members` - List all clinic members with their roles
- `POST /api/clinic/members/invite` - Generate invitation link for new member
- `PUT /api/clinic/members/{user_id}/roles` - Update member roles (admin/practitioner checkboxes)
- `DELETE /api/clinic/members/{user_id}` - Remove member from clinic
- `GET /api/clinic/members/{user_id}/gcal/auth` - Initiate member Google Calendar OAuth
- `GET /api/clinic/members/{user_id}/gcal/callback` - Handle member calendar OAuth callback

#### User Profile Endpoints (All Authenticated Users)
- `GET /api/profile` - Get current user's profile information
- `PUT /api/profile` - Update current user's profile (name, contact preferences)
- `GET /api/clinic/members/{user_id}` - View member details *[Clinic Admins & Self Only]*

### API Request/Response Schemas

#### POST /api/system/clinics
**Request:**
```json
{
  "name": "Dr. Chen's Physical Therapy Clinic",
  "line_channel_id": "1234567890",
  "line_channel_secret": "abc123...",
  "line_channel_access_token": "xyz789..."
}
```

**Response:**
```json
{
  "id": 1,
  "name": "Dr. Chen's Physical Therapy Clinic",
  "subscription_status": "trial",
  "trial_ends_at": "2025-11-22T00:00:00Z",
  "created_at": "2025-10-22T10:30:00Z"
}
```

#### POST /api/system/clinics/{clinic_id}/signup-link
**Request:** None (generates new link)

**Response:**
```json
{
  "signup_url": "https://your-domain.com/signup/clinic?token=abc123...",
  "expires_at": "2025-10-24T10:30:00Z",
  "token_id": 1
}
```

#### POST /api/clinic/members/invite
**Request:**
```json
{
  "default_roles": ["practitioner"]
  // or: ["admin", "practitioner"]
}
```

**Response:**
```json
{
  "signup_url": "https://your-domain.com/signup/member?token=xyz789...",
  "expires_at": "2025-10-24T10:30:00Z",
  "token_id": 5
}
```

#### PUT /api/clinic/members/{user_id}/roles
**Request:**
```json
{
  "roles": ["admin", "practitioner"]
  // Valid combinations: ["admin"], ["practitioner"], ["admin", "practitioner"], []
}
```

**Response:**
```json
{
  "id": 3,
  "email": "member@clinic.com",
  "full_name": "Dr. Wang",
  "roles": ["admin", "practitioner"],
  "updated_at": "2025-10-22T11:00:00Z"
}
```

#### GET /api/clinic/members
**Response:**
```json
{
  "members": [
    {
      "id": 1,
      "email": "admin@clinic.com",
      "full_name": "Dr. Chen",
      "roles": ["admin", "practitioner"],
      "gcal_sync_enabled": true,
      "is_active": true,
      "created_at": "2025-10-01T10:00:00Z"
    },
    {
      "id": 2,
      "email": "nurse@clinic.com",
      "full_name": "Nurse Wang",
      "roles": ["practitioner"],
      "gcal_sync_enabled": false,
      "is_active": true,
      "created_at": "2025-10-15T14:30:00Z"
    }
  ]
}
```

#### PUT /api/profile
**Request:**
```json
{
  "full_name": "Dr. Chen Yi-Wei",
  "preferences": {
    "language": "zh-TW",
    "notifications_enabled": true
  }
}
```

**Response:**
```json
{
  "id": 1,
  "email": "chen@clinic.com",
  "full_name": "Dr. Chen Yi-Wei",
  "roles": ["admin", "practitioner"],
  "updated_at": "2025-10-22T11:30:00Z"
}
```

#### POST /api/auth/refresh
**Request:** None (uses httpOnly cookie)

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600,
  "expires_at": 1698000000
}
```

### Database Schema

#### Clinic Table
```sql
CREATE TABLE clinics (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  line_channel_id VARCHAR(255) UNIQUE NOT NULL,
  line_channel_secret VARCHAR(255) NOT NULL,
  line_channel_access_token VARCHAR(255) NOT NULL,
  subscription_status VARCHAR(50) DEFAULT 'trial',
  trial_ends_at TIMESTAMPTZ,
  stripe_customer_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clinics_subscription_status ON clinics(subscription_status);
```

#### Users Table (Unified for All Clinic Personnel)
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  -- Authentication (all users)
  email VARCHAR(255) UNIQUE NOT NULL,
  google_subject_id VARCHAR(255) UNIQUE NOT NULL, -- Stable unique ID from Google
  full_name VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE NOT NULL,  -- Soft delete: false = user removed but data preserved
  roles JSONB NOT NULL,  -- Array of roles: ['admin'], ['practitioner'], or ['admin', 'practitioner']

  -- Practitioner-specific fields (nullable, only for users with 'practitioner' role)
  gcal_credentials TEXT,  -- Encrypted Google Calendar OAuth credentials (JSON)
  gcal_sync_enabled BOOLEAN DEFAULT FALSE,
  gcal_watch_resource_id VARCHAR(255),  -- Google Calendar watch resource ID

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_users_clinic_id ON users(clinic_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_google_subject_id ON users(google_subject_id);
CREATE INDEX idx_users_is_active ON users(is_active);

-- Users belong to exactly one clinic (enforced by NOT NULL on clinic_id)
-- Email is globally unique (prevents same person from working at multiple clinics)
```

#### Signup Tokens Table
```sql
CREATE TABLE signup_tokens (
  id SERIAL PRIMARY KEY,
  token VARCHAR(255) UNIQUE NOT NULL,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  default_roles JSONB NOT NULL, -- Default roles for new user: ['admin', 'practitioner'] or ['practitioner']
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_email VARCHAR(255),  -- Email of user who used this token (audit trail)
  is_revoked BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- token column is UNIQUE, so it has an automatic index
-- Partial index for fast validation of active (unused, non-revoked, non-expired) tokens
CREATE INDEX idx_signup_tokens_active ON signup_tokens(expires_at) 
  WHERE used_at IS NULL AND is_revoked = FALSE;
CREATE INDEX idx_signup_tokens_clinic_id ON signup_tokens(clinic_id);
```

#### Refresh Tokens Table (for Session Management)
```sql
CREATE TABLE refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE NOT NULL, -- bcrypt hashed for security
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked BOOLEAN DEFAULT FALSE NOT NULL
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
```

#### Database Triggers for Auto-Update

**Trigger Function for `updated_at` Auto-Update:**
```sql
-- Create trigger function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to clinics table
CREATE TRIGGER update_clinics_updated_at
    BEFORE UPDATE ON clinics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to users table
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

**Note:** These triggers ensure `updated_at` is automatically set to current timestamp whenever a row is updated, without requiring application code to manage it.

### Google OAuth Scopes

All clinic users (admins and practitioners) need calendar access since they handle appointments:

#### All Clinic Users (Admin + Practitioner) Scopes
```python
CLINIC_USER_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.events",  # Read/write calendar events
    "https://www.googleapis.com/auth/calendar.settings.readonly"  # Read timezone settings
]
```

**Note:** Both clinic admins and practitioners get the same OAuth scopes since both need to interact with Google Calendar for appointment management.

### Encryption Strategy

#### Google Calendar Credentials Encryption

Google Calendar OAuth credentials are sensitive and must be encrypted before storage:

**Implementation:**
```python
from cryptography.fernet import Fernet
import json
import base64
from core.config import ENCRYPTION_KEY  # 32-byte key from environment

def encrypt_gcal_credentials(credentials: dict) -> str:
    """Encrypt Google Calendar credentials for database storage."""
    fernet = Fernet(base64.urlsafe_b64encode(ENCRYPTION_KEY.encode().ljust(32)[:32]))
    credentials_json = json.dumps(credentials)
    encrypted = fernet.encrypt(credentials_json.encode())
    return encrypted.decode()

def decrypt_gcal_credentials(encrypted_credentials: str) -> dict:
    """Decrypt Google Calendar credentials from database."""
    fernet = Fernet(base64.urlsafe_b64encode(ENCRYPTION_KEY.encode().ljust(32)[:32]))
    decrypted = fernet.decrypt(encrypted_credentials.encode())
    return json.loads(decrypted.decode())
```

**Environment Configuration:**
```bash
# .env file
# Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
ENCRYPTION_KEY="base64-encoded-32-byte-key-here"  # Example: "A7x9K2mP8qL4nR6tB3jD5sF1gH9wE0vY2uC8zM4xN6o="
```

**Security Notes:**
- Use Fernet (symmetric encryption) for simplicity and security
- Store encryption key in environment variables (not in code)
- Rotate encryption keys periodically (requires re-encrypting all credentials)
- Never log or expose encrypted/decrypted credentials

### Security Considerations

1. **Signup Token Security**
   - Generate cryptographically secure tokens using `secrets.token_urlsafe(32)` or UUID4
   - Include expiration (24-48 hours recommended)
   - One-time use tokens (marked as used after successful signup)
   - Store in database with clinic_id association
   - Support revocation for security incidents

2. **System Admin Authentication**
   - System admin emails configured in environment variables
   - `SYSTEM_ADMIN_EMAILS=admin1@company.com,admin2@company.com`
   - Separate from clinic admin authentication
   - **Trade-off**: Requires redeployment to add/remove system admins (acceptable for MVP)
   - No database records needed - permissions determined by email whitelist

3. **Session Management**
   - JWT access tokens (short-lived, 1 hour expiry)
   - Refresh tokens (long-lived, 7 days, stored in httpOnly cookies)
   - Access tokens stored in memory only (XSS protection)
   - CSRF protection via SameSite=Strict cookies
   - Token revocation support via refresh token database

4. **Clinic Isolation**
   - Clinic admins can only access their assigned clinic
   - System admins can access all clinics
   - **Code-level enforcement**: Every API endpoint MUST validate clinic_id
   - Row-level security via dependency injection pattern
   - Foreign key relationships provide database-level constraints

### User Experience Summary

#### System Admin Workflow
1. Configure environment variables for admin emails
2. Visit `/login` → automatic role detection → access `/system/dashboard`
3. Manage clinics, monitor system metrics, handle support requests

#### Clinic Admin Workflow
1. Receive system admin invitation → OAuth signup → get admin + practitioner roles
2. Access clinic dashboard for full management capabilities
3. Invite team members, manage appointments, configure settings
4. Optional: Adjust personal roles if not providing healthcare services

#### Practitioner Workflow
1. Receive clinic admin invitation → OAuth signup → get practitioner access
2. Access clinic dashboard with read permissions + calendar integration
3. View patient data, manage personal appointments, coordinate with team

### Authentication & Authorization Implementation

#### JWT Token Structure

**Access Token Payload** (1 hour expiry):
```python
{
    "sub": "google_subject_id_12345",
    "email": "user@example.com",
    "user_type": "clinic_user",  # "clinic_user" or "system_admin"
    "roles": ["admin", "practitioner"],  # Array of roles for clinic users (matches database)
    "clinic_id": 123,  # null for system admins
    "name": "User Name",
    "iat": 1234567890,
    "exp": 1234571490  # 1 hour from iat
}
```

**Token Fields Explained:**
- `user_type`: Distinguishes between system admins and clinic users
- `roles`: Array of roles for clinic users (`["admin"]`, `["practitioner"]`, or `["admin", "practitioner"]`)
- `clinic_id`: The clinic the user belongs to (null for system admins)

**Examples:**
```python
# System Admin
{
    "sub": "google_subject_id_12345",
    "user_type": "system_admin",
    "roles": [],  # System admins don't have clinic-specific roles
    "clinic_id": null,
    ...
}

# Clinic Admin + Practitioner
{
    "sub": "google_subject_id_67890",
    "user_type": "clinic_user",
    "roles": ["admin", "practitioner"],
    "clinic_id": 123,
    ...
}

# Practitioner Only
{
    "sub": "google_subject_id_11111",
    "user_type": "clinic_user",
    "roles": ["practitioner"],
    "clinic_id": 123,
    ...
}

# Read-Only Member
{
    "sub": "google_subject_id_22222",
    "user_type": "clinic_user",
    "roles": [],  # No admin or practitioner role = read-only
    "clinic_id": 123,
    ...
}
```

#### Token Validation Logic

**Signup Token Validation**:
```python
def validate_signup_token(token: str, db: Session) -> SignupToken:
    """Validate signup token and return token data."""
    result = db.query(SignupToken).filter(
        SignupToken.token == token,
        SignupToken.expires_at > datetime.utcnow(),
        SignupToken.is_revoked == False,
        SignupToken.used_at == None  # One-time use
    ).first()
    
    if not result:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "signup_token_invalid",
                "message": "這個註冊連結已失效，請聯繫管理員取得新的連結"
            }
        )
    
    return result

def mark_token_used(token: SignupToken, email: str, db: Session):
    """Mark token as used after successful signup."""
    token.used_at = datetime.utcnow()
    token.used_by_email = email
    db.commit()
```

#### Authorization Middleware

**Dependency injection for role-based access control**:

```python
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer
from typing import List

security = HTTPBearer()

class UserContext:
    """User context extracted from JWT token."""
    def __init__(self, user_type: str, email: str, roles: List[str], 
                 clinic_id: int | None, google_subject_id: str, name: str):
        self.user_type = user_type  # "system_admin" or "clinic_user"
        self.email = email
        self.roles = roles  # List of roles: ["admin"], ["practitioner"], etc.
        self.clinic_id = clinic_id
        self.google_subject_id = google_subject_id
        self.name = name
    
    def is_system_admin(self) -> bool:
        return self.user_type == "system_admin"
    
    def has_role(self, role: str) -> bool:
        return role in self.roles or self.is_system_admin()

def get_current_user(token: HTTPAuthorizationCredentials = Depends(security)) -> UserContext:
    """Validates JWT and returns user context."""
    try:
        payload = jwt.decode(token.credentials, SECRET_KEY, algorithms=["HS256"])
        return UserContext(
            user_type=payload["user_type"],
            email=payload["email"],
            roles=payload.get("roles", []),
            clinic_id=payload.get("clinic_id"),
            google_subject_id=payload["sub"],
            name=payload.get("name", "")
        )
    except JWTError:
        raise HTTPException(401, "Invalid authentication credentials")

def require_system_admin(user: UserContext = Depends(get_current_user)) -> UserContext:
    """Restricts endpoint to system admins only."""
    if not user.is_system_admin():
        raise HTTPException(403, "System admin access required")
    return user

def require_admin_role(user: UserContext = Depends(get_current_user)) -> UserContext:
    """Requires user to have admin role (or be system admin)."""
    if not user.has_role("admin"):
        raise HTTPException(403, "Admin access required")
    return user

def require_practitioner_role(user: UserContext = Depends(get_current_user)) -> UserContext:
    """Requires user to have practitioner role (or be system admin)."""
    if not user.has_role("practitioner"):
        raise HTTPException(403, "Practitioner access required")
    return user

# Example usage:
@app.get("/api/system/clinics")
def list_clinics(user: UserContext = Depends(require_system_admin), db: Session = Depends(get_db)):
    """Only system admins can access this endpoint."""
    return db.query(Clinic).all()

@app.get("/api/clinic/members")
def list_members(user: UserContext = Depends(require_admin_role), db: Session = Depends(get_db)):
    """Only users with admin role can access this endpoint, limited to their clinic."""
    return db.query(User).filter(
        User.clinic_id == user.clinic_id,  # ✅ Enforces clinic isolation
        User.is_active == True
    ).all()

@app.put("/api/clinic/members/{user_id}/roles")
def update_member_roles(
    user_id: int,
    roles: List[str],
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """Update member roles - admin access required."""
    member = db.query(User).filter(
        User.id == user_id,
        User.clinic_id == current_user.clinic_id  # ✅ Enforces clinic isolation
    ).first()
    
    if not member:
        raise HTTPException(404, "Member not found")
    
    # Prevent removing last admin
    if "admin" not in roles:
        admin_count = db.query(User).filter(
            User.clinic_id == current_user.clinic_id,
            User.roles.contains(["admin"]),
            User.is_active == True,
            User.id != user_id
        ).count()
        
        if admin_count == 0:
            raise HTTPException(400, "Cannot remove last admin from clinic")
    
    member.roles = roles
    db.commit()
    return member

@app.get("/api/clinic/members/{user_id}/gcal/auth")
def initiate_calendar_auth(
    user_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """Initiate Google Calendar OAuth for a member - admin access required."""
    # Verify member belongs to same clinic
    member = db.query(User).filter(
        User.id == user_id,
        User.clinic_id == current_user.clinic_id  # ✅ Enforces clinic isolation
    ).first()
    
    if not member:
        raise HTTPException(404, "Member not found")
    
    # Generate OAuth URL...
    auth_url = oauth_service.get_authorization_url(user_id, current_user.clinic_id)
    return {"auth_url": auth_url}
```

**Key Authorization Patterns:**
1. **System Admin Check**: Use `require_system_admin()` for system-only endpoints
2. **Role Check**: Use `require_admin_role()` or `require_practitioner_role()` for role-specific access
3. **Clinic Isolation**: Always filter by `clinic_id` when accessing clinic data
4. **Self-Access**: Allow users to access their own data even without admin role

#### Frontend Token Management

```typescript
// Store access token in memory only (XSS protection)
let accessToken: string | null = null;
let tokenExpiry: number | null = null;

// Refresh token stored in httpOnly cookie (backend sets it)
// Frontend cannot access it directly

function shouldRefreshToken(): boolean {
  if (!tokenExpiry) return false;
  const now = Date.now() / 1000;
  const timeToExpiry = tokenExpiry - now;
  return timeToExpiry < 300; // Refresh if < 5 minutes left
}

async function ensureValidToken(): Promise<string> {
  if (!accessToken || shouldRefreshToken()) {
    return await refreshAccessToken();
  }
  return accessToken;
}

async function refreshAccessToken(): Promise<string> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include'  // Send httpOnly cookie
  });

  if (!response.ok) {
    // Handle refresh failure - redirect to login
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiry = data.expiry; // Backend should include token expiry time
  return accessToken;
}

// Proactive refresh - check every minute
setInterval(() => {
  if (accessToken && shouldRefreshToken()) {
    refreshAccessToken().catch(() => {
      // Silent failure - user will be redirected on next API call
    });
  }
}, 60 * 1000);  // Check every minute

// Use ensureValidToken() before all API calls
async function apiCall(endpoint: string, options: RequestInit = {}) {
  const token = await ensureValidToken();
  return fetch(endpoint, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    }
  });
}
```

#### Session Cookie Configuration

```python
# Backend sets refresh token as httpOnly cookie
response.set_cookie(
    key="refresh_token",
    value=refresh_token,
    httponly=True,      # Cannot be accessed by JavaScript
    secure=True,        # HTTPS only in production
    samesite="strict",  # CSRF protection
    max_age=7 * 24 * 60 * 60  # 7 days
)
```

### System Admin Dashboard Features

The system admin dashboard provides system-wide management and monitoring:

#### **Clinic Management**
- List all clinics with status indicators
- Create new clinic records with LINE credentials
- Update clinic subscription status
- View clinic details and statistics
- Generate clinic admin signup links
- Regenerate expired signup links

#### **LINE Integration Monitoring**
- Webhook health status for each clinic
- Last message received timestamp
- Message volume metrics
- LINE API connection validation
- Webhook configuration verification

#### **System Metrics**
- Total clinics (active vs trial)
- Platform-wide user counts (patients, therapists, admins)
- Appointment statistics (total, recent trends)
- Subscription revenue overview
- Trial expiration alerts

#### **Support Tools**
- Access clinic admin dashboard (impersonation for support)
- Manual intervention for LINE integration issues
- Export system analytics
- Regenerate expired signup links

### Multi-Admin Policy

**Current Support:**
- **Multiple admins per clinic** - Clinics can have unlimited admin users
- **Admin invitation system** - Existing clinic admins can invite additional admins
- **Equal permissions** - All clinic admins have identical full access to clinic management
- **Secure onboarding** - Admin invitations use token-based secure links

**Rationale:**
- Supports growing clinics with multiple managers
- Enables proper delegation of administrative responsibilities
- Maintains security through invitation-only access
- Scalable for clinics of any size

**Member Invitation Flow:**
1. **Clinic Admin** → Navigate to "Members" section → "Invite Team Member"
2. **Admin selects roles** for new member (e.g., ['practitioner'] or ['admin', 'practitioner'])
3. **System generates** secure signup link with specified roles
4. **Admin shares** link with new member (email, chat, etc.)
5. **New Member** → Clicks link → OAuth signup → Gains specified roles
6. **Admin can adjust** member roles via checkboxes if needed
7. **All admins** have equal permissions and can manage clinic together

**Security Considerations:**
- Invitation links expire after 48 hours
- Links are single-use and cannot be reused
- System admins can revoke admin access if needed
- At least one admin must remain per clinic (enforced by system)

### Member Signup Link Management

**Invitation Generation:**
```python
from pydantic import BaseModel
from typing import List

class MemberInviteRequest(BaseModel):
    default_roles: List[str]  # e.g., ["practitioner"] or ["admin", "practitioner"]

@router.post("/api/clinic/members/invite")
def invite_member(
    data: MemberInviteRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """Generate invitation link for new member (no user record created yet)."""
    
    # Validate roles
    valid_roles = {"admin", "practitioner"}
    if not all(role in valid_roles for role in data.default_roles):
        raise HTTPException(400, "Invalid role specified")

    # Generate signup token (stored in signup_tokens table)
    token = generate_signup_token(
        clinic_id=current_user.clinic_id,
        default_roles=data.default_roles,
        expires_hours=48,
        db=db
    )

    # Create invitation link (no database record for user yet)
    signup_url = f"{FRONTEND_URL}/signup/member?token={token.token}"

    return {
        "signup_url": signup_url,
        "expires_at": token.expires_at,
        "token_id": token.id
    }

def generate_signup_token(clinic_id: int, default_roles: List[str], expires_hours: int, db: Session) -> SignupToken:
    """Generate a secure signup token."""
    token = SignupToken(
        token=secrets.token_urlsafe(32),
        clinic_id=clinic_id,
        default_roles=default_roles,  # Stored as JSONB
        expires_at=datetime.utcnow() + timedelta(hours=expires_hours)
    )
    db.add(token)
    db.commit()
    db.refresh(token)
    return token
```


### Team Member Post-OAuth Experience

After a team member completes Google OAuth and grants calendar access:

1. **OAuth Callback Completion**
   - Backend receives OAuth code
   - Exchanges code for calendar access credentials and user info
   - Stores encrypted credentials in `users.gcal_credentials`
   - Updates `users.email` and `users.full_name` with Google account info
   - Sets `users.gcal_sync_enabled = True`

2. **Redirect to Success Page**
   - URL: `/practitioner/setup-complete`
   - Page displays:
     ```
     ✅ 行事曆同步已啟用
     
     您的 Google 日曆已成功連結！
     
     📅 接下來會發生什麼：
     - 新的預約將自動出現在您的 Google 日曆中
     - 您可以在日曆中查看預約詳情
     - 請勿手動刪除機器人建立的預約事件
     
     如有問題，請聯繫診所管理員。
     
     [關閉視窗]
     ```

3. **Auto-Close Option**
   - Page auto-closes after 10 seconds
   - Or user clicks "關閉視窗" button
   - Practitioner can now manage schedule through Google Calendar

4. **Verification**
   - Clinic admin sees "✅ 已連結" status in practitioner list
   - Test appointment created to verify sync
   - Practitioner receives test event in calendar

### Error Handling

**Key Error Scenarios:**
1. **Expired Signup Links**: User-friendly message with admin contact info
2. **Duplicate Emails**: Prevents same email across multiple clinics
3. **LINE Connection Issues**: Graceful handling with troubleshooting guidance
4. **Invalid Tokens**: Clear messaging for revoked/used links
5. **Trial Expiration**: Upgrade prompts with clear next steps
6. **Permission Denied**: Role-based access control with helpful guidance
7. **OAuth Failures**: Retry options for calendar permission issues

**Error Response Format:**
```json
{
  "error": "error_code",
  "message": "User-friendly message in Chinese",
  "action": "suggested_action",
  "help_text": "Additional context"
}
```

### Error Recovery Flows

#### 1. Expired Signup Link Recovery

**Scenario:** User clicks signup link but token has expired

**User Flow:**
1. User clicks signup link → sees error: "註冊連結已過期"
2. Error page displays:
   - Clear explanation: "此連結已在 48 小時後過期"
   - Actionable step: "請聯繫您的診所管理員以取得新的連結"
   - Contact info: Displays clinic admin email (if available)
3. User contacts clinic admin
4. Admin regenerates new signup link via dashboard
5. User receives new link and completes signup

**Admin Action:**
- Navigate to Members → Click "Invite Team Member" again to generate fresh link
- Share new link with user

#### 2. OAuth Failure Recovery

**Scenario:** Google OAuth fails during signup (network issue, user denies permissions, etc.)

**User Flow:**
1. User clicks signup link → redirected to Google OAuth
2. OAuth fails (user denies calendar permissions, or network error)
3. User redirected back to error page with message:
   - "授權失敗 - 請確認您已允許行事曆存取權限"
   - "Retry" button to restart OAuth flow
4. User clicks "Retry" → restarts OAuth with same signup token
5. On success → account created and redirected to dashboard

**Technical Implementation:**
- Signup token remains valid until used successfully
- Multiple OAuth attempts allowed with same token
- Token only marked as "used" after successful account creation

#### 3. Duplicate Email Error Recovery

**Scenario:** User tries to sign up but email already exists

**User Flow:**
1. User completes OAuth with email that's already registered
2. Error page displays:
   - "此 Google 帳號已經註冊過了"
   - "如果您忘記登入方式，請直接前往登入頁面"
   - Button: "前往登入" → redirects to `/login`
3. User clicks login → completes OAuth → auto-redirected to their clinic dashboard

**Alternative:** If user genuinely needs a new account:
- User contacts clinic admin
- Admin removes old account (if appropriate)
- User retries with fresh signup link

#### 4. LINE Integration Connection Failure Recovery

**Scenario:** LINE webhook stops working or credentials become invalid

**System Admin Flow:**
1. System admin notices webhook failures in dashboard (or clinic reports issue)
2. Navigate to System Dashboard → Clinics → Select affected clinic
3. View LINE integration status: "連線失敗 - 請檢查憑證"
4. Click "Troubleshoot" button → shows diagnostic info:
   - Last successful webhook: timestamp
   - Recent error messages from LINE API
   - Webhook configuration status
5. System admin options:
   - **Update credentials:** Re-enter `channel_access_token` and `channel_secret`
   - **Test connection:** Send test message to verify configuration
   - **View LINE Developer Console link:** Direct link to LINE dashboard
6. After updating → click "Test Connection" → success message
7. Clinic operations resume normally

**Clinic Admin View:**
- Sees banner: "LINE 連線異常，請聯繫系統管理員"
- Cannot resolve independently (no access to LINE credentials)
- Must contact system admin for resolution

#### 5. Practitioner Calendar Disconnect Recovery

**Scenario:** Practitioner wants to disconnect or reconnect Google Calendar

**Practitioner Flow (Disconnect):**
1. Navigate to Profile → Calendar Settings
2. Click "中斷 Google 日曆連結"
3. Confirmation dialog: "確定要中斷連結嗎？未來的預約將不會同步到您的日曆"
4. Click "確認" → `gcal_sync_enabled` set to `false`
5. Existing calendar events remain (not deleted)
6. Future appointments won't sync until reconnected

**Practitioner Flow (Reconnect):**
1. Navigate to Profile → Calendar Settings
2. Click "重新連結 Google 日曆"
3. Redirected to Google OAuth flow
4. Grant calendar permissions
5. Redirected back → success message
6. System syncs all future appointments to calendar

**Clinic Admin Action (if practitioner needs help):**
1. Navigate to Members → Select practitioner
2. Click "Reset Calendar Connection"
3. Generate new calendar auth link → send to practitioner
4. Practitioner clicks link → completes OAuth → reconnected

#### 6. Lost Access / Forgotten Login Recovery

**Scenario:** User forgot how to access the system

**User Flow:**
1. User visits `/login`
2. Clicks "Sign in with Google"
3. Chooses Google account
4. System checks:
   - **If system admin email:** Redirect to `/system/dashboard`
   - **If associated with clinic:** Redirect to `/dashboard`
   - **If not found:** Show error "無法找到您的帳號，請聯繫管理員"
5. If error → contact clinic admin or system admin

**No password reset needed:** OAuth handles authentication, no passwords to forget


## Summary

**Complete authentication system with:**
- **Unified user management** with flexible role assignments
- **JWT-based sessions** with automatic token refresh
- **Invitation-only signup** with secure token validation
- **Multi-admin clinics** with equal permissions
- **Google OAuth integration** with calendar access
- **Role-based access control** with clinic data isolation

**Key Security Features:**
- System admin email whitelisting
- httpOnly refresh cookies
- Secure token-based invitations
- Encrypted Google Calendar credentials storage
- Role-based access control with clinic isolation


---



---
## Code Implementation Changes

### Current Codebase Discrepancies

**Status**: Major refactoring required to align with specification

### 1. Database Schema Changes (CRITICAL)

**Current State:**
- Separate `clinic_admins` and `therapists` tables
- No `signup_tokens` or `refresh_tokens` tables
- No auto-update triggers
- Appointments reference `therapists.id`

**Required Changes:**
- **Unify user models**: Replace separate tables with single `users` table
- **Add signup_tokens table**: For invitation management
- **Add refresh_tokens table**: For JWT session management
- **Add database triggers**: Auto-update `updated_at` timestamps
- **Update appointments table**: Change `therapist_id` → `practitioner_id` foreign key

**Files to Create:**
- `/backend/src/models/user.py` (replaces clinic_admin.py, therapist.py)
- `/backend/src/models/signup_token.py`
- `/backend/src/models/refresh_token.py`
- Database migration script

**Files to Delete:**
- `/backend/src/models/clinic_admin.py`
- `/backend/src/models/therapist.py`

### 2. Authentication & Authorization (CRITICAL)

**Current State:**
- Mock authentication with `get_current_admin()` returning hardcoded data
- No JWT token system
- No refresh token mechanism
- Basic Google OAuth for clinic admins only

**Required Changes:**
- **Implement JWT service**: Access tokens (1hr) + refresh tokens (7 days)
- **Create authorization middleware**: `UserContext` class with role checking
- **Implement encryption service**: Fernet encryption for Google Calendar credentials
- **Update OAuth service**: Support both system admin and clinic user flows

**Files to Create:**
- `/backend/src/services/jwt_service.py`
- `/backend/src/services/encryption_service.py`
- `/backend/src/auth/dependencies.py` (authorization middleware)

**Files to Update:**
- `/backend/src/services/google_oauth.py` (add calendar.settings.readonly scope)

### 3. API Structure Reorganization (HIGH)

**Current State:**
- All endpoints under `/api/admin/*`
- Single OAuth flow for clinic admins
- Mock authentication dependency

**Required Changes:**
- **Reorganize endpoints**:
  - `/api/auth/*` - Authentication (login, refresh, logout)
  - `/api/signup/*` - Signup flows (clinic admin, team member)
  - `/api/system/*` - System admin functions
  - `/api/clinic/*` - Clinic management (members, settings, appointments)

**Files to Create:**
- `/backend/src/api/auth.py` (authentication endpoints)
- `/backend/src/api/signup.py` (signup endpoints)
- `/backend/src/api/system.py` (system admin endpoints)
- `/backend/src/api/clinic.py` (clinic management endpoints)

**Files to Update:**
- `/backend/src/api/admin.py` (rename to clinic.py, update endpoints)

### 4. Configuration Updates (MEDIUM)

**Current State:**
- Missing JWT timing configurations
- No encryption key
- Basic OAuth scopes

**Required Changes:**
- **Add environment variables**:
  ```bash
  ENCRYPTION_KEY=base64-encoded-32-byte-fernet-key
  JWT_ALGORITHM=HS256
  JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
  JWT_REFRESH_TOKEN_EXPIRE_DAYS=7
  ```

**Files to Update:**
- `/backend/env.example` (add new variables)
- `/backend/src/core/config.py` (add configuration constants)
- `/backend/src/core/constants.py` (update GOOGLE_OAUTH_SCOPES to include calendar.settings.readonly)

### 5. Model Updates (HIGH)

**Current State:**
- Separate ClinicAdmin and Therapist models
- All queries reference these separate tables

**Required Changes:**
- **Update all model imports**: Replace `ClinicAdmin`, `Therapist` with `User`
- **Update all database queries**: Filter by roles instead of table joins
- **Update relationships**: Clinic.users instead of clinic.admins/therapists
- **Update foreign keys**: Appointments.practitioner_id instead of therapist_id

**Files to Update (estimated 15-20 files):**
- All files importing `ClinicAdmin` or `Therapist`
- All API endpoints using these models
- Appointment-related queries and relationships

### 6. Frontend Changes (HIGH)

**Current State:**
- Basic API client
- No token management
- No role-based routing

**Required Changes:**
- **Update API client**: Handle new endpoint structure and JWT tokens
- **Implement token management**: Store access tokens in memory, refresh tokens in httpOnly cookies
- **Add role-based routing**: System admin vs clinic user dashboards
- **Update authentication hooks**: Support multi-role users

**Files to Update:**
- `/frontend/src/services/api.ts`
- `/frontend/src/hooks/useAuth.tsx`
- Routing components
- Dashboard components

### Migration Strategy & Effort Estimate

**Total Estimated Effort**: 14-17 days

**Phase 1: Database & Core Services (Days 1-5)**
- Create new database schema and migration
- Implement JWT and encryption services
- Create authorization middleware

**Phase 2: API Reorganization (Days 6-9)**
- Create new API routers
- Update existing endpoints
- Implement role-based access control

**Phase 3: Model & Query Updates (Days 10-11)**
- Update all model imports and relationships
- Update database queries throughout codebase

**Phase 4: Frontend Integration (Days 12-14)**
- Update API client and authentication
- Implement token management
- Update routing and components

**Phase 5: Testing & Deployment (Days 15-17)**
- Unit and integration tests
- Security testing
- Production deployment

### Risk Assessment

**High Risk Areas:**
1. **Database migration**: Foreign key updates could break existing data
2. **Authentication overhaul**: Complete replacement of auth system
3. **API reorganization**: Major endpoint restructuring

**Mitigation Strategies:**
1. Create comprehensive test suite before migration
2. Implement gradual rollout with feature flags
3. Maintain backward compatibility during transition
4. Extensive testing of authentication flows

### Files to Create: ~15
### Files to Update: ~30
### Files to Delete: 2

**Ready for implementation with proper planning and testing.**
