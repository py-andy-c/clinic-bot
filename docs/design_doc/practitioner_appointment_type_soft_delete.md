# Practitioner Appointment Type Soft Delete

## Overview

This document outlines the design for implementing soft-delete functionality for Practitioner Appointment Types (PATs) and decoupling billing scenarios from PATs. This preserves billing scenarios when practitioners are unassigned and allows scenarios to be managed independently.

**Note**: This is a design document describing the target implementation. The current codebase has PATs that are hard-deleted and billing scenarios with CASCADE foreign keys.

## Implementation Status

### Already Implemented
- ✅ Billing scenarios have `is_deleted` and `deleted_at` fields (soft-delete support exists)
- ✅ Billing scenarios use `practitioner_appointment_type_id` FK (needs to be decoupled)

### To Be Implemented
- ❌ PAT soft-delete fields (`is_deleted`, `deleted_at`)
- ❌ Partial unique index for PATs (replacing existing unique constraint)
- ❌ Decouple billing scenarios from PAT (remove FK, add direct fields)
- ❌ Database trigger to prevent hard-deletes of billing scenarios
- ❌ PAT reactivation logic
- ❌ Query filtering for soft-deleted PATs
- ❌ Frontend staging workflow updates

---

## Problem Statement

### Current Issue

When a practitioner is unassigned from a service item:
1. The `practitioner_appointment_types` record is **hard-deleted**
2. The foreign key constraint on `billing_scenarios` uses `CASCADE` deletion
3. **All billing scenarios for that practitioner-service combination are permanently lost**
4. When the practitioner is re-assigned, billing scenarios must be recreated from scratch

### Impact

- **Data Loss**: Valuable billing configuration (pricing scenarios, revenue shares) is lost
- **User Experience**: Clinics must reconfigure billing scenarios after reassigning practitioners
- **Business Risk**: Historical billing data integrity is compromised

---

## Solution: Soft Delete for PATs

### High-Level Approach

1. **Add soft-delete fields** to `practitioner_appointment_types`:
   - `is_deleted` (boolean, default: false)
   - `deleted_at` (timestamp, nullable)

2. **Add uniqueness constraint** to prevent duplicate active PATs:
   - Drop existing unique constraint `uq_practitioner_type_clinic` on `(user_id, clinic_id, appointment_type_id)`
   - Create partial unique index on `(user_id, clinic_id, appointment_type_id)` where `is_deleted = false`
   - Ensures reactivation reuses existing PAT record instead of creating duplicates
   - Column order matches existing constraint for consistency

3. **Decouple billing scenarios from PAT**:
   - Remove `practitioner_appointment_type_id` foreign key from `billing_scenarios`
   - Add direct fields: `practitioner_id`, `appointment_type_id`, `clinic_id` to `billing_scenarios`
   - Scenarios become independent entities - can be created/edited even when no PAT exists
   - UI always shows all scenarios for practitioner-service combination regardless of PAT status
   - Visual indicator shows when practitioner is not assigned

4. **Add database-level protection** for billing scenarios:
   - Database trigger prevents hard-deletes (converts DELETE to soft-delete)
   - Ensures scenarios are never permanently lost

5. **Update business logic**:
   - When unassigning: soft-delete PAT instead of hard-delete
   - When reassigning: **always reactivate existing soft-deleted PAT** if exists (never create new)
   - Filter out soft-deleted PATs in all queries where active records are expected

6. **Frontend staging and save workflow**:
   - All changes (PAT assignments, scenario edits) are staged in local state
   - Changes are only saved to database when "儲存變更" button is clicked
   - Browser `beforeunload` event warns user about unsaved changes
   - In-app indicator shows unsaved changes status

---

## Implementation Details

### Database Trigger for Billing Scenarios

**Purpose**: Prevent hard-deletes of billing scenarios at the database level.

**Implementation**:
- Create a `BEFORE DELETE` trigger on `billing_scenarios` table
- Trigger intercepts DELETE operations
- Converts DELETE to UPDATE: set `is_deleted = true`, `deleted_at = CURRENT_TIMESTAMP`
- Returns error if trigger fails (should not happen in normal operation)

**Rationale**: Provides defense-in-depth protection. Even if application code is modified or bypassed, scenarios cannot be permanently deleted.

### Partial Unique Index for PATs

**Purpose**: Ensure only one active PAT per (practitioner, service, clinic) combination.

**Implementation**:
```sql
-- Drop existing unique constraint
DROP INDEX IF EXISTS uq_practitioner_type_clinic;

-- Create partial unique index (column order matches existing constraint)
CREATE UNIQUE INDEX idx_pat_unique_active 
ON practitioner_appointment_types (user_id, clinic_id, appointment_type_id) 
WHERE is_deleted = false;
```

