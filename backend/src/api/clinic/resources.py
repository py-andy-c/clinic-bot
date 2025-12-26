# pyright: reportMissingTypeStubs=false
"""
Resource Management API endpoints.
"""

import logging
import re
from datetime import datetime
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi import status as http_status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import require_admin_role, require_practitioner_or_admin, UserContext, ensure_clinic_access
from models import ResourceType, Resource, AppointmentType, AppointmentResourceRequirement, AppointmentResourceAllocation, CalendarEvent, Appointment

logger = logging.getLogger(__name__)

router = APIRouter()


# ===== Request/Response Models =====

class ResourceTypeCreateRequest(BaseModel):
    """Request model for creating a resource type."""
    name: str = Field(..., min_length=1, max_length=255)


class ResourceTypeUpdateRequest(BaseModel):
    """Request model for updating a resource type."""
    name: str = Field(..., min_length=1, max_length=255)


class ResourceTypeResponse(BaseModel):
    """Response model for resource type."""
    id: int
    clinic_id: int
    name: str
    created_at: datetime
    updated_at: datetime


class ResourceTypeListResponse(BaseModel):
    """Response model for resource type list."""
    resource_types: List[ResourceTypeResponse]


class ResourceCreateRequest(BaseModel):
    """Request model for creating a resource."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None


class ResourceUpdateRequest(BaseModel):
    """Request model for updating a resource."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None


class ResourceResponse(BaseModel):
    """Response model for resource."""
    id: int
    resource_type_id: int
    clinic_id: int
    name: str
    description: Optional[str]
    is_deleted: bool
    created_at: datetime
    updated_at: datetime


class ResourceListResponse(BaseModel):
    """Response model for resource list."""
    resources: List[ResourceResponse]


class ResourceRequirementCreateRequest(BaseModel):
    """Request model for creating a resource requirement."""
    resource_type_id: int
    quantity: int = Field(..., ge=1)


class ResourceRequirementUpdateRequest(BaseModel):
    """Request model for updating a resource requirement."""
    quantity: int = Field(..., ge=1)


class ResourceRequirementResponse(BaseModel):
    """Response model for resource requirement."""
    id: int
    appointment_type_id: int
    resource_type_id: int
    resource_type_name: str
    quantity: int
    created_at: datetime
    updated_at: datetime


class ResourceRequirementListResponse(BaseModel):
    """Response model for resource requirement list."""
    requirements: List[ResourceRequirementResponse]


# ===== API Endpoints =====

@router.get("/resource-types", summary="List all resource types for clinic")
async def list_resource_types(
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> ResourceTypeListResponse:
    """Get all resource types for the current clinic."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        resource_types = db.query(ResourceType).filter(
            ResourceType.clinic_id == clinic_id
        ).order_by(ResourceType.name).all()
        
        return ResourceTypeListResponse(
            resource_types=[
                ResourceTypeResponse(
                    id=rt.id,
                    clinic_id=rt.clinic_id,
                    name=rt.name,
                    created_at=rt.created_at,
                    updated_at=rt.updated_at
                )
                for rt in resource_types
            ]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to list resource types: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得資源類型列表"
        )


@router.post("/resource-types", summary="Create a new resource type")
async def create_resource_type(
    request: ResourceTypeCreateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ResourceTypeResponse:
    """Create a new resource type for the clinic."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Check if resource type with same name already exists
        existing = db.query(ResourceType).filter(
            ResourceType.clinic_id == clinic_id,
            ResourceType.name == request.name
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="資源類型名稱已存在"
            )
        
        resource_type = ResourceType(
            clinic_id=clinic_id,
            name=request.name
        )
        db.add(resource_type)
        db.commit()
        db.refresh(resource_type)
        
        return ResourceTypeResponse(
            id=resource_type.id,
            clinic_id=resource_type.clinic_id,
            name=resource_type.name,
            created_at=resource_type.created_at,
            updated_at=resource_type.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to create resource type: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法建立資源類型"
        )


@router.put("/resource-types/{resource_type_id}", summary="Update a resource type")
async def update_resource_type(
    resource_type_id: int,
    request: ResourceTypeUpdateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ResourceTypeResponse:
    """Update a resource type."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        resource_type = db.query(ResourceType).filter(
            ResourceType.id == resource_type_id,
            ResourceType.clinic_id == clinic_id
        ).first()
        
        if not resource_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源類型不存在"
            )
        
        # Check if new name conflicts with existing resource type
        existing = db.query(ResourceType).filter(
            ResourceType.clinic_id == clinic_id,
            ResourceType.name == request.name,
            ResourceType.id != resource_type_id
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="資源類型名稱已存在"
            )
        
        resource_type.name = request.name
        db.commit()
        db.refresh(resource_type)
        
        return ResourceTypeResponse(
            id=resource_type.id,
            clinic_id=resource_type.clinic_id,
            name=resource_type.name,
            created_at=resource_type.created_at,
            updated_at=resource_type.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update resource type: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新資源類型"
        )


@router.delete("/resource-types/{resource_type_id}", summary="Delete a resource type")
async def delete_resource_type(
    resource_type_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """Delete a resource type. Prevents deletion if resources have active allocations."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        resource_type = db.query(ResourceType).filter(
            ResourceType.id == resource_type_id,
            ResourceType.clinic_id == clinic_id
        ).first()
        
        if not resource_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源類型不存在"
            )
        
        # Check if any resources of this type have active allocations
        active_allocations = db.query(AppointmentResourceAllocation).join(
            Resource, AppointmentResourceAllocation.resource_id == Resource.id
        ).join(
            CalendarEvent, AppointmentResourceAllocation.appointment_id == CalendarEvent.id
        ).join(
            Appointment, CalendarEvent.id == Appointment.calendar_event_id
        ).filter(
            Resource.resource_type_id == resource_type_id,
            Resource.clinic_id == clinic_id,
            Resource.is_deleted == False,
            Appointment.status == 'confirmed'
        ).first()
        
        if active_allocations:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="此資源類型仍有資源被使用中，無法刪除"
            )
        
        db.delete(resource_type)
        db.commit()
        
        return {"success": True, "message": "資源類型已刪除"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to delete resource type: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法刪除資源類型"
        )


