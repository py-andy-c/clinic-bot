"""add_cascade_delete_to_practitioner_appointment_types

Revision ID: 61cdb3d6fde6
Revises: b7745d01aa46
Create Date: 2025-11-04 00:44:19.894314

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '61cdb3d6fde6'
down_revision: Union[str, None] = 'b7745d01aa46'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if CASCADE DELETE is already applied
    conn = op.get_bind()
    result = conn.execute(sa.text("PRAGMA foreign_key_list(practitioner_appointment_types)")).fetchall()

    # Look for the foreign key to appointment_types with CASCADE DELETE
    cascade_applied = any(
        row[3] == 'appointment_types' and row[6] == 'CASCADE'
        for row in result
    )

    if not cascade_applied:
        # For SQLite, we need to recreate the table with CASCADE DELETE
        # This only runs if CASCADE DELETE is not already applied
        op.execute("CREATE TABLE practitioner_appointment_types_backup AS SELECT * FROM practitioner_appointment_types")
        op.drop_table('practitioner_appointment_types')

        op.create_table('practitioner_appointment_types',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('appointment_type_id', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.TIMESTAMP(), nullable=False),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.ForeignKeyConstraint(['appointment_type_id'], ['appointment_types.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'appointment_type_id', name='uq_practitioner_type')
        )

        op.execute("INSERT INTO practitioner_appointment_types SELECT * FROM practitioner_appointment_types_backup")
        op.drop_table('practitioner_appointment_types_backup')

        op.create_index('ix_practitioner_appointment_types_id', 'practitioner_appointment_types', ['id'])
        op.create_index('idx_practitioner_types_user', 'practitioner_appointment_types', ['user_id'])
        op.create_index('idx_practitioner_types_type', 'practitioner_appointment_types', ['appointment_type_id'])


def downgrade() -> None:
    # Recreate table without CASCADE DELETE
    # Backup existing data
    op.execute("CREATE TABLE practitioner_appointment_types_backup AS SELECT * FROM practitioner_appointment_types")

    op.drop_table('practitioner_appointment_types')

    op.create_table('practitioner_appointment_types',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('appointment_type_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['appointment_type_id'], ['appointment_types.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'appointment_type_id', name='uq_practitioner_type')
    )

    # Restore data
    op.execute("INSERT INTO practitioner_appointment_types SELECT * FROM practitioner_appointment_types_backup")

    # Drop backup table
    op.drop_table('practitioner_appointment_types_backup')

    # Recreate indexes
    op.create_index('ix_practitioner_appointment_types_id', 'practitioner_appointment_types', ['id'])
    op.create_index('idx_practitioner_types_user', 'practitioner_appointment_types', ['user_id'])
    op.create_index('idx_practitioner_types_type', 'practitioner_appointment_types', ['appointment_type_id'])
