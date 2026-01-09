# pyright: reportMissingTypeStubs=false
"""
Authentication and authorization dependencies for FastAPI.

Provides dependency injection functions for user authentication,
role-based access control, and clinic isolation enforcement.

MIGRATION NOTE (2025-01-27):
- Removed require_clinic_member, require_read_access, require_clinic_or_system_admin
  (replaced by require_authenticated - they were functionally identical)
- Removed require_practitioner_role (not used in any endpoints)
- Added require_authenticated for any authenticated user (system admin or clinic user)
"""

import logging
# datetime and timezone imports removed - using taiwan_now() from utils.datetime_utils instead
from typing import Optional, Dict, Any, List
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import jwt

from core.database import get_db
from core.config import SYSTEM_ADMIN_EMAILS
from services.jwt_service import jwt_service, TokenPayload
from models import User, LineUser, Clinic, UserClinicAssociation
from utils.datetime_utils import taiwan_now

logger = logging.getLogger(__name__)


class UserContext:
    """Authenticated user context extracted from JWT token."""

    def __init__(
        self,
        user_type: str,
        email: str,
        roles: list[str],
        google_subject_id: str,
        name: str,
        user_id: Optional[int] = None,
        active_clinic_id: Optional[int] = None,  # Currently selected clinic (from UserClinicAssociation)
        available_clinics: Optional[List[Dict[str, Any]]] = None  # Optional: list of clinics user can access
    ):
        self.user_type = user_type  # "system_admin" or "clinic_user"
        self.email = email
        self.roles = roles  # List of roles at active_clinic_id: ["admin"], ["practitioner"], etc.
        self.active_clinic_id = active_clinic_id  # Currently selected clinic for clinic users
        self.google_subject_id = google_subject_id
        self.name = name  # Clinic-specific name at active_clinic_id
        self.user_id = user_id  # Database user ID (for both system admins and clinic users)
        self.available_clinics = available_clinics  # For clinic switching UI

    def is_system_admin(self) -> bool:
        """Check if user is a system admin."""
        return self.user_type == "system_admin"

    def has_role(self, role: str) -> bool:
        """Check if user has a specific role."""
        return role in self.roles or self.is_system_admin()

    def is_clinic_user(self) -> bool:
        """Check if user is a clinic user (not system admin)."""
        return self.user_type == "clinic_user"

    def __repr__(self) -> str:
        return f"UserContext(user_type='{self.user_type}', email='{self.email}', roles={self.roles})"


# HTTP Bearer token security scheme
security = HTTPBearer(auto_error=False)


def get_token_payload(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[TokenPayload]:
    """Extract and validate JWT token payload."""
    if not credentials:
        return None

    token = credentials.credentials
    payload = jwt_service.verify_token(token)

    if not payload:
        return None

    return payload


def get_current_user(
    payload: Optional[TokenPayload] = Depends(get_token_payload),
    db: Session = Depends(get_db)
) -> UserContext:
    """Get authenticated user context from JWT token."""
    if not payload:
        logger.warning("[AUTH] No payload provided - authentication failed")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials not provided"
        )

    # Handle system admin authentication
    if payload.user_type == "system_admin":
        # Verify email is in system admin whitelist
        if payload.email not in SYSTEM_ADMIN_EMAILS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )

        # Look up User record for system admin (no clinic associations)
        user = db.query(User).filter(
            User.email == payload.email
        ).first()
        
        # Verify it's actually a system admin (no associations)
        if user:
            has_associations = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == user.id
            ).first() is not None
            if has_associations:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found"
                )

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )

        return UserContext(
            user_type="system_admin",
            email=user.email,
            roles=[],  # System admins don't have clinic-specific roles
            google_subject_id=user.google_subject_id,
            name=user.email,  # System admins use email as name (full_name not needed)
            user_id=user.id,  # System admins now have user_id
            active_clinic_id=None  # System admins don't have active clinic
        )

    # Handle clinic user authentication
    elif payload.user_type == "clinic_user":
        # Find user by Google subject ID and email
        user = db.query(User).filter(
            User.google_subject_id == payload.sub,
            User.email == payload.email
        ).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )

        # Get active_clinic_id from payload
        active_clinic_id = payload.active_clinic_id
        
        if not active_clinic_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Clinic access denied"
            )

        # CRITICAL: Validate active_clinic_id against user_clinic_associations
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user.id,
            UserClinicAssociation.clinic_id == active_clinic_id,
            UserClinicAssociation.is_active == True
        ).first()

        if not association:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Clinic access denied"
            )

        # Verify clinic is still active
        clinic = db.query(Clinic).filter(
            Clinic.id == active_clinic_id,
            Clinic.is_active == True
        ).first()

        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Clinic is inactive"
            )

        # Update last_accessed_at for default clinic selection
        # Use flush() instead of commit() to avoid blocking on every request
        # The session will commit at the end of the request lifecycle
        # If this fails, log but don't fail authentication
        try:
            association.last_accessed_at = taiwan_now()
            db.flush()  # Flush instead of commit to reduce blocking
        except Exception as e:
            # Log but don't fail authentication if last_accessed_at update fails
            logger.warning(f"Failed to update last_accessed_at for user {user.id}, clinic {active_clinic_id}: {e}")

        return UserContext(
            user_type="clinic_user",
            email=user.email,
            roles=association.roles,  # Roles from association
            google_subject_id=user.google_subject_id,
            name=association.full_name,  # Clinic-specific name
            user_id=user.id,
            active_clinic_id=active_clinic_id
        )

    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user type"
        )


