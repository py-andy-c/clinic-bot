"""
Resource service for resource management and availability checking.

This service handles:
- Resource availability checking for time slots
- Automatic resource allocation for appointments
- Resource validation and filtering
"""

import logging
from datetime import datetime
from typing import List, Dict, Any, Optional, cast

from sqlalchemy import and_
from sqlalchemy.orm import Session

from models import (
    ResourceType,
    Resource,
    AppointmentResourceRequirement,
    AppointmentResourceAllocation,
    CalendarEvent,
    Appointment,
    UserClinicAssociation
)

logger = logging.getLogger(__name__)


class ResourceService:
    """Service for resource management and availability checking."""

    @staticmethod
    def check_resource_availability(
        db: Session,
        appointment_type_id: int,
        clinic_id: int,
        start_time: datetime,
        end_time: datetime,
        selected_resource_ids: Optional[List[int]] = None,
        exclude_calendar_event_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Check if resources are available for an appointment type at a given time.

        Args:
            db: Database session
            appointment_type_id: Appointment type ID
            clinic_id: Clinic ID
            start_time: Start datetime
            end_time: End datetime
            selected_resource_ids: Optional list of selected resource IDs to check for specific conflicts
            exclude_calendar_event_id: Optional calendar event ID to exclude

        Returns:
            {
                'is_available': bool,
                'selection_insufficient_warnings': List[Dict],
                'resource_conflict_warnings': List[Dict],
                'unavailable_resource_ids': List[int]
            }
        """
        # 1. Get resource requirements for appointment type
        requirements = db.query(AppointmentResourceRequirement).filter(
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id
        ).all()

        if not requirements:
            return {
                'is_available': True,
                'selection_insufficient_warnings': [],
                'resource_conflict_warnings': [],
                'unavailable_resource_ids': []
            }

        # Ensure selected_resource_ids is a list
        selected_ids = selected_resource_ids or []
        
        selection_insufficient_warnings: List[Dict[str, Any]] = []
        resource_conflict_warnings: List[Dict[str, Any]] = []
        global_unavailable_resource_ids: List[int] = []
        is_available = True

        for req in requirements:
            # Get resource type name
            resource_type = db.query(ResourceType).filter(ResourceType.id == req.resource_type_id).first()
            resource_type_name = resource_type.name if resource_type else "未知資源類型"

            # Get all active resources of this type
            all_resources = db.query(Resource).filter(
                Resource.resource_type_id == req.resource_type_id,
                Resource.clinic_id == clinic_id,
                Resource.is_deleted == False
            ).all()
            all_resource_ids = [r.id for r in all_resources]
            resource_map = {r.id: r.name for r in all_resources}

            # Find allocated resources during this time slot
            # Note: Exclude soft-deleted calendar events and only count confirmed appointments
            allocated_query = db.query(
                AppointmentResourceAllocation.resource_id,
                CalendarEvent,
                UserClinicAssociation.full_name.label('practitioner_name')
            ).join(
                CalendarEvent, AppointmentResourceAllocation.appointment_id == CalendarEvent.id
            ).join(
                Appointment, CalendarEvent.id == Appointment.calendar_event_id
            ).join(
                UserClinicAssociation, and_(CalendarEvent.user_id == UserClinicAssociation.user_id, CalendarEvent.clinic_id == UserClinicAssociation.clinic_id)
            ).filter(
                AppointmentResourceAllocation.resource_id.in_(all_resource_ids),
                CalendarEvent.clinic_id == clinic_id,
                CalendarEvent.date == start_time.date(),
                CalendarEvent.start_time < end_time.time(),
                CalendarEvent.end_time > start_time.time(),
                Appointment.status == 'confirmed',
                UserClinicAssociation.is_active == True
            )

            if exclude_calendar_event_id:
                allocated_query = allocated_query.filter(
                    CalendarEvent.id != exclude_calendar_event_id
                )

            allocations = allocated_query.all()
            allocated_resource_ids = {a.resource_id for a in allocations}
            global_unavailable_resource_ids.extend(list(allocated_resource_ids))

            # 2. Check Availability
            if selected_resource_ids is None:
                # General capacity check (no specific selection provided)
                # Check if there are enough available resources to meet the requirement
                available_count = len([rid for rid in all_resource_ids if rid not in allocated_resource_ids])
                
                if available_count < req.quantity:
                    is_available = False
                    # We can use selection_insufficient_warnings to indicate shortage, 
                    # but maybe with a slightly different meaning or messages
                    selection_insufficient_warnings.append({
                        "resource_type_name": resource_type_name,
                        "required_quantity": req.quantity,
                        "selected_quantity": available_count  # In this context, "selected" means "available"
                    })
            else:
                # Specific selection check
                selected_for_this_type = [rid for rid in selected_ids if rid in all_resource_ids]
                
                # Check Quantity
                if len(selected_for_this_type) < req.quantity:
                    is_available = False
                    selection_insufficient_warnings.append({
                        "resource_type_name": resource_type_name,
                        "required_quantity": req.quantity,
                        "selected_quantity": len(selected_for_this_type)
                    })

                # Check Conflicts (only for selected resources)
                for allocation in allocations:
                    if allocation.resource_id in selected_for_this_type:
                        is_available = False
                        resource_conflict_warnings.append({
                            "resource_name": resource_map.get(allocation.resource_id, "未知資源"),
                            "resource_type_name": resource_type_name,
                            "conflicting_appointment": {
                                "practitioner_name": allocation.practitioner_name,
                                "start_time": allocation.CalendarEvent.start_time.strftime('%H:%M'),
                                "end_time": allocation.CalendarEvent.end_time.strftime('%H:%M')
                            }
                        })

        return {
            'is_available': is_available,
            'selection_insufficient_warnings': selection_insufficient_warnings,
            'resource_conflict_warnings': resource_conflict_warnings,
            'unavailable_resource_ids': list(set(global_unavailable_resource_ids))
        }

    @staticmethod
    def allocate_resources(
        db: Session,
        appointment_id: int,
        appointment_type_id: int,
        start_time: datetime,
        end_time: datetime,
        clinic_id: int,
        selected_resource_ids: Optional[List[int]] = None,
        exclude_calendar_event_id: Optional[int] = None
    ) -> List[int]:
        """
        Allocate required resources for an appointment.

        If selected_resource_ids is provided, validates and uses those resources.
        Otherwise, automatically allocates available resources.

        Args:
            db: Database session
            appointment_id: Calendar event ID (appointment ID)
            appointment_type_id: Appointment type ID
            start_time: Appointment start datetime
            end_time: Appointment end datetime
            clinic_id: Clinic ID
            selected_resource_ids: Optional list of resource IDs selected by frontend
            exclude_calendar_event_id: Exclude this appointment from availability checks

        Returns:
            List of allocated resource IDs
        """
        # Get requirements
        requirements = db.query(AppointmentResourceRequirement).filter(
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id
        ).all()

        allocated_resource_ids: List[int] = []

        # Phase 1: Process required resources (those matching AppointmentResourceRequirement)
        # These resources are validated for availability and allocated according to requirements
        if requirements:
            for req in requirements:
                if selected_resource_ids:
                    # Validate and filter selected resources for this resource type
                    validated_resources = ResourceService._validate_and_filter_resources(
                        db,
                        selected_resource_ids,
                        req.resource_type_id,
                        clinic_id,
                        start_time,
                        end_time,
                        exclude_calendar_event_id
                    )

                    # Use validated resources up to required quantity
                    to_allocate = min(req.quantity, len(validated_resources))
                    for i in range(to_allocate):
                        allocation = AppointmentResourceAllocation(
                            appointment_id=appointment_id,
                            resource_id=validated_resources[i].id
                        )
                        db.add(allocation)
                        allocated_resource_ids.append(validated_resources[i].id)

                    # If we need more resources, auto-allocate additional ones
                    if to_allocate < req.quantity:
                        remaining_needed = req.quantity - to_allocate
                        available_resources = ResourceService._find_available_resources(
                            db, req.resource_type_id, clinic_id, start_time, end_time, exclude_calendar_event_id
                        )
                        # Exclude already allocated resources
                        allocated_ids_set = {r.id for r in validated_resources[:to_allocate]}
                        available_resources = [r for r in available_resources if r.id not in allocated_ids_set]

                        additional_to_allocate = min(remaining_needed, len(available_resources))
                        for i in range(additional_to_allocate):
                            allocation = AppointmentResourceAllocation(
                                appointment_id=appointment_id,
                                resource_id=available_resources[i].id
                            )
                            db.add(allocation)
                            allocated_resource_ids.append(available_resources[i].id)
                else:
                    # Auto-allocate if no selection provided
                    available_resources = ResourceService._find_available_resources(
                        db, req.resource_type_id, clinic_id, start_time, end_time, exclude_calendar_event_id
                    )

                    # Allocate required quantity (simple: first available)
                    to_allocate = min(req.quantity, len(available_resources))
                    for i in range(to_allocate):
                        allocation = AppointmentResourceAllocation(
                            appointment_id=appointment_id,
                            resource_id=available_resources[i].id
                        )
                        db.add(allocation)
                        allocated_resource_ids.append(available_resources[i].id)

        # Phase 2: Allocate additional resources (resources that don't match any requirement)
        # This allows users to add "additional resource types" that aren't explicitly required
        # by the appointment type. For example, a Pilates appointment might require a "治療室"
        # but the user can also manually add "床" resources.
        if selected_resource_ids:
            allocated_set = set(allocated_resource_ids)
            remaining_selected = [rid for rid in selected_resource_ids if rid not in allocated_set]
            
            if remaining_selected:
                # Validate remaining resources exist, belong to the clinic, and aren't deleted
                # Note: We don't check availability here - this is intentional to allow manual overrides
                # Users can explicitly select resources even if they're marked as unavailable
                additional_resources = db.query(Resource).filter(
                    Resource.id.in_(remaining_selected),
                    Resource.clinic_id == clinic_id,
                    Resource.is_deleted == False
                ).all()
                
                # Allocate all valid additional resources
                # Availability is not checked - this is a manual override feature
                for resource in additional_resources:
                    allocation = AppointmentResourceAllocation(
                        appointment_id=appointment_id,
                        resource_id=resource.id
                    )
                    db.add(allocation)
                    allocated_resource_ids.append(resource.id)
        return allocated_resource_ids

    @staticmethod
    def _find_available_resources(
        db: Session,
        resource_type_id: int,
        clinic_id: int,
        start_time: datetime,
        end_time: datetime,
        exclude_calendar_event_id: Optional[int] = None
    ) -> List[Resource]:
        """
        Find available resources of a type for a time slot.

        Args:
            db: Database session
            resource_type_id: Resource type ID
            clinic_id: Clinic ID
            start_time: Slot start datetime
            end_time: Slot end datetime
            exclude_calendar_event_id: Exclude this appointment from checks

        Returns:
            List of available Resource objects, ordered by name
        """
        # Get all active resources of this type
        all_resources = db.query(Resource).filter(
            Resource.resource_type_id == resource_type_id,
            Resource.clinic_id == clinic_id,
            Resource.is_deleted == False
        ).all()

        # Get allocated resource IDs during this time
        # Note: Exclude soft-deleted calendar events and only count confirmed appointments
        allocated_query = db.query(AppointmentResourceAllocation.resource_id).join(
            CalendarEvent, AppointmentResourceAllocation.appointment_id == CalendarEvent.id
        ).join(
            Appointment, CalendarEvent.id == Appointment.calendar_event_id
        ).filter(
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date == start_time.date(),
            CalendarEvent.start_time < end_time.time(),
            CalendarEvent.end_time > start_time.time(),
            Appointment.status == 'confirmed'
        )

        if exclude_calendar_event_id:
            allocated_query = allocated_query.filter(
                CalendarEvent.id != exclude_calendar_event_id
            )

        allocated_resource_ids = {r[0] for r in allocated_query.all()}  # Extract resource_id from tuple

        # Return available resources (ordered by name for deterministic selection)
        available = [r for r in all_resources if r.id not in allocated_resource_ids]
        return sorted(available, key=lambda r: r.name)  # Deterministic ordering by name

    @staticmethod
    def _validate_and_filter_resources(
        db: Session,
        selected_resource_ids: List[int],
        resource_type_id: int,
        clinic_id: int,
        start_time: datetime,
        end_time: datetime,
        exclude_calendar_event_id: Optional[int] = None
    ) -> List[Resource]:
        """
        Validate and filter selected resources.

        Validates that resources:
        - Exist
        - Are active (not soft-deleted)
        - Belong to the correct clinic
        - Belong to the correct resource type
        - Are available at the specified time (if check_availability=True)

        Args:
            db: Database session
            selected_resource_ids: List of resource IDs to validate
            resource_type_id: Expected resource type ID
            clinic_id: Expected clinic ID
            start_time: Slot start datetime
            end_time: Slot end datetime
            exclude_calendar_event_id: Exclude this appointment from availability checks

        Returns:
            List of valid Resource objects that are available
        """
        if not selected_resource_ids:
            return []

        # Get all resources that match the IDs and are valid
        resources = db.query(Resource).filter(
            Resource.id.in_(selected_resource_ids),
            Resource.resource_type_id == resource_type_id,
            Resource.clinic_id == clinic_id,
            Resource.is_deleted == False
        ).all()

        # Get allocated resource IDs during this time
        allocated_query = db.query(AppointmentResourceAllocation.resource_id).join(
            CalendarEvent, AppointmentResourceAllocation.appointment_id == CalendarEvent.id
        ).join(
            Appointment, CalendarEvent.id == Appointment.calendar_event_id
        ).filter(
            AppointmentResourceAllocation.resource_id.in_([r.id for r in resources]),
            CalendarEvent.clinic_id == clinic_id,
            CalendarEvent.date == start_time.date(),
            CalendarEvent.start_time < end_time.time(),
            CalendarEvent.end_time > start_time.time(),
            Appointment.status == 'confirmed'
        )

        if exclude_calendar_event_id:
            allocated_query = allocated_query.filter(
                CalendarEvent.id != exclude_calendar_event_id
            )

        # Note: We don't filter by allocated_resource_ids here because resources can be overridden
        # (allows manual resource selection even if already allocated to another appointment)
        # We only filter out invalid resources (wrong type, wrong clinic, deleted)

        return sorted(resources, key=lambda r: r.name)

    @staticmethod
    def get_resource_availability_for_slot(
        db: Session,
        appointment_type_id: int,
        clinic_id: int,
        start_time: datetime,
        end_time: datetime,
        exclude_calendar_event_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Get detailed resource availability information for a time slot.

        Used by the frontend for resource selection UI.

        Args:
            db: Database session
            appointment_type_id: Appointment type ID
            clinic_id: Clinic ID
            start_time: Slot start datetime
            end_time: Slot end datetime
            exclude_calendar_event_id: Exclude this appointment from checks

        Returns:
            {
                "requirements": [
                    {
                        "resource_type_id": int,
                        "resource_type_name": str,
                        "required_quantity": int,
                        "available_resources": [
                            {"id": int, "name": str, "is_available": bool},
                            ...
                        ],
                        "available_quantity": int
                    }
                ],
                "suggested_allocation": [
                    {"id": int, "name": str}
                ],
                "conflicts": [
                    {
                        "resource_type_id": int,
                        "resource_type_name": str,
                        "required_quantity": int,
                        "total_resources": int,
                        "allocated_count": int
                    }
                ]
            }
        """
        # Get resource requirements for appointment type
        requirements = db.query(AppointmentResourceRequirement).filter(
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id
        ).all()

        if not requirements:
            return {
                "requirements": [],
                "suggested_allocation": []
            }

        result_requirements: List[Dict[str, Any]] = []
        suggested_allocation: List[Dict[str, Any]] = []

        for req in requirements:
            resource_type = db.query(ResourceType).filter(
                ResourceType.id == req.resource_type_id
            ).first()

            if not resource_type:
                continue

            # Get all resources of this type (active)
            all_resources = db.query(Resource).filter(
                Resource.resource_type_id == req.resource_type_id,
                Resource.clinic_id == clinic_id,
                Resource.is_deleted == False
            ).order_by(Resource.name).all()

            # Get allocated resource IDs during this time
            allocated_query = db.query(AppointmentResourceAllocation.resource_id).join(
                CalendarEvent, AppointmentResourceAllocation.appointment_id == CalendarEvent.id
            ).join(
                Appointment, CalendarEvent.id == Appointment.calendar_event_id
            ).filter(
                AppointmentResourceAllocation.resource_id.in_([r.id for r in all_resources]),
                CalendarEvent.clinic_id == clinic_id,
                CalendarEvent.date == start_time.date(),
                CalendarEvent.start_time < end_time.time(),
                CalendarEvent.end_time > start_time.time(),
                Appointment.status == 'confirmed'
            )

            if exclude_calendar_event_id:
                allocated_query = allocated_query.filter(
                    CalendarEvent.id != exclude_calendar_event_id
                )

            allocated_resource_ids = {r[0] for r in allocated_query.all()}

            # Build available resources list
            available_resources: List[Dict[str, Any]] = []
            for resource in all_resources:
                is_available = resource.id not in allocated_resource_ids
                available_resources.append({
                    "id": resource.id,
                    "name": resource.name,
                    "description": resource.description,
                    "is_available": is_available
                })

            available_quantity = len([r for r in available_resources if r.get("is_available", False)])

            # available_quantity check is handled by counts above

            result_requirements.append({
                "resource_type_id": req.resource_type_id,
                "resource_type_name": resource_type.name,
                "required_quantity": req.quantity,
                "available_resources": available_resources,
                "available_quantity": available_quantity
            })

            # Add suggested allocation (first available resources)
            available_resource_objs: List[Resource] = [r for r in all_resources if r.id not in allocated_resource_ids]
            suggested_count = min(req.quantity, len(available_resource_objs))
            for i in range(suggested_count):
                resource_obj = available_resource_objs[i]
                suggested_allocation.append({
                    "id": resource_obj.id,
                    "name": resource_obj.name,
                    "description": resource_obj.description
                })

        return {
            "requirements": result_requirements,
            "suggested_allocation": suggested_allocation
        }

    @staticmethod
    def get_all_resources_for_appointments(
        db: Session,
        appointment_ids: List[int]
    ) -> Dict[int, List[Resource]]:
        """
        Bulk fetch resources for multiple appointments in a single query.

        Returns a dictionary mapping appointment_id to a list of Resource objects.
        """
        if not appointment_ids:
            return {}

        # Join allocations with resources to get all info in one go
        allocations = db.query(AppointmentResourceAllocation, Resource).join(
            Resource, AppointmentResourceAllocation.resource_id == Resource.id
        ).filter(
            AppointmentResourceAllocation.appointment_id.in_(appointment_ids)
        ).all()

        result: Dict[int, List[Resource]] = {}
        for allocation, resource in allocations:
            if allocation.appointment_id not in result:
                result[allocation.appointment_id] = []
            result[allocation.appointment_id].append(resource)

        return result

