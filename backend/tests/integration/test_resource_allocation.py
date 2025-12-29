"""
Integration tests for resource allocation in appointments.

Tests the full flow of resource allocation when creating and updating appointments.
"""

import pytest
from datetime import datetime, time, date
from sqlalchemy.orm import Session

from models.clinic import Clinic
from models.appointment_type import AppointmentType
from models.resource_type import ResourceType
from models.resource import Resource
from models.appointment_resource_requirement import AppointmentResourceRequirement
from models.appointment_resource_allocation import AppointmentResourceAllocation
from models.calendar_event import CalendarEvent
from models.appointment import Appointment
from models.patient import Patient
from models.user import User
from models.user_clinic_association import UserClinicAssociation
from models.practitioner_appointment_types import PractitionerAppointmentTypes
from services.appointment_service import AppointmentService
from services.availability_service import AvailabilityService


class TestResourceAllocationIntegration:
    """Integration tests for resource allocation."""

    def test_create_appointment_with_resource_allocation(self, db_session: Session):
        """Test that resources are automatically allocated when creating an appointment."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient"
        )
        db_session.add(patient)
        db_session.commit()

        # Create practitioner
        user = User(
            email="practitioner@example.com",
            google_subject_id="practitioner_subject"
        )
        db_session.add(user)
        db_session.commit()

        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            roles=['practitioner'],
            full_name="Test Practitioner",
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Link practitioner to appointment type
        practitioner_appointment_type = PractitionerAppointmentTypes(
            user_id=user.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(practitioner_appointment_type)
        db_session.commit()

        # Create resource type and resources
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(resource_type)
        db_session.commit()

        resource1 = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室1"
        )
        resource2 = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室2"
        )
        db_session.add_all([resource1, resource2])
        db_session.commit()

        # Create requirement (needs 1 room)
        requirement = AppointmentResourceRequirement(
            appointment_type_id=appointment_type.id,
            resource_type_id=resource_type.id,
            quantity=1
        )
        db_session.add(requirement)
        db_session.commit()

        # Create appointment
        start_time = datetime(2025, 1, 28, 10, 0)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=user.id,
            selected_resource_ids=None  # Auto-allocate
        )

        # Verify appointment was created
        assert result['appointment_id'] is not None

        # Verify resource was allocated
        calendar_event = db_session.query(CalendarEvent).filter(
            CalendarEvent.id == result['calendar_event_id']
        ).first()
        assert calendar_event is not None

        allocations = db_session.query(AppointmentResourceAllocation).filter(
            AppointmentResourceAllocation.appointment_id == calendar_event.id
        ).all()

        assert len(allocations) == 1
        assert allocations[0].resource_id in [resource1.id, resource2.id]

    def test_create_appointment_with_selected_resources(self, db_session: Session):
        """Test that selected resources are used when provided."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient"
        )
        db_session.add(patient)
        db_session.commit()

        # Create practitioner
        user = User(
            email="practitioner@example.com",
            google_subject_id="practitioner_subject"
        )
        db_session.add(user)
        db_session.commit()

        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            roles=['practitioner'],
            full_name="Test Practitioner",
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Link practitioner to appointment type
        practitioner_appointment_type = PractitionerAppointmentTypes(
            user_id=user.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(practitioner_appointment_type)
        db_session.commit()

        # Create resource type and resources
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(resource_type)
        db_session.commit()

        resource1 = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室1"
        )
        resource2 = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室2"
        )
        db_session.add_all([resource1, resource2])
        db_session.commit()

        # Create requirement (needs 1 room)
        requirement = AppointmentResourceRequirement(
            appointment_type_id=appointment_type.id,
            resource_type_id=resource_type.id,
            quantity=1
        )
        db_session.add(requirement)
        db_session.commit()

        # Create appointment with selected resource
        start_time = datetime(2025, 1, 28, 10, 0)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=user.id,
            selected_resource_ids=[resource1.id]  # Select specific resource
        )

        # Verify resource was allocated
        calendar_event = db_session.query(CalendarEvent).filter(
            CalendarEvent.id == result['calendar_event_id']
        ).first()

        allocations = db_session.query(AppointmentResourceAllocation).filter(
            AppointmentResourceAllocation.appointment_id == calendar_event.id
        ).all()

        assert len(allocations) == 1
        assert allocations[0].resource_id == resource1.id

    def test_update_appointment_reallocates_resources(self, db_session: Session):
        """Test that resources are re-allocated when appointment time changes."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient"
        )
        db_session.add(patient)
        db_session.commit()

        # Create practitioner
        user = User(
            email="practitioner@example.com",
            google_subject_id="practitioner_subject"
        )
        db_session.add(user)
        db_session.commit()

        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            roles=['practitioner'],
            full_name="Test Practitioner",
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Link practitioner to appointment type
        practitioner_appointment_type = PractitionerAppointmentTypes(
            user_id=user.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(practitioner_appointment_type)
        db_session.commit()

        # Create resource type and resources
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(resource_type)
        db_session.commit()

        resource1 = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室1"
        )
        resource2 = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室2"
        )
        db_session.add_all([resource1, resource2])
        db_session.commit()

        # Create requirement (needs 1 room)
        requirement = AppointmentResourceRequirement(
            appointment_type_id=appointment_type.id,
            resource_type_id=resource_type.id,
            quantity=1
        )
        db_session.add(requirement)
        db_session.commit()

        # Create appointment at 10:00
        start_time = datetime(2025, 1, 28, 10, 0)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=user.id
        )

        calendar_event = db_session.query(CalendarEvent).filter(
            CalendarEvent.id == result['calendar_event_id']
        ).first()

        # Verify initial allocation
        initial_allocations = db_session.query(AppointmentResourceAllocation).filter(
            AppointmentResourceAllocation.appointment_id == calendar_event.id
        ).all()
        assert len(initial_allocations) == 1
        initial_resource_id = initial_allocations[0].resource_id

        # Update appointment time to 14:00
        new_start_time = datetime(2025, 1, 28, 14, 0)
        AppointmentService.update_appointment(
            db=db_session,
            appointment_id=calendar_event.id,
            new_practitioner_id=None,
            new_start_time=new_start_time,
            apply_booking_constraints=False,
            allow_auto_assignment=False
        )

        # Verify resources were re-allocated (old allocation deleted, new one created)
        allocations = db_session.query(AppointmentResourceAllocation).filter(
            AppointmentResourceAllocation.appointment_id == calendar_event.id
        ).all()
        assert len(allocations) == 1
        # Resource might be the same or different (depends on availability)

    def test_resource_availability_affects_slot_calculation(self, db_session: Session):
        """Test that resource availability affects available slot calculation."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create practitioner
        user = User(
            email="practitioner@example.com",
            google_subject_id="practitioner_subject"
        )
        db_session.add(user)
        db_session.commit()

        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            roles=['practitioner'],
            full_name="Test Practitioner",
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Link practitioner to appointment type
        practitioner_appointment_type = PractitionerAppointmentTypes(
            user_id=user.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(practitioner_appointment_type)
        db_session.commit()

        # Create resource type and only 1 resource
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(resource_type)
        db_session.commit()

        resource1 = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="治療室1"
        )
        db_session.add(resource1)
        db_session.commit()

        # Create requirement (needs 1 room)
        requirement = AppointmentResourceRequirement(
            appointment_type_id=appointment_type.id,
            resource_type_id=resource_type.id,
            quantity=1
        )
        db_session.add(requirement)
        db_session.commit()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment at 10:00 that uses the only resource
        # Use a future date
        from datetime import timedelta
        future_date = datetime.now() + timedelta(days=7)
        start_time = datetime.combine(future_date.date(), time(10, 0))
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=user.id
        )

        # Check available slots for same time - should show no slots available
        # (resource is already allocated)
        date_str = future_date.strftime("%Y-%m-%d")
        slots = AvailabilityService.get_available_slots_for_practitioner(
            db=db_session,
            practitioner_id=user.id,
            date=date_str,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            apply_booking_restrictions=False
        )

        # Should have no slots at 10:00 (resource is allocated)
        slot_times = [slot['start_time'] for slot in slots]
        assert '10:00' not in slot_times

    def test_allocate_additional_resources_not_in_requirements(self, db_session: Session):
        """Test that resources that don't match AppointmentResourceRequirement are still allocated."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient"
        )
        db_session.add(patient)
        db_session.commit()

        # Create practitioner
        user = User(
            email="practitioner@example.com",
            google_subject_id="practitioner_subject"
        )
        db_session.add(user)
        db_session.commit()

        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            roles=['practitioner'],
            full_name="Test Practitioner",
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Pilates",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Link practitioner to appointment type
        practitioner_appointment_type = PractitionerAppointmentTypes(
            user_id=user.id,
            clinic_id=clinic.id,
            appointment_type_id=appointment_type.id
        )
        db_session.add(practitioner_appointment_type)
        db_session.commit()

        # Create required resource type (治療室) and resource
        required_resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(required_resource_type)
        db_session.commit()

        required_resource = Resource(
            resource_type_id=required_resource_type.id,
            clinic_id=clinic.id,
            name="治療室1"
        )
        db_session.add(required_resource)
        db_session.commit()

        # Create requirement (needs 1 治療室)
        requirement = AppointmentResourceRequirement(
            appointment_type_id=appointment_type.id,
            resource_type_id=required_resource_type.id,
            quantity=1
        )
        db_session.add(requirement)
        db_session.commit()

        # Create additional resource type (床) that is NOT in requirements
        additional_resource_type = ResourceType(
            clinic_id=clinic.id,
            name="床"
        )
        db_session.add(additional_resource_type)
        db_session.commit()

        additional_resource1 = Resource(
            resource_type_id=additional_resource_type.id,
            clinic_id=clinic.id,
            name="床A"
        )
        additional_resource2 = Resource(
            resource_type_id=additional_resource_type.id,
            clinic_id=clinic.id,
            name="床B"
        )
        db_session.add_all([additional_resource1, additional_resource2])
        db_session.commit()

        # Create appointment with both required and additional resources
        start_time = datetime(2025, 1, 28, 10, 0)
        result = AppointmentService.create_appointment(
            db=db_session,
            clinic_id=clinic.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            practitioner_id=user.id,
            selected_resource_ids=[
                required_resource.id,      # Required resource (matches requirement)
                additional_resource1.id,  # Additional resource (doesn't match requirement)
                additional_resource2.id   # Another additional resource
            ]
        )

        # Verify appointment was created
        assert result['appointment_id'] is not None

        # Verify all resources were allocated (required + additional)
        calendar_event = db_session.query(CalendarEvent).filter(
            CalendarEvent.id == result['calendar_event_id']
        ).first()
        assert calendar_event is not None

        allocations = db_session.query(AppointmentResourceAllocation).filter(
            AppointmentResourceAllocation.appointment_id == calendar_event.id
        ).all()

        # Should have 3 allocations: 1 required + 2 additional
        assert len(allocations) == 3
        
        allocated_resource_ids = {alloc.resource_id for alloc in allocations}
        
        # Verify required resource is allocated
        assert required_resource.id in allocated_resource_ids
        
        # Verify additional resources are allocated (this is the key test - they don't match requirements)
        assert additional_resource1.id in allocated_resource_ids
        assert additional_resource2.id in allocated_resource_ids

