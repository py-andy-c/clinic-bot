"""
Unit tests for ResourceService.

Tests for resource management and availability checking.
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
from services.resource_service import ResourceService


class TestResourceService:
    """Test ResourceService methods."""

    def test_check_resource_availability_no_requirements(self, db_session: Session):
        """Test resource availability check when appointment type has no requirements."""
        # Create clinic and appointment type
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Check availability (no requirements)
        start_time = datetime(2025, 1, 28, 10, 0)
        end_time = datetime(2025, 1, 28, 10, 30)
        
        result = ResourceService.check_resource_availability(
            db=db_session,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            start_time=start_time,
            end_time=end_time
        )

        assert result['is_available'] is True
        assert result['selection_insufficient_warnings'] == []
        assert result['resource_conflict_warnings'] == []

    def test_check_resource_availability_sufficient_resources(self, db_session: Session):
        """Test resource availability check when sufficient resources are available."""
        # Create clinic and appointment type
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
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

        # Check availability
        start_time = datetime(2025, 1, 28, 10, 0)
        end_time = datetime(2025, 1, 28, 11, 0)
        
        result = ResourceService.check_resource_availability(
            db=db_session,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            start_time=start_time,
            end_time=end_time
        )

        assert result['is_available'] is True
        assert result['selection_insufficient_warnings'] == []
        assert result['resource_conflict_warnings'] == []

    def test_check_resource_availability_insufficient_resources(self, db_session: Session):
        """Test resource availability check when insufficient resources are available."""
        # Create clinic and appointment type
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
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
        db_session.add(resource1)
        db_session.commit()

        # Create requirement (needs 2 rooms, but only 1 exists)
        requirement = AppointmentResourceRequirement(
            appointment_type_id=appointment_type.id,
            resource_type_id=resource_type.id,
            quantity=2
        )
        db_session.add(requirement)
        db_session.commit()

        # Check availability
        start_time = datetime(2025, 1, 28, 10, 0)
        end_time = datetime(2025, 1, 28, 11, 0)
        
        result = ResourceService.check_resource_availability(
            db=db_session,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            start_time=start_time,
            end_time=end_time
        )

        assert result['is_available'] is False
        assert len(result['selection_insufficient_warnings']) == 1
        assert result['selection_insufficient_warnings'][0]['required_quantity'] == 2
        assert result['selection_insufficient_warnings'][0]['selected_quantity'] == 1

    def test_check_resource_availability_with_existing_appointment(self, db_session: Session):
        """Test resource availability check when resources are already allocated."""
        # Create clinic and appointment type
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Create patient and practitioner
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient"
        )
        db_session.add(patient)
        db_session.commit()

        user = User(
            email="test@example.com",
            google_subject_id="test_subject"
        )
        db_session.add(user)
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

        # Create existing appointment that uses resource1
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            is_active=True,
            roles=["practitioner"],
            full_name="Test Practitioner"
        )
        db_session.add(association)
        db_session.commit()

        calendar_event = CalendarEvent(
            user_id=user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=date(2025, 1, 28),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()

        allocation = AppointmentResourceAllocation(
            appointment_id=calendar_event.id,
            resource_id=resource1.id
        )
        db_session.add(allocation)
        db_session.commit()

        # Check availability for overlapping time slot
        start_time = datetime(2025, 1, 28, 10, 0)
        end_time = datetime(2025, 1, 28, 11, 0)
        
        result = ResourceService.check_resource_availability(
            db=db_session,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            start_time=start_time,
            end_time=end_time
        )

        # Should still be available (resource2 is free)
        assert result['is_available'] is True
        assert result['selection_insufficient_warnings'] == []
        assert result['resource_conflict_warnings'] == []

        # Check availability when both resources are booked
        allocation2 = AppointmentResourceAllocation(
            appointment_id=calendar_event.id,
            resource_id=resource2.id
        )
        db_session.add(allocation2)
        db_session.commit()

        result = ResourceService.check_resource_availability(
            db=db_session,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            start_time=start_time,
            end_time=end_time
        )

        assert result['is_available'] is False
        assert len(result['selection_insufficient_warnings']) == 1

    def test_allocate_resources_auto_allocate(self, db_session: Session):
        """Test that automatic resource allocation happens for LIFF bookings (None selection)."""
        # Create clinic and appointment type
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
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

        # Create calendar event
        user = User(
            email="test@example.com",
            google_subject_id="test_subject"
        )
        db_session.add(user)
        db_session.commit()

        calendar_event = CalendarEvent(
            user_id=user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=date(2025, 1, 28),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        # Allocate resources with None (should NOW auto-allocate)
        start_time = datetime(2025, 1, 28, 10, 0)
        end_time = datetime(2025, 1, 28, 11, 0)
        
        allocated_ids = ResourceService.allocate_resources(
            db=db_session,
            appointment_id=calendar_event.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            end_time=end_time,
            clinic_id=clinic.id,
            selected_resource_ids=None
        )

        assert len(allocated_ids) == 1
        assert allocated_ids[0] == resource1.id

        # Verify allocation exists
        allocation = db_session.query(AppointmentResourceAllocation).filter(
            AppointmentResourceAllocation.appointment_id == calendar_event.id
        ).first()
        assert allocation is not None
        assert allocation.resource_id == resource1.id

    def test_allocate_resources_auto_allocate_failure(self, db_session: Session):
        """Test that automatic resource allocation fails if resources are unavailable."""
        # Create clinic and appointment type
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Create resource type and resources
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="治療室"
        )
        db_session.add(resource_type)
        db_session.commit()

        # NO resources created for this type

        # Create requirement (needs 1 room)
        requirement = AppointmentResourceRequirement(
            appointment_type_id=appointment_type.id,
            resource_type_id=resource_type.id,
            quantity=1
        )
        db_session.add(requirement)
        db_session.commit()

        # Create calendar event
        user = User(
            email="test@example.com",
            google_subject_id="test_subject"
        )
        db_session.add(user)
        db_session.commit()

        calendar_event = CalendarEvent(
            user_id=user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=date(2025, 1, 28),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        # Attempt to allocate resources with None (should fail with ValueError)
        start_time = datetime(2025, 1, 28, 10, 0)
        end_time = datetime(2025, 1, 28, 11, 0)
        
        with pytest.raises(ValueError, match="No resources found"):
            ResourceService.allocate_resources(
                db=db_session,
                appointment_id=calendar_event.id,
                appointment_type_id=appointment_type.id,
                start_time=start_time,
                end_time=end_time,
                clinic_id=clinic.id,
                selected_resource_ids=None
            )

    def test_allocate_resources_with_selection(self, db_session: Session):
        """Test resource allocation with selected resource IDs."""
        # Create clinic and appointment type
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
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

        # Create calendar event
        user = User(
            email="test@example.com",
            google_subject_id="test_subject"
        )
        db_session.add(user)
        db_session.commit()

        calendar_event = CalendarEvent(
            user_id=user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=date(2025, 1, 28),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        # Allocate resources with selection
        start_time = datetime(2025, 1, 28, 10, 0)
        end_time = datetime(2025, 1, 28, 11, 0)
        
        allocated_ids = ResourceService.allocate_resources(
            db=db_session,
            appointment_id=calendar_event.id,
            appointment_type_id=appointment_type.id,
            start_time=start_time,
            end_time=end_time,
            clinic_id=clinic.id,
            selected_resource_ids=[resource1.id]
        )

        assert len(allocated_ids) == 1
        assert allocated_ids[0] == resource1.id

        # Verify allocation exists
        allocation = db_session.query(AppointmentResourceAllocation).filter(
            AppointmentResourceAllocation.appointment_id == calendar_event.id,
            AppointmentResourceAllocation.resource_id == resource1.id
        ).first()
        assert allocation is not None



    def test_check_resource_availability_manual_selection_conflict(self, db_session: Session):
        """Test resource availability check for manual selection conflict (even with no requirements)."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create appointment type with NO resource requirements
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Simple Consultation",
            duration_minutes=30
        )
        db_session.add(appointment_type)
        db_session.commit()

        # Create resource type and resource
        resource_type = ResourceType(
            clinic_id=clinic.id,
            name="Meeting Room"
        )
        db_session.add(resource_type)
        db_session.commit()

        resource1 = Resource(
            resource_type_id=resource_type.id,
            clinic_id=clinic.id,
            name="Room A"
        )
        db_session.add(resource1)
        db_session.commit()

        # Create an existing appointment occupying Room A
        user = User(
            email="test@example.com",
            google_subject_id="test_subject"
        )
        db_session.add(user)
        db_session.commit()
        
        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            is_active=True,
            roles=["practitioner"],
            full_name="Dr. Test"
        )
        db_session.add(association)
        db_session.commit()
        
        # Create a patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient"
        )
        db_session.add(patient)
        db_session.commit()

        calendar_event = CalendarEvent(
            user_id=user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=date(2025, 1, 30),
            start_time=time(10, 0),
            end_time=time(10, 30)
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            appointment_type_id=appointment_type.id,
            patient_id=patient.id,  # Assign patient_id
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()

        allocation = AppointmentResourceAllocation(
            appointment_id=calendar_event.id,
            resource_id=resource1.id
        )
        db_session.add(allocation)
        db_session.commit()

        # Now check availability for an overlapping slot with Room A MANUALLY selected
        check_start = datetime(2025, 1, 30, 10, 0)
        check_end = datetime(2025, 1, 30, 10, 30)

        result = ResourceService.check_resource_availability(
            db=db_session,
            appointment_type_id=appointment_type.id,  # Type has NO requirements
            clinic_id=clinic.id,
            start_time=check_start,
            end_time=check_end,
            selected_resource_ids=[resource1.id]  # Manually selected Room A
        )

        assert result['is_available'] is False
        assert len(result['resource_conflict_warnings']) == 1
        conflict = result['resource_conflict_warnings'][0]
        assert conflict['resource_name'] == "Room A"
        assert conflict['conflicting_appointment']['practitioner_name'] == "Dr. Test"

    def test_check_resource_availability_empty_selection_warning(self, db_session: Session):
        """Test that explicit empty selection triggers warning even if resources are available globally."""
        # Create clinic and appointment type
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
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

        # Check availability with EMPTY list (explicit selection of nothing)
        start_time = datetime(2025, 1, 28, 10, 0)
        end_time = datetime(2025, 1, 28, 11, 0)
        
        result = ResourceService.check_resource_availability(
            db=db_session,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            start_time=start_time,
            end_time=end_time,
            selected_resource_ids=[]  # Explicit empty selection (Case A)
        )

        assert result['is_available'] is False
        assert len(result['selection_insufficient_warnings']) == 1
        assert result['selection_insufficient_warnings'][0]['selected_quantity'] == 0
        assert result['selection_insufficient_warnings'][0]['required_quantity'] == 1

    def test_check_resource_availability_none_selection_global_check(self, db_session: Session):
        """Test that None selection uses global capacity check (patient booking flow)."""
        # Create clinic and appointment type
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Physical Therapy",
            duration_minutes=60
        )
        db_session.add(appointment_type)
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

        # Check availability with None (Case B)
        start_time = datetime(2025, 1, 28, 10, 0)
        end_time = datetime(2025, 1, 28, 11, 0)
        
        result = ResourceService.check_resource_availability(
            db=db_session,
            appointment_type_id=appointment_type.id,
            clinic_id=clinic.id,
            start_time=start_time,
            end_time=end_time,
            selected_resource_ids=None  # Implicit selection (Case B)
        )

        # Should be available because resource1 is free globally
        assert result['is_available'] is True
        assert len(result['selection_insufficient_warnings']) == 0
