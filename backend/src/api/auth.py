# pyright: reportMissingTypeStubs=false
"""
Authentication API endpoints.

Handles Google OAuth login, token refresh, and logout for both
system admins and clinic users.
"""

import logging
import os
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request, Query
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from datetime import datetime, timezone
from typing import Dict, Any
from core.database import get_db
from core.config import API_BASE_URL, SYSTEM_ADMIN_EMAILS, FRONTEND_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_REFRESH_TOKEN_EXPIRE_DAYS
from services.jwt_service import jwt_service, TokenPayload
from models import RefreshToken, User, Clinic
from auth.dependencies import UserContext, get_current_user

router = APIRouter()
security = HTTPBearer(auto_error=False)


def set_refresh_token_cookie(
    response: Response,
    request: Request,
    refresh_token: str,
    max_age: int = JWT_REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
) -> None:
    """
    Helper to set refresh token cookie with proper cross-origin settings.
    
    Args:
        response: FastAPI Response object to set cookie on
        request: FastAPI Request object to detect HTTPS
        refresh_token: The refresh token value to set
        max_age: Cookie max age in seconds (defaults to refresh token expiry)
    """
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    cookie_same_site = "none" if is_https else "lax"
    logger.debug(f"Setting refresh token cookie - HTTPS: {is_https}, SameSite: {cookie_same_site}")
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=is_https,  # Secure cookies only over HTTPS (required for SameSite=None)
        samesite=cookie_same_site,  # "none" for cross-origin, "lax" for same-origin HTTP
        path="/",  # Ensure cookie is sent with all requests
        max_age=max_age
    )


def delete_refresh_token_cookie(
    response: Response,
    request: Request
) -> None:
    """
    Helper to delete refresh token cookie with proper cross-origin settings.
    
    Args:
        response: FastAPI Response object to delete cookie on
        request: FastAPI Request object to detect HTTPS
    """
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    cookie_same_site = "none" if is_https else "lax"
    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        secure=is_https,  # Secure cookies only over HTTPS (required for SameSite=None)
        samesite=cookie_same_site  # Match cookie setting
    )


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
            detail="無效的使用者類型。必須是 'system_admin' 或 'clinic_user'"
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
    request: Request,
    code: str = Query(None),
    state: str = Query(...),
    error: str = Query(None),
    db: Session = Depends(get_db)
):
    """
    Handle Google OAuth callback and create JWT tokens.

    Args:
        code: Authorization code from Google (optional if user cancelled)
        state: Signed JWT containing user type
        error: Error code from Google OAuth (e.g., 'access_denied' if user cancelled)

    Returns:
        Redirect URL for frontend
    """
    # Handle user cancellation or OAuth errors
    if error:
        logger.info(f"OAuth callback error: {error}")
        from fastapi.responses import RedirectResponse
        from urllib.parse import quote
        error_message = "登入已取消" if error == "access_denied" else "認證失敗"
        error_url = f"{FRONTEND_URL}/login?error=true&message={quote(error_message)}"
        return RedirectResponse(url=error_url, status_code=302)
    
    # Ensure code is provided if no error
    if not code:
        logger.warning("OAuth callback missing code parameter")
        from fastapi.responses import RedirectResponse
        from urllib.parse import quote
        error_url = f"{FRONTEND_URL}/login?error=true&message={quote('認證失敗：缺少授權碼')}"
        return RedirectResponse(url=error_url, status_code=302)

    try:
        # Verify and parse signed state
        state_data = jwt_service.verify_oauth_state(state)
        if not state_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效或已過期的認證狀態"
            )

        intended_user_type = state_data.get("type")
        if intended_user_type not in ["system_admin", "clinic_user"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的認證狀態"
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
                detail="無法從 Google 取得使用者資訊"
            )

        email = user_info["email"]
        google_subject_id = user_info["id"]
        name = user_info.get("name", email)

        # Determine actual user type based on email (not frontend intention)
        actual_user_type = "clinic_user"  # Default
        existing_user = None

        if email in SYSTEM_ADMIN_EMAILS:
            # This is a system admin regardless of which button was clicked
            actual_user_type = "system_admin"

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

        else:
            # This is a clinic user - they need to go through signup flow
            # Check if intended to be clinic user
            if intended_user_type != "clinic_user":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="請使用診所使用者登入選項"
                )

            # For clinic users, check if they have an existing account
            existing_user = db.query(User).filter(User.email == email).first()
            if existing_user:
                # Check if user is active
                if not existing_user.is_active:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="帳戶已被停用，請聯繫診所管理員重新啟用"
                    )
                
                # Existing active clinic user - create tokens
                payload = TokenPayload(
                    sub=google_subject_id,
                    email=email,
                    user_type="clinic_user",
                    roles=existing_user.roles,
                    clinic_id=existing_user.clinic_id,
                    name=name
                )

                redirect_url = f"{FRONTEND_URL}/clinic/dashboard"
            else:
                # New clinic user - redirect to signup
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="診所使用者認證必須透過註冊流程"
                )

        # Create token pair
        token_data = jwt_service.create_token_pair(payload)

        # Store refresh token in database
        if actual_user_type == "system_admin":
            # For system admins, we don't have a user record, so we'll store by email
            # In a real implementation, you might want a separate table for system admin sessions
            # For now, we'll create a dummy user ID based on email
            dummy_user_id = hash(email) % 1000000  # Simple hash for demo
        else:
            # For clinic users, use the actual user ID
            assert existing_user is not None, "existing_user should not be None for clinic users"
            dummy_user_id = existing_user.id

        refresh_token_hash = token_data["refresh_token_hash"]
        hmac_key = token_data["refresh_token_hmac"]

        refresh_token_record = RefreshToken(
            user_id=dummy_user_id,
            token_hash=refresh_token_hash,
            hmac_key=hmac_key,
            expires_at=jwt_service.get_token_expiry("refresh"),
            email=email if actual_user_type == "system_admin" else None,  # Store email for system admins
            google_subject_id=google_subject_id if actual_user_type == "system_admin" else None,  # Store google_subject_id for system admins
            name=name if actual_user_type == "system_admin" else None  # Store name for system admins
        )
        db.add(refresh_token_record)
        db.commit()

        # Create redirect response with tokens in URL and refresh token in cookie
        from fastapi.responses import RedirectResponse
        # Note: Setting cookies during cross-origin redirects can be problematic
        # The cookie will be set for the backend domain, not the frontend domain
        # Include refresh token in URL as fallback for cross-origin cookie issues
        from urllib.parse import quote
        redirect_url_with_tokens = f"{redirect_url}?token={quote(token_data['access_token'])}&refresh_token={quote(token_data['refresh_token'])}"
        logger.debug(f"OAuth redirect: tokens included in URL for cross-origin fallback")
        response = RedirectResponse(
            url=redirect_url_with_tokens,
            status_code=302
        )

        # Set refresh token as httpOnly cookie
        set_refresh_token_cookie(response, request, token_data["refresh_token"])

        return response

    except HTTPException as e:
        # Handle specific error cases by redirecting to frontend with error message
        if e.detail == "診所使用者認證必須透過註冊流程":
            from fastapi.responses import RedirectResponse
            error_url = f"{FRONTEND_URL}/login?error=true&message={e.detail}"
            return RedirectResponse(url=error_url, status_code=302)
        elif e.detail == "帳戶已被停用，請聯繫診所管理員重新啟用":
            from fastapi.responses import RedirectResponse
            error_url = f"{FRONTEND_URL}/login?error=true&message={e.detail}"
            return RedirectResponse(url=error_url, status_code=302)
        else:
            raise
    except Exception as e:
        logger.exception(f"Authentication error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="認證失敗"
        )


