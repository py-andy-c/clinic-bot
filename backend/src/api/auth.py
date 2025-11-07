# pyright: reportMissingTypeStubs=false
"""
Authentication API endpoints.

Handles Google OAuth login, token refresh, and logout for both
system admins and clinic users.
"""

import logging
import os
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request, Query
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from datetime import datetime, timezone
from typing import Dict, Any
from core.database import get_db
from core.config import API_BASE_URL, SYSTEM_ADMIN_EMAILS, FRONTEND_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
from services.jwt_service import jwt_service, TokenPayload
from models import RefreshToken, User, Clinic
from models.clinic import ClinicSettings
from auth.dependencies import UserContext, get_current_user

router = APIRouter()


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
    # NOTE: Calendar scopes removed - requiring calendar access would need Google App verification.
    if user_type == "system_admin":
        scopes = ["openid", "profile", "email"]
    else:  # clinic_user
        scopes = [
            "openid", "profile", "email"
            # Calendar scopes disabled - would require Google App verification:
            # "https://www.googleapis.com/auth/calendar.events",
            # "https://www.googleapis.com/auth/calendar.settings.readonly"
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

        # Determine user type based on email (not frontend intention)
        existing_user = None

        if email in SYSTEM_ADMIN_EMAILS:
            # This is a system admin regardless of which button was clicked

            # For system admins, get or create User record (with clinic_id=None)
            existing_user = db.query(User).filter(
                User.email == email,
                User.clinic_id.is_(None)  # System admins have clinic_id=None
            ).first()
            
            if not existing_user:
                # Create new User record for system admin
                now = datetime.now(timezone.utc)
                existing_user = User(
                    clinic_id=None,  # System admins don't belong to clinics
                    email=email,
                    google_subject_id=google_subject_id,
                    full_name=name,
                    roles=[],  # System admins don't have clinic roles
                    is_active=True,
                    created_at=now,
                    updated_at=now
                )
                db.add(existing_user)
                db.commit()
                db.refresh(existing_user)
                logger.info(f"Created User record for system admin: {email}")
            else:
                # Update existing system admin User record
                existing_user.google_subject_id = google_subject_id
                existing_user.full_name = name
                existing_user.last_login_at = datetime.now(timezone.utc)
                existing_user.updated_at = datetime.now(timezone.utc)
                db.commit()
                db.refresh(existing_user)
                logger.info(f"Updated User record for system admin: {email}")

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
            existing_user = db.query(User).filter(
                User.email == email,
                User.clinic_id.isnot(None)  # Clinic users must have clinic_id
            ).first()
            if existing_user:
                # Check if user is active
                if not existing_user.is_active:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="帳戶已被停用，請聯繫診所管理員重新啟用"
                    )
                
                # Update last login
                existing_user.last_login_at = datetime.now(timezone.utc)
                existing_user.updated_at = datetime.now(timezone.utc)
                db.commit()
                
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

        # Create token pair and store refresh token in database
        # Wrap in try-catch to rollback database changes if token creation fails
        try:
            # Create token pair
            token_data = jwt_service.create_token_pair(payload)

            # Store refresh token in database
            # Now both system admins and clinic users have User records
            assert existing_user is not None, "existing_user should not be None"
            user_id_for_token = existing_user.id

            refresh_token_hash = token_data["refresh_token_hash"]
            refresh_token_hash_sha256 = token_data.get("refresh_token_hash_sha256")  # SHA-256 hash for O(1) lookup

            refresh_token_record = RefreshToken(
                user_id=user_id_for_token,  # Both system admins and clinic users have user_id now
                token_hash=refresh_token_hash,
                token_hash_sha256=refresh_token_hash_sha256,  # SHA-256 hash for O(1) lookup
                expires_at=jwt_service.get_token_expiry("refresh"),
                email=None,  # No longer needed - user_id links to User record
                google_subject_id=None,  # No longer needed - user_id links to User record
                name=None  # No longer needed - user_id links to User record
            )
            db.add(refresh_token_record)
            db.commit()

            # Create redirect response with tokens in URL
            from fastapi.responses import RedirectResponse
            from urllib.parse import quote
            redirect_url_with_tokens = f"{redirect_url}?token={quote(token_data['access_token'])}&refresh_token={quote(token_data['refresh_token'])}"
            logger.debug(f"OAuth redirect: tokens included in URL")
            response = RedirectResponse(
                url=redirect_url_with_tokens,
                status_code=302
            )

            return response
        except Exception as e:
            # Rollback database changes if token creation or redirect fails
            db.rollback()
            logger.exception(f"Failed to create tokens or redirect in OAuth callback: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="認證失敗"
            )

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
    Refresh access token using refresh token from request body.
    
    Returns new access token and refresh token.
    """
    # Get refresh token from request body
    try:
        body = await request.json()
        refresh_token = body.get("refresh_token")
    except Exception as e:
        logger.debug(f"Could not read request body as JSON: {e}")
        refresh_token = None
    
    # Validate refresh token format
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="找不到重新整理權杖"
        )
    
    # Validate refresh token format (must be a non-empty string with minimum length)
    if not isinstance(refresh_token, str) or len(refresh_token.strip()) < 10:
        logger.warning(f"Invalid refresh token format: type={type(refresh_token)}, length={len(refresh_token) if isinstance(refresh_token, str) else 0}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的重新整理權杖格式"
        )

    # Optimized O(1) lookup using SHA-256 hash
    # First, compute SHA-256 hash of the incoming token
    token_hash_sha256 = jwt_service.get_refresh_token_sha256_hash(refresh_token)
    
    # Use SHA-256 hash for fast O(1) lookup via index
    refresh_token_record = db.query(RefreshToken).filter(
        RefreshToken.token_hash_sha256 == token_hash_sha256,
        RefreshToken.revoked == False,
        RefreshToken.expires_at > datetime.now(timezone.utc)
    ).first()
    
    # If not found with SHA-256 hash (old token without SHA-256), fall back to O(n) scan
    if not refresh_token_record:
        logger.debug("Refresh token not found via SHA-256 hash, falling back to O(n) scan for backward compatibility")
        # Fallback: O(n) scan for old tokens without SHA-256 hash
        valid_tokens = db.query(RefreshToken).filter(
            RefreshToken.token_hash_sha256.is_(None),  # Only check tokens without SHA-256 hash
            RefreshToken.revoked == False,
            RefreshToken.expires_at > datetime.now(timezone.utc)
        ).all()

        for token_record in valid_tokens:
            if jwt_service.verify_refresh_token_hash(refresh_token, token_record.token_hash):
                refresh_token_record = token_record
                # Update old token with SHA-256 hash for future O(1) lookups
                token_record.token_hash_sha256 = token_hash_sha256
                db.commit()
                logger.debug(f"Updated old refresh token with SHA-256 hash - user_id: {token_record.user_id}")
                break

    if not refresh_token_record:
        logger.warning(
            f"Refresh token validation failed - token not found in database or expired/revoked"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="無效的重新整理權杖"
        )
    
    # Verify with bcrypt hash for security (SHA-256 is just for lookup)
    if not jwt_service.verify_refresh_token_hash(refresh_token, refresh_token_record.token_hash):
        logger.warning("Refresh token SHA-256 hash matched but bcrypt verification failed")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="無效的重新整理權杖"
        )
    
    logger.debug(f"Refresh token validated - user_id: {refresh_token_record.user_id}, "
                f"expires_at: {refresh_token_record.expires_at}")
    
    # Now both system admins and clinic users have User records
    # Look up user from refresh token
    user = refresh_token_record.user
    
    # Backward compatibility: Handle old refresh tokens with user_id=None
    # These are from before the unification migration
    if user is None:
        # Check if this is an old system admin refresh token (has email stored)
        if refresh_token_record.email and refresh_token_record.email in SYSTEM_ADMIN_EMAILS:
            # Migrate old system admin refresh token: create User record
            logger.warning(f"Migrating old system admin refresh token for {refresh_token_record.email}")
            now = datetime.now(timezone.utc)
            
            # Check if User record already exists
            user = db.query(User).filter(
                User.email == refresh_token_record.email,
                User.clinic_id.is_(None)
            ).first()
            
            if not user:
                # Create User record for system admin
                user = User(
                    clinic_id=None,
                    email=refresh_token_record.email,
                    google_subject_id=refresh_token_record.google_subject_id or refresh_token_record.email,
                    full_name=refresh_token_record.name or refresh_token_record.email.split('@')[0].title(),
                    roles=[],
                    is_active=True,
                    created_at=now,
                    updated_at=now
                )
                db.add(user)
                db.commit()
                db.refresh(user)
                logger.info(f"Created User record for system admin during refresh token migration: {refresh_token_record.email}")
            
            # Update refresh token to link to User record
            refresh_token_record.user_id = user.id
            refresh_token_record.email = None  # Clear legacy field
            refresh_token_record.google_subject_id = None  # Clear legacy field
            refresh_token_record.name = None  # Clear legacy field
            db.commit()
        else:
            # Invalid refresh token - no user record and not a system admin
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="找不到使用者或使用者已停用"
            )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="找不到使用者或使用者已停用"
        )
    
    # Determine user type based on clinic_id
    # System admins have clinic_id=None, clinic users have clinic_id set
    is_system_admin = user.clinic_id is None
    
    if is_system_admin:
        # Verify email is in system admin whitelist
        if user.email not in SYSTEM_ADMIN_EMAILS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    # Unified token payload creation for both system admins and clinic users
    payload = TokenPayload(
        sub=str(user.google_subject_id),
        email=user.email,
        user_type="system_admin" if is_system_admin else "clinic_user",
        roles=[] if is_system_admin else user.roles,  # System admins don't have clinic roles
        clinic_id=user.clinic_id,  # None for system admins, clinic_id for clinic users
        name=user.full_name
    )
    
    token_data = jwt_service.create_token_pair(payload)
    
    # Revoke old refresh token
    refresh_token_record.revoke()
    
    # Create new refresh token record (same for both system admins and clinic users)
    new_refresh_token_record = RefreshToken(
        user_id=user.id,  # Both system admins and clinic users have user_id now
        token_hash=token_data["refresh_token_hash"],
        token_hash_sha256=token_data.get("refresh_token_hash_sha256"),  # SHA-256 hash for O(1) lookup
        expires_at=jwt_service.get_token_expiry("refresh"),
        email=None,  # No longer needed - user_id links to User record
        google_subject_id=None,  # No longer needed - user_id links to User record
        name=None  # No longer needed - user_id links to User record
    )
    db.add(new_refresh_token_record)
    db.commit()

    # Return response with access token and refresh token
    response_data = {
        "access_token": token_data["access_token"],
        "token_type": token_data["token_type"],
        "expires_in": str(token_data["expires_in"]),
        "refresh_token": token_data["refresh_token"]
    }
    
    # Log successful refresh
    # Both system admins and clinic users now have User records
    logger.info(
        f"Token refresh successful - user: {user.email}, "
        f"user_type: {'system_admin' if is_system_admin else 'clinic_user'}, "
        f"token_rotated: True"
    )
    
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
    # For system admins, check with clinic_id=None
    # For clinic users, check with clinic_id set
    if user_type == "system_admin":
        user = db.query(User).filter(
            User.email == email,
            User.clinic_id.is_(None)  # System admins have clinic_id=None
        ).first()
    else:
        user = db.query(User).filter(
            User.email == email,
            User.clinic_id.isnot(None)  # Clinic users must have clinic_id
        ).first()
    
    if not user:
        # Create a new user
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        
        if user_type == "clinic_user":
            # Need a clinic for clinic users
            clinic = db.query(Clinic).first()
            if not clinic:
                # Create default clinic using ClinicSettings with all defaults
                clinic = Clinic(
                    name="Development Clinic",
                    line_channel_id="dev_channel",
                    line_channel_secret="dev_secret",
                    line_channel_access_token="dev_token",
                    settings=ClinicSettings().model_dump()  # Use all defaults from Pydantic model
                )
                db.add(clinic)
                db.commit()

            user = User(
                clinic_id=clinic.id,
                email=email,
                google_subject_id=f"dev_{email.replace('@', '_').replace('.', '_')}",
                full_name=email.split('@')[0].title(),
                roles=["admin", "practitioner"],
                is_active=True,
                created_at=now,
                updated_at=now
            )
        else:
            # System admin - create User record with clinic_id=None
            user = User(
                clinic_id=None,  # System admins have clinic_id=None
                email=email,
                google_subject_id=f"dev_{email.replace('@', '_').replace('.', '_')}",
                full_name=email.split('@')[0].title(),
                roles=[],  # System admins don't have clinic roles
                is_active=True,
                created_at=now,
                updated_at=now
            )
        db.add(user)
        db.commit()
        db.refresh(user)

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
    refresh_token_hash_sha256 = token_data.get("refresh_token_hash_sha256")  # SHA-256 hash for O(1) lookup

    refresh_token_record = RefreshToken(
        user_id=user.id,
        token_hash=refresh_token_hash,
        token_hash_sha256=refresh_token_hash_sha256,  # SHA-256 hash for O(1) lookup
        expires_at=jwt_service.get_token_expiry("refresh"),
        email=None,  # No longer needed - user_id links to User record
        google_subject_id=None,  # No longer needed - user_id links to User record
        name=None  # No longer needed - user_id links to User record
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
    Logout the current user by revoking refresh token.
    """
    # Get refresh token from request body
    try:
        body = await request.json()
        refresh_token = body.get("refresh_token")
    except Exception as e:
        logger.debug(f"Could not read request body as JSON during logout: {e}")
        refresh_token = None

    # Revoke refresh token if found
    if refresh_token:
        # Optimized O(1) lookup using SHA-256 hash
        token_hash_sha256 = jwt_service.get_refresh_token_sha256_hash(refresh_token)
        
        # Use SHA-256 hash for fast O(1) lookup via index
        token_record = db.query(RefreshToken).filter(
            RefreshToken.token_hash_sha256 == token_hash_sha256,
            RefreshToken.revoked == False,
            RefreshToken.expires_at > datetime.now(timezone.utc)
        ).first()
        
        if token_record:
            # Verify with bcrypt hash for security
            if jwt_service.verify_refresh_token_hash(refresh_token, token_record.token_hash):
                token_record.revoke()
                db.commit()
                logger.info("Refresh token revoked during logout")
        else:
            # Fallback: O(n) scan for old tokens without SHA-256 hash
            valid_tokens = db.query(RefreshToken).filter(
                RefreshToken.token_hash_sha256.is_(None),  # Only check tokens without SHA-256 hash
                RefreshToken.revoked == False,
                RefreshToken.expires_at > datetime.now(timezone.utc)
            ).all()

            for token_record in valid_tokens:
                if jwt_service.verify_refresh_token_hash(refresh_token, token_record.token_hash):
                    token_record.revoke()
                    db.commit()
                    logger.info("Refresh token revoked during logout (fallback)")
                    break
    else:
        logger.debug("No refresh token found in request body during logout")

    return {"message": "登出成功"}
