"""
Service type group service for managing service type groups.

This module contains business logic for service type group CRUD operations.
"""

import logging
from typing import List, Optional, Dict, Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_, func

from models import ServiceTypeGroup
from utils.datetime_utils import taiwan_now

logger = logging.getLogger(__name__)


class ServiceTypeGroupService:
    """
    Service class for service type group operations.
    
    Contains business logic for group management that is shared across API endpoints.
    """

    @staticmethod
    def list_groups_for_clinic(
        db: Session,
        clinic_id: int
    ) -> List[ServiceTypeGroup]:
        """
        List all service type groups for a clinic, ordered by display_order.

        Args:
            db: Database session
            clinic_id: Clinic ID

        Returns:
            List of ServiceTypeGroup objects ordered by display_order
        """
        return db.query(ServiceTypeGroup).filter(
            ServiceTypeGroup.clinic_id == clinic_id
        ).order_by(
            ServiceTypeGroup.display_order.asc(),
            ServiceTypeGroup.id.asc()
        ).all()

    @staticmethod
    def get_group_by_id(
        db: Session,
        group_id: int,
        clinic_id: Optional[int] = None
    ) -> ServiceTypeGroup:
        """
        Get service type group by ID.

        Args:
            db: Database session
            group_id: Group ID
            clinic_id: Optional clinic ID to validate ownership

        Returns:
            ServiceTypeGroup object

        Raises:
            HTTPException: If group not found or doesn't belong to clinic
        """
        query = db.query(ServiceTypeGroup).filter(ServiceTypeGroup.id == group_id)
        
        if clinic_id is not None:
            query = query.filter(ServiceTypeGroup.clinic_id == clinic_id)
        
        group = query.first()
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="服務類型群組不存在"
            )
        
        return group

    @staticmethod
    def create_group(
        db: Session,
        clinic_id: int,
        name: str,
        display_order: Optional[int] = None
    ) -> ServiceTypeGroup:
        """
        Create a new service type group.

        Args:
            db: Database session
            clinic_id: Clinic ID
            name: Group name
            display_order: Optional display order (defaults to end of list)

        Returns:
            Created ServiceTypeGroup object

        Raises:
            HTTPException: If group name already exists for clinic
        """
        # Check for duplicate name
        existing = db.query(ServiceTypeGroup).filter(
            and_(
                ServiceTypeGroup.clinic_id == clinic_id,
                ServiceTypeGroup.name == name
            )
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"群組名稱 '{name}' 已存在"
            )
        
        # If display_order not provided, set to end of list
        if display_order is None:
            max_order = db.query(func.max(ServiceTypeGroup.display_order)).filter(
                ServiceTypeGroup.clinic_id == clinic_id
            ).scalar()
            
            display_order = (max_order + 1) if max_order is not None else 0
        
        now = taiwan_now()
        group = ServiceTypeGroup(
            clinic_id=clinic_id,
            name=name,
            display_order=display_order,
            created_at=now,
            updated_at=now
        )
        
        db.add(group)
        return group

    @staticmethod
    def update_group(
        db: Session,
        group_id: int,
        clinic_id: int,
        name: Optional[str] = None,
        display_order: Optional[int] = None
    ) -> ServiceTypeGroup:
        """
        Update a service type group.

        Args:
            db: Database session
            group_id: Group ID
            clinic_id: Clinic ID for validation
            name: Optional new name
            display_order: Optional new display order

        Returns:
            Updated ServiceTypeGroup object

        Raises:
            HTTPException: If group not found or name already exists
        """
        group = ServiceTypeGroupService.get_group_by_id(db, group_id, clinic_id)
        
        if name is not None and name != group.name:
            # Check for duplicate name
            existing = db.query(ServiceTypeGroup).filter(
                and_(
                    ServiceTypeGroup.clinic_id == clinic_id,
                    ServiceTypeGroup.name == name,
                    ServiceTypeGroup.id != group_id
                )
            ).first()
            
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"群組名稱 '{name}' 已存在"
                )
            
            group.name = name
        
        if display_order is not None:
            group.display_order = display_order
        
        group.updated_at = taiwan_now()
        return group

    @staticmethod
    def delete_group(
        db: Session,
        group_id: int,
        clinic_id: int
    ) -> None:
        """
        Delete a service type group.

        Sets service_type_group_id to NULL for all appointment types in this group.
        This is safe because the FK has ondelete="SET NULL".

        Args:
            db: Database session
            group_id: Group ID
            clinic_id: Clinic ID for validation

        Raises:
            HTTPException: If group not found
        """
        group = ServiceTypeGroupService.get_group_by_id(db, group_id, clinic_id)
        
        # The FK constraint will automatically set service_type_group_id to NULL
        # for all appointment types in this group when we delete the group
        db.delete(group)

    @staticmethod
    def bulk_update_group_order(
        db: Session,
        clinic_id: int,
        group_orders: List[Dict[str, Any]]
    ) -> List[ServiceTypeGroup]:
        """
        Bulk update display order for multiple groups.

        Args:
            db: Database session
            clinic_id: Clinic ID
            group_orders: List of dicts with 'id' and 'display_order'

        Returns:
            List of updated ServiceTypeGroup objects

        Raises:
            HTTPException: If any group not found or doesn't belong to clinic
        """
        # Validate all groups belong to clinic before updating
        group_ids = [order_data.get('id') for order_data in group_orders if order_data.get('id') is not None]
        if group_ids:
            valid_groups = db.query(ServiceTypeGroup).filter(
                ServiceTypeGroup.id.in_(group_ids),
                ServiceTypeGroup.clinic_id == clinic_id
            ).all()
            valid_group_ids = {g.id for g in valid_groups}
            
            if len(valid_group_ids) != len(group_ids):
                invalid_ids = set(group_ids) - valid_group_ids
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"某些群組不存在或不属于此診所: {invalid_ids}"
                )
        
        updated_groups: List[ServiceTypeGroup] = []
        
        for order_data in group_orders:
            group_id = order_data.get('id')
            display_order = order_data.get('display_order')
            
            if group_id is None or display_order is None:
                continue
            
            group = ServiceTypeGroupService.get_group_by_id(db, group_id, clinic_id)
            group.display_order = display_order
            group.updated_at = taiwan_now()
            updated_groups.append(group)
        
        return updated_groups

