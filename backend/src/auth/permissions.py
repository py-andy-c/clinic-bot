# pyright: reportMissingTypeStubs=false
from fastapi import Depends, HTTPException, status

from auth.dependencies import UserContext, get_current_user


def require_self_or_admin(user_id_param: str = "user_id"):
    """
    Dependency that ensures user is either viewing their own data or is an admin.

    Args:
        user_id_param: Name of the path parameter containing the user_id

    Returns:
        Dependency function that can be used with FastAPI Depends()
    """
    def dependency(
        user_id: int,
        current_user: UserContext = Depends(get_current_user)
    ) -> UserContext:
        if current_user.is_system_admin():
            return current_user

        if current_user.user_type == 'clinic_user':
            if current_user.has_role("admin"):
                return current_user

            if current_user.user_id == user_id:
                return current_user

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You can only access your own data"
        )

    return dependency


def require_clinic_admin():
    """
    Dependency that ensures user is a clinic admin.

    Returns:
        Dependency function that can be used with FastAPI Depends()
    """
    def dependency(current_user: UserContext = Depends(get_current_user)) -> UserContext:
        if current_user.is_system_admin():
            return current_user

        if current_user.user_type == 'clinic_user' and current_user.has_role("admin"):
            return current_user

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Admin privileges required"
        )

    return dependency


def require_practitioner():
    """
    Dependency that ensures user is a practitioner in their clinic.

    Returns:
        Dependency function that can be used with FastAPI Depends()
    """
    def dependency(current_user: UserContext = Depends(get_current_user)) -> UserContext:
        if current_user.is_system_admin():
            return current_user

        if current_user.user_type == 'clinic_user':
            if current_user.has_role("admin") or current_user.has_role("practitioner"):
                return current_user

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Practitioner privileges required"
        )

    return dependency


def require_clinic_member_or_self(user_id_param: str = "user_id"):
    """
    Dependency that ensures user is either a clinic member or accessing their own data.

    Args:
        user_id_param: Name of the path parameter containing the user_id

    Returns:
        Dependency function that can be used with FastAPI Depends()
    """
    def dependency(
        user_id: int,
        current_user: UserContext = Depends(get_current_user)
    ) -> UserContext:
        if current_user.is_system_admin():
            return current_user

        # Allow if user is accessing their own data
        if current_user.user_id == user_id:
            return current_user

        # Allow if user is a clinic member (practitioner or admin)
        if current_user.user_type == 'clinic_user':
            return current_user

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You can only access your own data or clinic data"
        )

    return dependency
