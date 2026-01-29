"""add_recurring_clinic_confirmation_message_to_appointment_types

Revision ID: f17a0ce3d06b
Revises: update_billing_amount
Create Date: 2026-01-28 14:22:27.860028

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f17a0ce3d06b'
down_revision: Union[str, None] = 'update_billing_amount'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Default message template
    default_message = """{病患姓名}，已為您建立{預約數量}個預約：

{日期範圍}

{預約列表}

【{服務項目}】{治療師姓名}

期待為您服務！"""
    
    # Get connection
    conn = op.get_bind()
    
    # Check if column exists
    result = conn.execute(sa.text("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='appointment_types' 
        AND column_name='recurring_clinic_confirmation_message'
    """)).fetchone()
    
    if not result:
        # Column doesn't exist, add it as nullable first
        op.add_column('appointment_types', 
            sa.Column('recurring_clinic_confirmation_message', 
                     sa.Text(), 
                     nullable=True))
    
    # Always populate NULL values with default (idempotent)
    conn.execute(sa.text("""
        UPDATE appointment_types 
        SET recurring_clinic_confirmation_message = :default_msg 
        WHERE recurring_clinic_confirmation_message IS NULL
    """), {"default_msg": default_message})
    
    # Make column NOT NULL (idempotent - will only change if currently nullable)
    op.alter_column('appointment_types', 'recurring_clinic_confirmation_message', nullable=False)


def downgrade() -> None:
    # Remove the recurring_clinic_confirmation_message column
    op.drop_column('appointment_types', 'recurring_clinic_confirmation_message')
