# pyright: reportMissingTypeStubs=false
"""
Authentication API endpoints.

Handles Google OAuth login, token refresh, and logout for both
system admins and clinic users.
"""

import logging
import os
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request, Query
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from datetime import datetime, timezone, timedelta
from typing import Dict, Any
from core.database import get_db
from core.config import API_BASE_URL, SYSTEM_ADMIN_EMAILS, FRONTEND_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
from services.jwt_service import jwt_service, TokenPayload
from models import RefreshToken, User, Clinic, UserClinicAssociation
from models.clinic import ClinicSettings
from auth.dependencies import get_active_clinic_association, require_authenticated, UserContext
from pydantic import BaseModel

router = APIRouter()

# Rate limiting for clinic switching (in-memory, per-user)
# Format: {user_id: [list of switch timestamps]}
_clinic_switch_rate_limit: Dict[int, list[datetime]] = defaultdict(list)
CLINIC_SWITCH_RATE_LIMIT = 10  # Max switches per minute
CLINIC_SWITCH_RATE_WINDOW = timedelta(minutes=1)


def check_clinic_switch_rate_limit(user_id: int) -> None:
    """
    Check if user has exceeded rate limit for clinic switching.
    
    Raises HTTPException if rate limit exceeded.
    """
    now = datetime.now(timezone.utc)
    window_start = now - CLINIC_SWITCH_RATE_WINDOW
    
    # Clean old entries
    user_switches = _clinic_switch_rate_limit[user_id]
    user_switches[:] = [ts for ts in user_switches if ts > window_start]
    
    # Check limit
    if len(user_switches) >= CLINIC_SWITCH_RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many clinic switches. Maximum {CLINIC_SWITCH_RATE_LIMIT} switches per minute."
        )
    
    # Record this switch
    user_switches.append(now)


