"""
Service Management Service for bulk service management operations.

This module contains all service management-related business logic for bulk loading
and saving of service items, practitioners, billing scenarios, and associations.
"""

import logging
import time
from typing import Dict, List, Any, Union, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from models import (
    AppointmentType,
    ServiceTypeGroup,
    UserClinicAssociation,
    BillingScenario,
    AppointmentResourceRequirement,
    FollowUpMessage,
    PractitionerAppointmentTypes
)

logger = logging.getLogger(__name__)

def _retry_on_serialization_failure(max_retries: int = 3, base_delay: float = 0.1):  # type: ignore
    """
    Decorator to retry operations that fail due to SERIALIZABLE transaction isolation.

    SERIALIZABLE isolation can cause serialization failures when concurrent transactions
    modify the same data. This decorator implements exponential backoff retry logic.

    Args:
        max_retries: Maximum number of retry attempts
        base_delay: Base delay in seconds (exponential backoff)
    """
    def decorator(func):  # type: ignore
        def wrapper(*args, **kwargs):  # type: ignore
            last_exception = None
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)  # type: ignore
                except OperationalError as e:
                    last_exception = e
                    # Check if this is a serialization failure (SQLSTATE 40001)
                    if hasattr(e, 'orig') and hasattr(e.orig, 'pgcode'):
                        pgcode = getattr(e.orig, 'pgcode', None)
                        if pgcode == '40001':  # serialization_failure
                            if attempt < max_retries:
                                delay = base_delay * (2 ** attempt)  # Exponential backoff
                                logger.warning(  # type: ignore
                                    f"Serialization failure in {getattr(func, '__name__', 'unknown')} (attempt {attempt + 1}/{max_retries + 1}), "  # type: ignore
                                    f"retrying in {delay:.2f} seconds: {e}"
                                )
                                time.sleep(delay)
                                continue
                    # Re-raise if not a serialization failure or max retries exceeded
                    raise
            # This should not be reached, but just in case
            raise last_exception  # type: ignore
        return wrapper  # type: ignore
    return decorator  # type: ignore


