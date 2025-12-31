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

## Edge Cases

### 1. Missing Settings

**Scenario**: Clinic or practitioner has no settings configured (empty JSONB)

**Behavior**: Default settings are returned via Pydantic model defaults

**Rationale**: Ensures system always has valid settings even if not explicitly configured.

### 2. Invalid Settings Format

**Scenario**: Database contains invalid JSON or structure doesn't match schema

**Behavior**: Validation fails, error returned. Settings must be fixed before saving

**Rationale**: Prevents invalid data from causing runtime errors.

### 3. Settings Update Failure

**Scenario**: Settings update fails due to validation error or database error

**Behavior**: Transaction rolled back, error returned. No partial updates saved

**Rationale**: Ensures settings remain consistent - either all changes succeed or none do.

### 4. Concurrent Settings Updates

**Scenario**: Multiple requests update same clinic's settings simultaneously

**Behavior**: Database transaction isolation prevents conflicts. Last write wins (standard database behavior)

**Rationale**: Database handles concurrency - no special locking needed for settings.

### 5. Settings Deletion

**Scenario**: Settings field is set to null or deleted

**Behavior**: Default settings returned on next access. System continues to work with defaults

**Rationale**: Graceful degradation - missing settings don't break system.

### 6. Settings Schema Migration

**Scenario**: Settings schema changes (new fields added, old fields removed)

**Behavior**: Pydantic models handle missing/extra fields gracefully:
- Missing fields: Use defaults
- Extra fields: Ignored (can be preserved if needed)

**Rationale**: Schema evolution is handled gracefully without breaking existing data.

### 7. Test Mode Settings Override

**Scenario**: Chatbot test mode uses unsaved settings

**Behavior**: `chat_settings_override` parameter allows testing unsaved settings without affecting production

**Rationale**: Enables safe testing of chatbot configuration changes.

---

## Technical Design

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

### Pydantic Models

**ClinicSettings**: Top-level model containing all clinic setting groups
```python
class ClinicSettings(BaseModel):
    notification_settings: NotificationSettings
    booking_restriction_settings: BookingRestrictionSettings
    clinic_info_settings: ClinicInfoSettings
    chat_settings: ChatSettings
    receipt_settings: ReceiptSettings
```

**PractitionerSettings**: Model for practitioner settings
```python
class PractitionerSettings(BaseModel):
    compact_schedule_enabled: bool = False
```

**Validation**: Pydantic automatically validates types, constraints, and defaults

### Settings Access Pattern

**Get Settings**:
```python
# Via service
settings = SettingsService.get_clinic_settings(db, clinic_id)

# Via model
settings = clinic.get_validated_settings()
```

**Update Settings**:
```python
# Get current
current = clinic.get_validated_settings()

# Modify
current.notification_settings.reminder_hours_before = 48

# Save
clinic.set_validated_settings(current)
db.commit()
```

**Partial Update**:
```python
# Get current
current = clinic.get_validated_settings()

# Merge with new (only update provided fields)
new_dict = current.model_dump()
new_dict.update(request.settings)  # request.settings contains only changed fields

# Validate and save
validated = ClinicSettings.model_validate(new_dict)
clinic.set_validated_settings(validated)
db.commit()
```

### Settings Service

**Purpose**: Centralized access to settings with consistent error handling

**Methods**:
- `get_clinic_settings(db, clinic_id)`: Returns validated `ClinicSettings`
- `get_practitioner_settings(db, user_id, clinic_id)`: Returns validated `PractitionerSettings` or None

**Error Handling**: Raises `HTTPException` if clinic/user not found

**Rationale**: Provides consistent API for settings access across the application.

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
- Technical design (database schema, Pydantic models, access patterns, settings service)

All settings are validated before saving and have sensible defaults to ensure system reliability and ease of use.



