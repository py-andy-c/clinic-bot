"""
Integration tests for receipt immutability enforcement.
"""

import pytest
from decimal import Decimal
from datetime import datetime, date, time, timezone
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from models import Clinic, User, Patient, AppointmentType, Appointment, CalendarEvent, Receipt
from models.user_clinic_association import UserClinicAssociation
from services.receipt_service import ReceiptService


class TestReceiptDataImmutability:
    """Test that receipt_data JSONB is immutable after creation."""

    @pytest.fixture
    def setup_receipt(self, db_session: Session):
        """Create a receipt for testing."""
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
        
        return receipt, db_session

    def test_receipt_data_cannot_be_modified(self, setup_receipt):
        """Test that attempting to modify receipt_data raises an exception."""
        receipt, db_session = setup_receipt
        
        # Try to modify receipt_data
        original_data = receipt.receipt_data.copy()
        modified_data = original_data.copy()
        modified_data["total_amount"] = 9999.99  # Try to change total
        
        receipt.receipt_data = modified_data
        
        # Attempt to save - should raise exception from database trigger
        with pytest.raises((IntegrityError, Exception)) as exc_info:
            db_session.commit()
        
        # Verify the error message indicates immutability
        error_message = str(exc_info.value).lower()
        assert "immutable" in error_message or "cannot be modified" in error_message

    def test_receipt_data_immutability_trigger_exists(self, setup_receipt):
        """Test that the immutability trigger is active."""
        receipt, db_session = setup_receipt
        
        # Verify trigger prevents modification
        original_data = receipt.receipt_data.copy()
        
        # Try to modify any field in receipt_data
        modified_data = original_data.copy()
        modified_data["payment_method"] = "card"  # Change payment method
        
        receipt.receipt_data = modified_data
        
        # Should raise exception
        with pytest.raises((IntegrityError, Exception)):
            db_session.commit()


class TestVoidInfoImmutability:
    """Test that void info columns are immutable after voiding."""

    @pytest.fixture
    def setup_voided_receipt(self, db_session: Session):
        """Create a voided receipt for testing."""
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
        
        # Void receipt
        voided_receipt = ReceiptService.void_receipt(
            db=db_session,
            receipt_id=receipt.id,
            voided_by_user_id=admin_user.id,
            reason="Test void reason"
        )
        db_session.commit()
        
        return voided_receipt, db_session

    def test_void_reason_cannot_be_modified_after_voiding(self, setup_voided_receipt):
        """Test that void_reason cannot be modified after voiding."""
        receipt, db_session = setup_voided_receipt
        
        # Try to modify void_reason
        original_reason = receipt.void_reason
        receipt.void_reason = "Modified reason"
        
        # Attempt to save - should raise exception from database trigger
        with pytest.raises((IntegrityError, Exception)) as exc_info:
            db_session.commit()
        
        # Verify the error message indicates void info immutability
        error_message = str(exc_info.value).lower()
        assert "void" in error_message or "cannot be modified" in error_message

    def test_void_info_columns_immutable_after_voiding(self, setup_voided_receipt):
        """Test that all void info columns are immutable after voiding."""
        receipt, db_session = setup_voided_receipt
        
        # Try to modify voided_at
        receipt.voided_at = datetime.now(timezone.utc)
        
        # Should raise exception
        with pytest.raises((IntegrityError, Exception)):
            db_session.commit()


class TestVoidReasonPersistence:
    """Test that void reason is properly stored and retrieved."""

    def test_void_reason_stored_in_column(self, db_session: Session):
        """Test that void reason is stored in void_reason column."""
        # Setup (same as above)
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

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

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        )
        db_session.add(apt_type)
        db_session.commit()

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

        # Void receipt with reason
        void_reason = "Customer requested cancellation"
        voided_receipt = ReceiptService.void_receipt(
            db=db_session,
            receipt_id=receipt.id,
            voided_by_user_id=admin_user.id,
            reason=void_reason
        )
        db_session.commit()

        # Verify void_reason is stored
        assert voided_receipt.void_reason == void_reason
        
        # Refresh from database to verify persistence
        db_session.refresh(voided_receipt)
        assert voided_receipt.void_reason == void_reason
