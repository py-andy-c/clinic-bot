"""
Signup API endpoints.

Handles secure token-based user onboarding for clinic admins and team members.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Response
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import API_BASE_URL, FRONTEND_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ENVIRONMENT
from services.jwt_service import jwt_service, TokenPayload
from models import User, SignupToken, RefreshToken

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
        scopes = [
            "openid", "profile", "email",
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/calendar.settings.readonly"
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
        scopes = [
            "openid", "profile", "email",
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/calendar.settings.readonly"
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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="註冊流程初始化失敗"
        )


@router.get("/callback", summary="Handle signup OAuth callback")
async def signup_oauth_callback(
    code: str,
    state: str,
    response: Response,
    db: Session = Depends(get_db)
) -> dict[str, str]:
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

            # Get user info
            user_info_url = "https://www.googleapis.com/oauth2/v2/userinfo"
            headers = {"Authorization": f"Bearer {token_info['access_token']}"}
            user_response = await client.get(user_info_url, headers=headers)
            user_response.raise_for_status()
            user_info = user_response.json()

        if not user_info or not user_info.get("email"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無法從 Google 獲取用戶資訊"
            )

        email = user_info["email"]
        google_subject_id = user_info["sub"]
        name = user_info.get("name", email)

        # Check if user already exists
        existing_user = db.query(User).filter(
            User.google_subject_id == google_subject_id
        ).first()

        if existing_user:
            # User already exists, redirect to login
            redirect_url = f"{FRONTEND_URL}/login?error=user_exists"
            return {"redirect_url": redirect_url}

        # Check if email is already used in this clinic
        existing_email = db.query(User).filter(
            User.clinic_id == signup_token.clinic_id,
            User.email == email,
            User.is_active == True
        ).first()

        if existing_email:
            # Email already used, redirect with error
            redirect_url = f"{FRONTEND_URL}/login?error=email_taken"
            return {"redirect_url": redirect_url}

        # Encrypt Google Calendar credentials
        gcal_credentials = {
            "access_token": token_info["access_token"],
            "refresh_token": token_info.get("refresh_token"),
            "expires_at": token_info.get("expires_in"),
            "token_type": token_info.get("token_type", "Bearer"),
            "scope": token_info.get("scope"),
            "user_email": email,
            "user_name": name
        }
        from services.encryption_service import get_encryption_service
        encrypted_credentials = get_encryption_service().encrypt_data(gcal_credentials)

        # Create user record
        user = User(
            clinic_id=signup_token.clinic_id,
            email=email,
            google_subject_id=google_subject_id,
            full_name=name,
            roles=signup_token.default_roles,
            gcal_credentials=encrypted_credentials,
            gcal_sync_enabled=True
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
            sub=google_subject_id,
            email=email,
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

        # Set refresh token cookie
        response.set_cookie(
            key="refresh_token",
            value=token_data["refresh_token"],
            httponly=True,
            secure=ENVIRONMENT == "production",  # Secure in production
            samesite="strict",
            max_age=7 * 24 * 60 * 60
        )

        # Redirect to appropriate dashboard
        redirect_url = f"{FRONTEND_URL}/dashboard?token={token_data['access_token']}"

        return {"redirect_url": redirect_url}

    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="註冊失敗"
        )
