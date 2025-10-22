"""
Authentication API endpoints.

Handles Google OAuth login, token refresh, and logout for both
system admins and clinic users.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from datetime import datetime, timezone
from typing import Dict
from core.database import get_db
from core.config import API_BASE_URL, SYSTEM_ADMIN_EMAILS, FRONTEND_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ENVIRONMENT
from services.jwt_service import jwt_service, TokenPayload
from models import RefreshToken

router = APIRouter()
security = HTTPBearer(auto_error=False)


@router.get("/google/login", summary="Initiate Google OAuth login")
async def initiate_google_auth(user_type: str = "clinic_user") -> dict[str, str]:
    """
    Initiate Google OAuth login flow.

    Args:
        user_type: Type of user ("system_admin" or "clinic_user")

    Returns:
        Authorization URL for Google OAuth
    """
    if user_type not in ["system_admin", "clinic_user"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid user_type. Must be 'system_admin' or 'clinic_user'"
        )

    from urllib.parse import urlencode

    # Different scopes based on user type
    if user_type == "system_admin":
        scopes = ["openid", "profile", "email"]
    else:  # clinic_user
        scopes = [
            "openid", "profile", "email",
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/calendar.settings.readonly"
        ]

    # Sign the state parameter for security
    state_data = {"type": user_type}
    signed_state = jwt_service.sign_oauth_state(state_data)

    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": f"{API_BASE_URL}/api/auth/google/callback",
        "scope": " ".join(scopes),
        "response_type": "code",
        "access_type": "offline",  # Request refresh token
        "prompt": "consent",  # Force consent screen to get refresh token
        "state": signed_state  # Use signed state
    }

    auth_url = f"https://accounts.google.com/o/oauth2/auth?{urlencode(params)}"
    return {"auth_url": auth_url}


@router.get("/google/callback", summary="Handle Google OAuth callback")
async def google_auth_callback(
    code: str,
    state: str,
    db: Session = Depends(get_db)
) -> dict[str, str]:
    """
    Handle Google OAuth callback and create JWT tokens.

    Args:
        code: Authorization code from Google
        state: Signed JWT containing user type

    Returns:
        Redirect URL for frontend
    """
    try:
        # Verify and parse signed state
        state_data = jwt_service.verify_oauth_state(state)
        if not state_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired authentication state"
            )

        user_type = state_data.get("type")
        if user_type not in ["system_admin", "clinic_user"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid authentication state"
            )

        # Exchange code for tokens (simplified - would use actual OAuth client)
        import httpx
        token_url = "https://oauth2.googleapis.com/token"

        token_data = {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": f"{API_BASE_URL}/api/auth/google/callback"
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
                detail="Failed to get user information from Google"
            )

        email = user_info["email"]
        google_subject_id = user_info["id"]
        name = user_info.get("name", email)

        # Handle different user types
        if user_type == "system_admin":
            # Verify system admin
            if email not in SYSTEM_ADMIN_EMAILS:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied. You are not authorized as a system admin."
                )

            # Create token payload for system admin
            payload = TokenPayload(
                sub=google_subject_id,
                email=email,
                user_type="system_admin",
                roles=[],  # System admins don't have clinic roles
                clinic_id=None,
                name=name
            )

            redirect_url = f"{FRONTEND_URL}/system/dashboard"

        else:  # clinic_user
            # This would normally handle clinic user authentication
            # For now, redirect to login with error
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Clinic user authentication must go through signup flow"
            )

        # Create token pair
        token_data = jwt_service.create_token_pair(payload)

        # For system admins, we don't have a user record, so we'll store by email
        # In a real implementation, you might want a separate table for system admin sessions
        # For now, we'll skip database storage for system admins

        # Create response with httpOnly cookie for refresh token
        response = Response()
        response.set_cookie(
            key="refresh_token",
            value=token_data["refresh_token"],
            httponly=True,
            secure=ENVIRONMENT == "production",  # Secure in production
            samesite="strict",
            max_age=7 * 24 * 60 * 60  # 7 days
        )

        # Redirect to appropriate dashboard with access token
        redirect_url = f"{redirect_url}?token={token_data['access_token']}"

        return {"redirect_url": redirect_url}

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication failed"
        )


@router.post("/refresh", summary="Refresh access token")
async def refresh_access_token(
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Refresh access token using refresh token from httpOnly cookie.

    Returns new access token and sets new refresh token cookie.
    """
    # Get refresh token from cookie
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token not found"
        )

    # First, try fast lookup using HMAC key
    expected_hmac = jwt_service.generate_refresh_token_hmac(refresh_token)

    refresh_token_record = db.query(RefreshToken).filter(
        RefreshToken.hmac_key == expected_hmac,
        RefreshToken.revoked == False,
        RefreshToken.expires_at > datetime.now(timezone.utc)
    ).first()

    # If HMAC lookup succeeds, verify with bcrypt for final security
    if refresh_token_record and jwt_service.verify_refresh_token_hash(refresh_token, refresh_token_record.token_hash):
        # HMAC match + bcrypt verification successful
        pass
    else:
        # Fallback to original linear scan for backward compatibility or if HMAC lookup failed
        valid_tokens = db.query(RefreshToken).filter(
            RefreshToken.revoked == False,
            RefreshToken.expires_at > datetime.now(timezone.utc)
        ).all()

        refresh_token_record = None
        for token_record in valid_tokens:
            if jwt_service.verify_refresh_token_hash(refresh_token, token_record.token_hash):
                refresh_token_record = token_record
                break

    if not refresh_token_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )

    # Get the user associated with this refresh token
    user = refresh_token_record.user
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive"
        )

    # Create new token pair
    payload = TokenPayload(
        sub=str(user.google_subject_id),
        email=user.email,
        user_type="clinic_user",
        roles=user.roles,
        clinic_id=user.clinic_id,
        name=user.full_name
    )

    token_data = jwt_service.create_token_pair(payload)

    # Revoke old refresh token
    refresh_token_record.revoke()

    # Create new refresh token record
    new_refresh_token_record = RefreshToken(
        user_id=user.id,
        token_hash=token_data["refresh_token_hash"],
        hmac_key=token_data["refresh_token_hmac"],
        expires_at=jwt_service.get_token_expiry("refresh")
    )
    db.add(new_refresh_token_record)
    db.commit()

    # Set new refresh token cookie
    response.set_cookie(
        key="refresh_token",
        value=token_data["refresh_token"],
        httponly=True,
        secure=ENVIRONMENT == "production",  # Secure in production
        samesite="strict",
        max_age=jwt_service.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60  # days to seconds
    )

    return {
        "access_token": token_data["access_token"],
        "token_type": token_data["token_type"],
        "expires_in": str(token_data["expires_in"])
    }


