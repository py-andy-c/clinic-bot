# pyright: reportMissingTypeStubs=false
"""
Signup API endpoints.

Handles secure token-based user onboarding for clinic admins and team members.
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import FRONTEND_URL
from services.jwt_service import jwt_service, TokenPayload
from models import User, SignupToken, RefreshToken

logger = logging.getLogger(__name__)

router = APIRouter()
security = HTTPBearer(auto_error=False)


class NameConfirmationRequest(BaseModel):
    """Request model for name confirmation."""
    full_name: str


@router.post("/confirm-name", summary="Confirm user name and complete signup")
async def confirm_name(
    request: NameConfirmationRequest,
    token: str,
    db: Session = Depends(get_db)
) -> dict[str, str]:
    """
    Confirm user name and complete the signup process.
    
    Args:
        request: Name confirmation data
        token: Temporary JWT token containing signup data
        
    Returns:
        Redirect URL to dashboard with access token
    """
    try:
        # Verify and parse temporary token
        temp_data = jwt_service.verify_oauth_state(token)
        if not temp_data or temp_data.get("type") != "name_confirmation":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效或過期的確認令牌"
            )
        
        # Extract data from temporary token
        signup_token_str = temp_data.get("signup_token")
        email = temp_data.get("email")
        google_subject_id = temp_data.get("google_subject_id")
        roles = temp_data.get("roles")
        clinic_id = temp_data.get("clinic_id")

        # Validate required fields (allow empty roles list)
        # Data integrity issues are logged but user sees generic error message
        missing_fields: list[str] = []
        if not signup_token_str:
            missing_fields.append("signup_token")
        if not email:
            missing_fields.append("email")
        if not google_subject_id:
            missing_fields.append("google_subject_id")
        if not clinic_id:
            missing_fields.append("clinic_id")
        if roles is None:
            missing_fields.append("roles")

        if missing_fields:
            logger.warning(
                "Data integrity issue: Invalid signup confirmation token data - missing required fields",
                extra={
                    "missing_fields": missing_fields,
                    "token_fields_present": {
                        "signup_token": bool(signup_token_str),
                        "email": bool(email),
                        "google_subject_id": bool(google_subject_id),
                        "clinic_id": bool(clinic_id),
                        "roles": roles is not None
                    }
                }
            )
            # Return generic error message to user, don't expose internal data structure issues
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效或過期的確認令牌"
            )
        
        # Validate signup token is still valid
        signup_token = db.query(SignupToken).filter(
            SignupToken.token == signup_token_str,
            SignupToken.expires_at > datetime.now(timezone.utc),
            SignupToken.is_revoked == False,
            SignupToken.used_at == None
        ).first()
        
        if not signup_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="註冊連結已失效"
            )
        
        # Validate name is not empty
        if not request.full_name.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="姓名不能為空"
            )
        
        # Create user record
        user = User(
            clinic_id=clinic_id,
            email=email,
            google_subject_id=google_subject_id,
            full_name=request.full_name.strip(),
            roles=roles,
            gcal_credentials=None,  # Google Calendar credentials no longer stored during signup
            gcal_sync_enabled=False  # Don't enable sync until they actually connect calendar
        )
        
        db.add(user)
        db.commit()
        db.refresh(user)
        
        # Mark signup token as used
        signup_token.used_at = datetime.now(timezone.utc)
        signup_token.used_by_email = email
        db.commit()
        
        # Create JWT token payload
        payload = TokenPayload(
            sub=str(google_subject_id),
            email=str(email),
            user_type="clinic_user",
            roles=user.roles,
            clinic_id=user.clinic_id,
            name=user.full_name
        )
        
        # Create token pair
        token_data = jwt_service.create_token_pair(payload)
        
        # Store refresh token in database
        refresh_token_hash = token_data["refresh_token_hash"]
        refresh_token_expiry = datetime.now(timezone.utc) + timedelta(days=7)
        
        refresh_token_record = RefreshToken(
            user_id=user.id,
            token_hash=refresh_token_hash,
            hmac_key=token_data["refresh_token_hmac"],
            expires_at=refresh_token_expiry
        )
        db.add(refresh_token_record)
        db.commit()
        
        # Return redirect URL with access token
        return {
            "redirect_url": f"{FRONTEND_URL}/clinic/dashboard?token={token_data['access_token']}",
            "refresh_token": token_data["refresh_token"]
        }
        
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Error in name confirmation and signup completion")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="註冊完成失敗"
        )
