"""add_recurrent_appointment_message_customization

Revision ID: 202601281728
Revises: update_billing_amount
Create Date: 2026-01-28 17:28:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = '202601281728'
down_revision: Union[str, None] = 'update_billing_amount'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Default message (must match constant in core/message_template_constants.py)
DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE = """{病患姓名}，已為您建立 {預約數量} 個預約：

{預約日期範圍}
{預約時段列表}

【{服務項目}】{治療師姓名}

期待為您服務！"""


def upgrade() -> None:
    """Add recurrent appointment message customization fields."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'appointment_types' not in tables:
        return
    
    columns = [col['name'] for col in inspector.get_columns('appointment_types')]

    # Step 1: Add boolean toggle column (conditional)
    if 'send_recurrent_clinic_confirmation' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('send_recurrent_clinic_confirmation', sa.Boolean(), nullable=False, server_default='true')
        )
    
    # Step 2: Add message text column (conditional)
    if 'recurrent_clinic_confirmation_message' not in columns:
        op.add_column(
            'appointment_types',
            sa.Column('recurrent_clinic_confirmation_message', sa.Text(), nullable=False, server_default='')
        )
    
    # Step 3: Populate existing records with default message
    # Even if columns existed (from baseline create_all), we still want to ensure they are populated
    conn.execute(text("""
        UPDATE appointment_types
        SET recurrent_clinic_confirmation_message = :message
        WHERE recurrent_clinic_confirmation_message IS NULL OR recurrent_clinic_confirmation_message = ''
    """), {"message": DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE})


def downgrade() -> None:
    """Remove recurrent appointment message customization fields."""
    op.drop_column('appointment_types', 'recurrent_clinic_confirmation_message')
    op.drop_column('appointment_types', 'send_recurrent_clinic_confirmation')
