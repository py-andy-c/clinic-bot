"""
Integration tests for appointment modification constraints.
"""

import pytest
from datetime import datetime, date, time, timezone
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models import Clinic, User, Patient, AppointmentType, Appointment, CalendarEvent, Receipt
from models.user_clinic_association import UserClinicAssociation
from services.receipt_service import ReceiptService
from services.appointment_service import AppointmentService


class TestAppointmentModificationConstraint:
    """Test that appointments with receipts cannot be modified."""

    @pytest.fixture
    def setup_appointment_with_receipt(self, db_session: Session):
        """Create an appointment with a receipt for testing."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create admin user
        admin_user = User(
            email="admin@test.com",
            google_subject_id="google_admin_123"
        )
        db_session.add(admin_user)
        db_session.flush()

        association = UserClinicAssociation(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            full_name="Admin User",
            roles=["admin"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment type
        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        )
        db_session.add(apt_type)
        db_session.commit()

        # Create calendar event
        calendar_event = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=date.today(),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        # Create appointment
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=apt_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Create receipt
        items = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type.id,
                "practitioner_id": None,
                "billing_scenario_id": None,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "display_order": 0
            }
        ]
        
        receipt = ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items,
            payment_method="cash"
        )
        db_session.commit()
        
        return appointment, receipt, db_session

    def test_cannot_update_appointment_with_receipt(self, setup_appointment_with_receipt):
        """Test that update_appointment raises 403 when receipt exists."""
        appointment, receipt, db_session = setup_appointment_with_receipt
        
        # Try to update appointment
        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment.calendar_event_id,
                new_practitioner_id=None,
                new_start_time=None,
                new_notes="Updated notes"
            )
        
        # Verify 403 error
        assert exc_info.value.status_code == 403
        assert "已有收據" in exc_info.value.detail or "receipt" in exc_info.value.detail.lower()

    def test_cannot_cancel_appointment_with_receipt(self, setup_appointment_with_receipt):
        """Test that cancel_appointment raises 403 when receipt exists."""
        appointment, receipt, db_session = setup_appointment_with_receipt
        
        # Try to cancel appointment
        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.cancel_appointment(
                db=db_session,
                appointment_id=appointment.calendar_event_id,
                cancelled_by="clinic"
            )
        
        # Verify 403 error
        assert exc_info.value.status_code == 403
        assert "已有收據" in exc_info.value.detail or "receipt" in exc_info.value.detail.lower()

    def test_can_modify_appointment_without_receipt(self, db_session: Session):
        """Test that appointments without receipts can be modified."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create admin user
        admin_user = User(
            email="admin@test.com",
            google_subject_id="google_admin_123"
        )
        db_session.add(admin_user)
        db_session.flush()

        association = UserClinicAssociation(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            full_name="Admin User",
            roles=["admin"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment type
        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        )
        db_session.add(apt_type)
        db_session.commit()

        # Create calendar event
        calendar_event = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=date.today(),
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        # Create appointment
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=apt_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Update appointment - should succeed (no receipt)
        result = AppointmentService.update_appointment(
            db=db_session,
            appointment_id=appointment.calendar_event_id,
            new_practitioner_id=None,
            new_start_time=None,
            new_notes="Updated notes"
        )
        
        # Verify update succeeded
        assert result is not None

    def test_appointment_with_voided_receipt_cannot_be_modified(self, setup_appointment_with_receipt):
        """Test that appointments with voided receipts still cannot be modified."""
        appointment, receipt, db_session = setup_appointment_with_receipt
        
        # Void the receipt
        ReceiptService.void_receipt(
            db=db_session,
            receipt_id=receipt.id,
            voided_by_user_id=appointment.calendar_event.user_id,
            reason="Test void"
        )
        db_session.commit()
        
        # Try to update appointment - should still fail (voided receipt still counts)
        with pytest.raises(HTTPException) as exc_info:
            AppointmentService.update_appointment(
                db=db_session,
                appointment_id=appointment.calendar_event_id,
                new_practitioner_id=None,
                new_start_time=None,
                new_notes="Updated notes"
            )
        
        # Verify 403 error
        assert exc_info.value.status_code == 403