@router.get("/resource-types/{resource_type_id}/resources", summary="List resources for a resource type")
async def list_resources(
    resource_type_id: int,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> ResourceListResponse:
    """Get all resources for a resource type."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify resource type belongs to clinic
        resource_type = db.query(ResourceType).filter(
            ResourceType.id == resource_type_id,
            ResourceType.clinic_id == clinic_id
        ).first()
        
        if not resource_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源類型不存在"
            )
        
        resources = db.query(Resource).filter(
            Resource.resource_type_id == resource_type_id,
            Resource.clinic_id == clinic_id,
            Resource.is_deleted == False  # Exclude soft-deleted resources
        ).order_by(Resource.name).all()
        
        return ResourceListResponse(
            resources=[
                ResourceResponse(
                    id=r.id,
                    resource_type_id=r.resource_type_id,
                    clinic_id=r.clinic_id,
                    name=r.name,
                    description=r.description,
                    is_deleted=r.is_deleted,
                    created_at=r.created_at,
                    updated_at=r.updated_at
                )
                for r in resources
            ]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to list resources: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得資源列表"
        )


@router.post("/resource-types/{resource_type_id}/resources", summary="Create a new resource")
async def create_resource(
    resource_type_id: int,
    request: ResourceCreateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ResourceResponse:
    """Create a new resource. Auto-generates name if not provided."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify resource type belongs to clinic
        resource_type = db.query(ResourceType).filter(
            ResourceType.id == resource_type_id,
            ResourceType.clinic_id == clinic_id
        ).first()
        
        if not resource_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源類型不存在"
            )
        
        # Auto-generate name if not provided
        if not request.name:
            # Find highest number for this resource type
            existing_resources = db.query(Resource).filter(
                Resource.resource_type_id == resource_type_id,
                Resource.clinic_id == clinic_id,
                Resource.is_deleted == False
            ).all()
            
            # Extract numbers from existing resource names
            # Pattern matches trailing digits (e.g., "治療室1" -> 1, "Room2" -> 2)
            max_num = 0
            for r in existing_resources:
                # Try to extract number from name (e.g., "治療室1" -> 1)
                # Use word boundary to avoid matching numbers in the middle
                match = re.search(r'(\d+)$', r.name)
                if match:
                    try:
                        num = int(match.group(1))
                        max_num = max(max_num, num)
                    except ValueError:
                        # Skip if conversion fails
                        continue
            
            request.name = f"{resource_type.name}{max_num + 1}"
        
        # Check if name already exists for this resource type
        existing = db.query(Resource).filter(
            Resource.resource_type_id == resource_type_id,
            Resource.name == request.name,
            Resource.is_deleted == False
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="資源名稱已存在"
            )
        
        resource = Resource(
            resource_type_id=resource_type_id,
            clinic_id=clinic_id,
            name=request.name,
            description=request.description
        )
        db.add(resource)
        db.commit()
        db.refresh(resource)
        
        return ResourceResponse(
            id=resource.id,
            resource_type_id=resource.resource_type_id,
            clinic_id=resource.clinic_id,
            name=resource.name,
            description=resource.description,
            is_deleted=resource.is_deleted,
            created_at=resource.created_at,
            updated_at=resource.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to create resource: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法建立資源"
        )