@router.post("/logout", summary="Logout current user")
async def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
) -> dict[str, str]:
    """
    Logout the current user by revoking refresh token and clearing cookie.
    """
    # Get refresh token from cookie and revoke it in database
    refresh_token = request.cookies.get("refresh_token")
    if refresh_token:
        # Find and revoke the refresh token using HMAC for efficiency
        expected_hmac = jwt_service.generate_refresh_token_hmac(refresh_token)

        token_record = db.query(RefreshToken).filter(
            RefreshToken.hmac_key == expected_hmac,
            RefreshToken.revoked == False,
            RefreshToken.expires_at > datetime.now(timezone.utc)
        ).first()

        if token_record and jwt_service.verify_refresh_token_hash(refresh_token, token_record.token_hash):
            token_record.revoke()
            db.commit()
        else:
            # Fallback to linear scan for backward compatibility
            valid_tokens = db.query(RefreshToken).filter(
                RefreshToken.revoked == False,
                RefreshToken.expires_at > datetime.now(timezone.utc)
            ).all()

            for token_record in valid_tokens:
                if jwt_service.verify_refresh_token_hash(refresh_token, token_record.token_hash):
                    token_record.revoke()
                    db.commit()
                    break

    # Clear the refresh token cookie
    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        secure=ENVIRONMENT == "production",  # Consistent with set_cookie
        samesite="strict"
    )

    return {"message": "Logged out successfully"}
