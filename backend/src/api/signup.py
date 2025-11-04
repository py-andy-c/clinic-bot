# pyright: reportMissingTypeStubs=false
"""
Signup API endpoints.

Handles secure token-based user onboarding for clinic admins and team members.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import API_BASE_URL, FRONTEND_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
from services.jwt_service import jwt_service, TokenPayload
from models import User, SignupToken, RefreshToken

logger = logging.getLogger(__name__)

router = APIRouter()
security = HTTPBearer(auto_error=False)


@router.get("/clinic", summary="Initiate clinic admin signup")
async def initiate_clinic_admin_signup(token: str, db: Session = Depends(get_db)) -> dict[str, str]:
    """
    Validate clinic admin signup token and redirect to Google OAuth.

    Args:
        token: Secure signup token

    Returns:
        Google OAuth authorization URL
    """
    try:
        # Validate signup token
        signup_token = db.query(SignupToken).filter(
            SignupToken.token == token,
            SignupToken.expires_at > datetime.now(timezone.utc),
            SignupToken.is_revoked == False,
            SignupToken.used_at == None
        ).first()

        if not signup_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="註冊連結已失效，請聯繫診所處理。"
            )

        # Check if roles include admin (clinic admin signup)
        if "admin" not in signup_token.default_roles:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的註冊連結。"
            )

        from urllib.parse import urlencode

        # OAuth scopes for clinic admins
        # NOTE: Calendar scopes removed - requiring calendar access would need Google App verification.
        scopes = [
            "openid", "profile", "email"
            # Calendar scopes disabled - would require Google App verification:
            # "https://www.googleapis.com/auth/calendar.events",
            # "https://www.googleapis.com/auth/calendar.settings.readonly"
        ]

        # Create signed state containing signup token
        state_data = {"type": "clinic", "token": token}
        signed_state = jwt_service.sign_oauth_state(state_data)

        params = {
            "client_id": GOOGLE_CLIENT_ID,
            "redirect_uri": f"{API_BASE_URL}/api/signup/callback",
            "scope": " ".join(scopes),
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
            "state": signed_state  # Use signed state
        }

        auth_url = f"https://accounts.google.com/o/oauth2/auth?{urlencode(params)}"
        return {"auth_url": auth_url}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error initiating clinic admin signup")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="註冊流程初始化失敗"
        )


@router.get("/member", summary="Initiate team member signup")
async def initiate_member_signup(token: str, db: Session = Depends(get_db)) -> dict[str, str]:
    """
    Validate team member signup token and redirect to Google OAuth.

    Args:
        token: Secure signup token

    Returns:
        Google OAuth authorization URL
    """
    try:
        # Validate signup token
        signup_token = db.query(SignupToken).filter(
            SignupToken.token == token,
            SignupToken.expires_at > datetime.now(timezone.utc),
            SignupToken.is_revoked == False,
            SignupToken.used_at == None
        ).first()

        if not signup_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="註冊連結已失效，請聯繫診所管理員。"
            )

        from urllib.parse import urlencode

        # OAuth scopes for team members
        # NOTE: Calendar scopes removed - requiring calendar access would need Google App verification.
        scopes = [
            "openid", "profile", "email"
            # Calendar scopes disabled - would require Google App verification:
            # "https://www.googleapis.com/auth/calendar.events",
            # "https://www.googleapis.com/auth/calendar.settings.readonly"
        ]

        # Create signed state containing signup token
        state_data = {"type": "member", "token": token}
        signed_state = jwt_service.sign_oauth_state(state_data)

        params = {
            "client_id": GOOGLE_CLIENT_ID,
            "redirect_uri": f"{API_BASE_URL}/api/signup/callback",
            "scope": " ".join(scopes),
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
            "state": signed_state  # Use signed state
        }

        auth_url = f"https://accounts.google.com/o/oauth2/auth?{urlencode(params)}"
        return {"auth_url": auth_url}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error initiating member signup")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="註冊流程初始化失敗"
        )


@router.get("/callback", summary="Handle signup OAuth callback")
async def signup_oauth_callback(
    code: str,
    state: str,
    db: Session = Depends(get_db)
) -> RedirectResponse:
    """
    Handle OAuth callback for user signup and account creation.

    Args:
        code: Authorization code from Google
        state: Signed JWT containing signup type and token

    Returns:
        Redirect URL for appropriate dashboard
    """
    try:
        # Verify and parse signed state
        state_data = jwt_service.verify_oauth_state(state)
        if not state_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效或過期的驗證狀態"
            )

        signup_type = state_data.get("type")
        token = state_data.get("token")

        if not signup_type or not token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的驗證狀態"
            )

        if signup_type not in ["clinic", "member"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的註冊類型"
            )

        # Validate signup token
        signup_token = db.query(SignupToken).filter(
            SignupToken.token == token,
            SignupToken.expires_at > datetime.now(timezone.utc),
            SignupToken.is_revoked == False,
            SignupToken.used_at == None
        ).first()

        if not signup_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="註冊連結已失效"
            )

        # Exchange code for tokens
        import httpx
        token_url = "https://oauth2.googleapis.com/token"

        token_data = {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": f"{API_BASE_URL}/api/signup/callback"
        }

        async with httpx.AsyncClient() as client:
            token_response = await client.post(token_url, data=token_data)
            token_response.raise_for_status()
            token_info = token_response.json()

        # Get user info from Google
        userinfo_url = "https://www.googleapis.com/oauth2/v2/userinfo"
        headers = {"Authorization": f"Bearer {token_info['access_token']}"}
        
        async with httpx.AsyncClient() as client:
            userinfo_response = await client.get(userinfo_url, headers=headers)
            userinfo_response.raise_for_status()
            user_info = userinfo_response.json()

        if not user_info or not user_info.get("email"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無法從 Google 獲取用戶資訊"
            )

        email = user_info["email"]
        google_subject_id = user_info.get("sub") or user_info.get("id")  # Try 'id' as fallback
        if not google_subject_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無法從 Google 獲取用戶識別碼"
            )
        name = user_info.get("name", email)

        # Check if user already exists
        existing_user = db.query(User).filter(
            User.google_subject_id == google_subject_id
        ).first()

        if existing_user:
            # User already exists, redirect to login
            return RedirectResponse(
                url=f"{FRONTEND_URL}/login?error=user_exists",
                status_code=302
            )

        # Check if email is already used in this clinic
        existing_email = db.query(User).filter(
            User.clinic_id == signup_token.clinic_id,
            User.email == email,
            User.is_active == True
        ).first()

        if existing_email:
            # Email already used, redirect with error
            return RedirectResponse(
                url=f"{FRONTEND_URL}/login?error=email_taken",
                status_code=302
            )

        # Store OAuth data temporarily for name confirmation
        # Create a temporary state with user data for name confirmation
        temp_state_data = {
            "type": "name_confirmation",
            "signup_token": token,
            "email": email,
            "google_subject_id": google_subject_id,
            "google_name": name,
            "roles": signup_token.default_roles,
            "clinic_id": signup_token.clinic_id
        }
        
        # Create a temporary JWT token for name confirmation
        temp_token = jwt_service.sign_oauth_state(temp_state_data)
        
        # Redirect to name confirmation page
        return RedirectResponse(
            url=f"{FRONTEND_URL}/signup/confirm-name?token={temp_token}",
            status_code=302
        )

    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Error in signup OAuth callback")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="註冊失敗"
        )


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
            roles=roles
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
        refresh_token_expiry = jwt_service.get_token_expiry("refresh")
        
        refresh_token_record = RefreshToken(
            user_id=user.id,
            token_hash=refresh_token_hash,
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
