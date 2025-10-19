"""
Admin API endpoints for clinic management.

This module provides REST endpoints for clinic administrators to manage
therapists, patients, and system configuration.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.database import get_db
from services.google_oauth import google_oauth_service
from models.therapist import Therapist

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get(  # type: ignore[reportUntypedFunctionDecorator]
    "/therapists/{therapist_id}/gcal/auth",
    summary="Initiate Google OAuth",
    description="Generate authorization URL for therapist Google Calendar access",
    responses={
        200: {
            "description": "Authorization URL generated successfully",
            "content": {
                "application/json": {
                    "example": {
                        "authorization_url": "https://accounts.google.com/o/oauth2/auth?..."
                    }
                }
            }
        },
        404: {"description": "Therapist not found"},
        500: {"description": "Internal server error"},
    },
)
async def initiate_google_oauth(
    therapist_id: int,
    clinic_id: int = Query(..., description="ID of the clinic the therapist belongs to"),  # pyright: ignore[reportCallInDefaultInitializer]
    db: Session = Depends(get_db)  # pyright: ignore[reportCallInDefaultInitializer]
) -> dict[str, str]:
    """
    Initiate Google OAuth 2.0 flow for a therapist.

    Generates an authorization URL that the therapist can use to grant
    access to their Google Calendar. This URL should be presented to
    the therapist in the admin interface.

    Args:
        therapist_id: Unique identifier of the therapist
        clinic_id: ID of the clinic for security validation
        db: Database session dependency

    Returns:
        dict containing the authorization URL

    Raises:
        HTTPException: If therapist is not found or clinic validation fails
    """
    try:
        # Verify therapist exists and belongs to the specified clinic
        therapist = db.query(Therapist).filter(
            Therapist.id == therapist_id,
            Therapist.clinic_id == clinic_id
        ).first()

        if not therapist:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Therapist not found or does not belong to specified clinic"
            )

        # Generate OAuth authorization URL
        auth_url = google_oauth_service.get_authorization_url(therapist_id, clinic_id)

        return {"authorization_url": auth_url}

    except HTTPException:
        raise
    except Exception as e:
        # Log unexpected errors for debugging
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Error initiating Google OAuth for therapist {therapist_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initiate OAuth flow"
        )


@router.get(  # type: ignore[reportUntypedFunctionDecorator]
    "/auth/google/callback",
    summary="Google OAuth Callback",
    description="Handle OAuth callback and complete therapist calendar authorization",
    responses={
        200: {
            "description": "OAuth flow completed successfully",
            "content": {
                "application/json": {
                    "example": {
                        "message": "Google Calendar access granted successfully",
                        "therapist_id": 1,
                        "therapist_name": "Dr. Smith"
                    }
                }
            }
        },
        400: {"description": "OAuth error or invalid parameters"},
        500: {"description": "OAuth processing failed"},
    },
)
def _handle_oauth_error(error: str) -> None:
    """Handle OAuth authorization errors."""
    import logging
    logger = logging.getLogger(__name__)
    logger.warning(f"OAuth callback received error: {error}")
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"OAuth authorization failed: {error}"
    )


def _validate_oauth_params(code: str | None, state: str | None) -> None:
    """Validate required OAuth callback parameters."""
    if not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Authorization code is required"
        )

    if not state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="State parameter is required"
        )


async def _process_oauth_success(db: Session, code: str | None, state: str | None) -> Therapist:
    """Process successful OAuth callback and return therapist."""
    import logging
    logger = logging.getLogger(__name__)

    # At this point, validation should have ensured these are not None
    assert code is not None, "Code should not be None at this point"
    assert state is not None, "State should not be None at this point"

    therapist = await google_oauth_service.handle_oauth_callback(db, code, state)
    logger.info(f"Successfully authorized Google Calendar access for therapist {therapist.id}")
    return therapist


async def google_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db)  # pyright: ignore[reportCallInDefaultInitializer]
) -> dict[str, Any]:
    """
    Handle Google OAuth 2.0 callback and complete therapist authorization.

    This endpoint is called by Google after the therapist grants or denies
    calendar access. It exchanges the authorization code for tokens and
    stores them securely in the database.

    Args:
        request: The HTTP request containing query parameters
        db: Database session dependency

    Returns:
        dict with success message and therapist information

    Raises:
        HTTPException: If OAuth fails or parameters are invalid
    """
    import logging
    logger = logging.getLogger(__name__)

    try:
        # Handle OAuth errors
        if error:
            _handle_oauth_error(error)

        # Validate parameters
        _validate_oauth_params(code, state)

        # Process successful OAuth
        therapist = await _process_oauth_success(db, code, state)

        return {
            "message": "Google Calendar access granted successfully",
            "therapist_id": therapist.id,
            "therapist_name": therapist.name
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in OAuth callback: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OAuth callback processing failed"
        )