**Behavior**:
- Allows multiple soft-deleted PATs with same (user_id, clinic_id, appointment_type_id)
- Prevents duplicate active PATs
- Enables reactivation by finding existing soft-deleted record

**Rationale**: Ensures data integrity while allowing historical records to be preserved.

### PAT Reactivation Logic

**Algorithm**:
1. When reassigning practitioner to service:
   - Query for existing PAT: `WHERE user_id = X AND clinic_id = Y AND appointment_type_id = Z`
   - If found and `is_deleted = true`: 
     - Reactivate: set `is_deleted = false`, `deleted_at = NULL`
     - Keep original `created_at` (preserve audit trail)
     - If multiple soft-deleted PATs exist (edge case), reactivate one with most recent `deleted_at` timestamp
   - If found and `is_deleted = false`: Already active, no action needed
   - If not found: Create new PAT

**Rationale**: Preserves PAT record ID and audit trail. Billing scenarios are independent and don't need linking - they use direct `practitioner_id` and `appointment_type_id` fields.

### Data Model: Decoupling Billing Scenarios from PAT

**Change**: Remove `practitioner_appointment_type_id` FK, add direct `practitioner_id`, `appointment_type_id`, `clinic_id` fields to `BillingScenario`.

**Result**: Scenarios are independent - no PAT dependency, can be created before practitioner assignment, simpler queries. See Migration section for implementation details.

---

## Key Changes

### Database Schema

**Migration Order**: Execute migrations in this order:
1. `add_soft_delete_to_practitioner_appointment_types` (PAT soft-delete)
2. `decouple_billing_scenarios_from_pat` (scenario decoupling)
3. Add database trigger (can be in migration 2 or separate)

**Migration Rollback**:
- Migration 1 rollback: Drop `is_deleted`/`deleted_at` columns, recreate original unique constraint
- Migration 2 rollback: Restore `practitioner_appointment_type_id` FK, drop direct fields, drop trigger
- **Critical**: Test rollback procedures in staging environment before production

**Migration** (`add_soft_delete_to_practitioner_appointment_types`):
- Add `is_deleted` and `deleted_at` columns to `practitioner_appointment_types`
  - Set `is_deleted = false` and `deleted_at = NULL` for all existing records
- Create index on `is_deleted` for query performance
- **Drop existing unique constraint** `uq_practitioner_type_clinic` on `(user_id, clinic_id, appointment_type_id)`
- Create **partial unique index** on `(user_id, clinic_id, appointment_type_id)` where `is_deleted = false`
  - Prevents duplicate active PATs
  - Allows multiple soft-deleted PATs (for history/audit)
  - Column order matches existing constraint

**Migration** (`decouple_billing_scenarios_from_pat`):
- Add direct fields to `billing_scenarios`:
  - `practitioner_id` (FK to `users.id`, NOT NULL)
  - `appointment_type_id` (FK to `appointment_types.id`, NOT NULL)
  - `clinic_id` (FK to `clinics.id`, NOT NULL)
- **Pre-migration validation**: Check for orphaned scenarios before starting:
  ```sql
  SELECT COUNT(*) FROM billing_scenarios bs
  LEFT JOIN practitioner_appointment_types pat ON bs.practitioner_appointment_type_id = pat.id
  WHERE pat.id IS NULL;
  ```
  - If count > 0, fail migration with clear error message requiring manual cleanup
- Populate new fields from existing `practitioner_appointment_type_id` relations:
  - Join with `practitioner_appointment_types` to get `user_id`, `appointment_type_id`, `clinic_id`
  - Update all existing billing scenarios
  - **Edge case handling**: Run migration during maintenance window to prevent concurrent PAT deletions
- Create index on `(practitioner_id, appointment_type_id, clinic_id)` for query performance
- Create composite unique index on `(practitioner_id, appointment_type_id, clinic_id, name)` where `is_deleted = false` for scenario name uniqueness
- Drop obsolete index `idx_billing_scenarios_practitioner_type` on `practitioner_appointment_type_id`
- Remove `practitioner_appointment_type_id` foreign key and column
- Remove `cascade="all, delete-orphan"` from `PractitionerAppointmentTypes.billing_scenarios` relationship
- Add **database trigger** on `billing_scenarios` to prevent hard-deletes:
  ```sql
  CREATE OR REPLACE FUNCTION prevent_billing_scenario_hard_delete()
  RETURNS TRIGGER AS $$
  BEGIN
    UPDATE billing_scenarios 
    SET is_deleted = true, deleted_at = CURRENT_TIMESTAMP 
    WHERE id = OLD.id;
    RETURN NULL; -- Prevent actual deletion
  END;
  $$ LANGUAGE plpgsql;
  
  CREATE TRIGGER billing_scenario_soft_delete_trigger
  BEFORE DELETE ON billing_scenarios
  FOR EACH ROW EXECUTE FUNCTION prevent_billing_scenario_hard_delete();
  ```
  - Note: Billing scenarios already have `is_deleted` and `deleted_at` fields - trigger provides defense-in-depth
  - Ensures scenarios are never permanently lost

