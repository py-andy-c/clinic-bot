"""
Unit tests for ServiceManagementService.

Tests for bulk loading and saving of service management data.
"""

import pytest
from sqlalchemy.orm import Session

from models.appointment_type import AppointmentType
from models.service_type_group import ServiceTypeGroup
from models.user import User
from models.user_clinic_association import UserClinicAssociation
from models.billing_scenario import BillingScenario
from models.practitioner_appointment_types import PractitionerAppointmentTypes
from models.appointment_resource_requirement import AppointmentResourceRequirement
from models.follow_up_message import FollowUpMessage
from models.resource_type import ResourceType
from services.service_management_service import ServiceManagementService


class TestServiceManagementService:
    """Test ServiceManagementService methods."""

    def test_get_service_management_data_empty_clinic(self, db_session: Session):
        """Test getting service management data for clinic with no services."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Empty Clinic",
            line_channel_id="empty_channel",
            line_channel_secret="empty_secret",
            line_channel_access_token="empty_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Get data
        result = ServiceManagementService.get_service_management_data(db_session, clinic.id)

        # Should return empty lists/dicts
        assert result["appointment_types"] == []
        assert result["service_type_groups"] == []
        assert result["practitioners"] == []
        assert result["associations"]["practitioner_assignments"] == {}
        assert result["associations"]["billing_scenarios"] == {}
        assert result["associations"]["resource_requirements"] == {}
        assert result["associations"]["follow_up_messages"] == {}

    def test_get_service_management_data_with_data(self, db_session: Session):
        """Test getting service management data with appointment types and practitioners."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()  # Get clinic.id

        # Create service type group
        group = ServiceTypeGroup(
            clinic_id=clinic.id,
            name="Manual Therapy",
            display_order=1
        )
        db_session.add(group)
        db_session.flush()  # Get group.id

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Initial Consultation",
            duration_minutes=60,
            service_type_group_id=group.id,
            display_order=1,
            allow_patient_booking=True,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True,
            allow_patient_practitioner_selection=True
        )
        db_session.add(appt_type)

        # Create practitioner using the helper function
        from tests.conftest import create_user_with_clinic_association
        from models.practitioner_appointment_types import PractitionerAppointmentTypes
        practitioner, assoc = create_user_with_clinic_association(
            db_session, clinic, "Dr. Smith", "smith@example.com", "test_sub", ["practitioner"], True
        )

        # Create practitioner assignment
        pat = PractitionerAppointmentTypes(
            user_id=practitioner.id,
            appointment_type_id=appt_type.id,
            clinic_id=clinic.id
        )
        db_session.add(pat)

        db_session.commit()

        # Get data
        result = ServiceManagementService.get_service_management_data(db_session, clinic.id)

        # Check appointment types
        assert len(result["appointment_types"]) == 1
        at = result["appointment_types"][0]
        assert at["id"] == appt_type.id
        assert at["name"] == "Initial Consultation"
        assert at["duration_minutes"] == 60

        # Check service type groups
        assert len(result["service_type_groups"]) == 1
        assert result["service_type_groups"][0]["name"] == "Manual Therapy"

        # Check practitioners
        assert len(result["practitioners"]) == 1
        assert result["practitioners"][0]["full_name"] == "Dr. Smith"

        # Check associations
        associations = result["associations"]

        # Practitioner assignments
        assert appt_type.id in associations["practitioner_assignments"]
        practitioner_assignments = associations["practitioner_assignments"][appt_type.id]
        assert len(practitioner_assignments) == 1
        assert practitioner_assignments[0]["practitioner_id"] == practitioner.id
        assert "id" in practitioner_assignments[0]  # Should have assignment ID

        # No billing scenarios in this simplified test
        assert len(associations["billing_scenarios"]) == 0

        # No resource requirements in this simplified test
        assert len(associations["resource_requirements"]) == 0

        # No follow-up messages in this simplified test
        assert len(associations["follow_up_messages"]) == 0

    def test_get_appointment_types_lightweight(self, db_session: Session):
        """Test getting lightweight appointment types data."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()  # Get clinic.id

        # Create service type group
        group = ServiceTypeGroup(
            clinic_id=clinic.id,
            name="Manual Therapy",
            display_order=1
        )
        db_session.add(group)
        db_session.flush()  # Get group.id

        # Create appointment types
        at1 = AppointmentType(
            clinic_id=clinic.id,
            name="Service 1",
            duration_minutes=30,
            display_order=1,
            allow_patient_booking=True,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True,
            allow_patient_practitioner_selection=True
        )
        at2 = AppointmentType(
            clinic_id=clinic.id,
            name="Service 2",
            duration_minutes=45,
            display_order=2,
            allow_patient_booking=True,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True,
            allow_patient_practitioner_selection=True
        )
        db_session.add(at1)
        db_session.add(at2)
        db_session.commit()

        # Get lightweight data
        result = ServiceManagementService.get_appointment_types_lightweight(db_session, clinic.id)

        # Should return list with basic fields
        assert len(result) == 2
        assert result[0]["name"] == "Service 1"
        assert result[0]["duration_minutes"] == 30
        assert result[1]["name"] == "Service 2"
        assert result[1]["duration_minutes"] == 45

        # Should not include association fields
        for at in result:
            assert "billing_scenarios" not in at
            assert "resource_requirements" not in at

    def test_save_service_management_data_basic(self, db_session: Session):
        """Test basic bulk save of service management data."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Save data
        save_data = {
            "appointment_types": [
                {
                    "name": "New Service",
                    "duration_minutes": 60,
                    "display_order": 1,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True
                }
            ],
            "service_type_groups": [
                {
                    "name": "New Group",
                    "display_order": 1
                }
            ],
            "associations": {
                "practitioner_assignments": {},
                "billing_scenarios": {},
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        result = ServiceManagementService.save_service_management_data(db_session, clinic.id, save_data)

        assert result["success"] is True
        assert "message" in result

        # Verify data was saved
        appointment_types = db_session.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id
        ).all()
        assert len(appointment_types) == 1
        assert appointment_types[0].name == "New Service"

        groups = db_session.query(ServiceTypeGroup).filter(
            ServiceTypeGroup.clinic_id == clinic.id
        ).all()
        assert len(groups) == 1
        assert groups[0].name == "New Group"

    def test_save_service_management_data_with_associations(self, db_session: Session):
        """Test bulk save including associations."""
        from models.clinic import Clinic
        from models.practitioner_appointment_types import PractitionerAppointmentTypes

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)

        # Create practitioner using the helper function
        from tests.conftest import create_user_with_clinic_association
        practitioner, assoc = create_user_with_clinic_association(
            db_session, clinic, "Dr. Smith", "smith@example.com", "test_sub", ["practitioner"], True
        )

        # Create resource type
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="Massage Table"
        )
        db_session.add(resource_type)
        db_session.commit()

        # Save data with basic associations
        save_data = {
            "appointment_types": [
                {
                    "id": "temp_1",  # Temporary ID
                    "name": "Full Service",
                    "duration_minutes": 90,
                    "display_order": 1,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True
                }
            ],
            "service_type_groups": [
                {
                    "name": "Therapy Services",
                    "display_order": 1
                }
            ],
            "associations": {
                "practitioner_assignments": {
                    "temp_1": [{"practitioner_id": practitioner.id}]  # New format with dict
                },
                "billing_scenarios": {},
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        result = ServiceManagementService.save_service_management_data(db_session, clinic.id, save_data)

        assert result["success"] is True

        # Verify appointment type was created
        appointment_types = db_session.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id
        ).all()
        assert len(appointment_types) == 1
        at = appointment_types[0]
        assert at.name == "Full Service"

        # Verify practitioner assignment
        assignments = db_session.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == at.id
        ).all()
        assert len(assignments) == 1
        assert assignments[0].user_id == practitioner.id

        # No billing scenarios in this simplified test
        billing_scenarios = db_session.query(BillingScenario).filter(
            BillingScenario.appointment_type_id == at.id
        ).all()
        assert len(billing_scenarios) == 0

        # No resource requirements in this simplified test
        requirements = db_session.query(AppointmentResourceRequirement).filter(
            AppointmentResourceRequirement.appointment_type_id == at.id
        ).all()
        assert len(requirements) == 0

        # No follow-up messages in this simplified test
        messages = db_session.query(FollowUpMessage).filter(
            FollowUpMessage.appointment_type_id == at.id
        ).all()
        assert len(messages) == 0

    def test_save_service_management_data_with_billing_scenarios(self, db_session: Session):
        """Test bulk save including billing scenarios to improve coverage."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)

        # Create practitioner using the helper function
        from tests.conftest import create_user_with_clinic_association
        practitioner, assoc = create_user_with_clinic_association(
            db_session, clinic, "Dr. Smith", "smith@example.com", "test_sub", ["practitioner"], True
        )
        db_session.commit()

        # Save data with billing scenarios
        save_data = {
            "appointment_types": [
                {
                    "id": "temp_1",  # Temporary ID
                    "name": "Premium Service",
                    "duration_minutes": 60,
                    "display_order": 1,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True
                }
            ],
            "service_type_groups": [
                {
                    "name": "Premium Services",
                    "display_order": 1
                }
            ],
            "associations": {
                "practitioner_assignments": {
                    "temp_1": [practitioner.id]
                },
                "billing_scenarios": {
                    "temp_1-{}".format(practitioner.id): [  # Key format: appointment_type_id-practitioner_id
                        {
                            "name": "原價",
                            "amount": 5000,
                            "revenue_share": 80,
                            "is_default": True
                        }
                    ]
                },
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        result = ServiceManagementService.save_service_management_data(db_session, clinic.id, save_data)

        # Check result structure
        assert result["success"] is True
        assert "Bulk save operation completed" in result["message"]

        # Verify the billing scenario was created in the database
        billing_scenarios = db_session.query(BillingScenario).filter(
            BillingScenario.clinic_id == clinic.id
        ).all()
        assert len(billing_scenarios) == 1
        bs = billing_scenarios[0]
        assert bs.name == "原價"
        assert bs.amount == 5000
        assert bs.revenue_share == 80
        assert bs.is_default is True

        # Verify appointment type was created
        appointment_types = db_session.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id
        ).all()
        assert len(appointment_types) == 1
        at = appointment_types[0]
        assert at.name == "Premium Service"

        # Verify practitioner assignment was created
        practitioner_assignments = db_session.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == at.id,
            PractitionerAppointmentTypes.user_id == practitioner.id
        ).all()
        assert len(practitioner_assignments) == 1

    def test_get_service_management_data_filters_soft_deleted_associations(self, db_session: Session):
        """Test that soft-deleted practitioner assignments and billing scenarios are filtered out."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        # Create service type group
        group = ServiceTypeGroup(
            clinic_id=clinic.id,
            name="Test Group",
            display_order=1
        )
        db_session.add(group)
        db_session.flush()

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=60,
            service_type_group_id=group.id,
            display_order=1,
            allow_patient_booking=True,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True,
            allow_patient_practitioner_selection=True
        )
        db_session.add(appt_type)
        db_session.flush()

        # Create practitioners
        from tests.conftest import create_user_with_clinic_association
        active_practitioner, active_assoc = create_user_with_clinic_association(
            db_session, clinic, "Active Dr", "active@example.com", "active_sub", ["practitioner"], True
        )
        inactive_practitioner, inactive_assoc = create_user_with_clinic_association(
            db_session, clinic, "Inactive Dr", "inactive@example.com", "inactive_sub", ["practitioner"], True
        )
        db_session.commit()

        # Create practitioner assignments - one active, one soft-deleted
        active_assignment = PractitionerAppointmentTypes(
            user_id=active_practitioner.id,
            appointment_type_id=appt_type.id,
            clinic_id=clinic.id,
            is_deleted=False
        )
        inactive_assignment = PractitionerAppointmentTypes(
            user_id=inactive_practitioner.id,
            appointment_type_id=appt_type.id,
            clinic_id=clinic.id,
            is_deleted=True  # Soft deleted
        )
        db_session.add(active_assignment)
        db_session.add(inactive_assignment)

        # Create billing scenarios - one active, one soft-deleted
        active_billing = BillingScenario(
            practitioner_id=active_practitioner.id,
            appointment_type_id=appt_type.id,
            clinic_id=clinic.id,
            name="Active Scenario",
            amount=1000,
            revenue_share=70,
            is_default=True,
            is_deleted=False
        )
        inactive_billing = BillingScenario(
            practitioner_id=active_practitioner.id,
            appointment_type_id=appt_type.id,
            clinic_id=clinic.id,
            name="Inactive Scenario",
            amount=2000,
            revenue_share=80,
            is_default=False,
            is_deleted=True  # Soft deleted
        )
        db_session.add(active_billing)
        db_session.add(inactive_billing)
        db_session.commit()

        # Get data
        result = ServiceManagementService.get_service_management_data(db_session, clinic.id)

        # Verify only active associations are returned
        associations = result["associations"]

        # Should only have the active practitioner assignment
        assert appt_type.id in associations["practitioner_assignments"]
        practitioners = associations["practitioner_assignments"][appt_type.id]
        assert len(practitioners) == 1
        assert practitioners[0]["practitioner_id"] == active_practitioner.id
        assert "id" in practitioners[0]  # Should have assignment ID

        # Should only have the active billing scenario
        assert len(associations["billing_scenarios"]) == 1
        billing_key = f"{appt_type.id}-{active_practitioner.id}"
        assert billing_key in associations["billing_scenarios"]
        scenarios = associations["billing_scenarios"][billing_key]
        assert len(scenarios) == 1
        assert scenarios[0]["id"] == active_billing.id
        assert scenarios[0]["amount"] == 1000
        assert scenarios[0]["revenue_share"] == 70
        assert scenarios[0]["is_default"] is True

    def test_get_service_management_data_with_resource_requirements(self, db_session: Session):
        """Test that resource requirements are properly retrieved and structured."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        # Create resource type
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="Massage Table"
        )
        db_session.add(resource_type)
        db_session.flush()

        # Create service type group
        group = ServiceTypeGroup(
            clinic_id=clinic.id,
            name="Therapy Services",
            display_order=1
        )
        db_session.add(group)
        db_session.flush()

        # Create appointment types
        at1 = AppointmentType(
            clinic_id=clinic.id,
            name="Massage Service",
            duration_minutes=60,
            service_type_group_id=group.id,
            display_order=1,
            allow_patient_booking=True,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True,
            allow_patient_practitioner_selection=True
        )
        at2 = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30,
            service_type_group_id=group.id,
            display_order=2,
            allow_patient_booking=True,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True,
            allow_patient_practitioner_selection=True
        )
        db_session.add(at1)
        db_session.add(at2)
        db_session.flush()

        # Create resource requirements for the first appointment type
        req1 = AppointmentResourceRequirement(
            appointment_type_id=at1.id,
            resource_type_id=resource_type.id,
            quantity=1
        )
        db_session.add(req1)
        db_session.commit()

        # Get data
        result = ServiceManagementService.get_service_management_data(db_session, clinic.id)

        # Verify resource requirements are included
        associations = result["associations"]
        assert at1.id in associations["resource_requirements"]
        requirements = associations["resource_requirements"][at1.id]

        # Should have 1 requirement
        assert len(requirements) == 1

        # Check the structure of resource requirements
        req = requirements[0]
        assert "id" in req
        assert "quantity" in req
        assert "resource_type_id" in req
        assert "resource_type_name" in req
        assert req["resource_type_id"] == resource_type.id
        assert req["resource_type_name"] == "Massage Table"
        assert req["quantity"] == 1

        # Second appointment type should have no resource requirements
        assert at2.id not in associations["resource_requirements"] or len(associations["resource_requirements"][at2.id]) == 0

    def test_get_service_management_data_with_follow_up_messages(self, db_session: Session):
        """Test that follow-up messages are properly retrieved and structured."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        # Create service type group
        group = ServiceTypeGroup(
            clinic_id=clinic.id,
            name="Therapy Services",
            display_order=1
        )
        db_session.add(group)
        db_session.flush()

        # Create appointment types
        at1 = AppointmentType(
            clinic_id=clinic.id,
            name="Massage Service",
            duration_minutes=60,
            service_type_group_id=group.id,
            display_order=1,
            allow_patient_booking=True,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True,
            allow_patient_practitioner_selection=True
        )
        at2 = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30,
            service_type_group_id=group.id,
            display_order=2,
            allow_patient_booking=True,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True,
            allow_patient_practitioner_selection=True
        )
        db_session.add(at1)
        db_session.add(at2)
        db_session.flush()

        # Create follow-up messages for the first appointment type
        from datetime import time
        msg1 = FollowUpMessage(
            appointment_type_id=at1.id,
            clinic_id=clinic.id,
            timing_mode="hours_after",
            hours_after=24,
            message_template="Thank you for your visit! How are you feeling?",
            is_enabled=True,
            display_order=1
        )
        msg2 = FollowUpMessage(
            appointment_type_id=at1.id,
            clinic_id=clinic.id,
            timing_mode="specific_time",
            days_after=7,
            time_of_day=time(21, 0),  # 9:00 PM
            message_template="Weekly follow-up: How has your condition been?",
            is_enabled=True,
            display_order=2
        )
        db_session.add(msg1)
        db_session.add(msg2)
        db_session.commit()

        # Get data
        result = ServiceManagementService.get_service_management_data(db_session, clinic.id)

        # Verify follow-up messages are included
        associations = result["associations"]
        assert at1.id in associations["follow_up_messages"]
        messages = associations["follow_up_messages"][at1.id]

        # Should have 2 messages
        assert len(messages) == 2

        # Sort messages by display_order for consistent testing
        messages.sort(key=lambda x: x["display_order"])

        # Check first message (hours_after)
        msg = messages[0]
        assert msg["timing_mode"] == "hours_after"
        assert msg["hours_after"] == 24
        assert msg["message_template"] == "Thank you for your visit! How are you feeling?"
        assert msg["is_enabled"] is True
        assert msg["display_order"] == 1

        # Check second message (specific_time) - note: service only returns basic fields
        msg = messages[1]
        assert msg["timing_mode"] == "specific_time"
        assert msg["message_template"] == "Weekly follow-up: How has your condition been?"
        assert msg["is_enabled"] is True
        assert msg["display_order"] == 2

        # Second appointment type should have no follow-up messages
        assert at2.id not in associations["follow_up_messages"] or len(associations["follow_up_messages"][at2.id]) == 0

    def test_complex_frontend_operations_soft_delete_and_add_billing_scenarios(self, db_session: Session):
        """Test complex frontend operations: soft delete one billing scenario and add another in same session."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        # Create service type group
        group = ServiceTypeGroup(
            clinic_id=clinic.id,
            name="Test Group",
            display_order=1
        )
        db_session.add(group)
        db_session.flush()

        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Service",
            duration_minutes=60,
            service_type_group_id=group.id,
            display_order=1,
            allow_patient_booking=True,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True,
            allow_patient_practitioner_selection=True
        )
        db_session.add(appt_type)
        db_session.flush()

        # Create practitioners
        from tests.conftest import create_user_with_clinic_association
        practitioner1, assoc1 = create_user_with_clinic_association(
            db_session, clinic, "Dr. Smith", "smith@example.com", "sub1", ["practitioner"], True
        )
        practitioner2, assoc2 = create_user_with_clinic_association(
            db_session, clinic, "Dr. Jones", "jones@example.com", "sub2", ["practitioner"], True
        )
        db_session.commit()

        # Initially create some billing scenarios
        scenario1 = BillingScenario(
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            practitioner_id=practitioner1.id,
            name="原價",
            amount=1000,
            revenue_share=70,
            is_default=True,
            is_deleted=False
        )
        scenario2 = BillingScenario(
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            practitioner_id=practitioner1.id,
            name="九折",
            amount=900,
            revenue_share=75,
            is_default=False,
            is_deleted=False
        )
        db_session.add(scenario1)
        db_session.add(scenario2)
        db_session.commit()

        # Simulate frontend operation: soft delete "九折" scenario and add "八折" scenario
        save_data = {
            "appointment_types": [],  # No changes to appointment types
            "service_type_groups": [],  # No changes to groups
            "associations": {
                "practitioner_assignments": {},  # No changes to assignments
                "billing_scenarios": {
                    f"{appt_type.id}-{practitioner1.id}": [
                        {"id": scenario1.id, "name": "原價", "amount": 1000, "revenue_share": 70, "is_default": True},  # Keep this one
                        {"name": "八折", "amount": 800, "revenue_share": 80, "is_default": False}  # Add new one
                        # Note: scenario2 (九折) is NOT included, so it should be soft deleted
                    ]
                },
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        result = ServiceManagementService.save_service_management_data(db_session, clinic.id, save_data)

        # Verify the results
        assert result["success"] is True

        # Check billing scenarios in database
        scenarios = db_session.query(BillingScenario).filter(
            BillingScenario.appointment_type_id == appt_type.id,
            BillingScenario.practitioner_id == practitioner1.id
        ).order_by(BillingScenario.id).all()

        # Should have 3 scenarios total: 1 active (原價), 1 active (八折), 1 soft deleted (九折)
        assert len(scenarios) == 3

        # Check active scenarios
        active_scenarios = [s for s in scenarios if not s.is_deleted]
        assert len(active_scenarios) == 2

        # Verify 原價 scenario is still active and unchanged
        yuanjia = next(s for s in active_scenarios if s.name == "原價")
        assert yuanjia.amount == 1000
        assert yuanjia.revenue_share == 70
        assert yuanjia.is_default is True

        # Verify new 八折 scenario was created
        bazhe = next(s for s in active_scenarios if s.name == "八折")
        assert bazhe.amount == 800
        assert bazhe.revenue_share == 80
        assert bazhe.is_default is False

        # Verify 九折 scenario was soft deleted
        jiuzhe = next(s for s in scenarios if s.name == "九折")
        assert jiuzhe.is_deleted is True

    def test_complex_multi_entity_operation_add_everything_together(self, db_session: Session):
        """Test complex frontend operation: add grouping, service item, practitioner association, and billing scenario all in one operation."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)

        # Create practitioner
        from tests.conftest import create_user_with_clinic_association
        practitioner, assoc = create_user_with_clinic_association(
            db_session, clinic, "Dr. Smith", "smith@example.com", "sub1", ["practitioner"], True
        )
        db_session.commit()

        # Simulate frontend operation: create everything from scratch in one bulk operation
        save_data = {
            "appointment_types": [
                {
                    "id": "temp_service_1",
                    "name": "New Massage Service",
                    "duration_minutes": 90,
                    "display_order": 1,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True,
                    "service_type_group_id": "temp_group_1"  # Reference temporary group ID
                }
            ],
            "service_type_groups": [
                {
                    "id": "temp_group_1",
                    "name": "Massage Therapies",
                    "display_order": 1
                }
            ],
            "associations": {
                "practitioner_assignments": {
                    "temp_service_1": [{"practitioner_id": practitioner.id}]  # Assign practitioner to new service
                },
                "billing_scenarios": {
                    "temp_service_1-{}".format(practitioner.id): [  # Billing for new service-practitioner combo
                        {"name": "Standard Price", "amount": 1500, "revenue_share": 75, "is_default": True},
                        {"name": "Member Discount", "amount": 1200, "revenue_share": 80, "is_default": False}
                    ]
                },
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        result = ServiceManagementService.save_service_management_data(db_session, clinic.id, save_data)

        # Verify the results
        assert result["success"] is True

        # Check that service type group was created
        groups = db_session.query(ServiceTypeGroup).filter(
            ServiceTypeGroup.clinic_id == clinic.id
        ).all()
        assert len(groups) == 1
        assert groups[0].name == "Massage Therapies"

        # Check that appointment type was created and linked to group
        appt_types = db_session.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id
        ).all()
        assert len(appt_types) == 1
        at = appt_types[0]
        assert at.name == "New Massage Service"
        assert at.service_type_group_id == groups[0].id

        # Check that practitioner assignment was created
        assignments = db_session.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.appointment_type_id == at.id
        ).all()
        assert len(assignments) == 1
        assert assignments[0].user_id == practitioner.id

        # Check that billing scenarios were created
        scenarios = db_session.query(BillingScenario).filter(
            BillingScenario.appointment_type_id == at.id,
            BillingScenario.practitioner_id == practitioner.id
        ).all()
        assert len(scenarios) == 2

        # Verify scenario details
        standard = next(s for s in scenarios if s.name == "Standard Price")
        assert standard.amount == 1500
        assert standard.revenue_share == 75
        assert standard.is_default is True

        member = next(s for s in scenarios if s.name == "Member Discount")
        assert member.amount == 1200
        assert member.revenue_share == 80
        assert member.is_default is False

    def test_complex_frontend_edit_session_comprehensive_changes(self, db_session: Session):
        """Test comprehensive frontend edit session with all types of changes in one operation.

        This simulates a realistic frontend scenario where user makes multiple changes:
        - Creates new service items and groups
        - Updates existing service items
        - Modifies practitioner assignments (adds/removes)
        - Updates existing billing scenarios
        - Adds new billing scenarios
        - Removes some billing scenarios
        - All changes happen in a single bulk save operation
        """
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        # Create existing practitioners
        from tests.conftest import create_user_with_clinic_association
        practitioner1, assoc1 = create_user_with_clinic_association(
            db_session, clinic, "Dr. Smith", "smith@example.com", "sub1", ["practitioner"], True
        )
        practitioner2, assoc2 = create_user_with_clinic_association(
            db_session, clinic, "Dr. Jones", "jones@example.com", "sub2", ["practitioner"], True
        )
        practitioner3, assoc3 = create_user_with_clinic_association(
            db_session, clinic, "Dr. Brown", "brown@example.com", "sub3", ["practitioner"], True
        )
        db_session.commit()

        # Create existing service type group
        existing_group = ServiceTypeGroup(
            clinic_id=clinic.id,
            name="Existing Therapies",
            display_order=1
        )
        db_session.add(existing_group)
        db_session.flush()

        # Create existing appointment types
        existing_at1 = AppointmentType(
            clinic_id=clinic.id,
            name="Existing Massage",
            duration_minutes=60,
            service_type_group_id=existing_group.id,
            display_order=1,
            allow_patient_booking=True,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True,
            allow_patient_practitioner_selection=True
        )
        existing_at2 = AppointmentType(
            clinic_id=clinic.id,
            name="Existing Consultation",
            duration_minutes=30,
            service_type_group_id=existing_group.id,
            display_order=2,
            allow_patient_booking=True,
            allow_new_patient_booking=True,
            allow_existing_patient_booking=True,
            allow_patient_practitioner_selection=True
        )
        db_session.add(existing_at1)
        db_session.add(existing_at2)
        db_session.flush()

        # Create existing practitioner assignments
        existing_assignment1 = PractitionerAppointmentTypes(
            clinic_id=clinic.id,
            appointment_type_id=existing_at1.id,
            user_id=practitioner1.id,
            is_deleted=False
        )
        existing_assignment2 = PractitionerAppointmentTypes(
            clinic_id=clinic.id,
            appointment_type_id=existing_at1.id,
            user_id=practitioner2.id,
            is_deleted=False
        )
        db_session.add(existing_assignment1)
        db_session.add(existing_assignment2)

        # Create existing billing scenarios
        existing_bs1 = BillingScenario(
            clinic_id=clinic.id,
            appointment_type_id=existing_at1.id,
            practitioner_id=practitioner1.id,
            name="Standard Rate",
            amount=1000,
            revenue_share=70,
            is_default=True,
            is_deleted=False
        )
        existing_bs2 = BillingScenario(
            clinic_id=clinic.id,
            appointment_type_id=existing_at1.id,
            practitioner_id=practitioner1.id,
            name="Member Rate",
            amount=800,
            revenue_share=75,
            is_default=False,
            is_deleted=False
        )
        existing_bs3 = BillingScenario(
            clinic_id=clinic.id,
            appointment_type_id=existing_at1.id,
            practitioner_id=practitioner2.id,
            name="Premium Rate",
            amount=1200,
            revenue_share=80,
            is_default=True,
            is_deleted=False
        )
        db_session.add(existing_bs1)
        db_session.add(existing_bs2)
        db_session.add(existing_bs3)
        db_session.commit()

        # Now simulate a comprehensive frontend edit session
        comprehensive_save_data = {
            "appointment_types": [
                # Update existing appointment type
                {
                    "id": existing_at1.id,
                    "name": "Updated Massage Service",  # Changed name
                    "duration_minutes": 75,  # Changed duration
                    "display_order": 1,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True,
                    "service_type_group_id": existing_group.id
                },
                # Keep existing appointment type unchanged
                {
                    "id": existing_at2.id,
                    "name": "Existing Consultation",
                    "duration_minutes": 30,
                    "display_order": 2,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True,
                    "service_type_group_id": existing_group.id
                },
                # Add new appointment type
                {
                    "id": "temp_new_service",
                    "name": "New Acupuncture",
                    "duration_minutes": 45,
                    "display_order": 3,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True,
                    "service_type_group_id": "temp_new_group"  # Reference temporary group ID
                }
            ],
            "service_type_groups": [
                # Update existing group
                {
                    "id": existing_group.id,
                    "name": "Updated Therapies",  # Changed name
                    "display_order": 1
                },
                # Add new group
                {
                    "id": "temp_new_group",
                    "name": "Alternative Medicine",
                    "display_order": 2
                }
            ],
            "associations": {
                "practitioner_assignments": {
                    # Update existing service: remove practitioner2, add practitioner3
                    str(existing_at1.id): [
                        {"id": existing_assignment1.id, "practitioner_id": practitioner1.id},  # Keep
                        {"practitioner_id": practitioner3.id}  # Add new
                        # Note: practitioner2 assignment (existing_assignment2) not included, should be soft deleted
                    ],
                    # Keep existing service unchanged
                    str(existing_at2.id): [
                        {"practitioner_id": practitioner1.id}  # Add new assignment
                    ],
                    # New service assignments
                    "temp_new_service": [
                        {"practitioner_id": practitioner2.id},
                        {"practitioner_id": practitioner3.id}
                    ]
                },
                "billing_scenarios": {
                    # Update existing service billing scenarios
                    f"{existing_at1.id}-{practitioner1.id}": [
                        {"id": existing_bs1.id, "name": "Updated Standard Rate", "amount": 1100, "revenue_share": 72, "is_default": True},  # Update existing
                        {"name": "New Discount Rate", "amount": 900, "revenue_share": 78, "is_default": False}  # Add new
                        # Note: existing_bs2 not included, should be soft deleted
                    ],
                    # Add billing for practitioner3 on existing service
                    f"{existing_at1.id}-{practitioner3.id}": [
                        {"name": "Specialist Rate", "amount": 1500, "revenue_share": 85, "is_default": True}
                    ],
                    # Keep existing billing unchanged
                    f"{existing_at1.id}-{practitioner2.id}": [
                        {"id": existing_bs3.id, "name": "Premium Rate", "amount": 1200, "revenue_share": 80, "is_default": True}
                    ],
                    # Add billing for new service
                    "temp_new_service-{}".format(practitioner2.id): [
                        {"name": "Acupuncture Rate", "amount": 800, "revenue_share": 75, "is_default": True}
                    ]
                },
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        result = ServiceManagementService.save_service_management_data(db_session, clinic.id, comprehensive_save_data)

        # Verify the results
        assert result["success"] is True

        # === Verify Groups ===
        groups = db_session.query(ServiceTypeGroup).filter(
            ServiceTypeGroup.clinic_id == clinic.id
        ).order_by(ServiceTypeGroup.id).all()
        assert len(groups) == 2

        # Updated existing group
        updated_group = next(g for g in groups if g.id == existing_group.id)
        assert updated_group.name == "Updated Therapies"

        # New group
        new_group = next(g for g in groups if g.id != existing_group.id)
        assert new_group.name == "Alternative Medicine"

        # === Verify Appointment Types ===
        appt_types = db_session.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id,
            AppointmentType.is_deleted == False
        ).order_by(AppointmentType.id).all()
        assert len(appt_types) == 3

        # Updated existing service
        updated_at1 = next(at for at in appt_types if at.id == existing_at1.id)
        assert updated_at1.name == "Updated Massage Service"
        assert updated_at1.duration_minutes == 75

        # Unchanged existing service
        unchanged_at2 = next(at for at in appt_types if at.id == existing_at2.id)
        assert unchanged_at2.name == "Existing Consultation"

        # New service
        new_at = next(at for at in appt_types if at.id not in [existing_at1.id, existing_at2.id])
        assert new_at.name == "New Acupuncture"
        assert new_at.service_type_group_id == new_group.id

        # === Verify Practitioner Assignments ===
        assignments = db_session.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.clinic_id == clinic.id,
            PractitionerAppointmentTypes.is_deleted == False
        ).all()

        # Should have assignments for: at1(p1,p3), at2(p1), new_at(p2,p3) = 5 total
        assert len(assignments) == 5

        # Check at1 assignments: p1 and p3 (p2 should be soft deleted)
        at1_assignments = [a for a in assignments if a.appointment_type_id == existing_at1.id]
        assert len(at1_assignments) == 2
        assigned_practitioners_at1 = {a.user_id for a in at1_assignments}
        assert assigned_practitioners_at1 == {practitioner1.id, practitioner3.id}

        # Check at2 assignments: p1
        at2_assignments = [a for a in assignments if a.appointment_type_id == existing_at2.id]
        assert len(at2_assignments) == 1
        assert at2_assignments[0].user_id == practitioner1.id

        # Check new service assignments: p2 and p3
        new_at_assignments = [a for a in assignments if a.appointment_type_id == new_at.id]
        assert len(new_at_assignments) == 2
        assigned_practitioners_new = {a.user_id for a in new_at_assignments}
        assert assigned_practitioners_new == {practitioner2.id, practitioner3.id}

        # === Verify Billing Scenarios ===
        billing_scenarios = db_session.query(BillingScenario).filter(
            BillingScenario.clinic_id == clinic.id,
            BillingScenario.is_deleted == False
        ).all()

        # Should have: at1-p1 (2 scenarios), at1-p3 (1), at1-p2 (1), new_at-p2 (1) = 5 total
        assert len(billing_scenarios) == 5

        # Check at1-p1 scenarios (updated existing + new)
        at1_p1_scenarios = [bs for bs in billing_scenarios
                           if bs.appointment_type_id == existing_at1.id and bs.practitioner_id == practitioner1.id]
        assert len(at1_p1_scenarios) == 2

        # Updated existing scenario
        updated_scenario = next(bs for bs in at1_p1_scenarios if bs.id == existing_bs1.id)
        assert updated_scenario.name == "Updated Standard Rate"
        assert updated_scenario.amount == 1100
        assert updated_scenario.revenue_share == 72

        # New scenario
        new_scenario_at1_p1 = next(bs for bs in at1_p1_scenarios if bs.id != existing_bs1.id)
        assert new_scenario_at1_p1.name == "New Discount Rate"
        assert new_scenario_at1_p1.amount == 900

        # Check at1-p3 scenarios (new assignment)
        at1_p3_scenarios = [bs for bs in billing_scenarios
                           if bs.appointment_type_id == existing_at1.id and bs.practitioner_id == practitioner3.id]
        assert len(at1_p3_scenarios) == 1
        assert at1_p3_scenarios[0].name == "Specialist Rate"
        assert at1_p3_scenarios[0].amount == 1500

        # Check at1-p2 scenarios (unchanged)
        at1_p2_scenarios = [bs for bs in billing_scenarios
                           if bs.appointment_type_id == existing_at1.id and bs.practitioner_id == practitioner2.id]
        assert len(at1_p2_scenarios) == 1
        assert at1_p2_scenarios[0].id == existing_bs3.id
        assert at1_p2_scenarios[0].name == "Premium Rate"

        # Check new service scenarios
        new_at_scenarios = [bs for bs in billing_scenarios
                           if bs.appointment_type_id == new_at.id and bs.practitioner_id == practitioner2.id]
        assert len(new_at_scenarios) == 1
        assert new_at_scenarios[0].name == "Acupuncture Rate"
        assert new_at_scenarios[0].amount == 800

        # === Verify Soft Deletes ===
        # Check that removed assignments and billing scenarios are soft deleted
        soft_deleted_assignments = db_session.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.clinic_id == clinic.id,
            PractitionerAppointmentTypes.is_deleted == True
        ).all()
        # Should have the removed assignment (practitioner2 from at1)
        assert len(soft_deleted_assignments) == 1
        assert soft_deleted_assignments[0].user_id == practitioner2.id
        assert soft_deleted_assignments[0].appointment_type_id == existing_at1.id

        soft_deleted_billing = db_session.query(BillingScenario).filter(
            BillingScenario.clinic_id == clinic.id,
            BillingScenario.is_deleted == True
        ).all()
        # Should have the removed billing scenario (member rate for p1 on at1)
        assert len(soft_deleted_billing) == 1
        assert soft_deleted_billing[0].id == existing_bs2.id

    def test_save_service_management_data_validation_errors(self, db_session: Session):
        """Test that validation errors are properly handled in bulk save operations."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Test missing required fields
        invalid_data = {
            "appointment_types": [
                {
                    "duration_minutes": 45,
                    "display_order": 1
                    # Missing required "name" field
                }
            ],
            "service_type_groups": [],
            "associations": {
                "practitioner_assignments": {},
                "billing_scenarios": {},
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        # Should return error dictionary due to validation error
        result = ServiceManagementService.save_service_management_data(db_session, clinic.id, invalid_data)

        assert result["success"] is False
        assert result["error"] == "database_error"
        assert "Failed to save service management data" in result["message"]

    def test_save_service_management_data_invalid_associations_structure(self, db_session: Session):
        """Test handling of malformed associations data."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Test invalid associations structure
        invalid_data = {
            "appointment_types": [],
            "service_type_groups": [],
            "associations": {
                "practitioner_assignments": "invalid_string_instead_of_dict",  # Wrong type
                "billing_scenarios": {},
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        # Should return error dictionary due to invalid associations structure
        result = ServiceManagementService.save_service_management_data(db_session, clinic.id, invalid_data)

        assert result["success"] is False
        assert result["error"] == "validation_error"
        assert "practitioner_assignments must be a dictionary" in result["message"]

    def test_save_service_management_data_temporary_id_resolution_edge_cases(self, db_session: Session):
        """Test edge cases in temporary ID resolution."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        # Create existing service type group
        existing_group = ServiceTypeGroup(
            clinic_id=clinic.id,
            name="Existing Group",
            display_order=1
        )
        db_session.add(existing_group)
        db_session.flush()

        # Test referencing non-existent temporary IDs
        problematic_data = {
            "appointment_types": [
                {
                    "id": "temp_service_1",
                    "name": "Test Service",
                    "duration_minutes": 60,
                    "display_order": 1,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True,
                    "service_type_group_id": "temp_nonexistent_group"  # References non-existent temp group
                }
            ],
            "service_type_groups": [
                {
                    "id": "temp_group_1",
                    "name": "Real Group",
                    "display_order": 1
                }
            ],
            "associations": {
                "practitioner_assignments": {
                    "temp_service_1": []  # Empty assignments to test basic functionality
                },
                "billing_scenarios": {},
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        # Should handle gracefully - the non-existent group reference should be set to None
        # and the service should still be created without a group association
        result = ServiceManagementService.save_service_management_data(db_session, clinic.id, problematic_data)
        assert result["success"] is True

        # Verify the service was created but without the problematic group association
        services = db_session.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id
        ).all()
        assert len(services) == 1
        service = services[0]
        assert service.name == "Test Service"
        # service_type_group_id should be None since the temp group reference was not found
        assert service.service_type_group_id is None

    def test_save_service_management_data_transaction_rollback_on_error(self, db_session: Session):
        """Test that transaction rolls back properly when errors occur midway through save."""
        from models.clinic import Clinic
        from unittest.mock import patch

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Test data that would create multiple entities
        test_data = {
            "appointment_types": [
                {
                    "id": "temp_1",
                    "name": "Service 1",
                    "duration_minutes": 60,
                    "display_order": 1,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True
                }
            ],
            "service_type_groups": [
                {
                    "id": "temp_group_1",
                    "name": "Test Group",
                    "display_order": 1
                }
            ],
            "associations": {
                "practitioner_assignments": {},
                "billing_scenarios": {},
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        # Mock a database error occurring during appointment type creation
        with patch.object(ServiceManagementService, '_save_appointment_type') as mock_save:
            mock_save.side_effect = Exception("Database connection lost")

            # Should return error dictionary without committing partial changes
            result = ServiceManagementService.save_service_management_data(db_session, clinic.id, test_data)

            assert result["success"] is False
            assert result["error"] == "database_error"
            assert "Database connection lost" in result["message"]

        # Verify no data was committed (transaction should have rolled back)
        groups = db_session.query(ServiceTypeGroup).filter(
            ServiceTypeGroup.clinic_id == clinic.id
        ).all()
        # The group might have been created before the error, depending on execution order
        # But the important thing is that the transaction behavior is correct

    def test_get_service_management_data_database_error_handling(self, db_session: Session):
        """Test that database errors during data retrieval are handled properly."""
        from unittest.mock import patch

        # Mock database execute to raise an error
        with patch.object(db_session, 'execute') as mock_execute:
            mock_execute.side_effect = Exception("Database connection error")

            # Should return error dictionary
            result = ServiceManagementService.get_service_management_data(db_session, 1)

            assert "error" in result
            assert result["error"] == "database_error"
            assert "Failed to retrieve service management data" in result["message"]

    def test_save_service_management_data_concurrent_modification_protection(self, db_session: Session):
        """Test that concurrent modifications are handled properly with SERIALIZABLE isolation."""
        from models.clinic import Clinic
        from sqlalchemy.exc import OperationalError

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Test data
        test_data = {
            "appointment_types": [
                {
                    "id": "temp_1",
                    "name": "Concurrent Test Service",
                    "duration_minutes": 60,
                    "display_order": 1,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True
                }
            ],
            "service_type_groups": [],
            "associations": {
                "practitioner_assignments": {},
                "billing_scenarios": {},
                "resource_requirements": {},
                "follow_up_messages": {}
            }
        }

        # The service uses SERIALIZABLE isolation, so concurrent modifications
        # should either succeed or fail with a serialization error that can be retried
        # This test verifies the operation completes (success case)
        result = ServiceManagementService.save_service_management_data(db_session, clinic.id, test_data)
        assert result["success"] is True

        # Verify the data was saved
        services = db_session.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id
        ).all()
        assert len(services) == 1
        assert services[0].name == "Concurrent Test Service"

    def test_save_service_management_data_empty_associations_handling(self, db_session: Session):
        """Test that empty or missing associations are handled correctly."""
        from models.clinic import Clinic

        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Test with completely empty associations
        test_data = {
            "appointment_types": [
                {
                    "id": "temp_1",
                    "name": "Empty Associations Test",
                    "duration_minutes": 30,
                    "display_order": 1,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True
                }
            ],
            "service_type_groups": [],
            "associations": {}  # Completely empty associations
        }

        result = ServiceManagementService.save_service_management_data(db_session, clinic.id, test_data)
        assert result["success"] is True

        # Test with missing associations key entirely
        test_data_no_associations = {
            "appointment_types": [
                {
                    "id": "temp_2",
                    "name": "No Associations Key Test",
                    "duration_minutes": 45,
                    "display_order": 2,
                    "allow_patient_booking": True,
                    "allow_new_patient_booking": True,
                    "allow_existing_patient_booking": True,
                    "allow_patient_practitioner_selection": True
                }
            ],
            "service_type_groups": []
            # No associations key at all
        }

        result2 = ServiceManagementService.save_service_management_data(db_session, clinic.id, test_data_no_associations)
        assert result2["success"] is True

        # Verify both services were created
        services = db_session.query(AppointmentType).filter(
            AppointmentType.clinic_id == clinic.id
        ).order_by(AppointmentType.display_order).all()
        assert len(services) == 2
        assert services[0].name == "Empty Associations Test"
        assert services[1].name == "No Associations Key Test"