# Role-based authorization dependencies
def require_system_admin(user: UserContext = Depends(get_current_user)) -> UserContext:
    """Require system admin access."""
    if not user.is_system_admin():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System admin access required"
        )
    return user


def require_clinic_user(user: UserContext = Depends(get_current_user)) -> UserContext:
    """Require clinic user (not system admin)."""
    if not user.is_clinic_user():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clinic user access required"
        )
    return user


def require_authenticated(user: UserContext = Depends(get_current_user)) -> UserContext:
    """
    Require any authenticated user (system admin or clinic user).
    
    This allows:
    - System admins (full access)
    - Clinic users with any roles (including no roles for read-only access)
    
    Replaces require_clinic_member and require_read_access which were functionally identical.
    """
    if not (user.is_system_admin() or user.is_clinic_user()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authentication required"
        )
    return user


def require_admin_role(user: UserContext = Depends(get_current_user)) -> UserContext:
    """Require admin role (or system admin)."""
    if not user.has_role("admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return user


def require_practitioner_or_admin(user: UserContext = Depends(get_current_user)) -> UserContext:
    """
    Require practitioner role or admin role (or system admin).
    
    This is for endpoints that need practitioner-specific functionality.
    
    NOTE: This could potentially be replaced with a parameterized require_role() function
    in the future, but keeping as-is for now since it's a specific use case.
    """
    if not (user.has_role("practitioner") or user.has_role("admin") or user.is_system_admin()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Practitioner or admin access required"
        )
    return user


# FUTURE CONSIDERATION: Parameterized role checking
# Could replace require_admin_role and simplify require_practitioner_or_admin:
#
# def require_role(role: str):
#     """Require specific role (or system admin)."""
#     def _require_role(user: UserContext = Depends(get_current_user)) -> UserContext:
#         if not (user.has_role(role) or user.is_system_admin()):
#             raise HTTPException(
#                 status_code=status.HTTP_403_FORBIDDEN,
#                 detail=f"{role.title()} access required"
#             )
#         return user
#     return _require_role
#
# Then use: require_role("admin"), require_role("practitioner")
# And require_practitioner_or_admin could be replaced with composition:
# # Use: require_role("practitioner") or require_role("admin")


def get_active_clinic_association(
    user: User, 
    db: Session, 
    preferred_clinic_id: Optional[int] = None
) -> Optional[UserClinicAssociation]:
    """
    Get the active clinic association for a clinic user.
    
    If preferred_clinic_id is provided, attempts to get that specific association.
    This provides "Sticky Clinic Context" for multi-tab sessions, preventing
    one tab from switching focus because another tab updated the global
    'last_accessed_at' ordering.
    
    If preferred_clinic_id is not provided or not found, selects the most 
    recently accessed clinic (by last_accessed_at), or the first active 
    association if none have been accessed.
    
    Args:
        user: User to get clinic association for
        db: Database session
        preferred_clinic_id: Optional clinic ID to prioritize
        
    Returns:
        UserClinicAssociation if found, None if user has no associations
        
    Note:
        This function does NOT update last_accessed_at. Callers should update it
        when creating tokens to track clinic usage.
    """
    # Base query for active associations with active clinics
    query = db.query(UserClinicAssociation).filter(
        UserClinicAssociation.user_id == user.id,
        UserClinicAssociation.is_active == True
    ).join(Clinic).filter(
        Clinic.is_active == True
    )

    # If preferred_clinic_id is provided, try to find that specific one first
    if preferred_clinic_id:
        association = query.filter(UserClinicAssociation.clinic_id == preferred_clinic_id).first()
        if association:
            return association

    # Fallback: Get most recently used or oldest association
    associations = query.order_by(
        UserClinicAssociation.last_accessed_at.desc().nulls_last(),
        UserClinicAssociation.id.asc()  # Fallback: oldest association if no last_accessed_at
    ).all()
    
    if not associations:
        return None
    
    # Return the most recently accessed, or first one if none accessed
    return associations[0]


def ensure_clinic_access(user: UserContext) -> int:
    """
    Ensure user has clinic access and return clinic_id.

    Raises HTTPException if user doesn't have clinic access.
    This is a helper function to avoid repeating the same check.

    Gets `active_clinic_id` from user context.

    System admins are not allowed to access clinic endpoints - they should use system endpoints.

    Args:
        user: UserContext to check

    Returns:
        int: The clinic_id (from active_clinic_id or clinic_id)

    Raises:
        HTTPException: If user doesn't have clinic access
    """
    # System admins should not access clinic endpoints
    if user.is_system_admin():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="系統管理員無法存取診所端點，請使用系統管理端點"
        )
    
    clinic_id = user.active_clinic_id
    if clinic_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要診所存取權限"
        )
    return clinic_id


