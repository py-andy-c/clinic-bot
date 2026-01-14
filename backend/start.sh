#!/bin/bash
set -e

# =============================================================================
# PRODUCTION DATABASE MIGRATION SAFETY SYSTEM - Railway Deployment Script
# =============================================================================
#
# PURPOSE:
#   Railway deployment startup script with comprehensive database migration safety.
#   Ensures database integrity before application startup with zero-downtime deployment.
#
# SAFETY PHILOSOPHY:
#   "Fail fast, fail safe" - Any uncertainty blocks deployment to prevent data corruption.
#   Railway environments trusted for backup infrastructure, non-Railway require explicit confirmation.
#
# PREVENTED ISSUES:
#   ✅ Data Loss: Post-migration validation catches corruption before app startup
#   ✅ Schema Inconsistencies: Mandatory pre-migration schema validation
#   ✅ Concurrent Corruption: Database-level migration locks prevent simultaneous migrations
#   ✅ Railway Timeouts: Timeout monitoring with graceful failure handling
#   ✅ Silent Failures: Comprehensive logging and error reporting
#   ✅ Unknown States: Revision validation blocks deployments with diverged migration history
#
# 4-PHASE SAFETY SYSTEM:
#   Phase 1: Pre-flight Validation
#     - Database connectivity and permissions
#     - Schema integrity (critical tables exist)
#     - Environment validation (Railway backup trust model)
#
#   Phase 2: Migration State Validation
#     - Current revision verification
#     - Unknown revision blocking with recovery guidance
#
#   Phase 3: Safe Migration Execution
#     - Migration lock acquisition (prevents concurrency)
#     - Timeout-protected execution (Railway deployment aware)
#     - Success/failure handling with cleanup
#
#   Phase 4: Post-Migration Validation
#     - Alembic version verification
#     - Table/data integrity checks (environment-aware thresholds)
#     - Critical application query testing
#
# KNOWN LIMITATIONS:
#   ❌ Cannot prevent data loss DURING migration execution (PostgreSQL DDL limitation)
#   ❌ Cannot rollback DDL operations (PostgreSQL transaction limitation)
#   ❌ Cannot validate migration logic intent (only execution results)
#   ❌ Railway backup status not programmatically verifiable
#
# EMERGENCY PROCEDURES:
#   🚨 Unknown Revision: Set ALLOW_UNKNOWN_REVISION=true (requires bridge migration)
#   🚨 Non-Railway Deploy: Set ALLOW_NO_BACKUP=true (requires manual backup verification)
#   🚨 Lock Issues: Wait for other deployment or manual lock cleanup
#
# RECOVERY:
#   - Railway auto-rollback on failure (previous version remains running)
#   - Railway point-in-time recovery for data restoration
#   - Comprehensive logging guides manual intervention
#
# =============================================================================

# Enable verbose output for debugging (shows each command as it runs)
# Comment out if too verbose: set -x

# Ensure we're in the backend directory (where alembic.ini is)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "🚀 Starting Railway deployment"
echo "=========================================="
echo "Working directory: $(pwd)"
echo "Python version: $(python3 --version 2>&1 || echo 'Python not found')"
echo "PORT: ${PORT:-8000}"
echo "=========================================="

# Fix alembic directory structure if Nixpacks flattened it
[ ! -d "alembic" ] && [ -f "alembic.ini" ] && [ -f "env.py" -o -d "versions" ] && {
    echo "Fixing alembic directory structure..."
    mkdir -p alembic
    mv env.py script.py.mako alembic/ 2>/dev/null || true
    [ -d "versions" ] && mv versions alembic/ || true
}

# Helper functions
is_railway_env() {
    [ -n "$RAILWAY_PROJECT_ID" ] && [ -n "$RAILWAY_ENVIRONMENT_ID" ]
}

validate_environment() {
    if is_railway_env; then
        if [ "$RAILWAY_ENVIRONMENT_NAME" = "production" ]; then
            echo "✅ Railway production environment detected"
            echo "   Railway provides automated PostgreSQL backups and point-in-time recovery"
        elif [ "$RAILWAY_ENVIRONMENT_NAME" = "staging" ]; then
            echo "✅ Railway staging environment detected"
            echo "   Railway provides automated PostgreSQL backups and point-in-time recovery"
        else
            echo "✅ Railway environment detected ($RAILWAY_ENVIRONMENT_NAME)"
            echo "   Railway provides automated PostgreSQL backups and point-in-time recovery"
        fi
    else
        echo "⚠️  Non-Railway environment detected"
        echo "   This deployment environment may not have automated backup guarantees"
        if [ "$ALLOW_NO_BACKUP" != "true" ]; then
            echo "❌ ERROR: Non-Railway deployments require explicit backup confirmation"
            echo "   Set ALLOW_NO_BACKUP=true if you have verified backup arrangements"
            exit 1
        else
            echo "⚠️  Proceeding with ALLOW_NO_BACKUP=true override"
        fi
    fi
}

