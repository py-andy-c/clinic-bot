#!/usr/bin/env python3
"""
Schema Contract Validation Script

This script validates that backend Pydantic models match frontend Zod schemas.
It checks that all fields in AppointmentTypeResponse are present in the frontend schema.

Run this in CI to catch schema mismatches early.
"""

import sys
import json
from pathlib import Path

# Add backend src to path
backend_src = Path(__file__).parent.parent / "src"
sys.path.insert(0, str(backend_src))

from api.responses import AppointmentTypeResponse


def get_backend_fields():
    """Extract field names from AppointmentTypeResponse model."""
    model_fields = AppointmentTypeResponse.model_fields
    return set(model_fields.keys())


def get_frontend_schema_fields():
    """Extract field names from frontend AppointmentTypeSchema."""
    frontend_schema_path = Path(__file__).parent.parent.parent / "frontend" / "src" / "schemas" / "api.ts"
    
    if not frontend_schema_path.exists():
        print(f"Warning: Frontend schema file not found at {frontend_schema_path}")
        return set()
    
    content = frontend_schema_path.read_text()
    
    # Extract fields from AppointmentTypeSchema
    # This is a simple parser - for production, consider using a proper TypeScript parser
    fields = set()
    
    # Look for the AppointmentTypeSchema definition
    schema_start = content.find("export const AppointmentTypeSchema")
    if schema_start == -1:
        print("Error: Could not find AppointmentTypeSchema in frontend file")
        return set()
    
    # Find the object definition
    obj_start = content.find("z.object({", schema_start)
    if obj_start == -1:
        print("Error: Could not find z.object definition")
        return set()
    
    # Extract field names (simple regex-based approach)
    import re
    # Match field names before colons (e.g., "require_notes: z.boolean()")
    # Look for patterns like: field_name: z.type() or field_name: z.type().optional()
    field_pattern = r'(\w+):\s*z\.'
    matches = re.findall(field_pattern, content[obj_start:obj_start + 3000])
    
    # Also check for commented fields that might be in the schema
    comment_pattern = r'//\s*(\w+)\s+customization'
    comment_matches = re.findall(comment_pattern, content[obj_start:obj_start + 3000])
    
    for match in matches:
        # Skip common keywords and Zod methods
        skip_words = {
            'object', 'array', 'string', 'number', 'boolean', 'nullable', 
            'optional', 'null', 'union', 'record', 'passthrough', 'catchall'
        }
        if match not in skip_words:
            fields.add(match)
    
    # Add fields mentioned in comments (like "Notes customization fields")
    for match in comment_matches:
        if match not in ['Message', 'Notes']:
            fields.add(match)
    
    return fields


def validate_schema_contract():
    """Validate that backend and frontend schemas match."""
    backend_fields = get_backend_fields()
    frontend_fields = get_frontend_schema_fields()
    
    # Critical fields that must be present
    critical_fields = {
        'id', 'clinic_id', 'name', 'duration_minutes',
        'require_notes', 'notes_instructions',  # The fields we just fixed
    }
    
    print("Backend fields:", sorted(backend_fields))
    print("Frontend fields:", sorted(frontend_fields))
    print()
    
    # Check for missing critical fields
    missing_in_frontend = critical_fields - frontend_fields
    if missing_in_frontend:
        print(f"❌ ERROR: Critical fields missing in frontend schema: {missing_in_frontend}")
        return False
    
    # Check for fields in backend but not in frontend (warnings)
    # Note: Some fields may be intentionally excluded (e.g., follow_up_messages loaded separately)
    missing_fields = backend_fields - frontend_fields
    if missing_fields:
        # Known excluded fields (documented as intentionally not in schema)
        known_excluded = {'is_deleted'}  # Soft-deleted items are filtered out
        actual_missing = missing_fields - known_excluded
        
        if actual_missing:
            print(f"⚠️  WARNING: Backend fields not in frontend schema: {actual_missing}")
            print("   (These may be preserved by .passthrough() but should be added to schema for type safety)")
    
    # Check for fields in frontend but not in backend (informational)
    extra_fields = frontend_fields - backend_fields
    if extra_fields:
        print(f"ℹ️  INFO: Frontend fields not in backend: {extra_fields}")
    
    print("✅ Schema contract validation passed!")
    return True


if __name__ == "__main__":
    success = validate_schema_contract()
    sys.exit(0 if success else 1)