class ServiceManagementService:
    """
    Service class for service management bulk operations.

    Contains business logic for bulk loading and saving all service management data
    to eliminate N+1 query patterns and database connection pool exhaustion.
    """

    @staticmethod
    def get_service_management_data(db: Session, clinic_id: int, limit: Optional[int] = None, offset: Optional[int] = None) -> Dict[str, Any]:
        """
        Single optimized query loading all service management data with proper JOINs.

        This replaces multiple individual API calls with one bulk query that loads:
        - Appointment types with their groups
        - Service type groups
        - Practitioners (clinic members with practitioner role)
        - Practitioner assignments (which practitioners offer which services)
        - Billing scenarios (pricing per practitioner-service combination)
        - Resource requirements (equipment/facilities needed per service)
        - Follow-up messages (automated messages after appointments)

        Args:
            db: Database session
            clinic_id: Clinic ID to load data for

        Returns:
            Dict containing all service management data
        """
        try:
            # Track query execution time for monitoring
            query_start_time = time.time()

            # Build query with optional pagination
            query_parts = ["""
                SELECT
                    -- Appointment types
                    at.id as appointment_type_id,
                    at.name as appointment_type_name,
                    at.duration_minutes,
                    at.receipt_name,
                    at.allow_patient_booking,
                    at.allow_new_patient_booking,
                    at.allow_existing_patient_booking,
                    at.allow_patient_practitioner_selection,
                    at.description,
                    at.scheduling_buffer_minutes,
                    at.service_type_group_id,
                    at.display_order as appointment_type_display_order,
                    at.send_patient_confirmation,
                    at.send_clinic_confirmation,
                    at.send_reminder,
                    at.patient_confirmation_message,
                    at.clinic_confirmation_message,
                    at.reminder_message,
                    at.require_notes,
                    at.notes_instructions,

                    -- Service type groups
                    stg.id as group_id,
                    stg.name as group_name,
                    stg.display_order as group_display_order,

                    -- Practitioner assignments
                    pat.id as practitioner_assignment_id,
                    pat.user_id as practitioner_id,

                    -- Billing scenarios
                    bs.id as billing_scenario_id,
                    bs.name as billing_scenario_name,
                    bs.amount,
                    bs.revenue_share,
                    bs.is_default,

                    -- Resource requirements
                    arr.id as resource_requirement_id,
                    arr.quantity,
                    rt.id as resource_type_id,
                    rt.name as resource_type_name,

                    -- Follow-up messages
                    fm.id as follow_up_message_id,
                    fm.timing_mode,
                    fm.hours_after,
                    fm.message_template,
                    fm.is_enabled,
                    fm.display_order as follow_up_display_order

                FROM appointment_types at
                LEFT JOIN service_type_groups stg ON stg.id = at.service_type_group_id
                LEFT JOIN practitioner_appointment_types pat ON pat.appointment_type_id = at.id AND pat.is_deleted = false
                LEFT JOIN billing_scenarios bs ON bs.appointment_type_id = at.id AND bs.is_deleted = false
                LEFT JOIN appointment_resource_requirements arr ON arr.appointment_type_id = at.id
                LEFT JOIN resource_types rt ON rt.id = arr.resource_type_id
                LEFT JOIN follow_up_messages fm ON fm.appointment_type_id = at.id
                WHERE at.clinic_id = :clinic_id AND at.is_deleted = false
                ORDER BY stg.display_order, at.display_order, fm.display_order
            """]

            # Add pagination if specified
            if limit:
                query_parts.append(f"LIMIT {limit}")
            if offset:
                query_parts.append(f"OFFSET {offset}")

            bulk_query = text(" ".join(query_parts))

            result = db.execute(bulk_query, {"clinic_id": clinic_id})
            rows = result.fetchall()

            # Log query execution time for monitoring
            query_execution_time = time.time() - query_start_time
            logger.info(
                f"Bulk service management query completed for clinic {clinic_id} "
                f"in {query_execution_time:.3f}s, returned {len(rows)} rows"
            )

            # Process rows into structured data
            appointment_types: Dict[int, Dict[str, Any]] = {}
            service_type_groups: Dict[int, Dict[str, Any]] = {}
            practitioner_assignments: Dict[int, List[Dict[str, Any]]] = {}
            billing_scenarios: Dict[str, List[Dict[str, Any]]] = {}
            resource_requirements: Dict[int, List[Dict[str, Any]]] = {}
            follow_up_messages: Dict[int, List[Dict[str, Any]]] = {}

            # Process each row from the bulk query

            for row in rows:
                # Process appointment types
                at_id = row.appointment_type_id
                if at_id not in appointment_types:
                    appointment_types[at_id] = {
                        "id": at_id,
                        "name": row.appointment_type_name,
                        "duration_minutes": row.duration_minutes,
                        "receipt_name": row.receipt_name,
                        "allow_patient_booking": row.allow_patient_booking,
                        "allow_new_patient_booking": row.allow_new_patient_booking,
                        "allow_existing_patient_booking": row.allow_existing_patient_booking,
                        "allow_patient_practitioner_selection": row.allow_patient_practitioner_selection,
                        "description": row.description,
                        "scheduling_buffer_minutes": row.scheduling_buffer_minutes,
                        "service_type_group_id": row.service_type_group_id,
                        "display_order": row.appointment_type_display_order,
                        "send_patient_confirmation": row.send_patient_confirmation,
                        "send_clinic_confirmation": row.send_clinic_confirmation,
                        "send_reminder": row.send_reminder,
                        "patient_confirmation_message": row.patient_confirmation_message,
                        "clinic_confirmation_message": row.clinic_confirmation_message,
                        "reminder_message": row.reminder_message,
                        "require_notes": row.require_notes,
                        "notes_instructions": row.notes_instructions,
                    }

                # Process service type groups
                if row.group_id and row.group_id not in service_type_groups:
                    service_type_groups[row.group_id] = {
                        "id": row.group_id,
                        "name": row.group_name,
                        "display_order": row.group_display_order,
                    }

                # Process practitioner assignments
                if row.practitioner_id:
                    if at_id not in practitioner_assignments:
                        practitioner_assignments[at_id] = []
                    # Check if this practitioner is already in the list
                    existing_assignment = next((pa for pa in practitioner_assignments[at_id] if pa.get("practitioner_id") == row.practitioner_id), None)
                    if not existing_assignment:
                        practitioner_assignments[at_id].append({
                            "id": int(row.practitioner_assignment_id),  # type: ignore
                            "practitioner_id": int(row.practitioner_id)  # type: ignore
                        })

                # Process billing scenarios
                if row.billing_scenario_id:
                    billing_key = f"{at_id}-{row.practitioner_id}"
                    if billing_key not in billing_scenarios:
                        billing_scenarios[billing_key] = []
                    billing_scenarios[billing_key].append({
                        "id": int(row.billing_scenario_id),
                        "amount": int(row.amount),
                        "revenue_share": int(row.revenue_share),
                        "is_default": bool(row.is_default),
                    })

                # Process resource requirements
                if row.resource_requirement_id:
                    if at_id not in resource_requirements:
                        resource_requirements[at_id] = []
                    resource_requirements[at_id].append({
                        "id": int(row.resource_requirement_id),
                        "resource_type_id": int(row.resource_type_id),
                        "resource_type_name": str(row.resource_type_name),
                        "quantity": int(row.quantity),
                    })

                # Process follow-up messages
                if row.follow_up_message_id:
                    if at_id not in follow_up_messages:
                        follow_up_messages[at_id] = []
                    follow_up_messages[at_id].append({
                        "id": int(row.follow_up_message_id),
                        "timing_mode": str(row.timing_mode),
                        "hours_after": row.hours_after,
                        "message_template": str(row.message_template),
                        "is_enabled": bool(row.is_enabled),
                        "display_order": int(row.follow_up_display_order),
                    })

            # Get practitioners (clinic members with practitioner role)
            practitioners_query = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.clinic_id == clinic_id,
                UserClinicAssociation.is_active == True,
                UserClinicAssociation.roles.contains(['practitioner'])
            ).order_by(UserClinicAssociation.full_name)

            practitioners = [
                {
                    "id": assoc.user_id,
                    "full_name": assoc.full_name,
                    "roles": assoc.roles,
                }
                for assoc in practitioners_query
            ]

            return {
                "appointment_types": list(appointment_types.values()),
                "service_type_groups": list(service_type_groups.values()),
                "practitioners": practitioners,
                "associations": {
                    "practitioner_assignments": practitioner_assignments,
                    "billing_scenarios": billing_scenarios,
                    "resource_requirements": resource_requirements,
                    "follow_up_messages": follow_up_messages,
                }
            }

        except Exception as e:
            logger.exception(f"Failed to get service management data for clinic {clinic_id}: {e}")
            return {
                "error": "database_error",
                "message": "Failed to retrieve service management data",
                "details": str(e) if logger.level <= logging.DEBUG else None
            }

    @staticmethod
    def get_appointment_types_lightweight(db: Session, clinic_id: int) -> List[Dict[str, Any]]:
        """
        Get lightweight appointment types data for components that don't need associations.

        Used by appointment creation, dashboards, and basic displays that only need
        basic appointment type information without associations.

        Args:
            db: Database session
            clinic_id: Clinic ID to load data for

        Returns:
            List of appointment type dictionaries with basic fields
        """
        try:
            appointment_types = db.query(AppointmentType).filter(
                AppointmentType.clinic_id == clinic_id,
                AppointmentType.is_deleted == False
            ).order_by(AppointmentType.display_order).all()

            return [
                {
                    "id": at.id,
                    "name": at.name,
                    "duration_minutes": at.duration_minutes,
                    "service_type_group_id": at.service_type_group_id,
                    "display_order": at.display_order,
                }
                for at in appointment_types
            ]

        except Exception as e:
            logger.exception(f"Failed to get lightweight appointment types for clinic {clinic_id}: {e}")
            raise

    @staticmethod
    @_retry_on_serialization_failure(max_retries=3, base_delay=0.1)
    def save_service_management_data(db: Session, clinic_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Save all service management data in a single SERIALIZABLE transaction for consistency.

        This method performs bulk operations in a single transaction to ensure data consistency
        and prevent partial saves that could leave the system in an inconsistent state.

        Args:
            db: Database session
            clinic_id: Clinic ID to save data for
            data: Service management data to save containing:
                - appointment_types: List of appointment type data
                - service_type_groups: List of service type group data
                - associations: Dict with practitioner_assignments, billing_scenarios, etc.

        Returns:
            Dict with success status and any validation errors

        Raises:
            Exception: If transaction fails or validation errors occur
        """
        # Perform bulk save operations (caller should handle transaction)
        errors: Dict[str, Dict[str, List[str]]] = {"service_items": {}, "billing_scenarios": {}, "practitioner_assignments": {}}

        try:
            # Save service type groups first (needed for appointment types)
            group_id_map: Dict[Union[str, int], int] = {}  # Maps temporary IDs to real IDs
            for group_data in data.get("service_type_groups", []):
                group = ServiceManagementService._save_service_type_group(db, clinic_id, group_data)
                if group_data.get("id") and not isinstance(group_data["id"], int):
                    group_id_map[group_data["id"]] = group.id

            # Save appointment types
            at_id_map: Dict[Union[str, int], int] = {}  # Maps temporary IDs to real IDs
            for at_data in data.get("appointment_types", []):
                # Replace temporary group IDs with real ones
                if "service_type_group_id" in at_data:
                    if at_data["service_type_group_id"] in group_id_map:
                        at_data["service_type_group_id"] = group_id_map[at_data["service_type_group_id"]]
                    elif isinstance(at_data["service_type_group_id"], str):
                        # Temporary ID not found, set to None to avoid database errors
                        at_data["service_type_group_id"] = None

                appointment_type = ServiceManagementService._save_appointment_type(db, clinic_id, at_data)
                if at_data.get("id") and not isinstance(at_data["id"], int):
                    at_id_map[at_data["id"]] = appointment_type.id

            # Save associations
            associations = data.get("associations", {})

            # Save practitioner assignments (incremental updates)
            practitioner_assignments = associations.get("practitioner_assignments", {})
            if not isinstance(practitioner_assignments, dict):
                raise ValueError("practitioner_assignments must be a dictionary")

            for temp_at_id, assignment_data in practitioner_assignments.items():  # type: ignore
                real_at_id = at_id_map.get(temp_at_id, temp_at_id)  # type: ignore
                real_at_id_int = int(real_at_id)  # type: ignore
                # Support both legacy format (list of IDs) and new format (list of dicts with IDs)
                assignment_list = list(assignment_data)  # type: ignore
                if assignment_list and isinstance(assignment_list[0], dict):  # type: ignore
                    ServiceManagementService._save_practitioner_assignments_incremental(db, clinic_id, real_at_id_int, assignment_list)  # type: ignore
                else:
                    # Legacy format: complete replacement
                    practitioner_ids = [int(pid) for pid in assignment_list if pid is not None]  # type: ignore
                    ServiceManagementService._save_practitioner_assignments(db, clinic_id, real_at_id_int, practitioner_ids)  # type: ignore

            # Save billing scenarios (incremental updates)
            billing_scenarios: Dict[str, List[Dict[str, Any]]] = associations.get("billing_scenarios", {})
            for billing_key, scenarios in billing_scenarios.items():
                # Parse key like "1-101" (appointment_type_id-practitioner_id)
                parts = str(billing_key).split("-")
                if len(parts) == 2:
                    temp_at_id, practitioner_id = parts
                    real_at_id = at_id_map.get(temp_at_id, temp_at_id)
                    ServiceManagementService._save_billing_scenarios_incremental(db, clinic_id, int(real_at_id), int(practitioner_id), list(scenarios))

            # Save resource requirements
            resource_requirements: Dict[Union[str, int], List[Dict[str, Any]]] = associations.get("resource_requirements", {})
            for temp_at_id, requirements in resource_requirements.items():
                real_at_id = at_id_map.get(temp_at_id, temp_at_id)
                ServiceManagementService._save_resource_requirements(db, clinic_id, int(real_at_id), list(requirements))

            # Save follow-up messages
            follow_up_messages: Dict[Union[str, int], List[Dict[str, Any]]] = associations.get("follow_up_messages", {})
            for temp_at_id, messages in follow_up_messages.items():
                real_at_id = at_id_map.get(temp_at_id, temp_at_id)
                ServiceManagementService._save_follow_up_messages(db, clinic_id, int(real_at_id), list(messages))

        except ValueError as e:
            # Handle validation errors (like invalid associations structure)
            logger.warning(f"Validation error saving service management data for clinic {clinic_id}: {e}")
            return {
                "success": False,
                "error": "validation_error",
                "message": f"Validation error: {str(e)}",
                "details": str(e) if logger.level <= logging.DEBUG else None
            }
        except Exception as e:
            # Handle database and other errors
            logger.exception(f"Failed to save service management data for clinic {clinic_id}: {e}")
            return {
                "success": False,
                "error": "database_error",
                "message": f"Failed to save service management data: {str(e)}",
                "details": str(e) if logger.level <= logging.DEBUG else None
            }

        # Check for validation errors
        has_errors = any(len(error_list) > 0 for error_dict in errors.values() for error_list in error_dict.values())
        if has_errors:
            return {
                "success": False,
                "error": "validation_error",
                "message": "Bulk save validation errors",
                "validation_errors": errors,
                "details": errors if logger.level <= logging.DEBUG else None
            }

        return {"success": True, "message": "Bulk save operation completed"}

    @staticmethod
    def _save_service_type_group(db: Session, clinic_id: int, group_data: Dict[str, Any]) -> ServiceTypeGroup:
        """Save a single service type group."""
        group_id = group_data.get("id")
        if group_id and isinstance(group_id, int):
            # Update existing
            group = db.query(ServiceTypeGroup).filter(
                ServiceTypeGroup.id == group_id,
                ServiceTypeGroup.clinic_id == clinic_id
            ).first()
            if not group:
                raise ValueError(f"Service type group {group_id} not found")
        else:
            # Create new
            group = ServiceTypeGroup(clinic_id=clinic_id)

        # Update fields
        group.name = group_data["name"]
        group.display_order = group_data.get("display_order", 0)

        if not group.id:
            db.add(group)
            db.flush()  # Get the ID

        return group

    @staticmethod
    def _save_appointment_type(db: Session, clinic_id: int, at_data: Dict[str, Any]) -> AppointmentType:
        """Save a single appointment type."""
        at_id = at_data.get("id")
        if at_id and isinstance(at_id, int):
            # Update existing
            appointment_type = db.query(AppointmentType).filter(
                AppointmentType.id == at_id,
                AppointmentType.clinic_id == clinic_id
            ).first()
            if not appointment_type:
                raise ValueError(f"Appointment type {at_id} not found")
        else:
            # Create new
            appointment_type = AppointmentType(clinic_id=clinic_id)

        # Update fields
        appointment_type.name = at_data["name"]
        appointment_type.duration_minutes = at_data["duration_minutes"]
        appointment_type.receipt_name = at_data.get("receipt_name")
        appointment_type.allow_patient_booking = at_data.get("allow_patient_booking", True)
        appointment_type.allow_new_patient_booking = at_data.get("allow_new_patient_booking", True)
        appointment_type.allow_existing_patient_booking = at_data.get("allow_existing_patient_booking", True)
        appointment_type.allow_patient_practitioner_selection = at_data.get("allow_patient_practitioner_selection", True)
        appointment_type.description = at_data.get("description")
        appointment_type.scheduling_buffer_minutes = at_data.get("scheduling_buffer_minutes", 0)
        appointment_type.service_type_group_id = at_data.get("service_type_group_id")
        appointment_type.display_order = at_data.get("display_order", 0)
        appointment_type.send_patient_confirmation = at_data.get("send_patient_confirmation", True)
        appointment_type.send_clinic_confirmation = at_data.get("send_clinic_confirmation", True)
        appointment_type.send_reminder = at_data.get("send_reminder", True)
        appointment_type.patient_confirmation_message = at_data.get("patient_confirmation_message") or ""
        appointment_type.clinic_confirmation_message = at_data.get("clinic_confirmation_message") or ""
        appointment_type.reminder_message = at_data.get("reminder_message") or ""
        appointment_type.require_notes = at_data.get("require_notes", False)
        appointment_type.notes_instructions = at_data.get("notes_instructions")
        appointment_type.is_deleted = False  # Reactivate if it was soft deleted

        if not appointment_type.id:
            db.add(appointment_type)
            db.flush()  # Get the ID

        return appointment_type

    @staticmethod
    def _save_practitioner_assignments(db: Session, clinic_id: int, appointment_type_id: int, practitioner_ids: List[int]):
        """Save practitioner assignments for an appointment type."""
        # Remove existing assignments
        db.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == appointment_type_id
        ).delete()

        # Add new assignments
        for practitioner_id in practitioner_ids:
            assignment = PractitionerAppointmentTypes(
                user_id=practitioner_id,
                appointment_type_id=appointment_type_id,
                clinic_id=clinic_id
            )
            db.add(assignment)

    @staticmethod
    def _save_practitioner_assignments_incremental(db: Session, clinic_id: int, appointment_type_id: int, assignments: List[Dict[str, Any]]):
        """Save practitioner assignments for an appointment type with incremental updates."""
        # Track which assignments should remain active
        active_assignment_ids: set[int] = set()

        # Update existing assignments and create new ones
        for assignment_data in assignments:
            assignment_id = assignment_data.get("id")
            practitioner_id = assignment_data["practitioner_id"]

            if assignment_id and isinstance(assignment_id, int):
                # Update existing assignment
                assignment = db.query(PractitionerAppointmentTypes).filter(
                    PractitionerAppointmentTypes.id == assignment_id,
                    PractitionerAppointmentTypes.clinic_id == clinic_id
                ).first()
                if assignment:
                    assignment.user_id = practitioner_id
                    assignment.is_deleted = False  # Reactivate if it was soft deleted
                    active_assignment_ids.add(assignment_id)  # type: ignore
            else:
                # Create new assignment
                assignment = PractitionerAppointmentTypes(
                    clinic_id=clinic_id,
                    appointment_type_id=appointment_type_id,
                    user_id=practitioner_id
                )
                db.add(assignment)
                db.flush()  # Get the ID
                active_assignment_ids.add(assignment.id)  # type: ignore

        # Soft delete assignments that are no longer in the list
        db.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == appointment_type_id,
            PractitionerAppointmentTypes.id.notin_(active_assignment_ids)  # type: ignore
        ).update({"is_deleted": True})

    @staticmethod
    def _save_billing_scenarios_incremental(db: Session, clinic_id: int, appointment_type_id: int, practitioner_id: int, scenarios: List[Dict[str, Any]]):
        """Save billing scenarios for an appointment type and practitioner with incremental updates."""
        # Track which scenarios should remain active
        active_scenario_ids: set[int] = set()

        # Update existing scenarios and create new ones
        for scenario_data in scenarios:
            scenario_id = scenario_data.get("id")
            if scenario_id and isinstance(scenario_id, int):
                # Update existing scenario
                scenario = db.query(BillingScenario).filter(
                    BillingScenario.id == scenario_id,
                    BillingScenario.clinic_id == clinic_id
                ).first()
                if scenario:
                    scenario.name = scenario_data["name"]
                    scenario.amount = scenario_data["amount"]
                    scenario.revenue_share = scenario_data["revenue_share"]
                    scenario.is_default = scenario_data.get("is_default", False)
                    scenario.is_deleted = False  # Reactivate if it was soft deleted
                    active_scenario_ids.add(scenario_id)  # type: ignore
            else:
                # Create new scenario
                scenario = BillingScenario(
                    clinic_id=clinic_id,
                    appointment_type_id=appointment_type_id,
                    practitioner_id=practitioner_id,
                    name=scenario_data["name"],
                    amount=scenario_data["amount"],
                    revenue_share=scenario_data["revenue_share"],
                    is_default=scenario_data.get("is_default", False)
                )
                db.add(scenario)
                db.flush()  # Get the ID
                active_scenario_ids.add(scenario.id)  # type: ignore

        # Soft delete scenarios that are no longer in the list
        db.query(BillingScenario).filter(
            BillingScenario.appointment_type_id == appointment_type_id,
            BillingScenario.practitioner_id == practitioner_id,
            BillingScenario.clinic_id == clinic_id,
            BillingScenario.id.notin_(active_scenario_ids)  # type: ignore
        ).update({"is_deleted": True})

    @staticmethod
    def _save_billing_scenarios(db: Session, clinic_id: int, appointment_type_id: int, practitioner_id: int, scenarios: List[Dict[str, Any]]):
        """Save billing scenarios for an appointment type and practitioner (legacy complete replacement)."""
        # Remove existing scenarios
        db.query(BillingScenario).filter(
            BillingScenario.appointment_type_id == appointment_type_id,
            BillingScenario.practitioner_id == practitioner_id,
            BillingScenario.clinic_id == clinic_id
        ).delete()

        # Add new scenarios
        for scenario_data in scenarios:
            scenario = BillingScenario(
                clinic_id=clinic_id,
                appointment_type_id=appointment_type_id,
                practitioner_id=practitioner_id,
                name=scenario_data["name"],
                amount=scenario_data["amount"],
                revenue_share=scenario_data["revenue_share"],
                is_default=scenario_data.get("is_default", False)
            )
            db.add(scenario)

    @staticmethod
    def _save_resource_requirements(db: Session, clinic_id: int, appointment_type_id: int, requirements: List[Dict[str, Any]]):
        """Save resource requirements for an appointment type."""
        # Remove existing requirements
        db.query(AppointmentResourceRequirement).filter(
            AppointmentResourceRequirement.appointment_type_id == appointment_type_id
        ).delete()

        # Add new requirements
        for req_data in requirements:
            requirement = AppointmentResourceRequirement(
                appointment_type_id=appointment_type_id,
                resource_type_id=req_data["resource_type_id"],
                quantity=req_data["quantity"]
            )
            db.add(requirement)

    @staticmethod
    def _save_follow_up_messages(db: Session, clinic_id: int, appointment_type_id: int, messages: List[Dict[str, Any]]):
        """Save follow-up messages for an appointment type."""
        # Remove existing messages
        db.query(FollowUpMessage).filter(
            FollowUpMessage.appointment_type_id == appointment_type_id
        ).delete()

        # Add new messages
        for msg_data in messages:
            message = FollowUpMessage(
                clinic_id=clinic_id,
                appointment_type_id=appointment_type_id,
                timing_mode=msg_data["timing_mode"],
                hours_after=msg_data.get("hours_after"),
                message_template=msg_data["message_template"],
                is_enabled=msg_data.get("is_enabled", True),
                display_order=msg_data.get("display_order", 0)
            )
            db.add(message)