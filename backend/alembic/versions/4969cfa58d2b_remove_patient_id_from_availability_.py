"""remove_patient_id_from_availability_notifications

Revision ID: 4969cfa58d2b
Revises: 4df1ea3c02d0
Create Date: 2025-01-27 12:00:00.000000

Remove patient_id from availability_notifications table.
Notifications are now tracked per LINE user only, not per patient.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4969cfa58d2b'
down_revision: Union[str, None] = '4df1ea3c02d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Remove patient_id column and update indexes.
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'availability_notifications' not in tables:
        print("availability_notifications table does not exist, skipping migration")
        return
    
    # Check if patient_id column exists
    columns = [col['name'] for col in inspector.get_columns('availability_notifications')]
    if 'patient_id' not in columns:
        print("patient_id column does not exist, skipping removal")
        return
    
    # Drop foreign key constraint
    op.drop_constraint('fk_availability_notifications_patient_id', 'availability_notifications', type_='foreignkey')
    
    # Drop old indexes
    op.drop_index('idx_notification_lookup', table_name='availability_notifications')
    op.drop_index('idx_notification_user', table_name='availability_notifications')
    
    # Drop patient_id column
    op.drop_column('availability_notifications', 'patient_id')
    
    # Recreate indexes with updated columns
    op.create_index(
        'idx_notification_lookup',
        'availability_notifications',
        ['clinic_id', 'appointment_type_id', 'date', 'practitioner_id', 'status']
    )
    
    op.create_index(
        'idx_notification_user',
        'availability_notifications',
        ['line_user_id', 'clinic_id', 'status']
    )


def downgrade() -> None:
    """
    Restore patient_id column and old indexes.
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'availability_notifications' not in tables:
        print("availability_notifications table does not exist, skipping downgrade")
        return
    
    # Check if patient_id column already exists
    columns = [col['name'] for col in inspector.get_columns('availability_notifications')]
    if 'patient_id' in columns:
        print("patient_id column already exists, skipping restoration")
        return
    
    # Drop new indexes
    op.drop_index('idx_notification_user', table_name='availability_notifications')
    op.drop_index('idx_notification_lookup', table_name='availability_notifications')
    
    # Add patient_id column back
    op.add_column('availability_notifications', sa.Column('patient_id', sa.Integer(), nullable=False, server_default='1'))
    
    # Recreate foreign key constraint
    op.create_foreign_key(
        'fk_availability_notifications_patient_id',
        'availability_notifications',
        'patients',
        ['patient_id'],
        ['id']
    )
    
    # Recreate old indexes
    op.create_index(
        'idx_notification_user',
        'availability_notifications',
        ['line_user_id', 'status']
    )
    
    op.create_index(
        'idx_notification_lookup',
        'availability_notifications',
        ['clinic_id', 'appointment_type_id', 'date', 'status']
    )
