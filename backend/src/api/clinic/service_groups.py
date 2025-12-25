# pyright: reportMissingTypeStubs=false
"""
Service Type Group Management API endpoints.
"""

import logging
from typing import Dict, List, Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import require_admin_role, require_authenticated, UserContext, ensure_clinic_access
from models import AppointmentType
from services.service_type_group_service import ServiceTypeGroupService
from api.responses import ServiceTypeGroupResponse, ServiceTypeGroupListResponse

logger = logging.getLogger(__name__)

router = APIRouter()


class ServiceTypeGroupCreateRequest(BaseModel):
    """Request model for creating a service type group."""
    name: str = Field(..., min_length=1, max_length=255)
    display_order: Optional[int] = Field(None, ge=0)


class ServiceTypeGroupUpdateRequest(BaseModel):
    """Request model for updating a service type group."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    display_order: Optional[int] = Field(None, ge=0)


class ServiceTypeGroupBulkOrderRequest(BaseModel):
    """Request model for bulk updating group display order."""
    group_orders: List[Dict[str, Any]] = Field(..., description="List of dicts with 'id' and 'display_order'")


class AppointmentTypeBulkOrderRequest(BaseModel):
    """Request model for bulk updating appointment type display order."""
    service_orders: List[Dict[str, Any]] = Field(..., description="List of dicts with 'id' and 'display_order'")


@router.get("/service-type-groups", summary="List all service type groups", response_model=ServiceTypeGroupListResponse)
async def list_service_type_groups(
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> ServiceTypeGroupListResponse:
    """
    List all service type groups for the clinic.
    
    Available to all clinic members.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        groups = ServiceTypeGroupService.list_groups_for_clinic(db, clinic_id)
        
        return ServiceTypeGroupListResponse(
            groups=[
                ServiceTypeGroupResponse(
                    id=g.id,
                    clinic_id=g.clinic_id,
                    name=g.name,
                    display_order=g.display_order,
                    created_at=g.created_at,
                    updated_at=g.updated_at
                )
                for g in groups
            ]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to list service type groups: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得服務類型群組列表"
        )


@router.post("/service-type-groups", summary="Create a service type group", response_model=ServiceTypeGroupResponse)
async def create_service_type_group(
    request: ServiceTypeGroupCreateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ServiceTypeGroupResponse:
    """
    Create a new service type group.
    
    Admin-only.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        group = ServiceTypeGroupService.create_group(
            db=db,
            clinic_id=clinic_id,
            name=request.name,
            display_order=request.display_order
        )
        
        db.commit()
        db.refresh(group)
        
        return ServiceTypeGroupResponse(
            id=group.id,
            clinic_id=group.clinic_id,
            name=group.name,
            display_order=group.display_order,
            created_at=group.created_at,
            updated_at=group.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to create service type group: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法建立服務類型群組"
        )


@router.put("/service-type-groups/bulk-order", summary="Bulk update group display order")
async def bulk_update_group_order(
    request: ServiceTypeGroupBulkOrderRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Bulk update display order for multiple groups.
    
    Admin-only.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        ServiceTypeGroupService.bulk_update_group_order(
            db=db,
            clinic_id=clinic_id,
            group_orders=request.group_orders
        )
        
        db.commit()
        return {"success": True, "message": "群組順序已更新"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to bulk update group order: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新群組順序"
        )


@router.put("/service-type-groups/{group_id}", summary="Update a service type group", response_model=ServiceTypeGroupResponse)
async def update_service_type_group(
    group_id: int,
    request: ServiceTypeGroupUpdateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ServiceTypeGroupResponse:
    """
    Update a service type group.
    
    Admin-only.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        group = ServiceTypeGroupService.update_group(
            db=db,
            group_id=group_id,
            clinic_id=clinic_id,
            name=request.name,
            display_order=request.display_order
        )
        
        db.commit()
        db.refresh(group)
        
        return ServiceTypeGroupResponse(
            id=group.id,
            clinic_id=group.clinic_id,
            name=group.name,
            display_order=group.display_order,
            created_at=group.created_at,
            updated_at=group.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update service type group: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新服務類型群組"
        )


@router.delete("/service-type-groups/{group_id}", summary="Delete a service type group")
async def delete_service_type_group(
    group_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Delete a service type group.
    
    Sets service_type_group_id to NULL for all appointment types in this group.
    Admin-only.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        ServiceTypeGroupService.delete_group(db, group_id, clinic_id)
        
        db.commit()
        return {"success": True, "message": "服務類型群組已刪除"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to delete service type group: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法刪除服務類型群組"
        )


@router.put("/appointment-types/bulk-order", summary="Bulk update appointment type display order")
async def bulk_update_appointment_type_order(
    request: AppointmentTypeBulkOrderRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Bulk update display order for multiple appointment types.
    
    Admin-only.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Validate all appointment types belong to clinic before updating
        service_ids = [order_data.get('id') for order_data in request.service_orders if order_data.get('id') is not None]
        if service_ids:
            valid_services = db.query(AppointmentType).filter(
                AppointmentType.id.in_(service_ids),
                AppointmentType.clinic_id == clinic_id,
                AppointmentType.is_deleted == False
            ).all()
            valid_service_ids = {s.id for s in valid_services}
            
            if len(valid_service_ids) != len(service_ids):
                invalid_ids = set(service_ids) - valid_service_ids
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"某些服務項目不存在或不属于此診所: {invalid_ids}"
                )
        
        # Update display orders
        for order_data in request.service_orders:
            service_id = order_data.get('id')
            display_order = order_data.get('display_order')
            
            if service_id is None or display_order is None:
                continue
            
            service = db.query(AppointmentType).filter(
                AppointmentType.id == service_id,
                AppointmentType.clinic_id == clinic_id,
                AppointmentType.is_deleted == False
            ).first()
            
            if service:
                service.display_order = display_order
        
        db.commit()
        return {"success": True, "message": "服務項目順序已更新"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to bulk update appointment type order: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新服務項目順序"
        )

