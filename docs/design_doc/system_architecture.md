# System Architecture - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for system-level features, including multi-clinic user support, clinic-specific LIFF apps, internationalization, and database migrations.

---

## Key Business Logic

### 1. Multi-Clinic User Support

**Purpose**: Support users who work at multiple clinics while maintaining strict clinic isolation.

**Core Principles**:
- **Clinic Isolation**: User's settings, appointments, roles, calendar, and availability must be separate between clinics
- **Multi-Clinic Access**: Users can be members of multiple clinics with different roles at each
- **Clinic Switching**: Users can easily switch between clinics in the UI
- **Backward Compatible**: Existing single-clinic users continue to work without changes

**Architecture**:
- **UserClinicAssociation**: Many-to-many relationship between users and clinics
  - Each association has its own `roles`, `full_name`, `is_active` flag
  - User can have different roles at different clinics
- **Clinic Context**: All queries filter by `clinic_id` from user's current clinic context
- **Authentication**: JWT token includes `clinic_id` for clinic users

**Rationale**: Enables users to work at multiple clinics while maintaining data isolation and security.

### 2. Clinic-Specific Provider LIFF Support

**Purpose**: Support clinics with their own LINE provider (created by clinic owner) who need clinic-specific LIFF apps.

**Architecture**:
- **Hybrid Approach**: Support both shared LIFF app (current) and clinic-specific LIFF apps
- **Clinic Identification**:
  - **Shared LIFF**: Uses `clinic_token` in URL query parameter
  - **Clinic-Specific LIFF**: Uses `liff_id` stored per clinic in database
- **LIFF ID Storage**: `clinics.liff_id` column (nullable, unique)
- **Frontend Detection**: Extracts `liff_id` from URL parameter (`?liff_id=...`) for clinic-specific apps, falls back to `VITE_LIFF_ID` env var for shared LIFF

**Rationale**: Some clinics have their own LINE provider and need clinic-specific LIFF apps. Providers cannot be changed once linked, and user IDs differ per provider.

### 3. Multi-Language Support

**Purpose**: Support multiple languages in the LIFF app (Traditional Chinese and English).

**Architecture**:
- **Library**: `react-i18next` for i18n support
- **Default Language**: Traditional Chinese (繁體中文)
- **Supported Languages**: Traditional Chinese (zh-TW), English (en)
- **Language Detection**: User's saved preference from database (`line_user.preferred_language`), default to Traditional Chinese if no preference
- **Storage**: Database storage only (no localStorage) - preference stored in `LineUser.preferred_language` column

**Rationale**: 95% of users use Traditional Chinese, so default directly to Traditional Chinese. Database storage needed for LINE message personalization in future.

### 4. Database Migrations

**Purpose**: Manage database schema changes safely and versioned.

**Tool**: Alembic for database migrations.

**Pattern**:
- Each migration is a separate file with upgrade/downgrade functions
- Migrations are versioned and tracked in database
- Rollback support via downgrade functions

**Rationale**: Ensures database schema changes are versioned, reversible, and can be applied consistently across environments.

---

## Edge Cases

### 1. User Switches Clinic Mid-Session

**Scenario**: User switches clinic while viewing calendar or other clinic-specific data.

**Behavior**: Refresh all clinic-specific data when clinic context changes. Clear cached data for previous clinic.

### 2. Clinic-Specific LIFF App Configuration

**Scenario**: Clinic configures LIFF app with incorrect endpoint URL or LIFF ID.

**Behavior**: Frontend validates LIFF ID format and shows error if invalid. Backend validates clinic lookup by `liff_id` and returns 404 if not found.

### 3. Language Preference Not Set

**Scenario**: User's language preference is not set in database.

**Behavior**: Default to Traditional Chinese. Language selector allows user to set preference, which is saved to database immediately.

### 4. Migration Rollback

**Scenario**: Migration needs to be rolled back due to issues.

**Behavior**: Alembic downgrade function reverses migration. Database state returns to previous version.

---

## Technical Design

### Multi-Clinic Architecture

**Database Schema**:
- `users` table: Core user information (email, google_subject_id)
- `user_clinic_associations` table: Many-to-many relationship
  - `user_id`, `clinic_id`, `roles` (JSONB array), `full_name`, `is_active`
- All clinic-scoped tables: Filter by `clinic_id` from association

**Authentication Flow**:
1. User authenticates via Google OAuth
2. System identifies user's clinics via `UserClinicAssociation`
3. User selects clinic (or system uses default)
4. JWT token includes `clinic_id` for clinic context
5. All queries filter by `user.clinic_id` from association

**Rationale**: Maintains strict clinic isolation while enabling multi-clinic access.

### Clinic-Specific LIFF

**Database Schema**:
- `clinics.liff_id` column (nullable, unique, indexed)

**Frontend Implementation**:
- Extract `liff_id` from URL parameter before LIFF initialization
- Use `liff_id` from URL or `VITE_LIFF_ID` env var
- After initialization, verify with `liff.getContext().liffId`
- Send `liff_id` to backend for clinic lookup

**Backend Implementation**:
- Look up clinic by `liff_id` first, fall back to `clinic_token` if not found
- Include `liff_id` in JWT token for clinic-specific apps
- `generate_liff_url()` uses `clinic.liff_id` when available

**Rationale**: Supports both shared and clinic-specific LIFF apps with single codebase.

### Internationalization

**Frontend Structure**:
- `frontend/src/i18n/`: i18n configuration and translation files
  - `index.ts`: i18n initialization
  - `locales/zh-TW.ts`: Traditional Chinese translations
  - `locales/en.ts`: English translations
- `frontend/src/liff/components/LanguageSelector.tsx`: Language selection component

**Initialization Sequence**:
1. Initialize i18n with default language ('zh-TW')
2. Perform LIFF login
3. If `preferred_language` is returned from API and differs from default, change i18n language
4. If API call fails or no preference, keep default

**Rationale**: Provides seamless language switching with preference persistence.

---

## Summary

This document covers:
- Multi-clinic user support (clinic isolation, multi-clinic access, clinic switching)
- Clinic-specific LIFF support (hybrid approach, clinic identification, LIFF ID storage)
- Multi-language support (Traditional Chinese and English, preference persistence)
- Database migrations (Alembic, versioned schema changes, rollback support)
- Edge cases (clinic switching, LIFF configuration, language preference, migration rollback)
- Technical design (database schema, authentication flow, frontend/backend implementation)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.