### Backend Changes

**Models**:
- `PractitionerAppointmentTypes`: 
  - Add soft-delete fields (`is_deleted`, `deleted_at`)
  - Remove `cascade="all, delete-orphan"` from `billing_scenarios` relationship (line 49)
- `BillingScenario`: 
  - Remove `practitioner_appointment_type_id` foreign key
  - Add direct fields: `practitioner_id`, `appointment_type_id`, `clinic_id`
  - Remove relationship to `PractitionerAppointmentTypes`
- `backend/src/api/responses.py` (if exists):
  - Verify and update `BillingScenario` response model if present

**Services**:
- `PractitionerService.update_practitioner_appointment_types()`:
  - Soft-delete PATs instead of hard-delete
  - **Always reactivate existing soft-deleted PAT** when reassigning (never create new)
  - Query for soft-deleted PAT first, then reactivate if found
- `AvailabilityService.is_practitioner_assigned_to_appointment_type()`: 
  - Add `is_deleted == False` filter (line ~168-172)
- `PractitionerService`: 
  - Filter `is_deleted == False` in all queries:
    - `get_practitioners_for_clinic()` (line ~58-62)
    - `get_practitioners_for_appointment_type()` (line ~144-148)
    - `get_practitioner_by_appointment_type()` (line ~212-216)
- `appointment_type_queries.py.get_active_appointment_types_for_practitioner()`: 
  - Add `is_deleted == False` filter (line ~133-137)
- `appointment_type_queries.py.count_active_appointment_types_for_practitioner()`: 
  - Add `is_deleted == False` filter (line ~162-169)
- `appointment_type_queries.py.get_active_appointment_types_for_clinic_with_active_practitioners()`: 
  - Add `is_deleted == False` filter in PAT subquery (line ~195-205)
- `clinic/practitioners.py` (appointment type counts): 
  - Add `is_deleted == False` filter on PAT queries (line ~423-433)
- `BillingScenarioService`: 
  - Never hard-delete scenarios (only soft-delete)
  - Query scenarios by `practitioner_id`, `appointment_type_id`, `clinic_id` directly (no PAT dependency)

**API Endpoints**:
- `receipt_endpoints.py`: 
  - `BillingScenarioResponse` model (line ~482-489): Remove `practitioner_appointment_type_id`, add `practitioner_id`, `appointment_type_id`, `clinic_id`
  - All endpoints: Remove PAT existence checks, query scenarios directly by `practitioner_id` and `appointment_type_id`
    - `list_billing_scenarios()` (line ~529-533)
    - `create_billing_scenario()` (line ~588-592) - allow creation without PAT
    - `update_billing_scenario()` (line ~672-677)
    - `delete_billing_scenario()` (line ~749-754)
  - Always return all scenarios regardless of PAT status

### Frontend Changes

**State Management**:
- `serviceItemsStore.ts`: 
  - Update `BillingScenario` type (line ~25): remove `practitioner_appointment_type_id`, add `practitioner_id`, `appointment_type_id`, `clinic_id`
  - Stage all changes in local state; commit only on "儲存變更" button
  - Atomic save operation (all succeed or all fail)
  - Query scenarios by `practitioner_id` and `appointment_type_id` directly
- `frontend/src/types/index.ts`:
  - Update `BillingScenario` interface (line ~544): remove `practitioner_appointment_type_id`, add `practitioner_id`, `appointment_type_id`, `clinic_id`
- `frontend/src/types/api.ts` (if exists):
  - Verify and update `BillingScenario` type definition if present
- `frontend/src/services/api.ts`:
  - Update `getBillingScenarios()` endpoint to work with direct fields (no PAT requirement)

**Components**:
- `AppointmentTypeField`: 
  - Always show all scenarios regardless of PAT status
  - Visual indicator when PAT doesn't exist (e.g., "治療師尚未指派到此服務項目")
  - Full scenario management even when no PAT exists
  - Load scenarios by `practitioner_id` and `appointment_type_id` directly
- `ServiceItemEditModal`: 
  - Sync scenarios between main and staging stores
  - Unsaved changes indicator + browser `beforeunload` warning
  - Confirmation dialogs for scenario deletion

---

## Business Rules

