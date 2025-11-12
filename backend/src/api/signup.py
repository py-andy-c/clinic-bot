# pyright: reportMissingTypeStubs=false
"""
Signup API endpoints.

Handles secure token-based user onboarding for clinic admins and team members.
"""

import logging
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import API_BASE_URL, FRONTEND_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
from services.jwt_service import jwt_service, TokenPayload
from models import User, SignupToken, RefreshToken, UserClinicAssociation, Clinic
from auth.dependencies import get_active_clinic_association, require_authenticated, UserContext
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)

router = APIRouter()


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
    except Exception as e:
        logger.exception(f"Error initiating clinic admin signup: {e}")
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
    except Exception as e:
        logger.exception(f"Error initiating member signup: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="註冊流程初始化失敗"
        )


@router.get("/callback", summary="Handle signup OAuth callback")
async def signup_oauth_callback(
    request: Request,
    code: str = Query(None),
    state: str = Query(...),
    error: str = Query(None),
    db: Session = Depends(get_db)
) -> RedirectResponse:
    """
    Handle OAuth callback for user signup and account creation.

    Args:
        code: Authorization code from Google (optional if user cancelled)
        state: Signed JWT containing signup type and token
        error: Error code from Google OAuth (e.g., 'access_denied' if user cancelled)

    Returns:
        Redirect URL for appropriate dashboard
    """
    # Handle user cancellation or OAuth errors
    if error:
        logger.info(f"OAuth callback error: {error}")
        from urllib.parse import quote
        error_message = "註冊已取消" if error == "access_denied" else "認證失敗"
        error_url = f"{FRONTEND_URL}/login?error=true&message={quote(error_message)}"
        return RedirectResponse(url=error_url, status_code=302)

    # Ensure code is provided if no error
    if not code:
        logger.warning("OAuth callback missing code parameter")
        from urllib.parse import quote
        error_url = f"{FRONTEND_URL}/login?error=true&message={quote('認證失敗：缺少授權碼')}"
        return RedirectResponse(url=error_url, status_code=302)

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
            # User already exists, redirect to login with proper error message
            from urllib.parse import quote
            error_message = "此 Google 帳號已經註冊過，請直接登入"
            return RedirectResponse(
                url=f"{FRONTEND_URL}/login?error=true&message={quote(error_message)}",
                status_code=302
            )

        # Check if email is already used in this clinic via association
        existing_email = db.query(User).join(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == signup_token.clinic_id,
            User.email == email,
            UserClinicAssociation.is_active == True,
            User.is_active == True
        ).first()

        if existing_email:
            # Email already used, redirect with error
            from urllib.parse import quote
            error_message = "此 email 已在診所中註冊，請直接登入或聯繫管理員"
            return RedirectResponse(
                url=f"{FRONTEND_URL}/login?error=true&message={quote(error_message)}",
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
    except Exception as e:
        db.rollback()
        logger.exception(f"Error in signup OAuth callback: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="註冊失敗"
        )


class NameConfirmationRequest(BaseModel):
    """Request model for name confirmation."""
    full_name: str


class JoinClinicRequest(BaseModel):
    """Request model for existing user joining a new clinic."""
    full_name: Optional[str] = None  # Optional: clinic-specific name


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
        
        # Create UserClinicAssociation for the new user
        now = datetime.now(timezone.utc)
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic_id,
            roles=roles,
            full_name=request.full_name.strip(),
            is_active=True,
            last_accessed_at=now,
            created_at=now,
            updated_at=now
        )
        db.add(association)
        db.commit()
        db.refresh(association)
        
        # Mark signup token as used
        signup_token.used_at = datetime.now(timezone.utc)
        signup_token.used_by_email = email
        db.commit()
        
        # Get active clinic association (should be the one we just created)
        # This ensures we use clinic-specific roles and name
        active_association = get_active_clinic_association(user, db)
        if active_association:
            active_clinic_id = active_association.clinic_id
            clinic_roles: list[str] = active_association.roles or []
            clinic_name = active_association.full_name or user.full_name
        else:
            # Fallback (shouldn't happen, but handle gracefully)
            active_clinic_id = clinic_id
            clinic_roles: list[str] = roles or []
            clinic_name = user.full_name
        
        # Create JWT token payload
        payload = TokenPayload(
            sub=str(google_subject_id),
            user_id=user.id,
            email=str(email),
            user_type="clinic_user",
            roles=clinic_roles,  # Use clinic-specific roles from association
            active_clinic_id=active_clinic_id,  # Currently selected clinic
            name=clinic_name  # Clinic-specific name from association
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
    except Exception as e:
        db.rollback()
        logger.exception(f"Error in name confirmation and signup completion: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="註冊完成失敗"
        )


def _reactivate_association(
    association: UserClinicAssociation,
    signup_token: SignupToken,
    request: JoinClinicRequest,
    db: Session
) -> None:
    """
    Reactivate an inactive user-clinic association.
    
    Updates the association to active, sets roles from signup token,
    optionally updates name, and updates last_accessed_at.
    """
    now = datetime.now(timezone.utc)
    association.is_active = True
    association.roles = signup_token.default_roles or []
    if request.full_name and request.full_name.strip():
        association.full_name = request.full_name.strip()
    association.last_accessed_at = now
    association.updated_at = now
    db.commit()
    db.refresh(association)


def _get_clinic_name(request: JoinClinicRequest, current_user: UserContext) -> str:
    """
    Get clinic-specific name with fallback logic.
    
    Priority:
    1. Request full_name (if provided and non-empty)
    2. Current user's name
    3. Email username (before @)
    4. "User" as final fallback
    """
    return (
        request.full_name.strip() if request.full_name and request.full_name.strip()
        else current_user.name
        or (current_user.email.split("@")[0] if current_user.email else "User")
    )


@router.post("/member/join-existing", summary="Join clinic as existing user")
async def join_clinic_as_existing_user(
    token: str,
    request: JoinClinicRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """
    Create user-clinic association for existing user.
    
    User must be authenticated. This is called when an existing user
    clicks a signup link for a new clinic.
    
    Handles race conditions via database unique constraint.
    
    Args:
        token: Signup token for the clinic
        request: Optional clinic-specific name
        current_user: Authenticated user context
        db: Database session
        
    Returns:
        Dictionary with association details and clinic info
    """
    try:
        # System admins cannot join clinics
        if current_user.is_system_admin():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="系統管理員無法加入診所"
            )
        
        # Validate user_id is available
        if current_user.user_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無效的使用者上下文"
            )
        
        # Validate signup token
        signup_token = db.query(SignupToken).filter(
            SignupToken.token == token,
            SignupToken.expires_at > datetime.now(timezone.utc),
            SignupToken.is_revoked == False
        ).first()
        
        if not signup_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="註冊連結已失效，請聯繫診所處理。"
            )
        
        # Validate clinic is active
        clinic = db.query(Clinic).filter(
            Clinic.id == signup_token.clinic_id,
            Clinic.is_active == True
        ).first()
        
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="此診所已停用"
            )
        
        # Check if association already exists (optimistic check)
        existing = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == current_user.user_id,
            UserClinicAssociation.clinic_id == signup_token.clinic_id
        ).first()
        
        if existing:
            if existing.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="您已經是此診所的成員"
                )
            else:
                # Reactivate existing association
                _reactivate_association(existing, signup_token, request, db)
                association = existing
                # Mark token as used (user is using the token to reactivate)
                if signup_token.used_at is None:
                    signup_token.used_at = datetime.now(timezone.utc)
                    signup_token.used_by_email = current_user.email
                    db.commit()
        else:
            # Create new association (handle race condition via unique constraint)
            clinic_name = _get_clinic_name(request, current_user)
            
            association = UserClinicAssociation(
                user_id=current_user.user_id,
                clinic_id=signup_token.clinic_id,
                roles=signup_token.default_roles or [],
                full_name=clinic_name,
                is_active=True,
                last_accessed_at=datetime.now(timezone.utc),
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc)
            )
            
            try:
                db.add(association)
                # Mark signup token as used (if not already used)
                # Note: Token is marked as used when creating new association or reactivating
                if signup_token.used_at is None:
                    signup_token.used_at = datetime.now(timezone.utc)
                    signup_token.used_by_email = current_user.email
                db.commit()
                db.refresh(association)
            except IntegrityError:
                # Race condition: association was created by another request
                db.rollback()
                # Fetch the existing association
                association = db.query(UserClinicAssociation).filter(
                    UserClinicAssociation.user_id == current_user.user_id,
                    UserClinicAssociation.clinic_id == signup_token.clinic_id
                ).first()
                
                if not association:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="建立關聯時發生錯誤，請稍後再試"
                    )
                
                if not association.is_active:
                    # Reactivate it
                    _reactivate_association(association, signup_token, request, db)
                    # Mark token as used (user is using the token to reactivate)
                    if signup_token.used_at is None:
                        signup_token.used_at = datetime.now(timezone.utc)
                        signup_token.used_by_email = current_user.email
                        db.commit()
                else:
                    # Already active - user is already a member
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="您已經是此診所的成員"
                    )
        
        return {
            "association_created": True,
            "clinic_id": signup_token.clinic_id,
            "clinic": {
                "id": clinic.id,
                "name": clinic.name,
                "display_name": clinic.name  # Use name as display_name for now
            },
            "roles": association.roles or [],
            "full_name": association.full_name
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Error joining clinic as existing user: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="加入診所時發生錯誤，請稍後再試"
        )
