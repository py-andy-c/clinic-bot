"""add_appointment_message_customization

Revision ID: add_appointment_message_customization
Revises: add_service_type_grouping
Create Date: 2025-01-28 14:00:00.000000

Add appointment message customization:
- Add send_patient_confirmation, send_clinic_confirmation, send_reminder boolean flags
- Add patient_confirmation_message, clinic_confirmation_message, reminder_message text fields
- Set existing items: send_patient_confirmation=false, others=true, populate all messages with defaults
- New items get database defaults: all toggles=true, messages populated with defaults
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = 'add_msg_customization'
down_revision: Union[str, None] = 'add_service_type_grouping'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Default messages (must match constants in core/message_template_constants.py)
DEFAULT_PATIENT_CONFIRMATION_MESSAGE = """{病患姓名}，您的預約已建立：

{預約時間} - 【{服務項目}】{治療師姓名}
{病患備註}

期待為您服務！"""

DEFAULT_CLINIC_CONFIRMATION_MESSAGE = """{病患姓名}，您的預約已建立：

{預約時間} - 【{服務項目}】{治療師姓名}
{病患備註}

期待為您服務！"""

DEFAULT_REMINDER_MESSAGE = """提醒您，您預約的【{服務項目}】預計於【{預約時間}】開始，由【{治療師姓名}】為您服務。

診所：{診所名稱}
地址：{診所地址}
電話：{診所電話}

請準時前往診所，期待為您服務！"""


def upgrade() -> None:
    """
    Add appointment message customization fields.
    
    This migration:
    1. Adds send_patient_confirmation, send_clinic_confirmation, send_reminder boolean columns
    2. Adds patient_confirmation_message, clinic_confirmation_message, reminder_message text columns
    3. Sets existing items: send_patient_confirmation=false, others=true
    4. Populates all message fields with system default text
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'appointment_types' not in tables:
        return
    
    columns = [col['name'] for col in inspector.get_columns('appointment_types')]
    
    # Step 1: Add boolean toggle columns
    if 'send_patient_confirmation' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('send_patient_confirmation', sa.Boolean(), nullable=False, server_default='true')
        )
    
    if 'send_clinic_confirmation' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('send_clinic_confirmation', sa.Boolean(), nullable=False, server_default='true')
        )
    
    if 'send_reminder' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('send_reminder', sa.Boolean(), nullable=False, server_default='true')
        )
    
    # Step 2: Add message text columns (not nullable, always populated)
    if 'patient_confirmation_message' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('patient_confirmation_message', sa.Text(), nullable=False, server_default='')
        )
    
    if 'clinic_confirmation_message' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('clinic_confirmation_message', sa.Text(), nullable=False, server_default='')
        )
    
    if 'reminder_message' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('reminder_message', sa.Text(), nullable=False, server_default='')
        )
    
    # Step 3: Update existing items
    # Set send_patient_confirmation=false (preserve current behavior - no unexpected messages)
    # Set send_clinic_confirmation=true, send_reminder=true (matches current behavior)
    # Populate all message fields with system default text
    # Update ALL existing appointment types (not just empty ones) to ensure consistency
    # Use parameterized query to avoid SQL injection and handle special characters
    conn = op.get_bind()
    conn.execute(text("""
        UPDATE appointment_types
        SET 
            send_patient_confirmation = false,
            send_clinic_confirmation = true,
            send_reminder = true,
            patient_confirmation_message = :patient_msg,
            clinic_confirmation_message = :clinic_msg,
            reminder_message = :reminder_msg
        WHERE 
            is_deleted = false OR is_deleted IS NULL
    """), {
        'patient_msg': DEFAULT_PATIENT_CONFIRMATION_MESSAGE,
        'clinic_msg': DEFAULT_CLINIC_CONFIRMATION_MESSAGE,
        'reminder_msg': DEFAULT_REMINDER_MESSAGE
    })


def downgrade() -> None:
    """Remove appointment message customization fields."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'appointment_types' not in tables:
        return
    
    columns = [col['name'] for col in inspector.get_columns('appointment_types')]
    
    # Remove message columns
    if 'reminder_message' in columns:
        op.drop_column('appointment_types', 'reminder_message')
    
    if 'clinic_confirmation_message' in columns:
        op.drop_column('appointment_types', 'clinic_confirmation_message')
    
    if 'patient_confirmation_message' in columns:
        op.drop_column('appointment_types', 'patient_confirmation_message')
    
    # Remove toggle columns
    if 'send_reminder' in columns:
        op.drop_column('appointment_types', 'send_reminder')
    
    if 'send_clinic_confirmation' in columns:
        op.drop_column('appointment_types', 'send_clinic_confirmation')
    
    if 'send_patient_confirmation' in columns:
        op.drop_column('appointment_types', 'send_patient_confirmation')