@router.put("/resources/{resource_id}", summary="Update a resource")
async def update_resource(
    resource_id: int,
    request: ResourceUpdateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ResourceResponse:
    """Update a resource."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        resource = db.query(Resource).filter(
            Resource.id == resource_id,
            Resource.clinic_id == clinic_id
        ).first()
        
        if not resource:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源不存在"
            )
        
        # Check if new name conflicts with existing resource of same type
        existing = db.query(Resource).filter(
            Resource.resource_type_id == resource.resource_type_id,
            Resource.name == request.name,
            Resource.id != resource_id,
            Resource.is_deleted == False
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="資源名稱已存在"
            )
        
        resource.name = request.name
        resource.description = request.description
        db.commit()
        db.refresh(resource)
        
        return ResourceResponse(
            id=resource.id,
            resource_type_id=resource.resource_type_id,
            clinic_id=resource.clinic_id,
            name=resource.name,
            description=resource.description,
            is_deleted=resource.is_deleted,
            created_at=resource.created_at,
            updated_at=resource.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update resource: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新資源"
        )


@router.delete("/resources/{resource_id}", summary="Delete a resource (soft delete)")
async def delete_resource(
    resource_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """Soft delete a resource. Prevents deletion if resource has active allocations."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        resource = db.query(Resource).filter(
            Resource.id == resource_id,
            Resource.clinic_id == clinic_id
        ).first()
        
        if not resource:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源不存在"
            )
        
        if resource.is_deleted:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="資源已刪除"
            )
        
        # Check if resource has active allocations
        active_allocations = db.query(AppointmentResourceAllocation).join(
            CalendarEvent, AppointmentResourceAllocation.appointment_id == CalendarEvent.id
        ).join(
            Appointment, CalendarEvent.id == Appointment.calendar_event_id
        ).filter(
            AppointmentResourceAllocation.resource_id == resource_id,
            Appointment.status == 'confirmed'
        ).first()
        
        if active_allocations:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="此資源正在使用中，無法刪除"
            )
        
        resource.is_deleted = True
        db.commit()
        
        return {"success": True, "message": "資源已刪除"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to delete resource: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法刪除資源"
        )


@router.get("/resource-types/{resource_type_id}/appointment-types", summary="Get appointment types that require a resource type")
async def get_appointment_types_by_resource_type(
    resource_type_id: int,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """Get all appointment types that require a specific resource type."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify resource type belongs to clinic
        resource_type = db.query(ResourceType).filter(
            ResourceType.id == resource_type_id,
            ResourceType.clinic_id == clinic_id
        ).first()
        
        if not resource_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源類型不存在"
            )
        
        # Get requirements for this resource type
        requirements = db.query(AppointmentResourceRequirement).join(
            AppointmentType, AppointmentResourceRequirement.appointment_type_id == AppointmentType.id
        ).filter(
            AppointmentResourceRequirement.resource_type_id == resource_type_id,
            AppointmentType.clinic_id == clinic_id,
            AppointmentType.is_deleted == False
        ).all()
        
        appointment_types = [
            {
                "id": req.appointment_type.id,
                "name": req.appointment_type.name,
                "required_quantity": req.quantity
            }
            for req in requirements
        ]
        
        return {"appointment_types": appointment_types}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get appointment types for resource type: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得服務項目列表"
        )


@router.get("/appointment-types/{appointment_type_id}/resource-requirements", summary="Get resource requirements for appointment type")
async def get_resource_requirements(
    appointment_type_id: int,
    current_user: UserContext = Depends(require_practitioner_or_admin),
    db: Session = Depends(get_db)
) -> ResourceRequirementListResponse:
    """Get all resource requirements for an appointment type."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify appointment type belongs to clinic (exclude soft-deleted)
        appointment_type = db.query(AppointmentType).filter(
            AppointmentType.id == appointment_type_id,
            AppointmentType.clinic_id == clinic_id,
            AppointmentType.is_deleted == False
        ).first()
        
        if not appointment_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="預約類型不存在"
            )
        
        requirements = db.query(AppointmentResourceRequirement).join(
            ResourceType, AppointmentResourceRequirement.resource_type_id == ResourceType.id
        ).filter(
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id
        ).all()
        
        return ResourceRequirementListResponse(
            requirements=[
                ResourceRequirementResponse(
                    id=req.id,
                    appointment_type_id=req.appointment_type_id,
                    resource_type_id=req.resource_type_id,
                    resource_type_name=req.resource_type.name,
                    quantity=req.quantity,
                    created_at=req.created_at,
                    updated_at=req.updated_at
                )
                for req in requirements
            ]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to get resource requirements: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得資源需求"
        )


