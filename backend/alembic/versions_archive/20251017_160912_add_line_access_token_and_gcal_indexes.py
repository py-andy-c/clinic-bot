"""Add LINE channel access token to clinics and indexes to appointments

Revision ID: add_line_token_gcal_indexes
Revises: 
Create Date: $(date)

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_line_token_gcal_indexes'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add line_channel_access_token to clinics table
    op.add_column('clinics', sa.Column('line_channel_access_token', sa.String(length=255), nullable=False))
    
    # Create indexes for appointments table performance
    op.create_index('idx_patient_upcoming', 'appointments', ['patient_id', 'start_time'])
    op.create_index('idx_therapist_schedule', 'appointments', ['therapist_id', 'start_time'])
    op.create_index('idx_gcal_sync', 'appointments', ['gcal_event_id'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('idx_gcal_sync', table_name='appointments')
    op.drop_index('idx_therapist_schedule', table_name='appointments')
    op.drop_index('idx_patient_upcoming', table_name='appointments')
    
    # Drop column
    op.drop_column('clinics', 'line_channel_access_token')
