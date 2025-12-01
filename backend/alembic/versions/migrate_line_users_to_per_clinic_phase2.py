"""migrate_line_users_to_per_clinic_phase2

Revision ID: migrate_line_users_per_clinic_phase2
Revises: add_clinic_id_line_users_phase1
Create Date: 2025-01-XX XX:XX:XX.XXXXXX

Phase 2: Data migration to duplicate LineUser entries per clinic.

This migration:
1. For each existing LineUser (with clinic_id = NULL):
   - Finds all clinics the user interacts with (via Patient or LineMessage)
   - Creates duplicate LineUser entries, one per clinic
   - Migrates AI settings from line_user_ai_disabled and line_user_ai_opt_outs
   - Updates Patient records to reference the correct clinic-specific LineUser
2. After migration, all LineUsers should have clinic_id set

This is a data migration that must run after Phase 1 schema changes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision: str = 'migrate_line_users_phase2'
down_revision: Union[str, None] = 'add_clinic_id_phase1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Migrate existing LineUser entries to per-clinic duplicates.
    
    For each LineUser without clinic_id:
    1. Find all clinics they interact with
    2. Create duplicate entries per clinic
    3. Migrate settings
    4. Update Patient references
    """
    conn = op.get_bind()
    inspector = inspect(conn)
    tables = inspector.get_table_names()
    
    # Check which tables exist
    has_ai_disabled_table = 'line_user_ai_disabled' in tables
    has_ai_opt_outs_table = 'line_user_ai_opt_outs' in tables
    
    # Step 1: Find all LineUsers that need migration (clinic_id is NULL)
    # and get their associated clinics from multiple sources
    # Build query dynamically based on which tables exist
    query_parts = [
        """-- Clinics from Patient records
            SELECT DISTINCT 
                lu.id as old_line_user_id,
                lu.line_user_id as line_user_id_string,
                p.clinic_id
            FROM line_users lu
            INNER JOIN patients p ON p.line_user_id = lu.id
            WHERE lu.clinic_id IS NULL
              AND p.is_deleted = false""",
        
        """-- Clinics from LineMessage records
            SELECT DISTINCT
                lu.id as old_line_user_id,
                lu.line_user_id as line_user_id_string,
                lm.clinic_id
            FROM line_users lu
            INNER JOIN line_messages lm ON lm.line_user_id = lu.line_user_id
            WHERE lu.clinic_id IS NULL"""
    ]
    
    if has_ai_disabled_table:
        query_parts.append("""-- Clinics from line_user_ai_disabled (users who only have settings, no patients/messages)
            SELECT DISTINCT
                lu.id as old_line_user_id,
                lu.line_user_id as line_user_id_string,
                luad.clinic_id
            FROM line_users lu
            INNER JOIN line_user_ai_disabled luad ON luad.line_user_id = lu.line_user_id
            WHERE lu.clinic_id IS NULL""")
    
    if has_ai_opt_outs_table:
        query_parts.append("""-- Clinics from line_user_ai_opt_outs (users who only have opt-out, no patients/messages)
            SELECT DISTINCT
                lu.id as old_line_user_id,
                lu.line_user_id as line_user_id_string,
                luo.clinic_id
            FROM line_users lu
            INNER JOIN line_user_ai_opt_outs luo ON luo.line_user_id = lu.line_user_id
            WHERE lu.clinic_id IS NULL""")
    
    migration_query_sql = f"""
        WITH user_clinics AS (
            {' UNION '.join(query_parts)}
        )
        SELECT DISTINCT
            uc.old_line_user_id,
            uc.clinic_id,
            uc.line_user_id_string,
            lu.display_name,
            lu.preferred_language
        FROM user_clinics uc
        INNER JOIN line_users lu ON lu.id = uc.old_line_user_id
        ORDER BY uc.old_line_user_id, uc.clinic_id
    """
    
    migration_query = text(migration_query_sql)
    result = conn.execute(migration_query)
    user_clinic_pairs = result.fetchall()
    
    if not user_clinic_pairs:
        # No data to migrate
        return
    
    # Step 2: For each (line_user, clinic) pair, create new LineUser entry
    for row in user_clinic_pairs:
        old_line_user_id = int(row[0])  # The old LineUser.id
        clinic_id = int(row[1])
        line_user_id_string = str(row[2])
        display_name = row[3]
        preferred_language = row[4]
        
        # Check if LineUser for this clinic already exists
        check_query = text("""
            SELECT id FROM line_users 
            WHERE line_user_id = :line_user_id_string 
              AND clinic_id = :clinic_id
        """)
        existing = conn.execute(
            check_query,
            {"line_user_id_string": line_user_id_string, "clinic_id": clinic_id}
        ).first()
        
        if existing:
            # Already migrated, skip
            continue
        
        # Get AI disabled settings from line_user_ai_disabled table (if it exists)
        ai_disabled_row = None
        if has_ai_disabled_table:
            ai_disabled_query = text("""
                SELECT disabled_at, disabled_by_user_id, reason
                FROM line_user_ai_disabled
                WHERE line_user_id = :line_user_id_string
                  AND clinic_id = :clinic_id
                LIMIT 1
            """)
            ai_disabled_row = conn.execute(
                ai_disabled_query,
                {"line_user_id_string": line_user_id_string, "clinic_id": clinic_id}
            ).first()
        
        # Get AI opt-out settings from line_user_ai_opt_outs table (if it exists)
        ai_opt_out_row = None
        if has_ai_opt_outs_table:
            ai_opt_out_query = text("""
                SELECT opted_out_until
                FROM line_user_ai_opt_outs
                WHERE line_user_id = :line_user_id_string
                  AND clinic_id = :clinic_id
                LIMIT 1
            """)
            ai_opt_out_row = conn.execute(
                ai_opt_out_query,
                {"line_user_id_string": line_user_id_string, "clinic_id": clinic_id}
            ).first()
        
        # Prepare AI disabled values
        ai_disabled = ai_disabled_row is not None
        ai_disabled_at = ai_disabled_row[0] if ai_disabled_row else None
        ai_disabled_by_user_id = ai_disabled_row[1] if ai_disabled_row else None
        ai_disabled_reason = ai_disabled_row[2] if ai_disabled_row else None
        ai_opt_out_until = ai_opt_out_row[0] if ai_opt_out_row else None
        
        # Create new LineUser entry for this clinic
        insert_query = text("""
            INSERT INTO line_users (
                line_user_id,
                clinic_id,
                display_name,
                preferred_language,
                ai_disabled,
                ai_disabled_at,
                ai_disabled_by_user_id,
                ai_disabled_reason,
                ai_opt_out_until
            ) VALUES (
                :line_user_id_string,
                :clinic_id,
                :display_name,
                :preferred_language,
                :ai_disabled,
                :ai_disabled_at,
                :ai_disabled_by_user_id,
                :ai_disabled_reason,
                :ai_opt_out_until
            )
            RETURNING id
        """)
        
        new_line_user_result = conn.execute(
            insert_query,
            {
                "line_user_id_string": line_user_id_string,
                "clinic_id": clinic_id,
                "display_name": display_name,
                "preferred_language": preferred_language,
                "ai_disabled": ai_disabled,
                "ai_disabled_at": ai_disabled_at,
                "ai_disabled_by_user_id": ai_disabled_by_user_id,
                "ai_disabled_reason": ai_disabled_reason,
                "ai_opt_out_until": ai_opt_out_until,
            }
        )
        new_line_user_id = new_line_user_result.scalar()
        
        # Step 3: Update Patient records to point to new clinic-specific LineUser
        update_patients_query = text("""
            UPDATE patients
            SET line_user_id = :new_line_user_id
            WHERE line_user_id = :old_line_user_id
              AND clinic_id = :clinic_id
              AND is_deleted = false
        """)
        conn.execute(
            update_patients_query,
            {
                "new_line_user_id": new_line_user_id,
                "old_line_user_id": old_line_user_id,
                "clinic_id": clinic_id
            }
        )
    
    # Step 4: Delete old LineUser entries that have been migrated
    # (Only delete if they have no patients pointing to them)
    # Note: We keep old entries that still have patients pointing to them
    # These will be cleaned up after all Patient records are updated
    delete_old_query = text("""
        DELETE FROM line_users
        WHERE clinic_id IS NULL
          AND id NOT IN (
              SELECT DISTINCT COALESCE(line_user_id, 0) FROM patients WHERE line_user_id IS NOT NULL
          )
    """)
    conn.execute(delete_old_query)
    
    # Note: Alembic handles transaction commit automatically


def downgrade() -> None:
    """
    Revert migration by consolidating per-clinic LineUsers back to single entries.
    
    This is complex and may lose data if multiple clinics had different settings.
    For safety, this downgrade is not fully implemented - manual intervention required.
    """
    # Note: Downgrade is complex and may lose per-clinic customizations.
    # In practice, this migration should not be rolled back.
    # If rollback is needed, manual data consolidation is required.
    pass

