"""cleanup_practitioner_daily_scheduled_messages

Revision ID: cleanup_practitioner_daily
Revises: migrate_admin_reminder_time
Create Date: 2025-01-30 15:01:00.000000

Mark existing practitioner_daily ScheduledLineMessage entries as skipped.

This is a one-time data migration to mark all pending practitioner_daily messages
as skipped since we've migrated to hourly check (real-time aggregation) instead
of pre-scheduling.

This migration runs AFTER the code deployment that removes PractitionerNotificationSchedulingService.

Migration logic:
- Find all ScheduledLineMessage entries with:
  - message_type = 'practitioner_daily'
  - status = 'pending'
- Mark them as status = 'skipped'

This preserves audit trail while preventing them from being sent by the old
scheduled message scheduler.

This migration is idempotent - it only updates records with status = 'pending',
so it's safe to run multiple times.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = 'cleanup_practitioner_daily'
down_revision: Union[str, None] = 'migrate_admin_reminder_time'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Mark all pending practitioner_daily ScheduledLineMessage entries as skipped.
    
    This migration:
    1. Finds all ScheduledLineMessage entries with message_type = 'practitioner_daily' and status = 'pending'
    2. Updates their status to 'skipped'
    
    This preserves audit trail while preventing them from being sent by the old
    scheduled message scheduler.
    
    This is idempotent - only updates records with status = 'pending'.
    """
    conn = op.get_bind()
    
    # Mark all pending practitioner_daily messages as skipped
    update_query = text("""
        UPDATE scheduled_line_messages
        SET status = 'skipped'
        WHERE 
            message_type = 'practitioner_daily'
            AND status = 'pending'
    """)
    
    result = conn.execute(update_query)
    updated_count = result.rowcount
    
    print(f"✅ Marked {updated_count} pending practitioner_daily messages as skipped")
    
    # Validate migration: check if any pending messages remain
    # (This is informational only - migration is idempotent)
    validation_query = text("""
        SELECT COUNT(*)
        FROM scheduled_line_messages
        WHERE 
            message_type = 'practitioner_daily'
            AND status = 'pending'
    """)
    
    remaining_count = conn.execute(validation_query).scalar()
    
    if remaining_count > 0:
        print(f"⚠️  Note: {remaining_count} practitioner_daily messages still have status = 'pending'")
        print("   These may have been created after the migration ran")
    else:
        print("✅ All pending practitioner_daily messages have been marked as skipped")


def downgrade() -> None:
    """
    Revert skipped practitioner_daily messages back to pending.
    
    Note: This is a destructive operation that restores messages to pending status.
    This should only be used if reverting the entire unified notification feature.
    
    Warning: If the old PractitionerNotificationSchedulingService is restored,
    these messages will be sent, which may cause duplicate notifications.
    """
    conn = op.get_bind()
    
    # Revert skipped practitioner_daily messages back to pending
    # Only revert messages that were skipped (not other statuses)
    revert_query = text("""
        UPDATE scheduled_line_messages
        SET status = 'pending'
        WHERE 
            message_type = 'practitioner_daily'
            AND status = 'skipped'
    """)
    
    result = conn.execute(revert_query)
    reverted_count = result.rowcount
    
    print(f"Reverted {reverted_count} skipped practitioner_daily messages back to pending status")
    print("⚠️  Warning: If PractitionerNotificationSchedulingService is restored, these messages will be sent")