release_migration_lock() {
    DEPLOYMENT_ID=${DEPLOYMENT_ID:-$(date +%s)}

    python3 -c "
import sys
sys.path.insert(0, 'src')
from sqlalchemy import text
from core.database import get_db

try:
    with next(get_db()) as db:
        table_exists = db.execute(text('''
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'migration_lock'
            )
        ''')).scalar()

        if table_exists:
            db.execute(text('DELETE FROM migration_lock WHERE deployment_id = :deployment_id'),
                      {'deployment_id': '$DEPLOYMENT_ID'})
            db.commit()
            print('✅ Migration lock released')
        else:
            print('ℹ️  Migration lock table not available - skipping lock release')
except Exception as e:
    print(f'⚠️  Warning: Failed to release migration lock: {e}')
    "
}

# Run database migrations - CRITICAL: Must succeed before starting app
if [ -d "alembic" ] && [ -f "alembic.ini" ]; then
    echo "=========================================="
    echo "🛡️  Production Database Migration Safety System"
    echo "=========================================="

    # Phase 1: Pre-flight validation (MANDATORY)
    echo "🔍 Phase 1: Pre-migration validation..."

    # 1.1 Validate database connectivity and permissions
    if ! python3 -c "
import sys
sys.path.insert(0, 'src')
try:
    from core.database import get_db
    from sqlalchemy import text
    with next(get_db()) as db:
        db.execute(text('SELECT 1'))
    print('✅ Database connectivity validated')
except Exception as e:
    print(f'❌ Database connection failed: {e}')
    exit(1)
    "; then
        echo "❌ CRITICAL: Cannot connect to database. Aborting deployment."
        exit 1
    fi

    # 1.2 Mandatory schema validation
    if ! python3 -c "
import sys
sys.path.insert(0, 'src')
from sqlalchemy import inspect, text
from core.database import get_db

try:
    with next(get_db()) as session:
        # Get connection from session for inspection
        connection = session.connection()
        inspector = inspect(connection)

        # Check critical tables exist
        required_tables = ['alembic_version', 'users', 'clinics', 'patients', 'appointments']
        missing_tables = []
        for table in required_tables:
            if not inspector.has_table(table):
                missing_tables.append(table)

        if missing_tables:
            print(f'❌ Critical tables missing: {missing_tables}')
            exit(1)

        # Check alembic_version table
        result = connection.execute(text('SELECT version_num FROM alembic_version')).fetchone()
        if not result:
            print('❌ alembic_version table is empty')
            exit(1)

        print(f'✅ Schema validation passed (revision: {result[0]})')

except Exception as e:
    print(f'❌ Schema validation failed: {e}')
    print('   Manual intervention required before deployment')
    exit(1)
    "; then
        echo "❌ CRITICAL: Schema validation failed. Manual intervention required."
        exit 1
    fi

    # 1.3 Environment validation
    validate_environment

    # Phase 2: Migration state validation
    echo "🔍 Phase 2: Migration state validation..."
    CURRENT_REV=$(alembic current 2>&1 | grep -oE '[a-f0-9]{12}' | head -1 || echo "")

    if [ -n "$CURRENT_REV" ]; then
        echo "Current migration revision: $CURRENT_REV"

        # Check if the revision exists in our migration history
        if ! alembic history | grep -q "$CURRENT_REV"; then
            echo "❌ CRITICAL: Unknown migration revision: $CURRENT_REV"
            echo ""
            echo "🚨 DEPLOYMENT BLOCKED - MANUAL INTERVENTION REQUIRED 🚨"
            echo ""
            echo "This database contains a migration revision not in the current codebase."
            echo "This indicates the database schema has diverged from the migration history."
            echo ""
            echo "SAFE RECOVERY OPTIONS:"
            echo "1. 🛟  Restore from Railway backup (recommended)"
            echo "   - Go to Railway dashboard → Project → Database → Backups"
            echo "   - Restore to a point before the unknown revision"
            echo ""
            echo "2. 🔧 Create bridge migration (advanced)"
            echo "   - Only use if you understand the schema differences"
            echo "   - Requires manual schema analysis and testing"
            echo "   - Contact DBA team for assistance"
            echo ""
            echo "3. 🏥 Emergency override (not recommended)"
            echo "   - Set ALLOW_UNKNOWN_REVISION=true environment variable"
            echo "   - Only for critical production emergencies"
            echo "   - Will likely cause data corruption or loss"
            echo ""
            if [ "$ALLOW_UNKNOWN_REVISION" != "true" ]; then
                echo "❌ Deployment cancelled for safety. Resolve the revision mismatch first."
                exit 1
            else
                echo "⚠️  PROCEEDING WITH EMERGENCY OVERRIDE"
                echo "   This may cause data corruption. Monitor closely."
            fi
        else
            echo "✅ Current revision $CURRENT_REV is valid in migration chain"
        fi
    else
        echo "ℹ️  No current migration revision found (fresh database)"
    fi

    # Phase 3: Safe migration execution with locking
    echo "🔍 Phase 3: Safe migration execution..."

    # Acquire migration lock to prevent concurrent migrations
    DEPLOYMENT_ID=${DEPLOYMENT_ID:-$(date +%s)}
    LOCKER_ID=${RAILWAY_PROJECT_ID:-${HOSTNAME}}

    if ! python3 -c "
