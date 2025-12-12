"""
Integration tests for PDF receipt generation.
"""

import pytest
from decimal import Decimal
from datetime import datetime, date, time, timezone
from sqlalchemy.orm import Session

from models import Clinic, User, Patient, AppointmentType, Appointment, CalendarEvent, Receipt
from models.user_clinic_association import UserClinicAssociation
from services.receipt_service import ReceiptService
from services.pdf_service import PDFService


class TestPDFGeneration:
    """Test PDF generation for receipts."""

    def test_generate_pdf_receipt(self, db_session: Session):
        """Test generating PDF from receipt_data."""
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

        # Generate PDF
        pdf_service = PDFService()
        receipt_data = receipt.receipt_data
        pdf_bytes = pdf_service.generate_receipt_pdf(
            receipt_data=receipt_data,
            is_voided=receipt.is_voided
        )

        # Verify PDF was generated
        assert pdf_bytes is not None
        assert len(pdf_bytes) > 0
        assert pdf_bytes.startswith(b'%PDF')  # PDF file signature

    def test_generate_html_receipt(self, db_session: Session):
        """Test generating HTML from receipt_data."""
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

        # Generate HTML
        pdf_service = PDFService()
        receipt_data = receipt.receipt_data
        html_content = pdf_service.generate_receipt_html(
            receipt_data=receipt_data,
            is_voided=receipt.is_voided
        )

        # Verify HTML was generated
        assert html_content is not None
        assert len(html_content) > 0
        assert '<html' in html_content.lower()
        assert receipt_data['clinic']['display_name'] in html_content
        assert receipt_data['patient']['name'] in html_content

    def test_generate_pdf_with_voided_receipt(self, db_session: Session):
        """Test generating PDF for voided receipt (should show watermark)."""
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

        # Void receipt
        ReceiptService.void_receipt(
            db=db_session,
            receipt_id=receipt.id,
            voided_by_user_id=admin_user.id,
            reason="Test voiding"
        )
        db_session.commit()
        db_session.refresh(receipt)

        # Generate PDF for voided receipt
        pdf_service = PDFService()
        receipt_data = receipt.receipt_data
        pdf_bytes = pdf_service.generate_receipt_pdf(
            receipt_data=receipt_data,
            is_voided=receipt.is_voided
        )

        # Verify PDF was generated
        assert pdf_bytes is not None
        assert len(pdf_bytes) > 0
        assert pdf_bytes.startswith(b'%PDF')  # PDF file signature

