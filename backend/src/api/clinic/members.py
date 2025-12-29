# pyright: reportMissingTypeStubs=false
"""
Member Management API endpoints.
"""

import logging
import secrets
from datetime import datetime, timedelta
from typing import Dict, List, Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi import status as http_status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.config import FRONTEND_URL
from auth.dependencies import require_admin_role, require_authenticated, UserContext, ensure_clinic_access
from models import User, SignupToken, UserClinicAssociation
from utils.datetime_utils import taiwan_now
from api.responses import MemberResponse, MemberListResponse

logger = logging.getLogger(__name__)

router = APIRouter()


class MemberInviteRequest(BaseModel):
    """Request model for inviting a new team member."""
    default_roles: List[str]  # e.g., ["practitioner"] or ["admin", "practitioner"]


class MemberInviteResponse(BaseModel):
    """Response model for member invitation."""
    signup_url: str
    expires_at: datetime
    token_id: int


@router.get("/members", summary="List all clinic members")
async def list_members(
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> MemberListResponse:
    """
    Get all members of the current user's clinic.
    
    For admins: Returns both active and inactive members.
    For other users: Returns only active members.
    
    Available to all clinic members (including read-only users).
    """
    # Check clinic access first (raises HTTPException if denied)
    clinic_id = ensure_clinic_access(current_user)
    
    try:
        # Get members via UserClinicAssociation for the active clinic
        # Use joinedload to eagerly load associations and avoid N+1 queries
        query = db.query(User).join(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic_id
        )
        
        # Non-admins only see active members
        if not current_user.has_role("admin"):
            query = query.filter(UserClinicAssociation.is_active == True)
        
        query = query.options(joinedload(User.clinic_associations))  # Eager load associations for name lookup
        
        members_with_associations = query.all()
        
        # Build member list with roles from associations
        member_list: List[MemberResponse] = []
        
        for member in members_with_associations:
            # Get the association for this clinic from the eagerly loaded relationships
            association = next(
                (a for a in member.clinic_associations 
                 if a.clinic_id == clinic_id),
                None
            )
            
            # Get settings for practitioners (available to all users for read-only access)
            patient_booking_allowed = None
            step_size_minutes = None
            if association and 'practitioner' in (association.roles or []):
                try:
                    settings = association.get_validated_settings()
                    patient_booking_allowed = settings.patient_booking_allowed
                    step_size_minutes = settings.step_size_minutes
                except Exception:
                    # If settings validation fails, default to None
                    pass
            
            member_list.append(MemberResponse(
                id=member.id,
                email=member.email,
                full_name=association.full_name if association else member.email,  # Clinic users must have association
                roles=association.roles if association else [],
                is_active=association.is_active if association else False,
                created_at=member.created_at,
                patient_booking_allowed=patient_booking_allowed,
                step_size_minutes=step_size_minutes
            ))

        return MemberListResponse(members=member_list)

    except Exception as e:
        logger.exception(f"Error getting members list: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得成員列表"
        )


@router.post("/members/invite", summary="Invite a new team member")
async def invite_member(
    invite_data: MemberInviteRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> MemberInviteResponse:
    """
    Generate a secure signup link for inviting a new team member.

    Only clinic admins can invite members.
    Supports inviting users with no roles for read-only access.
    """
    try:
        # Validate roles - allow empty list for read-only access
        valid_roles = {"admin", "practitioner"}
        if invite_data.default_roles and not all(role in valid_roles for role in invite_data.default_roles):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="指定的角色無效"
            )

        # Generate secure token
        token = secrets.token_urlsafe(32)
        expires_at = taiwan_now() + timedelta(hours=48)  # 48 hours

        clinic_id = ensure_clinic_access(current_user)
        
        signup_token = SignupToken(
            token=token,
            clinic_id=clinic_id,
            default_roles=invite_data.default_roles,
            expires_at=expires_at
        )

        db.add(signup_token)
        db.commit()
        db.refresh(signup_token)

        signup_url = f"{FRONTEND_URL}/signup/member?token={token}"

        return MemberInviteResponse(
            signup_url=signup_url,
            expires_at=expires_at,
            token_id=signup_token.id
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error inviting member: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法產生邀請"
        )


@router.put("/members/{user_id}/roles", summary="Update member roles")
async def update_member_roles(
    user_id: int,
    roles_update: Dict[str, Any],
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> MemberResponse:
    """
    Update roles for a team member.

    Only clinic admins can update member roles.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Find member via association with eagerly loaded associations
        member = db.query(User).join(UserClinicAssociation).filter(
            User.id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).options(joinedload(User.clinic_associations)).first()

        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員"
            )

        # Get the association from the eagerly loaded relationships
        association = next(
            (a for a in member.clinic_associations 
             if a.clinic_id == clinic_id),
            None
        )
        
        if not association:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員關聯"
            )

        # Prevent self-demotion if user would lose admin access
        new_roles = roles_update.get("roles", [])
        if current_user.user_id == user_id and "admin" not in new_roles:
            # Check if this user is the last admin
            admin_associations = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True,
                UserClinicAssociation.user_id != user_id
            ).all()

            admin_count = sum(1 for assoc in admin_associations if 'admin' in (assoc.roles or []))

            if admin_count == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無法從最後一位管理員停用管理員權限"
                )

        # Validate roles
        valid_roles = {"admin", "practitioner"}
        if not all(role in valid_roles for role in new_roles):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="指定的角色無效"
            )

        # Update roles in association
        association.roles = new_roles
        # updated_at will be set automatically by database event listener
        db.commit()
        db.refresh(association)

        return MemberResponse(
            id=member.id,
            email=member.email,
            full_name=association.full_name,
            roles=association.roles or [],
            is_active=association.is_active,
            created_at=member.created_at
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating member roles for user {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新成員角色"
        )


@router.delete("/members/{user_id}", summary="Remove a team member")
async def remove_member(
    user_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Soft delete a team member by marking them as inactive.

    Only clinic admins can remove members.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Find member via association
        member = db.query(User).join(UserClinicAssociation).filter(
            User.id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        ).first()

        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員"
            )

        # Get the association to check roles and deactivate
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user_id,
            UserClinicAssociation.clinic_id == clinic_id
        ).first()
        
        if not association:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員關聯"
            )

        # Prevent removing last admin
        if "admin" in (association.roles or []):
            admin_associations = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True,
                UserClinicAssociation.user_id != user_id
            ).all()

            admin_count = sum(1 for assoc in admin_associations if 'admin' in (assoc.roles or []))

            if admin_count == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="無法停用最後一位管理員"
                )

        # Deactivate association (not the user, since they may be in other clinics)
        association.is_active = False
        # updated_at will be set automatically by database event listener
        db.commit()

        return {"message": "成員已停用"}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error removing member {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法停用成員"
        )


@router.post("/members/{user_id}/reactivate", summary="Reactivate a team member")
async def reactivate_member(
    user_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Reactivate a previously removed team member.

    Only clinic admins can reactivate members.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Find inactive member via association
        member = db.query(User).join(UserClinicAssociation).filter(
            User.id == user_id,
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == False
        ).first()

        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到已停用的成員"
            )

        # Get and reactivate the association
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == user_id,
            UserClinicAssociation.clinic_id == clinic_id
        ).first()
        
        if not association:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到成員關聯"
            )

        # Reactivate association
        association.is_active = True
        # updated_at will be set automatically by database event listener
        db.commit()

        return {"message": "成員已重新啟用"}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error reactivating member {user_id}: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法重新啟用成員"
        )

