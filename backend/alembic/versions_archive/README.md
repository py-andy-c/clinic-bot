# Archived Migrations - Pre-Baseline History

**Date:** November 2025  
**Reason:** Migration History Reset - Path B Lite Week 2

## Overview

This directory contains all migrations from the original migration history (23 migrations total). These were archived as part of Path B Lite Week 2 to create a clean baseline migration that consolidates all schema changes into a single, comprehensive migration.

## Why Archive?

### Problems with Original Migration History:
1. **Complex Dependencies**: Multiple merge points and branching migrations
2. **SQLite Workarounds**: Some migrations contained SQLite-specific workarounds
3. **Hard to Understand**: 23 migrations made it difficult to understand the current schema
4. **Test Setup Complexity**: Required complex logic to handle migrations in tests

### Benefits of Baseline Migration:
1. **Clean History**: Single migration creates all tables from scratch
2. **PostgreSQL-Optimized**: Uses PostgreSQL-specific types (JSONB, TIMESTAMPTZ) from the start
3. **Simpler Test Setup**: Can run migrations from scratch (base → head)
4. **Better Documentation**: Clear schema definition in one place
5. **Pre-Launch Opportunity**: Easier to reset now than after launch

## Migration Chain (Original Order)

### Base → First Migration
- `20251017_160912_add_line_access_token_and_gcal_indexes.py` - First migration (assumes tables exist)

### Authentication Schema Branch
- `20251022_000000_authentication_schema_migration.py` - Unified user model and authentication tables

### Practitioner Availability Branch
- `20251024_120000_add_practitioner_availability.py` - Practitioner availability table

### Calendar Schema Branch
- `e04729c2b2e0_practitioner_calendar_schema_migration.py` - Calendar event schema migration

### Merge Point
- `14aae079a414_merge_migration_heads.py` - Merged authentication and practitioner availability branches

### Subsequent Migrations (Sequential)
1. `11946888e740_add_hmac_key_field_to_refresh_tokens_.py` - HMAC key for refresh tokens
2. `e19c901bffd3_add_email_field_to_refresh_tokens_for_.py` - Email field for system admins
3. `08b75d419cd0_add_notification_settings_to_clinics_.py` - Notification settings
4. `7930a84b50b1_add_appointment_status_indexes.py` - Appointment status indexes
5. `73e30b8b8da7_add_booking_restriction_fields_to_.py` - Booking restriction fields
6. `054d4458faa7_remove_hmac_key_from_refresh_tokens.py` - Removed HMAC key (reverted)
7. `63c6a541e10d_add_clinic_display_info_fields.py` - Clinic display info fields
8. `b7745d01aa46_fix_calendar_time_range_constraint.py` - Fixed calendar time range constraint
9. `61cdb3d6fde6_add_cascade_delete_to_practitioner_.py` - Cascade delete for practitioner types
10. `20251104_120000_add_soft_delete_to_appointment_types.py` - Soft delete for appointment types
11. `20251104_130000_add_appointment_booking_constraints.py` - Appointment booking constraints
12. `20251104_140000_add_soft_delete_to_patients.py` - Soft delete for patients
13. `08495bc8486f_migrate_clinic_settings_to_json.py` - Migrate clinic settings to JSON
14. `20251104_204901_make_refresh_token_user_id_nullable.py` - Make refresh token user_id nullable

### Path B Lite Week 1 Optimizations
15. `018d83953428_add_jsonb_gin_indexes.py` - JSONB GIN indexes (Week 1, Task 1)
16. `2e8a774cc355_add_postgresql_constraints.py` - PostgreSQL constraints (Week 1, Task 3)
17. `ea8656d0814d_add_performance_indexes.py` - Performance indexes (Week 1, Task 4)

## What Was Consolidated

All schema changes from these 23 migrations have been consolidated into a single baseline migration that:
- Creates all tables from scratch
- Includes all columns, indexes, constraints
- Uses PostgreSQL-specific types (JSONB, TIMESTAMPTZ)
- Incorporates all Week 1 optimizations
- Removes SQLite workarounds

## Design Rationale

### Original Migration Approach:
- Incremental changes as the project evolved
- Migrations assumed tables existed (first migration only adds columns)
- SQLite workarounds for compatibility
- Complex branching and merge points

### New Baseline Approach:
- Single comprehensive migration
- Creates all tables from scratch
- PostgreSQL-optimized from the start
- Clean linear history going forward

## Migration Files

All 23 migration files are preserved in this directory for reference:
- Original migration files (unchanged)
- Can be referenced for historical context
- Useful for understanding evolution of schema

## Notes

- **No Data Loss**: Archive preserves all migration history
- **Reference Only**: These migrations are not used in active development
- **Baseline Migration**: New baseline migration (`001_initial_schema.py`) replaces all of these
- **Test Compatibility**: New baseline enables simpler test setup (run all migrations from scratch)

