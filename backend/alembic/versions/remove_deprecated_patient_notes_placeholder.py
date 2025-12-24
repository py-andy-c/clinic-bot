"""remove_deprecated_patient_notes_placeholder

Revision ID: remove_deprecated_patient_notes_placeholder
Revises: add_gender_to_patients
Create Date: 2025-01-31 12:00:00.000000

Remove deprecated {病患備註} placeholder from existing appointment type message templates.
This placeholder was deprecated and always renders as empty, causing blank lines in messages.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = 'remove_deprecated_patient_notes_placeholder'
down_revision: Union[str, None] = 'add_gender_to_patients'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Remove deprecated {病患備註} placeholder from appointment type message templates.
    
    This migration:
    1. Removes {病患備註} and its surrounding newlines from patient_confirmation_message
    2. Removes {病患備註} and its surrounding newlines from clinic_confirmation_message
    3. Reminder messages don't have this placeholder, so no changes needed
    
    The placeholder was deprecated because it always renders as empty, causing
    blank lines in rendered messages. This migration cleans up existing templates
    to match the current default templates in message_template_constants.py.
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'appointment_types' not in tables:
        return
    
    columns = [col['name'] for col in inspector.get_columns('appointment_types')]
    
    # Check if message columns exist
    if 'patient_confirmation_message' not in columns or 'clinic_confirmation_message' not in columns:
        return
    
    # Remove {病患備註} placeholder and clean up surrounding whitespace
    # Handle multiple patterns:
    # 1. \n{病患備註}\n (most common - from original migration) -> replace with \n
    # 2. \n{病患備註} (at start of line) -> remove
    # 3. {病患備註}\n (at end of line) -> remove
    # 4. {病患備註} (standalone, no newlines) -> remove
    # Order matters: replace most specific patterns first
    
    # For patient_confirmation_message
    conn.execute(text("""
        UPDATE appointment_types
        SET patient_confirmation_message = REPLACE(
            REPLACE(
                REPLACE(
                    REPLACE(
                        patient_confirmation_message,
                        E'\\n{病患備註}\\n',
                        E'\\n'
                    ),
                    E'\\n{病患備註}',
                    ''
                ),
                E'{病患備註}\\n',
                ''
            ),
            '{病患備註}',
            ''
        )
        WHERE patient_confirmation_message LIKE '%{病患備註}%'
    """))
    
    # For clinic_confirmation_message
    conn.execute(text("""
        UPDATE appointment_types
        SET clinic_confirmation_message = REPLACE(
            REPLACE(
                REPLACE(
                    REPLACE(
                        clinic_confirmation_message,
                        E'\\n{病患備註}\\n',
                        E'\\n'
                    ),
                    E'\\n{病患備註}',
                    ''
                ),
                E'{病患備註}\\n',
                ''
            ),
            '{病患備註}',
            ''
        )
        WHERE clinic_confirmation_message LIKE '%{病患備註}%'
    """))


def downgrade() -> None:
    """
    Re-add {病患備註} placeholder to message templates.
    
    Note: This is a best-effort restoration. The exact position may not match
    the original, but the placeholder will be added back in a reasonable location.
    """
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'appointment_types' not in tables:
        return
    
    columns = [col['name'] for col in inspector.get_columns('appointment_types')]
    
    if 'patient_confirmation_message' not in columns or 'clinic_confirmation_message' not in columns:
        return
    
    # Re-add {病患備註} placeholder after the appointment details line
    # Pattern: Insert \n{病患備註}\n after the line with {預約時間} - 【{服務項目}】{治療師姓名}
    conn.execute(text("""
        UPDATE appointment_types
        SET patient_confirmation_message = REPLACE(
            patient_confirmation_message,
            E'\\n{預約時間} - 【{服務項目}】{治療師姓名}\\n',
            E'\\n{預約時間} - 【{服務項目}】{治療師姓名}\\n{病患備註}\\n'
        )
        WHERE patient_confirmation_message NOT LIKE '%{病患備註}%'
          AND patient_confirmation_message LIKE '%{預約時間} - 【{服務項目}】{治療師姓名}%'
    """))
    
    conn.execute(text("""
        UPDATE appointment_types
        SET clinic_confirmation_message = REPLACE(
            clinic_confirmation_message,
            E'\\n{預約時間} - 【{服務項目}】{治療師姓名}\\n',
            E'\\n{預約時間} - 【{服務項目}】{治療師姓名}\\n{病患備註}\\n'
        )
        WHERE clinic_confirmation_message NOT LIKE '%{病患備註}%'
          AND clinic_confirmation_message LIKE '%{預約時間} - 【{服務項目}】{治療師姓名}%'
    """))

