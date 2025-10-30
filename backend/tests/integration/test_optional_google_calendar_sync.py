"""
Integration tests for optional Google Calendar sync functionality.

Tests that appointment operations succeed even when Google Calendar sync is not available or fails.
"""

import pytest
from datetime import datetime, time, timedelta, timezone
from unittest.mock import AsyncMock, patch, MagicMock

from clinic_agents.context import ConversationContext
from clinic_agents.tools import (
    create_appointment_impl,
    cancel_appointment_impl,
    reschedule_appointment_impl
)
from models import (
    User, Clinic, AppointmentType, Patient, PractitionerAvailability,
    CalendarEvent, Appointment
)


class TestOptionalGoogleCalendarSync:
    """Test that Google Calendar sync is optional and doesn't block operations."""

    @pytest.fixture
    def test_clinic_with_practitioners(self, db_session):
        """Create test clinic with practitioners with and without GCal credentials."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.flush()

        # Practitioner WITH Google Calendar credentials
        practitioner_with_gcal = User(
            clinic_id=clinic.id,
            email="withgcal@example.com",
            google_subject_id="withgcal_subject",
            full_name="Dr. With GCal",
            roles=["practitioner"],
            is_active=True,
            gcal_credentials='encrypted_credentials_test'  # Mock encrypted credentials
        )
        db_session.add(practitioner_with_gcal)
        db_session.flush()

        # Practitioner WITHOUT Google Calendar credentials
        practitioner_without_gcal = User(
            clinic_id=clinic.id,
            email="withoutgcal@example.com",
            google_subject_id="withoutgcal_subject",
            full_name="Dr. Without GCal",
            roles=["practitioner"],
            is_active=True,
            gcal_credentials=None
        )
        db_session.add(practitioner_without_gcal)
        db_session.flush()

        # Create default availability for both practitioners
        for practitioner in [practitioner_with_gcal, practitioner_without_gcal]:
            for day in range(5):  # Monday to Friday
                availability = PractitionerAvailability(
                    user_id=practitioner.id,
                    day_of_week=day,
                    start_time=time(9, 0),
                    end_time=time(17, 0)
                )
                db_session.add(availability)

        # Create appointment type
        appointment_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Appointment",
            duration_minutes=60
        )
        db_session.add(appointment_type)
        db_session.flush()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        return {
            "clinic": clinic,
            "practitioner_with_gcal": practitioner_with_gcal,
            "practitioner_without_gcal": practitioner_without_gcal,
            "appointment_type": appointment_type,
            "patient": patient
        }

    @pytest.fixture
    def conversation_context(self, db_session, test_clinic_with_practitioners):
        """Create conversation context."""
        clinic = test_clinic_with_practitioners["clinic"]
        return ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,
            line_user_id="test_line_user",
            is_linked=False
        )

    @pytest.mark.asyncio
    async def test_create_appointment_without_gcal_credentials(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test that appointment can be created without Google Calendar credentials."""
        wrapper = AsyncMock()
        wrapper.context = conversation_context
        
        practitioner = test_clinic_with_practitioners["practitioner_without_gcal"]
        appointment_type = test_clinic_with_practitioners["appointment_type"]
        patient = test_clinic_with_practitioners["patient"]
        
        result = await create_appointment_impl(
            wrapper=wrapper,
            therapist_id=practitioner.id,
            appointment_type_id=appointment_type.id,
            start_time="2025-01-15 10:00",
            patient_id=patient.id
        )
        
        assert result["success"] == True
        assert "注意：此預約未同步至 Google 日曆" in result["message"]

        # Verify appointment was created in database
        appointment = db_session.query(Appointment).filter(
            Appointment.patient_id == patient.id
        ).first()
        assert appointment is not None
        assert appointment.calendar_event.gcal_event_id is None

    @pytest.mark.asyncio
    async def test_create_appointment_with_gcal_credentials_failure(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test that appointment is created even when Google Calendar sync fails."""
        wrapper = AsyncMock()
        wrapper.context = conversation_context
        
        practitioner = test_clinic_with_practitioners["practitioner_with_gcal"]
        appointment_type = test_clinic_with_practitioners["appointment_type"]
        patient = test_clinic_with_practitioners["patient"]
        
        start_time = "2025-01-15 10:00"
        
        # Mock decryption to succeed, but GCal service to fail
        with patch('clinic_agents.tools.create_appointment.get_encryption_service') as mock_encryption:
            mock_encryption.return_value.decrypt_data.return_value = {
                "access_token": "test_token",
                "refresh_token": "test_refresh"
            }
            
            with patch('clinic_agents.tools.create_appointment.GoogleCalendarService') as mock_gcal_class:
                mock_gcal_instance = AsyncMock()
                mock_gcal_instance.create_event = AsyncMock(side_effect=Exception("Google Calendar API error"))
                mock_gcal_class.return_value = mock_gcal_instance
                
                result = await create_appointment_impl(
                    wrapper=wrapper,
                    therapist_id=practitioner.id,
                    appointment_type_id=appointment_type.id,
                    start_time=start_time,
                    patient_id=patient.id
                )
        
        assert result["success"] == True
        assert "注意：此預約未同步至 Google 日曆" in result["message"]

        # Verify appointment was created in database despite GCal failure
        appointment = db_session.query(Appointment).filter(
            Appointment.patient_id == patient.id
        ).first()
        assert appointment is not None
        assert appointment.calendar_event.gcal_event_id is None

    @pytest.mark.asyncio
    async def test_create_appointment_with_successful_gcal_sync(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test that appointment is created and synced when Google Calendar works."""
        wrapper = AsyncMock()
        wrapper.context = conversation_context
        
        practitioner = test_clinic_with_practitioners["practitioner_with_gcal"]
        appointment_type = test_clinic_with_practitioners["appointment_type"]
        patient = test_clinic_with_practitioners["patient"]
        
        start_time = "2025-01-15 10:00"
        
        # Mock successful Google Calendar sync
        with patch('clinic_agents.tools.create_appointment.get_encryption_service') as mock_encryption:
            mock_encryption.return_value.decrypt_data.return_value = {
                "access_token": "test_token",
                "refresh_token": "test_refresh"
            }
            
            with patch('clinic_agents.tools.create_appointment.GoogleCalendarService') as mock_gcal_class:
                mock_gcal_instance = AsyncMock()
                mock_gcal_instance.create_event = AsyncMock(return_value={"id": "gcal_event_123"})
                mock_gcal_class.return_value = mock_gcal_instance
                
                result = await create_appointment_impl(
                    wrapper=wrapper,
                    therapist_id=practitioner.id,
                    appointment_type_id=appointment_type.id,
                    start_time=start_time,
                    patient_id=patient.id
                )
        
        assert result["success"] == True
        assert "預約成功" in result["message"]

        # Verify appointment was created with GCal event ID
        appointment = db_session.query(Appointment).filter(
            Appointment.patient_id == patient.id
        ).first()
        assert appointment is not None
        assert appointment.calendar_event.gcal_event_id == "gcal_event_123"

    @pytest.mark.asyncio
    async def test_cancel_appointment_without_gcal(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test that appointment can be canceled without Google Calendar sync."""
        wrapper = AsyncMock()
        wrapper.context = conversation_context

        practitioner = test_clinic_with_practitioners["practitioner_without_gcal"]
        appointment_type = test_clinic_with_practitioners["appointment_type"]
        patient = test_clinic_with_practitioners["patient"]

        # Create an appointment first
        start_time_dt = datetime(2025, 1, 15, 10, 0)
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type='appointment',
            date=start_time_dt.date(),
            start_time=start_time_dt.time(),
            end_time=(start_time_dt + timedelta(minutes=60)).time(),
            gcal_event_id=None
        )
        db_session.add(calendar_event)
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()
        
        # Cancel the appointment using the implementation function
        result = await cancel_appointment_impl(
            wrapper=wrapper,
            appointment_id=calendar_event.id,
            patient_id=patient.id
        )
        
        assert result["success"] == True
        assert result["appointment_id"] == calendar_event.id
        assert result["calendar_synced"] == False
        assert "gcal_event_id" not in result
        
        # Verify appointment was canceled in database
        db_session.refresh(appointment)
        assert appointment.status == 'canceled_by_patient'

    @pytest.mark.asyncio
    async def test_cancel_appointment_with_gcal_failure(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test that appointment cancellation succeeds even when Google Calendar sync fails."""
        wrapper = AsyncMock()
        wrapper.context = conversation_context

        practitioner = test_clinic_with_practitioners["practitioner_with_gcal"]
        appointment_type = test_clinic_with_practitioners["appointment_type"]
        patient = test_clinic_with_practitioners["patient"]

        # Create an appointment with existing GCal event
        start_time_dt = datetime(2025, 1, 15, 10, 0)
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type='appointment',
            date=start_time_dt.date(),
            start_time=start_time_dt.time(),
            end_time=(start_time_dt + timedelta(minutes=60)).time(),
            gcal_event_id="existing_gcal_123"
        )
        db_session.add(calendar_event)
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()
        
        # Mock GCal service to fail during deletion
        with patch('clinic_agents.tools.create_appointment.get_encryption_service') as mock_encryption:
            mock_encryption.return_value.decrypt_data.return_value = {
                "access_token": "test_token",
                "refresh_token": "test_refresh"
            }
            
            with patch('clinic_agents.tools.cancel_appointment.GoogleCalendarService') as mock_gcal_class:
                mock_gcal_instance = AsyncMock()
                mock_gcal_instance.delete_event = AsyncMock(side_effect=Exception("Google Calendar API error"))
                mock_gcal_class.return_value = mock_gcal_instance

                result = await cancel_appointment_impl(
                    wrapper=wrapper,
                    appointment_id=calendar_event.id,
                    patient_id=patient.id
                )
        
        assert result["success"] == True
        assert result["appointment_id"] == calendar_event.id
        assert result["calendar_synced"] == False
        assert "日曆同步失敗" in result["message"]
        
        # Verify appointment was canceled in database despite GCal failure
        db_session.refresh(appointment)
        assert appointment.status == 'canceled_by_patient'

    @pytest.mark.asyncio
    async def test_reschedule_appointment_without_gcal(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test that appointment can be rescheduled without Google Calendar sync."""
        wrapper = AsyncMock()
        wrapper.context = conversation_context

        practitioner = test_clinic_with_practitioners["practitioner_without_gcal"]
        appointment_type = test_clinic_with_practitioners["appointment_type"]
        patient = test_clinic_with_practitioners["patient"]

        # Create an appointment first
        start_time_dt = datetime(2025, 1, 15, 10, 0)
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type='appointment',
            date=start_time_dt.date(),
            start_time=start_time_dt.time(),
            end_time=(start_time_dt + timedelta(minutes=60)).time(),
            gcal_event_id=None
        )
        db_session.add(calendar_event)
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()
        
        # Reschedule the appointment
        new_start_time = datetime(2025, 1, 16, 14, 0, tzinfo=timezone(timedelta(hours=8)))
        result = await reschedule_appointment_impl(
            wrapper=wrapper,
            appointment_id=calendar_event.id,
            patient_id=patient.id,
            new_start_time=new_start_time
        )
        
        assert result["success"] == True
        assert result["appointment_id"] == calendar_event.id
        assert result["calendar_synced"] == False
        assert "gcal_event_id" not in result
        
        # Verify appointment was rescheduled in database
        db_session.refresh(calendar_event)
        assert calendar_event.start_time == new_start_time.time()
        assert calendar_event.gcal_event_id is None

    @pytest.mark.asyncio
    async def test_reschedule_appointment_with_gcal_failure(self, conversation_context, test_clinic_with_practitioners, db_session):
        """Test that rescheduling succeeds even when Google Calendar sync fails."""
        wrapper = AsyncMock()
        wrapper.context = conversation_context

        practitioner = test_clinic_with_practitioners["practitioner_with_gcal"]
        appointment_type = test_clinic_with_practitioners["appointment_type"]
        patient = test_clinic_with_practitioners["patient"]

        # Create an appointment with existing GCal event
        start_time_dt = datetime(2025, 1, 15, 10, 0)
        calendar_event = CalendarEvent(
            user_id=practitioner.id,
            event_type='appointment',
            date=start_time_dt.date(),
            start_time=start_time_dt.time(),
            end_time=(start_time_dt + timedelta(minutes=60)).time(),
            gcal_event_id="existing_gcal_123"
        )
        db_session.add(calendar_event)
        db_session.flush()
        
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appointment_type.id,
            status='confirmed'
        )
        db_session.add(appointment)
        db_session.commit()
        
        # Mock GCal service to fail during update
        new_start_time = datetime(2025, 1, 16, 14, 0, tzinfo=timezone(timedelta(hours=8)))
        
        with patch('clinic_agents.tools.create_appointment.get_encryption_service') as mock_encryption:
            mock_encryption.return_value.decrypt_data.return_value = {
                "access_token": "test_token",
                "refresh_token": "test_refresh"
            }
            
            with patch('clinic_agents.tools.reschedule_appointment.GoogleCalendarService') as mock_gcal_class:
                mock_gcal_instance = AsyncMock()
                mock_gcal_instance.update_event = AsyncMock(side_effect=Exception("Google Calendar API error"))
                mock_gcal_class.return_value = mock_gcal_instance

                result = await reschedule_appointment_impl(
                    wrapper=wrapper,
                    appointment_id=calendar_event.id,
                    patient_id=patient.id,
                    new_start_time=new_start_time
                )
        
        assert result["success"] == True
        assert result["appointment_id"] == calendar_event.id
        assert result["calendar_synced"] == False
        assert "日曆同步失敗" in result["message"]
        
        # Verify appointment was rescheduled in database despite GCal failure
        db_session.refresh(calendar_event)
        assert calendar_event.start_time == new_start_time.time()
        assert calendar_event.gcal_event_id is None  # Should be cleared on failure
