# pyright: reportUnknownArgumentType=false, reportUnknownMemberType=false, reportUnknownVariableType=false
"""
Service Management Service for bulk service operations.

This module contains business logic for bulk loading and saving of service management data,
including appointment types, service groups, practitioners, and all their associations.
"""

import logging
from typing import Dict, List, Any
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from models import AppointmentType, ServiceTypeGroup, PractitionerAppointmentTypes, BillingScenario, AppointmentResourceRequirement, FollowUpMessage

logger = logging.getLogger(__name__)


class ServiceManagementService:
    """
    Service class for bulk service management operations.

    Handles loading and saving of complete service catalogs with all associations
    in optimized database operations.
    """

    @staticmethod
    def get_service_management_data(db: Session, clinic_id: int) -> Dict[str, Any]:
        """
        Get complete service management data for a clinic in a single optimized query.

        Returns appointment types, service groups, practitioners, and all associations.

        Args:
            db: Database session
            clinic_id: Clinic ID

        Returns:
            Dict containing all service management data
        """
        try:
            # Single optimized query with JOINs for all data
            query = text("""
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

                    -- Service type groups
                    stg.id as group_id,
                    stg.name as group_name,
                    stg.display_order as group_display_order,

                    -- Practitioner assignments
                    pat.user_id as practitioner_id,

                    -- Billing scenarios
                    bs.id as billing_scenario_id,
                    bs.name as billing_scenario_name,
                    bs.amount,
                    bs.revenue_share,
                    bs.is_default,

                    -- Resource requirements
                    arr.id as resource_requirement_id,
                    arr.resource_type_id,
                    rt.name as resource_type_name,
                    arr.quantity,

                    -- Follow-up messages
                    fm.id as follow_up_message_id,
                    fm.timing_mode,
                    fm.hours_after,
                    fm.days_after,
                    fm.time_of_day,
                    fm.message_template,
                    fm.is_enabled,
                    fm.display_order as message_display_order

                FROM appointment_types at
                LEFT JOIN service_type_groups stg ON stg.id = at.service_type_group_id AND stg.clinic_id = at.clinic_id
                LEFT JOIN practitioner_appointment_types pat ON pat.appointment_type_id = at.id
                LEFT JOIN billing_scenarios bs ON bs.appointment_type_id = at.id
                LEFT JOIN appointment_resource_requirements arr ON arr.appointment_type_id = at.id
                LEFT JOIN resource_types rt ON rt.id = arr.resource_type_id AND rt.clinic_id = at.clinic_id
                LEFT JOIN follow_up_messages fm ON fm.appointment_type_id = at.id
                WHERE at.clinic_id = :clinic_id AND at.is_deleted = false
                ORDER BY stg.display_order, at.display_order, fm.display_order
            """)

            result = db.execute(query, {"clinic_id": clinic_id}).fetchall()

            # Process results into structured data
            appointment_types = {}
            service_type_groups = {}
            practitioner_assignments = {}
            billing_scenarios = {}
            resource_requirements = {}
            follow_up_messages = {}

            for row in result:
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
                    if row.practitioner_id not in practitioner_assignments[at_id]:
                        practitioner_assignments[at_id].append(row.practitioner_id)  # type: ignore

                # Process billing scenarios
                if row.billing_scenario_id:
                    key = f"{at_id}-{row.practitioner_id}"
                    if key not in billing_scenarios:
                        billing_scenarios[key] = []
                    billing_scenarios[key].append({  # type: ignore
                        "id": row.billing_scenario_id,
                        "name": row.billing_scenario_name,
                        "amount": row.amount,
                        "revenue_share": row.revenue_share,
                        "is_default": row.is_default,
                    })

                # Process resource requirements
                if row.resource_requirement_id:
                    if at_id not in resource_requirements:
                        resource_requirements[at_id] = []
                    resource_requirements[at_id].append({  # type: ignore
                        "id": row.resource_requirement_id,
                        "resource_type_id": row.resource_type_id,
                        "resource_type_name": row.resource_type_name,
                        "quantity": row.quantity,
                    })

                # Process follow-up messages
                if row.follow_up_message_id:
                    if at_id not in follow_up_messages:
                        follow_up_messages[at_id] = []
                    follow_up_messages[at_id].append({  # type: ignore
                        "id": row.follow_up_message_id,
                        "timing_mode": row.timing_mode,
                        "hours_after": row.hours_after,
                        "days_after": row.days_after,
                        "time_of_day": row.time_of_day,
                        "message_template": row.message_template,
                        "is_enabled": row.is_enabled,
                        "display_order": row.message_display_order,
                    })

            # Get practitioners separately (they might not be assigned to any services)
            practitioners_query = text("""
                SELECT DISTINCT
                    u.id,
                    uca.full_name,
                    uca.roles
                FROM users u
                JOIN user_clinic_associations uca ON uca.user_id = u.id
                WHERE uca.clinic_id = :clinic_id
                AND uca.is_active = true
                AND uca.roles::text LIKE '%practitioner%'
                ORDER BY uca.full_name
            """)

            practitioners_result = db.execute(practitioners_query, {"clinic_id": clinic_id}).fetchall()
            practitioners = [
                {
                    "id": row.id,
                    "full_name": row.full_name,
                    "roles": row.roles,
                }
                for row in practitioners_result
            ]

            return {
                "appointment_types": list(appointment_types.values()),
                "service_type_groups": list(service_type_groups.values()),
                "practitioners": practitioners,
                "associations": {
                    "practitioner_assignments": practitioner_assignments,  # type: ignore[return-value]
                    "billing_scenarios": billing_scenarios,  # type: ignore[return-value]
                    "resource_requirements": resource_requirements,  # type: ignore[return-value]
                    "follow_up_messages": follow_up_messages,  # type: ignore[return-value]
                }
            }

        except SQLAlchemyError as e:
            logger.error(f"Failed to get service management data for clinic {clinic_id}: {e}")
            raise

    @staticmethod
    def save_service_management_data(db: Session, clinic_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Save complete service management data in a single transaction.

        Args:
            db: Database session
            clinic_id: Clinic ID
            data: Service management data to save

        Returns:
            Dict with success status and any errors
        """
        try:
            # Use SERIALIZABLE isolation to prevent phantom reads
            db.execute(text("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE"))

            errors = []

            # Process service type groups first (needed for appointment types)
            if "service_type_groups" in data:
                ServiceManagementService._save_service_type_groups(db, clinic_id, data["service_type_groups"], errors)  # type: ignore[arg-type]

            # Process appointment types
            if "appointment_types" in data:
                ServiceManagementService._save_appointment_types(db, clinic_id, data["appointment_types"], errors)  # type: ignore[arg-type]

            # Process associations
            associations = data.get("associations", {})
            if "practitioner_assignments" in associations:
                ServiceManagementService._save_practitioner_assignments(db, clinic_id, associations["practitioner_assignments"], errors)  # type: ignore[arg-type]

            if "billing_scenarios" in associations:
                ServiceManagementService._save_billing_scenarios(db, clinic_id, associations["billing_scenarios"], errors)  # type: ignore[arg-type]

            if "resource_requirements" in associations:
                ServiceManagementService._save_resource_requirements(db, clinic_id, associations["resource_requirements"], errors)  # type: ignore[arg-type]

            if "follow_up_messages" in associations:
                ServiceManagementService._save_follow_up_messages(db, clinic_id, associations["follow_up_messages"], errors)  # type: ignore[arg-type]

            if errors:
                db.rollback()
                return {"success": False, "errors": errors}

            db.commit()
            return {"success": True, "errors": []}

        except SQLAlchemyError as e:
            logger.error(f"Failed to save service management data for clinic {clinic_id}: {e}")
            db.rollback()
            raise

    @staticmethod
    def _save_service_type_groups(db: Session, clinic_id: int, groups: List[Dict[str, Any]], errors: List[str]) -> None:
        """Save service type groups."""
        try:
            # Get existing groups
            existing_groups = db.query(ServiceTypeGroup).filter(
                ServiceTypeGroup.clinic_id == clinic_id
            ).all()
            existing_ids = {g.id for g in existing_groups}

            # Process groups
            for group_data in groups:
                if "id" in group_data and group_data["id"] in existing_ids:
                    # Update existing
                    group = db.query(ServiceTypeGroup).filter(
                        ServiceTypeGroup.id == group_data["id"],
                        ServiceTypeGroup.clinic_id == clinic_id
                    ).first()
                    if group:
                        group.name = group_data["name"]
                        group.display_order = group_data["display_order"]
                else:
                    # Create new
                    group = ServiceTypeGroup(
                        clinic_id=clinic_id,
                        name=group_data["name"],
                        display_order=group_data.get("display_order", 0)
                    )
                    db.add(group)

            # Remove groups not in the new data
            new_ids = {g.get("id") for g in groups if "id" in g}
            for existing_group in existing_groups:
                if existing_group.id not in new_ids:
                    # Check if group has appointment types
                    has_appointments = db.query(AppointmentType).filter(
                        AppointmentType.service_type_group_id == existing_group.id
                    ).first()
                    if has_appointments:
                        errors.append(f"Cannot delete service group '{existing_group.name}' - it has associated appointment types")
                    else:
                        db.delete(existing_group)

        except Exception as e:
            errors.append(f"Error saving service type groups: {str(e)}")

    @staticmethod
    def _save_appointment_types(db: Session, clinic_id: int, appointment_types: List[Dict[str, Any]], errors: List[str]) -> None:
        """Save appointment types."""
        try:
            # Get existing appointment types
            existing_types = db.query(AppointmentType).filter(
                AppointmentType.clinic_id == clinic_id,
                AppointmentType.is_deleted == False
            ).all()
            existing_ids = {at.id for at in existing_types}

            # Process appointment types
            for at_data in appointment_types:
                if "id" in at_data and at_data["id"] in existing_ids:
                    # Update existing
                    at = db.query(AppointmentType).filter(
                        AppointmentType.id == at_data["id"],
                        AppointmentType.clinic_id == clinic_id
                    ).first()
                    if at:
                        at.name = at_data["name"]
                        at.duration_minutes = at_data["duration_minutes"]
                        at.receipt_name = at_data.get("receipt_name")
                        at.allow_patient_booking = at_data.get("allow_patient_booking", True)
                        at.allow_new_patient_booking = at_data.get("allow_new_patient_booking", True)
                        at.allow_existing_patient_booking = at_data.get("allow_existing_patient_booking", True)
                        at.allow_patient_practitioner_selection = at_data.get("allow_patient_practitioner_selection", True)
                        at.description = at_data.get("description")
                        at.scheduling_buffer_minutes = at_data.get("scheduling_buffer_minutes", 0)
                        at.service_type_group_id = at_data.get("service_type_group_id")
                        at.display_order = at_data.get("display_order", 0)
                else:
                    # Create new
                    at = AppointmentType(
                        clinic_id=clinic_id,
                        name=at_data["name"],
                        duration_minutes=at_data["duration_minutes"],
                        receipt_name=at_data.get("receipt_name"),
                        allow_patient_booking=at_data.get("allow_patient_booking", True),
                        allow_new_patient_booking=at_data.get("allow_new_patient_booking", True),
                        allow_existing_patient_booking=at_data.get("allow_existing_patient_booking", True),
                        allow_patient_practitioner_selection=at_data.get("allow_patient_practitioner_selection", True),
                        description=at_data.get("description"),
                        scheduling_buffer_minutes=at_data.get("scheduling_buffer_minutes", 0),
                        service_type_group_id=at_data.get("service_type_group_id"),
                        display_order=at_data.get("display_order", 0),
                    )
                    db.add(at)

            # Soft delete types not in the new data
            new_ids = {at.get("id") for at in appointment_types if "id" in at}
            for existing_type in existing_types:
                if existing_type.id not in new_ids:
                    # Soft delete by setting is_deleted = true
                    existing_type.is_deleted = True

        except Exception as e:
            errors.append(f"Error saving appointment types: {str(e)}")

    @staticmethod
    def _save_practitioner_assignments(db: Session, clinic_id: int, assignments: Dict[str, List[int]], errors: List[str]) -> None:
        """Save practitioner assignments."""
        try:
            # Clear existing assignments for all appointment types in this clinic
            db.query(PractitionerAppointmentTypes).filter(
                PractitionerAppointmentTypes.appointment_type_id.in_(
                    db.query(AppointmentType.id).filter(
                        AppointmentType.clinic_id == clinic_id,
                        AppointmentType.is_deleted == False
                    )
                )
            ).delete()

            # Add new assignments
            for at_id_str, practitioner_ids in assignments.items():
                at_id = int(at_id_str)
                for practitioner_id in practitioner_ids:
                    assignment = PractitionerAppointmentTypes(
                        appointment_type_id=at_id,
                        practitioner_id=practitioner_id,
                    )
                    db.add(assignment)

        except Exception as e:
            errors.append(f"Error saving practitioner assignments: {str(e)}")

    @staticmethod
    def _save_billing_scenarios(db: Session, clinic_id: int, scenarios: Dict[str, List[Dict[str, Any]]], errors: List[str]) -> None:
        """Save billing scenarios."""
        try:
            # Clear existing scenarios for all appointment types in this clinic
            db.query(BillingScenario).filter(
                BillingScenario.appointment_type_id.in_(
                    db.query(AppointmentType.id).filter(
                        AppointmentType.clinic_id == clinic_id,
                        AppointmentType.is_deleted == False
                    )
                )
            ).delete()

            # Add new scenarios
            for key, scenario_list in scenarios.items():
                at_id, practitioner_id = key.split("-")
                at_id = int(at_id)
                practitioner_id = int(practitioner_id)

                for scenario_data in scenario_list:
                    scenario = BillingScenario(
                        clinic_id=clinic_id,
                        appointment_type_id=at_id,
                        practitioner_id=practitioner_id,
                        name=scenario_data["name"],
                        amount=scenario_data["amount"],
                        revenue_share=scenario_data["revenue_share"],
                        is_default=scenario_data.get("is_default", False),
                    )
                    db.add(scenario)

        except Exception as e:
            errors.append(f"Error saving billing scenarios: {str(e)}")

    @staticmethod
    def _save_resource_requirements(db: Session, clinic_id: int, requirements: Dict[str, List[Dict[str, Any]]], errors: List[str]) -> None:
        """Save resource requirements."""
        try:
            # Clear existing requirements for all appointment types in this clinic
            db.query(AppointmentResourceRequirement).filter(
                AppointmentResourceRequirement.appointment_type_id.in_(
                    db.query(AppointmentType.id).filter(
                        AppointmentType.clinic_id == clinic_id,
                        AppointmentType.is_deleted == False
                    )
                )
            ).delete()

            # Add new requirements
            for at_id_str, requirement_list in requirements.items():
                at_id = int(at_id_str)

                for req_data in requirement_list:
                    requirement = AppointmentResourceRequirement(
                        appointment_type_id=at_id,
                        resource_type_id=req_data["resource_type_id"],
                        quantity=req_data["quantity"],
                    )
                    db.add(requirement)

        except Exception as e:
            errors.append(f"Error saving resource requirements: {str(e)}")

    @staticmethod
    def _save_follow_up_messages(db: Session, clinic_id: int, messages: Dict[str, List[Dict[str, Any]]], errors: List[str]) -> None:
        """Save follow-up messages."""
        try:
            # Clear existing messages for all appointment types in this clinic
            db.query(FollowUpMessage).filter(
                FollowUpMessage.appointment_type_id.in_(
                    db.query(AppointmentType.id).filter(
                        AppointmentType.clinic_id == clinic_id,
                        AppointmentType.is_deleted == False
                    )
                )
            ).delete()

            # Add new messages
            for at_id_str, message_list in messages.items():
                at_id = int(at_id_str)

                for msg_data in message_list:
                    message = FollowUpMessage(
                        clinic_id=clinic_id,
                        appointment_type_id=at_id,
                        timing_mode=msg_data["timing_mode"],
                        message_template=msg_data["message_template"],
                        is_enabled=msg_data.get("is_enabled", True),
                        display_order=msg_data.get("display_order", 0),
                    )

                    # Set timing-specific fields
                    if msg_data["timing_mode"] == "hours_after":
                        message.hours_after = msg_data.get("hours_after")
                    elif msg_data["timing_mode"] == "specific_time":
                        message.days_after = msg_data.get("days_after")
                        message.time_of_day = msg_data.get("time_of_day")

                    db.add(message)

        except Exception as e:
            errors.append(f"Error saving follow-up messages: {str(e)}")

    @staticmethod
    def get_appointment_types_basic(db: Session, clinic_id: int) -> List[Dict[str, Any]]:
        """
        Get basic appointment type data for components that don't need associations.

        Args:
            db: Database session
            clinic_id: Clinic ID

        Returns:
            List of basic appointment type data
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

        except SQLAlchemyError as e:
            logger.error(f"Failed to get basic appointment types for clinic {clinic_id}: {e}")
            raise
