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
        clinic_id: int,
        line_service: LINEService,
        display_name: Optional[str] = None,
        picture_url: Optional[str] = None
    ) -> LineUser:
        """
        Get or create LINE user for a specific clinic, fetching profile if needed.
        
        This method is thread-safe and handles race conditions when multiple
        webhook events arrive simultaneously for the same user.
        
        Each clinic has its own LineUser entry for the same LINE user ID, enabling
        strict clinic isolation and per-clinic customization.
        
        Args:
            db: Database session
            line_user_id: LINE user ID from webhook event
            clinic_id: Clinic ID this LineUser belongs to (must not be None)
            line_service: LINEService instance for API calls
            display_name: Optional display name (if already known from event)
            picture_url: Optional profile picture URL (if already known, e.g., from LIFF)
        
        Returns:
            LineUser instance (existing or newly created) for this clinic
        
        Raises:
            ValueError: If clinic_id is None or invalid
            Exception: If database operations fail after retries
        """
        # Validate clinic_id is a positive integer
        if clinic_id <= 0:
            raise ValueError(f"clinic_id must be a positive integer, got: {clinic_id}")
        
        # First, check if user already exists for this clinic
        line_user = db.query(LineUser).filter_by(
            line_user_id=line_user_id,
            clinic_id=clinic_id
        ).first()
        
        if line_user:
            # Update display name if provided and different
            updated = False
            if display_name and line_user.display_name != display_name:
                line_user.display_name = display_name
                updated = True
            
            # Update picture_url if provided
            if picture_url and line_user.picture_url != picture_url:
                line_user.picture_url = picture_url
                updated = True
            
            # Lazy update: fetch profile if picture_url is missing
            if not line_user.picture_url and line_service:
                try:
                    profile = line_service.get_user_profile(line_user_id)
                    if profile and profile.get('pictureUrl'):
                        line_user.picture_url = profile.get('pictureUrl')
                        updated = True
                        logger.debug(
                            f"Fetched and updated picture_url for existing LineUser {line_user_id[:10]}... "
                            f"at clinic_id={clinic_id}"
                        )
                except Exception as e:
                    # Log but don't fail - picture_url is optional
                    logger.debug(
                        f"Failed to fetch profile for existing user {line_user_id[:10]}...: {e}"
                    )
            
            if updated:
                try:
                    db.commit()
                    logger.debug(
                        f"Updated LineUser {line_user_id[:10]}... "
                        f"at clinic_id={clinic_id}"
                    )
                except Exception as e:
                    logger.warning(
                        f"Failed to update LineUser {line_user_id[:10]}... "
                        f"at clinic_id={clinic_id}: {e}"
                    )
                    db.rollback()
            return line_user
        
        # User doesn't exist for this clinic - fetch profile from LINE API if needed
        # Fetch profile if either display_name OR picture_url is missing (OR condition, not AND)
        # This ensures we get complete profile data when creating new users
        if not display_name or not picture_url:
            try:
                profile = line_service.get_user_profile(line_user_id)
                if profile:
                    if not display_name:
                        display_name = profile.get('displayName')
                    if not picture_url:
                        picture_url = profile.get('pictureUrl')
                    logger.debug(
                        f"Fetched profile for {line_user_id[:10]}...: "
                        f"display_name={display_name}, picture_url={'set' if picture_url else 'none'}, "
                        f"clinic_id={clinic_id}"
                    )
                else:
                    logger.debug(f"Profile fetch returned None for {line_user_id[:10]}...")
            except Exception as e:
                # Log but don't fail - we can create user without profile data
                logger.debug(
                    f"Failed to fetch profile for {line_user_id[:10]}...: {e}. "
                    "Creating user without profile data."
                )
        
        # Create new user for this clinic
        # Handle race condition: another request might have created it between check and insert
        try:
            line_user = LineUser(
                line_user_id=line_user_id,
                clinic_id=clinic_id,
                display_name=display_name,
                picture_url=picture_url
            )
            db.add(line_user)
            db.commit()
            db.refresh(line_user)
            logger.info(
                f"Created new LineUser: id={line_user.id}, "
                f"line_user_id={line_user.line_user_id[:10]}..., "
                f"clinic_id={clinic_id}, display_name={line_user.display_name}"
            )
            return line_user
        except IntegrityError:
            # Race condition: another request created it
            db.rollback()
            logger.debug(
                f"Race condition detected for {line_user_id[:10]}... "
                f"at clinic_id={clinic_id}, fetching existing user"
            )
            # Fetch the user that was just created by another request
            line_user = db.query(LineUser).filter_by(
                line_user_id=line_user_id,
                clinic_id=clinic_id
            ).first()
            if not line_user:
                # This shouldn't happen, but handle gracefully
                logger.error(
                    f"Failed to find LineUser after IntegrityError for {line_user_id[:10]}... "
                    f"at clinic_id={clinic_id}"
                )
                raise
            logger.debug(f"Found existing LineUser after race condition: id={line_user.id}")
            return line_user
        except Exception as e:
            db.rollback()
            logger.exception(
                f"Failed to create LineUser for {line_user_id[:10]}... "
                f"at clinic_id={clinic_id}: {e}"
            )
            raise