@router.post("/appointment-types/{appointment_type_id}/resource-requirements", summary="Create a resource requirement")
async def create_resource_requirement(
    appointment_type_id: int,
    request: ResourceRequirementCreateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ResourceRequirementResponse:
    """Create a resource requirement for an appointment type."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify appointment type belongs to clinic (exclude soft-deleted)
        appointment_type = db.query(AppointmentType).filter(
            AppointmentType.id == appointment_type_id,
            AppointmentType.clinic_id == clinic_id,
            AppointmentType.is_deleted == False
        ).first()
        
        if not appointment_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="預約類型不存在"
            )
        
        # Verify resource type belongs to clinic
        resource_type = db.query(ResourceType).filter(
            ResourceType.id == request.resource_type_id,
            ResourceType.clinic_id == clinic_id
        ).first()
        
        if not resource_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源類型不存在"
            )
        
        # Check if requirement already exists
        existing = db.query(AppointmentResourceRequirement).filter(
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id,
            AppointmentResourceRequirement.resource_type_id == request.resource_type_id
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="此資源需求已存在"
            )
        
        requirement = AppointmentResourceRequirement(
            appointment_type_id=appointment_type_id,
            resource_type_id=request.resource_type_id,
            quantity=request.quantity
        )
        db.add(requirement)
        db.commit()
        db.refresh(requirement)
        
        return ResourceRequirementResponse(
            id=requirement.id,
            appointment_type_id=requirement.appointment_type_id,
            resource_type_id=requirement.resource_type_id,
            resource_type_name=resource_type.name,
            quantity=requirement.quantity,
            created_at=requirement.created_at,
            updated_at=requirement.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to create resource requirement: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法建立資源需求"
        )


@router.put("/appointment-types/{appointment_type_id}/resource-requirements/{requirement_id}", summary="Update a resource requirement")
async def update_resource_requirement(
    appointment_type_id: int,
    requirement_id: int,
    request: ResourceRequirementUpdateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ResourceRequirementResponse:
    """Update a resource requirement."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        requirement = db.query(AppointmentResourceRequirement).join(
            AppointmentType, AppointmentResourceRequirement.appointment_type_id == AppointmentType.id
        ).filter(
            AppointmentResourceRequirement.id == requirement_id,
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id,
            AppointmentType.clinic_id == clinic_id
        ).first()
        
        if not requirement:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源需求不存在"
            )
        
        requirement.quantity = request.quantity
        db.commit()
        db.refresh(requirement)
        
        resource_type = db.query(ResourceType).filter(
            ResourceType.id == requirement.resource_type_id
        ).first()
        
        return ResourceRequirementResponse(
            id=requirement.id,
            appointment_type_id=requirement.appointment_type_id,
            resource_type_id=requirement.resource_type_id,
            resource_type_name=resource_type.name if resource_type else "Unknown",
            quantity=requirement.quantity,
            created_at=requirement.created_at,
            updated_at=requirement.updated_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to update resource requirement: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新資源需求"
        )


@router.delete("/appointment-types/{appointment_type_id}/resource-requirements/{requirement_id}", summary="Delete a resource requirement")
async def delete_resource_requirement(
    appointment_type_id: int,
    requirement_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """Delete a resource requirement."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        requirement = db.query(AppointmentResourceRequirement).join(
            AppointmentType, AppointmentResourceRequirement.appointment_type_id == AppointmentType.id
        ).filter(
            AppointmentResourceRequirement.id == requirement_id,
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id,
            AppointmentType.clinic_id == clinic_id
        ).first()
        
        if not requirement:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源需求不存在"
            )
        
        db.delete(requirement)
        db.commit()
        
        return {"success": True, "message": "資源需求已刪除"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to delete resource requirement: {e}")
        db.rollback()
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法刪除資源需求"
        )