### PAT Management
1. **Soft-delete on unassignment**: Mark `is_deleted=true`, `deleted_at=timestamp`
2. **Reactivation on reassignment**: Always reactivate existing soft-deleted PAT (never create new); preserve `created_at` for audit trail
3. **Uniqueness**: Only one active PAT per `(user_id, clinic_id, appointment_type_id)` (enforced by partial unique index)
4. **Query filtering**: All active queries must filter `is_deleted == False` (see "Key Changes" for specific locations)

### Billing Scenario Management
5. **Independence**: Scenarios use direct `practitioner_id`, `appointment_type_id`, `clinic_id` - no PAT dependency
6. **Soft-delete only**: Database trigger prevents hard-deletes; app code must only soft-delete
7. **Full CRUD**: Scenarios can be created/edited without PAT existing; always visible in UI with visual indicator when PAT missing

### Frontend Workflow
9. **Staging**: All changes staged in local state; saved only on "儲存變更" button click
10. **Atomic save**: All changes succeed or all fail (transaction-based)
11. **Unsaved changes**: Browser `beforeunload` warning + in-app indicator

### Data Integrity
13. **Uniqueness**: Scenario names unique per `(practitioner_id, appointment_type_id, clinic_id, name)` where `is_deleted=false` (enforced by partial unique index)
14. **Historical data**: Soft-deleted records preserved for audit
15. **Foreign key validation**: Direct fields (`practitioner_id`, `appointment_type_id`, `clinic_id`) have FK constraints - scenarios cannot reference non-existent entities

---

## Edge Cases & Questions

### Migration Edge Cases
1. **Orphaned billing scenarios**: If `practitioner_appointment_type_id` points to deleted PAT
   - **Solution**: Pre-migration validation query (see Migration section) fails migration if orphans found
   - **Fallback**: Manual cleanup required before proceeding

2. **Concurrent PAT deletion during migration**: PAT deleted while migration populates direct fields
   - **Solution**: Run during maintenance window, use transaction with appropriate isolation level
   - **Fallback**: Migration fails, rollback and retry

### Runtime Edge Cases
3. **Creating scenario with non-existent practitioner**: `practitioner_id` doesn't exist in `users` table
   - **Solution**: FK constraint prevents this - validation error returned
   - **Behavior**: Scenario creation fails with foreign key violation

4. **Creating scenario with wrong clinic**: `practitioner_id` belongs to different clinic than `clinic_id`
   - **Solution**: Application-level validation (practitioner must be in clinic)
   - **Behavior**: Validation error, scenario creation fails

5. **Scenario without matching PAT**: Scenario exists with `practitioner_id` + `appointment_type_id` but no PAT (active or soft-deleted)
   - **Solution**: This is allowed - scenarios are independent
   - **Behavior**: Scenario remains valid, visual indicator shows PAT missing

6. **Multiple soft-deleted PATs**: Partial unique index prevents this; if it occurs, reactivate most recent by `deleted_at`
7. **Database trigger failure**: Trigger raises exception, transaction rolls back, hard-delete prevented
8. **PAT reactivation with deleted entities**: FK constraints prevent reactivation, fails with validation error

### Frontend Edge Cases
9. **PAT soft-deleted during scenario editing**: Scenarios remain editable (independent), visual indicator updates
10. **Concurrent scenario edits**: Last save wins (or implement optimistic locking)
11. **Save failure with staged changes**: Preserve staging state, show error, allow retry

---

## Benefits

- **Data Preservation**: Scenarios never lost (database trigger protection)
- **Better UX**: No need to reconfigure billing after reassignment
- **True Decoupling**: PAT and scenarios independent - scenarios can be created before assignment
- **Simpler Queries**: Direct lookups by `practitioner_id`/`appointment_type_id` (no PAT joins)
- **User Control**: Explicit save workflow prevents accidental changes
- **Reversibility**: Unassignments easily reversed with full data restoration

---

## Testing Considerations

### PAT Management
- Reactivation reuses same PAT record (not creating new)
- Uniqueness constraint prevents duplicate active PATs
- Soft-deleted PATs excluded from listings and availability checks
- Multiple unassign/reassign cycles

### Billing Scenarios
- Scenarios always visible regardless of PAT status
- Can create/edit when no PAT exists; visual indicator shown
- Use direct `practitioner_id`, `appointment_type_id`, `clinic_id` (no PAT FK)
- Database trigger prevents hard-delete
- Persist independently when PAT created/reactivated

### Frontend Workflow
- All changes staged; saved only on "儲存變更" button
- Atomic save (all succeed or all fail)
- Browser alert + in-app indicator for unsaved changes
- Error handling preserves staging state

### Edge Cases
- Creating scenarios before practitioner assignment
- Reactivating PAT when scenarios already exist
- Concurrent edits and saves
- Migration: Populating direct fields from PAT relations