@router.post("/refresh", summary="Refresh access token")
async def refresh_access_token(
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Refresh access token using refresh token from httpOnly cookie or request body/header.
    
    Falls back to request body/header for cross-origin scenarios where cookies don't work
    (e.g., different ngrok domains with Safari ITP).
    
    Returns new access token and sets new refresh token cookie.
    """
    # Try to get refresh token from cookie first (preferred method)
    refresh_token = request.cookies.get("refresh_token")
    token_source = "cookie" if refresh_token else None
    
    # Fallback: Try to get from request body or header if cookie is not available
    # This handles cross-origin scenarios where cookies are blocked (Safari ITP)
    if not refresh_token:
        try:
            # Try to get from request body
            # Note: request.body() can only be read once, so we check if content-type is JSON first
            content_type = request.headers.get("content-type", "")
            if "application/json" in content_type:
                body = await request.json()
                refresh_token = body.get("refresh_token")
                if refresh_token:
                    token_source = "body"
                    logger.debug("Refresh token found in request body (cookie fallback)")
        except Exception as e:
            logger.debug(f"Could not read request body as JSON: {e}")
        finally:
            # Try header as last resort
            if not refresh_token:
                refresh_token = request.headers.get("X-Refresh-Token")
                if refresh_token:
                    token_source = "header"
                    logger.debug("Refresh token found in header (cookie fallback)")
    
    # Debug logging (only log warnings for failed attempts, not successful ones)
    if not refresh_token:
        all_cookies = request.cookies
        logger.warning("Refresh token not found in cookie, body, or header")
        logger.debug(f"Refresh request - cookies received: {list(all_cookies.keys())}")
        logger.debug(f"Refresh request - origin: {request.headers.get('origin')}")
        logger.debug(f"Refresh request - referer: {request.headers.get('referer')}")
        logger.debug(f"Request URL: {request.url}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="找不到重新整理權杖"
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
            detail="無效的重新整理權杖"
        )

    # Get the user associated with this refresh token
    user = refresh_token_record.user
    
    # Handle system admins - check if email is stored (system admin indicator)
    # Note: In tests, we may create dummy User records for FK constraint,
    # but we can still identify system admins by the email field in RefreshToken
    is_system_admin = refresh_token_record.email is not None and refresh_token_record.email in SYSTEM_ADMIN_EMAILS
    
    if is_system_admin:
        # For system admin, create token payload from stored fields
        assert refresh_token_record.email is not None, "System admin refresh token must have email"
        system_admin_email = refresh_token_record.email
        system_admin_subject_id = refresh_token_record.google_subject_id or system_admin_email  # Fallback to email if not stored
        system_admin_name = refresh_token_record.name or system_admin_email.split('@')[0].title()  # Fallback name
        
        # Create new token pair for system admin
        payload = TokenPayload(
            sub=system_admin_subject_id,  # Use stored google_subject_id
            email=system_admin_email,
            user_type="system_admin",
            roles=[],  # System admins don't have clinic roles
            clinic_id=None,
            name=system_admin_name
        )
        
        token_data = jwt_service.create_token_pair(payload)
        
        # Revoke old refresh token
        refresh_token_record.revoke()
        
        # Create new refresh token record for system admin
        dummy_user_id = hash(system_admin_email) % 1000000  # Same hash calculation as OAuth callback
        new_refresh_token_record = RefreshToken(
            user_id=dummy_user_id,
            token_hash=token_data["refresh_token_hash"],
            hmac_key=token_data["refresh_token_hmac"],
            expires_at=jwt_service.get_token_expiry("refresh"),
            email=system_admin_email,  # Store email for system admin
            google_subject_id=system_admin_subject_id,  # Store google_subject_id for system admin
            name=system_admin_name  # Store name for system admin
        )
    else:
        # Clinic user - normal flow
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="找不到使用者或使用者已停用"
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
            expires_at=jwt_service.get_token_expiry("refresh"),
            email=None,  # Clinic users don't need email in RefreshToken
            google_subject_id=None,  # Clinic users don't need google_subject_id in RefreshToken
            name=None  # Clinic users don't need name in RefreshToken
        )
    db.add(new_refresh_token_record)
    db.commit()

    # Set new refresh token cookie
    set_refresh_token_cookie(response, request, token_data["refresh_token"])

    # Return response with access token
    # Always include refresh_token in response to ensure localStorage fallback works
    # even if cookies fail (cross-origin, SameSite issues, Safari ITP, etc.)
    response_data = {
        "access_token": token_data["access_token"],
        "token_type": token_data["token_type"],
        "expires_in": str(token_data["expires_in"]),
        "refresh_token": token_data["refresh_token"]  # Always include for localStorage fallback
    }
    
    logger.debug(f"Including refresh_token in response body (token_source: {token_source})")
    
    return response_data


@router.get("/verify", summary="Verify access token")
async def verify_token(
    current_user: UserContext = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Verify that the provided access token is valid and return user information.

    Returns user data if token is valid, raises 401 if invalid.
    """
    logger.info(f"Token verification for user: {current_user.email}, type: {current_user.user_type}, roles: {current_user.roles}")
    
    return {
        "user_id": current_user.user_id,
        "clinic_id": current_user.clinic_id,
        "email": current_user.email,
        "full_name": current_user.name,
        "user_type": current_user.user_type,
        "roles": current_user.roles
    }


@router.post("/dev/login", summary="Development login (bypass OAuth)")
async def dev_login(
    request: Request,
    email: str,
    user_type: str = "system_admin",
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Development endpoint to create/login users without OAuth.

    WARNING: Only use in development/testing environments!
    This endpoint should be DISABLED in production deployments.
    """
    # Security check: Only allow on localhost/127.0.0.1 for development
    # Also allow "testclient" for FastAPI TestClient in test environments
    # In production, this endpoint should be disabled via router configuration
    client_host = request.client.host if request.client else None
    # Allow localhost addresses and FastAPI TestClient
    allowed_hosts = ["127.0.0.1", "localhost", "::1", "testclient"]
    # Also allow if we're in a test environment (pytest sets PYTEST_VERSION)
    is_testing = os.getenv("PYTEST_VERSION") is not None
    if client_host and client_host not in allowed_hosts and not is_testing:
        logger.warning(f"Dev login attempted from non-localhost: {client_host}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="開發登入僅在本地開發環境中可用"
        )

    if user_type not in ["system_admin", "clinic_user"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的使用者類型。必須是 'system_admin' 或 'clinic_user'"
        )

    # Check if user exists, if not create them
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # Create a new user
        if user_type == "clinic_user":
            # Need a clinic for clinic users
            clinic = db.query(Clinic).first()
            if not clinic:
                # Create a default clinic
                clinic = Clinic(
                    name="Development Clinic",
                    line_channel_id="dev_channel",
                    line_channel_secret="dev_secret",
                    line_channel_access_token="dev_token"
                )
                db.add(clinic)
                db.commit()

            user = User(
                clinic_id=clinic.id,
                email=email,
                google_subject_id=f"dev_{email.replace('@', '_').replace('.', '_')}",
                full_name=email.split('@')[0].title(),
                roles=["admin", "practitioner"] if user_type == "clinic_user" else [],
                is_active=True
            )
        else:
            # System admin - in dev mode, still create a User record but use a dummy clinic
            # This is different from OAuth where system admins use dummy user_id and no User record
            # NOTE: For consistency in dev/testing, dev_login system admins have User records
            # and will go through clinic user refresh path (not system admin path)
            clinic = db.query(Clinic).first()
            if not clinic:
                # Create a default clinic for dev system admins
                clinic = Clinic(
                    name="Development Clinic",
                    line_channel_id="dev_channel",
                    line_channel_secret="dev_secret",
                    line_channel_access_token="dev_token"
                )
                db.add(clinic)
                db.commit()
            
            user = User(
                clinic_id=clinic.id,
                email=email,
                google_subject_id=f"dev_{email.replace('@', '_').replace('.', '_')}",
                full_name=email.split('@')[0].title(),
                roles=[],  # System admins don't have clinic roles
                is_active=True
            )
        db.add(user)
        db.commit()

    # Create JWT tokens
    token_payload = TokenPayload(
        sub=str(user.google_subject_id),
        user_type="system_admin" if email in SYSTEM_ADMIN_EMAILS else "clinic_user",
        email=user.email,
        roles=user.roles,
        clinic_id=user.clinic_id,
        name=user.full_name
    )

    token_data = jwt_service.create_token_pair(token_payload)

    # Store refresh token
    refresh_token_hash = token_data["refresh_token_hash"]
    hmac_key = token_data["refresh_token_hmac"]

    refresh_token_record = RefreshToken(
        user_id=user.id,
        token_hash=refresh_token_hash,
        hmac_key=hmac_key,
        expires_at=jwt_service.get_token_expiry("refresh"),
        email=email if email in SYSTEM_ADMIN_EMAILS else None,  # Store email for system admins
        google_subject_id=str(user.google_subject_id) if email in SYSTEM_ADMIN_EMAILS else None,  # Store google_subject_id for system admins
        name=user.full_name if email in SYSTEM_ADMIN_EMAILS else None  # Store name for system admins
    )
    db.add(refresh_token_record)
    db.commit()

    return {
        "access_token": token_data["access_token"],
        "refresh_token": token_data["refresh_token"],
        "token_type": "bearer",
        "expires_in": str(jwt_service.get_token_expiry("access")),
        "user": {
            "user_id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "user_type": token_payload.user_type,
            "roles": user.roles
        }
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
    # Get refresh token from cookie (preferred) or request body (fallback for cross-origin)
    refresh_token = request.cookies.get("refresh_token")
    token_source = "cookie" if refresh_token else None

    # Fallback: Try to get from request body if cookie is not available
    # This handles cross-origin scenarios where cookies are blocked (Safari ITP)
    if not refresh_token:
        try:
            content_type = request.headers.get("content-type", "")
            if "application/json" in content_type:
                body = await request.json()
                refresh_token = body.get("refresh_token")
                if refresh_token:
                    token_source = "body"
                    logger.debug("Refresh token found in request body during logout (cookie fallback)")
        except Exception as e:
            logger.debug(f"Could not read request body as JSON during logout: {e}")

    # Revoke refresh token if found
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
            logger.info(f"Refresh token revoked during logout (source: {token_source})")
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
                    logger.info(f"Refresh token revoked during logout via linear scan (source: {token_source})")
                    break
    else:
        logger.debug("No refresh token found in cookie or request body during logout")

    # Clear the refresh token cookie
    delete_refresh_token_cookie(response, request)

    return {"message": "登出成功"}
