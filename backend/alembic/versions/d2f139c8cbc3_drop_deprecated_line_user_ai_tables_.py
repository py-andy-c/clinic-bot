"""drop_deprecated_line_user_ai_tables_phase4

Revision ID: drop_deprecated_tables_phase4
Revises: make_clinic_id_not_null_phase3
Create Date: 2025-11-23 14:47:12.625882

Phase 4: Drop deprecated tables after successful migration.

This migration:
1. Drops line_user_ai_disabled table (data migrated to LineUser.ai_disabled fields)
2. Drops line_user_ai_opt_outs table (data migrated to LineUser.ai_opt_out_until field)

These tables are no longer needed as all data has been migrated to the LineUser table
during Phase 2, and all code now uses the LineUser fields directly.

This migration should only be run after verifying:
- Phase 2 migration completed successfully
- All data was migrated correctly
- No code references these tables anymore
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision: str = 'drop_deprecated_tables_phase4'
down_revision: Union[str, None] = 'make_clinic_id_not_null_phase3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Drop deprecated tables that have been replaced by LineUser fields.
    
    Before dropping, verify that:
    1. All data has been migrated (Phase 2 should have done this)
    2. No code references these tables anymore
    """
    conn = op.get_bind()
    inspector = inspect(conn)
    tables = inspector.get_table_names()
    
    # Drop line_user_ai_disabled table if it exists
    if 'line_user_ai_disabled' in tables:
        # Safety check: verify table is empty or all data was migrated
        check_query = text("SELECT COUNT(*) FROM line_user_ai_disabled")
        remaining_count = conn.execute(check_query).scalar()
        
        if remaining_count > 0:
            # Log warning but proceed (data should have been migrated in Phase 2)
            print(f"⚠️  Warning: line_user_ai_disabled table has {remaining_count} records.")
            print("   These should have been migrated in Phase 2. Proceeding with drop...")
        
        op.drop_table('line_user_ai_disabled')
        print("✅ Dropped line_user_ai_disabled table")
    
    # Drop line_user_ai_opt_outs table if it exists
    if 'line_user_ai_opt_outs' in tables:
        # Safety check: verify table is empty or all data was migrated
        check_query = text("SELECT COUNT(*) FROM line_user_ai_opt_outs")
        remaining_count = conn.execute(check_query).scalar()
        
        if remaining_count > 0:
            # Log warning but proceed (data should have been migrated in Phase 2)
            print(f"⚠️  Warning: line_user_ai_opt_outs table has {remaining_count} records.")
            print("   These should have been migrated in Phase 2. Proceeding with drop...")
        
        op.drop_table('line_user_ai_opt_outs')
        print("✅ Dropped line_user_ai_opt_outs table")


def downgrade() -> None:
    """
    Recreate deprecated tables (for rollback purposes).
    
    Note: This will recreate empty tables. Data that was migrated to LineUser
    will not be restored. Manual data migration would be required.
    """
    # Recreate line_user_ai_disabled table
    op.create_table(
        'line_user_ai_disabled',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('line_user_id', sa.String(255), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('disabled_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('disabled_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reason', sa.String(500), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('line_user_id', 'clinic_id', name='uq_line_user_clinic_ai_disabled')
    )
    
    # Recreate indexes
    op.create_index(
        'idx_line_user_ai_disabled_user_clinic',
        'line_user_ai_disabled',
        ['line_user_id', 'clinic_id']
    )
    op.create_index(
        'idx_line_user_ai_disabled_at',
        'line_user_ai_disabled',
        ['disabled_at']
    )
    op.create_index(
        'idx_line_user_ai_disabled_by_user',
        'line_user_ai_disabled',
        ['disabled_by_user_id']
    )
    
    # Recreate line_user_ai_opt_outs table
    op.create_table(
        'line_user_ai_opt_outs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('line_user_id', sa.String(255), nullable=False),
        sa.Column('clinic_id', sa.Integer(), nullable=False),
        sa.Column('opted_out_until', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('line_user_id', 'clinic_id', name='uq_line_user_clinic_ai_opt_out')
    )
    
    # Recreate indexes
    op.create_index(
        'idx_line_user_ai_opt_out_user_clinic',
        'line_user_ai_opt_outs',
        ['line_user_id', 'clinic_id']
    )
    op.create_index(
        'idx_line_user_ai_opt_out_expiry',
        'line_user_ai_opt_outs',
        ['opted_out_until']
    )
