"""
Authentication and authorization dependencies for FastAPI.

Provides dependency injection functions for user authentication,
role-based access control, and clinic isolation enforcement.
"""

from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from core.database import get_db
from core.config import SYSTEM_ADMIN_EMAILS
from services.jwt_service import jwt_service, TokenPayload
from models import User, LineUser


class UserContext:
    """Authenticated user context extracted from JWT token."""

    def __init__(
        self,
        user_type: str,
        email: str,
        roles: list[str],
        clinic_id: Optional[int],
        google_subject_id: str,
        name: str,
        user_id: Optional[int] = None
    ):
        self.user_type = user_type  # "system_admin" or "clinic_user"
        self.email = email
        self.roles = roles  # List of roles: ["admin"], ["practitioner"], etc.
        self.clinic_id = clinic_id
        self.google_subject_id = google_subject_id
        self.name = name
        self.user_id = user_id  # Database user ID (for clinic users only)

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

        return UserContext(
            user_type="system_admin",
            email=payload.email,
            roles=[],  # System admins don't have clinic-specific roles
            clinic_id=None,
            google_subject_id=payload.sub,
            name=payload.name
        )

    # Handle clinic user authentication
    elif payload.user_type == "clinic_user":
        # First check if user exists (regardless of active status)
        user = db.query(User).filter(
            User.google_subject_id == payload.sub,
            User.email == payload.email
        ).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )

            # Check if user is active
            if not user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="帳戶已被停用，請聯繫診所管理員重新啟用"
                )

        # Verify clinic ID matches
        if payload.clinic_id != user.clinic_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Clinic access denied"
            )

        return UserContext(
            user_type="clinic_user",
            email=user.email,
            roles=user.roles,
            clinic_id=user.clinic_id,
            google_subject_id=user.google_subject_id,
            name=user.full_name,
            user_id=user.id
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


def require_admin_role(user: UserContext = Depends(get_current_user)) -> UserContext:
    """Require admin role (or system admin)."""
    if not user.has_role("admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return user


def require_practitioner_role(user: UserContext = Depends(get_current_user)) -> UserContext:
    """Require practitioner role (or system admin)."""
    if not user.has_role("practitioner"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Practitioner access required"
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


def require_clinic_or_system_admin(user: UserContext = Depends(get_current_user)) -> UserContext:
    """Require clinic user or system admin."""
    if not (user.is_clinic_user() or user.is_system_admin()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clinic user or system admin access required"
        )
    return user


def require_clinic_member(user: UserContext = Depends(get_current_user)) -> UserContext:
    """
    Require any clinic member (regardless of roles).
    
    This allows users with no roles to have read-only access to clinic data.
    System admins are also allowed.
    """
    if not (user.is_clinic_user() or user.is_system_admin()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clinic member access required"
        )
    return user


def require_read_access(user: UserContext = Depends(get_current_user)) -> UserContext:
    """
    Require read access to clinic data.
    
    This allows:
    - System admins (full access)
    - Clinic users with any roles (including no roles for read-only access)
    """
    if not (user.is_system_admin() or user.is_clinic_user()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access required"
        )
    return user


def require_practitioner_or_admin(user: UserContext = Depends(get_current_user)) -> UserContext:
    """
    Require practitioner role or admin role (or system admin).
    
    This is for endpoints that need practitioner-specific functionality.
    """
    if not (user.has_role("practitioner") or user.has_role("admin") or user.is_system_admin()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Practitioner or admin access required"
        )
    return user


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
    if clinic_id is not None and user.clinic_id != clinic_id:
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
        # Decode JWT directly without TokenPayload validation
        payload = jwt_service.verify_token(token)
        if not payload:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )

        # For LIFF users, we expect line_user_id in the payload
        line_user_id = getattr(payload, 'line_user_id', None)
        if not line_user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid LINE user token"
            )

        line_user = db.query(LineUser).filter(LineUser.line_user_id == line_user_id).first()
        if not line_user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="LINE user not found"
            )

        return line_user
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )
