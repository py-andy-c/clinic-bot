"""
Integration tests for receipt and billing endpoints.
"""

import pytest
from decimal import Decimal
from datetime import datetime, date, time, timezone
from sqlalchemy.orm import Session

from models import Clinic, User, Patient, AppointmentType, Appointment, CalendarEvent, PractitionerAppointmentTypes, Receipt
from models.user_clinic_association import UserClinicAssociation
from services.receipt_service import ReceiptService
from services.billing_scenario_service import BillingScenarioService
from services.accounting_service import AccountingService


class TestCheckoutEndpoint:
    """Test checkout endpoint."""

    def test_checkout_appointment_success(self, db_session: Session):
        """Test successful checkout."""
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

        # Create calendar event and appointment
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

        # Test checkout via service (direct service testing)
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
        
        assert receipt is not None
        assert receipt.receipt_number.startswith(str(datetime.now(timezone.utc).year))
        assert receipt.total_amount == Decimal("1000.00")
        assert receipt.total_revenue_share == Decimal("300.00")
        assert receipt.is_voided is False
        
        # Verify quantity is stored in receipt_data
        receipt_data = receipt.receipt_data
        assert len(receipt_data["items"]) == 1
        assert receipt_data["items"][0].get("quantity", 1) == 1  # Default quantity

    def test_checkout_with_quantity_multiple_items(self, db_session: Session):
        """Test checkout with quantity > 1 and verify money calculations are correct."""
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

        # Create calendar event and appointment
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

        # Test checkout with quantity = 3
        # Unit price: 1000, quantity: 3, expected total: 3000
        # Unit revenue_share: 300, quantity: 3, expected total: 900
        items = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type.id,
                "practitioner_id": None,
                "billing_scenario_id": None,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "display_order": 0,
                "quantity": 3
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
        
        # Verify totals are calculated correctly with quantity
        assert receipt.total_amount == Decimal("3000.00")  # 1000 * 3
        assert receipt.total_revenue_share == Decimal("900.00")  # 300 * 3
        
        # Verify quantity is stored in receipt_data
        receipt_data = receipt.receipt_data
        assert len(receipt_data["items"]) == 1
        assert receipt_data["items"][0]["quantity"] == 3
        assert receipt_data["items"][0]["amount"] == 1000.00  # Unit amount
        assert receipt_data["items"][0]["revenue_share"] == 300.00  # Unit revenue_share

    def test_checkout_multiple_items_with_different_quantities(self, db_session: Session):
        """Test checkout with multiple items having different quantities."""
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

        # Test with multiple items with different quantities
        # Item 1: 1000 * 2 = 2000, revenue_share: 300 * 2 = 600
        # Item 2: 500 * 3 = 1500, revenue_share: 150 * 3 = 450
        # Total: 3500, Total revenue_share: 1050
        items = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type.id,
                "practitioner_id": None,
                "billing_scenario_id": None,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "display_order": 0,
                "quantity": 2
            },
            {
                "item_type": "other",
                "item_name": "其他服務",
                "practitioner_id": None,
                "amount": 500.00,
                "revenue_share": 150.00,
                "display_order": 1,
                "quantity": 3
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
        
        # Verify totals
        assert receipt.total_amount == Decimal("3500.00")  # (1000*2) + (500*3)
        assert receipt.total_revenue_share == Decimal("1050.00")  # (300*2) + (150*3)
        
        # Verify items in receipt_data
        receipt_data = receipt.receipt_data
        assert len(receipt_data["items"]) == 2
        assert receipt_data["items"][0]["quantity"] == 2
        assert receipt_data["items"][1]["quantity"] == 3

    def test_checkout_prevents_duplicate_active_receipt(self, db_session: Session):
        """Test that checkout fails if active receipt already exists."""
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

        # Create first receipt
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
        
        receipt1 = ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items,
            payment_method="cash"
        )
        db_session.commit()
        
        # Try to create second receipt (should fail)
        from services.receipt_service import ConcurrentCheckoutError
        with pytest.raises(ConcurrentCheckoutError, match="此預約已有收據，無法重複結帳"):
            ReceiptService.create_receipt(
                db=db_session,
                appointment_id=appointment.calendar_event_id,
                clinic_id=clinic.id,
                checked_out_by_user_id=admin_user.id,
                items=items,
                payment_method="cash"
            )

    def test_checkout_validates_revenue_share(self, db_session: Session):
        """Test that checkout validates revenue_share <= amount."""
        # Setup
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

        # Try checkout with invalid revenue_share
        items = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type.id,
                "practitioner_id": None,
                "billing_scenario_id": None,
                "amount": 1000.00,
                "revenue_share": 1500.00,  # Invalid: > amount
                "display_order": 0
            }
        ]
        
        with pytest.raises(ValueError, match="revenue_share.*must be <= amount"):
            ReceiptService.create_receipt(
                db=db_session,
                appointment_id=appointment.calendar_event_id,
                clinic_id=clinic.id,
                checked_out_by_user_id=admin_user.id,
                items=items,
                payment_method="cash"
            )


class TestReceiptViewing:
    """Test receipt viewing endpoints."""

    def test_get_receipt_for_appointment(self, db_session: Session):
        """Test getting receipt for an appointment."""
        # Setup
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

        # Get receipt
        retrieved_receipt = ReceiptService.get_receipt_for_appointment(
            db_session, appointment.calendar_event_id
        )
        
        assert retrieved_receipt is not None
        assert retrieved_receipt.id == receipt.id
        assert retrieved_receipt.receipt_number == receipt.receipt_number


class TestReceiptVoiding:
    """Test receipt voiding."""

    def test_void_receipt_success(self, db_session: Session):
        """Test successful receipt voiding."""
        # Setup
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

        # Void receipt
        void_reason = "Test voiding reason"
        voided_receipt = ReceiptService.void_receipt(
            db=db_session,
            receipt_id=receipt.id,
            voided_by_user_id=admin_user.id,
            reason=void_reason
        )
        db_session.commit()

        assert voided_receipt.is_voided is True
        assert voided_receipt.voided_at is not None
        assert voided_receipt.voided_by_user_id == admin_user.id
        assert voided_receipt.void_reason == void_reason  # Verify void reason is stored

    def test_void_receipt_already_voided(self, db_session: Session):
        """Test that voiding an already voided receipt fails."""
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

        # Create and void receipt
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

        ReceiptService.void_receipt(
            db=db_session,
            receipt_id=receipt.id,
            voided_by_user_id=admin_user.id
        )
        db_session.commit()

        # Try to void again (should fail)
        with pytest.raises(ValueError, match="already voided"):
            ReceiptService.void_receipt(
                db=db_session,
                receipt_id=receipt.id,
                voided_by_user_id=admin_user.id
            )


