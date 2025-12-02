# Production Deployment Checklist for Migration Fix

## Pre-Deployment Checks

### 1. Database Backup (CRITICAL)
```bash
# Create a full database backup before running migrations
pg_dump "postgresql://postgres:WTNpHuCmSPuNVRVCRBBvjKzYWEIUpVEV@yamanote.proxy.rlwy.net:34793/railway" > backup_$(date +%Y%m%d_%H%M%S).sql
```

### 2. Verify Current Migration State
```bash
# Check what migration is currently applied
alembic current

# Check if migrate_line_users_phase2 has already been run
# If it has, the fix will make it idempotent (safe to re-run)
```

### 3. Check Production Data State
```sql
-- Check how many LineUsers need migration
SELECT COUNT(*) FROM line_users WHERE clinic_id IS NULL;

-- Check if any patients reference these LineUsers
SELECT COUNT(*) FROM patients p 
INNER JOIN line_users lu ON p.line_user_id = lu.id 
WHERE lu.clinic_id IS NULL AND p.is_deleted = false;
```

### 4. Verify Tables Don't Exist (Expected)
```sql
-- These tables should NOT exist in production (based on migration path)
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('line_user_ai_opt_outs', 'line_user_ai_disabled');
```

## Deployment Steps

1. ✅ **Backup database** (see above)
2. ✅ **Deploy code** with the fixed migration
3. ✅ **Run migrations** - The fix makes it safe even if tables don't exist
4. ✅ **Verify migration success** - Check that LineUsers were migrated correctly
5. ✅ **Monitor application** - Ensure no errors after deployment

## Post-Deployment Verification

```sql
-- Verify migration completed successfully
-- All LineUsers should have clinic_id set (or be deleted if orphaned)
SELECT COUNT(*) FROM line_users WHERE clinic_id IS NULL;

-- Should be 0 or very few (only orphaned entries)
```

## Rollback Plan

If something goes wrong:
1. The transaction will auto-rollback on error
2. If migration partially completes, you can manually fix data
3. Restore from backup if needed: `psql < backup_file.sql`

## Notes

- The migration is **idempotent** - safe to re-run
- The migration is **transaction-wrapped** - auto-rollback on error
- The fix makes it **resilient** to missing tables
- **Estimated time**: Depends on number of LineUsers (could be minutes for large datasets)

