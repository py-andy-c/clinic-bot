"""add_service_management_bulk_query_indexes

Revision ID: 80600facb4be
Revises: 33347da59d16
Create Date: 2026-01-08 01:00:26.944830

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '80600facb4be'
down_revision: Union[str, None] = '33347da59d16'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add indexes required for service management bulk query performance.

    These indexes optimize the complex JOIN query in ServiceManagementService.get_service_management_data()
    which loads all service data in a single query instead of multiple N+1 operations.

    Required indexes based on design document:
    - appointment_types(clinic_id, display_order) - For clinic-specific ordering and filtering
    - practitioner_appointment_types(appointment_type_id, practitioner_id) - For association queries
    - billing_scenarios(appointment_type_id, practitioner_id) - For association queries
    - appointment_resource_requirements(appointment_type_id) - For resource associations
    - follow_up_messages(appointment_type_id) - For message associations
    """
    conn = op.get_bind()
    inspector = inspect(conn)

    # Index 1: appointment_types(clinic_id, display_order)
    indexes = [idx['name'] for idx in inspector.get_indexes('appointment_types')]
    if 'idx_appointment_types_clinic_display_order' not in indexes:
        op.create_index(
            'idx_appointment_types_clinic_display_order',
            'appointment_types',
            ['clinic_id', 'display_order'],
            unique=False
        )

    # Index 2: practitioner_appointment_types(appointment_type_id, practitioner_id)
    indexes = [idx['name'] for idx in inspector.get_indexes('practitioner_appointment_types')]
    if 'idx_practitioner_appointment_types_appt_pract' not in indexes:
        op.create_index(
            'idx_practitioner_appointment_types_appt_pract',
            'practitioner_appointment_types',
            ['appointment_type_id', 'user_id'],  # Note: user_id is the practitioner
            unique=False
        )

    # Index 3: billing_scenarios(appointment_type_id, practitioner_id)
    indexes = [idx['name'] for idx in inspector.get_indexes('billing_scenarios')]
    if 'idx_billing_scenarios_appt_pract' not in indexes:
        op.create_index(
            'idx_billing_scenarios_appt_pract',
            'billing_scenarios',
            ['appointment_type_id', 'practitioner_id'],
            unique=False
        )

    # Index 4: appointment_resource_requirements(appointment_type_id)
    indexes = [idx['name'] for idx in inspector.get_indexes('appointment_resource_requirements')]
    if 'idx_appointment_resource_requirements_appt' not in indexes:
        op.create_index(
            'idx_appointment_resource_requirements_appt',
            'appointment_resource_requirements',
            ['appointment_type_id'],
            unique=False
        )

    # Index 5: follow_up_messages(appointment_type_id)
    indexes = [idx['name'] for idx in inspector.get_indexes('follow_up_messages')]
    if 'idx_follow_up_messages_appt' not in indexes:
        op.create_index(
            'idx_follow_up_messages_appt',
            'follow_up_messages',
            ['appointment_type_id'],
            unique=False
        )


def downgrade() -> None:
    """Remove the service management bulk query indexes."""
    conn = op.get_bind()
    inspector = inspect(conn)

    # Remove indexes if they exist (defensive programming)
    indexes = [idx['name'] for idx in inspector.get_indexes('appointment_types')]
    if 'idx_appointment_types_clinic_display_order' in indexes:
        op.drop_index('idx_appointment_types_clinic_display_order', table_name='appointment_types')

    indexes = [idx['name'] for idx in inspector.get_indexes('practitioner_appointment_types')]
    if 'idx_practitioner_appointment_types_appt_pract' in indexes:
        op.drop_index('idx_practitioner_appointment_types_appt_pract', table_name='practitioner_appointment_types')

    indexes = [idx['name'] for idx in inspector.get_indexes('billing_scenarios')]
    if 'idx_billing_scenarios_appt_pract' in indexes:
        op.drop_index('idx_billing_scenarios_appt_pract', table_name='billing_scenarios')

    indexes = [idx['name'] for idx in inspector.get_indexes('appointment_resource_requirements')]
    if 'idx_appointment_resource_requirements_appt' in indexes:
        op.drop_index('idx_appointment_resource_requirements_appt', table_name='appointment_resource_requirements')

    indexes = [idx['name'] for idx in inspector.get_indexes('follow_up_messages')]
    if 'idx_follow_up_messages_appt' in indexes:
        op.drop_index('idx_follow_up_messages_appt', table_name='follow_up_messages')
