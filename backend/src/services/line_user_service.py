"""
LINE user service for proactive user management.

This service handles creating and managing LINE user entries from webhook events,
ensuring users are registered as soon as they interact with the clinic's official account.
"""

import logging
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import LineUser
from services.line_service import LINEService

logger = logging.getLogger(__name__)


class LineUserService:
    """
    Service for managing LINE user entries.
    
    Handles creation and updates of LineUser records from webhook events,
    with proper race condition handling and profile fetching.
    """

    @staticmethod
    def get_or_create_line_user(
        db: Session,
        line_user_id: str,
        line_service: LINEService,
        display_name: Optional[str] = None
    ) -> LineUser:
        """
        Get or create LINE user, fetching profile if needed.
        
        This method is thread-safe and handles race conditions when multiple
        webhook events arrive simultaneously for the same user.
        
        Args:
            db: Database session
            line_user_id: LINE user ID from webhook event
            line_service: LINEService instance for API calls
            display_name: Optional display name (if already known from event)
        
        Returns:
            LineUser instance (existing or newly created)
        
        Raises:
            Exception: If database operations fail after retries
        """
        # First, check if user already exists
        line_user = db.query(LineUser).filter_by(
            line_user_id=line_user_id
        ).first()
        
        if line_user:
            # Update display name if provided and different
            if display_name and line_user.display_name != display_name:
                try:
                    line_user.display_name = display_name
                    db.commit()
                    logger.debug(f"Updated display name for LineUser {line_user_id[:10]}...")
                except Exception as e:
                    logger.warning(f"Failed to update display name for {line_user_id[:10]}...: {e}")
                    db.rollback()
            return line_user
        
        # User doesn't exist - fetch profile from LINE API if display_name not provided
        if not display_name:
            try:
                profile = line_service.get_user_profile(line_user_id)
                if profile:
                    display_name = profile.get('displayName')
                    logger.debug(f"Fetched profile for {line_user_id[:10]}...: display_name={display_name}")
                else:
                    logger.debug(f"Profile fetch returned None for {line_user_id[:10]}...")
            except Exception as e:
                # Log but don't fail - we can create user without display name
                logger.debug(
                    f"Failed to fetch profile for {line_user_id[:10]}...: {e}. "
                    "Creating user without display name."
                )
        
        # Create new user
        # Handle race condition: another request might have created it between check and insert
        try:
            line_user = LineUser(
                line_user_id=line_user_id,
                display_name=display_name
            )
            db.add(line_user)
            db.commit()
            db.refresh(line_user)
            logger.info(
                f"Created new LineUser: id={line_user.id}, "
                f"line_user_id={line_user.line_user_id[:10]}..., display_name={line_user.display_name}"
            )
            return line_user
        except IntegrityError:
            # Race condition: another request created it
            db.rollback()
            logger.debug(f"Race condition detected for {line_user_id[:10]}..., fetching existing user")
            # Fetch the user that was just created by another request
            line_user = db.query(LineUser).filter_by(
                line_user_id=line_user_id
            ).first()
            if not line_user:
                # This shouldn't happen, but handle gracefully
                logger.error(f"Failed to find LineUser after IntegrityError for {line_user_id[:10]}...")
                raise
            logger.debug(f"Found existing LineUser after race condition: id={line_user.id}")
            return line_user
        except Exception as e:
            db.rollback()
            logger.exception(f"Failed to create LineUser for {line_user_id[:10]}...: {e}")
            raise