class TestReceiptQuantityAccounting:
    """Test quantity handling in accounting calculations."""
    
    def test_accounting_summary_with_quantity(self, db_session: Session):
        """Test that accounting summary correctly calculates totals with quantity."""
        # Setup
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

        # Create two receipts with different quantities
        today = date.today()
        
        # Receipt 1: quantity = 2, amount = 1000, revenue_share = 300
        # Expected: total = 2000, revenue_share = 600
        calendar_event1 = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=today,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event1)
        db_session.commit()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=apt_type.id,
            status="confirmed"
        )
        db_session.add(appointment1)
        db_session.commit()

        receipt1 = ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment1.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=[{
                "item_type": "service_item",
                "service_item_id": apt_type.id,
                "practitioner_id": None,
                "billing_scenario_id": None,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "display_order": 0,
                "quantity": 2
            }],
            payment_method="cash"
        )
        db_session.commit()

        # Receipt 2: quantity = 3, amount = 500, revenue_share = 150
        # Expected: total = 1500, revenue_share = 450
        calendar_event2 = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=today,
            start_time=time(14, 0),
            end_time=time(15, 0)
        )
        db_session.add(calendar_event2)
        db_session.commit()

        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=apt_type.id,
            status="confirmed"
        )
        db_session.add(appointment2)
        db_session.commit()

        receipt2 = ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment2.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=[{
                "item_type": "service_item",
                "service_item_id": apt_type.id,
                "practitioner_id": None,
                "billing_scenario_id": None,
                "amount": 500.00,
                "revenue_share": 150.00,
                "display_order": 0,
                "quantity": 3
            }],
            payment_method="cash"
        )
        db_session.commit()

        # Get accounting summary
        summary = AccountingService.get_accounting_summary(
            db=db_session,
            clinic_id=clinic.id,
            start_date=today,
            end_date=today
        )

        # Verify totals: (1000*2) + (500*3) = 2000 + 1500 = 3500
        assert summary["summary"]["total_revenue"] == 3500.00
        # Verify revenue_share: (300*2) + (150*3) = 600 + 450 = 1050
        assert summary["summary"]["total_revenue_share"] == 1050.00
        assert summary["summary"]["receipt_count"] == 2

        # Verify service item stats
        service_item_stats = summary["by_service_item"]
        assert len(service_item_stats) == 1
        si_stat = service_item_stats[0]
        assert si_stat["total_revenue"] == Decimal("3500.00")
        assert si_stat["total_revenue_share"] == Decimal("1050.00")
        # Item count should be sum of quantities: 2 + 3 = 5
        assert si_stat["item_count"] == 5

    def test_accounting_backward_compatibility_no_quantity(self, db_session: Session):
        """Test that accounting works with old receipts that don't have quantity field."""
        # Setup
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

        today = date.today()
        calendar_event = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=today,
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

        # Create receipt without quantity (simulating old receipt)
        receipt = ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=[{
                "item_type": "service_item",
                "service_item_id": apt_type.id,
                "practitioner_id": None,
                "billing_scenario_id": None,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "display_order": 0
                # No quantity field - should default to 1
            }],
            payment_method="cash"
        )
        db_session.commit()

        # Get accounting summary
        summary = AccountingService.get_accounting_summary(
            db=db_session,
            clinic_id=clinic.id,
            start_date=today,
            end_date=today
        )

        # Should treat as quantity = 1
        assert summary["summary"]["total_revenue"] == 1000.00
        assert summary["summary"]["total_revenue_share"] == 300.00
        assert summary["summary"]["receipt_count"] == 1


class TestBillingScenarioEndpoints:
    """Test billing scenario endpoints."""

    def test_create_billing_scenario(self, db_session: Session):
        """Test creating a billing scenario."""
        from services.billing_scenario_service import BillingScenarioService
        
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        user = User(
            email="practitioner@test.com",
            google_subject_id="google_practitioner_123"
        )
        db_session.add(user)
        db_session.flush()

        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            full_name="Test Practitioner",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        )
        db_session.add(apt_type)
        db_session.commit()

        pat = PractitionerAppointmentTypes(
            user_id=user.id,
            appointment_type_id=apt_type.id,
            clinic_id=clinic.id
        )
        db_session.add(pat)
        db_session.commit()

        # Create billing scenario
        scenario = BillingScenarioService.create_billing_scenario(
            db=db_session,
            practitioner_appointment_type_id=pat.id,
            name="原價",
            amount=Decimal("1000.00"),
            revenue_share=Decimal("300.00"),
            is_default=True
        )
        db_session.commit()

        assert scenario.name == "原價"
        assert scenario.amount == Decimal("1000.00")
        assert scenario.revenue_share == Decimal("300.00")
        assert scenario.is_default is True

    def test_billing_scenario_revenue_share_validation(self, db_session: Session):
        """Test that billing scenario validates revenue_share <= amount."""
        from services.billing_scenario_service import BillingScenarioService
        
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        user = User(
            email="practitioner@test.com",
            google_subject_id="google_practitioner_456"
        )
        db_session.add(user)
        db_session.flush()

        association = UserClinicAssociation(
            user_id=user.id,
            clinic_id=clinic.id,
            full_name="Test Practitioner",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        apt_type = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            duration_minutes=60
        )
        db_session.add(apt_type)
        db_session.commit()

        pat = PractitionerAppointmentTypes(
            user_id=user.id,
            appointment_type_id=apt_type.id,
            clinic_id=clinic.id
        )
        db_session.add(pat)
        db_session.commit()

        # Try to create scenario with invalid revenue_share
        with pytest.raises(ValueError, match="revenue_share must be <= amount"):
            BillingScenarioService.create_billing_scenario(
                db=db_session,
                practitioner_appointment_type_id=pat.id,
                name="無效方案",
                amount=Decimal("1000.00"),
                revenue_share=Decimal("1500.00"),  # Invalid
                is_default=False
            )