def get_clinic_user_token_data(user: User, db: Session) -> Dict[str, Any]:
    """
    Get clinic-specific data for token creation.
    
    For clinic users, retrieves the active clinic association and returns
    clinic-specific roles and name. Updates last_accessed_at for default
    clinic selection.
    
    Args:
        user: User to get clinic data for
        db: Database session
        
    Returns:
        Dictionary with:
        - active_clinic_id: Currently selected clinic ID (None for system admins)
        - clinic_roles: Clinic-specific roles (empty list for system admins)
        - clinic_name: Clinic-specific name (user.email for system admins)
    """
    active_clinic_id = None
    clinic_roles: list[str] = []
    clinic_name = user.email  # System admins use email as name
    
    # Get active clinic association for clinic users
    association = get_active_clinic_association(user, db)
    if association:
        active_clinic_id = association.clinic_id
        clinic_roles = association.roles or []
        clinic_name = association.full_name  # Clinic users always have association.full_name
        
        # Update last_accessed_at for default clinic selection
        try:
            association.last_accessed_at = datetime.now(timezone.utc)
            db.flush()  # Use flush instead of commit to reduce blocking
        except Exception as e:
            logger.warning(f"Failed to update last_accessed_at for user {user.id}: {e}")
            # Don't fail authentication if update fails
    else:
        # System admin or user with no active clinic association
        # For system admins, this is expected (active_clinic_id will be None)
        # For clinic users, this shouldn't happen after migration, but handle gracefully
        pass
    
    return {
        "active_clinic_id": active_clinic_id,
        "clinic_roles": clinic_roles,
        "clinic_name": clinic_name
    }


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
        error_url = f"{FRONTEND_URL}/admin/login?error=true&message={quote(error_message)}"
        return RedirectResponse(url=error_url, status_code=302)
    
    # Ensure code is provided if no error
    if not code:
        logger.warning("OAuth callback missing code parameter")
        from fastapi.responses import RedirectResponse
        from urllib.parse import quote
        error_url = f"{FRONTEND_URL}/admin/login?error=true&message={quote('認證失敗：缺少授權碼')}"
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

            # For system admins, get or create User record (no clinic associations)
            existing_user = db.query(User).filter(
                User.email == email
            ).first()
            
            # Verify it's actually a system admin (no associations)
            if existing_user:
                has_associations = db.query(UserClinicAssociation).filter(  # type: ignore
                    UserClinicAssociation.user_id == existing_user.id  # type: ignore
                ).first() is not None
                if has_associations:
                    existing_user = None  # Not a system admin, treat as new user
            
            if not existing_user:
                # Create new User record for system admin
                now = datetime.now(timezone.utc)
                existing_user = User(
                    email=email,
                    google_subject_id=google_subject_id,
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
                # full_name removed from User model - system admins use email as name
                existing_user.last_login_at = datetime.now(timezone.utc)
                existing_user.updated_at = datetime.now(timezone.utc)
                db.commit()
                db.refresh(existing_user)
                logger.info(f"Updated User record for system admin: {email}")

            # Create token payload for system admin
            payload = TokenPayload(
                sub=google_subject_id,
                user_id=existing_user.id,
                email=email,
                user_type="system_admin",
                roles=[],  # System admins don't have clinic roles
                active_clinic_id=None,
                name=name
            )

            redirect_url = f"{FRONTEND_URL}/admin/system/clinics"

        else:
            # This is a clinic user - they need to go through signup flow
            # Check if intended to be clinic user
            if intended_user_type != "clinic_user":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="請使用診所使用者登入選項"
                )

            # For clinic users, check if they have an existing account
            # Check by email (clinic users should have at least one association)
            existing_user = db.query(User).filter(
                User.email == email
            ).first()
            
            if existing_user:
                # User is_active check removed - access controlled by association.is_active
                
                # Verify user has at least one active clinic association
                has_association = db.query(UserClinicAssociation).filter(
                    UserClinicAssociation.user_id == existing_user.id,
                    UserClinicAssociation.is_active == True
                ).first()
                
                if not has_association:
                    # User exists but has no active clinic association - redirect to signup
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="診所使用者認證必須透過註冊流程"
                    )
                
                # Update last login
                existing_user.last_login_at = datetime.now(timezone.utc)
                existing_user.updated_at = datetime.now(timezone.utc)
                db.commit()
                
                # Get clinic-specific data for token creation
                clinic_data = get_clinic_user_token_data(existing_user, db)
                
                # Existing active clinic user - create tokens
                payload = TokenPayload(
                    sub=google_subject_id,
                    user_id=existing_user.id,
                    email=email,
                    user_type="clinic_user",
                    roles=clinic_data["clinic_roles"],
                    active_clinic_id=clinic_data["active_clinic_id"],
                    name=clinic_data["clinic_name"]
                )

                # Redirect to default clinic user route (will be determined by frontend based on role)
                # Frontend will redirect practitioners to /admin/calendar and others to /admin/clinic/members
                redirect_url = f"{FRONTEND_URL}/admin"
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
            error_url = f"{FRONTEND_URL}/admin/login?error=true&message={e.detail}"
            return RedirectResponse(url=error_url, status_code=302)
        elif e.detail == "帳戶已被停用，請聯繫診所管理員重新啟用":
            from fastapi.responses import RedirectResponse
            error_url = f"{FRONTEND_URL}/admin/login?error=true&message={e.detail}"
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
) -> Dict[str, Any]:
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
            
            # Check if User record already exists (system admin - no associations)
            user = db.query(User).filter(
                User.email == refresh_token_record.email
            ).first()
            
            # Verify it's actually a system admin (no associations)
            if user:
                has_associations = db.query(UserClinicAssociation).filter(  # type: ignore
                    UserClinicAssociation.user_id == user.id  # type: ignore
                ).first() is not None
                if has_associations:
                    user = None  # Not a system admin
            
            if not user:
                # Create User record for system admin
                user = User(
                    email=refresh_token_record.email,
                    google_subject_id=refresh_token_record.google_subject_id or refresh_token_record.email,
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
    
    # User is_active check removed - access controlled by association.is_active for clinic users
    
    # Determine user type based on clinic associations
    # System admins have no clinic associations, clinic users have at least one
    has_association = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user.id,
        UserClinicAssociation.is_active == True
    ).first()
    is_system_admin = not has_association
    
    if is_system_admin:
        # Verify email is in system admin whitelist
        if user.email not in SYSTEM_ADMIN_EMAILS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    else:
        # Clinic users MUST have at least one active association
        if not has_association:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User must have at least one active clinic association"
            )
    
    # Get clinic-specific data for token creation
    clinic_data = get_clinic_user_token_data(user, db)
    
    # Unified token payload creation for both system admins and clinic users
    payload = TokenPayload(
        sub=str(user.google_subject_id),
        user_id=user.id,
        email=user.email,
        user_type="system_admin" if is_system_admin else "clinic_user",
        roles=[] if is_system_admin else clinic_data["clinic_roles"],  # System admins don't have clinic roles
        active_clinic_id=clinic_data["active_clinic_id"],  # Currently selected clinic for clinic users
        name=clinic_data["clinic_name"]  # Clinic-specific name for clinic users
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

    # Return response with access token, refresh token, and user data
    # This eliminates the need for a separate /auth/verify call
    response_data: Dict[str, Any] = {
        "access_token": token_data["access_token"],
        "token_type": token_data["token_type"],
        "expires_in": str(token_data["expires_in"]),
        "refresh_token": token_data["refresh_token"],
        "user": {
            "user_id": user.id,
            "active_clinic_id": clinic_data["active_clinic_id"],
            "email": user.email,
            "full_name": clinic_data["clinic_name"],
            "user_type": "system_admin" if is_system_admin else "clinic_user",
            "roles": [] if is_system_admin else clinic_data["clinic_roles"]
        }
    }
    
    # Log successful refresh
    # Both system admins and clinic users now have User records
    logger.info(
        f"Token refresh successful - user: {user.email}, "
        f"user_type: {'system_admin' if is_system_admin else 'clinic_user'}, "
        f"token_rotated: True"
    )
    
    return response_data


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
    # Get user by email
    user = db.query(User).filter(
        User.email == email
    ).first()
    
    # Verify user type matches
    if user:
        has_associations = db.query(UserClinicAssociation).filter(  # type: ignore
            UserClinicAssociation.user_id == user.id  # type: ignore
        ).first() is not None
        
        if user_type == "system_admin" and has_associations:
            # User has associations but we're expecting system admin
            user = None
        elif user_type == "clinic_user" and not has_associations:
            # User has no associations but we're expecting clinic user
            user = None
    
    if not user:
        # Create a new user
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
            
            # Create user
            user = User(
                email=email,
                google_subject_id=f"dev_{email.replace('@', '_').replace('.', '_')}",
                full_name=email.split('@')[0].title(),
                is_active=True,
                created_at=now,
                updated_at=now
            )
            db.add(user)
            db.flush()
            
            # Create clinic association
            association = UserClinicAssociation(
                user_id=user.id,
                clinic_id=clinic.id,
                roles=["admin", "practitioner"],
                full_name=email.split('@')[0].title(),
                is_active=True,
                created_at=now,
                updated_at=now
            )
            db.add(association)
        else:
            # System admin - create User record (no clinic associations)
            user = User(
                email=email,
                google_subject_id=f"dev_{email.replace('@', '_').replace('.', '_')}",
                created_at=now,
                updated_at=now
            )
        db.add(user)
        db.commit()
        db.refresh(user)

    # Determine user type - check if user has any clinic associations
    has_associations = db.query(UserClinicAssociation).filter(  # type: ignore
        UserClinicAssociation.user_id == user.id  # type: ignore
    ).first() is not None
    is_system_admin = not has_associations or email in SYSTEM_ADMIN_EMAILS
    
    # Get clinic-specific data for token creation
    clinic_data = get_clinic_user_token_data(user, db)
    
    # Create JWT tokens
    token_payload = TokenPayload(
        sub=str(user.google_subject_id),
        user_id=user.id,
        user_type="system_admin" if is_system_admin else "clinic_user",
        email=user.email,
        roles=[] if is_system_admin else clinic_data["clinic_roles"],  # System admins don't have clinic roles
        active_clinic_id=clinic_data["active_clinic_id"],  # Currently selected clinic for clinic users
        name=clinic_data["clinic_name"]  # Clinic-specific name for clinic users
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
            "full_name": user.email,  # System admins use email as name
            "user_type": token_payload.user_type,
            "roles": token_payload.roles  # Clinic-specific roles from token
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


# ===== Request/Response Models for Clinic Switching =====

class ClinicInfoResponse(BaseModel):
    """Clinic information in clinics list response."""
    id: int
    name: str
    display_name: str
    roles: list[str]
    is_active: bool
    last_accessed_at: datetime | None


class ClinicsListResponse(BaseModel):
    """Response for listing available clinics."""
    clinics: list[ClinicInfoResponse]
    active_clinic_id: int | None


class SwitchClinicRequest(BaseModel):
    """Request to switch active clinic."""
    clinic_id: int


class SwitchClinicResponse(BaseModel):
    """Response for clinic switching."""
    access_token: str | None  # None when idempotent (use current token)
    refresh_token: str | None  # None when idempotent (use current token)
    active_clinic_id: int
    roles: list[str]
    name: str
    clinic: dict[str, Any]


# ===== Clinic Management Endpoints =====

@router.get("/clinics", summary="List available clinics for current user")
async def list_available_clinics(
    current_user: UserContext = Depends(require_authenticated),
    include_inactive: bool = Query(False, description="Include inactive associations"),
    db: Session = Depends(get_db)
) -> ClinicsListResponse:
    """
    Get list of clinics the user can access.
    
    For system admins, returns empty list (they don't have clinic associations).
    For clinic users, returns all active clinic associations.
    """
    # System admins don't have clinic associations
    if current_user.is_system_admin():
        return ClinicsListResponse(
            clinics=[],
            active_clinic_id=None
        )
    
    # Get user record
    user = db.query(User).filter(User.id == current_user.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Build query for clinic associations
    query = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user.id
    ).join(Clinic).filter(
        Clinic.is_active == True  # Only active clinics
    )
    
    # Filter by is_active unless include_inactive is True
    if not include_inactive:
        query = query.filter(UserClinicAssociation.is_active == True)
    
    # Order by last_accessed_at DESC (most recently used first), then by id
    associations = query.order_by(
        UserClinicAssociation.last_accessed_at.desc().nulls_last(),
        UserClinicAssociation.id.asc()
    ).all()
    
    # Build response
    clinic_list: list[ClinicInfoResponse] = []
    for association in associations:
        clinic_list.append(ClinicInfoResponse(
            id=association.clinic_id,
            name=association.clinic.name,
            display_name=association.clinic.name,  # Use name as display_name for now
            roles=association.roles or [],
            is_active=association.is_active,
            last_accessed_at=association.last_accessed_at
        ))
    
    return ClinicsListResponse(
        clinics=clinic_list,
        active_clinic_id=current_user.active_clinic_id
    )


@router.post("/switch-clinic", summary="Switch active clinic context")
async def switch_clinic(
    request_data: SwitchClinicRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> SwitchClinicResponse:
    """
    Switch active clinic context.
    
    Validates that the user has access to the requested clinic, updates
    last_accessed_at, and returns a new JWT token with the new active_clinic_id.
    """
    # System admins cannot switch clinics (they don't have clinic associations)
    if current_user.is_system_admin():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="System admins cannot switch clinics"
        )
    
    # Check rate limit (skip for idempotent case)
    if current_user.active_clinic_id != request_data.clinic_id:
        if current_user.user_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid user context"
            )
        check_clinic_switch_rate_limit(current_user.user_id)
    
    # Check if already on requested clinic (idempotent)
    if current_user.active_clinic_id == request_data.clinic_id:
        # Get clinic info for response
        clinic = db.query(Clinic).filter(Clinic.id == request_data.clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Clinic not found"
            )
        
        # Return current token info without generating new token
        # Frontend should use current access_token and refresh_token
        return SwitchClinicResponse(
            access_token=None,  # None indicates to use current token
            refresh_token=None,  # None indicates to use current token
            active_clinic_id=request_data.clinic_id,
            roles=current_user.roles,
            name=current_user.name,
            clinic={
                "id": clinic.id,
                "name": clinic.name,
                "display_name": clinic.name
            }
        )
    
    # Get user record
    user = db.query(User).filter(User.id == current_user.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Verify association exists and is active
    association = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user.id,
        UserClinicAssociation.clinic_id == request_data.clinic_id,
        UserClinicAssociation.is_active == True
    ).join(Clinic).filter(
        Clinic.is_active == True  # Clinic must also be active
    ).first()
    
    if not association:
        # Check if clinic exists but association is inactive
        clinic_exists = db.query(Clinic).filter(
            Clinic.id == request_data.clinic_id,
            Clinic.is_active == True
        ).first()
        
        if not clinic_exists:
            # Check if clinic exists but is inactive
            inactive_clinic = db.query(Clinic).filter(Clinic.id == request_data.clinic_id).first()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="此診所已停用" if inactive_clinic else "您沒有此診所的存取權限"
            )
        
        # Check if association exists but is inactive
        inactive_association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user.id,
            UserClinicAssociation.clinic_id == request_data.clinic_id
        ).first()
        
        if inactive_association:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您在此診所的存取權限已被停用"
            )
        
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您沒有此診所的存取權限"
        )
    
    # Update last_accessed_at to track this clinic as most recently accessed
    # This is one of only two places where last_accessed_at is updated:
    # 1. Here (clinic switch) - when user explicitly switches clinics
    # 2. OAuth login (get_clinic_user_token_data) - for initial clinic selection
    # Note: It is NOT updated in get_current_user() to avoid lock contention on every API request
    try:
        association.last_accessed_at = datetime.now(timezone.utc)
        db.flush()
    except Exception as e:
        logger.warning(f"Failed to update last_accessed_at for user {user.id}: {e}")
        # Don't fail the request if update fails
    
    # Create new token payload with new active_clinic_id
    # Use the association we just validated (not get_clinic_user_token_data which selects most recent)
    payload = TokenPayload(
        sub=str(user.google_subject_id),
        user_id=user.id,
        email=user.email,
        user_type="clinic_user",
        roles=association.roles or [],
        active_clinic_id=request_data.clinic_id,
        name=association.full_name  # Clinic users always have association.full_name
    )
    
    # Create new token pair
    token_data = jwt_service.create_token_pair(payload)
    
    # Store new refresh token
    refresh_token_hash = token_data["refresh_token_hash"]
    refresh_token_hash_sha256 = token_data.get("refresh_token_hash_sha256")
    
    new_refresh_token_record = RefreshToken(
        user_id=user.id,
        token_hash=refresh_token_hash,
        token_hash_sha256=refresh_token_hash_sha256,
        expires_at=jwt_service.get_token_expiry("refresh"),
        email=None,
        google_subject_id=None,
        name=None
    )
    db.add(new_refresh_token_record)
    db.commit()
    
    return SwitchClinicResponse(
        access_token=token_data["access_token"],
        refresh_token=token_data["refresh_token"],
        active_clinic_id=request_data.clinic_id,
        roles=association.roles or [],
        name=association.full_name,  # Clinic users always have association.full_name
        clinic={
            "id": association.clinic_id,
            "name": association.clinic.name,
            "display_name": association.clinic.name  # Use name as display_name for now
        }
    )
