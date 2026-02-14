# pyright: reportMissingTypeStubs=false
"""
Resource Management API endpoints.
"""

import logging
import re
from datetime import datetime
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_

from core.database import get_db
from auth.dependencies import require_admin_role, require_authenticated, UserContext, ensure_clinic_access
from models import ResourceType, Resource, AppointmentType, AppointmentResourceRequirement, AppointmentResourceAllocation, CalendarEvent, Appointment
from utils.datetime_utils import taiwan_now

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_future_resource_allocations(db: Session, resource_id: int):
    """
    Get all future confirmed appointment allocations for a resource.
    
    Returns allocations where the appointment is:
    - In the future (date > today OR date == today AND start_time > now)
    - Status is 'confirmed'
    
    Uses Taiwan timezone for consistent comparison with database fields.
    """
    # Use Taiwan timezone for consistent comparison (following existing pattern)
    taiwan_current = taiwan_now()
    today = taiwan_current.date()
    current_time = taiwan_current.time()
    
    return db.query(AppointmentResourceAllocation).join(
        CalendarEvent, AppointmentResourceAllocation.appointment_id == CalendarEvent.id
    ).join(
        Appointment, CalendarEvent.id == Appointment.calendar_event_id
    ).filter(
        AppointmentResourceAllocation.resource_id == resource_id,
        Appointment.status == 'confirmed',
        # Future appointments: either future date, or today but future time
        or_(
            CalendarEvent.date > today,
            and_(
                CalendarEvent.date == today,
                CalendarEvent.start_time > current_time
            )
        )
    )


def _unallocate_future_appointments(db: Session, resource_id: int) -> int:
    """
    Unallocate a resource from all future confirmed appointments.
    
    Returns the number of appointments affected.
    Uses explicit transaction management for data consistency.
    """
    try:
        future_allocations = _get_future_resource_allocations(db, resource_id).all()
        
        for allocation in future_allocations:
            db.delete(allocation)
            logger.info(f"Unallocated resource {resource_id} from future calendar event {allocation.appointment_id}")
        
        return len(future_allocations)
    except Exception as e:
        logger.error(f"Failed to unallocate resource {resource_id} from future appointments: {e}")
        db.rollback()
        raise


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
    resource_count: int
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


class ResourceBundleData(BaseModel):
    """Data model for resource in a bundle."""
    id: Optional[int] = None
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None


class ResourceTypeBundleRequest(BaseModel):
    """Request model for resource type bundle."""
    name: str = Field(..., min_length=1, max_length=255)
    resources: List[ResourceBundleData] = []


class ResourceTypeBundleResponse(BaseModel):
    """Response model for resource type bundle."""
    resource_type: ResourceTypeResponse
    resources: List[ResourceResponse]


# ===== API Endpoints =====