# Clinic isolation enforcement
def require_clinic_access(
    user: UserContext = Depends(require_clinic_user),
    clinic_id: Optional[int] = None
) -> UserContext:
    """
    Enforce clinic isolation - clinic users can only access their own clinic.

    This dependency should be used for endpoints that take a clinic_id parameter
    to ensure users can't access other clinics' data.
    """
    if clinic_id is not None and user.active_clinic_id != clinic_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this clinic"
        )
    return user


# Optional authentication (for endpoints that work with or without auth)
def get_optional_user(
    payload: Optional[TokenPayload] = Depends(get_token_payload),
    db: Session = Depends(get_db)
) -> Optional[UserContext]:
    """Get user context if authenticated, None otherwise."""
    if not payload:
        return None

    try:
        return get_current_user(payload, db)
    except HTTPException:
        return None


# LIFF/Line user authentication dependencies
def get_current_line_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> LineUser:
    """Get authenticated LINE user from JWT token."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials not provided"
        )

    token = credentials.credentials
    try:
        # Decode JWT directly - LIFF tokens have different structure than TokenPayload
        from core.config import JWT_SECRET_KEY
        
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
        if not payload:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )

        # For LIFF users, we expect line_user_id in the payload
        line_user_id = payload.get('line_user_id')
        if not line_user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid LINE user token"
            )

        # DEPRECATED: This function doesn't filter by clinic_id and may return wrong LineUser
        # in multi-clinic scenarios. Use get_current_line_user_with_clinic instead.
        # 
        # Note: This function is currently unused. It's kept for backward compatibility
        # but should not be used for new code. All clinic-specific operations should use
        # get_current_line_user_with_clinic which properly filters by clinic_id.
        import warnings
        warnings.warn(
            "get_current_line_user is deprecated and may return wrong clinic's LineUser. "
            "Use get_current_line_user_with_clinic instead.",
            DeprecationWarning,
            stacklevel=2
        )
        
        line_user = db.query(LineUser).filter(LineUser.line_user_id == line_user_id).first()
        if not line_user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="LINE user not found"
            )

        return line_user
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )
    except Exception as e:
        logger.exception(f"Unexpected token validation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )


def get_current_line_user_with_clinic(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> tuple[LineUser, Clinic]:
    """
    Get authenticated LINE user and clinic from JWT token.

    Returns both LineUser and Clinic to ensure proper clinic isolation.
    Clinic context comes from JWT payload (set during LIFF login).
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials not provided"
        )

    token = credentials.credentials

    try:
        # Decode JWT directly - LIFF tokens have different structure than TokenPayload
        from core.config import JWT_SECRET_KEY
        
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
        if not payload:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )

        # Extract clinic_id from JWT payload
        clinic_id = payload.get('clinic_id')
        if not clinic_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid clinic token"
            )

        # Validate clinic exists and is active
        clinic = db.query(Clinic).filter(
            Clinic.id == clinic_id,
            Clinic.is_active == True
        ).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Clinic not found or inactive"
            )

        # For LIFF users, we expect line_user_id in the payload
        line_user_id = payload.get('line_user_id')
        if not line_user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid LINE user token"
            )

        line_user = db.query(LineUser).filter(
            LineUser.line_user_id == line_user_id,
            LineUser.clinic_id == clinic_id
        ).first()
        if not line_user:
            # This shouldn't happen in normal flow, but handle gracefully
            # Create LineUser for this clinic using service method for race condition handling
            from services.line_user_service import LineUserService
            from services.line_service import LINEService
            from sqlalchemy.exc import IntegrityError
            
            display_name = payload.get('display_name')
            
            # Create LINEService from clinic credentials for profile fetching if needed
            line_service = LINEService(
                channel_secret=clinic.line_channel_secret or "",
                channel_access_token=clinic.line_channel_access_token or ""
            )
            
            try:
                line_user = LineUserService.get_or_create_line_user(
                    db=db,
                    line_user_id=line_user_id,
                    clinic_id=clinic_id,
                    line_service=line_service,
                    display_name=display_name
                )
            except IntegrityError:
                # Race condition: another request created the LineUser
                # Retry query to get the existing one
                db.rollback()
                line_user = db.query(LineUser).filter(
                    LineUser.line_user_id == line_user_id,
                    LineUser.clinic_id == clinic_id
                ).first()
                if not line_user:
                    # Still not found after retry - unexpected error
                    logger.error(
                        f"Failed to create or retrieve LineUser after race condition: "
                        f"line_user_id={line_user_id}, clinic_id={clinic_id}"
                    )
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="Failed to create LINE user"
                    )

        return line_user, clinic

    except HTTPException:
        raise
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )
    except Exception as e:
        logger.exception(f"Token validation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )
