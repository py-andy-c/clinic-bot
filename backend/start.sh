#!/bin/bash
set -e

# Railway deployment startup script
# Ensures proper directory structure and runs migrations before starting the app
# Best practice: Fail fast if migrations fail - do not start app with inconsistent schema

# Ensure we're in the backend directory (where alembic.ini is)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Fix alembic directory structure if Nixpacks flattened it
# This handles a known Nixpacks quirk where subdirectories may be flattened
if [ ! -d "alembic" ] && [ -f "alembic.ini" ]; then
    if [ -f "env.py" ] || [ -d "versions" ]; then
        echo "Fixing alembic directory structure..."
        mkdir -p alembic
        [ -f "env.py" ] && mv env.py alembic/ || true
        [ -f "script.py.mako" ] && mv script.py.mako alembic/ || true
        [ -d "versions" ] && [ ! -d "alembic/versions" ] && mv versions alembic/ || true
    fi
fi

# Run database migrations - CRITICAL: Must succeed before starting app
if [ -d "alembic" ] && [ -f "alembic.ini" ]; then
    # Check if database is fresh (no alembic_version table)
    if ! alembic current 2>&1 | grep -q "alembic_version"; then
        echo "Fresh database detected - creating initial schema..."
        cd src
        # Create tables from models - exit on failure
        # IMPORTANT: Must import all models before calling create_all()
        if ! python -c "
from core.database import Base, engine
from core.config import DATABASE_URL
# Import all models to register them with Base.metadata
from models import (
    Clinic, User, SignupToken, RefreshToken, Patient, LineUser,
    Appointment, AppointmentType, PractitionerAvailability,
    CalendarEvent, AvailabilityException, PractitionerAppointmentTypes
)
import sys
print(f'Creating tables in: {DATABASE_URL}')
try:
    # Now all models are registered, create_all() will create all tables
    Base.metadata.create_all(bind=engine)
    print('Tables created successfully')
except Exception as e:
    print(f'ERROR: Failed to create tables: {e}', file=sys.stderr)
    sys.exit(1)
"; then
            echo "ERROR: Failed to create database tables. Aborting startup." >&2
            exit 1
        fi
        cd ..
        
        # Run migrations to ensure schema is up to date with all migrations
        # This ensures any migrations that modify existing tables are applied
        echo "Running migrations to ensure schema is up to date..."
        if ! alembic upgrade head; then
            echo "ERROR: Failed to run migrations. Aborting startup." >&2
            exit 1
        fi
    else
        # Run incremental migrations - exit on failure
        echo "Running migrations..."
        if ! alembic upgrade head; then
            echo "ERROR: Database migrations failed. Aborting startup." >&2
            echo "The application will not start with an inconsistent database schema." >&2
            exit 1
        fi
        echo "Migrations completed successfully"
    fi
else
    echo "ERROR: Alembic directory or config not found. Cannot proceed without migrations." >&2
    echo "This is a critical error - migrations are required for database consistency." >&2
    exit 1
fi

# Start the application only after successful migrations
# Railway sets PORT environment variable automatically
echo "Starting application..."
cd src
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"

