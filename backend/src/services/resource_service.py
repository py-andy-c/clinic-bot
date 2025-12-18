"""
Resource service for resource management and availability checking.

This service handles:
- Resource availability checking for time slots
- Automatic resource allocation for appointments
- Resource validation and filtering
"""

import logging
from datetime import datetime
from typing import List, Dict, Any, Optional

from sqlalchemy.orm import Session

from models import (
    ResourceType,
    Resource,
    AppointmentResourceRequirement,
    AppointmentResourceAllocation,
    CalendarEvent,
    Appointment
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
        exclude_calendar_event_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Check if required resources are available for a time slot.

        Args:
            db: Database session
            appointment_type_id: Appointment type ID
            clinic_id: Clinic ID
            start_time: Slot start datetime
            end_time: Slot end datetime
            exclude_calendar_event_id: Exclude this appointment from checks

        Returns:
            {
                'is_available': bool,
                'conflicts': List[{
                    'resource_type_id': int,
                    'resource_type_name': str,
                    'required_quantity': int,
                    'available_quantity': int
                }]
            }
        """
        # 1. Get resource requirements for appointment type
        requirements = db.query(AppointmentResourceRequirement).filter(
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id
        ).all()

        if not requirements:
            return {'is_available': True, 'conflicts': []}

        # 2. For each required resource type, check availability
        conflicts = []
        is_available = True

        for req in requirements:
            # Count total active resources of this type
            total_resources = db.query(Resource).filter(
                Resource.resource_type_id == req.resource_type_id,
                Resource.clinic_id == clinic_id,
                Resource.is_deleted == False
            ).count()

            # Count allocated resources during this time slot
            # Note: Exclude soft-deleted calendar events and only count confirmed appointments
            allocated_query = db.query(AppointmentResourceAllocation).join(
                CalendarEvent, AppointmentResourceAllocation.appointment_id == CalendarEvent.id
            ).join(
                Appointment, CalendarEvent.id == Appointment.calendar_event_id
            ).filter(
                AppointmentResourceAllocation.resource_id.in_(
                    db.query(Resource.id).filter(
                        Resource.resource_type_id == req.resource_type_id,
                        Resource.clinic_id == clinic_id,
                        Resource.is_deleted == False
                    )
                ),
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

            allocated_count = allocated_query.count()
            available_quantity = total_resources - allocated_count

            if available_quantity < req.quantity:
                is_available = False
                resource_type = db.query(ResourceType).filter(
                    ResourceType.id == req.resource_type_id
                ).first()
                conflict_dict: Dict[str, Any] = {
                    'resource_type_id': req.resource_type_id,
                    'resource_type_name': resource_type.name if resource_type else 'Unknown',
                    'required_quantity': req.quantity,
                    'available_quantity': available_quantity
                }
                conflicts.append(conflict_dict)  # type: ignore[reportUnknownMemberType]

        return {'is_available': is_available, 'conflicts': conflicts}

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

        if not requirements:
            return []

        allocated_resource_ids: List[int] = []

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
                "conflicts": []
            }
        """
        # Get resource requirements for appointment type
        requirements = db.query(AppointmentResourceRequirement).filter(
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id
        ).all()

        if not requirements:
            return {
                "requirements": [],
                "suggested_allocation": [],
                "conflicts": []
            }

        result_requirements: List[Dict[str, Any]] = []
        suggested_allocation: List[Dict[str, Any]] = []
        conflicts: List[Dict[str, Any]] = []

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
                    "is_available": is_available
                })

            available_quantity = len([r for r in available_resources if r.get("is_available", False)])

            # Check for conflicts
            if available_quantity < req.quantity:
                conflicts.append({
                    'resource_type_id': req.resource_type_id,
                    'resource_type_name': resource_type.name,
                    'required_quantity': req.quantity,
                    'available_quantity': available_quantity
                })

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
                    "name": resource_obj.name
                })

        return {
            "requirements": result_requirements,
            "suggested_allocation": suggested_allocation,
            "conflicts": conflicts
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