import sys
sys.path.insert(0, 'src')
from sqlalchemy import text
from core.database import get_db

try:
    with next(get_db()) as db:
        # Check if migration lock function exists (defensive programming)
        function_exists = db.execute(text('''
            SELECT EXISTS (
                SELECT 1 FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE n.nspname = 'public'
                AND p.proname = 'acquire_migration_lock'
            )
        ''')).scalar()

        if not function_exists:
            print('⚠️  Migration lock function not available (first deployment after upgrade)')
            print('   Proceeding without lock - ensure no concurrent deployments')
            exit(0)

        # Function exists, try to acquire lock
        result = db.execute(text('''
            SELECT acquire_migration_lock(:deployment_id, :locker_id)
        '''), {'deployment_id': '$DEPLOYMENT_ID', 'locker_id': '$LOCKER_ID'}).scalar()

        if result:
            print('✅ Migration lock acquired')
            exit(0)
        else:
            print('❌ Migration lock unavailable - another migration in progress')
            exit(1)
except Exception as e:
    print(f'❌ Error acquiring migration lock: {e}')
    exit(1)
    "; then
        echo "❌ CRITICAL: Cannot acquire migration lock. Another deployment may be running."
        exit 1
    fi

    # Execute migration with timeout protection
    echo "=========================================="
    echo "🔄 Executing database migrations (with safety controls)..."
    echo "=========================================="

    MIGRATION_TIMEOUT=600  # 10 minutes (Railway deployment limit)

    # Run migration in background with timeout monitoring
    (
        if alembic upgrade head 2>&1; then
            echo "MIGRATION_SUCCESS" >&3
        else
            echo "MIGRATION_FAILED" >&3
        fi
    ) 3>&1 &

    MIGRATION_PID=$!

    # Monitor migration with timeout
    SECONDS_ELAPSED=0
    while [ $SECONDS_ELAPSED -lt $MIGRATION_TIMEOUT ]; do
        if kill -0 $MIGRATION_PID 2>/dev/null; then
            # Process still running, check for completion signal
            if read -t 1 MIGRATION_STATUS 2>/dev/null; then
                if [ "$MIGRATION_STATUS" = "MIGRATION_SUCCESS" ]; then
                    echo "✅ Migration completed successfully"
                    break
                elif [ "$MIGRATION_STATUS" = "MIGRATION_FAILED" ]; then
                    echo "❌ Migration failed"
                    kill $MIGRATION_PID 2>/dev/null || true
                    release_migration_lock
                    exit 1
                fi
            fi
        else
            # Process finished - check exit code
            wait $MIGRATION_PID
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 0 ]; then
                echo "✅ Migration completed successfully"
                break
            else
                echo "❌ Migration failed with exit code $EXIT_CODE"
                release_migration_lock
                exit 1
            fi
        fi

        SECONDS_ELAPSED=$((SECONDS_ELAPSED + 1))
        sleep 1
    done

    # Check for timeout
    if [ $SECONDS_ELAPSED -ge $MIGRATION_TIMEOUT ]; then
        echo "❌ CRITICAL: Migration timeout after ${MIGRATION_TIMEOUT}s"
        echo "   This may indicate a hanging migration or Railway deployment timeout"
        kill $MIGRATION_PID 2>/dev/null || true

        echo ""
        echo "🔍 DIAGNOSTIC INFORMATION:"
        echo "   - Check Railway deployment logs for migration progress"
        echo "   - Verify migration doesn't contain long-running operations"
        echo "   - Consider splitting large migrations into smaller steps"
        echo ""

        release_migration_lock
        exit 1
    fi

    # Phase 4: Post-migration validation
    echo "🔍 Phase 4: Post-migration validation..."

    if ! python3 -c "
import sys
sys.path.insert(0, 'src')
from sqlalchemy import text, inspect
from core.database import get_db

validation_errors = []