@router.get("/resource-types", summary="List all resource types for clinic")
async def list_resource_types(
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> ResourceTypeListResponse:
    """Get all resource types for the current clinic."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        resource_types = db.query(ResourceType).filter(
            ResourceType.clinic_id == clinic_id
        ).order_by(ResourceType.name).all()
        
        # Get resource counts for each resource type
        resource_type_responses: List[ResourceTypeResponse] = []
        for rt in resource_types:
            resource_count = db.query(Resource).filter(
                Resource.resource_type_id == rt.id,
                Resource.clinic_id == clinic_id,
                Resource.is_deleted == False
            ).count()
            
            resource_type_responses.append(ResourceTypeResponse(
                id=rt.id,
                clinic_id=rt.clinic_id,
                name=rt.name,
                resource_count=resource_count,
                created_at=rt.created_at,
                updated_at=rt.updated_at
            ))
        
        return ResourceTypeListResponse(
            resource_types=resource_type_responses
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
            resource_count=0,  # New resource type has no resources yet
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
        
        # Get current resource count for this resource type
        resource_count = db.query(Resource).filter(
            Resource.resource_type_id == resource_type.id,
            Resource.clinic_id == resource_type.clinic_id,
            Resource.is_deleted == False
        ).count()
        
        return ResourceTypeResponse(
            id=resource_type.id,
            clinic_id=resource_type.clinic_id,
            name=resource_type.name,
            resource_count=resource_count,
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
    current_user: UserContext = Depends(require_authenticated),
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
            Resource.name == request.name
        ).first()
        
        if existing:
            if not existing.is_deleted:
                raise HTTPException(
                    status_code=http_status.HTTP_409_CONFLICT,
                    detail="資源名稱已存在"
                )
            # Reactivate soft-deleted resource
            existing.is_deleted = False
            existing.description = request.description
            db.commit()
            db.refresh(existing)
            return ResourceResponse(
                id=existing.id,
                resource_type_id=existing.resource_type_id,
                clinic_id=existing.clinic_id,
                name=existing.name,
                description=existing.description,
                is_deleted=existing.is_deleted,
                created_at=existing.created_at,
                updated_at=existing.updated_at
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
        
        if request.name and resource.name != request.name:
            # First, check if there's an active resource with this name (True Conflict)
            active_conflict = db.query(Resource).filter(
                Resource.resource_type_id == resource.resource_type_id,
                Resource.name == request.name,
                Resource.is_deleted == False,
                Resource.id != resource_id
            ).with_for_update().first()
            if active_conflict:
                raise HTTPException(
                    status_code=http_status.HTTP_409_CONFLICT,
                    detail="此資源名稱已存在"
                )
            
            # Second, handle "Shadow Conflict" with soft-deleted items
            _evict_soft_deleted_resource_name(db, clinic_id, resource.resource_type_id, request.name, exclude_id=resource_id)
            
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
    """Soft delete a resource. Unallocates from all future confirmed appointments."""
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
        
        # Unallocate future appointments that will be affected
        affected_appointments = _unallocate_future_appointments(db, resource_id)
        
        # Soft delete the resource
        resource.is_deleted = True
        db.commit()
        
        message = "資源已刪除"
        if affected_appointments > 0:
            message += f"，已從 {affected_appointments} 個未來預約中移除此資源配置"
        
        return {"success": True, "message": message, "affected_appointments": affected_appointments}
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
    current_user: UserContext = Depends(require_authenticated),
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
    current_user: UserContext = Depends(require_authenticated),
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


def _evict_soft_deleted_resource_name(
    db: Session, 
    clinic_id: int, 
    resource_type_id: int, 
    name: str, 
    exclude_id: Optional[int] = None
) -> None:
    """
    If a soft-deleted resource exists with the given name, rename it to a unique name
    to avoid unique constraint violations when an active resource wants to take the name.
    """
    conflict_items = db.query(Resource).filter(
        Resource.clinic_id == clinic_id,
        Resource.resource_type_id == resource_type_id,
        Resource.name == name,
        Resource.is_deleted == True
    )
    if exclude_id is not None:
        conflict_items = conflict_items.filter(Resource.id != exclude_id)
    
    results = conflict_items.all()
    for conflict_item in results:
        suffix = datetime.now().strftime("%Y%m%d%H%M%S%f")
        conflict_item.name = f"{conflict_item.name} (deleted-{suffix})"
        # Log eviction for audit/debug
        logger.info(f"Evicted soft-deleted resource name: {name} -> {conflict_item.name} (Resource ID: {conflict_item.id})")
    
    if results:
        db.flush()


@router.get("/resource-types/{resource_type_id}/bundle", summary="Get resource type bundle")
async def get_resource_type_bundle(
    resource_type_id: int,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> ResourceTypeBundleResponse:
    """Get a resource type and all its resources."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Get resource type
        resource_type = db.query(ResourceType).filter(
            ResourceType.id == resource_type_id,
            ResourceType.clinic_id == clinic_id
        ).first()
        
        if not resource_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源類型不存在"
            )
            
        # Get resources
        resources = db.query(Resource).filter(
            Resource.resource_type_id == resource_type_id,
            Resource.clinic_id == clinic_id,
            Resource.is_deleted == False
        ).order_by(Resource.name).all()
        
        return ResourceTypeBundleResponse(
            resource_type=ResourceTypeResponse(
                id=resource_type.id,
                clinic_id=resource_type.clinic_id,
                name=resource_type.name,
                resource_count=len(resources),  # Use the resources we just queried
                created_at=resource_type.created_at,
                updated_at=resource_type.updated_at
            ),
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
        logger.exception(f"Failed to get resource type bundle: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得資源類型細節"
        )


def _sync_resource_type_resources(
    db: Session,
    clinic_id: int,
    resource_type_id: int,
    resources_data: List[ResourceBundleData]
) -> None:
    """
    Sync all resources for a resource type in a single transaction.
    Uses diff-based sync (Soft Delete missing).
    """
    incoming_ids = {r.id for r in resources_data if r.id}
    
    # 1. Soft delete missing resources and unallocate from future appointments
    resources_to_delete = db.query(Resource).filter(
        Resource.resource_type_id == resource_type_id,
        Resource.clinic_id == clinic_id,
        Resource.is_deleted == False
    )
    if incoming_ids:
        resources_to_delete = resources_to_delete.filter(Resource.id.not_in(incoming_ids))
    
    resources_to_delete_list = resources_to_delete.all()
    
    # For each resource being deleted, unallocate from future appointments
    for resource in resources_to_delete_list:
        _unallocate_future_appointments(db, resource.id)
        # Soft delete the resource
        resource.is_deleted = True
    
    # 2. Update or create resources
    for r_data in resources_data:
        if r_data.id:
            resource = db.query(Resource).filter(
                Resource.id == r_data.id,
                Resource.resource_type_id == resource_type_id,
                Resource.clinic_id == clinic_id
            ).first()
            if resource:
                # Handle Shadow Conflict if name changed
                if resource.name != r_data.name:
                    _evict_soft_deleted_resource_name(db, clinic_id, resource_type_id, r_data.name, exclude_id=resource.id)
                resource.name = r_data.name
                resource.description = r_data.description
                resource.is_deleted = False # Ensure reactivated if it was soft-deleted
        else:
            # Before creating a truly new one, evict ANY soft-deleted item with the same name
            # (This handles cases where the user creates a new record instead of reactivating)
            _evict_soft_deleted_resource_name(db, clinic_id, resource_type_id, r_data.name)

            resource = Resource(
                resource_type_id=resource_type_id,
                clinic_id=clinic_id,
                name=r_data.name,
                description=r_data.description
            )
            db.add(resource)


@router.post("/resource-types/bundle", summary="Create resource type bundle")
async def create_resource_type_bundle(
    request: ResourceTypeBundleRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ResourceTypeBundleResponse:
    """Create a new resource type and its resources in one transaction."""
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

        # 1. Create Resource Type
        resource_type = ResourceType(
            clinic_id=clinic_id,
            name=request.name
        )
        db.add(resource_type)
        db.flush()
        
        # 2. Sync Resources
        _sync_resource_type_resources(db, clinic_id, resource_type.id, request.resources)

        db.commit()
        return await get_resource_type_bundle(resource_type.id, current_user, db)
        
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to create resource type bundle: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法建立資源類型"
        )


@router.put("/resource-types/{resource_type_id}/bundle", summary="Update resource type bundle")
async def update_resource_type_bundle(
    resource_type_id: int,
    request: ResourceTypeBundleRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
) -> ResourceTypeBundleResponse:
    """Update an existing resource type and its resources in one transaction."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        resource_type = db.query(ResourceType).filter(
            ResourceType.id == resource_type_id,
            ResourceType.clinic_id == clinic_id
        ).with_for_update().first()
        
        if not resource_type:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="資源類型不存在"
            )
            
        # Check name conflict
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
            
        # 1. Update Resource Type
        resource_type.name = request.name
        
        # 2. Sync Resources
        _sync_resource_type_resources(db, clinic_id, resource_type.id, request.resources)
        
        db.commit()
        return await get_resource_type_bundle(resource_type_id, current_user, db)
        
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Failed to update resource type bundle: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法更新資源類型"
        )