try:
    with next(get_db()) as session:
        # Get connection from session for inspection and queries
        connection = session.connection()

        # Validation 1: Check alembic version updated
        result = connection.execute(text('SELECT version_num FROM alembic_version')).fetchone()
        if not result:
            validation_errors.append('alembic_version table is empty after migration')
        else:
            print(f'✅ Final alembic revision: {result[0]}')

        # Validation 2: Verify critical tables exist and have reasonable data
        inspector = inspect(connection)

        # Adjust validation thresholds based on environment
        import os
        is_staging = os.environ.get('RAILWAY_ENVIRONMENT_NAME') == 'staging'

        if is_staging:
            # Staging: Allow empty databases (no seed data)
            critical_checks = {
                'users': 0,        # Allow empty in staging
                'clinics': 0,      # Allow empty in staging
                'appointments': 0, # Always allow empty
            }
            print('ℹ️  Staging environment detected - allowing empty tables')
        else:
            # Production: Require minimum data for safety
            critical_checks = {
                'users': 1,        # Require at least 1 user
                'clinics': 1,      # Require at least 1 clinic
                'appointments': 0, # Always allow empty
            }
            print('ℹ️  Production environment - enforcing minimum data requirements')

        for table, min_records in critical_checks.items():
            if not inspector.has_table(table):
                validation_errors.append(f'Critical table missing: {table}')
                continue

            try:
                count = connection.execute(text(f'SELECT COUNT(*) FROM {table}')).scalar()
                if count < min_records:
                    validation_errors.append(f'Table {table} has insufficient records: {count} < {min_records}')
                else:
                    print(f'✅ Table {table}: {count} records')
            except Exception as e:
                validation_errors.append(f'Cannot query table {table}: {e}')

        # Validation 3: Test critical application queries
        critical_queries = [
            'SELECT id, name FROM clinics LIMIT 1',
            'SELECT id, email FROM users WHERE email IS NOT NULL LIMIT 1',
            'SELECT COUNT(*) FROM appointments WHERE status IN (\\'confirmed\\', \\'pending\\')'
        ]

        for query in critical_queries:
            try:
                connection.execute(text(query)).fetchone()
                print('✅ Critical query validated')
            except Exception as e:
                validation_errors.append(f'Critical query failed: {e}')

        if validation_errors:
            print('❌ Post-migration validation FAILED:')
            for error in validation_errors:
                print(f'   - {error}')
            exit(1)
        else:
            print('✅ Post-migration validation PASSED')

except Exception as e:
    print(f'❌ Post-migration validation error: {e}')
    exit(1)
    "; then
        echo "❌ CRITICAL: Post-migration validation failed"
        release_migration_lock
        exit 1
    fi

# Release migration lock (only if function exists)
    release_migration_lock

    echo "✅ All migration safety checks passed - deployment safe to proceed"


else
    echo "❌ CRITICAL: Alembic directory or config not found. Cannot proceed without migrations."
    echo "   This indicates a deployment configuration error."
    exit 1
fi

# Validate critical environment variables
echo "=========================================="
echo "🔍 Validating environment variables..."
echo "=========================================="
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable is not set" >&2
    exit 1
fi
echo "✅ DATABASE_URL is set"

# Check if we can import the main module (catches import errors early)
echo "=========================================="
echo "🔍 Testing Python imports..."
echo "=========================================="
if ! python3 -c "import sys; sys.path.insert(0, 'src'); from main import app; print('✅ Main module imports successfully')" 2>&1; then
    echo "❌ ERROR: Failed to import main module" >&2
    echo "This usually indicates:" >&2
    echo "  1. Missing Python dependencies" >&2
    echo "  2. Import errors in the code" >&2
    echo "  3. Missing environment variables required at import time" >&2
    exit 1
fi

# Check if uvicorn is available
if ! command -v uvicorn &> /dev/null; then
    echo "❌ ERROR: uvicorn command not found" >&2
    echo "This usually indicates missing dependencies. Check requirements.txt installation." >&2
    exit 1
fi

# Start the application only after successful migrations
# Railway sets PORT environment variable automatically
echo "=========================================="
echo "🚀 Starting application server..."
echo "=========================================="
PORT=${PORT:-8000}
echo "Command: uvicorn main:app --host 0.0.0.0 --port $PORT"
echo "Working directory: $(pwd)"
echo "=========================================="

# Change to src directory for uvicorn
cd src || {
    echo "❌ ERROR: Failed to change to src directory" >&2
    exit 1
}

# Start uvicorn with explicit error handling
# Use exec to replace shell process with uvicorn
# Ensure logs are flushed immediately for Railway visibility
export PYTHONUNBUFFERED=1
exec uvicorn main:app --host 0.0.0.0 --port "$PORT" --log-level info --no-access-log

